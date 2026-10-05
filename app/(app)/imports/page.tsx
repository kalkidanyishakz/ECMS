import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Badge } from '@/components/ui/Badge';
import { IconFileText, IconUpload } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser, hasPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { dateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const IMPORT_KINDS = ['boq', 'ipc', 'contract', 'drawings', 'organizations', 'other'];

export default async function ImportsPage() {
  await requireAppUser();
  const { tenantId, projectId } = await getProjectContext();
  const canManage = await hasPermission('import.manage', { projectId });

  const [jobs, boqVersions] = await Promise.all([
    db.import_jobs.findMany({
      where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
      orderBy: { created_at: 'desc' },
      include: {
        app_users: { select: { display_name: true } },
        _count: { select: { import_rows: true, import_exceptions: true, import_sheets: true } },
      },
    }),
    projectId
      ? db.boq_versions.findMany({
          where: { contracts: { project_id: projectId } },
          select: {
            id: true,
            name: true,
            version_number: true,
            status: true,
            contracts: { select: { contract_number: true } },
          },
          orderBy: { version_number: 'desc' },
        })
      : Promise.resolve([]),
  ]);

  const byStatus = new Map<string, number>();
  for (const j of jobs) byStatus.set(j.status, (byStatus.get(j.status) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Data Import Centre" />

      {canManage && (
        <Card title="Upload Import File" subtitle="CSV or Excel (XLSX/XLS). Sheets and rows are parsed automatically." icon={<IconUpload size={18} />}>
          <form method="POST" action="/api/v1/imports" encType="multipart/form-data" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="redirect_to" value="/imports" />
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ecms-muted">Import kind</span>
              <select name="import_type" defaultValue="boq" required className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
                {IMPORT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ecms-muted">Target BOQ version (for BOQ imports)</span>
              <select name="boq_version_id" defaultValue="" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
                <option value="">— None —</option>
                {boqVersions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.contracts?.contract_number ?? 'Contract'} · v{v.version_number} {v.name} ({v.status})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ecms-muted">Source name (optional)</span>
              <input name="file_name" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" placeholder="Defaults to file name" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ecms-muted">File</span>
              <input name="file" type="file" accept=".csv,.xlsx,.xls,.xlsm,.txt" required className="text-sm text-ecms-muted file:mr-3 file:rounded-lg file:border-0 file:bg-ecms-elevated file:px-3 file:py-1.5 file:text-ecms-text" />
            </label>
            <div className="sm:col-span-2 lg:col-span-4">
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
                <IconUpload size={16} /> Upload &amp; Parse
              </button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5"><p className="text-sm text-ecms-muted">Import Jobs</p><p className="mt-1 text-2xl font-bold text-ecms-text">{jobs.length}</p></div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5">
          <p className="text-sm text-ecms-muted">By Status</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {[...byStatus.entries()].map(([status, count]) => (
              <Badge key={status} tone={status === 'completed' ? 'success' : status === 'failed' ? 'danger' : status === 'completed_with_exceptions' ? 'warning' : 'neutral'}>{status} ({count})</Badge>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5">
          <p className="text-sm text-ecms-muted">Import Kinds</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {[...new Set(jobs.map((j) => j.import_kind))].map((k) => (
              <Badge key={k} tone="info">{k}</Badge>
            ))}
          </div>
        </div>
      </div>

      <Card icon={<IconFileText size={18} />}>
        {jobs.length === 0 ? (
          <EmptyState title="No import jobs" message="Uploaded BOQ, timesheet and ledger imports will appear here for mapping, validation and commit." />
        ) : (
          <Table>
            <THead><TH>Source</TH><TH>Kind</TH><TH>Status</TH><TH>Uploaded By</TH><TH>Sheets</TH><TH>Rows</TH><TH>Exceptions</TH><TH>Started</TH><TH>Completed</TH><TH>Created</TH></THead>
            <TBody>
              {jobs.map((j) => (
                <TR key={j.id} className="hover:bg-ecms-elevated/40">
                  <TD className="max-w-[220px] truncate font-medium">
                    <Link href={`/imports/${j.id}`} className="hover:text-ecms-amber">{j.source_name}</Link>
                  </TD>
                  <TD className="text-ecms-muted">{j.import_kind}</TD>
                  <TD><StatusPill status={j.status} /></TD>
                  <TD className="text-ecms-muted">{j.app_users?.display_name ?? '—'}</TD>
                  <TD>{j._count.import_sheets}</TD>
                  <TD>{j._count.import_rows}</TD>
                  <TD>{j._count.import_exceptions}</TD>
                  <TD>{j.started_at ? dateTime(j.started_at) : '—'}</TD>
                  <TD>{j.completed_at ? dateTime(j.completed_at) : '—'}</TD>
                  <TD className="text-ecms-muted">{dateTime(j.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
