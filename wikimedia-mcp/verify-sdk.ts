// Supply-chain drift probe (report 09 §2.3 step 3). CI re-runs `npm run verify:sdk`
// on a clean install to confirm the pinned SDK still exposes the 2026-07-28 surface.
import {
  McpServer,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type DiscoverResult,
  type InputRequiredResult,
  type CacheHint,
  type UnsupportedProtocolVersionError,
  type MissingRequiredClientCapabilityError,
} from '@modelcontextprotocol/server';
import { z } from 'zod';

const hints: Partial<Record<'server/discover' | 'tools/list', CacheHint>> = {
  'server/discover': { ttlMs: 60000, cacheScope: 'public' },
  'tools/list': { ttlMs: 60000, cacheScope: 'public' },
};

const server = new McpServer(
  { name: 'sdk-verify', version: '1.0.0' },
  { capabilities: { tools: {} }, cacheHints: hints },
);
server.registerTool('probe', {
  description: 'probe',
  inputSchema: z.object({ x: z.string() }).strict(),
}, async ({ x }) => ({ content: [{ type: 'text', text: x }] }));

const versions: string[] = [...SUPPORTED_PROTOCOL_VERSIONS, '2026-07-28'];
const resultType = 'complete' as const;
const inputRequired: Pick<InputRequiredResult, 'resultType'> = { resultType: 'input_required' };
const discoverCheck = (value: DiscoverResult): string => value.supportedVersions.join(',');
const unsupported: typeof UnsupportedProtocolVersionError | null = null;
const missing: typeof MissingRequiredClientCapabilityError | null = null;

void [server, LATEST_PROTOCOL_VERSION, versions, resultType, inputRequired, discoverCheck, unsupported, missing];
