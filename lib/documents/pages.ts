/**
 * Read-side helpers for `document_pages`.
 *
 * Shared by the pages API route and the document detail page so both render the
 * same snippet/preview shape. The caller passes the Prisma client (or a
 * transaction) so the helper is testable and composable.
 */

export type DocumentPageRow = {
  id: string;
  revisionId: string;
  revisionNumber: string;
  pageNumber: number;
  snippet: string;
  text: string | null;
  previewUrl: string | null;
};

const SNIPPET_LENGTH = 240;
const SNIPPET_LEAD = 60;

function buildPreviewUrl(thumbnailFileId: string | null, revisionFileId: string | null): string | null {
  const fileId = thumbnailFileId ?? revisionFileId;
  return fileId ? `/api/v1/files/${fileId}` : null;
}

/**
 * Collapse whitespace and produce a short, search-aware snippet. When `query`
 * is present and found, the window is centred on the match so the user sees
 * why the page matched.
 */
export function makeSnippet(text: string | null, query?: string | null): string {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return '';

  const term = query?.trim();
  if (term) {
    const index = normalized.toLowerCase().indexOf(term.toLowerCase());
    if (index >= 0) {
      const start = Math.max(0, index - SNIPPET_LEAD);
      const end = Math.min(normalized.length, start + SNIPPET_LENGTH);
      return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
    }
  }

  return normalized.length > SNIPPET_LENGTH
    ? `${normalized.slice(0, SNIPPET_LENGTH)}…`
    : normalized;
}

type RevisionHeader = { id: string; revision_number: string; file_id: string };

/**
 * List extracted pages for a document, optionally filtered by a
 * case-insensitive substring of the OCR text across all of its revisions.
 */
export async function listDocumentPages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  documentId: string,
  query?: string | null
): Promise<DocumentPageRow[]> {
  const revisions = (await client.document_revisions.findMany({
    where: { document_id: documentId },
    select: { id: true, revision_number: true, file_id: true },
  })) as RevisionHeader[];

  if (revisions.length === 0) return [];

  const revisionIds = revisions.map((revision) => revision.id);
  const term = query?.trim();

  const pages = (await client.document_pages.findMany({
    where: {
      revision_id: { in: revisionIds },
      ...(term ? { ocr_text: { contains: term, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ revision_id: 'asc' }, { page_number: 'asc' }],
    select: {
      id: true,
      revision_id: true,
      page_number: true,
      ocr_text: true,
      thumbnail_file_id: true,
    },
  })) as Array<{
    id: string;
    revision_id: string;
    page_number: number;
    ocr_text: string | null;
    thumbnail_file_id: string | null;
  }>;

  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));

  return pages.map((page) => {
    const revision = revisionById.get(page.revision_id);
    return {
      id: page.id,
      revisionId: page.revision_id,
      revisionNumber: revision?.revision_number ?? '',
      pageNumber: page.page_number,
      snippet: makeSnippet(page.ocr_text, term),
      text: page.ocr_text,
      previewUrl: buildPreviewUrl(page.thumbnail_file_id, revision?.file_id ?? null),
    };
  });
}
