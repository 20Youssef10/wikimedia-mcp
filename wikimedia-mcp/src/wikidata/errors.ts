import type { ToolErrorCode } from '../types.js';
import { toolError, type ToolErrorOptions } from '../protocol/errors.js';

/** A Group B tool fault with a frozen, actionable error code (§3.3). */
export class WikidataToolError extends Error {
  readonly code: ToolErrorCode;
  readonly options: ToolErrorOptions;

  constructor(code: ToolErrorCode, message: string, options: ToolErrorOptions = {}) {
    super(message);
    this.name = 'WikidataToolError';
    this.code = code;
    this.options = options;
  }

  toToolError() {
    return toolError(this.code, this.message, this.options);
  }
}

export function wdError(
  code: ToolErrorCode,
  message: string,
  options: ToolErrorOptions = {},
): never {
  throw new WikidataToolError(code, message, options);
}
