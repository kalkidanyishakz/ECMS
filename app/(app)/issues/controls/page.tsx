import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { RunFindingsScanButton } from '@/components/controls/RunFindingsScanButton';
import { IconShieldCheck, IconRobot } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { dateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

function severityTone(severity: string): BadgeTone {
  if (severity === 'critical') return 'danger';
  if (severity === 'high') return 'warning';
  if (severity === 'medium') return 'info';
  return 'neutral';
}

function evidenceSummary(evidence: unknown): string {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return '';
  const entries = Object.entries(evidence as Record<string, unknown>)
    .filter(
      ([key, value]) =>
        key !== 'input' &&
        (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    )
    .slice(0, 3);
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ');
}

export default async function ControlsPage() {
  await requireAppUser();
  const { tenantId, projectId } = await getProjectContext();

  const [rules, evaluations, findings] = await Promise.all([
    db.control_rules.findMany({ where: { tenant_id: tenantId }, orderBy: { rule_key: 'asc' } }),
    db.control_evaluations.findMany({
      where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
      orderBy: { evaluated_at: 'desc' },
      take: 100,
      include: { control_rules: { select: { name: true, rule_key: true } } },
    }),
    db.ai_findings.findMany({
      where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
      orderBy: { created_at: 'desc' },
      take: 50,
    }),
  ]);

  const failures = evaluations.filter((e) => e.result === 'blocked' || e.result === 'warning').length;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Control Console" actions={<RunFindingsScanButton />} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5"><p className="text-sm text-ecms-muted">Active Controls</p><p className="mt-1 text-2xl font-bold text-ecms-text">{rules.filter((r) => r.is_active).length}</p></div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5"><p className="text-sm text-ecms-muted">Evaluations</p><p className="mt-1 text-2xl font-bold text-ecms-amber">{evaluations.length}</p></div>
        <div className="rounded-xl border border-ecms-border bg-ecms-card p-5"><p className="text-sm text-ecms-muted">Blocks / Warnings</p><p className="mt-1 text-2xl font-bold text-ecms-danger">{failures}</p></div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Control Rules" icon={<IconShieldCheck size={18} />}>
          {rules.length === 0 ? (
            <EmptyState title="No control rules" message="Payment-gate control rules are defined per tenant." />
          ) : (
            <Table>
              <THead><TH>Rule</TH><TH>Name</TH><TH>Enforcement</TH><TH>Subject</TH><TH>Status</TH></THead>
              <TBody>
                {rules.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium">{r.rule_key}</TD>
                    <TD>{r.name}</TD>
                    <TD><Badge tone={r.enforcement === 'hard' ? 'danger' : r.enforcement === 'soft' ? 'warning' : 'neutral'}>{r.enforcement}</Badge></TD>
                    <TD className="text-ecms-muted">{r.subject_type}</TD>
                    <TD><Badge tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'active' : 'inactive'}</Badge></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card title="Control Evaluations" icon={<IconShieldCheck size={18} />}>
          {evaluations.length === 0 ? (
            <EmptyState title="No evaluations" message="Control evaluation outcomes against attempted mutations appear here." />
          ) : (
            <Table>
              <THead><TH>Rule</TH><TH>Action</TH><TH>Result</TH><TH>Severity</TH><TH>When</TH></THead>
              <TBody>
                {evaluations.map((e) => (
                  <TR key={e.id}>
                    <TD className="text-ecms-muted">{e.control_rules.rule_key}</TD>
                    <TD>{e.action_attempted}</TD>
                    <TD><StatusPill status={e.result} /></TD>
                    <TD><Badge tone={e.severity === 'critical' ? 'danger' : e.severity === 'high' ? 'warning' : 'neutral'}>{e.severity}</Badge></TD>
                    <TD>{dateTime(e.evaluated_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <Card title="AI Findings" subtitle="Automated document and workflow analysis" icon={<IconRobot size={18} />}>
        {findings.length === 0 ? (
          <EmptyState title="No AI findings" message="Automated findings from document analysis and control reviews appear here." />
        ) : (
          <Table>
            <THead><TH>Type</TH><TH>Finding</TH><TH>Evidence</TH><TH>Severity</TH><TH>Status</TH><TH>Model</TH><TH>Created</TH></THead>
            <TBody>
              {findings.map((f) => {
                const summary = evidenceSummary(f.evidence);
                return (
                  <TR key={f.id} className="hover:bg-ecms-elevated/40 align-top">
                    <TD className="text-ecms-muted whitespace-nowrap">{f.finding_type}</TD>
                    <TD className="max-w-[320px]">
                      <p className="font-medium text-ecms-text">{f.title}</p>
                      <p className="mt-0.5 whitespace-normal text-xs text-ecms-muted">{f.explanation}</p>
                    </TD>
                    <TD className="max-w-[220px] whitespace-normal text-xs text-ecms-muted">{summary || '—'}</TD>
                    <TD><Badge tone={severityTone(f.severity)}>{f.severity}</Badge></TD>
                    <TD><StatusPill status={f.status} /></TD>
                    <TD className="text-ecms-muted">{f.model_name}</TD>
                    <TD className="whitespace-nowrap">{dateTime(f.created_at)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
