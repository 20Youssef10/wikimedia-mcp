import { describe, expect, it } from 'vitest';
import { resolveTarget, ResolverError } from '../../src/resolver.js';

describe('language/project resolver', () => {
  it('applies en/wikipedia defaults', () => {
    const target = resolveTarget({});
    expect(target.source).toBe('wikipedia:en');
    expect(target.host).toBe('en.wikipedia.org');
    expect(target.restBase).toBe('https://en.wikipedia.org/api/rest_v1');
    expect(target.actionUrl).toBe('https://en.wikipedia.org/w/api.php');
  });

  it('resolves Wikimedia project codes from the corpus (v1.0.1)', () => {
    expect(resolveTarget({ project: 'enwiki' }).source).toBe('wikipedia:en');
    expect(resolveTarget({ project: 'dewiki' }).source).toBe('wikipedia:de');
    expect(resolveTarget({ project: 'dewiki' }).host).toBe('de.wikipedia.org');
    expect(resolveTarget({ project: 'en.wikipedia' }).source).toBe('wikipedia:en');
    expect(resolveTarget({ project: 'testwiki' }).host).toBe('test.wikipedia.org');
    expect(resolveTarget({ project: 'commonswiki' }).host).toBe('commons.wikimedia.org');
  });

  it('lets a code-encoded language override the lang parameter', () => {
    const target = resolveTarget({ lang: 'en', project: 'dewiki' });
    expect(target.lang).toBe('de');
    expect(target.source).toBe('wikipedia:de');
  });

  it('resolves aliases and special hosts', () => {
    expect(resolveTarget({ project: 'wiki' }).host).toBe('en.wikipedia.org');
    expect(resolveTarget({ project: 'wp', lang: 'fr' }).host).toBe('fr.wikipedia.org');
    expect(resolveTarget({ project: 'wikidata' }).host).toBe('www.wikidata.org');
    expect(resolveTarget({ project: 'meta' }).host).toBe('meta.wikimedia.org');
    expect(resolveTarget({ project: 'species' }).host).toBe('species.wikimedia.org');
  });

  it('URL-encodes titles with %20 rather than +', () => {
    const target = resolveTarget({});
    expect(target.articleUrl('Ada Lovelace')).toBe('https://en.wikipedia.org/wiki/Ada%20Lovelace?wprov=afsw1');
  });

  it('rejects unsupported projects and invalid languages', () => {
    expect(() => resolveTarget({ project: 'not-a-project' })).toThrow(ResolverError);
    expect(() => resolveTarget({ lang: 'en_us' })).toThrow(/Invalid Wikimedia language/);
  });
});
