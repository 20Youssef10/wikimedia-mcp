import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const SENSITIVE_KEY = /token|password|secret|api[_-]?key|authorization/i;

function redactString(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT_REDACTED]')
    .replace(/(token|password|secret|api[_-]?key)\s*[=:]\s*["']?[^\s"',}]+/gi, '$1=[REDACTED]');
}

/**
 * Deeply sanitise a value BEFORE serialisation (finding H4): object keys such
 * as `token` must have their values replaced, not merely pattern-matched in a
 * JSON string after the fact.
 */
export function redactObject(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactObject(item));
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactObject(item);
    }
    return output;
  }
  return value;
}

/** Redact credential-shaped values before any log line reaches stderr. */
export function redact(value: unknown): string {
  const sanitised = redactObject(value);
  return typeof sanitised === 'string' ? sanitised : JSON.stringify(sanitised);
}

export class Logger {
  readonly correlationId: string;

  constructor(
    readonly level: LogLevel = 'info',
    correlationId?: string,
  ) {
    this.correlationId = correlationId ?? randomUUID();
  }

  private emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      correlationId: this.correlationId,
      message: redact(message),
      ...(fields === undefined ? {} : { fields: redactObject(fields) as Record<string, unknown> }),
    });
    // Log structured output to stderr only; stdout is reserved for JSON-RPC on stdio.
    process.stderr.write(`${line}\n`);
  }

  debug(message: string, fields?: Record<string, unknown>): void { this.emit('debug', message, fields); }
  info(message: string, fields?: Record<string, unknown>): void { this.emit('info', message, fields); }
  warn(message: string, fields?: Record<string, unknown>): void { this.emit('warn', message, fields); }
  error(message: string, fields?: Record<string, unknown>): void { this.emit('error', message, fields); }

  child(correlationId: string): Logger {
    return new Logger(this.level, correlationId);
  }
}
