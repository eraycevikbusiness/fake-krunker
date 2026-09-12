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

if not exist "node_modules\ws\package.json" (
  echo.
  echo   Installiere Abhaengigkeiten fuer den Mehrspieler-Server ^(einmalig^) ...
  echo.
  call npm install --omit=dev --no-audit --no-fund
)

echo.
echo   Starte FRAGSTORM ... der Browser oeffnet sich gleich.
echo   Freunde im selben Netz: die LAN-Adresse unten aufrufen und ONLINE SPIELEN druecken.
echo   Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
echo.

node serve.mjs
pause
