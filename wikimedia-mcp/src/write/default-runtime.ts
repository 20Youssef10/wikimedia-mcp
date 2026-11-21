import type { Config } from '../config.js';
import { AuditStore } from './audit.js';
import { loadWriteConfig } from './config.js';
import { WriteRuntime } from './handlers.js';
import { HttpWriteTransport, tokenFromSecretStore } from './transport.js';

/**
 * One in-process runtime shared by every server instance/connection so the
 * MRTR single-use jti ledger and the audit hash chain survive across calls.
 */
let shared: { runtime: WriteRuntime; token: string } | undefined;

export function defaultWriteRuntime(baseConfig: Config): { runtime: WriteRuntime; token: string } {
  if (shared === undefined) {
    const writeConfig = loadWriteConfig();
    if (writeConfig === null) throw new Error('write runtime requested in read-only profile');
    const runtime = new WriteRuntime(writeConfig, {
      transport: new HttpWriteTransport(baseConfig.userAgent),
      fetchImpl: globalThis.fetch,
      audit: new AuditStore(writeConfig),
    });
    shared = { runtime, token: tokenFromSecretStore(writeConfig) };
  }
  return shared;
}

/** Test-only reset for deterministic harness isolation. */
export function resetDefaultWriteRuntime(): void { shared = undefined; }
