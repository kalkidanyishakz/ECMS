import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { getProjectContext } from '@/lib/server/context';
import { requireApiPermission } from '@/lib/server/session';
import { writeAudit } from '@/lib/audit';
import { enqueueOutboxEvent, OUTBOX_EVENT_TYPES } from '@/lib/outbox';
import { generateFindings } from '@/lib/controls/findings';

export const dynamic = 'force-dynamic';

/**
 * Request a deterministic, rules-based AI findings scan.
 *
 * Default mode enqueues `ai.findings_scan_requested`, which the outbox worker
 * (or `POST /api/v1/worker/tick`) drains asynchronously and returns 202.
 * `?sync=1` runs the generator inline and returns the created/skipped counts —
 * used by the demo/CLI path and idempotent re-runs.
 *
 * Gated by the existing `audit.read` permission from db/migrations/0004: it is
 * the closest non-mutating administrative permission (the same gate used by the
 * on-demand worker trigger at `/api/v1/worker/tick`) and is granted to
 * tenant_admin plus PM/auditor-style roles.
 */
export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const { tenantId, projectId } = await getProjectContext();
  if (!projectId) {
    return NextResponse.json({ error: 'No active project' }, { status: 400 });
  }

  const auth = await requireApiPermission('audit.read', projectId);
  if (auth instanceof NextResponse) return auth;
  const actorUserId = auth.appUser.id;

  const sync = req.nextUrl.searchParams.get('sync') === '1';

  if (sync) {
    const result = await generateFindings(projectId);
    await writeAudit({
      tenantId,
      projectId,
      actorUserId,
      action: 'AI_FINDINGS_SCAN_COMPLETED',
      entityType: 'project',
      entityId: projectId,
      metadata: { mode: 'sync', created: result.created, skipped: result.skipped },
    });
    return NextResponse.json({ queued: false, created: result.created, skipped: result.skipped });
  }

  await enqueueOutboxEvent({
    tenantId,
    projectId,
    aggregateType: 'project',
    aggregateId: projectId,
    eventType: OUTBOX_EVENT_TYPES.AI_FINDINGS_SCAN_REQUESTED,
    payload: { projectId },
  });
  await writeAudit({
    tenantId,
    projectId,
    actorUserId,
    action: 'AI_FINDINGS_SCAN_REQUESTED',
    entityType: 'project',
    entityId: projectId,
    metadata: { mode: 'queued' },
  });

  return NextResponse.json({ queued: true }, { status: 202 });
});
