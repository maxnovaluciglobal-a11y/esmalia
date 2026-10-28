#!/usr/bin/env bash
# Protección de rama de `main` (P1 de la transferencia, 28-oct-2026).
# PREPARADO, NO ACTIVADO: sin argumentos solo muestra el estado y las reglas.
# Activarla es decisión de Walter. Guía, riesgos y reversa: docs/RAMA_PROTEGIDA.md
#
#   bash scripts/proteger-main.sh             # estado actual + reglas que aplicaría (no cambia nada)
#   bash scripts/proteger-main.sh --aplicar   # PUT de la protección (exige ser ADMIN del repo)
#   bash scripts/proteger-main.sh --quitar    # DELETE de la protección (reversa de emergencia)
#
# Requiere `gh` autenticado con una cuenta con permiso de ADMIN sobre el repo
# (el dueño `maxnovaluciglobal-a11y`; la cuenta de trabajo tiene solo `write` y
# GitHub responde 404/403). Los nombres de los checks (`typecheck`, `lint`,
# `test`) son los jobs de .github/workflows/ci.yml: si se renombra un job hay que
# volver a correr --aplicar, o los merges quedan esperando un check que no llega.
set -euo pipefail

REPO="${REPO:-maxnovaluciglobal-a11y/esmalia}"
RAMA="${RAMA:-main}"

REGLAS=$(cat <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["typecheck", "lint", "test"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0, "dismiss_stale_reviews": false },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false
}
JSON
)

estado() {
  echo "==> Estado actual de $REPO@$RAMA (API pública)"
  curl -fsS "https://api.github.com/repos/$REPO/branches/$RAMA" |
    python3 -c 'import sys,json; d=json.load(sys.stdin); print("protected =", d["protected"]); print(json.dumps(d.get("protection"), indent=2))'
}

case "${1:-}" in
  --aplicar)
    echo "==> Aplicando la protección a $REPO@$RAMA"
    printf '%s' "$REGLAS" | gh api -X PUT "repos/$REPO/branches/$RAMA/protection" --input - >/dev/null
    estado
    ;;
  --quitar)
    echo "==> QUITANDO la protección de $REPO@$RAMA"
    gh api -X DELETE "repos/$REPO/branches/$RAMA/protection"
    estado
    ;;
  "")
    estado
    echo
    echo "==> Reglas que se aplicarían con --aplicar (no se aplicó nada):"
    printf '%s\n' "$REGLAS"
    ;;
  *)
    echo "Uso: $0 [--aplicar|--quitar]" >&2
    exit 2
    ;;
esac
