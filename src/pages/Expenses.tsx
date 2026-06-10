import React, { useState, useEffect, useCallback } from 'react';
import { UserProfile, Expense } from '../types';
import { supabase } from '../supabase';
import {
  Receipt,
  Plus,
  X,
  Search,
  Trash2,
  Edit2,
  TrendingDown,
  Calendar,
  CheckCircle2,
  Loader2,
  Download,
  FilterX,
  Lock,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { fetchLatestClosure, isBeforeLock, ClosureLock } from '../lib/closureLock';

interface ExpensesProps {
  profile: UserProfile | null;
}

const EXPENSE_TYPES = [
  'Loyer',
  'Eau / Électricité',
  'Transport',
  'Salaires',
  'Maintenance',
  'Carburant',
  'Fournitures',
  'Autre',
] as const;

const TYPE_COLORS: Record<string, string> = {
  'Loyer':             'bg-rose-100 text-rose-700',
  'Eau / Électricité': 'bg-blue-100 text-blue-700',
  'Transport':         'bg-amber-100 text-amber-700',
  'Salaires':          'bg-purple-100 text-purple-700',
  'Maintenance':       'bg-orange-100 text-orange-700',
  'Carburant':         'bg-yellow-100 text-yellow-700',
  'Fournitures':       'bg-teal-100 text-teal-700',
  'Autre':             'bg-slate-100 text-slate-600',
};

const EMPTY_FORM = {
  date_charge: '',
  type_charge: 'Autre' as string,
  description: '',
  montant: '',
  mode_paiement: 'Espèce',
};

export default function Expenses({ profile }: ExpensesProps) {
  const isAdmin = profile?.roleId === 'admin';

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  // Filtres temporels : mois rapide OU période personnalisée (exclusifs)
  const [filterMonth, setFilterMonth] = useState('');   // 'YYYY-MM'
  const [dateFrom, setDateFrom] = useState('');         // 'YYYY-MM-DD'
  const [dateTo, setDateTo] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());

  // Soft lock clôture de caisse : charges datées ≤ dernière clôture verrouillées (sauf admin)
  const [closureLock, setClosureLock] = useState<ClosureLock | null>(null);
  useEffect(() => { fetchLatestClosure().then(setClosureLock); }, []);
  const isChargeLocked = (e: Expense) =>
    !isAdmin && isBeforeLock(e.dateCharge, e.heureCharge, closureLock);

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('charges')
        .select('*')
        .order('date_charge', { ascending: false })
        .order('id', { ascending: false })
        .limit(500);
      if (error) throw error;

      const userIds = [...new Set((data || []).map((e: any) => e.utilisateur_id).filter(Boolean))];
      const agentMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: agents } = await supabase
          .from('utilisateurs')
          .select('id, username, nom')
          .in('id', userIds);
        (agents || []).forEach((a: any) => { agentMap[a.id] = a.nom || a.username || '—'; });
      }

      setExpenses(
        (data || []).map((e: any) => ({
          id: e.id,
          dateCharge: e.date_charge,
          heureCharge: e.heure_charge,
          typeCharge: e.type_charge,
          description: e.description,
          montant: parseFloat(e.montant || 0),
          modePaiement: e.mode_paiement || 'Espèce',
          utilisateurId: e.utilisateur_id,
          agentName: e.utilisateur_id ? (agentMap[e.utilisateur_id] || '—') : '—',
          createdAt: e.created_at,
        }))
      );
    } catch (err) {
      console.error('[Expenses] fetch:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, date_charge: todayStr });
    setShowModal(true);
  };

  const openEdit = (e: Expense) => {
    if (isChargeLocked(e)) {
      alert('Période clôturée : cette charge est verrouillée. Seul l\'administrateur peut la modifier.');
      return;
    }
    setEditingId(e.id);
    setForm({
      date_charge: e.dateCharge,
      type_charge: e.typeCharge,
      description: e.description || '',
      montant: e.montant.toString(),
      mode_paiement: e.modePaiement,
    });
    setShowModal(true);
  };

  const handleSave = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const montant = parseFloat(form.montant);
    if (!Number.isFinite(montant) || montant <= 0) {
      alert('Montant invalide.');
      return;
    }
    setSaving(true);
    try {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      const payload = {
        date_charge: form.date_charge,
        heure_charge: editingId ? undefined : timeStr,
        type_charge: form.type_charge,
        description: form.description.trim() || null,
        montant,
        mode_paiement: form.mode_paiement,
        utilisateur_id: profile?.id || null,
      };

      if (editingId) {
        const { error } = await supabase.from('charges').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('charges').insert({ ...payload, heure_charge: timeStr });
        if (error) throw error;
      }

      setShowModal(false);
      setEditingId(null);
      fetchExpenses();
    } catch (err) {
      alert('Erreur : ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (exp: Expense) => {
    if (isChargeLocked(exp)) {
      alert('Période clôturée : cette charge est verrouillée. Seul l\'administrateur peut la supprimer.');
      return;
    }
    if (!window.confirm('Supprimer cette charge ?')) return;
    try {
      const { error } = await supabase.from('charges').delete().eq('id', exp.id);
      if (error) throw error;
      fetchExpenses();
    } catch (err) {
      alert('Erreur suppression : ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const totalAllTime = expenses.reduce((s, e) => s + e.montant, 0);
  const totalThisMonth = expenses
    .filter((e) => e.dateCharge?.startsWith(thisMonth))
    .reduce((s, e) => s + e.montant, 0);

  // Average over last 3 months
  const months3Ago = new Date(now);
  months3Ago.setMonth(months3Ago.getMonth() - 3);
  const months3AgoStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(months3Ago);
  const last3 = expenses.filter((e) => (e.dateCharge || '') >= months3AgoStr);
  const avgPerMonth = last3.length > 0
    ? last3.reduce((s, e) => s + e.montant, 0) / 3
    : 0;

  const hasDateFilter = !!(filterMonth || dateFrom || dateTo);

  const filtered = expenses.filter((e) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      (e.description || '').toLowerCase().includes(q) ||
      (e.typeCharge || '').toLowerCase().includes(q) ||
      (e.agentName || '').toLowerCase().includes(q);
    const matchType = !filterType || e.typeCharge === filterType;
    const d = e.dateCharge || '';
    const matchMonth = !filterMonth || d.startsWith(filterMonth);
    const matchFrom = !dateFrom || d >= dateFrom;
    const matchTo = !dateTo || d <= dateTo;
    return matchSearch && matchType && matchMonth && matchFrom && matchTo;
  });

  const totalFiltered = filtered.reduce((s, e) => s + e.montant, 0);

  const resetDateFilters = () => { setFilterMonth(''); setDateFrom(''); setDateTo(''); };

  // ── Export Excel des charges filtrées ───────────────────────────────────────
  const handleExportExcel = () => {
    if (filtered.length === 0) { alert('Aucune charge à exporter avec ces filtres.'); return; }
    const rows = filtered.map((e) => ({
      'Date':            e.dateCharge || '',
      'Heure':           e.heureCharge ? e.heureCharge.slice(0, 5) : '',
      'Type':            e.typeCharge,
      'Description':     e.description || '',
      'Montant (DH)':    e.montant.toFixed(2),
      'Mode paiement':   e.modePaiement,
      'Agent':           e.agentName || '',
    }));
    // Ligne de total en bas
    rows.push({
      'Date': '', 'Heure': '', 'Type': '', 'Description': 'TOTAL',
      'Montant (DH)': totalFiltered.toFixed(2), 'Mode paiement': '', 'Agent': '',
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 7 }, { wch: 18 }, { wch: 36 }, { wch: 14 }, { wch: 14 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Charges');
    const period = filterMonth || [dateFrom, dateTo].filter(Boolean).join('_au_') || 'toutes_periodes';
    XLSX.writeFile(wb, `charges_gharbfeed_${period}.xlsx`);
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              <Receipt className="h-6 w-6 text-orange-500" />
              CHARGES & DÉPENSES
            </h2>
            <p className="text-sm text-slate-500 font-medium">
              {expenses.length} charge(s) enregistrée(s)
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={openCreate}
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-2xl flex items-center gap-2 shadow-lg shadow-orange-500/20 transition-all"
            >
              <Plus className="h-5 w-5" />
              Nouvelle Charge
            </button>
          )}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ce mois</span>
              <div className="h-8 w-8 bg-orange-50 rounded-xl flex items-center justify-center">
                <Calendar className="h-4 w-4 text-orange-500" />
              </div>
            </div>
            <p className="text-2xl font-black text-orange-600">
              {totalThisMonth.toFixed(0)}
              <span className="text-sm font-bold text-slate-400 ml-1">DH</span>
            </p>
            <p className="text-xs text-slate-400 font-medium mt-1">Mois en cours</p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Moy. mensuelle</span>
              <div className="h-8 w-8 bg-blue-50 rounded-xl flex items-center justify-center">
                <TrendingDown className="h-4 w-4 text-blue-500" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">
              {avgPerMonth.toFixed(0)}
              <span className="text-sm font-bold text-slate-400 ml-1">DH</span>
            </p>
            <p className="text-xs text-slate-400 font-medium mt-1">Sur 3 derniers mois</p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</span>
              <div className="h-8 w-8 bg-rose-50 rounded-xl flex items-center justify-center">
                <Receipt className="h-4 w-4 text-rose-500" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">
              {totalAllTime.toFixed(0)}
              <span className="text-sm font-bold text-slate-400 ml-1">DH</span>
            </p>
            <p className="text-xs text-slate-400 font-medium mt-1">Toutes périodes</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Rechercher par description, type, agent..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-orange-500/10 transition-all"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-orange-500/10 transition-all"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="">Tous les types</option>
              {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button
              onClick={handleExportExcel}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm rounded-xl shadow-sm shadow-emerald-500/20 transition-all shrink-0"
              title="Exporter les charges filtrées vers Excel"
            >
              <Download className="h-4 w-4" />
              Export Excel
            </button>
          </div>

          {/* Filtres temporels */}
          <div className="flex flex-col lg:flex-row lg:items-end gap-3 pt-1">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mois</label>
              <input
                type="month"
                className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-orange-500/10"
                value={filterMonth}
                onChange={(e) => { setFilterMonth(e.target.value); setDateFrom(''); setDateTo(''); }}
              />
            </div>
            <span className="hidden lg:block text-[10px] font-black text-slate-300 uppercase pb-3">— ou —</span>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Du</label>
              <input
                type="date"
                className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-orange-500/10"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setFilterMonth(''); }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Au</label>
              <input
                type="date"
                className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-orange-500/10"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => { setDateTo(e.target.value); setFilterMonth(''); }}
              />
            </div>
            {hasDateFilter && (
              <button
                onClick={resetDateFilters}
                className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-all"
              >
                <FilterX className="h-3.5 w-3.5" />
                Réinitialiser
              </button>
            )}
            {(hasDateFilter || filterType || search) && (
              <div className="lg:ml-auto flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5">
                <span className="text-[10px] font-black text-orange-600 uppercase tracking-widest">Total période filtrée</span>
                <span className="text-sm font-black text-orange-700">{totalFiltered.toFixed(2)} DH</span>
                <span className="text-[10px] font-bold text-orange-400">({filtered.length} charge{filtered.length > 1 ? 's' : ''})</span>
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Receipt className="h-12 w-12 text-slate-200" />
              <p className="text-slate-400 font-bold">Aucune charge trouvée</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="px-5 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                    <th className="px-5 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</th>
                    <th className="px-5 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Description</th>
                    <th className="px-5 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Mode</th>
                    <th className="px-5 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Agent</th>
                    <th className="px-5 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Montant</th>
                    {isAdmin && (
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-bold text-slate-900 text-xs inline-flex items-center gap-1">
                          {e.dateCharge ? new Date(e.dateCharge).toLocaleDateString('fr-FR') : '—'}
                          {isChargeLocked(e) && (
                            <Lock className="h-3 w-3 text-slate-400" aria-label="Période clôturée — modifiable par l'admin uniquement" />
                          )}
                        </p>
                        {e.heureCharge && (
                          <p className="text-[10px] text-slate-400 font-medium">
                            {e.heureCharge.slice(0, 5)}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn(
                          'px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider',
                          TYPE_COLORS[e.typeCharge] || 'bg-slate-100 text-slate-600'
                        )}>
                          {e.typeCharge}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-sm text-slate-700 font-medium truncate max-w-[200px]">
                          {e.description || <span className="text-slate-300 italic">—</span>}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-xs font-bold text-slate-600">{e.modePaiement}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-xs text-slate-500 font-medium">{e.agentName || '—'}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="font-black text-orange-600 text-sm">
                          {e.montant.toFixed(2)}
                          <span className="text-slate-400 font-normal text-xs ml-0.5">DH</span>
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => openEdit(e)}
                              className="p-2 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all"
                              title="Modifier"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(e)}
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

      {/* ── Modal Create / Edit ── */}
      <AnimatePresence>
        {showModal && (
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
              className="relative w-full max-w-md bg-white rounded-[28px] shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                    {editingId ? 'Modifier la charge' : 'Nouvelle charge'}
                  </h3>
                </div>
                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-900">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-4">
                {/* Date */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Date</label>
                  <input
                    required type="date"
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-orange-500/20"
                    value={form.date_charge}
                    onChange={(e) => setForm({ ...form, date_charge: e.target.value })}
                  />
                </div>

                {/* Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Type de charge</label>
                  <select
                    required
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-orange-500/20"
                    value={form.type_charge}
                    onChange={(e) => setForm({ ...form, type_charge: e.target.value })}
                  >
                    {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Description</label>
                  <input
                    type="text"
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-medium focus:ring-2 focus:ring-orange-500/20"
                    placeholder="Détail optionnel..."
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>

                {/* Montant */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Montant (DH)</label>
                  <input
                    required type="number" step="0.01" min="0.01"
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-lg font-black text-orange-600 focus:ring-2 focus:ring-orange-500/20"
                    value={form.montant}
                    onChange={(e) => setForm({ ...form, montant: e.target.value })}
                  />
                </div>

                {/* Mode paiement */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Mode de paiement</label>
                  <div className="flex gap-2">
                    {(['Espèce', 'Chèque', 'Versement'] as const).map((m) => (
                      <button
                        key={m} type="button"
                        onClick={() => setForm({ ...form, mode_paiement: m })}
                        className={cn(
                          'flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all',
                          form.mode_paiement === m
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-orange-300'
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                  <button type="button" onClick={() => setShowModal(false)}
                    className="px-5 py-2.5 bg-white text-slate-500 font-bold rounded-2xl hover:bg-slate-50 transition-all">
                    Annuler
                  </button>
                  <button type="submit" disabled={saving}
                    className="px-8 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-black rounded-2xl shadow-lg shadow-orange-500/20 transition-all flex items-center gap-2 disabled:opacity-50">
                    {saving
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Enregistrement...</>
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
