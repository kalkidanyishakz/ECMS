import Link from 'next/link';
import { IconAlertTriangle } from '@tabler/icons-react';

export default function AppNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ecms-elevated text-ecms-muted">
        <IconAlertTriangle size={28} />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-ecms-text">Page not found</h1>
        <p className="mt-1 max-w-md text-sm text-ecms-muted">
          The page you are looking for does not exist or may have been moved.
        </p>
      </div>
      <Link
        href="/dashboard"
        className="rounded-lg bg-ecms-amber px-4 py-2 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
