import type { WorkerHandler } from '@/lib/worker';
import { runDocumentOcr } from '@/lib/documents/ocr';

type OcrRequestedPayload = {
  revisionId?: unknown;
};

/**
 * `document.ocr_requested` — extract per-page text for a revision.
 *
 * Payload: `{ revisionId: string }`. Extraction is offline and synchronous;
 * failures throw so the outbox retries with backoff (and eventually
 * dead-letters), which is the correct behaviour for a transient read error.
 */
export const handler: WorkerHandler = async (event, ctx) => {
  const payload = event.payload as OcrRequestedPayload | null;
  const revisionId = payload?.revisionId;

  if (typeof revisionId !== 'string' || revisionId.length === 0) {
    throw new Error('document.ocr_requested payload.revisionId must be a non-empty string');
  }

  await runDocumentOcr(revisionId, { db: ctx.db });
};
