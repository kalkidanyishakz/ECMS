import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { redirectIfRequested, withErrorHandling } from '@/lib/api-handler';
import { withSearchPath } from '@/lib/server/search-path';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });
  const auth = await requireApiPermission('attendance.record', projectId);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const worker_id = (form.get('worker_id') as string)?.trim();
  const attendance_date = (form.get('attendance_date') as string) || null;
  const regular_hours = Number(form.get('regular_hours') ?? 0);
  const overtime_hours = Number(form.get('overtime_hours') ?? 0);
  const attendance_status = (form.get('attendance_status') as string)?.trim() || 'present';
  const source = (form.get('source') as string)?.trim() || 'manual';

  if (!worker_id || !attendance_date) {
    return NextResponse.json({ error: 'worker_id and attendance_date are required' }, { status: 400 });
  }

  const worker = await db.workers.findFirst({ where: { id: worker_id, project_id: projectId } });
  if (!worker) return NextResponse.json({ error: 'Invalid worker' }, { status: 400 });

  const record = await withSearchPath(async (tx) =>
    tx.attendance_records.create({
      data: {
        project_id: projectId,
        worker_id,
        attendance_date: new Date(attendance_date),
        regular_hours: Number.isNaN(regular_hours) ? 0 : regular_hours,
        overtime_hours: Number.isNaN(overtime_hours) ? 0 : overtime_hours,
        attendance_status,
        recorded_by: userId,
        source,
      },
    })
  );

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'CREATE',
    entityType: 'attendance_records',
    entityId: record.id,
    after: { worker_id, attendance_date, regular_hours, overtime_hours, attendance_status, source },
  });

  redirectIfRequested(form);
  return NextResponse.json({ ok: true, id: record.id }, { status: 201 });
});
