#!/usr/bin/env bash
# Levanta un Supabase local efímero (Postgres + Auth + PostgREST + Storage)
# y le aplica TODAS las migraciones de supabase/migrations/ en orden.
#
# La suite de tests corre contra esta base, nunca contra producción
# (hallazgos COD-07 / FN-02, auditoría 360 del 18-oct-2026).
#
# Uso:
#   bash scripts/test-db/start.sh          # levanta, migra y escribe .env.test
#   set -a; source .env.test; set +a; npm test
#   bash scripts/test-db/stop.sh           # apaga y borra la base
#
# Requiere: Supabase CLI y Docker. No usa ninguna credencial remota.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_ID="${ESMALIA_TEST_PROJECT_ID:-esmalia-test}"
WORKDIR="${ESMALIA_TEST_WORKDIR:-${TMPDIR:-/tmp}/esmalia-test-db}"
DB_CONTAINER="supabase_db_${PROJECT_ID}"
ENV_FILE="${ESMALIA_TEST_ENV_FILE:-$REPO_ROOT/.env.test}"
# CLI global si está instalado; si no, el de devDependencies (npm ci).
if command -v supabase >/dev/null 2>&1; then SUPABASE=supabase; else SUPABASE="$REPO_ROOT/node_modules/.bin/supabase"; fi

# Config propia en un workdir aparte: el supabase/config.toml del repo apunta
# al project_id de producción y `supabase start` aplicaría las migraciones en
# una transacción por archivo, lo que aborta con "unsafe use of new enum value"
# (ALTER TYPE ... ADD VALUE seguido de su uso). Las aplicamos abajo en
# autocommit, que es como se aplicaron en producción.
mkdir -p "$WORKDIR/supabase"
cat >"$WORKDIR/supabase/config.toml" <<EOF
project_id = "$PROJECT_ID"

[db]
major_version = 17

[db.migrations]
enabled = false

[db.seed]
enabled = false

[auth]
enable_signup = true

[auth.email]
enable_confirmations = false
EOF

echo "==> Levantando Supabase local ($PROJECT_ID)…"
# Solo lo que usan los tests: db, auth (gotrue), rest (postgrest), storage y kong.
"$SUPABASE" start --workdir "$WORKDIR" \
  -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,realtime,postgres-meta

psql_db() {
  docker exec -i "$DB_CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

echo "==> Fixtures previas a las migraciones…"
psql_db <"$REPO_ROOT/scripts/test-db/preseed.sql"

echo "==> Aplicando migraciones…"
count=0
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  if ! out=$(psql_db <"$f" 2>&1); then
    echo "Falló la migración $(basename "$f"):" >&2
    echo "$out" >&2
    exit 1
  fi
  count=$((count + 1))
done
echo "    $count migraciones aplicadas."

# PostgREST cachea el esquema al arrancar: lo recargamos con las tablas nuevas.
psql_db -c "NOTIFY pgrst, 'reload schema';"

status_env=$("$SUPABASE" status --workdir "$WORKDIR" -o env)
get() { echo "$status_env" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }

cat >"$ENV_FILE" <<EOF
# Generado por scripts/test-db/start.sh — base local efímera, NO producción.
PGHOST=127.0.0.1
PGPORT=54322
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=postgres
PGSSLMODE=disable
SUPABASE_URL=$(get API_URL)
SUPABASE_PUBLISHABLE_KEY=$(get ANON_KEY)
SUPABASE_SERVICE_ROLE_KEY=$(get SERVICE_ROLE_KEY)
EOF

if [ -n "${GITHUB_ENV:-}" ]; then
  grep -v '^#' "$ENV_FILE" >>"$GITHUB_ENV"
fi

echo "==> Listo. Variables en $ENV_FILE"
