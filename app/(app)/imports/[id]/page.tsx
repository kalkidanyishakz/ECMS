import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/StatusPill';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconFileText, IconArrowLeft } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser, hasPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { dateTime } from '@/lib/format';
import { ImportWorkbench } from '@/components/imports/ImportWorkbench';

export const dynamic = 'force-dynamic';

type Json = Record<string, unknown>;

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAppUser();
  const { projectId } = await getProjectContext();

  const job = await db.import_jobs.findUnique({
    where: { id },
    include: {
      import_sheets: { orderBy: { sheet_ordinal: 'asc' } },
      import_rows: {
        orderBy: [{ import_sheet_id: 'asc' }, { source_row_number: 'asc' }],
        take: 200,
      },
      import_mappings: true,
      import_exceptions: { orderBy: { created_at: 'desc' }, take: 200 },
    },
  });

  if (!job || (projectId && job.project_id !== projectId)) notFound();

  const canManage = await hasPermission('import.manage', { projectId });
  const statistics = (job.statistics ?? {}) as Json;

  const sheets = job.import_sheets.map((sheet) => ({
    id: sheet.id,
    name: sheet.sheet_name,
    ordinal: sheet.sheet_ordinal,
    isHidden: sheet.is_hidden,
    rowCount: sheet.row_count,
    columnCount: sheet.column_count,
    headers: ((sheet.metadata as { headers?: string[] } | null)?.headers ?? []) as string[],
  }));

  const rows = job.import_rows.map((row) => ({
    id: row.id,
    sheetId: row.import_sheet_id,
    rowNumber: row.source_row_number,
    sourceData: (row.source_data ?? {}) as Json,
    normalizedData: (row.normalized_data ?? null) as Json | null,
    status: row.status,
    errorCount: row.error_count,
    targetEntity: row.target_entity,
  }));

  const existingMappings = job.import_mappings
    .map((m) => {
      const mapping = (m.mapping ?? {}) as { source_column?: string; target_field?: string };
      return { sourceColumn: mapping.source_column ?? '', targetField: mapping.target_field ?? '' };
    })
    .filter((m) => m.sourceColumn && m.targetField);

  const exceptions = job.import_exceptions.map((ex) => ({
    id: ex.id,
    message: ex.message,
    severity: ex.severity,
    fieldName: ex.field_name,
    rowId: ex.import_row_id,
  }));

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title={job.source_name}
        actions={<StatusPill status={job.status} />}
      />

      <Link href="/imports" className="inline-flex w-fit items-center gap-1.5 text-sm text-ecms-muted hover:text-ecms-amber">
        <IconArrowLeft size={16} /> Back to import centre
      </Link>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5"><p className="text-sm text-ecms-muted">Kind</p><p className="mt-1 text-lg font-semibold text-ecms-text">{job.import_kind}</p></div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5"><p className="text-sm text-ecms-muted">Sheets</p><p className="mt-1 text-lg font-semibold text-ecms-text">{String(statistics.sheets ?? sheets.length)}</p></div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5"><p className="text-sm text-ecms-muted">Rows</p><p className="mt-1 text-lg font-semibold text-ecms-text">{String(statistics.rows ?? rows.length)}</p></div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5"><p className="text-sm text-ecms-muted">Created</p><p className="mt-1 text-sm font-medium text-ecms-text">{dateTime(job.created_at)}</p></div>
      </div>

      {job.error_message && (
        <div className="rounded-xl border border-ecms-danger/30 bg-ecms-danger/10 p-4 text-sm text-ecms-danger">
          {job.error_message}
        </div>
      )}

      <Card title="Job Summary" icon={<IconFileText size={18} />}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div className="flex justify-between gap-3"><dt className="text-ecms-muted">Status</dt><dd><StatusPill status={job.status} /></dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ecms-muted">Parser</dt><dd className="font-medium">{job.parser_version ?? '—'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ecms-muted">Completed</dt><dd className="font-medium">{job.completed_at ? dateTime(job.completed_at) : '—'}</dd></div>
        </dl>
      </Card>

      <ImportWorkbench
        jobId={job.id}
        status={job.status}
        importKind={job.import_kind}
        sourceName={job.source_name}
        statistics={statistics}
        sheets={sheets}
        rows={rows}
        existingMappings={existingMappings}
        exceptions={exceptions}
        canManage={canManage}
      />
    </div>
  );
}
