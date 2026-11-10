import { db } from '@/lib/db';
import type { Prisma } from '@/lib/generated/prisma/client';

export type AuditInput = {
  tenantId: string;
  projectId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

export async function writeAudit(input: AuditInput) {
  return db.audit_events.create({
    data: {
      tenant_id: input.tenantId,
      project_id: input.projectId ?? null,
      actor_user_id: input.actorUserId ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      before_data: input.before ? (input.before as Prisma.InputJsonValue) : undefined,
      after_data: input.after ? (input.after as Prisma.InputJsonValue) : undefined,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
