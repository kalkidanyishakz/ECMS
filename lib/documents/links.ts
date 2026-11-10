import { db } from '@/lib/db';

/**
 * Page-level references between documents and other records.
 *
 * `createDocumentLink` writes the previously-unused `document_links` table
 * (forward: "page X of this revision references target Y"). The reverse side —
 * "which records point at this revision" — is answered by
 * `listDocumentBackreferences`, which walks every FK that targets
 * `document_revisions` (found in the schema: `measurement_lines.drawing_revision_id`,
 * `rfis.drawing_revision_id`, `contract_clauses.source_revision_id`, and the
 * `transmittal_items.revision_id` join table).
 */

export type CreateDocumentLinkInput = {
  projectId: string;
  revisionId: string;
  pageNumber?: number | null;
  targetType: string;
  targetId: string;
  relationType?: string;
  anchor?: Record<string, unknown>;
  createdBy?: string | null;
};

export type DocumentBackreference = {
  entityType: string;
  entityId: string;
  identifier: string;
  page: number | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export async function createDocumentLink(
  input: CreateDocumentLinkInput,
  opts: { db?: AnyClient } = {}
): Promise<{ id: string }> {
  const client: AnyClient = opts.db ?? db;
  return client.document_links.create({
    data: {
      project_id: input.projectId,
      revision_id: input.revisionId,
      page_number: input.pageNumber ?? null,
      target_type: input.targetType,
      target_id: input.targetId,
      relation_type: input.relationType ?? 'references',
      anchor: input.anchor ?? {},
      created_by: input.createdBy ?? null,
    },
    select: { id: true },
  });
}

type MeasurementLineRow = {
  id: string;
  line_number: number;
  drawing_page_number: number | null;
  measurements: { measurement_number: string } | null;
};

type RfiRow = {
  id: string;
  rfi_number: string;
  drawing_page_number: number | null;
};

type ContractClauseRow = {
  id: string;
  clause_number: string;
  source_page_number: number | null;
};

type TransmittalItemRow = {
  transmittal_id: string;
  transmittals: { transmittal_number: string } | null;
};

/** Reverse lookup: records that reference the given document revision. */
export async function listDocumentBackreferences(
  revisionId: string,
  opts: { db?: AnyClient } = {}
): Promise<DocumentBackreference[]> {
  const client: AnyClient = opts.db ?? db;

  const [measurementLines, rfis, clauses, transmittalItems] = await Promise.all([
    client.measurement_lines.findMany({
      where: { drawing_revision_id: revisionId },
      select: {
        id: true,
        line_number: true,
        drawing_page_number: true,
        measurements: { select: { measurement_number: true } },
      },
    }) as Promise<MeasurementLineRow[]>,
    client.rfis.findMany({
      where: { drawing_revision_id: revisionId },
      select: { id: true, rfi_number: true, drawing_page_number: true },
    }) as Promise<RfiRow[]>,
    client.contract_clauses.findMany({
      where: { source_revision_id: revisionId },
      select: { id: true, clause_number: true, source_page_number: true },
    }) as Promise<ContractClauseRow[]>,
    client.transmittal_items.findMany({
      where: { revision_id: revisionId },
      select: { transmittal_id: true, transmittals: { select: { transmittal_number: true } } },
    }) as Promise<TransmittalItemRow[]>,
  ]);

  const backreferences: DocumentBackreference[] = [];

  for (const line of measurementLines) {
    const number = line.measurements?.measurement_number ?? 'Measurement';
    backreferences.push({
      entityType: 'measurement_line',
      entityId: line.id,
      identifier: `${number} · line ${line.line_number}`,
      page: line.drawing_page_number,
    });
  }

  for (const rfi of rfis) {
    backreferences.push({
      entityType: 'rfi',
      entityId: rfi.id,
      identifier: rfi.rfi_number,
      page: rfi.drawing_page_number,
    });
  }

  for (const clause of clauses) {
    backreferences.push({
      entityType: 'contract_clause',
      entityId: clause.id,
      identifier: clause.clause_number,
      page: clause.source_page_number,
    });
  }

  for (const item of transmittalItems) {
    backreferences.push({
      entityType: 'transmittal',
      entityId: item.transmittal_id,
      identifier: item.transmittals?.transmittal_number ?? 'Transmittal',
      page: null,
    });
  }

  return backreferences;
}
