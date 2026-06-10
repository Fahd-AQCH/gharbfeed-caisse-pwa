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
  LayoutDashboard,
  List,
  History,
  ChevronRight,
  MessageCircle,
  Edit2,
  ArrowUpDown,
  Crown,
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
  clientPhone?: string;
  totalDh: number;
  montantPaye: number;
  resteAPayer: number;
  dateEcheance?: string;
  statutPaiement?: string;
  conditionPaiement?: string;
  isOverdue: boolean;
  daysOverdue: number;
}

type TabId = 'dashboard' | 'actives' | 'historique';
type SortKey = 'echeance' | 'montant' | 'client' | 'date';

export default function Debts({ profile }: DebtsProps) {
  const isAdmin = profile?.roleId === 'admin';
  // Le trésorier gère les créances au même titre que l'admin (rôle financier)
  const canManage = isAdmin || profile?.roleId === 'tresorier';

  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  // ── Active debts ────────────────────────────────────────────────────────────
  const [debtOps, setDebtOps] = useState<DebtOp[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientSearch, setClientSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [paymentHistories, setPaymentHistories] = useState<Record<number, DebtPayment[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<Record<number, boolean>>({});
  const [sortBy, setSortBy] = useState<SortKey>('echeance');
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);

  // Édition inline de l'échéance (admin / trésorier)
  const [editingEcheanceId, setEditingEcheanceId] = useState<number | null>(null);
  const [echeanceDraft, setEcheanceDraft] = useState('');

  // ── Debt history (tab 3) ────────────────────────────────────────────────────
  const [debtHistory, setDebtHistory] = useState<DebtOp[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyClientSearch, setHistoryClientSearch] = useState('');
  const [historyExpandedId, setHistoryExpandedId] = useState<number | null>(null);

  // ── Payment modal ───────────────────────────────────────────────────────────
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [activeDebt, setActiveDebt] = useState<DebtOp | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payCondition, setPayCondition] = useState<'Espèce' | 'Chèque' | 'Versement'>('Espèce');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payLoading, setPayLoading] = useState(false);

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const enrichOps = async (opsData: any[]): Promise<DebtOp[]> => {
    if (!opsData?.length) return [];
    const clientIds = [...new Set(opsData.map((op: any) => op.client_id).filter(Boolean))];
    const clientMap: Record<string, string> = {};
    const phoneMap: Record<string, string> = {};
    if (clientIds.length > 0) {
      const { data: clients } = await supabase
        .from('clients')
        .select('id_client, nom_prenom, num_telephone')
        .in('id_client', clientIds);
      (clients || []).forEach((c: any) => {
        clientMap[String(c.id_client)] = c.nom_prenom;
        if (c.num_telephone) phoneMap[String(c.id_client)] = c.num_telephone;
      });
    }
    return opsData.map((op: any) => {
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
        clientPhone: op.client_id ? phoneMap[String(op.client_id)] : undefined,
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
  };

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
      setDebtOps(await enrichOps(opsData || []));
    } catch (err) {
      console.error('[Debts] fetchDebts:', err);
    } finally {
      setLoading(false);
    }
  }, [todayStr]);

  const fetchDebtHistory = useCallback(async () => {
    if (historyLoaded) return;
    setHistoryLoading(true);
    try {
      const { data: opsData, error } = await supabase
        .from('operations')
        .select('*')
        .in('type_op', ['vente'])
        .eq('statut', 'valide')
        .not('statut_paiement', 'is', null)
        .order('num_op', { ascending: false })
        .limit(500);
      if (error) throw error;
      setDebtHistory(await enrichOps(opsData || []));
      setHistoryLoaded(true);
    } catch (err) {
      console.error('[Debts] fetchDebtHistory:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyLoaded, todayStr]);

  useEffect(() => { fetchDebts(); }, [fetchDebts]);

  useEffect(() => {
    if (activeTab === 'historique') fetchDebtHistory();
  }, [activeTab, fetchDebtHistory]);

  const fetchPaymentHistory = async (opId: number) => {
    if (paymentHistories[opId]) return;
    setLoadingHistory(prev => ({ ...prev, [opId]: true }));
    try {
      const { data: payments } = await supabase
        .from('debt_payments')
        .select('*')
        .eq('operation_id', opId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

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
    if (expandedId === opId) { setExpandedId(null); return; }
    setExpandedId(opId);
    fetchPaymentHistory(opId);
  };

  const handleToggleHistoryExpand = (opId: number) => {
    if (historyExpandedId === opId) { setHistoryExpandedId(null); return; }
    setHistoryExpandedId(opId);
    fetchPaymentHistory(opId);
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
    if (!Number.isFinite(amount) || amount <= 0) { alert('Montant invalide.'); return; }
    if (amount > activeDebt.resteAPayer + 0.01) {
      alert(`Le montant (${amount.toFixed(2)} DH) dépasse le solde dû (${activeDebt.resteAPayer.toFixed(2)} DH).`);
      return;
    }
    setPayLoading(true);
    try {
      const timeStr = new Date().toTimeString().split(' ')[0];
      const newMontantPaye = activeDebt.montantPaye + amount;
      const newResteAPayer = Math.max(0, activeDebt.resteAPayer - amount);
      const isSolde = newResteAPayer <= 0.01;

      const { error: payErr } = await supabase.from('debt_payments').insert({
        operation_id: activeDebt.numOp,
        montant: amount,
        date_paiement: todayStr,
        heure_paiement: timeStr,
        condition_paiement: payCondition,
        ref_paiement: payRef.trim() || null,
        utilisateur_id: profile.id,
        notes: payNotes.trim() || null,
      });
      if (payErr) throw payErr;

      const { error: updateErr } = await supabase.from('operations').update({
        montant_paye: newMontantPaye,
        reste_a_payer: newResteAPayer,
        statut_paiement: isSolde ? 'Payé' : 'Partiel',
      }).eq('num_op', activeDebt.numOp);
      if (updateErr) throw updateErr;

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

      setPaymentHistories(prev => { const n = { ...prev }; delete n[activeDebt.numOp]; return n; });
      setHistoryLoaded(false); // invalidate history cache
      setShowPaymentModal(false);
      fetchDebts();
      if (isSolde) alert(`✅ La créance ${activeDebt.operationNumber} est intégralement soldée !`);
    } catch (err) {
      alert('Erreur : ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPayLoading(false);
    }
  };

  // ── Relance WhatsApp (numéros marocains 06… → 2126…) ───────────────────────
  const buildWhatsAppLink = (debt: DebtOp): string | null => {
    if (!debt.clientPhone) return null;
    let digits = debt.clientPhone.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('0')) digits = '212' + digits.slice(1);
    else if (!digits.startsWith('212')) digits = '212' + digits;
    const msg =
      `Bonjour ${debt.clientName}, nous vous rappelons aimablement qu'un solde de ` +
      `${debt.resteAPayer.toFixed(2)} DH reste dû sur l'opération ${debt.operationNumber}` +
      (debt.dateEcheance ? ` (échéance : ${new Date(debt.dateEcheance).toLocaleDateString('fr-FR')})` : '') +
      `. Merci de régulariser auprès de GharbFeed. 🙏`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
  };

  // ── Édition échéance ────────────────────────────────────────────────────────
  const handleSaveEcheance = async (debt: DebtOp) => {
    try {
      const { error } = await supabase
        .from('operations')
        .update({ date_echeance: echeanceDraft || null })
        .eq('num_op', debt.numOp);
      if (error) throw error;
      setEditingEcheanceId(null);
      setEcheanceDraft('');
      fetchDebts();
    } catch (err) {
      alert('Erreur : ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const filteredActive = debtOps.filter((d) => {
    if (showOverdueOnly && !d.isOverdue) return false;
    if (!clientSearch.trim()) return true;
    const q = clientSearch.toLowerCase();
    return (d.clientName || '').toLowerCase().includes(q) || d.operationNumber.toLowerCase().includes(q);
  });

  const sortedActive = [...filteredActive].sort((a, b) => {
    switch (sortBy) {
      case 'montant': return b.resteAPayer - a.resteAPayer;
      case 'client':  return (a.clientName || '').localeCompare(b.clientName || '', 'fr');
      case 'date':    return (a.dateOp || '').localeCompare(b.dateOp || '');
      case 'echeance':
      default: {
        // Échéances les plus urgentes d'abord — sans échéance en dernier
        const ea = a.dateEcheance || '9999-12-31';
        const eb = b.dateEcheance || '9999-12-31';
        return ea.localeCompare(eb);
      }
    }
  });

  // ── Balance âgée (ancienneté par date d'opération) ──────────────────────────
  const ageInDays = (d: DebtOp) =>
    d.dateOp ? Math.floor((new Date(todayStr).getTime() - new Date(d.dateOp).getTime()) / 86400000) : 0;

  const agingBuckets = [
    { label: '0–30 j',  color: 'bg-emerald-500', text: 'text-emerald-700', test: (n: number) => n <= 30 },
    { label: '31–60 j', color: 'bg-amber-400',   text: 'text-amber-700',   test: (n: number) => n > 30 && n <= 60 },
    { label: '61–90 j', color: 'bg-orange-500',  text: 'text-orange-700',  test: (n: number) => n > 60 && n <= 90 },
    { label: '+90 j',   color: 'bg-rose-500',    text: 'text-rose-700',    test: (n: number) => n > 90 },
  ].map((bucket) => {
    const ops = debtOps.filter((d) => bucket.test(ageInDays(d)));
    return { ...bucket, total: ops.reduce((s, d) => s + d.resteAPayer, 0), count: ops.length };
  });

  // ── Top 5 débiteurs ─────────────────────────────────────────────────────────
  const debtorMap = debtOps.reduce<Record<string, { name: string; total: number; count: number; hasOverdue: boolean }>>(
    (acc, d) => {
      const key = d.clientName || 'Comptoir';
      if (!acc[key]) acc[key] = { name: key, total: 0, count: 0, hasOverdue: false };
      acc[key].total += d.resteAPayer;
      acc[key].count += 1;
      acc[key].hasOverdue = acc[key].hasOverdue || d.isOverdue;
      return acc;
    },
    {}
  );
  const topDebtors = Object.keys(debtorMap)
    .map((k) => debtorMap[k])
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const filteredHistory = debtHistory.filter((d) => {
    if (!historyClientSearch.trim()) return true;
    const q = historyClientSearch.toLowerCase();
    return (d.clientName || '').toLowerCase().includes(q) || d.operationNumber.toLowerCase().includes(q);
  });

  const totalDu = debtOps.reduce((s, d) => s + d.resteAPayer, 0);
  const nbOverdue = debtOps.filter((d) => d.isOverdue).length;
  const uniqueClients = new Set(debtOps.filter((d) => d.clientId).map((d) => d.clientId)).size;
  const totalMontantEchu = debtOps.filter((d) => d.isOverdue).reduce((s, d) => s + d.resteAPayer, 0);

  // ── Reusable: debt row with payment history expand ─────────────────────────
  const DebtRow: React.FC<{
    debt: DebtOp;
    onPay?: (d: DebtOp) => void;
    expandedId: number | null;
    onToggle: (id: number) => void;
    manageable?: boolean;
  }> = ({ debt, onPay, expandedId, onToggle, manageable = false }) => {
    // Paiement initial (acompte à la création) = montant payé cumulé − somme des paiements partiels enregistrés.
    // Chaque paiement de debt_payments incrémente operations.montant_paye, donc la différence
    // reconstitue exactement le montant_paye initial de l'opération.
    const realPayments = paymentHistories[debt.numOp] || [];
    const sumRealPayments = realPayments.reduce((s, p) => s + p.montant, 0);
    const initialPayment = Math.max(0, debt.montantPaye - sumRealPayments);
    const hasInitialPayment = initialPayment > 0.01;

    const printInitialReceipt = () => {
      generateDebtPaymentPDF({
        operationNumber: debt.operationNumber,
        clientName: debt.clientName || 'Comptoir',
        totalOriginal: debt.totalDh,
        montantCePaiement: initialPayment,
        totalDejaPaye: 0,
        resteAPayerApres: Math.max(0, debt.totalDh - initialPayment),
        datePaiement: debt.dateOp,
        heurePaiement: debt.heureOp,
        conditionPaiement: debt.conditionPaiement || 'Espèce',
        isInitialPayment: true,
      });
    };

    return (
    <div className={cn('bg-white rounded-2xl border shadow-sm overflow-hidden transition-all', debt.isOverdue ? 'border-rose-300' : 'border-slate-200')}>
      <div
        className={cn('flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50/50 transition-colors', debt.isOverdue && 'bg-rose-50/30')}
        onClick={() => onToggle(debt.numOp)}
      >
        <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center shrink-0', debt.isOverdue ? 'bg-rose-100' : 'bg-amber-50')}>
          {debt.isOverdue ? <AlertTriangle className="h-5 w-5 text-rose-600" /> : <Clock className="h-5 w-5 text-amber-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-slate-900">{debt.clientName}</p>
            <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">{debt.operationNumber}</span>
            {debt.statutPaiement && (
              <span className={cn('text-[10px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider',
                debt.statutPaiement === 'Payé' ? 'bg-emerald-100 text-emerald-700' :
                debt.statutPaiement === 'Partiel' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
              )}>
                {debt.statutPaiement}
              </span>
            )}
            {debt.isOverdue && (
              <span className="text-[10px] font-black text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded-md uppercase tracking-wider">
                ⚠ {debt.daysOverdue}j retard
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <p className="text-xs text-slate-400 font-medium">
              {debt.dateOp ? new Date(debt.dateOp).toLocaleDateString('fr-FR') : '—'}
            </p>
            {editingEcheanceId === debt.numOp ? (
              <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <input
                  type="date"
                  value={echeanceDraft}
                  onChange={(e) => setEcheanceDraft(e.target.value)}
                  className="text-xs font-bold border border-slate-300 rounded-lg px-2 py-0.5 focus:ring-2 focus:ring-rose-400/30"
                />
                <button onClick={() => handleSaveEcheance(debt)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Enregistrer">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => { setEditingEcheanceId(null); setEcheanceDraft(''); }} className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg" title="Annuler">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                {debt.dateEcheance ? (
                  <p className={cn('text-xs font-bold', debt.isOverdue ? 'text-rose-600' : 'text-slate-500')}>
                    Échéance : {new Date(debt.dateEcheance).toLocaleDateString('fr-FR')}
                  </p>
                ) : manageable ? (
                  <p className="text-xs font-medium text-slate-300 italic">Sans échéance</p>
                ) : null}
                {manageable && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingEcheanceId(debt.numOp); setEcheanceDraft(debt.dateEcheance || ''); }}
                    className="p-1 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                    title="Modifier l'échéance"
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={cn('font-black text-lg', debt.resteAPayer > 0.01 ? 'text-rose-600' : 'text-emerald-600')}>
            {debt.resteAPayer.toFixed(2)} DH
          </p>
          <p className="text-[10px] text-slate-400 font-medium">Payé : {debt.montantPaye.toFixed(2)} / {debt.totalDh.toFixed(2)} DH</p>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {manageable && debt.resteAPayer > 0.01 && (() => {
            const wa = buildWhatsAppLink(debt);
            return wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 bg-green-50 hover:bg-green-100 text-green-600 rounded-xl transition-all border border-green-200"
                title={`Relancer ${debt.clientName} sur WhatsApp`}
              >
                <MessageCircle className="h-4 w-4" />
              </a>
            ) : null;
          })()}
          {onPay && canManage && debt.resteAPayer > 0.01 && (
            <button onClick={() => onPay(debt)} className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl transition-all shadow-sm shadow-emerald-500/20">
              <Plus className="h-3.5 w-3.5" /> Paiement
            </button>
          )}
          <div className="p-2 text-slate-400 hover:text-slate-700 cursor-pointer" onClick={() => onToggle(debt.numOp)}>
            {expandedId === debt.numOp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {debt.totalDh > 0 && (
        <div className="px-5 pb-2">
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(100, (debt.montantPaye / debt.totalDh) * 100)}%` }} />
          </div>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold mt-0.5">
            <span>{((debt.montantPaye / debt.totalDh) * 100).toFixed(0)}% payé</span>
            <span>{((debt.resteAPayer / debt.totalDh) * 100).toFixed(0)}% restant</span>
          </div>
        </div>
      )}

      {/* Expanded payment history */}
      <AnimatePresence>
        {expandedId === debt.numOp && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Historique des paiements</p>
              {loadingHistory[debt.numOp] ? (
                <div className="flex items-center gap-2 py-3">
                  <div className="h-4 w-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-slate-400 font-medium">Chargement...</span>
                </div>
              ) : realPayments.length === 0 && !hasInitialPayment ? (
                <p className="text-xs text-slate-400 font-medium italic py-2">Aucun paiement enregistré.</p>
              ) : (
                <div className="space-y-2">
                  {hasInitialPayment && (
                    <div className="flex items-center justify-between bg-emerald-50/50 rounded-xl border border-emerald-200 px-4 py-2.5">
                      <div>
                        <p className="text-xs font-bold text-slate-700">
                          {debt.dateOp ? new Date(debt.dateOp).toLocaleDateString('fr-FR') : '—'}
                          {debt.heureOp && <span className="ml-1 text-slate-400 font-normal text-[10px]">{debt.heureOp.slice(0, 5)}</span>}
                          <span className="ml-2 text-[10px] font-bold text-slate-500">{debt.conditionPaiement}</span>
                          <span className="ml-2 text-[9px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-md uppercase tracking-wider">Paiement initial</span>
                        </p>
                        <p className="text-[10px] text-slate-400 font-medium">Acompte versé à la création de l'opération</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="font-black text-emerald-600 text-sm">+{initialPayment.toFixed(2)} DH</p>
                        <button
                          onClick={printInitialReceipt}
                          className="p-1.5 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                          title="Réimprimer le reçu de l'acompte initial"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                  {realPayments.map((p, idx) => (
                    <div key={p.id} className="flex items-center justify-between bg-white rounded-xl border border-slate-100 px-4 py-2.5">
                      <div>
                        <p className="text-xs font-bold text-slate-700">
                          {p.datePaiement ? new Date(p.datePaiement).toLocaleDateString('fr-FR') : '—'}
                          {p.heurePaiement && <span className="ml-1 text-slate-400 font-normal text-[10px]">{p.heurePaiement.slice(0, 5)}</span>}
                          <span className="ml-2 text-[10px] font-bold text-slate-500">{p.conditionPaiement}</span>
                          {p.refPaiement && <span className="ml-1 text-[10px] text-slate-400">#{p.refPaiement}</span>}
                        </p>
                        {p.agentName && p.agentName !== '—' && <p className="text-[10px] text-slate-400 font-medium">par {p.agentName}</p>}
                        {p.notes && <p className="text-[10px] text-slate-400 italic">{p.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="font-black text-emerald-600 text-sm">+{p.montant.toFixed(2)} DH</p>
                        <button
                          onClick={() => {
                            // Total déjà réglé = acompte initial + tous les paiements strictement antérieurs
                            // (realPayments est trié par created_at puis id → slice(0, idx) = chronologie exacte)
                            const prevPaid = initialPayment + realPayments.slice(0, idx).reduce((s, px) => s + px.montant, 0);
                            const afterBalance = Math.max(0, debt.totalDh - prevPaid - p.montant);
                            generateDebtPaymentPDF({ operationNumber: debt.operationNumber, clientName: debt.clientName || 'Comptoir', totalOriginal: debt.totalDh, montantCePaiement: p.montant, totalDejaPaye: prevPaid, resteAPayerApres: afterBalance, datePaiement: p.datePaiement, heurePaiement: p.heurePaiement, conditionPaiement: p.conditionPaiement, refPaiement: p.refPaiement, cashierName: p.agentName, notes: p.notes });
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
    );
  };

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
            <p className="text-sm text-slate-500 font-medium">{debtOps.length} créance(s) active(s)</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-slate-100 p-1 w-fit rounded-xl gap-1">
          {([
            { id: 'dashboard', label: 'Vue d\'ensemble', icon: LayoutDashboard },
            { id: 'actives', label: 'Créances actives', icon: List },
            { id: 'historique', label: 'Historique', icon: History },
          ] as { id: TabId; label: string; icon: React.ElementType }[]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition-all',
                activeTab === tab.id ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
              {tab.id === 'actives' && debtOps.length > 0 && (
                <span className="bg-rose-500 text-white text-[10px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                  {debtOps.length > 9 ? '9+' : debtOps.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── TAB 1: Dashboard ── */}
        {activeTab === 'dashboard' && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Dû</span>
                  <div className="h-8 w-8 bg-rose-50 rounded-xl flex items-center justify-center"><DollarSign className="h-4 w-4 text-rose-500" /></div>
                </div>
                <p className="text-2xl font-black text-rose-600">{totalDu.toFixed(0)}<span className="text-sm font-bold text-slate-400 ml-1">DH</span></p>
                <p className="text-xs text-slate-400 font-medium mt-1">Solde total actif</p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Créances</span>
                  <div className="h-8 w-8 bg-amber-50 rounded-xl flex items-center justify-center"><TrendingDown className="h-4 w-4 text-amber-500" /></div>
                </div>
                <p className="text-2xl font-black text-slate-900">{debtOps.length}</p>
                <p className="text-xs text-slate-400 font-medium mt-1">Opérations en attente</p>
              </div>

              <div className={cn('rounded-2xl border p-5 shadow-sm', nbOverdue > 0 ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200')}>
                <div className="flex items-center justify-between mb-3">
                  <span className={cn('text-[10px] font-black uppercase tracking-widest', nbOverdue > 0 ? 'text-rose-500' : 'text-slate-400')}>Échues</span>
                  <div className={cn('h-8 w-8 rounded-xl flex items-center justify-center', nbOverdue > 0 ? 'bg-rose-100' : 'bg-slate-50')}>
                    <Clock className={cn('h-4 w-4', nbOverdue > 0 ? 'text-rose-600' : 'text-slate-400')} />
                  </div>
                </div>
                <p className={cn('text-2xl font-black', nbOverdue > 0 ? 'text-rose-700' : 'text-slate-900')}>{nbOverdue}</p>
                <p className={cn('text-xs font-medium mt-1', nbOverdue > 0 ? 'text-rose-600' : 'text-slate-400')}>
                  {nbOverdue > 0 ? `${totalMontantEchu.toFixed(0)} DH échus` : 'Aucune échéance dépassée'}
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Clients</span>
                  <div className="h-8 w-8 bg-blue-50 rounded-xl flex items-center justify-center"><Users className="h-4 w-4 text-blue-500" /></div>
                </div>
                <p className="text-2xl font-black text-slate-900">{uniqueClients}</p>
                <p className="text-xs text-slate-400 font-medium mt-1">Clients en créance</p>
              </div>
            </div>

            {/* Balance âgée + Top débiteurs */}
            {debtOps.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* ── Balance âgée ── */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <Clock className="h-4 w-4 text-slate-400" />
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Balance âgée des créances</p>
                  </div>
                  {/* Barre empilée */}
                  <div className="h-3 rounded-full overflow-hidden flex bg-slate-100 mb-4">
                    {agingBuckets.map((b) =>
                      b.total > 0 ? (
                        <div
                          key={b.label}
                          className={cn('h-full transition-all', b.color)}
                          style={{ width: `${(b.total / Math.max(totalDu, 0.01)) * 100}%` }}
                          title={`${b.label} : ${b.total.toFixed(2)} DH`}
                        />
                      ) : null
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {agingBuckets.map((b) => (
                      <div key={b.label} className="bg-slate-50 rounded-xl p-2.5 border border-slate-100">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={cn('h-2 w-2 rounded-full', b.color)} />
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">{b.label}</span>
                        </div>
                        <p className={cn('text-sm font-black', b.total > 0 ? b.text : 'text-slate-300')}>
                          {b.total.toFixed(0)} <span className="text-[9px] font-bold text-slate-400">DH</span>
                        </p>
                        <p className="text-[9px] text-slate-400 font-medium">{b.count} créance(s)</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Top 5 débiteurs ── */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <Crown className="h-4 w-4 text-amber-400" />
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Top 5 débiteurs</p>
                  </div>
                  <div className="space-y-2.5">
                    {topDebtors.map((d, i) => (
                      <button
                        key={d.name}
                        onClick={() => { setClientSearch(d.name); setActiveTab('actives'); }}
                        className="w-full flex items-center gap-3 group text-left"
                        title={`Voir les créances de ${d.name}`}
                      >
                        <span className={cn(
                          'h-6 w-6 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0',
                          i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                        )}>
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-black text-slate-700 truncate group-hover:text-rose-600 transition-colors">
                              {d.name}
                              {d.hasOverdue && <AlertTriangle className="inline h-3 w-3 text-rose-500 ml-1 mb-0.5" />}
                            </p>
                            <p className="text-xs font-black text-rose-600 shrink-0">{d.total.toFixed(0)} DH</p>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                            <div
                              className="h-full bg-rose-400 rounded-full transition-all"
                              style={{ width: `${(d.total / Math.max(topDebtors[0]?.total ?? 1, 0.01)) * 100}%` }}
                            />
                          </div>
                          <p className="text-[9px] text-slate-400 font-medium mt-0.5">{d.count} créance(s)</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-200 group-hover:text-rose-400 transition-colors shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Quick action: go to actives if any */}
            {debtOps.length > 0 ? (
              <button
                onClick={() => setActiveTab('actives')}
                className="w-full flex items-center justify-between px-5 py-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-rose-50 rounded-xl flex items-center justify-center">
                    <List className="h-5 w-5 text-rose-500" />
                  </div>
                  <div className="text-left">
                    <p className="font-black text-slate-900">Gérer les créances actives</p>
                    <p className="text-xs text-slate-500 font-medium">{debtOps.length} créance(s) · {totalDu.toFixed(2)} DH restants</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-rose-500 transition-colors" />
              </button>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <div className="h-16 w-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                </div>
                <p className="text-xl font-black text-slate-900">Aucune créance active !</p>
                <p className="text-sm text-slate-400 font-medium mt-1">Tous les comptes sont soldés.</p>
              </div>
            )}
          </>
        )}

        {/* ── TAB 2: Active debts ── */}
        {activeTab === 'actives' && (
          <>
            <div className="flex flex-col lg:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filtrer par client ou numéro d'opération..."
                  className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-rose-500/10 transition-all"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                />
              </div>

              {/* Tri */}
              <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-2">
                <ArrowUpDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                {([
                  { key: 'echeance', label: 'Échéance' },
                  { key: 'montant',  label: 'Montant' },
                  { key: 'client',   label: 'Client' },
                  { key: 'date',     label: 'Ancienneté' },
                ] as { key: SortKey; label: string }[]).map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setSortBy(s.key)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all',
                      sortBy === s.key ? 'bg-rose-500 text-white' : 'text-slate-500 hover:bg-slate-50'
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Filtre échues */}
              <button
                onClick={() => setShowOverdueOnly((v) => !v)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition-all',
                  showOverdueOnly
                    ? 'bg-rose-500 text-white border-rose-500 shadow-sm shadow-rose-500/20'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-rose-300'
                )}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Échues{nbOverdue > 0 ? ` (${nbOverdue})` : ''}
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-8 w-8 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : sortedActive.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <div className="h-16 w-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                </div>
                <p className="text-xl font-black text-slate-900">{clientSearch || showOverdueOnly ? 'Aucun résultat' : 'Aucune créance active !'}</p>
                <p className="text-sm text-slate-400 font-medium mt-1">{clientSearch || showOverdueOnly ? 'Modifiez vos filtres.' : 'Tous les comptes sont soldés.'}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedActive.map((debt) => (
                  <DebtRow
                    key={debt.numOp}
                    debt={debt}
                    onPay={openPaymentModal}
                    expandedId={expandedId}
                    onToggle={handleToggleExpand}
                    manageable={canManage}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── TAB 3: Full history ── */}
        {activeTab === 'historique' && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Filtrer par client..."
                className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-rose-500/10 transition-all"
                value={historyClientSearch}
                onChange={(e) => setHistoryClientSearch(e.target.value)}
              />
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-8 w-8 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <History className="h-12 w-12 text-slate-200 mx-auto mb-4" />
                <p className="text-xl font-black text-slate-900">Aucun historique de dettes</p>
                <p className="text-sm text-slate-400 font-medium mt-1">Les paiements partiels et créances soldées apparaîtront ici.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredHistory.map((debt) => (
                  <DebtRow
                    key={debt.numOp}
                    debt={debt}
                    expandedId={historyExpandedId}
                    onToggle={handleToggleHistoryExpand}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Payment Modal ── */}
      <AnimatePresence>
        {showPaymentModal && activeDebt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowPaymentModal(false)} className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[28px] shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Enregistrer un paiement</h3>
                  <p className="text-sm text-slate-500 font-medium">{activeDebt.operationNumber} · {activeDebt.clientName}</p>
                </div>
                <button onClick={() => setShowPaymentModal(false)} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-900">
                  <X className="h-5 w-5" />
                </button>
              </div>

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
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Montant encaissé (DH)</label>
                  <input required type="number" step="0.01" min="0.01" max={activeDebt.resteAPayer + 0.01}
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-lg font-black text-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                    placeholder={`Max: ${activeDebt.resteAPayer.toFixed(2)}`}
                    value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
                </div>

                <button type="button" onClick={() => setPayAmount(activeDebt.resteAPayer.toFixed(2))}
                  className="w-full py-2 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-all">
                  Paiement total — {activeDebt.resteAPayer.toFixed(2)} DH
                </button>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Mode de paiement</label>
                  <div className="flex gap-2">
                    {(['Espèce', 'Chèque', 'Versement'] as const).map((m) => (
                      <button key={m} type="button" onClick={() => setPayCondition(m)}
                        className={cn('flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all',
                          payCondition === m ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                        )}>{m}</button>
                    ))}
                  </div>
                </div>

                {(payCondition === 'Chèque' || payCondition === 'Versement') && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Référence {payCondition === 'Chèque' ? 'chèque' : 'virement'}</label>
                    <input type="text" className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                      value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Notes (optionnel)</label>
                  <input type="text" className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-medium focus:ring-2 focus:ring-slate-500/20"
                    value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Observation libre..." />
                </div>

                {payAmount && parseFloat(payAmount) > 0 && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 flex items-center justify-between">
                    <p className="text-xs font-bold text-emerald-700">Solde après ce paiement</p>
                    <p className="font-black text-emerald-700">{Math.max(0, activeDebt.resteAPayer - parseFloat(payAmount)).toFixed(2)} DH</p>
                  </div>
                )}

                <div className="pt-2 flex justify-end gap-3">
                  <button type="button" onClick={() => setShowPaymentModal(false)}
                    className="px-5 py-2.5 bg-white text-slate-500 font-bold rounded-2xl hover:bg-slate-50 transition-all">Annuler</button>
                  <button type="submit" disabled={payLoading}
                    className="px-8 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2 disabled:opacity-50">
                    {payLoading ? <span className="animate-pulse">Enregistrement...</span> : <><CheckCircle2 className="h-4 w-4" /> ENREGISTRER & IMPRIMER</>}
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
