import React, { useState, useEffect, useCallback } from 'react';
import { UserProfile } from '../types';
import { motion } from 'motion/react';
import {
  TrendingUp,
  Package,
  AlertTriangle,
  ShoppingCart,
  Clock,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';

interface DashboardProps {
  profile: UserProfile | null;
}

export default function Dashboard({ profile }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [todayCa, setTodayCa] = useState(0);
  const [todaySalesCount, setTodaySalesCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [pendingPurchasesCount, setPendingPurchasesCount] = useState(0);
  const [pendingPurchases, setPendingPurchases] = useState<any[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<any[]>([]);
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [debtCount, setDebtCount] = useState(0);
  const [debtTotal, setDebtTotal] = useState(0);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      // Intl gère Ramadan + heure d'été automatiquement (Africa/Casablanca = GMT+1 Maroc)
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());

      const [
        { data: todayOps },
        { data: pendingOps, count: pendingCount },
        { data: allProdsData },
        { data: salesData },
      ] = await Promise.all([
        // CA du jour : ventes validées aujourd'hui
        supabase
          .from('operations')
          .select('total_dh')
          .eq('type_op', 'vente')
          .eq('date_op', todayStr)
          .eq('statut', 'valide'),

        // Achats en attente (count total + derniers 3 pour affichage)
        supabase
          .from('operations')
          .select('num_op, total_dh, date_op', { count: 'exact' })
          .eq('type_op', 'achat')
          .eq('statut', 'en_attente')
          .order('num_op', { ascending: false })
          .limit(3),

        // Tous les produits avec seuil_alerte (filtre côté client)
        supabase
          .from('produits')
          .select('code, produit, stock_actuel, seuil_alerte')
          .order('stock_actuel', { ascending: true }),

        // 8 dernières ventes validées (tableau principal)
        supabase
          .from('operations')
          .select('num_op, total_dh, remise_dh, date_op, heure_op')
          .eq('type_op', 'vente')
          .eq('statut', 'valide')
          .order('num_op', { ascending: false })
          .limit(8),
      ]);

      const ca = (todayOps || []).reduce(
        (sum: number, op: any) => sum + parseFloat(op.total_dh || 0),
        0
      );
      // Filtrage stock bas : stock_actuel <= seuil_alerte (défaut 10)
      const lowProdsAll = (allProdsData || []).filter(
        (p: any) => p.stock_actuel <= (p.seuil_alerte ?? 10)
      );
      setTodayCa(ca);
      setTodaySalesCount((todayOps || []).length);
      setPendingPurchasesCount(pendingCount ?? (pendingOps || []).length);
      setPendingPurchases(pendingOps || []);
      setLowStockCount(lowProdsAll.length);
      setLowStockProducts(lowProdsAll.slice(0, 5));
      setRecentSales(salesData || []);

      // Créances — requête optionnelle (colonnes V3 peut-être pas encore créées)
      try {
        const { data: debtOps } = await supabase
          .from('operations')
          .select('reste_a_payer')
          .eq('type_op', 'vente')
          .eq('statut', 'valide')
          .gt('reste_a_payer', 0);
        setDebtCount((debtOps || []).length);
        setDebtTotal(
          (debtOps || []).reduce((s: number, op: any) => s + parseFloat(op.reste_a_payer || 0), 0)
        );
      } catch { /* colonne reste_a_payer pas encore créée */ }
    } catch (err) {
      console.error('[Dashboard] fetchDashboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    fetchDashboard();
  }, [profile?.id, fetchDashboard]);

  // ── KPI cards config ──────────────────────────────────────────────────────
  const kpis = [
    {
      label: 'CA du Jour',
      value: loading ? '...' : `${todayCa.toFixed(2)} DH`,
      sub: `${todaySalesCount} vente(s) validée(s)`,
      icon: TrendingUp,
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
      valueColor: 'text-emerald-700',
      link: '/history',
      urgent: false,
    },
    {
      label: 'Ventes du Jour',
      value: loading ? '...' : todaySalesCount.toString(),
      sub: 'Transactions validées aujourd\'hui',
      icon: ShoppingCart,
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      valueColor: 'text-blue-700',
      link: '/history',
      urgent: false,
    },
    {
      label: 'Stocks Bas',
      value: loading ? '...' : lowStockCount > 0 ? `${lowStockCount} produit(s)` : 'Aucun',
      sub: 'Seuil d\'alerte dynamique par produit',
      icon: Package,
      iconBg: lowStockCount > 0 ? 'bg-amber-100' : 'bg-slate-100',
      iconColor: lowStockCount > 0 ? 'text-amber-600' : 'text-slate-400',
      valueColor: lowStockCount > 0 ? 'text-amber-600' : 'text-emerald-600',
      link: '/inventory?filter=low_stock',
      urgent: false,
    },
    {
      label: 'Achats en Attente',
      value: loading ? '...' : pendingPurchasesCount > 0 ? `${pendingPurchasesCount} achat(s)` : 'Aucun',
      sub: 'En attente de validation admin',
      icon: Clock,
      iconBg: pendingPurchasesCount > 0 ? 'bg-orange-100' : 'bg-slate-100',
      iconColor: pendingPurchasesCount > 0 ? 'text-orange-600' : 'text-slate-400',
      valueColor: pendingPurchasesCount > 0 ? 'text-orange-600' : 'text-emerald-600',
      link: pendingPurchasesCount > 0 ? '/history?status=en_attente' : '/history',
      urgent: pendingPurchasesCount > 0,
    },
    {
      label: 'Créances Actives',
      value: loading ? '...' : debtCount > 0 ? `${debtCount} opération(s)` : 'Aucune',
      sub: loading ? '' : debtCount > 0 ? `${debtTotal.toFixed(0)} DH impayé(s)` : 'Tout est à jour',
      icon: AlertTriangle,
      iconBg: debtCount > 0 ? 'bg-rose-100' : 'bg-slate-100',
      iconColor: debtCount > 0 ? 'text-rose-600' : 'text-slate-400',
      valueColor: debtCount > 0 ? 'text-rose-600' : 'text-emerald-600',
      link: debtCount > 0 ? '/history?filter=debt' : '/history',
      urgent: debtCount > 0,
    },
  ];

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="space-y-6 animate-in fade-in duration-500">

        {/* Header */}
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">TABLEAU DE BORD</h2>
          <p className="text-sm text-slate-500 font-medium capitalize">
            {new Date().toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>

        {/* Zone A — 5 KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {kpis.map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
            >
              <Link
                to={kpi.link}
                className={cn(
                  'block bg-white p-5 rounded-2xl border shadow-sm hover:shadow-md transition-all',
                  kpi.urgent
                    ? 'border-orange-200 hover:border-orange-300'
                    : 'border-slate-200 hover:border-slate-300'
                )}
              >
                <div className="flex items-start justify-between">
                  <div className={cn('p-2 rounded-xl', kpi.iconBg)}>
                    <kpi.icon className={cn('h-5 w-5', kpi.iconColor)} />
                  </div>
                  {kpi.urgent && (
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-orange-500 animate-ping" />
                  )}
                </div>
                <p className="mt-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {kpi.label}
                </p>
                <p className={cn('text-2xl font-black mt-1 leading-tight', kpi.valueColor)}>
                  {kpi.value}
                </p>
                <p className="text-xs text-slate-400 font-medium mt-0.5">{kpi.sub}</p>
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Zone B + C */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* Zone B — Tableau des dernières ventes validées */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-900 uppercase tracking-tight text-sm">
                Dernières Ventes Validées
              </h3>
              <Link
                to="/history"
                className="text-xs text-emerald-600 font-bold hover:underline flex items-center gap-1"
              >
                Voir tout <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Numéro</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date &amp; Heure</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Total (DH)</th>
                    <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-12 text-center">
                        <div className="flex items-center justify-center gap-2 text-slate-400 font-bold">
                          <div className="h-4 w-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                          Chargement...
                        </div>
                      </td>
                    </tr>
                  ) : recentSales.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-12 text-center text-slate-400 font-medium">
                        Aucune vente enregistrée.
                      </td>
                    </tr>
                  ) : (
                    recentSales.map((op) => (
                      <tr key={op.num_op} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-3 font-mono font-bold text-slate-600 text-xs">
                          OP-{String(op.num_op).padStart(4, '0')}
                        </td>
                        <td className="px-5 py-3 text-xs">
                          <span className="font-bold text-slate-800">
                            {op.date_op
                              ? new Date(op.date_op + 'T00:00:00').toLocaleDateString('fr-FR')
                              : '—'}
                          </span>
                          <span className="ml-2 text-slate-400">
                            {op.heure_op ? op.heure_op.slice(0, 5) : ''}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-black text-slate-900 text-right">
                          {parseFloat(op.total_dh || 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700 uppercase">
                            <CheckCircle2 className="h-3 w-3" />
                            Validé
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Zone C — Alertes */}
          <div className="lg:col-span-1 space-y-4">

            {/* Bloc 1 — Achats en attente (admin/supervisor uniquement — hidden for cashier) */}
            {profile?.roleId !== 'cashier' && (
              <>
                {!loading && pendingPurchasesCount > 0 ? (
                  <div className="bg-orange-50 border border-orange-200 rounded-2xl overflow-hidden">
                    <div className="p-4 flex items-center gap-3 border-b border-orange-100">
                      <div className="p-2 bg-orange-100 rounded-xl shrink-0">
                        <Clock className="h-4 w-4 text-orange-600" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-orange-900 uppercase tracking-wider">
                          Achats en Attente
                        </p>
                        <p className="text-2xl font-black text-orange-700 leading-tight">
                          {pendingPurchasesCount}
                        </p>
                      </div>
                    </div>
                    <div className="divide-y divide-orange-100">
                      {pendingPurchases.map((op) => (
                        <div key={op.num_op} className="px-4 py-2.5 flex items-center justify-between">
                          <div>
                            <p className="text-xs font-bold text-slate-700 font-mono">
                              OP-{String(op.num_op).padStart(4, '0')}
                            </p>
                            <p className="text-[10px] text-slate-400">{op.date_op}</p>
                          </div>
                          <span className="text-xs font-black text-orange-700">
                            {parseFloat(op.total_dh || 0).toFixed(2)} DH
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="p-3 border-t border-orange-100">
                      <Link
                        to="/history?status=en_attente"
                        className="w-full flex items-center justify-center gap-1 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-black rounded-xl transition-all"
                      >
                        Valider maintenant <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                ) : !loading ? (
                  <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                    <div>
                      <p className="text-[10px] font-black text-emerald-800 uppercase tracking-wider">
                        Achats en Attente
                      </p>
                      <p className="text-xs text-emerald-600 font-medium">Aucun achat en cours</p>
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {/* Bloc 2 — Stocks bas */}
            {!loading && lowStockCount > 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
                <div className="p-4 flex items-center gap-3 border-b border-amber-100">
                  <div className="p-2 bg-amber-100 rounded-xl shrink-0">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-amber-900 uppercase tracking-wider">
                      Stocks Bas
                    </p>
                    <p className="text-2xl font-black text-amber-700 leading-tight">
                      {lowStockCount}
                      <span className="text-sm font-bold ml-1">produit(s)</span>
                    </p>
                  </div>
                </div>
                <div className="divide-y divide-amber-100">
                  {lowStockProducts.map((p) => (
                    <div key={p.code} className="px-4 py-2.5 flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-slate-700 truncate flex-1">{p.produit}</p>
                      <span
                        className={cn(
                          'text-xs font-black px-2 py-0.5 rounded-full shrink-0',
                          p.stock_actuel <= 0
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                        )}
                      >
                        {p.stock_actuel <= 0 ? 'Rupture' : `${p.stock_actuel} / ${p.seuil_alerte ?? 10}`}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t border-amber-100">
                  <Link
                    to="/inventory?filter=low_stock"
                    className="w-full flex items-center justify-center gap-1 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-black rounded-xl transition-all"
                  >
                    Voir l&apos;inventaire <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            ) : !loading ? (
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center gap-3">
                <Package className="h-5 w-5 text-emerald-500 shrink-0" />
                <div>
                  <p className="text-[10px] font-black text-emerald-800 uppercase tracking-wider">
                    Stocks
                  </p>
                  <p className="text-xs text-emerald-600 font-medium">Tous les stocks sont OK</p>
                </div>
              </div>
            ) : null}

            {/* Bloc 3 — Créances */}
            {!loading && debtCount > 0 && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl overflow-hidden">
                <div className="p-4 flex items-center gap-3 border-b border-rose-100">
                  <div className="p-2 bg-rose-100 rounded-xl shrink-0">
                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-rose-900 uppercase tracking-wider">
                      Créances Actives
                    </p>
                    <p className="text-2xl font-black text-rose-700 leading-tight">
                      {debtTotal.toFixed(0)}
                      <span className="text-sm font-bold ml-1">DH</span>
                    </p>
                  </div>
                </div>
                <div className="px-4 py-3 flex items-center justify-between">
                  <p className="text-xs text-slate-600 font-medium">{debtCount} vente(s) partiellement réglée(s)</p>
                </div>
                <div className="p-3 border-t border-rose-100">
                  <Link
                    to="/history?filter=debt"
                    className="w-full flex items-center justify-center gap-1 py-2 bg-rose-500 hover:bg-rose-600 text-white text-xs font-black rounded-xl transition-all"
                  >
                    Voir les créances <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )}

            {/* Skeleton loading pour Zone C */}
            {loading && (
              <div className="space-y-4">
                {[1, 2].map((k) => (
                  <div key={k} className="bg-slate-100 rounded-2xl h-24 animate-pulse" />
                ))}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
