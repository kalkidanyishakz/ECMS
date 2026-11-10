import { NextRequest, NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { withErrorHandling } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });
  const auth = await requireApiPermission('project.manage', projectId);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const cost_code = (form.get('cost_code') as string)?.trim();
  const name = (form.get('name') as string)?.trim();
  const category = ((form.get('category') as string)?.trim() || 'other') as string;
  const budget_amount = Number(form.get('budget_amount') ?? 0);

  if (!cost_code || !name) {
    return NextResponse.json({ error: 'cost_code and name are required' }, { status: 400 });
  }

  const allowedCategories = ['labor', 'material', 'plant', 'subcontract', 'overhead', 'other'];
  if (!allowedCategories.includes(category)) {
    return NextResponse.json(
      { error: `category must be one of: ${allowedCategories.join(', ')}` },
      { status: 400 }
    );
  }

  const existing = await db.cost_codes.findUnique({
    where: { project_id_cost_code: { project_id: projectId, cost_code } },
  });
  if (existing) {
    return NextResponse.json({ error: `Cost code ${cost_code} already exists` }, { status: 400 });
  }

  const costCode = await db.cost_codes.create({
    data: {
      project_id: projectId,
      cost_code,
      name,
      category,
      budget_amount: Number.isFinite(budget_amount) ? budget_amount : 0,
    },
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'CREATE',
    entityType: 'cost_codes',
    entityId: costCode.id,
    after: { cost_code, name, category, budget_amount },
  });

  redirect('/cost-and-boq');
});
