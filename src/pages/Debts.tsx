import React, { useState, useEffect, useCallback } from 'react';
import { UserProfile, DebtPayment } from '../types';
import { supabase } from '../supabase';
import {
  CreditCard,
  Search,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  Clock,
  DollarSign,
  Users,
  TrendingDown,
  Printer,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { generateDebtPaymentPDF } from '../utils/debtPdfGenerator';

interface DebtsProps {
  profile: UserProfile | null;
}

interface DebtOp {
  numOp: number;
  operationNumber: string;
  dateOp: string;
  heureOp?: string;
  typeOp: string;
  clientId?: number;
  clientName?: string;
  totalDh: number;
  montantPaye: number;
  resteAPayer: number;
  dateEcheance?: string;
  statutPaiement?: string;
  conditionPaiement?: string;
  isOverdue: boolean;
  daysOverdue: number;
}

export default function Debts({ profile }: DebtsProps) {
  const isAdmin = profile?.roleId === 'admin';

  const [debtOps, setDebtOps] = useState<DebtOp[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientSearch, setClientSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [paymentHistories, setPaymentHistories] = useState<Record<number, DebtPayment[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<Record<number, boolean>>({});

  // Payment modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [activeDebt, setActiveDebt] = useState<DebtOp | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payCondition, setPayCondition] = useState<'Espèce' | 'Chèque' | 'Versement'>('Espèce');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payLoading, setPayLoading] = useState(false);

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());

  const fetchDebts = useCallback(async () => {
    setLoading(true);
    try {
      const { data: opsData, error } = await supabase
        .from('operations')
        .select('*')
        .gt('reste_a_payer', 0.01)
        .eq('statut', 'valide')
        .order('date_echeance', { ascending: true, nullsFirst: false })
        .order('num_op', { ascending: false })
        .limit(500);

      if (error) throw error;
      if (!opsData?.length) { setDebtOps([]); return; }

      // Enrich with client names
      const clientIds = [...new Set(opsData.map((op: any) => op.client_id).filter(Boolean))];
      const clientMap: Record<string, string> = {};
      if (clientIds.length > 0) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id_client, nom_prenom')
          .in('id_client', clientIds);
        (clients || []).forEach((c: any) => { clientMap[String(c.id_client)] = c.nom_prenom; });
      }

      const mapped: DebtOp[] = opsData.map((op: any) => {
        const echeance = op.date_echeance || null;
        const isOverdue = !!echeance && echeance < todayStr;
        const daysOverdue = isOverdue
          ? Math.floor((new Date(todayStr).getTime() - new Date(echeance).getTime()) / 86400000)
          : 0;
        return {
          numOp: op.num_op,
          operationNumber: `OP-${String(op.num_op).padStart(4, '0')}`,
          dateOp: op.date_op || '',
          heureOp: op.heure_op || '',
          typeOp: op.type_op || 'vente',
          clientId: op.client_id ?? undefined,
          clientName: op.client_id ? (clientMap[String(op.client_id)] || `#${op.client_id}`) : 'Comptoir',
          totalDh: parseFloat(op.total_dh || 0),
          montantPaye: parseFloat(op.montant_paye || 0),
          resteAPayer: parseFloat(op.reste_a_payer || 0),
          dateEcheance: echeance,
          statutPaiement: op.statut_paiement,
          conditionPaiement: op.condition_paiement || 'Espèce',
          isOverdue,
          daysOverdue,
        };
      });

      setDebtOps(mapped);
    } catch (err) {
      console.error('[Debts] fetchDebts:', err);
    } finally {
      setLoading(false);
    }
  }, [todayStr]);

  useEffect(() => { fetchDebts(); }, [fetchDebts]);

  const fetchPaymentHistory = async (opId: number) => {
    if (paymentHistories[opId]) return; // already loaded
    setLoadingHistory(prev => ({ ...prev, [opId]: true }));
    try {
      const { data: payments } = await supabase
        .from('debt_payments')
        .select('*')
        .eq('operation_id', opId)
        .order('created_at', { ascending: true });

      const agentIds = [...new Set((payments || []).map((p: any) => p.utilisateur_id).filter(Boolean))];
      const agentMap: Record<string, string> = {};
      if (agentIds.length > 0) {
        const { data: agents } = await supabase
          .from('utilisateurs')
          .select('id, username, nom')
          .in('id', agentIds);
        (agents || []).forEach((a: any) => { agentMap[a.id] = a.nom || a.username || '—'; });
      }

      const mapped: DebtPayment[] = (payments || []).map((p: any) => ({
        id: p.id,
        operationId: p.operation_id,
        montant: parseFloat(p.montant || 0),
        datePaiement: p.date_paiement,
        heurePaiement: p.heure_paiement,
        conditionPaiement: p.condition_paiement,
        refPaiement: p.ref_paiement,
        utilisateurId: p.utilisateur_id,
        agentName: p.utilisateur_id ? (agentMap[p.utilisateur_id] || '—') : '—',
        notes: p.notes,
        createdAt: p.created_at,
      }));
      setPaymentHistories(prev => ({ ...prev, [opId]: mapped }));
    } catch (err) {
      console.error('[Debts] fetchPaymentHistory:', err);
    } finally {
      setLoadingHistory(prev => ({ ...prev, [opId]: false }));
    }
  };

  const handleToggleExpand = (opId: number) => {
    if (expandedId === opId) {
      setExpandedId(null);
    } else {
      setExpandedId(opId);
      fetchPaymentHistory(opId);
    }
  };

  const openPaymentModal = (debt: DebtOp) => {
    setActiveDebt(debt);
    setPayAmount('');
    setPayCondition('Espèce');
    setPayRef('');
    setPayNotes('');
    setShowPaymentModal(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDebt || !profile?.id) return;
    const amount = parseFloat(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Montant invalide.');
      return;
    }
    if (amount > activeDebt.resteAPayer + 0.01) {
      alert(`Le montant saisi (${amount.toFixed(2)} DH) dépasse le solde dû (${activeDebt.resteAPayer.toFixed(2)} DH).`);
      return;
    }
    setPayLoading(true);
    try {
      const timeStr = new Date().toTimeString().split(' ')[0];
      const newMontantPaye = activeDebt.montantPaye + amount;
      const newResteAPayer = Math.max(0, activeDebt.resteAPayer - amount);
      const isSolde = newResteAPayer <= 0.01;

      // 1. Insert payment record
      const { data: paymentRecord, error: payErr } = await supabase
        .from('debt_payments')
        .insert({
          operation_id: activeDebt.numOp,
          montant: amount,
          date_paiement: todayStr,
          heure_paiement: timeStr,
          condition_paiement: payCondition,
          ref_paiement: payRef.trim() || null,
          utilisateur_id: profile.id,
          notes: payNotes.trim() || null,
        })
        .select()
        .single();
      if (payErr) throw payErr;

      // 2. Update operation balances
      const { error: updateErr } = await supabase
        .from('operations')
        .update({
          montant_paye: newMontantPaye,
          reste_a_payer: newResteAPayer,
          statut_paiement: isSolde ? 'Payé' : 'Partiel',
        })
        .eq('num_op', activeDebt.numOp);
      if (updateErr) throw updateErr;

      // 3. Generate PDF receipt
      Promise.resolve().then(() => {
        generateDebtPaymentPDF({
          operationNumber: activeDebt.operationNumber,
          clientName: activeDebt.clientName || 'Comptoir',
          totalOriginal: activeDebt.totalDh,
          montantCePaiement: amount,
          totalDejaPaye: activeDebt.montantPaye,
          resteAPayerApres: newResteAPayer,
          datePaiement: todayStr,
          heurePaiement: timeStr,
          conditionPaiement: payCondition,
          refPaiement: payRef.trim() || undefined,
          cashierName: profile.username,
          notes: payNotes.trim() || undefined,
        });
      });

      // Invalidate history cache for this op
      setPaymentHistories(prev => {
        const next = { ...prev };
        delete next[activeDebt.numOp];
        return next;
      });

      setShowPaymentModal(false);
      fetchDebts();
      if (isSolde) {
        alert(`✅ Paiement enregistré. La créance ${activeDebt.operationNumber} est intégralement soldée !`);
      }
    } catch (err) {
      alert('Erreur : ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPayLoading(false);
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────────
  const filtered = debtOps.filter((d) => {
    if (!clientSearch.trim()) return true;
    const q = clientSearch.toLowerCase();
    return (
      (d.clientName || '').toLowerCase().includes(q) ||
      d.operationNumber.toLowerCase().includes(q)
    );
  });

  const totalDu = filtered.reduce((s, d) => s + d.resteAPayer, 0);
  const nbOverdue = filtered.filter((d) => d.isOverdue).length;
  const uniqueClients = new Set(filtered.filter((d) => d.clientId).map((d) => d.clientId)).size;

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              <CreditCard className="h-6 w-6 text-rose-500" />
              GESTION DES DETTES
            </h2>
            <p className="text-sm text-slate-500 font-medium">
              {debtOps.length} créance(s) active(s) en cours
            </p>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total dû */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Dû</span>
              <div className="h-8 w-8 bg-rose-50 rounded-xl flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-rose-500" />
              </div>
            </div>
            <p className="text-2xl font-black text-rose-600">
              {totalDu.toFixed(0)}
              <span className="text-sm font-bold text-slate-400 ml-1">DH</span>
            </p>
            <p className="text-xs text-slate-400 font-medium mt-1">Solde total restant</p>
          </div>
          {/* Nb créances */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Créances</span>
              <div className="h-8 w-8 bg-amber-50 rounded-xl flex items-center justify-center">
                <TrendingDown className="h-4 w-4 text-amber-500" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">{filtered.length}</p>
            <p className="text-xs text-slate-400 font-medium mt-1">Opérations en attente</p>
          </div>
          {/* Échues */}
          <div className={cn('rounded-2xl border p-5 shadow-sm', nbOverdue > 0 ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200')}>
            <div className="flex items-center justify-between mb-3">
              <span className={cn('text-[10px] font-black uppercase tracking-widest', nbOverdue > 0 ? 'text-rose-500' : 'text-slate-400')}>
                Échues
              </span>
              <div className={cn('h-8 w-8 rounded-xl flex items-center justify-center', nbOverdue > 0 ? 'bg-rose-100' : 'bg-slate-50')}>
                <Clock className={cn('h-4 w-4', nbOverdue > 0 ? 'text-rose-600' : 'text-slate-400')} />
              </div>
            </div>
            <p className={cn('text-2xl font-black', nbOverdue > 0 ? 'text-rose-700' : 'text-slate-900')}>{nbOverdue}</p>
            <p className={cn('text-xs font-medium mt-1', nbOverdue > 0 ? 'text-rose-500' : 'text-slate-400')}>
              {nbOverdue > 0 ? 'Dépassées échéance' : 'Aucune échéance dépassée'}
            </p>
          </div>
          {/* Clients */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Clients</span>
              <div className="h-8 w-8 bg-blue-50 rounded-xl flex items-center justify-center">
                <Users className="h-4 w-4 text-blue-500" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">{uniqueClients}</p>
            <p className="text-xs text-slate-400 font-medium mt-1">Clients en créance</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Filtrer par client ou numéro d'opération..."
            className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-rose-500/10 transition-all"
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
          />
        </div>

        {/* Debt List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <div className="h-16 w-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <p className="text-xl font-black text-slate-900">Aucune créance active !</p>
            <p className="text-sm text-slate-400 font-medium mt-1">Tous les comptes sont soldés.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((debt) => (
              <div
                key={debt.numOp}
                className={cn(
                  'bg-white rounded-2xl border shadow-sm overflow-hidden transition-all',
                  debt.isOverdue ? 'border-rose-300' : 'border-slate-200'
                )}
              >
                {/* Row header */}
                <div
                  className={cn(
                    'flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50/50 transition-colors',
                    debt.isOverdue && 'bg-rose-50/30'
                  )}
                  onClick={() => handleToggleExpand(debt.numOp)}
                >
                  {/* Overdue indicator */}
                  <div className={cn(
                    'h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
                    debt.isOverdue ? 'bg-rose-100' : 'bg-amber-50'
                  )}>
                    {debt.isOverdue
                      ? <AlertTriangle className="h-5 w-5 text-rose-600" />
                      : <Clock className="h-5 w-5 text-amber-500" />
                    }
                  </div>

                  {/* Client + op */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-slate-900">{debt.clientName}</p>
                      <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">
                        {debt.operationNumber}
                      </span>
                      {debt.isOverdue && (
                        <span className="text-[10px] font-black text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded-md uppercase tracking-wider">
                          ⚠ {debt.daysOverdue}j de retard
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <p className="text-xs text-slate-400 font-medium">
                        {debt.dateOp
                          ? new Date(debt.dateOp).toLocaleDateString('fr-FR')
                          : '—'}
                      </p>
                      {debt.dateEcheance && (
                        <p className={cn('text-xs font-bold', debt.isOverdue ? 'text-rose-600' : 'text-slate-500')}>
                          Échéance : {new Date(debt.dateEcheance).toLocaleDateString('fr-FR')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Balance */}
                  <div className="text-right shrink-0">
                    <p className="font-black text-rose-600 text-lg">
                      {debt.resteAPayer.toFixed(2)} DH
                    </p>
                    <p className="text-[10px] text-slate-400 font-medium">
                      Payé : {debt.montantPaye.toFixed(2)} / {debt.totalDh.toFixed(2)} DH
                    </p>
                  </div>

                  {/* Pay button (admin) + expand */}
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {isAdmin && (
                      <button
                        onClick={() => openPaymentModal(debt)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl transition-all shadow-sm shadow-emerald-500/20"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Paiement
                      </button>
                    )}
                    <div
                      className="p-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      onClick={() => handleToggleExpand(debt.numOp)}
                    >
                      {expandedId === debt.numOp
                        ? <ChevronUp className="h-4 w-4" />
                        : <ChevronDown className="h-4 w-4" />
                      }
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="px-5 pb-2">
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (debt.montantPaye / debt.totalDh) * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-slate-400 font-bold mt-0.5">
                    <span>{((debt.montantPaye / debt.totalDh) * 100).toFixed(0)}% payé</span>
                    <span>{((debt.resteAPayer / debt.totalDh) * 100).toFixed(0)}% restant</span>
                  </div>
                </div>

                {/* Expanded payment history */}
                <AnimatePresence>
                  {expandedId === debt.numOp && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                          Historique des paiements
                        </p>
                        {loadingHistory[debt.numOp] ? (
                          <div className="flex items-center gap-2 py-3">
                            <div className="h-4 w-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                            <span className="text-xs text-slate-400 font-medium">Chargement...</span>
                          </div>
                        ) : (paymentHistories[debt.numOp]?.length ?? 0) === 0 ? (
                          <p className="text-xs text-slate-400 font-medium italic py-2">
                            Aucun paiement partiel enregistré pour cette créance.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {paymentHistories[debt.numOp].map((p) => (
                              <div key={p.id} className="flex items-center justify-between bg-white rounded-xl border border-slate-100 px-4 py-2.5">
                                <div>
                                  <p className="text-xs font-bold text-slate-700">
                                    {p.datePaiement ? new Date(p.datePaiement).toLocaleDateString('fr-FR') : '—'}
                                    {p.heurePaiement && (
                                      <span className="ml-1 text-slate-400 font-normal text-[10px]">
                                        {p.heurePaiement.slice(0, 5)}
                                      </span>
                                    )}
                                    <span className="ml-2 text-slate-400 font-normal">·</span>
                                    <span className="ml-2 text-[10px] font-bold text-slate-500">{p.conditionPaiement}</span>
                                    {p.refPaiement && (
                                      <span className="ml-1 text-[10px] text-slate-400">#{p.refPaiement}</span>
                                    )}
                                  </p>
                                  {p.agentName && p.agentName !== '—' && (
                                    <p className="text-[10px] text-slate-400 font-medium">par {p.agentName}</p>
                                  )}
                                  {p.notes && (
                                    <p className="text-[10px] text-slate-400 italic">{p.notes}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <p className="font-black text-emerald-600 text-sm">
                                    +{p.montant.toFixed(2)} DH
                                  </p>
                                  <button
                                    onClick={() => {
                                      // Re-generate PDF for this specific payment
                                      const prevPaid = (paymentHistories[debt.numOp] || [])
                                        .filter(px => px.id < p.id)
                                        .reduce((s, px) => s + px.montant, 0);
                                      const afterBalance = Math.max(0, debt.totalDh - prevPaid - p.montant);
                                      generateDebtPaymentPDF({
                                        operationNumber: debt.operationNumber,
                                        clientName: debt.clientName || 'Comptoir',
                                        totalOriginal: debt.totalDh,
                                        montantCePaiement: p.montant,
                                        totalDejaPaye: prevPaid,
                                        resteAPayerApres: afterBalance,
                                        datePaiement: p.datePaiement,
                                        heurePaiement: p.heurePaiement,
                                        conditionPaiement: p.conditionPaiement,
                                        refPaiement: p.refPaiement,
                                        cashierName: p.agentName,
                                        notes: p.notes,
                                      });
                                    }}
                                    className="p-1.5 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                    title="Réimprimer le reçu"
                                  >
                                    <Printer className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Payment Modal ── */}
      <AnimatePresence>
        {showPaymentModal && activeDebt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowPaymentModal(false)}
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[28px] shadow-2xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                    Enregistrer un paiement
                  </h3>
                  <p className="text-sm text-slate-500 font-medium">
                    {activeDebt.operationNumber} · {activeDebt.clientName}
                  </p>
                </div>
                <button onClick={() => setShowPaymentModal(false)} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-900">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Balance summary */}
              <div className="mx-6 mt-4 grid grid-cols-3 gap-3 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                <div className="text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</p>
                  <p className="font-black text-slate-900 text-sm">{activeDebt.totalDh.toFixed(2)} DH</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Payé</p>
                  <p className="font-black text-emerald-600 text-sm">{activeDebt.montantPaye.toFixed(2)} DH</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Restant</p>
                  <p className="font-black text-rose-600 text-sm">{activeDebt.resteAPayer.toFixed(2)} DH</p>
                </div>
              </div>

              <form onSubmit={handleRecordPayment} className="p-6 space-y-4">
                {/* Amount */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Montant encaissé (DH)</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={activeDebt.resteAPayer + 0.01}
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-lg font-black text-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                    placeholder={`Max: ${activeDebt.resteAPayer.toFixed(2)}`}
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    autoFocus
                  />
                </div>

                {/* Quick full amount button */}
                <button
                  type="button"
                  onClick={() => setPayAmount(activeDebt.resteAPayer.toFixed(2))}
                  className="w-full py-2 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-all"
                >
                  Paiement total — {activeDebt.resteAPayer.toFixed(2)} DH
                </button>

                {/* Mode de paiement */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Mode de paiement</label>
                  <div className="flex gap-2">
                    {(['Espèce', 'Chèque', 'Versement'] as const).map((m) => (
                      <button
                        key={m} type="button"
                        onClick={() => setPayCondition(m)}
                        className={cn(
                          'flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all',
                          payCondition === m
                            ? 'bg-emerald-500 text-white border-emerald-500'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Référence (optional) */}
                {(payCondition === 'Chèque' || payCondition === 'Versement') && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                      Référence {payCondition === 'Chèque' ? 'chèque' : 'virement'}
                    </label>
                    <input
                      type="text"
                      className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                      value={payRef}
                      onChange={(e) => setPayRef(e.target.value)}
                    />
                  </div>
                )}

                {/* Notes */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Notes (optionnel)</label>
                  <input
                    type="text"
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-medium focus:ring-2 focus:ring-slate-500/20"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    placeholder="Observation libre..."
                  />
                </div>

                {/* Preview new balance */}
                {payAmount && parseFloat(payAmount) > 0 && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 flex items-center justify-between">
                    <p className="text-xs font-bold text-emerald-700">Solde après ce paiement</p>
                    <p className="font-black text-emerald-700">
                      {Math.max(0, activeDebt.resteAPayer - parseFloat(payAmount)).toFixed(2)} DH
                    </p>
                  </div>
                )}

                <div className="pt-2 flex justify-end gap-3">
                  <button type="button" onClick={() => setShowPaymentModal(false)}
                    className="px-5 py-2.5 bg-white text-slate-500 font-bold rounded-2xl hover:bg-slate-50 transition-all">
                    Annuler
                  </button>
                  <button type="submit" disabled={payLoading}
                    className="px-8 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2 disabled:opacity-50">
                    {payLoading
                      ? <span className="animate-pulse">Enregistrement...</span>
                      : <><CheckCircle2 className="h-4 w-4" /> ENREGISTRER & IMPRIMER</>
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
