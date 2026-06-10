import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Operation, OperationItem, UserProfile } from '../types';
import { supabase } from '../supabase';
import * as XLSX from 'xlsx';
import {
  History as HistoryIcon,
  Search,
  Download,
  Eye,
  TrendingDown,
  TrendingUp,
  Printer,
  X,
  ChevronUp,
  ChevronDown,
  CornerUpLeft,
  BarChart2,
  DollarSign,
  Tag,
  Lock,
} from 'lucide-react';
import { cn } from '../lib/utils';
import OperationDetailsModal from '../components/OperationDetailsModal';
import { generateTicketPDF, TicketItem, TicketOperation } from '../utils/pdfGenerator';

interface HistoryProps {
  profile: UserProfile | null;
}

/** Opération V2 : en-tête `operations` + lignes `operation_items` */
interface HistoryOperation extends Operation {
  items: OperationItem[];
  productSummary: string;
  itemsQuantity: number;
  agentName?: string;
  clientName?: string;
  fournisseurName?: string;
  isModified?: boolean;
  version?: number;
  parentOpId?: number;
  montantPaye?: number;
  resteAPayer?: number;
}

type DbOperationItem = {
  id: number;
  operation_id: number;
  produit_id: string;
  quantite?: number | string | null;
  prix_unitaire?: number | string | null;
  total_ligne?: number | string | null;
  produits?: { produit?: string | null } | null;
};

function normalizeStatus(statut: string | null | undefined): Operation['status'] {
  if (!statut) return 'validated';
  if (statut === 'valide' || statut === 'validated') return 'validated';
  if (statut === 'en_attente') return 'en_attente';
  if (statut === 'cancelled' || statut === 'annule') return 'cancelled';
  return statut as Operation['status'];
}

function mapOperationItems(
  rawItems: DbOperationItem[] | null | undefined,
  operationId: string
): OperationItem[] {
  return (rawItems || []).map((row) => {
    const productName = row.produits?.produit?.trim() || row.produit_id;
    return {
      id: row.id.toString(),
      operationId,
      productId: row.produit_id,
      productName,
      quantity: parseFloat(String(row.quantite ?? 0)),
      unitPrice: parseFloat(String(row.prix_unitaire ?? 0)),
      lineTotal: parseFloat(String(row.total_ligne ?? 0)),
      discountAmount: 0,
    };
  });
}

function buildProductSummary(items: OperationItem[]): { productSummary: string; itemsQuantity: number } {
  const itemsQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
  if (items.length === 0) {
    return { productSummary: '—', itemsQuantity: 0 };
  }
  if (items.length === 1) {
    const line = items[0];
    const label = line.productName || line.productId;
    return {
      productSummary: `${label} × ${line.quantity}`,
      itemsQuantity,
    };
  }
  const first = items[0];
  const label = first.productName || first.productId;
  return {
    productSummary: `${label} × ${first.quantity} (+${items.length - 1} art.)`,
    itemsQuantity,
  };
}

function mapOperationRow(row: Record<string, unknown>): HistoryOperation {
  const id = String(row.num_op);
  const items = mapOperationItems(row.operation_items as DbOperationItem[] | undefined, id);
  const { productSummary, itemsQuantity } = buildProductSummary(items);
  const remise = parseFloat(String(row.remise_dh ?? 0));
  const totalDh = parseFloat(String(row.total_dh ?? 0));
  const grossFromLines = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const grossTotal = grossFromLines > 0 ? grossFromLines : totalDh + remise;

  return {
    id,
    operationNumber: `OP-${id.padStart(4, '0')}`,
    type: (row.type_op as 'vente' | 'achat' | 'retour_client' | 'retour_fournisseur') || 'vente',
    clientId: row.client_id != null ? String(row.client_id) : undefined,
    userId: String(row.utilisateur_id ?? ''),
    status: normalizeStatus(row.statut as string | undefined),
    grossTotal,
    discountAmount: remise,
    finalTotal: totalDh,
    observation: row.observ as string | undefined,
    createdAt: {
      toDate: () => new Date(`${row.date_op}T${row.heure_op || '00:00:00'}`),
    },
    validatedAt: {
      toDate: () => new Date(`${row.date_op}T${row.heure_op || '00:00:00'}`),
    },
    items,
    productSummary,
    itemsQuantity,
    agentName: row._agentName as string | undefined,
    clientName: row._clientName as string | undefined,
    fournisseurName: row._fournisseurName as string | undefined,
    isModified: row.is_modified as boolean | undefined,
    version: row.version != null ? Number(row.version) : undefined,
    parentOpId: row.parent_op_id != null ? Number(row.parent_op_id) : undefined,
    montantPaye: row.montant_paye != null ? parseFloat(String(row.montant_paye)) : undefined,
    resteAPayer: row.reste_a_payer != null ? parseFloat(String(row.reste_a_payer)) : undefined,
  };
}

function isValidatedStatus(status: Operation['status']): boolean {
  return status === 'validated' || (status as string) === 'valide';
}

type SortKey = 'num_op' | 'date' | 'type' | 'agentName' | 'finalTotal' | 'status';

export default function History({ profile }: HistoryProps) {
  const isAdmin = profile?.roleId === 'admin';
  const isCashier = profile?.roleId === 'cashier';

  // Confidentialité prix d'achat : un caissier ne voit aucun montant
  // sur les opérations achat / retour fournisseur (montants = prix d'achat)
  const isConfidentialOp = (type: string) =>
    isCashier && (type === 'achat' || type === 'retour_fournisseur');

  const [operations, setOperations] = useState<HistoryOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [selectedOperation, setSelectedOperation] = useState<HistoryOperation | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get('status');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Filtre colonne Paiement : 'all' | 'debt' | 'paid'
  // Initialisé depuis ?filter=debt (lien Dashboard "Créances actives")
  const [paiementFilter, setPaiementFilter] = useState<'all' | 'debt' | 'paid'>(
    () => (new URLSearchParams(window.location.search).get('filter') === 'debt' ? 'debt' : 'all')
  );

  // Tabs
  const [activeTab, setActiveTab] = useState<'operations' | 'mouvements' | 'prix'>('operations');

  // Mouvements de stock (tab 2)
  const [movements, setMovements] = useState<any[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);

  // Historique des prix (tab 3)
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [loadingPrix, setLoadingPrix] = useState(false);

  const fetchOperations = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setFetchError(null);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        setFetchError('Session expirée — reconnectez-vous.');
        return;
      }

      // ── 1. En-têtes d'opérations ──────────────────────────────────────────
      const { data: opsData, error: opsError } = await supabase
        .from('operations')
        .select('*')
        .order('num_op', { ascending: false })
        .limit(200);

      if (opsError) {
        setFetchError(`Erreur base de données : ${opsError.message}`);
        return;
      }

      if (!opsData?.length) {
        setOperations([]);
        return;
      }

      const opIds = opsData.map(op => op.num_op);

      // ── 2. Lignes d'articles pour ces opérations (une seule requête) ───────
      const { data: itemsData } = await supabase
        .from('operation_items')
        .select('*')
        .in('operation_id', opIds);

      const allItems = itemsData || [];

      // ── 3. Noms des produits concernés (une seule requête) ─────────────────
      const produitIds = [...new Set(allItems.map(i => i.produit_id))];
      const produitMap: Record<string, string> = {};

      if (produitIds.length > 0) {
        const { data: produitsData } = await supabase
          .from('produits')
          .select('code, produit')
          .in('code', produitIds);
        (produitsData || []).forEach(p => { produitMap[p.code] = p.produit; });
      }

      // ── 4. Regroupement des articles par opération ────────────────────────
      const itemsByOpId: Record<number, DbOperationItem[]> = {};
      allItems.forEach(item => {
        if (!itemsByOpId[item.operation_id]) itemsByOpId[item.operation_id] = [];
        itemsByOpId[item.operation_id].push({
          id: item.id,
          operation_id: item.operation_id,
          produit_id: item.produit_id,
          quantite: item.quantite,
          prix_unitaire: item.prix_unitaire,
          total_ligne: item.total_ligne,
          produits: { produit: produitMap[item.produit_id] || null },
        });
      });

      // ── 5. Noms des agents (utilisateurs) ────────────────────────────────
      const agentIds = [...new Set(opsData.map(op => op.utilisateur_id).filter(Boolean))];
      const agentMap: Record<string, string> = {};
      if (agentIds.length > 0) {
        const { data: agents } = await supabase
          .from('utilisateurs')
          .select('id, nom, username')
          .in('id', agentIds);
        (agents || []).forEach((a: any) => {
          const name = a.nom || a.username;
          if (name) agentMap[a.id] = name;
        });
      }

      // ── 6. Noms des clients ───────────────────────────────────────────────
      // PK = id_client (INTEGER), nom = nom_prenom
      const clientIds = [...new Set(opsData.map(op => op.client_id).filter(Boolean))];
      const clientMap: Record<string, string> = {};
      if (clientIds.length > 0) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id_client, nom_prenom')
          .in('id_client', clientIds);
        (clients || []).forEach((c: any) => {
          if (c.nom_prenom) clientMap[String(c.id_client)] = c.nom_prenom;
        });
      }

      // ── 7. Noms des fournisseurs ──────────────────────────────────────────
      const fournisseurIds = [...new Set(opsData.map(op => op.fournisseur_id).filter(Boolean))];
      const fournisseurMap: Record<string, string> = {};
      if (fournisseurIds.length > 0) {
        const { data: fournisseurs } = await supabase
          .from('fournisseurs')
          .select('id_fournisseur, nom')
          .in('id_fournisseur', fournisseurIds);
        (fournisseurs || []).forEach((f: any) => {
          if (f.nom) fournisseurMap[String(f.id_fournisseur)] = f.nom;
        });
      }

      // ── 8. Construction des objets HistoryOperation ───────────────────────
      const mapped = opsData.map(op =>
        mapOperationRow({
          ...op,
          operation_items: itemsByOpId[op.num_op] || [],
          _agentName: op.utilisateur_id ? (agentMap[op.utilisateur_id] ?? null) : null,
          _clientName: op.client_id ? (clientMap[String(op.client_id)] ?? null) : null,
          _fournisseurName: op.fournisseur_id ? (fournisseurMap[String(op.fournisseur_id)] ?? null) : null,
        } as Record<string, unknown>)
      );

      setOperations(mapped);
    } catch (err) {
      console.error('[History] fetchOperations — exception:', err);
      setFetchError('Erreur inattendue — vérifiez la console.');
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    fetchOperations();
  }, [profile?.id, fetchOperations]);

  const fetchMovements = useCallback(async () => {
    setLoadingMovements(true);
    try {
      const { data: opsData, error: opsErr } = await supabase
        .from('operations')
        .select('num_op, type_op, date_op, heure_op')
        .eq('statut', 'valide')
        .order('num_op', { ascending: false })
        .limit(300);
      if (opsErr) throw opsErr;
      const validOps = opsData || [];
      if (validOps.length === 0) { setMovements([]); setLoadingMovements(false); return; }
      const validOpIds = validOps.map((op: any) => op.num_op);
      const opsMap: Record<number, any> = {};
      validOps.forEach((op: any) => { opsMap[op.num_op] = op; });
      const { data: itemsData } = await supabase
        .from('operation_items').select('*').in('operation_id', validOpIds);
      const allItems = itemsData || [];
      if (allItems.length === 0) { setMovements([]); setLoadingMovements(false); return; }
      const prodIds = [...new Set(allItems.map((i: any) => i.produit_id))];
      const prodMap: Record<string, string> = {};
      const stockMap: Record<string, number> = {};
      if (prodIds.length > 0) {
        const { data: prods } = await supabase
          .from('produits').select('code, produit, stock_actuel').in('code', prodIds as string[]);
        (prods || []).forEach((p: any) => { prodMap[p.code] = p.produit; stockMap[p.code] = parseFloat(p.stock_actuel || 0); });
      }
      const sortedItems = [...allItems].sort((a: any, b: any) => b.operation_id - a.operation_id);
      setMovements(sortedItems.map((item: any) => {
        const op = opsMap[item.operation_id];
        return {
          id: item.id.toString(),
          productId: item.produit_id,
          productName: prodMap[item.produit_id] || item.produit_id || 'Produit inconnu',
          operationId: item.operation_id.toString(),
          type: op?.type_op || 'vente',
          quantity: parseFloat(item.quantite || 0),
          afterQty: stockMap[item.produit_id] ?? 0,
          createdAt: { toDate: () => new Date(`${op?.date_op ?? ''}T${op?.heure_op ?? '00:00:00'}`) },
        };
      }));
    } catch (err) {
      console.error('[History] fetchMovements:', err);
    } finally {
      setLoadingMovements(false);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id || activeTab !== 'mouvements') return;
    fetchMovements();
  }, [profile?.id, activeTab, fetchMovements]);

  const fetchPriceHistory = useCallback(async () => {
    setLoadingPrix(true);
    try {
      const { data, error } = await supabase
        .from('price_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;

      const agentIds = [...new Set((data || []).map((p: any) => p.utilisateur_id).filter(Boolean))];
      const agentMap: Record<string, string> = {};
      if (agentIds.length > 0) {
        const { data: agents } = await supabase
          .from('utilisateurs')
          .select('id, username, nom')
          .in('id', agentIds);
        (agents || []).forEach((a: any) => { agentMap[a.id] = a.nom || a.username || '—'; });
      }

      const prodCodes = [...new Set((data || []).map((p: any) => p.produit_code).filter(Boolean))];
      const prodMap: Record<string, string> = {};
      if (prodCodes.length > 0) {
        const { data: prods } = await supabase
          .from('produits')
          .select('code, produit')
          .in('code', prodCodes as string[]);
        (prods || []).forEach((p: any) => { prodMap[p.code] = p.produit; });
      }

      setPriceHistory((data || [])
        // Confidentialité : seul l'admin voit l'historique des prix d'ACHAT
        .filter((row: any) => isAdmin || (row.type_prix || 'vente') !== 'achat')
        .map((row: any) => ({
          id: row.id,
          produitCode: row.produit_code,
          produitNom: prodMap[row.produit_code] || row.produit_code || '—',
          typePrix: row.type_prix || 'vente',
          ancienPrix: parseFloat(row.ancien_prix || 0),
          nouveauPrix: parseFloat(row.nouveau_prix || 0),
          agentName: row.utilisateur_id ? (agentMap[row.utilisateur_id] || '—') : '—',
          dateModif: row.date_modif || '',
          heureModif: row.heure_modif || '',
        })));
    } catch (err) {
      console.error('[History] fetchPriceHistory:', err);
    } finally {
      setLoadingPrix(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!profile?.id || activeTab !== 'prix') return;
    fetchPriceHistory();
  }, [profile?.id, activeTab, fetchPriceHistory]);

  const handleExportXLSX = () => {
    const rows = filtered.map((op) => {
      const confidential = isConfidentialOp(op.type);
      return {
        Date: op.createdAt?.toDate?.()?.toLocaleDateString('fr-FR') ?? 'N/A',
        Heure:
          op.createdAt?.toDate?.()?.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
          }) ?? '',
        Numéro: op.operationNumber,
        Type: op.type === 'retour_client' ? 'Avoir / Retour' : op.type === 'retour_fournisseur' ? 'Retour Fournisseur' : op.type,
        Articles: op.items.length > 0
          ? op.items.map(i => `${i.productName || i.productId} (x${i.quantity})`).join(', ')
          : op.productSummary,
        'Qté totale': op.itemsQuantity,
        'Montant HT (DH)': confidential ? 'Confidentiel' : op.grossTotal.toFixed(2),
        'Remise (DH)': confidential ? 'Confidentiel' : (op.discountAmount ?? 0).toFixed(2),
        'Total Final (DH)': confidential ? 'Confidentiel' : op.finalTotal.toFixed(2),
        Statut: op.status,
        Observation: op.observation ?? '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 12 },
      { wch: 8 },
      { wch: 14 },
      { wch: 8 },
      { wch: 28 },
      { wch: 10 },
      { wch: 14 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 30 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Opérations');
    XLSX.writeFile(wb, `GharbFeed_Historique_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handlePrintTicket = async (op: HistoryOperation) => {
    setPrintingId(op.id);
    try {
      let items = op.items;

      if (items.length === 0) {
        const { data: rawItems, error: itemsErr } = await supabase
          .from('operation_items')
          .select('*')
          .eq('operation_id', parseInt(op.id, 10));

        if (itemsErr) throw itemsErr;

        const prodIds = (rawItems || []).map(i => i.produit_id);
        const localProdMap: Record<string, string> = {};
        if (prodIds.length > 0) {
          const { data: prods } = await supabase
            .from('produits')
            .select('code, produit')
            .in('code', prodIds);
          (prods || []).forEach(p => { localProdMap[p.code] = p.produit; });
        }

        items = (rawItems || []).map(row => ({
          id: row.id.toString(),
          operationId: op.id,
          productId: row.produit_id,
          productName: localProdMap[row.produit_id] || row.produit_id,
          quantity: parseFloat(String(row.quantite ?? 0)),
          unitPrice: parseFloat(String(row.prix_unitaire ?? 0)),
          lineTotal: parseFloat(String(row.total_ligne ?? 0)),
          discountAmount: 0,
        }));
      }

      const dateStr =
        op.createdAt?.toDate?.()?.toISOString().split('T')[0] ??
        new Date().toISOString().split('T')[0];
      const timeStr =
        op.createdAt?.toDate?.()?.toTimeString().split(' ')[0] ?? '00:00:00';

      const ticketItems: TicketItem[] = items.map((item) => ({
        productId: item.productId,
        productCode: item.productId,
        productName: item.productName || item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      }));

      const ticketOp: TicketOperation = {
        id: op.operationNumber,
        type: op.type as 'vente' | 'achat',
        date: dateStr,
        time: timeStr,
        cashierName: profile?.username,
        grossTotal: op.grossTotal,
        discountAmount: op.discountAmount ?? 0,
        finalTotal: op.finalTotal,
      };

      generateTicketPDF(ticketOp, ticketItems);
    } catch (err) {
      console.error('[History] handlePrintTicket:', err);
      alert('Impossible de générer le ticket. Vérifiez la connexion.');
    } finally {
      setPrintingId(null);
    }
  };

  const filtered = operations.filter((op) => {
    if (statusFilter === 'en_attente' && op.status !== 'en_attente') return false;
    // Filtre paiement : géré par l'état local (synchro URL au changement)
    if (paiementFilter === 'debt' && (op.resteAPayer ?? 0) <= 0.01) return false;
    if (paiementFilter === 'paid' && ((op.montantPaye ?? 0) <= 0 || (op.resteAPayer ?? 0) > 0.01)) return false;
    const q = search.toLowerCase();
    const matchesItems = op.items.some(
      (item) =>
        item.productId.toLowerCase().includes(q) ||
        (item.productName ?? '').toLowerCase().includes(q) ||
        String(item.quantity).includes(q)
    );
    const matchesSearch =
      op.operationNumber.toLowerCase().includes(q) ||
      (op.observation ?? '').toLowerCase().includes(q) ||
      op.productSummary.toLowerCase().includes(q) ||
      matchesItems;
    if (!dateFilter) return matchesSearch;
    const opDate = op.createdAt?.toDate?.()?.toISOString().slice(0, 10) ?? '';
    return matchesSearch && opDate === dateFilter;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ChevronUp className="h-3 w-3 opacity-25" />;
    return sortDir === 'asc'
      ? <ChevronUp className="h-3 w-3 text-emerald-500" />
      : <ChevronDown className="h-3 w-3 text-emerald-500" />;
  };

  const sortedFiltered = [...filtered].sort((a, b) => {
    if (!sortKey) return 0;
    let valA: string | number = 0;
    let valB: string | number = 0;
    if (sortKey === 'num_op') {
      valA = parseInt(a.id, 10);
      valB = parseInt(b.id, 10);
    } else if (sortKey === 'date') {
      valA = a.createdAt?.toDate?.()?.getTime() ?? 0;
      valB = b.createdAt?.toDate?.()?.getTime() ?? 0;
    } else if (sortKey === 'type') {
      valA = a.type;
      valB = b.type;
    } else if (sortKey === 'agentName') {
      valA = (a.agentName ?? '').toLowerCase();
      valB = (b.agentName ?? '').toLowerCase();
    } else if (sortKey === 'finalTotal') {
      valA = a.finalTotal;
      valB = b.finalTotal;
    } else if (sortKey === 'status') {
      valA = a.status;
      valB = b.status;
    }
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="space-y-5">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">HISTORIQUE</h2>
            <p className="text-sm text-slate-500 font-medium">
              {operations.length} opération(s) enregistrée(s)
            </p>
          </div>
          {activeTab === 'operations' && (
            <button
              onClick={handleExportXLSX}
              className="p-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl transition-all flex items-center gap-2 text-sm font-bold shadow-lg shadow-emerald-500/20"
            >
              <Download className="h-4 w-4" />
              Exporter Excel (.xlsx)
            </button>
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex bg-slate-100 p-1 w-fit rounded-xl gap-1">
          <button
            onClick={() => setActiveTab('operations')}
            className={cn('flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-lg transition-all',
              activeTab === 'operations' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            <HistoryIcon className="h-3.5 w-3.5" />
            Opérations
          </button>
          <button
            onClick={() => setActiveTab('mouvements')}
            className={cn('flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-lg transition-all',
              activeTab === 'mouvements' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            <BarChart2 className="h-3.5 w-3.5" />
            Stock
          </button>
          <button
            onClick={() => setActiveTab('prix')}
            className={cn('flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-lg transition-all',
              activeTab === 'prix' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            <Tag className="h-3.5 w-3.5" />
            Prix
          </button>
        </div>

        {activeTab === 'operations' && (
          <>
            {/* Error banner */}
            {fetchError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2">
                <span>⚠️</span>
                <span>{fetchError}</span>
                <button onClick={fetchOperations} className="ml-auto underline font-black hover:text-rose-900">
                  Réessayer
                </button>
              </div>
            )}

            {/* Status filter banner */}
            {statusFilter === 'en_attente' && (
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-orange-100 text-orange-800 rounded-xl flex items-center justify-center text-lg">⏳</div>
                  <div>
                    <p className="text-sm font-bold text-orange-900">Filtre "Achats en Attente" actif</p>
                    <p className="text-xs text-orange-700">Seuls les achats avec le statut "En attente" sont affichés.</p>
                  </div>
                </div>
                <button
                  onClick={() => setSearchParams({})}
                  className="text-xs font-bold text-orange-900 bg-orange-100 hover:bg-orange-200 px-4 py-2 rounded-xl transition-all shadow-sm border border-orange-300 cursor-pointer w-full sm:w-auto"
                >
                  Afficher toutes les opérations
                </button>
              </div>
            )}

            {/* Banners filtre paiement */}
            {paiementFilter === 'debt' && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-rose-100 text-rose-800 rounded-xl flex items-center justify-center text-lg">💳</div>
                  <div>
                    <p className="text-sm font-bold text-rose-900">Filtre "Créances Actives" actif</p>
                    <p className="text-xs text-rose-700">Seules les opérations avec un solde restant dû sont affichées.</p>
                  </div>
                </div>
                <button
                  onClick={() => { setPaiementFilter('all'); setSearchParams((prev) => { const p = new URLSearchParams(prev); p.delete('filter'); return p; }); }}
                  className="text-xs font-bold text-rose-900 bg-rose-100 hover:bg-rose-200 px-4 py-2 rounded-xl transition-all shadow-sm border border-rose-300 cursor-pointer w-full sm:w-auto"
                >
                  Afficher toutes les opérations
                </button>
              </div>
            )}
            {paiementFilter === 'paid' && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-emerald-100 text-emerald-800 rounded-xl flex items-center justify-center text-lg">✅</div>
                  <div>
                    <p className="text-sm font-bold text-emerald-900">Filtre "Paiements soldés" actif</p>
                    <p className="text-xs text-emerald-700">Seules les opérations intégralement payées sont affichées.</p>
                  </div>
                </div>
                <button
                  onClick={() => setPaiementFilter('all')}
                  className="text-xs font-bold text-emerald-900 bg-emerald-100 hover:bg-emerald-200 px-4 py-2 rounded-xl transition-all shadow-sm border border-emerald-300 cursor-pointer w-full sm:w-auto"
                >
                  Afficher toutes les opérations
                </button>
              </div>
            )}

            {/* Filters */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center gap-4">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Rechercher par numéro, produit, observation..."
                  className="w-full bg-slate-50 border-none rounded-xl py-3 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-emerald-500/20"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="date"
                  className="bg-slate-50 border-none rounded-xl py-3 px-4 text-sm font-bold text-slate-600 focus:ring-2 focus:ring-emerald-500/20 w-full sm:w-auto"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                />
                {dateFilter && (
                  <button
                    onClick={() => setDateFilter('')}
                    className="p-3 hover:bg-slate-100 rounded-xl transition-all text-slate-400 hover:text-slate-900"
                    title="Réinitialiser la date"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Operations Table */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px] cursor-pointer hover:text-slate-800 select-none" onClick={() => handleSort('date')}>
                        <span className="flex items-center gap-1">Date {sortIcon('date')}</span>
                      </th>
                      <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px] cursor-pointer hover:text-slate-800 select-none" onClick={() => handleSort('num_op')}>
                        <span className="flex items-center gap-1">N° {sortIcon('num_op')}</span>
                      </th>
                      <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px] cursor-pointer hover:text-slate-800 select-none" onClick={() => handleSort('type')}>
                        <span className="flex items-center gap-1">Type {sortIcon('type')}</span>
                      </th>
                      <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Articles</th>
                      <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px] cursor-pointer hover:text-slate-800 select-none" onClick={() => handleSort('agentName')}>
                        <span className="flex items-center gap-1">Agent {sortIcon('agentName')}</span>
                      </th>
                      <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px] cursor-pointer hover:text-slate-800 select-none" onClick={() => handleSort('finalTotal')}>
                        <span className="flex items-center gap-1">Total {sortIcon('finalTotal')}</span>
                      </th>
                      <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">
                        <div className="flex items-center gap-1.5">
                          <DollarSign className="h-3 w-3" />
                          <span>Paiement</span>
                          <select
                            value={paiementFilter}
                            onChange={(e) => {
                              const val = e.target.value as 'all' | 'debt' | 'paid';
                              setPaiementFilter(val);
                              // Sync l'URL : ?filter=debt ↔ état local
                              if (val === 'debt') {
                                setSearchParams((prev) => { const p = new URLSearchParams(prev); p.set('filter', 'debt'); return p; });
                              } else {
                                setSearchParams((prev) => { const p = new URLSearchParams(prev); p.delete('filter'); return p; });
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              'text-[9px] font-black rounded-lg border py-0.5 px-1.5 cursor-pointer outline-none transition-all',
                              paiementFilter === 'all'
                                ? 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                                : paiementFilter === 'debt'
                                ? 'bg-rose-100 text-rose-700 border-rose-300 hover:bg-rose-200'
                                : 'bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200'
                            )}
                          >
                            <option value="all">Tous</option>
                            <option value="debt">⚠ En créance</option>
                            <option value="paid">✓ Soldé</option>
                          </select>
                        </div>
                      </th>
                      <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px] cursor-pointer hover:text-slate-800 select-none" onClick={() => handleSort('status')}>
                        <span className="flex items-center gap-1">Statut {sortIcon('status')}</span>
                      </th>
                      <th className="px-4 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={9} className="px-6 py-20 text-center">
                          <div className="flex items-center justify-center gap-3 text-slate-400 font-bold">
                            <div className="h-5 w-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                            Chargement...
                          </div>
                        </td>
                      </tr>
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-6 py-20 text-center">
                          <div className="flex flex-col items-center gap-4">
                            <div className="h-20 w-20 bg-slate-50 rounded-full flex items-center justify-center text-slate-200">
                              <HistoryIcon className="h-10 w-10" />
                            </div>
                            <p className="text-slate-400 font-bold">Aucune opération trouvée</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      sortedFiltered.map((op) => (
                        <tr key={op.id} className="group hover:bg-slate-50 transition-colors">
                          {/* Date */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={cn('p-1.5 rounded-lg shrink-0',
                                op.type === 'vente' ? 'bg-emerald-50 text-emerald-600'
                                : op.type === 'retour_client' ? 'bg-purple-50 text-purple-600'
                                : op.type === 'retour_fournisseur' ? 'bg-orange-50 text-orange-600'
                                : 'bg-blue-50 text-blue-600'
                              )}>
                                {op.type === 'vente' ? <TrendingUp className="h-3.5 w-3.5" />
                                  : op.type === 'retour_client' ? <CornerUpLeft className="h-3.5 w-3.5" />
                                  : op.type === 'retour_fournisseur' ? <CornerUpLeft className="h-3.5 w-3.5" />
                                  : <TrendingDown className="h-3.5 w-3.5" />}
                              </div>
                              <div>
                                <p className="font-bold text-slate-900 text-xs">
                                  {op.createdAt?.toDate?.()?.toLocaleDateString('fr-FR') ?? '—'}
                                </p>
                                <p className="text-[10px] text-slate-400">
                                  {op.createdAt?.toDate?.()?.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) ?? ''}
                                </p>
                              </div>
                            </div>
                          </td>
                          {/* N° */}
                          <td className="px-4 py-3">
                            <span className="font-mono font-bold text-slate-600 text-xs uppercase tracking-tighter">
                              {op.operationNumber}
                            </span>
                          </td>
                          {/* Type */}
                          <td className="px-4 py-3">
                            <span className={cn('px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider',
                              op.type === 'vente' ? 'bg-emerald-100 text-emerald-700'
                              : op.type === 'retour_client' ? 'bg-purple-100 text-purple-700'
                              : op.type === 'retour_fournisseur' ? 'bg-orange-100 text-orange-700'
                              : 'bg-blue-100 text-blue-700'
                            )}>
                              {op.type === 'retour_client' ? 'Avoir'
                                : op.type === 'retour_fournisseur' ? 'Ret. Fourn.'
                                : op.type}
                            </span>
                            {op.parentOpId != null && (
                              <p className="text-[9px] text-purple-500 font-bold mt-0.5">
                                ↩ OP-{String(op.parentOpId).padStart(4, '0')}
                              </p>
                            )}
                          </td>
                          {/* Articles */}
                          <td className="px-4 py-3 text-xs text-slate-600 font-medium max-w-[120px] truncate">
                            {op.itemsQuantity > 0 && (
                              <span className="font-mono text-slate-400 text-[10px]">{op.itemsQuantity} u. — </span>
                            )}
                            {op.productSummary}
                          </td>
                          {/* Agent */}
                          <td className="px-4 py-3">
                            <p className="text-xs font-bold text-slate-700">{op.agentName || '—'}</p>
                            {(op.clientName || op.fournisseurName) && (
                              <p className="text-[10px] text-slate-400 font-medium">{op.clientName || op.fournisseurName}</p>
                            )}
                          </td>
                          {/* Total — masqué pour caissier sur achat/retour fournisseur (confidentialité) */}
                          <td className="px-4 py-3">
                            {isConfidentialOp(op.type) ? (
                              <span className="inline-flex items-center gap-1 text-slate-300" title="Montant confidentiel">
                                <Lock className="h-3 w-3" />
                                <span className="text-xs font-black">•••</span>
                              </span>
                            ) : (
                              <p className={cn('font-black text-sm',
                                op.type === 'retour_client' ? 'text-rose-600' : 'text-slate-900'
                              )}>
                                {op.type === 'retour_client' ? '−' : ''}{op.finalTotal.toFixed(2)}
                                <span className="text-[10px] text-slate-400 ml-0.5">DH</span>
                              </p>
                            )}
                          </td>
                          {/* Paiement — innovation: stacked montant_paye + dette badge */}
                          <td className="px-4 py-3">
                            {isConfidentialOp(op.type) ? (
                              <span className="text-[10px] text-slate-300">—</span>
                            ) : op.montantPaye != null ? (
                              <div className="space-y-0.5">
                                <p className="text-xs font-bold text-slate-700">
                                  {op.montantPaye.toFixed(2)} <span className="text-[9px] text-slate-400">DH</span>
                                </p>
                                {(op.resteAPayer ?? 0) > 0.01 ? (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded text-[9px] font-black uppercase">
                                    ⚠ {(op.resteAPayer ?? 0).toFixed(0)} DH dû
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[9px] font-black uppercase">
                                    ✓ Soldé
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-300">—</span>
                            )}
                          </td>
                          {/* Statut */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider w-fit',
                                isValidatedStatus(op.status) ? 'bg-emerald-500 text-white'
                                : op.status === 'en_attente' ? 'bg-orange-400 text-white'
                                : op.status === 'cancelled' ? 'bg-rose-500 text-white'
                                : 'bg-slate-300 text-slate-700'
                              )}>
                                {isValidatedStatus(op.status) ? 'Validé'
                                  : op.status === 'en_attente' ? 'En attente'
                                  : op.status === 'cancelled' ? 'Annulé'
                                  : op.status}
                              </span>
                              {op.isModified && (
                                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase w-fit bg-amber-100 text-amber-700">
                                  v{op.version ?? '?'}
                                </span>
                              )}
                            </div>
                          </td>
                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => setSelectedOperation(op)}
                                className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                                title="Détails opération"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handlePrintTicket(op)}
                                disabled={printingId === op.id || op.status === 'en_attente' || isConfidentialOp(op.type)}
                                className={cn('p-1.5 rounded-lg transition-all disabled:opacity-40',
                                  (op.status === 'en_attente' || isConfidentialOp(op.type)) ? 'text-slate-300 cursor-not-allowed'
                                  : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'
                                )}
                                title={isConfidentialOp(op.type) ? 'Ticket confidentiel (prix d\'achat)' : op.status === 'en_attente' ? 'Ticket indisponible' : 'Imprimer ticket PDF'}
                              >
                                {printingId === op.id
                                  ? <div className="h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                  : <Printer className="h-4 w-4" />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Tab 2: Mouvements de stock ── */}
        {activeTab === 'mouvements' && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Date</th>
                    <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Produit</th>
                    <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Type</th>
                    <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px] text-right">Quantité</th>
                    <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px] text-right">Stock Final</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingMovements ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-20 text-center">
                        <div className="flex items-center justify-center gap-3 text-slate-400 font-bold">
                          <div className="h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                          Chargement des mouvements...
                        </div>
                      </td>
                    </tr>
                  ) : movements.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-20 text-center text-slate-400 font-bold">
                        Aucun mouvement trouvé.
                      </td>
                    </tr>
                  ) : (
                    movements.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-3 text-xs text-slate-600 font-medium">
                          {m.createdAt?.toDate() ? m.createdAt.toDate().toLocaleString('fr-FR') : '—'}
                        </td>
                        <td className="px-6 py-3">
                          <p className="font-bold text-slate-900 text-sm">{m.productName}</p>
                          <p className="text-[10px] text-slate-400 font-mono">OP-{String(m.operationId).padStart(4,'0')}</p>
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            <div className={cn('p-1.5 rounded-md',
                              m.type === 'vente' ? 'bg-rose-50 text-rose-600'
                              : m.type === 'retour_client' ? 'bg-purple-50 text-purple-600'
                              : m.type === 'retour_fournisseur' ? 'bg-orange-50 text-orange-600'
                              : 'bg-emerald-50 text-emerald-600'
                            )}>
                              {m.type === 'vente' ? <TrendingDown className="h-3 w-3" />
                                : m.type === 'retour_client' ? <CornerUpLeft className="h-3 w-3" />
                                : m.type === 'retour_fournisseur' ? <TrendingDown className="h-3 w-3" />
                                : <TrendingUp className="h-3 w-3" />}
                            </div>
                            <span className="font-bold uppercase tracking-wider text-xs text-slate-700">
                              {m.type === 'retour_client' ? 'Avoir'
                                : m.type === 'retour_fournisseur' ? 'Ret. Fourn.'
                                : m.type}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-3 font-black text-right">
                          <span className={
                            (m.type === 'vente' || m.type === 'retour_fournisseur') ? 'text-rose-600'
                            : m.type === 'retour_client' ? 'text-purple-600'
                            : 'text-emerald-600'
                          }>
                            {(m.type === 'vente' || m.type === 'retour_fournisseur') ? '−' : '+'}
                            {m.quantity}
                          </span>
                        </td>
                        <td className="px-6 py-3 font-black text-slate-800 text-right">{m.afterQty}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tab 3: Historique des prix ── */}
        {activeTab === 'prix' && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Date</th>
                    <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Produit</th>
                    <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Agent</th>
                    <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Type Prix</th>
                    <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px] text-right">Ancien Prix</th>
                    <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px] text-right">Nouveau Prix</th>
                    <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[10px] text-right">Variation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingPrix ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-20 text-center">
                        <div className="flex items-center justify-center gap-3 text-slate-400 font-bold">
                          <div className="h-5 w-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                          Chargement des modifications de prix...
                        </div>
                      </td>
                    </tr>
                  ) : priceHistory.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-20 text-center text-slate-400 font-bold">
                        Aucune modification de prix enregistrée.
                      </td>
                    </tr>
                  ) : (
                    priceHistory.map((row) => {
                      const delta = row.nouveauPrix - row.ancienPrix;
                      const pct = row.ancienPrix > 0 ? ((delta / row.ancienPrix) * 100).toFixed(1) : '—';
                      return (
                        <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-3">
                            <p className="text-xs font-bold text-slate-900">
                              {row.dateModif ? new Date(row.dateModif).toLocaleDateString('fr-FR') : '—'}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {row.heureModif ? row.heureModif.slice(0, 5) : ''}
                            </p>
                          </td>
                          <td className="px-6 py-3">
                            <p className="font-bold text-slate-900 text-sm">{row.produitNom}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{row.produitCode}</p>
                          </td>
                          <td className="px-6 py-3 text-xs font-bold text-slate-600">
                            {row.agentName}
                          </td>
                          <td className="px-6 py-3">
                            <span className={cn(
                              'px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider',
                              row.typePrix === 'vente' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                            )}>
                              {row.typePrix === 'vente' ? 'Vente' : 'Achat'}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-right font-bold text-slate-500 text-sm">
                            {row.ancienPrix.toFixed(2)} DH
                          </td>
                          <td className="px-6 py-3 text-right font-black text-slate-900 text-sm">
                            {row.nouveauPrix.toFixed(2)} DH
                          </td>
                          <td className="px-6 py-3 text-right">
                            <span className={cn(
                              'text-xs font-black',
                              delta > 0 ? 'text-rose-600' : delta < 0 ? 'text-emerald-600' : 'text-slate-400'
                            )}>
                              {delta > 0 ? '▲' : delta < 0 ? '▼' : '='}{' '}
                              {Math.abs(delta).toFixed(2)} DH
                            </span>
                            {pct !== '—' && (
                              <p className={cn('text-[10px] font-bold', delta > 0 ? 'text-rose-400' : delta < 0 ? 'text-emerald-400' : 'text-slate-300')}>
                                {delta >= 0 ? '+' : ''}{pct}%
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {selectedOperation && (
        <OperationDetailsModal
          operation={selectedOperation}
          profile={profile}
          onClose={() => setSelectedOperation(null)}
          onUpdate={fetchOperations}
        />
      )}
    </div>
  );
}
