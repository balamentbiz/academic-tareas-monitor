#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

echo "================================================"
echo "   Academic Tareas Monitor — Publicar actualización"
echo "================================================"
echo ""

# Cargar token desde .env
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "$GH_TOKEN" ]; then
  echo "ERROR: No se encontró el token de GitHub en .env"
  read -p "Presiona Enter para cerrar..."; exit 1
fi

# Leer versión actual
CURRENT=$(node -e "console.log(require('./package.json').version)" 2>/dev/null)
echo "Versión actual: $CURRENT"
echo ""
echo "¿Cuál es la nueva versión? (ej: 1.1.0) — Enter para mantener $CURRENT:"
read -r NEW_VERSION

if [ -n "$NEW_VERSION" ] && [ "$NEW_VERSION" != "$CURRENT" ]; then
  # Actualizar versión en package.json
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json'));
    pkg.version = '$NEW_VERSION';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
    console.log('Versión actualizada a $NEW_VERSION');
  "
fi

echo ""
echo "Instalando dependencias necesarias..."
npm install --save electron-updater 2>&1 | grep -E "added|updated|error" | head -5
echo ""

echo "Construyendo y publicando en GitHub..."
echo "(puede tardar 5-10 minutos)"
echo ""

npx electron-builder --mac dmg --publish always 2>&1

echo ""
if [ $? -eq 0 ]; then
  echo "================================================"
  echo "  ✓ Versión publicada exitosamente en GitHub"
  echo ""
  echo "  Tus asesores verán la actualización"
  echo "  automáticamente al abrir la app."
  echo "================================================"
else
  echo "Hubo un error. Revisa tu conexión a internet."
fi

echo ""
read -p "Presiona Enter para cerrar..."
