import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconClipboardList, IconPlus } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser, hasPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { money, date } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrdersPage() {
  await requireAppUser();
  const { tenantId, projectId } = await getProjectContext();

  const [orders, approvedReqs, suppliers, canCreate, canApprove] = await Promise.all([
    db.purchase_orders.findMany({
      where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
      orderBy: { created_at: 'desc' },
      include: {
        suppliers: { include: { organizations: { select: { legal_name: true } } } },
        contracts: { select: { contract_number: true } },
        purchase_order_lines: { select: { line_number: true, description: true, ordered_quantity: true, unit: true, unit_price: true, line_amount: true } },
      },
    }),
    db.purchase_requisitions.findMany({
      where: { status: 'approved', ...(projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } }) },
      orderBy: { created_at: 'desc' },
      select: { id: true, requisition_number: true, purpose: true, purchase_requisition_lines: { select: { id: true } } },
    }),
    db.suppliers.findMany({
      where: { status: 'approved', tenant_id: tenantId },
      orderBy: { supplier_code: 'asc' },
      include: { organizations: { select: { legal_name: true } } },
    }),
    hasPermission('procurement.order', { projectId }),
    hasPermission('procurement.approve', { projectId }),
  ]);

  const creatableReqs = approvedReqs.filter((r) => r.purchase_requisition_lines.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Purchase Orders" />

      {canCreate && (
        <Card title="New Purchase Order" icon={<IconClipboardList size={18} />}>
          <form method="POST" action="/api/v1/purchase-orders" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input type="hidden" name="redirect_to" value="/procurement/orders" />
            <select name="requisition_id" required className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="">Approved requisition…</option>
              {creatableReqs.map((r) => <option key={r.id} value={r.id}>{r.requisition_number} — {r.purpose}</option>)}
            </select>
            <select name="supplier_id" required className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="">Supplier…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_code} — {s.organizations.legal_name}</option>)}
            </select>
            <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
              <IconPlus size={16} /> Create Purchase Order
            </button>
          </form>
          {creatableReqs.length === 0 && (
            <p className="mt-2 text-xs text-ecms-muted">Approve a requisition with lines to create a purchase order.</p>
          )}
        </Card>
      )}

      <Card icon={<IconClipboardList size={18} />}>
        {orders.length === 0 ? (
          <EmptyState title="No purchase orders" message="Purchase orders issued to suppliers appear here." />
        ) : (
          <Table>
            <THead><TH>PO Number</TH><TH>Supplier</TH><TH>Contract</TH><TH>Status</TH><TH>Expected Delivery</TH><TH className="text-right">Total</TH><TH>Lines</TH><TH className="text-right">Actions</TH></THead>
            <TBody>
              {orders.map((po) => (
                <TR key={po.id} className="hover:bg-ecms-elevated/40">
                  <TD className="font-medium">{po.purchase_order_number}</TD>
                  <TD className="text-ecms-muted">{po.suppliers.organizations.legal_name}</TD>
                  <TD className="text-ecms-muted">{po.contracts?.contract_number ?? '—'}</TD>
                  <TD><StatusPill status={po.status} /></TD>
                  <TD>{date(po.expected_delivery_date)}</TD>
                  <TD className="text-right font-medium">{money(Number(po.total_amount), po.currency)}</TD>
                  <TD>{po.purchase_order_lines.length}</TD>
                  <TD className="text-right">
                    {po.status === 'draft' && canApprove && (
                      <form method="POST" action={`/api/v1/purchase-orders/${po.id}`} className="inline">
                        <input type="hidden" name="status" value="approved" />
                        <button type="submit" className="rounded-md bg-ecms-amber/90 px-2.5 py-1 text-xs font-semibold text-ecms-navy hover:bg-ecms-amber">Approve</button>
                      </form>
                    )}
                    {po.status === 'approved' && canCreate && (
                      <form method="POST" action={`/api/v1/purchase-orders/${po.id}`} className="inline">
                        <input type="hidden" name="status" value="issued" />
                        <button type="submit" className="rounded-md bg-ecms-success/90 px-2.5 py-1 text-xs font-semibold text-white hover:bg-ecms-success">Issue</button>
                      </form>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
