#!/usr/bin/env node
// WP11 — thin ESM entry for `npm run docs:tools`.
// Run AFTER `npm run build`: node scripts/gen-tool-reference.mjs [--check]
// Derives TOOLS.md from the shipped schemas in dist/ (no network, no secrets).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, 'dist', 'cli', 'tool-reference.js');
if (!existsSync(entry)) {
  console.error('FAIL  dist/cli/tool-reference.js not found — run `npm run build` first.');
  process.exit(1);
}
const { buildToolReference, TOOLS_DOC_PATH } = await import(entry);
const generated = buildToolReference();
const outPath = join(root, TOOLS_DOC_PATH);

if (process.argv.includes('--check')) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  if (current !== generated) {
    console.error(`FAIL  ${TOOLS_DOC_PATH} is stale — run \`npm run docs:tools\` and commit the result.`);
    process.exit(1);
  }
  console.log(`OK  ${TOOLS_DOC_PATH} is current (${generated.length} bytes)`);
  process.exit(0);
}

writeFileSync(outPath, generated, 'utf8');
console.log(`Wrote ${TOOLS_DOC_PATH} (${generated.length} bytes)`);
