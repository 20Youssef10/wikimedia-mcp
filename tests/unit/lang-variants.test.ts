import { describe, expect, it } from 'vitest';
import { resolveTarget } from '../../src/resolver.js';
import { getSummarySchema } from '../../src/server/tools/schemas.js';
import {
  hostLangFor, isValidLang, LANG_MAX_LENGTH, LANG_PATTERN_SOURCE, LANGUAGE_VARIANT_BASE,
} from '../../src/lang.js';

describe('M2 (second pass) — variant codes route to real hosts', () => {
  it('maps all required variants to their base-language wiki', () => {
    const variants: Record<string, string> = {
      'zh-hans': 'zh.wikipedia.org',
      'zh-hant': 'zh.wikipedia.org',
      'zh-cn': 'zh.wikipedia.org',
      'zh-sg': 'zh.wikipedia.org',
      'zh-my': 'zh.wikipedia.org',
      'pt-br': 'pt.wikipedia.org',
    };
    for (const [code, host] of Object.entries(variants)) {
      const target = resolveTarget({ lang: code, project: 'wikipedia' });
      expect(target.host, code).toBe(host);
      expect(target.restBase, code).toBe(`https://${host}/api/rest_v1`);
      // The full requested code is retained, not silently rewritten.
      expect(target.lang, code).toBe(code);
      expect(target.source, code).toBe(`wikipedia:${code}`);
      expect(target.articleUrl('Earth'), code).toContain(`https://${host}/wiki/Earth`);
    }
  });

  it('keeps exact hosts for variant codes that are real wikis', () => {
    for (const code of ['be-tarask', 'zh-min-nan', 'zh-tw']) {
      const target = resolveTarget({ lang: code });
      expect(target.host, code).toBe(`${code}.wikipedia.org`);
      expect(LANGUAGE_VARIANT_BASE[code]).toBeUndefined();
      expect(hostLangFor(code)).toBe(code);
    }
  });

  it('applies the mapping to project codes and dotted forms too', () => {
    expect(resolveTarget({ project: 'zh-hanswiki' }).host).toBe('zh.wikipedia.org');
    expect(resolveTarget({ project: 'zh-hanswiki' }).source).toBe('wikipedia:zh-hans');
    expect(resolveTarget({ project: 'pt-br.wikipedia' }).host).toBe('pt.wikipedia.org');
    expect(resolveTarget({ lang: 'zh-hans', project: 'wiktionary' }).host).toBe('zh.wiktionary.org');
  });

  it('does not regress the M2 schema rules', () => {
    expect(LANG_MAX_LENGTH).toBe(12);
    expect(LANG_PATTERN_SOURCE).toBe('^[a-z]{2,12}(-[a-z0-9]{2,12}){0,3}$');
    for (const code of ['zh-hans', 'pt-br', 'be-tarask', 'zh-min-nan', 'EN']) {
      expect(isValidLang(code.toLowerCase()), code).toBe(true);
      expect(getSummarySchema.safeParse({ title: 'Earth', lang: code }).success, code).toBe(true);
    }
    expect(getSummarySchema.safeParse({ title: 'Earth', lang: 'en_us' }).success).toBe(false);
  });
});
