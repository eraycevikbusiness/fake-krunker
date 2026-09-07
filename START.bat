@echo off
title KRUNKER CLONE - Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js wurde nicht gefunden.
  echo   Bitte von https://nodejs.org installieren und erneut starten.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starte Server ... der Browser oeffnet sich gleich.
echo   Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
echo.

start "" http://localhost:8080
node serve.mjs
pause
