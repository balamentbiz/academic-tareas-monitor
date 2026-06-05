@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Academic Tareas Monitor

echo ================================================
echo    Academic Tareas Monitor
echo ================================================
echo.

:: Verificar Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js no encontrado. Descargando instalador...
    echo Visita https://nodejs.org y descarga la version LTS
    echo Luego vuelve a ejecutar este archivo.
    pause
    start https://nodejs.org
    exit /b 1
)

echo Node.js %node -e "process.version"% encontrado
echo.

:: Instalar dependencias si faltan
if not exist "node_modules\electron" (
    echo Instalando dependencias (solo la primera vez)...
    npm install
    echo.
)

echo Iniciando Academic Tareas Monitor...
echo.

:: Lanzar la app
node_modules\.bin\electron .

echo.
pause
