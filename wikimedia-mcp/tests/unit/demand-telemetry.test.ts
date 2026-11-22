import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  DEMAND_THRESHOLDS,
  DemandTelemetry,
  emptyDemandSnapshot,
  evaluateDemandDecision,
  longestConsecutiveDiffDays,
  resolveDemandDecisionPath,
  resolveDemandReportPath,
  writeDemandDecision,
  writeDemandReport,
  type DemandSnapshot,
} from '../../src/observability/demand-telemetry.js';
import {
  buildNightlyReport,
} from '../../src/observability/nightly-report.js';
import { computeMetrics, toolClass, type Observation } from '../../src/observability/live-gate.js';
import { createHandlers } from '../../src/server/tools/handlers.js';
import { WikimediaClient } from '../../src/upstream/client.js';
import { createMswServer } from '../helpers/msw.js';
import { testConfig } from '../helpers/test-env.js';

const at = (date: string) => () => Date.parse(`${date}T12:00:00Z`);
const FORBIDDEN = ['Earth', 'SecretTitle', 'revision diff', 'Bearer', 'secret', 'alice', 'session-raw'];

function assertNoContent(serialised: string): void {
  for (const needle of FORBIDDEN) {
    expect(serialised, `demand telemetry leaked ${needle}`).not.toContain(needle);
  }
}

/** Synthetic telemetry: 50 search sessions/day, 2 of them asking for a diff. */
function sevenDayDiffTelemetry(days: number): DemandTelemetry {
  const telemetry = new DemandTelemetry();
  for (let index = 0; index < days; index += 1) {
    const date = `2026-11-${String(10 + index).padStart(2, '0')}`;
    const now = at(date);
    for (let session = 0; session < 50; session += 1) {
      const key = `search-session-${date}-${session}`;
      telemetry.recordToolInvocation({ tool: 'search', ok: true, sessionKey: key, now });
      if (session < 2) telemetry.recordSearchSessionDiffRequested({ sessionKey: key, now });
    }
  }
  return telemetry;
}

describe('WP6 — demand telemetry is counts only', () => {
  it('records tool name, success/failure and single-call resolution without content', () => {
    const telemetry = new DemandTelemetry();
    const now = at('2026-11-21');
    telemetry.recordToolInvocation({ tool: 'search', ok: true, sessionKey: 'session-raw-alice', now });
    telemetry.recordToolInvocation({ tool: 'get_summary', ok: false, sessionKey: 'session-raw-alice', now });
    telemetry.recordToolInvocation({ tool: 'get_summary', ok: true, sessionKey: 'other-session', now });
    // No session surrogate: counted at tool level, no session claim made.
    telemetry.recordToolInvocation({ tool: 'search', ok: true, now });
    const snapshot = telemetry.snapshot();

    expect(snapshot.instrumented).toBe(true);
    expect(snapshot.days_observed).toBe(1);
    expect(snapshot.first_observed_date).toBe('2026-11-21');
    expect(snapshot.last_observed_date).toBe('2026-11-21');
    expect(snapshot.tool_calls['search']).toEqual({ calls: 2, successes: 2, failures: 0 });
    expect(snapshot.tool_calls['get_summary']).toEqual({ calls: 2, successes: 1, failures: 1 });
    expect(snapshot.sessions_observed).toBe(2);
    expect(snapshot.single_call_sessions).toBe(1);
    expect(snapshot.daily[0]?.single_call_sessions).toBe(1);
    expect(snapshot.search_sessions).toBe(1);
    expect(snapshot.search_invocations).toBe(1);
    assertNoContent(JSON.stringify(snapshot));
  });

  it('increments only on the documented explicit signal paths', () => {
    const telemetry = new DemandTelemetry();
    const now = at('2026-11-21');
    telemetry.recordToolInvocation({ tool: 'search', ok: true, now });
    expect(telemetry.snapshot().revision_diff_requests).toBe(0);
    expect(telemetry.snapshot().category_traversal_requests).toBe(0);
    telemetry.recordRevisionDiffRequested({ now });
    telemetry.recordCategoryTraversalRequested({ now });
    const snapshot = telemetry.snapshot();
    expect(snapshot.revision_diff_requests).toBe(1);
    expect(snapshot.category_traversal_requests).toBe(1);
    expect(snapshot.diff_search_sessions).toBe(0); // no session emitted a search + diff together
    expect(snapshot.category_traversal_sessions).toBe(0);
    telemetry.reset();
    expect(telemetry.snapshot().days_observed).toBe(0);
  });

  it('hashes an opaque session surrogate immediately and never persists it', () => {
    const telemetry = new DemandTelemetry();
    telemetry.recordToolInvocation({
      tool: 'search', ok: true, sessionKey: 'session-raw-alice-secret', now: at('2026-11-21'),
    });
    telemetry.recordRevisionDiffRequested({
      sessionKey: 'session-raw-alice-secret', now: at('2026-11-21'),
    });
    expect(telemetry.snapshot().diff_search_sessions).toBe(1);
    assertNoContent(JSON.stringify(telemetry.snapshot()));
  });

  it('exposes a stable, zero-valued placeholder snapshot', () => {
    const snapshot = emptyDemandSnapshot();
    expect(snapshot).toEqual({ ...snapshot, instrumented: false, days_observed: 0, daily: [] });
    expect(snapshot.days_observed).toBe(0);
    assertNoContent(JSON.stringify(snapshot));
  });
});

describe('WP6 — validation gate triggers', () => {
  it('DROPS both flagged tools for a fresh deployment with no observed demand', () => {
    const decision = evaluateDemandDecision({
      snapshot: new DemandTelemetry().snapshot(),
      now: at('2026-11-22'),
    });
    expect(decision.compare_revisions.decision).toBe('DROP');
    expect(decision.get_category_members.decision).toBe('DROP');
    expect(decision.no_observed_demand).toBe(true);
    expect(decision.evidence.days_observed).toBe(0);
    expect(decision.compare_revisions.measured.downstream_requests).toBe(0);
    expect(decision.get_category_members.measured.category_traversal_requests).toBe(0);
    assertNoContent(JSON.stringify(decision));
  });

  it('BUILDS compare_revisions on >= 3 downstream requests', () => {
    const telemetry = new DemandTelemetry();
    const now = at('2026-11-21');
    for (let i = 0; i < DEMAND_THRESHOLDS.downstreamRequests; i += 1) {
      telemetry.recordRevisionDiffRequested({ now });
    }
    const decision = evaluateDemandDecision({ snapshot: telemetry.snapshot(), now: at('2026-11-22') });
    expect(decision.compare_revisions.decision).toBe('BUILD');
    expect(decision.compare_revisions.downstream_trigger_passed).toBe(true);
    expect(decision.compare_revisions.measured.downstream_requests).toBe(3);
    expect(decision.compare_revisions.reason).toContain('>= 3');
    // The category trigger is independent and stays closed.
    expect(decision.get_category_members.decision).toBe('DROP');
  });

  it('BUILDS compare_revisions on >= 2% of search sessions over >= 7 consecutive days', () => {
    const telemetry = sevenDayDiffTelemetry(7);
    const snapshot = telemetry.snapshot();
    expect(snapshot.search_sessions).toBe(350);
    expect(snapshot.diff_search_sessions).toBe(14);
    expect(longestConsecutiveDiffDays(snapshot)).toBe(7);
    const decision = evaluateDemandDecision({ snapshot, now: at('2026-11-22') });
    expect(decision.compare_revisions.rate_trigger_passed).toBe(true);
    expect(decision.compare_revisions.decision).toBe('BUILD');
    expect(decision.compare_revisions.measured.diff_session_rate).toBeCloseTo(0.04);
  });

  it('DROPS when the rate is met on fewer than 7 consecutive days', () => {
    const telemetry = sevenDayDiffTelemetry(6);
    const snapshot = telemetry.snapshot();
    expect(longestConsecutiveDiffDays(snapshot)).toBe(6);
    const decision = evaluateDemandDecision({ snapshot, now: at('2026-11-22') });
    expect(decision.compare_revisions.downstream_trigger_passed).toBe(false);
    expect(decision.compare_revisions.rate_trigger_passed).toBe(false);
    expect(decision.compare_revisions.decision).toBe('DROP');
    expect(decision.compare_revisions.reason).toContain('consecutive_qualifying_days=6');
  });

  it('DROPS when the diff session rate is below 2%', () => {
    const telemetry = new DemandTelemetry();
    for (let index = 0; index < 7; index += 1) {
      const date = `2026-11-${String(10 + index).padStart(2, '0')}`;
      const now = at(date);
      for (let session = 0; session < 100; session += 1) {
        const key = `session-${date}-${session}`;
        telemetry.recordToolInvocation({ tool: 'search', ok: true, sessionKey: key, now });
      }
      // One of 100 sessions = 1%, below the 2% threshold.
      telemetry.recordSearchSessionDiffRequested({ sessionKey: `session-${date}-0`, now });
    }
    const decision = evaluateDemandDecision({ snapshot: telemetry.snapshot(), now: at('2026-11-22') });
    expect(decision.compare_revisions.measured.diff_session_rate).toBeCloseTo(0.01);
    expect(decision.compare_revisions.decision).toBe('DROP');
  });

  it('BUILDS get_category_members on measured traversal demand', () => {
    const telemetry = new DemandTelemetry();
    telemetry.recordCategoryTraversalRequested({ now: at('2026-11-21') });
    const decision = evaluateDemandDecision({ snapshot: telemetry.snapshot(), now: at('2026-11-22') });
    expect(decision.get_category_members.decision).toBe('BUILD');
    expect(decision.get_category_members.traversal_trigger_passed).toBe(true);
    expect(decision.get_category_members.named_request_trigger_passed).toBe(false);
  });

  it('BUILDS on a named request with requester + date but stores only a one-way reference', () => {
    const decision = evaluateDemandDecision({
      snapshot: new DemandTelemetry().snapshot(),
      namedRequests: [{ requester: 'A Named Requester', date: '2026-11-21' }],
      now: at('2026-11-22'),
    });
    expect(decision.get_category_members.decision).toBe('BUILD');
    expect(decision.get_category_members.named_request_trigger_passed).toBe(true);
    expect(decision.get_category_members.measured.named_request_date).toBe('2026-11-21');
    expect(decision.get_category_members.measured.named_request_requester_ref).toMatch(/^sha256:[0-9a-f]{12}$/);
    assertNoContent(JSON.stringify(decision));
  });

  it('ignores malformed named requests without recording their content', () => {
    const decision = evaluateDemandDecision({
      snapshot: new DemandTelemetry().snapshot(),
      namedRequests: [
        { requester: '   ', date: '2026-11-21' },
        { requester: 'A Named Requester', date: '21/11/2026' },
      ],
      now: at('2026-11-22'),
    });
    expect(decision.get_category_members.decision).toBe('DROP');
    expect(decision.get_category_members.measured.invalid_named_requests_ignored).toBe(2);
    expect(decision.get_category_members.measured.valid_named_requests).toBe(0);
    assertNoContent(JSON.stringify(decision));
  });
});

describe('WP6 — nightly report and persisted evidence', () => {
  function observation(tool: string): Observation {
    return {
      id: 'fixture', tool, toolClass: toolClass(tool), durationMs: 100, ok: true,
      singleCall: true, hasProvenance: true, isContent: true,
      errorActionable: true, upstream429: false,
    };
  }

  it('adds an optional demand block without changing the alert-snippet fields', () => {
    const observations = [
      ...Array.from({ length: 150 }, () => observation('search')),
      ...Array.from({ length: 150 }, () => observation('get_summary')),
    ];
    const report = buildNightlyReport({
      observations,
      metrics: computeMetrics(observations),
      peakConcurrency: 3,
      now: at('2026-11-21'),
    });
    expect(report.schema_version).toBe(1);
    expect(report.overallPass).toBe(true);
    expect(report.m4_429_count).toBe(0);
    expect(report.failures).toEqual([]);
    expect(report.demand_signals?.instrumented).toBe(false);
    assertNoContent(JSON.stringify(report));
  });

  it('embeds an explicit in-process snapshot unchanged', () => {
    const telemetry = new DemandTelemetry();
    telemetry.recordToolInvocation({ tool: 'search', ok: true, sessionKey: 'session-raw-alice', now: at('2026-11-21') });
    const snapshot: DemandSnapshot = telemetry.snapshot();
    const observations = [observation('search')];
    const report = buildNightlyReport({
      observations,
      metrics: computeMetrics(observations),
      peakConcurrency: 1,
      demandSignals: snapshot,
      now: at('2026-11-21'),
    });
    expect(report.demand_signals).toEqual(snapshot);
    assertNoContent(JSON.stringify(report));
  });

  it('writes deterministic, newline-terminated, count-only JSON', () => {
    mkdirSync(path.join(process.cwd(), 'reports'), { recursive: true });
    const dir = mkdtempSync(path.join(process.cwd(), 'reports', 'demand-fixture-'));
    try {
      const telemetry = new DemandTelemetry();
      telemetry.recordToolInvocation({ tool: 'search', ok: true, sessionKey: 'session-raw-alice', now: at('2026-11-21') });
      telemetry.recordRevisionDiffRequested({ now: at('2026-11-21') });
      const reportPath = path.join(dir, 'demand.json');
      const decisionPath = path.join(dir, 'demand-decision.json');
      expect(writeDemandReport(telemetry.snapshot(), reportPath)).toBe(reportPath);
      const decision = evaluateDemandDecision({ snapshot: telemetry.snapshot(), now: at('2026-11-22') });
      expect(writeDemandDecision(decision, decisionPath)).toBe(decisionPath);
      for (const target of [reportPath, decisionPath]) {
        expect(existsSync(target)).toBe(true);
        const text = readFileSync(target, 'utf8');
        expect(text.endsWith('\n')).toBe(true);
        assertNoContent(text);
      }
      expect(JSON.parse(readFileSync(decisionPath, 'utf8'))).toEqual(decision);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses the deterministic gitignored default paths', () => {
    expect(resolveDemandReportPath().endsWith(path.join('reports', 'demand.json'))).toBe(true);
    expect(resolveDemandDecisionPath().endsWith(path.join('reports', 'demand-decision.json'))).toBe(true);
  });
});

describe('WP6 — handler instrumentation (fixture only)', () => {
  const msw = createMswServer();
  const config = testConfig();
  const client = new WikimediaClient(config, { useDispatcher: false });

  beforeAll(() => {
    msw.listen({ onUnhandledRequest: 'bypass' });
    msw.use(
      http.get('*/w/api.php', () => HttpResponse.json({ query: { search: [] } })),
      http.get('*/api/rest_v1/page/summary/*', () => new HttpResponse(null, { status: 404 })),
    );
  });
  afterAll(() => { client.close(); msw.close(); });

  it('counts tool invocations and success/failure without reading arguments', async () => {
    const telemetry = new DemandTelemetry();
    const handlers = createHandlers(client, config, { demandTelemetry: telemetry });
    const searchResult = await handlers.search({ q: 'revision diff SecretTitle', limit: 1 });
    const summaryResult = await handlers.get_summary({ title: 'SecretTitle' });
    expect(searchResult.isError).not.toBe(true);
    expect(summaryResult.isError).toBe(true);
    const snapshot = telemetry.snapshot();
    expect(snapshot.tool_calls['search']).toEqual({ calls: 1, successes: 1, failures: 0 });
    expect(snapshot.tool_calls['get_summary']).toEqual({ calls: 1, successes: 0, failures: 1 });
    expect(snapshot.revision_diff_requests).toBe(0); // query text is never inspected
    expect(snapshot.category_traversal_requests).toBe(0);
    assertNoContent(JSON.stringify(snapshot));
  });
});
