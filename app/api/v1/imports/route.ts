import { NextRequest, NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { writeAudit } from '@/lib/audit';
import { withErrorHandling } from '@/lib/api-handler';
import { extractUpload, readStoredFile, saveUploadedFile } from '@/lib/storage';
import { parseImportBuffer, rowHash } from '@/lib/import-parser';

export const dynamic = 'force-dynamic';

const ALLOWED_IMPORT_KINDS = ['boq', 'ipc', 'contract', 'drawings', 'organizations', 'other'] as const;

const ROWS_PER_INSERT = 500;

export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const { tenantId, projectId, userId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });
  const auth = await requireApiPermission('import.manage', projectId);
  if (auth instanceof NextResponse) return auth;

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data') && !contentType.includes('application/x-www-form-urlencoded')) {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 415 });
  }

  const form = await req.formData();
  const import_type = (form.get('import_type') as string | null)?.trim() ?? '';
  const providedName = (form.get('file_name') as string | null)?.trim() ?? '';
  let source_file_id = (form.get('source_file_id') as string | null)?.trim() ?? '';
  const boq_version_id = (form.get('boq_version_id') as string | null)?.trim() ?? '';

  if (!import_type || !ALLOWED_IMPORT_KINDS.includes(import_type as (typeof ALLOWED_IMPORT_KINDS)[number])) {
    return NextResponse.json(
      { error: `import_type must be one of: ${ALLOWED_IMPORT_KINDS.join(', ')}` },
      { status: 400 }
    );
  }

  if (!source_file_id) {
    const upload = extractUpload(form);
    if (!upload) {
      return NextResponse.json({ error: 'A file upload (field "file") or source_file_id is required' }, { status: 400 });
    }
    const stored = await saveUploadedFile(upload, { tenantId, userId });
    source_file_id = stored.id;
  }

  const file = await db.stored_files.findUnique({ where: { id: source_file_id } });
  if (!file) return NextResponse.json({ error: 'Invalid source file' }, { status: 400 });

  const source_name = providedName || file.original_name;

  const importJob = await db.import_jobs.create({
    data: {
      project_id: projectId,
      source_file_id,
      import_kind: import_type,
      status: 'inspecting',
      source_name,
      created_by: userId,
      control_totals: boq_version_id ? { boq_version_id } : {},
    },
  });

  let sheetCount = 0;
  let rowCount = 0;
  let parserVersion: string | null = null;

  try {
    const buffer = await readStoredFile(file);
    const workbook = parseImportBuffer(buffer, file.original_name);
    sheetCount = workbook.sheets.length;
    parserVersion = workbook.parserVersion;

    await db.$transaction(async (tx) => {
      for (const sheet of workbook.sheets) {
        const sheetRow = await tx.import_sheets.create({
          data: {
            import_job_id: importJob.id,
            sheet_name: sheet.name,
            sheet_ordinal: sheet.ordinal,
            is_hidden: sheet.isHidden,
            row_count: sheet.rows.length,
            column_count: sheet.headers.length,
            metadata: { headers: sheet.headers, ...sheet.metadata },
          },
        });

        for (let i = 0; i < sheet.rows.length; i += ROWS_PER_INSERT) {
          const chunk = sheet.rows.slice(i, i + ROWS_PER_INSERT);
          await tx.import_rows.createMany({
            data: chunk.map((row) => ({
              import_job_id: importJob.id,
              import_sheet_id: sheetRow.id,
              source_row_number: row.rowNumber,
              source_data: row.data,
              row_hash: rowHash(row.data),
              status: 'staged' as const,
            })),
          });
        }
        rowCount += sheet.rows.length;
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    await db.import_jobs.update({
      where: { id: importJob.id },
      data: { status: 'failed', error_message: message },
    });
    return NextResponse.json({ error: 'Failed to parse uploaded file', detail: message }, { status: 422 });
  }

  const status = rowCount > 0 ? 'uploaded' : 'failed';
  const updatedJob = await db.import_jobs.update({
    where: { id: importJob.id },
    data: {
      status,
      parser_version: parserVersion,
      statistics: { sheets: sheetCount, rows: rowCount },
      error_message: rowCount > 0 ? null : 'No data rows found in the uploaded file',
    },
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'CREATE',
    entityType: 'import_jobs',
    entityId: importJob.id,
    after: {
      import_kind: import_type,
      source_name,
      status,
      sheets: sheetCount,
      rows: rowCount,
    },
  });

  const redirectTo = (form.get('redirect_to') as string | null)?.trim();
  if (redirectTo) {
    redirect(redirectTo === '/imports' ? `/imports/${importJob.id}` : redirectTo);
  }

  const safeJob = JSON.parse(
    JSON.stringify(updatedJob, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
  );
  return NextResponse.json(safeJob, { status: 201 });
});
