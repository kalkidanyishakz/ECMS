/**
 * Enqueue `document.ocr_requested` for every document revision that has no
 * `document_pages` rows yet. Idempotent by construction: once the worker has
 * populated a revision, it no longer matches the filter.
 *
 * Run:  npm run ocr:backfill
 *       (then: npm run worker -- --once  or  POST /api/v1/worker/tick)
 */
import { db } from '@/lib/db';
import { enqueueOutboxEvent, OUTBOX_EVENT_TYPES } from '@/lib/outbox';

type PendingRevision = {
  id: string;
  documents: {
    project_id: string;
    projects: { tenant_id: string } | null;
  } | null;
};

async function main(): Promise<void> {
  const revisions = (await db.document_revisions.findMany({
    where: { document_pages: { none: {} } },
    select: {
      id: true,
      documents: {
        select: {
          project_id: true,
          projects: { select: { tenant_id: true } },
        },
      },
    },
  })) as PendingRevision[];

  let enqueued = 0;
  for (const revision of revisions) {
    const document = revision.documents;
    if (!document?.projects) continue;

    await enqueueOutboxEvent({
      tenantId: document.projects.tenant_id,
      projectId: document.project_id,
      aggregateType: 'document_revision',
      aggregateId: revision.id,
      eventType: OUTBOX_EVENT_TYPES.DOCUMENT_OCR_REQUESTED,
      payload: { revisionId: revision.id },
    });
    enqueued += 1;
  }

  console.log(
    `[ocr-backfill] enqueued ${enqueued} of ${revisions.length} revision(s) without pages`
  );
}

main().catch((error) => {
  console.error('[ocr-backfill] failed', error);
  process.exitCode = 1;
});
