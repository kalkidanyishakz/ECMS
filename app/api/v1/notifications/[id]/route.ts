import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { withErrorHandling } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { tenantId, projectId, userId } = await getProjectContext();

  const form = await req.formData().catch(() => new FormData());
  const markAll = form.get('all') === 'true';

  const now = new Date();
  const updated = await db.notifications.updateMany({
    where: markAll
      ? { user_id: userId, read_at: null }
      : { id, user_id: userId, read_at: null },
    data: { read_at: now, status: 'read' },
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'MARK_READ',
    entityType: 'notifications',
    entityId: markAll ? null : id,
    after: { read_at: now.toISOString(), all: markAll, count: updated.count },
  });

  return NextResponse.json({ updated: updated.count });
});
