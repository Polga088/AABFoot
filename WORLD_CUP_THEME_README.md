# World Cup Matchday Theme — Foot AAB

Thème visuel **World Cup Matchday** pour l'application Flask Foot AAB (sans modification de la logique métier).

## Palette

| Token | Valeur |
|-------|--------|
| `--wc-bg` | `#06111F` |
| `--wc-red` | `#C8102E` (Maroc / compétition) |
| `--wc-green` | `#00843D` (terrain) |
| `--wc-gold` | `#D4AF37` (trophée) |

## Polices

- **Titres** : Oswald (Google Fonts)
- **Texte** : Montserrat (Google Fonts)

## Assets

- `webapp/static/brand/worldcup/logo-worldcup.svg`
- `webapp/static/brand/worldcup/favicon.svg`
- `webapp/static/brand/worldcup/stadium-pattern.svg`
- `webapp/static/img/wc/flags/*.png`

## CSS

- `webapp/static/css/wc-global-theme.css` — thème global (toutes les pages)
- `webapp/static/css/worldcup.css` — page CDM 2026

## Classes utiles

- `wc-app-shell` — enveloppe stade
- `wc-card` / `.card` — glassmorphism
- `wc-button-primary` / `.btn-primary` — CTA gradient
- `wc-badge-live` — statut LIVE
- `wc-score-card` — carte score
- `wc-gradient-text` — texte dégradé rouge/vert/or

## Intégration

Le thème est chargé dans `webapp/templates/base.html` :

```html
<link rel="stylesheet" href="{{ url_for('static', filename='css/wc-global-theme.css') }}">
```

## Script

```bash
bash scripts/apply-worldcup-theme.sh
```

## Déploiement VPS

```bash
cd /opt/football-bot
git pull origin main
bash scripts/apply-worldcup-theme.sh
pm2 restart football-webapp
```

## Règles

- Ne pas modifier routes, API, auth, base de données
- Uniquement CSS, templates layout, assets statiques
