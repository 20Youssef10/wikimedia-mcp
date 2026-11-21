import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import type { WriteConfig } from './config.js';
import type { ActorBinding } from './tokens.js';
import { throwWrite } from './errors.js';

export type WriteFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type CimdDocument = {
  client_id: string;
  token_endpoint: string;
  jwks_uri: string;
  scopes_supported: string[];
};

export type ValidatedToken = {
  actor: ActorBinding;
  scopes: readonly string[];
  tokenId: string;
  exp: number;
};

/** Reusable actor/approver hash helper (WP4). Never exposes the raw subject. */
export function hashPrefix(value: string): string {
  return `sha256-prefix:${createHash('sha256').update(value).digest('hex').slice(0, 8)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** CIMD is fetched only from the configured HTTPS URL; DCR is never attempted. */
export async function loadCimd(config: WriteConfig, fetchImpl: WriteFetch): Promise<CimdDocument> {
  let response: Response;
  try {
    response = await fetchImpl(config.cimdUrl, {
      headers: { 'User-Agent': 'WikiMCP-Write/1.0', Accept: 'application/json' },
    });
  } catch {
    throwWrite('invalid_issuer', 'The client metadata document could not be retrieved.');
  }
  if (!response.ok) throwWrite('invalid_issuer', 'The client metadata document could not be retrieved.');
  let doc: unknown;
  try { doc = await response.json(); } catch { throwWrite('invalid_issuer', 'The client metadata document is invalid.'); }
  if (!isObject(doc) || doc['client_id'] !== config.clientId || doc['token_endpoint'] !== config.tokenEndpoint
      || typeof doc['jwks_uri'] !== 'string' || !/^https:\/\//i.test(doc['jwks_uri'])
      || !Array.isArray(doc['scopes_supported']) || doc['scopes_supported'].some((scope) => typeof scope !== 'string')) {
    throwWrite('invalid_issuer', 'The client metadata document is invalid or not pinned to this client.');
  }
  const supported = doc['scopes_supported'] as string[];
  if (supported.some((scope) => scope.includes('*'))) {
    throwWrite('invalid_issuer', 'The client metadata document advertises wildcard scopes.');
  }
  return {
    client_id: config.clientId,
    token_endpoint: config.tokenEndpoint,
    jwks_uri: doc['jwks_uri'],
    scopes_supported: supported,
  };
}

/**
 * G2 validation: RFC 9207 `iss` byte-for-byte, aud/exp/nbf, RS256 signature
 * against the CIMD-pinned JWKS, and least-privilege scope. Tokens are never
 * logged, echoed, cached or placed in a URL or error message.
 */
export async function validateAccessToken(
  rawToken: string,
  config: WriteConfig,
  requiredScope: string,
  fetchImpl: WriteFetch,
  tokenEndpointIss?: string,
  now: () => number = Date.now,
): Promise<ValidatedToken> {
  if (config.issuer.length === 0 || config.cimdUrl.length === 0 || config.scopes.length === 0) {
    throwWrite('authentication_required', 'No write issuer is configured; no write was attempted.');
  }
  const cimd = await loadCimd(config, fetchImpl);

  if (tokenEndpointIss === undefined || tokenEndpointIss !== config.issuer) {
    throwWrite('invalid_issuer', 'The token response has a missing or mismatched RFC 9207 issuer.');
  }
  const parts = rawToken.split('.');
  if (parts.length !== 3) throwWrite('authentication_required', 'A valid bearer token is required.');
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throwWrite('authentication_required', 'A valid bearer token is required.');
  }
  if (header['alg'] !== 'RS256' || typeof header['kid'] !== 'string') {
    throwWrite('authentication_required', 'The bearer token uses an unsupported signing algorithm.');
  }
  const iss = claims['iss'];
  if (typeof iss !== 'string' || iss !== config.issuer || !/^https:\/\//i.test(iss)) {
    throwWrite('invalid_issuer', 'The token issuer is missing, non-HTTPS or mismatched.');
  }
  if (claims['aud'] !== config.audience) {
    throwWrite('authentication_required', 'The bearer token audience is invalid.');
  }
  const exp = claims['exp'];
  const nbf = claims['nbf'];
  const current = Math.floor(now() / 1000);
  if (typeof exp !== 'number' || exp <= current || exp - current > config.tokenMaxTtlSeconds
      || (typeof nbf === 'number' && nbf > current)) {
    throwWrite('authentication_required', 'The bearer token is expired, not yet valid or has an excessive lifetime.');
  }

  let jwksResponse: Response;
  try {
    jwksResponse = await fetchImpl(cimd.jwks_uri, { headers: { Accept: 'application/json' } });
  } catch {
    throwWrite('invalid_issuer', 'The signing keys could not be retrieved.');
  }
  if (!jwksResponse.ok) throwWrite('invalid_issuer', 'The signing keys could not be retrieved.');
  const jwks = await jwksResponse.json() as { keys?: unknown[] };
  const jwk = Array.isArray(jwks.keys)
    ? jwks.keys.find((entry) => isObject(entry) && entry['kid'] === header['kid'])
    : undefined;
  if (jwk === undefined) throwWrite('invalid_issuer', 'The token signing key is not pinned by the CIMD.');
  try {
    const key = createPublicKey({ key: jwk as never, format: 'jwk' });
    const signed = `${parts[0]}.${parts[1]}`;
    const ok = verifySignature(
      'RSA-SHA256',
      Buffer.from(signed, 'utf8'),
      key,
      Buffer.from(parts[2]!, 'base64url'),
    );
    if (!ok) throwWrite('authentication_required', 'The bearer token signature is invalid.');
  } catch (error) {
    if (error instanceof Error && error.name === 'WriteError') throw error;
    throwWrite('authentication_required', 'The bearer token signature is invalid.');
  }

  const scopes = typeof claims['scope'] === 'string' ? claims['scope'].split(' ').filter(Boolean) : [];
  if (!scopes.includes(requiredScope)) throwWrite('insufficient_scope', `The ${requiredScope} scope is required for this write.`);
  const sub = typeof claims['sub'] === 'string' ? claims['sub'] : '';
  const tenant = typeof claims['tenant'] === 'string' ? claims['tenant'] : 'default';
  if (sub.length === 0) throwWrite('authentication_required', 'The bearer token has no subject.');
  return {
    actor: { tenant, sub, client_id_hash: hashPrefix(config.clientId) },
    scopes,
    tokenId: hashPrefix(rawToken),
    exp,
  };
}

/** Issuer-side revocation endpoint helper for the G12 drill. */
export async function revokeToken(
  config: WriteConfig,
  tokenId: string,
  fetchImpl: WriteFetch,
): Promise<boolean> {
  const response = await fetchImpl(config.revocationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token_id_hint: tokenId }).toString(),
  });
  return response.ok;
}
