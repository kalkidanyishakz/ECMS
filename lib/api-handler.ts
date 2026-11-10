import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';

type AnyFunction = (...args: never[]) => Promise<NextResponse>;

export function redirectIfRequested(form: FormData, fallback?: string): void {
  const target = ((form.get('redirect_to') as string | null) ?? '').trim() || fallback;
  if (target) redirect(target);
}

export function withErrorHandling<T extends AnyFunction>(handler: T): T {
  return (async (...args: never[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      const req = args[0] as Request | undefined;
      if (error instanceof Error && error.message.includes('NEXT_REDIRECT')) {
        throw error;
      }
      if (error instanceof Error && error.message.includes('NEXT_NOT_FOUND')) {
        throw error;
      }
      console.error(`[API Error] ${req?.method} ${new URL(req?.url ?? 'http://localhost').pathname}:`, error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  }) as T;
}
