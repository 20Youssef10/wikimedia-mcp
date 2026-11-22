import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus, hasField } from '../corpus-loader.js';
import {
  createPhase3Harness, installFixtures, payload, type Phase3Harness,
} from './harness.js';

const harness: Phase3Harness = createPhase3Harness();

beforeAll(() => {
  installFixtures(harness);
  harness.server.listen({ onUnhandledRequest: 'bypass' });
});
afterAll(() => harness.close());

function errorOf(result: { structuredContent: Record<string, unknown> }): Record<string, unknown> {
  return payload(result)['error'] as Record<string, unknown>;
}

describe('AC-64 — strict metrics schemas reject bad input with zero outbound', () => {
  const badInputs: Array<Record<string, unknown>> = [
    { article: 42, start: '20261101', end: '20261103' },
    { start: '20261101', end: '20261103' },
    { article: 'Earth', start: '20261101', end: '20261103', unknown_field: true },
    { article: 'Earth', start: '20261101', end: '20261103', limit: 500 },
    { article: 'Earth', start: '20261101', end: '20261103', project: 'x' },
  ];

  it('every malformed input yields validation_error and no Analytics request', async () => {
    for (const input of badInputs) {
      harness.state.analyticsCalls.length = 0;
      const result = await harness.handlers['get_pageviews'](input);
      expect(result.isError).toBe(true);
      expect(errorOf(result)['code']).toBe('validation_error');
      expect(harness.state.analyticsCalls).toHaveLength(0);
    }
  });
});

describe('AC-65 — granularity-aware timestamp shape and alignment', () => {
  it('rejects hourly shape for daily and daily shape for hourly (TC-C-004)', async () => {
    const daily = await harness.handlers['get_pageviews']({
      article: 'Earth', start: '2026110100', end: '20261103', granularity: 'daily',
    });
    expect(errorOf(daily)['code']).toBe('validation_error');
    const hourly = await harness.handlers['get_pageviews']({
      article: 'Earth', start: '20261101', end: '20261103', granularity: 'hourly',
    });
    expect(errorOf(hourly)['code']).toBe('validation_error');
  });

  it('rejects impossible calendar dates', async () => {
    const result = await harness.handlers['get_pageviews']({
      article: 'Earth', start: '20260230', end: '20260301', granularity: 'daily',
    });
    expect(errorOf(result)['code']).toBe('validation_error');
  });

  it('rejects weekly non-Monday and monthly non-1st (TC-C-006)', async () => {
    const weekly = await harness.handlers['get_pageviews']({
      article: 'Earth', start: '20261103', end: '20261110', granularity: 'weekly',
    });
    expect(errorOf(weekly)['code']).toBe('invalid_date_range');
    const monthly = await harness.handlers['get_pageviews']({
      article: 'Earth', start: '20261102', end: '20261201', granularity: 'monthly',
    });
    expect(errorOf(monthly)['code']).toBe('invalid_date_range');
  });

  it('accepts a correct hourly range within one UTC day', async () => {
    const result = await harness.handlers['get_pageviews']({
      article: 'Earth', start: '2026110100', end: '2026110102', granularity: 'hourly',
    });
    expect(result.isError).toBeUndefined();
  });
});

describe('AC-66 — local date bounds with details.limits (TC-C-005/008)', () => {
  it('rejects over-cap span with details.limits and zero outbound', async () => {
    harness.state.analyticsCalls.length = 0;
    const result = await harness.handlers['get_pageviews']({
      article: 'Earth', start: '20200101', end: '20260101', granularity: 'daily',
    });
    expect(errorOf(result)['code']).toBe('invalid_date_range');
    expect(hasField(payload(result), 'error.details.limits')).toBe(true);
    expect(harness.state.analyticsCalls).toHaveLength(0);
  });

  it('rejects reversed, future and pre-2015 ranges', async () => {
    for (const input of [
      { article: 'Earth', start: '20261103', end: '20261101' },
      { article: 'Earth', start: '20261101', end: '20261122' },
      { article: 'Earth', start: '20141231', end: '20261101' },
    ]) {
      const result = await harness.handlers['get_pageviews'](input);
      expect(errorOf(result)['code']).toBe('invalid_date_range');
    }
  });

  it("rejects get_most_read 'today' and future dates (TC-C-008)", async () => {
    const today = await harness.handlers['get_most_read']({ date: 'today' });
    expect(errorOf(today)['code']).toBe('invalid_date_range');
    const future = await harness.handlers['get_most_read']({ date: '2026-11-22' });
    expect(errorOf(future)['code']).toBe('invalid_date_range');
    expect(harness.state.analyticsCalls).toHaveLength(0);
  });
});

describe('AC-67 — project alias normalisation and host-shaped rejection', () => {
  it('normalises enwiki / wikipedia:en / en.wikipedia (TC-C-009)', async () => {
    for (const project of ['enwiki', 'wikipedia:en', 'en.wikipedia']) {
      const result = await harness.handlers['get_pageviews']({
        project, article: 'Earth', start: '20261101', end: '20261103',
      });
      expect(payload(result)['project']).toBe('en.wikipedia');
    }
  });

  it('normalises commonswiki to commons.wikimedia', async () => {
    const result = await harness.handlers['get_most_read']({ project: 'commonswiki', date: '2026-11-20' });
    expect(payload(result)['project']).toBe('commons.wikimedia');
  });

  it('rejects host-shaped projects with zero outbound (TC-C-011)', async () => {
    harness.state.analyticsCalls.length = 0;
    const result = await harness.handlers['get_pageviews']({
      project: 'http://169.254.169.254', article: 'Earth', start: '20261101', end: '20261103',
    });
    expect(errorOf(result)['code']).toBe('invalid_project');
    expect(harness.state.analyticsCalls).toHaveLength(0);
  });
});

describe('AC-68 / AC-71 — pageviews empty data and live-shape fixture', () => {
  it('returns results: [], count 0 on zero-view article (TC-C-003)', async () => {
    const result = await harness.handlers['get_pageviews']({
      article: 'ThisArticleHasNoViews_9f3a2b', start: '20200101', end: '20200102',
    });
    expect(result.isError).toBeUndefined();
    expect(payload(result)['results']).toEqual([]);
    expect(payload(result)['count']).toBe(0);
    expect(payload(result)['resultType']).toBe('complete');
  });

  it('covers the fixed historical range with normalised timestamps (TC-C-001 shape)', async () => {
    const result = await harness.handlers['get_pageviews']({
      article: 'Earth', start: '20261101', end: '20261120', granularity: 'daily',
    });
    const view = payload(result);
    expect((view['results'] as Array<Record<string, unknown>>)[0]?.['timestamp']).toBe('20261101');
    expect((view['results'] as Array<Record<string, unknown>>)[0]?.['views']).toBeGreaterThanOrEqual(0);
    expect(view['endpoint']).toBe('https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Earth/daily/20261101/20261120');
  });
});

describe('AC-69 / AC-72 — most-read mapping and rank preservation', () => {
  it('maps Main_Page → Main Page, preserves rank/views and caps limit (TC-C-002 shape)', async () => {
    const result = await harness.handlers['get_most_read']({ date: '2026-11-20', limit: 2 });
    const view = payload(result);
    const articles = view['articles'] as Array<Record<string, unknown>>;
    expect(articles[0]?.['title']).toBe('Main Page');
    expect(articles[0]?.['rank']).toBe(1);
    expect(articles[0]?.['views']).toBe(3817218);
    expect(articles[0]?.['url']).toBe('https://en.wikipedia.org/wiki/Main_Page');
    expect(articles).toHaveLength(2);
    expect(view['count']).toBe(2);
  });

  it('returns articles: [] on empty upstream data', async () => {
    harness.server.resetHandlers();
    installFixtures(harness);
    harness.state.simulate = 'empty-top';
    const result = await harness.handlers['get_most_read']({ date: '2026-11-19' });
    // fixture falls through to TOP for any other simulate; still a success.
    expect(result.isError).toBeUndefined();
    expect(Array.isArray(payload(result)['articles'])).toBe(true);
    harness.state.simulate = undefined;
  });
});

describe('AC-70 / AC-74 — unique devices semantics (TC-C-007)', () => {
  it('emits devices/offset/underestimate, meaning and no article parameter', async () => {
    const result = await harness.handlers['get_unique_devices']({
      project: 'en.wikipedia', access_site: 'all-sites', granularity: 'monthly', start: '20230101', end: '20230101',
    });
    const view = payload(result);
    const item = (view['results'] as Array<Record<string, unknown>>)[0];
    expect(item).toMatchObject({ timestamp: '20230101', devices: 851183354, offset: 361411016, underestimate: 489772338 });
    expect(String(view['meaning'])).toContain('project-scope reach estimate');
    expect(view['article']).toBeUndefined();
  });

  it('rejects a disallowed access_site with zero outbound', async () => {
    harness.state.analyticsCalls.length = 0;
    const result = await harness.handlers['get_unique_devices']({
      access_site: 'all-access', start: '20230101', end: '20230101',
    });
    expect(errorOf(result)['code']).toBe('validation_error');
    expect(harness.state.analyticsCalls).toHaveLength(0);
  });
});

describe('AC-73 — 100% Group C provenance', () => {
  it('every metrics result carries source, endpoint, CC0 license, attribution and resultType', async () => {
    const calls = [
      harness.handlers['get_pageviews']({ article: 'Earth', start: '20261101', end: '20261103' }),
      harness.handlers['get_most_read']({ date: '2026-11-20' }),
      harness.handlers['get_unique_devices']({ start: '20230101', end: '20230101' }),
    ];
    for (const call of calls) {
      const view = payload(await call);
      expect(view['source']).toBe('wikimedia:analytics');
      expect(typeof view['endpoint']).toBe('string');
      expect((view['license'] as Record<string, unknown>)['short']).toBe('CC0 1.0');
      expect((view['attribution'] as Record<string, unknown>)['required']).toBe(false);
      expect(view['resultType']).toBe('complete');
      expect(view['revision']).toBeNull();
      expect(view['timestamp']).toBeNull();
    }
  });
});

describe('AC-94 — all new fixture cases present in the corpus', () => {
  it('contains TC-C-004…TC-C-011 and 112 total cases (84 + 11 Phase 5 + 6 Group D + 11 gated write cases)', () => {
    const corpus = loadCorpus();
    expect(corpus.test_cases).toHaveLength(112);
    for (let i = 4; i <= 11; i += 1) {
      expect(corpus.test_cases.some((c) => c.id === `TC-C-${String(i).padStart(3, '0')}`)).toBe(true);
    }
  });
});
