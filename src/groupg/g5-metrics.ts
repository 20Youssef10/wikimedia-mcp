import { GROUP_G_TOOL_NAMES } from './schemas.js';

/**
 * Phase 5 independent load counters (contract 13 §5 / D14). These are
 * deliberately separate objects from the Phase 1 (M1–M6), Phase 2 (B-M3/B-M4)
 * and Phase 3 (CF-M3/CF-M4) gates. geo_search/get_tables observations are
 * accepted only here and are never forwarded to computeMetrics()/LiveGate.
 */

export type G5Observation = {
  tool: string;
  durationMs: number;
  ok: boolean;
  /** True for the network-bound Parsoid HTML fetch (excluded from G5-M3). */
  htmlFetch: boolean;
  upstream429: boolean;
};

export type G5Report = {
  m3: {
    perToolP95: Record<string, number>;
    samplesPerTool: Record<string, number>;
    pass: boolean;
  };
  m4: { count429: number; pass: boolean };
};

/** True when a tool belongs to Phase 5 and must be excluded from legacy gates. */
export function isPhase5Tool(tool: string): boolean {
  return (GROUP_G_TOOL_NAMES as readonly string[]).includes(tool);
}

/** Filter a mixed observation stream down to only non-Phase-5 tools. */
export function excludePhase5<T extends { tool: string }>(observations: readonly T[]): T[] {
  return observations.filter((item) => !isPhase5Tool(item.tool));
}

function nearestRankP95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil(0.95 * sorted.length)) - 1] ?? 0;
}

/**
 * Accumulate G5 observations and compute G5-M3 (per-tool p95 < 2 s, ≥150
 * samples, excluding HTML fetches) and G5-M4 (429 count == 0).
 */
export class G5Tracker {
  private readonly observations: G5Observation[] = [];
  private count429 = 0;

  record(observation: G5Observation): void {
    if (!isPhase5Tool(observation.tool)) {
      throw new Error(`G5Tracker rejects non-Phase-5 tool '${observation.tool}'`);
    }
    this.observations.push(observation);
    if (observation.upstream429) this.count429 += 1;
  }

  report(): G5Report {
    const perToolP95: Record<string, number> = {};
    const samplesPerTool: Record<string, number> = {};
    for (const name of GROUP_G_TOOL_NAMES) {
      const durations = this.observations
        .filter((item) => item.tool === name && item.ok && !item.htmlFetch)
        .map((item) => item.durationMs);
      samplesPerTool[name] = durations.length;
      perToolP95[name] = nearestRankP95(durations);
    }
    const m3pass = GROUP_G_TOOL_NAMES.every((name) =>
      (samplesPerTool[name] ?? 0) >= 150 && (perToolP95[name] ?? Infinity) < 2000);
    return {
      m3: { perToolP95, samplesPerTool, pass: m3pass },
      m4: { count429: this.count429, pass: this.count429 === 0 },
    };
  }

  get size(): number { return this.observations.length; }
}
