import type { PermissionDb } from '@/lib/server/session';

/**
 * Structural slice of the Prisma client used by the AI data tools.
 *
 * It is deliberately structural (rather than `PrismaClient`) for two reasons:
 *  1. The tools are unit-tested against small in-memory fake clients.
 *  2. Several tool read paths intentionally tolerate optional/alias columns
 *     (`po_number`, `title`/`description`, `organizations.name`) that are not
 *     part of the generated Prisma model types. Typing them here documents the
 *     exact shape the tools consume without altering runtime behaviour.
 *
 * The real `db` singleton is adapted once at the call boundary via an
 * `as unknown as ToolDb` cast (the same pattern used by `session.ts` for
 * `PermissionDb`).
 */

export type ContractPartyRow = {
  role: string;
  organizations?: { legal_name?: string | null; name?: string | null } | null;
};

export type ContractRow = {
  id: string;
  project_id?: string;
  currency?: string | null;
  original_contract_amount?: number | string | bigint | null;
  revised_contract_amount?: number | string | bigint | null;
  created_at?: Date;
  contract_parties?: ContractPartyRow[];
};

export type IpcLineRow = {
  boq_item_id: string;
  cumulative_quantity?: number | string | bigint | null;
};

export type IpcCertificateRow = {
  id: string;
  ipc_number: number;
  certificate_reference?: string | null;
  period_start: Date;
  period_end: Date;
  status: string;
  currency?: string | null;
  current_work_amount?: number | string | bigint | null;
  current_retention?: number | string | bigint | null;
  net_current_amount?: number | string | bigint | null;
  cumulative_work_amount?: number | string | bigint | null;
  cumulative_retention?: number | string | bigint | null;
  cumulative_net_amount?: number | string | bigint | null;
  calculation_version?: string | null;
  calculation_hash?: string | null;
  ipc_lines?: IpcLineRow[];
  _count?: { ipc_lines: number };
};

export type ProjectRow = {
  id: string;
  name: string;
  project_code: string;
  tenant_id?: string;
  description?: string | null;
  currency?: string | null;
  start_chainage_mm?: number | string | bigint | null;
  end_chainage_mm?: number | string | bigint | null;
  planned_start_date?: Date | null;
  planned_finish_date?: Date | null;
  actual_start_date?: Date | null;
  actual_finish_date?: Date | null;
  contracts?: ContractRow[];
  ipc_certificates?: IpcCertificateRow[];
};

export type BoqVersionRow = {
  id: string;
  contract_id?: string;
  version_number: number;
  status: string;
};

export type BoqSectionRow = {
  id: string;
  section_code: string;
  title: string;
};

export type BoqItemRow = {
  id: string;
  item_number: string;
  source_code?: string | null;
  description: string;
  unit?: string | null;
  original_quantity?: number | string | bigint | null;
  approved_quantity?: number | string | bigint | null;
  rate?: number | string | bigint | null;
  sort_order?: number;
  boq_sections?: BoqSectionRow | null;
};

export type PurchaseRequisitionRow = {
  id: string;
  requisition_number: string;
  status: string;
  title?: string | null;
  description?: string | null;
  purpose?: string | null;
  created_at?: Date;
};

export type PurchaseOrderRow = {
  id: string;
  po_number?: string | null;
  status: string;
  total_amount?: number | string | bigint | null;
  currency?: string | null;
  created_at?: Date;
};

export type InventoryItemRow = {
  item_code?: string | null;
  name?: string | null;
  description?: string | null;
  unit?: string | null;
};

export type StockLedgerEntryRow = {
  inventory_item_id: string;
  quantity_delta?: number | string | bigint | null;
  value_delta?: number | string | bigint | null;
  inventory_items?: InventoryItemRow | null;
};

export type WorkerRow = {
  id: string;
  status: string;
};

export type TimesheetRow = {
  id: string;
  timesheet_number: string;
  period_start: Date;
  period_end: Date;
  status: string;
};

export type PayrollBatchRow = {
  id: string;
  payroll_number: string;
  period_start: Date;
  period_end: Date;
  status: string;
  currency?: string | null;
  gross_amount?: number | string | bigint | null;
  net_amount?: number | string | bigint | null;
};

export type AuditEventRow = {
  id?: number | string | bigint;
  action: string;
  entity_type: string;
  occurred_at: Date;
  metadata?: Record<string, unknown> | null;
  app_users?: { display_name?: string | null; email?: string | null } | null;
};

export type ToolDb = PermissionDb & {
  projects: { findUnique: (args: unknown) => Promise<ProjectRow | null> };
  contracts: { findFirst: (args: unknown) => Promise<ContractRow | null> };
  boq_versions: { findFirst: (args: unknown) => Promise<BoqVersionRow | null> };
  boq_items: { findMany: (args: unknown) => Promise<BoqItemRow[]> };
  ipc_certificates: {
    findFirst: (args: unknown) => Promise<IpcCertificateRow | null>;
    findMany: (args: unknown) => Promise<IpcCertificateRow[]>;
  };
  purchase_requisitions: { findMany: (args: unknown) => Promise<PurchaseRequisitionRow[]> };
  purchase_orders: { findMany: (args: unknown) => Promise<PurchaseOrderRow[]> };
  stock_ledger_entries: { findMany: (args: unknown) => Promise<StockLedgerEntryRow[]> };
  workers: { findMany: (args: unknown) => Promise<WorkerRow[]> };
  timesheets: { findFirst: (args: unknown) => Promise<TimesheetRow | null> };
  payroll_batches: { findFirst: (args: unknown) => Promise<PayrollBatchRow | null> };
  audit_events: { findMany: (args: unknown) => Promise<AuditEventRow[]> };
};
