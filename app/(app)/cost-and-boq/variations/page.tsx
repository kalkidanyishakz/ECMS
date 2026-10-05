import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconAdjustments, IconPlus } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser, hasPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { money, date } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function VariationsPage() {
  await requireAppUser();
  const { tenantId, projectId } = await getProjectContext();

  const [variations, contracts, canCreate, canApprove] = await Promise.all([
    db.variations.findMany({
      where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
      orderBy: { created_at: 'desc' },
      include: {
        contracts: { select: { contract_number: true } },
        variation_items: { select: { line_number: true, change_type: true, description: true, amount: true } },
      },
    }),
    db.contracts.findMany({
      where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
      select: { id: true, contract_number: true, title: true },
    }),
    hasPermission('variation.create', { projectId }),
    hasPermission('variation.approve', { projectId }),
  ]);

  const totals = {
    submitted: 0,
    approved: 0,
    incorporated: 0,
  };
  for (const v of variations) {
    if (v.status === 'approved') totals.approved += Number(v.approved_value);
    if (v.status === 'incorporated') totals.incorporated += Number(v.approved_value);
    if (['submitted', 'under_review'].includes(v.status)) totals.submitted += Number(v.approved_value);
  }

  const nextNumber = `VO-${String(variations.length + 1).padStart(3, '0')}`;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Variations" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5">
          <p className="text-sm text-ecms-muted">Pending Review Value</p>
          <p className="mt-1 text-2xl font-bold text-ecms-warning">{money(totals.submitted)}</p>
        </div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5">
          <p className="text-sm text-ecms-muted">Approved Value</p>
          <p className="mt-1 text-2xl font-bold text-ecms-text">{money(totals.approved)}</p>
        </div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5">
          <p className="text-sm text-ecms-muted">Incorporated into BOQ</p>
          <p className="mt-1 text-2xl font-bold text-ecms-success">{money(totals.incorporated)}</p>
        </div>
      </div>

      {canCreate && (
        <Card title="New Variation" icon={<IconAdjustments size={18} />}>
          <form method="POST" action="/api/v1/variations" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="redirect_to" value="/cost-and-boq/variations" />
            <select name="contract_id" required className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="">Contract…</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_number} — {c.title}</option>)}
            </select>
            <input name="variation_number" defaultValue={nextNumber} className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" placeholder="Variation #" />
            <input name="title" required className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" placeholder="Title" />
            <select name="variation_type" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="">Reason…</option>
              <option value="additional_work">Additional work</option>
              <option value="omission">Omission</option>
              <option value="design_change">Design change</option>
              <option value="unforeseen_condition">Unforeseen condition</option>
              <option value="other">Other</option>
            </select>
            <textarea name="description" rows={2} className="sm:col-span-2 lg:col-span-3 rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" placeholder="Description" />
            <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
              <IconPlus size={16} /> Create Variation
            </button>
          </form>
        </Card>
      )}

      <Card title="Variation Register" icon={<IconAdjustments size={18} />}>
        {variations.length === 0 ? (
          <EmptyState title="No variations" message="Variation orders against contracts appear here." />
        ) : (
          <Table>
            <THead><TH>Number</TH><TH>Contract</TH><TH>Title</TH><TH>Status</TH><TH>Reason</TH><TH>Submitted</TH><TH className="text-right">Approved Value</TH><TH className="text-right">Time Impact</TH><TH>Lines</TH><TH className="text-right">Actions</TH></THead>
            <TBody>
              {variations.map((v) => (
                <TR key={v.id} className="hover:bg-ecms-elevated/40">
                  <TD className="font-medium">{v.variation_number}</TD>
                  <TD className="text-ecms-muted">{v.contracts.contract_number}</TD>
                  <TD className="max-w-[260px] truncate">{v.title}</TD>
                  <TD><StatusPill status={v.status} /></TD>
                  <TD className="text-ecms-muted">{v.reason_code ?? '—'}</TD>
                  <TD>{date(v.submitted_at)}</TD>
                  <TD className="text-right font-medium">{money(Number(v.approved_value))}</TD>
                  <TD className="text-right">{v.time_impact_days > 0 ? `${v.time_impact_days} d` : '—'}</TD>
                  <TD className="text-ecms-muted">{v.variation_items.length}</TD>
                  <TD className="text-right">
                    {v.status === 'draft' && canCreate && (
                      <form method="POST" action={`/api/v1/variations/${v.id}/submit`} className="inline">
                        <button type="submit" className="rounded-md bg-ecms-amber/90 px-2.5 py-1 text-xs font-semibold text-ecms-navy hover:bg-ecms-amber">Submit</button>
                      </form>
                    )}
                    {['submitted', 'under_review'].includes(v.status) && canApprove && (
                      <form method="POST" action={`/api/v1/variations/${v.id}/approve`} className="inline">
                        <button type="submit" className="rounded-md bg-ecms-success/90 px-2.5 py-1 text-xs font-semibold text-white hover:bg-ecms-success">Approve</button>
                      </form>
                    )}
                    {v.status === 'approved' && canApprove && (
                      <form method="POST" action={`/api/v1/variations/${v.id}/incorporate`} className="inline">
                        <button type="submit" className="rounded-md bg-ecms-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-ecms-navy/90">Incorporate</button>
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
