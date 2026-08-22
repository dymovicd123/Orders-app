// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.


export interface Env {
  DB: D1Database;
  DIAGNOSTICS_ENABLED?: string;
  ADMIN_MODE_LOGIN?: string;
  ADMIN_MODE_PASSWORD?: string;
  ADMIN_MODE_SESSION_SECRET?: string;
}


export type OrderInput = {
  requestId?: string;
  externalId?: string;
  orderDate?: string;
  managerId?: number;
  managerName?: string;
  customerPhone?: string;
  customerName?: string;
  city?: string;
  deliveryType?: string;
  sourceType?: 'warehouse' | 'boutique';
  orderTotal?: number;
  workshopStatus?: 'in_workshop' | 'ready' | 'shipped' | 'cancelled';
  orderStatus?: 'active' | 'closed' | 'archived' | 'deleted';
  shippingStatus?: 'not_sent' | 'sent' | 'Не отправлено' | 'Отправлено';
  shippingDate?: string | null;
  comment?: string;
  items?: Array<{
    productName?: string;
    gender?: string;
    color?: string;
    material?: string;
    length?: string;
    size?: string;
    quantity?: number;
    unitPrice?: number;
    sourceType?: 'warehouse' | 'boutique' | 'workshop';
    audienceType?: string;
    workshopComment?: string;
    workshopUrgent?: boolean;
    workshopDueDate?: string;
    observedPhysicalQuantity?: number | null;
    shortageAcknowledged?: boolean;
  }>;
  payments?: Array<{
    paymentDate?: string;
    method?: string;
    amount?: number;
    paymentKind?: 'primary' | 'debt_close' | 'extra';
    comment?: string;
  }>;
};


export type OrderListRow = {
  id: number;
  external_id: string;
  order_date: string;
  manager_id?: number | null;
  manager_name: string | null;
  manager_snapshot_name?: string | null;
  manager_color?: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  city: string | null;
  delivery_type: string | null;
  source_type: string;
  workshop_status: string;
  order_status: string;
  shipping_status?: string | null;
  shipping_date?: string | null;
  total_amount: number;
  received_amount: number;
  debt_amount: number;
  return_amount: number;
  comment: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
  archive_batch_id?: string | null;
  retained_only?: boolean | number;
  retained_summary_text?: string | null;
  retained_payment_count?: number;
  retained_return_count?: number;
};


export type PaymentKind = 'primary' | 'debt_close' | 'extra';

export type SourceType = 'warehouse' | 'boutique';

export type OrderItemSourceType = 'warehouse' | 'boutique' | 'workshop';

export type InventoryMovementKind = 'arrival' | 'manual_set' | 'writeoff' | 'sale' | 'return' | 'revision' | 'delete';

export type WorkshopViewMode = 'active' | 'urgent' | 'invoice' | 'done';

export type WorkshopTaskStatus = 'active' | 'ready' | 'done' | 'cancelled';

export type ReturnRestockSource = 'none' | 'warehouse' | 'boutique';

export type ExchangeReturnSource = 'none' | 'warehouse' | 'boutique';

export type ExchangeFinancialAction = 'none' | 'extra_payment' | 'refund';


export type ActivityEventInput = {
  eventType: string;
  entityType: string;
  entityId?: number | null;
  orderId?: number | null;
  externalOrderId?: string | null;
  title: string;
  details?: string | null;
  amount?: number | null;
  createdAt?: string | null;
};



export type InventoryItemInput = {
  productId?: number | string;
  variantId?: number | string;
  productName?: string;
  category?: string;
  gender?: string;
  color?: string;
  material?: string;
  length?: string;
  size?: string;
  quantity?: number | string;
  expectedQuantity?: number | string | null;
  observedPhysicalQuantity?: number | string | null;
};


export type ReferenceKind = 'managers' | 'cities' | 'deliveryTypes' | 'paymentMethods' | 'colors' | 'materials' | 'lengths' | 'sizes' | 'childAges' | 'returnReasons' | 'writeoffReasons';


export type ReferenceValueRecord = {
  id: number;
  value: string;
  isActive: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};



export type AuthUser = {
  id: number;
  email: string;
  role: 'admin' | 'manager';
  managerId: number | null;
  managerName: string | null;
  displayName: string;
  mustChangePassword: boolean;
};
