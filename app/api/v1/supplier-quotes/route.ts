import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { withErrorHandling, redirectIfRequested } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

function parseAmount(value: FormDataEntryValue | null): number | null {
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export const GET = withErrorHandling(async function GET(req: NextRequest) {
  const { tenantId, projectId } = await getProjectContext();

  const requisitionId = new URL(req.url).searchParams.get('requisition_id');

  const quotes = await db.supplier_quotes.findMany({
    where: {
      ...(projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } }),
      ...(requisitionId ? { requisition_id: requisitionId } : {}),
    },
    orderBy: { created_at: 'desc' },
    include: {
      suppliers: { select: { supplier_code: true } },
      supplier_quote_lines: { orderBy: { line_number: 'asc' } },
    },
  });

  return NextResponse.json({ quotes });
});

export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });

  const auth = await requireApiPermission('procurement.order', projectId);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const requisition_id = (form.get('requisition_id') as string | null)?.trim() ?? '';
  const supplier_id = (form.get('supplier_id') as string | null)?.trim() ?? '';
  const quote_number = (form.get('quote_number') as string | null)?.trim() ?? '';
  const quote_date = (form.get('quote_date') as string | null)?.trim() ?? '';
  const valid_until = (form.get('valid_until') as string | null)?.trim() || null;
  const currency = ((form.get('currency') as string | null)?.trim() || 'ETB').toUpperCase().slice(0, 3);
  const deliveryDaysRaw = (form.get('delivery_days') as string | null)?.trim() || '';
  const payment_terms = (form.get('payment_terms') as string | null)?.trim() || null;
  const tax_amount = parseAmount(form.get('tax_amount')) ?? 0;
  const total_amount = parseAmount(form.get('total_amount')) ?? 0;

  if (!requisition_id || !supplier_id || !quote_number || !quote_date) {
    return NextResponse.json(
      { error: 'requisition_id, supplier_id, quote_number and quote_date are required' },
      { status: 400 }
    );
  }

  const parsedQuoteDate = new Date(quote_date);
  if (Number.isNaN(parsedQuoteDate.getTime())) {
    return NextResponse.json({ error: 'quote_date is invalid' }, { status: 400 });
  }
  const parsedValidUntil = valid_until ? new Date(valid_until) : null;
  if (parsedValidUntil && parsedValidUntil < parsedQuoteDate) {
    return NextResponse.json({ error: 'valid_until must be on or after quote_date' }, { status: 400 });
  }

  const delivery_days = deliveryDaysRaw ? Number(deliveryDaysRaw) : null;
  if (delivery_days !== null && (!Number.isFinite(delivery_days) || delivery_days < 0)) {
    return NextResponse.json({ error: 'delivery_days must be a non-negative integer' }, { status: 400 });
  }
  if (tax_amount < 0 || total_amount < 0) {
    return NextResponse.json({ error: 'tax_amount and total_amount must be non-negative' }, { status: 400 });
  }

  const [requisition, supplier, duplicate] = await Promise.all([
    db.purchase_requisitions.findUnique({
      where: { id: requisition_id },
      select: { id: true, project_id: true },
    }),
    db.suppliers.findUnique({
      where: { id: supplier_id },
      select: { id: true, tenant_id: true },
    }),
    db.supplier_quotes.findUnique({
      where: {
        project_id_supplier_id_quote_number: { project_id: projectId, supplier_id, quote_number },
      },
      select: { id: true },
    }),
  ]);

  if (!requisition || requisition.project_id !== projectId) {
    return NextResponse.json({ error: 'Requisition not found for this project' }, { status: 404 });
  }
  if (!supplier || supplier.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
  }
  if (duplicate) {
    return NextResponse.json(
      { error: 'A quote with this number already exists for this supplier' },
      { status: 409 }
    );
  }

  const quote = await db.supplier_quotes.create({
    data: {
      project_id: projectId,
      requisition_id,
      supplier_id,
      quote_number,
      quote_date: parsedQuoteDate,
      valid_until: parsedValidUntil,
      currency,
      delivery_days: delivery_days === null ? null : Math.trunc(delivery_days),
      payment_terms,
      tax_amount,
      total_amount,
      status: 'received',
      captured_by: userId,
    },
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'CREATE',
    entityType: 'supplier_quotes',
    entityId: quote.id,
    after: {
      requisition_id,
      supplier_id,
      quote_number,
      quote_date,
      currency,
      tax_amount,
      total_amount,
    },
  });

  redirectIfRequested(form, '/procurement/quotes');

  return NextResponse.json({ ok: true, supplier_quote_id: quote.id }, { status: 201 });
});
