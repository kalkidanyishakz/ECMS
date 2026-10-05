import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getProjectContext } from '@/lib/server/context';
import { withErrorHandling } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

type SearchResult = {
  type: string;
  label: string;
  sublabel: string | null;
  href: string;
};

const LIMIT = 5;

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

export const GET = withErrorHandling(async function GET(req: NextRequest) {
  const { tenantId, projectId } = await getProjectContext();

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();

  if (!q) return NextResponse.json({ results: [] as SearchResult[] });

  const [projects, contracts, boqItems, measurements, ipcs, suppliers, requisitions] =
    await Promise.all([
      db.projects.findMany({
        where: {
          tenant_id: tenantId,
          OR: [{ name: contains(q) }, { project_code: contains(q) }],
        },
        take: LIMIT,
        orderBy: { created_at: 'desc' },
      }),
      projectId
        ? db.contracts.findMany({
            where: {
              project_id: projectId,
              OR: [{ contract_number: contains(q) }, { title: contains(q) }],
            },
            take: LIMIT,
            orderBy: { updated_at: 'desc' },
          })
        : Promise.resolve([]),
      projectId
        ? db.boq_items.findMany({
            where: {
              boq_versions: { contracts: { project_id: projectId } },
              OR: [{ item_number: contains(q) }, { description: contains(q) }],
            },
            take: LIMIT,
            include: { boq_versions: { select: { contract_id: true } } },
          })
        : Promise.resolve([]),
      projectId
        ? db.measurements.findMany({
            where: { project_id: projectId, measurement_number: contains(q) },
            take: LIMIT,
            orderBy: { measurement_date: 'desc' },
          })
        : Promise.resolve([]),
      projectId && /^\d+$/.test(q)
        ? db.ipc_certificates.findMany({
            where: { project_id: projectId, ipc_number: Number(q) },
            take: LIMIT,
            orderBy: { ipc_number: 'desc' },
          })
        : Promise.resolve([]),
      db.suppliers.findMany({
        where: {
          tenant_id: tenantId,
          OR: [
            { supplier_code: contains(q) },
            { organizations: { legal_name: contains(q) } },
            { organizations: { short_name: contains(q) } },
          ],
        },
        take: LIMIT,
        include: { organizations: { select: { legal_name: true } } },
        orderBy: { updated_at: 'desc' },
      }),
      projectId
        ? db.purchase_requisitions.findMany({
            where: { project_id: projectId, requisition_number: contains(q) },
            take: LIMIT,
            orderBy: { created_at: 'desc' },
          })
        : Promise.resolve([]),
    ]);

  const results: SearchResult[] = [
    ...projects.map((p) => ({
      type: 'Project',
      label: p.name,
      sublabel: p.project_code,
      href: '/projects',
    })),
    ...contracts.map((c) => ({
      type: 'Contract',
      label: c.contract_number,
      sublabel: c.title,
      href: '/contracts',
    })),
    ...boqItems.map((b) => ({
      type: 'BOQ Item',
      label: b.item_number,
      sublabel: b.description,
      href: `/cost-and-boq/boq/${b.boq_versions.contract_id}`,
    })),
    ...measurements.map((m) => ({
      type: 'Measurement',
      label: m.measurement_number,
      sublabel: m.measurement_date.toISOString().slice(0, 10),
      href: `/field/measurement/${m.id}`,
    })),
    ...ipcs.map((i) => ({
      type: 'IPC',
      label: `IPC #${i.ipc_number}`,
      sublabel: i.certificate_reference ?? i.status,
      href: `/ipcs/${i.id}`,
    })),
    ...suppliers.map((s) => ({
      type: 'Supplier',
      label: s.supplier_code,
      sublabel: s.organizations.legal_name,
      href: '/procurement',
    })),
    ...requisitions.map((r) => ({
      type: 'Requisition',
      label: r.requisition_number,
      sublabel: r.purpose,
      href: '/procurement/requisitions',
    })),
  ];

  return NextResponse.json({ results });
});
