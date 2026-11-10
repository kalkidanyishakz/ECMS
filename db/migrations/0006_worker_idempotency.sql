-- Migration 0006: create ecms.idempotency_keys
--
-- The `idempotency_keys` model has been present in prisma/schema.prisma since the
-- outbox/worker foundation but was never emitted as SQL (known drift: the table
-- is modeled in Prisma yet missing from 0001-0005). This migration closes that
-- gap so a database built purely from db/migrations matches the Prisma client.
--
-- Idempotent: safe to run repeatedly and after migrations 0001-0005.

BEGIN;

SET search_path TO ecms, public;

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key             text PRIMARY KEY,
    status          text NOT NULL DEFAULT 'processing',
    request_hash    text,
    response_data   jsonb,
    completed_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_idempotency_keys_created
    ON idempotency_keys (created_at);

COMMIT;
