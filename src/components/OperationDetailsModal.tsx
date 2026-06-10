import React, { useState, useEffect, useCallback } from 'react';
import { Operation, OperationItem, Product, UserProfile } from '../types';
import { supabase } from '../supabase';
import { X, CheckCircle2, Printer, ShieldCheck, Clock, RotateCcw, AlertTriangle, Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import { generateTicketPDF, TicketItem, TicketOperation } from '../utils/pdfGenerator';

interface OperationDetailsModalProps {
  operation: Operation;
  profile: UserProfile | null;
  onClose: () => void;
  onUpdate: () => void;
}

interface ReturnItem {
  itemId: string;
  productId: string;
  productName: string;
  maxQty: number;
  returnQty: number;
  unitPrice: number;
}

export default function OperationDetailsModal({ operation, profile, onClose, onUpdate }: OperationDetailsModalProps) {
  const [items, setItems] = useState<OperationItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versionHistory, setVersionHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── État Avoir/Retour ─────────────────────────────────────────────────────
  const [showReturnPanel, setShowReturnPanel] = useState(false);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [creatingReturn, setCreatingReturn] = useState(false);

  // ── Paiement fournisseur à la validation d'un achat (comptes fournisseurs) ──
  const [supplierPaid, setSupplierPaid] = useState('');
  const [supplierEcheance, setSupplierEcheance] = useState('');

  const isAdmin = profile?.roleId === 'admin';
  const isCashier = profile?.roleId === 'cashier';

  const isAchat = operation.type === 'achat' || (operation as any).type_op === 'achat';

  const isPendingPurchase =
    isAchat &&
    (operation.status === 'en_attente' || (operation as any).statut === 'en_attente');

  const isRetour =
    operation.type === 'retour_client' || (operation as any).type_op === 'retour_client' ||
    operation.type === 'retour_fournisseur' || (operation as any).type_op === 'retour_fournisseur';

  const isRetourFournisseur =
    operation.type === 'retour_fournisseur' || (operation as any).type_op === 'retour_fournisseur';

  // Confidentialité prix d'achat : opérations achat ET retour fournisseur
  // → prix unitaires visibles admin seulement ; pour un caissier, on masque
  //   aussi les totaux (qui permettraient de déduire le prix unitaire)
  const isAchatLike = isAchat || isRetourFournisseur;
  const hidePurchaseAmounts = isAchatLike && isCashier;

  const isValidatedSale =
    (operation.type === 'vente' || (operation as any).type_op === 'vente') &&
    (operation.status === 'validated' || (operation.status as string) === 'valide');

  const isValidatedAchat =
    isAchat &&
    (operation.status === 'validated' || (operation.status as string) === 'valide');

  const grossTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const finalTotal = grossTotal - (operation.discountAmount ?? 0);
  const returnTotal = returnItems.reduce((s, i) => s + i.returnQty * i.unitPrice, 0);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: prodData, error: prodErr } = await supabase.from('produits').select('*');
      if (prodErr) throw prodErr;

      const mappedProducts: Product[] = (prodData || []).map((p) => ({
        id: p.code,
        code: p.code,
        name: p.produit,
        description: p.description,
        unitId: 'u',
        categoryId: 'alimentaire',
        defaultPrice: parseFloat(p.prix_vente || 0),
        purchasePrice: parseFloat(p.pdat || 0),
        stockActual: parseFloat(p.stock_actuel || 0),
        isActive: true,
      }));
      setProducts(mappedProducts);

      const { data: itemsData, error: itemsErr } = await supabase
        .from('operation_items')
        .select('*')
        .eq('operation_id', parseInt(operation.id));

      if (!itemsErr && itemsData && itemsData.length > 0) {
        const fetchedItems: OperationItem[] = itemsData.map((row) => ({
          id: row.id.toString(),
          operationId: row.operation_id.toString(),
          productId: row.produit_id,
          quantity: parseFloat(row.quantite || 0),
          unitPrice: parseFloat(row.prix_unitaire || 0),
          lineTotal: parseFloat(row.total_ligne || 0),
          discountAmount: 0,
        }));
        setItems(fetchedItems);
      } else {
        // Fallback ancienne architecture
        const { data: opData, error: opErr } = await supabase
          .from('operations')
          .select('*')
          .eq('num_op', parseInt(operation.id))
          .single();
        if (opErr) throw opErr;
        if (opData?.code_produit) {
          setItems([{
            id: opData.num_op.toString(),
            operationId: opData.num_op.toString(),
            productId: opData.code_produit,
            quantity: parseFloat(opData.qte || 0),
            unitPrice: parseFloat(opData.prix_dh || 0),
            lineTotal: parseFloat(opData.total_dh || 0),
            discountAmount: parseFloat(opData.remise_dh || 0),
          }]);
        } else {
          setItems([]);
        }
      }

      // Préremplissage du paiement fournisseur (achat en attente) depuis l'en-tête
      const pending = (operation as any).statut === 'en_attente' || operation.status === 'en_attente';
      if (pending) {
        const { data: opRow } = await supabase
          .from('operations')
          .select('montant_paye, date_echeance')
          .eq('num_op', parseInt(operation.id))
          .single();
        if (opRow) {
          const mp = parseFloat(opRow.montant_paye || 0);
          setSupplierPaid(mp > 0.01 ? String(mp) : '');
          setSupplierEcheance(opRow.date_echeance || '');
        }
      }
    } catch (err) {
      console.error('fetchData error:', err);
    } finally {
      setLoading(false);
    }
  }, [operation.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Impression ticket PDF ─────────────────────────────────────────────────
  const handlePrint = () => {
    const ticketItems: TicketItem[] = items.map((item) => {
      const p = products.find((pr) => pr.id === item.productId);
      return {
        productId: item.productId,
        productCode: p?.code || item.productId,
        productName: p?.name || item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      };
    });
    let dateStr = '';
    let timeStr = '';
    try {
      const d = (operation.createdAt as any)?.toDate
        ? (operation.createdAt as any).toDate()
        : new Date(operation.createdAt as any);
      dateStr = d.toISOString().split('T')[0];
      timeStr = d.toTimeString().split(' ')[0];
    } catch {
      dateStr = new Date().toISOString().split('T')[0];
      timeStr = '00:00:00';
    }
    const ticketOp: TicketOperation = {
      id: operation.operationNumber || operation.id,
      type: (operation.type === 'retour_client' ? 'vente' : operation.type) as 'vente' | 'achat',
      date: dateStr,
      time: timeStr,
      cashierName: profile?.username,
      grossTotal,
      discountAmount: operation.discountAmount ?? 0,
      finalTotal,
    };
    generateTicketPDF(ticketOp, ticketItems);
  };

  // ── Modification quantité / prix (pending purchase only) ─────────────────
  const handleQuantityChange = (itemId: string, newQty: number) => {
    setItems((prev) => prev.map((i) =>
      i.id === itemId
        ? { ...i, quantity: Math.max(1, newQty), lineTotal: i.unitPrice * Math.max(1, newQty) }
        : i
    ));
  };

  const handlePriceChange = (itemId: string, newPrice: number) => {
    setItems((prev) => prev.map((i) =>
      i.id === itemId
        ? { ...i, unitPrice: newPrice, lineTotal: newPrice * i.quantity }
        : i
    ));
  };

  // ── Historique des versions ───────────────────────────────────────────────
  const fetchVersionHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data } = await supabase
        .from('operation_history')
        .select('*')
        .eq('operation_id', parseInt(operation.id))
        .order('version', { ascending: false });
      const rows = data || [];
      const agentUuids = [...new Set(rows.map((r: any) => r.modified_by).filter(Boolean))];
      const agentMap: Record<string, string> = {};
      if (agentUuids.length > 0) {
        const { data: agents } = await supabase
          .from('utilisateurs')
          .select('id, nom, username')
          .in('id', agentUuids);
        (agents || []).forEach((a: any) => { agentMap[a.id] = a.nom || a.username || '—'; });
      }
      setVersionHistory(rows.map((r: any) => ({
        ...r,
        _agentName: agentMap[r.modified_by] || r.modified_by || '—',
      })));
    } catch {
      setVersionHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [operation.id]);

  const handleToggleHistory = () => {
    if (!showHistory) fetchVersionHistory();
    setShowHistory(v => !v);
  };

  useEffect(() => {
    if (operation.isModified) fetchVersionHistory();
  }, [operation.isModified, fetchVersionHistory]);

  // ── Validation Achat Admin ────────────────────────────────────────────────
  const supplierPaidNum = parseFloat(supplierPaid || '0') || 0;
  const supplierReste = Math.max(0, finalTotal - supplierPaidNum);

  const handleValidatePurchase = async () => {
    if (!isAdmin || !isPendingPurchase) return;

    // Règles comptes fournisseurs : montant payé ≤ total ; échéance obligatoire si solde restant
    if (supplierPaidNum < 0 || supplierPaidNum > finalTotal + 0.01) {
      alert(`Le montant payé (${supplierPaidNum.toFixed(2)} DH) doit être compris entre 0 et le total de l'achat (${finalTotal.toFixed(2)} DH).`);
      return;
    }
    if (supplierReste > 0.01 && !supplierEcheance) {
      alert(`Un solde de ${supplierReste.toFixed(2)} DH reste dû au fournisseur.\nLa date d'échéance est obligatoire pour les paiements partiels.`);
      return;
    }

    setValidating(true);
    try {
      const { error: statusErr } = await supabase
        .from('operations')
        .update({
          statut: 'valide',
          observ: 'Achat validé par admin',
          total_dh: finalTotal,
          // Le paiement réellement effectué au fournisseur — corrige la colonne
          // "Paiement" de l'historique qui affichait l'ancien montant pré-validation
          montant_paye: supplierPaidNum,
          reste_a_payer: supplierReste,
          statut_paiement: supplierReste <= 0.01 ? 'Payé' : (supplierPaidNum > 0.01 ? 'Partiel' : 'Crédit'),
          date_echeance: supplierReste > 0.01 ? supplierEcheance : null,
        })
        .eq('num_op', parseInt(operation.id));
      if (statusErr) throw statusErr;

      for (const item of items) {
        await supabase
          .from('operation_items')
          .update({ quantite: item.quantity, prix_unitaire: item.unitPrice, total_ligne: item.lineTotal })
          .eq('id', parseInt(item.id));
      }

      const stockErrors: string[] = [];
      for (const item of items) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) continue;
        // RPC atomique : entrée en stock + cumul qte_achat + pdat réel — sans course
        const { error: rpcErr } = await supabase.rpc('apply_stock_delta', {
          p_code: product.code,
          p_delta_stock: item.quantity,
          p_delta_qte_achat: item.quantity,
          p_new_pdat: item.unitPrice,
        });
        if (rpcErr) {
          const msg = `${product.code}: ${rpcErr.message}`;
          console.error('[handleValidatePurchase] stock update failed —', msg);
          stockErrors.push(msg);
        }
      }

      if (stockErrors.length > 0) {
        alert(
          `Achat validé, mais ${stockErrors.length} mise(s) à jour de stock ont échoué :\n` +
          stockErrors.join('\n') +
          '\nVérifiez le stock manuellement dans le catalogue.'
        );
      }
      onUpdate();
      onClose();
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la validation de l'achat: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setValidating(false);
    }
  };

  // ── Création Avoir / Retour ───────────────────────────────────────────────
  const openReturnPanel = () => {
    setReturnItems(
      items.map((i) => ({
        itemId: i.id,
        productId: i.productId,
        productName: products.find((p) => p.id === i.productId)?.name || i.productId,
        maxQty: i.quantity,
        returnQty: i.quantity, // défaut : retour total
        unitPrice: i.unitPrice,
      }))
    );
    setShowReturnPanel(true);
  };

  const updateReturnQty = (itemId: string, qty: number) => {
    setReturnItems((prev) =>
      prev.map((i) =>
        i.itemId === itemId
          ? { ...i, returnQty: Math.max(0, Math.min(i.maxQty, qty)) }
          : i
      )
    );
  };

  const handleCreateReturn = async () => {
    if (!isAdmin) return;
    const toReturn = returnItems.filter((i) => i.returnQty > 0);
    if (toReturn.length === 0) {
      alert('Veuillez sélectionner au moins un article à retourner.');
      return;
    }
    setCreatingReturn(true);

    // Determine if this is a purchase return or a sale return
    const returnForPurchase = isAchat;
    const returnTypeOp = returnForPurchase ? 'retour_fournisseur' : 'retour_client';

    try {
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
      const timeStr = new Date().toTimeString().split(' ')[0];
      const total = toReturn.reduce((s, i) => s + i.returnQty * i.unitPrice, 0);

      // 1. Créer l'opération retour
      const { data: returnOp, error: returnErr } = await supabase
        .from('operations')
        .insert({
          date_op: todayStr,
          heure_op: timeStr,
          type_op: returnTypeOp,
          total_dh: total,
          remise_dh: 0,
          utilisateur_id: profile?.id,
          client_id: returnForPurchase ? null : ((operation as any).clientId || (operation as any).client_id || null),
          fournisseur_id: returnForPurchase ? ((operation as any).fournisseur_id || null) : null,
          statut: 'valide',
          parent_op_id: parseInt(operation.id),
          observ: returnForPurchase
            ? `Retour fournisseur sur ${operation.operationNumber}`
            : `Avoir sur ${operation.operationNumber}`,
          condition_paiement: 'Espèce',
        })
        .select()
        .single();

      if (returnErr) throw returnErr;

      // 2. Insérer les lignes articles
      const { error: itemsErr } = await supabase
        .from('operation_items')
        .insert(
          toReturn.map((i) => ({
            operation_id: returnOp.num_op,
            produit_id: i.productId,
            quantite: i.returnQty,
            prix_unitaire: i.unitPrice,
            total_ligne: i.returnQty * i.unitPrice,
          }))
        );
      if (itemsErr) throw itemsErr;

      // 3. Mise à jour du stock
      // • retour_client → RECRÉDITE le stock (on reprend la marchandise)
      // • retour_fournisseur → DÉCRÉDITE le stock (on rend la marchandise)
      for (const item of toReturn) {
        try {
          const { data: prod } = await supabase
            .from('produits')
            .select('stock_actuel, prix_vente, qte_vente, qte_achat')
            .eq('code', item.productId)
            .single();
          if (prod) {
            const currentStock = parseFloat(prod.stock_actuel || 0);
            const price = parseFloat(prod.prix_vente || 0);

            if (returnForPurchase) {
              // Retour fournisseur: DECREASE stock
              const newStock = Math.max(0, currentStock - item.returnQty);
              await supabase.from('produits').update({
                stock_actuel: newStock,
                valeur_stock: newStock * price,
                qte_achat: Math.max(0, parseFloat(prod.qte_achat || 0) - item.returnQty),
              }).eq('code', item.productId);
            } else {
              // Retour client: INCREASE stock
              const newStock = currentStock + item.returnQty;
              await supabase.from('produits').update({
                stock_actuel: newStock,
                valeur_stock: newStock * price,
                qte_vente: Math.max(0, parseFloat(prod.qte_vente || 0) - item.returnQty),
              }).eq('code', item.productId);
            }
          }
        } catch (e) {
          console.error('[Return] stock update failed:', item.productId, e);
        }
      }

      setShowReturnPanel(false);
      onUpdate();
      onClose();
      const label = returnForPurchase ? 'Retour fournisseur' : 'Avoir';
      alert(`✅ ${label} OP-${String(returnOp.num_op).padStart(4, '0')} créé — stock mis à jour.`);
    } catch (err) {
      alert('Erreur création retour : ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCreatingReturn(false);
    }
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  const typeLabel =
    isRetourFournisseur ? 'Retour Fournisseur' :
    isRetour ? 'Avoir / Retour Client' :
    operation.type === 'vente' ? 'Vente' :
    operation.type === 'achat' ? 'Achat' :
    operation.type;

  const typeBadgeCn = isRetourFournisseur
    ? 'bg-blue-100 text-blue-700'
    : isRetour
    ? 'bg-purple-100 text-purple-700'
    : operation.type === 'vente'
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-blue-100 text-blue-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-4xl bg-white rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* ── Header ── */}
        <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
          <div>
            <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3 flex-wrap">
              Détails Opération {operation.operationNumber}
              <span className={cn('px-2 py-1 rounded-lg text-[10px] font-black tracking-wider uppercase', typeBadgeCn)}>
                {typeLabel}
              </span>
              <span className={cn(
                'px-2 py-1 rounded-lg text-[10px] font-black tracking-wider uppercase',
                isPendingPurchase ? 'bg-orange-400 text-white' :
                operation.status === 'validated' || (operation.status as string) === 'valide' ? 'bg-emerald-500 text-white' :
                operation.status === 'cancelled' ? 'bg-rose-500 text-white' : 'bg-slate-300 text-slate-700'
              )}>
                {isPendingPurchase ? 'En attente admin' :
                 (operation.status === 'validated' || (operation.status as string) === 'valide') ? 'Validé' :
                 operation.status === 'cancelled' ? 'Annulé' : operation.status}
              </span>
              {operation.isModified && (
                <span className="px-2 py-1 rounded-lg text-[10px] font-black tracking-wider uppercase bg-amber-100 text-amber-700">
                  Modifiée v{operation.version ?? '?'}
                </span>
              )}
              {/* Badge lien parent pour les avoirs */}
              {operation.parentOpId && (
                <span className="px-2 py-1 rounded-lg text-[10px] font-black tracking-wider uppercase bg-purple-100 text-purple-700">
                  ↩ OP-{String(operation.parentOpId).padStart(4, '0')}
                </span>
              )}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {!isPendingPurchase && !hidePurchaseAmounts && (
              <button onClick={handlePrint} className="p-2 hover:bg-slate-200 text-slate-500 rounded-xl transition-all" title="Imprimer Ticket PDF">
                <Printer className="h-5 w-5" />
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-900">
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* ── Bandeau immutabilité pour ventes validées ── */}
        {isValidatedSale && !isRetour && (
          <div className="mx-6 mt-4 p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <p className="text-xs font-bold text-slate-600">
              Opération validée — <span className="text-emerald-700">inaltérable</span>.
              Les montants et articles ne peuvent plus être modifiés. Utilisez un Avoir pour corriger.
            </p>
          </div>
        )}

        {/* ── Alerte achat en attente + paiement fournisseur ── */}
        {isPendingPurchase && isAdmin && (
          <div className="mx-6 mt-4 bg-orange-50 border border-orange-200 rounded-2xl overflow-hidden">
            <div className="p-4 flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-orange-500 shrink-0" />
              <div>
                <p className="text-sm font-black text-orange-800">Achat en attente de validation</p>
                <p className="text-xs text-orange-600">Vérifiez les prix, renseignez le paiement fournisseur, puis validez pour mettre à jour le stock.</p>
              </div>
            </div>
            <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-orange-700 uppercase tracking-widest">Montant payé au fournisseur (DH)</label>
                <div className="flex gap-1.5">
                  <input
                    type="number" step="0.01" min="0"
                    className="w-full bg-white border border-orange-200 rounded-xl py-2 px-3 text-sm font-black text-slate-800 focus:ring-2 focus:ring-orange-400/30"
                    placeholder="0.00"
                    value={supplierPaid}
                    onChange={(e) => setSupplierPaid(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setSupplierPaid(finalTotal.toFixed(2))}
                    className="shrink-0 px-2.5 py-1 text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-all"
                    title="Achat intégralement payé"
                  >
                    TOUT
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-orange-700 uppercase tracking-widest">
                  Date échéance {supplierReste > 0.01 && <span className="text-rose-600">*obligatoire</span>}
                </label>
                <input
                  type="date"
                  className={cn(
                    'w-full bg-white border rounded-xl py-2 px-3 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-orange-400/30',
                    supplierReste > 0.01 && !supplierEcheance ? 'border-rose-400' : 'border-orange-200'
                  )}
                  value={supplierEcheance}
                  onChange={(e) => setSupplierEcheance(e.target.value)}
                  disabled={supplierReste <= 0.01}
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black text-orange-700 uppercase tracking-widest">Reste dû au fournisseur</p>
                <p className={cn(
                  'py-2 px-3 rounded-xl text-sm font-black border',
                  supplierReste > 0.01 ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                )}>
                  {supplierReste > 0.01 ? `${supplierReste.toFixed(2)} DH` : 'Soldé ✓'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Bandeau retour_client ── */}
        {isRetour && !isRetourFournisseur && (
          <div className="mx-6 mt-4 p-3 bg-purple-50 border border-purple-200 rounded-2xl flex items-center gap-3">
            <RotateCcw className="h-4 w-4 text-purple-500 shrink-0" />
            <p className="text-xs font-bold text-purple-700">
              Avoir / Retour client — le stock a été recrédité automatiquement lors de la création de cet avoir.
            </p>
          </div>
        )}
        {/* ── Bandeau retour_fournisseur ── */}
        {isRetourFournisseur && (
          <div className="mx-6 mt-4 p-3 bg-blue-50 border border-blue-200 rounded-2xl flex items-center gap-3">
            <RotateCcw className="h-4 w-4 text-blue-500 shrink-0" />
            <p className="text-xs font-bold text-blue-700">
              Retour fournisseur — le stock a été décrémenté automatiquement lors de la création de ce retour.
            </p>
          </div>
        )}

        {/* ── Content ── */}
        <div className="p-6 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="h-8 w-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Métadonnées */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</p>
                  <p className="text-sm font-bold text-slate-900">
                    {(() => { try { const d = (operation.createdAt as any)?.toDate ? (operation.createdAt as any).toDate() : new Date(operation.createdAt as any); return d.toLocaleDateString('fr-FR'); } catch { return '—'; } })()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Heure</p>
                  <p className="text-sm font-bold text-slate-900">
                    {(() => { try { const d = (operation.createdAt as any)?.toDate ? (operation.createdAt as any).toDate() : new Date(operation.createdAt as any); return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } })()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Agent</p>
                  <p className="text-sm font-bold text-slate-900">{(operation as any).agentName || profile?.username || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {isAchat ? 'Fournisseur' : 'Client'}
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {isAchat
                      ? ((operation as any).fournisseurName || 'Aucun fournisseur renseigné')
                      : ((operation as any).clientName || 'Sans client')}
                  </p>
                </div>
                {/* Lien vers la vente originale si avoir */}
                {operation.parentOpId && (
                  <div>
                    <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Avoir sur</p>
                    <p className="text-sm font-bold text-purple-700">
                      OP-{String(operation.parentOpId).padStart(4, '0')}
                    </p>
                  </div>
                )}
                {(operation as any).condition_paiement && (
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Paiement</p>
                    <p className="text-sm font-bold text-slate-900">
                      {(operation as any).condition_paiement}
                      {(operation as any).ref_paiement && (
                        <span className="ml-2 text-xs text-slate-500 font-medium">
                          — Réf: {(operation as any).ref_paiement}
                        </span>
                      )}
                    </p>
                  </div>
                )}
                {operation.observation && (
                  <div className="col-span-2 sm:col-span-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Observation</p>
                    <p className="text-sm text-slate-700">{operation.observation}</p>
                  </div>
                )}
                {operation.isModified && historyLoading && (
                  <div className="col-span-2 sm:col-span-4 flex items-center gap-2">
                    <div className="h-3 w-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Chargement modificateur...</p>
                  </div>
                )}
                {operation.isModified && !historyLoading && versionHistory.length > 0 && (
                  <div className="col-span-2 sm:col-span-4">
                    <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Dernière modification</p>
                    <p className="text-sm font-bold text-amber-800">
                      Par {versionHistory[0]._agentName || '—'}
                      <span className="ml-2 font-medium text-amber-600 text-xs">
                        · {versionHistory[0].modified_at ? new Date(versionHistory[0].modified_at).toLocaleString('fr-FR') : '—'}
                      </span>
                    </p>
                  </div>
                )}
              </div>

              {/* Historique des modifications */}
              {operation.isModified && isAdmin && (
                <div>
                  <button
                    onClick={handleToggleHistory}
                    className="flex items-center gap-2 text-xs font-bold text-amber-700 hover:text-amber-900 transition-colors"
                  >
                    <Clock className="h-4 w-4" />
                    {showHistory ? 'Masquer' : 'Voir'} l&apos;historique des modifications (v{operation.version ?? '?'})
                  </button>
                  {showHistory && (
                    <div className="mt-3 border border-amber-200 rounded-2xl overflow-hidden">
                      {historyLoading ? (
                        <div className="p-4 text-center text-sm text-slate-400 font-bold">Chargement...</div>
                      ) : versionHistory.length === 0 ? (
                        <div className="p-4 text-center text-sm text-slate-400 font-bold">Aucun historique disponible.</div>
                      ) : (
                        <div className="divide-y divide-amber-100">
                          {versionHistory.map((h) => {
                            const snapItems: any[] = h.snapshot?.items || [];
                            const total = h.snapshot?.total_dh;
                            return (
                              <div key={h.id}>
                                <div className="bg-amber-50 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                                  <span className="px-2 py-0.5 bg-amber-200 text-amber-900 text-[10px] font-black rounded-lg uppercase tracking-wider">v{h.version}</span>
                                  <span className="text-xs text-slate-500">{h.modified_at ? new Date(h.modified_at).toLocaleString('fr-FR') : '—'}</span>
                                  <span className="text-xs font-bold text-slate-600">Agent : {h._agentName || '—'}</span>
                                  {total != null && (
                                    <span className="ml-auto text-xs font-black text-emerald-700">{parseFloat(total).toFixed(2)} DH</span>
                                  )}
                                </div>
                                {snapItems.length > 0 ? (
                                  <table className="w-full text-xs">
                                    <thead className="bg-slate-50 border-b border-slate-100">
                                      <tr>
                                        <th className="px-4 py-1.5 text-left font-black text-slate-400 uppercase tracking-widest">Produit</th>
                                        <th className="px-4 py-1.5 text-right font-black text-slate-400 uppercase tracking-widest">Qté</th>
                                        <th className="px-4 py-1.5 text-right font-black text-slate-400 uppercase tracking-widest">P.U. (DH)</th>
                                        <th className="px-4 py-1.5 text-right font-black text-slate-400 uppercase tracking-widest">Total (DH)</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                      {snapItems.map((item: any, idx: number) => {
                                        const p = products.find((pr) => pr.id === item.productId);
                                        return (
                                          <tr key={idx} className="hover:bg-slate-50/50">
                                            <td className="px-4 py-1.5 text-slate-700">
                                              <span className="font-mono text-slate-400 text-[10px] mr-1">{item.productId}</span>
                                              {p?.name || item.productId}
                                            </td>
                                            <td className="px-4 py-1.5 text-right font-bold text-slate-700">{item.quantity}</td>
                                            <td className="px-4 py-1.5 text-right text-slate-600">{parseFloat(item.unitPrice ?? 0).toFixed(2)}</td>
                                            <td className="px-4 py-1.5 text-right font-black text-slate-900">{parseFloat(item.lineTotal ?? 0).toFixed(2)}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                ) : (
                                  <p className="px-4 py-2 text-xs text-slate-400 italic">Aucun article dans ce snapshot.</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Tableau des articles */}
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase text-[10px] tracking-widest">Produit</th>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase text-[10px] tracking-widest">QTE</th>
                      {(!isAchatLike || isAdmin) && (
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase text-[10px] tracking-widest text-right">
                          {isPendingPurchase ? 'Prix Achat (DH)' : 'Prix U. (DH)'}
                        </th>
                      )}
                      {!hidePurchaseAmounts && (
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase text-[10px] tracking-widest text-right">Total (DH)</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={hidePurchaseAmounts ? 2 : 4} className="px-4 py-8 text-center text-slate-400 font-bold">Aucun article trouvé</td>
                      </tr>
                    ) : items.map((item) => {
                      const p = products.find((pr) => pr.id === item.productId);
                      return (
                        <tr key={item.id}>
                          <td className="px-4 py-3 font-bold text-slate-900">
                            <span className="font-mono text-slate-400 text-xs mr-2">{item.productId}</span>
                            {p?.name || item.productId}
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-700">
                            {(isPendingPurchase && isAdmin) ? (
                              <input
                                type="number"
                                className="w-20 text-center bg-slate-50 border border-slate-200 rounded-lg p-1 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                value={item.quantity}
                                onChange={(e) => handleQuantityChange(item.id, Number(e.target.value))}
                              />
                            ) : (
                              item.quantity
                            )}
                          </td>
                          {(!isAchatLike || isAdmin) && (
                            <td className="px-4 py-3 text-right">
                              {(isPendingPurchase && isAdmin) ? (
                                <div className="flex flex-col items-end gap-0.5">
                                  <input
                                    type="number"
                                    step="0.01"
                                    className="w-24 text-right bg-slate-50 border border-slate-200 rounded-lg p-1 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                                    value={item.unitPrice}
                                    onChange={(e) => handlePriceChange(item.id, Number(e.target.value))}
                                  />
                                  {(() => {
                                    const ref = products.find((pr) => pr.id === item.productId);
                                    return ref?.purchasePrice != null && ref.purchasePrice > 0 ? (
                                      <span className="text-[10px] text-slate-400 font-medium">réf: {ref.purchasePrice.toFixed(2)} DH</span>
                                    ) : null;
                                  })()}
                                </div>
                              ) : (
                                <span className="font-bold text-slate-700">{item.unitPrice.toFixed(2)}</span>
                              )}
                            </td>
                          )}
                          {!hidePurchaseAmounts && (
                            <td className="px-4 py-3 font-black text-slate-900 text-right">{item.lineTotal.toFixed(2)}</td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totaux + bouton Avoir */}
              <div className="flex justify-between items-start">
                <div>
                  {/* Bouton retour client — ventes validées, admin seulement */}
                  {isAdmin && isValidatedSale && !isRetour && !showReturnPanel && (
                    <button
                      onClick={openReturnPanel}
                      className="flex items-center gap-2 px-5 py-2.5 bg-purple-50 border border-purple-200 text-purple-700 font-black rounded-xl hover:bg-purple-100 transition-all text-sm"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Créer un Avoir / Retour client
                    </button>
                  )}
                  {/* Bouton retour fournisseur — achats validés, admin seulement */}
                  {isAdmin && isValidatedAchat && !isRetour && !showReturnPanel && (
                    <button
                      onClick={openReturnPanel}
                      className="flex items-center gap-2 px-5 py-2.5 bg-blue-50 border border-blue-200 text-blue-700 font-black rounded-xl hover:bg-blue-100 transition-all text-sm"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Créer un Retour Fournisseur
                    </button>
                  )}
                  {showReturnPanel && (
                    <button
                      onClick={() => setShowReturnPanel(false)}
                      className="px-5 py-2.5 bg-slate-100 text-slate-500 font-bold rounded-xl hover:bg-slate-200 transition-all text-sm"
                    >
                      Annuler l'avoir
                    </button>
                  )}
                </div>
                {hidePurchaseAmounts ? (
                  <div className="w-64 bg-slate-50 p-4 rounded-2xl border border-slate-200 flex items-center gap-3">
                    <Lock className="h-4 w-4 text-slate-400 shrink-0" />
                    <p className="text-xs font-bold text-slate-500">
                      Montants confidentiels — réservés à l'administration.
                    </p>
                  </div>
                ) : (
                  <div className="w-64 space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                    <div className="flex justify-between items-center text-sm font-bold text-slate-600">
                      <span>Sous-total:</span>
                      <span>{grossTotal.toFixed(2)} DH</span>
                    </div>
                    {(operation.discountAmount ?? 0) > 0 && (
                      <div className="flex justify-between items-center text-sm font-bold text-emerald-600">
                        <span>Remise:</span>
                        <span>-{(operation.discountAmount ?? 0).toFixed(2)} DH</span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                      <span className="font-black text-slate-900">TOTAL:</span>
                      <span className={cn('text-xl font-black', isRetour ? 'text-purple-600' : 'text-emerald-600')}>
                        {finalTotal.toFixed(2)} DH
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Panel Création Retour ── */}
              {showReturnPanel && (
                <div className={cn('border-2 rounded-2xl overflow-hidden', isAchat ? 'border-blue-200' : 'border-purple-200')}>
                  <div className={cn('px-5 py-4 flex items-center gap-3 border-b', isAchat ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-200')}>
                    <RotateCcw className={cn('h-5 w-5 shrink-0', isAchat ? 'text-blue-600' : 'text-purple-600')} />
                    <div>
                      <p className={cn('text-sm font-black', isAchat ? 'text-blue-900' : 'text-purple-900')}>
                        {isAchat ? 'Retour Fournisseur' : 'Avoir / Retour Client'}
                      </p>
                      <p className={cn('text-xs', isAchat ? 'text-blue-600' : 'text-purple-600')}>
                        {isAchat
                          ? 'Définissez les quantités retournées au fournisseur. Le stock sera décrémenté.'
                          : 'Définissez les quantités retournées. Un avoir sera créé et le stock re-crédité.'}
                      </p>
                    </div>
                  </div>
                  <div className="p-4 space-y-2">
                    {returnItems.map((ri) => (
                      <div key={ri.itemId} className="flex items-center gap-4 py-2 border-b border-slate-100 last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">{ri.productName}</p>
                          <p className="text-xs text-slate-400 font-medium font-mono">{ri.productId} · {ri.unitPrice.toFixed(2)} DH/u</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-slate-400 font-medium">
                            sur {ri.maxQty}
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={ri.maxQty}
                            step={1}
                            value={ri.returnQty}
                            onChange={(e) => updateReturnQty(ri.itemId, Number(e.target.value))}
                            className="w-16 text-center bg-white border-2 border-purple-300 rounded-lg py-1.5 text-sm font-black text-purple-800 focus:ring-2 focus:ring-purple-400/30 focus:border-purple-500"
                          />
                        </div>
                        <div className="text-right min-w-[60px]">
                          <p className={cn('text-sm font-black', ri.returnQty > 0 ? 'text-purple-700' : 'text-slate-300')}>
                            {(ri.returnQty * ri.unitPrice).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Total retour + bouton confirmer */}
                  <div className={cn('px-5 py-4 border-t flex items-center justify-between', isAchat ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-200')}>
                    <div>
                      <p className={cn('text-[10px] font-black uppercase tracking-widest', isAchat ? 'text-blue-400' : 'text-purple-400')}>
                        Total retour
                      </p>
                      <p className={cn('text-xl font-black', isAchat ? 'text-blue-700' : 'text-purple-700')}>{returnTotal.toFixed(2)} DH</p>
                    </div>
                    <button
                      onClick={handleCreateReturn}
                      disabled={creatingReturn || returnTotal < 0.01}
                      className={cn(
                        'flex items-center gap-2 px-6 py-3 text-white font-black rounded-2xl transition-all shadow-lg disabled:opacity-50 text-sm',
                        isAchat
                          ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20'
                          : 'bg-purple-600 hover:bg-purple-700 shadow-purple-500/20'
                      )}
                    >
                      {creatingReturn ? (
                        <span className="animate-pulse">Création en cours...</span>
                      ) : (
                        <>
                          <RotateCcw className="h-4 w-4" />
                          {isAchat ? 'CONFIRMER LE RETOUR' : 'CONFIRMER L\'AVOIR'}
                        </>
                      )}
                    </button>
                  </div>
                  <div className="bg-amber-50 border-t border-amber-100 px-5 py-3 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-700 font-medium">
                      {isAchat
                        ? `Cette action est irréversible. Le stock sera décrémenté des articles retournés au fournisseur.`
                        : `Cette action est irréversible. Un avoir lié à ${operation.operationNumber} sera créé et le stock sera immédiatement recrédité.`}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {!loading && (
          <div className="p-6 border-t border-slate-200 bg-slate-50 shrink-0 flex justify-end gap-3">
            {isAdmin && isPendingPurchase && (
              <button
                onClick={handleValidatePurchase}
                disabled={validating}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 px-8 rounded-2xl flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
              >
                {validating ? (
                  <span className="animate-pulse">VALIDATION EN COURS...</span>
                ) : (
                  <>
                    <ShieldCheck className="h-5 w-5" />
                    VALIDER L'ACHAT &amp; METTRE À JOUR STOCK
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
