/**
 * Seed script: demo logins for the ECMS Docker demo.
 *
 * Creates Better Auth credentials for the three demo accounts and links them to
 * the application side (app_users, tenant_memberships, tenant_member_roles,
 * project_members, project_member_roles) so a login resolves real permissions.
 *
 * Run:  npx tsx db/seed-demo-users.ts
 * Idempotent: safe to re-run against an existing database.
 */
import { auth } from '../lib/auth';
import { db } from '../lib/db';

const DEMO_PASSWORD = 'demo1234';
const TENANT_SLUG = 'ecms-demo';
const PROJECT_CODE = 'JIGJIGA';

type DemoUser = {
  email: string;
  name: string;
  tenantRoles: string[];
  projectRoles: string[];
};

const DEMO_USERS: DemoUser[] = [
  {
    email: 'pm@ecms.app',
    name: 'Amina Yusuf (Project Manager)',
    tenantRoles: ['tenant_admin', 'employer_pm'],
    projectRoles: ['employer_pm'],
  },
  {
    email: 'supervisor@ecms.app',
    name: 'Dawit Bekele (Site Supervisor)',
    tenantRoles: ['quantity_surveyor', 'site_inspector'],
    projectRoles: ['quantity_surveyor', 'site_inspector'],
  },
  {
    email: 'store@ecms.app',
    name: 'Hanna Girma (Storekeeper)',
    tenantRoles: ['storekeeper', 'procurement_officer'],
    projectRoles: ['storekeeper', 'procurement_officer'],
  },
  {
    email: 'finance@ecms.app',
    name: 'Yonas Tesfaye (Finance Officer)',
    tenantRoles: ['finance'],
    projectRoles: ['finance'],
  },
];

async function ensureAuthUserId(user: DemoUser): Promise<string> {
  const existing = await db.user.findFirst({ where: { email: user.email } });
  if (existing) return existing.id;

  const result = await auth.api.signUpEmail({
    body: { email: user.email, password: DEMO_PASSWORD, name: user.name },
  });
  if (!result?.user?.id) {
    throw new Error(`Better Auth did not return a user id for ${user.email}`);
  }
  return result.user.id;
}

async function seedUser(user: DemoUser, tenantId: string, projectId: string, roleByKey: Map<string, string>) {
  const authUserId = await ensureAuthUserId(user);

  const existingByAuth = await db.app_users.findUnique({ where: { auth_subject: authUserId } });
  const existingByEmail = existingByAuth ?? (await db.app_users.findFirst({ where: { email: user.email } }));
  const appUser = existingByEmail
    ? await db.app_users.update({
        where: { id: existingByEmail.id },
        data: { auth_subject: authUserId, email: user.email, display_name: user.name, is_active: true },
      })
    : await db.app_users.create({
        data: { auth_subject: authUserId, email: user.email, display_name: user.name },
      });

  await db.tenant_memberships.upsert({
    where: { tenant_id_user_id: { tenant_id: tenantId, user_id: appUser.id } },
    update: { status: 'active', activated_at: new Date() },
    create: { tenant_id: tenantId, user_id: appUser.id, status: 'active', activated_at: new Date() },
  });

  for (const roleKey of user.tenantRoles) {
    const roleId = roleByKey.get(roleKey);
    if (!roleId) throw new Error(`System role not found: ${roleKey}`);
    await db.tenant_member_roles.upsert({
      where: { tenant_id_user_id_role_id: { tenant_id: tenantId, user_id: appUser.id, role_id: roleId } },
      update: {},
      create: { tenant_id: tenantId, user_id: appUser.id, role_id: roleId },
    });
  }

  const projectMember = await db.project_members.upsert({
    where: { project_id_user_id: { project_id: projectId, user_id: appUser.id } },
    update: { status: 'active' },
    create: { project_id: projectId, user_id: appUser.id, status: 'active' },
  });

  for (const roleKey of user.projectRoles) {
    const roleId = roleByKey.get(roleKey);
    if (!roleId) throw new Error(`System role not found: ${roleKey}`);
    await db.project_member_roles.upsert({
      where: { project_member_id_role_id: { project_member_id: projectMember.id, role_id: roleId } },
      update: {},
      create: { project_member_id: projectMember.id, role_id: roleId },
    });
  }

  console.log(
    `  ${user.email} -> auth=${authUserId} app_user=${appUser.id} ` +
      `tenant=[${user.tenantRoles.join(', ')}] project=[${user.projectRoles.join(', ')}]`
  );
}

async function main() {
  console.log('Seeding ECMS demo users...\n');

  const tenant = await db.tenants.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found. Run db/seed-jigjiga.ts first.`);

  const project = await db.projects.findFirst({
    where: { tenant_id: tenant.id, project_code: PROJECT_CODE },
  });
  if (!project) throw new Error(`Project "${PROJECT_CODE}" not found. Run db/seed-jigjiga.ts first.`);

  const systemRoles = await db.roles.findMany({ where: { tenant_id: null } });
  const roleByKey = new Map(systemRoles.map((role) => [role.role_key, role.id]));

  for (const user of DEMO_USERS) {
    await seedUser(user, tenant.id, project.id, roleByKey);
  }

  await db.$disconnect();
  console.log('\nDone. Demo users ready (password: demo1234).');
}

main().catch(async (error) => {
  console.error('Demo user seed failed:', error);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
