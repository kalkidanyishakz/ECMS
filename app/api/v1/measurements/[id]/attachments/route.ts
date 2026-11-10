import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { saveUploadedFile, extractUpload } from '@/lib/storage';
import { withErrorHandling } from '@/lib/api-handler';
import { toAttachmentOption, validateAttachmentTarget } from '@/lib/attachments';

export const dynamic = 'force-dynamic';

const fileInclude = {
  stored_files: { select: { original_name: true, mime_type: true, size_bytes: true } },
} as const;

export const GET = withErrorHandling(async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { projectId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });

  const auth = await requireApiPermission('measurement.create', projectId);
  if (auth instanceof NextResponse) return auth;

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
  const lineIds = lines.map((l) => l.id);

  const attachments = await db.record_attachments.findMany({
    where: {
      project_id: projectId,
      OR: [
        { record_type: 'measurement', record_id: id },
        { record_type: 'measurement_line', record_id: { in: lineIds } },
      ],
    },
    include: fileInclude,
    orderBy: { created_at: 'desc' },
  });

  return NextResponse.json({ attachments: attachments.map(toAttachmentOption) });
});

export const POST = withErrorHandling(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });

  const auth = await requireApiPermission('measurement.create', projectId);
  if (auth instanceof NextResponse) return auth;

  const measurement = await db.measurements.findUnique({
    where: { id },
    select: { id: true, project_id: true },
  });
  if (!measurement || measurement.project_id !== projectId) {
    return NextResponse.json({ error: 'Measurement not found' }, { status: 404 });
  }

  const form = await req.formData();
  const upload = extractUpload(form);
  if (!upload) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  const lines = await db.measurement_lines.findMany({
    where: { measurement_id: id },
    select: { id: true },
  });
  const target = validateAttachmentTarget({
    recordType: form.get('record_type') as string | null,
    recordId: form.get('record_id') as string | null,
    measurementId: id,
    lineIds: lines.map((l) => l.id),
  });
  if (!target.ok) {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }

  const description = (form.get('description') as string | null)?.trim() || null;
  const stored = await saveUploadedFile(upload, { tenantId, userId });

  const attachment = await db.record_attachments.create({
    data: {
      project_id: projectId,
      record_type: target.recordType,
      record_id: target.recordId,
      file_id: stored.id,
      attachment_role: 'evidence',
      description,
      captured_at: new Date(),
      captured_by: userId,
      metadata: {},
    },
    include: fileInclude,
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'CREATE',
    entityType: 'record_attachments',
    entityId: attachment.id,
    after: {
      record_type: target.recordType,
      record_id: target.recordId,
      file_id: stored.id,
      original_name: stored.original_name,
      description,
    },
  });

  const redirectTo = (form.get('redirect_to') as string | null)?.trim();
  if (redirectTo) return NextResponse.redirect(new URL(redirectTo, req.url));

  return NextResponse.json({ attachment: toAttachmentOption(attachment) }, { status: 201 });
});
