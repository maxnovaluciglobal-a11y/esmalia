#!/usr/bin/env bash
# Simulacro de restauración (SEG-05): restaura un backup cifrado de Esmalia en
# un Supabase EFÍMERO (Docker, en la máquina o en el runner de GitHub), lo
# verifica contra el propio backup y mide cuánto tarda (RTO).
#
# Es el ensayo del 10-oct (scripts/restore-drill.sh) llevado a un Supabase de
# verdad: usuarios recreados con auth.admin.createUser (mismo id), archivos
# subidos con la API de Storage y las tablas cargadas con el mismo SQL
# (scripts/simulacro/cargar-datos.sql).
#
# Nunca toca producción: la base es local, se niega a escribir en una URL que
# no sea 127.0.0.1, y al terminar se apaga y se borran sus volúmenes y el
# directorio de trabajo (tienen datos reales). Solo imprime nombres de tabla,
# conteos y tiempos.
#
# Uso:
#   scripts/simulacro/simulacro.sh <backup.json.gz.age> <clave-age> [storage.tar.gz.age]
#
# Variables opcionales:
#   SIMULACRO_SALIDA      dónde dejar reporte.md / reporte.json (default: ./simulacro-reporte)
#   SIMULACRO_ORIGEN      nombre del backup para el reporte (default: el del archivo)
#   SIMULACRO_T_BAJADA    segundos que tardó bajar el backup (se suman al RTO)
#   SIMULACRO_PROJECT_ID  project_id del Supabase local (default: esmalia-simulacro)
#   SIMULACRO_PUERTO      base de puertos: API = +1, DB = +2, shadow = +3 (default: 54320)
#   KEEP=1                no apagar ni borrar al terminar (¡datos reales!)
#
# Sale con 0 si todas las verificaciones pasan, 1 si alguna falla, 2 si no
# pudo ni empezar (archivos o herramientas que faltan).
set -uo pipefail

BACKUP="${1:?Uso: simulacro.sh <backup.json.gz.age> <clave-age> [storage.tar.gz.age]}"
KEY="${2:?Falta la clave privada age}"
STORAGE_BACKUP="${3:-}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$REPO_DIR/scripts/simulacro"
SALIDA="${SIMULACRO_SALIDA:-$PWD/simulacro-reporte}"
ORIGEN="${SIMULACRO_ORIGEN:-$(basename "$BACKUP")}"
PROJECT_ID="${SIMULACRO_PROJECT_ID:-esmalia-simulacro}"
PUERTO="${SIMULACRO_PUERTO:-54320}"
DB_CONTAINER="supabase_db_${PROJECT_ID}"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/simulacro.XXXXXX")"
chmod 700 "$WORKDIR"
if command -v supabase >/dev/null 2>&1; then SUPABASE=supabase; else SUPABASE="$REPO_DIR/node_modules/.bin/supabase"; fi

now() { perl -MTime::HiRes=time -e 'printf "%.2f\n", time'; }
elapsed() { perl -e "printf '%.1f', $2 - $1"; }
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
tiempo() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$WORKDIR/tiempos.tsv"; }

for bin in age docker node perl "$SUPABASE"; do
  command -v "$bin" >/dev/null 2>&1 || [ -x "$bin" ] || { echo "Falta '$bin'." >&2; exit 2; }
done
[ -r "$BACKUP" ] || { echo "No encuentro el backup '$BACKUP'." >&2; exit 2; }
[ -r "$KEY" ] || { echo "No encuentro la clave '$KEY'." >&2; exit 2; }

cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    log "KEEP=1: el Supabase '$PROJECT_ID' sigue arriba y $WORKDIR NO se borró (datos reales)."
    return
  fi
  "$SUPABASE" stop --workdir "$WORKDIR" --no-backup --project-id "$PROJECT_ID" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
  log "Supabase efímero apagado (volúmenes descartados) y directorio de trabajo borrado."
}
trap cleanup EXIT

: >"$WORKDIR/tiempos.tsv"
[ -n "${SIMULACRO_T_BAJADA:-}" ] && tiempo "0 bajar el backup de B2" "$SIMULACRO_T_BAJADA" 1

# ------------------------------------------------------------------ 1. descifrar
t=$(now)
log "1/6 Descifrando $ORIGEN"
if ! age -d -i "$KEY" "$BACKUP" | gunzip >"$WORKDIR/backup.json"; then
  echo "::error::No se pudo descifrar/descomprimir el backup (¿clave equivocada o archivo dañado?)." >&2
  exit 1
fi
if [ -n "$STORAGE_BACKUP" ]; then
  mkdir -p "$WORKDIR/storage"
  if ! age -d -i "$KEY" "$STORAGE_BACKUP" | tar -xzf - -C "$WORKDIR/storage"; then
    echo "::error::No se pudo descifrar/extraer el backup de Storage." >&2
    exit 1
  fi
fi
tiempo "1 descifrar y descomprimir" "$(elapsed "$t" "$(now)")" 1

# ------------------------------------------------------------------ 2. supabase + migraciones
t=$(now)
log "2/6 Supabase efímero ($PROJECT_ID, puertos $((PUERTO + 1))/$((PUERTO + 2))) + migraciones"
bash "$HERE/levantar.sh" "$WORKDIR" "$PROJECT_ID" "$PUERTO" || exit 1
tiempo "2 levantar Supabase y aplicar migraciones" "$(elapsed "$t" "$(now)")" 1

# shellcheck disable=SC1091
set -a; . "$WORKDIR/supabase.env"; set +a

# ------------------------------------------------------------------ 3. usuarios de auth
t=$(now)
log "3/6 Recreando usuarios de auth con su id (auth.admin.createUser)"
node "$HERE/restaurar-auth.mjs" "$WORKDIR/backup.json"
tiempo "3 recrear usuarios de auth" "$(elapsed "$t" "$(now)")" 1

# ------------------------------------------------------------------ 4. datos
t=$(now)
log "4/6 Cargando las tablas"
# El JSON se copia al contenedor (que se borra al final) y lo lee psql adentro.
docker cp "$WORKDIR/backup.json" "$DB_CONTAINER:/tmp/backup.json" >/dev/null
docker exec -i "$DB_CONTAINER" psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -v json=/tmp/backup.json \
  <"$HERE/cargar-datos.sql" 2>&1 | grep -E '^(NOTICE|ERROR)' | grep -v 'truncate cascades' | sed 's/^NOTICE:  /  /'
docker exec "$DB_CONTAINER" rm -f /tmp/backup.json
tiempo "4 cargar tablas" "$(elapsed "$t" "$(now)")" 1

# ------------------------------------------------------------------ 5. storage
t=$(now)
if [ -f "$WORKDIR/storage/manifest.json" ]; then
  log "5/6 Subiendo archivos de Storage"
  node "$HERE/restaurar-storage.mjs" "$WORKDIR/storage"
else
  log "5/6 Sin backup de Storage: se omite"
fi
tiempo "5 subir archivos de Storage" "$(elapsed "$t" "$(now)")" 1

# ------------------------------------------------------------------ 6. verificar
t=$(now)
log "6/6 Verificando contra el backup"
docker exec -i "$DB_CONTAINER" psql -X -q -U supabase_admin -d postgres \
  <"$HERE/verificar.sql" >"$WORKDIR/mediciones.json" 2>"$WORKDIR/verificar.err" \
  || { echo "::error::Falló la verificación:" >&2; cat "$WORKDIR/verificar.err" >&2; }
tiempo "6 verificar" "$(elapsed "$t" "$(now)")" 0

node "$HERE/evaluar.mjs" "$WORKDIR" "$SALIDA" "$ORIGEN"
estado=$?
log "Reporte en $SALIDA/reporte.md"
exit "$estado"
