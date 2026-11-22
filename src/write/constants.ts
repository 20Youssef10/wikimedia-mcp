import type { ToolErrorCode } from '../types.js';

/** Contract 16 §1.3 implementation order — frozen. */
export const WRITE_TOOL_NAMES = [
  'edit_page', 'protect_page', 'move_page', 'delete_page', 'upload_file',
] as const;
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];

/** Contract 16 §2.2 least-privilege scope map (no wildcards). */
export const WRITE_SCOPES: Record<WriteToolName, string> = {
  edit_page: 'edit',
  protect_page: 'protect',
  move_page: 'move',
  delete_page: 'delete',
  upload_file: 'upload',
};

/** Contract 16 §2.8 G11 — two distinct approvers for all but edit_page. */
export const TWO_PERSON_TOOLS: readonly WriteToolName[] = [
  'protect_page', 'move_page', 'delete_page', 'upload_file',
];

/** Contract 16 §2.1 scope allowlist — unknown/wildcard scopes rejected at boot. */
export const KNOWN_WRITE_SCOPES = new Set(Object.values(WRITE_SCOPES));

export const WRITE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
  idempotentHint: false,
});

export const CONFIRMATION_ID = 'confirm_write';

/** Mandated audit outcomes (contract 16 §2.5.1). */
export const AUDIT_OUTCOMES = new Set([
  'previewed', 'dry_run', 'executed', 'denied', 'failed', 'halted',
] as const);

export const WRITE_DESCRIPTIONS: Record<WriteToolName, string> = {
  edit_page: 'Replace the full wikitext of one allowlisted page after an exact-diff confirmation. Requires a valid write token, a summary and a signed single-use confirmation. Supports dry-run. Gated off by default.',
  protect_page: 'Change one page\'s protection levels after an exact-preview confirmation and two distinct approvals; prior levels are captured for rollback. Gated off by default.',
  move_page: 'Move one allowlisted page after an exact-preview confirmation and two distinct approvals; redirects and talk-page effects are explicit. Gated off by default.',
  delete_page: 'Delete one page after a base-revision-checked, reason-bearing confirmation and two distinct approvals; rollback is a recorded undelete. Gated off by default.',
  upload_file: 'Upload one small, MIME-checked media file after an exact-preview confirmation, two distinct approvals and a signed licence/ToU sign-off. Gated off by default.',
};

/** Error codes whose recovery text is always non-empty (contract 16 §3.3). */
export const WRITE_ERROR_CODES: readonly ToolErrorCode[] = [
  'validation_error', 'invalid_project', 'invalid_language', 'authentication_required',
  'invalid_issuer', 'insufficient_scope', 'confirmation_required', 'confirmation_invalid',
  'capability_invalid', 'blast_radius_exceeded', 'write_halted', 'target_changed',
  'approval_required', 'licence_not_signed_off', 'rate_limited', 'upstream_unavailable',
  'timeout', 'internal_error',
];
