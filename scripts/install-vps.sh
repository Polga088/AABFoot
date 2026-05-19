#!/usr/bin/env bash
set -euo pipefail

echo "==> Mise a jour systeme"
sudo apt update && sudo apt upgrade -y

echo "==> Installation prerequis"
sudo apt install -y curl git build-essential

echo "==> Installation Node.js 20 LTS (NodeSource)"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

echo "==> Installation PM2"
sudo npm install -g pm2

echo "==> Dependances Chrome / Puppeteer (WhatsApp)"
bash "$(dirname "$0")/install-chrome-deps.sh"

echo "==> Installation Ollama"
curl -fsSL https://ollama.com/install.sh | sh

echo "==> Demarrage Ollama"
nohup ollama serve >/tmp/ollama.log 2>&1 &

echo "==> Telechargement modele llama3.2 (~2GB)"
ollama pull llama3.2

echo "==> Installation dependances projet"
cd /opt/football-bot
npm install

echo "==> Demarrage PM2"
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo "Installation VPS terminee."
