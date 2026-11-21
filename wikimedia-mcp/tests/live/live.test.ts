import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeMetrics, LiveGateRunner, nearestRankP95, STANDARD_LIVE_CONFIG, toolClass,
  type Observation,
} from '../../src/observability/live-gate.js';
import { phase1LiveCases, type CorpusCase } from '../corpus-loader.js';

/**
 * REAL nightly gate (contract 09 §4). Skipped in the fixture-only merge gate:
 * no live network in CI. Enable with
 *   npm run build && WMCP_LIVE=1 npx vitest run tests/live/live.test.ts
 * off-peak from clean egress. Metric computation itself is always tested
 * (fixture-backed) in live-gate.test.ts.
 */
const enabled = process.env['WMCP_LIVE'] === '1';
const describeLive = enabled ? describe : describe.skip;

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ENTRY = path.join(ROOT, 'dist/index.js');

async function freePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', () => resolve()));
  const address = socket.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

/** Per-tool measured-call mix from contract 09 §4.2 (sum = 300). */
const MIX: Record<string, number> = {
  // Class R (REST): 60+40+25+25 = 150; Class A (Action): 45+35+30+22+18 = 150.
  // Both pools must meet STANDARD_LIVE_CONFIG.minSamplesPerClass (150).
  get_summary: 60, search: 45, get_feed: 40, get_page: 35, get_sections: 30,
  get_related_pages: 25, get_languages: 25, get_media: 22, get_random_page: 18,
};

function paramsFor(tool: string, caseFromCorpus: CorpusCase | undefined): Record<string, unknown> {
  if (caseFromCorpus !== undefined) return caseFromCorpus.params;
  const stable: Record<string, Record<string, unknown>> = {
    get_page: { title: 'Earth', format: 'plaintext' },
    get_related_pages: { title: 'Earth' },
    get_media: { title: 'Earth' },
    get_random_page: {},
    get_feed: { kind: 'featured', date: '2026-11-20' },
  };
  return stable[tool] ?? { title: 'Earth' };
}

function buildCases(): CorpusCase[] {
  const live = phase1LiveCases();
  const cases: CorpusCase[] = [];
  for (const [tool, count] of Object.entries(MIX)) {
    const corpusCase = live.find((item) => item.tool === tool);
    for (let i = 0; i < count; i += 1) {
      cases.push({
        id: `${tool}-live-${i}`,
        tool_group: 'A',
        tool,
        params: paramsFor(tool, corpusCase),
        category: 'happy_path',
        expected: { status: 'ok', required_fields: [], constraints: [] },
        mode: 'live',
      });
    }
  }
  // 30 warm-up calls use the same proportional mix.
  for (let i = 0; i < 30; i += 1) {
    const tool = Object.keys(MIX)[i % Object.keys(MIX).length] ?? 'get_summary';
    cases.unshift({
      id: `warmup-${i}`, tool_group: 'A', tool,
      params: paramsFor(tool, live.find((item) => item.tool === tool)),
      category: 'happy_path', expected: { status: 'ok', required_fields: [], constraints: [] }, mode: 'live',
    });
  }
  return cases;
}

describeLive('nightly live gate — Phase 1 Group A (M1–M4)', () => {
  let child: ChildProcess | undefined;
  let url: string;

  beforeAll(async () => {
    if (!existsSync(ENTRY)) throw new Error('Run `npm run build` before the nightly live gate');
    const port = await freePort();
    url = `http://127.0.0.1:${port}/mcp`;
    child = spawn(process.execPath, [ENTRY], {
      env: {
        ...process.env,
        MCP_TRANSPORT: 'streamable-http',
        MCP_HTTP_HOST: '127.0.0.1',
        MCP_HTTP_PORT: String(port),
        USER_AGENT: 'WikiMCP-Nightly/1.0 (https://example.org/nightly; ops@example.org)',
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const probe = await fetch(url, { method: 'GET' });
        if (probe.status === 405) return;
      } catch { /* not listening yet */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('nightly server did not start');
  }, 30000);

  afterAll(() => { child?.kill('SIGTERM'); });

  it('runs 330 live calls with 2 req/s pacing and concurrency <= 3', async () => {
    const cases = buildCases();
    expect(cases.length).toBe(STANDARD_LIVE_CONFIG.totalCalls);
    const runner = new LiveGateRunner(STANDARD_LIVE_CONFIG);
    const failureDetails = new Map<string, string>();

    const jobs = cases.map((testCase) => async (): Promise<Observation> => {
      const start = performance.now();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/call',
        'Mcp-Name': testCase.tool,
      };
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: {
            name: testCase.tool,
            arguments: testCase.params,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'nightly', version: '1.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });
      const text = await response.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const result = parsed['result'] as Record<string, unknown> | undefined;
      const isError = result?.['isError'] === true || parsed['error'] !== undefined;
      const error = result?.['structuredContent'] as Record<string, unknown> | undefined;
      const errorCode = typeof error?.['code'] === 'string' ? error['code'] : '';
      if (!response.ok || isError) failureDetails.set(testCase.id, `status=${response.status} ${text.slice(0, 400)}`);
      // Provenance must be checked on the PARSED result, not the raw JSON-RPC
      // text: tool content is a JSON string with escaped quotes, so a naive
      // /"license"/ regex on raw text reports false negatives (M5 bug).
      const structured = result?.['structuredContent'] as Record<string, unknown> | undefined;
      let contentObject = structured;
      if (contentObject === undefined) {
        const content = result?.['content'] as Array<{ type?: string; text?: string }> | undefined;
        const firstText = content?.find((c) => c.type === 'text')?.text;
        if (firstText !== undefined) {
          try { contentObject = JSON.parse(firstText) as Record<string, unknown>; } catch { /* not JSON content */ }
        }
      }
      return {
        id: testCase.id,
        tool: testCase.tool,
        toolClass: toolClass(testCase.tool),
        durationMs: performance.now() - start,
        ok: response.ok && !isError,
        singleCall: true,
        hasProvenance: contentObject !== undefined && 'license' in contentObject && 'attribution' in contentObject,
        isContent: true,
        errorActionable: !isError || (['code', 'message', 'retryable', 'action'].every((key) => key in (error ?? {}))),
        upstream429: errorCode === 'rate_limited' || /\b429\b/.test(text),
      };
    });

    const observations = await runner.run(jobs);
    const report = computeMetrics(observations, STANDARD_LIVE_CONFIG);

    // Diagnosability: a failing gate must say which tools failed and why.
    const measured = observations.filter((o) => !o.warmup);
    const byTool = new Map<string, { ok: number; total: number }>();
    for (const o of measured) {
      const entry = byTool.get(o.tool) ?? { ok: 0, total: 0 };
      entry.total += 1; if (o.ok) entry.ok += 1;
      byTool.set(o.tool, entry);
    }
    console.log('[nightly] per-tool success:', [...byTool.entries()].map(([t, v]) => `${t}=${v.ok}/${v.total}`).join(' '));
    const p95ByTool = new Map<string, number[]>();
    for (const o of measured.filter((item) => item.ok)) {
      const arr = p95ByTool.get(o.tool) ?? []; arr.push(o.durationMs); p95ByTool.set(o.tool, arr);
    }
    console.log('[nightly] per-tool p95(ms):', [...p95ByTool.entries()]
      .map(([t, arr]) => `${t}=${nearestRankP95(arr).toFixed(0)}`).join(' '));
    console.log('[nightly] M1 rate:', report.m1.rate, 'M4 429s:', report.m4.count429,
      'p95R:', report.m3.p95R, 'p95A:', report.m3.p95A, 'p95Global:', report.m3.p95Global,
      'M5 provenance:', report.m5.coverage, 'M6 actionable:', report.m6.coverage);
    for (const [id, detail] of [...failureDetails.entries()].slice(0, 12)) {
      console.log(`[nightly] FAIL ${id}: ${detail}`);
    }

    expect(report.warmup).toBe(30);
    expect(runner.peakConcurrency).toBeLessThanOrEqual(3);
    expect(report.m4.count429).toBe(0);
    expect(report.m1.rate).toBeGreaterThanOrEqual(0.95);
    expect(report.m2.rate).toBeGreaterThanOrEqual(0.70);
    expect(report.m3.p95R).toBeLessThanOrEqual(STANDARD_LIVE_CONFIG.budgets.R);
    expect(report.m3.p95A).toBeLessThanOrEqual(STANDARD_LIVE_CONFIG.budgets.A);
    expect(report.m3.p95Global).toBeLessThan(STANDARD_LIVE_CONFIG.budgets.global);
    expect(report.m3.samplesR, 'Class R must meet minSamplesPerClass').toBeGreaterThanOrEqual(STANDARD_LIVE_CONFIG.minSamplesPerClass);
    expect(report.m3.samplesA, 'Class A must meet minSamplesPerClass').toBeGreaterThanOrEqual(STANDARD_LIVE_CONFIG.minSamplesPerClass);
    expect(report.m3.pass).toBe(true);
    expect(report.overallPass).toBe(true);
  }, 400000);
});
