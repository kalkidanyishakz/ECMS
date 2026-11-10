import { db } from '@/lib/db';
import { readStoredFile } from '@/lib/storage';
import { classifyDocumentType, extractDocumentText, type DocumentType } from '@/lib/documents/extract';

/**
 * Run offline text extraction for one document revision and persist the result
 * to `document_pages`, rolling `ocr_status`/`page_count` up onto the revision.
 *
 * `opts.db` is injectable (mirroring `processOutboxBatch`) so the pipeline can
 * run against a transaction or a test double.
 */
export type RunDocumentOcrResult = { status: string; pageCount: number };

type RevisionForOcr = {
  id: string;
  document_id: string;
  file_id: string;
  documents: {
    project_id: string;
    projects: { tenant_id: string } | null;
  } | null;
  stored_files: {
    storage_key: string;
    original_name: string;
    mime_type: string;
  };
};

function thumbnailFileIdFor(type: DocumentType, fileId: string): string | null {
  // The original file IS the preview for single-image sources; text
  // spreadsheets and unsupported types have no rendered thumbnail.
  return type === 'image' || type === 'pdf' ? fileId : null;
}

export async function runDocumentOcr(
  revisionId: string,
  opts: { db?: unknown } = {}
): Promise<RunDocumentOcrResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = opts.db ?? db;

  const revision = (await client.document_revisions.findUnique({
    where: { id: revisionId },
    include: {
      documents: {
        select: { project_id: true, projects: { select: { tenant_id: true } } },
      },
      stored_files: true,
    },
  })) as RevisionForOcr | null;

  if (!revision) {
    throw new Error(`document revision not found: ${revisionId}`);
  }
  if (!revision.stored_files) {
    throw new Error(`document revision has no stored file: ${revisionId}`);
  }

  await client.document_revisions.update({
    where: { id: revisionId },
    data: { ocr_status: 'processing' },
  });

  const buffer = await readStoredFile(revision.stored_files);
  const result = extractDocumentText({
    buffer,
    mimeType: revision.stored_files.mime_type,
    fileName: revision.stored_files.original_name,
  });

  const documentType = classifyDocumentType({
    mimeType: revision.stored_files.mime_type,
    fileName: revision.stored_files.original_name,
  });
  const thumbnailFileId = thumbnailFileIdFor(documentType, revision.file_id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client.$transaction(async (tx: any) => {
    await tx.document_pages.deleteMany({ where: { revision_id: revisionId } });

    if (result.pages.length > 0) {
      await tx.document_pages.createMany({
        data: result.pages.map((page) => ({
          revision_id: revisionId,
          page_number: page.pageNumber,
          ocr_text: page.ocrText,
          thumbnail_file_id: thumbnailFileId,
          width_points: page.widthPoints,
          height_points: page.heightPoints,
          metadata: result.note ? { note: result.note } : {},
        })),
      });
    }

    await tx.document_revisions.update({
      where: { id: revisionId },
      data: {
        ocr_status: result.status,
        page_count: result.pages.length,
      },
    });

    return { status: result.status, pageCount: result.pages.length };
  });
}
