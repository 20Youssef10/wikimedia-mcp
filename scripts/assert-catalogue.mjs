#!/usr/bin/env node
// Default-profile catalogue assertion (Product Owner risk acceptance, 2026-11-21).
// Run AFTER `npm run build`: node scripts/assert-catalogue.mjs
// Asserts 28 tools, five destructive write tools, and that NO write control was
// removed to achieve registration.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const registryPath = join(dist, 'server', 'tools', 'registry.js');
if (!existsSync(registryPath)) {
  console.error('FAIL  dist/server/tools/registry.js not found — run `npm run build` first.');
  process.exit(1);
}

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
};

const { TOOL_NAMES, activeToolNames, buildMcpServer } = await import(registryPath);
const WRITE_TOOLS = ['edit_page', 'protect_page', 'move_page', 'delete_page', 'upload_file'];
check(Array.isArray(TOOL_NAMES) && TOOL_NAMES.length === 28, `default catalogue has 28 tools (${TOOL_NAMES.length})`);
for (const name of WRITE_TOOLS) check(TOOL_NAMES.includes(name), `write tool registered: ${name}`);
check(new Set(TOOL_NAMES).size === TOOL_NAMES.length, 'catalogue has no duplicate names');
check(activeToolNames({ READ_ONLY_PROFILE: '1' }).length === 23, 'explicit read-only profile still asserts 23 tools');

// Annotations: the shipped write constants declare the destructive annotation
// object that the registry spreads onto all five write tools.
const annotationSource = readFileSync(join(dist, 'write', 'constants.js'), 'utf8');
check(/destructiveHint:\s*true/.test(annotationSource), 'write annotations declare destructiveHint:true');
check(/readOnlyHint:\s*false/.test(annotationSource), 'write annotations declare readOnlyHint:false');

// Control wiring — every one must be present in the shipped write handler.
const writeDir = join(dist, 'write');
const handlerSource = readFileSync(join(writeDir, 'handlers.js'), 'utf8');
const authSource = readFileSync(join(writeDir, 'auth.js'), 'utf8');
const auditSource = readFileSync(join(writeDir, 'audit.js'), 'utf8');
const controls = [
  [authSource.includes('validateAccessToken'), 'OAuth issuer/scope validation is wired'],
  [handlerSource.includes('.states.verify('), 'MRTR signed requestState verification is wired'],
  [handlerSource.includes('.capabilities.verify('), 'capability token verification is wired'],
  [handlerSource.includes('blast_radius_exceeded'), 'blast-radius limits are wired'],
  [handlerSource.includes('write_halted'), 'kill switch is wired'],
  [handlerSource.includes('.audit.append('), 'HMAC audit emission is wired'],
  [auditSource.includes('record_hash'), 'tamper-evident audit hash chain is wired'],
  [handlerSource.includes('dry_run'), 'dry-run diff path is wired'],
  [handlerSource.includes('approval_required'), 'two-person approval is wired'],
  [handlerSource.includes('licence_not_signed_off'), 'upload G8 sign-off check is wired'],
  [!/\bautoConfirm\b|\bskipConfirmation\b/.test(handlerSource), 'no auto-confirm bypass exists'],
];
for (const [ok, label] of controls) check(ok, label);

check(typeof buildMcpServer === 'function', 'server factory is exported');
check(existsSync(join(root, 'write-security', 'signoff.md')), 'risk-acceptance sign-off artefact exists');

if (failures.length > 0) {
  console.error(`\nCATALOGUE ASSERTION FAILED (${failures.length} check(s))`);
  process.exit(1);
}
console.log('\nCATALOGUE ASSERTION PASSED — 28 tools with all write controls active.');
