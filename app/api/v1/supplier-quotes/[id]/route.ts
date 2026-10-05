import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { withErrorHandling, redirectIfRequested } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

/**
 * Allowed supplier-quote status transitions. Mirrors the
 * `ck_supplier_quotes_status` check constraint in the schema.
 */
const transitions: Record<string, string[]> = {
  received: ['clarification', 'evaluated', 'withdrawn'],
  clarification: ['evaluated', 'withdrawn'],
  evaluated: ['selected', 'not_selected', 'withdrawn'],
  selected: [],
  not_selected: [],
  withdrawn: [],
};

/** Permission required for each target status transition. */
const TARGET_PERMISSIONS: Record<string, string> = {
  clarification: 'procurement.order',
  evaluated: 'procurement.order',
  selected: 'procurement.approve',
  not_selected: 'procurement.approve',
  withdrawn: 'procurement.order',
};

export const POST = withErrorHandling(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });

  const quote = await db.supplier_quotes.findUnique({
    where: { id },
    select: { id: true, project_id: true, status: true, quote_number: true },
  });
  if (!quote || quote.project_id !== projectId) {
    return NextResponse.json({ error: 'Supplier quote not found' }, { status: 404 });
  }

  const form = await req.formData();
  const target = (form.get('status') as string | null)?.trim() ?? '';

  const requiredPermission = TARGET_PERMISSIONS[target];
  if (!requiredPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const auth = await requireApiPermission(requiredPermission, projectId);
  if (auth instanceof NextResponse) return auth;

  const allowed = transitions[quote.status] ?? [];
  if (!allowed.includes(target)) {
    return NextResponse.json(
      { error: `Invalid transition ${quote.status} -> ${target}` },
      { status: 409 }
    );
  }

  await db.supplier_quotes.update({
    where: { id },
    data: { status: target },
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'UPDATE',
    entityType: 'supplier_quotes',
    entityId: quote.id,
    before: { status: quote.status },
    after: { status: target },
  });

  redirectIfRequested(form, '/procurement/quotes');

  return NextResponse.json({ ok: true, supplier_quote_id: quote.id, status: target });
});
