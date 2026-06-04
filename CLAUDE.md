# GharbFeed v1.2 — Guide Claude

## Contexte métier

Application web de gestion de stock et de ventes pour un **magasin d'alimentation animale** (bétail).
- Caisse enregistreuse (ventes), réception marchandises (achats)
- Suivi des stocks en temps réel
- Historique des opérations
- Gestion des clients, fournisseurs et utilisateurs

---

## Stack Technique

| Couche | Technologie |
|---|---|
| Frontend | React 19 + Vite 6 + TypeScript |
| Styles | Tailwind CSS v4 |
| Routing | React Router v7 |
| Animations | Framer Motion (`motion/react`) |
| Base de données | Supabase (PostgreSQL + Auth + RLS) |
| PDF | jsPDF v4 + jspdf-autotable v5 |
| Export | xlsx (SheetJS) |
| Charts | recharts v3.8.1 |
| Icons | lucide-react |

**Dev server :** `npm run dev` → `http://localhost:3000`
**Build :** `npm run build`
**Lint :** `npm run lint` (TypeScript `--noEmit`)

---

## Structure des fichiers clés

```
src/
├── vite-env.d.ts              # Déclarations TypeScript assets (*.png, *.svg…) + vite/client
├── App.tsx                    # Auth state machine (isLoading, user, profile)
├── supabase.ts                # Client Supabase + createSecondaryClient
├── types.ts                   # Interfaces TypeScript globales
├── pages/
│   ├── Login.tsx              # Page de connexion (logo intégré)
│   ├── Dashboard.tsx          # Tableau de bord (KPIs + timezone Maroc)
│   ├── Cashier.tsx            # Caisse (vente + achat + fournisseur + condition paiement)
│   ├── History.tsx            # Historique des opérations (+ fournisseur)
│   ├── Inventory.tsx          # Gestion des stocks (+ catégories + prix achat)
│   ├── Clients.tsx            # Gestion des clients (fonction = select)
│   └── Admin.tsx              # Administration — 4 onglets (Analytique, Utilisateurs, Fournisseurs, Système)
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx        # Navigation (logo.png intégré)
│   │   └── Header.tsx
│   └── OperationDetailsModal.tsx  # Détail opération (fournisseur, condition paiement, réf)
├── utils/
│   └── pdfGenerator.ts        # Génération ticket PDF (jsPDF)
└── lib/
    └── utils.ts               # cn() helper (clsx + tailwind-merge)

logo.png                       # Logo sans fond (racine du projet — importé via alias @/)
```

**Import logo :** `import logo from '@/logo.png'` — l'alias `@` pointe sur la racine du projet (configuré dans `vite.config.ts`).

---

## Base de données Supabase

### Tables principales

| Table | Clé primaire | Rôle |
|---|---|---|
| `utilisateurs` | `id` (UUID = auth.uid) | Profils utilisateurs |
| `produits` | `code` (TEXT — **pas `id`**) | Catalogue produits |
| `clients` | `id_client` (serial) | Clients |
| `fournisseurs` | `id_fournisseur` (serial) | Fournisseurs (ajouté V2) |
| `operations` | `num_op` (serial) | En-têtes des opérations |
| `operation_items` | `id` (serial) | Lignes de chaque opération |

### Colonnes importantes

**`utilisateurs`**
- `id` — UUID (lié à `auth.users`)
- `username` — nom affiché (**pas `nom`**, toujours NULL en production)
- `role_id` ou `role` — `'admin'` ou `'caissier'` (mappé vers `'cashier'` côté JS)
- `actif` — booléen (**pas `is_active`**)

**`produits`**
- `code` — PK textuelle (ex: `"0025"`) — **jamais `id`**
- `produit` — nom du produit
- `prix_vente` — prix de vente
- `pdat` — prix d'achat (visible admin seulement dans Cashier/Inventory)
- `stock_actuel` — stock courant
- `qte_vente` — cumul des quantités vendues
- `qte_achat` — cumul des quantités achetées
- `valeur_stock` — stock_actuel × prix_vente
- `categorie` — catégorie métier (ajouté V2, voir liste ci-dessous)

**`clients`**
- `id_client` — PK serial (**pas `id`**) — utiliser `.in('id_client', ...)` et `.select('id_client, nom_prenom')`
- `nom_prenom` — nom du client (**jamais `nom`**)
- `fonction` — Eleveur | Technicien | Vétérinaire | Inséminateur | Revendeur | Client Comptoir

**`fournisseurs`** *(table V2)*
- `id_fournisseur` — PK serial
- `type` — `'Société'` | `'Personne physique'`
- `nom` — nom ou raison sociale
- `num_telephone`, `adresse` — contact
- `irc`, `ice` — identifiants fiscaux Société
- `cin` — identifiant Personne physique

**`operations`**
- `num_op` — PK serial
- `date_op`, `heure_op` — date et heure
- `type_op` — `'vente'` | `'achat'`
- `total_dh`, `remise_dh` — montants
- `utilisateur_id` — FK vers `utilisateurs.id`
- `client_id` — FK vers `clients.id_client` (nullable — renseigné en vente)
- `fournisseur_id` — FK vers `fournisseurs.id_fournisseur` (nullable — renseigné en achat, ajouté V2)
- `condition_paiement` — `'Espèce'` | `'Chèque'` | `'Versement'` (ajouté V2)
- `ref_paiement` — référence libre (renseignée si `condition_paiement = 'Versement'`, ajouté V2)
- `statut` — `'valide'` | `'en_attente'` | `'annule'`
- `observ` — observation libre
- `is_modified` — `BOOLEAN DEFAULT false` (traçabilité)
- `version` — `INTEGER DEFAULT 1` (numéro de version courant)
- ⚠️ `code_produit`, `qte`, `prix_dh`, `id_op` — **colonnes orphelines** (ancienne architecture, non alimentées)

**`operation_items`**
- `operation_id` — FK vers `operations.num_op`
- `produit_id` — FK vers `produits.code`
- `quantite`, `prix_unitaire`, `total_ligne`

### ⚠️ Vue SQL `v_operations_full` — OBSOLÈTE, NE PAS UTILISER

Cette vue a été abandonnée. Elle référençait `o.created_at` et `o.updated_at` qui **n'existent pas** dans la table `operations` réelle.

L'architecture retenue est celle des **requêtes séquentielles + jointure JS** (voir section Architecture History.tsx).

---

## Architecture Auth (App.tsx)

L'initialisation se fait en **un seul effet** :

1. `supabase.auth.getSession()` → récupère la session active
2. Si session : `supabase.from('utilisateurs').select('*')` → charge le profil
3. `finally { setIsLoading(false) }` — **toujours appelé**
4. `onAuthStateChange` écoute les changements suivants (ignore `INITIAL_SESSION`)

**États React :**
- `isLoading` (bool) — spinner affiché tant que `true`
- `user` (User | null) — de Supabase Auth
- `profile` (UserProfile | null) — de la table `utilisateurs`

**Fallback admin :** si `utilisateurs` retourne une erreur et que `email === 'aqch.fahd@gmail.com'`, le profil admin est injecté manuellement.

---

## Caisse (Cashier.tsx) — Flux de validation

### Vente (`type_op = 'vente'`)

```
1. INSERT header → operations   (statut='valide', num_op retourné)
   - client_id, condition_paiement, ref_paiement
   - fournisseur_id = null
2. INSERT lignes → operation_items (bulk)
3. UPDATE produits par item     (stock_actuel −qty, qte_vente +qty, valeur_stock)
4. Snapshot ticketItems + ticketOp (AVANT reset — données figées)
5. Reset UI state (cart, client, discount, search, conditionPaiement)
6. setTimeout(4s) → setSuccess(false)
7. Promise.resolve().then(() => generateTicketPDF())  ← microtask APRÈS commit React
```

### Achat (`type_op = 'achat'`)

```
1. INSERT header → operations   (statut='en_attente', num_op retourné)
   - fournisseur_id, condition_paiement, ref_paiement
   - client_id = null
2. INSERT lignes → operation_items (bulk)
   ⚠️ AUCUNE mise à jour de stock — le stock reste inchangé
3. Alert "Achat enregistré, en attente de validation" + reset UI
```

### Mode achat — comportements spécifiques

- **Sélecteur fournisseur** remplace le sélecteur client (toggle vente/achat)
- **Prix d'achat masqué** pour les caissiers (non-admin) dans la grille produits et le panier
- **Création rapide fournisseur** possible via modal inline (bouton "+" à côté du sélecteur)
- **Condition de paiement** : Espèce (défaut) | Chèque | Versement (+ champ réf si Versement)

### Recherche produits — scoring

```typescript
// Score 0 = code exact | 1 = code préfixe | 2 = code contains | 3 = nom contains
// Normalisation : retire les 0 en tête pour comparer "0001" ↔ "1"
```

### Validation Admin d'un achat (OperationDetailsModal.tsx — handleValidatePurchase)

Déclenchée quand l'admin ouvre un achat `en_attente` et clique "VALIDER L'ACHAT".

```
1. UPDATE operations  → statut='valide'
2. UPDATE operation_items → quantite, prix_unitaire, total_ligne (si modifiés)
3. Pour chaque article (try/catch individuel par produit) :
   a. SELECT produits.stock_actuel, qte_achat, prix_vente
   b. UPDATE produits :
      - stock_actuel  = stock_actuel + quantite
      - qte_achat     = qte_achat   + quantite
      - pdat          = prix_unitaire (prix d'achat réel)
      - valeur_stock  = (stock_actuel + quantite) × prix_vente
```

**Règle métier** : la mise à jour de stock n'a **jamais** lieu lors de la saisie initiale de l'achat. Elle est exclusivement déclenchée par la validation admin.

**Important :** Le PDF est toujours lancé via `Promise.resolve().then(...)` pour garantir que React a commité le state avant que jsPDF ne s'exécute de façon synchrone.

---

## Catégories produits (V2)

7 catégories métier fixes (pas de CRUD — constante côté JS) :

```
Matière première | Aliment composé | Additif | CMV | Bloc à lécher | Matériel | Produit Hygien
```

Colonne DB : `produits.categorie` (TEXT, nullable). Défaut côté JS : `'Matériel'`.

---

## Génération PDF (pdfGenerator.ts)

- Format A5 pour ≤ 10 articles, A4 au-delà
- Toujours `doc.save(filename)` — **jamais `window.open`**
- Paramètres : `TicketOperation` + `TicketItem[]`
- Fichier pur (pas de state React), appelable depuis n'importe où

---

## Architecture — Récupération des données (History.tsx + Inventory.tsx)

**NE PAS utiliser les jointures PostgREST imbriquées sur `produits`** (PGRST200 si FK non nommée).
Utiliser l'approche **requêtes séquentielles + jointure JS** :

```
1. from('operations').select('*').order('num_op').limit(200)
2. from('operation_items').select('*').in('operation_id', opIds)
3. from('produits').select('code, produit').in('code', produitIds)
→ Jointure manuelle en JavaScript : produitMap + itemsByOpId
```

**History.tsx** récupère en plus (étapes 4 à 7) :
```
4. from('utilisateurs').select('id, username, nom')         → agentMap
5. from('clients').select('id_client, nom_prenom')          → clientMap
6. from('fournisseurs').select('id_fournisseur, nom')       → fournisseurMap
   (uniquement les fournisseur_id présents dans opsData)
```

Cette approche fonctionne sans vue SQL, sans FK nommée, et est compatible offline-first.

---

## Architecture Admin (Admin.tsx) — 4 onglets

### Onglet 1 — Analytique (recharts)

`fetchAnalytics` : 4 requêtes en `Promise.all` + 2 séquentielles.

```
Promise.all :
  1. operations (12 mois glissants, vente+achat, valide) → KPIs, charts mensuels, paiements, clients
  2. produits (code, produit, qte_vente, valeur_stock, categorie) → stock, top 5, catégories
  3. fournisseurs (id_fournisseur, nom)
  4. operations (all-time, achat, valide, fournisseur non null) → top 5 fournisseurs

Séquentielles (après Promise.all) :
  5. operation_items pour venteOpIds → CA par catégorie
  6. clients pour topClientIds       → noms top 5 clients
```

**Timezone :** dates calculées via `Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' })`.
**Labels mois :** format `Jun '25 … Mai '26` (12 mois glissants, pas de doublons).

Composants recharts utilisés : `LineChart`, `BarChart` (normal + `layout="vertical"`), `PieChart`, `ResponsiveContainer`, `Tooltip`, `Legend`, `CartesianGrid`, `XAxis`, `YAxis`, `Line`, `Bar`, `Pie`, `Cell`.

### Onglet 2 — Utilisateurs
CRUD utilisateurs via `createSecondaryClient()` (signUp sans déconnecter l'admin). Badge "Connecté" animé pour l'utilisateur actuel.

### Onglet 3 — Fournisseurs
CRUD complet. `achatsMap: Record<number, number>` = total achats validés par fournisseur.
Champs conditionnels dans modal : IRC+ICE (Société) | CIN (Personne physique).

### Onglet 4 — Système
Import CSV produits/clients + Backup Cloud (Supabase) + Synchroniser + Infrastructure panel.

---

## Timezone Maroc (GMT+1 + Ramadan)

**Toujours utiliser :**
```typescript
const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
// → "YYYY-MM-DD" en heure marocaine, gère automatiquement DST et Ramadan
```

**Ne jamais utiliser :** `new Date(Date.now() + 3600000)` (offset fixe, bug au changement d'heure).

---

## Règles de développement

- **Pas de `window.open`** pour les PDFs — utiliser `doc.save()`
- **Pas de logique d'auth custom** — toujours utiliser les helpers Supabase
- **Snapshots avant reset** — capturer les données nécessaires avant tout `setCart([])`
- **`produits.code`** est la PK, pas `id` — toutes les requêtes SQL/JS doivent utiliser `.eq('code', ...)`
- **`clients.id_client`** est la PK, pas `id` — utiliser `.in('id_client', ...)` et `.select('id_client, nom_prenom')`
- **`clients.nom_prenom`** est le nom du client, pas `nom` — ne jamais requêter `.select('nom')`
- **`utilisateurs.username`** est le nom affiché — la colonne `nom` est toujours NULL en production
- **`utilisateurs.actif`** est le booléen actif, pas `is_active`
- **`fournisseurs.id_fournisseur`** est la PK — utiliser `.eq('id_fournisseur', ...)` et `.in('id_fournisseur', ...)`
- **Pas de nested joins via PostgREST** sur `produits` — utiliser les requêtes séquentielles + jointure JS
- **Prix d'achat (`pdat`)** — visible uniquement si `profile?.roleId === 'admin'` (masqué pour caissiers en mode achat)
- **Catégories** — constantes JS, pas de table DB. Défaut : `'Matériel'`
- **Import logo** — `import logo from '@/logo.png'` (alias Vite `@` = racine projet)
- **State simple** — préférer un `isLoading` plat à des `ref` + logique de retry complexe
- **Offline-First** — direction vers laquelle le projet évolue (pas encore implémenté)

---

## Variables d'environnement

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Fichier : `.env.local` à la racine.

---

## Script SQL V2 (migrations appliquées)

```sql
-- Table fournisseurs
CREATE TABLE IF NOT EXISTS fournisseurs (
  id_fournisseur SERIAL PRIMARY KEY,
  type           TEXT NOT NULL DEFAULT 'Personne physique',
  nom            TEXT NOT NULL,
  num_telephone  TEXT,
  adresse        TEXT,
  irc            TEXT,
  ice            TEXT,
  cin            TEXT
);

-- Colonnes ajoutées à operations
ALTER TABLE operations ADD COLUMN IF NOT EXISTS fournisseur_id    INTEGER REFERENCES fournisseurs(id_fournisseur);
ALTER TABLE operations ADD COLUMN IF NOT EXISTS condition_paiement TEXT DEFAULT 'Espèce';
ALTER TABLE operations ADD COLUMN IF NOT EXISTS ref_paiement       TEXT;

-- Colonne ajoutée à produits
ALTER TABLE produits ADD COLUMN IF NOT EXISTS categorie TEXT;
```

---

## Corrections appliquées

| # | Problème | Fichier | Statut |
|---|---|---|---|
| 1 | F5 → spinner infini | `App.tsx` | ✅ `initializeApp` avec try/catch/finally simple |
| 2 | PGRST200 — History vide | `History.tsx` | ✅ Requêtes séquentielles + jointure JS |
| 3 | History — noms/qtés introuvables | `History.tsx` | ✅ Même approche séquentielle avec `produitMap` |
| 4 | handlePrintTicket — jointure cassée | `History.tsx` | ✅ Remplacé par `operation_items` + `produits` séquentiel |
| 5 | PDF freeze UI | `Cashier.tsx` | ✅ Microtask `Promise.resolve().then()` |
| 6 | Qty input non éditable | `Cashier.tsx` | ✅ Input visible avec border emerald + focus ring |
| 7 | History — erreur silencieuse | `History.tsx` | ✅ `fetchError` state + bandeau rouge + bouton Réessayer |
| 8 | Inventory `fetchMovements` cassé | `Inventory.tsx` | ✅ 3 requêtes séquentielles (`operation_items` → `produits` → `operations`) |
| 9 | History — colonne Agent vide | `History.tsx` | ✅ Requête `utilisateurs` avec `nom \|\| username` fallback |
| 10 | History — colonne Client jamais affichée | `History.tsx` | ✅ Requête `id_client, nom_prenom` (noms réels des colonnes) |
| 11 | Modal OperationDetails — pas de métadonnées | `OperationDetailsModal.tsx` | ✅ Grille date/heure/agent/client/observation + historique versioning |
| 12 | Dashboard — seuil statique | `Dashboard.tsx` | ✅ Texte "Seuil d'alerte dynamique par produit" |
| 13 | Dashboard — timezone bug | `Dashboard.tsx` | ✅ `Intl.DateTimeFormat('Africa/Casablanca')` |
| 14 | History — bouton PDF actif pour en_attente | `History.tsx` | ✅ Bouton désactivé si `statut === 'en_attente'` |
| 15 | Inventory — titre onglet hist_stock | `Inventory.tsx` | ✅ Renommé "Historique de Stock" |
| 16 | Inventory — signe quantité mouvements | `Inventory.tsx` | ✅ `-X` rouge (vente) / `+X` vert (achat) |
| 17 | Clients — champ Fonction libre | `Clients.tsx` | ✅ Remplacé par `<select>` avec 6 options métier |
| 18 | supabase.ts — `ImportMeta.env` TS error | `vite-env.d.ts` | ✅ Créé avec `/// <reference types="vite/client" />` |
| 19 | Admin.tsx — onglet Analytique vide | `Admin.tsx` | ✅ recharts : 4 KPIs + LineChart + 2 BarCharts + 2 PieCharts + 2 Top 5 |
| 20 | Branding — icône générique dans sidebar/login | `Sidebar.tsx`, `Login.tsx` | ✅ Logo `logo.png` intégré via alias `@/` |
