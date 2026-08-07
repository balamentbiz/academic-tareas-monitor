#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  ACADEMIC TAREAS — Resubir archivos del release (sin recompilar)
#  Usa los archivos YA construidos en dist/ (firmados/notarizados),
#  borra todos los assets del release y los sube limpios.
# ═══════════════════════════════════════════════════════════════
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

# Cargar secretos sin exponerlos en la línea de comandos (xargs los deja
# visibles en la tabla de procesos para cualquier usuario del equipo)
if [ -f ".env" ]; then set -a; source ./.env; set +a; fi
if [ -z "$GH_TOKEN" ]; then echo "ERROR: Token no encontrado en .env"; read -p "Enter..."; exit 1; fi

VERSION=$(node -e "console.log(require('./package.json').version)")
echo "Release destino: v$VERSION"

RELEASE_ID=$(curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/tags/v$VERSION" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
if [ -z "$RELEASE_ID" ]; then echo "ERROR: no se encontró el release v$VERSION"; read -p "Enter..."; exit 1; fi
echo "Release ID: $RELEASE_ID"

echo "Eliminando TODOS los assets anteriores (paginado, via curl)..."
TOTAL=0
while true; do
  IDS=$(curl -s -H "Authorization: token $GH_TOKEN" \
    "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID/assets?per_page=100" \
    | python3 -c "import json,sys
try: d=json.load(sys.stdin)
except Exception: d=[]
print(' '.join(str(a['id']) for a in d) if isinstance(d,list) else '')")
  [ -z "$IDS" ] && break
  for ID in $IDS; do
    curl -s -X DELETE -H "Authorization: token $GH_TOKEN" \
      "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/assets/$ID" > /dev/null
    TOTAL=$((TOTAL+1))
  done
done
echo "  $TOTAL assets eliminados"

echo ""
echo "Subiendo archivos nuevos desde dist/..."
subir() {
  local F="$1"
  [ -f "$F" ] || { echo "  (no existe: $F — omitido)"; return; }
  local FN=$(basename "$F" | sed 's/ /-/g')
  echo "  → $FN"
  curl -s -X POST \
    -H "Authorization: token $GH_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary @"$F" \
    "https://uploads.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID/assets?name=$FN" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('    ✓ subido' if d.get('state')=='uploaded' else '    ✗ ERROR: '+str(d)[:150])"
}

subir "dist/Academic-Tareas-Monitor-$VERSION-arm64.dmg"
subir "dist/Academic-Tareas-Monitor-Setup-$VERSION.exe"
subir "dist/Academic-Tareas-Monitor-$VERSION-arm64.zip"
subir "dist/latest.yml"
subir "dist/latest-mac.yml"
subir "dist/Academic-Tareas-Monitor-$VERSION-arm64.dmg.blockmap"
subir "dist/Academic-Tareas-Monitor-$VERSION-arm64.zip.blockmap"
subir "dist/Academic-Tareas-Monitor-Setup-$VERSION.exe.blockmap"

echo ""
echo "════════════════════════════════════════════════"
echo "  ✓ Release v$VERSION con archivos firmados"
echo "  github.com/balamentbiz/academic-tareas-monitor/releases"
echo "════════════════════════════════════════════════"
read -p "Presiona Enter para cerrar..."
