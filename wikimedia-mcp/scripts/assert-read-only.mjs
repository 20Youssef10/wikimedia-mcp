#!/usr/bin/env node
// Shipped-artifact deployment assertion (report 08 gate G5).
// Run AFTER `npm run build`: node scripts/assert-read-only.mjs
// Proves the built server advertises no write tool and ships no write credential.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const registryPath = join(dist, 'server', 'tools', 'registry.js');

const WRITE_TOOL_DENYLIST = [
  'edit_page',   // report 05 §2 Group G — write
  'upload_file', // report 05 §2 Group G — upload
  'delete_page', // report 05 §2 Group G — delete
  'move_page',   // report 08 §1.1
  'protect_page',// report 08 §1.1
];
const WRITE_CREDENTIAL_KEY = /oauth|bot[_-]?password|write[_-]?(token|credential|secret)|(^|_)access[_-]?token|(^|_)refresh[_-]?token/i;

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
};

if (!existsSync(registryPath)) {
  console.error('FAIL  dist/server/tools/registry.js not found — run `npm run build` first.');
  process.exit(1);
}

// 1. Semantic check on the SHIPPED module's exported catalogue.
const { TOOL_NAMES } = await import(registryPath);
const overlap = TOOL_NAMES.filter((name) => WRITE_TOOL_DENYLIST.includes(name));
check(Array.isArray(TOOL_NAMES) && TOOL_NAMES.length > 0, `shipped catalogue is non-empty (${TOOL_NAMES.length} tools)`);
check(overlap.length === 0, `shipped TOOL_NAMES contains no write tool${overlap.length ? `: ${overlap.join(', ')}` : ''}`);

// 2. Static scan of every shipped JS file for a hardcoded write-tool registration.
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}
const registrationRe = new RegExp(
  `registerTool\\([\\s\\S]{0,80}?['"](${WRITE_TOOL_DENYLIST.join('|')})['"]`,
);
let shippedWriteRegistration = null;
for (const file of walk(dist)) {
  if (registrationRe.test(readFileSync(file, 'utf8'))) { shippedWriteRegistration = file; break; }
}
check(shippedWriteRegistration === null,
  `no shipped file registers a write tool${shippedWriteRegistration ? `: ${shippedWriteRegistration}` : ''}`);

// 3. Environment scan: no write-capable credential key may be set.
const envHits = Object.keys(process.env).filter((key) =>
  WRITE_CREDENTIAL_KEY.test(key) && (process.env[key] ?? '').trim().length > 0);
check(envHits.length === 0, `no write credential key in env${envHits.length ? `: ${envHits.join(', ')}` : ''}`);

// 4. Config scan: no write-credential field in the validated config object.
const { loadConfig } = await import(join(dist, 'config.js'));
const config = loadConfig({
  USER_AGENT: 'WikiMCP-ReadOnly-Assertion/1.0 (https://example.org/readonly; ops@example.org)',
  MCP_REQUIRE_ORIGIN: 'true',
  MCP_REQUIRE_CSRF: 'true',
  MCP_CSRF_SECRET: 'assertion-only-secret-value',
});
const configHits = Object.keys(config).filter((key) => WRITE_CREDENTIAL_KEY.test(key));
check(configHits.length === 0, `no write credential field in config${configHits.length ? `: ${configHits.join(', ')}` : ''}`);

if (failures.length > 0) {
  console.error(`\nREAD-ONLY ASSERTION FAILED (${failures.length} check(s))`);
  process.exit(1);
}
console.log('\nREAD-ONLY ASSERTION PASSED — no write tool or write credential in shipped artifact.');
