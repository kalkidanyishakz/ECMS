import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { getProjectContext } from '@/lib/server/context';
import { requireApiPermission } from '@/lib/server/session';
import { processOutboxBatch } from '@/lib/worker';

export const dynamic = 'force-dynamic';

/**
 * Run one worker batch synchronously. Used by cron/ops to tick the outbox.
 *
 * Gated by the existing seed permission `audit.read` (db/migrations/0004):
 * it is the closest administrative, non-mutating permission available and is
 * granted to tenant_admin plus auditor/PM-style roles. `tenant_admin` is a
 * super role, so it passes regardless.
 */
export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const { projectId } = await getProjectContext();

  const auth = await requireApiPermission('audit.read', projectId);
  if (auth instanceof NextResponse) return auth;

  let limit: number | undefined;
  try {
    const body = (await req.json()) as { limit?: unknown } | null;
    if (body && typeof body.limit === 'number' && Number.isFinite(body.limit)) {
      limit = body.limit;
    }
  } catch {
    // An empty/absent body is valid: fall back to the default batch size.
  }

  const result = await processOutboxBatch({ limit });
  return NextResponse.json(result);
});
