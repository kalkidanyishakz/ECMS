import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconClipboardList, IconPlus } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser, hasPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { date, num } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function StockCountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAppUser();
  await getProjectContext();

  const stockCount = await db.stock_counts.findUnique({
    where: { id },
    include: {
      warehouses: { select: { warehouse_code: true, name: true } },
      stock_count_lines: {
        orderBy: { created_at: 'asc' },
        include: { inventory_items: { select: { item_code: true, description: true } } },
      },
    },
  });

  if (!stockCount) notFound();

  const [inventoryItems, canIssue] = await Promise.all([
    db.inventory_items.findMany({
      where: { project_id: stockCount.project_id, is_active: true },
      orderBy: { item_code: 'asc' },
      select: { id: true, item_code: true, description: true, unit: true },
    }),
    hasPermission('inventory.issue', { projectId: stockCount.project_id }),
  ]);

  const totalVariance = stockCount.stock_count_lines.reduce((s, l) => s + Number(l.variance_quantity), 0);
  const varianceLines = stockCount.stock_count_lines.filter((l) => Number(l.variance_quantity) !== 0).length;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title={`Stock Count ${stockCount.count_number}`}
        actions={
          <div className="flex items-center gap-2">
            {stockCount.status === 'draft' && (
              <form method="POST" action={`/api/v1/stock-counts/${stockCount.id}/submit`}>
                <button type="submit" className="rounded-lg bg-ecms-amber px-4 py-2 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
                  Submit for Review
                </button>
              </form>
            )}
            {stockCount.status === 'submitted' && canIssue && (
              <form method="POST" action={`/api/v1/stock-counts/${stockCount.id}/approve`}>
                <button type="submit" className="rounded-lg bg-ecms-success px-4 py-2 text-sm font-semibold text-white hover:bg-ecms-success/90">
                  Approve
                </button>
              </form>
            )}
            {stockCount.status === 'approved' && canIssue && (
              <form method="POST" action={`/api/v1/stock-counts/${stockCount.id}/post`}>
                <button type="submit" className="rounded-lg bg-ecms-navy px-4 py-2 text-sm font-semibold text-white hover:bg-ecms-navy/90">
                  Post Adjustments
                </button>
              </form>
            )}
            {!['draft', 'submitted', 'approved'].includes(stockCount.status) && <StatusPill status={stockCount.status} />}
          </div>
        }
      />

      {canIssue && stockCount.status === 'draft' && (
        <Card title="Add Count Line" icon={<IconClipboardList size={18} />}>
          <form method="POST" action={`/api/v1/stock-counts/${stockCount.id}/lines`} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <input type="hidden" name="redirect_to" value={`/stores/counts/${stockCount.id}`} />
            <select name="inventory_item_id" required className="sm:col-span-2 rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="">Inventory item…</option>
              {inventoryItems.map((i) => <option key={i.id} value={i.id}>{i.item_code} — {i.description}</option>)}
            </select>
            <input name="counted_quantity" type="number" step="0.001" required className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" placeholder="Counted qty" />
            <input name="unit_cost_snapshot" type="number" step="0.01" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" placeholder="Unit cost" />
            <div className="flex gap-2">
              <input name="reason" className="flex-1 rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" placeholder="Reason" />
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
                <IconPlus size={16} />
              </button>
            </div>
          </form>
        </Card>
      )}


      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Stock Count Info" icon={<IconClipboardList size={18} />}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-ecms-muted">Count Number</dt><dd className="font-medium">{stockCount.count_number}</dd></div>
            <div className="flex justify-between"><dt className="text-ecms-muted">Warehouse</dt><dd className="font-medium">{stockCount.warehouses.warehouse_code}</dd></div>
            <div className="flex justify-between"><dt className="text-ecms-muted">Count Date</dt><dd className="font-medium">{date(stockCount.count_date)}</dd></div>
            <div className="flex justify-between"><dt className="text-ecms-muted">Status</dt><dd><StatusPill status={stockCount.status} /></dd></div>
            {stockCount.notes && (
              <div className="col-span-2 flex flex-col gap-1"><dt className="text-ecms-muted">Notes</dt><dd className="text-sm">{stockCount.notes}</dd></div>
            )}
          </dl>
        </Card>

        <Card title="Summary" bodyClassName="pt-3">
          <dl className="grid grid-cols-1 gap-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-ecms-muted">Total Items</dt><dd className="font-bold text-lg text-ecms-text">{stockCount.stock_count_lines.length}</dd></div>
            <div className="flex justify-between"><dt className="text-ecms-muted">Variance Lines</dt><dd className="font-medium">{varianceLines}</dd></div>
            <div className="flex justify-between border-t border-ecms-border pt-2"><dt className="text-ecms-muted font-semibold">Total Variance</dt><dd className={`font-bold ${totalVariance !== 0 ? 'text-ecms-amber' : 'text-ecms-text'}`}>{num(totalVariance)}</dd></div>
          </dl>
        </Card>

        <Card title="Audit Trail" bodyClassName="pt-3">
          <ul className="space-y-3 text-sm">
            <li className="flex items-center justify-between gap-2">
              <span className="text-ecms-muted">Created</span>
              <span className="font-medium">{date(stockCount.created_at)}</span>
            </li>
            {stockCount.submitted_by && (
              <li className="flex items-center justify-between gap-2">
                <span className="text-ecms-muted">Submitted by</span>
                <span className="font-medium">{stockCount.submitted_by}</span>
              </li>
            )}
            {stockCount.approved_at && (
              <li className="flex items-center justify-between gap-2">
                <span className="text-ecms-muted">Approved</span>
                <span className="font-medium">{date(stockCount.approved_at)}</span>
              </li>
            )}
            {stockCount.posted_at && (
              <li className="flex items-center justify-between gap-2">
                <span className="text-ecms-muted">Posted</span>
                <span className="font-medium">{date(stockCount.posted_at)}</span>
              </li>
            )}
          </ul>
        </Card>
      </div>

      <Card title="Count Lines" subtitle={`${stockCount.stock_count_lines.length} items · ${varianceLines} with variance`}>
        {stockCount.stock_count_lines.length === 0 ? (
          <EmptyState icon={<IconClipboardList size={28} />} title="No count lines" message="Add inventory items to this count sheet." />
        ) : (
          <Table>
            <THead><TH>Item</TH><TH>Name</TH><TH className="text-right">System Qty</TH><TH className="text-right">Counted Qty</TH><TH className="text-right">Variance</TH><TH>Reason</TH></THead>
            <TBody>
              {stockCount.stock_count_lines.map((l) => (
                <TR key={l.id} className="hover:bg-ecms-elevated/40">
                  <TD className="font-medium">{l.inventory_items.item_code}</TD>
                  <TD className="text-ecms-muted">{l.inventory_items.description}</TD>
                  <TD className="text-right">{num(Number(l.system_quantity))}</TD>
                  <TD className="text-right">{num(Number(l.counted_quantity))}</TD>
                  <TD className={`text-right font-medium ${Number(l.variance_quantity) !== 0 ? 'text-ecms-amber' : ''}`}>{num(Number(l.variance_quantity))}</TD>
                  <TD className="text-ecms-muted text-xs max-w-[160px] truncate">{l.reason ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
