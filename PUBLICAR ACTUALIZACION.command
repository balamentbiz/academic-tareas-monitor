#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

echo "================================================"
echo "   Academic Tareas Monitor — Publicar actualización"
echo "   Mac (DMG) + Windows (EXE)"
echo "================================================"
echo ""

# Cargar token
if [ -f ".env" ]; then export $(grep -v '^#' .env | xargs); fi
if [ -z "$GH_TOKEN" ]; then echo "ERROR: Token no encontrado en .env"; read -p "Enter..."; exit 1; fi

# Versión actual
CURRENT=$(node -e "console.log(require('./package.json').version)" 2>/dev/null)
echo "Versión actual: v$CURRENT"
echo "¿Nueva versión? (Enter para mantener v$CURRENT):"
read -r NEW_VERSION

if [ -n "$NEW_VERSION" ] && [ "$NEW_VERSION" != "$CURRENT" ]; then
  node -e "
    const fs=require('fs');
    const p=JSON.parse(fs.readFileSync('package.json'));
    p.version='$NEW_VERSION';
    fs.writeFileSync('package.json',JSON.stringify(p,null,2));
  "
  CURRENT="$NEW_VERSION"
  echo "Versión actualizada a v$CURRENT"
fi

# ── Subir código ──
echo ""
echo "Subiendo código a GitHub..."
rm -f .git/index.lock 2>/dev/null
git config user.email "academicsolutionsmx@gmail.com"
git config user.name "balamentbiz"
git add -A
git commit -m "v$CURRENT" 2>/dev/null || echo "(sin cambios nuevos)"
git push --force https://balamentbiz:${GH_TOKEN}@github.com/balamentbiz/academic-tareas-monitor.git main 2>&1 | tail -3

# ── Construir Mac DMG + ZIP (el ZIP lo usa el auto-updater) ──
echo ""
echo "[1/4] Construyendo Mac DMG + ZIP..."
echo "(~2-3 minutos)"

# Limpiar artefactos viejos para no subir versiones anteriores por error
rm -f dist/*.dmg dist/*.zip dist/*.blockmap dist/latest*.yml 2>/dev/null

# Firma + notarización automáticas si hay credenciales de Apple en .env
MAC_FLAGS=""
if [ -n "$APPLE_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
  echo "✓ Credenciales de Apple detectadas — se firmará y notarizará"
  MAC_FLAGS="--config.mac.notarize.teamId=$APPLE_TEAM_ID"
else
  echo "(sin credenciales de Apple en .env — build sin firmar; Mac usará aviso manual)"
fi

npx electron-builder --mac $MAC_FLAGS 2>&1

DMG=$(ls dist/*-arm64.dmg 2>/dev/null | grep "$CURRENT" | head -1)
if [ -z "$DMG" ]; then DMG=$(ls dist/*.dmg 2>/dev/null | head -1); fi
if [ -z "$DMG" ]; then
  echo "ERROR: No se generó el DMG"
  read -p "Enter para cerrar..."; exit 1
fi
echo "✓ DMG: $(basename "$DMG")"

# ── Construir Windows EXE ──
echo ""
echo "[2/4] Construyendo Windows EXE..."
echo "(~5-10 minutos)"

# Reparar icon.ico
python3 -c "
from PIL import Image
try:
    img = Image.open('assets/icon.icns').convert('RGBA')
except:
    img = Image.new('RGBA', (256,256), (9,163,239,255))
sizes = [(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)]
imgs = [img.resize(s, Image.LANCZOS) for s in sizes]
imgs[0].save('assets/icon.ico', format='ICO', append_images=imgs[1:])
" 2>/dev/null

# Limpiar EXE viejo
rm -f dist/*Setup*.exe dist/*Setup*.exe.blockmap 2>/dev/null
rm -rf dist/win-unpacked 2>/dev/null

npx electron-builder --win nsis --x64 2>&1

EXE=$(ls dist/*Setup*.exe 2>/dev/null | head -1)
if [ -z "$EXE" ]; then EXE=$(ls dist/*.exe 2>/dev/null | head -1); fi
if [ -z "$EXE" ]; then
  echo "ERROR: No se generó el EXE"
  read -p "Enter para cerrar..."; exit 1
fi
echo "✓ EXE: $(basename "$EXE")"

# ── Crear release en GitHub ──
echo ""
echo "[3/4] Creando release v$CURRENT en GitHub..."

EXISTING=$(curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/tags/v$CURRENT" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

if [ -n "$EXISTING" ]; then
  RELEASE_ID="$EXISTING"
  echo "Release existente (ID: $RELEASE_ID) — eliminando assets viejos..."
  curl -s -H "Authorization: token $GH_TOKEN" \
    "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID/assets" \
    | python3 -c "
import json,sys,urllib.request,os
assets=json.load(sys.stdin)
token=os.environ.get('GH_TOKEN','')
for a in assets:
    req=urllib.request.Request('https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/assets/'+str(a['id']),method='DELETE')
    req.add_header('Authorization','token '+token)
    try: urllib.request.urlopen(req)
    except: pass
" 2>/dev/null
else
  RELEASE_ID=$(curl -s -X POST \
    -H "Authorization: token $GH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"tag_name\":\"v$CURRENT\",\"name\":\"v$CURRENT\",\"draft\":false,\"prerelease\":false,\"make_latest\":\"true\"}" \
    "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  echo "Release creado (ID: $RELEASE_ID)"
fi

if [ -z "$RELEASE_ID" ]; then
  echo "ERROR: No se pudo crear el release"
  read -p "Enter para cerrar..."; exit 1
fi

# ── Subir DMG y EXE ──
echo ""
echo "[4/4] Subiendo archivos a GitHub..."

echo "Subiendo DMG (Mac)..."
DMG_NAME=$(basename "$DMG" | sed 's/ /-/g')
curl -X POST \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --progress-bar \
  --data-binary @"$DMG" \
  "https://uploads.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID/assets?name=$DMG_NAME"
echo ""

echo "Subiendo EXE (Windows)..."
EXE_NAME=$(basename "$EXE" | sed 's/ /-/g')
curl -X POST \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --progress-bar \
  --data-binary @"$EXE" \
  "https://uploads.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID/assets?name=$EXE_NAME"
echo ""

# ── Archivos del AUTO-UPDATER (sin estos, la app no se actualiza sola) ──
echo "Subiendo metadatos del auto-updater..."
for F in dist/latest.yml dist/latest-mac.yml dist/*.zip dist/*.blockmap; do
  [ -f "$F" ] || continue
  FN=$(basename "$F" | sed 's/ /-/g')
  echo "  → $FN"
  curl -s -X POST \
    -H "Authorization: token $GH_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary @"$F" \
    "https://uploads.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID/assets?name=$FN" > /dev/null
done
echo ""

# Marcar como latest
curl -s -X PATCH \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"draft":false,"prerelease":false,"make_latest":"true"}' \
  "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID" > /dev/null

echo ""
echo "================================================"
echo "  ✓ Release v$CURRENT publicado"
echo "  Mac:     $(basename "$DMG" | sed 's/ /-/g')"
echo "  Windows: $(basename "$EXE" | sed 's/ /-/g')"
echo "  github.com/balamentbiz/academic-tareas-monitor/releases"
echo "================================================"
echo ""
read -p "Presiona Enter para cerrar..."
