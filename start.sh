#!/usr/bin/env bash
# FRAGSTORM starten (Linux / macOS)
#   ./start.sh          oder   bash start.sh
# Nutzt Node.js; falls nicht installiert, Python 3 als Ersatz-Server.
set -e
cd "$(dirname "$0")"

open_browser() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 &
  fi
}

if command -v node >/dev/null 2>&1; then
  if [ ! -f node_modules/ws/package.json ]; then
    echo
    echo "  Installiere Abhaengigkeiten fuer den Mehrspieler-Server (einmalig) ..."
    npm install --omit=dev --no-audit --no-fund
  fi
  echo
  echo "  Starte FRAGSTORM ... der Browser oeffnet sich gleich."
  echo "  Freunde im selben Netz: LAN-Adresse unten aufrufen und ONLINE SPIELEN druecken."
  echo "  Beenden mit Strg+C"
  echo
  exec node serve.mjs "$@"
fi

PY=""
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
fi

if [ -z "$PY" ]; then
  echo
  echo "  Weder Node.js noch Python 3 gefunden."
  echo "  Bitte Node.js installieren: https://nodejs.org"
  echo
  exit 1
fi

PORT="${PORT:-8080}"
echo
echo "  Node.js fehlt - starte Ersatz-Server mit $PY auf http://localhost:$PORT"
echo "  Beenden mit Strg+C"
echo
( sleep 1; open_browser "http://localhost:$PORT" ) &
exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
