import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import type { membership_status } from '@/lib/generated/prisma/client';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { redirectIfRequested, withErrorHandling } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

/**
 * Invite/create a user: creates the app_user (and, when a password is supplied,
 * the Better Auth login), a tenant membership, and a project membership with a
 * project role. Mirrors db/seed-demo-users.ts.
 *
 * Better Auth has no invite/reset email transport configured in this demo, so a
 * login is only created when the admin supplies a temporary password. Without
 * one, the app_user + memberships are created with a placeholder `auth_subject`
 * that getAppUser() reconciles to the real auth id the first time the invitee
 * signs up with the same email (login limitation, documented in getAppUser).
 */
export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const { tenantId, projectId, userId } = await getProjectContext();
  const authCtx = await requireApiPermission('project.manage', projectId);
  if (authCtx instanceof NextResponse) return authCtx;

  const form = await req.formData();
  const email = (form.get('email') as string)?.trim().toLowerCase();
  const name = (form.get('name') as string)?.trim();
  const roleKey = (form.get('role_key') as string)?.trim();
  const password = (form.get('password') as string) ?? '';
  const organizationId = (form.get('organization_id') as string)?.trim() || null;

  if (!email || !name || !roleKey) {
    return NextResponse.json(
      { error: 'email, name and role_key are required' },
      { status: 400 }
    );
  }

  const role = await db.roles.findFirst({ where: { role_key: roleKey, tenant_id: null } });
  if (!role) {
    return NextResponse.json({ error: `Unknown role: ${roleKey}` }, { status: 400 });
  }

  if (organizationId) {
    const organization = await db.organizations.findFirst({
      where: { id: organizationId, tenant_id: tenantId },
    });
    if (!organization) {
      return NextResponse.json({ error: 'Invalid organization' }, { status: 400 });
    }
  }

  let authSubject: string | null = null;
  const existingAuthUser = await db.user.findFirst({ where: { email } });
  if (existingAuthUser) {
    authSubject = existingAuthUser.id;
  } else if (password) {
    const result = await auth.api.signUpEmail({ body: { email, password, name } });
    authSubject = result?.user?.id ?? null;
    if (!authSubject) {
      throw new Error(`Better Auth did not return a user id for ${email}`);
    }
  }

  const existingAppUser = await db.app_users.findFirst({ where: { email } });
  const appUser = existingAppUser
    ? await db.app_users.update({
        where: { id: existingAppUser.id },
        data: {
          display_name: name,
          is_active: true,
          ...(authSubject ? { auth_subject: authSubject } : {}),
        },
      })
    : await db.app_users.create({
        data: {
          auth_subject: authSubject ?? `invite:${randomUUID()}`,
          email,
          display_name: name,
        },
      });

  const membershipStatus: membership_status = authSubject ? 'active' : 'invited';
  await db.tenant_memberships.upsert({
    where: { tenant_id_user_id: { tenant_id: tenantId, user_id: appUser.id } },
    update: {
      status: membershipStatus,
      organization_id: organizationId,
      ...(authSubject ? { activated_at: new Date() } : {}),
    },
    create: {
      tenant_id: tenantId,
      user_id: appUser.id,
      status: membershipStatus,
      organization_id: organizationId,
      ...(authSubject ? { activated_at: new Date() } : {}),
    },
  });

  let projectMemberId: string | null = null;
  if (projectId) {
    const projectMember = await db.project_members.upsert({
      where: { project_id_user_id: { project_id: projectId, user_id: appUser.id } },
      update: { status: 'active', organization_id: organizationId },
      create: {
        project_id: projectId,
        user_id: appUser.id,
        status: 'active',
        organization_id: organizationId,
      },
    });
    projectMemberId = projectMember.id;

    await db.project_member_roles.upsert({
      where: { project_member_id_role_id: { project_member_id: projectMember.id, role_id: role.id } },
      update: {},
      create: { project_member_id: projectMember.id, role_id: role.id },
    });
  }

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'CREATE',
    entityType: 'app_users',
    entityId: appUser.id,
    after: {
      email,
      name,
      role_key: roleKey,
      organization_id: organizationId,
      has_login: Boolean(authSubject),
    },
  });

  redirectIfRequested(form, '/administration/settings');
  return NextResponse.json({ ok: true, user_id: appUser.id, project_member_id: projectMemberId });
});
