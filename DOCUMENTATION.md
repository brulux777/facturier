# Facturier — Documentation fonctionnelle

Application de facturation (factures, devis, signature de documents)
destinée à être servie à l'adresse **https://doc.eldcontrole.fr**, sur le
serveur **vps_pro** (déploiement Docker dans `~/facturier`, voir
[Déploiement](#déploiement-sur-vps_pro--doceldcontrolefr)).

Cette page est accessible directement sur l'instance :
`https://doc.eldcontrole.fr/DOCUMENTATION.md`.

---

## Organisation multi-entreprise

Le facturier est partagé par **plusieurs entités du même groupe**. Tous
les comptes se connectent à la même instance et partagent les mêmes
données (clients, factures, profils) ; l'entité émettrice ou signataire
est choisie dans l'application.

| Entité | Nature | Domaine email |
|---|---|---|
| **Contrôle Web** | Micro-entreprise | `@controleweb.fr` |
| **ELD Contrôle SAS** | Société par actions simplifiée | `@eldcontrole.fr` |
| **HoplaCollect** | **Plateforme**, pas une entreprise — portée par ELD Contrôle SAS | `@hoplacollect.fr` |

Points importants :

- **HoplaCollect n'est pas une entité juridique distincte** : c'est une
  plateforme qui appartient à ELD Contrôle SAS. Les documents la concernant
  sont émis ou signés **au nom d'ELD Contrôle SAS**.
- La création de compte est réservée aux adresses email des domaines
  autorisés : `@controleweb.fr`, `@eldcontrole.fr`, `@hoplacollect.fr`
  (variable `ALLOWED_EMAIL_DOMAINS` côté serveur).
- Dans l'application, la page **Profils** permet d'enregistrer une fiche
  par entreprise (Contrôle Web et ELD Contrôle SAS) avec ses
  coordonnées. Lors de la **signature d'un document**, on sélectionne
  l'entreprise signataire ; son nom apparaît sous chaque signature.
- Les paramètres généraux (page **Paramètres**) définissent l'émetteur
  par défaut des factures et devis (logo, coordonnées, mentions
  légales, IBAN).

---

## Fonctionnement général

L'application détecte seule son mode de fonctionnement au chargement
(interrogation de `/api/health`) :

- **Mode serveur** (auto-hébergé, le cas sur doc.eldcontrole.fr) :
  connexion obligatoire, données centralisées dans PostgreSQL,
  synchronisation automatique à chaque modification.
- **Mode local** (démo statique) : tout reste dans le `localStorage`
  du navigateur, aucun serveur.

### Authentification

- Comptes en base (email + mot de passe scrypt), création libre
  **limitée aux domaines autorisés** (voir ci-dessus).
- **Vérification d'email obligatoire** à l'inscription : un lien
  valable 24 h est envoyé ; la connexion est refusée tant qu'il n'a
  pas été ouvert (renvoi possible depuis la page de connexion).
- **Mot de passe oublié** : réinitialisation par email (lien valable
  1 h, usage unique) — un serveur SMTP est donc requis.
- Sessions par cookie signé (HMAC), durée configurable
  (`SESSION_TTL_DAYS`, 30 jours par défaut).

### Vues de l'application

Chaque vue a son URL (en mode serveur) :

| URL | Vue | Rôle |
|---|---|---|
| `/` | Éditeur | Création d'une facture ou d'un devis |
| `/historique` | Historique | Recherche, filtrage, statuts (brouillon/envoyée/payée), duplication |
| `/clients` | Clients | Fiches clients réutilisables |
| `/signature` | Signature | Liste des documents signés (re-téléchargement, suppression) |
| `/signer` | Signer | Assistant de signature d'un PDF |
| `/profils` | Profils | Signataires et entreprises (multi-entreprise) |
| `/parametres` | Paramètres | Émetteur par défaut, logo, banque, mentions légales, import/export |

### Factures et devis

- Numérotation automatique (éditable), TVA configurable multi-taux,
  totaux HT et TTC toujours affichés (même en TVA non applicable,
  art. 293 B).
- **Acompte** : mention en devis, déduction du net à payer en facture.
- **Paiement en 3 fois** : activable par document, échéancier mensuel
  automatique calculé sur le reste dû après acompte.
- **Cahier des charges** : Markdown optionnel — intégré à la facture,
  en annexe du même PDF, ou en second PDF séparé.
- PDF professionnel conforme aux normes françaises (mentions de
  pénalités de retard, indemnité forfaitaire de recouvrement 40 €,
  escompte), généré côté navigateur (pdfmake).

### Signature de documents

Signature **simple** apposée sur un PDF (garde-fou visuel — ce n'est
pas une signature électronique qualifiée au sens du règlement eIDAS).

1. Uplooder le PDF (8 Mo max, non protégé par mot de passe).
2. Renseigner titre, type, date, description.
3. Choisir **l'entreprise signataire** (Contrôle Web ou ELD Contrôle
   SAS, depuis les profils).
4. Sélectionner les signataires (profils réutilisables : nom rendu en
   police manuscrite ou dessin enregistré).
5. Cliquer sur l'aperçu pour placer chaque signature (déplaçable,
   redimensionnable), puis **Signer le document**.

Le bloc signature (image + nom + fonction + entreprise + date) est
incrusté dans le PDF, téléchargé immédiatement et archivé dans la liste
« Signature ». En mode serveur, les PDF signés sont stockés en base
(table `signed_docs`, 10 Mo max).

---

## Données et stockage (mode serveur)

Les données vivent dans PostgreSQL (conteneur `facturier-db`, volume
`facturier_pgdata`, non exposé sur l'hôte) :

| Table | Contenu |
|---|---|
| `settings` | Paramètres + compteurs + profils entreprises/signataires (JSONB) |
| `clients` | Une ligne par client (JSONB) |
| `invoices` | Une ligne par facture/devis (JSONB) |
| `signed_docs` | Documents signés : métadonnées (JSONB) + PDF (BYTEA) |
| `users` | Comptes (email, hash scrypt, date de vérification d'email) |
| `password_resets` | Jetons de réinitialisation (1 h, usage unique) |
| `email_verifications` | Jetons de vérification d'email (24 h, usage unique) |

Sauvegarde recommandée : export JSON depuis la page Paramètres, et/ou
`pg_dump` du conteneur `facturier-db`.

---

## Déploiement sur vps_pro — doc.eldcontrole.fr

Architecture sur le serveur **vps_pro** :

- **Dépôt** : `~/facturier` (clone git de ce dépôt, branche `master`).
- **Conteneurs** (docker compose du dépôt) :
  - `facturier-web` — application Node, bindée sur `127.0.0.1:8105`
    uniquement ;
  - `facturier-db` — PostgreSQL 16, non publié sur l'hôte.
- **nginx hôte** : vhost `/etc/nginx/sites-enabled/doc.eldcontrole.conf`
  — terminaison TLS (certificat Let's Encrypt), `proxy_pass` vers
  `127.0.0.1:8105`. Convention serveur : TLS toujours terminé par le
  nginx système, jamais dans les conteneurs.
- **DNS** : `doc.eldcontrole.fr` → adresse du vps_pro.
- **SMTP** : configuré via `.env` (variables `SMTP_*`) — nécessaire
  pour la vérification d'email et la réinitialisation de mot de passe.

### Mettre à jour l'application

```bash
ssh vps_pro
cd ~/facturier
git pull
docker compose up -d --build
```

La migration de base (nouvelles tables, nouvelles colonnes) est
appliquée automatiquement au démarrage du conteneur `facturier-web`.
Vérifier ensuite que les conteneurs sont sains :

```bash
docker compose ps          # facturier-web et facturier-db : Up (healthy)
curl -fsS http://127.0.0.1:8105/api/health
```

Cette documentation est servie par l'application elle-même à l'adresse
`https://doc.eldcontrole.fr/DOCUMENTATION.md`.
