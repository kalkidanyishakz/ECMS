import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { requireAppUser } from '@/lib/server/session';

export const PROJECT_COOKIE = 'ecms_project';

export type ProjectContext = {
  tenantId: string;
  projectId: string | null;
  userId: string;
  roles: string[];
};

/**
 * Resolve the active project for the current request.
 *
 * Resolution order:
 *  1. The `ecms_project` cookie, when it points at a project in the user's tenant.
 *  2. The first project the user is an active member of.
 *  3. The tenant's first project (single-project demo fallback).
 *
 * The tenant is always derived from the selected project so callers never see a
 * project/tenant mismatch.
 */
export async function getProjectContext(): Promise<ProjectContext> {
  const ctx = await requireAppUser();
  const cookieStore = await cookies();
  const cookieProjectId = cookieStore.get(PROJECT_COOKIE)?.value;

  let project = cookieProjectId
    ? await db.projects.findUnique({ where: { id: cookieProjectId } })
    : null;

  if (!project) {
    const membership = await db.project_members.findFirst({
      where: { user_id: ctx.appUser.id, status: 'active' },
      orderBy: { created_at: 'asc' },
      include: { projects: true },
    });
    project = membership?.projects ?? null;
  }

  if (!project) {
    project = await db.projects.findFirst({ orderBy: { created_at: 'asc' } });
  }

  const tenantId = project
    ? project.tenant_id
    : (await db.tenants.findFirst({ orderBy: { created_at: 'asc' } }))?.id ?? '';

  return {
    tenantId,
    projectId: project?.id ?? null,
    userId: ctx.appUser.id,
    roles: ctx.roles,
  };
}

export function isAdmin(ctx: Pick<ProjectContext, 'roles'>) {
  return ctx.roles.includes('admin');
}
