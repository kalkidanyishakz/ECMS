import type { Prisma } from '@/lib/generated/prisma/client';
import { db } from '@/lib/db';

/**
 * Run a unit of work inside a transaction whose `search_path` includes the
 * `ecms` schema.
 *
 * Several triggers created by db/migrations/0004 reference tables/types without
 * schema-qualifying them, while Prisma's normal session resolves `search_path`
 * to `"$user", public`. `SET LOCAL` inside an interactive transaction is pinned
 * to the same connection the triggers run on, so those references resolve.
 */
export async function withSearchPath<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL search_path TO ecms, public');
    return work(tx);
  });
}
