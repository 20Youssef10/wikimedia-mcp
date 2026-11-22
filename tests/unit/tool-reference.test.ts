import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toolAnnotations } from '../../src/server/tools/annotations.js';
import { WRITE_ANNOTATIONS } from '../../src/write/constants.js';
import {
  buildToolReference, collectToolDocs, renderToolSection, TOOLS_DOC_PATH,
  TOOL_NAMES, WRITE_TOOL_NAMES,
  ERROR_OUTPUT_FIELDS, OUTPUT_FIELDS, PROVENANCE_OUTPUT_FIELDS,
  type OutputFieldDoc, type ToolDocEntry,
} from '../../src/cli/tool-reference.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC_PATH = path.resolve(ROOT, TOOLS_DOC_PATH);
const NO_SECRET = /(MCP_[A-Z0-9_]*SECRET|Bearer\s+|Authorization\s*:|client_secret|access_token|refresh_token|password\s*=)/i;
const SECRET_FIELD = /secret|token|password|credential|bearer/i;

/** All eight WP12–WP15 additive output field names, verbatim. */
const KNOWN_ADDITIVE_FIELDS = [
  'relevance_reason', 'canonical_title', 'canonical_url', 'canonical_source',
  'cache_tier', 'error.suggested_tool', 'error.next_action', 'provenance_block',
] as const;

describe('WP11 — drift-proof tool reference', () => {
  it('generates byte-identical output on two consecutive runs', () => {
    expect(buildToolReference()).toBe(buildToolReference());
  });

  it('DRIFT GATE: regenerated output matches the committed TOOLS.md byte-for-byte', () => {
    const committed = readFileSync(DOC_PATH, 'utf8');
    const regenerated = buildToolReference();
    expect(regenerated, 'TOOLS.md is stale — run `npm run docs:tools` and commit the result').toBe(committed);
    expect(committed.endsWith('\n')).toBe(true);
  });

  it('covers every registered tool and every shipped schema field, in registry order', () => {
    const entries = collectToolDocs();
    expect(entries.map((entry) => entry.name)).toEqual([...TOOL_NAMES]);
    const doc = readFileSync(DOC_PATH, 'utf8');
    for (const entry of entries) {
      expect(doc, `missing tool section for ${entry.name}`).toContain(`## \`${entry.name}\``);
      expect(doc, `missing tool description for ${entry.name}`).toContain(entry.description);
      for (const field of entry.fields) {
        expect(doc, `${entry.name}.${field.name} missing`).toContain(`| \`${field.name}\` |`);
        expect(field.type.length).toBeGreaterThan(0);
      }
    }
    // 28 registered tools, and the documented default catalogue counts agree.
    expect(entries).toHaveLength(28);
    expect(doc).toContain('the 28-tool default catalogue (23 read-only + 5 gated write tools)');
  });

  it('renders an output-fields table and annotations block for every one of the 28 tools', () => {
    const entries = collectToolDocs();
    expect(entries).toHaveLength(28);
    const doc = readFileSync(DOC_PATH, 'utf8');
    for (const entry of entries) {
      const section = renderToolSection(entry).join('\n');
      expect(section, `${entry.name} missing output-fields header`).toContain('**Output fields**');
      expect(section, `${entry.name} missing Output field table header`).toContain('| Field | Type | Optional | Location | Description |');
      expect(section, `${entry.name} missing annotations`).toContain('**Annotations:**');
      for (const key of ['readOnlyHint', 'destructiveHint', 'openWorldHint', 'idempotentHint']) {
        expect(section, `${entry.name} missing ${key}`).toContain(`${key}:`);
      }
      expect(entry.outputFields.length, `${entry.name} has no documented output fields`).toBeGreaterThan(0);
      for (const field of entry.outputFields) {
        expect(doc, `${entry.name} output field ${field.name} missing from TOOLS.md`).toContain(`| \`${field.name}\` |`);
        expect(field.type.length, `${field.name} has empty type`).toBeGreaterThan(0);
        expect(field.description.length, `${field.name} has empty description`).toBeGreaterThan(0);
        expect(field.location.length, `${field.name} has empty location`).toBeGreaterThan(0);
      }
    }
  });

  it('documents all known WP12–WP15 additive output fields', () => {
    const entries = collectToolDocs();
    const documented = new Set(entries.flatMap((entry) => entry.outputFields.map((f) => f.name)));
    for (const name of KNOWN_ADDITIVE_FIELDS) {
      expect(documented.has(name), `additive output field '${name}' is not documented`).toBe(true);
    }
    const doc = readFileSync(DOC_PATH, 'utf8');
    for (const name of KNOWN_ADDITIVE_FIELDS) {
      expect(doc, `additive output field '${name}' missing from TOOLS.md`).toContain(`\`${name}\``);
    }
    // The registry constants stay in lock-step with the rendered entries.
    for (const field of [...ERROR_OUTPUT_FIELDS, ...PROVENANCE_OUTPUT_FIELDS]) {
      expect(documented.has(field.name)).toBe(true);
    }
    expect(Object.values(OUTPUT_FIELDS).flat().map((f) => f.name)).toContain('relevance_reason');
  });

  it('attributes per-tool additive fields only to the tools that emit them', () => {
    const byName = new Map(collectToolDocs().map((entry) => [entry.name, entry.outputFields.map((f) => f.name)]));
    const has = (tool: string, field: string): boolean => byName.get(tool)?.includes(field) === true;

    for (const field of ['relevance_reason', 'canonical_title', 'canonical_url', 'canonical_source']) {
      expect(has('search', field), `search.${field}`).toBe(true);
      expect(has('get_related_pages', field), `get_related_pages.${field}`).toBe(true);
    }
    expect(has('get_summary', 'cache_tier')).toBe(true);
    expect(has('get_related_pages', 'cache_tier')).toBe(true);

    // No other tool emits the ranking/canonical hints or the content cache tier.
    const additiveOnly = ['relevance_reason', 'canonical_title', 'canonical_url', 'canonical_source', 'cache_tier'];
    for (const [tool, fields] of byName) {
      if (tool === 'search' || tool === 'get_related_pages' || tool === 'get_summary') continue;
      for (const field of additiveOnly) {
        expect(fields, `${tool} must not document ${field}`).not.toContain(field);
      }
    }

    // WP14 error fields appear on every tool; WP15 block only on read-only ones.
    for (const [tool, fields] of byName) {
      expect(fields, `${tool} missing error.suggested_tool`).toContain('error.suggested_tool');
      expect(fields, `${tool} missing error.next_action`).toContain('error.next_action');
      expect(fields.includes('provenance_block')).toBe(!WRITE_TOOL_NAMES.includes(tool as typeof WRITE_TOOL_NAMES[number]));
    }
  });

  it('renders annotations that match the shared server function', () => {
    const byName = new Map(collectToolDocs().map((entry) => [entry.name, entry]));
    for (const [name, entry] of byName) {
      expect(entry.annotations, `annotations for ${name}`).toEqual(toolAnnotations(name));
    }
    // Write tools carry the frozen write annotation set.
    for (const name of WRITE_TOOL_NAMES) {
      expect(byName.get(name)?.annotations).toEqual({ ...WRITE_ANNOTATIONS });
    }
    // All read tools are read-only / non-destructive / open-world.
    const nonIdempotentRead = new Set(['get_random_page', 'get_feed', 'get_recent_changes']);
    for (const [name, entry] of byName) {
      if (WRITE_TOOL_NAMES.includes(name as typeof WRITE_TOOL_NAMES[number])) continue;
      expect(entry.annotations.readOnlyHint, `${name} readOnlyHint`).toBe(true);
      expect(entry.annotations.destructiveHint, `${name} destructiveHint`).toBe(false);
      expect(entry.annotations.openWorldHint, `${name} openWorldHint`).toBe(true);
      expect(entry.annotations.idempotentHint, `${name} idempotentHint`).toBe(!nonIdempotentRead.has(name));
    }
  });

  it('exposes no secret or internal-only field (config keys and credentials)', () => {
    const entries = collectToolDocs();
    for (const entry of entries) {
      for (const field of entry.fields) {
        expect(field.name, `${entry.name}.${field.name} looks secret-like`).not.toMatch(SECRET_FIELD);
      }
      for (const field of entry.outputFields) {
        expect(field.name, `${entry.name}.${field.name} output field looks secret-like`).not.toMatch(SECRET_FIELD);
      }
    }
    const doc = readFileSync(DOC_PATH, 'utf8');
    expect(doc).not.toMatch(NO_SECRET);
    expect(doc).not.toContain('MCP_WRITE_OAUTH_');
    expect(doc).not.toContain('MCP_MRTR_SECRET');
    expect(doc).not.toContain('MCP_CAPABILITY_SECRET');
  });

  it('is derived, not hand-maintained: a new field changes the rendered section', () => {
    const base = collectToolDocs()[0] as ToolDocEntry;
    const before = renderToolSection(base).join('\n');
    const additiveField: OutputFieldDoc = {
      name: 'additive_output_field',
      type: 'string',
      optional: true,
      location: 'top-level success payload',
      description: 'A future additive output field.',
    };
    const expanded: ToolDocEntry = {
      ...base,
      fields: [...base.fields, {
        name: 'additive_field',
        type: 'string',
        required: false,
        default: '—',
        constraints: '—',
        description: 'A future additive field.',
      }],
      outputFields: [...base.outputFields, additiveField],
    };
    const after = renderToolSection(expanded).join('\n');
    expect(after).toContain('| `additive_field` |');
    expect(after).toContain('| `additive_output_field` |');
    expect(after).not.toBe(before);
    // Existing rows are untouched — regeneration only adds additive documentation.
    for (const line of before.split('\n')) {
      if (line.startsWith('|')) expect(after).toContain(line);
    }
  });

  it('renders gated write tools with their warning marker only', () => {
    const entries = collectToolDocs();
    const writeNames = new Set(['edit_page', 'protect_page', 'move_page', 'delete_page', 'upload_file']);
    for (const entry of entries) {
      const rendered = renderToolSection(entry).join('\n');
      expect(rendered.includes('**Gated write tool**')).toBe(writeNames.has(entry.name));
    }
  });
});
