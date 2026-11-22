import { describe, expect, it } from 'vitest';
import { enforceResultLimit } from '../../src/protocol/limits.js';
import { DEFAULT_LICENSE } from '../../src/attribution/assemble.js';

const provenance = {
  source: 'wikipedia:en',
  license: DEFAULT_LICENSE,
  attribution: {
    required: true,
    text: 'Earth — wikipedia:en contributors, CC BY-SA 4.0',
    link: 'https://en.wikipedia.org/wiki/Earth?wprov=afsw1',
    disclaimer: 'You remain responsible for licence compliance.',
  },
};

describe('M3 — MAX_RESULT_BYTES enforcement', () => {
  it('leaves small payloads untouched', () => {
    const payload = { ...provenance, title: 'Earth', content: 'short' };
    expect(enforceResultLimit(payload, 65536)).toBe(payload);
  });

  it('clips bulky content, marks truncated, and keeps provenance', () => {
    const payload = { ...provenance, title: 'Earth', content: 'x'.repeat(200_000) };
    const limited = enforceResultLimit(payload, 1000);
    expect(Buffer.byteLength(JSON.stringify(limited), 'utf8')).toBeLessThanOrEqual(1000);
    expect(limited['truncated']).toBe(true);
    expect(String(limited['content']).length).toBeLessThan(200_000);
    expect(limited['license']).toEqual(DEFAULT_LICENSE);
    expect(limited['attribution']).toEqual(provenance.attribution);
  });

  it('truncates long arrays and never drops licence/attribution as a last resort', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ title: `Page ${i}`, url: `https://example.org/${'a'.repeat(20)}` }));
    const limited = enforceResultLimit({ ...provenance, items }, 1500);
    expect(Buffer.byteLength(JSON.stringify(limited), 'utf8')).toBeLessThanOrEqual(1500);
    expect(limited['truncated']).toBe(true);
    expect(limited['license']).toBeDefined();
    expect(limited['attribution']).toBeDefined();
  });
});
