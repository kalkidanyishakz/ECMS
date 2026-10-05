'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { IconCheckbox } from '@tabler/icons-react';
import { num } from '@/lib/format';

const inputCls = 'w-28 rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-right text-sm text-ecms-text';

export type VerifyLine = {
  id: string;
  lineNumber: number;
  itemNumber: string;
  description: string;
  unit: string;
  submittedQuantity: number;
};

type Props = {
  measurementId: string;
  status: string;
  canVerify: boolean;
  isSubmitter: boolean;
  lines: VerifyLine[];
};

export function MeasurementVerify({ measurementId, status, canVerify, isSubmitter, lines }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, String(l.submittedQuantity)]))
  );

  if (!canVerify || status !== 'submitted') return null;

  if (isSubmitter) {
    return (
      <Card title="Verification" subtitle="Segregation of duties" icon={<IconCheckbox size={18} />}>
        <p className="text-sm text-ecms-muted">
          You submitted this measurement. A different user must verify it before it can be included in an IPC.
        </p>
      </Card>
    );
  }

  async function handleVerify() {
    setBusy(true);
    try {
      const overrides = lines.map((l) => ({
        line_id: l.id,
        accepted_quantity: accepted[l.id] ?? String(l.submittedQuantity),
      }));
      const body = new FormData();
      body.set('accepted_quantities', JSON.stringify(overrides));
      const res = await fetch(`/api/v1/measurements/${measurementId}/verify`, {
        method: 'POST',
        body,
        redirect: 'manual',
      });
      if (res.type !== 'opaqueredirect' && !res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      }
      toast('Measurement verified and quantities accepted', 'success');
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Verification failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Verification"
      subtitle="Review submitted quantities and record the accepted quantities"
      icon={<IconCheckbox size={18} />}
      actions={
        <button
          type="button"
          onClick={handleVerify}
          disabled={busy}
          className="rounded-lg bg-ecms-success px-4 py-2 text-sm font-semibold text-white hover:bg-ecms-success/90 disabled:opacity-50"
        >
          {busy ? 'Verifying…' : 'Verify & Accept'}
        </button>
      }
    >
      <Table>
        <THead>
          <TH>#</TH>
          <TH>Item</TH>
          <TH>Description</TH>
          <TH>Unit</TH>
          <TH className="text-right">Submitted Qty</TH>
          <TH className="text-right">Accepted Qty</TH>
        </THead>
        <TBody>
          {lines.map((l) => (
            <TR key={l.id}>
              <TD>{l.lineNumber}</TD>
              <TD className="font-medium whitespace-nowrap">{l.itemNumber}</TD>
              <TD className="max-w-[280px] truncate text-ecms-muted">{l.description}</TD>
              <TD className="text-ecms-muted">{l.unit}</TD>
              <TD className="text-right">{num(l.submittedQuantity)}</TD>
              <TD className="text-right">
                <input
                  className={inputCls}
                  type="number"
                  step="0.0001"
                  min="0"
                  value={accepted[l.id] ?? ''}
                  onChange={(e) => setAccepted((prev) => ({ ...prev, [l.id]: e.target.value }))}
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}
