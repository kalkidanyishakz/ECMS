# ECMS - Engineering & Construction Management System

A modern, role-based web application tailored for the construction industry. Designed for control and engineered for efficiency, ECMS allows teams to track projects, manage construction planning, monitor budgets, handle site inventory, and streamline document management.

## Features

- **Role-Based Access Control:** Secure authentication powered by [Better Auth](https://www.better-auth.com/) with the Prisma adapter. Access and functionality are dynamically scoped by project-assigned roles.
- **Executive Dashboard:** Live KPI cards for active projects, budget tracking, completion rates, and recent notifications across the site.
- **Project Management:** Project registry with detailed profile cards, contract data, and a milestone tracker for granular timelines.
- **Planning & Progress:** High-level Gantt charts paired with S-Curve analysis. Allows site teams to submit daily progress reports directly.
- **Cost Control:** Budget vs. Actual tracking down to specific cost codes (Substructure, Superstructure, Masonry, etc.) with automated warnings.
- **Material & Warehouse:** Track site inventory in real-time and handle material requests with low-stock alerts.
- **Document Management:** Centralized drawing register that enforces version control and locks superseded drawings automatically.
- **Background Outbox Worker:** Durable, retrying job queue that delivers notifications, document OCR, and AI findings scans.
- **Document OCR & Page Search:** Offline text extraction into per-page records, with page previews, back-references, and page-level search.
- **AI Findings:** Deterministic, advisory rules that flag duplicate supplier payments, BOQ overruns, three-way-match breaks, and blocked controls.
- **Measurement Attachments:** Evidence files attached to a measurement or to an individual measurement line.

## Tech Stack

- **Framework:** [Next.js 16](https://nextjs.org/) (App Router)
- **Database:** [PostgreSQL](https://www.postgresql.org/) via [Prisma](https://www.prisma.io/) ORM
- **Styling:** [Tailwind CSS](https://tailwindcss.com/) with a fully custom dark-mode design system
- **Authentication:** [Better Auth](https://www.better-auth.com/) with Prisma adapter
- **Icons:** [Tabler Icons React](https://tabler.io/icons)
- **Language:** TypeScript

## Getting Started

First, run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Database Setup

`db/migrations/` is the **single source of truth** for the database schema. Migrations run in numeric order via:

```bash
npm run db:migrate
```

This executes `psql` against the `ecms` database, applying:
1. `0001_ecms_mvp_schema.sql` — core application tables
2. `0002_better_auth.sql` — Better Auth tables
3. `0003_ecms_ipc_paid_by.sql` — IPC paid_by column
4. `0004_triggers_rls_seeds.sql` — Database triggers and RLS policies
5. `0005_ai_chat_permission.sql` - `ai_chat.use` permission and role grants
6. `0006_worker_idempotency.sql` - idempotency keys for the outbox/worker foundation

The Docker entrypoint applies every `*.sql` file in `db/migrations/` in filename order and records each in `ecms._ecms_migrations`, so migrations are skipped once applied.

`prisma/schema.prisma` is kept in sync with these SQL files **manually** (not via `prisma migrate`). When you change the schema, update both the Prisma file and the corresponding SQL migration.

### Seeding the Jigjiga Demo Project

The primary demo dataset is the **Jigjiga Bypass Road** — a 6.93 km road contract (FIDIC unit-price, ERA employer, Yirgalem Construction contractor, ELDA/DAMRA engineer).

```bash
npm run db:seed:jigjiga
```

This creates: a tenant, the project, three organizations, a contract with contract_parties, an approved BOQ (from CSV), contract_rules for advance recovery and VAT withholding, and a stub IPC #1 draft.

**Two placeholder files must be replaced with real data before the demo is final:**

| File | Format | What to supply |
|------|--------|---------------|
| `db/seed-data/jigjiga-boq.csv` | `item_number,source_code,description,unit,original_quantity,rate,section_code,section_title` | Real BOQ line items, quantities, and rates |
| `db/seed-data/jigjiga-ipc1.json` | `{ period_start, period_end, items: [{ item_number, current_quantity }] }` | Real IPC #1 accepted quantities per BOQ item |

The seed script is idempotent — safe to re-run after replacing the data files. After seeding, use `POST /api/v1/ipcs/:id/calculate` to compute IPC #1 figures from the measurement data.

### Demo Accounts

Demo users are seeded into PostgreSQL by `db/seed-demo-users.ts`, which creates Better Auth credentials and links them to application records (`app_users`, tenant memberships, tenant roles, project members, and project roles). The Docker entrypoint runs this script after `db/seed-jigjiga.ts`, so a database is required to log in. Every demo account uses the password `demo1234`:

- **Project Manager:** `pm@ecms.app` (tenant admin, employer PM)
- **Site Supervisor:** `supervisor@ecms.app` (quantity surveyor, site inspector)
- **Storekeeper:** `store@ecms.app` (storekeeper, procurement officer)
- **Finance Officer:** `finance@ecms.app` (finance)

### Background Jobs & Automation

Work that should not block a request is written to a durable outbox and dispatched by a worker that claims rows with `FOR UPDATE SKIP LOCKED`, retries with exponential backoff, and dead-letters after repeated failures.

- **Outbox worker (`lib/outbox.ts`, `lib/worker/`, `scripts/worker.ts`):** `npm run worker` polls the outbox every `WORKER_POLL_MS` (default 5000) and can be run as `npm run worker -- --once` to drain a single batch and exit. `POST /api/v1/worker/tick` runs one batch on demand and requires the `audit.read` permission. Registered event handlers are `notification.dispatch`, `document.ocr_requested`, and `ai.findings_scan_requested`. Notifications are enqueued through the outbox and delivered to the in-app inbox by `notification.dispatch`; there is no email or SMS channel.
- **Document OCR, page previews, and search (`lib/documents/extract.ts`, `lib/documents/ocr.ts`, `runDocumentOcr`):** uploaded files are classified and extracted into `document_pages`. Text, CSV, JSON, YAML, and XLSX files are extracted with status `completed`; images and PDFs are truthfully reported as `partial` because no offline OCR engine is bundled; unsupported types are `failed`. Pages are read through `GET /api/v1/documents/:id/pages?q=`, and the document page renders a pages card plus a "Referenced by" list. Backfill existing revisions with `npm run ocr:backfill`, then tick the worker.
- **AI findings (`lib/controls/findings.ts`):** a deterministic, advisory rules scan that writes findings with `model_provider: 'ecms-rules'` and no model call. Rules cover duplicate supplier payments, BOQ quantities measured beyond or approaching the approved quantity, three-way-match breaks, and blocked or warning control evaluations. Trigger it from the Control Console ("Run AI scan"), `POST /api/v1/controls/findings/scan` (add `?sync=1` to run inline instead of queueing), or `npm run findings:scan [projectId]`. The route requires `audit.read`, and findings are advisory only.
- **Measurement attachments (`record_attachments`):** evidence files attach to a measurement or one of its lines through `POST` and `GET /api/v1/measurements/:id/attachments`, with a matching attachments card on the measurement page.

### NPM Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Production build |
| `npm run test` | Run the Vitest suite |
| `npm run db:migrate` | Apply migrations `0001` through `0006` |
| `npm run db:seed:jigjiga` | Seed the Jigjiga demo project |
| `npm run ocr:backfill` | Enqueue OCR for revisions that have no pages yet |
| `npm run worker` | Run the outbox worker (`-- --once` for a single batch) |
| `npm run findings:scan` | Run the deterministic AI findings scan |

Demo users are seeded by `db/seed-demo-users.ts`, which the Docker entrypoint runs after `db/seed-jigjiga.ts`; it is not exposed as an npm script.

## Project Structure

- `/app`: Next.js App Router endpoints, including layout shell and pages.
- `/components`: Reusable UI components (`Logo`, `StatusPill`, `ProgressBar`, etc.) and Layout elements (`Sidebar`, `Topbar`).
- `/lib`: Domain helpers for auth, database, storage, outbox worker, document extraction, control findings, and formatting.
- `/middleware.ts`: Secures routes globally and enforces role-based redirections.
