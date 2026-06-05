#!/bin/bash
echo "================================================"
echo "   Desinstalar Academic Tareas Monitor"
echo "================================================"
echo ""
echo "¿Estás seguro de que quieres desinstalar la aplicación?"
echo "Se eliminarán la app y todos sus datos."
echo ""
read -p "Escribe SI para confirmar: " CONFIRM

if [ "$CONFIRM" != "SI" ] && [ "$CONFIRM" != "si" ] && [ "$CONFIRM" != "sí" ] && [ "$CONFIRM" != "Sí" ]; then
  echo ""
  echo "Desinstalación cancelada."
  sleep 2
  exit 0
fi

echo ""
echo "Desinstalando..."

# Cerrar la app si está corriendo
pkill -f "Academic Tareas Monitor" 2>/dev/null
pkill -f "Electron" 2>/dev/null
sleep 1

# Eliminar la app de Aplicaciones
if [ -d "/Applications/Academic Tareas Monitor.app" ]; then
  rm -rf "/Applications/Academic Tareas Monitor.app"
  echo "✓ App eliminada de Aplicaciones"
fi

# Eliminar datos de usuario (sesiones, reportes guardados)
DATA_DIR="$HOME/Library/Application Support/academic-tareas-monitor"
if [ -d "$DATA_DIR" ]; then
  rm -rf "$DATA_DIR"
  echo "✓ Datos de sesiones eliminados"
fi

# Eliminar preferencias
rm -f "$HOME/Library/Preferences/com.academictareas.monitor.plist" 2>/dev/null
rm -rf "$HOME/Library/Application Support/Caches/com.academictareas.monitor" 2>/dev/null
rm -rf "$HOME/Library/Saved Application State/com.academictareas.monitor.savedState" 2>/dev/null
echo "✓ Preferencias eliminadas"

# Limpiar caché de íconos
killall Dock 2>/dev/null
killall Finder 2>/dev/null

echo ""
echo "================================================"
echo "  ✓ Academic Tareas Monitor desinstalado"
echo "    completamente de esta Mac."
echo "================================================"
echo ""
sleep 3
