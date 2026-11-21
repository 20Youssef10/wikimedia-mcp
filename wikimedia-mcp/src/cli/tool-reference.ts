import { loadConfig } from '../config.js';
import { TOOL_NAMES } from '../server/tools/registry.js';
import {
  TOOL_DESCRIPTIONS, TOOL_SCHEMAS,
} from '../server/tools/schemas.js';
import {
  GROUP_B_DESCRIPTIONS, GROUP_B_TOOL_NAMES, buildGroupBSchemas,
} from '../wikidata/schemas.js';
import {
  GROUP_C_DESCRIPTIONS, GROUP_C_SCHEMAS,
} from '../metrics/schemas.js';
import {
  GROUP_F_DESCRIPTIONS, GROUP_F_SCHEMAS,
} from '../media/schemas.js';
import {
  GROUP_G_DESCRIPTIONS, GROUP_G_SCHEMAS,
} from '../groupg/schemas.js';
import {
  GROUP_D_DESCRIPTIONS, GROUP_D_SCHEMAS,
} from '../groupd/schemas.js';
import {
  WRITE_DESCRIPTIONS, WRITE_TOOL_NAMES,
} from '../write/constants.js';
import { WRITE_STANDARD_SCHEMAS } from '../write/schemas.js';

/**
 * WP11 — drift-proof tool reference.
 *
 * Documentation is derived from the *advertised* JSON Schema of every shipped
 * Zod input schema (the same object the MCP server serves in `tools/list`),
 * plus the exact description maps the registry registers. There is no
 * hand-maintained field list, so a schema change cannot silently leave the
 * docs stale: `tests/unit/tool-reference.test.ts` regenerates in memory and
 * fails CI if `TOOLS.md` no longer matches byte-for-byte.
 *
 * Deterministic and offline: config is built from a fixed, secret-free env,
 * never from `process.env`, and no clock or network value is emitted.
 */

export const TOOLS_DOC_PATH = 'TOOLS.md';

/** Documentation-only placeholder — not a credential and never emitted. */
const DOCS_ENV: NodeJS.ProcessEnv = {
  USER_AGENT: 'WikiMCP-Docs/1.0 (documentation build)',
};

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: readonly unknown[];
  items?: { type?: string; enum?: readonly unknown[] };
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
}

interface ToolJsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

interface StandardSchemaLike {
  '~standard': {
    jsonSchema: {
      input: (options?: unknown) => ToolJsonSchema;
    };
  };
}

export interface ToolFieldDoc {
  name: string;
  type: string;
  required: boolean;
  default: string;
  constraints: string;
  description: string;
}

export interface ToolDocEntry {
  name: string;
  description: string;
  isWrite: boolean;
  fields: readonly ToolFieldDoc[];
}

const asSchemaMap = (value: object): Record<string, StandardSchemaLike> =>
  value as unknown as Record<string, StandardSchemaLike>;

const asDescriptionMap = (value: object): Record<string, string> =>
  value as unknown as Record<string, string>;

function advertisedSchema(schema: StandardSchemaLike): ToolJsonSchema {
  return schema['~standard'].jsonSchema.input();
}

function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function renderType(property: JsonSchemaProperty): string {
  const base = property.type ?? 'unknown';
  if (property.enum !== undefined && property.enum.length > 0) {
    return `enum: ${property.enum.map((value) => String(value)).join(' | ')}`;
  }
  if (base === 'array' && property.items !== undefined) {
    const itemEnum = property.items.enum;
    if (itemEnum !== undefined && itemEnum.length > 0) {
      return `array<enum: ${itemEnum.map((value) => String(value)).join(' | ')}>`;
    }
    return `array<${property.items.type ?? 'unknown'}>`;
  }
  return base;
}

function renderConstraints(property: JsonSchemaProperty): string {
  const parts: string[] = [];
  if (property.minLength !== undefined || property.maxLength !== undefined) {
    if (property.minLength !== undefined && property.maxLength !== undefined) {
      parts.push(`${property.minLength}..${property.maxLength} chars`);
    } else if (property.minLength !== undefined) {
      parts.push(`min ${property.minLength} chars`);
    } else {
      parts.push(`max ${property.maxLength} chars`);
    }
  }
  if (property.minimum !== undefined || property.maximum !== undefined) {
    if (property.minimum !== undefined && property.maximum !== undefined) {
      parts.push(`${property.minimum}..${property.maximum}`);
    } else if (property.minimum !== undefined) {
      parts.push(`min ${property.minimum}`);
    } else {
      parts.push(`max ${property.maximum}`);
    }
  }
  if (property.minItems !== undefined || property.maxItems !== undefined) {
    if (property.minItems !== undefined && property.maxItems !== undefined) {
      parts.push(`${property.minItems}..${property.maxItems} items`);
    } else if (property.minItems !== undefined) {
      parts.push(`min ${property.minItems} items`);
    } else {
      parts.push(`max ${property.maxItems} items`);
    }
  }
  if (property.pattern !== undefined) parts.push(`pattern \`${property.pattern}\``);
  return parts.length > 0 ? parts.join('; ') : '—';
}

/** Collect every registered tool with its shipped schema fields, in registry order. */
export function collectToolDocs(): ToolDocEntry[] {
  // Group B schemas are config-dependent (advertised WDQS limits). Use the
  // documented defaults from a fixed env so output is byte-stable in CI.
  const config = loadConfig(DOCS_ENV);
  const schemas: Record<string, StandardSchemaLike> = {
    ...asSchemaMap(TOOL_SCHEMAS),
    ...asSchemaMap(buildGroupBSchemas(config)),
    ...asSchemaMap(GROUP_C_SCHEMAS),
    ...asSchemaMap(GROUP_F_SCHEMAS),
    ...asSchemaMap(GROUP_G_SCHEMAS),
    ...asSchemaMap(GROUP_D_SCHEMAS),
    ...asSchemaMap(WRITE_STANDARD_SCHEMAS),
  };
  const descriptions: Record<string, string> = {
    ...asDescriptionMap(TOOL_DESCRIPTIONS),
    ...asDescriptionMap(GROUP_B_DESCRIPTIONS),
    ...asDescriptionMap(GROUP_C_DESCRIPTIONS),
    ...asDescriptionMap(GROUP_F_DESCRIPTIONS),
    ...asDescriptionMap(GROUP_G_DESCRIPTIONS),
    ...asDescriptionMap(GROUP_D_DESCRIPTIONS),
    ...asDescriptionMap(WRITE_DESCRIPTIONS),
  };

  const entries: ToolDocEntry[] = [];
  for (const name of TOOL_NAMES) {
    const schema = schemas[name];
    const description = descriptions[name];
    if (schema === undefined || description === undefined) {
      throw new Error(`tool-reference: registered tool '${name}' has no shipped schema or description`);
    }
    const jsonSchema = advertisedSchema(schema);
    const properties = jsonSchema.properties ?? {};
    const required = jsonSchema.required ?? [];
    const fields: ToolFieldDoc[] = Object.entries(properties).map(([fieldName, property]) => ({
      name: fieldName,
      type: renderType(property),
      required: required.includes(fieldName),
      default: property.default === undefined ? '—' : JSON.stringify(property.default),
      constraints: renderConstraints(property),
      description: mdCell(property.description ?? '—'),
    }));
    entries.push({
      name,
      description: mdCell(description),
      isWrite: (WRITE_TOOL_NAMES as readonly string[]).includes(name),
      fields,
    });
  }
  return entries;
}

/** Render one tool section. Kept exportable so drift can be proven in a test. */
export function renderToolSection(entry: ToolDocEntry): string[] {
  const lines: string[] = [`## \`${entry.name}\``, '', entry.description, ''];
  if (entry.isWrite) {
    lines.push('**Gated write tool** — never auto-confirmed; all write controls remain active.', '');
  }
  lines.push('| Field | Type | Required | Default | Constraints | Description |');
  lines.push('|---|---|---|---|---|---|');
  for (const field of entry.fields) {
    lines.push(
      `| \`${field.name}\` | ${mdCell(field.type)} | ${field.required ? 'yes' : 'no'} `
      + `| ${mdCell(field.default)} | ${mdCell(field.constraints)} | ${field.description} |`,
    );
  }
  lines.push('');
  return lines;
}

/** Generate the full Markdown reference as a deterministic string. */
export function buildToolReference(): string {
  const entries = collectToolDocs();
  const readOnlyCount = entries.length - WRITE_TOOL_NAMES.length;
  const lines: string[] = [
    '# Wikimedia MCP — tool reference',
    '',
    '> **Generated file — do not edit by hand.** Run `npm run docs:tools` to regenerate.',
    '> Derived from the shipped Zod input schemas (the same advertised JSON Schema served in `tools/list`), so the reference cannot drift from the implementation.',
    '> A schema change without regeneration fails `tests/unit/tool-reference.test.ts` in CI.',
    '',
    `Scope: the ${entries.length}-tool default catalogue (${readOnlyCount} read-only + ${WRITE_TOOL_NAMES.length} gated write tools). Tool order follows the registry \`TOOL_NAMES\`; field order follows schema declaration order.`,
    '',
    '---',
    '',
  ];
  for (const entry of entries) lines.push(...renderToolSection(entry));
  lines.push('---', '', 'Regenerate with `npm run docs:tools` after `npm run build`.', '');
  return lines.join('\n');
}

// Re-exported so the drift test can assert the registry order it derives from.
export { GROUP_B_TOOL_NAMES, TOOL_NAMES, WRITE_TOOL_NAMES };
