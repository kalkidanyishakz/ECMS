import { createHash } from 'node:crypto';

/**
 * Shared types, rule metadata, and hashing/dedupe helpers for the deterministic
 * rules-based AI findings pipeline. No database access lives here.
 */

export type FindingSeverity = 'low' | 'medium' | 'high' | 'critical';

export type FindingDraft = {
  findingType: string;
  subjectType: string;
  subjectId: string;
  severity: FindingSeverity;
  score: number | null;
  title: string;
  explanation: string;
  evidence: Record<string, unknown>;
  modelName: string;
};

/** Stable model identifiers recorded on every generated finding. */
export const RULE_MODEL_NAMES = {
  DUPLICATE_SUPPLIER_PAYMENT: 'duplicate-supplier-payment-v1',
  BOQ_OVER_APPROVED: 'boq-overrun-v1',
  BOQ_NEAR_OVERRUN: 'boq-overrun-v1',
  THREE_WAY_MATCH_BREAK: 'three-way-match-v1',
  CONTROL_BLOCKED: 'control-blocked-v1',
  CONTROL_WARNING: 'control-warning-v1',
} as const;

export const FINDING_TYPES = {
  DUPLICATE_SUPPLIER_PAYMENT: 'DUPLICATE_SUPPLIER_PAYMENT',
  BOQ_OVER_APPROVED: 'BOQ_OVER_APPROVED',
  BOQ_NEAR_OVERRUN: 'BOQ_NEAR_OVERRUN',
  THREE_WAY_MATCH_BREAK: 'THREE_WAY_MATCH_BREAK',
  CONTROL_BLOCKED: 'CONTROL_BLOCKED',
  CONTROL_WARNING: 'CONTROL_WARNING',
} as const;

// ---------------------------------------------------------------------------
// Input row shapes (normalized: dates as ISO strings, decimals as numbers)
// ---------------------------------------------------------------------------

export type SupplierPaymentRow = {
  id: string;
  supplierInvoiceId: string;
  supplierId: string;
  paymentReference: string;
  paymentDate: string;
  grossPaidAmount: number;
  netPaidAmount: number;
};

export type BoqProgressRow = {
  boqItemId: string;
  itemNumber: string;
  description: string;
  unit: string | null;
  approvedQuantity: number;
  measuredQuantity: number;
};

export type ThreeWayMatchRow = {
  id: string;
  supplierInvoiceId: string;
  runNumber: number;
  status: string;
  exceptionCount: number;
  quantityVariance: number;
  priceVariance: number;
  exceptionCodes: string[];
};

export type ControlEvaluationRow = {
  id: string;
  controlRuleKey: string;
  subjectType: string;
  subjectId: string;
  actionAttempted: string;
  result: string;
  severity: string;
  evidence: Record<string, unknown>;
  evaluatedAt: string;
};

// ---------------------------------------------------------------------------
// Hashing + dedupe helpers
// ---------------------------------------------------------------------------

/** Deterministic JSON: object keys are sorted at every depth. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/** sha256 hex of the *input rows* that produced a finding. Always 64 chars. */
export function hashInputRows(rows: unknown): string {
  return createHash('sha256').update(stableStringify(rows), 'utf8').digest('hex');
}

/** The rows a draft was derived from, falling back to the whole evidence blob. */
export function findingInputRows(draft: FindingDraft): unknown {
  const input = draft.evidence.input;
  return input === undefined ? draft.evidence : input;
}

export function inputSnapshotHash(draft: FindingDraft): string {
  return hashInputRows(findingInputRows(draft));
}

/**
 * `ai_finding_status` has no `resolved` value, so the terminal states that
 * should NOT block re-creation are `dismissed` and `converted_to_issue`.
 */
export const DEDUPE_EXCLUDED_STATUSES: readonly string[] = ['dismissed', 'converted_to_issue'];

export function findingKey(
  findingType: string,
  subjectType: string,
  subjectId: string,
  inputHash: string | null
): string {
  return [findingType, subjectType, subjectId, inputHash ?? ''].join('|');
}

export type ExistingFindingKey = {
  finding_type: string;
  subject_type: string;
  subject_id: string;
  input_snapshot_hash: string | null;
};

export type PreparedFinding = { draft: FindingDraft; inputSnapshotHash: string };

/**
 * Compute each draft's input hash and drop any that already exist (by
 * finding_type + subject_type + subject_id + input_snapshot_hash) or that
 * repeat within this batch. Idempotent re-runs therefore create nothing.
 */
export function prepareFindings(
  drafts: FindingDraft[],
  existingKeys: ReadonlySet<string> = new Set()
): { prepared: PreparedFinding[]; skipped: number } {
  const seen = new Set(existingKeys);
  const prepared: PreparedFinding[] = [];
  let skipped = 0;
  for (const draft of drafts) {
    const inputSnapshotHashValue = inputSnapshotHash(draft);
    const key = findingKey(draft.findingType, draft.subjectType, draft.subjectId, inputSnapshotHashValue);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    prepared.push({ draft, inputSnapshotHash: inputSnapshotHashValue });
  }
  return { prepared, skipped };
}

export function existingFindingKeys(rows: ExistingFindingKey[]): Set<string> {
  return new Set(
    rows.map((row) => findingKey(row.finding_type, row.subject_type, row.subject_id, row.input_snapshot_hash))
  );
}
