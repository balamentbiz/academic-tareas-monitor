#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  ACADEMIC TAREAS — Publicar interfaz (Firebase Hosting)
#
#  Sube la carpeta renderer/ a Firebase Hosting.
#  TODOS los usuarios (Mac y Windows) ven los cambios al instante
#  la próxima vez que abran la app o cambien de vista.
#  No hace falta reinstalar nada.
#
#  Primera vez: se instalará firebase-tools y pedirá iniciar
#  sesión con tu cuenta de Google (la del proyecto Firebase).
# ═══════════════════════════════════════════════════════════════
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

echo "════════════════════════════════════════════════"
echo "  Academic Tareas — Publicar interfaz (Hosting)"
echo "════════════════════════════════════════════════"
echo ""

# Instalar firebase-tools si no existe
if ! command -v firebase >/dev/null 2>&1; then
  echo "→ Instalando firebase-tools (solo la primera vez)..."
  npm install -g firebase-tools || { echo "ERROR instalando firebase-tools"; read -p "Enter para salir..."; exit 1; }
fi

# Login si hace falta
firebase projects:list >/dev/null 2>&1 || firebase login

echo ""
echo "→ Publicando renderer/ en https://academic-tareas-monitor.web.app ..."
firebase deploy --only hosting || { echo "ERROR al publicar"; read -p "Enter para salir..."; exit 1; }

echo ""
echo "✓ Interfaz publicada. Los usuarios la verán al reabrir la app."
read -p "Enter para cerrar..."
