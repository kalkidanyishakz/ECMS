import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconBox, IconPlus } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { date } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function GoodsReceiptsPage() {
  await requireAppUser();
  const { tenantId, projectId } = await getProjectContext();

  const [receipts, purchaseOrders, warehouses] = await Promise.all([
    db.goods_receipts.findMany({
      where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
      orderBy: { receipt_date: 'desc' },
      include: {
        purchase_orders: { select: { purchase_order_number: true } },
        warehouses: { select: { warehouse_code: true, name: true } },
        app_users_goods_receipts_received_byToapp_users: { select: { display_name: true } },
        goods_receipt_lines: { select: { line_number: true, received_quantity: true, accepted_quantity: true, rejected_quantity: true } },
      },
    }),
    db.purchase_orders.findMany({
      where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
      orderBy: { created_at: 'desc' },
      select: { id: true, purchase_order_number: true, status: true, purchase_order_lines: { select: { id: true } } },
    }),
    db.warehouses.findMany({
      where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
      select: { id: true, warehouse_code: true, name: true },
    }),
  ]);

  const receivablePos = purchaseOrders.filter((p) => p.purchase_order_lines.length > 0 && ['approved', 'issued', 'partially_received'].includes(p.status));

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Goods Receipts" />

      <Card title="New Goods Receipt" icon={<IconBox size={18} />}>
        <form method="POST" action="/api/v1/goods-receipts" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input type="hidden" name="redirect_to" value="/procurement/receipts" />
          <select name="purchase_order_id" required className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
            <option value="">Purchase order…</option>
            {receivablePos.map((p) => <option key={p.id} value={p.id}>{p.purchase_order_number} ({p.status})</option>)}
          </select>
          <select name="warehouse_id" required className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
            <option value="">Warehouse…</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.warehouse_code}</option>)}
          </select>
          <input name="receipt_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
          <input name="delivery_note_number" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" placeholder="Delivery note #" />
          <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
            <IconPlus size={16} /> Record Receipt
          </button>
        </form>
      </Card>

      <Card icon={<IconBox size={18} />}>
        {receipts.length === 0 ? (
          <EmptyState title="No goods receipts" message="Goods receipt notes against purchase orders appear here." />
        ) : (
          <Table>
            <THead><TH>Receipt</TH><TH>PO</TH><TH>Warehouse</TH><TH>Date</TH><TH>Received By</TH><TH>Status</TH><TH className="text-right">Accepted</TH><TH className="text-right">Rejected</TH><TH>Lines</TH></THead>
            <TBody>
              {receipts.map((g) => {
                const accepted = g.goods_receipt_lines.reduce((s, l) => s + Number(l.accepted_quantity), 0);
                const rejected = g.goods_receipt_lines.reduce((s, l) => s + Number(l.rejected_quantity), 0);
                return (
                  <TR key={g.id} className="hover:bg-ecms-elevated/40">
                    <TD className="font-medium">{g.receipt_number}</TD>
                    <TD className="text-ecms-muted">{g.purchase_orders.purchase_order_number}</TD>
                    <TD>{g.warehouses.warehouse_code}</TD>
                    <TD>{date(g.receipt_date)}</TD>
                    <TD className="text-ecms-muted">{g.app_users_goods_receipts_received_byToapp_users?.display_name}</TD>
                    <TD><StatusPill status={g.status} /></TD>
                    <TD className="text-right">{accepted}</TD>
                    <TD className="text-right">{rejected}</TD>
                    <TD>{g.goods_receipt_lines.length}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
