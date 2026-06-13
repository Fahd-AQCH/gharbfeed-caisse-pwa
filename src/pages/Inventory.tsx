import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Product, UserProfile, Category, Unit } from '../types';
import { supabase } from '../supabase';
import * as XLSX from 'xlsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { pullMasterData } from '../lib/syncService';
import { nowMaroc } from '../lib/serverTime';
import { toast, askConfirm } from '../lib/notify';
import {
  Package,
  Plus,
  Search,
  Filter,
  MoreVertical,
  ArrowUpRight,
  Edit2,
  Power,
  X,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  Download,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface InventoryProps {
  profile: UserProfile | null;
}

type InvSortKey = 'code' | 'name' | 'defaultPrice' | 'valeurStock' | 'stockActual' | 'categoryId';

export default function Inventory({ profile }: InventoryProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('filter');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories] = useState<Category[]>([
    { id: 'Matière première', name: 'Matière première' },
    { id: 'Aliment composé', name: 'Aliment composé' },
    { id: 'Additif', name: 'Additif' },
    { id: 'CMV', name: 'CMV' },
    { id: 'Bloc à lécher', name: 'Bloc à lécher' },
    { id: 'Matériel', name: 'Matériel' },
    { id: 'Produit Hygien', name: 'Produit Hygien' },
  ]);
  const [units, setUnits] = useState<Unit[]>([
    { id: 'kg', name: 'Kilogramme', symbol: 'kg' },
    { id: 'L', name: 'Litre', symbol: 'L' },
    { id: 'u', name: 'Unité', symbol: 'u' }
  ]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out' | 'ok'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [originalStockOnEdit, setOriginalStockOnEdit] = useState<number | null>(null);
  const [originalPriceOnEdit, setOriginalPriceOnEdit] = useState<number | null>(null);
  const [originalPdatOnEdit, setOriginalPdatOnEdit] = useState<number | null>(null);

  const isAdmin = profile?.roleId === 'admin';
  // Confidentialité : la valorisation du stock est une donnée financière —
  // visible UNIQUEMENT par l'admin et le trésorier, jamais par le caissier
  const canViewValuation = isAdmin || profile?.roleId === 'tresorier';

  // Raw DB rows — needed for XLSX export (qte_achat, qte_vente)
  const rawProdsRef = useRef<any[]>([]);

  const [invSortKey, setInvSortKey] = useState<InvSortKey | null>(null);
  const [invSortDir, setInvSortDir] = useState<'asc' | 'desc'>('asc');

  const [newProduct, setNewProduct] = useState({
    code: "",
    name: "",
    description: "",
    unitId: "u",
    categoryId: "Matériel",
    defaultPrice: 0,
    prixAchat: 0,
    stockActual: 0,
    seuilAlerte: 10,
    isActive: true
  });


  // Seed Dexie on first mount if empty (e.g. fresh install)
  useEffect(() => {
    db.produits.count().then(n => {
      if (n === 0) pullMasterData().catch(console.error);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  // ── Offline-first: read products from Dexie (populated by pullMasterData) ──
  const liveProds = useLiveQuery(() => db.produits.orderBy('produit').toArray(), []);

  useEffect(() => {
    if (liveProds === undefined) return; // still loading
    rawProdsRef.current = liveProds as any;
    setProducts(liveProds.map(p => ({
      id: p.code,
      code: p.code,
      name: p.produit,
      description: '',
      unitId: 'u',
      categoryId: p.categorie || 'Matériel',
      defaultPrice: p.prix_vente,
      purchasePrice: p.pdat ?? 0,
      stockActual: p.stock_actuel,
      seuilAlerte: p.seuil_alerte ?? 10,
      isActive: p.is_active !== false,
    })));
    setLoading(false);
  }, [liveProds]);

  // fetchData: used after writes (add/edit/delete) to sync Supabase → Dexie → UI
  const fetchData = async () => {
    setLoading(true);
    await pullMasterData(); // Dexie update triggers useLiveQuery re-render above
  };

  const logStockAudit = async (productCode: string, oldStock: number, newStock: number) => {
    const entry = {
      action: 'stock_initial_edit',
      product_code: productCode,
      old_stock: oldStock,
      new_stock: newStock,
      user_id: profile?.id,
      role: profile?.roleId,
      at: new Date().toISOString(),
    };
    console.info('[Inventory] audit', entry);
    try {
      await supabase.from('audit_log').insert(entry);
    } catch {
      // Table optionnelle — restriction admin reste active côté UI
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingProductId) {
        const stockChanged =
          originalStockOnEdit !== null && newProduct.stockActual !== originalStockOnEdit;
        if (stockChanged && !isAdmin) {
          toast.warning('Seul un administrateur peut modifier le stock initial.');
          return;
        }
        if (stockChanged && isAdmin && originalStockOnEdit !== null) {
          await logStockAudit(editingProductId, originalStockOnEdit, newProduct.stockActual);
        }
        const updatePayload: Record<string, unknown> = {
          code: newProduct.code,
          produit: newProduct.name,
          description: newProduct.description,
          prix_vente: newProduct.defaultPrice,
          valeur_stock: newProduct.stockActual * newProduct.defaultPrice,
          seuil_alerte: newProduct.seuilAlerte,
          categorie: newProduct.categoryId,
        };
        if (isAdmin) {
          updatePayload.stock_actuel = newProduct.stockActual;
          updatePayload.stock_initial = newProduct.stockActual;
          updatePayload.pdat = newProduct.prixAchat;
        }
        const { error } = await supabase
          .from('produits')
          .update(updatePayload)
          .eq('code', editingProductId);
        if (error) throw error;

        // ── Log price changes to price_history ────────────────────────────────
        if (isAdmin) {
          const { date: todayStr, heure: timeStr } = nowMaroc();
          const changes: { typePrix: string; ancienPrix: number; nouveauPrix: number }[] = [];
          if (originalPriceOnEdit !== null && Math.abs(newProduct.defaultPrice - originalPriceOnEdit) > 0.001) {
            changes.push({ typePrix: 'vente', ancienPrix: originalPriceOnEdit, nouveauPrix: newProduct.defaultPrice });
          }
          if (originalPdatOnEdit !== null && Math.abs(newProduct.prixAchat - originalPdatOnEdit) > 0.001) {
            changes.push({ typePrix: 'achat', ancienPrix: originalPdatOnEdit, nouveauPrix: newProduct.prixAchat });
          }
          for (const ch of changes) {
            supabase.from('price_history').insert({
              produit_code: editingProductId,
              produit_nom: newProduct.name,
              type_prix: ch.typePrix,
              ancien_prix: ch.ancienPrix,
              nouveau_prix: ch.nouveauPrix,
              utilisateur_id: profile?.id,
              date_modif: todayStr,
              heure_modif: timeStr,
            }).then(({ error: phErr }) => { if (phErr) console.error('[price_history]', phErr); });
          }
        }
      } else {
        const { error } = await supabase
          .from('produits')
          .insert({
            code: newProduct.code,
            produit: newProduct.name,
            description: newProduct.description,
            prix_vente: newProduct.defaultPrice,
            stock_initial: newProduct.stockActual,
            stock_actuel: newProduct.stockActual,
            qte_achat: 0,
            qte_vente: 0,
            pdat: newProduct.prixAchat,
            valeur_stock: newProduct.stockActual * newProduct.defaultPrice,
            seuil_alerte: newProduct.seuilAlerte,
            categorie: newProduct.categoryId,
          });
        if (error) throw error;
      }
      setShowAddModal(false);
      setEditingProductId(null);
      setOriginalStockOnEdit(null);
      setOriginalPriceOnEdit(null);
      setOriginalPdatOnEdit(null);
      fetchData();
      setNewProduct({
        code: "", name: "", description: "", unitId: "u", categoryId: "Matériel", defaultPrice: 0, prixAchat: 0, stockActual: 0, seuilAlerte: 10, isActive: true
      });
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de l'enregistrement du produit : " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleEditClick = (product: Product) => {
    setEditingProductId(product.code);
    setOriginalStockOnEdit(product.stockActual);
    setOriginalPriceOnEdit(product.defaultPrice);
    setOriginalPdatOnEdit((product as any).purchasePrice ?? 0);
    setNewProduct({
      code: product.code,
      name: product.name,
      description: product.description || '',
      unitId: product.unitId || 'u',
      categoryId: product.categoryId || 'Matériel',
      defaultPrice: product.defaultPrice,
      prixAchat: (product as any).purchasePrice ?? 0,
      stockActual: product.stockActual,
      seuilAlerte: product.seuilAlerte ?? 10,
      isActive: product.isActive
    });
    setShowAddModal(true);
  };

  const handleToggleActive = async (product: Product) => {
    const newState = !product.isActive;
    const label = newState ? 'Réactiver' : 'Désactiver';
    const ok = await askConfirm({
      title: `${label} « ${product.name} » ?`,
      message: newState
        ? 'Le produit réapparaîtra dans le catalogue et la caisse.'
        : 'Le produit sera masqué du catalogue et de la caisse (historique conservé).',
      confirmLabel: label,
      danger: !newState,
    });
    if (!ok) return;
    try {
      const { error } = await supabase
        .from('produits')
        .update({ is_active: newState })
        .eq('code', product.code);
      if (error) throw error;
      toast.success(`Produit « ${product.name} » ${newState ? 'réactivé' : 'désactivé'}.`);
      fetchData();
    } catch (err) {
      console.error(err);
      toast.error('Erreur : ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const filteredProducts = products.filter(p => {
    // Cashiers only see active products
    if (!isAdmin && p.isActive === false) return false;

    const searchLower = search.toLowerCase();
    const matchesName = p.name.toLowerCase().includes(searchLower);
    const matchesCodeStrict = p.code.toLowerCase().includes(searchLower);
    
    // Tolerant code search: extract digits and remove leading zeros
    const normProduct = p.code.replace(/\D/g, '').replace(/^0+/, '') || '0';
    const normSearch = search.replace(/\D/g, '').replace(/^0+/, '');
    const matchesCodeTolerant = normSearch ? normProduct.includes(normSearch) : false;
    
    const matchesSearch = matchesName || matchesCodeStrict || matchesCodeTolerant;
    
    const effectiveStockFilter =
      filter === 'low_stock' ? 'low' : stockFilter;

    if (categoryFilter && p.categoryId !== categoryFilter) {
      return false;
    }

    const seuil = p.seuilAlerte ?? 10;
    if (effectiveStockFilter === 'low') {
      return matchesSearch && p.stockActual > 0 && p.stockActual <= seuil;
    }
    if (effectiveStockFilter === 'out') {
      return matchesSearch && p.stockActual <= 0;
    }
    if (effectiveStockFilter === 'ok') {
      return matchesSearch && p.stockActual > seuil;
    }
    return matchesSearch;
  });

  const handleInvSort = (key: InvSortKey) => {
    if (invSortKey === key) {
      if (invSortDir === 'asc') setInvSortDir('desc');
      else { setInvSortKey(null); setInvSortDir('asc'); }
    } else {
      setInvSortKey(key);
      setInvSortDir('asc');
    }
  };

  const invSortIcon = (key: InvSortKey) => {
    if (invSortKey !== key) return <ChevronUp className="h-3 w-3 opacity-25" />;
    return invSortDir === 'asc'
      ? <ChevronUp className="h-3 w-3 text-emerald-500" />
      : <ChevronDown className="h-3 w-3 text-emerald-500" />;
  };

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (!invSortKey) return 0;
    let valA: string | number = 0;
    let valB: string | number = 0;
    if (invSortKey === 'code') { valA = a.code; valB = b.code; }
    else if (invSortKey === 'name') { valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); }
    else if (invSortKey === 'defaultPrice') { valA = a.defaultPrice; valB = b.defaultPrice; }
    else if (invSortKey === 'valeurStock') { valA = a.stockActual * a.defaultPrice; valB = b.stockActual * b.defaultPrice; }
    else if (invSortKey === 'stockActual') { valA = a.stockActual; valB = b.stockActual; }
    else if (invSortKey === 'categoryId') { valA = (a.categoryId || '').toLowerCase(); valB = (b.categoryId || '').toLowerCase(); }
    if (valA < valB) return invSortDir === 'asc' ? -1 : 1;
    if (valA > valB) return invSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const handleExportStock = () => {
    const rows = sortedProducts.map(p => {
      const raw = rawProdsRef.current.find(r => r.code === p.code);
      const base: Record<string, string | number> = {
        'Code': p.code,
        'Produit': p.name,
        'Catégorie': p.categoryId || '—',
        'Prix Vente (DH)': p.defaultPrice.toFixed(2),
      };
      // Confidentialité : le prix d'achat n'est exporté que pour l'admin
      if (isAdmin) base['Prix Achat (DH)'] = ((raw?.pdat) ?? 0).toFixed(2);
      base['Qté Achetée'] = parseFloat(raw?.qte_achat ?? 0);
      base['Qté Vendue'] = parseFloat(raw?.qte_vente ?? 0);
      base['Stock Disponible'] = p.stockActual;
      // Confidentialité : valorisation réservée admin & trésorier (comme la colonne)
      if (canViewValuation) base['Valeur Stock (DH)'] = (p.stockActual * p.defaultPrice).toFixed(2);
      base['Seuil Alerte'] = p.seuilAlerte ?? 10;
      return base;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 10 }, { wch: 30 }, { wch: 18 }, { wch: 14 },
      ...(isAdmin ? [{ wch: 14 }] : []),
      { wch: 13 }, { wch: 13 }, { wch: 16 },
      ...(canViewValuation ? [{ wch: 16 }] : []),
      { wch: 13 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'État du Stock');
    XLSX.writeFile(wb, `GharbFeed_Stock_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="h-full overflow-y-auto p-8">
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">ÉTAT DU STOCK</h2>
          <p className="text-sm text-slate-500 font-medium">Catalogue produits, stocks et seuils d'alerte.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportStock}
            className="flex items-center gap-2 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 px-4 py-3 rounded-2xl transition-all"
          >
            <Download className="h-4 w-4" />
            Exporter Excel
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-6 rounded-2xl flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all"
            >
              <Plus className="h-5 w-5" />
              Nouveau Produit
            </button>
          )}
        </div>
      </div>

      <>
          {filter === 'low_stock' && (
            <div className="bg-amber-50 border border-amber-250 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-4 duration-300 mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-amber-100 text-amber-800 rounded-xl flex items-center justify-center font-black">
                  ⚠️
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-900">Filtre "Stock Faible" actif</p>
                  <p className="text-xs text-amber-700">Seuls les produits avec un stock actuel inférieur ou égal à 10 sont affichés.</p>
                </div>
              </div>
              <button 
                onClick={() => setSearchParams({})}
                className="text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 px-4 py-2 rounded-xl transition-all shadow-sm border border-amber-300 cursor-pointer w-full sm:w-auto"
              >
                Afficher tous les produits
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Rechercher par nom, code ou catégorie..." 
                className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-emerald-500/10 transition-all"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={cn(
                'px-4 py-2 bg-white border border-slate-200 rounded-xl flex items-center gap-2 text-sm font-bold transition-all',
                showFilters ? 'text-emerald-600 border-emerald-200' : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              <Filter className="h-4 w-4" />
              Filtres
            </button>
          </div>

          {showFilters && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 shadow-sm">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  Catégorie
                </label>
                <select
                  className="w-full bg-slate-50 border-none rounded-xl py-2.5 px-3 text-sm font-bold"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="">Toutes</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  Statut stock
                </label>
                <select
                  className="w-full bg-slate-50 border-none rounded-xl py-2.5 px-3 text-sm font-bold"
                  value={filter === 'low_stock' ? 'low' : stockFilter}
                  onChange={(e) => {
                    const v = e.target.value as 'all' | 'low' | 'out' | 'ok';
                    setStockFilter(v);
                    if (filter === 'low_stock') setSearchParams({});
                  }}
                >
                  <option value="all">Tous</option>
                  <option value="low">Stock faible (≤10)</option>
                  <option value="out">Rupture (0)</option>
                  <option value="ok">Stock OK (&gt;10)</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('');
                  setStockFilter('all');
                  setSearchParams({});
                }}
                className="self-end px-4 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200"
              >
                Réinitialiser
              </button>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4 cursor-pointer hover:text-slate-800 select-none" onClick={() => handleInvSort('code')}>
                      <span className="flex items-center gap-1">Code {invSortIcon('code')}</span>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:text-slate-800 select-none" onClick={() => handleInvSort('name')}>
                      <span className="flex items-center gap-1">Nom {invSortIcon('name')}</span>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:text-slate-800 select-none" onClick={() => handleInvSort('defaultPrice')}>
                      <span className="flex items-center gap-1">Prix {invSortIcon('defaultPrice')}</span>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:text-slate-800 select-none" onClick={() => handleInvSort('categoryId')}>
                      <span className="flex items-center gap-1">Catégorie {invSortIcon('categoryId')}</span>
                    </th>
                    {canViewValuation && (
                      <th className="px-6 py-4 cursor-pointer hover:text-slate-800 select-none" onClick={() => handleInvSort('valeurStock')}>
                        <span className="flex items-center gap-1">Valeur Stock {invSortIcon('valeurStock')}</span>
                      </th>
                    )}
                    <th className="px-6 py-4 cursor-pointer hover:text-slate-800 select-none" onClick={() => handleInvSort('stockActual')}>
                      <span className="flex items-center gap-1">Stock {invSortIcon('stockActual')}</span>
                    </th>
                    <th className="px-6 py-4">Statut</th>
                    <th className="px-6 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-slate-50">
                  {sortedProducts.map((p) => (
                    <tr key={p.id} className={cn('hover:bg-slate-50/50 transition-colors', !p.isActive && 'opacity-50')}>
                      {/* Code */}
                      <td className="px-6 py-4">
                        <span className="font-mono font-bold text-slate-500 text-xs bg-slate-100 px-2 py-1 rounded-lg">
                          {p.code}
                        </span>
                      </td>
                      {/* Nom */}
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="h-9 w-9 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600 font-bold border border-emerald-100 shrink-0 text-sm">
                            {p.name[0]?.toUpperCase()}
                          </div>
                          <p className="font-semibold text-slate-900">{p.name}</p>
                        </div>
                      </td>
                      {/* Prix */}
                      <td className="px-6 py-4 font-bold text-slate-900">
                        {p.defaultPrice.toFixed(2)} DH
                      </td>
                      {/* Catégorie */}
                      <td className="px-6 py-4">
                        <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded-lg whitespace-nowrap">
                          {p.categoryId || '—'}
                        </span>
                      </td>
                      {/* Valeur Stock — donnée financière : admin & trésorier uniquement */}
                      {canViewValuation && (
                        <td className="px-6 py-4 font-bold text-emerald-700">
                          {(p.stockActual * p.defaultPrice).toFixed(2)} DH
                        </td>
                      )}
                      {/* Stock — quantité + jauge visuelle vs seuil d'alerte */}
                      <td className="px-6 py-4 text-slate-700">
                        {(() => {
                          const seuil = Math.max(1, p.seuilAlerte ?? 10);
                          // Jauge pleine à 2× le seuil = zone confortable ; le seuil = 50 %
                          const pct = Math.max(0, Math.min(100, (p.stockActual / (seuil * 2)) * 100));
                          const tone = p.stockActual <= 0 ? 'rose' : p.stockActual <= seuil ? 'amber' : 'emerald';
                          return (
                            <div className="min-w-[120px]">
                              <div className="flex items-baseline gap-1.5">
                                <span className={cn(
                                  'font-bold',
                                  tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-800'
                                )}>
                                  {p.stockActual}
                                </span>
                                <span className="text-slate-400 text-xs">{units.find(u => u.id === p.unitId)?.symbol}</span>
                                <span className="ml-auto text-[10px] text-slate-300 font-medium">seuil {seuil}</span>
                              </div>
                              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                                <div
                                  className={cn(
                                    'h-full rounded-full transition-all',
                                    tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-400' : 'bg-emerald-500'
                                  )}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      {/* Statut — badge dynamique de disponibilité */}
                      <td className="px-6 py-4">
                        {!p.isActive ? (
                          <span className="px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500">
                            Inactif
                          </span>
                        ) : p.stockActual <= 0 ? (
                          <span className="px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-rose-100 text-rose-700 whitespace-nowrap">
                            Rupture de Stock
                          </span>
                        ) : p.stockActual <= (p.seuilAlerte ?? 10) ? (
                          <span className="px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-700 whitespace-nowrap">
                            Alerte de Stock
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700">
                            Disponible
                          </span>
                        )}
                      </td>
                      {/* Actions */}
                      <td className="px-6 py-4">
                        {isAdmin ? (
                          <div className="flex items-center space-x-1">
                            <button
                              onClick={() => handleEditClick(p)}
                              className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                              title="Modifier"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleToggleActive(p)}
                              className={cn('p-2 rounded-lg transition-all',
                                p.isActive
                                  ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                                  : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                              )}
                              title={p.isActive ? 'Désactiver le produit' : 'Réactiver le produit'}
                            >
                              <Power className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-300 font-medium">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
      </>

      {/* Add Product Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowAddModal(false);
                setEditingProductId(null);
              }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-[32px] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div>
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                    {editingProductId ? 'Modifier le produit' : 'Ajouter un produit'}
                  </h3>
                  <p className="text-sm text-slate-500 font-medium text-emerald-600">
                    {editingProductId ? 'Modifiez les informations du produit.' : 'Complétez les informations pour créer une nouvelle référence.'}
                  </p>
                </div>
                <button onClick={() => {
                  setShowAddModal(false);
                  setEditingProductId(null);
                }} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-900">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleSaveProduct} className="p-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Code Barre / Réf</label>
                    <input 
                      required
                      type="text" 
                      className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                      value={newProduct.code}
                      onChange={(e) => setNewProduct({...newProduct, code: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Nom du produit</label>
                    <input 
                      required
                      type="text" 
                      className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                      value={newProduct.name}
                      onChange={(e) => setNewProduct({...newProduct, name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Catégorie</label>
                    <select 
                      required
                      className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                      value={newProduct.categoryId}
                      onChange={(e) => setNewProduct({...newProduct, categoryId: e.target.value})}
                    >
                      <option value="">Sélectionner...</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Unité</label>
                    <select 
                      required
                      className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                      value={newProduct.unitId}
                      onChange={(e) => setNewProduct({...newProduct, unitId: e.target.value})}
                    >
                      <option value="">Sélectionner...</option>
                      {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Prix de vente (DH)</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20 text-emerald-600"
                      value={newProduct.defaultPrice}
                      onChange={(e) => setNewProduct({...newProduct, defaultPrice: Number(e.target.value)})}
                    />
                  </div>
                  {isAdmin && (
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Prix d'achat (DH)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 text-blue-600"
                        value={newProduct.prixAchat}
                        onChange={(e) => setNewProduct({...newProduct, prixAchat: Number(e.target.value)})}
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">
                      Stock actuel
                      {editingProductId && !isAdmin && (
                        <span className="ml-2 text-amber-600 normal-case">(admin uniquement)</span>
                      )}
                    </label>
                    <input
                      required
                      type="number"
                      disabled={!!editingProductId && !isAdmin}
                      className={cn(
                        'w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20',
                        editingProductId && !isAdmin && 'opacity-60 cursor-not-allowed'
                      )}
                      value={newProduct.stockActual}
                      onChange={(e) =>
                        setNewProduct({ ...newProduct, stockActual: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">
                      Seuil d&apos;alerte stock
                    </label>
                    <input
                      required
                      type="number"
                      min="0"
                      className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-amber-500/20 text-amber-700"
                      value={newProduct.seuilAlerte}
                      onChange={(e) =>
                        setNewProduct({ ...newProduct, seuilAlerte: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
                
                <div className="pt-6 border-t border-slate-200 flex items-center justify-end gap-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-6 py-3 bg-white text-slate-500 font-bold rounded-2xl hover:bg-slate-50 transition-all"
                  >
                    Annuler
                  </button>
                  <button 
                    type="submit"
                    className="px-10 py-3 bg-slate-900 text-white font-black rounded-2xl hover:bg-slate-800 shadow-xl shadow-slate-900/20 transition-all flex items-center gap-2"
                  >
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    ENREGISTRER LE PRODUIT
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </div>
  );
}
