#!/usr/bin/env bash
# Genera la cara de titulares de la landing (/v2): Bricolage Grotesque fija en
# opsz 96, wdth 75 y wght 800, subconjunto latin. Sale del archivo variable de
# @fontsource-variable/bricolage-grotesque (devDependency) con fontTools.
#
# Por qué una instancia fija y no el archivo variable: los titulares usan una
# sola combinación de ejes. El archivo variable de fontsource con ancho y peso
# pesa ~78 KB; la instancia, ~21 KB. Es lo que más pesa en el primer pantallazo
# después del CSS.
#
# Requisitos: python3 con fonttools y brotli (`pip install fonttools brotli`).
# Uso: bash scripts/fuentes/instanciar-bricolage.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

ORIGEN="node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wdth-normal.woff2"
DESTINO="src/assets/fuentes/bricolage-grotesque-latin-display.woff2"

# El archivo `wdth` de fontsource trae los ejes wght y wdth; el opsz ya viene
# fijo en 96 (el valor por defecto de la familia, el de tamaños grandes).
python3 -m fontTools.varLib.instancer "$ORIGEN" wght=800 wdth=75 -o "$DESTINO" -q
python3 - "$DESTINO" <<'PY'
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1])
assert "fvar" not in f, "la instancia tiene que quedar fija"
f.flavor = "woff2"
f.save(sys.argv[1])
PY
ls -l "$DESTINO"
