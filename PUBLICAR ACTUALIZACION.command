#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

echo "================================================"
echo "   Academic Tareas Monitor — Publicar actualización"
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

echo ""
echo "Subiendo código a GitHub..."
rm -f .git/index.lock 2>/dev/null
git config user.email "academicsolutionsmx@gmail.com"
git config user.name "balamentbiz"
git add -A
git commit -m "v$CURRENT" 2>/dev/null || echo "(sin cambios nuevos)"
git push --force https://balamentbiz:${GH_TOKEN}@github.com/balamentbiz/academic-tareas-monitor.git main 2>&1 | tail -3

echo ""
echo "Construyendo DMG (sin subir)..."
echo "(~2-3 minutos)"
echo ""

# Solo construir, SIN publicar — evita la subida lentísima de electron-builder
npx electron-builder --mac dmg 2>&1

# Buscar el DMG generado
DMG=$(ls dist/*.dmg 2>/dev/null | head -1)
if [ -z "$DMG" ]; then
  echo "ERROR: No se generó el DMG"
  read -p "Enter para cerrar..."; exit 1
fi
echo ""
echo "✓ DMG generado: $(basename "$DMG")"

# Crear release en GitHub (o actualizar si ya existe)
echo ""
echo "Creando release v$CURRENT en GitHub..."

# Verificar si ya existe
EXISTING=$(curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/tags/v$CURRENT" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

if [ -n "$EXISTING" ]; then
  RELEASE_ID="$EXISTING"
  echo "Release existente encontrado (ID: $RELEASE_ID)"
  # Eliminar assets viejos para re-subir
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
print('Assets anteriores eliminados')
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

# Subir DMG con curl (mucho más rápido que electron-builder --publish)
echo ""
echo "Subiendo DMG a GitHub..."
DMG_NAME=$(basename "$DMG" | sed 's/ /-/g')
curl -X POST \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --progress-bar \
  --data-binary @"$DMG" \
  "https://uploads.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID/assets?name=$DMG_NAME"

echo ""

# Publicar (marcar como latest)
curl -s -X PATCH \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"draft":false,"prerelease":false,"make_latest":"true"}' \
  "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID" > /dev/null

echo ""
echo "================================================"
echo "  ✓ Release v$CURRENT publicado en GitHub"
echo "  Tus asesores verán la actualización al abrir la app."
echo "================================================"
echo ""
read -p "Presiona Enter para cerrar..."
