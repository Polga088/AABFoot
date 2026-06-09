# Agent Skills — Foot AAB

Skills installés depuis [skills.sh](https://skills.sh) pour Cursor. Verrouillage : `skills-lock.json`.

## Réinstaller / mettre à jour

```bash
npx skills experimental_install   # depuis skills-lock.json
# ou une skill précise :
npx skills add obra/superpowers@systematic-debugging -a cursor -y
```

## Skills installés

| Skill | Source | Quand l'utiliser |
|-------|--------|------------------|
| **aabfoot-project** | local | Tout changement dans ce repo — architecture, déploiement, règles métier |
| **systematic-debugging** | [obra/superpowers](https://skills.sh/obra/superpowers/systematic-debugging) | Bugs, 502, bot déconnecté, votes/wallet — cause racine avant fix |
| **verification-before-completion** | [obra/superpowers](https://skills.sh/obra/superpowers/verification-before-completion) | Avant commit/push — vérifier que le fix fonctionne vraiment |
| **webapp-testing** | [anthropics/skills](https://skills.sh/anthropics/skills/webapp-testing) | Tests Playwright de la webapp Flask (`/connexion`, `/finance`, etc.) |
| **flask-python** | [mindrally/skills](https://skills.sh/mindrally/skills/flask-python) | Nouvelles routes, blueprints, patterns Flask |
| **ui-ux-pro-max** | [nextlevelbuilder/ui-ux-pro-max-skill](https://skills.sh/nextlevelbuilder/ui-ux-pro-max-skill/ui-ux-pro-max) | UI/UX, animations, accessibilité, modernisation thème |

## Emplacement

```
.agents/skills/
├── aabfoot-project/      # spécifique projet
├── systematic-debugging/
├── verification-before-completion/
├── webapp-testing/
├── flask-python/
└── ui-ux-pro-max/
```

## Ajouter une skill

```bash
npx skills find <mot-clé>
npx skills add <owner/repo@skill> -a cursor -y
git add .agents/skills skills-lock.json && git commit && git push origin main
```
