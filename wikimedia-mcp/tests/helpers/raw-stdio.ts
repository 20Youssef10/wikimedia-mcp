import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

export type StdioRpcResult = { body: Record<string, unknown>; raw: string };

/** Minimal raw stdio client: newline-delimited JSON-RPC over child stdin/stdout. */
export class RawStdioClient {
  private readonly child: ChildProcess;
  private buffer = '';
  private readonly pending = new Map<number | string, (value: Record<string, unknown>) => void>();

  constructor(env: Record<string, string> = {}) {
    this.child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'src/index.ts')], {
      env: {
        ...process.env,
        USER_AGENT: 'WikiMCP-Test/1.0 (https://example.org/test; contact: test@example.org)',
        MCP_TRANSPORT: 'stdio',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line.length > 0) {
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            const id = parsed['id'];
            if (typeof id === 'number' || typeof id === 'string') {
              const resolve = this.pending.get(id);
              if (resolve !== undefined) {
                this.pending.delete(id);
                resolve(parsed);
              }
            }
          } catch { /* ignore malformed output */ }
        }
        newline = this.buffer.indexOf('\n');
      }
    });
  }

  request(method: string, params: Record<string, unknown> = {}, id = 1, version = '2026-07-28'): Promise<StdioRpcResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`stdio timeout for ${method}`)), 15000);
      this.pending.set(id, (body) => {
        clearTimeout(timer);
        resolve({ body, raw: JSON.stringify(body) });
      });
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': version,
            'io.modelcontextprotocol/clientInfo': { name: 'stdio-test', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      });
      this.child.stdin?.write(`${payload}\n`);
    });
  }

  /** Send a raw line without adding `_meta` (for malformed-request tests). */
  raw(line: string, id: number): Promise<StdioRpcResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stdio timeout for raw line')), 5000);
      this.pending.set(id, (body) => {
        clearTimeout(timer);
        resolve({ body, raw: JSON.stringify(body) });
      });
      this.child.stdin?.write(`${line}\n`);
    });
  }

  close(): void {
    this.child.stdin?.end();
    this.child.kill('SIGTERM');
  }
}
