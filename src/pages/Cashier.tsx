import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UserProfile, Product, Client } from '../types';
import { supabase } from '../supabase';
import { generateTicketPDF, TicketItem, TicketOperation } from '../utils/pdfGenerator';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { commitOperation, syncAll, enqueueMasterRecord } from '../lib/syncService';
import { nowMaroc } from '../lib/serverTime';
import { toast } from '../lib/notify';

// B13a (règle stricte) : « Client Comptoir » est un CHOIX explicite, plus un défaut
const COMPTOIR_ID = 'comptoir';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  UserPlus,
  Ticket,
  Calculator,
  ShoppingCart,
  CheckCircle2,
  XCircle,
  CornerUpLeft,
  ArrowLeft,
  Package,
  Loader2,
  Truck,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface CashierProps {
  profile: UserProfile | null;
}

interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discountAmount: number;
}

interface ReturnItem {
  itemId: number;
  productId: string;
  productName: string;
  maxQty: number;
  returnQty: number;
  unitPrice: number;
}

export default function Cashier({ profile }: CashierProps) {
  // ── Offline-first reads via Dexie useLiveQuery ──────────────────────────────
  const liveProds  = useLiveQuery(() => db.produits.orderBy('produit').toArray(),  []);
  const liveClients = useLiveQuery(() => db.clients.orderBy('nom_prenom').toArray(), []);
  const liveFourns  = useLiveQuery(() => db.fournisseurs.orderBy('nom').toArray(),  []);

  const products: Product[] = (liveProds ?? []).map((p) => ({
    id:            p.code,
    code:          p.code,
    name:          p.produit,
    description:   undefined,
    unitId:        'u',
    categoryId:    p.categorie || 'Matériel',
    defaultPrice:  p.prix_vente,
    purchasePrice: p.pdat ?? 0,
    stockActual:   p.stock_actuel,
    seuilAlerte:   p.seuil_alerte ?? 10,
    isActive:      p.is_active !== false,
  }));

  const clients: Client[] = (liveClients ?? [])
    .filter((c) => c.actif !== false) // clients désactivés exclus de la caisse
    .map((c) => ({
      id:        String(c.id_client),
      name:      c.nom_prenom,
      phone:     c.num_telephone ?? '',
      address:   '',
      function:  c.fonction ?? '',
      createdAt: new Date() as any,
      updatedAt: new Date() as any,
    }));

  const fournisseurs: any[] = (liveFourns ?? []).map((f) => ({
    id_fournisseur: f.id_fournisseur,
    nom:            f.nom,
    type:           f.type ?? 'Personne physique',
    num_telephone:  f.num_telephone ?? '',
  }));

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountGlobal, setDiscountGlobal] = useState(0);
  const [operationType, setOperationType] = useState<'vente' | 'achat'>('vente');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const isAdmin = profile?.roleId === 'admin';

  // Canal de vente (omnichannel)
  const [canalVente, setCanalVente] = useState<string>('Sur place');

  // Conditions de paiement
  const [conditionPaiement, setConditionPaiement] = useState<'Espèce' | 'Chèque' | 'Versement'>('Espèce');
  const [refPaiement, setRefPaiement] = useState('');
  const [montantPaye, setMontantPaye] = useState('');
  const [dateEcheance, setDateEcheance] = useState('');
  const [dateVersement, setDateVersement] = useState('');

  // Chèque details
  const [banqueCheque, setBanqueCheque] = useState('');
  const [proprietaireCheque, setProprietaireCheque] = useState('');
  const [dateEncaissementCheque, setDateEncaissementCheque] = useState('');

  // Fournisseurs (mode achat)
  const [selectedFournisseur, setSelectedFournisseur] = useState<any | null>(null);
  const [showQuickFournisseur, setShowQuickFournisseur] = useState(false);
  const [quickFournisseurType, setQuickFournisseurType] = useState<'Société' | 'Personne physique'>('Personne physique');
  const [quickFournisseurNom, setQuickFournisseurNom] = useState('');
  const [quickFournisseurTel, setQuickFournisseurTel] = useState('');
  const [quickFournisseurAdresse, setQuickFournisseurAdresse] = useState('');
  const [quickFournisseurIrc, setQuickFournisseurIrc] = useState('');
  const [quickFournisseurIce, setQuickFournisseurIce] = useState('');
  const [quickFournisseurCin, setQuickFournisseurCin] = useState('');
  const [quickFournisseurLoading, setQuickFournisseurLoading] = useState(false);

  // Return modal states
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnSearch, setReturnSearch] = useState('');
  const [returnSearchResults, setReturnSearchResults] = useState<any[]>([]);
  const [returnSearchLoading, setReturnSearchLoading] = useState(false);
  const [selectedReturnOp, setSelectedReturnOp] = useState<any | null>(null);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [creatingReturn, setCreatingReturn] = useState(false);

  // Checkout modal
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);

  // Quick client creation modal
  const [showQuickClient, setShowQuickClient] = useState(false);
  const [quickClientName, setQuickClientName] = useState('');
  const [quickClientPhone, setQuickClientPhone] = useState('');
  const [quickClientAddress, setQuickClientAddress] = useState('');
  const [quickClientFonction, setQuickClientFonction] = useState('');
  const [quickClientLoading, setQuickClientLoading] = useState(false);

  // ── Création rapide d'un client depuis la caisse ───────────────────────
  // HOTFIX offline : hors-ligne (ou réseau menteur), le client est créé
  // LOCALEMENT avec un id temporaire NÉGATIF + mis en file prioritaire.
  // Le push le synchronise AVANT les ventes qui le référencent (graphe FK).
  const handleCreateQuickClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickClientName.trim()) return;
    setQuickClientLoading(true);

    const record = {
      nom_prenom: quickClientName.trim(),
      num_telephone: quickClientPhone.trim() || null,
      adresse: quickClientAddress.trim() || null,
      fonction: quickClientFonction || null,
    };

    const resetForm = () => {
      setQuickClientName('');
      setQuickClientPhone('');
      setQuickClientAddress('');
      setQuickClientFonction('');
      setShowQuickClient(false);
    };

    const selectClient = (id: number) => {
      setSelectedClient({
        id: String(id),
        name: record.nom_prenom,
        phone: record.num_telephone || '',
        address: record.adresse || '',
        function: record.fonction || '',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Client);
    };

    const createLocally = async () => {
      const tempId = -Date.now(); // négatif → jamais en collision avec un serial Postgres
      await db.clients.put({ id_client: tempId, nom_prenom: record.nom_prenom, num_telephone: record.num_telephone, fonction: record.fonction, actif: true });
      await enqueueMasterRecord('client', tempId, record);
      selectClient(tempId);
      resetForm();
      toast.info(`Client « ${record.nom_prenom} » créé localement — synchronisé au retour du réseau.`);
    };

    try {
      if (!navigator.onLine) {
        await createLocally();
        return;
      }
      const { data, error } = await supabase
        .from('clients')
        .insert(record)
        .select()
        .single();
      if (error) throw error;
      // Also add to Dexie so useLiveQuery picks it up immediately
      await db.clients.put({ id_client: data.id_client, nom_prenom: data.nom_prenom, num_telephone: data.num_telephone ?? null, fonction: data.fonction ?? null, actif: true });
      selectClient(data.id_client);
      resetForm();
    } catch (err: any) {
      // navigator.onLine mentait → bascule en création locale au lieu de bloquer la vente
      if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(err.message || '')) {
        await createLocally();
      } else {
        toast.error('Erreur création client : ' + (err.message || String(err)));
      }
    } finally {
      setQuickClientLoading(false);
    }
  };

  // ── Création rapide d'un fournisseur depuis la caisse ───────────────────
  // HOTFIX offline : même mécanique que les clients (id temporaire négatif
  // + file prioritaire, synchronisé avant les achats qui le référencent).
  const handleCreateQuickFournisseur = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickFournisseurNom.trim()) return;
    setQuickFournisseurLoading(true);

    const record = {
      type: quickFournisseurType,
      nom: quickFournisseurNom.trim(),
      num_telephone: quickFournisseurTel.trim() || null,
      adresse: quickFournisseurAdresse.trim() || null,
      irc: quickFournisseurIrc.trim() || null,
      ice: quickFournisseurIce.trim() || null,
      cin: quickFournisseurCin.trim() || null,
    };

    const resetForm = () => {
      setQuickFournisseurNom('');
      setQuickFournisseurTel('');
      setQuickFournisseurAdresse('');
      setQuickFournisseurIrc('');
      setQuickFournisseurIce('');
      setQuickFournisseurCin('');
      setQuickFournisseurType('Personne physique');
      setShowQuickFournisseur(false);
    };

    const createLocally = async () => {
      const tempId = -Date.now();
      await db.fournisseurs.put({ id_fournisseur: tempId, nom: record.nom, type: record.type, num_telephone: record.num_telephone });
      await enqueueMasterRecord('fournisseur', tempId, record);
      setSelectedFournisseur({ id_fournisseur: tempId, nom: record.nom, type: record.type, num_telephone: record.num_telephone });
      resetForm();
      toast.info(`Fournisseur « ${record.nom} » créé localement — synchronisé au retour du réseau.`);
    };

    try {
      if (!navigator.onLine) {
        await createLocally();
        return;
      }
      const { data, error } = await supabase
        .from('fournisseurs')
        .insert(record)
        .select()
        .single();
      if (error) throw error;
      // Also add to Dexie so useLiveQuery picks it up immediately
      await db.fournisseurs.put({ id_fournisseur: data.id_fournisseur, nom: data.nom, type: data.type ?? null, num_telephone: data.num_telephone ?? null });
      setSelectedFournisseur(data);
      resetForm();
    } catch (err: any) {
      if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(err.message || '')) {
        await createLocally();
      } else {
        toast.error('Erreur création fournisseur : ' + (err.message || String(err)));
      }
    } finally {
      setQuickFournisseurLoading(false);
    }
  };

  // Recherche intelligente : code prioritaire (exact > préfixe > contient) puis nom
  const filteredProducts = (() => {
    // Inactive products are never shown in the cashier view (for any role)
    const activeProducts = products.filter((p) => p.isActive !== false);
    if (!search.trim()) return activeProducts;
    const q = search.toLowerCase().trim();
    const normQ = q.replace(/\D/g, '').replace(/^0+/, '');
    return activeProducts
      .map((p) => {
        const code = p.code.toLowerCase();
        const normCode = p.code.replace(/\D/g, '').replace(/^0+/, '') || '0';
        const name = p.name.toLowerCase();
        if (code === q || (normQ && normCode === normQ)) return { p, score: 0 };
        if (code.startsWith(q) || (normQ && normCode.startsWith(normQ))) return { p, score: 1 };
        if (code.includes(q) || (normQ && normCode.includes(normQ))) return { p, score: 2 };
        if (name.includes(q)) return { p, score: 3 };
        return { p, score: -1 };
      })
      .filter(({ score }) => score >= 0)
      .sort((a, b) => a.score - b.score)
      .map(({ p }) => p);
  })();

  // U2 — quantités DÉCIMALES (vente en vrac : 12,5 kg) · B13b — stock jamais négatif
  const roundQty = (n: number) => Math.round(n * 100) / 100;
  const roundMoney = (n: number) => Math.round(n * 100) / 100;
  const stockOf = (productId: string): number => {
    const p = products.find((x) => x.id === productId);
    return p ? p.stockActual : Number.POSITIVE_INFINITY;
  };

  /** Borne une quantité : ≥ 0.01, 2 décimales, et ≤ stock disponible en mode vente. */
  const clampQty = (productId: string, qty: number): number => {
    let q = Math.max(0.01, roundQty(qty));
    if (operationType === 'vente') {
      const max = stockOf(productId);
      if (q > max + 1e-9) {
        toast.warning(`Stock insuffisant : maximum ${max} disponible pour cet article.`);
        q = Math.max(0.01, roundQty(max));
      }
    }
    return q;
  };

  const addToCart = (product: Product) => {
    const priceToUse =
      operationType === 'vente'
        ? product.defaultPrice
        : (product as any).purchasePrice || 0;
    const existing = cart.find((item) => item.productId === product.id);

    // B13b : blocage strict du stock négatif à la vente
    if (operationType === 'vente') {
      if (product.stockActual <= 0) {
        toast.error(`Stock épuisé : « ${product.name} » (0 en stock).`);
        return;
      }
      const wanted = (existing?.quantity ?? 0) + 1;
      if (wanted > product.stockActual + 1e-9) {
        toast.warning(`Stock insuffisant : il ne reste que ${product.stockActual} « ${product.name} ».`);
        return;
      }
    }

    if (existing) {
      setCart(
        cart.map((item) =>
          item.productId === product.id
            ? {
                ...item,
                quantity: roundQty(item.quantity + 1),
                lineTotal: roundMoney(roundQty(item.quantity + 1) * priceToUse),
              }
            : item
        )
      );
    } else {
      setCart([
        ...cart,
        {
          productId: product.id,
          name: product.name,
          quantity: 1,
          unitPrice: priceToUse,
          lineTotal: priceToUse,
          discountAmount: 0,
        },
      ]);
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(
      cart.map((item) => {
        if (item.productId === productId) {
          const newQty = clampQty(productId, item.quantity + delta);
          return { ...item, quantity: newQty, lineTotal: roundMoney(newQty * item.unitPrice) };
        }
        return item;
      })
    );
  };

  const setQuantity = (productId: string, rawValue: string) => {
    const parsed = parseFloat(rawValue.replace(',', '.'));
    const newQty = clampQty(productId, Number.isFinite(parsed) && parsed > 0 ? parsed : 0.01);
    setCart(
      cart.map((item) => {
        if (item.productId === productId) {
          return { ...item, quantity: newQty, lineTotal: roundMoney(newQty * item.unitPrice) };
        }
        return item;
      })
    );
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter((item) => item.productId !== productId));
  };

  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const grossTotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
  const finalTotal = grossTotal - discountGlobal;

  // Confidentialité prix d'achat : en mode achat, un non-admin ne voit AUCUN montant
  // (les totaux permettraient de déduire le prix unitaire)
  const hideAchatAmounts = operationType === 'achat' && !isAdmin;

  // ─── Paiement — valeurs réactives ────────────────────────────────────────
  const montantPayeNum = parseFloat(montantPaye) || 0;
  const montantSaisi = montantPaye.trim() !== '';

  // Monnaie à rendre (Espèce, client overpays)
  const monnaieARendre =
    operationType === 'vente' && conditionPaiement === 'Espèce' && montantSaisi && montantPayeNum > finalTotal + 0.005
      ? montantPayeNum - finalTotal : 0;

  // Reste à payer (dette créée) — s'applique aux DEUX modes (vente & achat)
  // • Versement: actif même si rien n'est saisi (paiement différé)
  // • Espèce / Chèque: actif seulement si le cashier saisit un montant < total
  const resteAPayer =
    conditionPaiement === 'Versement' ? Math.max(0, finalTotal - montantPayeNum)
    : montantSaisi ? Math.max(0, finalTotal - montantPayeNum)
    : 0;

  const statutPaiement =
    resteAPayer < 0.01 ? 'Payé' : montantPayeNum > 0.01 ? 'Partiel' : 'Non payé';

  const returnTotal = returnItems.reduce((s, i) => s + i.returnQty * i.unitPrice, 0);

  // ─── Return: smart search (by OP#, client name/phone, or date) ─────────────
  const handleReturnSearch = useCallback(async () => {
    const q = returnSearch.trim();
    if (!q) { setReturnSearchResults([]); return; }
    setReturnSearchLoading(true);
    try {
      const normalized = q.replace(/^OP-?0*/i, '');
      const isNumeric = /^\d+$/.test(normalized) && normalized.length <= 6;

      let ops: any[] = [];

      if (isNumeric) {
        const { data } = await supabase
          .from('operations')
          .select('*')
          .eq('type_op', 'vente')
          .eq('statut', 'valide')
          .eq('num_op', parseInt(normalized, 10))
          .limit(5);
        ops = data || [];
      } else {
        // Date detection: YYYY-MM-DD or DD/MM/YYYY
        const dateMatch = q.match(/^(\d{4}-\d{2}-\d{2})$/) ||
          q.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)?.slice(1).reverse().join('-') as unknown as RegExpMatchArray | null;
        const isoDate = (() => {
          const d1 = q.match(/^(\d{4}-\d{2}-\d{2})$/);
          if (d1) return d1[1];
          const d2 = q.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
          if (d2) return `${d2[3]}-${d2[2]}-${d2[1]}`;
          return null;
        })();

        if (isoDate) {
          const { data } = await supabase
            .from('operations')
            .select('*')
            .eq('type_op', 'vente')
            .eq('statut', 'valide')
            .eq('date_op', isoDate)
            .order('num_op', { ascending: false })
            .limit(30);
          ops = data || [];
        } else {
          // Search by client name or phone
          const { data: matchingClients } = await supabase
            .from('clients')
            .select('id_client')
            .or(`nom_prenom.ilike.%${q}%,num_telephone.ilike.%${q}%`)
            .limit(40);
          const clientIds = (matchingClients || []).map((c: any) => c.id_client);
          if (clientIds.length > 0) {
            const { data } = await supabase
              .from('operations')
              .select('*')
              .eq('type_op', 'vente')
              .eq('statut', 'valide')
              .in('client_id', clientIds)
              .order('num_op', { ascending: false })
              .limit(30);
            ops = data || [];
          }
        }
      }

      if (!ops.length) { setReturnSearchResults([]); return; }

      // Enrich with client names
      const cIds = [...new Set(ops.map((o: any) => o.client_id).filter(Boolean))];
      const clientMap: Record<string, string> = {};
      if (cIds.length) {
        const { data: cl } = await supabase.from('clients').select('id_client, nom_prenom').in('id_client', cIds);
        (cl || []).forEach((c: any) => { clientMap[String(c.id_client)] = c.nom_prenom; });
      }

      // Fetch items + product names
      const opIds = ops.map((o: any) => o.num_op);
      const { data: rawItems } = await supabase.from('operation_items').select('*').in('operation_id', opIds);
      const pIds = [...new Set((rawItems || []).map((i: any) => i.produit_id))];
      const prodMap: Record<string, string> = {};
      if (pIds.length) {
        const { data: prods } = await supabase.from('produits').select('code, produit').in('code', pIds);
        (prods || []).forEach((p: any) => { prodMap[p.code] = p.produit; });
      }

      setReturnSearchResults(ops.map((op: any) => ({
        ...op,
        _clientName: op.client_id ? (clientMap[String(op.client_id)] ?? null) : null,
        _items: (rawItems || [])
          .filter((i: any) => i.operation_id === op.num_op)
          .map((i: any) => ({ ...i, _productName: prodMap[i.produit_id] || i.produit_id })),
      })));
    } catch (err) {
      console.error('[Cashier] handleReturnSearch:', err);
    } finally {
      setReturnSearchLoading(false);
    }
  }, [returnSearch]);

  const handleSelectReturnOp = (op: any) => {
    setSelectedReturnOp(op);
    setReturnItems(
      (op._items as any[]).map((item) => ({
        itemId: item.id,
        productId: item.produit_id,
        productName: item._productName || item.produit_id,
        maxQty: parseFloat(item.quantite ?? 0),
        returnQty: parseFloat(item.quantite ?? 0),
        unitPrice: parseFloat(item.prix_unitaire ?? 0),
      }))
    );
  };

  const updateReturnQty = (itemId: number, val: string) => {
    const parsed = parseFloat(val);
    setReturnItems((prev) =>
      prev.map((i) =>
        i.itemId === itemId
          ? { ...i, returnQty: Number.isFinite(parsed) ? Math.min(i.maxQty, Math.max(0, parsed)) : 0 }
          : i
      )
    );
  };

  const handleCreateReturn = async () => {
    const toReturn = returnItems.filter((i) => i.returnQty > 0.001);
    if (!toReturn.length) { toast.warning('Sélectionnez au moins un article à retourner.'); return; }
    setCreatingReturn(true);
    try {
      const { date: todayStr, heure: timeStr } = nowMaroc();
      const total = toReturn.reduce((s, i) => s + i.returnQty * i.unitPrice, 0);

      const { data: returnOp, error: opErr } = await supabase
        .from('operations')
        .insert({
          date_op: todayStr,
          heure_op: timeStr,
          type_op: 'retour_client',
          total_dh: total,
          remise_dh: 0,
          utilisateur_id: profile?.id,
          client_id: selectedReturnOp.client_id ?? null,
          statut: 'valide',
          condition_paiement: 'Espèce',
          parent_op_id: selectedReturnOp.num_op,
          observ: `Retour sur OP-${String(selectedReturnOp.num_op).padStart(4, '0')}`,
        })
        .select()
        .single();
      if (opErr) throw opErr;

      const { error: itemsErr } = await supabase.from('operation_items').insert(
        toReturn.map((i) => ({
          operation_id: returnOp.num_op,
          produit_id: i.productId,
          quantite: i.returnQty,
          prix_unitaire: i.unitPrice,
          total_ligne: i.returnQty * i.unitPrice,
        }))
      );
      if (itemsErr) throw itemsErr;

      // Restock products individually (fail-safe per-item, RPC atomique)
      for (const item of toReturn) {
        const { error: rpcErr } = await supabase.rpc('apply_stock_delta', {
          p_code: item.productId,
          p_delta_stock: item.returnQty,
          p_delta_qte_vente: -item.returnQty,
        });
        if (rpcErr) console.error(`[Cashier] restock ${item.productId}:`, rpcErr.message);
      }

      // Optimistic Dexie update — useLiveQuery propagates the change to the UI
      for (const ri of toReturn) {
        const local = await db.produits.get(ri.productId);
        if (local) {
          await db.produits.update(ri.productId, {
            stock_actuel: local.stock_actuel + ri.returnQty,
          });
        }
      }

      setShowReturnModal(false);
      setReturnSearch('');
      setReturnSearchResults([]);
      setSelectedReturnOp(null);
      setReturnItems([]);
      toast.success(`Retour OP-${String(returnOp.num_op).padStart(4, '0')} créé avec succès. Stock recrédité.`);
    } catch (err: any) {
      toast.error('Erreur retour : ' + (err.message || String(err)));
    } finally {
      setCreatingReturn(false);
    }
  };

  const handleValidateOperation = async () => {
    if (!profile?.id) {
      console.error('[Cashier] validate — profil absent, opération annulée');
      toast.error('Session utilisateur non prête. Réessayez dans quelques secondes.');
      return;
    }
    if (cart.length === 0) return;
    if (products.length === 0) {
      toast.error('Catalogue produits non chargé. Vérifiez votre connexion et réessayez.');
      return;
    }

    const isVenteOp = operationType === 'vente';

    // ── B13a (RÈGLE STRICTE) : le client doit être choisi EXPLICITEMENT ──────
    if (isVenteOp && !selectedClient) {
      toast.error('Sélectionnez un client — même « Client Comptoir » — avant d\'encaisser.');
      return;
    }
    // Créance anonyme interdite : pas de crédit pour le comptoir
    if (isVenteOp && selectedClient?.id === COMPTOIR_ID && resteAPayer > 0.01) {
      toast.error('Vente à crédit impossible pour « Client Comptoir ».\nSélectionnez un client identifié pour créer une créance.');
      return;
    }
    // ── B13c : remise illogique (négative ou > sous-total) ───────────────────
    if (isVenteOp && (discountGlobal < 0 || discountGlobal > grossTotal + 0.001)) {
      toast.error(`Remise invalide : elle ne peut pas dépasser le sous-total (${grossTotal.toFixed(2)} DH).`);
      return;
    }
    // ── B13b : re-contrôle final du stock (le panier a pu vieillir) ──────────
    if (isVenteOp) {
      for (const item of cart) {
        const stock = stockOf(item.productId);
        if (item.quantity > stock + 1e-9) {
          toast.error(`Stock insuffisant pour « ${item.name} » : ${stock} disponible(s), ${item.quantity} demandé(s).`);
          return;
        }
      }
    }
    // Vente à crédit : échéance obligatoire (garde défensive, le bouton la bloque déjà)
    if (isVenteOp && resteAPayer > 0.01 && !dateEcheance) {
      toast.error('Date d\'échéance obligatoire pour toute vente à crédit.');
      return;
    }

    setLoading(true);
    try {
      const { date: todayStr, heure: timeStr } = nowMaroc();
      const isVente = isVenteOp;

      // ── Build header & items payloads ─────────────────────────────────────
      // U5 (RÈGLE STRICTE) : un ACHAT ne porte AUCUNE condition financière à la
      // saisie caissier — montant payé, échéance et mode sont fixés par l'admin
      // à la validation (RPC validate_purchase).
      const header: Record<string, unknown> = {
        date_op:   todayStr,
        heure_op:  timeStr,
        type_op:   operationType,
        total_dh:  finalTotal,
        remise_dh: isVente ? discountGlobal : 0,
        utilisateur_id: profile?.id,
        client_id:      isVente
          ? (selectedClient && selectedClient.id !== COMPTOIR_ID ? parseInt(selectedClient.id) : null)
          : null,
        fournisseur_id: !isVente ? (selectedFournisseur?.id_fournisseur ?? null) : null,
        statut:         isVente ? 'valide' : 'en_attente',
        condition_paiement: isVente ? conditionPaiement : 'Espèce',
        ref_paiement:   isVente ? (refPaiement.trim() || null) : null,
        montant_paye:   isVente
          ? (conditionPaiement === 'Versement'
              ? montantPayeNum
              : (montantSaisi ? Math.min(montantPayeNum, finalTotal) : finalTotal))
          : 0,
        reste_a_payer:  isVente ? resteAPayer : 0,
        date_echeance:  isVente && resteAPayer > 0.01 && dateEcheance ? dateEcheance : null,
        date_versement: isVente && conditionPaiement === 'Versement' && dateVersement ? dateVersement : null,
        statut_paiement: isVente ? statutPaiement : null,
        banque_cheque:  isVente && conditionPaiement === 'Chèque' ? (banqueCheque.trim() || null) : null,
        proprietaire_cheque: isVente && conditionPaiement === 'Chèque' ? (proprietaireCheque.trim() || null) : null,
        date_encaissement_cheque: isVente && conditionPaiement === 'Chèque' && dateEncaissementCheque ? dateEncaissementCheque : null,
        canal_vente: isVente ? canalVente : null,
        observ: isVente ? 'Vente caisse' : 'Achat en attente de validation admin',
      };

      const itemRows = cart.map((item) => ({
        produit_id:    item.productId,
        quantite:      item.quantity,
        prix_unitaire: item.unitPrice,
        total_ligne:   item.lineTotal,
      }));

      // ── COMMIT: online → direct Supabase; offline → enqueue ───────────────
      const { numOp, queued } = await commitOperation(header, itemRows);
      const parentId = numOp; // real num_op online, 'LOC-XXXXXX' offline

      // ── OPTIMISTIC DEXIE STOCK UPDATE (instant, both online & offline) ─────
      if (isVente) {
        for (const item of cart) {
          const local = await db.produits.get(item.productId);
          if (local) {
            await db.produits.update(item.productId, {
              stock_actuel: Math.max(0, local.stock_actuel - item.quantity),
            });
          }
        }
      }

      // ── REMOTE STOCK UPDATE (online only) ──────────────────────────────────
      // RPC atomique : un seul UPDATE SQL côté serveur — pas de course possible
      // entre deux caisses simultanées (l'ancien SELECT→UPDATE perdait des ventes).
      if (isVente && !queued) {
        for (const item of cart) {
          const product = products.find((p) => p.id === item.productId);
          if (!product) continue;
          const { error: rpcErr } = await supabase.rpc('apply_stock_delta', {
            p_code: product.code,
            p_delta_stock: -item.quantity,
            p_delta_qte_vente: item.quantity,
          });
          if (rpcErr) console.error(`[Cashier] apply_stock_delta ${product.code}:`, rpcErr.message);
        }
      }

      // ── CONDITIONAL WORKFLOW ───────────────────────────────────────────────
      if (isVente) {
        // Snapshot ticket AVANT reset UI
        const ticketItems: TicketItem[] = cart.map((item) => {
          const product = products.find((p) => p.id === item.productId);
          return {
            productId: item.productId,
            productCode: product?.code || item.productId,
            productName: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
          };
        });

        const opLabel = typeof parentId === 'number'
          ? `OP-${parentId.toString().padStart(4, '0')}`
          : String(parentId); // LOC-XXXXXX when offline

        const ticketOp: TicketOperation = {
          id: opLabel,
          type: 'vente',
          date: todayStr,
          time: timeStr,
          clientName: selectedClient?.name,
          cashierName: profile?.username,
          grossTotal: grossTotal,
          discountAmount: discountGlobal,
          finalTotal: finalTotal,
          montantPaye: resteAPayer > 0.01 ? Math.min(montantPayeNum, finalTotal) : undefined,
          resteAPayer: resteAPayer > 0.01 ? resteAPayer : undefined,
        };

        // ── Reset UI AVANT PDF ────────────────────────────────────────────────
        setSuccess(true);
        setSuccessMessage(queued
          ? '📶 Hors ligne — Vente sauvegardée localement. Sync à la reconnexion.'
          : '✅ Vente validée et ticket généré !'
        );
        setCart([]);
        setSelectedClient(null);
        setDiscountGlobal(0);
        setSearch('');
        setCanalVente('Sur place');
        setConditionPaiement('Espèce');
        setRefPaiement('');
        setMontantPaye('');
        setDateEcheance('');
        setBanqueCheque('');
        setProprietaireCheque('');
        setDateEncaissementCheque('');
        setDateVersement('');
        setShowCheckoutModal(false);

        setTimeout(() => { setSuccess(false); setSuccessMessage(null); }, 4000);

        // Background sync — pushes queue if online, no-op if offline
        syncAll().catch((err) => console.warn('[Cashier] background syncAll:', err));

        // PDF après reset — microtask laisse React committer les états
        Promise.resolve().then(() => {
          try {
            generateTicketPDF(ticketOp, ticketItems);
          } catch (pdfErr) {
            console.error('[Cashier] generateTicketPDF:', pdfErr);
            toast.warning('La vente est enregistrée, mais le ticket PDF a échoué.');
          }
        });

      } else { // achat
        // ── ACHAT : no stock update, no PDF ───────────────────────────────────
        const msg = queued
          ? '📶 Achat sauvegardé localement. Sync à la reconnexion.'
          : '📦 Achat enregistré. En attente de validation Admin.';
        if (!queued) toast.success(msg);
        setSuccessMessage(msg);
        setSuccess(true);
        setCart([]);
        setSelectedClient(null);
        setSelectedFournisseur(null);
        setDiscountGlobal(0);
        setSearch('');
        setCanalVente('Sur place');
        setConditionPaiement('Espèce');
        setRefPaiement('');
        setMontantPaye('');
        setDateEcheance('');
        setBanqueCheque('');
        setProprietaireCheque('');
        setDateEncaissementCheque('');
        setDateVersement('');
        setShowCheckoutModal(false);
        setTimeout(() => {
          setSuccess(false);
          setSuccessMessage(null);
        }, 4000);
      }

      console.log('[Cashier] validate — flow complete');
    } catch (err) {
      console.error(err);
      toast.error(
        "Erreur lors de la validation de l'opération : " +
          (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setLoading(false);
    }
  };


  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <>
    {/* Root: h-full fills the <main> which is overflow-hidden. NO calc, NO overflow-y-auto here. */}
    <div className="flex flex-col lg:flex-row h-full gap-4 lg:gap-6 overflow-hidden p-4 lg:p-6">

      {/* ── LEFT: Product Catalogue ── */}
      <div className="flex-[1.5] flex flex-col gap-4 min-w-0 h-full overflow-hidden">

        {/* Search bar */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center gap-4 shadow-sm shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher un produit (Nom ou Code)..."
              className="w-full bg-slate-50 border-none rounded-xl py-3 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-emerald-500/20"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Product grid — THIS is the only scrollable zone on the left */}
        <div className="flex-1 overflow-y-auto min-h-0 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-4 pb-4 content-start">
          {filteredProducts.map((p) => (
            <motion.div
              layout
              key={p.id}
              onClick={() => addToCart(p)}
              className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-200 hover:shadow-md cursor-pointer group transition-all"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold text-slate-400 font-mono uppercase truncate max-w-[100px]">
                  {p.code}
                </span>
                <span
                  className={cn(
                    'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase',
                    p.stockActual > 10
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-rose-50 text-rose-600'
                  )}
                >
                  Stock: {p.stockActual}
                </span>
              </div>
              <h4 className="font-bold text-slate-900 group-hover:text-emerald-600 transition-colors truncate">
                {p.name}
              </h4>
              <p className="text-xl font-black text-slate-900 mt-2">
                {operationType === 'achat' && !isAdmin
                  ? <span className="text-slate-300 text-base">— DH</span>
                  : <>{(operationType === 'achat' ? ((p as any).purchasePrice ?? 0) : p.defaultPrice).toFixed(2)}{' '}<span className="text-xs font-medium text-slate-400">DH</span></>
                }
              </p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── RIGHT: Scanning Panel (Phase 1) ──────────────────────────────────
           RULE: This column is ONLY for scanning. It never grows vertically.
           Header (shrink-0) → Items (flex-1 scroll) → Footer totals (shrink-0)
           ALL checkout logic lives in the Checkout Modal.                      */}
      <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-slate-200 w-full lg:w-[400px] shrink-0 overflow-hidden">

        {/* ── Header: mode tabs + action buttons ── */}
        <div className="shrink-0 p-3 border-b border-slate-200 bg-slate-50 space-y-2.5">
          {/* Mode tabs */}
          <div className="flex bg-slate-200/70 p-1 rounded-xl gap-1">
            <button
              onClick={() => { setOperationType('vente'); setCart([]); setDiscountGlobal(0); setSelectedFournisseur(null); setConditionPaiement('Espèce'); setRefPaiement(''); setMontantPaye(''); setDateEcheance(''); setDateVersement(''); setBanqueCheque(''); setProprietaireCheque(''); setDateEncaissementCheque(''); }}
              className={cn(
                'flex-1 py-2 text-sm font-black rounded-lg transition-all tracking-tight',
                operationType === 'vente'
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              )}
            >
              🛒 Vente
            </button>
            <button
              onClick={() => { setOperationType('achat'); setCart([]); setDiscountGlobal(0); setSelectedClient(null); setConditionPaiement('Espèce'); setRefPaiement(''); setMontantPaye(''); setDateEcheance(''); setDateVersement(''); setBanqueCheque(''); setProprietaireCheque(''); setDateEncaissementCheque(''); }}
              className={cn(
                'flex-1 py-2 text-sm font-black rounded-lg transition-all tracking-tight',
                operationType === 'achat'
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              )}
            >
              📦 Achat
            </button>
          </div>
          {/* Action row */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400">
              {cart.length === 0 ? 'Panier vide' : `${cart.length} produit(s) · ${cart.reduce((s,i) => s+i.quantity,0)} unités`}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setShowReturnModal(true); setReturnSearch(''); setReturnSearchResults([]); setSelectedReturnOp(null); setReturnItems([]); }}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition-all text-xs font-black"
              >
                <CornerUpLeft className="h-3 w-3" /> Retour
              </button>
              <button
                onClick={() => setCart([])}
                disabled={cart.length === 0}
                className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all disabled:opacity-30"
                title="Vider le panier"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Cart items — THE ONLY scrollable zone ── */}
        <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-2">
          <AnimatePresence initial={false}>
            {cart.map((item) => (
              <motion.div
                key={item.productId}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.92 }}
                className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl group border border-transparent hover:border-slate-200 transition-all"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 truncate text-sm">{item.name}</p>
                  <p className="text-[11px] text-slate-400 font-medium">
                    {hideAchatAmounts ? '— DH/u' : `${item.unitPrice.toFixed(2)} DH/u`}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 bg-white rounded-lg p-0.5 border border-slate-200">
                  <button onClick={() => updateQuantity(item.productId, -1)} className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700 transition-colors">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="number" min="0.01" step="0.01" value={item.quantity}
                    onChange={(e) => setQuantity(item.productId, e.target.value)}
                    className="w-14 text-center text-sm font-black text-emerald-700 bg-white border border-emerald-300 rounded focus:ring-2 focus:ring-emerald-500 focus:border-transparent py-0.5"
                    aria-label={`Quantité ${item.name}`}
                  />
                  <button onClick={() => updateQuantity(item.productId, 1)} className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700 transition-colors">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="text-right w-16 shrink-0">
                  {/* Confidentialité : total de ligne masqué (total ÷ qté = prix d'achat déductible) */}
                  <p className="font-black text-sm text-slate-800">{hideAchatAmounts ? '—' : item.lineTotal.toFixed(2)}</p>
                  <p className="text-[9px] text-slate-400">DH</p>
                </div>
                <button onClick={() => removeFromCart(item.productId)} className="p-1.5 opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition-all">
                  <XCircle className="h-4 w-4" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>

          {cart.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-200 gap-3 py-16">
              <ShoppingCart className="h-14 w-14 opacity-30" />
              <p className="font-bold text-slate-400 text-sm">Cliquez sur un produit pour l'ajouter</p>
            </div>
          )}
        </div>

        {/* ── Footer: Totals + ENCAISSER (Phase 1 CTA) — FIXED, never grows ── */}
        <div className="shrink-0 border-t border-slate-200 bg-white">
          <div className="px-4 py-3 space-y-1.5">
            <div className="flex justify-between items-center text-slate-500">
              <span className="text-xs font-medium">Sous-total</span>
              <span className="font-bold text-xs">{hideAchatAmounts ? '— DH' : `${grossTotal.toFixed(2)} DH`}</span>
            </div>
            {operationType === 'vente' && (
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1 text-emerald-600">
                  <Ticket className="h-3 w-3" />
                  <span className="text-xs font-medium">Remise</span>
                </div>
                <input
                  type="number" min="0" step="0.01" max={grossTotal}
                  className="bg-slate-50 border border-slate-200 rounded-lg py-0.5 px-2 text-right w-16 text-xs font-bold text-emerald-600 focus:ring-1 focus:ring-emerald-400"
                  value={discountGlobal}
                  onChange={(e) => {
                    // B13c : la remise ne peut être ni négative ni dépasser le sous-total
                    const v = Number(e.target.value) || 0;
                    setDiscountGlobal(Math.min(Math.max(0, v), roundMoney(grossTotal)));
                  }}
                />
              </div>
            )}
            <div className="pt-1.5 border-t border-slate-100 flex justify-between items-center">
              <span className="font-black uppercase text-xs tracking-tight text-slate-700">Total</span>
              <span className={cn('text-2xl font-black', operationType === 'vente' ? 'text-emerald-600' : 'text-blue-600')}>
                {hideAchatAmounts ? '—' : finalTotal.toFixed(2)} <span className="text-xs font-medium">DH</span>
              </span>
            </div>
          </div>

          <div className="px-3 pb-3">
            {success ? (
              <div className={cn(
                'w-full py-3 rounded-xl flex items-center justify-center gap-2 font-black text-sm text-white',
                operationType === 'vente' ? 'bg-emerald-500' : 'bg-blue-500'
              )}>
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span className="text-xs text-center leading-tight">{successMessage || 'OPÉRATION RÉUSSIE'}</span>
              </div>
            ) : (
              <button
                onClick={() => setShowCheckoutModal(true)}
                disabled={cart.length === 0}
                className={cn(
                  'w-full py-3.5 rounded-xl flex items-center justify-center gap-2 font-black transition-all text-base tracking-tight',
                  operationType === 'vente'
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/25 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none'
                    : 'bg-blue-500 hover:bg-blue-400 text-white shadow-lg shadow-blue-500/25 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none'
                )}
              >
                <Calculator className="h-5 w-5" />
                {operationType === 'vente' ? 'ENCAISSER' : 'VALIDER ACHAT'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>

      {/* ══════════════════════════════════════════════════════════════════════
           CHECKOUT MODAL (Phase 2) — opens when cashier clicks ENCAISSER
           Contains: ① Client/Fournisseur  ② Payment method  ③ Partial payment
           The VALIDER button at the bottom calls handleValidateOperation.
           ══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showCheckoutModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => !loading && setShowCheckoutModal(false)}
            />

            {/* Modal card */}
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden z-10 flex flex-col max-h-[95vh] sm:max-h-[88vh]"
            >
              {/* Modal header */}
              <div className={cn(
                'shrink-0 px-6 py-4 border-b flex items-center justify-between',
                operationType === 'vente' ? 'bg-emerald-50 border-emerald-100' : 'bg-blue-50 border-blue-100'
              )}>
                <div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                    {operationType === 'vente' ? '💳 Encaissement' : '📥 Validation Achat'}
                  </h3>
                  <p className={cn('text-xs font-bold mt-0.5', operationType === 'vente' ? 'text-emerald-700' : 'text-blue-700')}>
                    {cart.length} article(s){hideAchatAmounts ? '' : ` · Total : ${finalTotal.toFixed(2)} DH`}
                  </p>
                </div>
                <button
                  onClick={() => !loading && setShowCheckoutModal(false)}
                  className="p-2 hover:bg-white/70 rounded-xl text-slate-400 transition-all"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto">

                {/* ── Order summary (compact, read-only) ── */}
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Récapitulatif commande</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                    {cart.map((item) => (
                      <div key={item.productId} className="flex justify-between items-center text-sm">
                        <span className="text-slate-700 font-medium truncate mr-2">{item.name} <span className="text-slate-400">× {item.quantity}</span></span>
                        <span className="font-bold text-slate-900 shrink-0">
                          {hideAchatAmounts ? '—' : `${item.lineTotal.toFixed(2)} DH`}
                        </span>
                      </div>
                    ))}
                  </div>
                  {operationType === 'vente' && discountGlobal > 0 && (
                    <div className="flex justify-between items-center text-xs mt-2 pt-2 border-t border-slate-200 text-emerald-600">
                      <span className="font-bold">Remise</span>
                      <span className="font-black">−{discountGlobal.toFixed(2)} DH</span>
                    </div>
                  )}
                </div>

                {/* ── Section A: Client / Fournisseur ── */}
                <div className="px-6 py-5 border-b border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={cn(
                      'h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0',
                      operationType === 'vente' ? 'bg-emerald-500' : 'bg-blue-500'
                    )}>①</div>
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">
                      {operationType === 'vente' ? 'Client' : 'Fournisseur'}
                    </p>
                  </div>
                  {operationType === 'vente' ? (
                    <div className="flex gap-2">
                      <select
                        className={cn(
                          'flex-1 bg-slate-50 rounded-xl py-2.5 px-3 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500/20 border-2',
                          // B13a : tant qu'aucun choix explicite n'est fait, le champ est marqué
                          !selectedClient ? 'border-rose-300' : 'border-slate-200'
                        )}
                        value={selectedClient?.id || ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === COMPTOIR_ID) {
                            setSelectedClient({
                              id: COMPTOIR_ID, name: 'Client Comptoir', phone: '', address: '',
                              function: '', createdAt: new Date() as any, updatedAt: new Date() as any,
                            } as Client);
                          } else {
                            setSelectedClient(clients.find((c) => c.id === v) || null);
                          }
                        }}
                      >
                        <option value="" disabled>— Sélectionner un client (obligatoire) —</option>
                        <option value={COMPTOIR_ID}>Client Comptoir</option>
                        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => setShowQuickClient(true)}
                        className="p-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl transition-all shrink-0"
                        title="Nouveau client"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <select
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500/20"
                        value={selectedFournisseur?.id_fournisseur || ''}
                        onChange={(e) => setSelectedFournisseur(fournisseurs.find((f) => String(f.id_fournisseur) === e.target.value) || null)}
                      >
                        <option value="">— Sélectionner un fournisseur —</option>
                        {fournisseurs.map((f) => <option key={f.id_fournisseur} value={f.id_fournisseur}>{f.nom}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => setShowQuickFournisseur(true)}
                        className="p-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl transition-all shrink-0"
                        title="Nouveau fournisseur"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* ── Section B0: Canal de vente (vente uniquement) ── */}
                {operationType === 'vente' && (
                  <div className="px-6 py-4 border-b border-slate-100">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">Canal de vente</p>
                    <div className="flex flex-wrap gap-2">
                      {(['Sur place', 'WhatsApp', 'Facebook', 'Téléphone', 'Livraison'] as const).map((c) => (
                        <button
                          key={c} type="button"
                          onClick={() => setCanalVente(c)}
                          className={cn(
                            'px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all',
                            canalVente === c
                              ? 'bg-emerald-500 text-white border-emerald-500'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── U5 (RÈGLE STRICTE) : achat = marchandises uniquement ── */}
                {operationType === 'achat' && (
                  <div className="px-6 py-5 border-b border-slate-100">
                    <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-2xl p-4">
                      <Truck className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-black text-blue-800">Enregistrement des marchandises uniquement</p>
                        <p className="text-xs font-medium text-blue-600 mt-0.5">
                          Les conditions financières (montant payé, mode de paiement, échéance) seront
                          fixées par l'administrateur lors de la validation de cet achat.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section B: Payment method (VENTE uniquement — U5) ── */}
                {operationType === 'vente' && (
                <div className="px-6 py-5 border-b border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={cn(
                      'h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0',
                      operationType === 'vente' ? 'bg-emerald-500' : 'bg-blue-500'
                    )}>②</div>
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Mode de paiement</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['Espèce', 'Chèque', 'Versement'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => { setConditionPaiement(mode); setRefPaiement(''); setDateEcheance(''); setDateVersement(''); setBanqueCheque(''); setProprietaireCheque(''); setDateEncaissementCheque(''); }}
                        className={cn(
                          'py-3 px-2 rounded-2xl border-2 text-sm font-black transition-all flex flex-col items-center gap-1',
                          conditionPaiement === mode
                            ? operationType === 'vente'
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                              : 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                        )}
                      >
                        <span className="text-lg leading-none">{mode === 'Espèce' ? '💵' : mode === 'Chèque' ? '📄' : '🔄'}</span>
                        <span className="text-[11px]">{mode}</span>
                      </button>
                    ))}
                  </div>

                </div>
                )}

                {/* ── Section C: Détails du paiement (VENTE uniquement — U5) ── */}
                {operationType === 'vente' && (
                  <div className="px-6 py-5 border-b border-slate-100">
                    <div className="flex items-center gap-2 mb-4">
                      <div className={cn('h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0',
                        operationType === 'vente' ? 'bg-emerald-500' : 'bg-blue-500'
                      )}>③</div>
                      <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Détails du paiement</p>
                    </div>

                    {/* Universal: Montant Reçu */}
                    <div className="space-y-1 mb-3">
                      <label className="text-xs font-black text-slate-500 uppercase tracking-widest">
                        Montant reçu (DH)
                        <span className="ml-1 text-slate-300 font-normal normal-case tracking-normal">— laisser vide si paiement total</span>
                      </label>
                      <input
                        type="number" min="0" step="0.01"
                        placeholder={`${finalTotal.toFixed(2)} DH`}
                        className="w-full bg-white border-2 border-slate-200 rounded-xl py-2.5 px-4 text-base font-black text-slate-800 focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400"
                        value={montantPaye}
                        onChange={(e) => setMontantPaye(e.target.value)}
                      />
                    </div>

                    {/* Live feedback: monnaie or debt — masqué en achat pour non-admin (confidentialité) */}
                    {montantSaisi && !hideAchatAmounts && (
                      <div className={cn(
                        'rounded-xl px-4 py-2.5 flex items-center justify-between mb-3',
                        monnaieARendre > 0.005 ? 'bg-blue-50 border border-blue-200'
                        : resteAPayer < 0.01 ? 'bg-emerald-50 border border-emerald-200'
                        : 'bg-rose-50 border border-rose-200'
                      )}>
                        <span className={cn('text-sm font-black',
                          monnaieARendre > 0.005 ? 'text-blue-700'
                          : resteAPayer < 0.01 ? 'text-emerald-700'
                          : 'text-rose-700'
                        )}>
                          {monnaieARendre > 0.005 ? '💴 Monnaie à rendre'
                            : resteAPayer < 0.01 ? '✅ Paiement complet'
                            : '⚠️ Reste dû'}
                        </span>
                        {(monnaieARendre > 0.005 || resteAPayer > 0.01) && (
                          <span className={cn('text-xl font-black',
                            monnaieARendre > 0.005 ? 'text-blue-700' : 'text-rose-700'
                          )}>
                            {(monnaieARendre > 0.005 ? monnaieARendre : resteAPayer).toFixed(2)} DH
                          </span>
                        )}
                      </div>
                    )}

                    {/* Date d'échéance — mandatory whenever reste_a_payer > 0 (all modes) */}
                    {resteAPayer > 0.01 && (
                      <div className="space-y-1 mb-4 p-3 bg-rose-50 rounded-2xl border border-rose-100">
                        <label className="text-xs font-black text-rose-600 uppercase tracking-widest flex items-center gap-1">
                          Date d'échéance de la créance <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="date"
                          className="w-full bg-white border-2 border-rose-200 rounded-xl py-2 px-3 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-rose-400/30 focus:border-rose-400"
                          value={dateEcheance}
                          onChange={(e) => setDateEcheance(e.target.value)}
                        />
                        {!dateEcheance && (
                          <p className="text-[10px] text-rose-500 font-bold mt-1">⚠️ Obligatoire pour toute vente à crédit</p>
                        )}
                      </div>
                    )}

                    {/* ── Versement: reference + date du virement ── */}
                    {conditionPaiement === 'Versement' && (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                            Référence du justificatif <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            placeholder="Ex: VIR-2025-0042"
                            className={cn(
                              'w-full bg-white border-2 rounded-xl py-2.5 px-4 text-sm font-bold text-slate-700 focus:ring-2',
                              !refPaiement.trim()
                                ? 'border-rose-300 focus:ring-rose-400/30 focus:border-rose-400'
                                : 'border-emerald-300 focus:ring-emerald-400/30 focus:border-emerald-400'
                            )}
                            value={refPaiement}
                            onChange={(e) => setRefPaiement(e.target.value)}
                          />
                          {!refPaiement.trim() && (
                            <p className="text-[10px] text-rose-500 font-bold mt-0.5">⚠️ Référence obligatoire pour un versement</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                            Date du virement <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="date"
                            className={cn(
                              'w-full bg-white border-2 rounded-xl py-2.5 px-4 text-sm font-bold text-slate-700 focus:ring-2',
                              !dateVersement
                                ? 'border-rose-300 focus:ring-rose-400/30 focus:border-rose-400'
                                : 'border-emerald-300 focus:ring-emerald-400/30 focus:border-emerald-400'
                            )}
                            value={dateVersement}
                            onChange={(e) => setDateVersement(e.target.value)}
                          />
                          {!dateVersement && (
                            <p className="text-[10px] text-rose-500 font-bold mt-0.5">⚠️ Date du virement obligatoire</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── Chèque: 4 mandatory fields ── */}
                    {conditionPaiement === 'Chèque' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                              N° Chèque <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="text"
                              placeholder="000123456"
                              className={cn(
                                'w-full bg-white border-2 rounded-xl py-2 px-3 text-sm font-bold focus:ring-2',
                                !refPaiement.trim() ? 'border-rose-300 focus:ring-rose-400/30' : 'border-emerald-300 focus:ring-emerald-400/30'
                              )}
                              value={refPaiement}
                              onChange={(e) => setRefPaiement(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                              Banque <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="text"
                              placeholder="CIH, Attijariwafa…"
                              className={cn(
                                'w-full bg-white border-2 rounded-xl py-2 px-3 text-sm font-bold focus:ring-2',
                                !banqueCheque.trim() ? 'border-rose-300 focus:ring-rose-400/30' : 'border-emerald-300 focus:ring-emerald-400/30'
                              )}
                              value={banqueCheque}
                              onChange={(e) => setBanqueCheque(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                            Nom du propriétaire du compte <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            placeholder="Ex: Mohammed Al Fassi"
                            className={cn(
                              'w-full bg-white border-2 rounded-xl py-2.5 px-4 text-sm font-bold focus:ring-2',
                              !proprietaireCheque.trim() ? 'border-rose-300 focus:ring-rose-400/30' : 'border-emerald-300 focus:ring-emerald-400/30'
                            )}
                            value={proprietaireCheque}
                            onChange={(e) => setProprietaireCheque(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                            Date d'encaissement du chèque <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="date"
                            className={cn(
                              'w-full bg-white border-2 rounded-xl py-2.5 px-4 text-sm font-bold focus:ring-2',
                              !dateEncaissementCheque ? 'border-rose-300 focus:ring-rose-400/30' : 'border-emerald-300 focus:ring-emerald-400/30'
                            )}
                            value={dateEncaissementCheque}
                            onChange={(e) => setDateEncaissementCheque(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </div>

              {/* ── Modal footer: total recap + VALIDER ── */}
              <div className="shrink-0 px-6 py-4 border-t border-slate-200 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total à {operationType === 'vente' ? 'encaisser' : 'valider'}</p>
                    <p className={cn('text-3xl font-black', operationType === 'vente' ? 'text-emerald-600' : 'text-blue-600')}>
                      {hideAchatAmounts ? '—' : finalTotal.toFixed(2)} <span className="text-sm font-bold text-slate-400">DH</span>
                    </p>
                    {hideAchatAmounts && (
                      <p className="text-[10px] font-bold text-slate-400 mt-0.5">🔒 Montants confidentiels — fixés à la validation admin</p>
                    )}
                    {!hideAchatAmounts && monnaieARendre > 0.005 && (
                      <p className="text-xs font-bold text-blue-500 mt-0.5">💴 Monnaie à rendre : {monnaieARendre.toFixed(2)} DH</p>
                    )}
                    {!hideAchatAmounts && resteAPayer > 0.01 && (
                      <p className="text-xs font-bold text-rose-500 mt-0.5">
                        {montantSaisi ? `Payé : ${Math.min(montantPayeNum, finalTotal).toFixed(2)} DH · ` : ''}Reste : {resteAPayer.toFixed(2)} DH
                      </p>
                    )}
                  </div>
                  {operationType === 'vente' && (
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Mode</p>
                      <p className="text-sm font-black text-slate-700">{conditionPaiement}</p>
                    </div>
                  )}
                </div>

                <button
                  onClick={handleValidateOperation}
                  disabled={
                    loading ||
                    cart.length === 0 ||
                    // Règles financières : VENTE uniquement (U5 — l'achat n'a plus de saisie financière)
                    (operationType === 'vente' && (
                      // B13a : client explicite obligatoire
                      !selectedClient ||
                      // Partial payment always requires a debt due date
                      (resteAPayer > 0.01 && !dateEcheance) ||
                      // Versement: reference + virement date mandatory
                      (conditionPaiement === 'Versement' && (!refPaiement.trim() || !dateVersement)) ||
                      // Chèque: all 4 fields mandatory
                      (conditionPaiement === 'Chèque' && (
                        !refPaiement.trim() || !banqueCheque.trim() || !proprietaireCheque.trim() || !dateEncaissementCheque
                      ))
                    ))
                  }
                  className={cn(
                    'w-full py-4 rounded-2xl flex items-center justify-center gap-3 font-black transition-all text-base tracking-tight',
                    operationType === 'vente'
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-xl shadow-emerald-500/30 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none'
                      : 'bg-blue-500 hover:bg-blue-400 text-white shadow-xl shadow-blue-500/30 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none'
                  )}
                >
                  {loading ? (
                    <><Loader2 className="h-5 w-5 animate-spin" /> Traitement en cours…</>
                  ) : (
                    <><CheckCircle2 className="h-5 w-5" /> {operationType === 'vente' ? 'VALIDER LA VENTE' : 'VALIDER L\'ACHAT'}</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Modal Création Rapide Fournisseur ── */}
      {showQuickFournisseur && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setShowQuickFournisseur(false)}
          />
          <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden z-10">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Nouveau Fournisseur</h3>
                <p className="text-xs text-slate-500 mt-0.5">Création rapide depuis la caisse</p>
              </div>
              <button onClick={() => setShowQuickFournisseur(false)} className="p-2 hover:bg-white rounded-xl text-slate-400 transition-all">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateQuickFournisseur} className="p-6 space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Type</label>
                <select
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                  value={quickFournisseurType}
                  onChange={(e) => setQuickFournisseurType(e.target.value as 'Société' | 'Personne physique')}
                >
                  <option value="Personne physique">Personne physique</option>
                  <option value="Société">Société</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Nom *</label>
                <input required type="text" placeholder="Ex: Agri-Maroc SARL"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                  value={quickFournisseurNom} onChange={(e) => setQuickFournisseurNom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Téléphone</label>
                <input type="tel" placeholder="0612345678"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                  value={quickFournisseurTel} onChange={(e) => setQuickFournisseurTel(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Adresse</label>
                <input type="text" placeholder="Ex: Zone Industrielle, Kénitra"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                  value={quickFournisseurAdresse} onChange={(e) => setQuickFournisseurAdresse(e.target.value)} />
              </div>
              {quickFournisseurType === 'Société' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">IRC</label>
                    <input type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                      value={quickFournisseurIrc} onChange={(e) => setQuickFournisseurIrc(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">ICE</label>
                    <input type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                      value={quickFournisseurIce} onChange={(e) => setQuickFournisseurIce(e.target.value)} />
                  </div>
                </div>
              )}
              {quickFournisseurType === 'Personne physique' && (
                <div className="space-y-1">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">CIN</label>
                  <input type="text" placeholder="AB123456"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                    value={quickFournisseurCin} onChange={(e) => setQuickFournisseurCin(e.target.value)} />
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowQuickFournisseur(false)}
                  className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all">
                  Annuler
                </button>
                <button type="submit" disabled={quickFournisseurLoading}
                  className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 text-white font-black rounded-2xl transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50">
                  {quickFournisseurLoading ? 'Création...' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal Retour Client ── */}
      <AnimatePresence>
        {showReturnModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowReturnModal(false)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden z-10 flex flex-col max-h-[90vh]"
            >
              {/* Modal header */}
              <div className="p-6 border-b border-slate-200 bg-purple-50 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  {selectedReturnOp && (
                    <button
                      onClick={() => { setSelectedReturnOp(null); setReturnItems([]); }}
                      className="p-2 hover:bg-purple-100 rounded-xl text-purple-500 transition-all"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  )}
                  <div className="h-10 w-10 bg-purple-600 rounded-xl flex items-center justify-center text-white">
                    <CornerUpLeft className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                      {selectedReturnOp
                        ? `Retour — OP-${String(selectedReturnOp.num_op).padStart(4, '0')}`
                        : 'Faire un Retour Client'}
                    </h3>
                    <p className="text-xs text-purple-600 font-bold mt-0.5">
                      {selectedReturnOp
                        ? `Étape 2 / 2 — Sélectionnez les articles à retourner`
                        : `Étape 1 / 2 — Recherchez l'opération d'origine`}
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowReturnModal(false)} className="p-2 hover:bg-purple-100 rounded-xl text-slate-400 transition-all">
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              {/* ── STEP 1: Search ── */}
              {!selectedReturnOp && (
                <div className="flex flex-col flex-1 overflow-hidden">
                  <div className="p-5 border-b border-slate-100 shrink-0">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                          type="text"
                          autoFocus
                          placeholder="Numéro ticket (ex: 42), nom client, téléphone, ou date (YYYY-MM-DD)..."
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-purple-500/20"
                          value={returnSearch}
                          onChange={(e) => setReturnSearch(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleReturnSearch(); }}
                        />
                      </div>
                      <button
                        onClick={handleReturnSearch}
                        disabled={returnSearchLoading || !returnSearch.trim()}
                        className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-all disabled:opacity-40 text-sm"
                      >
                        {returnSearchLoading ? (
                          <div className="h-4 w-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                        ) : 'Chercher'}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2 font-medium">
                      💡 Tapez le n° de ticket, le nom ou téléphone du client, ou la date (JJ/MM/AAAA)
                    </p>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {returnSearchResults.length === 0 && !returnSearchLoading && returnSearch.trim() && (
                      <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-3">
                        <Package className="h-12 w-12 opacity-20" />
                        <p className="font-bold text-sm">Aucune vente validée trouvée</p>
                        <p className="text-xs">Essayez un autre terme de recherche</p>
                      </div>
                    )}
                    {returnSearchResults.length === 0 && !returnSearch.trim() && (
                      <div className="flex flex-col items-center justify-center py-10 text-slate-300 gap-3">
                        <CornerUpLeft className="h-12 w-12 opacity-30" />
                        <p className="font-bold text-sm text-slate-400">Recherchez l'opération d'origine</p>
                      </div>
                    )}
                    {returnSearchResults.map((op: any) => (
                      <button
                        key={op.num_op}
                        onClick={() => handleSelectReturnOp(op)}
                        className="w-full text-left p-4 bg-slate-50 hover:bg-purple-50 border border-slate-200 hover:border-purple-200 rounded-2xl transition-all group"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-purple-200 transition-colors">
                              <span className="text-xs font-black">#{op.num_op}</span>
                            </div>
                            <div>
                              <p className="font-black text-slate-900 text-sm">
                                OP-{String(op.num_op).padStart(4, '0')}
                                {op._clientName && <span className="text-purple-600 ml-2">· {op._clientName}</span>}
                              </p>
                              <p className="text-xs text-slate-500 font-medium">
                                {op.date_op} · {op._items.length} article(s) · {parseFloat(op.total_dh || 0).toFixed(2)} DH
                              </p>
                            </div>
                          </div>
                          <span className="text-xs font-black text-purple-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Sélectionner →</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── STEP 2: Item selection ── */}
              {selectedReturnOp && (
                <div className="flex flex-col flex-1 overflow-hidden">
                  {/* Op summary banner */}
                  <div className="px-5 py-3 bg-purple-50/50 border-b border-purple-100 text-xs font-bold text-purple-700 shrink-0 flex items-center gap-4">
                    <span>📅 {selectedReturnOp.date_op}</span>
                    {selectedReturnOp._clientName && <span>👤 {selectedReturnOp._clientName}</span>}
                    <span>💰 {parseFloat(selectedReturnOp.total_dh || 0).toFixed(2)} DH</span>
                  </div>

                  {/* Items list */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Articles de la vente originale</p>
                    {returnItems.map((item) => (
                      <div
                        key={item.itemId}
                        className={cn(
                          'flex items-center gap-3 p-3 rounded-2xl border transition-all',
                          item.returnQty > 0
                            ? 'bg-purple-50 border-purple-200'
                            : 'bg-slate-50 border-slate-200 opacity-60'
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-slate-900 text-sm truncate">{item.productName}</p>
                          <p className="text-[10px] text-slate-500 font-medium">
                            {item.unitPrice.toFixed(2)} DH/u · Max: {item.maxQty}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 bg-white rounded-lg p-0.5 border border-purple-200">
                          <button
                            onClick={() => updateReturnQty(item.itemId, String(Math.max(0, item.returnQty - 1)))}
                            className="p-1.5 hover:bg-purple-50 rounded text-slate-400 hover:text-purple-600 transition-colors"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <input
                            type="number"
                            min="0"
                            max={item.maxQty}
                            step="1"
                            value={item.returnQty}
                            onChange={(e) => updateReturnQty(item.itemId, e.target.value)}
                            className="w-12 text-center text-sm font-black text-purple-700 bg-white border border-purple-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent py-1"
                          />
                          <button
                            onClick={() => updateReturnQty(item.itemId, String(Math.min(item.maxQty, item.returnQty + 1)))}
                            className="p-1.5 hover:bg-purple-50 rounded text-slate-400 hover:text-purple-600 transition-colors"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="min-w-[64px] text-right">
                          <p className="font-black text-sm text-purple-700">
                            {(item.returnQty * item.unitPrice).toFixed(2)}
                          </p>
                          <p className="text-[9px] text-slate-400">DH</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Footer: total + confirm */}
                  <div className="p-4 border-t border-slate-200 bg-slate-50 shrink-0 space-y-3">
                    <div className="flex justify-between items-center px-1">
                      <span className="font-black text-sm text-slate-700 uppercase tracking-tight">
                        Total remboursé
                      </span>
                      <span className="text-xl font-black text-rose-600">
                        −{returnTotal.toFixed(2)} <span className="text-xs">DH</span>
                      </span>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[10px] text-amber-700 font-bold">
                      ⚠️ Action irréversible — le stock sera recredité immédiatement.
                    </div>
                    <button
                      onClick={handleCreateReturn}
                      disabled={creatingReturn || returnTotal < 0.01}
                      className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-black rounded-2xl transition-all shadow-lg shadow-purple-500/20 disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {creatingReturn ? (
                        <><div className="h-4 w-4 border-2 border-white/50 border-t-white rounded-full animate-spin" /> Création…</>
                      ) : (
                        <><CornerUpLeft className="h-4 w-4" /> CONFIRMER LE RETOUR</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Modal Création Rapide Client ── */}
      {showQuickClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => {
              setShowQuickClient(false);
              setQuickClientName('');
              setQuickClientPhone('');
              setQuickClientAddress('');
              setQuickClientFonction('');
            }}
          />
          <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden z-10">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Nouveau Client</h3>
                <p className="text-xs text-slate-500 mt-0.5">Création rapide depuis la caisse</p>
              </div>
              <button onClick={() => { setShowQuickClient(false); setQuickClientName(''); setQuickClientPhone(''); setQuickClientAddress(''); setQuickClientFonction(''); }} className="p-2 hover:bg-white rounded-xl text-slate-400 transition-all">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateQuickClient} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Nom &amp; Prénom *</label>
                <input
                  required
                  type="text"
                  placeholder="Ex: Ahmed Benali"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                  value={quickClientName}
                  onChange={(e) => setQuickClientName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Téléphone</label>
                <input
                  type="tel"
                  placeholder="0612345678"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                  value={quickClientPhone}
                  onChange={(e) => setQuickClientPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Adresse</label>
                <input
                  type="text"
                  placeholder="Ex: Douar Ait Baha, Agadir"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                  value={quickClientAddress}
                  onChange={(e) => setQuickClientAddress(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Fonction</label>
                <select
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500/20"
                  value={quickClientFonction}
                  onChange={(e) => setQuickClientFonction(e.target.value)}
                >
                  <option value="">— Sélectionner —</option>
                  <option value="Éleveur">Éleveur</option>
                  <option value="Vétérinaire">Vétérinaire</option>
                  <option value="Autre">Autre</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowQuickClient(false);
                    setQuickClientName('');
                    setQuickClientPhone('');
                    setQuickClientAddress('');
                    setQuickClientFonction('');
                  }}
                  className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={quickClientLoading}
                  className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                >
                  {quickClientLoading ? 'Création...' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

