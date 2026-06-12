import React, { useState, useEffect, useCallback } from 'react';
import { UserProfile } from '../types';
import { supabase } from '../supabase';
import {
  Building2,
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  CheckCircle2,
  Phone,
  MapPin,
  Eye,
  AlertTriangle,
  Lock,
  ShoppingBag,
  TrendingUp,
  CreditCard,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast, askConfirm } from '../lib/notify';
import { db } from '../lib/db';

interface FournisseursProps {
  profile: UserProfile | null;
}

interface Fournisseur {
  id_fournisseur: number;
  type: 'Société' | 'Personne physique';
  nom: string;
  num_telephone?: string | null;
  adresse?: string | null;
  irc?: string | null;
  ice?: string | null;
  cin?: string | null;
  notes?: string | null;
  _totalAchats?: number;
  _soldeDu?: number;
}

interface FournisseurAccount {
  fournisseurId: number;
  nom: string;
  totalAchats: number;
  totalPaye: number;
  soldeDu: number;
  nbOperations: number;
  recentOps: Array<{
    numOp: number;
    dateOp: string;
    totalDh: number;
    resteAPayer: number;
    statut?: string;
    statutPaiement?: string;
  }>;
}

const EMPTY_FORM = {
  type: 'Personne physique' as 'Société' | 'Personne physique',
  nom: '',
  num_telephone: '',
  adresse: '',
  irc: '',
  ice: '',
  cin: '',
  notes: '',
};

export default function Fournisseurs({ profile }: FournisseursProps) {
  const isAdmin = profile?.roleId === 'admin';
  // Confidentialité : les montants d'achat (totaux, soldes) ne sont visibles
  // que pour les rôles financiers — jamais pour le caissier.
  const canViewAmounts = isAdmin || profile?.roleId === 'tresorier';

  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // Compte fournisseur (historique + total dû)
  const [accountModal, setAccountModal] = useState<FournisseurAccount | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);

  const fetchFournisseurs = useCallback(async () => {
    setLoading(true);
    try {
      const { data: fournsData, error } = await supabase
        .from('fournisseurs')
        .select('*')
        .order('nom');
      if (error) throw error;

      // Fetch total achats + solde dû per fournisseur (validated only)
      const { data: opsData } = await supabase
        .from('operations')
        .select('fournisseur_id, total_dh, reste_a_payer')
        .eq('type_op', 'achat')
        .eq('statut', 'valide')
        .not('fournisseur_id', 'is', null);

      const achatsMap: Record<number, number> = {};
      const soldeMap: Record<number, number> = {};
      (opsData || []).forEach((op: any) => {
        const fid = op.fournisseur_id;
        achatsMap[fid] = (achatsMap[fid] || 0) + parseFloat(op.total_dh || 0);
        soldeMap[fid] = (soldeMap[fid] || 0) + parseFloat(op.reste_a_payer || 0);
      });

      setFournisseurs(
        (fournsData || []).map((f: any) => ({
          ...f,
          _totalAchats: achatsMap[f.id_fournisseur] || 0,
          _soldeDu: soldeMap[f.id_fournisseur] || 0,
        }))
      );
    } catch (err) {
      console.error('[Fournisseurs] fetch:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFournisseurs(); }, [fetchFournisseurs]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (f: Fournisseur) => {
    setEditingId(f.id_fournisseur);
    setForm({
      type: f.type,
      nom: f.nom,
      num_telephone: f.num_telephone || '',
      adresse: f.adresse || '',
      irc: f.irc || '',
      ice: f.ice || '',
      cin: f.cin || '',
      notes: f.notes || '',
    });
    setShowModal(true);
  };

  // ── Compte fournisseur : historique des achats + total dû ──────────────────
  const openAccountModal = async (f: Fournisseur) => {
    if (!canViewAmounts) return;
    setLoadingAccount(true);
    setAccountModal(null);
    try {
      const { data: opsData } = await supabase
        .from('operations')
        .select('num_op, date_op, total_dh, montant_paye, reste_a_payer, statut, statut_paiement')
        .eq('fournisseur_id', f.id_fournisseur)
        .eq('type_op', 'achat')
        .order('num_op', { ascending: false })
        .limit(20);

      const ops = opsData || [];
      const valides = ops.filter((op: any) => op.statut === 'valide');
      const totalAchats = valides.reduce((s: number, op: any) => s + parseFloat(op.total_dh || 0), 0);
      const totalPaye = valides.reduce((s: number, op: any) => s + parseFloat(op.montant_paye || 0), 0);
      const soldeDu = valides.reduce((s: number, op: any) => s + parseFloat(op.reste_a_payer || 0), 0);

      setAccountModal({
        fournisseurId: f.id_fournisseur,
        nom: f.nom,
        totalAchats,
        totalPaye,
        soldeDu,
        nbOperations: ops.length,
        recentOps: ops.map((op: any) => ({
          numOp: op.num_op,
          dateOp: op.date_op,
          totalDh: parseFloat(op.total_dh || 0),
          resteAPayer: parseFloat(op.reste_a_payer || 0),
          statut: op.statut,
          statutPaiement: op.statut_paiement,
        })),
      });
    } catch (err) {
      console.error('[Fournisseurs] account:', err);
    } finally {
      setLoadingAccount(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        type: form.type,
        nom: form.nom.trim(),
        num_telephone: form.num_telephone.trim() || null,
        adresse: form.adresse.trim() || null,
        irc: form.type === 'Société' ? (form.irc.trim() || null) : null,
        ice: form.type === 'Société' ? (form.ice.trim() || null) : null,
        cin: form.type === 'Personne physique' ? (form.cin.trim() || null) : null,
        notes: form.notes.trim() || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from('fournisseurs')
          .update(payload)
          .eq('id_fournisseur', editingId);
        if (error) throw error;
        // B9 — Dexie à jour immédiatement (sélecteur caisse mode achat)
        await db.fournisseurs.update(editingId, {
          nom: payload.nom,
          type: payload.type ?? null,
          num_telephone: payload.num_telephone ?? null,
        }).catch(() => {});
      } else {
        const { data: inserted, error } = await supabase
          .from('fournisseurs')
          .insert(payload)
          .select('id_fournisseur')
          .single();
        if (error) throw error;
        if (inserted?.id_fournisseur != null) {
          await db.fournisseurs.put({
            id_fournisseur: inserted.id_fournisseur,
            nom: payload.nom,
            type: payload.type ?? null,
            num_telephone: payload.num_telephone ?? null,
          }).catch(() => {});
        }
      }

      setShowModal(false);
      setEditingId(null);
      fetchFournisseurs();
    } catch (err) {
      toast.error('Erreur : ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, nom: string) => {
    const ok = await askConfirm({
      title: `Supprimer « ${nom} » ?`,
      message: 'Le fournisseur sera définitivement supprimé (impossible si des achats lui sont liés).',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      const { error } = await supabase
        .from('fournisseurs')
        .delete()
        .eq('id_fournisseur', id);
      if (error) throw error;
      await db.fournisseurs.delete(id).catch(() => {});
      toast.success(`Fournisseur « ${nom} » supprimé.`);
      fetchFournisseurs();
    } catch (err) {
      toast.error('Erreur suppression : ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const filtered = fournisseurs.filter((f) => {
    const q = search.toLowerCase();
    return (
      f.nom.toLowerCase().includes(q) ||
      (f.num_telephone || '').toLowerCase().includes(q) ||
      (f.adresse || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              <Building2 className="h-6 w-6 text-blue-500" />
              FOURNISSEURS
            </h2>
            <p className="text-sm text-slate-500 font-medium">
              {fournisseurs.length} fournisseur(s) enregistré(s)
              {!isAdmin && (
                <span className="ml-2 px-2 py-0.5 bg-slate-100 text-slate-500 rounded-lg text-xs font-bold uppercase tracking-wider">
                  Lecture seule
                </span>
              )}
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={openCreate}
              className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-2xl flex items-center gap-2 shadow-lg shadow-blue-500/20 transition-all"
            >
              <Plus className="h-5 w-5" />
              Nouveau Fournisseur
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Rechercher par nom, téléphone, adresse..."
            className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-blue-500/10 transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Read-only info banner for cashiers */}
        {!isAdmin && (
          <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-2xl">
            <Eye className="h-4 w-4 text-slate-400 shrink-0" />
            <p className="text-xs font-medium text-slate-500">
              Vous avez accès en lecture seule. Contactez l'administrateur pour toute modification.
            </p>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Building2 className="h-12 w-12 text-slate-200" />
              <p className="text-slate-400 font-bold">Aucun fournisseur trouvé</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="px-5 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Fournisseur</th>
                    <th className="px-5 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact</th>
                    <th className="px-5 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Identifiants</th>
                    <th className="px-5 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Solde dû</th>
                    <th className="px-5 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Total achats</th>
                    {canViewAmounts && (
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map((f) => (
                    <tr key={f.id_fournisseur} className="hover:bg-slate-50/50 transition-colors">
                      {/* Fournisseur */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                            <Building2 className="h-4 w-4 text-blue-500" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{f.nom}</p>
                            <span className={cn(
                              'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md',
                              f.type === 'Société'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-600'
                            )}>
                              {f.type}
                            </span>
                          </div>
                        </div>
                      </td>
                      {/* Contact */}
                      <td className="px-5 py-4">
                        {f.num_telephone && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                            <Phone className="h-3.5 w-3.5 text-slate-400" />
                            {f.num_telephone}
                          </div>
                        )}
                        {f.adresse && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mt-0.5">
                            <MapPin className="h-3.5 w-3.5" />
                            <span className="truncate max-w-[140px]">{f.adresse}</span>
                          </div>
                        )}
                        {!f.num_telephone && !f.adresse && (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      {/* Identifiants */}
                      <td className="px-5 py-4">
                        {f.type === 'Société' ? (
                          <div className="space-y-0.5 text-xs">
                            {f.irc && <p className="text-slate-600"><span className="font-black text-slate-400">IRC:</span> {f.irc}</p>}
                            {f.ice && <p className="text-slate-600"><span className="font-black text-slate-400">ICE:</span> {f.ice}</p>}
                            {!f.irc && !f.ice && <span className="text-slate-300">—</span>}
                          </div>
                        ) : (
                          <div className="text-xs">
                            {f.cin
                              ? <p className="text-slate-600"><span className="font-black text-slate-400">CIN:</span> {f.cin}</p>
                              : <span className="text-slate-300">—</span>}
                          </div>
                        )}
                      </td>
                      {/* Solde dû (comptes fournisseurs) — confidentiel pour caissier */}
                      <td className="px-5 py-4 text-right">
                        {!canViewAmounts ? (
                          <span className="inline-flex items-center gap-1 text-slate-300"><Lock className="h-3 w-3" /><span className="text-xs">•••</span></span>
                        ) : (f._soldeDu ?? 0) > 0.01 ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-rose-50 text-rose-700 text-xs font-black">
                            <AlertTriangle className="h-3 w-3" />
                            {(f._soldeDu ?? 0).toFixed(2)} DH
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-emerald-600">Soldé</span>
                        )}
                      </td>
                      {/* Total achats — confidentiel pour caissier */}
                      <td className="px-5 py-4 text-right">
                        {canViewAmounts ? (
                          <span className="font-black text-blue-700 text-sm">
                            {(f._totalAchats ?? 0).toFixed(2)}
                            <span className="text-slate-400 font-normal text-xs ml-0.5">DH</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-300"><Lock className="h-3 w-3" /><span className="text-xs">•••</span></span>
                        )}
                      </td>
                      {/* Actions */}
                      {canViewAmounts && (
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => openAccountModal(f)}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-all"
                              title="Compte fournisseur — historique et total dû"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Compte
                            </button>
                            {isAdmin && (
                              <>
                                <button
                                  onClick={() => openEdit(f)}
                                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                  title="Modifier"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleDelete(f.id_fournisseur, f.nom)}
                                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                  title="Supprimer"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal Create / Edit (admin only) ── */}
      <AnimatePresence>
        {showModal && isAdmin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[28px] shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                    {editingId ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
                  </h3>
                </div>
                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-900">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-5">
                {/* Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Type</label>
                  <div className="flex gap-3">
                    {(['Personne physique', 'Société'] as const).map((t) => (
                      <button
                        key={t} type="button"
                        onClick={() => setForm({ ...form, type: t })}
                        className={cn(
                          'flex-1 py-2.5 px-4 rounded-xl font-bold text-sm transition-all border-2',
                          form.type === t
                            ? 'bg-blue-500 text-white border-blue-500'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Nom */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    {form.type === 'Société' ? 'Raison sociale' : 'Nom complet'}
                  </label>
                  <input
                    required type="text"
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                    value={form.nom}
                    onChange={(e) => setForm({ ...form, nom: e.target.value })}
                  />
                </div>

                {/* Téléphone */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Téléphone</label>
                  <input
                    type="text"
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                    value={form.num_telephone}
                    onChange={(e) => setForm({ ...form, num_telephone: e.target.value })}
                  />
                </div>

                {/* Adresse */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Adresse</label>
                  <input
                    type="text"
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                    value={form.adresse}
                    onChange={(e) => setForm({ ...form, adresse: e.target.value })}
                  />
                </div>

                {/* Conditional fields */}
                {form.type === 'Société' ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest">IRC</label>
                      <input type="text" className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                        value={form.irc} onChange={(e) => setForm({ ...form, irc: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest">ICE</label>
                      <input type="text" className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                        value={form.ice} onChange={(e) => setForm({ ...form, ice: e.target.value })} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">CIN</label>
                    <input type="text" className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                      value={form.cin} onChange={(e) => setForm({ ...form, cin: e.target.value })} />
                  </div>
                )}

                {/* Notes */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Notes</label>
                  <textarea
                    rows={2}
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-medium resize-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder="Remarques, conditions de livraison..."
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>

                <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                  <button type="button" onClick={() => setShowModal(false)}
                    className="px-5 py-2.5 bg-white text-slate-500 font-bold rounded-2xl hover:bg-slate-50 transition-all">
                    Annuler
                  </button>
                  <button type="submit" disabled={saving}
                    className="px-8 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-black rounded-2xl shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 disabled:opacity-50">
                    {saving
                      ? <span className="animate-pulse">Enregistrement...</span>
                      : <><CheckCircle2 className="h-4 w-4" /> ENREGISTRER</>
                    }
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Modal Compte Fournisseur (admin / trésorier) ── */}
      <AnimatePresence>
        {(loadingAccount || accountModal) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setAccountModal(null); setLoadingAccount(false); }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-white rounded-[28px] shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-blue-500" />
                    {accountModal?.nom || '…'}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">Compte fournisseur — {accountModal?.nbOperations ?? 0} achat(s)</p>
                </div>
                <button
                  onClick={() => { setAccountModal(null); setLoadingAccount(false); }}
                  className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-900"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {loadingAccount && !accountModal ? (
                <div className="flex items-center justify-center py-16">
                  <div className="h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : accountModal ? (
                <div className="p-6 space-y-5">
                  {/* KPI row */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-slate-50 rounded-2xl p-4 text-center border border-slate-100">
                      <div className="flex items-center justify-center mb-1">
                        <ShoppingBag className="h-4 w-4 text-blue-500" />
                      </div>
                      <p className="text-lg font-black text-slate-900">{accountModal.totalAchats.toFixed(0)}<span className="text-xs font-bold text-slate-400 ml-0.5">DH</span></p>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Total achats</p>
                    </div>
                    <div className="bg-emerald-50 rounded-2xl p-4 text-center border border-emerald-100">
                      <div className="flex items-center justify-center mb-1">
                        <TrendingUp className="h-4 w-4 text-emerald-500" />
                      </div>
                      <p className="text-lg font-black text-emerald-700">{accountModal.totalPaye.toFixed(0)}<span className="text-xs font-bold text-emerald-400 ml-0.5">DH</span></p>
                      <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mt-1">Total payé</p>
                    </div>
                    <div className={cn('rounded-2xl p-4 text-center border', accountModal.soldeDu > 0.01 ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-100')}>
                      <div className="flex items-center justify-center mb-1">
                        <CreditCard className={cn('h-4 w-4', accountModal.soldeDu > 0.01 ? 'text-rose-500' : 'text-slate-400')} />
                      </div>
                      <p className={cn('text-lg font-black', accountModal.soldeDu > 0.01 ? 'text-rose-700' : 'text-slate-500')}>
                        {accountModal.soldeDu.toFixed(0)}<span className="text-xs font-bold ml-0.5">DH</span>
                      </p>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Reste à payer</p>
                    </div>
                  </div>

                  {/* Recent operations */}
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Derniers achats</p>
                    {accountModal.recentOps.length === 0 ? (
                      <p className="text-xs text-slate-400 font-medium italic">Aucun achat enregistré pour ce fournisseur.</p>
                    ) : (
                      <div className="space-y-2 max-h-52 overflow-y-auto">
                        {accountModal.recentOps.map((op) => (
                          <div key={op.numOp} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-2.5 border border-slate-100">
                            <div>
                              <p className="text-xs font-black text-slate-700">
                                OP-{String(op.numOp).padStart(4, '0')}
                                {op.statut === 'en_attente' && (
                                  <span className="ml-2 text-[9px] font-black text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded-md uppercase tracking-wider">En attente</span>
                                )}
                              </p>
                              <p className="text-[10px] text-slate-400 font-medium">
                                {op.dateOp ? new Date(op.dateOp).toLocaleDateString('fr-FR') : '—'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-black text-slate-900">{op.totalDh.toFixed(2)} DH</p>
                              {op.resteAPayer > 0.01 ? (
                                <p className="text-[10px] font-bold text-rose-600">Reste: {op.resteAPayer.toFixed(2)} DH</p>
                              ) : op.statut === 'valide' ? (
                                <p className="text-[10px] font-bold text-emerald-600">Soldé</p>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
