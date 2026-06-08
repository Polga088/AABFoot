# MATCHCUP 26 — Official-Inspired Theme

Thème visuel inspiré de la Coupe du Monde 2026 (tri-host USA · Mexico · Canada).
**Sans logo FIFA officiel** — branding propriétaire MatchCup.

## Palette

| Token | Valeur |
|-------|--------|
| `--wc26-black` | `#050505` |
| `--wc26-white` | `#F7F4EF` |
| `--wc26-red` | `#D71920` |
| `--wc26-green` | `#00A651` |
| `--wc26-blue` | `#0046AD` |
| `--wc26-gold` | `#C9A227` |

## Polices

- **Titres** : Archivo Black
- **Texte** : Montserrat

## Fichiers

- `webapp/static/brand/worldcup26/matchcup26-logo.svg`
- `webapp/static/brand/worldcup26/favicon.svg`
- `webapp/static/brand/worldcup26/wc26-pattern.svg`
- `webapp/static/css/wc26-official-inspired.css` — thème global clair
- `webapp/static/css/worldcup.css` — page `/coupe-du-monde`

## Activation

Déjà actif dans `webapp/templates/base.html` :

```html
<link rel="stylesheet" href="{{ url_for('static', filename='css/wc26-official-inspired.css') }}">
```

## Script

```bash
bash scripts/apply-worldcup-2026-official-inspired-theme.sh
```

## Déploiement VPS

```bash
cd /opt/football-bot
git pull origin main
bash scripts/apply-worldcup-2026-official-inspired-theme.sh
pm2 restart football-webapp
```

## Règles

- UI uniquement (templates + CSS + assets)
- Aucune modification routes, Python, API, base de données
