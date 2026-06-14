# Modèles d'import GharbFeed

Fichiers à remplir puis importer via **Admin → Système → Importer un fichier**.
Formats acceptés : `.xlsx`, `.xls`, `.csv`. Un aperçu est affiché avant toute écriture.
(Le bouton « Télécharger le modèle » dans l'app génère ces mêmes modèles en `.xlsx`.)

## Produits — `gharbfeed_modele_produits.csv`

| Colonne | Obligatoire | Notes |
|---|---|---|
| CODE | ✅ | Référence unique. `1` / `0001` / `#0001` sont équivalents → stockés `#0001`. |
| PRODUIT | ✅ | Nom du produit. |
| CATEGORIE | — | Doit valoir : Matière première · Aliment composé · Additif · CMV · Bloc à lécher · Matériel · Produit Hygien (défaut : Matériel). |
| PRIX_VENTE | — | Décimale virgule ou point (`180,00` ou `180.00`). |
| PRIX_ACHAT | — | Prix d'achat. Sert à initialiser le coût (PAMP) d'un **nouveau** produit. |
| STOCK_ACTUEL | — | Quantité. Sur un produit **existant**, n'écrase le stock que si la case « Mettre à jour aussi le stock » est cochée. |
| SEUIL_ALERTE | — | Entier (défaut : 10). |
| DESCRIPTION | — | Libre. |

- **Nouveau produit** → inséré (compteurs ventes/achats à 0, actif, coût PAMP initialisé au prix d'achat).
- **Produit existant** (même CODE) → mise à jour des champs fournis ; le coût moyen (PAMP) déjà calculé n'est **jamais** écrasé.

## Clients — `gharbfeed_modele_clients.csv`

| Colonne | Obligatoire | Notes |
|---|---|---|
| NOM_PRENOM | ✅ | Nom complet. |
| FONCTION | — | Doit valoir : Eleveur · Technicien · Vétérinaire · Inséminateur · Revendeur · Client Comptoir (ou vide). |
| NUM_TELEPHONE | — | Formatez la colonne en **Texte** pour garder le 0 initial. |
| ADRESSE | — | Libre. |

- Dédoublonnage automatique sur **nom + téléphone** : un client déjà présent n'est pas réinséré.
