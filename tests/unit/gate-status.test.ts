import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildGateStatus, FROZEN_BASELINE, GATE_IDS, renderGateStatus,
} from '../../src/cli/gate-status.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('WP1 — gate status CLI', () => {
  it('emits exactly one row for G1..G12, each with real evidence or NOT EVIDENCED', () => {
    const report = buildGateStatus({ baseDir: ROOT });
    expect(report.gates).toHaveLength(12);
    expect(report.gates.map((gate) => gate.id)).toEqual([...GATE_IDS]);
    for (const gate of report.gates) {
      expect(gate.evidence_paths.length).toBeGreaterThan(0);
      const anyReal = gate.evidence_paths.some(
        (entry) => entry === 'NOT EVIDENCED' || existsSync(path.resolve(ROOT, entry)),
      );
      expect(anyReal, `${gate.id} has on-disk evidence or explicit absence`).toBe(true);
    }
  });

  it('reports a gate with no on-disk evidence as NOT EVIDENCED', () => {
    const report = buildGateStatus({ baseDir: ROOT, exists: () => false });
    for (const gate of report.gates) expect(gate.evidence_paths).toEqual(['NOT EVIDENCED']);
  });

  it('prints G1 and G8 as UNSIGNED and never emits a name, sign-off date or APPROVED', () => {
    const report = buildGateStatus({ baseDir: ROOT, requireSigned: true });
    const unsigned = report.gates.filter((gate) => ['G1', 'G8'].includes(gate.id));
    expect(unsigned).toHaveLength(2);
    for (const gate of unsigned) {
      expect(gate.status).toBe('UNSIGNED');
      expect(gate.signed).toBe(false);
      const scan = JSON.stringify(gate);
      expect(scan).not.toMatch(/APPROVED/);
      expect(scan).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
      expect(scan).not.toMatch(/Signature:/);
    }
    const rendered = renderGateStatus(report);
    expect(rendered).toContain('G1');
    expect(rendered).toContain('G8');
    expect(rendered).not.toContain('APPROVED');
    // require-signed is informational in the builder; the entry exits non-zero.
    expect(report.require_signed).toBe(true);
    expect(report.gates.some((gate) => !gate.signed)).toBe(true);
  });

  it('records G6 as RECORDED (not signed) when a decision exists, never SIGNED', () => {
    const report = buildGateStatus({ baseDir: ROOT, recordedGates: new Set(['G6']) });
    const g6 = report.gates.find((gate) => gate.id === 'G6')!;
    expect(g6.status).toBe('RECORDED (not signed)');
    expect(g6.signed).toBe(false);
    expect(renderGateStatus(report)).not.toMatch(/G6\s+SIGNED\b/);
  });

  it('freezes the §2 baseline into pretty, newline-terminated machine-readable JSON', () => {
    const report = buildGateStatus({ baseDir: ROOT, now: () => Date.parse('2026-11-21T00:00:00Z') });
    const text = `${JSON.stringify(report, null, 2)}\n`;
    expect(text.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(text) as typeof report;
    expect(parsed.baseline).toEqual(FROZEN_BASELINE);
    expect(parsed.baseline.fixture_tests.passing).toBe(378);
    expect(parsed.baseline.fixture_tests.skipped).toBe(5);
    expect(parsed.baseline.independent_qa).toMatchObject({ stdio: '16/16', http: '10/10', defect_regression: '9/9' });
    expect(parsed.baseline.catalogue.tools).toBe(28);
    expect(parsed.baseline.read_only_profile).toMatchObject({ tools: 23, assertions: '5/5' });
    expect(parsed.generated_at).toBe('2026-11-21T00:00:00Z');
  });
});
