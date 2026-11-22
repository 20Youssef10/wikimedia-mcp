import type {
  Attribution, License, Provenance, ProvenanceBlock, ResolveResult, ToolPayload,
} from '../types.js';

export const DEFAULT_LICENSE: License = {
  title: 'Creative Commons Attribution-ShareAlike 4.0 International',
  short: 'CC BY-SA 4.0',
  url: 'https://creativecommons.org/licenses/by-sa/4.0/',
};

const DISCLAIMER = 'You remain responsible for licence compliance.';

/** Strip HTML tags and decode common entities from Action API extmetadata values. */
export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escape content that will be rendered downstream (TC-A-012 injection defence). */
export function escapeContent(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function assembleAttribution(
  target: ResolveResult,
  title: string,
  license: License = DEFAULT_LICENSE,
): Attribution {
  return {
    required: true,
    text: `${title} — ${target.source} contributors, ${license.short}`,
    link: target.articleUrl(title),
    disclaimer: DISCLAIMER,
  };
}

/**
 * Build the shared provenance block. Called for every content result so the
 * 100% licence/attribution metric (AC-28 / M5) cannot be bypassed.
 */
export function assembleProvenance(
  target: ResolveResult,
  title: string,
  options: {
    license?: License;
    revision?: number | null;
    timestamp?: string | null;
  } = {},
): Provenance {
  const license = options.license ?? DEFAULT_LICENSE;
  return {
    source: target.source,
    license,
    attribution: assembleAttribution(target, title, license),
    revision: options.revision ?? null,
    timestamp: options.timestamp ?? null,
  };
}

/**
 * WP15 — derive the compact block from an already-assembled flat provenance
 * object, so the grouped and flat views can never diverge. The disclaimer and
 * any licence hint are preserved verbatim.
 */
export function assembleProvenanceBlock(provenance: Provenance): ProvenanceBlock {
  const { source, license, attribution } = provenance;
  const licencePart = license.url === null
    ? license.short
    : `${license.short} (${license.url})`;
  return {
    source,
    license,
    attribution,
    attribution_text: `${attribution.text} — ${licencePart}. ${attribution.disclaimer}`,
    disclaimer: attribution.disclaimer,
    ...(attribution.hint === undefined ? {} : { hint: attribution.hint }),
  };
}

export function withProvenance(
  payload: ToolPayload,
  target: ResolveResult,
  title: string,
  options: {
    license?: License;
    revision?: number | null;
    timestamp?: string | null;
  } = {},
): ToolPayload {
  const provenance = assembleProvenance(target, title, options);
  return {
    ...payload,
    ...provenance,
    provenance_block: assembleProvenanceBlock(provenance),
  };
}

/** List results: top-level provenance with null revision/timestamp (§3). */
export function withListProvenance(
  payload: ToolPayload,
  target: ResolveResult,
  label: string,
): ToolPayload {
  return withProvenance(payload, target, label, { revision: null, timestamp: null });
}

/**
 * Map Action API extmetadata into a machine-readable License (finding M7).
 * Never invent a licence URL: when upstream gives none the URL is null and a
 * verification hint is attached to the attribution by the caller.
 */
export function licenseFromExtMetadata(metadata: Record<string, unknown>): License {
  const short = readHtmlField(metadata, 'LicenseShortName') || readHtmlField(metadata, 'UsageTerms') || 'Licence not stated';
  const title = readHtmlField(metadata, 'License') || short;
  const url = readHtmlField(metadata, 'LicenseUrl');
  return {
    title: title || short,
    short,
    url: url.length > 0 ? url : null,
  };
}

/** Hint emitted when upstream did not state a complete media licence. */
export function licenceHint(license: License): string | undefined {
  return license.url === null
    ? 'Licence URL not provided by upstream; verify the file page before reuse.'
    : undefined;
}

function readHtmlField(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  if (typeof value === 'string') return stripHtml(value);
  if (isRecord(value) && typeof value['value'] === 'string') return stripHtml(value['value']);
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
