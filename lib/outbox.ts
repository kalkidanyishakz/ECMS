import { db } from '@/lib/db';

/**
 * Canonical set of event types the outbox worker knows how to dispatch. Keep
 * this in sync with the handler registry in `lib/worker/handlers/index.ts`.
 */
export const OUTBOX_EVENT_TYPES = {
  NOTIFICATION_DISPATCH: 'notification.dispatch',
  DOCUMENT_OCR_REQUESTED: 'document.ocr_requested',
  AI_FINDINGS_SCAN_REQUESTED: 'ai.findings_scan_requested',
} as const;

export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[keyof typeof OUTBOX_EVENT_TYPES];

export type OutboxEventInput = {
  tenantId: string;
  projectId?: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
};

/**
 * Insert a durable outbox event in the `pending` state. Callers enqueue inside
 * the same request that performs the state change; a background worker later
 * claims and dispatches the row. Pass `client` to reuse a transaction; defaults
 * to the shared Prisma singleton.
 */
export async function enqueueOutboxEvent(
  input: OutboxEventInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any = db
): Promise<{ id: string }> {
  return client.outbox_events.create({
    data: {
      tenant_id: input.tenantId,
      project_id: input.projectId ?? null,
      aggregate_type: input.aggregateType,
      aggregate_id: input.aggregateId,
      event_type: input.eventType,
      payload: input.payload,
      status: 'pending',
      attempts: 0,
      available_at: input.availableAt ?? new Date(),
    },
    select: { id: true },
  });
}
