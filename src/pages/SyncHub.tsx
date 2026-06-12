import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SyncQueueItem } from '../lib/db';
import {
  syncAll,
  retryQueueItem,
  retryAllFailed,
  deleteQueueItem,
  pullMasterData,
  getLastSyncAt,
} from '../lib/syncService';
import { UserProfile } from '../types';
import {
  RefreshCw,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Trash2,
  RotateCcw,
  Database,
  CloudUpload,
  Inbox,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { toast, askConfirm } from '../lib/notify';

interface SyncHubProps {
  profile: UserProfile | null;
}

// Résumé lisible d'un élément de file (le payload est du JSON brut)
function summarizeItem(item: SyncQueueItem): { label: string; detail: string } {
  try {
    // Fiches maîtres créées hors-ligne (synchronisées AVANT les opérations)
    if (item.type === 'client' || item.type === 'fournisseur') {
      const { record } = JSON.parse(item.payload) as { record: Record<string, unknown> };
      const nom = String(record?.nom_prenom ?? record?.nom ?? '—');
      return {
        label: item.type === 'client' ? 'Nouveau client' : 'Nouveau fournisseur',
        detail: `${nom}${record?.num_telephone ? ` · ${record.num_telephone}` : ''} · sera synchronisé en priorité`,
      };
    }

    const { header, items } = JSON.parse(item.payload) as {
      header: Record<string, unknown>;
      items: unknown[];
    };
    const typeOp = String(header.type_op || item.type);
    const label =
      typeOp === 'vente' ? 'Vente'
      : typeOp === 'achat' ? 'Achat'
      : typeOp === 'retour_client' ? 'Retour client'
      : typeOp === 'retour_fournisseur' ? 'Retour fournisseur'
      : typeOp;
    const total = parseFloat(String(header.total_dh ?? 0));
    const when = [header.date_op, String(header.heure_op || '').slice(0, 5)].filter(Boolean).join(' ');
    return {
      label,
      detail: `${when} · ${total.toFixed(2)} DH · ${items?.length ?? 0} article(s)`,
    };
  } catch {
    return { label: item.type, detail: 'Payload illisible' };
  }
}

export default function SyncHub({ profile: _profile }: SyncHubProps) {
  // État réseau réel (avec écouteurs — pas un simple snapshot)
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const [syncing, setSyncing] = useState(false);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(() => getLastSyncAt());

  // ── Lectures LIVE de la base locale (mise à jour automatique) ───────────────
  const queue = useLiveQuery(() => db.sync_queue.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const nbProduits = useLiveQuery(() => db.produits.count(), []) ?? 0;
  const nbClients = useLiveQuery(() => db.clients.count(), []) ?? 0;
  const nbFournisseurs = useLiveQuery(() => db.fournisseurs.count(), []) ?? 0;

  const pending = queue.filter((q) => q.status === 'pending' || q.status === 'processing');
  const failed = queue.filter((q) => q.status === 'failed');

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await syncAll();
      setLastSync(getLastSyncAt());
    } catch (err) {
      toast.error('Erreur de synchronisation : ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSyncing(false);
    }
  };

  const handleRefreshCatalog = async () => {
    setRefreshingCatalog(true);
    try {
      const res = await pullMasterData();
      if (!res.success) toast.error('Rafraîchissement impossible : ' + (res.error || 'inconnu'));
      else { setLastSync(getLastSyncAt()); toast.success('Catalogue local rafraîchi.'); }
    } finally {
      setRefreshingCatalog(false);
    }
  };

  const handleRetryOne = async (item: SyncQueueItem) => {
    try {
      await retryQueueItem(item.id!);
      setLastSync(getLastSyncAt());
    } catch (err) {
      toast.error('Erreur : ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleRetryAllFailed = async () => {
    try {
      await retryAllFailed();
      setLastSync(getLastSyncAt());
    } catch (err) {
      toast.error('Erreur : ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleDelete = async (item: SyncQueueItem) => {
    const { label, detail } = summarizeItem(item);
    const ok = await askConfirm({
      title: 'Supprimer définitivement cet élément ?',
      message: `${label} — ${detail}\n\nCette opération n'a JAMAIS été envoyée au serveur : la supprimer = la perdre pour toujours.`,
      confirmLabel: 'Supprimer pour toujours',
      danger: true,
    });
    if (!ok) return;
    await deleteQueueItem(item.id!);
    toast.info('Élément supprimé de la file locale.');
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="space-y-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              <CloudUpload className="h-6 w-6 text-emerald-500" />
              CENTRE DE SYNCHRONISATION
            </h2>
            <p className="text-sm text-slate-500 font-medium">
              File hors-ligne, catalogue local et état de la connexion.
            </p>
          </div>
          <button
            onClick={handleSyncNow}
            disabled={syncing || !online}
            className="flex items-center gap-2 px-5 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-40 disabled:shadow-none"
            title={!online ? 'Impossible hors ligne' : 'Pousser la file et rafraîchir le catalogue'}
          >
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
            {syncing ? 'SYNCHRONISATION...' : 'SYNCHRONISER MAINTENANT'}
          </button>
        </div>

        {/* ── Cartes d'état ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className={cn('rounded-2xl border p-5 shadow-sm', online ? 'bg-white border-slate-200' : 'bg-amber-50 border-amber-300')}>
            <div className="flex items-center justify-between mb-3">
              <span className={cn('text-[10px] font-black uppercase tracking-widest', online ? 'text-slate-400' : 'text-amber-600')}>Connexion</span>
              <div className={cn('h-8 w-8 rounded-xl flex items-center justify-center', online ? 'bg-emerald-50' : 'bg-amber-100')}>
                {online ? <Wifi className="h-4 w-4 text-emerald-500" /> : <WifiOff className="h-4 w-4 text-amber-600" />}
              </div>
            </div>
            <p className={cn('text-xl font-black', online ? 'text-emerald-600' : 'text-amber-700')}>
              {online ? 'En ligne' : 'Hors ligne'}
            </p>
            <p className="text-xs text-slate-400 font-medium mt-1">
              {online ? 'Les opérations partent directement au cloud' : 'Les opérations sont sauvegardées localement'}
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dernière synchro</span>
              <div className="h-8 w-8 bg-blue-50 rounded-xl flex items-center justify-center"><Clock className="h-4 w-4 text-blue-500" /></div>
            </div>
            <p className="text-xl font-black text-slate-900">
              {lastSync ? new Date(lastSync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
            </p>
            <p className="text-xs text-slate-400 font-medium mt-1">Dernier cycle complet réussi</p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Catalogue local</span>
              <div className="h-8 w-8 bg-purple-50 rounded-xl flex items-center justify-center"><Database className="h-4 w-4 text-purple-500" /></div>
            </div>
            <p className="text-sm font-black text-slate-900">
              {nbProduits} produits · {nbClients} clients · {nbFournisseurs} fourn.
            </p>
            <button
              onClick={handleRefreshCatalog}
              disabled={refreshingCatalog || !online}
              className="mt-2 flex items-center gap-1.5 text-xs font-bold text-purple-600 hover:text-purple-800 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={cn('h-3 w-3', refreshingCatalog && 'animate-spin')} />
              Rafraîchir le catalogue
            </button>
          </div>
        </div>

        {/* ── Échecs (prioritaire) ── */}
        {failed.length > 0 && (
          <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 flex items-center gap-3 border-b border-rose-200/70 bg-rose-100/50">
              <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0" />
              <p className="text-sm font-black text-rose-800">
                {failed.length} opération(s) en ÉCHEC de synchronisation — action requise
              </p>
              <button
                onClick={handleRetryAllFailed}
                disabled={!online}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition-all disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Tout réessayer
              </button>
            </div>
            <div className="divide-y divide-rose-100">
              {failed.map((item) => {
                const { label, detail } = summarizeItem(item);
                return (
                  <div key={item.id} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-800">
                        {label}
                        <span className="ml-2 text-[10px] font-bold text-rose-600 bg-white border border-rose-200 px-1.5 py-0.5 rounded-md">
                          {item.retryCount} tentative(s)
                        </span>
                      </p>
                      <p className="text-xs text-slate-500 font-medium">{detail}</p>
                      {item.lastError && (
                        <p className="text-[11px] text-rose-600 font-medium mt-0.5 truncate max-w-md" title={item.lastError}>
                          ⚠ {item.lastError}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleRetryOne(item)}
                        disabled={!online}
                        className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl transition-all disabled:opacity-40"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Réessayer
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-white rounded-xl transition-all"
                        title="Supprimer définitivement (perte de l'opération)"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── File en attente ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Inbox className="h-4 w-4 text-slate-400" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              File d'attente ({pending.length})
            </p>
          </div>
          {pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="h-14 w-14 bg-emerald-50 rounded-full flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <p className="font-black text-slate-900">Tout est synchronisé</p>
              <p className="text-xs text-slate-400 font-medium">Aucune opération en attente d'envoi au cloud.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {pending.map((item) => {
                const { label, detail } = summarizeItem(item);
                return (
                  <div key={item.id} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-800">
                        {label}
                        <span className={cn(
                          'ml-2 text-[9px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider',
                          item.status === 'processing' ? 'text-blue-700 bg-blue-100' : 'text-amber-700 bg-amber-100'
                        )}>
                          {item.status === 'processing' ? 'Envoi…' : 'En attente'}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500 font-medium">
                        {detail} · mis en file le {new Date(item.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDelete(item)}
                      className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all shrink-0"
                      title="Supprimer définitivement (perte de l'opération)"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="text-[11px] text-slate-400 font-medium text-center">
          Les opérations en file sont envoyées automatiquement au retour du réseau et après chaque vente.
          Un élément passe en échec après 3 tentatives — il reste ici jusqu'à votre décision.
        </p>
      </div>
    </div>
  );
}
