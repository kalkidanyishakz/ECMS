import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getProjectContext } from '@/lib/server/context';
import { readStoredFile } from '@/lib/storage';
import { withErrorHandling } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

function safeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, '_');
}

export const GET = withErrorHandling(async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await getProjectContext();

  const file = await db.stored_files.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  if (file.storage_provider !== 'local') {
    return NextResponse.json({ error: 'Unsupported storage provider' }, { status: 501 });
  }

  const buffer = await readStoredFile(file);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': file.mime_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${safeFilename(file.original_name)}"`,
      'Content-Length': String(file.size_bytes),
      'Cache-Control': 'private, max-age=0, no-store',
    },
  });
});
