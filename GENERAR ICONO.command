#!/bin/bash
cd "$(dirname "$0")"

echo "Generando ícono..."

SRC="Academic Tareas Monitor.app/Contents/Resources/icon.png"
TARGET="node_modules/electron/dist/Academic Tareas Monitor.app/Contents/Resources"
ICONSET="/tmp/AT_icon.iconset"

mkdir -p "$ICONSET"

for s in 16 32 128 256 512; do
  sips -z $s $s "$SRC" --out "$ICONSET/icon_${s}x${s}.png" &>/dev/null
  sips -z $((s*2)) $((s*2)) "$SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" &>/dev/null
done

iconutil -c icns "$ICONSET" -o "$TARGET/AppIcon.icns"
rm -rf "$ICONSET"

echo "Limpiando caché de íconos..."
rm -rf ~/Library/Application\ Support/com.apple.sharedfilelist
killall Finder 2>/dev/null
killall Dock 2>/dev/null

echo ""
echo "✓ Listo. El ícono se actualizará en unos segundos."
sleep 2
