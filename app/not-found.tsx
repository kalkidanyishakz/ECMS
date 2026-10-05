import Link from 'next/link';
import { Logo } from '@/components/ui/Logo';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <Logo variant="mark" />
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-ecms-amber">404</p>
        <h1 className="mt-2 text-xl font-semibold text-ecms-text">Page not found</h1>
        <p className="mt-2 max-w-md text-sm text-ecms-muted">
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
