import { generateKeyPairSync, sign as signBytes } from 'node:crypto';
import type { WriteConfig } from '../../src/write/config.js';
import { AuditStore } from '../../src/write/audit.js';
import { JtiLedger } from '../../src/write/tokens.js';
import { WriteRuntime, type MutateResult, type PreviewResult, type WriteInvocation, type WriteTransport } from '../../src/write/handlers.js';
import { createWriteHandlers, type WriteHandler } from '../../src/write/handlers.js';
import type { WriteToolName } from '../../src/write/constants.js';
import type { ResolveResult } from '../../src/types.js';
import { resolveTarget } from '../../src/resolver.js';
import type { ToolResponse } from '../../src/types.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
export const TEST_KID = 'test-key-1';

export function testWriteConfig(overrides: Partial<WriteConfig> = {}): WriteConfig {
  return {
    enabled: true, gatesSigned: true, killSwitch: 'released',
    issuer: 'https://issuer.example', audience: 'wikimedia-mcp-write',
    cimdUrl: 'https://issuer.example/.well-known/client.json',
    clientId: 'client-1', tokenEndpoint: 'https://issuer.example/token',
    scopes: ['edit', 'protect', 'move', 'delete', 'upload'], tokenStore: 'secret-store:write',
    tokenMaxTtlSeconds: 900, revocationEndpoint: 'https://issuer.example/revoke',
    mrtrSecret: 'mrtr-secret-that-is-at-least-32-chars-long', mrtrStateTtlSeconds: 120,
    capabilitySecret: 'capability-secret-that-is-32-chars-minimum', capabilityMaxTtlSeconds: 300,
    allowedProjects: ['testwiki'], allowedNamespaces: [0, 6],
    maxEditsPerSession: 5, maxWritesPerHour: 30, maxBytesPerEdit: 65536,
    uploadMaxBytes: 2_097_152, uploadMimeAllowlist: ['image/png', 'image/jpeg', 'image/gif'],
    auditSink: 'memory:test', auditHmacSecret: 'audit-secret-that-is-at-least-32-characters',
    auditRetentionDays: 365, twoPersonApproval: true,
    approverIds: ['approver-a', 'approver-b'], canariesRequired: true,
    uploadTouSignedBy: '', requireOrigin: true, requireCsrf: true,
    csrfSecret: 'csrf-secret-that-is-at-least-16-chars',
    allowedOrigins: ['https://console.example'], allowedHosts: ['127.0.0.1'],
    ...overrides,
  };
}

export function makeJwt(options: {
  iss?: string; aud?: string; scope?: string; sub?: string; exp?: number; nbf?: number; tenant?: string;
} = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: TEST_KID, typ: 'JWT' };
  const claims = {
    iss: options.iss ?? 'https://issuer.example',
    aud: options.aud ?? 'wikimedia-mcp-write',
    sub: options.sub ?? 'requester-1',
    tenant: options.tenant ?? 't-17',
    scope: options.scope ?? 'edit protect move delete upload',
    iat: now, nbf: options.nbf ?? now - 5, exp: options.exp ?? now + 600,
  };
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const signature = signBytes('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
  return `${input}.${signature}`;
}

export function makeFetch(config: WriteConfig, options: { tokenEndpointIss?: string; jwks?: object } = {}) {
  return async (url: string): Promise<Response> => {
    if (url === config.cimdUrl) {
      return new Response(JSON.stringify({
        client_id: config.clientId, token_endpoint: config.tokenEndpoint,
        jwks_uri: `${config.issuer}/jwks`, scopes_supported: config.scopes,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === `${config.issuer}/jwks`) {
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: TEST_KID, use: 'sig', alg: 'RS256' }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === config.tokenEndpoint) {
      return new Response(JSON.stringify({ iss: options.tokenEndpointIss ?? config.issuer }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
}

export class FakeTransport implements WriteTransport {
  readonly mutations: Array<{ action: string; params: Record<string, string>; token: string }> = [];
  readonly previews: string[] = [];
  revision = 100;
  newRevision = 101;
  currentText = 'prior text';
  protections: Array<{ type: string; level: string; expiry: string }> = [
    { type: 'edit', level: 'autoconfirmed', expiry: 'infinite' },
  ];
  mutateOk = true;
  mutateStatus = 200;

  async preview(_target: ResolveResult, title: string): Promise<PreviewResult> {
    this.previews.push(title);
    return {
      revision: this.revision, contentHash: 'sha256:prior', currentText: this.currentText,
      csrfToken: 'server-csrf-token', protections: [...this.protections], protected: this.protections.length > 0,
    };
  }
  async mutate(
    _target: ResolveResult, action: 'edit' | 'protect' | 'move' | 'delete' | 'upload',
    params: Record<string, string>, token: string,
  ): Promise<MutateResult> {
    this.mutations.push({ action, params, token });
    return {
      ok: this.mutateOk, newRevision: this.newRevision, logId: 42,
      status: this.mutateStatus, retryAfterMs: 1000,
    };
  }
}

export type Harness = {
  runtime: WriteRuntime;
  handlers: Record<WriteToolName, WriteHandler>;
  transport: FakeTransport;
  config: WriteConfig;
  token: string;
  approvals: string[];
  ledger: JtiLedger;
  audit: AuditStore;
  invoke: (name: WriteToolName, args: Record<string, unknown>, extra?: Partial<WriteInvocation>) => Promise<ToolResponse>;
  fullFlow: (name: WriteToolName, args: Record<string, unknown>, extra?: Partial<WriteInvocation>) => Promise<{
    preview: ToolResponse; result: ToolResponse; state: string;
  }>;
};

export function writeHarness(overrides: Partial<WriteConfig> = {}, fetchOptions: { tokenEndpointIss?: string } = {}): Harness {
  const config = testWriteConfig(overrides);
  const transport = new FakeTransport();
  const ledger = new JtiLedger();
  const runtime = new WriteRuntime(config, {
    transport, fetchImpl: makeFetch(config, fetchOptions), ledger,
    audit: new AuditStore(config, () => Date.now()),
  });
  const handlers = createWriteHandlers(runtime);
  const token = makeJwt();
  const approvals = [...config.approverIds];
  return {
    runtime, handlers, transport, config, token, approvals, ledger, audit: runtime.audit,
    invoke: (name, args, extra = {}) => handlers[name](args, { raw: args, token, approvals, tokenEndpointIss: config.issuer, ...extra }),
    fullFlow: async (name, args, extra = {}) => {
      const preview = await handlers[name](args, { raw: args, token, approvals, tokenEndpointIss: config.issuer, ...extra });
      const view = preview.structuredContent as { requestState?: string };
      const state = view.requestState ?? '';
      const result = await handlers[name](args, {
        raw: args, token, approvals, ...extra, requestState: state,
        inputResponses: [{ id: 'confirm_write', value: true }], tokenEndpointIss: config.issuer,
      });
      return { preview, result, state };
    },
  };
}

export function resolveTestTarget(project = 'testwiki'): ResolveResult {
  return resolveTarget({ project });
}
