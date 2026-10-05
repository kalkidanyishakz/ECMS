import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { db } from '@/lib/db';

const UPLOAD_DIR = process.env.ECMS_UPLOAD_DIR || path.join(process.cwd(), '.uploads');

export type StoredFileRecord = {
  id: string;
  storage_provider: string;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: bigint;
};

/**
 * Persist an uploaded file to local disk and register it in `stored_files`.
 *
 * Local-disk storage keeps the demo dependency-free (no S3/MinIO required).
 * The storage provider is tagged `local` so it is clearly distinguishable from
 * a production object-store backend.
 */
export async function saveUploadedFile(
  file: File,
  opts: { tenantId: string; userId?: string | null }
): Promise<StoredFileRecord> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const key = `${opts.tenantId}/${randomUUID()}`;
  const fullPath = path.join(UPLOAD_DIR, key);

  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);

  return db.stored_files.create({
    data: {
      tenant_id: opts.tenantId,
      storage_provider: 'local',
      storage_bucket: 'ecms-local',
      storage_key: key,
      original_name: file.name || 'upload',
      mime_type: file.type || 'application/octet-stream',
      size_bytes: BigInt(buffer.length),
      sha256_hex: sha256,
      scan_status: 'clean',
      uploaded_by: opts.userId ?? null,
    },
  });
}

export async function readStoredFile(record: Pick<StoredFileRecord, 'storage_key'>): Promise<Buffer> {
  return readFile(path.join(UPLOAD_DIR, record.storage_key));
}

/** Read the first upload from a multipart form, if any. */
export function extractUpload(form: FormData, field = 'file'): File | null {
  const value = form.get(field);
  if (value && typeof value === 'object' && 'arrayBuffer' in value && (value as File).size > 0) {
    return value as File;
  }
  return null;
}
