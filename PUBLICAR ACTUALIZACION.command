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
git add -A
git commit -m "v$CURRENT" 2>/dev/null || echo "(sin cambios nuevos)"
git push 2>&1 | tail -3

echo ""
echo "Instalando dependencias..."
npm install --save electron-updater 2>&1 | grep -E "added|updated" | head -3

echo ""
echo "Construyendo y publicando release en GitHub..."
echo "(puede tardar 5-10 minutos)"
echo ""

npx electron-builder --mac dmg --publish always 2>&1

echo ""
echo "Verificando release en GitHub..."
sleep 3
RELEASE=$(curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/latest" \
  | grep -o '"tag_name": "[^"]*"' | head -1)

if [ -n "$RELEASE" ]; then
  echo "================================================"
  echo "  ✓ Release publicado: $RELEASE"
  echo "  Tus asesores recibirán la actualización"
  echo "  automáticamente al abrir la app."
  echo "================================================"
else
  echo "Publicando release manualmente..."
  DRAFT_ID=$(curl -s -H "Authorization: token $GH_TOKEN" \
    "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases" \
    | python3 -c "import json,sys; r=json.load(sys.stdin); drafts=[x for x in r if x['draft']]; print(drafts[0]['id'] if drafts else '')" 2>/dev/null)

  if [ -n "$DRAFT_ID" ]; then
    curl -s -X PATCH \
      -H "Authorization: token $GH_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"draft":false,"prerelease":false}' \
      "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$DRAFT_ID" > /dev/null
    echo "  ✓ Release publicado exitosamente"
  fi
fi

echo ""
read -p "Presiona Enter para cerrar..."
