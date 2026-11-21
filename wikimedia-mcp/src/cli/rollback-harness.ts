import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ToolResponse } from '../types.js';
import type { AuditExport } from '../write/audit.js';
import type { WriteToolName } from '../write/constants.js';

/**
 * WP5 — testwiki-only rollback RECORDING harness. The human performs the
 * write; this tool records evidence. It NEVER performs a real wiki write: the
 * CLI entry has no live runtime and emits a plan skeleton only. Full evidence
 * (exported events + anchors) is produced by `runRollbackHarness` when a
 * caller injects fixture handlers and a verified audit export.
 *
 * en-GB spelling. Records evidence; does not sign and does not execute writes.
 */

export const TESTWIKI_PROJECT = 'testwiki';
export const HARNESS_LABEL = 'HUMAN-EXECUTED — NO REAL WIKI WRITE PERFORMED BY THIS TOOL';
export const NOT_EVIDENCED = 'NOT EVIDENCED — human execution required';

export type HarnessMode = 'dry-run' | 'execute';

export type HarnessRequest = {
  project: string;
  tool: WriteToolName;
  args: Record<string, unknown>;
  mode: HarnessMode;
  operatorRef?: string;
  witnessRef?: string;
  iHaveSignoff?: boolean;
};

export type HarnessInvocation = {
  raw: Record<string, unknown>;
  token: string;
  requestState?: string;
  inputResponses?: Array<{ id: string; value: unknown }>;
};

export type HarnessDeps = {
  invoke: (tool: WriteToolName, args: Record<string, unknown>, invocation: HarnessInvocation) => Promise<ToolResponse>;
  exportChain?: () => AuditExport;
  verifyChain?: (payload: AuditExport) => boolean;
  licenceSignedOff?: boolean;
  now?: () => number;
};

export type RollbackEvidence = {
  schema_version: 1;
  harness: string;
  generated_at: string;
  project: 'testwiki';
  tool: WriteToolName;
  mode: HarnessMode;
  preview_result_type: string | null;
  result: Record<string, unknown> | null;
  executed: boolean;
  would_change: boolean;
  chain: AuditExport | string;
  chain_verified: boolean;
  fail_closed_checks: {
    testwiki_only: boolean;
    operator_and_witness_refs_present: boolean;
    upload_licence_not_signed_off: boolean;
  };
  operator_ref: string | null;
  witness_ref: string | null;
};

/** Reject any project other than testwiki without making a network call. */
export function guardProject(project: string): void {
  if (project !== TESTWIKI_PROJECT) {
    throw new Error(`rollback harness: project '${project}' rejected; only ${TESTWIKI_PROJECT} is permitted`);
  }
}

/** `--execute` is blocked unless the operator asserts explicit sign-off and refs. */
export function guardExecuteAuthorisation(request: HarnessRequest): void {
  if (request.mode !== 'execute') return;
  const refsPresent = typeof request.operatorRef === 'string' && request.operatorRef.length > 0
    && typeof request.witnessRef === 'string' && request.witnessRef.length > 0;
  if (request.iHaveSignoff !== true || !refsPresent) {
    throw new Error('rollback harness: --execute requires --i-have-signoff, --operator and --witness');
  }
}

function resultView(response: ToolResponse): Record<string, unknown> {
  const structured = response.structuredContent;
  if (structured !== null && typeof structured === 'object') return structured as Record<string, unknown>;
  return {};
}

/** Pure evidence artefact builder. */
export function buildRollbackEvidence(input: {
  request: HarnessRequest;
  preview: ToolResponse | null;
  result: ToolResponse | null;
  chain: AuditExport | string;
  chainVerified: boolean;
  licenceSignedOff: boolean;
  now?: () => number;
}): RollbackEvidence {
  const { request } = input;
  const result = input.result === null ? null : resultView(input.result);
  const preview = input.preview === null ? null : resultView(input.preview);
  return {
    schema_version: 1,
    harness: HARNESS_LABEL,
    generated_at: new Date((input.now ?? (() => Date.now()))()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    project: TESTWIKI_PROJECT,
    tool: request.tool,
    mode: request.mode,
    preview_result_type: preview === null ? null : (typeof preview['resultType'] === 'string' ? preview['resultType'] : null),
    result,
    executed: result === null ? false : result['executed'] === true,
    would_change: result === null ? false : result['would_change'] === true,
    chain: input.chain,
    chain_verified: input.chainVerified,
    fail_closed_checks: {
      testwiki_only: true,
      operator_and_witness_refs_present: typeof request.operatorRef === 'string'
        && typeof request.witnessRef === 'string'
        && request.operatorRef.length > 0
        && request.witnessRef.length > 0,
      upload_licence_not_signed_off: request.tool === 'upload_file' ? !input.licenceSignedOff : true,
    },
    operator_ref: request.operatorRef ?? null,
    witness_ref: request.witnessRef ?? null,
  };
}

/** Orchestrate preview -> (dry-run) confirm against injected handlers only. */
export async function runRollbackHarness(request: HarnessRequest, deps: HarnessDeps): Promise<RollbackEvidence> {
  guardProject(request.project);
  guardExecuteAuthorisation(request);
  const args = request.mode === 'dry-run' ? { ...request.args, dry_run: true } : { ...request.args };
  const preview = await deps.invoke(request.tool, args, { raw: args, token: '' });
  const previewState = resultView(preview)['requestState'];
  const state = typeof previewState === 'string' ? previewState : undefined;
  const result = await deps.invoke(request.tool, args, {
    raw: args,
    token: '',
    ...(state !== undefined ? { requestState: state } : {}),
    inputResponses: [{ id: 'confirm_write', value: true }],
  });
  const chain = deps.exportChain?.() ?? NOT_EVIDENCED;
  const chainVerified = typeof chain === 'string' ? false : (deps.verifyChain?.(chain) ?? false);
  return buildRollbackEvidence({
    request,
    preview,
    result,
    chain,
    chainVerified,
    licenceSignedOff: deps.licenceSignedOff === true,
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });
}

/** Pretty, newline-terminated evidence artefact. */
export function writeRollbackEvidence(evidence: RollbackEvidence, filePath: string): string {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return filePath;
}

export type HarnessFlags = Record<string, string | boolean>;

export function parseHarnessFlags(argv: readonly string[]): HarnessFlags {
  const flags: HarnessFlags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) break;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'execute' || key === 'i-have-signoff' || key === 'dry-run') {
      flags[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`rollback harness: missing value for --${key}`);
    flags[key] = value;
    index += 1;
  }
  return flags;
}

export type HarnessPlan = {
  schema_version: 1;
  harness: string;
  project: 'testwiki';
  tool: string;
  mode: HarnessMode;
  executed: false;
  chain_export: string;
  guards_passed: true;
  operator_ref: string | null;
  witness_ref: string | null;
};

/**
 * CLI posture: no live runtime, no network, no write. Validates the guards
 * and emits a plan skeleton; the human-executed event fills the blanks later.
 */
export function buildHarnessPlan(flags: HarnessFlags): HarnessPlan {
  const project = typeof flags['project'] === 'string' ? flags['project'] : TESTWIKI_PROJECT;
  guardProject(project);
  const tool = typeof flags['tool'] === 'string' ? flags['tool'] : 'edit_page';
  const mode: HarnessMode = flags['execute'] === true ? 'execute' : 'dry-run';
  const request: HarnessRequest = {
    project,
    tool: tool as WriteToolName,
    args: {},
    mode,
    ...(typeof flags['operator'] === 'string' ? { operatorRef: flags['operator'] } : {}),
    ...(typeof flags['witness'] === 'string' ? { witnessRef: flags['witness'] } : {}),
    ...(flags['i-have-signoff'] === true ? { iHaveSignoff: true } : {}),
  };
  guardExecuteAuthorisation(request);
  return {
    schema_version: 1,
    harness: HARNESS_LABEL,
    project: TESTWIKI_PROJECT,
    tool,
    mode,
    executed: false,
    chain_export: NOT_EVIDENCED,
    guards_passed: true,
    operator_ref: request.operatorRef ?? null,
    witness_ref: request.witnessRef ?? null,
  };
}
