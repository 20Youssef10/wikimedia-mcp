import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOL_SCHEMAS, TOOL_DESCRIPTIONS, IDEMPOTENT_TOOLS, PHASE1_TOOL_NAMES } from '../../src/server/tools/schemas.js';
import { TOOL_NAMES } from '../../src/server/tools/registry.js';

describe('tool schemas (AC-21/AC-22/AC-23)', () => {
  it('advertises exactly nine Phase 1 tools with descriptions (AC-35)', () => {
    // Phase 2 adds six Group B tools to TOOL_NAMES; the frozen Phase 1 set
    // remains exactly these nine, unchanged in name, schema and error code.
    expect(PHASE1_TOOL_NAMES).toEqual([
      'search', 'get_summary', 'get_page', 'get_sections', 'get_related_pages',
      'get_media', 'get_languages', 'get_random_page', 'get_feed',
    ]);
    // Phase 3 adds five Group C/F tools; the Phase 1 nine are unchanged.
    expect(TOOL_NAMES).toHaveLength(20);
    for (const name of PHASE1_TOOL_NAMES) {
      expect(TOOL_DESCRIPTIONS[name].length).toBeGreaterThan(20);
      expect(z.toJSONSchema(TOOL_SCHEMAS[name]).type).toBe('object');
    }
  });

  it('rejects missing required params and unknown extra fields (strict)', () => {
    expect(TOOL_SCHEMAS.search.safeParse({}).success).toBe(false);
    expect(TOOL_SCHEMAS.get_summary.safeParse({ title: 'Earth', extra: true }).success).toBe(false);
    expect(TOOL_SCHEMAS.get_feed.safeParse({}).success).toBe(false);
  });

  it('rejects wrong types and out-of-range limits', () => {
    expect(TOOL_SCHEMAS.search.safeParse({ q: 5 }).success).toBe(false);
    expect(TOOL_SCHEMAS.search.safeParse({ q: 'x', limit: 51 }).success).toBe(false);
    expect(TOOL_SCHEMAS.search.safeParse({ q: 'x', limit: 0 }).success).toBe(false);
    expect(TOOL_SCHEMAS.get_media.safeParse({ title: 'x', thumb_width: 39 }).success).toBe(false);
  });

  it('rejects malformed dates and unknown feed kind', () => {
    expect(TOOL_SCHEMAS.get_feed.safeParse({ kind: 'featured', date: 'yesterday' }).success).toBe(false);
    expect(TOOL_SCHEMAS.get_feed.safeParse({ kind: 'other' }).success).toBe(false);
    expect(TOOL_SCHEMAS.get_feed.safeParse({ kind: 'featured', date: '2026-11-21' }).success).toBe(true);
  });

  it('applies documented defaults', () => {
    const parsed = TOOL_SCHEMAS.search.parse({ q: 'x' });
    expect(parsed.lang).toBe('en');
    expect(parsed.project).toBe('wikipedia');
    expect(parsed.limit).toBe(10);
    expect(parsed.offset).toBe(0);
    const page = TOOL_SCHEMAS.get_page.parse({ title: 'x' });
    expect(page.format).toBe('plaintext');
    expect(page.max_chars).toBe(20000);
  });

  it('marks exactly two tools as non-idempotent', () => {
    expect(IDEMPOTENT_TOOLS.has('get_random_page')).toBe(false);
    expect(IDEMPOTENT_TOOLS.has('get_feed')).toBe(false);
    expect(IDEMPOTENT_TOOLS.size).toBe(7);
  });
});
