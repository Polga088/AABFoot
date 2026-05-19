#!/usr/bin/env bash
# Arrete les processus Chrome/Puppeteer qui bloquent la session WhatsApp du bot.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_DIR="$ROOT_DIR/.wwebjs_auth"

echo "Arret des processus lies a FootBot..."

pkill -f "$SESSION_DIR" 2>/dev/null || true
pkill -f "football-bot.*src/index.js" 2>/dev/null || true

sleep 1

for lock in SingletonLock SingletonSocket SingletonCookie; do
  rm -f "$SESSION_DIR/session/$lock" 2>/dev/null || true
done

if pgrep -f "$SESSION_DIR" >/dev/null 2>&1; then
  echo "Attention: un processus utilise encore $SESSION_DIR"
  pgrep -fl "$SESSION_DIR" || true
  exit 1
fi

echo "OK — vous pouvez relancer: npm run dev"
