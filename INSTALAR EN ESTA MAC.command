#!/bin/bash
echo "================================================"
echo "   Instalando Academic Tareas Monitor..."
echo "================================================"
echo ""

# Buscar la app en ubicaciones comunes
LOCATIONS=(
  "/Applications/Academic Tareas Monitor.app"
  "$HOME/Applications/Academic Tareas Monitor.app"
  "$HOME/Desktop/Academic Tareas Monitor.app"
  "$(dirname "$0")/Academic Tareas Monitor.app"
)

APP_PATH=""
for loc in "${LOCATIONS[@]}"; do
  if [ -d "$loc" ]; then
    APP_PATH="$loc"
    break
  fi
done

if [ -z "$APP_PATH" ]; then
  echo "No se encontró la app. Asegúrate de haberla copiado a Aplicaciones."
  read -p "Presiona Enter para cerrar..."
  exit 1
fi

echo "App encontrada en: $APP_PATH"
echo ""
echo "Quitando restricciones de seguridad..."

# Quitar cuarentena de macOS (permite abrir sin el error "dañado")
xattr -cr "$APP_PATH" 2>/dev/null
spctl --add "$APP_PATH" 2>/dev/null

echo ""
echo "✓ Listo. Abriendo la aplicación..."
open "$APP_PATH"

sleep 2
osascript 2>/dev/null << 'APPLE'
tell application "Terminal"
  tell front window
    close saving no
  end tell
end tell
APPLE
