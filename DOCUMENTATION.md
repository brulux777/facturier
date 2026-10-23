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

### Page Entreprises

La page **Entreprises** gère une fiche complète par entité émettrice :
nom, forme juridique, adresse, SIRET, n° TVA (ou franchise art. 293 B
pour les micro-entreprises), logo, coordonnées bancaires, mentions
légales, préfixes de numérotation. L'entreprise par défaut (★) est
présélectionnée dans l'éditeur.

Dans l'**éditeur**, le **sélecteur d'entreprise émettrice** (en tête du
document) applique automatiquement les informations de la société
choisie : coordonnées et logo du PDF, régime TVA (taux des lignes,
mention 293 B), IBAN, mentions légales et **séquence de numérotation
propre à chaque entreprise** (ex : `CW-2026-001` pour Contrôle Web,
`F-2026-001` pour ELD Contrôle SAS). Chaque document enregistré fige
une copie des paramètres de son entreprise émettrice : les PDF déjà
émis restent identiques même si la fiche évolue ensuite. Rééditer un
document conserve cette copie figée (coordonnées client et entreprise
du document intouchées) ; seuls un changement explicite d'émetteur
dans l'éditeur, une duplication ou un nouveau document reprennent la
fiche actuelle.

À la première ouverture après mise à jour, l'ancienne configuration
unique (page Paramètres historique) est migrée automatiquement en
première entreprise, compteurs de numérotation inclus.

---

## Fonctionnement général

L'application détecte seule son mode de fonctionnement au chargement
(interrogation de `/api/health`) :

- **Mode serveur** (auto-hébergé, le cas sur doc.eldcontrole.fr) :
  connexion obligatoire, données centralisées dans PostgreSQL,
  synchronisation automatique à chaque modification.
- **Mode local** (démo statique) : tout reste dans le `localStorage`
  du navigateur, aucun serveur.

### Authentification et comptes

- Comptes en base (email + mot de passe scrypt), création libre
  **limitée aux domaines autorisés** (voir ci-dessus).
- **Vérification d'email obligatoire** à l'inscription : un lien
  valable 24 h est envoyé ; la connexion est refusée tant qu'il n'a
  pas été ouvert (renvoi possible depuis la page de connexion).
- **Mot de passe oublié** : réinitialisation par email (lien valable
  1 h, usage unique) — un serveur SMTP est donc requis.
- Sessions par cookie signé (HMAC), durée configurable
  (`SESSION_TTL_DAYS`, 30 jours par défaut).
- La page **Compte** affiche l'email de session, permet le changement
  de mot de passe et la déconnexion, et liste **tous les comptes de
  l'instance** (API `/api/users` : email, date de création, statut de
  vérification).

### Vues de l'application

Chaque vue a son URL (en mode serveur) :

| URL | Vue | Rôle |
|---|---|---|
| `/` | Éditeur | Création d'une facture ou d'un devis (sélecteur d'entreprise émettrice) |
| `/historique` | Historique | Recherche, filtrage, statuts (brouillon/envoyée/payée), duplication |
| `/clients` | Clients | Fiches clients réutilisables |
| `/signature` | Signature | Liste des documents signés (re-téléchargement, suppression) |
| `/signer` | Signer | Assistant de signature d'un PDF : signataires, renommage du fichier, placement (sans édition) |
| `/signataires` | Signataires | Fiches de signature : nom manuscrit (IA) ou dessin, lignes de bloc facultatives |
| `/entreprises` | Entreprises | Fiches des sociétés émettrices (multi-entreprise) |
| `/compte` | Compte | Session, changement de mot de passe, déconnexion, comptes de l'instance, import/export |

Les anciennes URL `/profils` et `/parametres` redirigent
respectivement vers `/signataires` et `/compte`.

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

L'assistant `/signer` ne fait aucune édition de document : il sélectionne
les signatures de la page Signataires et les place sur le PDF.

1. Uploader le PDF (8 Mo max, non protégé par mot de passe) et, si
   besoin, **renommer le fichier signé** (pré-rempli avec le nom du
   fichier téléversé).
2. Sélectionner les signataires — profils réutilisables de la page
   Signataires. Le contenu de leur bloc (mention, date, lignes…)
   se règle sur leur fiche (voir ci-dessous).
3. Placer les signatures :
   - **commune à toutes les pages**, avec 3 types de placement :
     - **automatique** : chaque signataire est placé sur **toutes les
       pages** à la position par défaut choisie (bas, haut, bord
       gauche, bord droit, ou un des quatre coins), avec répartition
       sans chevauchement (côte à côte horizontalement, empilés à
       gauche/droite). Déplacer ou redimensionner un bloc entraîne ses
       copies sur toutes les autres pages ; « × » supprime uniquement
       la copie de la page ;
     - **précis** : cliquer sur la première page pour placer un
       signataire — la position est reproduite sur toutes les pages,
       puis chaque page s'ajuste librement (glisser, redimensionner,
       supprimer : réglages locaux) ;
     - **manuel** : cliquer sur l'aperçu pour placer ou déplacer une
       signature page par page ;
   - **autonome** : chaque bloc est **pleinement indépendant** — on
     sélectionne un signataire puis on clique où l'on veut, autant de
     fois que nécessaire. Plusieurs signatures **différentes** peuvent
     ainsi figurer sur certaines pages seulement.

   Dans tous les cas, chaque bloc reste ajustable (glisser,
   redimensionner, supprimer), puis **Signer le document**.

Le fichier est téléchargé sous le nom choisi (`.pdf`) et archivé dans
la liste « Signature ». En mode serveur, les PDF signés sont stockés
en base (table `signed_docs`, 10 Mo max).

### Signataires (page /signataires)

Chaque signataire possède une fiche complète :

- **nom** et fonction ;
- le type de signature : **dessin** à la main, ou **nom en écriture
  manuscrite générée par IA** à partir du texte (réseau de neurones
  LSTM du modèle calligrapher.ai, auto-hébergé dans
  `vendor/handwriting/`, ~2,6 Mo chargés une fois) ;
- sa « main » : graine stable, style (10 styles + aléatoire),
  lisibilité et **nouvelle variante**. Accents gérés (translittérés),
  traits identiques à graine identique. Si le moteur est indisponible,
  repli automatique sur les polices manuscrites (Caveat…) ;
- des **lignes de bloc facultatives, en nombre libre** : chacune est
  un texte au choix **manuscrit** (généré par IA), en **mention**
  (italique) ou en **texte** simple ; `{date}` y est remplacé par la
  date du jour en toutes lettres, et un retour à la ligne dans un
  texte crée une ligne de bloc supplémentaire ;
- le style des textes : taille (70–180 %), couleur et police.

La fiche affiche un **aperçu du bloc complet** (signature + lignes)
en direct. Les signataires créés avant cette version retrouvent
automatiquement le contenu par défaut de l'ancien assistant
(mention, date, fonction).

---

## Données et stockage (mode serveur)

Les données vivent dans PostgreSQL (conteneur `facturier-db`, volume
`facturier_pgdata`, non exposé sur l'hôte) :

| Table | Contenu |
|---|---|
| `settings` | Préférences + compteurs (par entreprise) + profils entreprises/signataires (JSONB) |
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
