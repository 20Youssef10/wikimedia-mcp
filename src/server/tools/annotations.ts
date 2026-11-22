import { GROUP_B_TOOL_NAMES } from '../../wikidata/schemas.js';
import { GROUP_C_TOOL_NAMES } from '../../metrics/schemas.js';
import { GROUP_F_TOOL_NAMES } from '../../media/schemas.js';
import { GROUP_G_TOOL_NAMES } from '../../groupg/schemas.js';
import { GROUP_D_TOOL_NAMES } from '../../groupd/schemas.js';
import { WRITE_ANNOTATIONS, WRITE_TOOL_NAMES } from '../../write/constants.js';
import { IDEMPOTENT_TOOLS } from './schemas.js';

const GROUP_CF_TOOL_NAMES: readonly string[] = [...GROUP_C_TOOL_NAMES, ...GROUP_F_TOOL_NAMES];

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint: boolean;
}

/**
 * Single source of truth for the MCP hints advertised on `tools/list`.
 *
 * Both `buildMcpServer` (the live registration) and the generated TOOLS.md
 * reference call this pure function, so the documented annotations cannot
 * drift from the ones the server serves. No config, clock, env or network
 * value is read — only frozen tool-name sets.
 */
export function toolAnnotations(name: string): ToolAnnotations {
  if ((WRITE_TOOL_NAMES as readonly string[]).includes(name)) return { ...WRITE_ANNOTATIONS };
  return {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    // Group D is deliberately non-idempotent: the implicit "now" makes two
    // identical calls return different windows (contract §3.5).
    idempotentHint: !(GROUP_D_TOOL_NAMES as readonly string[]).includes(name)
      && ((GROUP_B_TOOL_NAMES as readonly string[]).includes(name)
        || GROUP_CF_TOOL_NAMES.includes(name)
        || (GROUP_G_TOOL_NAMES as readonly string[]).includes(name)
        || IDEMPOTENT_TOOLS.has(name)),
  };
}
