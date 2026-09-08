@echo off
title FRAGSTORM - Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  where python >nul 2>nul
  if errorlevel 1 (
    echo.
    echo   Weder Node.js noch Python wurde gefunden.
    echo   Bitte Node.js von https://nodejs.org installieren und erneut starten.
    echo.
    pause
    exit /b 1
  )
  echo.
  echo   Node.js fehlt - starte Ersatz-Server mit Python auf http://localhost:8080
  echo   Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
  echo.
  start "" http://localhost:8080
  python -m http.server 8080 --bind 127.0.0.1
  pause
  exit /b 0
)

echo.
echo   Starte FRAGSTORM ... der Browser oeffnet sich gleich.
echo   Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
echo.

node serve.mjs
pause
