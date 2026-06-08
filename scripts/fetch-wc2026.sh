#!/usr/bin/env bash
# Télécharge le calendrier CDM 2026 (openfootball, domaine public)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/webapp/data"
curl -fsSL "https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026/worldcup.json" \
  -o "$ROOT/webapp/data/wc2026.json" \
  || curl -fsSL "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json" \
  -o "$ROOT/webapp/data/wc2026.json"
echo "OK: $(wc -c < "$ROOT/webapp/data/wc2026.json") octets -> webapp/data/wc2026.json"
