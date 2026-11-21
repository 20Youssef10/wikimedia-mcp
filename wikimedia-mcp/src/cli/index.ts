import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WriteToolName } from '../write/constants.js';
import {
  buildGateStatus, GATE_IDS, renderGateStatus, type GateId,
} from './gate-status.js';
import { DEFAULT_RECORD_PATH, parseRecordFlags, recordFromFlags, recordGateDecision } from './gate-record.js';
import { isGateId, readRecordChain, RECORD_CHAIN_LABEL } from './record-chain.js';
import {
  buildHarnessPlan, HARNESS_LABEL, parseHarnessFlags, writeRollbackEvidence,
  type HarnessPlan,
} from './rollback-harness.js';
import { runConfigCli } from './config-generator.js';

/**
 * Unified `wmcp` subcommand dispatcher and thin CLI entries. All commands are
 * informational/recording only; none registers an MCP tool or signs a gate.
 */

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function recordedGates(): Set<GateId> {
  const chain = readRecordChain(path.resolve(PACKAGE_ROOT, DEFAULT_RECORD_PATH));
  const ids = new Set<GateId>();
  for (const entry of chain.records) {
    if (isGateId(entry.gate_id)) ids.add(entry.gate_id);
  }
  return ids;
}

export function runGateStatus(argv: readonly string[]): number {
  const requireSigned = argv.includes('--require-signed');
  const report = buildGateStatus({
    baseDir: PACKAGE_ROOT,
    requireSigned,
    recordedGates: recordedGates(),
  });
  console.log(renderGateStatus(report));
  const outPath = path.resolve(PACKAGE_ROOT, 'reports', 'gate-status.json');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(PACKAGE_ROOT, outPath)}`);
  if (requireSigned && report.gates.some((gate) => !gate.signed)) {
    console.error('GATE STATUS: --require-signed requested but unsigned gates remain (informational default).');
    return 1;
  }
  return 0;
}

export function runGateRecord(argv: readonly string[]): number {
  try {
    const args = recordFromFlags(parseRecordFlags(argv));
    const result = recordGateDecision({ ...args, baseDir: PACKAGE_ROOT });
    console.log(result.label);
    console.log(JSON.stringify({
      ok: result.ok,
      gate: result.entry.gate_id,
      role: result.entry.role,
      decision: result.entry.decision,
      seq: result.entry.seq,
      chain_head: result.chainHead,
      chain_intact: result.chainIntact,
      file: path.relative(PACKAGE_ROOT, result.filePath),
    }, null, 2));
    return 0;
  } catch (error) {
    console.error(`gate record: ${error instanceof Error ? error.message : String(error)}`);
    console.error(RECORD_CHAIN_LABEL);
    return 1;
  }
}

export function runRollbackCli(argv: readonly string[]): number {
  try {
    const plan: HarnessPlan = buildHarnessPlan(parseHarnessFlags(argv));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.resolve(PACKAGE_ROOT, 'write-security', 'evidence', `rollback-plan-${stamp}.json`);
    writeRollbackEvidence({
      schema_version: 1,
      harness: HARNESS_LABEL,
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      project: plan.project,
      tool: plan.tool as WriteToolName,
      mode: plan.mode,
      preview_result_type: null,
      result: null,
      executed: false,
      would_change: false,
      chain: 'NOT EVIDENCED — human execution required',
      chain_verified: false,
      fail_closed_checks: {
        testwiki_only: true,
        operator_and_witness_refs_present: plan.operator_ref !== null && plan.witness_ref !== null,
        upload_licence_not_signed_off: true,
      },
      operator_ref: plan.operator_ref,
      witness_ref: plan.witness_ref,
    }, outPath);
    console.log(HARNESS_LABEL);
    console.log(JSON.stringify(plan, null, 2));
    console.log(`Wrote ${path.relative(PACKAGE_ROOT, outPath)}`);
    return 0;
  } catch (error) {
    console.error(`rollback harness: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

export function runCli(argv: readonly string[]): number {
  const [group, command, ...rest] = argv;
  if (group === 'gate' && command === 'status') return runGateStatus(rest);
  if (group === 'gate' && command === 'record') return runGateRecord(rest);
  if (group === 'rollback-harness') return runRollbackCli(rest);
  if (group === 'config') return runConfigCli(command === undefined ? rest : [command, ...rest]);
  console.log('Usage: wmcp gate status [--require-signed] | wmcp gate record ... | wmcp rollback-harness [--dry-run|--execute ...] | wmcp config <host> [--url URL] [--out FILE] | wmcp config --list');
  console.log(`Gates: ${GATE_IDS.join(', ')}`);
  return 2;
}
