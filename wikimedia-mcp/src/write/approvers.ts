import { hashPrefix } from './auth.js';

/**
 * WP4 — two-person approver identity helper (G11). Validates two DISTINCT
 * configured approver subjects/groups and returns `sha256-prefix:` hashes for
 * storage. It does NOT supply identities, sign anything, or widen the existing
 * approval rule: failures still map to the `approval_required` path.
 */

export type ApproverRejectionReason =
  | 'approval_disabled'
  | 'missing'
  | 'unconfigured'
  | 'duplicate'
  | 'self_approval';

export type ApproverValidation =
  | { ok: true; approvedIds: string[]; hashedIds: string[] }
  | { ok: false; reason: ApproverRejectionReason; message: string };

export type ValidateApproversInput = {
  approvals: readonly string[] | undefined;
  approverIds: readonly string[];
  requesterSub?: string;
  twoPersonApproval: boolean;
  hash?: (value: string) => string;
};

function reject(reason: ApproverRejectionReason, message: string): ApproverValidation {
  return { ok: false, reason, message };
}

/**
 * Validate two distinct configured approvers, neither of them the requester.
 * Raw subjects are never returned: only `sha256-prefix:` hashes are emitted
 * for storage in audit/log fields.
 */
export function validateApprovers(input: ValidateApproversInput): ApproverValidation {
  if (!input.twoPersonApproval) {
    return reject('approval_disabled', 'Two-person approval may not be disabled for this tool.');
  }
  const list = input.approvals ?? [];
  if (list.length < 2) {
    return reject('missing', 'Two distinct configured approvers, neither the requester, are required.');
  }
  const distinct = [...new Set(list)];
  if (distinct.length !== list.length) {
    return reject('duplicate', 'A repeated approver identity is not two distinct approvers.');
  }
  for (const id of distinct) {
    if (!input.approverIds.includes(id)) {
      return reject('unconfigured', 'An approver identity is not in the configured allowlist.');
    }
    if (input.requesterSub !== undefined && id === input.requesterSub) {
      return reject('self_approval', 'The requester may not approve their own request.');
    }
  }
  if (distinct.length < 2) {
    return reject('missing', 'Two distinct configured approvers, neither the requester, are required.');
  }
  const hash = input.hash ?? hashPrefix;
  return {
    ok: true,
    approvedIds: distinct,
    hashedIds: distinct.map((id) => hash(id)),
  };
}
