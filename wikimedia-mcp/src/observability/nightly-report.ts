import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  nearestRankP95,
  type LiveGateReport,
  type Observation,
} from './live-gate.js';

/**
 * Durable, machine-readable evidence for every nightly live-gate run
 * (contract 09 §4). The console diagnostics remain for humans; this report is
 * the artefact CI/automation reads. It is written in a `finally` block by the
 * nightly test so a failed or interrupted run leaves evidence too.
 */
export const DEFAULT_NIGHTLY_REPORT_PATH = 'reports/nightly-live.json';

export type ToolSuccess = { ok: number; total: number };
export type ReportFailure = { id: string; detail: string };

export type NightlyReport = LiveGateReport & {
  schema_version: 1;
  /** ISO-8601 instant at which the report was persisted. */
  timestamp: string;
  /** Highest simultaneous in-flight jobs observed by the gate runner. */
  peak_concurrency: number;
  /** Measured calls (warm-up excluded), keyed by tool name. */
  per_tool_success: Record<string, ToolSuccess>;
  /** Nearest-rank p95 in ms of successful measured calls, keyed by tool name. */
  per_tool_p95_ms: Record<string, number>;
  /** Explicit alias of m4.count429 for consumers that want a flat field. */
  m4_429_count: number;
  failures: ReportFailure[];
};

export type BuildNightlyReportInput = {
  observations: readonly Observation[];
  metrics: LiveGateReport;
  peakConcurrency: number;
  failures?: readonly ReportFailure[];
  now?: () => number;
};

/** Pure builder: turn gate observations + metrics into a serialisable report. */
export function buildNightlyReport(input: BuildNightlyReportInput): NightlyReport {
  const { observations, metrics, peakConcurrency } = input;
  const measured = observations.filter((item) => item.warmup !== true);
  const perToolSuccess: Record<string, ToolSuccess> = {};
  const durationsByTool = new Map<string, number[]>();
  for (const item of measured) {
    const entry = perToolSuccess[item.tool] ?? { ok: 0, total: 0 };
    entry.total += 1;
    if (item.ok) entry.ok += 1;
    perToolSuccess[item.tool] = entry;
    if (item.ok) {
      const durations = durationsByTool.get(item.tool) ?? [];
      durations.push(item.durationMs);
      durationsByTool.set(item.tool, durations);
    }
  }
  const perToolP95: Record<string, number> = {};
  for (const [tool, durations] of [...durationsByTool.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    perToolP95[tool] = nearestRankP95(durations);
  }
  const now = input.now ?? (() => Date.now());
  return {
    schema_version: 1,
    timestamp: new Date(now()).toISOString(),
    total: metrics.total,
    warmup: metrics.warmup,
    measured: metrics.measured,
    peak_concurrency: peakConcurrency,
    per_tool_success: perToolSuccess,
    per_tool_p95_ms: perToolP95,
    m1: metrics.m1,
    m2: metrics.m2,
    m3: metrics.m3,
    m4: metrics.m4,
    m5: metrics.m5,
    m6: metrics.m6,
    m4_429_count: metrics.m4.count429,
    overallPass: metrics.overallPass,
    failures: (input.failures ?? []).map((failure) => ({ id: failure.id, detail: failure.detail })),
  };
}

/** Deterministic path, overridable for isolated test runs. */
export function resolveNightlyReportPath(): string {
  const configured = process.env['WMCP_NIGHTLY_REPORT_PATH'] ?? DEFAULT_NIGHTLY_REPORT_PATH;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

/** Create the parent directory if needed and persist pretty, newline-terminated JSON. */
export function writeNightlyReport(report: NightlyReport, filePath: string = resolveNightlyReportPath()): string {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return filePath;
}
