/**
 * Child → parent telemetry transport for the nightly live gate (WP19).
 *
 * The MCP server is spawned as a CHILD of the nightly runner, while
 * `reports/nightly-live.json` is built in the PARENT test process. Politeness
 * counters therefore never crossed the process boundary: the report had to
 * derive them from gate observations, leaving cache/coalescing/concurrency
 * counters at a permanent 0.
 *
 * This module moves a `PolitenessSnapshot` across that boundary through an
 * env-specified FILE path. The child writes atomically (temp file + rename)
 * periodically and at shutdown; the parent reads and strictly validates it
 * before building the report. Deliberate properties:
 *
 * - No HTTP endpoint is added. The MCP HTTP server is POST-only and returns
 *   405 for GET by design; this transport never touches its route table.
 * - The file carries counts/ratios only. Labels are restricted to a safe
 *   backend-label charset, and the parser rebuilds a fresh object from
 *   validated primitives, dropping every unknown key. No token, title,
 *   subject, header, URL, host or secret can be exported.
 * - A missing, truncated or malformed snapshot is never fatal: the parent
 *   falls back to the pre-existing observation-derived politeness block.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isRecord } from '../protocol/meta.js';
import type { PolitenessSnapshot } from './politeness.js';

/** Env var read by the server child AND (optionally) by the report builder. */
export const TELEMETRY_PATH_ENV = 'WMCP_TELEMETRY_SNAPSHOT_PATH';

/** Conventional name under the gitignored `reports/` directory. */
export const DEFAULT_TELEMETRY_SNAPSHOT_NAME = 'nightly-telemetry.json';

/** Periodic flush cadence in the child. Unref'd, so it never holds the process. */
export const TELEMETRY_WRITE_INTERVAL_MS = 1000;

/** Backend labels are fixed tokens such as `wikimedia-rest-v1`, not URLs. */
const SAFE_LABEL = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const MAX_LABELS = 256;

export type TelemetryReadOutcome = 'loaded' | 'missing' | 'invalid';

export type TelemetryReadResult = {
  outcome: TelemetryReadOutcome;
  snapshot?: PolitenessSnapshot;
};

/** Resolve the configured snapshot path (cwd-relative paths become absolute). */
export function resolveTelemetrySnapshotPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env[TELEMETRY_PATH_ENV]?.trim();
  if (configured === undefined || configured === '') return undefined;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function nonNegativeFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function unitRatio(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function needInt(value: unknown): number {
  const parsed = nonNegativeInt(value);
  if (parsed === undefined) throw new Error('invalid counter');
  return parsed;
}

function needFinite(value: unknown): number {
  const parsed = nonNegativeFinite(value);
  if (parsed === undefined) throw new Error('invalid duration');
  return parsed;
}

function needRatio(value: unknown): number {
  const parsed = unitRatio(value);
  if (parsed === undefined) throw new Error('invalid ratio');
  return parsed;
}

/**
 * Strictly parse a snapshot into a NEW object built only from validated
 * primitives. Unknown keys are ignored (never copied), so a tampered snapshot
 * cannot smuggle strings into the exported report. Returns undefined on any
 * shape/type/range violation; callers treat that as a transport failure.
 */
export function parseTelemetrySnapshot(raw: unknown): PolitenessSnapshot | undefined {
  try {
    if (!isRecord(raw)) return undefined;
    const rawByTool = raw['upstream_calls_by_tool'];
    if (!isRecord(rawByTool)) return undefined;
    const byTool: Record<string, number> = {};
    for (const [label, count] of Object.entries(rawByTool)) {
      if (!SAFE_LABEL.test(label)) return undefined;
      const value = nonNegativeInt(count);
      if (value === undefined) return undefined;
      byTool[label] = value;
    }
    if (Object.keys(byTool).length > MAX_LABELS) return undefined;
    const rawRetry = raw['retry_after'];
    if (!isRecord(rawRetry)) return undefined;

    return {
      upstream_calls_by_tool: byTool,
      upstream_calls_total: needInt(raw['upstream_calls_total']),
      cache_hits: needInt(raw['cache_hits']),
      cache_misses: needInt(raw['cache_misses']),
      cache_hit_rate: needRatio(raw['cache_hit_rate']),
      retry_after: {
        observed: needInt(rawRetry['observed']),
        rate_limited: needInt(rawRetry['rate_limited']),
        honored: needInt(rawRetry['honored']),
        proximity_ratio: needRatio(rawRetry['proximity_ratio']),
        max_observed_ms: needFinite(rawRetry['max_observed_ms']),
      },
      concurrency_reductions: needInt(raw['concurrency_reductions']),
      coalesced_calls: needInt(raw['coalesced_calls']),
      coalesced_waiters: needInt(raw['coalesced_waiters']),
    };
  } catch {
    return undefined;
  }
}

/** Parent-side read. Every failure mode maps to the fallback, never a throw. */
export function readTelemetrySnapshot(filePath: string | undefined): TelemetryReadResult {
  if (filePath === undefined || filePath === '') return { outcome: 'missing' };
  let text: string;
  try {
    if (!existsSync(filePath)) return { outcome: 'missing' };
    text = readFileSync(filePath, 'utf8');
  } catch {
    return { outcome: 'missing' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { outcome: 'invalid' };
  }
  const snapshot = parseTelemetrySnapshot(parsed);
  return snapshot === undefined ? { outcome: 'invalid' } : { outcome: 'loaded', snapshot };
}

export type TelemetryWriter = {
  readonly enabled: boolean;
  /** Flush the current snapshot now. Returns false if disabled or on any I/O error. */
  writeNow(): boolean;
  /** Stop the periodic flush; call after the final shutdown flush. */
  stop(): void;
};

const DISABLED_WRITER: TelemetryWriter = {
  enabled: false,
  writeNow: () => false,
  stop: () => {},
};

export type TelemetryWriterOptions = {
  /** Override the resolved path (tests). When omitted, `TELEMETRY_PATH_ENV` is used. */
  filePath?: string;
  /** Override the periodic cadence (tests). */
  intervalMs?: number;
  /** Override the environment inspected for `TELEMETRY_PATH_ENV` (tests). */
  env?: NodeJS.ProcessEnv;
};

/**
 * Child-side writer. A no-op unless a snapshot path is configured, so normal
 * stdio/HTTP servers never create files. Atomic rename prevents the parent
 * from ever reading a half-written JSON document.
 */
export function startTelemetrySnapshotWriter(
  source: () => PolitenessSnapshot,
  options: TelemetryWriterOptions = {},
): TelemetryWriter {
  const filePath = options.filePath ?? resolveTelemetrySnapshotPath(options.env ?? process.env);
  if (filePath === undefined) return DISABLED_WRITER;

  const intervalMs = options.intervalMs ?? TELEMETRY_WRITE_INTERVAL_MS;
  let stopped = false;

  const writeNow = (): boolean => {
    if (stopped) return false;
    let json: string;
    try {
      // Re-validate our own snapshot so the writer and reader agree on exactly
      // the same, leak-free shape.
      const validated = parseTelemetrySnapshot(source());
      if (validated === undefined) return false;
      json = `${JSON.stringify(validated, null, 2)}\n`;
    } catch {
      return false;
    }
    const tempPath = `${filePath}.${process.pid}.tmp`;
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(tempPath, json, 'utf8');
      renameSync(tempPath, filePath);
      return true;
    } catch {
      try { rmSync(tempPath, { force: true }); } catch { /* best effort */ }
      return false;
    }
  };

  const timer = setInterval(writeNow, intervalMs);
  timer.unref();

  return {
    enabled: true,
    writeNow,
    stop: (): void => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}
