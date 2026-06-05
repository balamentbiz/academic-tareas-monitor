#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

echo "================================================"
echo "   Academic Tareas Monitor — Crear instalador Windows"
echo "================================================"
echo ""

# Verificar wine (necesario para compilar para Windows desde Mac)
if ! command -v wine &>/dev/null; then
  echo "Instalando Wine (necesario para compilar Windows desde Mac)..."
  echo "Esto puede tardar varios minutos..."

  # Instalar Homebrew si no existe
  if ! command -v brew &>/dev/null; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  brew install --cask wine-stable
  echo ""
fi

# Instalar electron-builder si no está
if [ ! -d "node_modules/electron-builder" ]; then
  echo "Instalando electron-builder..."
  npm install --save-dev electron-builder 2>&1
  echo ""
fi

echo "Construyendo instalador Windows (.exe)..."
echo "Puede tardar 5-10 minutos..."
echo ""

npx electron-builder --win nsis --x64 2>&1

if ls dist/*.exe &>/dev/null; then
  echo ""
  echo "================================================"
  echo "  ✓ Instalador Windows creado en dist/"
  echo "================================================"
  ls dist/*.exe
  echo ""
  open dist/
else
  echo ""
  echo "Si falló la compilación cruzada, usa el método alternativo:"
  echo "Envía la carpeta del proyecto a tu amigo con Windows"
  echo "y que ejecute INICIAR EN WINDOWS.bat"
fi

read -p "Presiona Enter para cerrar..."
