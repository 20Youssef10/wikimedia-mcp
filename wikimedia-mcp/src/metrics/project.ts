import { resolveTarget, ResolverError } from '../resolver.js';

/**
 * Phase 3 §3.2 — reuse of the Phase 1 resolver in reverse. `project` accepts
 * the dotted Analytics code (`en.wikipedia`) AND the Phase 1 aliases, and is
 * normalised to the dotted Analytics project code. The wiki host returned by
 * the fixed allowlist resolver is the ONLY host ever interpolated into a URL
 * (SR-3); a host-shaped/unresolvable value is rejected with zero outbound
 * requests.
 */
export type AnalyticsProject = {
  /** Dotted Analytics code, e.g. `en.wikipedia`, `commons.wikimedia`. */
  readonly code: string;
  /** Allowlisted wiki host used to build article URLs, e.g. `en.wikipedia.org`. */
  readonly host: string;
  /** Resolver source identifier. */
  readonly source: string;
};

export class AnalyticsProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsProjectError';
  }
}

const SPECIAL_CODES: Readonly<Record<string, string>> = Object.freeze({
  commons: 'commons.wikimedia',
  commonswiki: 'commons.wikimedia',
  wikidata: 'wikidata',
  wikidatawiki: 'wikidata',
  meta: 'meta.wikimedia',
  metawiki: 'meta.wikimedia',
  species: 'species.wikimedia',
  specieswiki: 'species.wikimedia',
});

const FAMILY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  wikipedia: 'wikipedia',
  wiktionary: 'wiktionary',
  wikisource: 'wikisource',
  wikibooks: 'wikibooks',
  wikiquote: 'wikiquote',
  wikivoyage: 'wikivoyage',
  wikiversity: 'wikiversity',
});

/** Derive the dotted AQS code from an allowlisted resolver host. */
function codeFromHost(host: string): string {
  if (host === 'www.wikidata.org') return 'wikidata';
  if (host === 'test.wikipedia.org') return 'test.wikipedia';
  const trimmed = host.replace(/\.org$/, '');
  return trimmed.length > 0 ? trimmed : host;
}

export function resolveAnalyticsProject(raw: string): AnalyticsProject {
  const value = raw.trim();

  // Host-shaped / URL-like values are rejected locally, before resolution and
  // with zero outbound requests (§3.2 / SR-3 / report 09 AC-30 pattern).
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
      || /[\s/\\@]/.test(value)) {
    throw new AnalyticsProjectError(`Invalid Analytics project '${raw}'.`);
  }

  let projectInput = value.toLowerCase();
  let langOverride: string | undefined;

  // `wikipedia:en` family form → family + language.
  const colon = /^([a-z]+):([a-z]{2,12}(?:-[a-z0-9]{2,12}){0,3})$/.exec(projectInput);
  if (colon?.[1] !== undefined && colon[2] !== undefined && FAMILY_ALIASES[colon[1]] !== undefined) {
    langOverride = colon[2];
    projectInput = colon[1];
  }

  let target;
  try {
    target = resolveTarget({
      ...(langOverride === undefined ? {} : { lang: langOverride }),
      project: projectInput,
    });
  } catch (error) {
    if (error instanceof ResolverError) {
      throw new AnalyticsProjectError(`Invalid Analytics project '${raw}'.`);
    }
    throw error;
  }

  const code = SPECIAL_CODES[projectInput] ?? codeFromHost(target.host);
  return { code, host: target.host, source: target.source };
}
