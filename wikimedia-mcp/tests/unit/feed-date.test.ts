import { describe, expect, it } from 'vitest';
import { WikimediaClient } from '../../src/upstream/client.js';
import { createHandlers } from '../../src/server/tools/handlers.js';
import { getFeedSchema, isValidFeedDate } from '../../src/server/tools/schemas.js';
import { testConfig } from '../helpers/test-env.js';

const config = testConfig();
let fetchCount = 0;
const client = new WikimediaClient(config, {
  useDispatcher: false,
  fetchImpl: async () => { fetchCount += 1; throw new Error('upstream should not be called'); },
});
const handlers = createHandlers(client, config);

function errorOf(result: { structuredContent?: Record<string, unknown> }): Record<string, unknown> {
  return (result.structuredContent?.['error'] ?? {}) as Record<string, unknown>;
}

describe('M1 — strict get_feed date validation', () => {
  it('rejects impossible calendar dates that JS Date would normalise', async () => {
    expect(isValidFeedDate('2026-02-30')).toBe(false);
    expect(isValidFeedDate('2026-13-01')).toBe(false);
    expect(getFeedSchema.safeParse({ kind: 'featured', date: '2026-02-30' }).success).toBe(false);
    const before = fetchCount;
    const result = await handlers.get_feed({ kind: 'featured', date: '2026-02-30' });
    expect(errorOf(result)).toMatchObject({ code: 'validation_error', retryable: false });
    expect(fetchCount).toBe(before);
  });

  it('rejects future dates with no tolerance window', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(isValidFeedDate(tomorrow)).toBe(false);
    expect(getFeedSchema.safeParse({ kind: 'featured', date: tomorrow }).success).toBe(false);
    const result = await handlers.get_feed({ kind: 'featured', date: tomorrow });
    expect(errorOf(result)).toMatchObject({ code: 'validation_error' });
  });

  it('accepts today and a valid historical date', () => {
    expect(isValidFeedDate('today')).toBe(true);
    expect(isValidFeedDate('2026-11-20')).toBe(true);
    expect(getFeedSchema.safeParse({ kind: 'on_this_day', date: '2026-11-20' }).success).toBe(true);
  });
});
