/**
 * HTTP boundary checks (report 08 SR-7, T-10, T-11). Header names are
 * case-insensitive at HTTP level; this module deals with already-normalised
 * values.
 *
 * SEP-2243 routing-header validation (MCP-Protocol-Version / Mcp-Method /
 * Mcp-Name / Mcp-Param-* and the base64 sentinel) is performed by the v2 SDK's
 * `createMcpHandler` on the live path. It is covered by AC-15/AC-16/AC-17 in
 * `tests/contract/http.test.ts`. A former in-repo duplicate
 * (`validateRoutingHeaders`) was deleted as dead code — see 14-read-only-signoff.md
 * gap G10(d). Do not re-introduce a second validator here: the SDK is the single
 * authority and a second implementation can silently drift from it.
 */

/**
 * Validate the `Origin` header against the configured allowlist.
 *
 * When `requireOrigin` is false (default) a missing Origin is accepted so that
 * non-browser hosts (CLI/stdio-style HTTP clients) keep working. When true, a
 * missing Origin is rejected — this is mandatory for any future write-enabled
 * deployment (report 08 §5.9.1 / T-11).
 */
export function checkOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  requireOrigin = false,
): { ok: true } | { ok: false; reason: string } {
  if (origin === undefined) {
    return requireOrigin
      ? { ok: false, reason: 'missing_origin' }
      : { ok: true };
  }
  if (!allowedOrigins.includes(origin)) return { ok: false, reason: 'origin_not_allowed' };
  return { ok: true };
}

/** Validate the `Host` header against the configured allowlist. */
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
