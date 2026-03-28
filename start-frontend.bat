@echo off
setlocal
title Alexa Frontend UI
cd /d "%~dp0"

echo.
echo ===============================
echo   STARTING FRONTEND UI
echo ===============================
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo [X] npm not found in PATH.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [X] package.json not found.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [..] Installing frontend dependencies...
  call npm install
  if errorlevel 1 (
    echo [X] Frontend dependency installation failed.
    pause
    exit /b 1
  )
)

echo [OK] Launching UI (Vite)...
echo Open: http://localhost:5173
call npm run dev

pause
