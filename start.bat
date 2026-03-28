@echo off
setlocal
title Alexa Assistant Launcher
cd /d "%~dp0"

echo.
echo ============================================
echo         ALEXA ASSISTANT LAUNCHER
echo ============================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [X] Python not found in PATH.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [X] npm not found in PATH.
  pause
  exit /b 1
)

if not exist "server" (
  echo [X] server folder not found.
  pause
  exit /b 1
)

echo [1/4] Preparing backend venv...
if not exist "server\.venv" (
  python -m venv "server\.venv"
  if errorlevel 1 (
    echo [X] Failed to create virtual environment.
    pause
    exit /b 1
  )
)

for /d %%D in ("server\.venv\Lib\site-packages\~*") do rmdir /s /q "%%~fD" >nul 2>&1
for %%F in ("server\.venv\Lib\site-packages\~*") do del /f /q "%%~fF" >nul 2>&1

if not exist "server\.venv\.deps_ready" (
  echo [2/4] Installing backend dependencies (first run)...
  "server\.venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -U pip
  "server\.venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r "server\requirements.txt"
  "server\.venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -U yt-dlp
  if errorlevel 1 (
    echo [X] Backend dependency installation failed.
    pause
    exit /b 1
  )
  echo ok>"server\.venv\.deps_ready"
) else (
  echo [2/4] Backend dependencies OK.
)

echo [3/4] Preparing frontend dependencies...
if not exist "node_modules" (
  call npm install
)

echo [4/4] Starting backend...
start "Alexa Backend" cmd /k "cd /d \"%~dp0\" && call server\.venv\Scripts\activate.bat && python server\server.py"
timeout /t 2 /nobreak >nul

echo [..] Starting UI...
start "Alexa UI" cmd /k "cd /d \"%~dp0\" && npm run dev"

echo.
echo [OK] Launch complete.
echo Open: http://localhost:5173
echo.
exit /b 0
