import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const cassetteDir = path.resolve(process.cwd(), 'tests/fixtures/cassettes/A');

function load(name: string): Record<string, unknown> {
  // Cassettes are JSON documents stored with a .yaml extension (JSON is valid YAML 1.2).
  return JSON.parse(readFileSync(path.join(cassetteDir, name), 'utf8')) as Record<string, unknown>;
}

describe('recorded fixtures', () => {
  it('loads the canonical summary cassette with provenance fields', () => {
    const cassette = load('get_summary_TC-A-002.yaml');
    expect(cassette['case_id']).toBe('TC-A-002');
    const response = cassette['response'] as Record<string, unknown>;
    const body = response['body'] as Record<string, unknown>;
    expect(body['revision']).toBe(1293847560);
    expect(body['timestamp']).toBe('2026-11-20T09:14:22Z');
    expect(body['content_urls']).toBeDefined();
  });

  it('loads the 404 and media cassettes', () => {
    expect((load('get_summary_TC-A-004.yaml')['response'] as Record<string, unknown>)['status']).toBe(404);
    const media = load('get_media_TC-A-009.yaml')['response'] as Record<string, unknown>;
    const items = media['items'] as Array<Record<string, unknown>>;
    expect(items[0]?.['license']).toBeDefined();
    expect(items[0]?.['attribution']).toBeDefined();
  });
});
