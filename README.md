# Facturier Pro

Générateur de factures et devis professionnel, gratuit et open-source. Fonctionne 100% dans le navigateur — aucun serveur, aucune inscription, aucune donnée transmise.

**[Utiliser l'application](https://brulux777.github.io/facturier)**

## Fonctionnalités

- **Factures & Devis** — Numérotation automatique (éditable), TVA configurable, multi-taux
- **Multi-entreprise émettrice** — Plusieurs sociétés (page Entreprises) : coordonnées, logo, régime TVA, IBAN, préfixes et séquences de numérotation propres à chacune ; sélecteur d'entreprise dans l'éditeur
- **Mentions HT/TTC toujours présentes** — même en TVA non applicable (art. 293 B), les totaux affichent Total HT et Total TTC
- **Cahier des charges** — Markdown optionnel avec 3 emplacements au choix : intégré à la facture, en annexe sur une page séparée du même PDF, ou dans un second PDF téléchargé à part
- **Paiement en 3 fois** — activable/désactivable par document, échéancier mensuel automatique (montants + dates)
- **Gestion clients** — Enregistrement et réutilisation des fiches clients
- **Signature de documents** — Upload d'un PDF, placement visuel des signatures (clic sur l'aperçu), plusieurs signataires, profils réutilisables (écriture manuscrite **générée par IA** à partir du texte, ou dessin), bloc de signature modulaire (dessin, nom, phrase, date, lignes supplémentaires — toutes facultatives), choix de l'entreprise signataire, liste des documents signés avec re-téléchargement
- **PDF professionnel** — Génération et téléchargement de PDF conformes aux normes françaises
- **Historique** — Recherche, filtrage, statut (brouillon/envoyée/payée), duplication
- **Entreprises** — Une fiche par entité émettrice (adresse, SIRET, TVA, logo, banque, mentions légales, préfixes de numérotation)
- **Compte** — Email de session, changement de mot de passe, déconnexion, liste des comptes de l'instance, import/export
- **Import / Export** — Sauvegarde et restauration de toutes les données (JSON)
- **2 modes de stockage** — Local (navigateur) ou synchronisé sur votre serveur PostgreSQL (voir auto-hébergement)

## Confidentialité

- **Démo GitHub Pages** : aucune donnée n'est envoyée à un serveur, tout reste dans le `localStorage` du navigateur.
- **Auto-hébergé (Docker)** : vos données (settings, clients, factures) sont enregistrées dans **PostgreSQL**, sur **votre** serveur, protégées par un login. Utilisez l'export JSON pour sauvegarder.

## Stack

- HTML / CSS / JavaScript vanilla — aucun build step
- [pdfmake](https://pdfmake.github.io/docs/) (CDN) — génération PDF vectorielle côté client
- [pdf.js](https://mozilla.github.io/pdf.js/) (CDN) — aperçu des PDF à signer
- [pdf-lib](https://pdf-lib.js.org/) (CDN) — apposition des signatures sur le PDF
- **Écriture manuscrite générée (IA)** — moteur RNN de [calligrapher.ai](https://calligrapher.ai) (d'après [sjvasquez/handwriting-synthesis](https://github.com/sjvasquez/handwriting-synthesis), papier *Generating Sequences With Recurrent Neural Networks* d'A. Graves) auto-hébergé dans `vendor/handwriting/` (script + poids 2,6 Mo) ; repli sur polices manuscrites si indisponible
- Polices manuscrites Caveat, Dancing Script, Great Vibes, Parisienne (Google Fonts) — secours et textes du bloc
- [Inter](https://fonts.google.com/specimen/Inter) (Google Fonts)
- Serveur optionnel : Node.js — fichiers statiques + API de synchronisation + auth (dépendance `pg`)
- Docker : `node:22-alpine` (web) + `postgres:16-alpine` (base de données, volume dédié)

## Architecture

```
index.html           — app (route /)
DOCUMENTATION.md     — documentation fonctionnelle (servie sur l'instance, ex. doc.eldcontrole.fr)
login.html           — page de connexion (mode serveur)
style.css
js/
  state.js        — état, persistance (localStorage ou serveur), routing des vues
  server-sync.js  — détection du backend, redirection login, synchronisation serveur
  companies.js    — entreprises émettrices (multi-entreprise) : CRUD, compteurs, settings effectifs
  settings.js     — page Compte : session, comptes de l'instance, import/export
  clients.js      — gestion des fiches clients
  handwriting-synth.js — enveloppe du moteur d'écriture manuscrite IA (graine par signataire, accents, cache)
  signatures.js   — signature de PDF : assistant, profils signataires, liste
  editor.js       — éditeur de facture/devis, lignes, calculs, entreprise émettrice
  pdf.js          — aperçu HTML + génération PDF (pdfmake)
  history.js      — historique, statuts, duplication
  app.js          — initialisation et event bindings
server/
  server.js       — serveur Node : statiques + API /api/state + /api/signed-docs + /api/users + auth (cookie HMAC)
vendor/handwriting/ — moteur d'écriture IA auto-hébergé (engine.js + poids d.bin)
package.json       — dépendance pg
```

Au chargement, l'app interroge `/api/health` : si un backend répond, elle
passe en **mode serveur** (login + données sur le serveur) ; sinon elle
reste en **mode local** (localStorage). Les données locales existantes
sont migrées vers le serveur au premier lancement auto-hébergé.

En mode serveur, chaque vue a son URL : `/` (nouveau document),
`/historique`, `/clients`, `/signature` (documents signés), `/signer`
(assistant de signature), `/signataires` (profils de signature),
`/entreprises` (sociétés émettrices), `/compte` (session, comptes,
import/export ; l'ancienne URL `/parametres` y redirige). Toute page
demandée sans session valide est redirigée
(302) vers `/login.html?next=...` — l'app n'est pas servie avant
authentification, et le login ramène à la page demandée.

### Multi-entreprise émettrice

La page **Entreprises** gère une fiche par entité (ex : Contrôle Web
micro-entreprise, ELD Contrôle SAS) : coordonnées, SIRET, n° TVA,
régime (franchise art. 293 B), logo, IBAN, mentions légales, préfixes
de numérotation. Dans l'éditeur, le **sélecteur d'entreprise émettrice**
applique ces informations au document : chaque entreprise possède ses
propres séquences de numérotation (compteurs par entreprise). Les
documents enregistrés figent une copie des paramètres de l'entreprise
au moment de l'émission — les PDF déjà générés restent identiques même
si la fiche évolue. À la première ouverture, les anciens paramètres
(nom d'entreprise unique) sont migrés automatiquement en première
entreprise, compteurs inclus.

### Signature de documents

La vue **Signature** liste les documents signés (re-téléchargeables,
supprimables). L'assistant **Signer un document** : upload du PDF
(8 Mo max) → titre/type/date/description → entreprise signataire →
signataires (profils réutilisables) → **contenu du bloc** (chaque
ligne est facultative : dessin, nom en écriture manuscrite générée,
phrase libre, date, fonction, entreprise, lignes supplémentaires en
nombre libre) → placement visuel (automatique toutes pages, précis ou
manuel), puis **Signer le document**. Le bloc est incrusté dans le
PDF, téléchargé immédiatement et archivé dans la liste.

Chaque signataire possède sa « main » : un réseau de neurones
(LSTM + attention, modèle de calligrapher.ai auto-hébergé) génère des
traits d'écriture réalistes à partir du texte — nom, phrase, date ou
lignes supplémentaires. La graine par signataire est stable (la même
personne écrit toujours de la même façon), le bouton **Nouvelle
variante** explore d'autres façons d'écrire, et le style/lisibilité
sont réglables. Si le moteur est indisponible, l'app retombe sur les
polices manuscrites.

En mode local, les PDF signés vivent dans le `localStorage` (clé
dédiée, quota du navigateur). En mode serveur, ils sont stockés en
base (table `signed_docs`) via une API dédiée, les métadonnées des
profils (entreprises, signataires) étant portées par la synchro
d'état habituelle.

> Note : il s'agit d'une signature **simple** apposée sur le document
> (garde-fou visuel), pas d'une signature électronique qualifiée au
> sens du règlement eIDAS.

La création de compte (limitée aux domaines email autorisés) exige une
**vérification de l'email** : un lien valable 24 h est envoyé à
l'inscription et la connexion est refusée jusqu'à ce qu'il ait été
ouvert (renvoi possible depuis la page de connexion). Le mot de passe
oublié se réinitialise aussi par email — un serveur SMTP est donc
requis en mode auto-hébergé.

### Stockage (auto-hébergé)

Les données vivent dans PostgreSQL (conteneur `db`, volume
`facturier_pgdata`, non exposé sur l'hôte) :

| Table | Contenu |
|---|---|
| `settings` | préférences + compteurs (par entreprise) + profils entreprises/signataires (JSONB, ligne unique) |
| `clients` | une ligne par client (JSONB) |
| `invoices` | une ligne par facture/devis (JSONB) |
| `signed_docs` | documents signés : métadonnées (JSONB) + PDF (BYTEA, 10 Mo max) |
| `users` | comptes (email, hash scrypt, date de vérification d'email) |
| `password_resets` | jetons de réinitialisation (1 h, usage unique) |
| `email_verifications` | jetons de vérification d'email (24 h, usage unique) |

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
