/**
 * GharbFeedDB — Dexie (IndexedDB) local database.
 * Phase 1: infrastructure only. UI components are NOT wired up yet.
 *
 * Tables:
 *   Master data  → produits, clients, fournisseurs  (pulled from Supabase)
 *   Offline queue → sync_queue                       (pushed to Supabase when online)
 */

import Dexie, { type Table } from 'dexie';

// ── Master data types (lightweight — only the fields we cache locally) ────────

export interface LocalProduit {
  code: string;           // PK
  produit: string;
  categorie?: string | null;
  prix_vente: number;
  pdat?: number;          // purchase price (admin only)
  stock_actuel: number;
  seuil_alerte?: number;
  is_active?: boolean;
}

export interface LocalClient {
  id_client: number;      // PK
  nom_prenom: string;
  num_telephone?: string | null;
  fonction?: string | null;
}

export interface LocalFournisseur {
  id_fournisseur: number; // PK
  nom: string;
  type?: string | null;
  num_telephone?: string | null;
}

// ── Offline queue ─────────────────────────────────────────────────────────────

export type SyncQueueStatus = 'pending' | 'processing' | 'failed';
export type SyncQueueType   = 'operation' | 'retour_client';

export interface SyncQueueItem {
  id?: number;                      // auto-increment PK
  type: SyncQueueType;
  payload: string;                  // JSON-stringified operation payload
  status: SyncQueueStatus;
  retryCount: number;
  lastError?: string | null;
  createdAt: number;                // Unix ms timestamp
}

// ── Dexie class ───────────────────────────────────────────────────────────────

class GharbFeedDatabase extends Dexie {
  produits!:     Table<LocalProduit,     string>;   // PK = code (text)
  clients!:      Table<LocalClient,      number>;   // PK = id_client
  fournisseurs!: Table<LocalFournisseur, number>;   // PK = id_fournisseur
  sync_queue!:   Table<SyncQueueItem,    number>;   // PK = id (auto-increment)

  constructor() {
    super('GharbFeedDB');

    this.version(1).stores({
      // Indexed fields listed after PK. Non-indexed fields still stored — just not queryable.
      produits:     'code, produit, categorie, prix_vente, stock_actuel, is_active',
      clients:      'id_client, nom_prenom',
      fournisseurs: 'id_fournisseur, nom',
      sync_queue:   '++id, type, status, createdAt',
    });
  }
}

export const db = new GharbFeedDatabase();
