'use client';

import { IconAlertTriangle } from '@tabler/icons-react';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ecms-danger/10 text-ecms-danger">
        <IconAlertTriangle size={28} />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-ecms-text">Something went wrong</h1>
        <p className="mt-1 max-w-md text-sm text-ecms-muted">
          {error.message || 'An unexpected error occurred while loading this page.'}
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-ecms-amber px-4 py-2 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90"
      >
        Try again
      </button>
    </div>
  );
}
