import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { redirectIfRequested, withErrorHandling } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

/**
 * Replace the project roles assigned to a project member.
 *
 * `id` is the `project_members.id` (the join table carrying project-level
 * access). Roles are written to `project_member_roles` keyed by
 * (project_member_id, role_id), matching the seed.
 */
export const POST = withErrorHandling(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });

  const auth = await requireApiPermission('project.manage', projectId);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const roleKeys = form
    .getAll('role_keys')
    .map((value) => String(value).trim())
    .filter(Boolean);

  const member = await db.project_members.findUnique({
    where: { id },
    include: { projects: { select: { tenant_id: true } } },
  });
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }
  if (member.project_id !== projectId || member.projects.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'Member does not belong to this project' }, { status: 403 });
  }

  const roles = await db.roles.findMany({
    where: { tenant_id: null, role_key: { in: roleKeys } },
  });
  const roleIdByKey = new Map(roles.map((role) => [role.role_key, role.id]));
  const unknown = roleKeys.filter((key) => !roleIdByKey.has(key));
  if (unknown.length > 0) {
    return NextResponse.json({ error: `Unknown roles: ${unknown.join(', ')}` }, { status: 400 });
  }

  const before = await db.project_member_roles.findMany({
    where: { project_member_id: id },
    include: { roles: { select: { role_key: true } } },
  });

  await db.$transaction([
    db.project_member_roles.deleteMany({ where: { project_member_id: id } }),
    ...roleKeys.map((key) =>
      db.project_member_roles.create({
        data: { project_member_id: id, role_id: roleIdByKey.get(key)! },
      })
    ),
  ]);

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'UPDATE',
    entityType: 'project_member_roles',
    entityId: id,
    before: { role_keys: before.map((assignment) => assignment.roles.role_key) },
    after: { role_keys: roleKeys },
  });

  redirectIfRequested(form, '/administration/settings');
  return NextResponse.json({ ok: true, role_keys: roleKeys });
});
