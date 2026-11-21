/**
 * Single source of truth for Wikimedia language codes, shared by the Zod tool
 * schemas and the resolver so the advertised contract and runtime rules are
 * IDENTICAL (finding M2).
 *
 * Allows primary subcodes plus up to three hyphen segments, e.g. `en`,
 * `zh-hans`, `be-tarask`, `zh-min-nan`, `pt-br`. `EN` normalises to `en`.
 */
export const LANG_MAX_LENGTH = 12;
export const LANG_PATTERN_SOURCE = '^[a-z]{2,12}(-[a-z0-9]{2,12}){0,3}$';
export const LANG_RE = new RegExp(LANG_PATTERN_SOURCE);

export function normalizeLang(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidLang(value: string): boolean {
  return value.length >= 2 && value.length <= LANG_MAX_LENGTH && LANG_RE.test(value);
}

/**
 * Variant codes that are NOT separate Wikimedia wikis (verified by live DNS
 * probes: they return ENOTFOUND while the base-language wiki resolves). Route
 * these to the base host while retaining the requested code in `lang`/`source`.
 * Codes with real wikis — e.g. `be-tarask`, `zh-min-nan`, `zh-tw` — are absent
 * here and therefore keep their exact host.
 */
export const LANGUAGE_VARIANT_BASE: Readonly<Record<string, string>> = Object.freeze({
  // Chinese regional/script variants all live on zh.wikipedia.org.
  'zh-hans': 'zh',
  'zh-hant': 'zh',
  'zh-cn': 'zh',
  'zh-sg': 'zh',
  'zh-my': 'zh',
  'zh-hk': 'zh',
  'zh-mo': 'zh',
  // Brazilian/Portuguese variants live on pt.wikipedia.org.
  'pt-br': 'pt',
  'pt-pt': 'pt',
  // Script/formality and regional variants without their own wiki.
  'de-formal': 'de',
  'sr-ec': 'sr',
  'sr-el': 'sr',
  'en-gb': 'en',
  'en-us': 'en',
});

/** Host language for a validated code; unchanged when the code has its own wiki. */
export function hostLangFor(lang: string): string {
  return LANGUAGE_VARIANT_BASE[lang] ?? lang;
}
