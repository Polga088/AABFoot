#!/usr/bin/env bash
# Dependances systeme pour Chrome / Puppeteer (WhatsApp Web) sur Ubuntu 22.04+
set -euo pipefail

echo "==> Dependances Chrome pour le bot WhatsApp"
sudo apt update
sudo apt install -y \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  wget \
  xdg-utils

if command -v chromium-browser >/dev/null 2>&1; then
  echo "OK: chromium-browser -> $(command -v chromium-browser)"
elif command -v chromium >/dev/null 2>&1; then
  echo "OK: chromium -> $(command -v chromium)"
else
  echo "Installation chromium via snap/apt..."
  sudo apt install -y chromium-browser || sudo apt install -y chromium
fi

echo ""
echo "Ajoutez dans /opt/football-bot/.env (si besoin) :"
echo "PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser"
echo ""
echo "Puis: pm2 restart football-bot && pm2 logs football-bot"
