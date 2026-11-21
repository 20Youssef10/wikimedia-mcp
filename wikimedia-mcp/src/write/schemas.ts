import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { WRITE_DESCRIPTIONS, WRITE_TOOL_NAMES, type WriteToolName } from './constants.js';

const project = z.string().min(2).max(24).describe('Required project or alias, resolved to an allowlisted host.');
const lang = z.string().min(2).max(12).default('en').describe('Wikimedia language code.');
const title = z.string().min(1).max(512).describe('Canonical page title; whole page only.');
const reason = z.string().min(1).max(500).describe('Non-empty reason recorded in the log.');
const dryRun = z.boolean().default(false).describe('Preview only; perform no persistent write.');
const baseRevision = z.number().int().min(1);

export const editPageSchema = z.object({
  project, lang, title,
  text: z.string().min(1).max(2_000_000).describe('Full replacement wikitext; also bounded by MCP_WRITE_MAX_BYTES_PER_EDIT.'),
  summary: z.string().min(1).max(500).describe('Non-empty edit summary recorded in the revision.'),
  minor: z.boolean().default(false),
  base_revision: baseRevision.optional(),
  dry_run: dryRun,
}).strict();

export const protectPageSchema = z.object({
  project, lang, title,
  protections: z.array(z.object({
    type: z.enum(['edit', 'move', 'upload', 'create']),
    level: z.enum(['autoconfirmed', 'extendedconfirmed', 'sysop']),
    expiry: z.string().min(1).max(32),
  }).strict()).min(1).max(4)
    .refine((values) => new Set(values.map((value) => `${value.type}:${value.level}:${value.expiry}`)).size === values.length,
      'protections must be unique')
    .describe('Protection rules to apply; captured prior rules are included in the preview.'),
  reason,
  base_revision: baseRevision.optional(),
  dry_run: dryRun,
}).strict();

export const movePageSchema = z.object({
  project, lang,
  from: z.string().min(1).max(512).describe('Current canonical page title.'),
  to: z.string().min(1).max(512).describe('Destination canonical page title.'),
  reason,
  movetalk: z.boolean().default(true),
  noredirect: z.boolean().default(false),
  base_revision: baseRevision.optional(),
  dry_run: dryRun,
}).strict();

export const deletePageSchema = z.object({
  project, lang, title, reason,
  base_revision: baseRevision.describe('Expected current revision; required for delete.'),
  dry_run: dryRun,
}).strict();

export const uploadFileSchema = z.object({
  project, lang,
  filename: z.string().min(4).max(255).describe('Target file name, with or without the File: prefix.'),
  content_base64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).describe('Base64 file bytes.'),
  mime: z.enum(['image/png', 'image/jpeg', 'image/gif']),
  description: z.string().min(1).max(20_000),
  summary: z.string().min(1).max(500),
  license: z.enum(['CC-BY-SA-4.0', 'CC-BY-4.0', 'CC0-1.0', 'PD', 'OWN-WORK-AUTHORISED']),
  attribution: z.string().min(1).max(500),
  author: z.string().min(1).max(255),
  source_url: z.string().min(1).max(2048),
  dry_run: dryRun,
}).strict();

export const WRITE_SCHEMAS = {
  edit_page: editPageSchema,
  protect_page: protectPageSchema,
  move_page: movePageSchema,
  delete_page: deletePageSchema,
  upload_file: uploadFileSchema,
} as const satisfies Record<WriteToolName, z.ZodType>;

/** Add `uniqueItems:true` to array fields Zod validates via refine (v4 omits it). */
function advertise<T extends z.ZodType>(schema: T, arrayFields: readonly string[]): StandardSchemaWithJSON {
  const standard = schema['~standard'];
  const json = standard.jsonSchema as {
    input: (options?: unknown) => Record<string, unknown>;
    output: (options?: unknown) => Record<string, unknown>;
  };
  const patch = (value: Record<string, unknown>): Record<string, unknown> => {
    const properties = value['properties'];
    if (properties === null || typeof properties !== 'object') return value;
    const fields = { ...(properties as Record<string, unknown>) };
    for (const field of arrayFields) {
      const entry = fields[field];
      if (entry !== null && typeof entry === 'object') {
        fields[field] = { ...(entry as Record<string, unknown>), uniqueItems: true };
      }
    }
    return { ...value, properties: fields };
  };
  return {
    '~standard': {
      ...standard,
      jsonSchema: { input: (o?: unknown) => patch(json.input(o)), output: (o?: unknown) => patch(json.output(o)) },
    },
  } as unknown as StandardSchemaWithJSON;
}

export const WRITE_STANDARD_SCHEMAS: Record<WriteToolName, StandardSchemaWithJSON> = {
  edit_page: advertise(editPageSchema, []),
  protect_page: advertise(protectPageSchema, ['protections']),
  move_page: advertise(movePageSchema, []),
  delete_page: advertise(deletePageSchema, []),
  upload_file: advertise(uploadFileSchema, []),
};

export type WriteInputs = {
  edit_page: z.infer<typeof editPageSchema>;
  protect_page: z.infer<typeof protectPageSchema>;
  move_page: z.infer<typeof movePageSchema>;
  delete_page: z.infer<typeof deletePageSchema>;
  upload_file: z.infer<typeof uploadFileSchema>;
};

export function writeToolDescription(name: WriteToolName): string {
  return WRITE_DESCRIPTIONS[name];
}

export { WRITE_TOOL_NAMES };
