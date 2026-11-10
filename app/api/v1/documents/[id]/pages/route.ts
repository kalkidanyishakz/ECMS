import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { withErrorHandling } from '@/lib/api-handler';
import { listDocumentPages } from '@/lib/documents/pages';

export const dynamic = 'force-dynamic';

/**
 * List extracted pages for a document across all of its revisions.
 *
 * Optional `?q=` performs a case-insensitive substring match on
 * `document_pages.ocr_text` and centres the returned snippet on the match.
 */
export const GET = withErrorHandling(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { projectId } = await getProjectContext();
  if (!projectId) return NextResponse.json({ error: 'No project selected' }, { status: 400 });

  const auth = await requireApiPermission('document.read', projectId);
  if (auth instanceof NextResponse) return auth;

  const document = await db.documents.findUnique({
    where: { id },
    select: { project_id: true },
  });
  if (!document || document.project_id !== projectId) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const q = req.nextUrl.searchParams.get('q');
  const pages = await listDocumentPages(db, id, q);

  return NextResponse.json({ pages });
});
