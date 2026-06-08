#!/usr/bin/env bash
# World Cup Matchday Theme — Foot AAB (Flask)
# Génère / vérifie les assets du thème. Aucune logique métier modifiée.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRAND="$ROOT/webapp/static/brand/worldcup"
CSS="$ROOT/webapp/static/css/wc-global-theme.css"

echo "🏆 World Cup Matchday Theme — Foot AAB"

mkdir -p "$BRAND" "$ROOT/webapp/static/img/wc/flags"

# Assets SVG (idempotent)
for f in logo-worldcup.svg favicon.svg stadium-pattern.svg; do
  if [[ -f "$BRAND/$f" ]]; then
    echo "  ✓ $f"
  else
    echo "  ⚠ manquant: $BRAND/$f — relancez le déploiement git pull"
  fi
done

if [[ -f "$CSS" ]]; then
  echo "  ✓ wc-global-theme.css"
else
  echo "  ✗ wc-global-theme.css introuvable"
  exit 1
fi

# Drapeaux hôtes + Maroc
for code in us mx ca ma; do
  dest="$ROOT/webapp/static/img/wc/flags/${code}.png"
  if [[ ! -f "$dest" ]]; then
    curl -fsSL "https://flagcdn.com/w80/${code}.png" -o "$dest" || true
  fi
done

echo ""
echo "✅ Thème Matchday prêt."
echo "   Déploiement: git pull origin main && pm2 restart football-webapp"
echo "   Doc: WORLD_CUP_THEME_README.md"
