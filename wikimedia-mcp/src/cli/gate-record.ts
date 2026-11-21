import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  appendRecord, isDecision, isGateId, isValidEvidenceHash, readRecordChain,
  RECORD_CHAIN_LABEL, serialiseChain, verifyChain,
  type Decision, type GateId, type GateDecisionInput, type RecordChain, type RecordEntry,
} from './record-chain.js';

/**
 * WP2 — structured sign-off recorder. It records a human decision as a
 * tamper-evident, append-only chain that `gate status` can display and the
 * boot gate may inspect. It DOES NOT SIGN: it writes no personal name, date
 * chosen by the tool, signature or legal approval. The genuine signed artefact
 * remains owner-supplied (`write-security/signoff.md`).
 */

export const DEFAULT_RECORD_PATH = 'write-security/records/gate-decisions.json';

export type RecordWriteResult = {
  label: string;
  ok: true;
  entry: RecordEntry;
  chainHead: string;
  chainIntact: boolean;
  filePath: string;
};

export type RecordGateDecisionArgs = GateDecisionInput & {
  /** Path override for isolated tests; defaults to the package record file. */
  filePath?: string;
  baseDir?: string;
  /** Supply a chain directly (tests); otherwise read from filePath. */
  chain?: RecordChain;
};

export function recordGateDecision(args: RecordGateDecisionArgs): RecordWriteResult {
  if (!isDecision(args.decision)) throw new Error(`record: unsupported decision ${String(args.decision)}`);
  if (!isGateId(args.gateId)) throw new Error(`record: unsupported gate ${String(args.gateId)}`);
  if (!isValidEvidenceHash(args.evidenceHash)) throw new Error('record: evidence must be a sha256:<64 hex> hash');

  const baseDir = args.baseDir ?? process.cwd();
  const filePath = path.resolve(baseDir, args.filePath ?? DEFAULT_RECORD_PATH);
  const chain = args.chain ?? readRecordChain(filePath);
  const { chain: next, entry } = appendRecord(chain, {
    role: args.role,
    decision: args.decision,
    evidenceHash: args.evidenceHash,
    gateId: args.gateId,
    ...(args.signatoryRef !== undefined ? { signatoryRef: args.signatoryRef } : {}),
    ...(args.recordedAt !== undefined ? { recordedAt: args.recordedAt } : {}),
  });
  const chainIntact = verifyChain(next) === null;
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, serialiseChain(next), 'utf8');
  return {
    label: RECORD_CHAIN_LABEL,
    ok: true,
    entry,
    chainHead: next.head,
    chainIntact,
    filePath,
  };
}

/** Parse `wmcp gate record` flags without pulling in a CLI framework. */
export function parseRecordFlags(argv: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) break;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`record: missing value for --${key}`);
      flags[key] = value;
      index += 1;
    }
  }
  return flags;
}

export function recordFromFlags(flags: Record<string, string>): RecordGateDecisionArgs {
  const role = flags['role'];
  const decision = flags['decision'];
  const evidence = flags['evidence'];
  const gate = flags['gate'];
  if (role === undefined || decision === undefined || evidence === undefined || gate === undefined) {
    throw new Error('record: --role, --decision, --evidence and --gate are required');
  }
  if (!isDecision(decision)) throw new Error(`record: unsupported decision ${decision}`);
  if (!isGateId(gate)) throw new Error(`record: unsupported gate ${gate}`);
  return {
    role,
    decision: decision as Decision,
    evidenceHash: evidence,
    gateId: gate as GateId,
    ...(flags['signatory'] !== undefined ? { signatoryRef: flags['signatory'] } : {}),
    ...(flags['path'] !== undefined ? { filePath: flags['path'] } : {}),
  };
}
