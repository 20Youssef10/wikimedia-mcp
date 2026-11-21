import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Gate-first spine (WP1). Pure status builder for G1..G12. It reports what the
 * repository actually evidences; it never signs, approves or fabricates a
 * human decision. Human-owned gates (G1/AC-155 and G8) are always reported as
 * UNSIGNED until a genuine signature is supplied by their owners.
 *
 * en-GB spelling throughout. Records decisions; does not sign.
 */

export const GATE_IDS = [
  'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12',
] as const;
export type GateId = (typeof GATE_IDS)[number];

export type GateStatusValue =
  | 'EVIDENCED'
  | 'PARTIAL'
  | 'UNSIGNED'
  | 'RECORDED (not signed)'
  | 'NOT EVIDENCED';

export type GateRow = {
  id: GateId;
  title: string;
  status: GateStatusValue;
  evidence_paths: string[];
  residual_risks: string[];
  signed: boolean;
};

/** Frozen baseline from implementation plan §2. Not derived from live state. */
export const FROZEN_BASELINE = {
  fixture_tests: { passing: 378, skipped: 5, source: 'npm test' },
  independent_qa: {
    stdio: '16/16', http: '10/10', defect_regression: '9/9',
    source: 'independent /tmp/opencode QA scripts',
  },
  nightly_live: {
    total: 330, measured: 300, peak_concurrency_max: 3,
    m1_rate: 1, m4_429_count: 0, m5_coverage: 1, m6_coverage: 1,
    overall_pass: true, source: 'reports/nightly-live.json + handoff/NIGHTLY-SCHEDULER.md',
  },
  catalogue: { tools: 28, write_controls_wired: true, source: 'npm run verify:catalogue' },
  read_only_profile: {
    tools: 23, assertions: '5/5', source: 'READ_ONLY_PROFILE=1 npm run verify:read-only',
  },
  acceptance_criteria: { range: 'AC-01..AC-155', status: 'all green' },
  dependencies: { new_paid_runtime_dependency: false, runtime_dependencies_unchanged: true },
} as const;

export type GateStatusReport = {
  schema_version: 1;
  generated_at: string;
  require_signed: boolean;
  baseline: typeof FROZEN_BASELINE;
  gates: GateRow[];
};

type GateDefinition = {
  id: GateId;
  title: string;
  baseStatus: Exclude<GateStatusValue, 'RECORDED (not signed)' | 'NOT EVIDENCED'>;
  signed: boolean;
  evidence: readonly string[];
  residualRisks: readonly string[];
};

/** Evidence paths are relative to the wikimedia-mcp package root. */
const GATE_DEFINITIONS: readonly GateDefinition[] = [
  {
    id: 'G1', title: 'Threat re-review and three-way sign-off (AC-155)',
    baseStatus: 'UNSIGNED', signed: false,
    evidence: ['write-security/signoff.md', '../handoff/SIGNOFF-TEMPLATES.md', '../wikimedia-mcp-research/17-threat-model-rereview.md'],
    residualRisks: ['Requester risk acceptance only; independent named signatures not obtained.', 'Formal gate remains not signed; write tools stay fail-closed.'],
  },
  {
    id: 'G2', title: 'OAuth issuer, CIMD and token binding',
    baseStatus: 'EVIDENCED', signed: false,
    evidence: ['../handoff/OAUTH-CIMD-TEMPLATE.md', 'src/write/auth.ts'],
    residualRisks: ['No real issuer/CIMD/JWKS round-trip exercised in the default deployment.'],
  },
  {
    id: 'G3', title: 'Signed MRTR confirmation',
    baseStatus: 'EVIDENCED', signed: false,
    evidence: ['src/write/tokens.ts', 'tests/write/control-plane.test.ts'],
    residualRisks: ['Production confirmation channel remains operator-supplied.'],
  },
  {
    id: 'G4', title: 'Capability tokens, blast radius and kill switch',
    baseStatus: 'EVIDENCED', signed: false,
    evidence: ['src/write/tokens.ts', 'write-security/incident-revocation-drill.md'],
    residualRisks: ['Capability secrets are generated in-process in the default deployment.'],
  },
  {
    id: 'G5', title: 'Read/write separation',
    baseStatus: 'EVIDENCED', signed: false,
    evidence: ['scripts/assert-read-only.mjs', 'write-security/signoff.md'],
    residualRisks: ['None beyond the standing read-only profile assertion.'],
  },
  {
    id: 'G6', title: 'HMAC audit chain and external WORM anchor',
    baseStatus: 'PARTIAL', signed: false,
    evidence: ['../handoff/WORM-AUDIT-SPEC.md', 'src/write/audit.ts', 'src/write/audit-sink.ts'],
    residualRisks: ['Default sink is local-noop; an external WORM sink and 365-day sink-enforced retention are operator actions.', 'Chain verification is now automatic on anchor and export; retention is not claimed by the store.'],
  },
  {
    id: 'G7', title: 'Dry-run diff preview and verified rollback path',
    baseStatus: 'PARTIAL', signed: false,
    evidence: ['../handoff/REAL-WIKI-ROLLBACK-PLAN.md', 'write-security/rollback-runbooks.md', 'src/cli/rollback-harness.ts'],
    residualRisks: ['Real-wiki rollback remains untested; a human must execute and sign the testwiki evidence.'],
  },
  {
    id: 'G8', title: 'Upload licence / ToU compliance sign-off',
    baseStatus: 'UNSIGNED', signed: false,
    evidence: ['../handoff/G8-UPLOAD-TOC-CHECKLIST.md', 'write-security/upload-tou-checklist.md'],
    residualRisks: ['Legal/Compliance record pending; uploads remain failed closed with licence_not_signed_off.'],
  },
  {
    id: 'G9', title: 'Injection canaries with writes enabled',
    baseStatus: 'EVIDENCED', signed: false,
    evidence: ['write-security/signoff.md', 'tests/security/security.test.ts'],
    residualRisks: ['Writes-enabled canary re-run is an operator action for the signed deployment.'],
  },
  {
    id: 'G10', title: 'HTTP Origin/CSRF/redaction checks',
    baseStatus: 'EVIDENCED', signed: false,
    evidence: ['src/protocol/csrf.ts', 'tests/security/http-hardening.test.ts'],
    residualRisks: ['TLS termination and forwarded-header trust remain a deployment responsibility.'],
  },
  {
    id: 'G11', title: 'Two distinct approver identities',
    baseStatus: 'PARTIAL', signed: false,
    evidence: ['write-security/two-person-approval-runbook.md', 'src/write/approvers.ts'],
    residualRisks: ['Approval rule is enforced in code; real OIDC approver subjects and out-of-band channel are operator-supplied.'],
  },
  {
    id: 'G12', title: 'Revocation drill',
    baseStatus: 'PARTIAL', signed: false,
    evidence: ['write-security/incident-revocation-drill.md', 'tests/write/incident-drill.test.ts'],
    residualRisks: ['Drill is fixture-only; real issuer revocation was not exercised.'],
  },
];

export type GateStatusDeps = {
  /** Package root used to resolve evidence paths. Defaults to process.cwd(). */
  baseDir?: string;
  /** Existence test for a resolved absolute path. Defaults to existsSync. */
  exists?: (absolutePath: string) => boolean;
  /** Gate ids that have a recorded (not signed) decision. Defaults to none. */
  recordedGates?: ReadonlySet<GateId>;
  now?: () => number;
  requireSigned?: boolean;
};

/**
 * Build the gate status report. Every row exposes at least one on-disk
 * evidence path, or the literal `NOT EVIDENCED` when none is present.
 */
export function buildGateStatus(deps: GateStatusDeps = {}): GateStatusReport {
  const baseDir = deps.baseDir ?? process.cwd();
  const exists = deps.exists ?? ((absolutePath: string) => existsSync(absolutePath));
  const recorded = deps.recordedGates ?? new Set<GateId>();
  const now = deps.now ?? (() => Date.now());
  const gates: GateRow[] = GATE_DEFINITIONS.map((definition) => {
    const present = definition.evidence.filter((entry) => exists(path.resolve(baseDir, entry)));
    const evidencePaths: string[] = present.length > 0 ? [...present] : ['NOT EVIDENCED'];
    const isRecorded = recorded.has(definition.id);
    const status: GateStatusValue = isRecorded
      ? 'RECORDED (not signed)'
      : definition.baseStatus;
    return {
      id: definition.id,
      title: definition.title,
      status,
      evidence_paths: evidencePaths,
      residual_risks: [...definition.residualRisks],
      signed: false,
    };
  });
  return {
    schema_version: 1,
    generated_at: new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    require_signed: deps.requireSigned === true,
    baseline: FROZEN_BASELINE,
    gates,
  };
}

/** Human-readable rows. Deliberately contains no personal name, sign-off date or `APPROVED`. */
export function renderGateStatus(report: GateStatusReport): string {
  const lines: string[] = [
    'Wikimedia MCP — gate status (records decisions; does not sign)',
    `Generated: ${report.generated_at}  require-signed: ${report.require_signed ? 'yes' : 'no (informational)'}`,
    '',
    'GATE  STATUS                 EVIDENCE / RESIDUAL RISKS',
  ];
  for (const gate of report.gates) {
    lines.push(`${gate.id.padEnd(6)}${gate.status.padEnd(25)}${gate.evidence_paths.join('; ')}`);
    for (const risk of gate.residual_risks) lines.push(`${' '.repeat(31)}residual: ${risk}`);
  }
  const unsigned = report.gates.filter((gate) => !gate.signed).map((gate) => gate.id);
  lines.push('', `Unsigned gates (informational): ${unsigned.join(', ')}`);
  lines.push('Baseline: 378 passing / 5 skipped; QA 16/16 + 10/10 + 9/9; catalogue 28; read-only 23 + 5/5.');
  return `${lines.join('\n')}\n`;
}
