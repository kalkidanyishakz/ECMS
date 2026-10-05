import { NextRequest, NextResponse } from 'next/server';
import type { party_role } from '@/lib/generated/prisma/client';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { redirectIfRequested, withErrorHandling } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

const PARTY_ROLES: party_role[] = [
  'employer',
  'engineer',
  'consultant',
  'contractor',
  'subcontractor',
  'supplier',
  'financier',
  'government',
  'other',
];

export const POST = withErrorHandling(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { tenantId, projectId, userId } = await getProjectContext();
  const auth = await requireApiPermission('project.manage', projectId);
  if (auth instanceof NextResponse) return auth;

  const organization = await db.organizations.findFirst({
    where: { id, tenant_id: tenantId },
  });
  if (!organization) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  const form = await req.formData();
  const data: Record<string, unknown> = {};

  if (form.has('legal_name')) {
    const legal_name = (form.get('legal_name') as string)?.trim();
    if (!legal_name) {
      return NextResponse.json({ error: 'legal_name cannot be empty' }, { status: 400 });
    }
    data.legal_name = legal_name;
  }
  if (form.has('short_name')) {
    data.short_name = (form.get('short_name') as string)?.trim() || null;
  }
  if (form.has('organization_type')) {
    const typeInput = (form.get('organization_type') as string)?.trim() as party_role | undefined;
    if (!typeInput || !PARTY_ROLES.includes(typeInput)) {
      return NextResponse.json({ error: 'Invalid organization_type' }, { status: 400 });
    }
    data.organization_type = typeInput;
  }
  if (form.has('email')) {
    data.email = (form.get('email') as string)?.trim() || null;
  }
  if (form.has('phone')) {
    data.phone = (form.get('phone') as string)?.trim() || null;
  }
  if (form.has('is_active')) {
    data.is_active = (form.get('is_active') as string) === 'true';
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const updated = await db.organizations.update({ where: { id }, data });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'UPDATE',
    entityType: 'organizations',
    entityId: id,
    before: {
      legal_name: organization.legal_name,
      short_name: organization.short_name,
      organization_type: organization.organization_type,
      is_active: organization.is_active,
    },
    after: data,
  });

  redirectIfRequested(form, '/administration/settings');
  return NextResponse.json({ ok: true, id: updated.id });
});
