#!/usr/bin/env bash
set -euo pipefail

git pull origin main
npm install
pm2 restart football-bot
