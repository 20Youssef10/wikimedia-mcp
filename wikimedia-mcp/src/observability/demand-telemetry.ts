/**
 * WP6 — Demand telemetry and validation gate.
 *
 * INVARIANT: this module records COUNTS ONLY. It never sees, stores or exports
 * a title, query text, snippet, token, raw subject, credential or any other
 * user content. Deliberate demand signals (`revision_diff_requested` and
 * `category_traversal_requested`) are incremented only by explicit,
 * non-content-based calls; search query strings are never inspected to infer
 * demand. A session surrogate, when supplied, is hashed immediately and kept
 * only in memory: no surrogate is ever persisted in a report.
 *
 * The module emits a binary BUILD/DROP decision for the two flagged Tranche 2
 * tools using the exact triggers in report 18 §6 / report 19 WP6:
 *   - compare_revisions: BUILD iff >= 3 downstream revision-diff requests OR
 *     (>= 2% of instrumented search sessions request revision diffs on each
 *     of >= 7 consecutive calendar days). Otherwise DROP.
 *   - get_category_members: BUILD iff measured category traversal demand OR a
 *     named user request carrying a requester and a date. Otherwise DROP.
 * A named request is human-supplied input to the decision function; only a
 * one-way requester reference and its date may appear in the decision JSON.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_DEMAND_REPORT_PATH = 'reports/demand.json';
export const DEFAULT_DEMAND_DECISION_PATH = 'reports/demand-decision.json';

export const DEMAND_THRESHOLDS = {
  downstreamRequests: 3,
  diffSessionRate: 0.02,
  consecutiveDays: 7,
} as const;

export type ToolDemandCounts = {
  calls: number;
  successes: number;
  failures: number;
};

/** One UTC calendar day of counts. Dates are not user data. */
export type DemandDaily = {
  date: string;
  tool_calls: number;
  tool_successes: number;
  tool_failures: number;
  /** Day-scoped sessions with exactly one tool invocation (resolution signal). */
  single_call_sessions: number;
  sessions_observed: number;
  search_invocations: number;
  /** Day-scoped sessions with >= 1 search invocation. */
  search_sessions: number;
  revision_diff_requests: number;
  /** Search sessions in this day that also emitted a revision-diff signal. */
  diff_search_sessions: number;
  category_traversal_requests: number;
  category_traversal_sessions: number;
};

export type DemandSnapshot = {
  schema_version: 1;
  /**
   * false for a placeholder assembled in a process that cannot see the
   * server's in-memory counters (e.g. the nightly runner). Zero then means
   * "not instrumented here", never "no demand".
   */
  instrumented: boolean;
  first_observed_date: string | null;
  last_observed_date: string | null;
  days_observed: number;
  tool_calls: Record<string, ToolDemandCounts>;
  single_call_sessions: number;
  sessions_observed: number;
  search_invocations: number;
  search_sessions: number;
  revision_diff_requests: number;
  diff_search_sessions: number;
  category_traversal_requests: number;
  category_traversal_sessions: number;
  daily: DemandDaily[];
};

/** Human-supplied demand evidence. Never serialised verbatim. */
export type NamedDemandRequest = {
  requester: string;
  /** ISO calendar date, YYYY-MM-DD. */
  date: string;
};

export type DemandDecisionName = 'compare_revisions' | 'get_category_members';
export type DemandVerdict = 'BUILD' | 'DROP';

export type DemandDecision = {
  schema_version: 1;
  /** UTC calendar date on which the decision was evaluated. */
  evaluated_at: string;
  evidence: {
    telemetry_instrumented: boolean;
    first_observed_date: string | null;
    last_observed_date: string | null;
    days_observed: number;
    note: string;
  };
  compare_revisions: {
    decision: DemandVerdict;
    reason: string;
    thresholds: {
      downstream_requests: number;
      diff_session_rate: number;
      consecutive_qualifying_days: number;
    };
    measured: {
      downstream_requests: number;
      search_sessions: number;
      diff_search_sessions: number;
      diff_session_rate: number;
      consecutive_qualifying_days: number;
    };
    downstream_trigger_passed: boolean;
    rate_trigger_passed: boolean;
  };
  get_category_members: {
    decision: DemandVerdict;
    reason: string;
    measured: {
      category_traversal_requests: number;
      category_traversal_sessions: number;
      valid_named_requests: number;
      named_request_date: string | null;
      named_request_requester_ref: string | null;
      invalid_named_requests_ignored: number;
    };
    traversal_trigger_passed: boolean;
    named_request_trigger_passed: boolean;
  };
  /** True when this decision was evaluated without any observed traffic. */
  no_observed_demand: boolean;
};

type SessionState = {
  calls: number;
  searchCalls: number;
  diffRequests: number;
  categoryRequests: number;
};

type DayState = {
  date: string;
  toolCalls: number;
  toolSuccesses: number;
  toolFailures: number;
  searchInvocations: number;
  diffRequests: number;
  categoryRequests: number;
};

function utcDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** One-way, non-reversible reference. Only the prefix is retained in memory. */
function surrogate(key: string): string | null {
  if (typeof key !== 'string' || key.length === 0) return null;
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function requesterRef(requester: string): string {
  return `sha256:${createHash('sha256').update(requester).digest('hex').slice(0, 12)}`;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function newDay(date: string): DayState {
  return {
    date, toolCalls: 0, toolSuccesses: 0, toolFailures: 0,
    searchInvocations: 0, diffRequests: 0, categoryRequests: 0,
  };
}

function newSession(): SessionState {
  return { calls: 0, searchCalls: 0, diffRequests: 0, categoryRequests: 0 };
}

/** Stable empty snapshot for a process that cannot see server counters. */
export function emptyDemandSnapshot(): DemandSnapshot {
  return {
    schema_version: 1,
    instrumented: false,
    first_observed_date: null,
    last_observed_date: null,
    days_observed: 0,
    tool_calls: {},
    single_call_sessions: 0,
    sessions_observed: 0,
    search_invocations: 0,
    search_sessions: 0,
    revision_diff_requests: 0,
    diff_search_sessions: 0,
    category_traversal_requests: 0,
    category_traversal_sessions: 0,
    daily: [],
  };
}

/**
 * In-process recorder. One instance per server/fixture; no process-wide state.
 * `sessionKey` is an opaque, caller-supplied surrogate; it is hashed on entry
 * and never leaves this object. When it is absent the invocation is counted at
 * tool level only, and no session-level claim is made.
 */
export class DemandTelemetry {
  private readonly days = new Map<string, DayState>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly toolCalls = new Map<string, ToolDemandCounts>();

  private day(date: string): DayState {
    let entry = this.days.get(date);
    if (entry === undefined) {
      entry = newDay(date);
      this.days.set(date, entry);
    }
    return entry;
  }

  /** Session buckets are day-scoped so a midnight crossover cannot inflate a rate. */
  private session(date: string, key: string | undefined): SessionState | null {
    const hash = key === undefined ? null : surrogate(key);
    if (hash === null) return null;
    const bucketKey = `${date}:${hash}`;
    let entry = this.sessions.get(bucketKey);
    if (entry === undefined) {
      entry = newSession();
      this.sessions.set(bucketKey, entry);
    }
    return entry;
  }

  /**
   * Record one tool invocation. `tool` must be a registered tool name, never
   * an argument, title, query string or error message.
   */
  recordToolInvocation(input: {
    tool: string;
    ok: boolean;
    sessionKey?: string;
    now?: () => number;
  }): void {
    const tool = typeof input.tool === 'string' && input.tool.length > 0 ? input.tool : 'unknown';
    const counts = this.toolCalls.get(tool) ?? { calls: 0, successes: 0, failures: 0 };
    counts.calls += 1;
    if (input.ok) counts.successes += 1;
    else counts.failures += 1;
    this.toolCalls.set(tool, counts);

    const date = utcDate((input.now ?? Date.now)());
    const day = this.day(date);
    day.toolCalls += 1;
    if (input.ok) day.toolSuccesses += 1;
    else day.toolFailures += 1;

    const session = this.session(date, input.sessionKey);
    if (session !== null) {
      session.calls += 1;
      if (tool === 'search') {
        day.searchInvocations += 1;
        session.searchCalls += 1;
      }
    }
  }

  /** Explicit, non-content-derived demand for a revision diff (WP7). */
  recordRevisionDiffRequested(input: { sessionKey?: string; now?: () => number } = {}): void {
    const date = utcDate((input.now ?? Date.now)());
    this.day(date).diffRequests += 1;
    const session = this.session(date, input.sessionKey);
    if (session !== null) session.diffRequests += 1;
  }

  /**
   * Explicit, non-content-based diff intent observed inside a search session
   * (e.g. a client capability flag). This is deliberately distinct from a
   * downstream revision-diff request: it feeds the ">= 2% of search sessions"
   * trigger only, so the two report-18 triggers stay independently testable.
   */
  recordSearchSessionDiffRequested(input: { sessionKey: string; now?: () => number }): void {
    const date = utcDate((input.now ?? Date.now)());
    this.day(date); // mark the day observed even when no tool call was made
    const session = this.session(date, input.sessionKey);
    if (session !== null) session.diffRequests += 1;
  }

  /** Explicit, non-content-derived category traversal demand (WP8). */
  recordCategoryTraversalRequested(input: { sessionKey?: string; now?: () => number } = {}): void {
    const date = utcDate((input.now ?? Date.now)());
    this.day(date).categoryRequests += 1;
    const session = this.session(date, input.sessionKey);
    if (session !== null) session.categoryRequests += 1;
  }

  /** Count-only, deterministic snapshot. Safe to persist and archive. */
  snapshot(): DemandSnapshot {
    const daily: DemandDaily[] = [];
    for (const day of [...this.days.values()].sort((a, b) => a.date.localeCompare(b.date))) {
      const prefix = `${day.date}:`;
      let singleCall = 0;
      let sessionsObserved = 0;
      let searchSessions = 0;
      let diffSearchSessions = 0;
      let categorySessions = 0;
      for (const [key, state] of this.sessions) {
        if (!key.startsWith(prefix)) continue;
        sessionsObserved += 1;
        if (state.calls === 1) singleCall += 1;
        if (state.searchCalls > 0) searchSessions += 1;
        if (state.searchCalls > 0 && state.diffRequests > 0) diffSearchSessions += 1;
        if (state.categoryRequests > 0) categorySessions += 1;
      }
      daily.push({
        date: day.date,
        tool_calls: day.toolCalls,
        tool_successes: day.toolSuccesses,
        tool_failures: day.toolFailures,
        single_call_sessions: singleCall,
        sessions_observed: sessionsObserved,
        search_invocations: day.searchInvocations,
        search_sessions: searchSessions,
        revision_diff_requests: day.diffRequests,
        diff_search_sessions: diffSearchSessions,
        category_traversal_requests: day.categoryRequests,
        category_traversal_sessions: categorySessions,
      });
    }
    const toolCalls: Record<string, ToolDemandCounts> = {};
    for (const [tool, counts] of [...this.toolCalls.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      toolCalls[tool] = { ...counts };
    }
    const sum = (pick: (entry: DemandDaily) => number): number => daily.reduce((total, entry) => total + pick(entry), 0);
    return {
      schema_version: 1,
      instrumented: true,
      first_observed_date: daily[0]?.date ?? null,
      last_observed_date: daily.at(-1)?.date ?? null,
      days_observed: daily.length,
      tool_calls: toolCalls,
      single_call_sessions: sum((entry) => entry.single_call_sessions),
      sessions_observed: sum((entry) => entry.sessions_observed),
      search_invocations: sum((entry) => entry.search_invocations),
      search_sessions: sum((entry) => entry.search_sessions),
      revision_diff_requests: sum((entry) => entry.revision_diff_requests),
      diff_search_sessions: sum((entry) => entry.diff_search_sessions),
      category_traversal_requests: sum((entry) => entry.category_traversal_requests),
      category_traversal_sessions: sum((entry) => entry.category_traversal_sessions),
      daily,
    };
  }

  reset(): void {
    this.days.clear();
    this.sessions.clear();
    this.toolCalls.clear();
  }
}

/** Longest run of contiguous UTC days where the diff-rate trigger is met. */
export function longestConsecutiveDiffDays(snapshot: DemandSnapshot): number {
  const qualifying = snapshot.daily
    .filter((day) => day.search_sessions > 0 && ratio(day.diff_search_sessions, day.search_sessions) >= DEMAND_THRESHOLDS.diffSessionRate)
    .map((day) => day.date)
    .sort();
  let best = 0;
  let current = 0;
  let previous: number | null = null;
  for (const date of qualifying) {
    const value = dayNumber(date);
    if (Number.isFinite(value) && previous !== null && value - previous === 86_400_000) current += 1;
    else current = 1;
    previous = value;
    best = Math.max(best, current);
  }
  return best;
}

function isValidNamedRequest(request: NamedDemandRequest): boolean {
  if (typeof request?.requester !== 'string' || request.requester.trim().length === 0) return false;
  if (typeof request?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(request.date)) return false;
  const parsed = Date.parse(`${request.date}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === request.date;
}

/**
 * Pure binary decision. No content is read and no user-supplied name is
 * copied into the result; a named request is reduced to a hash reference.
 */
export function evaluateDemandDecision(input: {
  snapshot: DemandSnapshot;
  namedRequests?: readonly NamedDemandRequest[];
  now?: () => number;
}): DemandDecision {
  const snapshot = input.snapshot;
  const now = input.now ?? Date.now;
  const evaluatedAt = utcDate(now());

  const downstreamRequests = snapshot.revision_diff_requests;
  const searchSessions = snapshot.search_sessions;
  const diffSearchSessions = snapshot.diff_search_sessions;
  const diffSessionRate = ratio(diffSearchSessions, searchSessions);
  const consecutiveDays = longestConsecutiveDiffDays(snapshot);
  const downstreamTrigger = downstreamRequests >= DEMAND_THRESHOLDS.downstreamRequests;
  const rateTrigger = diffSessionRate >= DEMAND_THRESHOLDS.diffSessionRate
    && consecutiveDays >= DEMAND_THRESHOLDS.consecutiveDays;
  const compareBuild = downstreamTrigger || rateTrigger;
  const compareReason = downstreamTrigger
    ? `downstream_requests=${downstreamRequests} >= ${DEMAND_THRESHOLDS.downstreamRequests}`
    : rateTrigger
      ? `diff_session_rate=${diffSessionRate} >= ${DEMAND_THRESHOLDS.diffSessionRate} on ${consecutiveDays} consecutive days`
      : `downstream_requests=${downstreamRequests} < ${DEMAND_THRESHOLDS.downstreamRequests}; `
        + `diff_session_rate=${diffSessionRate} < ${DEMAND_THRESHOLDS.diffSessionRate} or `
        + `consecutive_qualifying_days=${consecutiveDays} < ${DEMAND_THRESHOLDS.consecutiveDays}`;

  const allNamed = input.namedRequests ?? [];
  const validNamed = allNamed.filter(isValidNamedRequest);
  const noObserved = snapshot.days_observed === 0
    && downstreamRequests === 0 && snapshot.category_traversal_requests === 0 && validNamed.length === 0;
  const latestNamed = [...validNamed].sort((a, b) => b.date.localeCompare(a.date))[0];
  const traversalRequests = snapshot.category_traversal_requests;
  const traversalTrigger = traversalRequests > 0;
  const namedTrigger = validNamed.length > 0;
  const categoryBuild = traversalTrigger || namedTrigger;
  const categoryReason = traversalTrigger
    ? `category_traversal_requests=${traversalRequests} > 0`
    : namedTrigger
      ? `named_request_present with requester reference and date ${latestNamed?.date ?? ''}`
      : 'category_traversal_requests=0 and no valid named request with requester + date';

  const baseNote = 'Counts only; no title, query text, token, raw subject or session surrogate is recorded. '
    + 'A named request is reduced to a one-way requester reference.';
  const note = noObserved
    ? `${baseNote} No instrumented demand has been observed: this is a fresh local deployment with no `
      + 'external users. Nightly gate self-test calls are deliberately not counted as demand.'
    : baseNote;

  return {
    schema_version: 1,
    evaluated_at: evaluatedAt,
    evidence: {
      telemetry_instrumented: snapshot.instrumented,
      first_observed_date: snapshot.first_observed_date,
      last_observed_date: snapshot.last_observed_date,
      days_observed: snapshot.days_observed,
      note,
    },
    compare_revisions: {
      decision: compareBuild ? 'BUILD' : 'DROP',
      reason: compareReason,
      thresholds: {
        downstream_requests: DEMAND_THRESHOLDS.downstreamRequests,
        diff_session_rate: DEMAND_THRESHOLDS.diffSessionRate,
        consecutive_qualifying_days: DEMAND_THRESHOLDS.consecutiveDays,
      },
      measured: {
        downstream_requests: downstreamRequests,
        search_sessions: searchSessions,
        diff_search_sessions: diffSearchSessions,
        diff_session_rate: diffSessionRate,
        consecutive_qualifying_days: consecutiveDays,
      },
      downstream_trigger_passed: downstreamTrigger,
      rate_trigger_passed: rateTrigger,
    },
    get_category_members: {
      decision: categoryBuild ? 'BUILD' : 'DROP',
      reason: categoryReason,
      measured: {
        category_traversal_requests: traversalRequests,
        category_traversal_sessions: snapshot.category_traversal_sessions,
        valid_named_requests: validNamed.length,
        named_request_date: latestNamed?.date ?? null,
        named_request_requester_ref: latestNamed === undefined ? null : requesterRef(latestNamed.requester),
        invalid_named_requests_ignored: allNamed.length - validNamed.length,
      },
      traversal_trigger_passed: traversalTrigger,
      named_request_trigger_passed: namedTrigger,
    },
    no_observed_demand: noObserved,
  };
}

function resolvePath(envKey: string, fallback: string): string {
  const configured = process.env[envKey] ?? fallback;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

/** Deterministic, gitignored report path (overridable for isolated tests). */
export function resolveDemandReportPath(): string {
  return resolvePath('WMCP_DEMAND_REPORT_PATH', DEFAULT_DEMAND_REPORT_PATH);
}

/** Deterministic, gitignored decision path (overridable for isolated tests). */
export function resolveDemandDecisionPath(): string {
  return resolvePath('WMCP_DEMAND_DECISION_PATH', DEFAULT_DEMAND_DECISION_PATH);
}

function persist(value: unknown, filePath: string): string {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

export function writeDemandReport(
  snapshot: DemandSnapshot,
  filePath: string = resolveDemandReportPath(),
): string {
  return persist(snapshot, filePath);
}

export function writeDemandDecision(
  decision: DemandDecision,
  filePath: string = resolveDemandDecisionPath(),
): string {
  return persist(decision, filePath);
}
