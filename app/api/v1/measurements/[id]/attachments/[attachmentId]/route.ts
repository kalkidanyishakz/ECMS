import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { withErrorHandling } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const DELETE = withErrorHandling(async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id, attachmentId } = await params;
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });

  // Deleting a draft upload requires measurement.create; verifiers may also
  // remove attachments while reviewing.
  const createAuth = await requireApiPermission('measurement.create', projectId);
  if (createAuth instanceof NextResponse) {
    if (createAuth.status !== 403) return createAuth;
    const verifyAuth = await requireApiPermission('measurement.verify', projectId);
    if (verifyAuth instanceof NextResponse) return verifyAuth;
  }

  const measurement = await db.measurements.findUnique({
    where: { id },
    select: { id: true, project_id: true },
  });
  if (!measurement || measurement.project_id !== projectId) {
    return NextResponse.json({ error: 'Measurement not found' }, { status: 404 });
  }

  const lines = await db.measurement_lines.findMany({
    where: { measurement_id: id },
    select: { id: true },
  });
  const lineIds = new Set(lines.map((l) => l.id));

  const attachment = await db.record_attachments.findFirst({
    where: { id: attachmentId, project_id: projectId },
  });
  const belongsToMeasurement = attachment
    ? (attachment.record_type === 'measurement' && attachment.record_id === id) ||
      (attachment.record_type === 'measurement_line' && lineIds.has(attachment.record_id))
    : false;
  if (!attachment || !belongsToMeasurement) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  }

  await db.record_attachments.delete({ where: { id: attachmentId } });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'DELETE',
    entityType: 'record_attachments',
    entityId: attachmentId,
    before: {
      record_type: attachment.record_type,
      record_id: attachment.record_id,
      file_id: attachment.file_id,
      description: attachment.description,
    },
  });

  let redirectTo = req.nextUrl.searchParams.get('redirect_to')?.trim() ?? '';
  if (!redirectTo && (req.headers.get('content-type') ?? '').includes('form-data')) {
    const form = await req.formData();
    redirectTo = (form.get('redirect_to') as string | null)?.trim() ?? '';
  }
  if (redirectTo) return NextResponse.redirect(new URL(redirectTo, req.url));

  return NextResponse.json({ ok: true });
});
