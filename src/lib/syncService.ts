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
      .select('code, produit, categorie, prix_vente, pdat, stock_actuel, seuil_alerte, is_active');

    if (prodErr) throw new Error(`produits: ${prodErr.message}`);

    const produits: LocalProduit[] = (produitsRaw || []).map((p: any) => ({
      code:         p.code,
      produit:      p.produit,
      categorie:    p.categorie ?? null,
      prix_vente:   parseFloat(p.prix_vente || 0),
      pdat:         parseFloat(p.pdat || 0),
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

  const pendingItems = await db.sync_queue
    .where('status')
    .equals('pending')
    .toArray();

  if (pendingItems.length === 0) return result;

  console.info(`[Sync] pushing ${pendingItems.length} queued operation(s)…`);

  for (const item of pendingItems) {
    // Mark as processing to avoid double-submit if called concurrently
    await db.sync_queue.update(item.id!, { status: 'processing' });

    try {
      const payload = JSON.parse(item.payload);

      if (item.type === 'operation' || item.type === 'retour_client') {
        // Each queued payload contains { header, items }
        const { header, items } = payload as {
          header: Record<string, unknown>;
          items: Record<string, unknown>[];
        };

        // ── Idempotence : si un retry précédent a déjà inséré ce header,
        //    on le retrouve via son id_op (UUID généré côté client à l'enqueue)
        //    au lieu de créer un doublon.
        let parentId: number | null = null;
        if (header.id_op) {
          const { data: existing, error: findErr } = await supabase
            .from('operations')
            .select('num_op')
            .eq('id_op', header.id_op as string)
            .maybeSingle();
          if (findErr) throw new Error(findErr.message);
          if (existing) parentId = (existing as any).num_op;
        }

        if (parentId == null) {
          const { data: newOp, error: opErr } = await supabase
            .from('operations')
            .insert(header)
            .select()
            .single();
          if (opErr) throw new Error(opErr.message);
          parentId = (newOp as any).num_op;
        }

        // Insert operation items with resolved operation_id (skip si déjà présents — retry-safe)
        if (items.length > 0) {
          const { count: existingItems, error: cntErr } = await supabase
            .from('operation_items')
            .select('id', { count: 'exact', head: true })
            .eq('operation_id', parentId);
          if (cntErr) throw new Error(cntErr.message);

          if (!existingItems) {
            const itemRows = items.map((i) => ({ ...i, operation_id: parentId }));
            const { error: itemsErr } = await supabase
              .from('operation_items')
              .insert(itemRows);
            if (itemsErr) throw new Error(itemsErr.message);
          }
        }

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
 * - ONLINE  → inserts directly into Supabase (returns the real `num_op`)
 * - OFFLINE → queues the payload in Dexie sync_queue (returns a local `LOC-XXXXXX` id)
 *
 * The caller uses the returned id for the PDF ticket regardless of the path.
 */
export async function commitOperation(
  header: Record<string, unknown>,
  items: Record<string, unknown>[]
): Promise<{ numOp: number | string; queued: boolean }> {

  if (!isOnline()) {
    // id_op généré côté client = clé d'idempotence du push (retry sans doublon)
    const headerWithId = { id_op: crypto.randomUUID(), ...header };
    await enqueueOperation('operation', headerWithId, items);
    const localId = `LOC-${Date.now().toString().slice(-6)}`;
    console.info(`[Sync] commitOperation — offline, enqueued as ${localId}`);
    return { numOp: localId, queued: true };
  }

  // Online path — direct Supabase, same as the original Cashier flow
  const { data: newOp, error: opErr } = await supabase
    .from('operations')
    .insert(header)
    .select()
    .single();

  if (opErr) throw new Error(opErr.message);
  const parentId: number = (newOp as any).num_op;

  if (items.length > 0) {
    const itemRows = items.map((i) => ({ ...i, operation_id: parentId }));
    const { error: itemsErr } = await supabase.from('operation_items').insert(itemRows);
    if (itemsErr) throw new Error(itemsErr.message);
  }

  console.info(`[Sync] commitOperation — online, num_op=${parentId}`);
  return { numOp: parentId, queued: false };
}

// ── Full sync (pull + push) ───────────────────────────────────────────────────

/**
 * Convenience function for a complete sync cycle.
 * Call on app startup and on `window.online` events.
 */
export async function syncAll(): Promise<void> {
  await pushPendingOperations(); // push first to avoid stale read-back
  await pullMasterData();
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
