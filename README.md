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
- **100% local** — Toutes les données restent dans le `localStorage` de votre navigateur

## Confidentialité

Aucune donnée n'est envoyée à un serveur. Tout est stocké localement dans votre navigateur. Utilisez la fonction **Exporter (JSON)** dans les paramètres pour sauvegarder vos données.

## Stack

- HTML / CSS / JavaScript vanilla
- [html2pdf.js](https://github.com/eKoopmans/html2pdf.js) (CDN) pour la génération PDF
- [Inter](https://fonts.google.com/specimen/Inter) (Google Fonts)
- Aucun build step, aucune dépendance npm

## Utilisation en local

Ouvrir `index.html` dans un navigateur. Aucune installation requise.

## Mentions légales

Le template PDF inclut par défaut les mentions obligatoires pour les factures en France :
- Pénalités de retard (3× taux légal)
- Indemnité forfaitaire de recouvrement (40 €)
- Mention d'escompte

Ces mentions sont personnalisables dans les paramètres.

## Licence

MIT
