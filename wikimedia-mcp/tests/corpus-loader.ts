import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = path.resolve(here, '../../wikimedia-mcp-research/test-corpus.json');

export type CorpusCase = {
  id: string;
  tool_group: string;
  tool: string;
  params: Record<string, unknown>;
  category: string;
  expected: {
    status: string;
    required_fields: string[];
    constraints: string[];
  };
  mode: 'live' | 'fixture';
  notes?: string;
};

export type Corpus = {
  version: string;
  generated: string;
  test_cases: CorpusCase[];
};

export function loadCorpus(): Corpus {
  return JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Corpus;
}

/** The nine frozen Group A tools implemented in Phase 1. */
export const PHASE1_TOOLS = new Set([
  'search', 'get_summary', 'get_page', 'get_sections', 'get_related_pages',
  'get_media', 'get_languages', 'get_random_page', 'get_feed',
]);

export function phase1FixtureCases(): CorpusCase[] {
  return loadCorpus().test_cases.filter(
    (testCase) => testCase.mode === 'fixture' && PHASE1_TOOLS.has(testCase.tool),
  );
}

export function phase1LiveCases(): CorpusCase[] {
  return loadCorpus().test_cases.filter(
    (testCase) => testCase.mode === 'live' && PHASE1_TOOLS.has(testCase.tool),
  );
}

/** Recursively resolve a dotted field path such as `results[0].title`. */
export function hasField(value: unknown, dotted: string): boolean {
  const segments = dotted.replace(/\[(\d+)\]/g, '.$1').split('.').filter((segment) => segment.length > 0);
  let current: unknown = value;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') return false;
    const record = current as Record<string, unknown>;
    if (!(segment in record)) return false;
    current = record[segment];
  }
  return true;
}
