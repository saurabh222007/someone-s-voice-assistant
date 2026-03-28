@echo off
setlocal
title Alexa Backend Server
cd /d "%~dp0"

echo.
echo ===============================
echo   STARTING BACKEND SERVER
echo ===============================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [X] Python not found in PATH.
  pause
  exit /b 1
)

if not exist "server" (
  echo [X] server folder not found.
  pause
  exit /b 1
)

if not exist "server\.venv" (
  echo [!] Creating virtual environment...
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
  echo [..] First run: installing backend dependencies...
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
  echo [OK] Dependencies already installed. Skipping install.
)

echo [OK] Launching backend at http://127.0.0.1:5000
call "server\.venv\Scripts\activate.bat"
python "server\server.py"

pause
