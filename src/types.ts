export interface Role {
  id: string;
  name: string;
  permissions: any;
}

export type CanalVente = 'Sur place' | 'WhatsApp' | 'Facebook' | 'Téléphone' | 'Livraison';

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  roleId: 'admin' | 'tresorier' | 'cashier' | 'stock_manager' | 'supervisor';
  isActive: boolean;
  createdAt: any;
}

export interface Expense {
  id: number;
  dateCharge: string;
  heureCharge?: string;
  typeCharge: string;
  description?: string;
  montant: number;
  modePaiement: string;
  utilisateurId?: string;
  agentName?: string;
  createdAt?: string;
}

export interface Client {
  id: string;
  name: string;
  address?: string;
  function?: string;
  phone?: string;
  createdAt: any;
  updatedAt: any;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  description?: string;
  unitId: string;
  categoryId: string;
  defaultPrice: number;
  purchasePrice?: number;
  stockActual: number;
  seuilAlerte?: number;
  isActive: boolean;
}

export interface Unit {
  id: string;
  name: string;
  symbol: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Operation {
  id: string;
  operationNumber: string;
  type: 'vente' | 'achat' | 'retour_client' | 'retour_fournisseur';
  clientId?: string;
  userId: string;
  status: 'draft' | 'validated' | 'cancelled' | 'en_attente';
  grossTotal: number;
  discountAmount: number;
  finalTotal: number;
  observation?: string;
  createdAt: any;
  validatedAt?: any;
  isModified?: boolean;
  version?: number;
  agentName?: string;
  clientName?: string;
  parentOpId?: number;
}

export interface OperationItem {
  id: string;
  operationId: string;
  productId: string;
  productName?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discountAmount: number;
}

export interface StockMovement {
  id: string;
  productId: string;
  operationId?: string;
  type: 'achat' | 'vente' | 'correction' | 'retour';
  quantity: number;
  beforeQty: number;
  afterQty: number;
  reason?: string;
  createdBy: string;
  createdAt: any;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: any;
  createdAt: any;
}

export interface DebtPayment {
  id: number;
  operationId: number;
  montant: number;
  datePaiement: string;
  heurePaiement?: string;
  conditionPaiement: string;
  refPaiement?: string;
  utilisateurId?: string;
  agentName?: string;
  notes?: string;
  createdAt?: string;
}

export interface PriceHistoryEntry {
  id: number;
  produitCode: string;
  produitNom?: string;
  typePrix: 'vente' | 'achat';
  ancienPrix: number;
  nouveauPrix: number;
  utilisateurId?: string;
  agentName?: string;
  dateModif?: string;
  heureModif?: string;
  createdAt?: string;
}
