import { describe, it, expect } from 'vitest';
import { processOutboxBatch, type OutboxEventRow, type WorkerHandler } from './index';

const failingHandler: WorkerHandler = async () => {
  throw new Error('not implemented yet');
};

type UpdateCall = { where: { id: string }; data: Record<string, unknown> };

function createFakeClient(claimedRows: OutboxEventRow[]) {
  const updates: UpdateCall[] = [];
  const updateManyCalls: Array<{ where: unknown; data: unknown }> = [];
  const queries: string[] = [];

  const tx = {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      void params;
      queries.push(sql);
      // SELECT ... FOR UPDATE SKIP LOCKED and UPDATE ... RETURNING both yield
      // the claimed rows; the fake surfaces the post-increment attempts.
      return claimedRows;
    },
  };

  const client = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    outbox_events: {
      update: async (args: UpdateCall) => {
        updates.push(args);
        return args;
      },
    },
    notifications: {
      updateMany: async (args: { where: unknown; data: unknown }) => {
        updateManyCalls.push(args);
        return { count: 1 };
      },
    },
  };

  return { client, updates, updateManyCalls, queries };
}

function row(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    tenant_id: 'tttttttt-tttt-tttt-tttt-tttttttttttt',
    project_id: null,
    aggregate_type: 'notification',
    aggregate_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    event_type: 'notification.dispatch',
    payload: { notificationIds: ['cccccccc-cccc-cccc-cccc-cccccccccccc'] },
    status: 'processing',
    attempts: 1,
    ...overrides,
  };
}

describe('processOutboxBatch', () => {
  it('claims rows with FOR UPDATE SKIP LOCKED and increments attempts in one transaction', async () => {
    const { client, queries } = createFakeClient([row({ attempts: 1 })]);

    await processOutboxBatch({ client, workerId: 'worker-1' });

    const sql = queries.join('\n');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('attempts = attempts + 1');
    expect(sql).toContain("status IN ('pending'::ecms.outbox_status, 'failed'::ecms.outbox_status)");
  });

  it('marks a successfully handled event completed and delivers the notification', async () => {
    const { client, updates, updateManyCalls } = createFakeClient([row({ attempts: 1 })]);

    const result = await processOutboxBatch({ client });

    expect(result).toEqual({ claimed: 1, processed: 1, failed: 0, deadLettered: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0].data.status).toBe('completed');
    expect(updates[0].data.last_error).toBeNull();
    expect(updates[0].data.processed_at).toBeInstanceOf(Date);

    // notification.dispatch persists to the in-app inbox (no email channel).
    expect(updateManyCalls).toHaveLength(1);
    expect(updateManyCalls[0].where).toEqual({
      id: { in: ['cccccccc-cccc-cccc-cccc-cccccccccccc'] },
      status: 'queued',
    });
    expect(updateManyCalls[0].data).toEqual({ status: 'sent', sent_at: expect.any(Date) });
  });

  it('retries a failing handler and schedules a future available_at with backoff', async () => {
    const { client, updates } = createFakeClient([
      row({
        id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        aggregate_type: 'document',
        event_type: 'document.ocr_requested',
        payload: { revisionId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' },
        attempts: 1,
      }),
    ]);
    const before = Date.now();

    const result = await processOutboxBatch({
      client,
      maxAttempts: 5,
      handlers: { 'document.ocr_requested': failingHandler },
    });

    expect(result).toEqual({ claimed: 1, processed: 0, failed: 1, deadLettered: 0 });
    const data = updates[0].data;
    expect(data.status).toBe('failed');
    expect(data.last_error).toContain('not implemented yet');
    expect(data.available_at).toBeInstanceOf(Date);

    // attempts=1 -> 30s * 2^0 = 30s
    const delay = (data.available_at as Date).getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(29_000);
    expect(delay).toBeLessThanOrEqual(60_000);
  });

  it('dead-letters a handler once the incremented attempts reach maxAttempts', async () => {
    const { client, updates } = createFakeClient([
      row({
        id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        event_type: 'document.ocr_requested',
        payload: { revisionId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' },
        attempts: 5,
      }),
    ]);

    const result = await processOutboxBatch({
      client,
      maxAttempts: 5,
      handlers: { 'document.ocr_requested': failingHandler },
    });

    expect(result).toEqual({ claimed: 1, processed: 0, failed: 0, deadLettered: 1 });
    expect(updates[0].data.status).toBe('dead_letter');
    expect(updates[0].data.last_error).toContain('not implemented yet');
  });

  it('immediately dead-letters an unknown event type without retrying', async () => {
    const { client, updates } = createFakeClient([
      row({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', event_type: 'mystery.event' }),
    ]);

    const result = await processOutboxBatch({ client });

    expect(result).toEqual({ claimed: 1, processed: 0, failed: 0, deadLettered: 1 });
    expect(updates[0].data.status).toBe('dead_letter');
    expect(updates[0].data.last_error).toBe('Unknown event type: mystery.event');
  });

  it('returns zero counts when nothing is claimable', async () => {
    const { client, updates } = createFakeClient([]);

    const result = await processOutboxBatch({ client });

    expect(result).toEqual({ claimed: 0, processed: 0, failed: 0, deadLettered: 0 });
    expect(updates).toHaveLength(0);
  });
});
