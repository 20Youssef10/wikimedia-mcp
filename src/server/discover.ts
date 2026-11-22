import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { serverInfo } from '../protocol/result.js';

/** Static description of what `server/discover` advertises (AC-01/AC-02). */
export const DISCOVERY = Object.freeze({
  supportedVersions: ['2026-07-28'] as readonly string[],
  capabilities: Object.freeze({
    tools: { listChanged: false },
    resources: { listChanged: false },
    prompts: { listChanged: false },
  }),
  instructions: SERVER_INSTRUCTIONS,
  serverInfo,
  /** SDK's current latest constant is legacy; we advertise the modern revision explicitly. */
  sdkLatestConstant: LATEST_PROTOCOL_VERSION,
});
