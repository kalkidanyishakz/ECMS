/**
 * Pure helpers for measurement evidence attachments.
 *
 * These functions carry no I/O so they can be unit-tested in isolation; the
 * route handlers own persistence and authorisation.
 */

export const ATTACHMENT_RECORD_TYPES = ['measurement', 'measurement_line'] as const;

export type AttachmentRecordType = (typeof ATTACHMENT_RECORD_TYPES)[number];

/** Shape passed from server components/routes to the client attachments card. */
export type AttachmentOption = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  recordType: string;
  recordId: string;
  createdAt: string;
  fileUrl: string;
};

/** Structural input for {@link toAttachmentOption} — matches the Prisma row + include. */
export type AttachmentRecordInput = {
  id: string;
  record_type: string;
  record_id: string;
  file_id: string;
  description: string | null;
  created_at: Date;
  stored_files: {
    original_name: string;
    mime_type: string;
    size_bytes: bigint;
  };
};

export function toAttachmentOption(record: AttachmentRecordInput): AttachmentOption {
  return {
    id: record.id,
    fileName: record.stored_files.original_name,
    mimeType: record.stored_files.mime_type,
    sizeBytes: Number(record.stored_files.size_bytes),
    description: record.description,
    recordType: record.record_type,
    recordId: record.record_id,
    createdAt: record.created_at.toISOString(),
    fileUrl: `/api/v1/files/${record.file_id}`,
  };
}

const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** Render a byte count as a compact human-readable string (binary units). */
export function humanFileSize(bytes: number | bigint): string {
  const value = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${Math.round(value)} B`;

  let scaled = value;
  let unitIndex = -1;
  while (scaled >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  return `${scaled.toFixed(1)} ${SIZE_UNITS[unitIndex]}`;
}

export type AttachmentTargetInput = {
  recordType?: string | null;
  recordId?: string | null;
  measurementId: string;
  lineIds: readonly string[];
};

export type AttachmentTargetResult =
  | { ok: true; recordType: AttachmentRecordType; recordId: string }
  | { ok: false; error: string };

/**
 * Resolve and validate the target of an attachment upload.
 *
 * `record_type` defaults to `measurement`; `record_id` defaults to the
 * measurement id. A `measurement` attachment may only point at its own
 * measurement, while a `measurement_line` attachment must reference a line
 * belonging to that measurement.
 */
export function validateAttachmentTarget({
  recordType,
  recordId,
  measurementId,
  lineIds,
}: AttachmentTargetInput): AttachmentTargetResult {
  const type = (recordType ?? '').trim() || 'measurement';
  if (type !== 'measurement' && type !== 'measurement_line') {
    return { ok: false, error: `Unsupported record_type: ${type}` };
  }

  const resolvedId = (recordId ?? '').trim() || measurementId;

  if (type === 'measurement') {
    if (resolvedId !== measurementId) {
      return { ok: false, error: 'record_id must match the measurement id' };
    }
    return { ok: true, recordType: type, recordId: measurementId };
  }

  if (!lineIds.includes(resolvedId)) {
    return { ok: false, error: 'record_id must be a measurement line belonging to this measurement' };
  }
  return { ok: true, recordType: type, recordId: resolvedId };
}
