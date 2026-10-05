import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Badge } from '@/components/ui/Badge';
import { IconSwitchVertical, IconPlus } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser, hasPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { date } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function TransmittalsPage() {
  await requireAppUser();
  const { tenantId, projectId } = await getProjectContext();

  const transmittals = await db.transmittals.findMany({
    where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
    orderBy: { sent_at: 'desc' },
    include: {
      contracts: { select: { contract_number: true } },
      organizations_transmittals_sender_org_idToorganizations: { select: { short_name: true } },
      organizations_transmittals_recipient_org_idToorganizations: { select: { short_name: true } },
      _count: { select: { transmittal_items: true } },
    },
  });

  const organizations = await db.organizations.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, legal_name: true, short_name: true },
    orderBy: { legal_name: 'asc' },
  });

  const canCreate = await hasPermission('transmittal.create', { projectId });
  const nextNumber = transmittals.length + 1;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Transmittals" />

      {canCreate && (
        <Card title="New Transmittal" icon={<IconSwitchVertical size={18} />}>
          <form method="POST" action="/api/v1/transmittals" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input type="hidden" name="redirect_to" value="/documents/transmittals" />
            <input name="transmittal_number" defaultValue={`TR-${String(nextNumber).padStart(3, '0')}`} readOnly className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
            <select name="direction" required defaultValue="outgoing" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="outgoing">outgoing</option>
              <option value="incoming">incoming</option>
            </select>
            <input name="subject" required placeholder="Subject" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
            <select name="sender_org_id" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="">Sender…</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.short_name ?? o.legal_name}</option>)}
            </select>
            <select name="recipient_org_id" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="">Recipient…</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.short_name ?? o.legal_name}</option>)}
            </select>
            <input name="sent_at" type="datetime-local" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
            <select name="status" defaultValue="draft" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="draft">draft</option>
              <option value="issued">issued</option>
              <option value="received">received</option>
              <option value="acknowledged">acknowledged</option>
              <option value="cancelled">cancelled</option>
            </select>
            <div className="sm:col-span-2 lg:col-span-5">
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
                <IconPlus size={16} /> Create Transmittal
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card icon={<IconSwitchVertical size={18} />}>
        {transmittals.length === 0 ? (
          <EmptyState title="No transmittals" message="Document transmittals in and out appear here." />
        ) : (
          <Table>
            <THead><TH>Number</TH><TH>Contract</TH><TH>Direction</TH><TH>Subject</TH><TH>From</TH><TH>To</TH><TH>Sent</TH><TH>Status</TH><TH>Items</TH></THead>
            <TBody>
              {transmittals.map((t) => (
                <TR key={t.id} className="hover:bg-ecms-elevated/40">
                  <TD className="font-medium">{t.transmittal_number}</TD>
                  <TD className="text-ecms-muted">{t.contracts?.contract_number ?? '—'}</TD>
                  <TD><Badge tone={t.direction === 'outgoing' ? 'info' : 'warning'}>{t.direction}</Badge></TD>
                  <TD className="max-w-[240px] truncate">{t.subject}</TD>
                  <TD className="text-ecms-muted">{t.organizations_transmittals_sender_org_idToorganizations?.short_name ?? '—'}</TD>
                  <TD className="text-ecms-muted">{t.organizations_transmittals_recipient_org_idToorganizations?.short_name ?? '—'}</TD>
                  <TD>{date(t.sent_at)}</TD>
                  <TD><StatusPill status={t.status} /></TD>
                  <TD>{t._count.transmittal_items}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
