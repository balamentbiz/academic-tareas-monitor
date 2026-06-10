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
echo "Construyendo y publicando release en GitHub..."
echo "(puede tardar 5-10 minutos)"
echo ""

npx electron-builder --mac dmg --publish always 2>&1

echo ""
echo "Publicando release v$CURRENT en GitHub..."
sleep 5

# Buscar el release por tag (puede ser draft) y publicarlo
RELEASE_ID=$(curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/tags/v$CURRENT" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

if [ -n "$RELEASE_ID" ]; then
  curl -s -X PATCH \
    -H "Authorization: token $GH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"draft":false,"prerelease":false,"make_latest":"true"}' \
    "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID" > /dev/null
  echo "================================================"
  echo "  ✓ Release v$CURRENT publicado en GitHub"
  echo "  Tus asesores verán la actualización"
  echo "  al abrir la app."
  echo "================================================"
else
  echo "  ⚠ No se encontró el release. Verifica en GitHub manualmente."
fi

echo ""
read -p "Presiona Enter para cerrar..."
