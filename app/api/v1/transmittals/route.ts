import { NextRequest, NextResponse } from 'next/server';
import type { transmittal_direction } from '@/lib/generated/prisma/client';
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
  const auth = await requireApiPermission('transmittal.create', projectId);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const direction = (form.get('direction') as string)?.trim() as transmittal_direction;
  const subject = (form.get('subject') as string)?.trim();
  const status = (form.get('status') as string)?.trim() || 'draft';
  const sender_org_id = (form.get('sender_org_id') as string)?.trim() || null;
  const recipient_org_id = (form.get('recipient_org_id') as string)?.trim() || null;
  const sent_at = (form.get('sent_at') as string) || null;

  if (!subject || (direction !== 'incoming' && direction !== 'outgoing')) {
    return NextResponse.json({ error: 'subject and a valid direction are required' }, { status: 400 });
  }

  const count = await db.transmittals.count({ where: { project_id: projectId } });
  const transmittal_number = `TR-${String(count + 1).padStart(3, '0')}`;

  const transmittal = await withSearchPath(async (tx) =>
    tx.transmittals.create({
      data: {
        project_id: projectId,
        transmittal_number,
        direction,
        subject,
        status,
        sender_org_id,
        recipient_org_id,
        sent_at: sent_at ? new Date(sent_at) : null,
        created_by: userId,
      },
    })
  );

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'CREATE',
    entityType: 'transmittals',
    entityId: transmittal.id,
    after: { transmittal_number, direction, subject, status, sender_org_id, recipient_org_id },
  });

  redirectIfRequested(form);
  return NextResponse.json({ ok: true, id: transmittal.id }, { status: 201 });
});
