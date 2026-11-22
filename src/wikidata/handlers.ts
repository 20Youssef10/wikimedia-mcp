import type { Config } from '../config.js';
import type { ToolResponse } from '../types.js';
import { asRecord, type WikimediaClient } from '../upstream/client.js';
import { errorToolResult, okToolResult } from '../protocol/result.js';
import { enforceResultLimit } from '../protocol/limits.js';
import { UpstreamError } from '../upstream/retry.js';
import {
  SparqlExecutionError, SparqlGuardError, SparqlParseError, SparqlRunner,
  LABEL_SERVICE_TIMEOUT_MS, guardQuery, usesLabelService, type SparqlSuccess,
} from '../upstream/wikidata-sparql.js';
import { WikibaseClient } from './wikibase.js';
import { WikidataToolError, wdError } from './errors.js';
import { wikidataProvenance } from './provenance.js';
import {
  EXTERNAL_SCHEMES, PROPERTY_LABELS, QID_RE, SITE_CODE_RE, TITLE_FORBIDDEN_RE,
  WIKIDATA_ENTITY_BASE, isAllowedSite, normalizeExternalId, siteBaseUrl, sitelinkUrl,
  type ExternalScheme,
} from './constants.js';
import { buildGroupBSchemas, issueCodeForPath, type GroupBSchemaMap } from './schemas.js';

type GroupBHandler = (raw: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResponse>;
type JsonRecord = Record<string, unknown>;

function escapeSparqlLiteral(value: string): string {
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    wdError('invalid_external_id', 'The identifier contains control characters and was rejected.');
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function languageValues(raw: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [lang, value] of Object.entries(raw as JsonRecord)) {
    if (typeof value === 'string') result[lang] = value;
    else {
      const record = asRecord(value);
      if (record !== null && typeof record['value'] === 'string') result[lang] = record['value'];
    }
  }
  return result;
}

function aliasValues(raw: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [lang, value] of Object.entries(raw as JsonRecord)) {
    const items = Array.isArray(value) ? value : [];
    result[lang] = items.flatMap((item) => {
      if (typeof item === 'string') return [item];
      const record = asRecord(item);
      return record !== null && typeof record['value'] === 'string' ? [record['value']] : [];
    });
  }
  return result;
}

function snakValue(mainsnak: unknown): { type: string; content: unknown } | null {
  const snak = asRecord(mainsnak);
  if (snak === null) return null;
  const datavalue = asRecord(snak['datavalue']) ?? asRecord(snak['value']);
  if (datavalue === null) return { type: typeof snak['type'] === 'string' ? snak['type'] : 'value', content: snak['value'] ?? null };
  return {
    type: typeof datavalue['type'] === 'string' ? datavalue['type'] : 'value',
    content: datavalue['value'] ?? null,
  };
}

const RANK_ORDER: Record<string, number> = { preferred: 0, normal: 1, deprecated: 2 };

type MappedStatement = {
  id: string;
  rank: string;
  value: { type: string; content: unknown } | null;
  qualifiers: unknown[];
  references_count: number;
  value_label: string | null;
};

/**
 * Create the six Phase 2 Group B handlers. All share the fixed error envelope,
 * CC0 provenance and central result cap; all read-only (§3.4).
 */
export function createWikidataHandlers(
  client: WikimediaClient,
  config: Config,
  options: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Record<string, GroupBHandler> {
  const schemas: GroupBSchemaMap = buildGroupBSchemas(config);
  const wb = new WikibaseClient(client);
  const sparql = new SparqlRunner(config, client, options);

  function groupBError(name: string, error: unknown): ToolResponse {
    if (error instanceof WikidataToolError) {
      return errorToolResult(error.code, error.message, {
        ...error.options,
        details: { ...(error.options.details ?? {}), tool: name },
      });
    }
    if (error instanceof SparqlGuardError) {
      return errorToolResult(error.code, error.message, {
        retryable: false,
        details: { tool: name, backend: 'wdqs' },
        ...(error.limits === undefined ? {} : { limits: error.limits }),
      });
    }
    if (error instanceof SparqlExecutionError) {
      return errorToolResult(error.code, error.message, {
        retryable: error.options.retryable ?? true,
        ...(error.options.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.options.retryAfterSeconds }),
        ...(error.options.hint === undefined ? {} : { hint: error.options.hint }),
        ...(error.options.action === undefined ? {} : { action: error.options.action }),
        details: { ...(error.options.details ?? {}), tool: name },
      });
    }
    if (error instanceof SparqlParseError) {
      return errorToolResult('upstream_unavailable', error.message, {
        retryable: true,
        details: { tool: name, backend: 'wdqs', parse_error: error.detail },
        action: 'Retry once; if it persists, use a simpler SPARQL 1.1 SELECT.',
      });
    }
    if (error instanceof UpstreamError) {
      if (error.status === 0) {
        const host = error.host ?? 'the upstream host';
        return errorToolResult('upstream_unavailable', `Could not reach Wikidata at ${host}.`, {
          retryable: true,
          hint: `Check network access to ${host} and retry.`,
          action: `Verify network access to ${host}, then retry.`,
          details: { tool: name, host, network: true },
        });
      }
      if (error.status === 429) {
        return errorToolResult('rate_limited', 'Wikidata is rate-limiting requests after bounded retries.', {
          retryable: true,
          retryAfterSeconds: Math.ceil((error.retryAfterMs ?? config.retryAfterFallbackMs) / 1000),
          details: { tool: name, http_status: 429, backend: 'wikibase-rest-v1' },
        });
      }
      return errorToolResult('upstream_unavailable', 'The Wikidata service is temporarily unavailable. Retry shortly.', {
        retryable: true, details: { tool: name, http_status: error.status },
      });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return errorToolResult('timeout', 'The Wikidata request was cancelled or timed out. Retry the call.', {
        retryable: true, details: { tool: name },
      });
    }
    return errorToolResult('internal_error', `An internal error occurred in ${name}. Retry with the correlation ID.`, {
      retryable: true, details: { tool: name },
    });
  }

  async function run(
    name: string,
    raw: Record<string, unknown>,
    signal: AbortSignal | undefined,
    fn: (input: JsonRecord, signal?: AbortSignal) => Promise<JsonRecord>,
  ): Promise<ToolResponse> {
    const schema = schemas[name];
    if (schema === undefined) return errorToolResult('internal_error', `Unregistered tool ${name}.`, { retryable: false });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const code = issueCodeForPath(issue?.path ?? []);
      const detail = parsed.error.issues.map((item) => `${item.path.join('.')}: ${item.message}`).join('; ');
      return errorToolResult(code, `Invalid arguments for ${name}: ${detail}`, {
        retryable: false,
        ...(code === 'unsupported_scheme' ? { hint: `Allowed schemes: ${EXTERNAL_SCHEMES.join(', ')}.` } : {}),
        details: { tool: name },
      });
    }
    try {
      const output = await fn(parsed.data as JsonRecord, signal);
      return okToolResult(enforceResultLimit(output, config.maxResultBytes));
    } catch (error) {
      return groupBError(name, error);
    }
  }

  return {
    async wikidata_search_entities(raw, signal) {
      return run('wikidata_search_entities', raw, signal, async (input, childSignal) => {
        const params = new URLSearchParams({
          q: String(input['query']), language: String(input['language']),
          limit: String(input['limit']), offset: String(input['offset']),
        });
        const response = await wb.get(`/search/items?${params.toString()}`, {
          ...(childSignal === undefined ? {} : { signal: childSignal }),
        });
        if (response.status !== 200) {
          wdError('upstream_unavailable', 'Wikidata item search is temporarily unavailable.', {
            retryable: true, details: { http_status: response.status, backend: 'wikibase-rest-v1' },
          });
        }
        const root = asRecord(response.json) ?? {};
        const hits = Array.isArray(root['results']) ? root['results'] : [];
        const results = hits.slice(0, Number(input['limit'])).flatMap((hit) => {
          const entry = asRecord(hit);
          if (entry === null || typeof entry['id'] !== 'string') return [];
          const label = asRecord(entry['display-label']);
          const description = asRecord(entry['description']);
          const qid = entry['id'];
          return [{
            qid,
            label: typeof label?.['value'] === 'string' ? label['value'] : '',
            description: typeof description?.['value'] === 'string' ? description['value'] : '',
            url: `${WIKIDATA_ENTITY_BASE}${qid}`,
          }];
        });
        const total = typeof root['total'] === 'number' ? root['total']
          : typeof root['totalhits'] === 'number' ? root['totalhits'] : results.length;
        return {
          query: input['query'], language: input['language'], results, total_hits: total,
          next_offset: results.length >= Number(input['limit'])
            ? Number(input['offset']) + results.length : null,
          ...wikidataProvenance({ qid: null }),
        };
      });
    },

    async wikidata_get_entity(raw, signal) {
      return run('wikidata_get_entity', raw, signal, async (input, childSignal) => {
        const qid = String(input['qid']);
        if (!QID_RE.test(qid)) wdError('invalid_qid', `Invalid Wikidata item ID '${qid}'.`);
        const fields = input['fields'] as string[];
        const requestedLangs = Array.isArray(input['languages'])
          ? (input['languages'] as string[]) : [String(input['language'])];
        const restFields = [...new Set(['type', ...fields.map((field) => field === 'claims' ? 'statements' : field)])];
        const params = new URLSearchParams({ _fields: restFields.join(',') });
        const response = await wb.get(`/entities/items/${encodeURIComponent(qid)}?${params.toString()}`, {
          ...(childSignal === undefined ? {} : { signal: childSignal }),
          // Distinct field projections are distinct cache entries: a narrow
          // first call must not starve a later, wider one on a 304.
          cacheKey: `${qid}:fields:${restFields.join(',')}`,
        });
        if (response.status === 404) {
          wdError('entity_not_found', `No Wikidata item with ID '${qid}' exists.`, {
            hint: `Check the QID, or call wikidata_search_entities({ query: '...' }) to find one.`,
            details: { http_status: 404, backend: 'wikibase-rest-v1' },
          });
        }
        if (response.status !== 200 && response.status !== 304) {
          wdError('upstream_unavailable', 'The Wikidata entity service is temporarily unavailable.', {
            retryable: true, details: { http_status: response.status, backend: 'wikibase-rest-v1' },
          });
        }
        const data = asRecord(response.json) ?? {};
        const labels = fields.includes('labels')
          ? projectLanguages(languageValues(data['labels']), requestedLangs) : {};
        const descriptions = fields.includes('descriptions')
          ? projectLanguages(languageValues(data['descriptions']), requestedLangs) : {};
        const aliases = fields.includes('aliases') ? projectAliases(aliasValues(data['aliases']), requestedLangs) : {};
        let truncated = false;
        const claims: JsonRecord = {};
        if (fields.includes('claims')) {
          const statements = asRecord(data['statements']) ?? {};
          const properties = Object.keys(statements).sort();
          const maxProperties = Number(input['max_properties']);
          const maxStatements = Number(input['max_statements_per_property']);
          if (properties.length > maxProperties) truncated = true;
          for (const pid of properties.slice(0, maxProperties)) {
            const list = Array.isArray(statements[pid]) ? statements[pid] as unknown[] : [];
            if (list.length > maxStatements) truncated = true;
            claims[pid] = list.slice(0, maxStatements).map((statement) => {
              const entry = asRecord(statement) ?? {};
              return {
                id: typeof entry['id'] === 'string' ? entry['id'] : '',
                rank: typeof entry['rank'] === 'string' ? entry['rank'] : 'normal',
                value: snakValue(entry['mainsnak'] ?? entry['value']),
              };
            });
          }
        }
        const sitelinks: JsonRecord = {};
        if (fields.includes('sitelinks')) {
          const rawLinks = asRecord(data['sitelinks']) ?? {};
          for (const [site, value] of Object.entries(rawLinks)) {
            const link = asRecord(value) ?? {};
            sitelinks[site] = {
              title: typeof link['title'] === 'string' ? link['title'] : '',
              url: typeof link['url'] === 'string' ? link['url'] : sitelinkUrl(site, String(link['title'] ?? '')),
              badges: Array.isArray(link['badges']) ? link['badges'] : [],
            };
          }
        }
        return {
          qid, url: `${WIKIDATA_ENTITY_BASE}${qid}`, labels, descriptions, aliases, claims, sitelinks,
          languages_requested: requestedLangs, truncated,
          ...wikidataProvenance({ qid, revision: response.revision, timestamp: response.timestamp }),
        };
      });
    },

    async wikidata_get_statements(raw, signal) {
      return run('wikidata_get_statements', raw, signal, async (input, childSignal) => {
        const qid = String(input['qid']);
        const pid = String(input['property']);
        const params = new URLSearchParams({ property: pid });
        const response = await wb.get(`/entities/items/${encodeURIComponent(qid)}/statements?${params.toString()}`, {
          ...(childSignal === undefined ? {} : { signal: childSignal }),
          cacheKey: `${qid}:statements:${pid}`,
        });
        if (response.status === 404) {
          wdError('entity_not_found', `No Wikidata item with ID '${qid}' exists.`, {
            hint: 'Check the QID, or call wikidata_search_entities to find one.',
            details: { http_status: 404, backend: 'wikibase-rest-v1' },
          });
        }
        if (response.status !== 200 && response.status !== 304) {
          wdError('upstream_unavailable', 'The Wikidata statements service is temporarily unavailable.', {
            retryable: true, details: { http_status: response.status, backend: 'wikibase-rest-v1' },
          });
        }
        const root = asRecord(response.json) ?? {};
        let rawStatements: unknown[] = [];
        if (Array.isArray(root['statements'])) rawStatements = root['statements'];
        else if (Array.isArray(root[pid])) rawStatements = root[pid] as unknown[];
        else if (!Array.isArray(root['statements']) && Object.values(root).some((value) => Array.isArray(value))) {
          const first = Object.values(root).find((value) => Array.isArray(value));
          rawStatements = first as unknown[];
        }
        const statements: MappedStatement[] = rawStatements.flatMap((item) => {
          const entry = asRecord(item);
          if (entry === null) return [];
          const rank = typeof entry['rank'] === 'string' ? entry['rank'] : 'normal';
          const qualifiers: unknown[] = [];
          if (input['include_qualifiers'] === true) {
            const rawQualifiers = asRecord(entry['qualifiers']) ?? {};
            for (const [property, snaks] of Object.entries(rawQualifiers)) {
              for (const snak of Array.isArray(snaks) ? snaks : []) {
                qualifiers.push({ property, value: snakValue(snak) });
              }
            }
          }
          return [{
            id: typeof entry['id'] === 'string' ? entry['id'] : '',
            rank,
            value: snakValue(entry['mainsnak'] ?? entry['value']),
            qualifiers,
            references_count: Array.isArray(entry['references']) ? entry['references'].length : 0,
            value_label: null,
          }];
        }).sort((a, b) => (RANK_ORDER[a.rank] ?? 1) - (RANK_ORDER[b.rank] ?? 1));
        const rankFilter = String(input['rank']);
        const filtered = rankFilter === 'all'
          ? statements : statements.filter((statement) => statement.rank === rankFilter);
        const offset = Number(input['offset']);
        const limit = Number(input['limit']);
        const page = filtered.slice(offset, offset + limit);
        const warnings: string[] = [];
        if (input['resolve_labels'] === true) {
          const qids = [...new Set(page.flatMap((statement) => {
            const content = asRecord(statement.value?.content);
            const id = content?.['id'];
            return typeof id === 'string' && QID_RE.test(id) ? [id] : [];
          }))];
          if (qids.length > 10) warnings.push('Label decoration limited to the first 10 distinct entity values.');
          const targets = qids.slice(0, 10);
          if (targets.length > 0) {
            const languages = input['languages'] as string[];
            const query = [
              'PREFIX wd: <http://www.wikidata.org/entity/>',
              'PREFIX wikibase: <http://wikiba.se/ontology#>',
              'PREFIX bd: <http://www.bigdata.com/rdf#>',
              `SELECT ?item ?itemLabel WHERE { VALUES ?item { ${targets.map((id) => `wd:${id}`).join(' ')} } SERVICE wikibase:label { bd:serviceParam wikibase:language "${languages.join(',')}". } } LIMIT 10`,
            ].join('\n');
            try {
              const guard = guardQuery(query, config.wikidataSparql.maxQueryLength, config.wikidataSparql.maxRows, 10);
              const result = await sparql.execute(guard.effectiveQuery, guard.effectiveLimit, {
                ...(childSignal === undefined ? {} : { signal: childSignal }),
              });
              const labels = labelMap(result);
              for (const statement of page) {
                const content = asRecord(statement.value?.content);
                const id = content?.['id'];
                if (typeof id === 'string' && labels.has(id)) statement.value_label = labels.get(id) ?? null;
              }
            } catch {
              warnings.push('Optional label decoration failed; statements returned without labels.');
            }
          }
        }
        return {
          qid, property: pid,
          property_label: PROPERTY_LABELS[pid] === undefined ? null : { en: PROPERTY_LABELS[pid] },
          rank_filter: rankFilter, statements: page, count: page.length,
          next_offset: offset + page.length < filtered.length ? offset + page.length : null,
          truncated: filtered.length > offset + limit,
          ...(warnings.length > 0 ? { warnings } : {}),
          ...wikidataProvenance({ qid, revision: response.revision, timestamp: response.timestamp }),
        };
      });
    },

    async wikidata_get_sitelinks(raw, signal) {
      return run('wikidata_get_sitelinks', raw, signal, async (input, childSignal) => {
        const qid = String(input['qid']);
        const response = await wb.get(`/entities/items/${encodeURIComponent(qid)}/sitelinks`, {
          ...(childSignal === undefined ? {} : { signal: childSignal }),
          cacheKey: `${qid}:sitelinks`,
        });
        if (response.status === 404) {
          wdError('entity_not_found', `No Wikidata item with ID '${qid}' exists.`, {
            hint: 'Check the QID, or call wikidata_search_entities to find one.',
            details: { http_status: 404, backend: 'wikibase-rest-v1' },
          });
        }
        if (response.status !== 200 && response.status !== 304) {
          wdError('upstream_unavailable', 'The Wikidata sitelinks service is temporarily unavailable.', {
            retryable: true, details: { http_status: response.status, backend: 'wikibase-rest-v1' },
          });
        }
        const root = asRecord(response.json) ?? {};
        const rawLinks = asRecord(root['sitelinks']) ?? root;
        const requested = Array.isArray(input['sites']) ? input['sites'] as string[] : null;
        if (requested !== null) {
          for (const site of requested) {
            if (!SITE_CODE_RE.test(site) || !isAllowedSite(site)) {
              wdError('invalid_site', `Site code '${site}' is not on the Wikimedia allowlist.`, {
                hint: 'Use an allowlisted Wikimedia site code such as enwiki, dewiki or commonswiki.',
                details: { site },
              });
            }
          }
        }
        const includeBadges = input['include_badges'] === true;
        const limit = Number(input['limit']);
        const sitelinks: JsonRecord = {};
        let count = 0;
        for (const [site, value] of Object.entries(rawLinks)) {
          if (requested !== null && !requested.includes(site)) continue;
          if (!isAllowedSite(site)) continue;
          if (requested === null && count >= limit) break;
          const link = asRecord(value) ?? {};
          const title = typeof link['title'] === 'string' ? link['title'] : '';
          sitelinks[site] = {
            title,
            url: sitelinkUrl(site, title),
            badges: includeBadges && Array.isArray(link['badges']) ? link['badges'] : [],
          };
          count += 1;
        }
        return {
          qid, sitelinks, requested_sites: requested, count,
          truncated: requested === null && Object.keys(rawLinks).length > limit,
          ...wikidataProvenance({ qid, revision: response.revision, timestamp: response.timestamp }),
        };
      });
    },

    async wikidata_resolve_external_id(raw, signal) {
      return run('wikidata_resolve_external_id', raw, signal, async (input, childSignal) => {
        const hasIdMode = input['scheme'] !== undefined && input['id'] !== undefined;
        const hasSiteMode = input['site'] !== undefined && input['title'] !== undefined;
        if (hasIdMode === hasSiteMode) {
          wdError('validation_error', 'Supply exactly one mode: scheme+id, or site+title.', {
            hint: 'Use scheme+id for external identifiers, or site+title for a sitelink.',
          });
        }
        let query: string;
        let normalizedId: string | null = null;
        let schemeOut: string | null = null;
        let idOut: string | null = null;
        let siteOut: string | null = null;
        let titleOut: string | null = null;
        if (hasIdMode) {
          const scheme = String(input['scheme']);
          if (!(EXTERNAL_SCHEMES as readonly string[]).includes(scheme)) {
            wdError('unsupported_scheme', `External-ID scheme '${scheme}' is not supported.`, {
              hint: `Allowed schemes: ${EXTERNAL_SCHEMES.join(', ')}.`,
              details: { scheme },
            });
          }
          const normalized = normalizeExternalId(scheme as ExternalScheme, String(input['id']));
          if ('error' in normalized) {
            wdError('invalid_external_id', normalized.error, { hint: 'Check the identifier format and retry.', details: { scheme } });
          }
          normalizedId = normalized.value;
          schemeOut = scheme;
          idOut = String(input['id']);
          query = [
            'PREFIX wdt: <http://www.wikidata.org/prop/direct/>',
            `SELECT ?item WHERE { ?item wdt:${normalized.property} "${escapeSparqlLiteral(normalized.value)}" . } LIMIT ${Number(input['limit'])}`,
          ].join('\n');
        } else {
          const site = String(input['site']);
          if (!SITE_CODE_RE.test(site) || !isAllowedSite(site)) {
            wdError('invalid_site', `Site code '${site}' is not on the Wikimedia allowlist.`, {
              hint: 'Use an allowlisted Wikimedia site code such as enwiki.',
              details: { site },
            });
          }
          const title = String(input['title']);
          if (TITLE_FORBIDDEN_RE.test(title)) {
            wdError('validation_error', 'The sitelink title contains characters that are not permitted.', {
              hint: 'Remove <, >, ", {, }, |, ^, ` or \\ from the title.',
              details: { site },
            });
          }
          siteOut = site;
          titleOut = title;
          const base = siteBaseUrl(site) as string;
          const encoded = encodeURIComponent(title.replace(/ /g, '_'));
          query = [
            'PREFIX schema: <http://schema.org/>',
            `SELECT ?item WHERE { <${base}${encoded}> schema:about ?item . } LIMIT ${Number(input['limit'])}`,
          ].join('\n');
        }
        const guard = guardQuery(query, config.wikidataSparql.maxQueryLength, config.wikidataSparql.maxRows, Number(input['limit']));
        const result = await sparql.execute(guard.effectiveQuery, guard.effectiveLimit, {
          ...(childSignal === undefined ? {} : { signal: childSignal }),
        });
        const matches = bindingsToMatches(result);
        return {
          qid: matches[0]?.qid ?? null,
          matches,
          scheme: schemeOut, id: idOut, site: siteOut, title: titleOut, normalized_id: normalizedId,
          endpoint: result.endpoint, effective_limit: result.effective_limit,
          ...wikidataProvenance({
            qid: matches[0]?.qid ?? null,
            endpoint: result.endpoint,
            effectiveQuery: result.effective_query,
            resultTime: result.timestamp,
          }),
        };
      });
    },

    async wikidata_sparql_query(raw, signal) {
      return run('wikidata_sparql_query', raw, signal, async (input, childSignal) => {
        const query = String(input['query']);
        const guard = guardQuery(query, config.wikidataSparql.maxQueryLength, config.wikidataSparql.maxRows,
          input['limit'] === undefined ? undefined : Number(input['limit']));
        const requestedTimeoutMs = Number(input['timeout_ms']);
        // Label-service queries are the known slow path. Spend the full,
        // already-permitted 60 s hard cap on them instead of failing early at
        // e.g. 30 s, and make the raised deadline visible (non-fatal) to the
        // caller. The global cap itself is never increased.
        const labelService = usesLabelService(guard.effectiveQuery);
        const effectiveTimeoutMs = labelService && requestedTimeoutMs < LABEL_SERVICE_TIMEOUT_MS
          ? LABEL_SERVICE_TIMEOUT_MS : requestedTimeoutMs;
        const timeoutWarnings: string[] = effectiveTimeoutMs > requestedTimeoutMs
          ? [`label-service query: timeout_ms raised from ${requestedTimeoutMs} ms to ${effectiveTimeoutMs} ms (60 s hard cap)`]
          : [];
        const result = await sparql.execute(guard.effectiveQuery, guard.effectiveLimit, {
          ...(childSignal === undefined ? {} : { signal: childSignal }),
          timeoutMs: effectiveTimeoutMs,
        });
        return {
          vars: result.vars,
          results: { bindings: result.bindings },
          row_count: result.row_count,
          truncated: result.truncated,
          endpoint: result.endpoint,
          effective_limit: result.effective_limit,
          effective_timeout_ms: effectiveTimeoutMs,
          warnings: [...guard.warnings, ...result.warnings, ...timeoutWarnings],
          ...wikidataProvenance({
            qid: null,
            endpoint: result.endpoint,
            effectiveQuery: result.effective_query,
            resultTime: result.timestamp,
          }),
        };
      });
    },
  };
}

function projectLanguages(values: Record<string, string>, languages: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const lang of languages) if (values[lang] !== undefined) result[lang] = values[lang] as string;
  return result;
}

function projectAliases(values: Record<string, string[]>, languages: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const lang of languages) if (values[lang] !== undefined) result[lang] = values[lang] as string[];
  return result;
}

function labelMap(result: SparqlSuccess): Map<string, string> {
  const labels = new Map<string, string>();
  for (const binding of result.bindings) {
    const item = binding['item'];
    const label = binding['itemLabel'];
    if (item === undefined || label === undefined) continue;
    const match = /Q[1-9][0-9]{0,9}$/.exec(item.value);
    if (match !== null && match[0] !== undefined && label.value.length > 0) labels.set(match[0], label.value);
  }
  return labels;
}

function bindingsToMatches(result: SparqlSuccess): Array<{ qid: string; label: string | null; description: string | null }> {
  const matches: Array<{ qid: string; label: string | null; description: string | null }> = [];
  for (const binding of result.bindings) {
    const item = binding['item'] ?? binding[result.vars[0] ?? ''] ?? binding['?item'];
    if (item === undefined) continue;
    const match = /^(?:https?:\/\/www\.wikidata\.org\/entity\/)?(Q[1-9][0-9]{0,9})$/.exec(item.value);
    if (match !== null && match[1] !== undefined) {
      matches.push({ qid: match[1], label: null, description: null });
    }
  }
  matches.sort((a, b) => a.qid.localeCompare(b.qid));
  const unique = new Map(matches.map((entry) => [entry.qid, entry]));
  return [...unique.values()];
}
