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

# Usar npx: no requiere instalación global ni permisos de administrador.
# La primera vez descarga firebase-tools a la caché del usuario (~1-2 min).
FB="npx -y firebase-tools"

# Login si hace falta (abre el navegador la primera vez)
$FB projects:list >/dev/null 2>&1 || $FB login

echo ""
echo "→ Publicando interfaz + reglas de seguridad de Firestore ..."
$FB deploy --only hosting,firestore:rules || { echo "ERROR al publicar"; read -p "Enter para salir..."; exit 1; }

echo ""
echo "✓ Interfaz publicada. Los usuarios la verán al reabrir la app."
read -p "Enter para cerrar..."
