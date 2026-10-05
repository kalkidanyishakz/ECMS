import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { withErrorHandling } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

export const POST = withErrorHandling(async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });
  const auth = await requireApiPermission('import.manage', projectId);
  if (auth instanceof NextResponse) return auth;

  const importJob = await db.import_jobs.findUnique({ where: { id } });
  if (!importJob) return NextResponse.json({ error: 'Import job not found' }, { status: 404 });

  if (importJob.status !== 'ready') {
    return NextResponse.json({ error: `Cannot commit import in status ${importJob.status}` }, { status: 409 });
  }

  const rows = await db.import_rows.findMany({
    where: { import_job_id: id, status: 'valid' },
    orderBy: { source_row_number: 'asc' },
  });

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No valid rows to commit' }, { status: 400 });
  }

  const controlTotals = (importJob.control_totals ?? {}) as Record<string, unknown>;
  const defaultBoqVersionId = toText(controlTotals.boq_version_id);
  if (importJob.import_kind === 'boq' && !defaultBoqVersionId) {
    return NextResponse.json(
      { error: 'boq_version_id is required for BOQ imports. Create the import with a target BOQ version.' },
      { status: 400 }
    );
  }

  let committedCount = 0;
  let skippedCount = 0;

  await db.$transaction(async (tx) => {
    await tx.import_jobs.update({
      where: { id },
      data: { status: 'committing', started_at: new Date() },
    });

    for (const row of rows) {
      const data = (row.normalized_data ?? row.source_data) as Record<string, unknown>;

      await tx.$executeRawUnsafe('SAVEPOINT import_row');
      try {
        if (importJob.import_kind === 'boq') {
          const boqVersionId = toText(data.boq_version_id) || defaultBoqVersionId;

          let sectionId: string | null = null;
          const rawSection = toText(data.section_id);
          if (rawSection && UUID_RE.test(rawSection)) {
            sectionId = rawSection;
          } else {
            const sectionCode = toText(data.section_code) || rawSection;
            if (sectionCode) {
              const existing = await tx.boq_sections.findFirst({
                where: { boq_version_id: boqVersionId, section_code: sectionCode },
                select: { id: true },
              });
              if (existing) {
                sectionId = existing.id;
              } else {
                const created = await tx.boq_sections.create({
                  data: {
                    boq_version_id: boqVersionId,
                    section_code: sectionCode,
                    title: toText(data.section_title) || sectionCode,
                  },
                  select: { id: true },
                });
                sectionId = created.id;
              }
            }
          }

          const qty = toNumber(data.quantity ?? data.original_quantity);
          const rate = toNumber(data.unit_rate ?? data.rate);
          const unit = toText(data.unit) || null;

          const boqItem = await tx.boq_items.create({
            data: {
              boq_version_id: boqVersionId,
              item_number: toText(data.item_number) || `IMP-${row.source_row_number}`,
              source_code: toText(data.source_code) || null,
              description: toText(data.description) || 'Imported item',
              unit,
              original_quantity: qty,
              approved_quantity: qty,
              rate,
              quantity_trackable: Boolean(unit),
              approved_amount: qty * rate,
              section_id: sectionId,
            },
          });

          await tx.import_rows.update({
            where: { id: row.id },
            data: {
              status: 'committed',
              target_entity: 'boq_items',
              target_id: boqItem.id,
              committed_at: new Date(),
            },
          });
          committedCount++;
        } else if (importJob.import_kind === 'measurements') {
          const contract_id = (data.contract_id as string) || '';
          if (!contract_id) {
            await tx.import_rows.update({
              where: { id: row.id },
              data: { status: 'error', error_count: (row.error_count || 0) + 1 },
            });
            await tx.import_exceptions.create({
              data: {
                import_job_id: id,
                import_row_id: row.id,
                severity: 'high',
                exception_code: 'MISSING_FIELD',
                message: 'contract_id is required for measurement imports',
              },
            });
            skippedCount++;
            continue;
          }

          const measurement = await tx.measurements.create({
            data: {
              project_id: projectId!,
              contract_id,
              measurement_number: (data.measurement_number as string) || `IMP-${row.source_row_number}`,
              measurement_date: new Date((data.measurement_date as string) || new Date()),
              status: 'draft',
              created_by: userId,
            },
          });

          await tx.import_rows.update({
            where: { id: row.id },
            data: {
              status: 'committed',
              target_entity: 'measurements',
              target_id: measurement.id,
              committed_at: new Date(),
            },
          });
          committedCount++;
        } else if (importJob.import_kind === 'workers') {
          await tx.import_rows.update({
            where: { id: row.id },
            data: {
              status: 'skipped',
            },
          });
          skippedCount++;
        } else {
          await tx.import_rows.update({
            where: { id: row.id },
            data: { status: 'skipped' },
          });
          skippedCount++;
        }
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT import_row');
      } catch {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT import_row');
        await tx.import_rows.update({
          where: { id: row.id },
          data: { status: 'error', error_count: (row.error_count || 0) + 1 },
        });

        await tx.import_exceptions.create({
          data: {
            import_job_id: id,
            import_row_id: row.id,
            severity: 'critical',
            exception_code: 'COMMIT_FAILED',
            message: 'Failed to commit row',
          },
        });
        skippedCount++;
      }
    }

    const finalStatus = skippedCount > 0 ? 'completed_with_exceptions' : 'completed';
    await tx.import_jobs.update({
      where: { id },
      data: {
        status: finalStatus,
        completed_at: new Date(),
        statistics: { committed: committedCount, skipped: skippedCount, total: rows.length },
      },
    });
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'UPDATE',
    entityType: 'import_jobs',
    entityId: importJob.id,
    before: { status: importJob.status },
    after: { status: 'completed', committed: committedCount, skipped: skippedCount },
  });

  return NextResponse.json({
    status: skippedCount > 0 ? 'completed_with_exceptions' : 'completed',
    committed: committedCount,
    skipped: skippedCount,
  });
});
