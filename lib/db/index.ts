import { PrismaClient } from '@/lib/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma returns PostgreSQL bigint columns (e.g. row_version) as BigInt, which
// JSON.stringify cannot serialize. Register a toJSON so route handlers can
// return model rows directly without a BigInt serialization error.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(
  this: bigint,
): string {
  return this.toString();
};

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/ecms?schema=ecms';

const globalForDb = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString, options: '-c search_path=ecms,public' });
  return new PrismaClient({ adapter });
}

export const db = globalForDb.prisma ?? createClient();
if (process.env.NODE_ENV !== 'production') globalForDb.prisma = db;

export * from '@/lib/generated/prisma/enums';
