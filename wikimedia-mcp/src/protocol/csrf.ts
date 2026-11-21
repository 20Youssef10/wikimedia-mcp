/**
 * CSRF token issuance/validation for state-changing HTTP calls
 * (report 08 §5.9.1, §5.9.4, T-11; gate G10(c)).
 *
 * This mechanism is OFF by default (`MCP_REQUIRE_CSRF=false`) because the
 * read-only server has no state-changing tool. It is shipped so that a future
 * write-enabled deployment has a ready, tested control; it does not itself
 * register or enable any write tool.
 *
 * Token = base64url(JSON payload).base64url(HMAC-SHA256(payload, secret)).
 * The payload carries an issue time and a random nonce. Verification is a
 * constant-time MAC comparison plus a TTL check. Tokens are stateless (they do
 * not require server-side storage), consistent with the MCP 2026-07-28
 * stateless model.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Lower-case form is used to look up Node's normalised inbound header keys. */
export const CSRF_REQUEST_HEADER = 'mcp-csrf-token';
/** Response header clients read to obtain a fresh token (double-submit pattern). */
export const CSRF_RESPONSE_HEADER = 'MCP-CSRF-Token';

/**
 * Write-tool names from report 05 §2 Group G (write / upload / delete) plus
 * the additional mutators named in report 08 §1.1. These are DENY-LIST
 * entries only — none of them is registered by this server.
 */
export const WRITE_TOOL_DENYLIST: readonly string[] = [
  'edit_page',     // report 05 §2 — write
  'upload_file',   // report 05 §2 — upload
  'delete_page',   // report 05 §2 — delete
  'move_page',     // report 08 §1.1
  'protect_page',  // report 08 §1.1
];

/** Env/config key shapes that would indicate a write-capable credential. */
const WRITE_CREDENTIAL_KEY_PATTERN =
  /oauth|bot[_-]?password|write[_-]?(token|credential|secret)|access[_-]?token|refresh[_-]?token/i;

type TokenPayload = { iat: number; n: string };

export type CsrfGuard = {
  issueToken(): string;
  verifyToken(token: string | undefined): boolean;
};

function mac(payloadB64: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payloadB64).digest();
}

export function createCsrfGuard(
  secret: string,
  ttlMs: number,
  now: () => number = Date.now,
): CsrfGuard {
  function issueToken(): string {
    const payload: TokenPayload = { iat: now(), n: randomBytes(16).toString('hex') };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${payloadB64}.${mac(payloadB64, secret).toString('base64url')}`;
  }

  function verifyToken(token: string | undefined): boolean {
    if (typeof token !== 'string' || token.length === 0) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const payloadB64 = parts[0];
    const sigB64 = parts[1];
    if (payloadB64 === undefined || sigB64 === undefined) return false;

    const supplied = Buffer.from(sigB64, 'base64url');
    const expected = mac(payloadB64, secret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;

    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as unknown;
    } catch {
      return false;
    }
    if (decoded === null || typeof decoded !== 'object') return false;
    const record = decoded as Record<string, unknown>;
    const iat = record['iat'];
    const nonce = record['n'];
    if (typeof iat !== 'number' || !Number.isFinite(iat) || typeof nonce !== 'string' || nonce.length === 0) {
      return false;
    }

    const current = now();
    // Allow one minute of clock skew, then enforce the configured TTL.
    if (iat > current + 60_000) return false;
    if (current - iat > ttlMs) return false;
    return true;
  }

  return { issueToken, verifyToken };
}

/**
 * A request is "state-changing" only when it is a `tools/call` to a deny-listed
 * write tool. With the current read-only catalogue this is always false; the
 * test-only harness registers a dummy write tool to prove the gate fires.
 */
export function isStateChangingRequest(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  if (record['method'] !== 'tools/call') return false;
  const params = record['params'];
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return false;
  const name = (params as Record<string, unknown>)['name'];
  return typeof name === 'string' && WRITE_TOOL_DENYLIST.includes(name);
}

/** Throw when any deny-listed write tool appears in an advertised catalogue. */
export function assertNoWriteTool(toolNames: readonly string[]): void {
  const overlap = toolNames.filter((name) => WRITE_TOOL_DENYLIST.includes(name));
  if (overlap.length > 0) {
    throw new Error(`write tools present in tool catalogue: ${overlap.join(', ')}`);
  }
}

/** Return non-empty env keys whose name indicates a write-capable credential. */
export function findWriteCredentialEnvKeys(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter((key) =>
    WRITE_CREDENTIAL_KEY_PATTERN.test(key) && (env[key] ?? '').trim().length > 0);
}
