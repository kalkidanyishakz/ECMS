'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { IconRobot } from '@tabler/icons-react';

/**
 * Triggers the deterministic rules-based findings scan.
 *
 * Uses `?sync=1` so the scan runs inline and `router.refresh()` immediately
 * surfaces the new rows in the AI Findings table. The same endpoint's default
 * (queued) mode is still used by external/worker callers.
 */
export function RunFindingsScanButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function runScan() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/controls/findings/scan?sync=1', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        created?: number;
        skipped?: number;
      };
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const created = data.created ?? 0;
      const skipped = data.skipped ?? 0;
      toast(
        created > 0
          ? `AI scan complete: ${created} new finding(s), ${skipped} already known`
          : `AI scan complete: no new findings (${skipped} already known)`,
        'success'
      );
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to run AI scan', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={runScan}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <IconRobot size={16} />
      {busy ? 'Scanning…' : 'Run AI scan'}
    </button>
  );
}
