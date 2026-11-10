import { OUTBOX_EVENT_TYPES } from '@/lib/outbox';
import type { WorkerHandler } from '@/lib/worker';
import { handler as notificationHandler } from './notifications';
import { handler as documentHandler } from './documents';
import { handler as findingsHandler } from './findings';

/**
 * Registry of outbox event types to handlers. Event types with no entry are
 * treated by the worker as non-retryable and dead-lettered immediately.
 */
export const workerHandlers: Record<string, WorkerHandler> = {
  [OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH]: notificationHandler,
  [OUTBOX_EVENT_TYPES.DOCUMENT_OCR_REQUESTED]: documentHandler,
  [OUTBOX_EVENT_TYPES.AI_FINDINGS_SCAN_REQUESTED]: findingsHandler,
};
