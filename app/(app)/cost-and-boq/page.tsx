import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconCurrencyDollar, IconPlus } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser, hasAnyPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { money, num } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function CostCodesPage() {
  const ctx = await requireAppUser();
  const { tenantId, projectId } = await getProjectContext();
  const canManage = hasAnyPermission(ctx.roles, ctx.permissions, 'project.manage');

  const costCodes = await db.cost_codes.findMany({
    where: projectId
      ? { project_id: projectId }
      : { projects: { tenant_id: tenantId } },
    orderBy: { cost_code: 'asc' },
  });

  const [labor, materials] = await Promise.all([
    db.timesheet_lines.groupBy({ by: ['cost_code_id'], where: { cost_code_id: { not: null }, timesheets: { status: { in: ['approved', 'included_in_payroll'] }, projects: { tenant_id: tenantId } } }, _sum: { gross_amount: true } }),
    db.material_issue_lines.groupBy({
      by: ['material_issue_id'],
      where: { material_issues: { status: 'posted', projects: { tenant_id: tenantId } } },
      _sum: { unit_cost_snapshot: true },
    }).then(async () => {
      const byCode = new Map<string, number>();
      const lines = await db.material_issue_lines.findMany({
        where: { material_issues: { status: 'posted', projects: { tenant_id: tenantId } } },
        select: { unit_cost_snapshot: true, issued_quantity: true, material_issues: { select: { cost_code_id: true } } },
      });
      for (const l of lines) {
        if (l.material_issues.cost_code_id) {
          byCode.set(l.material_issues.cost_code_id, (byCode.get(l.material_issues.cost_code_id) ?? 0) + Number(l.issued_quantity) * Number(l.unit_cost_snapshot));
        }
      }
      return byCode;
    }),
  ]);

  const laborByCode = new Map(labor.map((r) => [r.cost_code_id ?? '', Number(r._sum.gross_amount ?? 0)]));

  const totalBudget = costCodes.reduce((s, c) => s + Number(c.budget_amount), 0);
  const totalSpend = costCodes.reduce((s, c) => s + (laborByCode.get(c.id) ?? 0) + (materials.get(c.id) ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Cost Codes & Budget"
        actions={
          canManage && projectId ? (
            <form method="POST" action="/api/v1/cost-codes" className="flex flex-wrap items-center gap-2">
              <input name="cost_code" placeholder="Code (e.g. CC-001)" required className="w-36 rounded-lg border border-ecms-border bg-ecms-card px-3 py-1.5 text-sm text-ecms-text placeholder:text-ecms-muted" />
              <input name="name" placeholder="Cost code name" required className="w-48 rounded-lg border border-ecms-border bg-ecms-card px-3 py-1.5 text-sm text-ecms-text placeholder:text-ecms-muted" />
              <select name="category" defaultValue="other" className="w-32 rounded-lg border border-ecms-border bg-ecms-card px-3 py-1.5 text-sm text-ecms-text">
                {['labor', 'material', 'plant', 'subcontract', 'overhead', 'other'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input name="budget_amount" type="number" min="0" step="0.01" placeholder="Budget" className="w-32 rounded-lg border border-ecms-border bg-ecms-card px-3 py-1.5 text-sm text-ecms-text placeholder:text-ecms-muted" />
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90">
                <IconPlus size={16} /> New Cost Code
              </button>
            </form>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5">
          <p className="text-sm text-ecms-muted">Total Budget</p>
          <p className="mt-1 text-2xl font-bold text-ecms-text">{money(totalBudget)}</p>
        </div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5">
          <p className="text-sm text-ecms-muted">Spend (labor + materials)</p>
          <p className="mt-1 text-2xl font-bold text-ecms-amber">{money(totalSpend)}</p>
        </div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5">
          <p className="text-sm text-ecms-muted">Remaining</p>
          <p className="mt-1 text-2xl font-bold text-ecms-success">{money(totalBudget - totalSpend)}</p>
        </div>
      </div>

      <Card title="Cost Code Register" icon={<IconCurrencyDollar size={18} />}>
        {costCodes.length === 0 ? (
          <EmptyState
            icon={<IconCurrencyDollar size={32} />}
            title="No cost codes"
            message={
              projectId
                ? canManage
                  ? 'Add your first cost code using the form above to start tracking budget vs. actual spend.'
                  : 'Cost codes are created per project during setup or import. Ask a project manager to add them.'
                : 'Select a project to view and manage its cost codes.'
            }
          />
        ) : (
          <Table>
            <THead><TH>Code</TH><TH>Name</TH><TH>Category</TH><TH className="text-right">Budget</TH><TH className="text-right">Labor</TH><TH className="text-right">Materials</TH><TH className="text-right">Total Spend</TH><TH className="text-right">Utilization</TH></THead>
            <TBody>
              {costCodes.map((c) => {
                const laborAmt = laborByCode.get(c.id) ?? 0;
                const matAmt = materials.get(c.id) ?? 0;
                const spend = laborAmt + matAmt;
                const budget = Number(c.budget_amount);
                const util = budget > 0 ? Math.round((spend / budget) * 100) : 0;
                return (
                  <TR key={c.id} className="hover:bg-ecms-elevated/40">
                    <TD className="font-medium">{c.cost_code}</TD>
                    <TD>{c.name}</TD>
                    <TD className="capitalize text-ecms-muted">{c.category}</TD>
                    <TD className="text-right">{money(budget)}</TD>
                    <TD className="text-right">{money(laborAmt)}</TD>
                    <TD className="text-right">{money(matAmt)}</TD>
                    <TD className="text-right font-medium">{money(spend)}</TD>
                    <TD className="text-right">
                      <span className={util > 100 ? 'font-semibold text-ecms-danger' : util > 80 ? 'font-semibold text-ecms-amber' : 'text-ecms-muted'}>{num(util, 0)}%</span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
