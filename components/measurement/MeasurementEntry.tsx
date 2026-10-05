'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { IconRuler, IconPlus } from '@tabler/icons-react';

const inputCls = 'rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text';
const labelCls = 'text-xs font-medium text-ecms-muted';

export type BoqOption = {
  id: string;
  itemNumber: string;
  description: string;
  unit: string;
  rate: number;
};

export type MeasurementLineOption = {
  id: string;
  lineNumber: number;
  itemNumber: string;
  description: string;
  unit: string;
};

type Props = {
  measurementId: string;
  status: string;
  canCreate: boolean;
  boqItems: BoqOption[];
  lines: MeasurementLineOption[];
};

export function MeasurementEntry({ measurementId, status, canCreate, boqItems, lines }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [boqId, setBoqId] = useState(boqItems[0]?.id ?? '');
  const [unit, setUnit] = useState(boqItems[0]?.unit ?? '');

  if (!canCreate || status !== 'draft') return null;

  async function send(url: string, body: FormData | object) {
    const isForm = body instanceof FormData;
    const res = await fetch(url, isForm
      ? { method: 'POST', body }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
    return data;
  }

  async function handleForm(e: React.FormEvent<HTMLFormElement>, url: string, message: string) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    try {
      await send(url, new FormData(form));
      toast(message, 'success');
      form.reset();
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Request failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Card title="Add Measurement Line" icon={<IconRuler size={18} />}>
        {boqItems.length === 0 ? (
          <EmptyState title="No BOQ items" message="This contract has no approved BOQ items to measure against." />
        ) : (
          <form onSubmit={(e) => handleForm(e, `/api/v1/measurements/${measurementId}/lines`, 'Measurement line added')} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={labelCls}>BOQ item</span>
              <select
                name="boq_item_id"
                required
                className={inputCls}
                value={boqId}
                onChange={(e) => {
                  const id = e.target.value;
                  setBoqId(id);
                  setUnit(boqItems.find((b) => b.id === id)?.unit ?? '');
                }}
              >
                {boqItems.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.itemNumber} — {b.description.slice(0, 60)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Unit</span>
              <input name="unit" required value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Submitted quantity</span>
              <input name="submitted_quantity" type="number" step="0.001" required className={inputCls} placeholder="0" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Length (optional)</span>
              <input name="length" type="number" step="0.001" className={inputCls} placeholder="m" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Width (optional)</span>
              <input name="width" type="number" step="0.001" className={inputCls} placeholder="m" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Height (optional)</span>
              <input name="height" type="number" step="0.001" className={inputCls} placeholder="m" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Remarks (optional)</span>
              <input name="remarks" className={inputCls} placeholder="Notes" />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" disabled={busy} className="rounded-lg bg-ecms-elevated px-4 py-2 text-sm font-semibold text-ecms-text hover:bg-ecms-elevated/70 disabled:opacity-50">
                Add Line
              </button>
            </div>
          </form>
        )}
      </Card>

      <Card title="Add Chainage Segment" icon={<IconPlus size={18} />}>
        {lines.length === 0 ? (
          <EmptyState title="No lines yet" message="Add a measurement line before recording chainage segments." />
        ) : (
          <form onSubmit={(e) => handleForm(e, `/api/v1/measurements/${measurementId}/segments`, 'Segment added')} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={labelCls}>Line</span>
              <select name="measurement_line_id" required className={inputCls}>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    #{l.lineNumber} {l.itemNumber} — {l.description.slice(0, 50)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Start chainage (mm)</span>
              <input name="start_chainage_mm" type="number" step="1" className={inputCls} placeholder="e.g. 12000000" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>End chainage (mm)</span>
              <input name="end_chainage_mm" type="number" step="1" className={inputCls} placeholder="e.g. 12050000" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Offset (m)</span>
              <input name="offset_m" type="number" step="0.001" className={inputCls} placeholder="Optional" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Quantity</span>
              <input name="segment_value" type="number" step="0.001" className={inputCls} placeholder="Optional" />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={labelCls}>Notes</span>
              <input name="notes" className={inputCls} placeholder="Optional" />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" disabled={busy} className="rounded-lg bg-ecms-elevated px-4 py-2 text-sm font-semibold text-ecms-text hover:bg-ecms-elevated/70 disabled:opacity-50">
                Add Segment
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
