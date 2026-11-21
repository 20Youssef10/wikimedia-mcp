/**
 * SEP-2243 routing header validation and Origin/Host checks (report 09 §2.5,
 * report 08 SR-7). Header names are case-insensitive at HTTP level; this
 * module deals with already-normalised values.
 */

export class HeaderMismatchError extends Error {
  constructor(readonly detail: string) {
    super(`HeaderMismatch: ${detail}`);
    this.name = 'HeaderMismatchError';
  }
}

/**
 * Decode the `=?base64?…?=` sentinel used for values that are not header-safe.
 * Malformed sentinels are rejected rather than silently mis-compared.
 */
export function decodeSentinel(value: string): string {
  const match = /^=\?base64\?([A-Za-z0-9+/=]+)\?=$/.exec(value);
  if (match?.[1] === undefined) {
    if (value.includes('=?base64?')) throw new HeaderMismatchError('Malformed base64 sentinel');
    return value;
  }
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    if (decoded.length === 0) throw new Error('empty');
    return decoded;
  } catch {
    throw new HeaderMismatchError('Malformed base64 sentinel payload');
  }
}

export type RoutingHeaderInput = {
  headerProtocolVersion?: string;
  headerMethod?: string;
  headerName?: string;
  bodyProtocolVersion: string;
  bodyMethod: string;
  bodyName?: string;
  extraParamHeaders: ReadonlyArray<readonly [string, string]>;
};

/**
 * Validate routing headers against the JSON-RPC body. Any mismatch yields
 * `-32020 HeaderMismatch`. `Mcp-Param-*` headers are never used in Phase 1 and
 * are rejected outright (AC-17).
 */
export function validateRoutingHeaders(input: RoutingHeaderInput): void {
  if (input.extraParamHeaders.length > 0) {
    throw new HeaderMismatchError('Mcp-Param-* headers are not supported in Phase 1');
  }
  if (input.headerProtocolVersion === undefined) {
    throw new HeaderMismatchError('Missing MCP-Protocol-Version header');
  }
  if (decodeSentinel(input.headerProtocolVersion) !== input.bodyProtocolVersion) {
    throw new HeaderMismatchError('MCP-Protocol-Version does not match _meta protocolVersion');
  }
  if (input.headerMethod === undefined) {
    throw new HeaderMismatchError('Missing Mcp-Method header');
  }
  if (decodeSentinel(input.headerMethod) !== input.bodyMethod) {
    throw new HeaderMismatchError('Mcp-Method does not match the JSON-RPC method');
  }
  const nameRequired = input.bodyMethod === 'tools/call'
    || input.bodyMethod === 'resources/read'
    || input.bodyMethod === 'prompts/get';
  if (nameRequired && input.bodyName !== undefined) {
    if (input.headerName === undefined) throw new HeaderMismatchError('Missing Mcp-Name header');
    if (decodeSentinel(input.headerName) !== input.bodyName) {
      throw new HeaderMismatchError('Mcp-Name does not match params.name');
    }
  } else if (!nameRequired && input.headerName !== undefined) {
    // An extra Mcp-Name on a method that has no name is harmless but ignored.
    void input.headerName;
  }
}

export function checkOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  if (origin === undefined) return { ok: true };
  if (!allowedOrigins.includes(origin)) return { ok: false, reason: 'origin_not_allowed' };
  return { ok: true };
}

export function checkHost(
  host: string | undefined,
  allowedHosts: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  if (host === undefined) return { ok: false, reason: 'missing_host' };
  const hostname = host.replace(/:\d+$/, '').replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (!allowedHosts.some((allowed) => allowed.toLowerCase() === hostname)) {
    return { ok: false, reason: 'host_not_allowed' };
  }
  return { ok: true };
}
