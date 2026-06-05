#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

SCRIPT_DIR="$(pwd)"
ELECTRON_APP="$SCRIPT_DIR/node_modules/electron/dist/Academic Tareas Monitor.app"
# Fallback al Electron original si no existe el renombrado
[ ! -d "$ELECTRON_APP" ] && ELECTRON_APP="$SCRIPT_DIR/node_modules/electron/dist/Electron.app"
ELECTRON_BIN="$ELECTRON_APP/Contents/MacOS/Electron"

# Verificar que Electron está instalado
if [ ! -f "$ELECTRON_BIN" ]; then
  echo "Instalando... (solo la primera vez)"
  npm install 2>/dev/null
  ARCH=$(uname -m | sed 's/x86_64/x64/')
  ELECTRON_ZIP="electron-v35.4.0-darwin-${ARCH}.zip"
  curl -L --progress-bar "https://github.com/electron/electron/releases/download/v35.4.0/${ELECTRON_ZIP}" -o "/tmp/${ELECTRON_ZIP}"
  mkdir -p "node_modules/electron/dist"
  ditto -x -k "/tmp/${ELECTRON_ZIP}" "node_modules/electron/dist"
  echo "dist/Electron.app/Contents/MacOS/Electron" > "node_modules/electron/path.txt"
  rm "/tmp/${ELECTRON_ZIP}"
fi

# ── Generar ícono personalizado (solo una vez) ──────────────────────────────
APP_BUNDLE="$SCRIPT_DIR/Academic Tareas Monitor.app"
ICNS_DEST="$APP_BUNDLE/Contents/Resources/AppIcon.icns"
SRC_PNG="$SCRIPT_DIR/Academic Tareas Monitor.app/Contents/Resources/icon.png"

if [ ! -f "$ICNS_DEST" ] && command -v iconutil &>/dev/null && [ -f "$SRC_PNG" ]; then
  ICONSET="/tmp/AppIcon_AT.iconset"
  mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$SRC_PNG" --out "$ICONSET/icon_${s}x${s}.png" &>/dev/null
    sips -z $((s*2)) $((s*2)) "$SRC_PNG" --out "$ICONSET/icon_${s}x${s}@2x.png" &>/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$ICNS_DEST" &>/dev/null
  rm -rf "$ICONSET"
  # Refrescar caché de íconos
  touch "$APP_BUNDLE"
fi

# ── Lanzar con 'open -a' ────────────────────────────────────────────────────
open -a "$ELECTRON_APP" --args "$SCRIPT_DIR"

# Cerrar Terminal sin diálogo de confirmación
sleep 0.3
osascript 2>/dev/null << 'APPLE'
tell application "Terminal"
  tell front window
    close saving no
  end tell
end tell
APPLE
