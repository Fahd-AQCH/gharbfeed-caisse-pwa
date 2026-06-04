export interface Role {
  id: string;
  name: string;
  permissions: any;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  roleId: 'admin' | 'cashier' | 'stock_manager' | 'supervisor';
  isActive: boolean;
  createdAt: any;
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
  type: 'vente' | 'achat' | 'retour_client';
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
