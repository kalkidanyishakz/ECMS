#!/usr/bin/env bash
set -euo pipefail

PGHOST="${PGHOST:-db}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-ecms}"
export PGHOST PGPORT PGUSER PGDATABASE

echo "[entrypoint] waiting for postgres at ${PGHOST}:${PGPORT} ..."
until pg_isready -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -q; do
  sleep 1
done
echo "[entrypoint] postgres is ready"

psql -v ON_ERROR_STOP=1 -q -c "CREATE SCHEMA IF NOT EXISTS ecms;"
psql -v ON_ERROR_STOP=1 -q -c "CREATE TABLE IF NOT EXISTS ecms._ecms_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"

MIGRATIONS_DIR="/app/db/migrations"
shopt -s nullglob
for migration in "${MIGRATIONS_DIR}"/*.sql; do
  filename="$(basename "${migration}")"
  applied="$(psql -tAc "SELECT 1 FROM ecms._ecms_migrations WHERE filename = '${filename}'")"
  if [ "${applied}" = "1" ]; then
    echo "[entrypoint] migration ${filename} already applied, skipping"
    continue
  fi
  echo "[entrypoint] applying migration ${filename}"
  psql -v ON_ERROR_STOP=1 -q -f "${migration}"
  psql -v ON_ERROR_STOP=1 -q -c "INSERT INTO ecms._ecms_migrations (filename) VALUES ('${filename}');"
done

echo "[entrypoint] seeding jigjiga demo project"
./node_modules/.bin/tsx db/seed-jigjiga.ts

echo "[entrypoint] seeding demo users"
./node_modules/.bin/tsx db/seed-demo-users.ts

echo "[entrypoint] enriching demo data (dashboard + AI assistant)"
./node_modules/.bin/tsx db/seed-demo-data.ts

echo "[entrypoint] starting application: $*"
exec "$@"
