#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

if [ -f ".env" ]; then export $(grep -v '^#' .env | xargs); fi

echo "Subiendo v1.3.9 a GitHub..."

# Eliminar lock si existe
rm -f .git/index.lock 2>/dev/null

git config user.email "academicsolutionsmx@gmail.com"
git config user.name "balamentbiz"
git add -A
git commit -m "v1.3.9 - version estable" 2>/dev/null || echo "(sin cambios nuevos)"
git push https://balamentbiz:${GH_TOKEN}@github.com/balamentbiz/academic-tareas-monitor.git 2>&1

echo ""
echo "✓ Listo. Código subido a GitHub."
read -p "Presiona Enter para cerrar..."
