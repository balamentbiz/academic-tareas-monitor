#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

echo "================================================"
echo "   Academic Tareas Monitor — Crear DMG"
echo "================================================"
echo ""

# Instalar electron-builder si no está
if [ ! -d "node_modules/electron-builder" ]; then
  echo "Instalando electron-builder..."
  npm install --save-dev electron-builder 2>&1
  echo ""
fi

# Generar icns si no existe
if [ ! -f "assets/icon.icns" ] && command -v iconutil &>/dev/null; then
  echo "Generando ícono..."
  ICONSET="/tmp/AT_build.iconset"
  mkdir -p "$ICONSET"
  SRC="Academic Tareas Monitor.app/Contents/Resources/icon.png"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$SRC" --out "$ICONSET/icon_${s}x${s}.png" &>/dev/null
    sips -z $((s*2)) $((s*2)) "$SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" &>/dev/null
  done
  mkdir -p assets
  iconutil -c icns "$ICONSET" -o "assets/icon.icns" &>/dev/null
  rm -rf "$ICONSET"
  echo "Ícono generado."
  echo ""
fi

echo "Construyendo DMG (puede tardar 2-5 minutos)..."
echo ""
npx electron-builder --mac dmg 2>&1

if [ -d "dist" ]; then
  echo ""
  echo "================================================"
  echo "  DMG creado exitosamente en la carpeta dist/"
  echo "================================================"
  ls dist/*.dmg 2>/dev/null
  echo ""
  open dist/ 2>/dev/null
fi

read -p "Presiona Enter para cerrar..."
