import { loadConfig } from '../config.js';
import { TOOL_NAMES } from '../server/tools/registry.js';
import { toolAnnotations, type ToolAnnotations } from '../server/tools/annotations.js';
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
 * plus the exact description maps the registry registers. Input fields are
 * derived, so a schema change cannot silently leave the docs stale.
 *
 * WP12–WP15 added *additive output fields* that have no Zod input schema, so
 * they cannot be derived from `tools/list`; they are documented from the
 * explicit OUTPUT_FIELDS registry below (a closed, code-verified set) plus the
 * shared annotation function used by the live server. `tests/unit/tool-
 * reference.test.ts` regenerates in memory and fails CI if `TOOLS.md` no
 * longer matches byte-for-byte.
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
  outputFields: readonly OutputFieldDoc[];
  annotations: ToolAnnotations;
}

/** An additive output field documented for a tool (WP12–WP15). */
export interface OutputFieldDoc {
  /** Field name as it appears in the JSON payload (dot path for nested fields). */
  name: string;
  /** Human-readable JSON type, including closed enums. */
  type: string;
  /** True when the field is optional / additively omitted when not applicable. */
  optional: boolean;
  /** Where in the result envelope the field appears. */
  location: string;
  description: string;
}

/* -------------------------------------------------------------------------- */
/* Additive output fields (WP12–WP15)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Source of truth for documented additive output fields. Every entry here is
 * a field the code actually emits; no field is inferred or invented. The
 * closed sets live in `src/types.ts` (`RelevanceReason`, `CacheTier`) and the
 * emitters live in `src/resolver.ts`, `src/protocol/{caching,errors,result}.ts`.
 * Normal input fields remain derived from the advertised JSON Schema above.
 */
const RELEVANCE_REASON_VALUES = 'title_exact | title_prefix | title_contains | snippet_match | description_match | unspecified';

const REASON_FIELD: Omit<OutputFieldDoc, 'location'> = {
  name: 'relevance_reason',
  type: `enum: ${RELEVANCE_REASON_VALUES}`,
  optional: true,
  description: 'WP12 — bounded, explainable reason the item matched; never reorders results.',
};
const CANONICAL_TITLE_FIELD: Omit<OutputFieldDoc, 'location'> = {
  name: 'canonical_title',
  type: 'string',
  optional: true,
  description: 'WP12 — title derived only from the allowlisted target; omitted for malformed/over-long titles.',
};
const CANONICAL_URL_FIELD: Omit<OutputFieldDoc, 'location'> = {
  name: 'canonical_url',
  type: 'string',
  optional: true,
  description: 'WP12 — article URL derived only from the allowlisted target.',
};
const CANONICAL_SOURCE_FIELD: Omit<OutputFieldDoc, 'location'> = {
  name: 'canonical_source',
  type: 'string',
  optional: true,
  description: 'WP12 — allowlisted lang/project source identifier (e.g. `wikipedia:en`).',
};
const CACHE_TIER_FIELD: OutputFieldDoc = {
  name: 'cache_tier',
  type: 'enum: metadata | content',
  optional: true,
  location: 'top-level success payload',
  description: 'WP13 — tier that served the result: `metadata` (strict TTL) or `content` (bounded ETag/Cache-Control revalidation); present only on cacheable responses.',
};

const inItems = (location: string): OutputFieldDoc[] => [
  REASON_FIELD, CANONICAL_TITLE_FIELD, CANONICAL_URL_FIELD, CANONICAL_SOURCE_FIELD,
].map((field) => ({ ...field, location }));

/**
 * Per-tool additive success fields, keyed by registered tool name. Only the
 * three tools that emit WP12/WP13 additive fields are listed; all other tools
 * still receive the common error/provenance fields below.
 */
export const OUTPUT_FIELDS: Readonly<Record<string, readonly OutputFieldDoc[]>> = Object.freeze({
  search: inItems('`results[]` items'),
  get_related_pages: [...inItems('`related[]` / `pages[]` items'), CACHE_TIER_FIELD],
  get_summary: [CACHE_TIER_FIELD],
});

/** WP14 — error-envelope fields emitted for every tool's error result. */
export const ERROR_OUTPUT_FIELDS: readonly OutputFieldDoc[] = Object.freeze([
  {
    name: 'error.suggested_tool',
    type: 'string',
    optional: true,
    location: '`error` object (error results only)',
    description: 'WP14 — registered tool that is the unambiguous recovery step; absent when no such tool exists.',
  },
  {
    name: 'error.next_action',
    type: 'string',
    optional: true,
    location: '`error` object (error results only)',
    description: 'WP14 — deterministic next step for the error; absent when no unique recovery exists.',
  },
]);

/** WP15 — compact provenance block on read-only success payloads. */
export const PROVENANCE_OUTPUT_FIELDS: readonly OutputFieldDoc[] = Object.freeze([
  {
    name: 'provenance_block',
    type: 'object',
    optional: true,
    location: 'top-level success payload (read-only tools)',
    description: 'WP15 — compact block with `source`, `license`, `attribution`, `attribution_text`, `disclaimer` and optional `hint`; derived from the unchanged flat provenance fields.',
  },
]);

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
    const isWrite = (WRITE_TOOL_NAMES as readonly string[]).includes(name);
    const outputFields: OutputFieldDoc[] = [
      ...ERROR_OUTPUT_FIELDS,
      ...(isWrite ? [] : PROVENANCE_OUTPUT_FIELDS),
      ...(OUTPUT_FIELDS[name] ?? []),
    ];
    entries.push({
      name,
      description: mdCell(description),
      isWrite,
      fields,
      outputFields,
      annotations: toolAnnotations(name),
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

  lines.push('**Output fields** (additive fields the code emits, with WP12–WP15 provenance):', '');
  lines.push('| Field | Type | Optional | Location | Description |');
  lines.push('|---|---|---|---|---|');
  for (const field of entry.outputFields) {
    lines.push(
      `| \`${field.name}\` | ${mdCell(field.type)} | ${field.optional ? 'yes' : 'no'} `
      + `| ${mdCell(field.location)} | ${mdCell(field.description)} |`,
    );
  }
  lines.push('');

  const a = entry.annotations;
  lines.push(
    `**Annotations:** \`readOnlyHint: ${a.readOnlyHint}\`, \`destructiveHint: ${a.destructiveHint}\`, `
    + `\`openWorldHint: ${a.openWorldHint}\`, \`idempotentHint: ${a.idempotentHint}\`.`,
    '',
  );
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
    '> Input fields are derived from the shipped Zod input schemas (the same advertised JSON Schema served in `tools/list`); annotations come from the same pure function the server registers.',
    '> Additive output fields (WP12–WP15) are documented from the closed `OUTPUT_FIELDS` registry in `src/cli/tool-reference.ts` — the only fields the code actually emits beyond each tool\'s core result shape.',
    '> Any change to a schema, output field or annotation without regeneration fails `tests/unit/tool-reference.test.ts` in CI.',
    '',
    `Scope: the ${entries.length}-tool default catalogue (${readOnlyCount} read-only + ${WRITE_TOOL_NAMES.length} gated write tools). Tool order follows the registry \`TOOL_NAMES\`; input field order follows schema declaration order. Each tool lists its input schema, additive output fields and MCP annotations.`,
    '',
    '---',
    '',
  ];
  for (const entry of entries) lines.push(...renderToolSection(entry));
  lines.push('---', '', 'Regenerate with `npm run docs:tools` after `npm run build`.', '');
  return lines.join('\n');
}

// Re-exported so the drift test can assert the registry order and known fields it derives from.
export { GROUP_B_TOOL_NAMES, TOOL_NAMES, WRITE_TOOL_NAMES };
