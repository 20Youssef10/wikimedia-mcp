import { hostLangFor, isValidLang } from '../lang.js';

/** Contract §3.1 — QID/PID validation before any path interpolation. */
export const QID_RE = /^Q[1-9][0-9]{0,9}$/;
export const PID_RE = /^P[1-9][0-9]{0,9}$/;
export const WD_LANG_RE = /^[a-z]{2}[a-z0-9-]*$/;
export const SITE_CODE_RE = /^([a-z-]{2,12})(wiki|wikisource|wikiquote|wikibooks|wikivoyage)$/;

export const WIKIBASE_REST_BASE = 'https://www.wikidata.org/w/rest.php/wikibase/v1';
export const WIKIDATA_ENTITY_BASE = 'https://www.wikidata.org/wiki/';

/** Contract §3.2 — Wikidata structured data is CC0 1.0 (SR-11). */
export const CC0_LICENSE = Object.freeze({
  title: 'Creative Commons CC0 1.0 Universal Public Domain Dedication',
  short: 'CC0 1.0',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
});
export const CC0_DISCLAIMER = 'Wikidata structured data is CC0 1.0; linked-site content and media retain their own licences.';

/**
 * Contract §6.1 — static, code-reviewed scheme → Wikidata property map.
 * A new scheme requires a minor contract version plus a corpus case.
 */
export type ExternalScheme = 'doi' | 'pmid' | 'orcid' | 'openalex' | 'imdb';
export const EXTERNAL_SCHEMES: readonly ExternalScheme[] = ['doi', 'pmid', 'orcid', 'openalex', 'imdb'];
export const EXTERNAL_PROPERTY: Readonly<Record<ExternalScheme, string>> = Object.freeze({
  doi: 'P356', pmid: 'P698', orcid: 'P496', openalex: 'P10283', imdb: 'P345',
});

export type NormalizedId = { property: string; value: string } | { error: string };

/** Normalise an external identifier per §6.1; return an actionable error on failure. */
export function normalizeExternalId(scheme: ExternalScheme, raw: string): NormalizedId {
  let value = raw.trim();
  if (scheme === 'doi') {
    value = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:/i, '').toLowerCase();
    if (!/^10\.[0-9]{4,9}\/\S+$/.test(value)) return { error: 'A DOI must look like 10.1234/abc after optional prefix stripping.' };
  } else if (scheme === 'pmid') {
    value = value.replace(/^PMID:/i, '').replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/?/i, '').trim();
    if (!/^\d{1,9}$/.test(value)) return { error: 'A PMID must be 1–9 digits after optional prefix stripping.' };
  } else if (scheme === 'orcid') {
    value = value.replace(/^https?:\/\/orcid\.org\//i, '').replace(/^ORCID:/i, '').trim();
    if (!/^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(value)) return { error: 'An ORCID must look like 0000-0002-1825-0097.' };
  } else if (scheme === 'openalex') {
    value = value.replace(/^https?:\/\/openalex\.org\//i, '').replace(/^OpenAlex:/i, '').trim();
    if (!/^[A-Z][0-9]{7,}$/.test(value)) return { error: 'An OpenAlex ID must look like A5023888391.' };
  } else {
    value = value.replace(/^(IMDB:)/i, '').trim();
    value = value.slice(0, 2).toLowerCase() + value.slice(2);
    if (!/^(tt|nm|co|ev)\d{7,10}$/.test(value)) return { error: 'An IMDb ID must look like nm0000209 or tt0133093.' };
  }
  return { property: EXTERNAL_PROPERTY[scheme], value };
}

/** Title characters that must never reach a generated sitelink SPARQL literal/IRI. */
export const TITLE_FORBIDDEN_RE = /[<>"{}|`\\]/;

/**
 * Contract §5.4 site allowlist. Site codes are projected onto a fixed set of
 * Wikimedia hosts derived from the Phase 1 resolver — never caller-supplied.
 */
export function siteBaseUrl(site: string): string | null {
  const match = SITE_CODE_RE.exec(site);
  if (match === null || match[1] === undefined || match[2] === undefined) return null;
  const prefix = match[1];
  const kind = match[2];
  if (kind === 'wiki') {
    if (prefix === 'commons') return 'https://commons.wikimedia.org/wiki/';
    if (prefix === 'species') return 'https://species.wikimedia.org/wiki/';
    if (prefix === 'meta') return 'https://meta.wikimedia.org/wiki/';
    if (prefix === 'test') return 'https://test.wikipedia.org/wiki/';
    if (prefix === 'wikidata') return 'https://www.wikidata.org/wiki/';
    if (!isValidLang(prefix)) return null;
    return `https://${hostLangFor(prefix)}.wikipedia.org/wiki/`;
  }
  if (!isValidLang(prefix)) return null;
  const domain = kind === 'wikisource' ? 'wikisource.org'
    : kind === 'wikiquote' ? 'wikiquote.org'
      : kind === 'wikibooks' ? 'wikibooks.org' : 'wikivoyage.org';
  return `https://${hostLangFor(prefix)}.${domain}/wiki/`;
}

/** §5.4 — unknown site codes are rejected with zero outbound requests. */
export function isAllowedSite(site: string): boolean {
  return siteBaseUrl(site) !== null;
}

/** §5.4 — build the article URL for a sitelink title from the fixed allowlist. */
export function sitelinkUrl(site: string, title: string): string {
  const base = siteBaseUrl(site) ?? 'https://www.wikidata.org/wiki/';
  return `${base}${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** §7.2 — static property labels for the most-requested properties. */
export const PROPERTY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  P31: 'instance of', P569: 'date of birth', P570: 'date of death',
  P106: 'occupation', P21: 'sex or gender', P27: 'country of citizenship',
  P19: 'place of birth', P20: 'place of death', P22: 'father', P25: 'mother',
  P26: 'spouse', P40: 'child', P463: 'member of', P39: 'position held',
  P69: 'educated at', P108: 'employer', P166: 'award received',
  P17: 'country', P131: 'located in the administrative territorial entity',
  P356: 'DOI', P698: 'PubMed ID', P496: 'ORCID iD', P10283: 'OpenAlex ID', P345: 'IMDb ID',
});
