import React, { useState, useEffect, useCallback } from 'react';
import { UserProfile } from '../types';
import { supabase, createSecondaryClient } from '../supabase';
import {
  Settings,
  Users,
  Shield,
  Database,
  RefreshCw,
  UserCheck,
  UserX,
  Plus,
  X,
  Mail,
  Lock,
  Loader2,
  UploadCloud,
  FileSpreadsheet,
  BarChart3,
  Building2,
  Edit2,
  Phone,
  MapPin,
  Trash2,
  BadgeCheck,
  ChevronRight,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast, askConfirm } from '../lib/notify';
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart, Pie, Cell,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminProps {
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
}

type AdminTab = 'analytique' | 'utilisateurs' | 'fournisseurs' | 'systeme';

const TABS: { id: AdminTab; label: string; icon: React.ElementType }[] = [
  { id: 'analytique',   label: 'Analytique',   icon: BarChart3   },
  { id: 'utilisateurs', label: 'Utilisateurs', icon: Users       },
  { id: 'fournisseurs', label: 'Fournisseurs', icon: Building2   },
  { id: 'systeme',      label: 'Système',      icon: Settings    },
];

// ─── Chart constants ─────────────────────────────────────────────────────────
const PIE_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16'];
const PAIEMENT_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'];
const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Admin({ profile }: AdminProps) {

  // ── Tab ───────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<AdminTab>('analytique');

  // ── Utilisateurs ─────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newNom, setNewNom] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'tresorier' | 'cashier'>('cashier');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // ── Import CSV ────────────────────────────────────────────────────────────
  const [showImport, setShowImport] = useState(false);
  const [importType, setImportType] = useState<'products' | 'clients'>('products');
  const [csvData, setCsvData] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // ── Fournisseurs ─────────────────────────────────────────────────────────
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [loadingFournisseurs, setLoadingFournisseurs] = useState(true);
  const [achatsMap, setAchatsMap] = useState<Record<number, number>>({});
  const [showFournisseurModal, setShowFournisseurModal] = useState(false);
  const [editingFournisseurId, setEditingFournisseurId] = useState<number | null>(null);
  const [savingFournisseur, setSavingFournisseur] = useState(false);
  const [fournisseurForm, setFournisseurForm] = useState<{
    type: 'Société' | 'Personne physique';
    nom: string;
    num_telephone: string;
    adresse: string;
    irc: string;
    ice: string;
    cin: string;
  }>({
    type: 'Personne physique',
    nom: '',
    num_telephone: '',
    adresse: '',
    irc: '',
    ice: '',
    cin: '',
  });

  // ── Analytique ────────────────────────────────────────────────────────────
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  // '' = rolling 12 months (default) | 'YYYY-MM' = specific month filter
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [kpis, setKpis] = useState({ caMois: 0, valeurStock: 0, margeBrute: 0, achatsMois: 0, chargesMois: 0, beneficeNet: 0 });
  const [caMonthly, setCaMonthly] = useState<{ mois: string; CA: number; Achats: number; Charges: number }[]>([]);
  const [topProduits, setTopProduits] = useState<{ name: string; qte: number }[]>([]);
  const [caCategorie, setCaCategorie] = useState<{ name: string; value: number }[]>([]);
  const [paiementsPie, setPaiementsPie] = useState<{ name: string; value: number }[]>([]);
  // F5 — CA par canal de vente (colonne canal_vente, enfin exploitée)
  const [canalCA, setCanalCA] = useState<{ name: string; value: number }[]>([]);
  const [topClients, setTopClients] = useState<{ nom: string; total: number }[]>([]);
  const [topFournisseursData, setTopFournisseursData] = useState<{ nom: string; total: number }[]>([]);

  // ── Créances ──────────────────────────────────────────────────────────────
  const [debtKpis, setDebtKpis] = useState({ totalDette: 0, nbOperations: 0, pctDetteVsCA: 0 });

  // ── Suppression utilisateur ───────────────────────────────────────────────
  const [showDeleteUser, setShowDeleteUser] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchUsers();
    fetchFournisseurs();
    fetchAchatsParFournisseur();
    fetchAnalytics();
    fetchDebtKpis();
  }, []);

  // Re-fetch analytics when period filter changes
  useEffect(() => {
    fetchAnalytics();
  }, [selectedPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Utilisateurs — handlers ───────────────────────────────────────────────

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const { data, error } = await supabase
        .from('utilisateurs')
        .select('*')
        .order('username');
      if (error) throw error;
      setUsers((data || []).map(u => {
        const rawRole = u.role_id || u.role || 'caissier';
        const roleId = rawRole === 'admin' ? 'admin' : 'cashier';
        const isActive = u.is_active !== undefined ? u.is_active : (u.actif !== undefined ? u.actif : true);
        return {
          id: u.id,
          username: u.username,
          email: u.email || `${u.username}@gharbfeed.com`,
          roleId,
          isActive,
          createdAt: u.created_at || u.date_creation || new Date().toISOString(),
        } as UserProfile;
      }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const toggleUserStatus = async (user: UserProfile) => {
    try {
      let res = await supabase
        .from('utilisateurs')
        .update({ is_active: !user.isActive })
        .eq('id', user.id);
      if (res.error) {
        res = await supabase
          .from('utilisateurs')
          .update({ actif: !user.isActive })
          .eq('id', user.id);
      }
      if (res.error) throw res.error;
      fetchUsers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setIsCreating(true);
    try {
      let authEmail = newUsername.trim().toLowerCase();
      if (!authEmail.includes('@')) authEmail = `${authEmail}@gharbfeed.com`;

      const secondarySupabase = createSecondaryClient();
      const { data: signUpData, error: signUpError } = await secondarySupabase.auth.signUp({
        email: authEmail,
        password: newPassword,
        options: { data: { username: newUsername.trim(), role_id: newRole } },
      });
      if (signUpError) throw signUpError;
      if (!signUpData.user) throw new Error('Erreur de création dans Supabase Auth.');

      const newUserId = signUpData.user.id;
      let res = await supabase.from('utilisateurs').insert({
        id: newUserId,
        username: newUsername.trim(),
        nom: newNom.trim() || newUsername.trim(),
        role_id: newRole === 'admin' ? 'admin' : newRole === 'tresorier' ? 'tresorier' : 'caissier',
        is_active: true,
      });
      if (res.error) {
        res = await supabase.from('utilisateurs').insert({
          id: newUserId,
          username: newUsername.trim(),
          nom: newNom.trim() || newUsername.trim(),
          role: newRole === 'admin' ? 'admin' : newRole === 'tresorier' ? 'tresorier' : 'caissier',
          actif: true,
        });
      }
      if (res.error) throw res.error;

      setShowAddUser(false);
      setNewUsername('');
      setNewNom('');
      setNewPassword('');
      fetchUsers();
    } catch (err: any) {
      const msg = err.message || '';
      if (
        msg.toLowerCase().includes('email') ||
        msg.toLowerCase().includes('rate limit') ||
        msg.toLowerCase().includes('limit exceeded') ||
        msg.toLowerCase().includes('confirmation')
      ) {
        setCreateError("Limite d'emails atteinte. Désactivez 'Confirm email' dans Supabase > Auth > Providers > Email.");
      } else {
        setCreateError(msg || "Erreur lors de la création de l'utilisateur.");
      }
    } finally {
      setIsCreating(false);
    }
  };

  // ── Import CSV — handler ──────────────────────────────────────────────────

  const handleImportCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportError(null);
    setImportSuccess(null);
    setIsImporting(true);
    try {
      const lines = csvData.split('\n').map(l => l.trim()).filter(l => l);
      if (lines.length < 2) throw new Error('Le fichier CSV doit contenir au moins une ligne d\'en-tête et une ligne de données.');

      const isComma = lines[0].includes(',');
      const sep = isComma ? ',' : ';';
      const headers = lines[0].split(sep);
      const getIdx = (name: string) => headers.findIndex(h => h.trim().toUpperCase() === name);

      const itemsToInsert: any[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(sep);
        if (cols.length < 2) continue;
        if (importType === 'products') {
          const codeIdx = getIdx('CODE');
          const nameIdx = getIdx('PRODUIT');
          const descIdx = getIdx('DESCRIPTION');
          const priceIdx = getIdx('PRIX_VENTE');
          const stockIdx = getIdx('STOCK_ACTUEL');
          const code = codeIdx >= 0 && cols[codeIdx] ? cols[codeIdx] : `#P${i}`;
          const name = nameIdx >= 0 && cols[nameIdx] ? cols[nameIdx] : `Produit ${i}`;
          const priceVal = priceIdx >= 0 ? parseFloat(cols[priceIdx].replace(',', '.')) : 0;
          const stockVal = stockIdx >= 0 ? parseFloat(cols[stockIdx].replace(',', '.')) : 0;
          itemsToInsert.push({
            code,
            produit: name,
            description: descIdx >= 0 ? cols[descIdx] : '',
            prix_vente: isNaN(priceVal) ? 0 : priceVal,
            stock_initial: isNaN(stockVal) ? 0 : stockVal,
            stock_actuel: isNaN(stockVal) ? 0 : stockVal,
            qte_achat: 0,
            qte_vente: 0,
            pdat: isNaN(priceVal) ? 0 : priceVal,
            valeur_stock: (isNaN(priceVal) ? 0 : priceVal) * (isNaN(stockVal) ? 0 : stockVal),
          });
        } else if (importType === 'clients') {
          const nameIdx = getIdx('NOM_PRENOM');
          const addressIdx = getIdx('ADRESSE');
          const funcIdx = getIdx('FONCTION');
          const phoneIdx = getIdx('NUM_TELEPHONE');
          const name = nameIdx >= 0 && cols[nameIdx] ? cols[nameIdx] : `Client ${i}`;
          itemsToInsert.push({
            nom_prenom: name,
            adresse: addressIdx >= 0 ? cols[addressIdx] : '',
            fonction: funcIdx >= 0 ? cols[funcIdx] : '',
            num_telephone: phoneIdx >= 0 ? cols[phoneIdx] : '',
          });
        }
      }
      if (itemsToInsert.length > 0) {
        const table = importType === 'products' ? 'produits' : 'clients';
        const { error } = await supabase.from(table).insert(itemsToInsert);
        if (error) throw error;
      }
      setImportSuccess(`${lines.length - 1} éléments importés avec succès !`);
      setCsvData('');
    } catch (err: any) {
      setImportError(err.message || "Erreur lors de l'importation.");
    } finally {
      setIsImporting(false);
    }
  };

  // ── Fournisseurs — handlers ───────────────────────────────────────────────

  const fetchFournisseurs = useCallback(async () => {
    setLoadingFournisseurs(true);
    try {
      const { data, error } = await supabase
        .from('fournisseurs')
        .select('*')
        .order('nom');
      if (error) throw error;
      setFournisseurs(data || []);
    } catch (err) {
      console.error('[Admin] fetchFournisseurs:', err);
    } finally {
      setLoadingFournisseurs(false);
    }
  }, []);

  const fetchAchatsParFournisseur = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('operations')
        .select('fournisseur_id, total_dh')
        .eq('type_op', 'achat')
        .eq('statut', 'valide')
        .not('fournisseur_id', 'is', null);

      const map: Record<number, number> = {};
      (data || []).forEach((op: any) => {
        const id = op.fournisseur_id as number;
        map[id] = (map[id] || 0) + parseFloat(op.total_dh || 0);
      });
      setAchatsMap(map);
    } catch (err) {
      console.error('[Admin] fetchAchatsParFournisseur:', err);
    }
  }, []);

  const openNewFournisseur = () => {
    setEditingFournisseurId(null);
    setFournisseurForm({ type: 'Personne physique', nom: '', num_telephone: '', adresse: '', irc: '', ice: '', cin: '' });
    setShowFournisseurModal(true);
  };

  const openEditFournisseur = (f: Fournisseur) => {
    setEditingFournisseurId(f.id_fournisseur);
    setFournisseurForm({
      type: f.type,
      nom: f.nom,
      num_telephone: f.num_telephone || '',
      adresse: f.adresse || '',
      irc: f.irc || '',
      ice: f.ice || '',
      cin: f.cin || '',
    });
    setShowFournisseurModal(true);
  };

  const handleSaveFournisseur = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingFournisseur(true);
    try {
      const payload = {
        type: fournisseurForm.type,
        nom: fournisseurForm.nom.trim(),
        num_telephone: fournisseurForm.num_telephone.trim() || null,
        adresse: fournisseurForm.adresse.trim() || null,
        irc: fournisseurForm.irc.trim() || null,
        ice: fournisseurForm.ice.trim() || null,
        cin: fournisseurForm.cin.trim() || null,
      };

      if (editingFournisseurId !== null) {
        const { error } = await supabase.from('fournisseurs').update(payload).eq('id_fournisseur', editingFournisseurId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('fournisseurs').insert(payload);
        if (error) throw error;
      }

      setShowFournisseurModal(false);
      setEditingFournisseurId(null);
      fetchFournisseurs();
      fetchAchatsParFournisseur();
    } catch (err: any) {
      toast.error('Erreur : ' + (err.message || String(err)));
    } finally {
      setSavingFournisseur(false);
    }
  };

  const handleDeleteFournisseur = async (id: number) => {
    const ok = await askConfirm({
      title: 'Supprimer ce fournisseur ?',
      message: 'Cette action est irréversible (impossible si des achats lui sont liés).',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from('fournisseurs').delete().eq('id_fournisseur', id);
      if (error) throw error;
      toast.success('Fournisseur supprimé.');
      fetchFournisseurs();
    } catch (err: any) {
      toast.error('Erreur suppression : ' + (err.message || String(err)));
    }
  };

  // ── Analytique — handler ──────────────────────────────────────────────────

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      // ── Plage de dates (timezone Maroc) ───────────────────────────────────
      const todayMA = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
      const [todayYear, todayMonth] = todayMA.split('-').map(Number);

      let startDateStr: string;
      let endDateStr: string | null = null;
      let firstDayThisMonth: string;

      if (selectedPeriod) {
        // Specific month filter
        const [selYear, selMonth] = selectedPeriod.split('-').map(Number);
        const lastDay = new Date(selYear, selMonth, 0).getDate();
        startDateStr = `${selectedPeriod}-01`;
        endDateStr = `${selectedPeriod}-${String(lastDay).padStart(2, '0')}`;
        firstDayThisMonth = startDateStr; // KPIs cover the full selected month
      } else {
        // Rolling 12 months (default)
        firstDayThisMonth = `${todayYear}-${String(todayMonth).padStart(2, '0')}-01`;
        const startD = new Date(todayYear, todayMonth - 1 - 11, 1);
        startDateStr = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, '0')}-01`;
      }

      // ── Requêtes parallèles ───────────────────────────────────────────────
      let opsQuery = supabase
        .from('operations')
        .select('num_op, date_op, type_op, total_dh, client_id, fournisseur_id, condition_paiement, canal_vente')
        .in('type_op', ['vente', 'achat'])
        .eq('statut', 'valide')
        .gte('date_op', startDateStr)
        .order('date_op');
      if (endDateStr) opsQuery = opsQuery.lte('date_op', endDateStr);

      // Charges & dépenses sur la même fenêtre temporelle que les opérations
      let chargesQuery = supabase
        .from('charges')
        .select('date_charge, montant')
        .gte('date_charge', startDateStr);
      if (endDateStr) chargesQuery = chargesQuery.lte('date_charge', endDateStr);

      const [
        { data: opsData },
        { data: produitsData },
        { data: fournsData },
        { data: allAchatsOps },
        { data: chargesData },
      ] = await Promise.all([
        opsQuery,
        supabase.from('produits').select('code, produit, qte_vente, valeur_stock, categorie'),
        supabase.from('fournisseurs').select('id_fournisseur, nom'),
        supabase
          .from('operations')
          .select('fournisseur_id, total_dh')
          .eq('type_op', 'achat')
          .eq('statut', 'valide')
          .not('fournisseur_id', 'is', null),
        chargesQuery,
      ]);

      const ops = opsData || [];
      const produits = produitsData || [];
      const fourn = fournsData || [];
      const allAchats = allAchatsOps || [];
      const charges = chargesData || [];

      // ── KPIs ──────────────────────────────────────────────────────────────
      let caMois = 0, achatsMois = 0, chargesMois = 0;
      ops.forEach((op: any) => {
        if (op.date_op >= firstDayThisMonth) {
          if (op.type_op === 'vente') caMois += parseFloat(op.total_dh || 0);
          else achatsMois += parseFloat(op.total_dh || 0);
        }
      });
      charges.forEach((c: any) => {
        if (c.date_charge >= firstDayThisMonth) chargesMois += parseFloat(c.montant || 0);
      });
      const valeurStock = produits.reduce((s: number, p: any) => s + parseFloat(p.valeur_stock || 0), 0);
      // Bénéfice net réel = CA − Achats − Charges (le vrai résultat du mois)
      setKpis({
        caMois,
        valeurStock,
        margeBrute: caMois - achatsMois,
        achatsMois,
        chargesMois,
        beneficeNet: caMois - achatsMois - chargesMois,
      });

      // ── Données mensuelles ────────────────────────────────────────────────
      // Specific month → single bucket; rolling → 12 buckets (all pre-seeded to 0)
      const monthlyMap: Record<string, { CA: number; Achats: number; Charges: number }> = {};
      if (selectedPeriod) {
        monthlyMap[selectedPeriod] = { CA: 0, Achats: 0, Charges: 0 };
      } else {
        for (let i = 0; i < 12; i++) {
          const d = new Date(todayYear, todayMonth - 1 - 11 + i, 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          monthlyMap[key] = { CA: 0, Achats: 0, Charges: 0 };
        }
      }
      ops.forEach((op: any) => {
        const k = op.date_op?.slice(0, 7);
        if (k && monthlyMap[k]) {
          if (op.type_op === 'vente') monthlyMap[k].CA += parseFloat(op.total_dh || 0);
          else monthlyMap[k].Achats += parseFloat(op.total_dh || 0);
        }
      });
      charges.forEach((c: any) => {
        const k = c.date_charge?.slice(0, 7);
        if (k && monthlyMap[k]) monthlyMap[k].Charges += parseFloat(c.montant || 0);
      });
      setCaMonthly(
        Object.entries(monthlyMap).map(([key, val]) => {
          const [y, m] = key.split('-');
          return {
            mois: `${MONTHS_FR[parseInt(m) - 1]} '${y.slice(2)}`,
            CA: Math.round(val.CA),
            Achats: Math.round(val.Achats),
            Charges: Math.round(val.Charges),
          };
        })
      );

      // ── Top 5 produits ────────────────────────────────────────────────────
      setTopProduits(
        produits
          .filter((p: any) => (p.qte_vente || 0) > 0)
          .sort((a: any, b: any) => b.qte_vente - a.qte_vente)
          .slice(0, 5)
          .map((p: any) => ({
            name: (p.produit || p.code || '').slice(0, 22),
            qte: p.qte_vente,
          }))
      );

      // ── CA par catégorie ──────────────────────────────────────────────────
      const venteOps = ops.filter((op: any) => op.type_op === 'vente');
      const venteOpIds = venteOps.map((op: any) => op.num_op);
      if (venteOpIds.length > 0) {
        const { data: itemsData } = await supabase
          .from('operation_items')
          .select('produit_id, total_ligne')
          .in('operation_id', venteOpIds);
        const produitCatMap: Record<string, string> = {};
        produits.forEach((p: any) => { produitCatMap[p.code] = p.categorie || 'Autre'; });
        const catMap: Record<string, number> = {};
        (itemsData || []).forEach((item: any) => {
          const cat = produitCatMap[item.produit_id] || 'Autre';
          catMap[cat] = (catMap[cat] || 0) + parseFloat(item.total_ligne || 0);
        });
        setCaCategorie(
          Object.entries(catMap)
            .sort(([, a], [, b]) => b - a)
            .map(([name, value]) => ({ name, value: Math.round(value) }))
        );
      }

      // ── Répartition paiements ─────────────────────────────────────────────
      const paiMap: Record<string, number> = {};
      venteOps.forEach((op: any) => {
        const p = op.condition_paiement || 'Espèce';
        paiMap[p] = (paiMap[p] || 0) + 1;
      });
      setPaiementsPie(Object.entries(paiMap).map(([name, value]) => ({ name, value })));

      // ── F5 : CA par canal de vente ────────────────────────────────────────
      const canalMap: Record<string, number> = {};
      venteOps.forEach((op: any) => {
        const c = op.canal_vente || 'Sur place';
        canalMap[c] = (canalMap[c] || 0) + parseFloat(op.total_dh || 0);
      });
      setCanalCA(
        Object.entries(canalMap)
          .sort(([, a], [, b]) => b - a)
          .map(([name, value]) => ({ name, value: Math.round(value) }))
      );

      // ── Top 5 clients ─────────────────────────────────────────────────────
      const clientTotals: Record<number, number> = {};
      venteOps.filter((op: any) => op.client_id).forEach((op: any) => {
        clientTotals[op.client_id] = (clientTotals[op.client_id] || 0) + parseFloat(op.total_dh || 0);
      });
      const topCIds = Object.entries(clientTotals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([id]) => Number(id));
      if (topCIds.length > 0) {
        const { data: clientsData } = await supabase
          .from('clients')
          .select('id_client, nom_prenom')
          .in('id_client', topCIds);
        const cMap: Record<number, string> = {};
        (clientsData || []).forEach((c: any) => { cMap[c.id_client] = c.nom_prenom; });
        setTopClients(topCIds.map(id => ({ nom: cMap[id] || `Client #${id}`, total: clientTotals[id] })));
      } else {
        setTopClients([]);
      }

      // ── Top 5 fournisseurs (toutes périodes) ──────────────────────────────
      const achatsPerF: Record<number, number> = {};
      allAchats.forEach((op: any) => {
        achatsPerF[op.fournisseur_id] = (achatsPerF[op.fournisseur_id] || 0) + parseFloat(op.total_dh || 0);
      });
      setTopFournisseursData(
        fourn
          .filter((f: any) => (achatsPerF[f.id_fournisseur] || 0) > 0)
          .sort((a: any, b: any) => (achatsPerF[b.id_fournisseur] || 0) - (achatsPerF[a.id_fournisseur] || 0))
          .slice(0, 5)
          .map((f: any) => ({ nom: f.nom, total: achatsPerF[f.id_fournisseur] }))
      );

    } catch (err) {
      console.error('[Admin] fetchAnalytics:', err);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [selectedPeriod]); // selectedPeriod in deps — closure must see the current value

  const fetchDebtKpis = useCallback(async () => {
    try {
      const [{ data: debtOps }, { data: allVentes }] = await Promise.all([
        supabase
          .from('operations')
          .select('reste_a_payer')
          .eq('type_op', 'vente')
          .eq('statut', 'valide')
          .gt('reste_a_payer', 0),
        supabase
          .from('operations')
          .select('total_dh')
          .eq('type_op', 'vente')
          .eq('statut', 'valide'),
      ]);
      const totalDette = (debtOps || []).reduce(
        (s: number, op: any) => s + parseFloat(op.reste_a_payer || 0), 0
      );
      const nbOperations = (debtOps || []).length;
      const totalCA = (allVentes || []).reduce(
        (s: number, op: any) => s + parseFloat(op.total_dh || 0), 0
      );
      setDebtKpis({
        totalDette,
        nbOperations,
        pctDetteVsCA: totalCA > 0 ? (totalDette / totalCA) * 100 : 0,
      });
    } catch { /* colonne reste_a_payer pas encore créée */ }
  }, []);

  // Soft delete — désactive l'utilisateur sans supprimer les enregistrements liés
  // Loi comptable : les opérations restent liées au compte et traçables.
  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    setDeletingUser(true);
    try {
      // Try is_active first, then actif (legacy column name)
      let res = await supabase
        .from('utilisateurs')
        .update({ is_active: false })
        .eq('id', userToDelete.id);
      if (res.error) {
        res = await supabase
          .from('utilisateurs')
          .update({ actif: false })
          .eq('id', userToDelete.id);
      }
      if (res.error) throw res.error;
      setShowDeleteUser(false);
      setUserToDelete(null);
      fetchUsers();
    } catch (err: any) {
      toast.error('Erreur désactivation : ' + (err.message || String(err)));
    } finally {
      setDeletingUser(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="space-y-6 pb-12">

        {/* Header */}
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">CENTRE DE CONTRÔLE</h2>
          <p className="text-sm text-slate-500 font-medium">Administration système, analytique et configuration globale.</p>
        </div>

        {/* ── Tab Navigation ─────────────────────────────────────────────────── */}
        <div className="flex bg-slate-100 p-1 w-fit rounded-xl gap-0.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-lg transition-all',
                  activeTab === tab.id
                    ? tab.id === 'analytique'
                      ? 'bg-white text-emerald-600 shadow-sm'
                      : tab.id === 'utilisateurs'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : tab.id === 'fournisseurs'
                      ? 'bg-white text-purple-600 shadow-sm'
                      : 'bg-white text-slate-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ONGLET 1 — ANALYTIQUE                                             */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'analytique' && (
          <div className="space-y-6">

            {/* ── En-tête + filtres ────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <p className="text-sm text-slate-500 font-medium">
                  {selectedPeriod
                    ? `Période : ${new Date(selectedPeriod + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} · Maroc`
                    : 'Données des 12 derniers mois · Maroc (GMT+1)'}
                </p>
                {selectedPeriod && (
                  <button
                    onClick={() => setSelectedPeriod('')}
                    className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg hover:bg-emerald-100 transition-all"
                  >
                    ✕ Réinitialiser
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Month selector — 12 recent months */}
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  className="bg-white border border-slate-200 rounded-xl py-1.5 px-3 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="">12 derniers mois</option>
                  {Array.from({ length: 12 }, (_, i) => {
                    const d = new Date();
                    d.setDate(1);
                    d.setMonth(d.getMonth() - i);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
                    return <option key={key} value={key}>{label}</option>;
                  })}
                </select>
                <button
                  onClick={fetchAnalytics}
                  disabled={analyticsLoading}
                  className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl hover:bg-emerald-100 transition-all disabled:opacity-50"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', analyticsLoading && 'animate-spin')} />
                  Actualiser
                </button>
              </div>
            </div>

            {analyticsLoading ? (
              <div className="flex justify-center items-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
              </div>
            ) : (
              <>
                {/* ── KPI Cards — CA, Achats, Charges → Bénéfice NET ───────── */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { label: 'CA Total (mois en cours)', value: kpis.caMois, color: 'emerald', icon: '📈' },
                    { label: 'Achats validés (mois)', value: kpis.achatsMois, color: 'purple', icon: '🛒' },
                    { label: 'Charges & Dépenses (mois)', value: kpis.chargesMois, color: 'orange', icon: '🧾' },
                    { label: 'Marge Brute (CA − Achats)', value: kpis.margeBrute, color: kpis.margeBrute >= 0 ? 'amber' : 'rose', icon: '💰' },
                    { label: 'Bénéfice NET (− charges)', value: kpis.beneficeNet, color: kpis.beneficeNet >= 0 ? 'emerald' : 'rose', icon: '🏆' },
                    { label: 'Valeur Stock Total', value: kpis.valeurStock, color: 'blue', icon: '📦' },
                  ].map((kpi) => (
                    <div key={kpi.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                      <div className="flex items-start justify-between mb-3">
                        <p className="text-xs font-black text-slate-400 uppercase tracking-wider leading-tight max-w-[80%]">{kpi.label}</p>
                        <span className="text-xl shrink-0">{kpi.icon}</span>
                      </div>
                      <p className={cn(
                        'text-2xl font-black',
                        kpi.color === 'emerald' ? 'text-emerald-600' :
                        kpi.color === 'blue'    ? 'text-blue-600'    :
                        kpi.color === 'amber'   ? 'text-amber-600'   :
                        kpi.color === 'orange'  ? 'text-orange-600'  :
                        kpi.color === 'rose'    ? 'text-rose-500'    :
                        'text-purple-600'
                      )}>
                        {kpi.value.toLocaleString('fr-MA', { maximumFractionDigits: 0 })}
                        <span className="text-sm font-bold text-slate-400 ml-1">DH</span>
                      </p>
                    </div>
                  ))}
                </div>

                {/* ── Créances ─────────────────────────────────────────────── */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    {
                      label: 'Total impayé',
                      value: `${debtKpis.totalDette.toLocaleString('fr-MA', { maximumFractionDigits: 0 })} DH`,
                      icon: '⚠️',
                      color: 'text-rose-600',
                      bg: 'bg-rose-50',
                      border: 'border-rose-100',
                    },
                    {
                      label: 'Opérations en crédit',
                      value: debtKpis.nbOperations.toString(),
                      icon: '🧾',
                      color: 'text-orange-600',
                      bg: 'bg-orange-50',
                      border: 'border-orange-100',
                    },
                    {
                      label: '% Dette / CA Total',
                      value: `${debtKpis.pctDetteVsCA.toFixed(1)}%`,
                      icon: '📊',
                      color: 'text-amber-600',
                      bg: 'bg-amber-50',
                      border: 'border-amber-100',
                    },
                  ].map((item) => (
                    <div key={item.label} className={cn('rounded-2xl border p-5 shadow-sm', item.bg, item.border)}>
                      <div className="flex items-start justify-between mb-3">
                        <p className="text-xs font-black text-slate-500 uppercase tracking-wider leading-tight">{item.label}</p>
                        <span className="text-xl shrink-0">{item.icon}</span>
                      </div>
                      <p className={cn('text-2xl font-black', item.color)}>{item.value}</p>
                    </div>
                  ))}
                </div>

                {/* ── LineChart — CA, Achats & Charges 12 mois ────────────── */}
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                  <h4 className="text-sm font-black text-slate-700 mb-5">Évolution CA, Achats &amp; Charges — 12 derniers mois</h4>
                  {caMonthly.length === 0 ? (
                    <p className="text-center text-slate-400 text-sm py-10">Aucune donnée disponible</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={caMonthly} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="mois" tick={{ fontSize: 11, fontWeight: 700, fill: '#94a3b8' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                        <Tooltip
                          formatter={(value: any) => [`${Number(value).toLocaleString('fr-MA')} DH`]}
                          contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 700 }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px', fontWeight: 700 }} />
                        <Line type="monotone" dataKey="CA" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 5 }} />
                        <Line type="monotone" dataKey="Achats" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3, fill: '#8b5cf6' }} activeDot={{ r: 5 }} strokeDasharray="5 5" />
                        <Line type="monotone" dataKey="Charges" stroke="#f97316" strokeWidth={2.5} dot={{ r: 3, fill: '#f97316' }} activeDot={{ r: 5 }} strokeDasharray="2 3" />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* ── Row: BarChart grouped 6 mois + BarChart Top 5 produits ── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                  {/* BarChart grouped — Ventes vs Achats vs Charges 6 derniers mois */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h4 className="text-sm font-black text-slate-700 mb-5">Ventes vs Achats vs Charges — 6 derniers mois</h4>
                    {caMonthly.length === 0 ? (
                      <p className="text-center text-slate-400 text-sm py-10">Aucune donnée</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={caMonthly.slice(-6)} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="mois" tick={{ fontSize: 11, fontWeight: 700, fill: '#94a3b8' }} />
                          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                          <Tooltip
                            formatter={(value: any) => [`${Number(value).toLocaleString('fr-MA')} DH`]}
                            contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 700 }}
                          />
                          <Legend wrapperStyle={{ fontSize: '12px', fontWeight: 700 }} />
                          <Bar dataKey="CA" fill="#10b981" radius={[4, 4, 0, 0] as [number, number, number, number]} />
                          <Bar dataKey="Achats" fill="#8b5cf6" radius={[4, 4, 0, 0] as [number, number, number, number]} />
                          <Bar dataKey="Charges" fill="#f97316" radius={[4, 4, 0, 0] as [number, number, number, number]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>

                  {/* BarChart horizontal — Top 5 produits */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h4 className="text-sm font-black text-slate-700 mb-5">Top 5 Produits — Quantités vendues</h4>
                    {topProduits.length === 0 ? (
                      <p className="text-center text-slate-400 text-sm py-10">Aucune donnée</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart layout="vertical" data={topProduits} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                          <YAxis type="category" dataKey="name" width={118} tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} />
                          <Tooltip
                            formatter={(value: any) => [`${value} unités`, 'Qté vendue']}
                            contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 700 }}
                          />
                          <Bar dataKey="qte" fill="#3b82f6" radius={[0, 4, 4, 0] as [number, number, number, number]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* ── Row: PieChart catégories + paiements + canal (F5) ──────── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                  {/* F5 — CA par Canal de Vente (Sur place / WhatsApp / Téléphone…) */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h4 className="text-sm font-black text-slate-700 mb-5">CA par Canal de Vente</h4>
                    {canalCA.length === 0 ? (
                      <p className="text-center text-slate-400 text-sm py-10">Aucune donnée</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={Math.max(160, canalCA.length * 44)}>
                        <BarChart layout="vertical" data={canalCA} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                          <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} />
                          <Tooltip
                            formatter={(value: any) => [`${Number(value).toLocaleString('fr-MA')} DH`, 'CA']}
                            contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 700 }}
                          />
                          <Bar dataKey="value" radius={[0, 4, 4, 0] as [number, number, number, number]}>
                            {canalCA.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>

                  {/* PieChart — CA par catégorie */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h4 className="text-sm font-black text-slate-700 mb-5">CA par Catégorie</h4>
                    {caCategorie.length === 0 ? (
                      <p className="text-center text-slate-400 text-sm py-10">Aucune donnée</p>
                    ) : (
                      <div className="flex items-center gap-4">
                        <ResponsiveContainer width="55%" height={200}>
                          <PieChart>
                            <Pie data={caCategorie} cx="50%" cy="50%" outerRadius={80} dataKey="value" stroke="none">
                              {caCategorie.map((_, i) => (
                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value: any) => [`${Number(value).toLocaleString('fr-MA')} DH`, '']}
                              contentStyle={{ borderRadius: '12px', fontSize: '12px', fontWeight: 700 }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="flex-1 space-y-2 min-w-0">
                          {caCategorie.slice(0, 7).map((c, i) => (
                            <div key={c.name} className="flex items-center gap-2 text-xs">
                              <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                              <span className="text-slate-600 flex-1 truncate font-medium">{c.name}</span>
                              <span className="font-black text-slate-800 shrink-0">{c.value.toLocaleString('fr-MA')} DH</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* PieChart — Répartition paiements */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h4 className="text-sm font-black text-slate-700 mb-5">Répartition des Paiements</h4>
                    {paiementsPie.length === 0 ? (
                      <p className="text-center text-slate-400 text-sm py-10">Aucune donnée</p>
                    ) : (
                      <div className="flex items-center gap-4">
                        <ResponsiveContainer width="55%" height={200}>
                          <PieChart>
                            <Pie data={paiementsPie} cx="50%" cy="50%" outerRadius={80} dataKey="value" stroke="none">
                              {paiementsPie.map((_, i) => (
                                <Cell key={i} fill={PAIEMENT_COLORS[i % PAIEMENT_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value: any, name: any) => [`${value} opérations`, String(name)]}
                              contentStyle={{ borderRadius: '12px', fontSize: '12px', fontWeight: 700 }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="flex-1 space-y-2">
                          {paiementsPie.map((p, i) => {
                            const total = paiementsPie.reduce((s, x) => s + x.value, 0);
                            return (
                              <div key={p.name} className="flex items-center gap-2 text-xs">
                                <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: PAIEMENT_COLORS[i % PAIEMENT_COLORS.length] }} />
                                <span className="text-slate-600 flex-1 font-medium">{p.name}</span>
                                <span className="font-black text-slate-800">{p.value} — {Math.round((p.value / total) * 100)}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Row: Top 5 Clients + Top 5 Fournisseurs ──────────────── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                  {/* Top 5 Clients */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
                      <span>🏆</span>
                      <h4 className="text-sm font-black text-slate-700">Top 5 Clients</h4>
                      <span className="ml-auto text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full uppercase tracking-wider">12 mois</span>
                    </div>
                    {topClients.length === 0 ? (
                      <p className="text-center text-slate-400 text-sm p-8">Aucune donnée</p>
                    ) : (
                      <div className="divide-y divide-slate-50">
                        {topClients.map((c, i) => (
                          <div key={c.nom} className="flex items-center gap-3 px-6 py-3.5">
                            <span className={cn(
                              'h-7 w-7 rounded-full flex items-center justify-center text-xs font-black shrink-0',
                              i === 0 ? 'bg-amber-100 text-amber-700' :
                              i === 1 ? 'bg-slate-200 text-slate-600' :
                              i === 2 ? 'bg-orange-100 text-orange-600' :
                              'bg-slate-100 text-slate-400'
                            )}>
                              {i + 1}
                            </span>
                            <span className="flex-1 text-sm font-bold text-slate-900 truncate">{c.nom}</span>
                            <span className="text-sm font-black text-emerald-700 shrink-0">
                              {c.total.toLocaleString('fr-MA', { maximumFractionDigits: 0 })} DH
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Top 5 Fournisseurs */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
                      <span>🏆</span>
                      <h4 className="text-sm font-black text-slate-700">Top 5 Fournisseurs</h4>
                      <span className="ml-auto text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full uppercase tracking-wider">Toutes périodes</span>
                    </div>
                    {topFournisseursData.length === 0 ? (
                      <p className="text-center text-slate-400 text-sm p-8">Aucune donnée</p>
                    ) : (
                      <div className="divide-y divide-slate-50">
                        {topFournisseursData.map((f, i) => (
                          <div key={f.nom} className="flex items-center gap-3 px-6 py-3.5">
                            <span className={cn(
                              'h-7 w-7 rounded-full flex items-center justify-center text-xs font-black shrink-0',
                              i === 0 ? 'bg-amber-100 text-amber-700' :
                              i === 1 ? 'bg-slate-200 text-slate-600' :
                              i === 2 ? 'bg-orange-100 text-orange-600' :
                              'bg-slate-100 text-slate-400'
                            )}>
                              {i + 1}
                            </span>
                            <span className="flex-1 text-sm font-bold text-slate-900 truncate">{f.nom}</span>
                            <span className="text-sm font-black text-purple-700 shrink-0">
                              {f.total.toLocaleString('fr-MA', { maximumFractionDigits: 0 })} DH
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ONGLET 2 — UTILISATEURS                                           */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'utilisateurs' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Liste utilisateurs */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Users className="h-5 w-5 text-blue-500" />
                    Utilisateurs du système
                    <span className="ml-1 text-xs font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                      {users.length}
                    </span>
                  </h3>
                  <button
                    onClick={() => setShowAddUser(true)}
                    className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg hover:bg-emerald-100 transition-all"
                  >
                    <Plus className="h-4 w-4" />
                    Ajouter
                  </button>
                </div>

                {loadingUsers ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {users.map(u => (
                      <div key={u.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "h-12 w-12 rounded-2xl flex items-center justify-center font-black border uppercase text-lg",
                            u.isActive
                              ? 'bg-slate-100 text-slate-600 border-slate-200'
                              : 'bg-red-50 text-red-300 border-red-100'
                          )}>
                            {u.username?.[0] || '?'}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-bold text-slate-900">{u.username}</p>
                              {/* Badge "Connecté" pour l'utilisateur actuel */}
                              {u.id === profile?.id && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-100 text-emerald-700 uppercase tracking-wider">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  Connecté
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500">{u.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className={cn(
                            'px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider',
                            u.roleId === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
                          )}>
                            {u.roleId === 'admin' ? 'Admin' : 'Caissier'}
                          </span>
                          <button
                            onClick={() => toggleUserStatus(u)}
                            disabled={u.id === profile?.id}
                            title={u.id === profile?.id ? 'Impossible de désactiver votre propre compte' : u.isActive ? 'Désactiver' : 'Activer'}
                            className={cn(
                              'p-2 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed',
                              u.isActive ? 'text-emerald-500 hover:bg-emerald-50' : 'text-rose-500 hover:bg-rose-50'
                            )}
                          >
                            {u.isActive ? <UserCheck className="h-5 w-5" /> : <UserX className="h-5 w-5" />}
                          </button>
                          <button
                            onClick={() => { setUserToDelete(u); setShowDeleteUser(true); }}
                            disabled={u.id === profile?.id}
                            title={u.id === profile?.id ? 'Impossible de supprimer votre propre compte' : 'Supprimer cet utilisateur'}
                            className="p-2 rounded-xl transition-all text-slate-300 hover:text-rose-500 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Panneau info droite */}
            <div className="space-y-4">
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Résumé</h4>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Total', value: users.length, color: 'text-slate-900' },
                    { label: 'Actifs', value: users.filter(u => u.isActive).length, color: 'text-emerald-600' },
                    { label: 'Admins', value: users.filter(u => u.roleId === 'admin').length, color: 'text-purple-600' },
                    { label: 'Inactifs', value: users.filter(u => !u.isActive).length, color: 'text-rose-500' },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-50 rounded-2xl p-3 text-center">
                      <p className={cn('text-2xl font-black', s.color)}>{s.value}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-3xl p-5 text-xs space-y-1.5 text-amber-800">
                <p className="font-black text-sm flex items-center gap-1.5">⚠️ Note Supabase Auth</p>
                <p>Pour éviter les blocages de confirmation email, allez dans <strong>Supabase › Auth › Email</strong> et désactivez <strong>"Confirm email"</strong>.</p>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ONGLET 3 — FOURNISSEURS                                           */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'fournisseurs' && (
          <div className="space-y-4">
            {/* Header + bouton */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">
                  {fournisseurs.length} fournisseur(s) enregistré(s)
                </p>
              </div>
              <button
                onClick={openNewFournisseur}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-5 rounded-xl transition-all shadow-lg shadow-purple-500/20 text-sm"
              >
                <Plus className="h-4 w-4" />
                Nouveau Fournisseur
              </button>
            </div>

            {/* Tableau */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</th>
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Nom</th>
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact</th>
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Adresse</th>
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">IDs Fiscaux</th>
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Achats Validés</th>
                      <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {loadingFournisseurs ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center">
                          <Loader2 className="h-5 w-5 animate-spin text-slate-300 mx-auto" />
                        </td>
                      </tr>
                    ) : fournisseurs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center">
                          <div className="flex flex-col items-center gap-3 text-slate-300">
                            <Building2 className="h-10 w-10" />
                            <p className="font-bold text-slate-400">Aucun fournisseur enregistré.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      fournisseurs.map(f => (
                        <tr key={f.id_fournisseur} className="hover:bg-slate-50/60 transition-colors">
                          {/* Type */}
                          <td className="px-5 py-3">
                            <span className={cn(
                              'px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider',
                              f.type === 'Société'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-600'
                            )}>
                              {f.type === 'Société' ? 'Société' : 'Personne'}
                            </span>
                          </td>
                          {/* Nom */}
                          <td className="px-5 py-3 font-bold text-slate-900">{f.nom}</td>
                          {/* Contact */}
                          <td className="px-5 py-3 text-slate-500">
                            {f.num_telephone ? (
                              <span className="flex items-center gap-1 text-xs">
                                <Phone className="h-3 w-3 text-slate-400" />
                                {f.num_telephone}
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          {/* Adresse */}
                          <td className="px-5 py-3 text-slate-500 max-w-[160px]">
                            {f.adresse ? (
                              <span className="flex items-start gap-1 text-xs">
                                <MapPin className="h-3 w-3 text-slate-400 mt-0.5 shrink-0" />
                                <span className="truncate">{f.adresse}</span>
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          {/* IDs fiscaux */}
                          <td className="px-5 py-3">
                            <div className="flex flex-col gap-0.5">
                              {f.type === 'Société' ? (
                                <>
                                  {f.irc && <span className="text-[10px] font-mono text-slate-500">IRC: {f.irc}</span>}
                                  {f.ice && <span className="text-[10px] font-mono text-slate-500">ICE: {f.ice}</span>}
                                  {!f.irc && !f.ice && <span className="text-slate-300 text-xs">—</span>}
                                </>
                              ) : (
                                f.cin
                                  ? <span className="text-[10px] font-mono text-slate-500">CIN: {f.cin}</span>
                                  : <span className="text-slate-300 text-xs">—</span>
                              )}
                            </div>
                          </td>
                          {/* Achats validés */}
                          <td className="px-5 py-3 text-right">
                            {achatsMap[f.id_fournisseur] ? (
                              <span className="font-black text-emerald-700">
                                {achatsMap[f.id_fournisseur].toFixed(2)}{' '}
                                <span className="text-[10px] text-slate-400 font-medium">DH</span>
                              </span>
                            ) : (
                              <span className="text-slate-300 text-xs">0.00 DH</span>
                            )}
                          </td>
                          {/* Actions */}
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEditFournisseur(f)}
                                className="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all"
                                title="Modifier"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteFournisseur(f.id_fournisseur)}
                                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                title="Supprimer"
                              >
                                <Trash2 className="h-4 w-4" />
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
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ONGLET 4 — SYSTÈME                                                */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'systeme' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sécurité & Maintenance */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Shield className="h-5 w-5 text-emerald-500" />
                Sécurité & Maintenance
              </h3>

              {/* Import CSV */}
              <button
                onClick={() => setShowImport(true)}
                className="w-full flex items-center gap-3 p-4 bg-slate-50 hover:bg-slate-100 rounded-2xl transition-all group text-left"
              >
                <div className="h-10 w-10 bg-white rounded-xl flex items-center justify-center text-slate-400 group-hover:text-blue-500 shadow-sm border border-slate-100 shrink-0">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-900 leading-tight">Importer depuis CSV</p>
                  <p className="text-xs text-slate-500 mt-0.5">Produits et clients depuis Excel</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
              </button>

              {/* Backup */}
              <div className="w-full flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                <div className="h-10 w-10 bg-white rounded-xl flex items-center justify-center text-emerald-500 shadow-sm border border-emerald-100 shrink-0">
                  <Database className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-900 leading-tight">Backup Cloud</p>
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-wider">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                      Actif
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Sauvegarde automatisée et continue par Supabase</p>
                </div>
              </div>

              {/* Synchroniser */}
              <button
                onClick={() => { fetchUsers(); fetchFournisseurs(); fetchAchatsParFournisseur(); }}
                className="w-full flex items-center gap-3 p-4 bg-emerald-500 hover:bg-emerald-600 rounded-2xl transition-all text-white shadow-lg shadow-emerald-500/20 text-left"
              >
                <RefreshCw className="h-5 w-5 shrink-0" />
                <span className="font-black text-sm">SYNCHRONISER LES DONNÉES</span>
              </button>
            </div>

            {/* Infrastructure */}
            <div className="bg-slate-900 p-6 rounded-[32px] text-white overflow-hidden relative">
              <div className="relative z-10">
                <h4 className="font-black text-emerald-400 text-xs uppercase tracking-widest mb-2">Infrastructure</h4>
                <p className="text-lg font-bold mb-4">GharbFeed Core v2.0</p>
                <div className="space-y-0">
                  {[
                    { label: 'Database Status', value: 'Online', color: 'text-emerald-400' },
                    { label: 'Region', value: 'europe-west2', color: 'text-white/80' },
                    { label: 'Auth Provider', value: 'Supabase', color: 'text-white/80' },
                    { label: 'Storage', value: 'PostgreSQL 15', color: 'text-white/80' },
                    { label: 'Frontend', value: 'React 19 + Vite 6', color: 'text-white/80' },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between text-xs py-2 border-b border-white/10">
                      <span className="text-white/40">{row.label}</span>
                      <span className={cn('font-bold', row.color)}>{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs text-emerald-400 font-bold">
                  <BadgeCheck className="h-4 w-4" />
                  Tous les systèmes sont opérationnels
                </div>
              </div>
              <Settings className="absolute -bottom-6 -right-6 h-32 w-32 text-white/5 rotate-12" />
            </div>
          </div>
        )}

      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* MODALS                                                                */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      {/* ── Modal Ajouter Utilisateur ─────────────────────────────────────── */}
      <AnimatePresence>
        {showAddUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowAddUser(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
                <div>
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Ajouter un utilisateur</h3>
                  <p className="text-sm text-slate-500 font-medium text-blue-600">Créer un nouveau compte d'accès.</p>
                </div>
                <button onClick={() => setShowAddUser(false)} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-900">
                  <X className="h-6 w-6" />
                </button>
              </div>
              <form onSubmit={handleCreateUser} className="p-8 space-y-5 overflow-y-auto flex-1">
                {createError && (
                  <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm font-bold border border-rose-100">
                    {createError}
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Nom Complet</label>
                  <input type="text" placeholder="Ex: Hajar Benali"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                    value={newNom} onChange={(e) => setNewNom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Nom d'utilisateur</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                    <input required type="text" placeholder="Ex: hajar  →  hajar@gharbfeed.com"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                      value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Mot de passe</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                    <input
                      required
                      type={showNewPassword ? 'text' : 'password'}
                      placeholder="Min 6 caractères"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-10 pr-10 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-500 transition-colors"
                      aria-label={showNewPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Rôle</label>
                  <select className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                    value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'tresorier' | 'cashier')}>
                    <option value="cashier">Caissier</option>
                    <option value="tresorier">Trésorier</option>
                    <option value="admin">Administrateur</option>
                  </select>
                </div>
                <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                  <button type="button" onClick={() => setShowAddUser(false)}
                    className="px-5 py-2.5 bg-white text-slate-500 font-bold rounded-2xl hover:bg-slate-50 transition-all text-sm">
                    Annuler
                  </button>
                  <button type="submit" disabled={isCreating}
                    className="px-6 py-2.5 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center gap-2 text-sm">
                    {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                    CRÉER LE COMPTE
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Modal Fournisseur (Créer / Modifier) ─────────────────────────── */}
      <AnimatePresence>
        {showFournisseurModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowFournisseurModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
                <div>
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                    {editingFournisseurId !== null ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
                  </h3>
                  <p className="text-sm text-purple-600 font-medium mt-0.5">
                    {editingFournisseurId !== null ? 'Mettez à jour les informations.' : 'Ajoutez un fournisseur au référentiel.'}
                  </p>
                </div>
                <button onClick={() => setShowFournisseurModal(false)} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-900">
                  <X className="h-6 w-6" />
                </button>
              </div>
              <form onSubmit={handleSaveFournisseur} className="p-8 space-y-4 overflow-y-auto flex-1">
                {/* Type */}
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Type</label>
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    {(['Personne physique', 'Société'] as const).map(t => (
                      <button key={t} type="button"
                        onClick={() => setFournisseurForm(f => ({ ...f, type: t }))}
                        className={cn(
                          'flex-1 py-2 text-sm font-bold rounded-lg transition-all',
                          fournisseurForm.type === t ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        )}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Nom */}
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Nom *</label>
                  <input required type="text" placeholder={fournisseurForm.type === 'Société' ? 'Ex: Agri-Maroc SARL' : 'Ex: Mohamed Alaoui'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-purple-500/20"
                    value={fournisseurForm.nom} onChange={(e) => setFournisseurForm(f => ({ ...f, nom: e.target.value }))} />
                </div>
                {/* Téléphone + Adresse */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Téléphone</label>
                    <input type="tel" placeholder="0612345678"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-purple-500/20"
                      value={fournisseurForm.num_telephone} onChange={(e) => setFournisseurForm(f => ({ ...f, num_telephone: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Adresse</label>
                    <input type="text" placeholder="Ville, région…"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-purple-500/20"
                      value={fournisseurForm.adresse} onChange={(e) => setFournisseurForm(f => ({ ...f, adresse: e.target.value }))} />
                  </div>
                </div>
                {/* Champs conditionnels selon le type */}
                {fournisseurForm.type === 'Société' ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">IRC</label>
                      <input type="text" placeholder="N° Registre Commerce"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-purple-500/20"
                        value={fournisseurForm.irc} onChange={(e) => setFournisseurForm(f => ({ ...f, irc: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">ICE</label>
                      <input type="text" placeholder="Identifiant Commun Entreprise"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-purple-500/20"
                        value={fournisseurForm.ice} onChange={(e) => setFournisseurForm(f => ({ ...f, ice: e.target.value }))} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">CIN</label>
                    <input type="text" placeholder="Ex: AB123456"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-purple-500/20"
                      value={fournisseurForm.cin} onChange={(e) => setFournisseurForm(f => ({ ...f, cin: e.target.value }))} />
                  </div>
                )}
                <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                  <button type="button" onClick={() => setShowFournisseurModal(false)}
                    className="px-5 py-2.5 bg-white text-slate-500 font-bold rounded-2xl hover:bg-slate-50 transition-all text-sm">
                    Annuler
                  </button>
                  <button type="submit" disabled={savingFournisseur}
                    className="px-6 py-2.5 bg-purple-600 text-white font-black rounded-2xl hover:bg-purple-500 transition-all shadow-lg shadow-purple-500/20 disabled:opacity-50 flex items-center gap-2 text-sm">
                    {savingFournisseur && <Loader2 className="h-4 w-4 animate-spin" />}
                    {editingFournisseurId !== null ? 'ENREGISTRER' : 'CRÉER'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Modal Confirmation Suppression Utilisateur ───────────────────── */}
      <AnimatePresence>
        {showDeleteUser && userToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setShowDeleteUser(false); setUserToDelete(null); }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden z-10"
            >
              <div className="p-6">
                <div className="flex items-center justify-center mb-4">
                  <div className="h-14 w-14 rounded-2xl bg-rose-100 flex items-center justify-center">
                    <Trash2 className="h-7 w-7 text-rose-500" />
                  </div>
                </div>
                <h3 className="text-center text-xl font-black text-slate-900 mb-1">
                  Désactiver l'utilisateur ?
                </h3>
                <p className="text-center text-sm text-slate-500 mb-3">
                  Vous êtes sur le point de désactiver{' '}
                  <strong className="text-slate-800">{userToDelete.username}</strong>.
                </p>
                <p className="text-center text-xs text-sky-700 bg-sky-50 border border-sky-100 rounded-xl p-3 mb-5">
                  🔒 Le compte sera marqué <strong>Inactif</strong>. L'historique des opérations reste intact (exigence comptable). La session expire à la prochaine déconnexion.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowDeleteUser(false); setUserToDelete(null); }}
                    className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all text-sm"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleDeleteUser}
                    disabled={deletingUser}
                    className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-2xl transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                  >
                    {deletingUser
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <UserX className="h-4 w-4" />}
                    Désactiver
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Modal Import CSV ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {showImport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowImport(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
                <div>
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                    <FileSpreadsheet className="h-6 w-6 text-blue-500" />
                    Importer depuis CSV
                  </h3>
                  <p className="text-sm text-slate-500 font-medium mt-1">Collez les données copiées depuis Excel</p>
                </div>
                <button onClick={() => setShowImport(false)} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-900">
                  <X className="h-6 w-6" />
                </button>
              </div>
              <form onSubmit={handleImportCsv} className="p-8 space-y-6 overflow-y-auto flex-1">
                {importError && <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm font-bold border border-rose-100">{importError}</div>}
                {importSuccess && <div className="bg-emerald-50 text-emerald-600 p-4 rounded-xl text-sm font-bold border border-emerald-100">{importSuccess}</div>}
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Type de données</label>
                  <select className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                    value={importType} onChange={(e) => setImportType(e.target.value as 'products' | 'clients')}>
                    <option value="products">Produits / Catalogue</option>
                    <option value="clients">Clients / Éleveurs</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Données CSV (séparateur ; ou ,)</label>
                  <textarea required rows={8}
                    placeholder={importType === 'products'
                      ? 'CODE;PRODUIT;DESCRIPTION;STOCK_ACTUEL;PRIX_VENTE\n#0001;MACHINE A TRAIRE;…;10;1500'
                      : 'NOM_PRENOM;ADRESSE;FONCTION;NUM_TELEPHONE\nAdil Larach;Larache;Eleveur;0661962189'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs font-mono text-slate-600 focus:ring-2 focus:ring-blue-500/20 whitespace-pre resize-none"
                    value={csvData} onChange={(e) => setCsvData(e.target.value)} />
                </div>
                <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
                  <button type="button" onClick={() => setShowImport(false)}
                    className="px-5 py-2.5 bg-white text-slate-500 font-bold rounded-2xl hover:bg-slate-50 transition-all text-sm">
                    Fermer
                  </button>
                  <button type="submit" disabled={isImporting || !csvData.trim()}
                    className="px-6 py-2.5 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center gap-2 text-sm">
                    {isImporting ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
                    {isImporting ? 'IMPORTATION…' : "LANCER L'IMPORT"}
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
