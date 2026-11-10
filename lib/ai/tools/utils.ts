import { resolveEffectivePermissions, hasAnyPermission } from '@/lib/server/session';
import { db as defaultDb } from '@/lib/db';
import type { ToolDb } from './db';

export type ToolPermissionCheckResult =
  | { allowed: true; roles: string[]; permissions: string[] }
  | { allowed: false; restricted: true; reason: string };

export async function checkToolPermissions(
  projectId: string,
  userId: string,
  requiredDomainPermission: string,
  dbClient: ToolDb = defaultDb as unknown as ToolDb
): Promise<ToolPermissionCheckResult> {
  if (!projectId || !userId) {
    return {
      allowed: false,
      restricted: true,
      reason: 'Both projectId and userId must be provided.',
    };
  }

  const { roles, permissions } = await resolveEffectivePermissions(userId, projectId, dbClient);

  if (!hasAnyPermission(roles, permissions, 'ai_chat.use')) {
    return {
      allowed: false,
      restricted: true,
      reason: "User lacks the required 'ai_chat.use' permission to access AI chat tools.",
    };
  }

  if (!hasAnyPermission(roles, permissions, requiredDomainPermission)) {
    return {
      allowed: false,
      restricted: true,
      reason: `User lacks the required '${requiredDomainPermission}' domain permission.`,
    };
  }

  return { allowed: true, roles, permissions };
}
