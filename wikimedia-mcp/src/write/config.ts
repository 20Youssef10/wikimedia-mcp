import { existsSync } from 'node:fs';
import path from 'node:path';
import { KNOWN_WRITE_SCOPES } from './constants.js';

/**
 * Contract 16 §2.1 — all write configuration is OFF by default and lives in a
 * SEPARATE config object. The read-only `loadConfig()` never gains a write
 * field, so `verify:read-only` keeps its 5/5 assertion. Invalid or missing
 * required values terminate startup (fail closed).
 */
export type WriteConfig = {
  readonly enabled: true;
  readonly gatesSigned: boolean;
  readonly killSwitch: 'engaged' | 'released';
  readonly issuer: string;
  readonly audience: string;
  readonly cimdUrl: string;
  readonly clientId: string;
  readonly tokenEndpoint: string;
  readonly scopes: readonly string[];
  readonly tokenStore: string;
  readonly tokenMaxTtlSeconds: number;
  readonly revocationEndpoint: string;
  readonly mrtrSecret: string;
  readonly mrtrStateTtlSeconds: number;
  readonly capabilitySecret: string;
  readonly capabilityMaxTtlSeconds: number;
  readonly allowedProjects: readonly string[];
  readonly allowedNamespaces: readonly number[];
  readonly maxEditsPerSession: number;
  readonly maxWritesPerHour: number;
  readonly maxBytesPerEdit: number;
  readonly uploadMaxBytes: number;
  readonly uploadMimeAllowlist: readonly string[];
  readonly auditSink: string;
  readonly auditHmacSecret: string;
  readonly auditRetentionDays: number;
  readonly twoPersonApproval: boolean;
  readonly approverIds: readonly string[];
  readonly canariesRequired: boolean;
  readonly uploadTouSignedBy: string;
  readonly requireOrigin: boolean;
  readonly requireCsrf: boolean;
  readonly csrfSecret: string;
  readonly allowedOrigins: readonly string[];
  readonly allowedHosts: readonly string[];
};

export const WRITE_CONFIG_KEYS = [
  'MCP_WRITES_ENABLED', 'MCP_WRITE_GATES_SIGNED', 'MCP_WRITE_KILL_SWITCH',
  'MCP_WRITE_OAUTH_ISSUER', 'MCP_WRITE_OAUTH_AUDIENCE', 'MCP_WRITE_OAUTH_CIMD_URL',
  'MCP_WRITE_OAUTH_CLIENT_ID', 'MCP_WRITE_OAUTH_TOKEN_ENDPOINT', 'MCP_WRITE_OAUTH_SCOPES',
  'MCP_WRITE_TOKEN_STORE', 'MCP_WRITE_TOKEN_MAX_TTL_SECONDS',
  'MCP_WRITE_TOKEN_REVOCATION_ENDPOINT', 'MCP_MRTR_SECRET', 'MCP_MRTR_STATE_TTL_SECONDS',
  'MCP_CAPABILITY_SECRET', 'MCP_CAPABILITY_MAX_TTL_SECONDS', 'MCP_WRITE_ALLOWED_PROJECTS',
  'MCP_WRITE_ALLOWED_NAMESPACES', 'MCP_WRITE_MAX_EDITS_PER_SESSION',
  'MCP_WRITE_MAX_WRITES_PER_HOUR', 'MCP_WRITE_MAX_BYTES_PER_EDIT',
  'MCP_WRITE_UPLOAD_MAX_BYTES', 'MCP_WRITE_UPLOAD_MIME_ALLOWLIST',
  'MCP_WRITE_AUDIT_SINK', 'MCP_WRITE_AUDIT_HMAC_SECRET', 'MCP_WRITE_AUDIT_RETENTION_DAYS',
  'MCP_WRITE_TWO_PERSON_APPROVAL', 'MCP_WRITE_APPROVER_IDS', 'MCP_WRITE_CANARIES_REQUIRED',
  'MCP_UPLOAD_TOU_SIGNED_BY',
] as const;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === '') throw new Error(`write config: ${key} is required when writes are enabled`);
  return value.trim();
}
function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`write config: ${key} must be a positive integer`);
  return value;
}
function boolEnv(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`write config: ${key} must be 'true' or 'false'`);
}
function csv(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}
function httpsUrl(value: string, key: string): string {
  if (!/^https:\/\//i.test(value)) throw new Error(`write config: ${key} must be an https URL`);
  return value;
}
function secret(value: string, key: string): string {
  if (value.length < 32) throw new Error(`write config: ${key} must be at least 32 characters`);
  return value;
}
function noWildcard(values: readonly string[], key: string): void {
  if (values.length === 0 || values.some((value) => value.includes('*'))) {
    throw new Error(`write config: ${key} must be an explicit, non-wildcard allowlist`);
  }
}

/** Default sign-off record path. Absent in this repository by design. */
export const WRITES_SIGNOFF_PATH = path.resolve(process.cwd(), 'write-security', 'signoff.md');

export type WriteConfigDeps = {
  signoffPresent?: (path: string) => boolean;
};

/** Returns `null` in the default read-only deployment (no write config object at all). */
export function loadWriteConfig(
  env: NodeJS.ProcessEnv = process.env,
  deps: WriteConfigDeps = {},
): WriteConfig | null {
  if (boolEnv(env, 'MCP_WRITES_ENABLED', false) === false) return null;

  const gatesSigned = boolEnv(env, 'MCP_WRITE_GATES_SIGNED', false);
  const killSwitchRaw = env['MCP_WRITE_KILL_SWITCH'] ?? 'engaged';
  if (killSwitchRaw !== 'engaged' && killSwitchRaw !== 'released') {
    throw new Error("write config: MCP_WRITE_KILL_SWITCH must be 'engaged' or 'released'");
  }
  if (!gatesSigned && killSwitchRaw === 'released') {
    throw new Error('write config: kill switch may not be released while gates are unsigned');
  }
  const signoffPresent = deps.signoffPresent ?? ((file: string) => existsSync(file));
  if (!gatesSigned || !signoffPresent(WRITES_SIGNOFF_PATH)) {
    throw new Error('write config: signed gate record is required before writes may be enabled (AC-155)');
  }

  const scopes = csv(required(env, 'MCP_WRITE_OAUTH_SCOPES'));
  noWildcard(scopes, 'MCP_WRITE_OAUTH_SCOPES');
  for (const scope of scopes) {
    if (!KNOWN_WRITE_SCOPES.has(scope)) throw new Error(`write config: unknown scope '${scope}'`);
  }
  const allowedProjects = csv(required(env, 'MCP_WRITE_ALLOWED_PROJECTS'));
  noWildcard(allowedProjects, 'MCP_WRITE_ALLOWED_PROJECTS');
  if (allowedProjects.some((project) => project !== 'testwiki')) {
    // Production projects require a separately signed gates record; this build
    // has none, so only an isolated test project may ever be configured.
    throw new Error('write config: production projects require a signed gates record');
  }
  const allowedNamespaces = csv(env['MCP_WRITE_ALLOWED_NAMESPACES'] ?? '0').map(Number);
  if (allowedNamespaces.length === 0 || allowedNamespaces.some((ns) => !Number.isInteger(ns) || ns < 0 || ns > 15)) {
    throw new Error('write config: MCP_WRITE_ALLOWED_NAMESPACES must contain namespace ids 0..15');
  }
  const approverIds = csv(required(env, 'MCP_WRITE_APPROVER_IDS'));
  if (new Set(approverIds).size < 2) throw new Error('write config: at least two distinct approvers are required');
  const mime = csv(env['MCP_WRITE_UPLOAD_MIME_ALLOWLIST'] ?? 'image/png,image/jpeg,image/gif');
  noWildcard(mime, 'MCP_WRITE_UPLOAD_MIME_ALLOWLIST');

  const retention = intEnv(env, 'MCP_WRITE_AUDIT_RETENTION_DAYS', 365);
  if (retention < 365) throw new Error('write config: audit retention must be >= 365 days');
  const mrtrTtl = intEnv(env, 'MCP_MRTR_STATE_TTL_SECONDS', 120);
  if (mrtrTtl > 300) throw new Error('write config: MRTR state TTL may not exceed 300 s');
  const capabilityTtl = intEnv(env, 'MCP_CAPABILITY_MAX_TTL_SECONDS', 300);
  if (capabilityTtl > 300) throw new Error('write config: capability TTL may not exceed 300 s');
  const tokenTtl = intEnv(env, 'MCP_WRITE_TOKEN_MAX_TTL_SECONDS', 900);
  if (tokenTtl > 900) throw new Error('write config: token TTL may not exceed 900 s');

  if (env['MCP_REQUIRE_ORIGIN'] !== 'true' || env['MCP_REQUIRE_CSRF'] !== 'true') {
    throw new Error('write config: MCP_REQUIRE_ORIGIN and MCP_REQUIRE_CSRF must be true for writes');
  }
  const allowedOrigins = csv(required(env, 'MCP_ALLOWED_ORIGINS'));
  const allowedHosts = csv(required(env, 'MCP_ALLOWED_HOSTS'));
  noWildcard(allowedOrigins, 'MCP_ALLOWED_ORIGINS');
  noWildcard(allowedHosts, 'MCP_ALLOWED_HOSTS');

  return {
    enabled: true,
    gatesSigned: true,
    killSwitch: killSwitchRaw as 'engaged' | 'released',
    issuer: httpsUrl(required(env, 'MCP_WRITE_OAUTH_ISSUER'), 'MCP_WRITE_OAUTH_ISSUER'),
    audience: required(env, 'MCP_WRITE_OAUTH_AUDIENCE'),
    cimdUrl: httpsUrl(required(env, 'MCP_WRITE_OAUTH_CIMD_URL'), 'MCP_WRITE_OAUTH_CIMD_URL'),
    clientId: required(env, 'MCP_WRITE_OAUTH_CLIENT_ID'),
    tokenEndpoint: httpsUrl(required(env, 'MCP_WRITE_OAUTH_TOKEN_ENDPOINT'), 'MCP_WRITE_OAUTH_TOKEN_ENDPOINT'),
    scopes,
    tokenStore: required(env, 'MCP_WRITE_TOKEN_STORE'),
    tokenMaxTtlSeconds: tokenTtl,
    revocationEndpoint: httpsUrl(required(env, 'MCP_WRITE_TOKEN_REVOCATION_ENDPOINT'), 'MCP_WRITE_TOKEN_REVOCATION_ENDPOINT'),
    mrtrSecret: secret(required(env, 'MCP_MRTR_SECRET'), 'MCP_MRTR_SECRET'),
    mrtrStateTtlSeconds: mrtrTtl,
    capabilitySecret: secret(required(env, 'MCP_CAPABILITY_SECRET'), 'MCP_CAPABILITY_SECRET'),
    capabilityMaxTtlSeconds: capabilityTtl,
    allowedProjects,
    allowedNamespaces,
    maxEditsPerSession: intEnv(env, 'MCP_WRITE_MAX_EDITS_PER_SESSION', 5),
    maxWritesPerHour: intEnv(env, 'MCP_WRITE_MAX_WRITES_PER_HOUR', 30),
    maxBytesPerEdit: intEnv(env, 'MCP_WRITE_MAX_BYTES_PER_EDIT', 65536),
    uploadMaxBytes: intEnv(env, 'MCP_WRITE_UPLOAD_MAX_BYTES', 20971520),
    uploadMimeAllowlist: mime,
    auditSink: required(env, 'MCP_WRITE_AUDIT_SINK'),
    auditHmacSecret: secret(required(env, 'MCP_WRITE_AUDIT_HMAC_SECRET'), 'MCP_WRITE_AUDIT_HMAC_SECRET'),
    auditRetentionDays: retention,
    twoPersonApproval: boolEnv(env, 'MCP_WRITE_TWO_PERSON_APPROVAL', true),
    approverIds,
    canariesRequired: boolEnv(env, 'MCP_WRITE_CANARIES_REQUIRED', true),
    uploadTouSignedBy: required(env, 'MCP_UPLOAD_TOU_SIGNED_BY'),
    requireOrigin: true,
    requireCsrf: true,
    csrfSecret: (() => {
      const value = required(env, 'MCP_CSRF_SECRET');
      if (value.length < 16) throw new Error('write config: MCP_CSRF_SECRET must be at least 16 characters');
      return value;
    })(),
    allowedOrigins,
    allowedHosts,
  };
}
