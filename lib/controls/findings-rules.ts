import {
  FINDING_TYPES,
  RULE_MODEL_NAMES,
  type BoqProgressRow,
  type ControlEvaluationRow,
  type FindingDraft,
  type SupplierPaymentRow,
  type ThreeWayMatchRow,
} from './findings-types';

/**
 * Pure, deterministic rule functions. Each takes plain normalized arrays and
 * returns insertable `FindingDraft`s. No database access here.
 */

function roundScore(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Rule 1 — duplicate supplier payments
// ---------------------------------------------------------------------------

function comparePayments(a: SupplierPaymentRow, b: SupplierPaymentRow): number {
  return (
    a.supplierInvoiceId.localeCompare(b.supplierInvoiceId) ||
    a.paymentDate.localeCompare(b.paymentDate) ||
    a.id.localeCompare(b.id)
  );
}

function paymentEvidenceRow(row: SupplierPaymentRow): Record<string, unknown> {
  return {
    id: row.id,
    supplierInvoiceId: row.supplierInvoiceId,
    supplierId: row.supplierId,
    paymentReference: row.paymentReference,
    paymentDate: row.paymentDate,
    grossPaidAmount: row.grossPaidAmount,
    netPaidAmount: row.netPaidAmount,
  };
}

/**
 * Flags (a) more than one payment recorded against the same supplier invoice,
 * and (b) payments with an identical (supplier, amount, date) signature spread
 * across different invoices.
 */
export function detectDuplicateSupplierPayments(rows: SupplierPaymentRow[]): FindingDraft[] {
  const drafts: FindingDraft[] = [];
  const sorted = [...rows].sort(comparePayments);

  for (const [invoiceId, group] of groupBy(sorted, (r) => r.supplierInvoiceId)) {
    if (group.length < 2) continue;
    const input = group.map(paymentEvidenceRow);
    drafts.push({
      findingType: FINDING_TYPES.DUPLICATE_SUPPLIER_PAYMENT,
      subjectType: 'supplier_invoice',
      subjectId: invoiceId,
      severity: 'high',
      score: roundScore(Math.min(1, 0.5 + 0.25 * (group.length - 1))),
      title: 'Multiple supplier payments against one invoice',
      explanation: `${group.length} supplier payments reference the same invoice. Confirm they are separate disbursements and not a duplicate payment.`,
      evidence: { supplierInvoiceId: invoiceId, paymentCount: group.length, input },
      modelName: RULE_MODEL_NAMES.DUPLICATE_SUPPLIER_PAYMENT,
    });
  }

  const bySignature = groupBy(sorted, (r) => `${r.supplierId}|${r.grossPaidAmount}|${r.paymentDate}`);
  for (const group of bySignature.values()) {
    const invoiceIds = new Set(group.map((r) => r.supplierInvoiceId));
    if (group.length < 2 || invoiceIds.size < 2) continue;
    const input = group.map(paymentEvidenceRow);
    const first = group[0];
    drafts.push({
      findingType: FINDING_TYPES.DUPLICATE_SUPPLIER_PAYMENT,
      subjectType: 'supplier_payment',
      subjectId: first.id,
      severity: 'high',
      score: roundScore(Math.min(1, 0.55 + 0.2 * (group.length - 1))),
      title: 'Identical supplier payments across invoices',
      explanation: `${group.length} payments to the same supplier share amount ${first.grossPaidAmount} and date ${first.paymentDate} across ${invoiceIds.size} invoices.`,
      evidence: {
        supplierId: first.supplierId,
        grossPaidAmount: first.grossPaidAmount,
        paymentDate: first.paymentDate,
        paymentCount: group.length,
        invoiceCount: invoiceIds.size,
        input,
      },
      modelName: RULE_MODEL_NAMES.DUPLICATE_SUPPLIER_PAYMENT,
    });
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Rule 2 — BOQ measured vs approved quantity
// ---------------------------------------------------------------------------

function boqEvidenceRow(row: BoqProgressRow): Record<string, unknown> {
  return {
    boqItemId: row.boqItemId,
    itemNumber: row.itemNumber,
    description: row.description,
    unit: row.unit,
    approvedQuantity: row.approvedQuantity,
    measuredQuantity: row.measuredQuantity,
  };
}

/** >= 1.0 of approved quantity is critical; [0.9, 1.0) is a medium warning. */
export function detectBoqOverruns(rows: BoqProgressRow[]): FindingDraft[] {
  const drafts: FindingDraft[] = [];
  const sorted = [...rows].sort(
    (a, b) => a.itemNumber.localeCompare(b.itemNumber) || a.boqItemId.localeCompare(b.boqItemId)
  );

  for (const row of sorted) {
    if (!(row.approvedQuantity > 0)) continue;
    const ratio = row.measuredQuantity / row.approvedQuantity;
    if (ratio < 0.9) continue;

    const overrun = ratio >= 1;
    const pct = roundScore(ratio * 100);
    drafts.push({
      findingType: overrun ? FINDING_TYPES.BOQ_OVER_APPROVED : FINDING_TYPES.BOQ_NEAR_OVERRUN,
      subjectType: 'boq_item',
      subjectId: row.boqItemId,
      severity: overrun ? 'critical' : 'medium',
      score: roundScore(Math.min(1, ratio)),
      title: overrun
        ? 'BOQ item measured beyond approved quantity'
        : 'BOQ item approaching approved quantity',
      explanation: `Item ${row.itemNumber} has ${row.measuredQuantity} measured vs ${row.approvedQuantity} approved (${pct}%).`,
      evidence: { ...boqEvidenceRow(row), ratio: roundScore(ratio), input: [boqEvidenceRow(row)] },
      modelName: RULE_MODEL_NAMES.BOQ_OVER_APPROVED,
    });
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Rule 3 — three-way match breaks
// ---------------------------------------------------------------------------

export function detectThreeWayMatchBreaks(rows: ThreeWayMatchRow[]): FindingDraft[] {
  const drafts: FindingDraft[] = [];
  const sorted = [...rows].sort(
    (a, b) =>
      a.supplierInvoiceId.localeCompare(b.supplierInvoiceId) ||
      a.runNumber - b.runNumber ||
      a.id.localeCompare(b.id)
  );

  for (const row of sorted) {
    const hasVariance = row.quantityVariance !== 0 || row.priceVariance !== 0;
    const isBreak =
      row.status === 'exception' || row.status === 'rejected' || row.exceptionCount > 0 || hasVariance;
    if (!isBreak) continue;

    const input = [
      {
        id: row.id,
        supplierInvoiceId: row.supplierInvoiceId,
        runNumber: row.runNumber,
        status: row.status,
        exceptionCount: row.exceptionCount,
        quantityVariance: row.quantityVariance,
        priceVariance: row.priceVariance,
        exceptionCodes: [...row.exceptionCodes].sort(),
      },
    ];
    const score = row.exceptionCount > 0 ? Math.min(1, 0.6 + 0.1 * row.exceptionCount) : 0.7;
    drafts.push({
      findingType: FINDING_TYPES.THREE_WAY_MATCH_BREAK,
      subjectType: 'three_way_match',
      subjectId: row.id,
      severity: 'high',
      score: roundScore(score),
      title: 'Three-way match exception',
      explanation: `Match run ${row.runNumber} for invoice ${row.supplierInvoiceId} is ${row.status} with ${row.exceptionCount} exception(s), quantity variance ${row.quantityVariance} and price variance ${row.priceVariance}.`,
      evidence: { ...input[0], input },
      modelName: RULE_MODEL_NAMES.THREE_WAY_MATCH_BREAK,
    });
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Rule 4 — blocked / warning control evaluations
// ---------------------------------------------------------------------------

function controlEvidenceRow(row: ControlEvaluationRow): Record<string, unknown> {
  return {
    id: row.id,
    controlRuleKey: row.controlRuleKey,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    actionAttempted: row.actionAttempted,
    result: row.result,
    severity: row.severity,
    evidence: row.evidence,
    evaluatedAt: row.evaluatedAt,
  };
}

/** `blocked` evaluations are high; `warning` evaluations are the medium variant. */
export function detectBlockedControls(rows: ControlEvaluationRow[]): FindingDraft[] {
  const drafts: FindingDraft[] = [];
  const sorted = [...rows].sort(
    (a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt) || a.id.localeCompare(b.id)
  );

  for (const row of sorted) {
    if (row.result !== 'blocked' && row.result !== 'warning') continue;
    const blocked = row.result === 'blocked';
    const input = [controlEvidenceRow(row)];
    drafts.push({
      findingType: blocked ? FINDING_TYPES.CONTROL_BLOCKED : FINDING_TYPES.CONTROL_WARNING,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      severity: blocked ? 'high' : 'medium',
      score: blocked ? 0.9 : 0.5,
      title: blocked ? 'Control blocked an action' : 'Control raised a warning',
      explanation: `Rule ${row.controlRuleKey} returned "${row.result}" for ${row.actionAttempted} on ${row.subjectType} ${row.subjectId}.`,
      evidence: { ...controlEvidenceRow(row), input },
      modelName: blocked ? RULE_MODEL_NAMES.CONTROL_BLOCKED : RULE_MODEL_NAMES.CONTROL_WARNING,
    });
  }

  return drafts;
}
