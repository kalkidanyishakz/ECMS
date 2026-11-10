import type { WorkerHandler } from '@/lib/worker';

type NotificationDispatchPayload = {
  notificationIds: string[];
};

/**
 * `notification.dispatch` — deliver queued notifications to the in-app inbox.
 *
 * There is no email/SMS channel wired: "delivered" means the notification row
 * is persisted to the in-app inbox (`status = 'sent'`), not that an external
 * message was sent.
 */
export const handler: WorkerHandler = async (event, ctx) => {
  const payload = event.payload as Partial<NotificationDispatchPayload> | null;
  const notificationIds = payload?.notificationIds;

  if (
    !Array.isArray(notificationIds) ||
    notificationIds.some((id) => typeof id !== 'string')
  ) {
    throw new Error('notification.dispatch payload.notificationIds must be a string array');
  }

  if (notificationIds.length === 0) return;

  await ctx.db.notifications.updateMany({
    where: { id: { in: notificationIds }, status: 'queued' },
    data: { status: 'sent', sent_at: new Date() },
  });
};
