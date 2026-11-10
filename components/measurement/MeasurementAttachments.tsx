'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { IconPaperclip, IconUpload, IconTrash } from '@tabler/icons-react';
import { humanFileSize, type AttachmentOption } from '@/lib/attachments';
import { dateTime } from '@/lib/format';

const inputCls = 'rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text';
const labelCls = 'text-xs font-medium text-ecms-muted';

export type AttachmentLineOption = {
  id: string;
  lineNumber: number;
  description: string;
};

type Props = {
  measurementId: string;
  attachments: AttachmentOption[];
  canUpload: boolean;
  canDelete: boolean;
  lines?: AttachmentLineOption[];
};

export function MeasurementAttachments({
  measurementId,
  attachments,
  canUpload,
  canDelete,
  lines = [],
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = new FormData(form);
    const target = String(body.get('target') ?? 'measurement');
    body.delete('target');
    if (target === 'measurement') {
      body.set('record_type', 'measurement');
      body.delete('record_id');
    } else {
      body.set('record_type', 'measurement_line');
      body.set('record_id', target);
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/v1/measurements/${measurementId}/attachments`, {
        method: 'POST',
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Upload failed (${res.status})`);
      toast('Attachment uploaded', 'success');
      form.reset();
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Upload failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(attachmentId: string) {
    setDeletingId(attachmentId);
    try {
      const res = await fetch(`/api/v1/measurements/${measurementId}/attachments/${attachmentId}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Delete failed (${res.status})`);
      toast('Attachment deleted', 'success');
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Delete failed', 'error');
    } finally {
      setDeletingId(null);
    }
  }

  const countLabel = `${attachments.length} file${attachments.length === 1 ? '' : 's'}`;

  return (
    <Card
      title="Evidence Attachments"
      subtitle={countLabel}
      icon={<IconPaperclip size={18} />}
    >
      {attachments.length === 0 ? (
        <EmptyState
          title="No attachments"
          message="Upload photos, drawings, or documents as evidence for this measurement."
        />
      ) : (
        <Table>
          <THead>
            <TH>File</TH>
            <TH>Type</TH>
            <TH className="text-right">Size</TH>
            <TH>Description</TH>
            <TH>Added</TH>
            {canDelete && <TH>Actions</TH>}
          </THead>
          <TBody>
            {attachments.map((a) => (
              <TR key={a.id} className="hover:bg-ecms-elevated/40">
                <TD>
                  <a
                    href={a.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-ecms-amber hover:underline"
                  >
                    {a.fileName}
                  </a>
                  {a.recordType === 'measurement_line' && (
                    <span className="ml-2 text-xs text-ecms-muted">(line)</span>
                  )}
                </TD>
                <TD className="text-xs text-ecms-muted">{a.mimeType}</TD>
                <TD className="text-right text-ecms-muted">{humanFileSize(a.sizeBytes)}</TD>
                <TD className="max-w-[220px] truncate text-xs text-ecms-muted">{a.description ?? '—'}</TD>
                <TD className="whitespace-nowrap text-xs text-ecms-muted">{dateTime(a.createdAt)}</TD>
                {canDelete && (
                  <TD>
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      disabled={deletingId === a.id || busy}
                      className="inline-flex items-center gap-1 rounded-lg border border-ecms-border px-2 py-1 text-xs text-ecms-danger hover:bg-ecms-danger/10 disabled:opacity-50"
                    >
                      <IconTrash size={14} />
                      {deletingId === a.id ? 'Removing…' : 'Delete'}
                    </button>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {canUpload && (
        <form
          onSubmit={handleUpload}
          className="mt-5 grid grid-cols-1 gap-3 border-t border-ecms-border pt-5 sm:grid-cols-3"
        >
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={labelCls}>File</span>
            <input name="file" type="file" required className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Target</span>
            <select name="target" className={inputCls} defaultValue="measurement">
              <option value="measurement">Whole measurement</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  #{l.lineNumber} — {l.description.slice(0, 60)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={labelCls}>Description (optional)</span>
            <input name="description" className={inputCls} placeholder="What does this evidence show?" />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg bg-ecms-elevated px-4 py-2 text-sm font-semibold text-ecms-text hover:bg-ecms-elevated/70 disabled:opacity-50"
            >
              <IconUpload size={16} />
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
