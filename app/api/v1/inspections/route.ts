import { NextRequest, NextResponse } from 'next/server';
import type { inspection_result, inspection_status } from '@/lib/generated/prisma/client';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { redirectIfRequested, withErrorHandling } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });
  const auth = await requireApiPermission('inspection.request', projectId);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const subject = (form.get('subject') as string)?.trim();
  const requested_for = (form.get('requested_for') as string) || null;
  const result = ((form.get('result') as string)?.trim() || 'pending') as inspection_result;

  if (!subject) {
    return NextResponse.json({ error: 'subject is required' }, { status: 400 });
  }

  const count = await db.inspection_requests.count({ where: { project_id: projectId } });
  const inspection_number = `INS-${String(count + 1).padStart(3, '0')}`;

  const inspection = await db.inspection_requests.create({
    data: {
      project_id: projectId,
      inspection_number,
      subject,
      status: 'requested' as inspection_status,
      result,
      requested_by: userId,
      requested_for: requested_for ? new Date(requested_for) : null,
    },
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'CREATE',
    entityType: 'inspection_requests',
    entityId: inspection.id,
    after: { inspection_number, subject, result, requested_for },
  });

  redirectIfRequested(form);
  return NextResponse.json({ ok: true, id: inspection.id }, { status: 201 });
});
