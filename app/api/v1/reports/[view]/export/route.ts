import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withErrorHandling } from '@/lib/api-handler';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';

export const dynamic = 'force-dynamic';

type CsvValue = string | number | boolean | Date | null | undefined;

function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const raw = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function toCsv(columns: string[], rows: CsvValue[][]): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

export const GET = withErrorHandling(async (_req: Request, ctx: { params: Promise<{ view: string }> }) => {
  const { view } = await ctx.params;
  const auth = await requireApiPermission('report.read');
  if (auth instanceof NextResponse) return auth;
  const { projectId } = await getProjectContext();
  const pid = projectId ?? '';

  let columns: string[] = [];
  let rows: CsvValue[][] = [];
  let filename = `report-${view}.csv`;

  if (view === 'commercial') {
    const data = await db.$queryRaw<
      Array<{
        contract_number: string;
        currency: string;
        original_contract_amount: number;
        approved_variations: number;
        revised_contract_amount: number;
        certified_net: number;
        retention_held: number;
        paid_net: number;
        uncertified_balance: number;
      }>
    >`
      SELECT contract_number, currency, original_contract_amount, approved_variations, revised_contract_amount, certified_net, retention_held, paid_net, uncertified_balance
      FROM ecms.v_contract_commercial_position WHERE project_id = ${pid} ORDER BY contract_number ASC`;
    columns = ['Contract', 'Currency', 'Original', 'Variations', 'Revised', 'Certified Net', 'Retention', 'Paid', 'Uncertified'];
    rows = data.map((c) => [
      c.contract_number,
      c.currency,
      c.original_contract_amount,
      c.approved_variations,
      c.revised_contract_amount,
      c.certified_net,
      c.retention_held,
      c.paid_net,
      c.uncertified_balance,
    ]);
    filename = 'contract-commercial-position.csv';
  } else if (view === 'money-streams') {
    const data = await db.$queryRaw<
      Array<{ period_month: Date; employer_to_contractor_certified: number; contractor_to_supplier_paid: number; contractor_to_worker_paid: number }>
    >`
      SELECT period_month, employer_to_contractor_certified, contractor_to_supplier_paid, contractor_to_worker_paid
      FROM ecms.v_three_money_streams WHERE project_id = ${pid} ORDER BY period_month DESC LIMIT 12`;
    columns = ['Month', 'Employer to Contractor Certified', 'Contractor to Supplier Paid', 'Contractor to Worker Paid'];
    rows = data.map((m) => [m.period_month, m.employer_to_contractor_certified, m.contractor_to_supplier_paid, m.contractor_to_worker_paid]);
    filename = 'three-money-streams.csv';
  } else if (view === 'exceptions') {
    const data = await db.$queryRaw<
      Array<{ source_type: string; category: string; severity: string; status: string; title: string; age_days: number; created_at: Date }>
    >`
      SELECT source_type, category, severity, status, title, age_days, created_at
      FROM ecms.v_open_exceptions WHERE project_id = ${pid} ORDER BY created_at DESC LIMIT 500`;
    columns = ['Source', 'Category', 'Title', 'Severity', 'Status', 'Age (days)', 'Created'];
    rows = data.map((e) => [e.source_type, e.category, e.title, e.severity, e.status, e.age_days, e.created_at]);
    filename = 'open-exceptions.csv';
  } else if (view === 'labor') {
    const data = await db.$queryRaw<
      Array<{ package_code: string | null; cost_code: string | null; regular_hours: number; overtime_hours: number; approved_gross_amount: number }>
    >`
      SELECT package_code, cost_code, sum(regular_hours) AS regular_hours, sum(overtime_hours) AS overtime_hours, sum(approved_gross_amount) AS approved_gross_amount
      FROM ecms.v_labor_cost_by_package WHERE project_id = ${pid} GROUP BY package_code, cost_code ORDER BY approved_gross_amount DESC`;
    columns = ['Package', 'Cost Code', 'Regular Hrs', 'OT Hrs', 'Gross'];
    rows = data.map((l) => [l.package_code, l.cost_code, l.regular_hours, l.overtime_hours, l.approved_gross_amount]);
    filename = 'labor-cost-by-package.csv';
  } else {
    return NextResponse.json({ error: `Unknown report view: ${view}` }, { status: 404 });
  }

  const body = toCsv(columns, rows);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
