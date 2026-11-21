import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildToolReference, collectToolDocs, renderToolSection, TOOLS_DOC_PATH,
  TOOL_NAMES, type ToolDocEntry,
} from '../../src/cli/tool-reference.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC_PATH = path.resolve(ROOT, TOOLS_DOC_PATH);
const NO_SECRET = /(MCP_[A-Z0-9_]*SECRET|Bearer\s+|Authorization\s*:|client_secret|access_token|refresh_token|password\s*=)/i;

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

  it('exposes no secret or internal-only field (config keys and credentials)', () => {
    const entries = collectToolDocs();
    for (const entry of entries) {
      for (const field of entry.fields) {
        expect(field.name, `${entry.name}.${field.name} looks secret-like`).not.toMatch(/secret|token|password|credential|bearer/i);
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
    };
    const after = renderToolSection(expanded).join('\n');
    expect(after).toContain('| `additive_field` |');
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
