---
name: aabfoot-project
description: >-
  Foot AAB / MATCHCUP 26 — bot WhatsApp (Node) + webapp Flask + SQLite partagée.
  Use for any change in this repo: polls, wallet, joueurs, finance, calendrier,
  déploiement VPS, normalisation téléphone 06/212, bot_tasks, ou debug 502/pm2.
---

# AABFoot — contexte projet

## Stack

| Composant | Chemin | Runtime |
|-----------|--------|---------|
| Bot WhatsApp | `src/` | Node, `whatsapp-web.js`, PM2 `football-bot` |
| Webapp | `webapp/` | Flask + gunicorn `127.0.0.1:5000`, PM2 `football-webapp` |
| Base | `football.db` | SQLite **partagée** bot + webapp |
| Config | `.env` | Jamais committer |

VPS prod : `/opt/football-bot` — domaine `foot.omjep.ma` (nginx → gunicorn:5000).

## Déploiement (après chaque push `main`)

```bash
cd /opt/football-bot && git pull origin main
pm2 restart football-bot football-webapp
curl -s http://127.0.0.1:5000/health   # {"status":"ok"}
```

## Téléphones Maroc (règle métier)

- `0663104773` ≡ `212663104773` ≡ `212663104773@c.us`
- Canonique stocké : `212XXXXXXXXX@c.us` (préfixe `212[67]`, 12 chiffres)
- **Rejeter** les LID WhatsApp (`137220044378212@c.us`) — pas un vrai numéro
- Utils : `src/utils/phone.js`, `webapp/phone_utils.py`
- Auth / recherche joueur : variantes via `getPhoneLookupVariants` / `normalize_phone_candidates`

## Vote sondage (critique)

- `src/modules/poll.js` → `findRegisteredPlayerForVote` — **ne jamais** auto-créer un joueur au vote
- Cotisation : `matchCotisation.js` + `app_settings.default_cotisation` / `players.cotisation_amount`
- Capacité : 6v6=12, 7v7=14 votes « Oui »

## Tâches bot asynchrones (`bot_tasks`)

| task_type | Fichier |
|-----------|---------|
| `group_scan` | `src/modules/groupScanTask.js` |
| `wallet_reminder` | `src/jobs/queue.js` |
| `cotisation_report` | `src/modules/financeTasks.js` |

Déclenchées depuis la webapp (INSERT `bot_tasks` status `pending`).

## Pages webapp clés

- `/connexion` — PIN joueur, numéro 06 ou 212
- `/joueurs` — admin, scan groupe, `display_name` admin-only
- `/finance` — cotisation globale, import CSV, rappels wallet
- `/calendrier` — sondages WhatsApp (admin)
- `/matchs` — historique simple

Admin : session `is_admin` ou header `X-Admin-Token` = `ADMIN_TOKEN`.

## Debug rapide

| Symptôme | Vérifier |
|----------|----------|
| 502 nginx | `pm2 logs football-webapp` — gunicorn crash au boot ? |
| Sondage absent | `GROUP_ID` finit par `@g.us`, bot connecté 15s avant publish |
| Vote ignoré | Joueur absent de `/joueurs` ou LID non résolu |
| Wallet non débité | `findRegisteredPlayerForVote` + téléphone canonique en base |

Utiliser le skill `systematic-debugging` avant de patcher.

## Tests webapp

Skill `webapp-testing` — serveur local :

```bash
cd webapp
python .agents/skills/webapp-testing/scripts/with_server.py \
  --server "venv/bin/gunicorn -w 1 -b 127.0.0.1:5000 wsgi:app" --port 5000 \
  -- python your_playwright_script.py
```

Smoke : `GET /health`, `GET /connexion`, admin `/joueurs` avec token.

## Git

Règle projet : pousser sur `main` après chaque lot de changements (voir `.cursor/rules/git-push-github.mdc`).
Exclure : `.env`, `football.db`, `node_modules/`, `.DS_Store`.
