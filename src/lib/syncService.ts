/**
 * syncService.ts — Bidirectional sync between Supabase (remote) and Dexie (local).
 * Phase 1: infrastructure only.
 *
 * pullMasterData()        → Supabase → IndexedDB  (read-only reference data)
 * pushPendingOperations() → IndexedDB → Supabase  (offline-queued writes)
 */

import { supabase } from '../supabase';
import { db, type LocalProduit, type LocalClient, type LocalFournisseur, type SyncQueueItem } from './db';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;

// ── Online guard ──────────────────────────────────────────────────────────────

function isOnline(): boolean {
  return navigator.onLine;
}

// navigator.onLine peut MENTIR (portail captif, Wi-Fi sans internet réel…).
// Cette heuristique reconnaît les échecs réseau de fetch pour basculer en file
// locale au lieu de perdre l'opération.
function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|timeout/i.test(msg);
}

// ── Horodatage de la dernière synchro réussie (affiché dans le Hub) ───────────

const LAST_SYNC_KEY = 'gf_last_sync_at';

export function getLastSyncAt(): string | null {
  try { return localStorage.getItem(LAST_SYNC_KEY); } catch { return null; }
}

function markSyncSuccess(): void {
  try { localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString()); } catch { /* quota */ }
}

// ── PULL: Supabase → Dexie ────────────────────────────────────────────────────

/**
 * Fetches all master data from Supabase and bulk-upserts into local Dexie tables.
 * Safe to call repeatedly — uses `bulkPut` (upsert, not insert).
 * No-op when offline.
 */
export async function pullMasterData(): Promise<{ success: boolean; error?: string }> {
  if (!isOnline()) {
    console.info('[Sync] pullMasterData — skipped (offline)');
    return { success: false, error: 'offline' };
  }

  try {
    // ── Produits ──────────────────────────────────────────────────────────────
    const { data: produitsRaw, error: prodErr } = await supabase
      .from('produits')
      .select('code, produit, categorie, prix_vente, pdat, pamp, stock_actuel, seuil_alerte, is_active');

    if (prodErr) throw new Error(`produits: ${prodErr.message}`);

    const produits: LocalProduit[] = (produitsRaw || []).map((p: any) => ({
      code:         p.code,
      produit:      p.produit,
      categorie:    p.categorie ?? null,
      prix_vente:   parseFloat(p.prix_vente || 0),
      pdat:         parseFloat(p.pdat || 0),
      pamp:         p.pamp != null ? parseFloat(p.pamp) : null, // figé à la vente (Phase 2) — confidentiel, jamais affiché
      stock_actuel: parseFloat(p.stock_actuel || 0),
      seuil_alerte: p.seuil_alerte != null ? parseInt(p.seuil_alerte) : 10,
      is_active:    p.is_active !== false,
    }));

    await db.produits.bulkPut(produits);
    console.info(`[Sync] produits cached: ${produits.length} rows`);

    // ── Clients ───────────────────────────────────────────────────────────────
    const { data: clientsRaw, error: cliErr } = await supabase
      .from('clients')
      .select('id_client, nom_prenom, num_telephone, fonction, actif');

    if (cliErr) throw new Error(`clients: ${cliErr.message}`);

    const clients: LocalClient[] = (clientsRaw || []).map((c: any) => ({
      id_client:     c.id_client,
      nom_prenom:    c.nom_prenom,
      num_telephone: c.num_telephone ?? null,
      fonction:      c.fonction ?? null,
      actif:         c.actif !== false,
    }));

    await db.clients.bulkPut(clients);
    console.info(`[Sync] clients cached: ${clients.length} rows`);

    // ── Fournisseurs ──────────────────────────────────────────────────────────
    const { data: fournsRaw, error: fourErr } = await supabase
      .from('fournisseurs')
      .select('id_fournisseur, nom, type, num_telephone');

    if (fourErr) throw new Error(`fournisseurs: ${fourErr.message}`);

    const fournisseurs: LocalFournisseur[] = (fournsRaw || []).map((f: any) => ({
      id_fournisseur: f.id_fournisseur,
      nom:            f.nom,
      type:           f.type ?? null,
      num_telephone:  f.num_telephone ?? null,
    }));

    await db.fournisseurs.bulkPut(fournisseurs);
    console.info(`[Sync] fournisseurs cached: ${fournisseurs.length} rows`);

    return { success: true };
  } catch (err: any) {
    console.error('[Sync] pullMasterData error:', err);
    return { success: false, error: err.message || String(err) };
  }
}

// ── PUSH: Dexie → Supabase ────────────────────────────────────────────────────

/**
 * Reads all 'pending' items from sync_queue, attempts to push each to Supabase.
 * On success → deletes the item from the queue.
 * On failure → increments retryCount; marks as 'failed' after MAX_RETRIES.
 * No-op when offline.
 */
export async function pushPendingOperations(): Promise<{
  pushed: number;
  failed: number;
  skipped: number;
}> {
  const result = { pushed: 0, failed: 0, skipped: 0 };

  if (!isOnline()) {
    console.info('[Sync] pushPendingOperations — skipped (offline)');
    result.skipped = await db.sync_queue.where('status').equals('pending').count();
    return result;
  }

  // Récupère les items restés bloqués en 'processing' (crash / refresh pendant
  // un push précédent) — sinon ils deviennent invisibles pour toujours.
  await db.sync_queue.where('status').equals('processing').modify({ status: 'pending' });

  const pendingItems = await db.sync_queue
    .where('status')
    .equals('pending')
    .toArray();

  if (pendingItems.length === 0) return result;

  // ── GRAPHE DE DÉPENDANCES : les fiches maîtres (clients/fournisseurs créés
  //    hors-ligne) passent AVANT les opérations qui les référencent — sinon
  //    violation FK garantie. Chronologique à l'intérieur de chaque groupe.
  const TYPE_PRIORITY: Record<string, number> = { client: 0, fournisseur: 0, operation: 1, retour_client: 1 };
  pendingItems.sort((a, b) =>
    (TYPE_PRIORITY[a.type] ?? 1) - (TYPE_PRIORITY[b.type] ?? 1) || a.createdAt - b.createdAt
  );

  console.info(`[Sync] pushing ${pendingItems.length} queued item(s)…`);

  for (const item of pendingItems) {
    // Mark as processing to avoid double-submit if called concurrently
    await db.sync_queue.update(item.id!, { status: 'processing' });

    try {
      const payload = JSON.parse(item.payload);

      if (item.type === 'client' || item.type === 'fournisseur') {
        // ── Fiche maître créée hors-ligne : insertion + résolution de l'id réel
        //    + réécriture des opérations en file qui pointent l'id temporaire.
        await pushMasterRecord(item, payload as MasterRecordPayload);
      } else if (item.type === 'operation' || item.type === 'retour_client') {
        // Each queued payload contains { header, items }
        const { header, items } = payload as {
          header: Record<string, unknown>;
          items: Record<string, unknown>[];
        };

        // Garde : une opération qui référence encore un id temporaire (négatif)
        // ne doit JAMAIS partir — la fiche maître correspondante a échoué plus
        // haut dans ce même push. Erreur claire, retry au prochain cycle.
        if ((typeof header.client_id === 'number' && (header.client_id as number) < 0) ||
            (typeof header.fournisseur_id === 'number' && (header.fournisseur_id as number) < 0)) {
          throw new Error('Dépendance non résolue : le client/fournisseur créé hors-ligne n\'est pas encore synchronisé.');
        }

        // ── RPC commit_operation : pré-contrôles FK + idempotence id_op +
        //    en-tête + lignes en UNE transaction serveur. Un refus (client
        //    supprimé, produit disparu, doublon) lève une erreur claire SANS
        //    consommer le numéro séquentiel → plus de trous comptables.
        const { data: commitRes, error: commitErr } = await supabase.rpc('commit_operation', {
          p_header: header,
          p_items: items,
        });
        if (commitErr) throw new Error(commitErr.message);
        const parentId = Number((commitRes as any)?.num_op);
        if (!Number.isFinite(parentId)) throw new Error('commit_operation : num_op manquant dans la réponse');

        // ── STOCK CENTRAL : applique les deltas des opérations hors-ligne.
        //    Ventes validées → stock −qté ; retours client → stock +qté.
        //    Achats : AUCUN delta ici (stock appliqué à la validation admin).
        //    RPC atomique (UPDATE unique) + flag stockApplied = pas de double application.
        if (!item.stockApplied) {
          const typeOp = String(header.type_op || '');
          const isQueuedVente = typeOp === 'vente' && header.statut === 'valide';
          const isQueuedRetour = typeOp === 'retour_client';

          if (isQueuedVente || isQueuedRetour) {
            for (const it of items) {
              const qty = parseFloat(String(it.quantite ?? 0));
              if (!qty) continue;
              const { error: rpcErr } = await supabase.rpc('apply_stock_delta', {
                p_code: String(it.produit_id),
                p_delta_stock: isQueuedVente ? -qty : qty,
                p_delta_qte_vente: isQueuedVente ? qty : -qty,
              });
              if (rpcErr) throw new Error(`stock ${it.produit_id}: ${rpcErr.message}`);
            }
          }
          await db.sync_queue.update(item.id!, { stockApplied: true });
        }
      } else {
        console.warn(`[Sync] unknown queue item type: ${item.type} — skipping`);
        result.skipped++;
        await db.sync_queue.update(item.id!, { status: 'pending' }); // restore
        continue;
      }

      // Success → remove from queue
      await db.sync_queue.delete(item.id!);
      result.pushed++;
      console.info(`[Sync] queue item ${item.id} pushed OK`);
    } catch (err: any) {
      const retries = (item.retryCount ?? 0) + 1;
      const newStatus = retries >= MAX_RETRIES ? 'failed' : 'pending';
      await db.sync_queue.update(item.id!, {
        status:     newStatus,
        retryCount: retries,
        lastError:  err.message || String(err),
      });
      result.failed++;
      console.error(`[Sync] queue item ${item.id} error (attempt ${retries}):`, err.message);
    }
  }

  console.info(`[Sync] push complete — pushed:${result.pushed} failed:${result.failed}`);
  return result;
}

// ── commitOperation: transparent online/offline write ────────────────────────

/**
 * The single entry-point for creating an operation from the Cashier.
 *
 * - ONLINE  → RPC `commit_operation` (atomique, anti-brûlage de séquence)
 * - OFFLINE → file Dexie sync_queue, id local temporaire `OFF-XXXXXXXX`.
 *   Le numéro séquentiel OP-XXXX n'est attribué QUE par la RPC lors de
 *   l'insertion finale réussie — plus de trous dans la numérotation.
 *
 * The caller uses the returned id for the PDF ticket regardless of the path.
 */
export async function commitOperation(
  header: Record<string, unknown>,
  items: Record<string, unknown>[]
): Promise<{ numOp: number | string; queued: boolean }> {

  // id_op généré côté client SUR LES DEUX CHEMINS = clé d'idempotence du push.
  // Même un échec online PARTIEL peut être mis en file sans risque : la RPC
  // retrouvera l'opération par id_op et ne créera ni doublon ni double stock.
  const headerWithId = { id_op: crypto.randomUUID(), ...header };

  const enqueueFallback = async (reason: string) => {
    await enqueueOperation('operation', headerWithId, items);
    // Id TEMPORAIRE local — le vrai numéro séquentiel sera attribué par la RPC
    const localId = `OFF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    console.warn(`[Sync] commitOperation — ${reason}, enqueued as ${localId}`);
    return { numOp: localId, queued: true as const };
  };

  // Une opération qui référence un client/fournisseur créé hors-ligne (id négatif)
  // passe DIRECTEMENT en file : le push synchronisera la fiche maître d'abord,
  // réécrira la FK, puis poussera l'opération — jamais de violation FK.
  const hasTempRefs =
    (typeof header.client_id === 'number' && (header.client_id as number) < 0) ||
    (typeof header.fournisseur_id === 'number' && (header.fournisseur_id as number) < 0);

  if (!isOnline() || hasTempRefs) {
    return enqueueFallback(hasTempRefs ? 'références locales à synchroniser d\'abord' : 'offline');
  }

  // Online path — RPC atomique
  try {
    const { data: commitRes, error: commitErr } = await supabase.rpc('commit_operation', {
      p_header: headerWithId,
      p_items: items,
    });
    if (commitErr) throw new Error(commitErr.message);
    const parentId = Number((commitRes as any)?.num_op);
    if (!Number.isFinite(parentId)) throw new Error('commit_operation : num_op manquant dans la réponse');

    console.info(`[Sync] commitOperation — online, num_op=${parentId}`);
    return { numOp: parentId, queued: false };
  } catch (err) {
    // navigator.onLine mentait : une erreur RÉSEAU bascule l'opération en file
    // locale au lieu de la perdre. Les vraies erreurs métier (contrainte DB,
    // RLS…) continuent de remonter au caller.
    if (isNetworkError(err)) {
      return enqueueFallback('réseau KO malgré onLine');
    }
    throw err;
  }
}

// ── Full sync (pull + push) ───────────────────────────────────────────────────

/**
 * Convenience function for a complete sync cycle.
 * Call on app startup and on `window.online` events.
 */
export async function syncAll(): Promise<void> {
  const pushResult = await pushPendingOperations(); // push first to avoid stale read-back
  const pullResult = await pullMasterData();
  if (pullResult.success && pushResult.failed === 0) markSyncSuccess();
}

// ── Gestion de la file (Hub de synchronisation) ───────────────────────────────

/** Relance UN élément en échec : repasse en 'pending' (compteur remis à zéro) puis push. */
export async function retryQueueItem(id: number): Promise<void> {
  await db.sync_queue.update(id, { status: 'pending', retryCount: 0, lastError: null });
  await pushPendingOperations();
}

/** Relance TOUS les éléments en échec. */
export async function retryAllFailed(): Promise<void> {
  await db.sync_queue
    .where('status')
    .equals('failed')
    .modify({ status: 'pending', retryCount: 0, lastError: null });
  await pushPendingOperations();
}

/** Supprime définitivement un élément de la file (action destructive — confirmée en UI). */
export async function deleteQueueItem(id: number): Promise<void> {
  await db.sync_queue.delete(id);
}

// ── Queue helper ──────────────────────────────────────────────────────────────

/**
 * Enqueues an offline operation when Supabase is unreachable.
 * `header` = the operations row payload.
 * `items`  = the operation_items rows (without operation_id — resolved on push).
 */
export async function enqueueOperation(
  type: SyncQueueItem['type'],
  header: Record<string, unknown>,
  items: Record<string, unknown>[]
): Promise<number> {
  const id = await db.sync_queue.add({
    type,
    payload:    JSON.stringify({ header, items }),
    status:     'pending',
    retryCount: 0,
    lastError:  null,
    createdAt:  Date.now(),
  });
  console.info(`[Sync] operation enqueued — id:${id} type:${type}`);
  return id as number;
}

// ── Fiches maîtres créées hors-ligne (clients / fournisseurs) ─────────────────

export interface MasterRecordPayload {
  tempId: number;                    // id local NÉGATIF (jamais en collision avec un serial)
  record: Record<string, unknown>;   // colonnes réelles de la table cible
}

/** File une fiche maître créée hors-ligne — synchronisée AVANT les opérations. */
export async function enqueueMasterRecord(
  type: 'client' | 'fournisseur',
  tempId: number,
  record: Record<string, unknown>
): Promise<number> {
  const id = await db.sync_queue.add({
    type,
    payload:    JSON.stringify({ tempId, record }),
    status:     'pending',
    retryCount: 0,
    lastError:  null,
    createdAt:  Date.now(),
  });
  console.info(`[Sync] fiche ${type} enqueued — temp:${tempId} queue:${id}`);
  return id as number;
}

/**
 * Pousse une fiche maître vers Supabase, résout son id réel, met à jour Dexie,
 * puis RÉÉCRIT toutes les opérations en file qui référencent l'id temporaire.
 * Idempotent : un retry retrouve la fiche par (nom + téléphone) sans doublon.
 */
async function pushMasterRecord(item: SyncQueueItem, payload: MasterRecordPayload): Promise<void> {
  const { tempId, record } = payload;
  const isClient = item.type === 'client';
  const table = isClient ? 'clients' : 'fournisseurs';
  const idCol = isClient ? 'id_client' : 'id_fournisseur';
  const nameCol = isClient ? 'nom_prenom' : 'nom';

  // ── Idempotence : déjà insérée par un retry précédent ? ────────────────────
  let realId: number | null = null;
  const { data: existing, error: findErr } = await supabase
    .from(table)
    .select(`${idCol}, num_telephone`)
    .eq(nameCol, String(record[nameCol] ?? ''));
  if (findErr) throw new Error(findErr.message);
  const tel = String(record.num_telephone ?? '');
  const match = (existing || []).find((r: any) => String(r.num_telephone ?? '') === tel);
  if (match) realId = (match as any)[idCol];

  if (realId == null) {
    const { data: inserted, error: insErr } = await supabase
      .from(table)
      .insert(record)
      .select(idCol)
      .single();
    if (insErr) throw new Error(insErr.message);
    realId = (inserted as any)[idCol];
  }

  // ── Dexie : remplace la fiche temporaire par la fiche réelle ────────────────
  if (isClient) {
    await db.clients.delete(tempId);
    await db.clients.put({
      id_client:     realId!,
      nom_prenom:    String(record.nom_prenom ?? ''),
      num_telephone: (record.num_telephone as string | null) ?? null,
      fonction:      (record.fonction as string | null) ?? null,
      actif:         true,
    });
  } else {
    await db.fournisseurs.delete(tempId);
    await db.fournisseurs.put({
      id_fournisseur: realId!,
      nom:            String(record.nom ?? ''),
      type:           (record.type as string | null) ?? null,
      num_telephone:  (record.num_telephone as string | null) ?? null,
    });
  }

  // ── Réécriture des opérations en file qui pointent l'id temporaire ──────────
  const fkField = isClient ? 'client_id' : 'fournisseur_id';
  const all = await db.sync_queue.toArray();
  for (const o of all) {
    if (o.type !== 'operation' && o.type !== 'retour_client') continue;
    try {
      const pl = JSON.parse(o.payload);
      if (pl?.header?.[fkField] === tempId) {
        pl.header[fkField] = realId;
        await db.sync_queue.update(o.id!, { payload: JSON.stringify(pl) });
        console.info(`[Sync] op en file ${o.id} : ${fkField} ${tempId} → ${realId}`);
      }
    } catch { /* payload illisible — ignoré */ }
  }

  console.info(`[Sync] fiche ${item.type} synchronisée — temp:${tempId} → réel:${realId}`);
}
