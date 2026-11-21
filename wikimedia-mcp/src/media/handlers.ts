import type { ZodType } from 'zod';
import type { Config } from '../config.js';
import type { ToolResponse, ToolPayload } from '../types.js';
import { WikimediaClient } from '../upstream/client.js';
import { UpstreamError } from '../upstream/retry.js';
import type { PacingClock } from '../upstream/pacing.js';
import { errorToolResult, okToolResult } from '../protocol/result.js';
import { enforceResultLimit } from '../protocol/limits.js';
import { resolveFile, MediaToolError, type ResolvedFile } from '../attribution/resolve.js';
import {
  getFileMetadataSchema, getImageInfoSchema,
  type GetFileMetadataInput, type GetImageInfoInput,
} from './schemas.js';

type GroupFHandler = (raw: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResponse>;

const FORBIDDEN_HOST_KEYS = ['host', 'api_url', 'endpoint', 'base_url', 'url'];

function mapError(name: string, error: unknown): ToolResponse {
  if (error instanceof MediaToolError) {
    return errorToolResult(error.code, error.message, {
      ...(error.options.retryable === undefined ? {} : { retryable: error.options.retryable }),
      ...(error.options.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.options.retryAfterSeconds }),
      ...(error.options.hint === undefined ? {} : { hint: error.options.hint }),
      details: { ...(error.options.details ?? {}), tool: name },
    });
  }
  if (error instanceof UpstreamError) {
    if (error.status === 429) {
      return errorToolResult('rate_limited', 'Upstream rate limit reached after bounded retries.', {
        retryable: true,
        retryAfterSeconds: Math.ceil((error.retryAfterMs ?? 5000) / 1000),
        details: { tool: name, http_status: 429 },
      });
    }
    return errorToolResult('upstream_unavailable', 'The upstream service is temporarily unavailable. Retry shortly.', {
      retryable: true, details: { tool: name, http_status: error.status },
    });
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return errorToolResult('timeout', 'The upstream request was cancelled or timed out. Retry the call.', {
      retryable: true, details: { tool: name },
    });
  }
  return errorToolResult('internal_error', `An internal error occurred in ${name}. Retry with the correlation ID.`, {
    retryable: true, details: { tool: name, error_type: error instanceof Error ? error.name : 'unknown' },
  });
}

/** Two tools, one shared resolve pipeline (§5.3 / AC-87). */
export function createMediaHandlers(
  client: WikimediaClient,
  config: Config,
  options: { clock?: PacingClock } = {},
): Record<string, GroupFHandler> {
  async function run<TInput>(
    name: string,
    schema: ZodType<TInput>,
    raw: Record<string, unknown>,
    fn: (input: TInput, signal?: AbortSignal) => Promise<ToolPayload>,
    signal?: AbortSignal,
  ): Promise<ToolResponse> {
    const forbidden = FORBIDDEN_HOST_KEYS.find((key) => key in raw);
    if (forbidden !== undefined) {
      return errorToolResult('host_not_allowed',
        `Parameter '${forbidden}' is not accepted. Hosts are fixed by the server allowlist; no outbound request was made.`,
        { retryable: false, details: { tool: name, rejected_key: forbidden } });
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return errorToolResult('validation_error', `Invalid arguments for ${name}: ${detail}`, {
        retryable: false, details: { tool: name },
      });
    }
    try {
      return okToolResult(enforceResultLimit(await fn(parsed.data, signal), config.maxResultBytes));
    } catch (error) {
      return mapError(name, error);
    }
  }

  function resolve(
    input: { filename: string; project: string; thumb_width: number },
    signal?: AbortSignal,
  ): Promise<ResolvedFile> {
    return resolveFile(client, config, input.filename, input.project, input.thumb_width, true, signal, options);
  }

  return {
    async get_file_metadata(raw, signal) {
      return run<GetFileMetadataInput>('get_file_metadata', getFileMetadataSchema, raw, async (input, childSignal) => {
        const r = await resolveFile(client, config, input.filename, input.project, input.thumb_width, input.include_brand_marks, childSignal, options);
        return {
          filename: r.filename,
          title: r.title,
          url: r.url,
          thumb_url: r.thumb_url,
          mime: r.mime,
          width: r.width,
          height: r.height,
          size: r.size,
          description_url: r.description_url,
          author: r.author,
          credit: r.credit,
          brand_marks: r.brand_marks,
          wiki: r.wiki,
          storage: r.storage,
          attribution_source: r.attribution_source,
          restrictions: r.restrictions,
          warnings: r.warnings,
          source: r.source,
          revision: r.revision,
          timestamp: r.timestamp,
          license: r.license,
          attribution: r.attribution,
          resultType: 'complete',
        };
      }, signal);
    },

    async get_image_info(raw, signal) {
      return run<GetImageInfoInput>('get_image_info', getImageInfoSchema, raw, async (input, childSignal) => {
        const r = await resolve(input, childSignal);
        return {
          filename: r.filename,
          url: r.url,
          thumb_url: r.thumb_url,
          mime: r.mime,
          width: r.width,
          height: r.height,
          size: r.size,
          description_url: r.description_url,
          author: r.author,
          storage: r.storage,
          attribution_source: r.attribution_source,
          warnings: r.warnings,
          source: r.source,
          revision: r.revision,
          timestamp: r.timestamp,
          license: r.license,
          attribution: r.attribution,
          resultType: 'complete',
        };
      }, signal);
    },
  };
}
