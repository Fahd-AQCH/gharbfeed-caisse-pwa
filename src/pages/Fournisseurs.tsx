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
  Clock,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

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
  date_echeance_paiement?: string | null;
  notes?: string | null;
  _totalAchats?: number;
}

const EMPTY_FORM = {
  type: 'Personne physique' as 'Société' | 'Personne physique',
  nom: '',
  num_telephone: '',
  adresse: '',
  irc: '',
  ice: '',
  cin: '',
  date_echeance_paiement: '',
  notes: '',
};

export default function Fournisseurs({ profile }: FournisseursProps) {
  const isAdmin = profile?.roleId === 'admin';

  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const fetchFournisseurs = useCallback(async () => {
    setLoading(true);
    try {
      const { data: fournsData, error } = await supabase
        .from('fournisseurs')
        .select('*')
        .order('nom');
      if (error) throw error;

      // Fetch total achats per fournisseur (validated only)
      const { data: opsData } = await supabase
        .from('operations')
        .select('fournisseur_id, total_dh')
        .eq('type_op', 'achat')
        .eq('statut', 'valide')
        .not('fournisseur_id', 'is', null);

      const achatsMap: Record<number, number> = {};
      (opsData || []).forEach((op: any) => {
        const fid = op.fournisseur_id;
        achatsMap[fid] = (achatsMap[fid] || 0) + parseFloat(op.total_dh || 0);
      });

      setFournisseurs(
        (fournsData || []).map((f: any) => ({
          ...f,
          _totalAchats: achatsMap[f.id_fournisseur] || 0,
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
      date_echeance_paiement: f.date_echeance_paiement || '',
      notes: f.notes || '',
    });
    setShowModal(true);
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
        date_echeance_paiement: form.date_echeance_paiement.trim() || null,
        notes: form.notes.trim() || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from('fournisseurs')
          .update(payload)
          .eq('id_fournisseur', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('fournisseurs').insert(payload);
        if (error) throw error;
      }

      setShowModal(false);
      setEditingId(null);
      fetchFournisseurs();
    } catch (err) {
      alert('Erreur : ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, nom: string) => {
    if (!window.confirm(`Supprimer le fournisseur "${nom}" ?`)) return;
    try {
      const { error } = await supabase
        .from('fournisseurs')
        .delete()
        .eq('id_fournisseur', id);
      if (error) throw error;
      fetchFournisseurs();
    } catch (err) {
      alert('Erreur suppression : ' + (err instanceof Error ? err.message : String(err)));
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
                    <th className="px-5 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Échéance</th>
                    <th className="px-5 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Total achats</th>
                    {isAdmin && (
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
                      {/* Échéance */}
                      <td className="px-5 py-4">
                        {f.date_echeance_paiement ? (() => {
                          const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
                          const diff = Math.ceil((new Date(f.date_echeance_paiement).getTime() - new Date(today).getTime()) / 86400000);
                          const isOverdue = diff < 0;
                          const isSoon = diff >= 0 && diff <= 7;
                          return (
                            <div className={cn(
                              'flex items-center gap-1.5 px-2 py-1 rounded-lg w-fit text-xs font-bold',
                              isOverdue ? 'bg-rose-100 text-rose-700' : isSoon ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                            )}>
                              {isOverdue ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                              {isOverdue ? `${Math.abs(diff)}j échu` : isSoon ? `${diff}j` : new Date(f.date_echeance_paiement).toLocaleDateString('fr-FR')}
                            </div>
                          );
                        })() : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      {/* Total achats */}
                      <td className="px-5 py-4 text-right">
                        <span className="font-black text-blue-700 text-sm">
                          {(f._totalAchats ?? 0).toFixed(2)}
                          <span className="text-slate-400 font-normal text-xs ml-0.5">DH</span>
                        </span>
                      </td>
                      {/* Actions (admin only) */}
                      {isAdmin && (
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5">
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

                {/* Échéance paiement */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Date d'échéance paiement</label>
                  <input
                    type="date"
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                    value={form.date_echeance_paiement}
                    onChange={(e) => setForm({ ...form, date_echeance_paiement: e.target.value })}
                  />
                </div>

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
    </div>
  );
}
