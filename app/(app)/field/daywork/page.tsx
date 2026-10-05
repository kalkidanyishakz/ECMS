import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconClock, IconPlus } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser, hasPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { money, date } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DayworkPage() {
  await requireAppUser();
  const { tenantId, projectId } = await getProjectContext();

  const sheets = await db.daywork_sheets.findMany({
    where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
    orderBy: { work_date: 'desc' },
    include: {
      contracts: { select: { contract_number: true } },
      work_packages: { select: { package_code: true } },
      _count: { select: { daywork_lines: true } },
    },
  });

  const contracts = await db.contracts.findMany({
    where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
    select: { id: true, contract_number: true, title: true },
    orderBy: { contract_number: 'asc' },
  });

  const canCreate = await hasPermission('daywork.create', { projectId });
  const nextNumber = sheets.length + 1;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Daywork Sheets" />

      {canCreate && (
        <Card title="New Daywork Sheet" icon={<IconClock size={18} />}>
          <form method="POST" action="/api/v1/daywork" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input type="hidden" name="redirect_to" value="/field/daywork" />
            <select name="contract_id" required className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="">Contract…</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_number} · {c.title}</option>)}
            </select>
            <input name="sheet_number" defaultValue={`DW-${String(nextNumber).padStart(3, '0')}`} readOnly className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
            <input name="work_date" type="date" required className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
            <input name="total_amount" type="number" step="0.01" placeholder="Total amount" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
            <select name="status" defaultValue="draft" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="draft">draft</option>
              <option value="submitted">submitted</option>
              <option value="approved">approved</option>
            </select>
            <textarea name="description" required placeholder="Description" rows={2} className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text sm:col-span-2 lg:col-span-5" />
            <div className="sm:col-span-2 lg:col-span-5">
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
                <IconPlus size={16} /> Create Daywork Sheet
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card icon={<IconClock size={18} />}>
        {sheets.length === 0 ? (
          <EmptyState title="No daywork sheets" message="Daywork sheets for variations and extra works appear here." />
        ) : (
          <Table>
            <THead><TH>Sheet</TH><TH>Contract</TH><TH>Package</TH><TH>Work Date</TH><TH>Description</TH><TH>Status</TH><TH className="text-right">Total Amount</TH><TH>Lines</TH></THead>
            <TBody>
              {sheets.map((s) => (
                <TR key={s.id} className="hover:bg-ecms-elevated/40">
                  <TD className="font-medium">{s.sheet_number}</TD>
                  <TD className="text-ecms-muted">{s.contracts.contract_number}</TD>
                  <TD className="text-ecms-muted">{s.work_packages?.package_code ?? '—'}</TD>
                  <TD>{date(s.work_date)}</TD>
                  <TD className="max-w-[260px] truncate">{s.description}</TD>
                  <TD><StatusPill status={s.status} /></TD>
                  <TD className="text-right font-medium">{money(Number(s.total_amount))}</TD>
                  <TD>{s._count.daywork_lines}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
