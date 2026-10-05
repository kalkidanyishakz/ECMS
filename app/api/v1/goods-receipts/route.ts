import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { withErrorHandling, redirectIfRequested } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });

  const auth = await requireApiPermission('goods.receive', projectId);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const purchaseOrderId = (form.get('purchase_order_id') as string | null)?.trim();
  const warehouseId = (form.get('warehouse_id') as string | null)?.trim();
  const receiptDate = (form.get('receipt_date') as string | null)?.trim();
  const deliveryNote = (form.get('delivery_note_number') as string | null)?.trim() || null;

  if (!purchaseOrderId) return NextResponse.json({ error: 'purchase_order_id is required' }, { status: 400 });
  if (!warehouseId) return NextResponse.json({ error: 'warehouse_id is required' }, { status: 400 });
  if (!receiptDate) return NextResponse.json({ error: 'receipt_date is required' }, { status: 400 });

  const po = await db.purchase_orders.findUnique({
    where: { id: purchaseOrderId },
    include: { purchase_order_lines: { orderBy: { line_number: 'asc' } } },
  });
  if (!po) return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
  if (po.project_id !== projectId) {
    return NextResponse.json({ error: 'Purchase order does not belong to this project' }, { status: 403 });
  }
  if (po.purchase_order_lines.length === 0) {
    return NextResponse.json({ error: 'Purchase order has no lines' }, { status: 409 });
  }

  const warehouse = await db.warehouses.findUnique({ where: { id: warehouseId } });
  if (!warehouse) return NextResponse.json({ error: 'Invalid warehouse' }, { status: 400 });

  const existingCount = await db.goods_receipts.count({ where: { project_id: projectId } });
  const receiptNumber = `GRN-${String(existingCount + 1).padStart(5, '0')}`;

  const inventoryCount = await db.inventory_items.count({ where: { project_id: projectId } });

  const receipt = await db.$transaction(async (tx) => {
    const created = await tx.goods_receipts.create({
      data: {
        project_id: projectId,
        purchase_order_id: purchaseOrderId,
        warehouse_id: warehouseId,
        receipt_number: receiptNumber,
        receipt_date: new Date(receiptDate),
        delivery_note_number: deliveryNote,
        status: 'draft',
        received_by: userId,
      },
    });

    let inventorySeq = inventoryCount;
    let lineNumber = 0;

    for (const poLine of po.purchase_order_lines) {
      lineNumber += 1;

      let item = await tx.inventory_items.findFirst({
        where: { project_id: projectId, description: poLine.description },
      });
      if (!item) {
        inventorySeq += 1;
        item = await tx.inventory_items.create({
          data: {
            project_id: projectId,
            item_code: `INV-${String(inventorySeq).padStart(4, '0')}`,
            description: poLine.description,
            specification: poLine.specification,
            unit: poLine.unit ?? 'unit',
          },
        });
      }

      const priorReceived = await tx.goods_receipt_lines.aggregate({
        where: { purchase_order_line_id: poLine.id },
        _sum: { accepted_quantity: true },
      });

      const receivedQty = Number(poLine.ordered_quantity);

      await tx.goods_receipt_lines.create({
        data: {
          goods_receipt_id: created.id,
          purchase_order_line_id: poLine.id,
          inventory_item_id: item.id,
          line_number: lineNumber,
          ordered_quantity_snapshot: poLine.ordered_quantity,
          previously_received_quantity: priorReceived._sum.accepted_quantity ?? 0,
          received_quantity: receivedQty,
          accepted_quantity: receivedQty,
          rejected_quantity: 0,
          specification_result: 'pending',
        },
      });
    }

    return created;
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'CREATE',
    entityType: 'goods_receipts',
    entityId: receipt.id,
    after: {
      receipt_number: receiptNumber,
      purchase_order_id: purchaseOrderId,
      warehouse_id: warehouseId,
      line_count: po.purchase_order_lines.length,
    },
  });

  redirectIfRequested(form);

  return NextResponse.json({ ok: true, goods_receipt_id: receipt.id, receipt_number: receiptNumber }, { status: 201 });
});
