import type { Config } from '../config.js';
import type { License, ToolErrorCode } from '../types.js';
import { asRecord, type WikimediaClient } from '../upstream/client.js';
import { UpstreamError } from '../upstream/retry.js';
import { createPacedLane, REAL_CLOCK, type PacingClock } from '../upstream/pacing.js';
import { resolveTarget, ResolverError } from '../resolver.js';
import {
  attributionPlan, fetchSignals, AttributionRedirectError,
  type AttributionPlan,
} from '../upstream/attribution.js';
import { canonicalLicenseUrl, stripExtmetadata } from './license.js';

/** Terminal, actionable media error. Never carries a raw upstream body. */
export class MediaToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly options: {
      retryable?: boolean;
      retryAfterSeconds?: number | null;
      hint?: string;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = 'MediaToolError';
  }
}

export type BrandMark = { readonly name: string; readonly url: string; readonly type: string };
export type WikiBlock = {
  readonly site_name: string;
  readonly project_family: string;
  readonly site_id: string;
  readonly site_language: string;
  readonly page_language: string;
};
export type MediaLicense = License & { readonly source: string };

export type ResolvedFile = {
  readonly filename: string;
  readonly title: string;
  readonly url: string;
  readonly thumb_url: string | null;
  readonly mime: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly size: number | null;
  readonly description_url: string;
  readonly author: string | null;
  readonly credit: string | null;
  readonly brand_marks: readonly BrandMark[];
  readonly wiki: WikiBlock | null;
  readonly storage: 'local' | 'remote';
  readonly attribution_source: 'attribution-v0-beta' | 'action-extmetadata' | 'rest-bare';
  readonly restrictions: string;
  readonly warnings: readonly string[];
  readonly source: string;
  readonly revision: number | null;
  readonly timestamp: string | null;
  readonly license: MediaLicense;
  readonly attribution: {
    readonly required: boolean;
    readonly text: string;
    readonly link: string;
    readonly disclaimer: string;
  };
};

type ExtMetadata = {
  artist: string | null;
  credit: string | null;
  short: string | null;
  title: string | null;
  url: string | null;
  required: boolean | null;
  restrictions: string | null;
  stripped: boolean;
};

function readExtField(ext: Record<string, unknown>, key: string): string | null {
  const value = ext[key];
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const inner = (value as Record<string, unknown>)['value'];
    if (typeof inner === 'string') return inner;
  }
  return null;
}

function cleanExtField(ext: Record<string, unknown>, key: string): { value: string | null; stripped: boolean } {
  const raw = readExtField(ext, key);
  if (raw === null) return { value: null, stripped: false };
  const value = stripExtmetadata(raw);
  return { value: value.length > 0 ? value : null, stripped: value !== raw };
}

function extMetadataOf(ext: Record<string, unknown>): ExtMetadata {
  const artist = cleanExtField(ext, 'Artist');
  const credit = cleanExtField(ext, 'Credit');
  const short = cleanExtField(ext, 'LicenseShortName');
  const usage = cleanExtField(ext, 'UsageTerms');
  const licence = cleanExtField(ext, 'License');
  const url = cleanExtField(ext, 'LicenseUrl');
  const required = cleanExtField(ext, 'AttributionRequired');
  const restrictions = cleanExtField(ext, 'Restrictions');
  return {
    artist: artist.value,
    credit: credit.value,
    short: short.value ?? usage.value,
    title: licence.value ?? usage.value ?? short.value,
    url: url.value,
    required: required.value === null ? null : /^true$/i.test(required.value),
    restrictions: restrictions.value,
    stripped: artist.stripped || credit.stripped || short.stripped || usage.stripped
      || licence.stripped || url.stripped || required.stripped || restrictions.stripped,
  };
}

function licenseFamily(value: string | null): string {
  if (value === null) return '';
  const v = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^(pd|pdm|public domain( mark)?|public-domain)$/.test(v)) return 'pd';
  if (/^cc0( 1\.0)?$/.test(v)) return 'cc0';
  return v.replace(/^creative commons /, '');
}

function sameFamily(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return licenseFamily(a) === licenseFamily(b);
}

function mediaSource(projectInput: string): string {
  const value = projectInput.trim().toLowerCase();
  if (value === 'commons' || value === 'commonswiki') return 'commonswiki';
  if (value === 'wikidatawiki' || value === 'wikidata') return 'wikidatawiki';
  return value;
}

function assertFilename(filename: string): string {
  if (/[\u0000-\u001F\u007F]/.test(filename) || filename.includes('\\') || filename.includes('..')) {
    throw new MediaToolError('invalid_article', 'The filename contains a rejected encoding character.', {
      retryable: false, details: { field: 'filename' },
    });
  }
  const match = /^file:(.+)$/i.exec(filename.trim());
  if (match?.[1] === undefined || match[1].length === 0) {
    throw new MediaToolError('validation_error', "filename must start with 'File:' (e.g. 'File:NASA logo.svg').", {
      retryable: false,
      hint: "Prefix the title with 'File:' and call the tool again.",
      details: { field: 'filename' },
    });
  }
  return `File:${match[1]}`;
}

export type ResolveOptions = { readonly clock?: PacingClock };

/**
 * One shared resolve pipeline for both Group F tools (§5.3 / AC-87).
 *
 * Order note: Action `imageinfo` runs first because the beta API has no remote
 * media support and `imagerepository` must be known before deciding whether to
 * call it (D12). Step 3's mandatory imageinfo enrichment is therefore always
 * performed, and its `missing` flag is combined with the beta result by Step 4
 * to distinguish `file_not_found` from a beta gap.
 */
export async function resolveFile(
  client: WikimediaClient,
  config: Config,
  filenameInput: string,
  projectInput: string,
  thumbWidth: number,
  includeBrandMarks: boolean,
  signal?: AbortSignal,
  options: ResolveOptions = {},
): Promise<ResolvedFile> {
  const filename = assertFilename(filenameInput);
  let target;
  try {
    target = resolveTarget({ project: projectInput });
  } catch (error) {
    if (error instanceof ResolverError) {
      throw new MediaToolError('invalid_project', `Invalid wiki project '${projectInput}'.`, {
        retryable: false,
        hint: "Use a supported wiki such as 'commonswiki', 'enwiki' or 'en.wikipedia'.",
        details: { field: 'project' },
      });
    }
    throw error;
  }

  const plan: AttributionPlan = attributionPlan(config);
  const clock = options.clock ?? REAL_CLOCK;
  const betaLane = createPacedLane(Math.min(2, config.concurrencyLimit), 1, 2, clock);
  const imageLane = createPacedLane(config.concurrencyLimit, 2, 3, clock);
  const encodedTitle = encodeURIComponent(filename);
  const warnings: string[] = [];
  const source = mediaSource(projectInput);

  // Build the query manually: the title is ALREADY percent-encoded (%3A/%20,
  // never '+'), and URLSearchParams would double-encode the '%' to '%25',
  // making MediaWiki see a literal 'File%3A...' title and return no imageinfo.
  const imageUrl = `${target.actionUrl}?action=query&format=json&prop=imageinfo`
    + `&titles=${encodedTitle}`
    + `&iiprop=${encodeURIComponent('url|size|mime|extmetadata|user|timestamp')}`
    + `&iiurlwidth=${thumbWidth}`;
  const imageKey = `media:imageinfo:${target.host}:${encodedTitle}:${thumbWidth}`;

  let imageJson: unknown;
  try {
    imageJson = await client.cached(imageKey, () => imageLane.run(() => client.getJson(imageUrl, {
      ...(signal === undefined ? {} : { signal }),
      backend: 'action-imageinfo',
    })), config.metadataCacheTtlMs).then((response) => response.json);
  } catch (error) {
    throw mapMediaFetchError(error, 'action-imageinfo', config, 'imageinfo');
  }

  const root = asRecord(imageJson) ?? {};
  const errorObj = asRecord(root['error']);
  const apiMissing = errorObj !== null && typeof errorObj['code'] === 'string'
    && /missing|nosuch|notfound|not_found/i.test(errorObj['code']);
  const queryObj = asRecord(root['query']);
  const pages = asRecord(queryObj?.['pages']);
  const page = pages === null || pages === undefined
    ? null
    : (asRecord(Object.values(pages)[0]) ?? null);
  const pageMissing = page !== null && Object.prototype.hasOwnProperty.call(page, 'missing');
  const missing = apiMissing || pageMissing;
  const info = asRecord(Array.isArray(page?.['imageinfo']) ? (page?.['imageinfo'] as unknown[])[0] : undefined);
  const ext = info === null ? {} : (asRecord(info['extmetadata']) ?? {});
  const extMeta = extMetadataOf(ext);
  const storage: 'local' | 'remote' = typeof info?.['imagerepository'] === 'string'
    && info['imagerepository'] !== 'local' ? 'remote' : 'local';

  // Step 1 — primary Attribution API (skipped entirely for remote media, D12).
  let betaEssential: Record<string, unknown> | null = null;
  let betaMissed = true;
  let betaLink: string | null = null;
  const betaKey = `media:signals:${target.host}:${plan.apiVersion}:${encodedTitle}`;
  if (storage === 'local') {
    try {
      const signals = await client.cached(betaKey, () => betaLane.run(() => fetchSignals(
        client, plan, target.host, encodedTitle,
        {
          maxAttempts: config.retryMaxAttempts,
          baseMs: config.retryBackoffBaseMs,
          maxMs: config.retryBackoffMaxMs,
          retryAfterFallbackMs: config.retryAfterFallbackMs,
        },
        signal,
      )), config.metadataCacheTtlMs);
      if (signals.status === 200 && signals.essential !== null) {
        betaEssential = signals.essential;
        betaMissed = false;
      } else {
        betaMissed = true;
      }
    } catch (error) {
      if (error instanceof AttributionRedirectError) {
        throw new MediaToolError('upstream_unavailable', 'The attribution source returned a cross-origin redirect.', {
          retryable: false,
          hint: 'Verify the filename and retry. No credential was sent to the redirected host.',
          details: { backend: 'attribution-api', redirect: 'cross-origin' },
        });
      }
      // 429/503/5xx exhaustion and parse faults are non-fatal here: Step 4's
      // fallback chain consumes the Action API result already in hand.
      warnings.push('attribution beta unavailable; used per-file Action API data');
      betaMissed = true;
    }
  } else {
    warnings.push('remote media: beta attribution unavailable');
  }

  // Step 4.3 — file_not_found only when BOTH sources indicate absence.
  const betaIndicatesAbsence = betaMissed && (betaEssential === null);
  if (missing && betaIndicatesAbsence) {
    throw new MediaToolError('file_not_found', `No file titled '${filename}' exists on ${projectInput}. Check the filename and the 'File:' prefix.`, {
      retryable: false,
      hint: `Confirm the exact filename on the wiki, then call the tool again with '${filename}'.`,
      details: { http_status: 404, backend: betaMissed ? 'action-imageinfo' : 'attribution-api' },
    });
  }
  if (info === null && betaEssential === null) {
    throw new MediaToolError('attribution_unavailable', 'No per-file attribution could be established from any source.', {
      retryable: true,
      hint: 'Retry with the same filename; if it persists, verify the licence on the file page before reuse.',
      details: { backend: 'action-imageinfo' },
    });
  }

  // Step 4.2 — record the skipped wiki-wide fallback for media.
  warnings.push('skipped action-rightsinfo: site-wide licence is not a per-file licence');
  if (betaMissed && storage === 'local') {
    warnings.push('attribution beta returned no signal; used action-imageinfo fallback');
  }
  if (extMeta.stripped) {
    warnings.push('extmetadata values were HTML-stripped and are treated as untrusted data');
  }

  // Step 1 — exact essential.* mapping.
  const sourceWiki = asRecord(betaEssential?.['source_wiki']);
  const betaLicense = asRecord(betaEssential?.['license']);
  const betaShort = typeof betaLicense?.['short'] === 'string' ? betaLicense['short'] : null;
  const betaTitle = typeof betaLicense?.['title'] === 'string' ? betaLicense['title'] : null;
  const betaUrl = typeof betaLicense?.['url'] === 'string' ? betaLicense['url'] : null;
  const essentialCredit = typeof betaEssential?.['credit'] === 'string' ? betaEssential['credit'] : null;
  if (typeof betaEssential?.['link'] === 'string' && betaEssential['link'].length > 0) {
    betaLink = betaEssential['link'];
  }
  const wiki: WikiBlock | null = sourceWiki === null ? null : {
    site_name: typeof sourceWiki['site_name'] === 'string' ? sourceWiki['site_name'] : '',
    project_family: typeof sourceWiki['project_family'] === 'string' ? sourceWiki['project_family'] : '',
    site_id: typeof sourceWiki['site_id'] === 'string' ? sourceWiki['site_id'] : source,
    site_language: typeof sourceWiki['site_language'] === 'string' ? sourceWiki['site_language'] : '',
    page_language: typeof sourceWiki['page_language'] === 'string' ? sourceWiki['page_language'] : '',
  };

  // Step 3 + Step 4.1 — per-file extmetadata wins over beta for licence values.
  const short = extMeta.short ?? betaShort ?? '';
  const title = extMeta.title ?? betaTitle ?? short;
  let url = extMeta.url ?? betaUrl ?? null;
  const extChanged = betaEssential !== null
    && (!sameFamily(extMeta.short ?? extMeta.title, betaShort ?? betaTitle)
      || (extMeta.url !== null && betaUrl !== null && extMeta.url !== betaUrl));
  // `license.source` names the source of the FINAL licence values, so any
  // extmetadata contribution counts even when it agrees with beta's family
  // (contract §3.4/§5.4.2 — cf. TC-F-001's beta attribution_source + extmetadata
  // license.source). `attribution_source` stays beta unless the licence changed.
  const extSuppliedLicence = extMeta.short !== null || extMeta.title !== null || extMeta.url !== null;
  const licenseSource = betaEssential === null || extSuppliedLicence
    ? 'action-extmetadata'
    : 'attribution-v0-beta';
  const attributionSource: ResolvedFile['attribution_source'] = betaEssential === null || betaMissed || storage === 'remote'
    ? 'action-extmetadata'
    : (extChanged ? 'action-extmetadata' : 'attribution-v0-beta');

  // Step 5 — licence URL safety: static map or null + warning, never CC BY-SA default.
  if (url === null) {
    const mapped = canonicalLicenseUrl(short || title);
    if (mapped !== null) {
      url = mapped;
    } else {
      warnings.push('licence URL not stated by upstream; verify the file page before reuse');
    }
  }
  if (short.length === 0 && title.length === 0) {
    warnings.push('per-file licence not stated by any source; verify the file page before reuse');
  }

  const author = extMeta.artist;
  if (author === null) warnings.push('author not stated by any source; returned as null');
  const credit = essentialCredit ?? extMeta.credit;
  const restrictions = extMeta.restrictions ?? '';
  const license: MediaLicense = { title: title || short || 'Licence not stated', short: short || title || 'Licence not stated', url, source: licenseSource };
  const link = betaLink ?? `https://${target.host}/w/index.php?title=${encodedTitle}&wprov=afsw1`;
  const authorLabel = author ?? (wiki?.site_name ?? source);
  const attributionText = `${filename} — ${authorLabel}, ${license.short}`;
  const required = extMeta.required ?? (betaEssential !== null ? false : true);

  const brandMarks: BrandMark[] = [];
  if (includeBrandMarks && Array.isArray(betaEssential?.['default_brand_marks'])) {
    for (const mark of betaEssential['default_brand_marks'] as unknown[]) {
      const record = asRecord(mark);
      if (record === null) continue;
      brandMarks.push({
        name: typeof record['name'] === 'string' ? record['name'] : '',
        url: typeof record['url'] === 'string' ? record['url'] : '',
        type: typeof record['type'] === 'string' ? record['type'] : '',
      });
    }
  }

  // MediaWiki puts `pageid` on the page object (a sibling of `imageinfo`);
  // accept the inner form too for upstream variants. Never fabricate one.
  const revision = typeof page?.['pageid'] === 'number'
    ? page['pageid']
    : (typeof info?.['pageid'] === 'number' ? info['pageid'] : null);
  const timestamp = typeof info?.['timestamp'] === 'string' ? info['timestamp'] : null;

  return {
    filename,
    title: typeof betaEssential?.['title'] === 'string' ? betaEssential['title'] : filename,
    url: typeof info?.['url'] === 'string' ? info['url'] : '',
    thumb_url: typeof info?.['thumburl'] === 'string' ? info['thumburl'] : null,
    mime: typeof info?.['mime'] === 'string' ? info['mime'] : '',
    width: typeof info?.['width'] === 'number' ? info['width'] : null,
    height: typeof info?.['height'] === 'number' ? info['height'] : null,
    size: typeof info?.['size'] === 'number' ? info['size'] : null,
    description_url: typeof info?.['descriptionurl'] === 'string' ? info['descriptionurl'] : link,
    author,
    credit,
    brand_marks: brandMarks,
    wiki,
    storage,
    attribution_source: attributionSource,
    restrictions,
    warnings,
    source: wiki?.site_id ?? source,
    revision,
    timestamp,
    license,
    attribution: {
      required,
      text: attributionText,
      link,
      disclaimer: plan.disclaimer,
    },
  };
}

function mapMediaFetchError(error: unknown, backend: string, config: Config, phase: string): MediaToolError {
  if (error instanceof UpstreamError) {
    if (error.status === 429) {
      return new MediaToolError('rate_limited', 'Upstream rate limit reached after bounded retries.', {
        retryable: true,
        retryAfterSeconds: Math.ceil((error.retryAfterMs ?? config.retryAfterFallbackMs) / 1000),
        details: { backend, http_status: 429, phase },
      });
    }
    if (error.status === 0) {
      return new MediaToolError('upstream_unavailable', `Could not reach the upstream wiki at ${error.host ?? 'the configured host'}.`, {
        retryable: true,
        hint: `Check DNS/network access to ${error.host ?? 'the configured host'} and retry.`,
        details: { backend, network: true, phase },
      });
    }
    return new MediaToolError('upstream_unavailable', 'The upstream service is temporarily unavailable. Retry shortly.', {
      retryable: error.status >= 500,
      details: { backend, http_status: error.status, phase },
    });
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new MediaToolError('timeout', 'The upstream request was cancelled or timed out. Retry the call.', {
      retryable: true, details: { backend, phase },
    });
  }
  return new MediaToolError('internal_error', `An internal error occurred during ${phase}. Retry with the correlation ID.`, {
    retryable: true, details: { backend, phase, error_type: error instanceof Error ? error.name : 'unknown' },
  });
}
