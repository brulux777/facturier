# Facturier Pro

Générateur de factures et devis professionnel — 100% côté client, hébergé gratuitement sur GitHub Pages.

## Fonctionnalités

- **Factures & Devis** — Numérotation automatique, TVA configurable, multi-taux
- **Gestion clients** — Enregistrement et réutilisation des fiches clients
- **PDF professionnel** — Génération et téléchargement de PDF conformes
- **Historique** — Recherche, filtrage, statut (brouillon/envoyée/payée)
- **Paramètres entreprise** — Logo, coordonnées bancaires, mentions légales
- **100% local** — Aucun serveur, toutes les données restent dans le navigateur (localStorage)

## Déploiement

### GitHub Pages

1. Créer un repo GitHub (privé ou public)
2. Pousser les fichiers
3. Activer GitHub Pages dans Settings → Pages → Source: `main` / `root`
4. L'app est accessible à `https://[username].github.io/[repo-name]`

### Local

Ouvrir `index.html` dans un navigateur. Aucune installation requise.

## Stack

- HTML / CSS / JavaScript vanilla
- [html2pdf.js](https://github.com/eKoopmans/html2pdf.js) (CDN) pour la génération PDF
- [Inter](https://fonts.google.com/specimen/Inter) (Google Fonts)
- Aucun build step, aucune dépendance npm

## Mentions légales françaises

Le template PDF inclut par défaut les mentions obligatoires pour les factures en France :
- Pénalités de retard (3× taux légal)
- Indemnité forfaitaire de recouvrement (40 €)
- Mention d'escompte

Ces mentions sont personnalisables dans les paramètres.
