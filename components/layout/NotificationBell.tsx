'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconBell } from '@tabler/icons-react';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';

type NotificationItem = {
  id: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
      setUnread(data.unread_count ?? 0);
    } catch {
      // Ignore transient fetch failures.
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function markOne(id: string) {
    try {
      const res = await fetch(`/api/v1/notifications/${id}`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to mark notification read');
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
      );
      setUnread((prev) => Math.max(0, prev - 1));
      router.refresh();
    } catch {
      toast('Could not mark notification read', 'error');
    }
  }

  async function markAll() {
    if (unread === 0) return;
    setLoading(true);
    try {
      const body = new FormData();
      body.set('all', 'true');
      const res = await fetch('/api/v1/notifications/all', { method: 'POST', body });
      if (!res.ok) throw new Error('Failed to mark all read');
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
      setUnread(0);
      router.refresh();
    } catch {
      toast('Could not mark notifications read', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative text-ecms-muted hover:text-ecms-text"
        aria-label="Notifications"
      >
        <IconBell size={20} stroke={1.5} />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-ecms-navy bg-ecms-danger px-1 text-[9px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-ecms-border bg-ecms-card shadow-lg">
          <div className="flex items-center justify-between border-b border-ecms-border px-3 py-2">
            <span className="text-xs font-medium text-ecms-text">Notifications</span>
            <button
              type="button"
              onClick={markAll}
              disabled={loading || unread === 0}
              className="text-[11px] text-ecms-amber hover:underline disabled:text-ecms-muted disabled:no-underline"
            >
              Mark all read
            </button>
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ecms-muted">No notifications.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-ecms-border overflow-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => !n.read_at && markOne(n.id)}
                    className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-ecms-elevated"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 truncate text-xs font-medium text-ecms-text">
                        {!n.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ecms-amber" />}
                        {n.title}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-ecms-muted">
                        {date(n.created_at)}
                      </span>
                    </span>
                    {n.body && <span className="line-clamp-2 text-[11px] text-ecms-muted">{n.body}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
