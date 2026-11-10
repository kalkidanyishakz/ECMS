import type { WorkerHandler } from '@/lib/worker';
import { generateFindings } from '@/lib/controls/findings';

/**
 * Handles `ai.findings_scan_requested` (payload `{ projectId: string }`).
 *
 * Runs the deterministic, rules-based findings generator for the project and
 * persists advisory rows into `ecms.ai_findings`. The scan is idempotent, so
 * worker retries do not create duplicate findings.
 */
export const handler: WorkerHandler = async (event, ctx) => {
  const payload = (event.payload ?? {}) as { projectId?: unknown };
  const payloadProjectId = typeof payload.projectId === 'string' ? payload.projectId : null;
  const projectId = payloadProjectId ?? (typeof event.project_id === 'string' ? event.project_id : null);

  if (!projectId) {
    throw new Error('ai.findings_scan_requested: missing projectId in payload');
  }

  await generateFindings(projectId, { db: ctx.db });
};
