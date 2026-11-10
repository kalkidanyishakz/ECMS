import os from 'node:os';
import { db } from '@/lib/db';
import { workerHandlers } from './handlers';

export type OutboxEventRow = {
  id: string;
  tenant_id: string;
  project_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  status: string;
  attempts: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkerHandler = (event: OutboxEventRow, ctx: { db: any }) => Promise<void>;

export type ProcessOutboxBatchOptions = {
  limit?: number;
  workerId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any;
  maxAttempts?: number;
  handlers?: Record<string, WorkerHandler>;
};

export type ProcessOutboxBatchResult = {
  claimed: number;
  processed: number;
  failed: number;
  deadLettered: number;
};

const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 3_600_000;

/**
 * Claim pending/failed rows with `FOR UPDATE SKIP LOCKED` so concurrent workers
 * never process the same event. The SELECT + UPDATE run in one transaction;
 * `RETURNING attempts` yields the already-incremented attempt count used for
 * retry/dead-letter decisions.
 */
const CLAIM_SELECT_SQL = `
  SELECT id, tenant_id, project_id, aggregate_type, aggregate_id, event_type,
         payload, status, attempts
  FROM ecms.outbox_events
  WHERE status IN ('pending'::ecms.outbox_status, 'failed'::ecms.outbox_status)
    AND available_at <= now()
  ORDER BY created_at ASC, id ASC
  LIMIT $1
  FOR UPDATE SKIP LOCKED
`;

const CLAIM_MARK_SQL = `
  UPDATE ecms.outbox_events
  SET status = 'processing'::ecms.outbox_status,
      locked_at = now(),
      locked_by = $2,
      attempts = attempts + 1
  WHERE id = ANY($1::uuid[])
  RETURNING id, tenant_id, project_id, aggregate_type, aggregate_id, event_type,
            payload, status, attempts
`;

let cachedWorkerId: string | undefined;

/** Stable per-process worker identity: `hostname:pid:random`. */
export function getWorkerId(): string {
  if (!cachedWorkerId) {
    cachedWorkerId = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
  }
  return cachedWorkerId;
}

/** Exponential backoff: 30s * 2^(attempts-1), capped at one hour. */
function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(BASE_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);
}

/**
 * Claim and process one batch of outbox events.
 *
 * Claiming happens in a single transaction; handlers run after that transaction
 * commits so a slow/erroring handler cannot hold row locks. `client` is
 * injectable so the batch can be unit-tested without a database.
 */
export async function processOutboxBatch(
  opts: ProcessOutboxBatchOptions = {}
): Promise<ProcessOutboxBatchResult> {
  const limit = Math.max(1, Math.trunc(opts.limit ?? DEFAULT_LIMIT));
  const workerId = opts.workerId ?? getWorkerId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = opts.client ?? db;
  const maxAttempts = Math.max(1, Math.trunc(opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));

  const claimedRows = (await client.$transaction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any) => {
      const selected = (await tx.$queryRawUnsafe(CLAIM_SELECT_SQL, limit)) as OutboxEventRow[];
      if (selected.length === 0) return [] as OutboxEventRow[];
      const ids = selected.map((row) => row.id);
      return (await tx.$queryRawUnsafe(CLAIM_MARK_SQL, ids, workerId)) as OutboxEventRow[];
    }
  )) as OutboxEventRow[];

  const now = new Date();
  let processed = 0;
  let failed = 0;
  let deadLettered = 0;

  const handlers = opts.handlers ?? workerHandlers;

  for (const row of claimedRows) {
    const handler = handlers[row.event_type];

    if (!handler) {
      // Non-retryable: an unknown event type will never become known by waiting.
      await client.outbox_events.update({
        where: { id: row.id },
        data: {
          status: 'dead_letter',
          last_error: `Unknown event type: ${row.event_type}`,
        },
      });
      deadLettered += 1;
      continue;
    }

    try {
      await handler(row, { db: client });
      await client.outbox_events.update({
        where: { id: row.id },
        data: { status: 'completed', processed_at: now, last_error: null },
      });
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (row.attempts >= maxAttempts) {
        await client.outbox_events.update({
          where: { id: row.id },
          data: { status: 'dead_letter', last_error: message },
        });
        deadLettered += 1;
      } else {
        await client.outbox_events.update({
          where: { id: row.id },
          data: {
            status: 'failed',
            last_error: message,
            available_at: new Date(now.getTime() + retryDelayMs(row.attempts)),
          },
        });
        failed += 1;
      }
    }
  }

  return { claimed: claimedRows.length, processed, failed, deadLettered };
}

export { workerHandlers };
