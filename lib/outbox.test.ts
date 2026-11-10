import { describe, it, expect } from 'vitest';
import { enqueueOutboxEvent, OUTBOX_EVENT_TYPES } from './outbox';

type CapturedCreate = { data: Record<string, unknown>; select: { id: true } };

function createFakeOutboxClient() {
  const calls: CapturedCreate[] = [];
  const client = {
    outbox_events: {
      create: async (args: CapturedCreate) => {
        calls.push(args);
        return { id: 'evt-1' };
      },
    },
  };
  return { client, calls };
}

describe('enqueueOutboxEvent', () => {
  it('writes a pending outbox row with zero attempts and a ready available_at', async () => {
    const { client, calls } = createFakeOutboxClient();
    const before = Date.now();

    const result = await enqueueOutboxEvent(
      {
        tenantId: 'tenant-1',
        aggregateType: 'notification',
        aggregateId: '11111111-1111-1111-1111-111111111111',
        eventType: OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH,
        payload: { notificationIds: ['22222222-2222-2222-2222-222222222222'] },
      },
      client
    );

    expect(result).toEqual({ id: 'evt-1' });
    expect(calls).toHaveLength(1);

    const data = calls[0].data;
    expect(data.status).toBe('pending');
    expect(data.attempts).toBe(0);
    expect(data.project_id).toBeNull();
    expect(data.aggregate_type).toBe('notification');
    expect(data.aggregate_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(data.event_type).toBe('notification.dispatch');
    expect(data.payload).toEqual({
      notificationIds: ['22222222-2222-2222-2222-222222222222'],
    });
    expect(data.available_at).toBeInstanceOf(Date);
    expect((data.available_at as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('honors an explicit projectId and availableAt', async () => {
    const { client, calls } = createFakeOutboxClient();
    const availableAt = new Date('2030-01-01T00:00:00.000Z');
    const projectId = '33333333-3333-3333-3333-333333333333';

    await enqueueOutboxEvent(
      {
        tenantId: 'tenant-1',
        projectId,
        aggregateType: 'document',
        aggregateId: '44444444-4444-4444-4444-444444444444',
        eventType: OUTBOX_EVENT_TYPES.DOCUMENT_OCR_REQUESTED,
        payload: { revisionId: '44444444-4444-4444-4444-444444444444' },
        availableAt,
      },
      client
    );

    expect(calls[0].data.project_id).toBe(projectId);
    expect(calls[0].data.available_at).toBe(availableAt);
  });
});
