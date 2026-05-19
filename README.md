# Football Bot WhatsApp

Bot WhatsApp de gestion d'equipe de football amateur (wallet, disponibilites, lineup, rappels automatiques) avec stack 100% gratuite et open source.

## Local

1. `npm install`
2. `ollama pull llama3.2`
3. `cp .env.example .env` -> remplis `ADMIN_PHONE`
4. `npm run dev` -> scanne le QR avec WhatsApp
5. Envoie `!join MonNom` depuis ton telephone pour te creer

## VPS

1. `ssh user@IP_VPS`
2. `git clone [repo] /opt/football-bot`
3. `bash scripts/install-vps.sh`
4. `cp .env.example .env && nano .env`
5. `pm2 start ecosystem.config.js`
6. `pm2 logs football-bot` -> recupere le QR code dans les logs
7. Scanne depuis WhatsApp

## Calendrier + sondages WhatsApp

1. Definir `ADMIN_TOKEN` et `GROUP_ID` dans `.env`
2. Lancer le bot (`npm run dev`) et la webapp (`python webapp/app.py`)
3. Ouvrir [http://localhost:5000/calendrier](http://localhost:5000/calendrier)
4. Creer un **entrainement** (semaine) ou un **match** (adversaire obligatoire)
5. Cocher « Envoyer le sondage » : le bot poste un sondage natif (Oui / Non / Peut-etre)
6. Les joueurs votent dans le groupe — **pas besoin de `!join`**
7. Apres les votes : **Generer lineup** puis **MP gilets + infos** (date, heure, Google Maps, couleur)

Le token admin est demande une fois dans le navigateur (stocke en local).

## Pages admin

- `/joueurs` — liste, ajout, modification (prenom, nom, telephone)
- `/finance` — crediter un solde, import/export CSV, historique
- `/calendrier` — modifier / supprimer / republier un sondage WhatsApp

## Cotisation au vote (defaut)

Dans `.env` : `COTISATION_ON_VOTE=1` et `COTISATION_AMOUNT=10`

- Vote **Oui** sur le sondage → **-10 dh** du wallet
- Vote **Non** ou **Peut-etre** → solde inchange
- Alimentation libre du solde via page Finance ou import CSV

## Probleme envoi sondage (erreur `t` ou `Execution context was destroyed`)

1. Arreter proprement: `Ctrl+C` puis `npm run stop`
2. Relancer: `npm run dev`
3. Attendre **✅ FootBot connecté !** puis **15 secondes** avant de publier le sondage
4. Verifier que `GROUP_ID` finit bien par `@g.us` (ex: `120363...@g.us`, **pas** `@c.us`)

### Trouver le bon GROUP_ID

Au demarrage, le bot affiche la liste des groupes dans le terminal.

Ou dans le **groupe equipe** WhatsApp, envoyez :
```
!groupid
```
Copiez la valeur dans `.env`, redemarrez le bot (`npm run dev`).

## Probleme « browser is already running »

Une instance Chrome est restee ouverte apres un arret brutal (Ctrl+C).

```bash
npm run stop
npm run dev
```

## Commandes utiles

- `npm run stop`             # liberer la session Chrome du bot
- `pm2 logs football-bot`    # voir les logs en temps reel
- `pm2 restart football-bot` # redemarrer
- `pm2 monit`                # monitoring

## Webapp

### Installation locale

```bash
cd webapp
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

-> [http://localhost:5000](http://localhost:5000)

### VPS

```bash
bash scripts/start.sh
```
