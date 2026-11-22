#!/usr/bin/env node
// WP2/WP5 — unified `wmcp` entry: gate status, gate record, rollback harness.
// Run AFTER `npm run build`: node scripts/wmcp.mjs <subcommand> ...

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, 'dist', 'cli', 'index.js');
if (!existsSync(entry)) {
  console.error('FAIL  dist/cli/index.js not found — run `npm run build` first.');
  process.exit(1);
}
const { runCli } = await import(entry);
process.exit(runCli(process.argv.slice(2)));
