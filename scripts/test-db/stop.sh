#!/usr/bin/env bash
# Apaga el Supabase local de tests y descarta sus volúmenes (la base es efímera).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_ID="${ESMALIA_TEST_PROJECT_ID:-esmalia-test}"
WORKDIR="${ESMALIA_TEST_WORKDIR:-${TMPDIR:-/tmp}/esmalia-test-db}"
# CLI global si está instalado; si no, el de devDependencies (npm ci).
if command -v supabase >/dev/null 2>&1; then SUPABASE=supabase; else SUPABASE="$REPO_ROOT/node_modules/.bin/supabase"; fi
"$SUPABASE" stop --workdir "$WORKDIR" --no-backup --project-id "$PROJECT_ID"
