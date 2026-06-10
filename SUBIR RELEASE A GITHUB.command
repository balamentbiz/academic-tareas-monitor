#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

if [ -f ".env" ]; then export $(grep -v '^#' .env | xargs); fi

VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null)
OWNER="balamentbiz"
REPO="academic-tareas-monitor"
TOKEN="$GH_TOKEN"

echo "================================================"
echo "  Subiendo release v$VERSION a GitHub..."
echo "================================================"
echo ""

DMG="dist/Academic Tareas Monitor-${VERSION}-arm64.dmg"
ZIP="dist/Academic Tareas Monitor-${VERSION}-arm64-mac.zip"
YML="dist/latest-mac.yml"

if [ ! -f "$DMG" ]; then
  echo "ERROR: No se encontró el DMG en dist/"
  echo "Primero corre CREAR DMG.command"
  read -p "Enter para cerrar..."; exit 1
fi

# Eliminar release existente si hay una con el mismo tag
echo "Verificando releases existentes..."
EXISTING=$(curl -s -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/releases/tags/v$VERSION" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

if [ -n "$EXISTING" ] && [ "$EXISTING" != "None" ]; then
  echo "Eliminando release anterior v$VERSION..."
  curl -s -X DELETE -H "Authorization: token $TOKEN" \
    "https://api.github.com/repos/$OWNER/$REPO/releases/$EXISTING" > /dev/null
fi

# Eliminar tag existente
git push https://${OWNER}:${TOKEN}@github.com/${OWNER}/${REPO}.git --delete "v$VERSION" 2>/dev/null || true

# Crear nuevo release
echo "Creando release v$VERSION..."
RELEASE=$(curl -s -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"tag_name\":\"v$VERSION\",\"name\":\"v$VERSION\",\"draft\":false,\"prerelease\":false,\"body\":\"Academic Tareas Monitor v$VERSION\"}" \
  "https://api.github.com/repos/$OWNER/$REPO/releases")

RELEASE_ID=$(echo "$RELEASE" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null)
UPLOAD_URL=$(echo "$RELEASE" | python3 -c "import json,sys; print(json.load(sys.stdin)['upload_url'].replace('{?name,label}',''))" 2>/dev/null)

if [ -z "$RELEASE_ID" ]; then
  echo "ERROR: No se pudo crear el release."
  echo "$RELEASE"
  read -p "Enter para cerrar..."; exit 1
fi

echo "Release creado (ID: $RELEASE_ID)"
echo ""

upload_file() {
  local file="$1"
  local name="$2"
  local type="$3"
  echo "Subiendo $name..."
  curl -s -X POST \
    -H "Authorization: token $TOKEN" \
    -H "Content-Type: $type" \
    --data-binary @"$file" \
    "${UPLOAD_URL}?name=${name}" > /dev/null
  echo "  ✓ $name"
}

upload_file "$DMG"  "Academic-Tareas-Monitor-${VERSION}-arm64.dmg"         "application/octet-stream"
upload_file "$ZIP"  "Academic-Tareas-Monitor-${VERSION}-arm64-mac.zip"      "application/zip"

# Actualizar latest-mac.yml con la versión correcta
DMG_SIZE=$(wc -c < "$DMG" | tr -d ' ')
DMG_SHA=$(shasum -a 512 "$DMG" | awk '{print $1}' | xxd -r -p | base64)
cat > "$YML" << EOF
version: $VERSION
files:
  - url: Academic-Tareas-Monitor-${VERSION}-arm64.dmg
    sha512: $DMG_SHA
    size: $DMG_SIZE
path: Academic-Tareas-Monitor-${VERSION}-arm64.dmg
sha512: $DMG_SHA
releaseDate: '$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'
EOF

upload_file "$YML" "latest-mac.yml" "application/octet-stream"

echo ""
echo "================================================"
echo "  ✓ Release v$VERSION publicado en GitHub"
echo "  github.com/$OWNER/$REPO/releases"
echo "================================================"
read -p "Presiona Enter para cerrar..."
