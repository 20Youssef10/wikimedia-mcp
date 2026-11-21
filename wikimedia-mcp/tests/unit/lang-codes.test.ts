import { describe, expect, it } from 'vitest';
import { resolveTarget } from '../../src/resolver.js';
import { getSummarySchema } from '../../src/server/tools/schemas.js';
import { isValidLang, LANG_RE, normalizeLang } from '../../src/lang.js';

describe('M2 — hyphenated and uppercase language codes accepted consistently', () => {
  const valid = ['en', 'zh-hans', 'be-tarask', 'zh-min-nan', 'pt-br', 'EN', ' DE '];

  it('schema and resolver use the identical acceptance rule', () => {
    for (const code of valid) {
      const expected = normalizeLang(code);
      expect(isValidLang(expected), code).toBe(true);
      expect(LANG_RE.test(expected), code).toBe(true);
      expect(getSummarySchema.safeParse({ title: 'Earth', lang: code }).success, code).toBe(true);
      expect(resolveTarget({ lang: code, project: 'wikipedia' }).lang, code).toBe(expected);
    }
  });

  it('normalises uppercase/trimmed codes into the source identifier', () => {
    expect(resolveTarget({ lang: 'EN' }).source).toBe('wikipedia:en');
    expect(resolveTarget({ lang: ' zh-hans ' }).source).toBe('wikipedia:zh-hans');
    expect(resolveTarget({ project: 'zh-hanswiki' }).source).toBe('wikipedia:zh-hans');
    expect(resolveTarget({ project: 'pt-br.wikipedia' }).source).toBe('wikipedia:pt-br');
  });

  it('still rejects malformed or over-long codes', () => {
    for (const bad of ['e', 'abc-def-ghi-jkl-mno', 'en--us', 'en_US']) {
      expect(isValidLang(bad), bad).toBe(false);
      expect(getSummarySchema.safeParse({ title: 'Earth', lang: bad }).success, bad).toBe(false);
      expect(() => resolveTarget({ lang: bad }), bad).toThrow(/Invalid Wikimedia language/);
    }
  });
});
