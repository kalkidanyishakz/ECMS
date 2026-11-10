import { db as defaultDb } from '@/lib/db';
import {
  detectBlockedControls,
  detectBoqOverruns,
  detectDuplicateSupplierPayments,
  detectThreeWayMatchBreaks,
} from './findings-rules';
import { existingFindingKeys, prepareFindings, type FindingDraft } from './findings-types';
import { loadProjectFindingsSource } from './findings-queries';

export type GenerateFindingsResult = {
  created: number;
  skipped: number;
  findings: FindingDraft[];
};

export type GenerateFindingsOptions = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
};

/**
 * Load the project's source rows, run every deterministic rule, and persist the
 * resulting advisory findings into `ecms.ai_findings`.
 *
 * Idempotency: a draft is skipped when an `ai_findings` row already exists with
 * the same finding_type + subject_type + subject_id + input_snapshot_hash and a
 * non-terminal status (terminal statuses have no `resolved` value in the enum,
 * so `dismissed` and `converted_to_issue` are treated as resolved).
 */
export async function generateFindings(
  projectId: string,
  opts: GenerateFindingsOptions = {}
): Promise<GenerateFindingsResult> {
  const db = opts.db ?? defaultDb;
  const source = await loadProjectFindingsSource(projectId, db);

  const drafts = [
    ...detectDuplicateSupplierPayments(source.paymentRows),
    ...detectBoqOverruns(source.boqRows),
    ...detectThreeWayMatchBreaks(source.matchRows),
    ...detectBlockedControls(source.evaluationRows),
  ];

  const { prepared, skipped } = prepareFindings(drafts, existingFindingKeys(source.existing));

  for (const { draft, inputSnapshotHash } of prepared) {
    await db.ai_findings.create({
      data: {
        project_id: projectId,
        finding_type: draft.findingType,
        subject_type: draft.subjectType,
        subject_id: draft.subjectId,
        severity: draft.severity,
        score: draft.score,
        title: draft.title,
        explanation: draft.explanation,
        evidence: draft.evidence,
        model_provider: 'ecms-rules',
        model_name: draft.modelName,
        model_version: 'v1',
        prompt_version: null,
        input_snapshot_hash: inputSnapshotHash,
        status: 'open',
      },
    });
  }

  return { created: prepared.length, skipped, findings: prepared.map((entry) => entry.draft) };
}
