import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Badge } from '@/components/ui/Badge';
import { IconFingerprint, IconPlus } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser, hasPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { date, num } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AttendancePage() {
  await requireAppUser();
  const { tenantId, projectId } = await getProjectContext();

  const records = await db.attendance_records.findMany({
    where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
    orderBy: { attendance_date: 'desc' },
    take: 200,
    include: {
      workers: { select: { worker_number: true, display_name: true } },
      work_packages: { select: { package_code: true } },
      cost_codes: { select: { cost_code: true } },
    },
  });

  const workers = await db.workers.findMany({
    where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
    select: { id: true, worker_number: true, display_name: true },
    orderBy: { display_name: 'asc' },
  });

  const canCreate = await hasPermission('attendance.record', { projectId });

  const today = new Date().toISOString().slice(0, 10);
  const todayCount = records.filter((r) => r.attendance_date.toISOString().slice(0, 10) === today).length;
  const present = records.filter((r) => r.attendance_status === 'present').length;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Attendance" />

      {canCreate && (
        <Card title="Record Attendance" icon={<IconFingerprint size={18} />}>
          <form method="POST" action="/api/v1/attendance" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input type="hidden" name="redirect_to" value="/workforce/attendance" />
            <select name="worker_id" required className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="">Worker…</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.worker_number} · {w.display_name}</option>)}
            </select>
            <input name="attendance_date" type="date" required defaultValue={today} className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
            <input name="regular_hours" type="number" step="0.5" placeholder="Regular hrs" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
            <input name="overtime_hours" type="number" step="0.5" placeholder="OT hrs" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text" />
            <select name="attendance_status" defaultValue="present" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="present">present</option>
              <option value="absent">absent</option>
              <option value="half_day">half_day</option>
              <option value="leave">leave</option>
            </select>
            <select name="source" defaultValue="manual" className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text">
              <option value="manual">manual</option>
              <option value="biometric">biometric</option>
            </select>
            <div className="sm:col-span-2 lg:col-span-5">
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
                <IconPlus size={16} /> Record Attendance
              </button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5"><p className="text-sm text-ecms-muted">Records (recent)</p><p className="mt-1 text-2xl font-bold text-ecms-text">{records.length}</p></div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5"><p className="text-sm text-ecms-muted">Marked Present</p><p className="mt-1 text-2xl font-bold text-ecms-success">{present}</p></div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5"><p className="text-sm text-ecms-muted">Today</p><p className="mt-1 text-2xl font-bold text-ecms-amber">{todayCount}</p></div>
      </div>

      <Card icon={<IconFingerprint size={18} />}>
        {records.length === 0 ? (
          <EmptyState title="No attendance records" message="Daily attendance captured on site appears here." />
        ) : (
          <Table>
            <THead><TH>Date</TH><TH>Worker</TH><TH>Package</TH><TH>Cost Code</TH><TH>Status</TH><TH className="text-right">Regular Hrs</TH><TH className="text-right">OT Hrs</TH><TH>Check In</TH><TH>Check Out</TH></THead>
            <TBody>
              {records.map((r) => (
                <TR key={r.id} className="hover:bg-ecms-elevated/40">
                  <TD>{date(r.attendance_date)}</TD>
                  <TD className="font-medium">{r.workers.display_name} <span className="text-ecms-muted">({r.workers.worker_number})</span></TD>
                  <TD className="text-ecms-muted">{r.work_packages?.package_code ?? '—'}</TD>
                  <TD className="text-ecms-muted">{r.cost_codes?.cost_code ?? '—'}</TD>
                  <TD><Badge tone={r.attendance_status === 'present' ? 'success' : r.attendance_status === 'absent' ? 'danger' : 'warning'}>{r.attendance_status}</Badge></TD>
                  <TD className="text-right">{num(Number(r.regular_hours), 1)}</TD>
                  <TD className="text-right">{num(Number(r.overtime_hours), 1)}</TD>
                  <TD className="text-ecms-muted">{r.check_in_at ? r.check_in_at.toISOString().slice(11, 16) : '—'}</TD>
                  <TD className="text-ecms-muted">{r.check_out_at ? r.check_out_at.toISOString().slice(11, 16) : '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
