#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

if [ -f ".env" ]; then export $(grep -v '^#' .env | xargs); fi

VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null)

echo "================================================"
echo "   Subir instalador Windows (.msi) al release v$VERSION"
echo "================================================"
echo ""

if [ -z "$GH_TOKEN" ]; then
  echo "ERROR: Token no encontrado en .env"
  read -p "Enter para cerrar..."; exit 1
fi

# ── Buscar EXE ya generado o construir uno nuevo ──
# Limpiar instaladores Windows viejos de dist/
echo "Limpiando instaladores anteriores..."
rm -f dist/*Setup*.exe dist/*Setup*.exe.blockmap 2>/dev/null
rm -rf dist/win-unpacked 2>/dev/null

REBUILD="y"
EXE=""

if [ "$REBUILD" = "y" ] || [ -z "$EXE" ]; then
  # Reparar icon.ico
  echo "Verificando ícono Windows..."
  python3 -c "
from PIL import Image
try:
    img = Image.open('assets/icon.icns').convert('RGBA')
except:
    img = Image.new('RGBA', (256,256), (9,163,239,255))
sizes = [(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)]
imgs = [img.resize(s, Image.LANCZOS) for s in sizes]
imgs[0].save('assets/icon.ico', format='ICO', append_images=imgs[1:])
print('Icono OK')
" 2>/dev/null || echo "(continuando...)"

  echo ""
  echo "Construyendo instalador Windows..."
  echo "(puede tardar 5-10 minutos)"
  echo ""
  npx electron-builder --win nsis --x64 2>&1

  EXE=$(ls dist/*Setup*.exe 2>/dev/null | head -1)
  if [ -z "$EXE" ]; then EXE=$(ls dist/*.exe 2>/dev/null | head -1); fi
fi

if [ -z "$EXE" ]; then
  echo "ERROR: No se encontró ningún .exe en dist/"
  read -p "Enter para cerrar..."; exit 1
fi

echo ""
echo "✓ EXE: $(basename "$EXE") ($(du -sh "$EXE" | cut -f1))"
echo ""

# ── Buscar release en GitHub ──
echo "Buscando release v$VERSION en GitHub..."
RELEASE_JSON=$(curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/tags/v$VERSION")

RELEASE_ID=$(echo "$RELEASE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

if [ -z "$RELEASE_ID" ]; then
  echo ""
  echo "No se encontró release v$VERSION — buscando el último release..."
  RELEASE_JSON=$(curl -s -H "Authorization: token $GH_TOKEN" \
    "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/latest")
  RELEASE_ID=$(echo "$RELEASE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
  RELEASE_TAG=$(echo "$RELEASE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tag_name',''))" 2>/dev/null)
  echo "Usando release más reciente: $RELEASE_TAG (ID: $RELEASE_ID)"
fi

if [ -z "$RELEASE_ID" ]; then
  echo "ERROR: No se pudo encontrar ningún release. Corre primero PUBLICAR ACTUALIZACION.command"
  open dist/
  read -p "Enter para cerrar..."; exit 1
fi

# ── Eliminar EXE anterior si existe ──
echo "Verificando assets existentes..."
EXISTING_ASSET=$(curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID/assets" \
  | python3 -c "
import json,sys
assets=json.load(sys.stdin)
for a in assets:
    if a['name'].endswith('.exe'):
        print(a['id'])
        break
" 2>/dev/null)

if [ -n "$EXISTING_ASSET" ]; then
  echo "Eliminando .exe anterior (ID: $EXISTING_ASSET)..."
  curl -s -X DELETE \
    -H "Authorization: token $GH_TOKEN" \
    "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/assets/$EXISTING_ASSET"
fi

# ── Subir EXE ──
EXE_NAME=$(basename "$EXE" | sed 's/ /-/g')
echo ""
echo "Subiendo $EXE_NAME..."

UPLOAD_RESULT=$(curl -X POST \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --progress-bar \
  --data-binary @"$EXE" \
  "https://uploads.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID/assets?name=$EXE_NAME")

# Verificar resultado
ASSET_ID=$(echo "$UPLOAD_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

echo ""
if [ -n "$ASSET_ID" ]; then
  echo "================================================"
  echo "  ✓ Windows .msi subido correctamente"
  echo "  github.com/balamentbiz/academic-tareas-monitor/releases"
  echo "================================================"
else
  echo "ERROR al subir. Respuesta de GitHub:"
  echo "$UPLOAD_RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('message','Error desconocido'))" 2>/dev/null
  echo ""
  echo "El EXE está en: $EXE"
  echo "Puedes subirlo manualmente a GitHub releases."
  open dist/
fi

echo ""
read -p "Presiona Enter para cerrar..."
