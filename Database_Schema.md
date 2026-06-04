# GharbFeed v1.2 — Référence du Schéma Base de Données

> **Généré le** : 2026-05-24  
> **Source** : Audit direct via API REST Supabase (schéma public)  
> **Projet Supabase** : `vyltktuehkpblmgmqxam`

---

## Vue d'ensemble

| Table | Rôle métier | Lignes (au 2026-05-24) |
|---|---|---|
| `operations` | En-têtes des opérations (ventes et achats) | 70 |
| `operation_items` | Lignes de chaque opération (1 ligne = 1 produit) | 72 |
| `operation_history` | Snapshots des modifications (traçabilité) | 0 |
| `produits` | Catalogue produits + stocks | 184 |
| `clients` | Carnet clients | 301 |
| `utilisateurs` | Comptes utilisateurs (liés à `auth.users`) | 4 |

---

## Diagramme des relations

```
utilisateurs (id UUID PK)
    │
    ├──▶ operations.utilisateur_id
    │
    └──▶ operation_history.modified_by

clients (id_client SERIAL PK)
    │
    └──▶ operations.client_id

operations (num_op SERIAL PK)
    │
    ├──▶ operation_items.operation_id
    └──▶ operation_history.operation_id

produits (code TEXT PK)
    │
    └──▶ operation_items.produit_id   ⚠️ FK non déclarée en DB (voir anomalies)
```

---

## Tables

### `operations`

En-tête de chaque opération de vente ou d'achat.

| Colonne | Type | Défaut | Contrainte | Notes |
|---|---|---|---|---|
| `num_op` | INTEGER | auto-increment | **PK** | Identifiant principal, utilisé dans tout le code |
| `date_op` | TEXT / DATE | — | — | Date de l'opération (format `YYYY-MM-DD`) |
| `heure_op` | TEXT / TIME | — | — | Heure de l'opération (format `HH:MM:SS`) |
| `type_op` | TEXT | — | — | `'vente'` ou `'achat'` |
| `total_dh` | INTEGER | — | — | Montant total après remise (DH) |
| `remise_dh` | INTEGER | 0 | — | Remise appliquée (DH) |
| `observ` | TEXT | — | — | Observation libre |
| `utilisateur_id` | UUID | — | FK → `utilisateurs.id` | Agent ayant effectué l'opération |
| `client_id` | INTEGER | NULL | FK → `clients.id_client` | Nullable (vente sans client nommé) |
| `statut` | TEXT | `'valide'` | — | `'valide'`, `'en_attente'`, `'annule'` |
| `is_modified` | BOOLEAN | `false` | — | `true` si l'opération a été modifiée en post |
| `version` | INTEGER | 1 | — | Numéro de version courant (incrémenté à chaque modif) |
| `id_op` | UUID | auto | — | ⚠️ **Colonne orpheline** — UUID inutilisé, voir anomalies |
| `code_produit` | TEXT | — | — | ⚠️ **Ancienne architecture** — duplique `operation_items.produit_id` |
| `qte` | INTEGER | — | — | ⚠️ **Ancienne architecture** — duplique `operation_items.quantite` |
| `prix_dh` | INTEGER | — | — | ⚠️ **Ancienne architecture** — duplique `operation_items.prix_unitaire` |

---

### `operation_items`

Lignes de détail de chaque opération. Une ligne par produit par opération.

| Colonne | Type | Défaut | Contrainte | Notes |
|---|---|---|---|---|
| `id` | INTEGER | auto-increment | **PK** | |
| `operation_id` | INTEGER | — | FK → `operations.num_op` | |
| `produit_id` | TEXT | — | FK → `produits.code` ⚠️ non déclarée | Clé du produit |
| `quantite` | INTEGER | — | — | Quantité vendue ou achetée |
| `prix_unitaire` | DECIMAL | — | — | Prix unitaire au moment de l'opération |
| `total_ligne` | DECIMAL | — | — | `quantite × prix_unitaire` |

---

### `operation_history`

Snapshots JSON des opérations avant chaque modification (traçabilité).  
Peuplée par `handleSaveChanges` dans `OperationDetailsModal.tsx`.

| Colonne | Type | Défaut | Contrainte | Notes |
|---|---|---|---|---|
| `id` | INTEGER | auto-increment | **PK** | |
| `operation_id` | INTEGER | — | FK → `operations.num_op` | |
| `version` | INTEGER | — | — | Version de l'opération **avant** la modification |
| `modified_by` | UUID | — | FK → `utilisateurs.id` | Agent ayant effectué la modification |
| `modified_at` | TIMESTAMPTZ | `NOW()` | — | Horodatage de la modification |
| `snapshot` | JSONB | — | — | État complet des items avant modif (`items[]`, `total_dh`, `snapshot_at`) |

---

### `produits`

Catalogue des produits avec prix et stocks.

| Colonne | Type | Défaut | Contrainte | Notes |
|---|---|---|---|---|
| `code` | TEXT | — | **PK** | Clé textuelle (ex: `"#0001"`, `"0025"`) — **jamais `id`** |
| `produit` | TEXT | — | — | Nom du produit |
| `description` | TEXT | NULL | — | Description (souvent vide) |
| `stock_initial` | INTEGER | — | — | Stock de départ (référence) |
| `stock_actuel` | INTEGER | — | — | Stock courant (mis à jour à chaque vente/achat) |
| `prix_vente` | INTEGER | — | — | Prix de vente (DH) ⚠️ INTEGER, pas DECIMAL |
| `pdat` | INTEGER | — | — | Prix d'achat (`prix_d'achat_TTC`) ⚠️ nom cryptique, INTEGER |
| `qte_vente` | INTEGER | 0 | — | Cumul des quantités vendues |
| `qte_achat` | INTEGER | 0 | — | Cumul des quantités achetées |
| `valeur_stock` | INTEGER | — | — | `stock_actuel × prix_vente` ⚠️ INTEGER |

---

### `clients`

Carnet des clients nommés.

| Colonne | Type | Défaut | Contrainte | Notes |
|---|---|---|---|---|
| `id_client` | INTEGER | auto-increment | **PK** | ⚠️ PK nommée `id_client` (pas `id`) |
| `nom_prenom` | TEXT | — | — | ⚠️ Colonne nommée `nom_prenom` (pas `nom`) |
| `adresse` | TEXT | NULL | — | |
| `fonction` | TEXT | NULL | — | Ex: `'Éleveur'`, `'Vétérinaire'`, `'Autre'` |
| `num_telephone` | TEXT | NULL | — | Stocké en TEXT (formats variés avec points et tirets) |

---

### `utilisateurs`

Comptes utilisateurs, liés aux identités Supabase Auth.

| Colonne | Type | Défaut | Contrainte | Notes |
|---|---|---|---|---|
| `id` | UUID | — | **PK** (= `auth.users.id`) | |
| `username` | TEXT | — | — | Identifiant de connexion (ex: `"aqch.fahd"`, `"hajar"`) |
| `nom` | TEXT | NULL | — | ⚠️ Toujours NULL en production — utiliser `username` à la place |
| `role` | TEXT | — | — | `'admin'` ou `'caissier'` (pas `'cashier'`) |
| `created_at` | TIMESTAMPTZ | `NOW()` | — | |
| `actif` | BOOLEAN | `true` | — | ⚠️ Nommé `actif` (pas `is_active`) |

---

## Anomalies détectées

### 🔴 Critique — Bug clients dans `History.tsx` (corrigé en session)

La requête originale utilisait `.select('id, nom').in('id', ...)` :
- `id` n'existe pas → c'est `id_client`
- `nom` n'existe pas → c'est `nom_prenom`

**Corrigé** dans la même session : `.select('id_client, nom_prenom').in('id_client', ...)`.

---

### 🟠 Importante — Colonnes orphelines `operations` (ancienne architecture)

`code_produit`, `qte`, `prix_dh` sont des vestiges de l'ancienne architecture "1 opération = 1 produit".  
Elles sont toujours peuplées lors des INSERTs dans `Cashier.tsx` **mais jamais lues**.  
Les données exactes se trouvent dans `operation_items`.

**Recommandation** : ne pas supprimer immédiatement (risque de régression si un INSERT les référence encore), mais planifier leur suppression après audit du code d'insertion.

---

### 🟠 Importante — `id_op` UUID inutilisé dans `operations`

Identifiant doublon généré automatiquement. Aucun code ne le référence. Aucune FK ne le pointe.  
**Recommandation** : supprimer lors d'une prochaine migration.

---

### 🟡 Mineure — Types numériques incohérents dans `produits`

`prix_vente`, `pdat`, `valeur_stock` sont des INTEGER. `operation_items.prix_unitaire` est DECIMAL.  
Acceptable si tous les prix sont en DH entiers, mais à surveiller si des prix avec centimes sont introduits.

---

### 🟡 Mineure — FK `operation_items.produit_id` → `produits.code` non déclarée

Aucune contrainte `FOREIGN KEY` PostgreSQL n'enforce cette relation. Un `produit_id` inexistant peut être inséré sans erreur. C'est aussi la cause racine du bug PGRST200 (PostgREST ne peut pas détecter la relation automatiquement).

**SQL pour déclarer la FK** (à exécuter après vérification d'intégrité) :
```sql
ALTER TABLE operation_items
  ADD CONSTRAINT fk_items_produit
  FOREIGN KEY (produit_id) REFERENCES produits(code);
```

---

### 🟡 Mineure — `utilisateurs.nom` toujours NULL

La colonne `nom` existe mais n'est jamais remplie. Les 4 utilisateurs n'ont que `username` de valorisé.  
Le code de l'application utilise `nom || username` comme fallback (correct).  
La colonne `nom` est techniquement inutile dans l'état actuel.

---

### 🟡 Mineure — Vue `v_operations_full` dans CLAUDE.md obsolète

La définition SQL dans CLAUDE.md référence `o.created_at` et `o.updated_at` qui **n'existent pas** dans la table `operations`. Si ce SQL est exécuté tel quel, il échouera. L'architecture actuelle utilise les requêtes séquentielles (sans vue), la définition de la vue est donc à mettre à jour ou à supprimer du CLAUDE.md.

---

## Règles de requêtage (rappel)

| Règle | Raison |
|---|---|
| Toujours utiliser `produits.code` comme clé, jamais `id` | `code` est la PK TEXT |
| Toujours utiliser `clients.id_client` comme clé, jamais `id` | PK nommée `id_client` |
| Utiliser `clients.nom_prenom` pour le nom, jamais `nom` | La colonne s'appelle `nom_prenom` |
| Utiliser `utilisateurs.username` pour le nom affiché | `nom` est toujours NULL |
| Ne jamais joindre `produits` via PostgREST imbriqué | FK non déclarée → PGRST200 |
| Toujours `doc.save()` pour les PDFs | Jamais `window.open()` |
