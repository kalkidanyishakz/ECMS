import { db as defaultDb } from '@/lib/db';
import { DEDUPE_EXCLUDED_STATUSES } from './findings-types';
import type {
  BoqProgressRow,
  ControlEvaluationRow,
  ExistingFindingKey,
  SupplierPaymentRow,
  ThreeWayMatchRow,
} from './findings-types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Normalization helpers (Prisma Decimal/Date -> plain JSON-safe values)
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const num = Number(value as number);
  return Number.isFinite(num) ? num : 0;
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Measurement statuses that represent executed work. `accepted_quantity` wins
// over `submitted_quantity` when present.
const COUNTED_MEASUREMENT_STATUSES = ['submitted', 'verified', 'included'];

export type ProjectFindingsSource = {
  paymentRows: SupplierPaymentRow[];
  boqRows: BoqProgressRow[];
  matchRows: ThreeWayMatchRow[];
  evaluationRows: ControlEvaluationRow[];
  existing: ExistingFindingKey[];
};

/** Read every project-scoped row the rules need, normalized for pure rules. */
export async function loadProjectFindingsSource(
  projectId: string,
  db: any = defaultDb
): Promise<ProjectFindingsSource> {
  const [invoices, contract, matches, evaluations, existing] = await Promise.all([
    db.supplier_invoices.findMany({
      where: { project_id: projectId },
      select: {
        id: true,
        supplier_id: true,
        supplier_payments: {
          select: {
            id: true,
            payment_reference: true,
            payment_date: true,
            gross_paid_amount: true,
            net_paid_amount: true,
          },
        },
      },
    }),
    db.contracts.findFirst({
      where: { project_id: projectId },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    }),
    db.three_way_matches.findMany({
      where: { supplier_invoices: { project_id: projectId } },
      select: {
        id: true,
        supplier_invoice_id: true,
        run_number: true,
        status: true,
        exception_count: true,
        three_way_match_lines: {
          select: { quantity_variance: true, price_variance: true, exception_codes: true },
        },
      },
    }),
    db.control_evaluations.findMany({
      where: { project_id: projectId, result: { in: ['blocked', 'warning'] } },
      orderBy: { evaluated_at: 'asc' },
      select: {
        id: true,
        action_attempted: true,
        result: true,
        severity: true,
        subject_type: true,
        subject_id: true,
        evidence: true,
        evaluated_at: true,
        control_rules: { select: { rule_key: true } },
      },
    }),
    db.ai_findings.findMany({
      where: { project_id: projectId, status: { notIn: [...DEDUPE_EXCLUDED_STATUSES] } },
      select: {
        finding_type: true,
        subject_type: true,
        subject_id: true,
        input_snapshot_hash: true,
      },
    }),
  ]);

  const paymentRows: SupplierPaymentRow[] = invoices.flatMap(
    (invoice: {
      id: string;
      supplier_id: string;
      supplier_payments: Array<{
        id: string;
        payment_reference: string;
        payment_date: unknown;
        gross_paid_amount: unknown;
        net_paid_amount: unknown;
      }>;
    }) =>
      invoice.supplier_payments.map((payment) => ({
        id: payment.id,
        supplierInvoiceId: invoice.id,
        supplierId: invoice.supplier_id,
        paymentReference: payment.payment_reference,
        paymentDate: toIsoDate(payment.payment_date),
        grossPaidAmount: toNumber(payment.gross_paid_amount),
        netPaidAmount: toNumber(payment.net_paid_amount),
      }))
  );

  const matchRows: ThreeWayMatchRow[] = matches.map(
    (match: {
      id: string;
      supplier_invoice_id: string;
      run_number: number;
      status: string;
      exception_count: number;
      three_way_match_lines: Array<{
        quantity_variance: unknown;
        price_variance: unknown;
        exception_codes: string[] | null;
      }>;
    }) => {
      const lines = match.three_way_match_lines ?? [];
      const variances = lines.map((line) => ({
        quantity: Math.abs(toNumber(line.quantity_variance)),
        price: Math.abs(toNumber(line.price_variance)),
      }));
      return {
        id: match.id,
        supplierInvoiceId: match.supplier_invoice_id,
        runNumber: match.run_number,
        status: match.status,
        exceptionCount: match.exception_count,
        quantityVariance: variances.reduce((max, v) => Math.max(max, v.quantity), 0),
        priceVariance: variances.reduce((max, v) => Math.max(max, v.price), 0),
        exceptionCodes: Array.from(new Set(lines.flatMap((line) => line.exception_codes ?? []))),
      };
    }
  );

  const evaluationRows: ControlEvaluationRow[] = evaluations.map(
    (evaluation: {
      id: string;
      action_attempted: string;
      result: string;
      severity: string;
      subject_type: string;
      subject_id: string;
      evidence: unknown;
      evaluated_at: unknown;
      control_rules: { rule_key: string } | null;
    }) => ({
      id: evaluation.id,
      controlRuleKey: evaluation.control_rules?.rule_key ?? 'unknown',
      subjectType: evaluation.subject_type,
      subjectId: evaluation.subject_id,
      actionAttempted: evaluation.action_attempted,
      result: evaluation.result,
      severity: evaluation.severity,
      evidence: asRecord(evaluation.evidence),
      evaluatedAt:
        evaluation.evaluated_at instanceof Date
          ? evaluation.evaluated_at.toISOString()
          : String(evaluation.evaluated_at ?? ''),
    })
  );

  const boqRows = await loadBoqProgressRows(db, projectId, contract?.id);

  return { paymentRows, boqRows, matchRows, evaluationRows, existing };
}

/**
 * Cumulative measured quantity per BOQ line for the project's approved (or
 * latest) BOQ version, from `measurement_lines` accepted/submitted quantities.
 */
async function loadBoqProgressRows(
  db: any,
  projectId: string,
  contractId: string | undefined
): Promise<BoqProgressRow[]> {
  if (!contractId) return [];
  const version =
    (await db.boq_versions.findFirst({
      where: { contract_id: contractId, status: 'approved' },
      orderBy: { version_number: 'desc' },
      select: { id: true },
    })) ??
    (await db.boq_versions.findFirst({
      where: { contract_id: contractId },
      orderBy: { version_number: 'desc' },
      select: { id: true },
    }));
  if (!version) return [];

  const items = await db.boq_items.findMany({
    where: { boq_version_id: version.id },
    select: {
      id: true,
      item_number: true,
      description: true,
      unit: true,
      approved_quantity: true,
      original_quantity: true,
    },
  });
  if (items.length === 0) return [];

  const lines = await db.measurement_lines.findMany({
    where: {
      boq_item_id: { in: items.map((item: { id: string }) => item.id) },
      measurements: { project_id: projectId, status: { in: COUNTED_MEASUREMENT_STATUSES } },
    },
    select: { boq_item_id: true, accepted_quantity: true, submitted_quantity: true },
  });

  const measured = new Map<string, number>();
  for (const line of lines) {
    const quantity =
      line.accepted_quantity === null || line.accepted_quantity === undefined
        ? toNumber(line.submitted_quantity)
        : toNumber(line.accepted_quantity);
    measured.set(line.boq_item_id, (measured.get(line.boq_item_id) ?? 0) + quantity);
  }

  return items.map(
    (item: {
      id: string;
      item_number: string;
      description: string;
      unit: string | null;
      approved_quantity: unknown;
      original_quantity: unknown;
    }) => ({
      boqItemId: item.id,
      itemNumber: item.item_number,
      description: item.description,
      unit: item.unit,
      approvedQuantity: toNumber(item.approved_quantity ?? item.original_quantity),
      measuredQuantity: measured.get(item.id) ?? 0,
    })
  );
}
