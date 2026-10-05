# ECMS — Engineering & Construction Management System

## What it is

ECMS is a role-based web platform for **commercial project control in the construction industry**. Its core is an end-to-end, FIDIC/ERA-style **unit-price, re-measurement contract loop**: set up a project and contract, import the approved BOQ, record measured work, assemble interim payment certificates (IPCs), apply contract deductions, certify, and record payment — with a complete audit trail back to source data.

It is deliberately scoped as a **modular monolith**, not a full construction ERP and not a set of microservices.

## The commercial model it preserves

- The approved **BOQ** is the priced scope *and* the measurement coding structure. BOQ quantity is a baseline estimate, not automatically the payable quantity.
- **Field measurements** establish quantity actually executed; the engineer independently accepts the payable quantity.
- Each **IPC line** snapshots `Previous + This Period = To Date`; only the current certified amount enters that period's payment.
- **Provisional sums** become payable only through an authorized instruction/usage record.
- **Retention, advance recovery, VAT split, price adjustment, withholding tax, and other typed adjustments** each carry clause/rule lineage.
- Excel is an **import/export format only** — never live business logic. PostgreSQL records, versioned rules, and API calculations are the system of record.

## Core capabilities (MVP)

| Domain | Function |
|---|---|
| Tenancy & users | Multi-client; every record tenant- and project-scoped |
| Projects & parties | Employer, engineer, contractor, subcontractor, supplier, financier |
| Contract controls | Clauses and configurable numeric/date rules drive alerts and IPC math |
| BOQ & cost baseline | Versioned hierarchical BOQ: sections, items, quantities, rates, provisional sums, variations |
| Field measurements | Quantity records by BOQ item, date, location, chainage, with attachments and approval state |
| IPCs | Certificate workspace, line snapshots, adjustments, workflow, certification, payment record |
| Documents & drawings | Register, revision history, transmittals, OCR text, current-revision control |
| RFIs & inspections | Field-quality loop linked to drawings, BOQ items, locations, evidence |
| Procurement | Supplier master, PR → quote → PO → GRN → invoice → three-way match → supplier payment |
| Stores & materials | Warehouse/item master, material issue slips, immutable stock ledger, stock counts |
| Workforce & timesheets | Worker roster, attendance, approved timesheets, payroll batch, worker payment |
| Fraud controls | Segregation of duties, payment gates, duplicate checks, control exceptions, immutable decisions |
| AI findings | Advisory anomaly/duplicate/OCR findings with human review — no autonomous approval or payment block |
| Imports & exceptions | Staged import with row-level lineage, validation failures, reconciliation |
| Audit & notifications | Immutable state-change history and reliable outbox-driven notification jobs |
| Reporting | Dashboard, BOQ progress, IPC statement, payment history, exception list, source traceability |

## Roles & separation of authority

Roles are **project assignments, not global labels** (a user can be consultant QS on one project and viewer on another). Roles include tenant admin, employer PM, employer finance, engineer/consultant lead, quantity surveyor, site inspector, contractor PM, contractor QS, document controller, and auditor/viewer.

Permissions are atomic (e.g. `boq.manage`, `measurement.verify`, `ipc.certify`, `payment.record`, `audit.read`) and roles are permission bundles stored in PostgreSQL. Two operating chains coexist — the **employer chain** (employer → engineer → certification/payment) and the **contractor chain** (PM → site staff → crews/suppliers/workers) — and the system enforces that the contractor cannot certify its own IPC, a requester cannot approve their own demand, a receiver cannot purchase, a timesheet submitter cannot approve it, and a certifier cannot record the corresponding payment.

## AI assistant

An in-app project assistant answers questions strictly from retrieved tool data, scoped to the active project. It is explicitly forbidden from fabricating numbers and must surface permission restrictions rather than guess. It is advisory only; a human approves every contractual value.

## Tech stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Database:** PostgreSQL, with Prisma ORM for CRUD and raw SQL migrations for constraints, partial unique indexes, immutable-ledger triggers, payment gates, reporting views, and RLS helpers
- **Auth:** Better Auth (Prisma adapter); authenticated subject maps to `app_users.auth_subject`
- **Styling:** Tailwind CSS v4, custom dark-mode design system
- **Charts:** Recharts; **Icons:** Tabler Icons; **Validation:** Zod
- **AI:** OpenAI-compatible client (DeepSeek)
- **Testing:** Vitest

## Architecture

```
Web / tablet users → Next.js frontend → API (domain modules)
                                        ├── PostgreSQL (authoritative)
                                        ├── Object storage (files, drawings, photos, reports)
                                        └── Outbox jobs → background worker (imports, OCR, previews, notifications, reports)
```

Generated Prisma types are treated as **persistence types**, not the frontend API contract; explicit request/response schemas keep DB changes from leaking into screens.

## Application modules (navigation)

Overview · Cost & BOQ · Field · IPCs · Contract · Documents · Issues · Reports · Setup — plus procurement, stores, workforce, imports, and administration. The API exposes `/api/v1/*` endpoints for projects, contracts, BOQ versions, measurements, IPCs, variations, documents, issues, suppliers, requisitions, purchase orders, goods receipts, supplier invoices, material issues, stock counts, workers, timesheets, payroll, worker payments, imports, and AI.

## Database

The schema is defined by numbered SQL migrations in `db/migrations/` (the **single source of truth**, ~100+ tables) and mirrored manually in `prisma/schema.prisma`. Migrations cover the core MVP schema, Better Auth tables, IPC `paid_by`, triggers/RLS/seeds, and AI chat permissions.

## Demo data

The primary demo dataset is the **Jigjiga Bypass Road** — a 6.93 km FIDIC unit-price road contract (ERA employer, Yirgalem Construction contractor, ELDA/DAMRA engineer). Seeding creates a tenant, project, organizations, contract parties, an approved BOQ, contract rules for advance recovery and VAT withholding, and a stub IPC #1 draft. Demo accounts (PM, site supervisor, storekeeper) log in against `lib/data.ts` without a database.

## Explicitly out of scope (Phase 2)

Full Primavera/MS Project scheduling; full general ledger/accounting, tendering marketplace, fleet telematics, plant maintenance; BIM/IFC authoring; native mobile/offline apps; no-code workflow design; and AI as an autonomous contractual decision maker.
