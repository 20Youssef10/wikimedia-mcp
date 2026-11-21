/**
 * Phase 3 §3.7 Step 5 / §5.4 — code-reviewed static licence URL map and the
 * stricter extmetadata HTML stripper. Both are shared by the two Group F tools
 * (AC-87: one HTML stripper, one licence map).
 */

/** Canonical deed URLs for a small, reviewed allowlist of short names. */
export const LICENSE_URL_MAP: Readonly<Record<string, string>> = Object.freeze({
  'public domain': 'https://creativecommons.org/publicdomain/mark/1.0/',
  'pd': 'https://creativecommons.org/publicdomain/mark/1.0/',
  'pdm': 'https://creativecommons.org/publicdomain/mark/1.0/',
  'public domain mark': 'https://creativecommons.org/publicdomain/mark/1.0/',
  'cc0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'cc0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'cc by-sa 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'cc by-sa 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'cc by 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'cc by 3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'cc by-sa 2.0': 'https://creativecommons.org/licenses/by-sa/2.0/',
});

/** Look up a canonical URL by short name; never guess or default to CC BY-SA. */
export function canonicalLicenseUrl(short: string): string | null {
  const key = short.trim().toLowerCase().replace(/\s+/g, ' ');
  return LICENSE_URL_MAP[key] ?? null;
}

/** Strip tags, decode named/numeric entities and collapse whitespace (D9). */
export function stripExtmetadata(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function safeCodePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10FFFF) return '';
  try {
    return String.fromCodePoint(value);
  } catch {
    return '';
  }
}
