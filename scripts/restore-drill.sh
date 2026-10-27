#!/usr/bin/env bash
# Ensayo de restauración LOCAL de un backup de Esmalia.
#
# Levanta un Postgres 16 descartable, le pone los objetos mínimos de
# Supabase que las migraciones esperan (roles, auth, storage, vault,
# extensions), corre TODAS las migraciones de supabase/migrations/, carga
# el backup y verifica conteos + integridad referencial. Al final apaga el
# Postgres y BORRA el directorio de trabajo (tiene datos de pacientes).
#
# Nunca toca producción ni la red: solo lee el .age local y la clave.
# Nunca imprime datos: solo nombres de tabla y conteos.
#
# Uso:
#   scripts/restore-drill.sh <backup.json.gz.age> <clave-age> [storage.tar.gz.age]
#
# Variables opcionales:
#   WORKDIR     directorio de trabajo (default: mktemp). Se crea vacío y se borra.
#   PGBIN       binarios de Postgres 16 (default: /opt/homebrew/opt/postgresql@16/bin)
#   PGPORT      puerto (default: 55432)
#   MIGRATIONS  carpeta de migraciones (default: supabase/migrations del repo)
#   KEEP=1      no borrar WORKDIR ni apagar Postgres al terminar (¡datos reales!)
set -uo pipefail
# macOS: sin un locale válido el postmaster aborta con "became multithreaded during startup".
export LC_ALL="${LC_ALL:-en_US.UTF-8}" LANG="${LANG:-en_US.UTF-8}"

BACKUP="${1:?Uso: restore-drill.sh <backup.json.gz.age> <clave-age> [storage.tar.gz.age]}"
KEY="${2:?Falta la clave privada age}"
STORAGE_BACKUP="${3:-}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
PGPORT="${PGPORT:-55432}"
MIGRATIONS="${MIGRATIONS:-$REPO_DIR/supabase/migrations}"
WORKDIR="${WORKDIR:-$(mktemp -d "${TMPDIR:-/tmp}/restore-drill.XXXXXX")}"
MARKER=".restore-drill-workdir"

now() { perl -MTime::HiRes=time -e 'printf "%.2f\n", time'; }
elapsed() { perl -e "printf '%.1f', $2 - $1"; }
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# --- Directorio de trabajo: o no existe, o está vacío, o lo creamos nosotros.
if [ -e "$WORKDIR" ] && [ -n "$(ls -A "$WORKDIR" 2>/dev/null)" ] && [ ! -f "$WORKDIR/$MARKER" ]; then
  echo "WORKDIR '$WORKDIR' existe y no es de un ensayo anterior; no lo toco." >&2
  exit 2
fi
mkdir -p "$WORKDIR" && touch "$WORKDIR/$MARKER" && chmod 700 "$WORKDIR"
PGDATA="$WORKDIR/pgdata"
JSON="$WORKDIR/backup.json"
PSQL=("$PGBIN/psql" -X -q -h localhost -p "$PGPORT" -U postgres -d restore)

cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    log "KEEP=1: Postgres sigue en :$PGPORT y $WORKDIR NO se borró (contiene datos reales)."
    return
  fi
  [ -f "$PGDATA/postmaster.pid" ] && "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1
  # Solo se borra un directorio que este script marcó como propio.
  if [ -f "$WORKDIR/$MARKER" ]; then rm -rf "$WORKDIR"; log "Postgres detenido y $WORKDIR borrado."; fi
}
trap cleanup EXIT

T0=$(now)
declare -a TIMINGS=()

# ---------------------------------------------------------------- 1. descifrar
t=$(now)
log "1/5 Descifrando $(basename "$BACKUP")"
if ! age -d -i "$KEY" "$BACKUP" | gunzip > "$JSON"; then
  echo "No se pudo descifrar/descomprimir el backup." >&2; exit 1
fi
node -e '
  const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const t = Object.entries(d.tables);
  const total = t.reduce((s, [, r]) => s + r.length, 0);
  console.log(`  exportedAt=${d.exportedAt} tablas=${t.length} filas=${total} auth_users=${(d.auth_users ?? []).length}${d.auth_users ? "" : " (backup sin auth_users)"}`);
  for (const [n, r] of t.sort()) if (r.length) console.log(`    ${n}: ${r.length}`);
  const vacias = t.filter(([, r]) => r.length === 0).map(([n]) => n);
  console.log(`    (vacías: ${vacias.length})`);
' "$JSON"
TIMINGS+=("1 descifrar+leer: $(elapsed "$t" "$(now)")s")

# ---------------------------------------------------------------- 2. postgres + stubs + migraciones
t=$(now)
log "2/5 Postgres 16 descartable en :$PGPORT + stubs de Supabase + migraciones"
"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null || exit 1
"$PGBIN/pg_ctl" -D "$PGDATA" -l "$WORKDIR/postgres.log" -w \
  -o "-p $PGPORT -c listen_addresses=localhost -c unix_socket_directories=''" start >/dev/null || { tail -5 "$WORKDIR/postgres.log" >&2; exit 1; }
"$PGBIN/createdb" -h localhost -p "$PGPORT" -U postgres restore || exit 1

# Objetos que Supabase trae de fábrica y las migraciones dan por existentes.
# Cada bloque dice qué migración lo necesita: es la lista para un runbook.
"${PSQL[@]}" -v ON_ERROR_STOP=1 >/dev/null 2>"$WORKDIR/bootstrap.err" <<'SQL' || { echo "Falló el bootstrap de stubs" >&2; cat "$WORKDIR/bootstrap.err" >&2; exit 1; }
-- Roles de PostgREST / GoTrue (GRANT ... TO authenticated/anon/service_role, policies TO authenticated)
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','supabase_admin','authenticator',
                           'supabase_auth_admin','supabase_storage_admin','dashboard_user'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
ALTER ROLE service_role BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS vault;
GRANT USAGE ON SCHEMA public, extensions, auth, storage TO anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
-- Supabase pone extensions en el search_path por defecto (gen_random_bytes, crypt, hmac…)
ALTER DATABASE restore SET search_path = "$user", public, extensions;
SET search_path = "$user", public, extensions;

-- auth.users: FKs (profiles, clinic_members, appointments.confirmed_by, …) y el trigger on_auth_user_created
CREATE TABLE IF NOT EXISTS auth.users (
  instance_id uuid, id uuid PRIMARY KEY, aud varchar(255), role varchar(255),
  email varchar(255), encrypted_password varchar(255), email_confirmed_at timestamptz,
  invited_at timestamptz, confirmation_token varchar(255), confirmation_sent_at timestamptz,
  recovery_token varchar(255), recovery_sent_at timestamptz, last_sign_in_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  phone text, phone_confirmed_at timestamptz, banned_until timestamptz,
  deleted_at timestamptz, is_sso_user boolean NOT NULL DEFAULT false,
  is_anonymous boolean NOT NULL DEFAULT false
);
-- auth.uid()/role()/jwt()/email(): 134 usos en policies y funciones
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                             current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT auth.jwt() ->> 'email' $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

-- storage: bucket clinical-documents + policies sobre storage.objects (20260826200000)
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, owner uuid, public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
  name text, owner uuid, metadata jsonb, version text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
  $$ SELECT (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;

-- Realtime: ALTER PUBLICATION supabase_realtime ADD TABLE … (20260726161056)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- Usuario de la clínica demo (demo@esmalia.com): reset_demo_clinic() lo usa como
-- owner/counted_by, y 20261011000000 llama al reset → sin él la migración falla por FK.
INSERT INTO auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data)
VALUES ('139dd209-8495-415c-b6cd-6bbc63367bad', 'demo@esmalia.com', 'authenticated', 'authenticated',
        '{"restore_stub": true}', '{}')
ON CONFLICT (id) DO NOTHING;

-- vault: clave esmalia_document_id_key (20260822150000 y siguientes). Stub VACÍO a propósito:
-- la clave real no está en el backup (ver docs/BACKUPS.md).
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text,
  created_at timestamptz DEFAULT now()
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, secret AS decrypted_secret, created_at FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL)
  RETURNS uuid LANGUAGE sql AS
  $$ INSERT INTO vault.secrets (name, secret) VALUES (new_name, new_secret) RETURNING id $$;
CREATE OR REPLACE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL,
  new_name text DEFAULT NULL, new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS
  $$ UPDATE vault.secrets SET secret = coalesce(new_secret, secret), name = coalesce(new_name, name)
     WHERE id = secret_id $$;

-- auth.identities: 20261014000000 actualiza el correo de la cuenta demo.
CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, provider text NOT NULL,
  provider_id text, identity_data jsonb NOT NULL DEFAULT '{}', last_sign_in_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
SQL

MIG_OK=0; MIG_FAIL=0; MIG_NOTX=0
: > "$WORKDIR/migration-failures.txt"; : > "$WORKDIR/migration-notx.txt"
for f in "$MIGRATIONS"/*.sql; do
  # Primero cada migración en su propia transacción (-1, como `supabase db push`):
  # si falla, no queda a medias. Si falla así pero pasa sin transacción (que es
  # como se aplicaron a prod: `psql -f`), se anota como "no transaccional" —
  # típicamente ALTER TYPE … ADD VALUE usado en el mismo archivo.
  if "${PSQL[@]}" -1 -v ON_ERROR_STOP=1 -f "$f" >"$WORKDIR/mig.out" 2>&1; then
    MIG_OK=$((MIG_OK + 1))
  elif "${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$f" >"$WORKDIR/mig2.out" 2>&1; then
    MIG_OK=$((MIG_OK + 1)); MIG_NOTX=$((MIG_NOTX + 1))
    printf '%s: %s\n' "$(basename "$f")" "$(grep -m1 -o 'ERROR:.*' "$WORKDIR/mig.out")" >> "$WORKDIR/migration-notx.txt"
  else
    MIG_FAIL=$((MIG_FAIL + 1))
    # El error de una migración es esquema, no datos: se puede mostrar.
    printf '%s: %s\n' "$(basename "$f")" "$(grep -m1 -o 'ERROR:.*' "$WORKDIR/mig2.out")" >> "$WORKDIR/migration-failures.txt"
  fi
done
log "  migraciones: $MIG_OK ok ($MIG_NOTX solo fuera de transacción), $MIG_FAIL con error"
[ "$MIG_NOTX" -gt 0 ] && { echo "  no transaccionales (fallan con -1 / supabase db push):"; sed 's/^/    /' "$WORKDIR/migration-notx.txt"; }
[ "$MIG_FAIL" -gt 0 ] && { echo "  con error:"; sed 's/^/    /' "$WORKDIR/migration-failures.txt"; }
TIMINGS+=("2 postgres+stubs+migraciones: $(elapsed "$t" "$(now)")s")

# ---------------------------------------------------------------- 3. cargar datos
t=$(now)
log "3/5 Cargando el backup"
# El JSON entra como variable de psql (no pg_read_file): así el mismo SQL sirve
# contra un Supabase nuevo, donde `postgres` no es superusuario.
# El SQL de carga vive en scripts/simulacro/cargar-datos.sql: el simulacro
# automático (SEG-05) usa exactamente el mismo.
"${PSQL[@]}" -v ON_ERROR_STOP=1 -v json="$JSON" -f "$REPO_DIR/scripts/simulacro/cargar-datos.sql" 2>&1 \
  | grep -E '^(NOTICE|ERROR)' | grep -v 'truncate cascades' | sed 's/^NOTICE:  /  /'
TIMINGS+=("3 carga de datos: $(elapsed "$t" "$(now)")s")

# ---------------------------------------------------------------- 4. verificar
t=$(now)
log "4/5 Verificando"
"${PSQL[@]}" -v ON_ERROR_STOP=1 <<'SQL' 2>&1 | grep -E '^(NOTICE|ERROR)' | sed 's/^NOTICE:  /  /'
DO $$
DECLARE
  d jsonb := (SELECT doc FROM public._restore_doc);
  t text; esperado bigint; real bigint; ok int := 0; distintos int := 0;
  c record; huerfanos bigint; fk_mal int := 0; fk_total int := 0; n bigint; m bigint;
BEGIN
  FOR t IN SELECT jsonb_object_keys(d->'tables') ORDER BY 1 LOOP
    CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;
    esperado := jsonb_array_length(d->'tables'->t);
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO real;
    IF real = esperado THEN ok := ok + 1;
    ELSE distintos := distintos + 1; RAISE NOTICE 'CONTEO DISTINTO %: backup=% db=%', t, esperado, real; END IF;
  END LOOP;
  RAISE NOTICE 'conteos iguales al backup: % tablas; distintos: %', ok, distintos;

  -- Integridad referencial: la carga fue sin chequeo de FKs, así que se mide acá.
  FOR c IN SELECT con.conname, con.conrelid::regclass AS rel, a.attname AS col,
                  con.confrelid::regclass AS ref, ra.attname AS refcol
             FROM pg_constraint con
             JOIN pg_attribute a  ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
             JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = con.confkey[1]
            WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1
              AND con.connamespace = 'public'::regnamespace LOOP
    fk_total := fk_total + 1;
    EXECUTE format('SELECT count(*) FROM %s x WHERE x.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s y WHERE y.%I = x.%I)',
                   c.rel, c.col, c.ref, c.refcol, c.col) INTO huerfanos;
    IF huerfanos > 0 THEN fk_mal := fk_mal + 1; RAISE NOTICE 'FK rota %.%: % filas huérfanas', c.rel, c.col, huerfanos; END IF;
  END LOOP;
  RAISE NOTICE 'FKs de una columna revisadas: %, con huérfanos: %', fk_total, fk_mal;

  -- Consultas de cordura (solo conteos).
  SELECT count(*), count(DISTINCT clinic_id) INTO n, m FROM public.patients;
  RAISE NOTICE 'pacientes: % en % clínicas', n, m;
  SELECT count(*) INTO n FROM public.appointments a JOIN public.patients p ON p.id = a.patient_id AND p.clinic_id = a.clinic_id;
  SELECT count(*) INTO m FROM public.appointments;
  RAISE NOTICE 'citas con su paciente en la misma clínica: % de %', n, m;
  SELECT count(*) INTO n FROM public.clinic_members cm JOIN auth.users u ON u.id = cm.user_id;
  SELECT count(*) INTO m FROM public.clinic_members;
  RAISE NOTICE 'miembros de clínica con usuario en auth.users: % de %', n, m;
  SELECT count(*) INTO n FROM auth.users WHERE raw_app_meta_data ? 'restore_stub';
  RAISE NOTICE 'usuarios stub (sin datos reales de auth): %', n;
END $$;
SQL

if [ -n "$STORAGE_BACKUP" ]; then
  mkdir -p "$WORKDIR/storage"
  if age -d -i "$KEY" "$STORAGE_BACKUP" | tar -xzf - -C "$WORKDIR/storage"; then
    node -e '
      const fs = require("fs"), path = require("path");
      const dir = process.argv[1];
      const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
      let ok = 0, bad = 0;
      for (const b of m.buckets) for (const o of b.objects) {
        const p = path.join(dir, b.id, o.path);
        fs.existsSync(p) && fs.statSync(p).size === o.size ? ok++ : bad++;
      }
      console.log(`  storage: ${m.buckets.length} buckets, ${ok} archivos ok, ${bad} faltantes/tamaño distinto, ${m.failed.length} fallidos al exportar`);
    ' "$WORKDIR/storage"
  else
    echo "  storage: no se pudo descifrar/extraer $STORAGE_BACKUP" >&2
  fi
fi
TIMINGS+=("4 verificación: $(elapsed "$t" "$(now)")s")

# ---------------------------------------------------------------- 5. limpiar
t=$(now)
log "5/5 Apagando y borrando el directorio de trabajo"
cleanup; trap - EXIT
TIMINGS+=("5 limpieza: $(elapsed "$t" "$(now)")s")

log "Tiempos:"
for x in "${TIMINGS[@]}"; do echo "  $x"; done
echo "  TOTAL: $(elapsed "$T0" "$(now)")s"
