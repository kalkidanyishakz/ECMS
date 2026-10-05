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
  const auth = await requireApiPermission('daywork.create', projectId);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const contract_id = (form.get('contract_id') as string)?.trim();
  const work_date = (form.get('work_date') as string) || null;
  const description = (form.get('description') as string)?.trim();
  const status = (form.get('status') as string)?.trim() || 'draft';
  const total_amount = Number(form.get('total_amount') ?? 0);

  if (!contract_id || !work_date || !description) {
    return NextResponse.json({ error: 'contract_id, work_date and description are required' }, { status: 400 });
  }

  const contract = await db.contracts.findFirst({ where: { id: contract_id, project_id: projectId } });
  if (!contract) return NextResponse.json({ error: 'Invalid contract' }, { status: 400 });

  const count = await db.daywork_sheets.count({ where: { project_id: projectId } });
  const sheet_number = `DW-${String(count + 1).padStart(3, '0')}`;

  const sheet = await withSearchPath(async (tx) =>
    tx.daywork_sheets.create({
      data: {
        project_id: projectId,
        contract_id,
        sheet_number,
        work_date: new Date(work_date),
        description,
        status,
        total_amount: Number.isNaN(total_amount) ? 0 : total_amount,
        submitted_by: userId,
      },
    })
  );

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'CREATE',
    entityType: 'daywork_sheets',
    entityId: sheet.id,
    after: { sheet_number, contract_id, work_date, description, status, total_amount },
  });

  redirectIfRequested(form);
  return NextResponse.json({ ok: true, id: sheet.id }, { status: 201 });
});
