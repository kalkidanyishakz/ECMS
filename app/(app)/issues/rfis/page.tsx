import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Badge } from '@/components/ui/Badge';
import { IconHelp, IconPlus } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser, hasPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { date } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function RfisPage() {
  await requireAppUser();
  const { tenantId, projectId } = await getProjectContext();

  const rfis = await db.rfis.findMany({
    where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
    orderBy: { created_at: 'desc' },
    include: {
      contracts: { select: { contract_number: true } },
      app_users_rfis_raised_byToapp_users: { select: { display_name: true } },
      app_users_rfis_assigned_toToapp_users: { select: { display_name: true } },
      _count: { select: { rfi_responses: true } },
    },
  });

  const canCreate = await hasPermission('rfi.create', { projectId });
  const nextNumber = rfis.length + 1;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Requests for Information" />

      {canCreate && (
        <Card title="Raise RFI" icon={<IconHelp size={18} />}>
          <form method="POST" action="/api/v1/rfis" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input type="hidden" name="redirect_to" value="/issues/rfis" />
            <input name="rfi_number" defaultValue={`RFI-${String(nextNumber).padStart(3, '0')}`} readOnly className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
            <input name="subject" required placeholder="Subject" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
            <select name="priority" defaultValue="medium" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="info">info</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
            <input name="due_date" type="date" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
            <textarea name="question" required placeholder="Question" rows={2} className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text sm:col-span-2 lg:col-span-5" />
            <div className="sm:col-span-2 lg:col-span-5">
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
                <IconPlus size={16} /> Raise RFI
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card icon={<IconHelp size={18} />}>
        {rfis.length === 0 ? (
          <EmptyState title="No RFIs" message="Requests for information raised to the engineer appear here." />
        ) : (
          <Table>
            <THead><TH>Number</TH><TH>Subject</TH><TH>Contract</TH><TH>Priority</TH><TH>Raised By</TH><TH>Assigned To</TH><TH>Due</TH><TH>Status</TH><TH>Responses</TH></THead>
            <TBody>
              {rfis.map((r) => (
                <TR key={r.id} className="hover:bg-ecms-elevated/40">
                  <TD className="font-medium">{r.rfi_number}</TD>
                  <TD className="max-w-[240px] truncate">{r.subject}</TD>
                  <TD className="text-ecms-muted">{r.contracts?.contract_number ?? '—'}</TD>
                  <TD><Badge tone={r.priority === 'critical' ? 'danger' : r.priority === 'high' ? 'warning' : 'neutral'}>{r.priority}</Badge></TD>
                  <TD className="text-ecms-muted">{r.app_users_rfis_raised_byToapp_users?.display_name ?? '—'}</TD>
                  <TD className="text-ecms-muted">{r.app_users_rfis_assigned_toToapp_users?.display_name ?? '—'}</TD>
                  <TD>{date(r.due_date)}</TD>
                  <TD><StatusPill status={r.status} /></TD>
                  <TD>{r._count.rfi_responses}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
