import { describe, expect, it } from 'vitest';
import { CACHEABLE_OPERATIONS, cacheHints, isCacheableOperation, assertNoCacheFields } from '../../src/protocol/caching.js';
import { inputRequiredStub } from '../../src/protocol/result.js';

describe('caching metadata (AC-07/AC-08/AC-09)', () => {
  it('defines hints for exactly the six cacheable operations', () => {
    expect(CACHEABLE_OPERATIONS).toEqual([
      'server/discover', 'tools/list', 'prompts/list',
      'resources/list', 'resources/templates/list', 'resources/read',
    ]);
    for (const operation of CACHEABLE_OPERATIONS) {
      const hint = cacheHints[operation];
      expect(hint).toBeDefined();
      expect(hint?.ttlMs).toBeGreaterThanOrEqual(0);
      expect(hint?.cacheScope).toBe('public');
    }
  });

  it('does not treat tools/call as cacheable', () => {
    expect(isCacheableOperation('tools/call')).toBe(false);
    expect(assertNoCacheFields({ title: 'Earth' })).toBe(true);
    expect(assertNoCacheFields({ ttlMs: 10 })).toBe(false);
  });

  it('input_required stub carries neither ttlMs nor cacheScope', () => {
    const stub = inputRequiredStub();
    expect(stub.resultType).toBe('input_required');
    expect('ttlMs' in stub).toBe(false);
    expect('cacheScope' in stub).toBe(false);
  });
});
