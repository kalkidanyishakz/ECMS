import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { withErrorHandling, redirectIfRequested } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

function parseNumber(value: FormDataEntryValue | null): number | null {
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Add an evaluated line to a captured supplier quote.
 *
 * Description, unit and quantity default to the underlying requisition line so
 * the UI only has to capture price/spec fields. Quote totals are recomputed from
 * the full set of lines after each insert.
 */
export const POST = withErrorHandling(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });

  const auth = await requireApiPermission('procurement.order', projectId);
  if (auth instanceof NextResponse) return auth;

  const quote = await db.supplier_quotes.findUnique({
    where: { id },
    select: { id: true, project_id: true, requisition_id: true, currency: true },
  });
  if (!quote || quote.project_id !== projectId) {
    return NextResponse.json({ error: 'Supplier quote not found' }, { status: 404 });
  }

  const form = await req.formData();
  const requisition_line_id = (form.get('requisition_line_id') as string | null)?.trim() ?? '';
  const unit_price = parseNumber(form.get('unit_price'));
  const tax_percent = parseNumber(form.get('tax_percent')) ?? 0;

  if (!requisition_line_id) {
    return NextResponse.json({ error: 'requisition_line_id is required' }, { status: 400 });
  }
  if (unit_price === null || unit_price < 0) {
    return NextResponse.json({ error: 'unit_price must be a non-negative number' }, { status: 400 });
  }
  if (tax_percent < 0 || tax_percent > 100) {
    return NextResponse.json({ error: 'tax_percent must be between 0 and 100' }, { status: 400 });
  }

  const requisitionLine = await db.purchase_requisition_lines.findUnique({
    where: { id: requisition_line_id },
    select: {
      id: true,
      requisition_id: true,
      description: true,
      unit: true,
      requested_quantity: true,
    },
  });
  if (!requisitionLine || requisitionLine.requisition_id !== quote.requisition_id) {
    return NextResponse.json(
      { error: 'Requisition line does not belong to this quote requisition' },
      { status: 400 }
    );
  }

  const duplicate = await db.supplier_quote_lines.findUnique({
    where: {
      supplier_quote_id_requisition_line_id: {
        supplier_quote_id: quote.id,
        requisition_line_id,
      },
    },
    select: { id: true },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: 'This requisition line already has a quote line' },
      { status: 409 }
    );
  }

  const offered_description =
    (form.get('offered_description') as string | null)?.trim() || requisitionLine.description;
  const offered_specification =
    (form.get('offered_specification') as string | null)?.trim() || null;
  const unit = (form.get('unit') as string | null)?.trim() || requisitionLine.unit;
  const quantity = parseNumber(form.get('quantity')) ?? Number(requisitionLine.requested_quantity);
  if (quantity <= 0) {
    return NextResponse.json({ error: 'quantity must be greater than zero' }, { status: 400 });
  }

  const compliesRaw = (form.get('complies') as string | null)?.trim();
  const complies = compliesRaw === 'yes' ? true : compliesRaw === 'no' ? false : null;
  const deviation_notes = (form.get('deviation_notes') as string | null)?.trim() || null;

  const lineAmount = Math.round(quantity * unit_price * 10000) / 10000;

  await db.$transaction(async (tx) => {
    const maxLine = await tx.supplier_quote_lines.aggregate({
      where: { supplier_quote_id: quote.id },
      _max: { line_number: true },
    });

    await tx.supplier_quote_lines.create({
      data: {
        supplier_quote_id: quote.id,
        requisition_line_id,
        line_number: (maxLine._max.line_number ?? 0) + 1,
        offered_description,
        offered_specification,
        unit,
        quantity,
        unit_price,
        tax_percent,
        line_amount: lineAmount,
        complies,
        deviation_notes,
      },
    });

    const lines = await tx.supplier_quote_lines.findMany({
      where: { supplier_quote_id: quote.id },
      select: { line_amount: true, tax_percent: true },
    });
    const subtotal = lines.reduce((sum, l) => sum + Number(l.line_amount), 0);
    const tax = lines.reduce(
      (sum, l) => sum + Number(l.line_amount) * (Number(l.tax_percent) / 100),
      0
    );

    await tx.supplier_quotes.update({
      where: { id: quote.id },
      data: {
        tax_amount: Math.round(tax * 10000) / 10000,
        total_amount: Math.round((subtotal + tax) * 10000) / 10000,
      },
    });
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'UPDATE',
    entityType: 'supplier_quote_lines',
    entityId: quote.id,
    after: {
      requisition_line_id,
      unit_price,
      quantity,
      tax_percent,
      line_amount: lineAmount,
    },
  });

  redirectIfRequested(form, '/procurement/quotes');

  return NextResponse.json({ ok: true, supplier_quote_id: quote.id }, { status: 201 });
});
