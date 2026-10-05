import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Badge } from '@/components/ui/Badge';
import { IconUsers, IconBuilding, IconPlus } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser, hasPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { dateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const ORG_TYPES = [
  'employer',
  'engineer',
  'consultant',
  'contractor',
  'subcontractor',
  'supplier',
  'financier',
  'government',
  'other',
] as const;

const inputClass = 'rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text';

export default async function SettingsPage() {
  const ctx = await requireAppUser();
  const { tenantId, projectId } = await getProjectContext();
  const canManage = await hasPermission('project.manage', { projectId });

  const [tenants, memberships, orgs, workflows] = await Promise.all([
    db.tenants.findMany({ orderBy: { name: 'asc' } }),
    db.tenant_memberships.findMany({
      where: { tenant_id: tenantId },
      include: {
        app_users: { select: { display_name: true, email: true } },
        organizations: { select: { short_name: true } },
        tenant_member_roles: { include: { roles: { select: { role_key: true, name: true } } } },
      },
    }),
    db.organizations.findMany({ where: { tenant_id: tenantId }, orderBy: { legal_name: 'asc' } }),
    db.workflow_tasks.findMany({ where: { assigned_user_id: ctx.appUser.id, status: { in: ['pending', 'active'] } }, orderBy: { due_at: 'asc' }, take: 20 }),
  ]);

  const [projectMembers, projectRoles] = await Promise.all([
    projectId
      ? db.project_members.findMany({
          where: { project_id: projectId },
          orderBy: { created_at: 'asc' },
          include: {
            app_users: { select: { display_name: true, email: true } },
            project_member_roles: { include: { roles: { select: { role_key: true, name: true } } } },
          },
        })
      : Promise.resolve([]),
    db.roles.findMany({
      where: { tenant_id: null, role_key: { not: 'tenant_admin' } },
      orderBy: { name: 'asc' },
      select: { role_key: true, name: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Users, Roles & Settings" />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="My Workflow Tasks" icon={<IconUsers size={18} />} className="xl:col-span-1">
          {workflows.length === 0 ? (
            <EmptyState title="No pending tasks" message="Approval tasks assigned to you will appear here." />
          ) : (
            <Table>
              <THead><TH>Step</TH><TH>Status</TH><TH>Due</TH></THead>
              <TBody>
                {workflows.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-medium">Step {t.step_number}</TD>
                    <TD><Badge tone={t.status === 'active' ? 'warning' : 'neutral'}>{t.status}</Badge></TD>
                    <TD className="text-ecms-muted">{t.due_at ? dateTime(t.due_at) : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card title="Tenant Members" icon={<IconUsers size={18} />} className="xl:col-span-2">
          {memberships.length === 0 ? (
            <EmptyState title="No members" message="Users added to this tenant appear here." />
          ) : (
            <Table>
              <THead><TH>User</TH><TH>Organization</TH><TH>Status</TH><TH>Roles</TH></THead>
              <TBody>
                {memberships.map((m) => (
                  <TR key={`${m.tenant_id}-${m.user_id}`}>
                    <TD>
                      <div className="font-medium">{m.app_users.display_name}</div>
                      <div className="text-xs text-ecms-muted">{m.app_users.email}</div>
                    </TD>
                    <TD className="text-ecms-muted">{m.organizations?.short_name ?? '—'}</TD>
                    <TD><Badge tone={m.status === 'active' ? 'success' : m.status === 'invited' ? 'warning' : 'neutral'}>{m.status}</Badge></TD>
                    <TD className="text-ecms-muted">{m.tenant_member_roles.map((r) => r.roles.role_key).join(', ') || '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      {canManage && (
        <Card title="Invite User" subtitle="Create an app user, membership and project role" icon={<IconPlus size={18} />}>
          <form method="POST" action="/api/v1/administration/users" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input name="email" type="email" required placeholder="Email" className={inputClass} />
            <input name="name" required placeholder="Full name" className={inputClass} />
            <select name="role_key" required className={inputClass} defaultValue="">
              <option value="" disabled>Project role…</option>
              {projectRoles.map((r) => <option key={r.role_key} value={r.role_key}>{r.name}</option>)}
            </select>
            <select name="organization_id" className={inputClass} defaultValue="">
              <option value="">Organization (optional)…</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.short_name ?? o.legal_name}</option>)}
            </select>
            <input name="password" type="password" autoComplete="new-password" placeholder="Temporary password (optional)" className={`${inputClass} sm:col-span-2`} />
            <div className="sm:col-span-2 lg:col-span-2 flex items-end">
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
                <IconPlus size={16} /> Invite User
              </button>
            </div>
          </form>
          <p className="mt-3 text-xs text-ecms-muted">
            No invite email transport is configured in this demo. Provide a temporary password to create a Better Auth login now;
            otherwise the membership is created as <span className="text-ecms-text">invited</span> and the login is linked when the
            user signs up with this email.
          </p>
        </Card>
      )}

      <Card title="Project Members & Roles" icon={<IconUsers size={18} />}>
        {projectMembers.length === 0 ? (
          <EmptyState title="No project members" message="Invite a user to add them to the active project." />
        ) : (
          <Table>
            <THead><TH>User</TH><TH>Current roles</TH>{canManage && <TH>Assign roles</TH>}</THead>
            <TBody>
              {projectMembers.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <div className="font-medium">{m.app_users.display_name}</div>
                    <div className="text-xs text-ecms-muted">{m.app_users.email}</div>
                  </TD>
                  <TD className="text-ecms-muted">
                    {m.project_member_roles.map((r) => r.roles.role_key).join(', ') || '—'}
                  </TD>
                  {canManage && (
                    <TD>
                      <form method="POST" action={`/api/v1/administration/members/${m.id}/roles`} className="flex flex-wrap items-center gap-2">
                        <select
                          name="role_keys"
                          multiple
                          size={3}
                          className={inputClass}
                          defaultValue={m.project_member_roles.map((a) => a.roles.role_key)}
                        >
                          {projectRoles.map((r) => (
                            <option key={r.role_key} value={r.role_key}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="rounded-lg border border-ecms-border bg-ecms-elevated px-3 py-1.5 text-sm font-medium text-ecms-text hover:bg-ecms-elevated/70">
                          Save
                        </button>
                      </form>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Tenants" icon={<IconBuilding size={18} />}>
          {tenants.length === 0 ? (
            <EmptyState title="No tenants" message="Organization tenants appear here." />
          ) : (
            <Table>
              <THead><TH>Name</TH><TH>Slug</TH><TH>Currency</TH><TH>Timezone</TH><TH>Created</TH></THead>
              <TBody>
                {tenants.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-medium">{t.name}</TD>
                    <TD className="text-ecms-muted">{t.slug}</TD>
                    <TD>{t.default_currency}</TD>
                    <TD className="text-ecms-muted">{t.timezone}</TD>
                    <TD>{dateTime(t.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card title="Organizations" icon={<IconBuilding size={18} />}>
          {canManage && (
            <form method="POST" action="/api/v1/administration/organizations" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input name="legal_name" required placeholder="Legal name" className={inputClass} />
              <input name="short_name" placeholder="Short name" className={inputClass} />
              <select name="organization_type" className={inputClass} defaultValue="other">
                {ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
                <IconPlus size={16} /> Add
              </button>
            </form>
          )}
          {orgs.length === 0 ? (
            <EmptyState title="No organizations" message="Employer, engineer, contractor and supplier organizations appear here." />
          ) : (
            <Table>
              <THead><TH>Legal Name</TH><TH>Short Name</TH><TH>Type</TH><TH>Active</TH></THead>
              <TBody>
                {orgs.map((o) => (
                  <TR key={o.id}>
                    <TD className="font-medium">{o.legal_name}</TD>
                    <TD className="text-ecms-muted">{o.short_name ?? '—'}</TD>
                    <TD className="text-ecms-muted">{o.organization_type}</TD>
                    <TD><Badge tone={o.is_active ? 'success' : 'neutral'}>{o.is_active ? 'active' : 'inactive'}</Badge></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
