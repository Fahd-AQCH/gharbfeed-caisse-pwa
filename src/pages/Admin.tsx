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
  Download,
  FileUp,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast, askConfirm } from '../lib/notify';
import * as XLSX from 'xlsx';
import { unzipSync, zipSync, strFromU8, strToU8, type Zippable } from 'fflate';
import { pullMasterData } from '../lib/syncService';
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

// ─── Import fichier (Produits / Clients) ──────────────────────────────────────
// Valeurs autorisées (couche applicative — aucune contrainte CHECK en DB) :
const CATEGORIES_IMPORT = ['Matière première', 'Aliment composé', 'Additif', 'CMV', 'Bloc à lécher', 'Matériel', 'Produit Hygien'];
const FONCTIONS_IMPORT = ['Eleveur', 'Technicien', 'Vétérinaire', 'Inséminateur', 'Revendeur', 'Client Comptoir'];

interface ProductAnalysis {
  rowNum: number;
  code: string;
  produit: string;
  action: 'insert' | 'update' | 'skip';
  reason?: string;
  warning?: string;
  categorie?: string | null;
  prix_vente?: number | null;
  pdat?: number | null;
  stock_actuel?: number | null;
  seuil_alerte?: number | null;
  description?: string | null;
  existingPamp?: number | null;
  existingStock?: number | null;
  existingPrix?: number | null;
}
interface ClientAnalysis {
  rowNum: number;
  nom_prenom: string;
  action: 'insert' | 'skip';
  reason?: string;
  fonction?: string | null;
  num_telephone?: string | null;
  adresse?: string | null;
}
type ImportPreview =
  | { kind: 'products'; rows: ProductAnalysis[] }
  | { kind: 'clients'; rows: ClientAnalysis[] };

// Accent- & casse-insensible (corrige aussi les mojibake type "�leveur")
const canonStr = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Code produit : opaque, jamais numérique. "1" / "01" / "0001" / "#0001" → "#0001"
const normCode = (v: any): string => {
  let s = String(v ?? '').trim();
  if (s.startsWith('#')) s = s.slice(1).trim();
  if (/^\d+$/.test(s)) return '#' + s.padStart(4, '0');
  return '#' + s;
};

// Décimales virgule OU point ("180,00" / "1 500,00" / "6 700 MAD") → number | null
const parseNum = (v: any): number | null => {
  if (v == null) return null;
  let s = String(v).trim();
  if (s === '') return null;
  s = s.replace(/[^\d.,-]/g, '');
  if (s === '') return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};

const clientKey = (nom: any, tel: any) => `${String(nom ?? '').trim().toLowerCase()}|${String(tel ?? '').trim()}`;

// Parse .xlsx/.csv → tableau de lignes (cellules = chaînes affichées, raw:false
// préserve les zéros de tête des téléphones quand la colonne est formatée Texte)
async function parseSheet(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: '' });
  return aoa.map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '')) : []));
}

// Analyse READ-ONLY produits : insert/update/skip + raisons. Lit l'existant (code, pamp, stock, prix).
async function analyzeProducts(rows: string[][]): Promise<ProductAnalysis[]> {
  const headers = (rows[0] || []).map((h) => h.trim().toUpperCase());
  const col = (n: string) => headers.indexOf(n);
  const cCode = col('CODE'), cName = col('PRODUIT'), cCat = col('CATEGORIE'),
    cPv = col('PRIX_VENTE'), cPa = col('PRIX_ACHAT'), cStock = col('STOCK_ACTUEL'),
    cSeuil = col('SEUIL_ALERTE'), cDesc = col('DESCRIPTION');
  if (cCode < 0 || cName < 0) throw new Error('Colonnes requises manquantes : CODE et PRODUIT.');

  const { data: existing, error } = await supabase.from('produits').select('code, pamp, stock_actuel, prix_vente');
  if (error) throw error;
  const exMap = new Map<string, { pamp: number | null; stock: number; prix: number }>();
  (existing || []).forEach((p: any) => exMap.set(p.code, {
    pamp: p.pamp != null ? parseFloat(p.pamp) : null,
    stock: parseFloat(p.stock_actuel || 0),
    prix: parseFloat(p.prix_vente || 0),
  }));

  const out: ProductAnalysis[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const rawCode = String(r[cCode] ?? '').trim();
    const name = String(r[cName] ?? '').trim();
    if (!rawCode && !name) continue; // ligne vide
    const rowNum = i + 1;
    if (!rawCode) { out.push({ rowNum, code: '', produit: name, action: 'skip', reason: 'CODE manquant' }); continue; }
    if (!name) { out.push({ rowNum, code: rawCode, produit: '', action: 'skip', reason: 'PRODUIT manquant' }); continue; }
    const code = normCode(rawCode);
    if (seen.has(code)) { out.push({ rowNum, code, produit: name, action: 'skip', reason: 'doublon dans le fichier' }); continue; }
    seen.add(code);

    let categorie: string | null = null;
    if (cCat >= 0 && String(r[cCat] ?? '').trim() !== '') {
      const raw = String(r[cCat]).trim();
      const m = CATEGORIES_IMPORT.find((x) => canonStr(x) === canonStr(raw));
      if (!m) { out.push({ rowNum, code, produit: name, action: 'skip', reason: `catégorie invalide : "${raw}"` }); continue; }
      categorie = m;
    }
    const prix_vente = cPv >= 0 ? parseNum(r[cPv]) : null;
    const pdat = cPa >= 0 ? parseNum(r[cPa]) : null;
    const stock_actuel = cStock >= 0 ? parseNum(r[cStock]) : null;
    const seuilRaw = cSeuil >= 0 ? parseNum(r[cSeuil]) : null;
    const description = cDesc >= 0 ? String(r[cDesc] ?? '').trim() : null;

    const ex = exMap.get(code);
    const action: 'insert' | 'update' = ex ? 'update' : 'insert';
    const warning = action === 'insert' && (pdat == null || pdat <= 0)
      ? "produit neuf sans prix d'achat → pas de coût/marge" : undefined;

    out.push({
      rowNum, code, produit: name, action, warning,
      categorie, prix_vente, pdat, stock_actuel,
      seuil_alerte: seuilRaw != null ? Math.round(seuilRaw) : null,
      description: description || null,
      existingPamp: ex?.pamp ?? null,
      existingStock: ex?.stock ?? null,
      existingPrix: ex?.prix ?? null,
    });
  }
  return out;
}

// Analyse READ-ONLY clients : dédoublonnage sur nom_prenom+num_telephone (DB + intra-fichier).
async function analyzeClients(rows: string[][]): Promise<ClientAnalysis[]> {
  const headers = (rows[0] || []).map((h) => h.trim().toUpperCase());
  const col = (n: string) => headers.indexOf(n);
  const cName = col('NOM_PRENOM'), cFonc = col('FONCTION'), cTel = col('NUM_TELEPHONE'), cAdr = col('ADRESSE');
  if (cName < 0) throw new Error('Colonne requise manquante : NOM_PRENOM.');

  const { data: existing, error } = await supabase.from('clients').select('nom_prenom, num_telephone');
  if (error) throw error;
  const exKeys = new Set((existing || []).map((c: any) => clientKey(c.nom_prenom, c.num_telephone)));

  const out: ClientAnalysis[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = String(r[cName] ?? '').trim();
    const rowNum = i + 1;
    if (!name) {
      if (r.some((c) => String(c ?? '').trim() !== '')) out.push({ rowNum, nom_prenom: '', action: 'skip', reason: 'NOM_PRENOM manquant' });
      continue;
    }
    const tel = cTel >= 0 ? String(r[cTel] ?? '').trim() : '';
    let fonction: string | null = null;
    if (cFonc >= 0 && String(r[cFonc] ?? '').trim() !== '') {
      const raw = String(r[cFonc]).trim();
      const m = FONCTIONS_IMPORT.find((x) => canonStr(x) === canonStr(raw));
      if (!m) { out.push({ rowNum, nom_prenom: name, action: 'skip', reason: `fonction invalide : "${raw}"` }); continue; }
      fonction = m;
    }
    const adresse = cAdr >= 0 ? String(r[cAdr] ?? '').trim() : '';
    const key = clientKey(name, tel);
    if (exKeys.has(key)) { out.push({ rowNum, nom_prenom: name, action: 'skip', reason: 'doublon (existe déjà)' }); continue; }
    if (seen.has(key)) { out.push({ rowNum, nom_prenom: name, action: 'skip', reason: 'doublon dans le fichier' }); continue; }
    seen.add(key);
    out.push({ rowNum, nom_prenom: name, fonction, num_telephone: tel || null, adresse: adresse || null, action: 'insert' });
  }
  return out;
}

// Écriture produits — UPSERT on code. updateStock pilote l'écrasement du stock des EXISTANTS.
async function writeProducts(rows: ProductAnalysis[], updateStock: boolean): Promise<{ inserted: number; updated: number }> {
  const inserts = rows.filter((r) => r.action === 'insert');
  const updates = rows.filter((r) => r.action === 'update');

  const insertPayload = inserts.map((r) => {
    const stock = r.stock_actuel ?? 0;
    const prix = r.prix_vente ?? 0;
    const pdat = r.pdat ?? 0;
    return {
      code: r.code, produit: r.produit,
      description: r.description ?? '',
      categorie: r.categorie ?? 'Matériel',
      prix_vente: prix, pdat,
      stock_actuel: stock, stock_initial: stock,
      qte_achat: 0, qte_vente: 0,
      valeur_stock: stock * prix,
      seuil_alerte: r.seuil_alerte ?? 10,
      is_active: true,
      pamp: pdat > 0 ? pdat : null, // SEED pamp = pdat (sinon NULL). valeur_stock_pamp jamais écrit (D8).
    };
  });
  if (insertPayload.length) {
    const { error } = await supabase.from('produits').insert(insertPayload);
    if (error) throw error;
  }

  for (const r of updates) {
    const payload: Record<string, any> = { produit: r.produit }; // n'écrase une colonne que si le fichier l'a fournie
    if (r.description != null) payload.description = r.description;
    if (r.categorie != null) payload.categorie = r.categorie;
    if (r.prix_vente != null) payload.prix_vente = r.prix_vente;
    if (r.pdat != null) payload.pdat = r.pdat;
    if (r.seuil_alerte != null) payload.seuil_alerte = r.seuil_alerte;
    let effStock = r.existingStock ?? 0;
    if (updateStock && r.stock_actuel != null) { payload.stock_actuel = r.stock_actuel; effStock = r.stock_actuel; }
    const effPrix = r.prix_vente != null ? r.prix_vente : (r.existingPrix ?? 0);
    payload.valeur_stock = effStock * effPrix;
    // pamp : NE JAMAIS écraser une moyenne mobile existante — seed seulement si NULL et prix d'achat fourni.
    if (r.existingPamp == null && r.pdat != null && r.pdat > 0) payload.pamp = r.pdat;
    // qte_achat / qte_vente / stock_initial / is_active : jamais touchés en update.
    const { error } = await supabase.from('produits').update(payload).eq('code', r.code);
    if (error) throw error;
  }
  return { inserted: insertPayload.length, updated: updates.length };
}

// Écriture clients — insert des nouveaux uniquement (les doublons sont déjà classés 'skip').
async function writeClients(rows: ClientAnalysis[]): Promise<{ inserted: number }> {
  const inserts = rows.filter((r) => r.action === 'insert').map((r) => ({
    nom_prenom: r.nom_prenom,
    fonction: r.fonction ?? null,
    num_telephone: r.num_telephone ?? null,
    adresse: r.adresse ?? null,
    actif: true,
  }));
  if (inserts.length) {
    const { error } = await supabase.from('clients').insert(inserts);
    if (error) throw error;
  }
  return { inserted: inserts.length };
}

// Génère et télécharge un modèle .xlsx avec dropdowns (dataValidation) et format texte sur CODE.
// SheetJS community ne supporte pas dataValidations → on injecte le XML brut via fflate.
function downloadTemplate(type: 'products' | 'clients') {
  const aoa = type === 'products'
    ? [
        ['CODE', 'PRODUIT', 'CATEGORIE', 'PRIX_VENTE', 'PRIX_ACHAT', 'STOCK_ACTUEL', 'SEUIL_ALERTE', 'DESCRIPTION'],
        ['#0001', 'MACHINE A TRAIRE HUILE (1 VACHE)', 'Matériel', 6700, 5300, 5, 5, 'Trayeuse mono-poste'],
        ['#0500', 'ALIMENT VACHE LAITIÈRE 25KG', 'Aliment composé', 180, 145.5, 40, 10, 'Sac 25 kg'],
      ]
    : [
        ['NOM_PRENOM', 'FONCTION', 'NUM_TELEPHONE', 'ADRESSE'],
        ['Adil Larach', 'Eleveur', '0661962189', 'Larache'],
        ['Fatima Zahra', 'Vétérinaire', '0612345678', 'Kénitra'],
      ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type === 'products' ? 'Produits' : 'Clients');

  // Step 1 — Generate raw XLSX bytes. XLSX.write(type:'array') returns an ArrayBuffer,
  // NOT a Uint8Array — fflate.unzipSync needs a Uint8Array, so wrap it (no copy).
  const rawBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const rawBytes = new Uint8Array(rawBuf);

  // Step 2 — Unpack the ZIP
  const files = unzipSync(rawBytes) as Record<string, Uint8Array>;

  // Step 3 — Inject into worksheet XML.
  // ⚠️ SpreadsheetML (CT_Worksheet) imposes a FIXED child order:
  //   sheetViews → (sheetFormatPr) → cols → sheetData → … → dataValidations → … → ignoredErrors → …
  // SheetJS emits <ignoredErrors> after </sheetData>, so <dataValidations> MUST be spliced right
  // after </sheetData> (before ignoredErrors) — anchoring on </worksheet> lands it AFTER
  // ignoredErrors, which violates the order and corrupts the part (Excel drops the sheet).
  const sheetKey = 'xl/worksheets/sheet1.xml';
  let sheetXml = strFromU8(files[sheetKey]);

  const xmlEsc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // dataValidations goes after </mergeCells> if present, else immediately after </sheetData>.
  const insertDV = (xml: string, dv: string) =>
    xml.includes('</mergeCells>')
      ? xml.replace('</mergeCells>', '</mergeCells>' + dv)
      : xml.replace('</sheetData>', '</sheetData>' + dv);

  if (type === 'products') {
    // ① Append a TEXT cell format (numFmtId=49 / "@") to cellXfs and CAPTURE its index.
    //    The new <xf> is appended last → its index = the OLD cellXfs count. Don't hardcode:
    //    SheetJS's default cellXfs count can differ between versions/inputs.
    const stylesKey = 'xl/styles.xml';
    let stylesXml = strFromU8(files[stylesKey]);
    let textStyleIdx = 0;
    stylesXml = stylesXml.replace(
      /<cellXfs count="(\d+)">/,
      (_: string, n: string) => {
        textStyleIdx = parseInt(n, 10);
        return `<cellXfs count="${textStyleIdx + 1}">`;
      }
    );
    stylesXml = stylesXml.replace(
      '</cellXfs>',
      '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
    );
    files[stylesKey] = strToU8(stylesXml);

    // ② <cols> (schema slot: after sheetViews, before sheetData) → col A: visible width (14) +
    //    the text format captured above, so "#0001" stays text and the column is not collapsed.
    if (!sheetXml.includes('<cols>')) {
      sheetXml = sheetXml.replace(
        '<sheetData>',
        `<cols><col min="1" max="1" width="14" customWidth="1" style="${textStyleIdx}"/></cols><sheetData>`
      );
    }
    // ③ dataValidation dropdown on CATEGORIE (col C, rows 2–1000)
    const catList = CATEGORIES_IMPORT.map(xmlEsc).join(',');
    sheetXml = insertDV(
      sheetXml,
      `<dataValidations count="1"><dataValidation type="list" allowBlank="0" showInputMessage="1" showErrorMessage="1" sqref="C2:C1000"><formula1>"${catList}"</formula1></dataValidation></dataValidations>`
    );
    files[sheetKey] = strToU8(sheetXml);
  } else {
    // dataValidation dropdown on FONCTION (col B, rows 2–1000), blank allowed
    const fonctList = FONCTIONS_IMPORT.map(xmlEsc).join(',');
    sheetXml = insertDV(
      sheetXml,
      `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="B2:B1000"><formula1>"${fonctList}"</formula1></dataValidation></dataValidations>`
    );
    files[sheetKey] = strToU8(sheetXml);
  }

  // Step 4 — Repack
  const outBytes = zipSync(files as unknown as Zippable);

  // Step 5 — Sanity-check the output is a valid zip before serving it, so a malformed
  // file can never be downloaded again. Checks the PK magic header + re-parses the zip.
  if (outBytes[0] !== 0x50 || outBytes[1] !== 0x4b) {
    throw new Error('downloadTemplate: sortie invalide (en-tête ZIP "PK" manquant)');
  }
  const verify = unzipSync(outBytes) as Record<string, Uint8Array>;
  if (!verify[sheetKey] || !strFromU8(verify[sheetKey]).includes('<dataValidations')) {
    throw new Error('downloadTemplate: dataValidations absent du fichier généré');
  }

  // Step 6 — Trigger download
  const blob = new Blob([outBytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gharbfeed_modele_${type === 'products' ? 'produits' : 'clients'}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

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

  // ── Import fichier (Produits / Clients) ───────────────────────────────────
  const [showImport, setShowImport] = useState(false);
  const [importType, setImportType] = useState<'products' | 'clients'>('products');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  // Option A/B (produits) : écraser le stock des EXISTANTS. Décoché = sûr (option B).
  const [updateStock, setUpdateStock] = useState(false);

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
  // PAMP Phase 3 — bénéfice réel basé sur cout_unitaire figé à la vente (confidentiel)
  const [beneficePAMP, setBeneficePAMP] = useState(0);

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

  // ── Import fichier — handlers ─────────────────────────────────────────────

  const resetImport = () => {
    setShowImport(false);
    setPreview(null);
    setImportFileName('');
    setImportError(null);
    setImportSuccess(null);
    setUpdateStock(false);
  };

  // Change de cible → on repart à zéro (l'analyse dépend de la table visée)
  const handleChangeImportType = (t: 'products' | 'clients') => {
    setImportType(t);
    setPreview(null);
    setImportFileName('');
    setImportError(null);
    setImportSuccess(null);
  };

  // Sélection fichier → parse + analyse READ-ONLY → preview (aucune écriture)
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // autorise la re-sélection du même fichier
    if (!file) return;
    setImportError(null);
    setImportSuccess(null);
    setPreview(null);
    setImportFileName(file.name);
    setAnalyzing(true);
    try {
      const rows = await parseSheet(file);
      if (rows.length < 2) throw new Error('Fichier vide ou sans ligne de données.');
      if (importType === 'products') setPreview({ kind: 'products', rows: await analyzeProducts(rows) });
      else setPreview({ kind: 'clients', rows: await analyzeClients(rows) });
    } catch (err: any) {
      setImportError(err.message || 'Erreur de lecture du fichier.');
    } finally {
      setAnalyzing(false);
    }
  };

  // Confirmation explicite (askConfirm) PUIS écriture
  const handleRunImport = async () => {
    if (!preview) return;
    const insertN = preview.rows.filter((r) => r.action === 'insert').length;
    const updateN = preview.rows.filter((r) => r.action === 'update').length;
    const skipN = preview.rows.filter((r) => r.action === 'skip').length;
    if (insertN + updateN === 0) { toast.warning('Aucune ligne valide à importer.'); return; }
    const stockN = preview.kind === 'products' && updateStock
      ? preview.rows.filter((r) => r.action === 'update' && (r as ProductAnalysis).stock_actuel != null).length : 0;

    const ok = await askConfirm({
      title: preview.kind === 'products' ? "Confirmer l'import des produits" : "Confirmer l'import des clients",
      message:
        `${insertN} à insérer · ${updateN} à mettre à jour · ${skipN} ignorée(s).` +
        (stockN > 0 ? `\n⚠️ Stock écrasé pour ${stockN} produit(s) existant(s).` : ''),
      confirmLabel: 'Importer',
      danger: stockN > 0,
    });
    if (!ok) return;

    setIsImporting(true);
    setImportError(null);
    try {
      let msg = '';
      if (preview.kind === 'products') {
        const { inserted, updated } = await writeProducts(preview.rows, updateStock);
        msg = `${inserted} produit(s) inséré(s), ${updated} mis à jour, ${skipN} ignoré(s).`;
      } else {
        const { inserted } = await writeClients(preview.rows);
        msg = `${inserted} client(s) inséré(s), ${skipN} ignoré(s).`;
      }
      await pullMasterData().catch(() => { /* cache local — non bloquant */ });
      toast.success(msg);
      setImportSuccess(msg);
      setPreview(null);
      setImportFileName('');
    } catch (err: any) {
      const m = err.message || String(err);
      setImportError(m);
      toast.error('Erreur : ' + m);
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
    setBeneficePAMP(0);
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
          .select('produit_id, total_ligne, cout_unitaire, quantite, prix_unitaire')
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

        // Bénéfice NET (PAMP) — lignes avec coût figé connu uniquement
        let _beneficePAMP = 0;
        (itemsData || []).forEach((item: any) => {
          if (item.cout_unitaire != null) {
            _beneficePAMP += (parseFloat(item.prix_unitaire || 0) - parseFloat(item.cout_unitaire)) * parseFloat(item.quantite || 0);
          }
        });
        setBeneficePAMP(Math.round(_beneficePAMP));
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

                {/* ── Bénéfice NET (PAMP) — marge réelle sur coût figé ──────── */}
                <div className="bg-sky-50 border border-sky-200 rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-black text-sky-700 uppercase tracking-wider leading-tight">Bénéfice NET (PAMP)</p>
                    <p className="text-[10px] text-sky-400 font-medium mt-0.5">
                      Σ (prix_vente − coût) · ventes avec coût connu uniquement (post-Phase 2)
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xl">📊</span>
                    <p className={cn('text-2xl font-black', beneficePAMP >= 0 ? 'text-sky-700' : 'text-rose-500')}>
                      {beneficePAMP.toLocaleString('fr-MA', { maximumFractionDigits: 0 })}
                      <span className="text-sm font-bold text-sky-400 ml-1">DH</span>
                    </p>
                  </div>
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

              {/* Import fichier */}
              <button
                onClick={() => setShowImport(true)}
                className="w-full flex items-center gap-3 p-4 bg-slate-50 hover:bg-slate-100 rounded-2xl transition-all group text-left"
              >
                <div className="h-10 w-10 bg-white rounded-xl flex items-center justify-center text-slate-400 group-hover:text-blue-500 shadow-sm border border-slate-100 shrink-0">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-900 leading-tight">Importer un fichier</p>
                  <p className="text-xs text-slate-500 mt-0.5">Produits & clients — Excel/CSV avec aperçu</p>
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

      {/* ── Modal Import fichier (Produits / Clients) ────────────────────── */}
      <AnimatePresence>
        {showImport && (() => {
          const insertN = preview ? preview.rows.filter((r) => r.action === 'insert').length : 0;
          const updateN = preview ? preview.rows.filter((r) => r.action === 'update').length : 0;
          const skipN = preview ? preview.rows.filter((r) => r.action === 'skip').length : 0;
          const warnN = preview?.kind === 'products' ? preview.rows.filter((r) => (r as ProductAnalysis).warning).length : 0;
          const stockN = preview?.kind === 'products' && updateStock
            ? preview.rows.filter((r) => r.action === 'update' && (r as ProductAnalysis).stock_actuel != null).length : 0;
          return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={resetImport}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-3xl bg-white rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
                <div>
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                    <FileSpreadsheet className="h-6 w-6 text-blue-500" />
                    Importer un fichier
                  </h3>
                  <p className="text-sm text-slate-500 font-medium mt-1">Fichier Excel ou CSV (.xlsx, .xls, .csv) — aperçu avant écriture</p>
                </div>
                <button onClick={resetImport} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-900">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="p-8 space-y-6 overflow-y-auto flex-1">
                {importError && <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm font-bold border border-rose-100">{importError}</div>}
                {importSuccess && <div className="bg-emerald-50 text-emerald-600 p-4 rounded-xl text-sm font-bold border border-emerald-100">{importSuccess}</div>}

                {/* Type de données */}
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Type de données</label>
                  <select className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                    value={importType} onChange={(e) => handleChangeImportType(e.target.value as 'products' | 'clients')}>
                    <option value="products">Produits / Catalogue</option>
                    <option value="clients">Clients / Éleveurs</option>
                  </select>
                </div>

                {/* Option A/B — produits uniquement */}
                {importType === 'products' && (
                  <label className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer">
                    <input type="checkbox" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded accent-amber-600" />
                    <span className="text-sm">
                      <span className="font-bold text-amber-900">Mettre à jour aussi le stock des produits existants</span>
                      <span className="block text-xs text-amber-700 mt-0.5">
                        Décoché (défaut) : le stock des produits existants n'est pas touché. Coché : le stock du fichier écrase le stock actuel.
                        N'affecte jamais les nouveaux produits (toujours pris du fichier).
                      </span>
                    </span>
                  </label>
                )}

                {/* Modèle + fichier */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <button type="button" onClick={() => downloadTemplate(importType)}
                    className="flex items-center justify-center gap-2 text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-4 py-3 rounded-2xl transition-all">
                    <Download className="h-4 w-4" />
                    Télécharger le modèle
                  </button>
                  <label className="flex-1 flex items-center justify-center gap-2 text-sm font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-4 py-3 rounded-2xl transition-all cursor-pointer">
                    {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                    {analyzing ? 'Analyse…' : (importFileName || 'Choisir un fichier…')}
                    <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileSelected} disabled={analyzing || isImporting} />
                  </label>
                </div>

                {/* Aperçu */}
                {preview && (
                  <div className="space-y-4">
                    {/* Résumé */}
                    <div className="flex flex-wrap gap-2">
                      <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-100 text-emerald-700">{insertN} à insérer</span>
                      {preview.kind === 'products' && <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-blue-100 text-blue-700">{updateN} à mettre à jour</span>}
                      <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-slate-100 text-slate-600">{skipN} ignorée(s)</span>
                      {warnN > 0 && <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-amber-100 text-amber-700">{warnN} sans prix d'achat</span>}
                      {stockN > 0 && <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-rose-100 text-rose-700">⚠️ stock écrasé pour {stockN} produit(s) existant(s)</span>}
                    </div>

                    {/* Tableau */}
                    <div className="border border-slate-200 rounded-2xl overflow-hidden">
                      <div className="max-h-[320px] overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-500 uppercase font-bold sticky top-0">
                            <tr>
                              <th className="px-3 py-2">Ligne</th>
                              <th className="px-3 py-2">{preview.kind === 'products' ? 'Code' : 'Nom'}</th>
                              <th className="px-3 py-2">{preview.kind === 'products' ? 'Produit' : 'Fonction'}</th>
                              <th className="px-3 py-2">Action</th>
                              <th className="px-3 py-2">Détail</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {preview.rows.map((r, i) => {
                              const prod = preview.kind === 'products' ? (r as ProductAnalysis) : null;
                              const cli = preview.kind === 'clients' ? (r as ClientAnalysis) : null;
                              const stockOverwrite = prod && prod.action === 'update' && updateStock && prod.stock_actuel != null;
                              return (
                                <tr key={i} className={cn(r.action === 'skip' && 'bg-slate-50/60 text-slate-400')}>
                                  <td className="px-3 py-2 font-mono text-slate-400">{r.rowNum}</td>
                                  <td className="px-3 py-2 font-mono font-bold text-slate-600">{prod ? prod.code : cli!.nom_prenom}</td>
                                  <td className="px-3 py-2 text-slate-700 truncate max-w-[180px]">{prod ? prod.produit : (cli!.fonction || '—')}</td>
                                  <td className="px-3 py-2">
                                    <span className={cn('px-2 py-0.5 rounded-lg text-[10px] font-black uppercase',
                                      r.action === 'insert' ? 'bg-emerald-100 text-emerald-700' :
                                      r.action === 'update' ? 'bg-blue-100 text-blue-700' :
                                      'bg-slate-200 text-slate-500')}>
                                      {r.action === 'insert' ? 'Insérer' : r.action === 'update' ? 'MàJ' : 'Ignorer'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-slate-500">
                                    {r.reason
                                      ? <span className="text-rose-500 font-medium">{r.reason}</span>
                                      : stockOverwrite
                                        ? <span className="text-rose-500 font-medium">stock écrasé</span>
                                        : prod?.warning
                                          ? <span className="text-amber-600 font-medium">{prod.warning}</span>
                                          : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0 bg-slate-50">
                <button type="button" onClick={resetImport}
                  className="px-5 py-2.5 bg-white text-slate-500 font-bold rounded-2xl hover:bg-slate-100 transition-all text-sm">
                  Fermer
                </button>
                <button type="button" onClick={handleRunImport} disabled={isImporting || analyzing || !preview || (insertN + updateN === 0)}
                  className="px-6 py-2.5 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center gap-2 text-sm">
                  {isImporting ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
                  {isImporting ? 'IMPORTATION…' : "LANCER L'IMPORT"}
                </button>
              </div>
            </motion.div>
          </div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
