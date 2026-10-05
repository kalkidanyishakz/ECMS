import { NextRequest, NextResponse } from 'next/server';
import type { issue_severity, rfi_status } from '@/lib/generated/prisma/client';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { redirectIfRequested, withErrorHandling } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });
  const auth = await requireApiPermission('rfi.create', projectId);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const subject = (form.get('subject') as string)?.trim();
  const question = (form.get('question') as string)?.trim();
  const priority = ((form.get('priority') as string)?.trim() || 'medium') as issue_severity;
  const due_date = (form.get('due_date') as string) || null;

  if (!subject || !question) {
    return NextResponse.json({ error: 'subject and question are required' }, { status: 400 });
  }

  const count = await db.rfis.count({ where: { project_id: projectId } });
  const rfi_number = `RFI-${String(count + 1).padStart(3, '0')}`;

  const rfi = await db.rfis.create({
    data: {
      project_id: projectId,
      rfi_number,
      subject,
      question,
      status: 'open' as rfi_status,
      priority,
      raised_by: userId,
      opened_at: new Date(),
      due_date: due_date ? new Date(due_date) : null,
    },
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'CREATE',
    entityType: 'rfis',
    entityId: rfi.id,
    after: { rfi_number, subject, priority, due_date },
  });

  redirectIfRequested(form);
  return NextResponse.json({ ok: true, id: rfi.id }, { status: 201 });
});
