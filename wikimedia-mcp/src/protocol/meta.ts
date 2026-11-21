import type { LogLevel } from '../observability/logging.js';

export const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
export const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';
export const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
export const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';
export const LOG_LEVEL_META_KEY = 'io.modelcontextprotocol/logLevel';

export const SUPPORTED_PROTOCOL_VERSION = '2026-07-28';

export type RequestMeta = {
  protocolVersion: string;
  clientCapabilities: Record<string, unknown>;
  clientInfo?: { name: string; version: string };
  logLevel?: LogLevel;
  correlationId?: string;
};

export class MetaError extends Error {
  constructor(
    readonly reason: 'missing_version' | 'non_string_version' | 'missing_capabilities',
    message: string,
  ) {
    super(message);
    this.name = 'MetaError';
  }
}

/**
 * Parse and validate the per-request `_meta` envelope. A missing or non-string
 * protocolVersion, or a missing clientCapabilities object, is malformed
 * (`-32602 Invalid params` on the wire, per report 09 §5 AC-03/AC-04).
 */
export function parseRequestMeta(params: unknown): RequestMeta {
  const paramsObject = isRecord(params) ? params : {};
  const metaValue = paramsObject['_meta'];
  const meta = isRecord(metaValue) ? metaValue : {};

  const version = meta[PROTOCOL_VERSION_META_KEY];
  if (version === undefined || version === null) {
    throw new MetaError('missing_version', `Missing required _meta['${PROTOCOL_VERSION_META_KEY}']`);
  }
  if (typeof version !== 'string') {
    throw new MetaError('non_string_version', `_meta['${PROTOCOL_VERSION_META_KEY}'] must be a string`);
  }
  const capabilities = meta[CLIENT_CAPABILITIES_META_KEY];
  if (!isRecord(capabilities)) {
    throw new MetaError('missing_capabilities', `Missing or invalid _meta['${CLIENT_CAPABILITIES_META_KEY}']`);
  }

  const result: RequestMeta = { protocolVersion: version, clientCapabilities: capabilities };
  const info = meta[CLIENT_INFO_META_KEY];
  if (isRecord(info) && typeof info['name'] === 'string' && typeof info['version'] === 'string') {
    result.clientInfo = { name: info['name'], version: info['version'] };
  }
  const level = meta[LOG_LEVEL_META_KEY];
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    result.logLevel = level;
  }
  const correlation = meta['correlationId'];
  if (typeof correlation === 'string') result.correlationId = correlation;
  return result;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
