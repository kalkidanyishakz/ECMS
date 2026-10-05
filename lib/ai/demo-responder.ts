import { writeAudit } from '@/lib/audit';
import {
  projectSummary,
  boqStatus,
  ipcStatus,
  procurementStatus,
  workforceStatus,
  recentActivity,
  TOOL_FRIENDLY_NAMES,
} from './tools';

type PermissionDenied = { allowed?: boolean; restricted?: boolean; reason?: string };

interface SummaryResult {
  name: string;
  projectCode: string;
  scopeChainage: string;
  contractValue: number;
  currency: string;
  physicalProgressPercent: number;
  timeElapsedPercent: number;
  employerName: string;
  contractorName: string;
  engineerName: string;
}

interface BoqItem {
  itemNumber?: string;
  sourceCode?: string;
  description?: string;
  unit?: string;
  approvedQuantity: number;
  percentComplete: number;
  isOverrun: boolean;
}

interface BoqResult {
  totalItems: number;
  over90PercentCount: number;
  overrunCount: number;
  items: BoqItem[];
}

interface IpcEntry {
  ipcNumber: string | number;
  status: string;
  workAmount: number;
  netAmount: number;
  currency: string;
}

interface IpcInProgress {
  ipcNumber: string | number;
  status: string;
  isCalculated: boolean;
}

interface IpcResult {
  totalIpcs: number;
  ipcs: IpcEntry[];
  currentInProgressIpc: IpcInProgress | null;
}

interface OpenReq {
  requisitionNumber: string;
  title?: string;
  status: string;
}

interface OpenPo {
  poNumber: string;
  status: string;
  totalAmount: number;
  currency: string;
}

interface Material {
  code: string;
  name: string;
  unit: string;
  totalQuantity: number;
  totalValue: number;
}

interface ProcResult {
  requisitionsSummary: {
    totalCount: number;
    countsByStatus: Record<string, number>;
    openRequisitions: OpenReq[];
  };
  purchaseOrdersSummary: {
    totalCount: number;
    countsByStatus: Record<string, number>;
    openPurchaseOrders: OpenPo[];
  };
  topMaterialsByValue: Material[];
}

interface WorkResult {
  roster: { totalCount: number; activeCount: number };
  latestTimesheet: { timesheetNumber: string; status: string } | null;
  latestPayrollBatch: {
    payrollNumber: string;
    status: string;
    grossAmount: number;
    netAmount: number;
    currency: string;
  } | null;
}

interface ActivityResult {
  events: Array<{ summary: string }>;
}

type ToolFn = (
  projectId: string,
  userId: string,
  args: Record<string, unknown>,
  dbClient: unknown
) => Promise<unknown>;

/**
 * A DeepSeek key is only "usable" when it is present and not the documented
 * placeholder shipped in .env.example/docker-compose. When absent we answer from
 * the local database instead of surfacing an upstream 401 to the demo audience.
 */
export function hasUsableDeepSeekKey(): boolean {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) return false;
  if (/your-deepseek-api-key-here/i.test(key)) return false;
  if (key.toLowerCase() === 'missing-api-key') return false;
  return true;
}

function money(value: number, currency?: string): string {
  const amount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0);
  return `${currency || 'ETB'} ${amount}`;
}

function truncate(text: string | undefined, max: number): string {
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts || {});
  if (entries.length === 0) return 'none';
  return entries.map(([status, count]) => `${status}: ${count}`).join(', ');
}

function deniedReason(result: PermissionDenied): string | null {
  if (result && result.allowed === false) {
    return result.reason || 'Your account does not have permission for this insight.';
  }
  return null;
}

function formatSummary(r: SummaryResult): string[] {
  return [
    `Project: ${r.name} (${r.projectCode})`,
    `Scope: ${r.scopeChainage}`,
    `Contract value: ${money(r.contractValue, r.currency)}`,
    `Physical progress: ${r.physicalProgressPercent}%  |  Time elapsed: ${r.timeElapsedPercent}%`,
    `Employer: ${r.employerName} · Contractor: ${r.contractorName} · Engineer: ${r.engineerName}`,
  ];
}

function formatBoq(r: BoqResult): string[] {
  const lines = [
    `BOQ items: ${r.totalItems}  |  at/over 90% complete: ${r.over90PercentCount}  |  overrun: ${r.overrunCount}`,
  ];
  const highlight = [...(r.items || [])]
    .sort((a, b) => b.percentComplete - a.percentComplete)
    .slice(0, 5);
  if (highlight.length > 0) {
    lines.push('Most advanced items:');
    for (const item of highlight) {
      const overrun = item.isOverrun ? ' (OVERRUN)' : '';
      lines.push(
        `• ${item.itemNumber || item.sourceCode || '—'} ${truncate(item.description, 64)} — ${item.percentComplete}% of ${item.approvedQuantity} ${item.unit || ''}${overrun}`
      );
    }
  }
  return lines;
}

function formatIpc(r: IpcResult): string[] {
  const lines = [`Interim Payment Certificates: ${r.totalIpcs}`];
  for (const ipc of (r.ipcs || []).slice(0, 6)) {
    lines.push(
      `• IPC #${ipc.ipcNumber} — ${ipc.status} · work ${money(ipc.workAmount, ipc.currency)} · net ${money(ipc.netAmount, ipc.currency)}`
    );
  }
  if (r.currentInProgressIpc) {
    lines.push(
      `Current in-progress: IPC #${r.currentInProgressIpc.ipcNumber} (${r.currentInProgressIpc.status})${r.currentInProgressIpc.isCalculated ? '' : ' — not yet calculated'}`
    );
  }
  return lines;
}

function formatProcurement(r: ProcResult): string[] {
  const lines: string[] = [];
  const reqs = r.requisitionsSummary;
  lines.push(`Purchase requisitions: ${reqs.totalCount} (${formatCounts(reqs.countsByStatus)})`);
  for (const req of (reqs.openRequisitions || []).slice(0, 4)) {
    lines.push(`• ${req.requisitionNumber} — ${truncate(req.title, 54)} (${req.status})`);
  }
  const pos = r.purchaseOrdersSummary;
  lines.push(`Purchase orders: ${pos.totalCount} (${formatCounts(pos.countsByStatus)})`);
  for (const po of (pos.openPurchaseOrders || []).slice(0, 4)) {
    lines.push(`• ${po.poNumber} — ${po.status} · ${money(po.totalAmount, po.currency)}`);
  }
  if ((r.topMaterialsByValue || []).length > 0) {
    lines.push('Top stock materials by value:');
    for (const mat of r.topMaterialsByValue) {
      lines.push(`• ${mat.code} ${mat.name} — ${mat.totalQuantity} ${mat.unit} · ${money(mat.totalValue)}`);
    }
  }
  return lines;
}

function formatWorkforce(r: WorkResult): string[] {
  const lines = [`Workers on roster: ${r.roster.totalCount} (active: ${r.roster.activeCount})`];
  lines.push(
    r.latestTimesheet
      ? `Latest timesheet: ${r.latestTimesheet.timesheetNumber} (${r.latestTimesheet.status})`
      : 'Timesheets: none recorded yet'
  );
  lines.push(
    r.latestPayrollBatch
      ? `Latest payroll batch: ${r.latestPayrollBatch.payrollNumber} (${r.latestPayrollBatch.status}) · gross ${money(r.latestPayrollBatch.grossAmount, r.latestPayrollBatch.currency)} · net ${money(r.latestPayrollBatch.netAmount, r.latestPayrollBatch.currency)}`
      : 'Payroll batches: none recorded yet'
  );
  return lines;
}

/**
 * Answer a demo question using the same permission-checked tools the live AI
 * would call, then render their JSON into readable plain text.
 */
export async function generateDemoReply(
  projectId: string,
  userId: string,
  question: string,
  dbClient: unknown
): Promise<{ content: string; toolNames: string[] }> {
  const q = question.toLowerCase();
  const selected: Array<{ name: string; fn: ToolFn; args: Record<string, unknown> }> = [];

  if (/(summary|progress|overview|contract value|project value|how is the project|project status|physical|elapsed)/.test(q)) {
    selected.push({ name: 'get_project_summary', fn: projectSummary.run as unknown as ToolFn, args: {} });
  }
  if (/(overrun|boq|bill of quantities|quantity|90%|percent complete|item)/.test(q)) {
    selected.push({ name: 'get_boq_status', fn: boqStatus.run as unknown as ToolFn, args: {} });
  }
  if (/(ipc|payment|certificate|retention|interim)/.test(q)) {
    selected.push({ name: 'get_ipc_status', fn: ipcStatus.run as unknown as ToolFn, args: {} });
  }
  if (/(stock|material|inventory|procurement|requisition|purchase|supplier)/.test(q)) {
    selected.push({ name: 'get_procurement_status', fn: procurementStatus.run as unknown as ToolFn, args: { topN: 5 } });
  }
  if (/(workforce|worker|labour|labor|timesheet|payroll|attendance)/.test(q)) {
    selected.push({ name: 'get_workforce_status', fn: workforceStatus.run as unknown as ToolFn, args: {} });
  }
  if (/(activity|recent|history|audit|what happened|latest)/.test(q)) {
    selected.push({ name: 'get_recent_activity', fn: recentActivity.run as unknown as ToolFn, args: { limit: 6 } });
  }

  if (selected.length === 0) {
    selected.push({ name: 'get_project_summary', fn: projectSummary.run as unknown as ToolFn, args: {} });
  }

  const toolNames: string[] = [];
  const sections: string[] = [];

  for (const tool of selected) {
    toolNames.push(tool.name);
    let result: unknown;
    try {
      result = await tool.fn(projectId, userId, tool.args, dbClient);
    } catch {
      sections.push('I could not retrieve that insight right now. Please try again.');
      continue;
    }

    const denied = deniedReason(result as PermissionDenied);
    if (denied) {
      sections.push(denied);
      continue;
    }

    switch (tool.name) {
      case 'get_project_summary':
        sections.push(formatSummary(result as unknown as SummaryResult).join('\n'));
        break;
      case 'get_boq_status':
        sections.push(formatBoq(result as unknown as BoqResult).join('\n'));
        break;
      case 'get_ipc_status':
        sections.push(formatIpc(result as unknown as IpcResult).join('\n'));
        break;
      case 'get_procurement_status':
        sections.push(formatProcurement(result as unknown as ProcResult).join('\n'));
        break;
      case 'get_workforce_status':
        sections.push(formatWorkforce(result as unknown as WorkResult).join('\n'));
        break;
      case 'get_recent_activity': {
        const activity = result as unknown as ActivityResult;
        const lines = (activity.events || []).map((evt) => `• ${evt.summary}`);
        sections.push(lines.length > 0 ? lines.join('\n') : 'No recent activity recorded yet.');
        break;
      }
      default:
        sections.push(JSON.stringify(result));
    }
  }

  if (sections.length === 0) {
    sections.push('I could not find an answer for that. Try asking about project progress, BOQ, IPCs, procurement, or workforce.');
  }

  return { content: sections.join('\n\n'), toolNames };
}

/**
 * Emit the assistant's answer over the same NDJSON wire format used by the live
 * DeepSeek path, so the ChatWidget renders it identically (tool traces + text).
 */
export async function streamDemoChat(
  projectId: string,
  userId: string,
  tenantId: string,
  messages: Array<{ role: string; content?: unknown }>,
  dbClient: unknown
): Promise<Response> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const question = typeof lastUser?.content === 'string' ? lastUser.content : '';

  const { content, toolNames } = await generateDemoReply(projectId, userId, question, dbClient);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const name of toolNames) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: 'tool_call',
              name,
              label: TOOL_FRIENDLY_NAMES[name] || name,
            }) + '\n'
          )
        );
      }
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'content', delta: content }) + '\n'));
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'done' }) + '\n'));
      controller.close();
    },
  });

  await writeAudit({
    tenantId,
    projectId,
    actorUserId: userId,
    action: 'AI_CHAT_QUERY',
    entityType: 'ai_chat',
    metadata: {
      userQuestion: question.slice(0, 200),
      toolsCalled: toolNames,
      mode: 'offline_demo',
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
