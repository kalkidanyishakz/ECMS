import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getProjectContext } from '@/lib/server/context';
import { withErrorHandling } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async function GET() {
  const { userId } = await getProjectContext();

  const [notifications, unreadCount] = await Promise.all([
    db.notifications.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 50,
    }),
    db.notifications.count({ where: { user_id: userId, read_at: null } }),
  ]);

  return NextResponse.json({ notifications, unread_count: unreadCount });
});
