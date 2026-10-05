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

export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const { tenantId, projectId, userId } = await getProjectContext();
  const auth = await requireApiPermission('project.manage', projectId);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const legal_name = (form.get('legal_name') as string)?.trim();
  const short_name = (form.get('short_name') as string)?.trim() || null;
  const typeInput = (form.get('organization_type') as string)?.trim() as party_role | undefined;
  const organization_type: party_role =
    typeInput && PARTY_ROLES.includes(typeInput) ? typeInput : 'other';
  const email = (form.get('email') as string)?.trim() || null;
  const phone = (form.get('phone') as string)?.trim() || null;

  if (!legal_name) {
    return NextResponse.json({ error: 'legal_name is required' }, { status: 400 });
  }

  const organization = await db.organizations.create({
    data: {
      tenant_id: tenantId,
      legal_name,
      short_name,
      organization_type,
      email,
      phone,
    },
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'CREATE',
    entityType: 'organizations',
    entityId: organization.id,
    after: { legal_name, short_name, organization_type },
  });

  redirectIfRequested(form, '/administration/settings');
  return NextResponse.json({ ok: true, id: organization.id });
});
