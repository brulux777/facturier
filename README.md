# Facturier Pro

Générateur de factures et devis professionnel, gratuit et open-source. Fonctionne 100% dans le navigateur — aucun serveur, aucune inscription, aucune donnée transmise.

**[Utiliser l'application](https://brulux777.github.io/facturier)**

## Fonctionnalités

- **Factures & Devis** — Numérotation automatique (éditable), TVA configurable, multi-taux
- **Mentions HT/TTC toujours présentes** — même en TVA non applicable (art. 293 B), les totaux affichent Total HT et Total TTC
- **Cahier des charges** — Markdown optionnel avec 3 emplacements au choix : intégré à la facture, en annexe sur une page séparée du même PDF, ou dans un second PDF téléchargé à part
- **Paiement en 3 fois** — activable/désactivable par document, échéancier mensuel automatique (montants + dates)
- **Gestion clients** — Enregistrement et réutilisation des fiches clients
- **PDF professionnel** — Génération et téléchargement de PDF conformes aux normes françaises
- **Historique** — Recherche, filtrage, statut (brouillon/envoyée/payée), duplication
- **Paramètres entreprise** — Logo, coordonnées bancaires, mentions légales, bouton Enregistrer
- **Import / Export** — Sauvegarde et restauration de toutes les données (JSON)
- **2 modes de stockage** — Local (navigateur) ou synchronisé sur votre serveur PostgreSQL (voir auto-hébergement)

## Confidentialité

- **Démo GitHub Pages** : aucune donnée n'est envoyée à un serveur, tout reste dans le `localStorage` du navigateur.
- **Auto-hébergé (Docker)** : vos données (settings, clients, factures) sont enregistrées dans **PostgreSQL**, sur **votre** serveur, protégées par un login. Utilisez l'export JSON pour sauvegarder.

## Stack

- HTML / CSS / JavaScript vanilla — aucun build step
- [pdfmake](https://pdfmake.github.io/docs/) (CDN) — génération PDF vectorielle côté client
- [Inter](https://fonts.google.com/specimen/Inter) (Google Fonts)
- Serveur optionnel : Node.js — fichiers statiques + API de synchronisation + auth (dépendance `pg`)
- Docker : `node:22-alpine` (web) + `postgres:16-alpine` (base de données, volume dédié)

## Architecture

```
index.html           — app (route /)
login.html           — page de connexion (mode serveur)
style.css
js/
  state.js        — état, persistance (localStorage ou serveur), routing des vues
  server-sync.js  — détection du backend, redirection login, synchronisation serveur
  settings.js     — paramètres entreprise, logo, import/export
  clients.js      — gestion des fiches clients
  editor.js       — éditeur de facture/devis, lignes, calculs
  pdf.js          — aperçu HTML + génération PDF (pdfmake)
  history.js      — historique, statuts, duplication
  app.js          — initialisation et event bindings
server/
  server.js       — serveur Node : statiques + API /api/state + auth (cookie HMAC)
package.json       — dépendance pg
```

Au chargement, l'app interroge `/api/health` : si un backend répond, elle
passe en **mode serveur** (login + données sur le serveur) ; sinon elle
reste en **mode local** (localStorage). Les données locales existantes
sont migrées vers le serveur au premier lancement auto-hébergé.

En mode serveur, chaque vue a son URL : `/` (nouveau document),
`/historique`, `/clients`, `/parametres`. Toute page demandée sans
session valide est redirigée (302) vers `/login.html?next=...` — l'app
n'est pas servie avant authentification, et le login ramène à la page
demandée.

### Stockage (auto-hébergé)

Les données vivent dans PostgreSQL (conteneur `db`, volume
`facturier_pgdata`, non exposé sur l'hôte) :

| Table | Contenu |
|---|---|
| `settings` | paramètres entreprise + compteurs (JSONB, ligne unique) |
| `clients` | une ligne par client (JSONB) |
| `invoices` | une ligne par facture/devis (JSONB) |

Au premier démarrage, un éventuel `state.json` hérité de l'ancienne
version (volume `facturier_data`) est migré automatiquement vers
PostgreSQL.

## Utilisation en local (démo statique)

Ouvrir `index.html` dans un navigateur. Aucune installation requise.

## Auto-hébergement (Docker)

```bash
cp .env.example .env
# renseigner AUTH_EMAIL, AUTH_PASSWORD_SHA256, SESSION_SECRET, POSTGRES_PASSWORD
docker compose up -d --build
```

Variables d'environnement dans `.env` :

| Variable | Rôle |
|---|---|
| `AUTH_EMAIL` | email de connexion |
| `AUTH_PASSWORD_SHA256` | SHA-256 hex du mot de passe (`echo -n 'pass' \| shasum -a 256`) |
| `SESSION_SECRET` | secret HMAC (`openssl rand -hex 32`) |
| `SESSION_TTL_DAYS` | durée de session (déf. 30) |
| `COOKIE_SECURE` | `1` derrière HTTPS |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | base de données |

Le conteneur web écoute sur 3000 ; à reverse-proxer derrière nginx/TLS
(ex. `proxy_pass http://127.0.0.1:8105;`). Le conteneur `db` n'est pas
exposé sur l'hôte.

## Mentions légales

Le template PDF inclut par défaut les mentions obligatoires pour les factures en France :
- Pénalités de retard (3× taux légal)
- Indemnité forfaitaire de recouvrement (40 €)
- Mention d'escompte

Ces mentions sont personnalisables dans les paramètres.

## Licence

MIT
