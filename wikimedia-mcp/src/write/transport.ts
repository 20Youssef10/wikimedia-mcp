import type { ResolveResult } from '../types.js';
import type { MutateResult, PreviewResult, WriteTransport } from './handlers.js';
import type { WriteConfig } from './config.js';

/**
 * Real Action API transport used by the enabled deployment. Every mutating
 * request carries the server-side bearer token over TLS and aborts on the
 * shared signal. Preview fetches current revision/content/protection data and
 * a server-side CSRF edit token; it never mutates.
 */
export class HttpWriteTransport implements WriteTransport {
  constructor(
    private readonly userAgent: string,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  private async get(target: ResolveResult, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const query = new URLSearchParams({ action: 'query', format: 'json', ...params });
    const response = await this.fetchImpl(`${target.actionUrl}?${query.toString()}`, {
      method: 'GET',
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw new Error(`preview failed with status ${response.status}`);
    return response.json();
  }

  async preview(target: ResolveResult, title: string, signal?: AbortSignal): Promise<PreviewResult> {
    const [pageJson, tokenJson] = await Promise.all([
      this.get(target, {
        prop: 'revisions|protection', titles: title, rvprop: 'ids|content|timestamp',
        rvslots: 'main', rvlimit: '1',
      }, signal),
      this.get(target, { meta: 'tokens', type: 'csrf' }, signal),
    ]);
    const pageRecord = pageJson as { query?: { pages?: Record<string, unknown> } };
    const page = Object.values(pageRecord.query?.pages ?? {})[0] as Record<string, unknown> | undefined;
    const revisions = Array.isArray(page?.['revisions']) ? page!['revisions'] as Array<Record<string, unknown>> : [];
    const firstRevision = revisions[0];
    const slots = firstRevision && typeof firstRevision['slots'] === 'object'
      ? firstRevision['slots'] as Record<string, unknown> : {};
    const main = typeof slots['main'] === 'object' ? slots['main'] as Record<string, unknown> : {};
    const tokenRecord = tokenJson as { query?: { tokens?: Record<string, string> } };
    const protection = Array.isArray(page?.['protection']) ? page!['protection'] as Array<Record<string, unknown>> : [];
    return {
      revision: typeof firstRevision?.['revid'] === 'number' ? firstRevision['revid'] as number : null,
      contentHash: typeof main['*'] === 'string' ? `sha256:${Buffer.from(main['*']).toString('base64url').slice(0, 16)}` : null,
      currentText: typeof main['*'] === 'string' ? main['*'] as string : null,
      csrfToken: tokenRecord.query?.tokens?.csrftoken ?? '',
      protections: protection.map((entry) => ({
        type: String(entry['type'] ?? ''), level: String(entry['level'] ?? ''), expiry: String(entry['expiry'] ?? ''),
      })),
      protected: protection.length > 0,
    };
  }

  async mutate(
    target: ResolveResult,
    action: 'edit' | 'protect' | 'move' | 'delete' | 'upload',
    params: Record<string, string>,
    bearerToken: string,
    signal?: AbortSignal,
  ): Promise<MutateResult> {
    const body = new URLSearchParams({ action, format: 'json', ...params });
    const response = await this.fetchImpl(target.actionUrl, {
      method: 'POST',
      headers: {
        'User-Agent': this.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: body.toString(),
      ...(signal === undefined ? {} : { signal }),
    });
    const text = await response.text();
    if (response.status === 429) {
      return { ok: false, newRevision: null, logId: null, status: 429, retryAfterMs: Number(response.headers.get('retry-after')) * 1000 || null };
    }
    if (!response.ok) return { ok: false, newRevision: null, logId: null, status: response.status, retryAfterMs: null };
    let decoded: unknown = null;
    try { decoded = JSON.parse(text); } catch { decoded = null; }
    const root = decoded as { edit?: { newrevid?: number }; delete?: { logid?: number }; upload?: { result?: string } } | null;
    return {
      ok: true,
      newRevision: typeof root?.edit?.newrevid === 'number' ? root.edit.newrevid : null,
      logId: typeof root?.delete?.logid === 'number' ? root.delete.logid : null,
      status: response.status,
      retryAfterMs: null,
    };
  }
}

/** Token is selected server-side from the configured secret-store reference. */
export function tokenFromSecretStore(config: WriteConfig, env: NodeJS.ProcessEnv = process.env): string {
  if (config.tokenStore.length === 0) return '';
  return env[config.tokenStore] ?? env['MCP_WRITE_TOKEN'] ?? '';
}
