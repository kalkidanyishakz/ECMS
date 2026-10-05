/**
 * Seed script: enrich the ECMS demo so the dashboard and offline AI assistant
 * show credible, non-zero data.
 *
 * Run inside the app container:
 *   docker compose exec -T app npx tsx db/seed-demo-data.ts
 *   — or automatically from docker/entrypoint.sh after the base seeds.
 *
 * Idempotent:
 *   - Project dates / worker status are only written when they differ.
 *   - IPC lines are inserted only when the certificate has none.
 *   - Every other row is looked up on a natural key (issue_number,
 *     payment_reference, notification title, item_code, ledger source_id)
 *     before creating, so re-runs create nothing new.
 *
 * This script relies on the base datasets created by db/seed-jigjiga.ts
 * (tenant, project, contract, organizations, BOQ, workers, draft IPC #1) and
 * db/seed-demo-users.ts (pm@ecms.app etc.). It MUST run after both.
 */
import { createHash } from 'crypto';
import { db } from '../lib/db';
import type { Prisma } from '../lib/generated/prisma/client';

// ---------------------------------------------------------------------------
// Constants / assumptions
// ---------------------------------------------------------------------------

const TENANT_SLUG = 'ecms-demo';
const PROJECT_CODE = 'JIGJIGA';
const CONTRACT_NUMBER = 'JIGJIGA-2024-001';
const PM_EMAIL = 'pm@ecms.app';
const RECORDER_EMAIL = 'supervisor@ecms.app';

/**
 * Planned contract window.
 *
 * The brief asked for "roughly 2024-01-01 → 2026-06-30" so that time-elapsed
 * lands mid-project. The runtime clock in this environment is 2026-10, which
 * makes that literal finish date already elapsed (100 %). To preserve the
 * stated intent of a credible mid-project time-elapsed (~61 %) the finish date
 * is extended while the start date stays exactly 2024-01-01.
 */
const PLANNED_START = new Date('2024-01-01T00:00:00.000Z');
const PLANNED_FINISH = new Date('2028-06-30T00:00:00.000Z');

const RETENTION_PERCENT = 5;

/** Header fields eligible for status transitions in this demo. */
const CERTIFIED_STATUSES = new Set(['certified', 'paid']);

/** Distinct (warehouse, item) balances: 3 below minimum, all 4 value-positive. */
const INVENTORY: Array<{
  id: string;
  code: string;
  description: string;
  unit: string;
  minimumStock: number;
  receiptQty: number;
  issueQty: number;
  unitCost: number;
}> = [
  {
    id: '1a000000-0000-4000-8000-00000000000a',
    code: 'MAT-CEM-001',
    description: 'OPC Cement 42.5R (50 kg bag)',
    unit: 'bag',
    minimumStock: 500,
    receiptQty: 2000,
    issueQty: 1650,
    unitCost: 850,
  },
  {
    id: '1b000000-0000-4000-8000-00000000000b',
    code: 'MAT-STL-012',
    description: 'Deformed steel rebar 12 mm',
    unit: 'ton',
    minimumStock: 80,
    receiptQty: 300,
    issueQty: 245,
    unitCost: 4200,
  },
  {
    id: '1c000000-0000-4000-8000-00000000000c',
    code: 'MAT-AGG-020',
    description: 'Crushed stone aggregate 20 mm',
    unit: 'm3',
    minimumStock: 60,
    receiptQty: 200,
    issueQty: 165,
    unitCost: 1100,
  },
  {
    id: '1d000000-0000-4000-8000-00000000000d',
    code: 'MAT-GEO-001',
    description: 'Non-woven geotextile separator',
    unit: 'roll',
    minimumStock: 20,
    receiptQty: 150,
    issueQty: 40,
    unitCost: 320,
  },
];

/** IPC #1 accepted quantities (from the placeholder measurement set). */
const IPC_LINES: Array<{ itemNumber: string; quantity: number }> = [
  { itemNumber: '1.1', quantity: 45000 },
  { itemNumber: '1.2', quantity: 82000 },
  { itemNumber: '1.3', quantity: 9500 },
  { itemNumber: '1.4', quantity: 58000 },
  { itemNumber: '2.1', quantity: 15000 },
  { itemNumber: '2.2', quantity: 11200 },
  { itemNumber: '3.1', quantity: 180 },
  { itemNumber: '3.2', quantity: 1400 },
  { itemNumber: '3.3', quantity: 85 },
];

const ISSUES: Array<{
  number: string;
  type: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress';
  severity: 'low' | 'medium' | 'high' | 'critical';
  dueDate: string;
}> = [
  {
    number: 'ISS-001',
    type: 'commercial',
    title: 'IPC #1 certification pending employer sign-off',
    description: 'The engineer has recommended IPC #1; employer certification is required to release payment.',
    status: 'in_progress',
    severity: 'high',
    dueDate: '2026-11-15',
  },
  {
    number: 'ISS-002',
    type: 'defect',
    title: 'Pavement edge slumping at chainage 4+250',
    description: 'Localised edge failure observed after the last rainfall event. Repair method statement required.',
    status: 'open',
    severity: 'medium',
    dueDate: '2026-10-30',
  },
  {
    number: 'ISS-003',
    type: 'safety',
    title: 'Missing guardrails along traffic diversion at 5+100',
    description: 'Temporary diversion is not fully protected; install guardrails and reflective markers.',
    status: 'open',
    severity: 'critical',
    dueDate: '2026-10-20',
  },
  {
    number: 'ISS-004',
    type: 'document',
    title: 'As-built drawing revision outstanding',
    description: 'Issued-for-construction revision R2 has not been returned with as-built markups.',
    status: 'in_progress',
    severity: 'low',
    dueDate: '2026-12-05',
  },
];

const NOTIFICATIONS: Array<{ type: string; title: string; body: string }> = [
  {
    type: 'ipc',
    title: 'IPC #1 recommended for certification',
    body: 'The engineer has recommended IPC #1. Review the certificate and record certification.',
  },
  {
    type: 'issue',
    title: 'Critical safety issue raised at 5+100',
    body: 'Missing guardrails on the traffic diversion were logged as a critical issue and assigned to you.',
  },
  {
    type: 'stock',
    title: '3 stock items below minimum level',
    body: 'Cement, rebar and aggregate balances are below their minimum stock levels at WH-01.',
  },
  {
    type: 'measurement',
    title: 'Measurement M-001 submitted',
    body: 'The site team submitted measurement M-001 covering earthworks and drainage. Verification is pending.',
  },
];

const REQUISITIONS: Array<{
  number: string;
  purpose: string;
  requiredDate: string;
}> = [
  {
    number: 'PR-2026-001',
    purpose: 'Supply and delivery of 500 bags OPC cement for drainage works',
    requiredDate: '2026-11-15',
  },
  {
    number: 'PR-2026-002',
    purpose: 'Supply of 12 mm deformed steel rebar for pier reinforcement',
    requiredDate: '2026-12-01',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stableUuid(label: string): string {
  const h = createHash('sha1').update(label).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function sameDay(a: Date | null | undefined, b: Date): boolean {
  if (!a) return false;
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

/**
 * Run a unit of work inside a transaction whose `search_path` includes the
 * `ecms` schema.
 *
 * Several triggers created by db/migrations/0004 reference tables without
 * schema-qualifying them (e.g. `protect_locked_ipc_child` reads
 * `ipc_certificates`), while Prisma's normal session resolves `search_path` to
 * `"$user", public`. `SET LOCAL` inside an interactive transaction is pinned to
 * the same connection the triggers run on, so those functions resolve.
 */
async function withSearchPath<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL search_path TO ecms, public');
    return work(tx);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Enriching ECMS demo data...\n');
  const summary: string[] = [];

  // ── Resolve base entities ────────────────────────────────────────────────
  const tenant = await db.tenants.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found. Run db/seed-jigjiga.ts first.`);

  const project = await db.projects.findFirst({
    where: { tenant_id: tenant.id, project_code: PROJECT_CODE },
  });
  if (!project) throw new Error(`Project "${PROJECT_CODE}" not found. Run db/seed-jigjiga.ts first.`);

  const contract = await db.contracts.findFirst({
    where: { project_id: project.id, contract_number: CONTRACT_NUMBER },
  });
  if (!contract) throw new Error(`Contract "${CONTRACT_NUMBER}" not found. Run db/seed-jigjiga.ts first.`);

  const boqVersion = await db.boq_versions.findFirst({
    where: { contract_id: contract.id, status: 'approved' },
  });
  if (!boqVersion) throw new Error('Approved BOQ version not found. Run db/seed-jigjiga.ts first.');

  const orgs = await db.organizations.findMany({ where: { tenant_id: tenant.id } });
  const employerOrg = orgs.find((o) => o.organization_type === 'employer');
  const contractorOrg = orgs.find((o) => o.organization_type === 'contractor');

  const pm = await db.app_users.findFirst({ where: { email: PM_EMAIL } });
  if (!pm) throw new Error(`Demo user "${PM_EMAIL}" not found. Run db/seed-demo-users.ts first.`);
  const recorder =
    (await db.app_users.findFirst({ where: { email: RECORDER_EMAIL } })) ?? pm;

  // ── 1. Project timeline ──────────────────────────────────────────────────
  if (
    !sameDay(project.planned_start_date, PLANNED_START) ||
    !sameDay(project.planned_finish_date, PLANNED_FINISH) ||
    !sameDay(project.actual_start_date, PLANNED_START)
  ) {
    await db.projects.update({
      where: { id: project.id },
      data: {
        planned_start_date: PLANNED_START,
        planned_finish_date: PLANNED_FINISH,
        actual_start_date: PLANNED_START,
      },
    });
    summary.push(`project timeline set ${PLANNED_START.toISOString().slice(0, 10)} → ${PLANNED_FINISH.toISOString().slice(0, 10)}`);
  } else {
    summary.push('project timeline already set (skipped)');
  }

  // ── 2. Workers on active roster ──────────────────────────────────────────
  const workerNumbers = ['W-001', 'W-002', 'W-003'];
  const workers = await db.workers.findMany({
    where: { project_id: project.id, worker_number: { in: workerNumbers } },
  });
  const inactive = workers.filter((w) => w.status !== 'active');
  if (inactive.length > 0) {
    await db.workers.updateMany({
      where: { id: { in: inactive.map((w) => w.id) } },
      data: { status: 'active', approved_by: pm.id, approved_at: new Date() },
    });
    summary.push(`workers activated: ${inactive.map((w) => w.worker_number).join(', ')}`);
  } else {
    summary.push(`workers already active (${workers.length}) (skipped)`);
  }

  // ── 3. Certified IPC #1 with lines ───────────────────────────────────────
  let ipc = await db.ipc_certificates.findFirst({
    where: { contract_id: contract.id, ipc_number: 1 },
  });
  if (!ipc) {
    ipc = await db.ipc_certificates.create({
      data: {
        project_id: project.id,
        contract_id: contract.id,
        boq_version_id: boqVersion.id,
        ipc_number: 1,
        period_start: new Date('2025-07-01T00:00:00.000Z'),
        period_end: new Date('2025-12-31T00:00:00.000Z'),
        status: 'draft',
        currency: 'ETB',
      },
    });
    summary.push('IPC #1 shell created');
  }

  const existingLineCount = await db.ipc_lines.count({ where: { ipc_id: ipc.id } });
  let currentWorkAmount: number;
  let currentNetAmount: number;

  if (existingLineCount === 0) {
    const boqItems = await db.boq_items.findMany({
      where: { boq_version_id: boqVersion.id },
      orderBy: { sort_order: 'asc' },
    });
    const byNumber = new Map(boqItems.map((i) => [i.item_number, i]));
    const ipcId = ipc.id;
    let lineNo = 1;
    let workTotal = 0;

    const created = await withSearchPath(async (tx) => {
      let count = 0;
      for (const def of IPC_LINES) {
        const item = byNumber.get(def.itemNumber);
        if (!item) continue;
        const rate = Number(item.rate);
        const amount = round4(def.quantity * rate);
        workTotal += amount;
        await tx.ipc_lines.create({
          data: {
            ipc_id: ipcId,
            line_number: lineNo++,
            boq_item_id: item.id,
            item_number_snapshot: item.item_number,
            source_code_snapshot: item.source_code,
            description_snapshot: item.description,
            unit_snapshot: item.unit,
            contract_quantity_snapshot: item.original_quantity?.toString() ?? null,
            rate_snapshot: rate.toString(),
            previous_quantity: '0',
            current_quantity: def.quantity.toString(),
            cumulative_quantity: def.quantity.toString(),
            previous_amount: '0',
            current_amount: amount.toString(),
            cumulative_amount: amount.toString(),
          },
        });
        count++;
      }
      return count;
    });

    currentWorkAmount = round4(workTotal);
    currentNetAmount = round4(currentWorkAmount - currentWorkAmount * (RETENTION_PERCENT / 100));
    summary.push(`IPC #1 lines created: ${created}`);
  } else {
    currentWorkAmount = Number(ipc.cumulative_work_amount);
    currentNetAmount = Number(ipc.net_current_amount);
    summary.push(`IPC #1 already has ${existingLineCount} lines (skipped)`);
  }

  if (!CERTIFIED_STATUSES.has(ipc.status)) {
    const retention = round4(currentWorkAmount * (RETENTION_PERCENT / 100));
    const netAmount = round4(currentWorkAmount - retention);
    const now = new Date();
    const calculationHash = createHash('sha256')
      .update(`jigjiga-ipc-1:${currentWorkAmount}`)
      .digest('hex');

    ipc = await db.ipc_certificates.update({
      where: { id: ipc.id },
      data: {
        status: 'certified',
        currency: 'ETB',
        calculation_version: 'demo-1',
        calculation_hash: calculationHash,
        rule_snapshot: { retentionPercent: RETENTION_PERCENT, source: 'seed-demo-data' },
        previous_work_amount: '0',
        current_work_amount: currentWorkAmount.toString(),
        cumulative_work_amount: currentWorkAmount.toString(),
        current_retention: retention.toString(),
        cumulative_retention: retention.toString(),
        current_gross_amount: currentWorkAmount.toString(),
        net_current_amount: netAmount.toString(),
        cumulative_net_amount: netAmount.toString(),
        submitted_by: pm.id,
        submitted_at: now,
        recommended_by: pm.id,
        recommended_at: now,
        certified_by: pm.id,
        certified_at: now,
        locked_at: now,
      },
    });
    currentNetAmount = netAmount;
    summary.push(
      `IPC #1 certified: work ${currentWorkAmount.toLocaleString()} ETB, net ${netAmount.toLocaleString()} ETB`
    );
  } else {
    summary.push(`IPC #1 already ${ipc.status} (skipped)`);
  }

  // ── 4. Payment against the certified IPC ─────────────────────────────────
  const paymentReference = 'PAY-IPC1-001';
  const existingPayment = await db.payments.findFirst({
    where: { ipc_id: ipc.id, payment_reference: paymentReference },
  });
  if (!existingPayment && recorder.id !== pm.id && currentNetAmount > 0) {
    const paid = Math.min(50_000_000, currentNetAmount);
    await withSearchPath(async (tx) => {
      await tx.payments.create({
        data: {
          ipc_id: ipc.id,
          payment_reference: paymentReference,
          payment_date: new Date('2026-02-15T00:00:00.000Z'),
          currency: 'ETB',
          gross_paid_amount: paid.toString(),
          withholding_amount: '0',
          other_deductions: '0',
          net_paid_amount: paid.toString(),
          payer_org_id: employerOrg?.id ?? null,
          payee_org_id: contractorOrg?.id ?? null,
          recorded_by: recorder.id,
          bank_reference: 'CBE-8891',
          notes: 'Interim payment against certified IPC #1',
        },
      });
    });
    summary.push(`payment ${paymentReference} recorded: ${paid.toLocaleString()} ETB`);
  } else {
    summary.push(`payment ${paymentReference} already present (skipped)`);
  }

  // ── 5. Issues ────────────────────────────────────────────────────────────
  let issuesCreated = 0;
  for (const def of ISSUES) {
    const existing = await db.issues.findFirst({
      where: { project_id: project.id, issue_number: def.number },
    });
    if (existing) continue;
    await db.issues.create({
      data: {
        project_id: project.id,
        contract_id: contract.id,
        issue_number: def.number,
        issue_type: def.type,
        title: def.title,
        description: def.description,
        status: def.status,
        severity: def.severity,
        assigned_to: pm.id,
        responsible_org_id: contractorOrg?.id ?? null,
        due_date: new Date(`${def.dueDate}T00:00:00.000Z`),
        created_by: pm.id,
      },
    });
    issuesCreated++;
  }
  summary.push(
    issuesCreated > 0 ? `issues created: ${issuesCreated}` : `issues already present (${ISSUES.length}) (skipped)`
  );

  // ── 6. Notifications for the PM ──────────────────────────────────────────
  let notificationsCreated = 0;
  for (const def of NOTIFICATIONS) {
    const existing = await db.notifications.findFirst({
      where: { user_id: pm.id, title: def.title },
    });
    if (existing) continue;
    await db.notifications.create({
      data: {
        tenant_id: tenant.id,
        project_id: project.id,
        user_id: pm.id,
        notification_type: def.type,
        title: def.title,
        body: def.body,
        status: 'queued',
      },
    });
    notificationsCreated++;
  }
  summary.push(
    notificationsCreated > 0
      ? `notifications created: ${notificationsCreated}`
      : `notifications already present (${NOTIFICATIONS.length}) (skipped)`
  );

  // ── 7. Inventory items + stock ledger ────────────────────────────────────
  const warehouse = await db.warehouses.findFirst({
    where: { project_id: project.id, warehouse_code: 'WH-01' },
  });
  if (!warehouse) throw new Error('Warehouse WH-01 not found. Run db/seed-jigjiga.ts first.');

  let itemsCreated = 0;
  let ledgerCreated = 0;

  for (const def of INVENTORY) {
    let item = await db.inventory_items.findFirst({
      where: { project_id: project.id, item_code: def.code },
    });
    if (!item) {
      item = await db.inventory_items.create({
        data: {
          id: def.id,
          project_id: project.id,
          item_code: def.code,
          description: def.description,
          unit: def.unit,
          minimum_stock: def.minimumStock.toString(),
        },
      });
      itemsCreated++;
    }

    const movements: Array<{
      entryType: 'receipt' | 'issue';
      quantity: number;
      occurredAt: string;
      note: string;
    }> = [
      {
        entryType: 'receipt',
        quantity: def.receiptQty,
        occurredAt: '2025-08-15T00:00:00.000Z',
        note: `Opening receipt ${def.code}`,
      },
      {
        entryType: 'issue',
        quantity: -def.issueQty,
        occurredAt: '2025-11-20T00:00:00.000Z',
        note: `Issued to site ${def.code}`,
      },
    ];

    const created = await withSearchPath(async (tx) => {
      let made = 0;
      for (const mv of movements) {
        const sourceId = stableUuid(`stock:${def.code}:${mv.entryType}`);
        const existing = await tx.stock_ledger_entries.findFirst({
          where: { project_id: project.id, inventory_item_id: item.id, source_type: 'demo_seed', source_id: sourceId },
        });
        if (existing) continue;
        await tx.stock_ledger_entries.create({
          data: {
            project_id: project.id,
            warehouse_id: warehouse.id,
            inventory_item_id: item.id,
            entry_type: mv.entryType,
            quantity_delta: mv.quantity.toString(),
            unit_cost: def.unitCost.toString(),
            value_delta: (mv.quantity * def.unitCost).toString(),
            source_type: 'demo_seed',
            source_id: sourceId,
            source_line_id: stableUuid(`stock-line:${def.code}:${mv.entryType}`),
            occurred_at: new Date(mv.occurredAt),
            posted_by: pm.id,
            notes: mv.note,
          },
        });
        made++;
      }
      return made;
    });
    ledgerCreated += created;
  }
  summary.push(
    `inventory items created: ${itemsCreated} (${INVENTORY.length - itemsCreated} existed)`
  );
  summary.push(
    `stock ledger entries created: ${ledgerCreated} (${INVENTORY.length * 2 - ledgerCreated} existed)`
  );

  // ── 8. Purchase requisitions (with lines; first one approved) ───────────
  const REQ_LINES: Record<string, Array<{ description: string; unit: string; qty: number; price: number }>> = {
    'PR-2026-001': [
      { description: 'OPC 42.5N cement (50 kg bags)', unit: 'bag', qty: 500, price: 780 },
      { description: 'River sand for drainage bedding', unit: 'm3', qty: 120, price: 950 },
    ],
    'PR-2026-002': [
      { description: '12 mm deformed steel rebar', unit: 'kg', qty: 8000, price: 82 },
    ],
  };
  let reqsCreated = 0;
  for (const def of REQUISITIONS) {
    const lines = REQ_LINES[def.number] ?? [];
    let existing = await db.purchase_requisitions.findFirst({
      where: { project_id: project.id, requisition_number: def.number },
      include: { purchase_requisition_lines: true },
    });
    if (!existing) {
      existing = await db.purchase_requisitions.create({
        data: {
          project_id: project.id,
          contract_id: contract.id,
          requisition_number: def.number,
          status: 'draft',
          purpose: def.purpose,
          requested_by: pm.id,
          required_date: new Date(def.requiredDate),
          purchase_requisition_lines: {
            create: lines.map((l, i) => ({
              line_number: i + 1,
              description: l.description,
              unit: l.unit,
              requested_quantity: l.qty,
              estimated_unit_price: l.price,
              estimated_amount: l.qty * l.price,
            })),
          },
        },
        include: { purchase_requisition_lines: true },
      });
      reqsCreated++;
    } else if (existing.purchase_requisition_lines.length === 0 && lines.length > 0) {
      await db.purchase_requisition_lines.createMany({
        data: lines.map((l, i) => ({
          requisition_id: existing!.id,
          line_number: i + 1,
          description: l.description,
          unit: l.unit,
          requested_quantity: l.qty,
          estimated_unit_price: l.price,
          estimated_amount: l.qty * l.price,
        })),
      });
    }
    // Approve the first requisition so a purchase order can be raised against it.
    if (def.number === 'PR-2026-001' && existing.status === 'draft') {
      await db.purchase_requisitions.update({
        where: { id: existing.id },
        data: {
          status: 'approved',
          submitted_at: new Date('2026-02-01T00:00:00.000Z'),
          approved_by: recorder.id,
          approved_at: new Date('2026-02-02T00:00:00.000Z'),
        },
      });
    }
  }
  summary.push(
    reqsCreated > 0
      ? `requisitions created: ${reqsCreated}`
      : `requisitions already present (${REQUISITIONS.length}) (skipped)`
  );

  // ── 9. Suppliers ────────────────────────────────────────────────────────
  const SUPPLIERS: Array<{ code: string; name: string; short: string }> = [
    { code: 'SUP-001', name: 'Weston Steel & Metals PLC', short: 'Weston' },
    { code: 'SUP-002', name: 'Awash Cement Distributors', short: 'Awash' },
    { code: 'SUP-003', name: 'Danakil Aggregates & Haulage', short: 'Danakil' },
  ];
  let suppliersCreated = 0;
  for (const def of SUPPLIERS) {
    let org = await db.organizations.findFirst({
      where: { tenant_id: tenant.id, legal_name: def.name },
    });
    if (!org) {
      org = await db.organizations.create({
        data: {
          tenant_id: tenant.id,
          legal_name: def.name,
          short_name: def.short,
          organization_type: 'supplier',
          address: {},
        },
      });
    }
    const existingSupplier = await db.suppliers.findFirst({
      where: { tenant_id: tenant.id, supplier_code: def.code },
    });
    if (!existingSupplier) {
      await db.suppliers.create({
        data: {
          tenant_id: tenant.id,
          organization_id: org.id,
          supplier_code: def.code,
          status: 'approved',
          categories: ['materials'],
          approved_by: pm.id,
          approved_at: new Date('2026-01-15T00:00:00.000Z'),
          created_by: recorder.id,
        },
      });
      suppliersCreated++;
    }
  }
  summary.push(
    suppliersCreated > 0
      ? `suppliers created: ${suppliersCreated}`
      : `suppliers already present (${SUPPLIERS.length}) (skipped)`
  );

  // ── 9b. Purchase order + accepted goods receipt ─────────────────────────
  const storeUser =
    (await db.app_users.findFirst({ where: { email: 'store@ecms.app' } })) ?? recorder;
  const poSupplier = await db.suppliers.findFirst({
    where: { tenant_id: tenant.id, supplier_code: 'SUP-002' },
  });
  const approvedReq = await db.purchase_requisitions.findFirst({
    where: { project_id: project.id, requisition_number: 'PR-2026-001' },
    include: { purchase_requisition_lines: { orderBy: { line_number: 'asc' } } },
  });
  const existingPo = await db.purchase_orders.findFirst({
    where: { project_id: project.id, purchase_order_number: 'PO-2026-001' },
  });
  if (
    !existingPo &&
    poSupplier &&
    approvedReq &&
    approvedReq.purchase_requisition_lines.length > 0
  ) {
    const invItems = await db.inventory_items.findMany({ where: { project_id: project.id } });
    let sandItem = invItems.find((i) => /sand/i.test(i.description));
    if (!sandItem) {
      sandItem = await db.inventory_items.create({
        data: {
          project_id: project.id,
          item_code: 'MAT-AGG-021',
          description: 'River sand for drainage bedding',
          unit: 'm3',
        },
      });
    }
    const pickInventory = (description: string) =>
      /cement/i.test(description)
        ? invItems.find((i) => /cement/i.test(i.description))?.id
        : /sand/i.test(description)
          ? sandItem.id
          : invItems[0]?.id;

    const reqLines = approvedReq.purchase_requisition_lines;
    const lineValues = reqLines.map((l) => ({
      requisitionLineId: l.id,
      inventoryItemId: pickInventory(l.description) ?? null,
      description: l.description,
      unit: l.unit,
      quantity: Number(l.requested_quantity),
      unitPrice: Number(l.estimated_unit_price ?? 0),
    }));
    const subtotal = lineValues.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const po = await db.purchase_orders.create({
      data: {
        project_id: project.id,
        contract_id: contract.id,
        purchase_order_number: 'PO-2026-001',
        supplier_id: poSupplier.id,
        status: 'issued',
        delivery_location: 'Jigjiga site store (WH-01)',
        expected_delivery_date: new Date('2026-03-05T00:00:00.000Z'),
        subtotal,
        tax_amount: 0,
        total_amount: subtotal,
        created_by: pm.id,
        approved_by: recorder.id,
        approved_at: new Date('2026-02-03T00:00:00.000Z'),
        issued_by: recorder.id,
        issued_at: new Date('2026-02-04T00:00:00.000Z'),
      },
    });
    const poLines: Array<{ id: string; inventoryItemId: string | null; quantity: number }> = [];
    for (let i = 0; i < lineValues.length; i++) {
      const l = lineValues[i];
      const created = await db.purchase_order_lines.create({
        data: {
          purchase_order_id: po.id,
          requisition_line_id: l.requisitionLineId,
          inventory_item_id: l.inventoryItemId,
          line_number: i + 1,
          description: l.description,
          unit: l.unit,
          ordered_quantity: l.quantity,
          unit_price: l.unitPrice,
          tax_percent: 0,
          line_amount: l.quantity * l.unitPrice,
        },
      });
      poLines.push({ id: created.id, inventoryItemId: l.inventoryItemId, quantity: l.quantity });
    }

    const grn = await db.goods_receipts.create({
      data: {
        project_id: project.id,
        purchase_order_id: po.id,
        warehouse_id: warehouse.id,
        receipt_number: 'GRN-00001',
        receipt_date: new Date('2026-03-03T00:00:00.000Z'),
        delivery_note_number: 'DN-2026-0311',
        status: 'draft',
        received_by: storeUser.id,
      },
    });
    for (let i = 0; i < poLines.length; i++) {
      const pol = poLines[i];
      await db.goods_receipt_lines.create({
        data: {
          goods_receipt_id: grn.id,
          purchase_order_line_id: pol.id,
          inventory_item_id: pol.inventoryItemId!,
          line_number: i + 1,
          ordered_quantity_snapshot: pol.quantity,
          previously_received_quantity: 0,
          received_quantity: pol.quantity,
          accepted_quantity: pol.quantity,
          rejected_quantity: 0,
          specification_result: 'accepted',
        },
      });
    }
    await db.goods_receipts.update({
      where: { id: grn.id },
      data: {
        status: 'accepted',
        submitted_at: new Date('2026-03-03T08:00:00.000Z'),
        inspected_by: pm.id,
        accepted_by: recorder.id,
        accepted_at: new Date('2026-03-03T09:00:00.000Z'),
      },
    });
    await db.purchase_requisitions.update({
      where: { id: approvedReq.id },
      data: { status: 'ordered' },
    });
    summary.push('purchase order PO-2026-001 + accepted GRN-00001 created');
  } else {
    summary.push(
      existingPo
        ? 'purchase order PO-2026-001 already present (skipped)'
        : 'purchase order seed prerequisites missing (skipped)'
    );
  }

  // ── 10. Draft IPC #2 (for live assembly demo) ───────────────────────────
  const ipc2Existing = await db.ipc_certificates.findFirst({
    where: { contract_id: contract.id, ipc_number: 2 },
  });
  if (!ipc2Existing) {
    await db.ipc_certificates.create({
      data: {
        project_id: project.id,
        contract_id: contract.id,
        boq_version_id: boqVersion.id,
        ipc_number: 2,
        period_start: new Date('2026-01-01T00:00:00.000Z'),
        period_end: new Date('2026-06-30T00:00:00.000Z'),
        status: 'draft',
        currency: 'ETB',
      },
    });
    summary.push('draft IPC #2 created');
  } else {
    summary.push(`IPC #2 already present (${ipc2Existing.status}) (skipped)`);
  }

  // ── 11. Variations ──────────────────────────────────────────────────────
  const VARIATIONS: Array<{
    number: string;
    title: string;
    status: 'submitted' | 'approved';
    value: number;
    reason: string;
    days: number;
  }> = [
    { number: 'VO-001', title: 'Additional drainage culverts at Ch. 4+200', status: 'submitted', value: 4_850_000, reason: 'design_change', days: 21 },
    { number: 'VO-002', title: 'Unforeseen rock excavation in cut section', status: 'approved', value: 2_340_000, reason: 'site_condition', days: 14 },
  ];
  let variationsCreated = 0;
  for (const def of VARIATIONS) {
    const existing = await db.variations.findFirst({
      where: { project_id: project.id, variation_number: def.number },
    });
    if (existing) continue;
    await db.variations.create({
      data: {
        project_id: project.id,
        contract_id: contract.id,
        variation_number: def.number,
        title: def.title,
        status: def.status,
        reason_code: def.reason,
        time_impact_days: def.days,
        approved_value: def.value,
        initiated_by: pm.id,
        submitted_at: def.status === 'submitted' ? new Date('2026-03-10T00:00:00.000Z') : new Date('2026-01-20T00:00:00.000Z'),
        approved_at: def.status === 'approved' ? new Date('2026-02-05T00:00:00.000Z') : null,
        approved_by: def.status === 'approved' ? recorder.id : null,
      },
    });
    variationsCreated++;
  }
  summary.push(
    variationsCreated > 0
      ? `variations created: ${variationsCreated}`
      : `variations already present (${VARIATIONS.length}) (skipped)`
  );

  // ── 12. Stock count (draft) ─────────────────────────────────────────────
  const existingStockCount = await db.stock_counts.findFirst({
    where: { project_id: project.id, count_number: 'SC-001' },
  });
  if (!existingStockCount) {
    const invItems = await db.inventory_items.findMany({
      where: { project_id: project.id },
      take: 3,
      orderBy: { item_code: 'asc' },
    });
    const sc = await db.stock_counts.create({
      data: {
        project_id: project.id,
        warehouse_id: warehouse.id,
        count_number: 'SC-001',
        count_date: new Date('2026-04-30T00:00:00.000Z'),
        status: 'draft',
        notes: 'Quarterly physical count',
      },
    });
    for (const item of invItems) {
      const bal = await db.stock_ledger_entries.aggregate({
        where: { project_id: project.id, inventory_item_id: item.id },
        _sum: { quantity_delta: true },
      });
      const systemQty = Number(bal._sum.quantity_delta ?? 0);
      await db.stock_count_lines.create({
        data: {
          stock_count_id: sc.id,
          inventory_item_id: item.id,
          system_quantity: systemQty,
          counted_quantity: systemQty,
          variance_quantity: 0,
        },
      });
    }
    summary.push(`stock count SC-001 created with ${invItems.length} lines`);
  } else {
    summary.push('stock count SC-001 already present (skipped)');
  }

  // ── 13. RFIs + inspection requests ──────────────────────────────────────
  const RFIS: Array<{ number: string; subject: string; question: string; status: 'open' | 'answered' }> = [
    { number: 'RFI-001', subject: 'Reinforcement lap length at pier P3', question: 'Confirm the required lap length for 20 mm bars at pier P3.', status: 'open' },
    { number: 'RFI-002', subject: 'Approved fill material source', question: 'Confirm the approved borrow pit for structural fill.', status: 'answered' },
  ];
  let rfisCreated = 0;
  for (const def of RFIS) {
    const existing = await db.rfis.findFirst({
      where: { project_id: project.id, rfi_number: def.number },
    });
    if (existing) continue;
    await db.rfis.create({
      data: {
        project_id: project.id,
        contract_id: contract.id,
        rfi_number: def.number,
        subject: def.subject,
        question: def.question,
        status: def.status,
        priority: 'medium',
        raised_by: pm.id,
        assigned_to: pm.id,
        responsible_org_id: contractorOrg?.id ?? null,
        due_date: new Date('2026-05-15T00:00:00.000Z'),
        opened_at: new Date('2026-04-20T00:00:00.000Z'),
        answered_at: def.status === 'answered' ? new Date('2026-04-28T00:00:00.000Z') : null,
      },
    });
    rfisCreated++;
  }
  summary.push(
    rfisCreated > 0 ? `rfis created: ${rfisCreated}` : `rfis already present (${RFIS.length}) (skipped)`
  );

  const INSPECTIONS: Array<{ number: string; subject: string; status: 'requested' | 'completed' }> = [
    { number: 'INS-001', subject: 'Sub-base compaction — Ch. 0+000 to 2+500', status: 'completed' },
    { number: 'INS-002', subject: 'Pier P3 reinforcement before pour', status: 'requested' },
  ];
  let inspectionsCreated = 0;
  for (const def of INSPECTIONS) {
    const existing = await db.inspection_requests.findFirst({
      where: { project_id: project.id, inspection_number: def.number },
    });
    if (existing) continue;
    await db.inspection_requests.create({
      data: {
        project_id: project.id,
        contract_id: contract.id,
        inspection_number: def.number,
        subject: def.subject,
        description: def.subject,
        status: def.status,
        result: def.status === 'completed' ? 'accepted' : undefined,
        requested_by: pm.id,
        contractor_org_id: contractorOrg?.id ?? null,
        requested_for: new Date('2026-05-05T00:00:00.000Z'),
        inspected_at: def.status === 'completed' ? new Date('2026-05-06T00:00:00.000Z') : null,
      },
    });
    inspectionsCreated++;
  }
  summary.push(
    inspectionsCreated > 0
      ? `inspection requests created: ${inspectionsCreated}`
      : `inspection requests already present (${INSPECTIONS.length}) (skipped)`
  );

  // ── 14. Attendance, daywork, transmittals ───────────────────────────────
  const workerRows = await db.workers.findMany({
    where: { project_id: project.id },
    take: 3,
    orderBy: { worker_number: 'asc' },
  });
  let attendanceCreated = 0;
  const attendanceDays = ['2026-04-27', '2026-04-28', '2026-04-29'];
  for (const worker of workerRows) {
    for (const day of attendanceDays) {
      const attendanceDate = new Date(`${day}T00:00:00.000Z`);
      const existing = await db.attendance_records.findFirst({
        where: { project_id: project.id, worker_id: worker.id, attendance_date: attendanceDate },
      });
      if (existing) continue;
      await withSearchPath(async (tx) => {
        await tx.attendance_records.create({
          data: {
            project_id: project.id,
            worker_id: worker.id,
            attendance_date: attendanceDate,
            regular_hours: 8,
            overtime_hours: day === '2026-04-29' ? 2 : 0,
            attendance_status: 'present',
            recorded_by: recorder.id,
            source: 'manual',
          },
        });
      });
      attendanceCreated++;
    }
  }
  summary.push(
    attendanceCreated > 0
      ? `attendance records created: ${attendanceCreated}`
      : `attendance records already present (skipped)`
  );

  const existingDaywork = await db.daywork_sheets.findFirst({
    where: { project_id: project.id, sheet_number: 'DW-001' },
  });
  if (!existingDaywork) {
    await withSearchPath(async (tx) => {
      await tx.daywork_sheets.create({
        data: {
          project_id: project.id,
          contract_id: contract.id,
          sheet_number: 'DW-001',
          work_date: new Date('2026-04-25T00:00:00.000Z'),
          description: 'Daywork for emergency culvert desilting after unseasonal rainfall',
          status: 'draft',
          total_amount: 185000,
          submitted_by: recorder.id,
        },
      });
    });
    summary.push('daywork sheet DW-001 created');
  } else {
    summary.push('daywork sheet DW-001 already present (skipped)');
  }

  const existingTransmittal = await db.transmittals.findFirst({
    where: { project_id: project.id, transmittal_number: 'TR-001' },
  });
  if (!existingTransmittal) {
    await withSearchPath(async (tx) => {
      await tx.transmittals.create({
        data: {
          project_id: project.id,
          contract_id: contract.id,
          transmittal_number: 'TR-001',
          direction: 'outgoing',
          subject: 'Submission of method statement for pier works',
          sender_org_id: contractorOrg?.id ?? null,
          recipient_org_id: employerOrg?.id ?? null,
          sent_at: new Date('2026-04-18T00:00:00.000Z'),
          status: 'issued',
          created_by: pm.id,
        },
      });
    });
    summary.push('transmittal TR-001 created');
  } else {
    summary.push('transmittal TR-001 already present (skipped)');
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  await db.$disconnect();
  console.log('Summary:');
  for (const line of summary) console.log(`  - ${line}`);
  console.log('\nDone. Demo data enrichment complete.');
}

main().catch(async (error) => {
  console.error('Demo data seed failed:', error);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
