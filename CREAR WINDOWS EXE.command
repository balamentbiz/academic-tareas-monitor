#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

if [ -f ".env" ]; then export $(grep -v '^#' .env | xargs); fi

VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null)

echo "================================================"
echo "   Crear y subir instalador Windows v$VERSION"
echo "================================================"
echo ""

# Reparar icon.ico si es muy pequeño
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
" 2>/dev/null || echo "(continuando sin reparar icono...)"

# Instalar Wine si es necesario
if ! command -v wine &>/dev/null; then
  echo "Instalando Wine (necesario para compilar Windows desde Mac)..."
  if ! command -v brew &>/dev/null; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  brew install --cask wine-stable
  echo ""
fi

echo "Construyendo instalador Windows..."
echo "(puede tardar 5-10 minutos)"
echo ""

npx electron-builder --win nsis --x64 2>&1

EXE=$(ls dist/*Setup*.exe 2>/dev/null | head -1)
if [ -z "$EXE" ]; then
  EXE=$(ls dist/*.exe 2>/dev/null | head -1)
fi

if [ -z "$EXE" ]; then
  echo "ERROR: No se generó el .exe"
  read -p "Enter para cerrar..."; exit 1
fi

echo ""
echo "✓ EXE generado: $EXE"
echo ""
echo "Subiendo a GitHub release v$VERSION..."

RELEASE_ID=$(curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/balamentbiz/academic-tareas-monitor/releases/tags/v$VERSION" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

if [ -z "$RELEASE_ID" ]; then
  echo "No se encontró release v$VERSION en GitHub."
  echo "Primero corre PUBLICAR ACTUALIZACION.command"
  open dist/
  read -p "Enter para cerrar..."; exit 1
fi

EXE_NAME=$(basename "$EXE" | sed 's/ /-/g')
curl -s -X POST \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$EXE" \
  "https://uploads.github.com/repos/balamentbiz/academic-tareas-monitor/releases/$RELEASE_ID/assets?name=$EXE_NAME" > /dev/null

echo ""
echo "================================================"
echo "  ✓ Windows .exe subido al release v$VERSION"
echo "  github.com/balamentbiz/academic-tareas-monitor/releases"
echo "================================================"
read -p "Presiona Enter para cerrar..."
