#!/usr/bin/env bash
# Simulacro completo SIN datos reales ni secretos: arma un backup "de juguete"
# y lo pasa por scripts/simulacro/simulacro.sh, exactamente como el real.
#
# 1. Levanta un Supabase efímero A con todas las migraciones (siembran la
#    clínica demo), le crea 2 usuarios de prueba y le sube un archivo de prueba.
# 2. Corre los scripts de backup DE VERDAD (backup-data.mjs y backup-storage.mjs)
#    contra A, y cifra el resultado con una clave age generada en el momento.
# 3. Apaga A (volúmenes descartados) y corre el simulacro sobre un Supabase B nuevo.
#
# Sirve para probar el workflow en un PR o con un dispatch sin que haga falta
# BACKUP_AGE_KEY, y deja probados también los scripts de backup.
#
# Uso: scripts/simulacro/juguete.sh       (mismas variables opcionales que simulacro.sh)
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$REPO_DIR/scripts/simulacro"
PUERTO="${SIMULACRO_PUERTO:-54320}"
PROJECT_A="${SIMULACRO_PROJECT_ID:-esmalia-simulacro}-origen"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/simulacro-juguete.XXXXXX")"
chmod 700 "$TMP"
if command -v supabase >/dev/null 2>&1; then SUPABASE=supabase; else SUPABASE="$REPO_DIR/node_modules/.bin/supabase"; fi

cleanup() {
  "$SUPABASE" stop --workdir "$TMP/a" --no-backup --project-id "$PROJECT_A" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "==> Backup de juguete: Supabase origen ($PROJECT_A)"
mkdir -p "$TMP/a"
# El origen usa otros puertos (+10) para no chocar con la base del simulacro.
bash "$HERE/levantar.sh" "$TMP/a" "$PROJECT_A" "$((PUERTO + 10))" || exit 1
(
  set -a
  # shellcheck disable=SC1091
  . "$TMP/a/supabase.env"
  set +a
  node "$HERE/sembrar-juguete.mjs" || exit 1
  node "$REPO_DIR/scripts/backup-data.mjs" >"$TMP/backup.json.gz" || exit 1
  node "$REPO_DIR/scripts/backup-storage.mjs" "$TMP/storage-backup" || exit 1
) || { echo "::error::No se pudo armar el backup de juguete." >&2; exit 1; }
tar -czf "$TMP/storage.tar.gz" -C "$TMP/storage-backup" .
"$SUPABASE" stop --workdir "$TMP/a" --no-backup --project-id "$PROJECT_A" >/dev/null 2>&1

age-keygen -o "$TMP/juguete.key" 2>/dev/null
PUB="$(age-keygen -y "$TMP/juguete.key")"
STAMP="$(date -u +%Y%m%d_%H%M%S)"
age -r "$PUB" -o "$TMP/esmalia_${STAMP}.json.gz.age" "$TMP/backup.json.gz"
age -r "$PUB" -o "$TMP/esmalia_storage_${STAMP}.tar.gz.age" "$TMP/storage.tar.gz"
rm -f "$TMP/backup.json.gz" "$TMP/storage.tar.gz"

echo "==> Simulacro sobre el backup de juguete"
SIMULACRO_ORIGEN="${SIMULACRO_ORIGEN:-juguete esmalia_${STAMP}}" \
  bash "$HERE/simulacro.sh" "$TMP/esmalia_${STAMP}.json.gz.age" "$TMP/juguete.key" \
  "$TMP/esmalia_storage_${STAMP}.tar.gz.age"
