import { describe, it, expect } from 'vitest';
import {
  detectBlockedControls,
  detectBoqOverruns,
  detectDuplicateSupplierPayments,
  detectThreeWayMatchBreaks,
  existingFindingKeys,
  findingKey,
  inputSnapshotHash,
  prepareFindings,
  stableStringify,
  type BoqProgressRow,
  type ControlEvaluationRow,
  type FindingDraft,
  type SupplierPaymentRow,
  type ThreeWayMatchRow,
} from './findings';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const UUID_D = '44444444-4444-4444-8444-444444444444';

function payment(overrides: Partial<SupplierPaymentRow> = {}): SupplierPaymentRow {
  return {
    id: UUID_A,
    supplierInvoiceId: UUID_B,
    supplierId: UUID_C,
    paymentReference: 'PAY-1',
    paymentDate: '2026-01-15',
    grossPaidAmount: 10_000,
    netPaidAmount: 9_500,
    ...overrides,
  };
}

function boq(overrides: Partial<BoqProgressRow> = {}): BoqProgressRow {
  return {
    boqItemId: UUID_A,
    itemNumber: '1.01',
    description: 'Earthworks',
    unit: 'm3',
    approvedQuantity: 1_000,
    measuredQuantity: 500,
    ...overrides,
  };
}

function match(overrides: Partial<ThreeWayMatchRow> = {}): ThreeWayMatchRow {
  return {
    id: UUID_A,
    supplierInvoiceId: UUID_B,
    runNumber: 1,
    status: 'passed',
    exceptionCount: 0,
    quantityVariance: 0,
    priceVariance: 0,
    exceptionCodes: [],
    ...overrides,
  };
}

function evaluation(overrides: Partial<ControlEvaluationRow> = {}): ControlEvaluationRow {
  return {
    id: UUID_A,
    controlRuleKey: 'payment.gate',
    subjectType: 'supplier_invoice',
    subjectId: UUID_B,
    actionAttempted: 'approve_payment',
    result: 'blocked',
    severity: 'high',
    evidence: { reason: 'missing match' },
    evaluatedAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Hashing + dedupe helpers
// ---------------------------------------------------------------------------

describe('stableStringify + inputSnapshotHash', () => {
  it('serializes objects key-order independently', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('produces a 64-char lowercase hex hash of the draft input rows', () => {
    const [draft] = detectBoqOverruns([boq({ measuredQuantity: 950 })]);
    const hash = inputSnapshotHash(draft);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(inputSnapshotHash(draft));
  });

  it('changes when the underlying input rows change', () => {
    const [a] = detectBoqOverruns([boq({ measuredQuantity: 950 })]);
    const [b] = detectBoqOverruns([boq({ measuredQuantity: 990 })]);
    expect(inputSnapshotHash(a)).not.toBe(inputSnapshotHash(b));
  });
});

describe('prepareFindings dedupe', () => {
  it('skips a draft whose key already exists with a non-terminal status', () => {
    const drafts = detectBoqOverruns([boq({ measuredQuantity: 1_100 })]);
    const keys = existingFindingKeys(
      drafts.map((draft) => ({
        finding_type: draft.findingType,
        subject_type: draft.subjectType,
        subject_id: draft.subjectId,
        input_snapshot_hash: inputSnapshotHash(draft),
      }))
    );

    const result = prepareFindings(drafts, keys);
    expect(result.prepared).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('keeps distinct drafts and drops within-batch repeats', () => {
    const draft = detectBoqOverruns([boq({ measuredQuantity: 1_100 })])[0];
    const result = prepareFindings([draft, draft]);
    expect(result.prepared).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it('builds stable keys for null hashes', () => {
    expect(findingKey('T', 's', 'id', null)).toBe('T|s|id|');
    expect(existingFindingKeys([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rule 1 — duplicate supplier payments
// ---------------------------------------------------------------------------

describe('detectDuplicateSupplierPayments', () => {
  it('flags multiple payments against the same supplier invoice', () => {
    const drafts = detectDuplicateSupplierPayments([
      payment({ id: UUID_A, supplierInvoiceId: UUID_B }),
      payment({ id: UUID_D, supplierInvoiceId: UUID_B, paymentReference: 'PAY-2' }),
    ]);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].findingType).toBe('DUPLICATE_SUPPLIER_PAYMENT');
    expect(drafts[0].subjectType).toBe('supplier_invoice');
    expect(drafts[0].subjectId).toBe(UUID_B);
    expect(drafts[0].severity).toBe('high');
    expect(drafts[0].score).toBeGreaterThan(0);
    expect(drafts[0].score).toBeLessThanOrEqual(1);
    expect(drafts[0].evidence.input).toHaveLength(2);
  });

  it('flags identical (supplier, amount, date) payments across invoices', () => {
    const drafts = detectDuplicateSupplierPayments([
      payment({ id: UUID_A, supplierInvoiceId: UUID_B }),
      payment({ id: UUID_D, supplierInvoiceId: UUID_C, paymentReference: 'PAY-9' }),
    ]);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].subjectType).toBe('supplier_payment');
    expect(drafts[0].evidence.invoiceCount).toBe(2);
  });

  it('does not flag a single payment', () => {
    expect(detectDuplicateSupplierPayments([payment()])).toHaveLength(0);
  });

  it('does not flag distinct payments', () => {
    const drafts = detectDuplicateSupplierPayments([
      payment({ id: UUID_A, grossPaidAmount: 100, paymentDate: '2026-01-01' }),
      payment({ id: UUID_D, supplierInvoiceId: UUID_C, grossPaidAmount: 200, paymentDate: '2026-02-01' }),
    ]);
    expect(drafts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — BOQ overruns
// ---------------------------------------------------------------------------

describe('detectBoqOverruns', () => {
  it('marks >= 100% of approved quantity as critical BOQ_OVER_APPROVED', () => {
    const drafts = detectBoqOverruns([boq({ measuredQuantity: 1_150 })]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].findingType).toBe('BOQ_OVER_APPROVED');
    expect(drafts[0].severity).toBe('critical');
    expect(drafts[0].subjectType).toBe('boq_item');
    expect(drafts[0].score).toBe(1);
  });

  it('marks exactly 100% as critical', () => {
    const drafts = detectBoqOverruns([boq({ measuredQuantity: 1_000 })]);
    expect(drafts[0].findingType).toBe('BOQ_OVER_APPROVED');
    expect(drafts[0].severity).toBe('critical');
  });

  it('marks [90%, 100%) as a medium BOQ_NEAR_OVERRUN', () => {
    const drafts = detectBoqOverruns([boq({ measuredQuantity: 950 })]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].findingType).toBe('BOQ_NEAR_OVERRUN');
    expect(drafts[0].severity).toBe('medium');
    expect(drafts[0].score).toBeCloseTo(0.95, 5);
  });

  it('ignores items below 90%', () => {
    expect(detectBoqOverruns([boq({ measuredQuantity: 899 })])).toHaveLength(0);
  });

  it('ignores items with no approved quantity', () => {
    expect(detectBoqOverruns([boq({ approvedQuantity: 0, measuredQuantity: 500 })])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — three-way match breaks
// ---------------------------------------------------------------------------

describe('detectThreeWayMatchBreaks', () => {
  it('flags an exception status', () => {
    const drafts = detectThreeWayMatchBreaks([match({ status: 'exception', exceptionCount: 2 })]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].findingType).toBe('THREE_WAY_MATCH_BREAK');
    expect(drafts[0].subjectType).toBe('three_way_match');
    expect(drafts[0].severity).toBe('high');
    expect(drafts[0].evidence.input).toHaveLength(1);
  });

  it('flags a quantity variance even when status is passed', () => {
    const drafts = detectThreeWayMatchBreaks([match({ quantityVariance: 3 })]);
    expect(drafts).toHaveLength(1);
  });

  it('flags a price variance', () => {
    expect(detectThreeWayMatchBreaks([match({ priceVariance: -0.5 })])).toHaveLength(1);
  });

  it('ignores a clean passed match', () => {
    expect(detectThreeWayMatchBreaks([match()])).toHaveLength(0);
  });

  it('ignores a pending match with no variances', () => {
    expect(detectThreeWayMatchBreaks([match({ status: 'pending' })])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — blocked / warning controls
// ---------------------------------------------------------------------------

describe('detectBlockedControls', () => {
  it('maps blocked evaluations to CONTROL_BLOCKED (high)', () => {
    const drafts = detectBlockedControls([evaluation({ result: 'blocked' })]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].findingType).toBe('CONTROL_BLOCKED');
    expect(drafts[0].severity).toBe('high');
    expect(drafts[0].subjectType).toBe('supplier_invoice');
    expect(drafts[0].subjectId).toBe(UUID_B);
  });

  it('maps warning evaluations to CONTROL_WARNING (medium)', () => {
    const drafts = detectBlockedControls([evaluation({ id: UUID_D, result: 'warning' })]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].findingType).toBe('CONTROL_WARNING');
    expect(drafts[0].severity).toBe('medium');
  });

  it('ignores passed and overridden evaluations', () => {
    const rows = [evaluation({ result: 'passed' }), evaluation({ id: UUID_D, result: 'overridden' })];
    expect(detectBlockedControls(rows)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Every draft is insertable
// ---------------------------------------------------------------------------

describe('draft shape', () => {
  it('always carries an object evidence blob with hashable input rows', () => {
    const drafts: FindingDraft[] = [
      ...detectDuplicateSupplierPayments([
        payment({ id: UUID_A, supplierInvoiceId: UUID_B }),
        payment({ id: UUID_D, supplierInvoiceId: UUID_B }),
      ]),
      ...detectBoqOverruns([boq({ measuredQuantity: 950 })]),
      ...detectThreeWayMatchBreaks([match({ status: 'exception' })]),
      ...detectBlockedControls([evaluation()]),
    ];

    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) {
      expect(typeof draft.findingType).toBe('string');
      expect(typeof draft.subjectType).toBe('string');
      expect(typeof draft.subjectId).toBe('string');
      expect(['low', 'medium', 'high', 'critical']).toContain(draft.severity);
      expect(draft.score === null || (draft.score >= 0 && draft.score <= 1)).toBe(true);
      expect(draft.evidence.input).toBeDefined();
      expect(inputSnapshotHash(draft)).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
