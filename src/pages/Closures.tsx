import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { UserProfile } from '../types';
import { supabase } from '../supabase';
import { generateZReportPDF } from '../utils/zReportPdfGenerator';
import {
  Archive,
  Calculator,
  CheckCircle2,
  Printer,
  RefreshCw,
  AlertTriangle,
  Lock,
  TrendingUp,
  TrendingDown,
  Banknote,
  History as HistoryIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';

interface ClosuresProps {
  profile: UserProfile | null;
}

interface ClosureRow {
  id: number;
  periode_debut_date: string;
  periode_debut_heure: string;
  date_cloture: string;
  heure_cloture: string;
  fonds_ouverture: number;
  total_ventes_especes: number;
  total_encaissements_dettes: number;
  total_retours_fournisseurs: number;
  total_achats_especes: number;
  total_paiements_fournisseurs: number;
  total_charges_especes: number;
  total_remboursements_clients: number;
  solde_theorique: number;
  solde_reel: number;
  ecart: number;
  fonds_prochaine_ouverture: number;
  notes?: string | null;
  utilisateur_id?: string | null;
  _agentName?: string;
}

interface Breakdown {
  debutDate: string;
  debutHeure: string;
  finDate: string;
  finHeure: string;
  fondsOuverture: number;
  ventesEspeces: number;
  encaissementsDettes: number;
  retoursFournisseurs: number;
  achatsEspeces: number;
  paiementsFournisseurs: number;
  chargesEspeces: number;
  remboursementsClients: number;
  soldeTheorique: number;
  nbOperations: number;
}

const fmtDateTime = (d?: string | null, h?: string | null) => {
  if (!d) return '—';
  const date = new Date(d).toLocaleDateString('fr-FR');
  return h ? `${date} ${String(h).slice(0, 5)}` : date;
};

export default function Closures({ profile }: ClosuresProps) {
  const isAdmin = profile?.roleId === 'admin';

  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [validating, setValidating] = useState(false);

  // Saisie admin
  const [soldeReel, setSoldeReel] = useState('');
  const [fondsNext, setFondsNext] = useState('');
  const [notes, setNotes] = useState('');

  const lastClosure: ClosureRow | null = closures.length > 0 ? closures[0] : null;

  // ── DOUBLE BLOQUEUR DE CLÔTURE (règle d'or comptable) ───────────────────────
  // Un paiement en attente = espèces potentiellement DANS le tiroir non comptabilisées.
  // Un achat en attente = espèces potentiellement SORTIES non comptabilisées.
  // Tant que l'un des deux existe, l'arrêté de caisse est strictement interdit.
  const [blockers, setBlockers] = useState<{ payments: number; purchases: number }>({ payments: 0, purchases: 0 });

  const fetchBlockers = useCallback(async (): Promise<{ payments: number; purchases: number }> => {
    const [pendingPays, pendingAchats] = await Promise.all([
      supabase.from('debt_payments').select('id', { count: 'exact', head: true }).eq('statut', 'en_attente'),
      supabase.from('operations').select('num_op', { count: 'exact', head: true }).eq('type_op', 'achat').eq('statut', 'en_attente'),
    ]);
    return { payments: pendingPays.count || 0, purchases: pendingAchats.count || 0 };
  }, []);

  useEffect(() => { fetchBlockers().then(setBlockers).catch(() => {}); }, [fetchBlockers]);

  const hasBlockers = blockers.payments > 0 || blockers.purchases > 0;

  // ── Chargement de l'historique des clôtures ─────────────────────────────────
  const fetchClosures = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('cash_closures')
        .select('*')
        .order('date_cloture', { ascending: false })
        .order('heure_cloture', { ascending: false })
        .limit(100);
      if (error) throw error;

      const rows = (data || []) as any[];
      const agentIds = [...new Set(rows.map((r) => r.utilisateur_id).filter(Boolean))];
      const agentMap: Record<string, string> = {};
      if (agentIds.length > 0) {
        const { data: agents } = await supabase
          .from('utilisateurs')
          .select('id, username, nom')
          .in('id', agentIds);
        (agents || []).forEach((a: any) => { agentMap[a.id] = a.nom || a.username || '—'; });
      }

      setClosures(rows.map((r) => ({
        ...r,
        fonds_ouverture: parseFloat(r.fonds_ouverture || 0),
        total_ventes_especes: parseFloat(r.total_ventes_especes || 0),
        total_encaissements_dettes: parseFloat(r.total_encaissements_dettes || 0),
        total_retours_fournisseurs: parseFloat(r.total_retours_fournisseurs || 0),
        total_achats_especes: parseFloat(r.total_achats_especes || 0),
        total_paiements_fournisseurs: parseFloat(r.total_paiements_fournisseurs || 0),
        total_charges_especes: parseFloat(r.total_charges_especes || 0),
        total_remboursements_clients: parseFloat(r.total_remboursements_clients || 0),
        solde_theorique: parseFloat(r.solde_theorique || 0),
        solde_reel: parseFloat(r.solde_reel || 0),
        ecart: parseFloat(r.ecart || 0),
        fonds_prochaine_ouverture: parseFloat(r.fonds_prochaine_ouverture || 0),
        _agentName: r.utilisateur_id ? (agentMap[r.utilisateur_id] || '—') : '—',
      })));
    } catch (err) {
      console.error('[Closures] fetch:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClosures(); }, [fetchClosures]);

  // ── Calcul de l'arrêté (solde théorique de la période en cours) ─────────────
  const computeBreakdown = useCallback(async () => {
    setComputing(true);
    try {
      // Rafraîchit les bloqueurs en même temps que le calcul
      fetchBlockers().then(setBlockers).catch(() => {});

      const now = new Date();
      const finDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(now);
      const finHeure = now.toTimeString().split(' ')[0];
      const debutDate = lastClosure ? lastClosure.date_cloture : '2000-01-01';
      const debutHeure = lastClosure ? String(lastClosure.heure_cloture).slice(0, 8) : '00:00:00';
      const fondsOuverture = lastClosure ? lastClosure.fonds_prochaine_ouverture : 0;

      // Bornage précis : strictement après la clôture précédente, jusqu'à maintenant inclus.
      const inPeriod = (d?: string | null, h?: string | null): boolean => {
        if (!d) return false;
        const hh = (h || '00:00:00').slice(0, 8);
        const afterStart = d > debutDate || (d === debutDate && hh > debutHeure);
        const beforeEnd = d < finDate || (d === finDate && hh <= finHeure);
        return afterStart && beforeEnd;
      };

      // 1) Opérations validées de la fenêtre (filtre grossier SQL, précis en JS)
      const { data: opsRaw, error: opsErr } = await supabase
        .from('operations')
        .select('num_op, date_op, heure_op, type_op, condition_paiement, total_dh, montant_paye')
        .eq('statut', 'valide')
        .gte('date_op', debutDate)
        .lte('date_op', finDate);
      if (opsErr) throw opsErr;
      const ops = (opsRaw || []).filter((op: any) => inPeriod(op.date_op, op.heure_op));

      const isEspece = (c?: string | null) => (c || 'Espèce') === 'Espèce';

      // 2) Reconstruction de l'acompte initial des ventes/achats Espèce :
      //    montant_paye est INCRÉMENTÉ par chaque debt_payment → acompte réel
      //    = montant_paye − Σ debt_payments(op). Sans cela, les encaissements
      //    de créances de la même période seraient comptés deux fois.
      const especeVAIds = ops
        .filter((o: any) => isEspece(o.condition_paiement) && (o.type_op === 'vente' || o.type_op === 'achat'))
        .map((o: any) => o.num_op);
      const paymentsSumByOp: Record<number, number> = {};
      if (especeVAIds.length > 0) {
        const { data: allPays } = await supabase
          .from('debt_payments')
          .select('operation_id, montant')
          .eq('statut', 'valide') // seuls les paiements validés sont dans montant_paye
          .in('operation_id', especeVAIds);
        (allPays || []).forEach((p: any) => {
          paymentsSumByOp[p.operation_id] = (paymentsSumByOp[p.operation_id] || 0) + parseFloat(p.montant || 0);
        });
      }
      const initialAcompte = (op: any) =>
        Math.max(0, parseFloat(op.montant_paye || 0) - (paymentsSumByOp[op.num_op] || 0));

      // 3) Paiements de dettes ESPÈCE encaissés/décaissés pendant la période
      //    (rattachés à LEUR date de paiement, pas à celle de l'opération parente)
      const { data: paysRaw, error: paysErr } = await supabase
        .from('debt_payments')
        .select('operation_id, montant, date_paiement, heure_paiement, condition_paiement')
        .eq('condition_paiement', 'Espèce')
        .eq('statut', 'valide') // les en attente / annulés ne sont pas des espèces comptabilisées
        .gte('date_paiement', debutDate)
        .lte('date_paiement', finDate);
      if (paysErr) throw paysErr;
      const pays = (paysRaw || []).filter((p: any) => inPeriod(p.date_paiement, p.heure_paiement));

      // Type du parent (vente = entrée / achat = sortie)
      const parentTypeMap: Record<number, string> = {};
      ops.forEach((o: any) => { parentTypeMap[o.num_op] = o.type_op; });
      const missingParentIds = [...new Set(pays.map((p: any) => p.operation_id).filter((id: number) => !parentTypeMap[id]))];
      if (missingParentIds.length > 0) {
        const { data: parents } = await supabase
          .from('operations')
          .select('num_op, type_op')
          .in('num_op', missingParentIds);
        (parents || []).forEach((o: any) => { parentTypeMap[o.num_op] = o.type_op; });
      }

      // 4) Charges ESPÈCE de la période
      const { data: chargesRaw, error: chErr } = await supabase
        .from('charges')
        .select('montant, date_charge, heure_charge, mode_paiement')
        .eq('mode_paiement', 'Espèce')
        .gte('date_charge', debutDate)
        .lte('date_charge', finDate);
      if (chErr) throw chErr;
      const charges = (chargesRaw || []).filter((c: any) => inPeriod(c.date_charge, c.heure_charge));

      // ── Sommes ────────────────────────────────────────────────────────────
      let ventesEspeces = 0, achatsEspeces = 0, retoursFournisseurs = 0, remboursementsClients = 0;
      ops.forEach((op: any) => {
        if (!isEspece(op.condition_paiement)) return;
        const total = parseFloat(op.total_dh || 0);
        switch (op.type_op) {
          case 'vente': ventesEspeces += initialAcompte(op); break;
          case 'achat': achatsEspeces += initialAcompte(op); break;
          case 'retour_fournisseur': retoursFournisseurs += total; break;
          case 'retour_client': remboursementsClients += total; break;
        }
      });

      let encaissementsDettes = 0, paiementsFournisseurs = 0;
      pays.forEach((p: any) => {
        const m = parseFloat(p.montant || 0);
        const parentType = parentTypeMap[p.operation_id];
        if (parentType === 'vente') encaissementsDettes += m;
        else if (parentType === 'achat') paiementsFournisseurs += m;
      });

      const chargesEspeces = charges.reduce((s: number, c: any) => s + parseFloat(c.montant || 0), 0);

      const soldeTheorique =
        fondsOuverture
        + ventesEspeces + encaissementsDettes + retoursFournisseurs
        - achatsEspeces - paiementsFournisseurs - chargesEspeces - remboursementsClients;

      setBreakdown({
        debutDate, debutHeure, finDate, finHeure,
        fondsOuverture,
        ventesEspeces, encaissementsDettes, retoursFournisseurs,
        achatsEspeces, paiementsFournisseurs, chargesEspeces, remboursementsClients,
        soldeTheorique,
        nbOperations: ops.length + pays.length + charges.length,
      });
    } catch (err) {
      console.error('[Closures] compute:', err);
      alert('Erreur lors du calcul : ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setComputing(false);
    }
  }, [lastClosure]);

  // Calcul automatique une fois l'historique chargé
  useEffect(() => {
    if (!loading && isAdmin) computeBreakdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const soldeReelNum = parseFloat(soldeReel);
  const hasReel = Number.isFinite(soldeReelNum);
  const ecart = breakdown && hasReel ? soldeReelNum - breakdown.soldeTheorique : 0;
  const fondsNextNum = parseFloat(fondsNext);
  const hasFondsNext = Number.isFinite(fondsNextNum) && fondsNextNum >= 0;

  // ── Validation de la clôture ────────────────────────────────────────────────
  const handleValidate = async () => {
    if (!isAdmin || !breakdown || !profile?.id) return;

    // ── BLOQUEUR STRICT : re-vérification FRAÎCHE au moment de valider
    //    (un caissier peut avoir enregistré un paiement pendant que cette page était ouverte)
    const fresh = await fetchBlockers();
    setBlockers(fresh);
    if (fresh.payments > 0 || fresh.purchases > 0) {
      alert(
        `🚫 Impossible de clôturer :\n\n` +
        `Vous avez ${fresh.payments} paiement(s) de dette en attente et ${fresh.purchases} achat(s) en attente.\n` +
        `Veuillez les valider ou les annuler avant d'arrêter la caisse.`
      );
      return;
    }

    if (!hasReel || soldeReelNum < 0) { alert('Saisissez le solde réel compté en caisse.'); return; }
    if (!hasFondsNext) { alert("Saisissez le fonds de caisse pour la prochaine ouverture."); return; }
    if (fondsNextNum > soldeReelNum + 0.01) {
      alert(`Le fonds de la prochaine ouverture (${fondsNextNum.toFixed(2)} DH) ne peut pas dépasser le solde réel compté (${soldeReelNum.toFixed(2)} DH).`);
      return;
    }
    if (!window.confirm(
      `Confirmer la clôture de caisse ?\n\n` +
      `Solde théorique : ${breakdown.soldeTheorique.toFixed(2)} DH\n` +
      `Solde réel compté : ${soldeReelNum.toFixed(2)} DH\n` +
      `Écart : ${ecart >= 0 ? '+' : ''}${ecart.toFixed(2)} DH\n\n` +
      `Toutes les opérations de la période seront verrouillées pour les caissiers et trésoriers.`
    )) return;

    setValidating(true);
    try {
      const { data: inserted, error } = await supabase
        .from('cash_closures')
        .insert({
          periode_debut_date: breakdown.debutDate,
          periode_debut_heure: breakdown.debutHeure,
          date_cloture: breakdown.finDate,
          heure_cloture: breakdown.finHeure,
          fonds_ouverture: breakdown.fondsOuverture,
          total_ventes_especes: breakdown.ventesEspeces,
          total_encaissements_dettes: breakdown.encaissementsDettes,
          total_retours_fournisseurs: breakdown.retoursFournisseurs,
          total_achats_especes: breakdown.achatsEspeces,
          total_paiements_fournisseurs: breakdown.paiementsFournisseurs,
          total_charges_especes: breakdown.chargesEspeces,
          total_remboursements_clients: breakdown.remboursementsClients,
          solde_theorique: breakdown.soldeTheorique,
          solde_reel: soldeReelNum,
          ecart,
          fonds_prochaine_ouverture: fondsNextNum,
          notes: notes.trim() || null,
          utilisateur_id: profile.id,
        })
        .select()
        .single();
      if (error) throw error;

      // Ticket Z après commit React (règle PDF du projet)
      const zData = {
        closureId: (inserted as any).id as number,
        periodeDebut: fmtDateTime(breakdown.debutDate === '2000-01-01' ? null : breakdown.debutDate, breakdown.debutHeure) === '—'
          ? 'Début d\'activité'
          : fmtDateTime(breakdown.debutDate, breakdown.debutHeure),
        periodeFin: fmtDateTime(breakdown.finDate, breakdown.finHeure),
        fondsOuverture: breakdown.fondsOuverture,
        ventesEspeces: breakdown.ventesEspeces,
        encaissementsDettes: breakdown.encaissementsDettes,
        retoursFournisseurs: breakdown.retoursFournisseurs,
        achatsEspeces: breakdown.achatsEspeces,
        paiementsFournisseurs: breakdown.paiementsFournisseurs,
        chargesEspeces: breakdown.chargesEspeces,
        remboursementsClients: breakdown.remboursementsClients,
        soldeTheorique: breakdown.soldeTheorique,
        soldeReel: soldeReelNum,
        ecart,
        fondsProchaineOuverture: fondsNextNum,
        adminName: profile.username,
        notes: notes.trim() || undefined,
      };
      Promise.resolve().then(() => {
        try { generateZReportPDF(zData); }
        catch (pdfErr) { console.error('[Closures] PDF:', pdfErr); }
      });

      // Reset + rechargement (le nouveau verrou devient actif)
      setSoldeReel('');
      setFondsNext('');
      setNotes('');
      setBreakdown(null);
      await fetchClosures();
      alert(`✅ Clôture Z-${String((inserted as any).id).padStart(4, '0')} enregistrée. Ticket Z généré.`);
    } catch (err) {
      alert('Erreur : ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setValidating(false);
    }
  };

  // Recalcule la période courante quand l'historique change (après validation)
  useEffect(() => {
    if (!loading && isAdmin && !breakdown && !computing) computeBreakdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closures]);

  // ── Réimpression d'un Ticket Z historique ───────────────────────────────────
  const reprintZ = (row: ClosureRow) => {
    generateZReportPDF({
      closureId: row.id,
      periodeDebut: row.periode_debut_date === '2000-01-01'
        ? 'Début d\'activité'
        : fmtDateTime(row.periode_debut_date, row.periode_debut_heure),
      periodeFin: fmtDateTime(row.date_cloture, row.heure_cloture),
      fondsOuverture: row.fonds_ouverture,
      ventesEspeces: row.total_ventes_especes,
      encaissementsDettes: row.total_encaissements_dettes,
      retoursFournisseurs: row.total_retours_fournisseurs,
      achatsEspeces: row.total_achats_especes,
      paiementsFournisseurs: row.total_paiements_fournisseurs,
      chargesEspeces: row.total_charges_especes,
      remboursementsClients: row.total_remboursements_clients,
      soldeTheorique: row.solde_theorique,
      soldeReel: row.solde_reel,
      ecart: row.ecart,
      fondsProchaineOuverture: row.fonds_prochaine_ouverture,
      adminName: row._agentName,
      notes: row.notes || undefined,
    });
  };

  // ── Accès refusé (non-admin) ────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-md">
          <Lock className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <p className="text-xl font-black text-slate-900">Accès réservé</p>
          <p className="text-sm text-slate-400 font-medium mt-1">
            La clôture de caisse est une opération réservée à l'administrateur.
          </p>
        </div>
      </div>
    );
  }

  const totalEntrees = breakdown
    ? breakdown.ventesEspeces + breakdown.encaissementsDettes + breakdown.retoursFournisseurs : 0;
  const totalSorties = breakdown
    ? breakdown.achatsEspeces + breakdown.paiementsFournisseurs + breakdown.chargesEspeces + breakdown.remboursementsClients : 0;

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="space-y-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              <Archive className="h-6 w-6 text-rose-500" />
              CLÔTURE DE CAISSE
            </h2>
            <p className="text-sm text-slate-500 font-medium">
              Arrêté de caisse (espèces) · Ticket Z · {closures.length} clôture(s) enregistrée(s)
            </p>
          </div>
          <button
            onClick={computeBreakdown}
            disabled={computing}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:border-rose-300 transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', computing && 'animate-spin')} />
            Recalculer
          </button>
        </div>

        {/* ── Période en cours ── */}
        <div className="bg-slate-900 rounded-2xl p-5 text-white shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Période en cours</p>
              <p className="text-lg font-black mt-0.5">
                {lastClosure
                  ? `Depuis le ${fmtDateTime(lastClosure.date_cloture, lastClosure.heure_cloture)}`
                  : 'Depuis le début d\'activité (aucune clôture)'}
                <span className="text-slate-400 font-bold"> → maintenant</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fonds d'ouverture hérité</p>
              <p className="text-2xl font-black text-emerald-400">
                {(lastClosure ? lastClosure.fonds_prochaine_ouverture : 0).toFixed(2)} <span className="text-sm">DH</span>
              </p>
            </div>
          </div>
        </div>

        {/* ── DOUBLE BLOQUEUR : tout doit être résolu avant l'arrêté ── */}
        {hasBlockers && (
          <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-base font-black text-rose-800">Impossible de clôturer la caisse</p>
                <p className="text-sm font-medium text-rose-700 mt-1">
                  Vous avez <strong>{blockers.payments} paiement(s) de dette en attente</strong> et{' '}
                  <strong>{blockers.purchases} achat(s) en attente</strong>.
                  Veuillez les valider ou les annuler avant d'arrêter la caisse.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {blockers.payments > 0 && (
                    <Link
                      to="/debts"
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-rose-200 text-rose-700 font-bold text-xs rounded-xl hover:bg-rose-100 transition-all"
                    >
                      → Traiter les {blockers.payments} paiement(s) (Gestion des Dettes)
                    </Link>
                  )}
                  {blockers.purchases > 0 && (
                    <Link
                      to="/history"
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-rose-200 text-rose-700 font-bold text-xs rounded-xl hover:bg-rose-100 transition-all"
                    >
                      → Traiter les {blockers.purchases} achat(s) (Historique)
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {computing || (loading && !breakdown) ? (
          <div className="flex items-center justify-center py-16 bg-white rounded-2xl border border-slate-200">
            <div className="h-8 w-8 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-sm font-bold text-slate-400">Calcul de l'arrêté en cours...</span>
          </div>
        ) : breakdown ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* ── Détail du calcul ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <Calculator className="h-4 w-4 text-slate-400" />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Solde théorique — détail</p>
              </div>
              <div className="p-5 space-y-1 text-sm">
                <div className="flex justify-between py-1.5">
                  <span className="font-bold text-slate-700">Fonds de caisse à l'ouverture</span>
                  <span className="font-black text-slate-900">{breakdown.fondsOuverture.toFixed(2)} DH</span>
                </div>

                <div className="flex items-center gap-1.5 pt-2">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Entrées espèces</span>
                </div>
                {[
                  ['Ventes encaissées (acomptes inclus)', breakdown.ventesEspeces],
                  ['Encaissements créances clients', breakdown.encaissementsDettes],
                  ['Remboursements fournisseurs (retours)', breakdown.retoursFournisseurs],
                ].map(([label, val]) => (
                  <div key={label as string} className="flex justify-between py-1 pl-5">
                    <span className="text-xs font-medium text-slate-500">{label}</span>
                    <span className="text-xs font-black text-emerald-600">+{(val as number).toFixed(2)} DH</span>
                  </div>
                ))}
                <div className="flex justify-between py-1 pl-5 border-t border-slate-50">
                  <span className="text-xs font-black text-slate-600">Total entrées</span>
                  <span className="text-xs font-black text-emerald-700">+{totalEntrees.toFixed(2)} DH</span>
                </div>

                <div className="flex items-center gap-1.5 pt-2">
                  <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
                  <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Sorties espèces</span>
                </div>
                {[
                  ['Achats payés comptant', breakdown.achatsEspeces],
                  ['Règlements crédits fournisseurs', breakdown.paiementsFournisseurs],
                  ['Charges & dépenses', breakdown.chargesEspeces],
                  ['Remboursements clients (avoirs)', breakdown.remboursementsClients],
                ].map(([label, val]) => (
                  <div key={label as string} className="flex justify-between py-1 pl-5">
                    <span className="text-xs font-medium text-slate-500">{label}</span>
                    <span className="text-xs font-black text-rose-600">−{(val as number).toFixed(2)} DH</span>
                  </div>
                ))}
                <div className="flex justify-between py-1 pl-5 border-t border-slate-50">
                  <span className="text-xs font-black text-slate-600">Total sorties</span>
                  <span className="text-xs font-black text-rose-700">−{totalSorties.toFixed(2)} DH</span>
                </div>

                <div className="flex justify-between items-center mt-3 pt-3 border-t-2 border-slate-100">
                  <span className="font-black text-slate-900 uppercase text-xs tracking-tight">Solde théorique</span>
                  <span className="text-2xl font-black text-slate-900">{breakdown.soldeTheorique.toFixed(2)} <span className="text-sm text-slate-400">DH</span></span>
                </div>
                <p className="text-[10px] text-slate-300 font-medium text-right">
                  {breakdown.nbOperations} mouvement(s) espèces sur la période
                </p>
              </div>
            </div>

            {/* ── Saisie & validation ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <Banknote className="h-4 w-4 text-slate-400" />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Comptage physique & validation</p>
              </div>
              <div className="p-5 space-y-4 flex-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Solde réel compté en caisse (DH) *</label>
                  <input
                    type="number" step="0.01" min="0"
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-xl font-black text-blue-700 focus:ring-2 focus:ring-blue-500/20"
                    placeholder="Comptez les espèces du tiroir..."
                    value={soldeReel}
                    onChange={(e) => setSoldeReel(e.target.value)}
                  />
                </div>

                {/* Écart en direct */}
                {hasReel && (
                  <div className={cn(
                    'rounded-2xl p-4 border flex items-center justify-between',
                    Math.abs(ecart) <= 0.01
                      ? 'bg-emerald-50 border-emerald-200'
                      : ecart > 0 ? 'bg-amber-50 border-amber-200' : 'bg-rose-50 border-rose-200'
                  )}>
                    <div className="flex items-center gap-2">
                      {Math.abs(ecart) <= 0.01
                        ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                        : <AlertTriangle className={cn('h-5 w-5', ecart > 0 ? 'text-amber-500' : 'text-rose-500')} />}
                      <p className={cn(
                        'text-sm font-black',
                        Math.abs(ecart) <= 0.01 ? 'text-emerald-700' : ecart > 0 ? 'text-amber-700' : 'text-rose-700'
                      )}>
                        {Math.abs(ecart) <= 0.01 ? 'Caisse juste — aucun écart' : ecart > 0 ? 'Surplus de caisse' : 'Manquant de caisse'}
                      </p>
                    </div>
                    <p className={cn(
                      'text-xl font-black',
                      Math.abs(ecart) <= 0.01 ? 'text-emerald-700' : ecart > 0 ? 'text-amber-700' : 'text-rose-700'
                    )}>
                      {ecart > 0 ? '+' : ''}{ecart.toFixed(2)} DH
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Fonds de caisse — prochaine ouverture (DH) *</label>
                  <div className="flex gap-2">
                    <input
                      type="number" step="0.01" min="0"
                      className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-black text-slate-800 focus:ring-2 focus:ring-emerald-500/20"
                      placeholder="Montant laissé dans le tiroir"
                      value={fondsNext}
                      onChange={(e) => setFondsNext(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => hasReel && setFondsNext(soldeReelNum.toFixed(2))}
                      disabled={!hasReel}
                      className="shrink-0 px-3 py-2 text-[10px] font-black text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-all disabled:opacity-40"
                      title="Tout laisser en caisse"
                    >
                      = RÉEL
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium">
                    Le surplus (réel − fonds) est retiré de la caisse. Ce fonds devient le solde d'ouverture du prochain arrêté.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Notes (optionnel)</label>
                  <input
                    type="text"
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-medium focus:ring-2 focus:ring-slate-500/20"
                    placeholder="Justification d'écart, observation..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="p-5 border-t border-slate-100 bg-slate-50">
                <button
                  onClick={handleValidate}
                  disabled={validating || !hasReel || !hasFondsNext || hasBlockers}
                  className="w-full py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-2xl shadow-lg shadow-rose-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:shadow-none"
                  title={hasBlockers ? `${blockers.payments} paiement(s) et ${blockers.purchases} achat(s) en attente — résolvez-les d'abord` : undefined}
                >
                  {validating ? (
                    <span className="animate-pulse">CLÔTURE EN COURS...</span>
                  ) : hasBlockers ? (
                    <><AlertTriangle className="h-4 w-4" /> CLÔTURE BLOQUÉE — ÉLÉMENTS EN ATTENTE</>
                  ) : (
                    <><Lock className="h-4 w-4" /> VALIDER LA CLÔTURE &amp; IMPRIMER LE TICKET Z</>
                  )}
                </button>
                <p className="text-[10px] text-slate-400 font-medium text-center mt-2">
                  {hasBlockers
                    ? 'Validez ou annulez les paiements et achats en attente avant de compter la caisse.'
                    : 'Verrouille la période pour les caissiers et trésoriers — l\'admin garde la main.'}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Historique des clôtures ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <HistoryIcon className="h-4 w-4 text-slate-400" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Historique des clôtures (Tickets Z)</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : closures.length === 0 ? (
            <p className="text-sm text-slate-400 font-medium italic text-center py-10">
              Aucune clôture enregistrée — la première couvrira tout l'historique.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    {['N°', 'Clôturé le', 'Théorique', 'Réel compté', 'Écart', 'Fonds suivant', 'Par', ''].map((h, i) => (
                      <th key={h || 'actions'} className={cn(
                        'px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest',
                        i >= 2 && i <= 5 ? 'text-right' : 'text-left'
                      )}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {closures.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-slate-500 text-xs">Z-{String(c.id).padStart(4, '0')}</td>
                      <td className="px-4 py-3 text-xs font-bold text-slate-700">{fmtDateTime(c.date_cloture, c.heure_cloture)}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-700">{c.solde_theorique.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-700">{c.solde_reel.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">
                        {Math.abs(c.ecart) <= 0.01 ? (
                          <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-1 rounded-lg uppercase tracking-wider">Juste</span>
                        ) : (
                          <span className={cn(
                            'text-[10px] font-black px-2 py-1 rounded-lg uppercase tracking-wider',
                            c.ecart > 0 ? 'text-amber-700 bg-amber-100' : 'text-rose-700 bg-rose-100'
                          )}>
                            {c.ecart > 0 ? '+' : '−'}{Math.abs(c.ecart).toFixed(2)} DH
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-black text-emerald-700">{c.fonds_prochaine_ouverture.toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-500">{c._agentName}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => reprintZ(c)}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                          title="Réimprimer le Ticket Z"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
