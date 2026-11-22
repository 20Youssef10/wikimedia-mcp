import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_CANONICAL_TITLE_CHARS, RELEVANCE_REASONS, allowedHostsFromResolver,
  canonicalTitleFor, relevanceReasonFor, resolveTarget,
} from '../../src/resolver.js';
import { createHandlers } from '../../src/server/tools/handlers.js';
import { WikimediaClient } from '../../src/upstream/client.js';
import { createMswServer } from '../helpers/msw.js';
import { testConfig } from '../helpers/test-env.js';

const msw = createMswServer();
const config = testConfig();
const client = new WikimediaClient(config, { useDispatcher: false });
const handlers = createHandlers(client, config);

beforeAll(() => msw.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => { client.close(); msw.close(); });

const ADDITIVE = ['relevance_reason', 'canonical_title', 'canonical_url', 'canonical_source'] as const;

describe('WP12 — bounded relevance labels', () => {
  it('uses a closed, enumerable reason set', () => {
    expect([...RELEVANCE_REASONS]).toEqual([
      'title_exact', 'title_prefix', 'title_contains',
      'snippet_match', 'description_match', 'unspecified',
    ]);
    for (const reason of RELEVANCE_REASONS) expect(reason.length).toBeLessThanOrEqual(20);
  });

  it('labels matches deterministically from already-present fields only', () => {
    expect(relevanceReasonFor('Ada Lovelace', { title: 'Ada Lovelace' })).toBe('title_exact');
    expect(relevanceReasonFor('Ada', { title: 'Ada Lovelace' })).toBe('title_prefix');
    expect(relevanceReasonFor('Lovelace', { title: 'Ada Lovelace' })).toBe('title_contains');
    expect(relevanceReasonFor('Ada', { title: 'Other', snippet: '<span>Mathematician</span>' })).toBe('unspecified');
    expect(relevanceReasonFor('Ada', { title: 'Other', snippet: 'Ada worked here' })).toBe('snippet_match');
    expect(relevanceReasonFor('Ada', { title: 'Other', description: 'Ada, pioneer' })).toBe('description_match');
    expect(relevanceReasonFor('Ada', { title: 'Other', extract: 'Ada wrote' })).toBe('description_match');
    expect(relevanceReasonFor('Ada', { title: 'Other' })).toBe('unspecified');
    expect(relevanceReasonFor('', { title: 'Ada' })).toBe('unspecified');
    expect(relevanceReasonFor('Ada', { title: 'Ada Lovelace' }))
      .toBe(relevanceReasonFor('Ada', { title: 'Ada Lovelace' }));
  });
});

describe('WP12 — canonical-title resolution through the allowlist', () => {
  const target = resolveTarget({ project: 'enwiki' });

  it('resolves a normalised title to an allowlisted host/source', () => {
    const resolved = canonicalTitleFor(target, 'Ada_Lovelace');
    expect(resolved).not.toBeNull();
    expect(resolved?.canonical_title).toBe('Ada Lovelace');
    expect(resolved?.canonical_source).toBe('wikipedia:en');
    expect(resolved?.canonical_url).toContain('https://en.wikipedia.org/wiki/Ada%20Lovelace');
    const host = new URL(resolved?.canonical_url ?? 'https://invalid.test').hostname;
    expect(allowedHostsFromResolver().some((allowed) => host === allowed || host.endsWith(`.${allowed}`))).toBe(true);
  });

  it('never trusts upstream URLs or caller-supplied hosts', () => {
    expect(canonicalTitleFor(target, { url: 'https://evil.test/x' })).toBeNull();
    expect(canonicalTitleFor(target, 42)).toBeNull();
    expect(canonicalTitleFor(target, '')).toBeNull();
    expect(canonicalTitleFor(target, 'a'.repeat(MAX_CANONICAL_TITLE_CHARS + 1))).toBeNull();
    expect(canonicalTitleFor(target, 'Bad\u0000Title')).toBeNull();
    const resolved = canonicalTitleFor(target, 'Safe Title');
    expect(resolved?.canonical_url).not.toContain('evil.test');
    expect(resolved?.canonical_url).toContain('?wprov=afsw1');
  });
});

describe('WP12 — additive fields on search/get_related_pages (superset)', () => {
  it('search keeps every prior field and order, then adds explainable hints', async () => {
    const result = await handlers['search']({ q: 'Ada', lang: 'en', project: 'wikipedia', limit: 5 });
    const payload = result.structuredContent;
    const results = payload['results'] as Record<string, unknown>[];
    expect(result.isError).toBeUndefined();
    expect((payload['query'] as string)).toBe('Ada');
    expect(results.map((item) => item['title'])).toEqual(['Ada Lovelace', 'Ada (name)']);
    for (const item of results) {
      expect(RELEVANCE_REASONS).toContain(item['relevance_reason']);
      expect(allowedHostsFromResolver().some((host) => String(item['canonical_url']).includes(host))).toBe(true);
      expect(item['canonical_source']).toBe('wikipedia:en');
    }
    // Removing the additive keys yields the exact prior result shape.
    const priorShape = results.map((item) => {
      const copy = { ...item };
      for (const key of ADDITIVE) delete copy[key];
      return copy;
    });
    expect(priorShape[0]).toMatchObject({
      pageid: 1, title: 'Ada Lovelace', snippet: 'Mathematician',
      timestamp: '2026-01-01T00:00:00Z', wordcount: 1000,
      url: 'https://en.wikipedia.org/wiki/Ada%20Lovelace?wprov=afsw1', qid: null,
    });
    expect(Object.keys(priorShape[0] ?? {}).sort()).toEqual([
      'pageid', 'qid', 'snippet', 'timestamp', 'title', 'url', 'wordcount',
    ]);
  });

  it('get_related_pages keeps flat provenance and adds canonical hints only', async () => {
    const result = await handlers['get_related_pages']({ title: 'Earth', lang: 'en', project: 'wikipedia', limit: 5 });
    const payload = result.structuredContent;
    expect(result.isError).toBeUndefined();
    const related = payload['related'] as Record<string, unknown>[];
    expect(payload['pages']).toEqual(related); // compatibility alias unchanged
    expect(related.map((item) => item['title'])).toEqual(['Related One', 'Related Two']);
    for (const item of related) {
      expect(RELEVANCE_REASONS).toContain(item['relevance_reason']);
      expect(String(item['canonical_url'])).toContain('https://en.wikipedia.org/wiki/');
      expect(item['canonical_source']).toBe('wikipedia:en');
      // The old upstream-provided `url` field is retained verbatim.
      expect(String(item['url'])).toContain('https://en.wikipedia.org/wiki/Related_');
      const prior = { ...item };
      for (const key of ADDITIVE) delete prior[key];
      expect(Object.keys(prior).sort()).toEqual([
        'description', 'extract', 'thumbnail', 'title', 'url',
      ]);
    }
    for (const field of ['source', 'license', 'attribution', 'provenance_block']) {
      expect(field in payload).toBe(true);
    }
  });
});
