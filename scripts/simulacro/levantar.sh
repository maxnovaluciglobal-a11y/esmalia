#!/usr/bin/env bash
# Levanta un Supabase local efímero (db, auth, rest, storage, kong) con todas
# las migraciones aplicadas, para el simulacro de restauración y su backup de
# juguete. Es scripts/test-db/start.sh con puertos y project_id propios, para
# poder correr al lado de la base de tests (o de otro Supabase local) sin chocar.
#
# Uso: levantar.sh <workdir> <project_id> <puerto base>
#   API = puerto + 1, DB = puerto + 2, shadow = puerto + 3
# Deja en <workdir>:
#   supabase.env       SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de la base local
#   migraciones.json   { ok, fallidas: [archivo] }
# Se apaga con: supabase stop --workdir <workdir> --no-backup --project-id <project_id>
set -uo pipefail

WORKDIR="${1:?Uso: levantar.sh <workdir> <project_id> <puerto>}"
PROJECT_ID="${2:?Falta project_id}"
PUERTO="${3:?Falta el puerto base}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_CONTAINER="supabase_db_${PROJECT_ID}"
if command -v supabase >/dev/null 2>&1; then SUPABASE=supabase; else SUPABASE="$REPO_DIR/node_modules/.bin/supabase"; fi

psql_db() { docker exec -i "$DB_CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

mkdir -p "$WORKDIR/supabase"
# Config propia: el supabase/config.toml del repo apunta al proyecto de
# producción, y `supabase start` aplicaría las migraciones en una transacción
# por archivo (aborta con "unsafe use of new enum value"). Van abajo, en autocommit.
cat >"$WORKDIR/supabase/config.toml" <<EOF
project_id = "$PROJECT_ID"

[api]
port = $((PUERTO + 1))

[db]
port = $((PUERTO + 2))
shadow_port = $((PUERTO + 3))
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

if ! "$SUPABASE" start --workdir "$WORKDIR" \
  -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,realtime,postgres-meta >"$WORKDIR/start.log" 2>&1; then
  tail -20 "$WORKDIR/start.log" >&2
  echo "::error::No levantó el Supabase efímero ($PROJECT_ID)." >&2
  exit 1
fi

# Lo que en producción existe desde antes de las migraciones (cuenta demo y privilegios clásicos).
psql_db <"$REPO_DIR/scripts/test-db/preseed.sql" >/dev/null || { echo "::error::Falló preseed.sql" >&2; exit 1; }
# preseed.sql inserta la cuenta demo a mano, con los tokens en NULL. GoTrue
# (listUsers, getUserById) no sabe leer NULL en esas columnas y responde un
# error vacío; un usuario creado por GoTrue, como en producción, tiene ''.
psql_db >/dev/null <<'SQL' || { echo "::error::No se pudo normalizar la cuenta demo" >&2; exit 1; }
UPDATE auth.users SET
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  email_change = coalesce(email_change, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  reauthentication_token = coalesce(reauthentication_token, '')
WHERE id = '139dd209-8495-415c-b6cd-6bbc63367bad';
SQL

# Una por una y en autocommit, como se aplicaron en producción (docs/BACKUPS.md).
mig_ok=0
fallidas=()
for f in "$REPO_DIR"/supabase/migrations/*.sql; do
  if psql_db <"$f" >"$WORKDIR/mig.out" 2>&1; then
    mig_ok=$((mig_ok + 1))
  else
    fallidas+=("$(basename "$f")")
    # El error de una migración es esquema, no datos: se puede mostrar.
    echo "  falló $(basename "$f"): $(grep -m1 -o 'ERROR:.*' "$WORKDIR/mig.out")" >&2
  fi
done
rm -f "$WORKDIR/mig.out"
node -e 'const [ok, ...f] = process.argv.slice(1); console.log(JSON.stringify({ ok: Number(ok), fallidas: f }))' \
  "$mig_ok" "${fallidas[@]+"${fallidas[@]}"}" >"$WORKDIR/migraciones.json"
psql_db -c "NOTIFY pgrst, 'reload schema';" >/dev/null
echo "  $mig_ok migraciones aplicadas, ${#fallidas[@]} con error"

status_env=$("$SUPABASE" status --workdir "$WORKDIR" -o env 2>/dev/null)
get() { echo "$status_env" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }
{
  echo "SUPABASE_URL=$(get API_URL)"
  echo "SUPABASE_SERVICE_ROLE_KEY=$(get SERVICE_ROLE_KEY)"
} >"$WORKDIR/supabase.env"
chmod 600 "$WORKDIR/supabase.env"
