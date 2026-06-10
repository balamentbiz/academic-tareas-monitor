#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

if [ -f ".env" ]; then export $(grep -v '^#' .env | xargs); fi

echo "================================================"
echo "  Subiendo v1.3.9 a GitHub (force push)"
echo "================================================"

# Limpiar locks
rm -f .git/index.lock .git/MERGE_HEAD 2>/dev/null

# Configurar identidad
git config user.email "academicsolutionsmx@gmail.com"
git config user.name "balamentbiz"

# Ver estado
echo ""
echo "Cambios detectados:"
git status --short

# Commit
git add -A
git commit -m "v1.3.9 - revert estable" 2>/dev/null || echo "(nada nuevo que commitear)"

# Force push — sobreescribe lo que haya en GitHub
echo ""
echo "Haciendo push a GitHub..."
git push --force https://balamentbiz:${GH_TOKEN}@github.com/balamentbiz/academic-tareas-monitor.git main 2>&1

echo ""
echo "================================================"
echo "  Listo. Verifica en github.com que main.js"
echo "  ya no diga v1.4.4 en el historial."
echo "================================================"
read -p "Presiona Enter para cerrar..."
