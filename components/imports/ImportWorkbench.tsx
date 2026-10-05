'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { IconColumns, IconCircleCheck, IconUpload, IconAlertTriangle } from '@tabler/icons-react';

const inputCls = 'rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text';
const labelCls = 'text-xs font-medium text-ecms-muted';

export type ImportSheetProp = {
  id: string;
  name: string;
  ordinal: number;
  isHidden: boolean;
  rowCount: number | null;
  columnCount: number | null;
  headers: string[];
};

export type ImportRowProp = {
  id: string;
  sheetId: string | null;
  rowNumber: number;
  sourceData: Record<string, unknown>;
  normalizedData: Record<string, unknown> | null;
  status: string;
  errorCount: number;
  targetEntity: string | null;
};

export type ImportExceptionProp = {
  id: string;
  message: string;
  severity: string;
  fieldName: string | null;
  rowId: string | null;
};

type FieldDef = { field: string; label: string };

const KIND_FIELDS: Record<string, FieldDef[]> = {
  boq: [
    { field: 'item_number', label: 'Item Number' },
    { field: 'description', label: 'Description' },
    { field: 'unit', label: 'Unit' },
    { field: 'quantity', label: 'Quantity' },
    { field: 'unit_rate', label: 'Unit Rate' },
    { field: 'section_code', label: 'Section Code' },
    { field: 'section_title', label: 'Section Title' },
    { field: 'source_code', label: 'Source Code' },
  ],
  ipc: [
    { field: 'measurement_number', label: 'Measurement Number' },
    { field: 'measurement_date', label: 'Measurement Date' },
    { field: 'contract_id', label: 'Contract ID' },
    { field: 'item_number', label: 'Item Number' },
    { field: 'quantity', label: 'Quantity' },
  ],
  contract: [
    { field: 'contract_number', label: 'Contract Number' },
    { field: 'title', label: 'Title' },
    { field: 'contract_value', label: 'Contract Value' },
    { field: 'start_date', label: 'Start Date' },
    { field: 'end_date', label: 'End Date' },
  ],
  drawings: [
    { field: 'drawing_number', label: 'Drawing Number' },
    { field: 'title', label: 'Title' },
    { field: 'revision', label: 'Revision' },
  ],
  organizations: [
    { field: 'name', label: 'Name' },
    { field: 'org_type', label: 'Organization Type' },
  ],
  other: [{ field: 'value', label: 'Value' }],
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function autoMatch(field: string, headers: string[]): string {
  const target = normalizeKey(field);
  const normalized = headers.map((h) => ({ header: h, key: normalizeKey(h) }));
  const exact = normalized.find((h) => h.key === target);
  if (exact) return exact.header;
  const contains = normalized.find((h) => h.key.includes(target) || target.includes(h.key));
  return contains?.header ?? '';
}

type Props = {
  jobId: string;
  status: string;
  importKind: string;
  sourceName: string;
  statistics: Record<string, unknown>;
  sheets: ImportSheetProp[];
  rows: ImportRowProp[];
  existingMappings: Array<{ sourceColumn: string; targetField: string }>;
  exceptions: ImportExceptionProp[];
  canManage: boolean;
};

export function ImportWorkbench({
  jobId,
  status,
  importKind,
  sheets,
  rows,
  existingMappings,
  exceptions,
  canManage,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const fields = KIND_FIELDS[importKind] ?? KIND_FIELDS.other;

  const headers = useMemo(() => {
    const set = new Set<string>();
    for (const sheet of sheets) for (const h of sheet.headers) set.add(h);
    return [...set];
  }, [sheets]);

  const [activeSheetId, setActiveSheetId] = useState<string>(sheets[0]?.id ?? '');

  const [mapping, setMapping] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of KIND_FIELDS[importKind] ?? KIND_FIELDS.other) {
      const existing = existingMappings.find((m) => m.targetField === f.field);
      init[f.field] = existing?.sourceColumn ?? autoMatch(f.field, [...new Set(sheets.flatMap((s) => s.headers))]);
    }
    return init;
  });

  const activeSheet = sheets.find((s) => s.id === activeSheetId) ?? sheets[0];
  const visibleRows = useMemo(
    () => (activeSheet ? rows.filter((r) => r.sheetId === activeSheet.id) : rows),
    [rows, activeSheet]
  );
  const visibleHeaders = activeSheet ? activeSheet.headers : headers;

  async function call(url: string, body: object, method = 'POST', label: string) {
    setBusy(label);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      toast(`${label} succeeded`, 'success');
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Request failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  function saveMapping() {
    const mappings = fields
      .filter((f) => mapping[f.field])
      .map((f) => ({ source_column: mapping[f.field], target_field: f.field }));
    if (mappings.length === 0) {
      toast('Select at least one column to map', 'error');
      return;
    }
    void call(`/api/v1/imports/${jobId}/mapping`, { mappings }, 'PUT', 'Save mapping');
  }

  const canMap = canManage && ['uploaded', 'mapping'].includes(status);
  const canValidate = canManage && ['uploaded', 'mapping'].includes(status);
  const canCommit = canManage && status === 'ready';

  return (
    <div className="flex flex-col gap-5">
      <Card title="Column Mapping" icon={<IconColumns size={18} />}>
        {headers.length === 0 ? (
          <EmptyState title="No columns detected" message="The uploaded file did not contain a readable header row." />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f) => (
                <label key={f.field} className="flex flex-col gap-1">
                  <span className={labelCls}>{f.label}</span>
                  <select
                    className={inputCls}
                    value={mapping[f.field] ?? ''}
                    disabled={!canMap}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [f.field]: e.target.value }))}
                  >
                    <option value="">— Not mapped —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={saveMapping}
                disabled={!canMap || busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ecms-elevated px-3 py-1.5 text-sm font-semibold text-ecms-text hover:bg-ecms-elevated/70 disabled:opacity-50"
              >
                {busy === 'Save mapping' ? 'Saving…' : 'Save Mapping'}
              </button>
              <button
                type="button"
                onClick={() => void call(`/api/v1/imports/${jobId}/validate`, {}, 'POST', 'Validate')}
                disabled={!canValidate || busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ecms-info/20 px-3 py-1.5 text-sm font-semibold text-ecms-info hover:bg-ecms-info/30 disabled:opacity-50"
              >
                <IconCircleCheck size={16} /> Validate Rows
              </button>
              <button
                type="button"
                onClick={() => void call(`/api/v1/imports/${jobId}/commit`, {}, 'POST', 'Commit')}
                disabled={!canCommit || busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90 disabled:opacity-50"
              >
                <IconUpload size={16} /> Commit Import
              </button>
              <span className="ml-auto text-xs text-ecms-muted">Status: <StatusPill status={status} /></span>
            </div>
          </div>
        )}
      </Card>

      <Card title="Parsed Sheets" icon={<IconColumns size={18} />}>
        {sheets.length === 0 ? (
          <EmptyState title="No sheets" message="Nothing was parsed from this upload." />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {sheets.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveSheetId(s.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${s.id === activeSheet?.id ? 'bg-ecms-amber text-ecms-navy' : 'bg-ecms-elevated text-ecms-muted hover:text-ecms-text'}`}
                >
                  {s.name} <span className="opacity-70">({s.rowCount ?? 0})</span>
                  {s.isHidden ? ' · hidden' : ''}
                </button>
              ))}
            </div>
            {visibleRows.length === 0 ? (
              <EmptyState title="No rows" message="This sheet has no data rows." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TH>#</TH>
                    <TH>Status</TH>
                    {visibleHeaders.map((h) => <TH key={h}>{h}</TH>)}
                    <TH>Target</TH>
                  </THead>
                  <TBody>
                    {visibleRows.map((r) => (
                      <TR key={r.id} className="hover:bg-ecms-elevated/40">
                        <TD className="text-ecms-muted">{r.rowNumber}</TD>
                        <TD><StatusPill status={r.status} /></TD>
                        {visibleHeaders.map((h) => {
                          const value = r.normalizedData?.[h] ?? r.sourceData[h];
                          return (
                            <TD key={h} className="max-w-[220px] truncate">
                              {value === null || value === undefined || value === '' ? '—' : String(value)}
                            </TD>
                          );
                        })}
                        <TD className="text-ecms-muted">{r.targetEntity ?? '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Exceptions" icon={<IconAlertTriangle size={18} />}>
        {exceptions.length === 0 ? (
          <EmptyState title="No exceptions" message="Run validation to surface mapping or data issues." />
        ) : (
          <Table>
            <THead><TH>Severity</TH><TH>Field</TH><TH>Message</TH></THead>
            <TBody>
              {exceptions.map((ex) => (
                <TR key={ex.id}>
                  <TD><StatusPill status={ex.severity} /></TD>
                  <TD className="text-ecms-muted">{ex.fieldName ?? '—'}</TD>
                  <TD>{ex.message}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
