# Facturier Pro

Générateur de factures et devis professionnel, gratuit et open-source. Fonctionne 100% dans le navigateur — aucun serveur, aucune inscription, aucune donnée transmise.

**[Utiliser l'application](https://brulux777.github.io/facturier)**

## Fonctionnalités

- **Factures & Devis** — Numérotation automatique (éditable), TVA configurable, multi-taux
- **Gestion clients** — Enregistrement et réutilisation des fiches clients
- **PDF professionnel** — Génération et téléchargement de PDF conformes aux normes françaises
- **Historique** — Recherche, filtrage, statut (brouillon/envoyée/payée), duplication
- **Paramètres entreprise** — Logo, coordonnées bancaires, mentions légales
- **Import / Export** — Sauvegarde et restauration de toutes les données (JSON)
- **2 modes de stockage** — Local (navigateur) ou synchronisé sur votre serveur (voir auto-hébergement)

## Confidentialité

- **Démo GitHub Pages** : aucune donnée n'est envoyée à un serveur, tout reste dans le `localStorage` du navigateur.
- **Auto-hébergé (Docker)** : vos données (settings, clients, factures) sont enregistrées dans le conteneur, sur **votre** serveur, protégées par un login. Utilisez l'export JSON pour sauvegarder.

## Stack

- HTML / CSS / JavaScript vanilla — aucun build step
- [pdfmake](https://pdfmake.github.io/docs/) (CDN) — génération PDF vectorielle côté client
- [Inter](https://fonts.google.com/specimen/Inter) (Google Fonts)
- Serveur optionnel : Node.js natif (zéro dépendance npm) — fichiers statiques + API de synchronisation + auth
- Docker (`node:22-alpine`) avec volume de données

## Architecture

```
index.html
login.html      — page de connexion (mode serveur)
style.css
js/
  state.js        — état, persistance (localStorage ou serveur), helpers
  server-sync.js  — détection du backend, redirection login, synchronisation serveur
  settings.js     — paramètres entreprise, logo, import/export
  clients.js      — gestion des fiches clients
  editor.js       — éditeur de facture/devis, lignes, calculs
  pdf.js          — aperçu HTML + génération PDF (pdfmake)
  history.js      — historique, statuts, duplication
  app.js          — initialisation et event bindings
server/
  server.js       — serveur Node : statiques + API /api/state + auth (cookie HMAC)
```

Au chargement, l'app interroge `/api/health` : si un backend répond, elle
passe en **mode serveur** (login + données sur le serveur) ; sinon elle
reste en **mode local** (localStorage). Les données locales existantes
sont migrées vers le serveur au premier lancement auto-hébergé.

En mode serveur, toute page de l'app demandée sans session valide est
redirigée (302) vers `/login.html` — l'app n'est pas servie avant
authentification.

## Utilisation en local (démo statique)

Ouvrir `index.html` dans un navigateur. Aucune installation requise.

## Auto-hébergement (Docker)

```bash
cp .env.example .env
# renseigner AUTH_EMAIL, AUTH_PASSWORD_SHA256, SESSION_SECRET
docker compose up -d --build
```

L'état est persisté dans le volume Docker `facturier_data`
(`/data/state.json`). Variables d'environnement dans `.env` :

| Variable | Rôle |
|---|---|
| `AUTH_EMAIL` | email de connexion |
| `AUTH_PASSWORD_SHA256` | SHA-256 hex du mot de passe (`echo -n 'pass' \| shasum -a 256`) |
| `SESSION_SECRET` | secret HMAC (`openssl rand -hex 32`) |
| `SESSION_TTL_DAYS` | durée de session (déf. 30) |
| `COOKIE_SECURE` | `1` derrière HTTPS |

Le conteneur écoute sur 3000 ; à reverse-proxer derrière nginx/TLS
(ex. `proxy_pass http://127.0.0.1:8105;`).

## Mentions légales

Le template PDF inclut par défaut les mentions obligatoires pour les factures en France :
- Pénalités de retard (3× taux légal)
- Indemnité forfaitaire de recouvrement (40 €)
- Mention d'escompte

Ces mentions sont personnalisables dans les paramètres.

## Licence

MIT
