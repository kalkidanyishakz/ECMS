'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { IconCalculator, IconPlus, IconCash, IconTruckDelivery } from '@tabler/icons-react';
import { num } from '@/lib/format';

const inputCls = 'rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text';
const labelCls = 'text-xs font-medium text-ecms-muted';

export type IpcCandidateLine = {
  id: string;
  itemNumber: string;
  description: string;
  unit: string;
  acceptedQuantity: number;
  measurementNumber: string;
  measurementDate: string;
};

type Props = {
  ipcId: string;
  currency: string;
  status: string;
  netCurrent: number;
  canPrepare: boolean;
  canPay: boolean;
  candidates: IpcCandidateLine[];
};

export function IpcAssembly({
  ipcId,
  currency,
  status,
  netCurrent,
  canPrepare,
  canPay,
  candidates,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const isDraft = status === 'draft';
  const canRecordPayment = (status === 'certified' || status === 'paid') && canPay;

  const selectedAmount = useMemo(
    () => candidates.filter((c) => selected.has(c.id)).reduce((s, c) => s + c.acceptedQuantity, 0),
    [candidates, selected]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === candidates.length ? new Set() : new Set(candidates.map((c) => c.id))
    );
  }

  async function send(url: string, body: FormData | object) {
    const isForm = body instanceof FormData;
    const res = await fetch(url, isForm
      ? { method: 'POST', body }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
    return data as Record<string, unknown>;
  }

  async function run<T>(fn: () => Promise<T>, successMessage: string) {
    setBusy(true);
    try {
      await fn();
      toast(successMessage, 'success');
      router.refresh();
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Request failed', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleCalculate() {
    if (selected.size === 0) {
      toast('Select at least one verified measurement line', 'error');
      return;
    }
    await run(async () => {
      const data = await send(`/api/v1/ipcs/${ipcId}/calculate`, {
        measurement_line_ids: [...selected],
      });
      if (data.overrun_warning) toast(String(data.overrun_warning), 'info');
      setSelected(new Set());
    }, 'Certificate recalculated from selected measurements');
  }

  async function handleFormSubmit(
    e: React.FormEvent<HTMLFormElement>,
    url: string,
    successMessage: string
  ) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const ok = await run(() => send(url, fd), successMessage);
    if (ok) form.reset();
  }

  return (
    <div className="flex flex-col gap-5">
      {isDraft && canPrepare && (
        <Card
          title="Assemble Certificate"
          subtitle="Select verified measurement lines, then calculate the certificate"
          icon={<IconCalculator size={18} />}
          actions={
            <button
              type="button"
              onClick={handleCalculate}
              disabled={busy || selected.size === 0}
              className="rounded-lg bg-ecms-amber px-4 py-2 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Working…' : `Calculate (${selected.size})`}
            </button>
          }
        >
          {candidates.length === 0 ? (
            <EmptyState
              title="No verified measurement lines available"
              message="Submit and verify a measurement for this contract before assembling the certificate."
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TH>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={selected.size === candidates.length && candidates.length > 0}
                      onChange={toggleAll}
                    />
                  </TH>
                  <TH>Item</TH>
                  <TH>Description</TH>
                  <TH>Unit</TH>
                  <TH className="text-right">Accepted Qty</TH>
                  <TH>Measurement</TH>
                </THead>
                <TBody>
                  {candidates.map((c) => (
                    <TR key={c.id} className="hover:bg-ecms-elevated/40">
                      <TD>
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.itemNumber}`}
                          checked={selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                        />
                      </TD>
                      <TD className="font-medium whitespace-nowrap">{c.itemNumber}</TD>
                      <TD className="max-w-[280px] truncate text-ecms-muted">{c.description}</TD>
                      <TD>{c.unit}</TD>
                      <TD className="text-right">{num(c.acceptedQuantity)}</TD>
                      <TD className="text-ecms-muted whitespace-nowrap">
                        {c.measurementNumber}
                        <span className="mx-1">·</span>
                        {c.measurementDate}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {selected.size > 0 && (
                <p className="mt-3 text-xs text-ecms-muted">
                  {selected.size} line(s) selected · {num(selectedAmount)} aggregate accepted quantity
                </p>
              )}
            </>
          )}
        </Card>
      )}

      {isDraft && canPrepare && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card title="Add Adjustment" icon={<IconPlus size={18} />}>
            <form onSubmit={(e) => handleFormSubmit(e, `/api/v1/ipcs/${ipcId}/adjustments`, 'Adjustment added')} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Kind</span>
                <select name="kind" className={inputCls} defaultValue="daywork">
                  <option value="daywork">Daywork</option>
                  <option value="provisional_sum">Provisional sum</option>
                  <option value="penalty">Penalty</option>
                  <option value="other_addition">Other addition</option>
                  <option value="other_deduction">Other deduction</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Direction</span>
                <select name="direction" className={inputCls} defaultValue="1">
                  <option value="1">Addition (+)</option>
                  <option value="-1">Deduction (−)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className={labelCls}>Description</span>
                <input name="description" required className={inputCls} placeholder="e.g. Daywork for culvert excavation" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Quantity</span>
                <input name="quantity" type="number" step="0.001" className={inputCls} placeholder="0" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Rate ({currency})</span>
                <input name="rate" type="number" step="0.01" className={inputCls} placeholder="0.00" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Basis amount ({currency})</span>
                <input name="basis_amount" type="number" step="0.01" className={inputCls} placeholder="Optional" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Percentage (%)</span>
                <input name="percentage" type="number" step="0.01" min="0" max="100" className={inputCls} placeholder="Optional" />
              </label>
              <div className="sm:col-span-2">
                <button type="submit" disabled={busy} className="rounded-lg bg-ecms-elevated px-4 py-2 text-sm font-semibold text-ecms-text hover:bg-ecms-elevated/70 disabled:opacity-50">
                  Add Adjustment
                </button>
              </div>
            </form>
          </Card>

          <Card title="Add Materials on Site" icon={<IconTruckDelivery size={18} />}>
            <form onSubmit={(e) => handleFormSubmit(e, `/api/v1/ipcs/${ipcId}/materials-on-site`, 'Materials on site added')} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className={labelCls}>Description</span>
                <input name="description" required className={inputCls} placeholder="e.g. Precast culvert rings delivered to site" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Quantity</span>
                <input name="quantity" type="number" step="0.001" required className={inputCls} placeholder="0" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Unit</span>
                <input name="unit" required className={inputCls} placeholder="e.g. nr" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Unit rate ({currency})</span>
                <input name="unit_rate" type="number" step="0.01" required className={inputCls} placeholder="0.00" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Invoice number</span>
                <input name="invoice_number" className={inputCls} placeholder="Optional" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Delivery date</span>
                <input name="delivery_date" type="date" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Eligibility (%)</span>
                <input name="eligibility_percent" type="number" step="0.01" min="0" max="100" defaultValue="100" className={inputCls} />
              </label>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input name="recovery_flag" type="checkbox" value="true" />
                <span className="text-sm text-ecms-muted">Recovery (deduct from this certificate)</span>
              </label>
              <div className="sm:col-span-2">
                <button type="submit" disabled={busy} className="rounded-lg bg-ecms-elevated px-4 py-2 text-sm font-semibold text-ecms-text hover:bg-ecms-elevated/70 disabled:opacity-50">
                  Add Materials on Site
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {canRecordPayment && (
        <Card title="Record Payment" icon={<IconCash size={18} />}>
          <form onSubmit={(e) => handleFormSubmit(e, `/api/v1/ipcs/${ipcId}/payments`, 'Payment recorded')} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Payment date</span>
              <input name="payment_date" type="date" required className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Net amount ({currency})</span>
              <input name="net_paid_amount" type="number" step="0.01" min="0" required defaultValue={netCurrent > 0 ? netCurrent.toFixed(2) : ''} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Payment reference</span>
              <input name="payment_reference" required className={inputCls} placeholder="e.g. PV-2026-014" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Currency</span>
              <input name="currency" defaultValue={currency} className={inputCls} />
            </label>
            <div className="lg:col-span-4">
              <button type="submit" disabled={busy} className="rounded-lg bg-ecms-amber px-4 py-2 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90 disabled:opacity-50">
                Record Payment
              </button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
