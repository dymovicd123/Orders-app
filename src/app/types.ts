import type * as React from 'react'

export type OrderItem = {
  productName: string
  audienceType?: 'ВЗРОСЛЫЙ' | 'ДЕТСКИЙ'
  gender?: string
  color?: string
  material?: string
  length?: string
  size?: string
  quantity?: number
  unitPrice?: number
  sourceType?: 'warehouse' | 'boutique' | 'workshop'
  workshopComment?: string
  workshopUrgent?: boolean
  workshopDueDate?: string
  stockObservationEnabled?: boolean
  observedPhysicalQuantity?: number | null
  shortageAcknowledged?: boolean
  serverShortage?: {
    physicalQuantity: number
    reservedQuantity: number
    requestedQuantity: number
    shortage: number
  }
}



export type Payment = {
  id?: number
  draftKey?: string
  paymentDate: string
  method: string
  amount: number
  paymentKind: 'primary' | 'debt_close' | 'extra'
  comment?: string
}



export type EditorItem = OrderItem


export type EditorPayment = Payment


export type ReturnEntry = {
  id: number
  returnDate: string
  amount: number
  paymentMethod?: string | null
  comment?: string | null
  status?: 'completed' | 'cancelled' | string
  cancelledAt?: string | null
  cancellationComment?: string | null
}

export type ReturnHistoryItem = {
  id: number
  orderItemId?: number | null
  productName: string
  quantity: number
  gender?: string | null
  color?: string | null
  material?: string | null
  length?: string | null
  size?: string | null
  inventorySource?: 'warehouse' | 'boutique' | null | string
  restocked?: boolean
  lifecycleStatus?: 'pending' | 'applied' | 'cancelled' | null | string
  pendingReason?: string | null
}

export type ReturnHistoryEntry = ReturnEntry & {
  orderId: number
  externalId: string
  orderDate: string
  managerId?: number | null
  manager: string
  managerColor?: string | null
  customer: string
  city: string
  operationType: 'order_return' | 'exchange_refund' | string
  exchangeId?: number | null
  items: ReturnHistoryItem[]
}

export type ReturnHistoryResponse = {
  ok: boolean
  count: number
  offset?: number
  limit?: number
  hasMore?: boolean
  summary: {
    activeCount: number
    cancelledCount: number
    activeAmount: number
  }
  returns: ReturnHistoryEntry[]
}



export type ReturnItemDraft = {
  orderItemId: number
  productName: string
  quantity: number
  maxQuantity: number
  sourceType: 'warehouse' | 'boutique' | 'workshop'
  restock: boolean
}



export type ReturnDraft = {
  returnDate: string
  amount: number
  paymentMethod: string
  comment: string
  restockSource: 'none' | 'warehouse' | 'boutique'
  items: ReturnItemDraft[]
}



export type ExchangeDraft = {
  orderId: number | null
  exchangeDate: string
  oldItemId: number
  oldQuantity: number
  oldReturnSource: 'none' | 'warehouse' | 'boutique'
  newItem: EditorItem
  financialAction: 'none' | 'extra_payment' | 'refund'
  financialAmount: number
  paymentMethod: string
  comment: string
  newSourceWasManuallyChanged: boolean
}



export type ActivityLogEntry = {
  id: number
  eventType: string
  entityType: string
  entityId: number | null
  orderId: number | null
  externalOrderId: string
  title: string
  details: string
  amount: number
  createdAt: string
  managerName?: string | null
  managerColor?: string | null
}



export type ManagerOption = {
  id: number
  name: string
  colorKey: string
  hiredAt?: string
}



export type TeamEmployee = ManagerOption & {
  role: string
  phone: string
  accountEmails?: string
  accountsCount?: number
  comment: string
  isActive: boolean
  dismissedAt?: string
  referenceCount?: number
  canDelete?: boolean
  createdAt?: string
  updatedAt?: string
}



export type LeadRecord = {
  id: number
  date: string
  managerId?: number
  manager: string
  managerColor?: string
  acceptedCount: number
  badCount: number
  qualifiedCount: number
  salesCount: number
  conversionRate: number
  comment: string
}



export type CallCentreRecord = {
  id: number
  date: string
  managerId?: number
  manager: string
  managerColor?: string
  acceptedLeads: number
  callsMade: number
  callsAccepted: number
  fakeCount: number
  refusalCount: number
  potentialCount: number
  callAcceptanceRate: number
  comment: string
}



export type ManagerPlanRecord = {
  id: number
  periodStart: string
  periodEnd: string
  managerId?: number
  manager: string
  managerColor?: string
  plannedAmount: number
  salaryBase: number
  bonusHitPercent?: number
  bonusMissPercent?: number
  bonusAmount?: number
  totalSalary?: number
  factAmount: number
  returnAmount: number
  completionRate: number
  comment: string
}



export type DepartmentPlanRecord = {
  id: number
  periodStart: string
  periodEnd: string
  plannedAmount: number
  factAmount: number
  returnAmount: number
  completionRate: number
  comment: string
}




export type TeamMode = 'employees' | 'timesheet' | 'plan' | 'salary' | 'activity'



export type TeamTimesheetEmployee = {
  id: number
  name: string
  role: string
  isActive: boolean
  colorKey?: string
  hiredAt?: string
}



export type TeamTimesheetEntry = {
  id: number
  date: string
  managerId: number
  manager: string
  managerColor?: string
  workUntil: string
  comment: string
}



export type TeamTimesheetResponse = {
  ok: boolean
  month: string
  startDate: string
  endDate: string
  employees: TeamTimesheetEmployee[]
  entries: TeamTimesheetEntry[]
}



export type TeamSalaryRow = {
  managerId?: number
  manager: string
  managerColor?: string
  role: string
  isActive: boolean
  workDays: number
  actionsCount: number
  plannedAmount: number
  factAmount: number
  returnAmount: number
  completionRate: number
  salaryBase: number
  bonusAmount: number
  totalSalary: number
}



export type TeamSalaryResponse = {
  ok: boolean
  startDate: string
  endDate: string
  rows: TeamSalaryRow[]
  totals: {
    employees: number
    active: number
    workDays: number
    salaryBase: number
    bonusAmount: number
    totalSalary: number
  }
}



export type TeamActivityType = 'all' | 'orders' | 'debt' | 'payments' | 'returns' | 'exchanges'


export type AccessRole = 'admin' | 'manager'


export type AuthUser = {
  id: number
  email: string
  role: AccessRole
  managerId: number | null
  managerName: string | null
  displayName: string
  mustChangePassword?: boolean
}



export type SimpleAdminStatusResponse = {
  ok: boolean
  isAdmin: boolean
  role: AccessRole
  user?: AuthUser
}



export type ManagedAuthUser = AuthUser & {
  isActive: boolean
  createdAt?: string
  lastLoginAt?: string
}




export type TeamActivityRow = {
  id: string
  actionType: string
  actionAt: string
  actionDate: string
  orderId: number
  externalOrderId: string
  managerId?: number
  manager: string
  managerColor?: string
  role: string
  title: string
  amount: number
  details: string
}



export type TeamActivitySummaryRow = {
  managerId?: number
  manager: string
  managerColor?: string
  role: string
  orders: number
  debtClosed: number
  payments: number
  returns: number
  exchanges: number
  totalActions: number
  totalAmount: number
}



export type TeamActivityResponse = {
  ok: boolean
  startDate: string
  endDate: string
  actionType: TeamActivityType
  count: number
  offset: number
  limit: number
  hasMore: boolean
  rows: TeamActivityRow[]
  summary: TeamActivitySummaryRow[]
  totals: {
    actions: number
    orders: number
    debtClosed: number
    payments: number
    returns: number
    exchanges: number
  }
}




export type PaymentMethodsByDayRow = {
  date: string
  total: number
  methods: Record<string, number>
}



export type ManagerReportDay = {
  date: string
  orderCount: number
  totalSales: number
  totalReceived: number
  totalReturns: number
  totalDebt: number
  managers: Array<{ managerId?: number; manager: string; colorKey?: string; order_count: number; total_sales: number; total_received: number; primary_received: number; order_extra_received?: number; debt_closed: number; extra_received?: number; total_returns: number; total_debt: number; avg_check: number }>
}



export type ProductReportDay = {
  date: string
  quantity: number
  orderCount: number
  products: Array<{ product: string; quantity: number; order_count: number }>
}



export type CityReportDay = {
  date: string
  orderCount: number
  totalSales: number
  cities: Array<{ city: string; order_count: number; total_sales: number; total_received: number; total_debt: number; clients: number; managers: number; avg_check: number }>
}



export type ReturnReportDay = {
  date: string
  count: number
  total: number
  returns: Array<{ id: number; external_id: string; order_date: string; operation_date?: string; manager: string; customer: string; amount: number; items: string; comment: string; status: string }>
}



export type ClosedDebtReportDay = {
  date: string
  count: number
  total: number
  rows: Array<{ id: number; external_id: string; order_date: string; operation_date?: string; manager: string; customer: string; city: string; method: string; amount: number; comment: string }>
}





export type FinancialHistoryEntry = {
  id: number
  orderId?: number | null
  externalOrderId: string
  orderDate?: string | null
  orderCreatedAt?: string | null
  eventDate: string
  eventAt: string
  eventRecordedAt?: string | null
  eventType: string
  relatedType: string | null
  operationLabel: string
  amountDelta: number
  paymentMethod: string | null
  manager?: string | null
  managerColor?: string | null
  reason: string | null
  comment: string | null
  isBackfill: boolean
  sourceType?: string | null
  sourceId?: number | null
  sourceRef?: string | null
  dateRelation?: 'before_order' | 'same_day' | 'after_order' | 'unknown' | string
  dateOffsetDays?: number
  traceCode?: string
  traceSeverity?: 'normal' | 'info' | 'review' | string
  traceTitle?: string
  traceExplanation?: string
}

export type FinancialHistoryResponse = {
  ok: boolean
  count: number
  offset: number
  limit: number
  hasMore: boolean
  summary: {
    totalIn: number
    totalOut: number
    net: number
  }
  events: FinancialHistoryEntry[]
}

export type FinancePaymentOperation = {
  id: number
  orderId: number
  externalId: string
  orderDate: string
  paymentDate: string
  method: string
  amount: number
  paymentKind: string
  operationType: 'order_payment' | 'order_extra' | 'debt_close' | 'exchange_extra' | string
  operationLabel: string
  comment: string
  managerId?: number | null
  manager: string
  managerColor?: string | null
  customer: string
  city: string
  dateRelation: 'before_order' | 'same_day' | 'after_order' | string
  dateOffsetDays: number
  createdAt: string
  orderCreatedAt: string
  recordedLagDays: number
  orderRecordedLagDays: number
  eventLineageStatus: 'source_id' | 'exact_fingerprint' | 'ambiguous' | 'missing' | string
  eventId?: number | null
  eventAt?: string | null
  eventRecordedAt?: string | null
  eventType?: string | null
  eventReason?: string | null
  eventIsBackfill: boolean
  traceCode: string
  traceSeverity: 'normal' | 'info' | 'review'
  traceTitle: string
  traceExplanation: string
}

export type FinancePaymentKindSummary = {
  operationType: string
  label: string
  count: number
  total: number
}

export type FinanceConsistency = {
  ledgerTotal: number
  methodsTotal: number
  kindsTotal: number
  difference: number
  ok: boolean
}

export type OrdersFinanceSummaryResponse = {
  ok: boolean
  startDate: string
  endDate: string
  generatedAt: string
  overview: {
    orderCount: number
    totalSales: number
    avgCheck: number
    grossReceived: number
    totalReturned: number
    currentDebt: number
    currentDebtOrders: number
  }
}


export type FinanceReportResponse = {
  ok: boolean
  startDate: string
  endDate: string
  generatedAt: string
  overview: {
    orderCount: number
    totalSales: number
    totalReceived: number
    totalReturns: number
    netCash: number
    periodDebt: number
    avgCheck: number
    paymentCount: number
    orderPaymentsTotal: number
    orderExtraPaymentsTotal: number
    debtPaymentsTotal: number
    exchangeExtraPaymentsTotal: number
    grossReceived: number
    regularReturnsTotal: number
    exchangeRefundsTotal: number
    totalReturned: number
    extraExchangeTotal: number
    refundExchangeTotal: number
    paymentDateAnomalyCount: number
    paymentDateAnomalyTotal: number
    paymentTraceReviewCount?: number
    paymentTraceInfoCount?: number
    crossDatePaymentCount?: number
    crossDatePaymentTotal?: number
    currentDebt: number
    currentDebtOrders: number
  }
  reports: {
    paymentMethods: Array<{ method: string; count: number; total: number }>
    paymentKinds?: FinancePaymentKindSummary[]
    paymentOperations?: FinancePaymentOperation[]
    paymentDateAnomalies?: FinancePaymentOperation[]
    paymentTraceReview?: FinancePaymentOperation[]
    paymentTraceInfo?: FinancePaymentOperation[]
    crossDatePaymentOperations?: FinancePaymentOperation[]
    traceScope?: { startDate: string; endDate: string; selectedOperationPeriodOnly: boolean; includesOrderPeriodBeforePayments: boolean }
    consistency?: FinanceConsistency
    managers: Array<{ manager_id?: number; manager: string; color_key?: string; order_count: number; total_sales: number; total_received: number; total_returns: number; total_debt: number; avg_check: number }>
    products: Array<{ product: string; quantity: number; order_count: number; order_sales: number }>
    cities: Array<{ city: string; order_count: number; total_sales: number; total_received: number; total_debt: number; total_returns: number; clients: number; managers: number }>
    days: Array<{ date: string; order_count: number; total_sales: number; total_received: number; total_returns: number; total_debt: number }>
    returns: Array<{ id: number; order_id: number; external_id: string; order_date: string; return_date: string; amount: number; status: string; comment: string; manager: string; manager_color?: string; customer?: string; city?: string; return_type?: 'order_return' | 'exchange_refund' | string }>
    exchanges: Array<{ id: number; order_id: number; external_id: string; order_date: string; exchange_date: string; old_quantity: number; old_return_source: string; new_source_type: string; financial_action: string; financial_amount: number; status: string; comment: string }>
    closedDebts: Array<{ id: number; order_id: number; external_id: string; order_date: string; payment_date: string; method: string; amount: number; comment: string }>
    currentDebtTop: Array<{ id: number; external_id: string; order_date: string; manager: string; customer: string; debt_amount: number }>
    inventoryMovements: Array<{ movement_type: string; inventory_source: string; count: number; quantity_delta: number }>
    repeatClients: Array<{ client_key: string; client: string; period_orders: number; period_sales: number; total_orders: number; first_order_at: string; last_order_at: string }>
    activityByType: Array<{ event_type: string; count: number }>
    paymentMethodsByDay?: PaymentMethodsByDayRow[]
    managerDays?: ManagerReportDay[]
    productDays?: ProductReportDay[]
    cityDays?: CityReportDay[]
    returnDays?: ReturnReportDay[]
    closedDebtDays?: ClosedDebtReportDay[]
    leads?: LeadRecord[]
    leadsTotals?: { acceptedCount: number; badCount: number; qualifiedCount: number; salesCount: number }
    callCentre?: CallCentreRecord[]
    callCentreTotals?: { acceptedLeads: number; callsMade: number; callsAccepted: number; fakeCount: number; refusalCount: number; potentialCount: number }
    managerPlans?: ManagerPlanRecord[]
    departmentPlans?: DepartmentPlanRecord[]
    teamEmployees?: TeamEmployee[]
  }
}



export type ExchangeHistoryResponse = {
  ok: boolean
  count: number
  offset?: number
  limit?: number
  hasMore?: boolean
  summary?: { activeCount: number; cancelledCount: number }
  exchanges: ExchangeHistoryEntry[]
}

export type ExchangeHistoryEntry = {
  id: number
  orderId: number
  externalId: string
  orderDate: string
  manager: string
  managerColor?: string | null
  customer: string
  exchangeDate: string
  oldProductName: string
  oldQuantity: number
  oldGender?: string | null
  oldColor?: string | null
  oldMaterial?: string | null
  oldLength?: string | null
  oldSize?: string | null
  oldReturnSource: 'none' | 'warehouse' | 'boutique' | string
  newProductName: string
  newQuantity: number
  newGender?: string | null
  newColor?: string | null
  newMaterial?: string | null
  newLength?: string | null
  newSize?: string | null
  newSourceType: 'warehouse' | 'boutique' | 'workshop' | string
  oldLifecycleStatus?: 'pending' | 'applied' | 'cancelled' | null | string
  newLifecycleStatus?: 'pending' | 'applied' | 'cancelled' | null | string
  financialAction: 'none' | 'extra_payment' | 'refund' | string
  financialAmount: number
  paymentMethod?: string
  status: 'completed' | 'cancelled' | string
  comment?: string
  cancelledAt?: string | null
  cancellationComment?: string | null
}



export type OrderRecord = {
  id: number
  external_id: string
  order_date: string
  manager_id?: number | null
  manager_name: string | null
  manager_color?: string | null
  customer_phone: string | null
  customer_name: string | null
  city: string | null
  delivery_type: string | null
  source_type: 'warehouse' | 'boutique'
  workshop_status: string
  order_status: string
  shipping_status?: 'not_sent' | 'sent' | string | null
  shipping_date?: string | null
  stock_handover_review_needed?: boolean
  stock_handover_has_active_items?: boolean
  total_amount: number
  received_amount: number
  debt_amount: number
  return_amount: number
  comment: string | null
  archived_at?: string | null
  archived_by?: string | null
  archive_reason?: string | null
  archive_batch_id?: string | null
  retained_only?: boolean
  retained_summary_text?: string | null
  retained_payment_count?: number
  retained_return_count?: number
  items: Array<{
    id?: number
    productName: string
    audienceType?: string | null
    gender?: string | null
    color?: string | null
    material?: string | null
    length?: string | null
    size?: string | null
    quantity: number
    unitPrice: number
    lineTotal: number
    sourceType: string
    workshopComment?: string | null
    workshopUrgent?: boolean
    workshopDueDate?: string | null
    isWorkshop?: boolean
    workshopTaskStatus?: string | null
  }>
  payments: Array<{
    id?: number
    paymentDate: string
    method: string
    amount: number
    paymentKind: string
    comment?: string | null
  }>
  returns: ReturnEntry[]
}



export type ApiState = {
  ok: boolean
  service?: string
  database?: string
  time?: string
  result?: { ok: number; now: string }
}



export type OrderPeriodStats = {
  orderCount: number
  totalAmount: number
  paymentCount: number
  paymentAmount: number
  debtAmount: number
  returnCount: number
  returnAmount: number
  workshopUnits: number
}



export type OrderListResponse = {
  ok: boolean
  count: number
  limit: number
  offset: number
  pageCount?: number
  totalCount?: number
  hasMore?: boolean
  hasPrevious?: boolean
  periodStats?: OrderPeriodStats
  orders: OrderRecord[]
}



export type ClientListItem = {
  id: number
  phone: string
  name: string
  city: string
  cities: string[]
  managers: string[]
  managerProfiles?: ManagerOption[]
  orderCount: number
  totalAmount: number
  receivedAmount: number
  debtAmount: number
  returnAmount: number
  firstOrderAt: string
  lastOrderAt: string
  activeOrderCount: number
  archivedOrderCount: number
  avgCheck: number
}



export type ClientsResponse = {
  ok: boolean
  mode: ClientMode
  q: string
  limit: number
  offset: number
  count: number
  summary: {
    totalClients: number
    repeatClients: number
    debtClients: number
    totalDebt: number
    totalSales: number
    totalReceived: number
    totalReturns: number
    orderCount: number
    activeOrderCount: number
    archivedOrderCount: number
    avgCheck: number
  }
  clients: ClientListItem[]
}



export type ClientOrderRecord = OrderRecord & {
  itemsText?: string
  archived_at?: string | null
  archived_by?: string | null
  archive_reason?: string | null
}



export type ClientDetailsResponse = {
  ok: boolean
  client: ClientListItem
  orderOffset?: number
  orderLimit?: number
  totalOrderCount?: number
  hasMore?: boolean
  orders: ClientOrderRecord[]
}



export type ArchivePreviewResponse = {
  ok: boolean
  rules: {
    cutoffDate: string
    reason: string
    includeNotSent: boolean
    limit: number
  }
  eligibleCount: number
  totalActiveOrders: number
  blocked: {
    notClosed: number
    tooNew: number
    withDebt: number
    activeWorkshop: number
    notSent: number
  }
  orders: Array<{
    id: number
    externalId: string
    orderDate: string
    manager: string
    totalAmount: number
    receivedAmount: number
    debtAmount: number
    shippingStatus: string
    workshopStatus: string
  }>
  archivedCount?: number
  batchId?: string
  message?: string
}



export type ReferenceData = {
  ok: boolean
  managers: string[]
  managerOptions: ManagerOption[]
  cities: string[]
  deliveryTypes: string[]
  paymentMethods: string[]
  products: string[]
  adultProducts: string[]
  childProducts: string[]
  colors: string[]
  materials: string[]
  lengths: string[]
  sizes: string[]
  childAges: string[]
  returnReasons: string[]
  writeoffReasons: string[]
}



export type ReferenceKind = 'cities' | 'deliveryTypes' | 'colors' | 'materials' | 'lengths' | 'sizes' | 'childAges' | 'returnReasons' | 'writeoffReasons'



export type OrderPanel = 'create' | 'list' | 'edit' | 'debt' | 'returns' | 'exchange' | 'activity'


export type FinanceReportType = 'payments' | 'managers' | 'products' | 'cities' | 'returns' | 'debts' | 'leads' | 'callCentre'


export type AppSector = 'overview' | 'orders' | 'clients' | 'workshop' | 'inventory' | 'finance' | 'references' | 'reports' | 'leads' | 'plan' | 'team'


export type InventoryPanel = 'overview' | 'attention' | 'stocktake' | 'movement' | 'settings' | 'exact' | 'warehouse' | 'boutique' | 'catalog' | 'history' | 'audit'


export type InventoryStatusFilter = 'all' | 'positive' | 'zero' | 'negative'


export type InventoryCategoryFilter = 'all' | 'adult' | 'child'


export type InventorySortMode = 'name' | 'quantityDesc' | 'quantityAsc' | 'updated'


export type InventorySourceKey = 'warehouse' | 'boutique'


export type OrderPeriodPreset = 'today' | 'yesterday' | 'month' | 'year' | 'custom'


export type ArchiveMode = 'active' | 'archived' | 'all'


export type ClientMode = 'all' | 'repeat' | 'debt'



export type ReferenceListItem = {
  id: number
  value: string
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}



export type InventoryStockRecord = {
  id: number
  inventorySource: string
  productId: number
  variantId: number
  productName: string
  gender: string
  color: string
  material: string
  length: string
  size: string
  audienceType: string
  quantity: number
  reservedQuantity: number
  availableQuantity: number
  lastAction: string
  lastSourceRef: string
  updatedAt: string
  createdAt: string
}



export type InventoryMovementRecord = {
  id: number
  inventorySource: string
  movementType: string
  productId: number
  variantId: number
  productName: string
  gender: string
  color: string
  material: string
  length: string
  size: string
  quantityDelta: number
  quantityAfter: number
  referenceType: string
  referenceId: string
  comment: string
  createdAt: string
  reversedAt: string
  reversalMovementId: number
  isReversal: boolean
  canReverse: boolean
}



export type InventoryHistoryResponse = {
  ok: boolean
  hasMore: boolean
  nextBeforeId?: number | null
  movements: Array<InventoryMovementRecord & {
    transferFromSource?: string | null
    transferToSource?: string | null
    transferStatus?: string | null
    transferComment?: string | null
    transferItemCount?: number
    transferTotalQuantity?: number
  }>
}

export type InventoryCheckHistoryRow = {
  kind: 'stocktake' | 'check'
  id: string
  source: 'warehouse' | 'boutique'
  scope?: 'full' | 'selective' | null
  checkedAt: string
  checkedBy?: string | null
  itemCount: number
  differenceCount: number
  netDelta: number
  referenceType?: string
  referenceId?: string
  checkType: string
  expectedQuantity?: number
  countedQuantity?: number
}

export type InventoryCheckHistoryResponse = { ok: boolean; rows: InventoryCheckHistoryRow[] }

export type InventoryResponse = {
  ok: boolean
  source: 'warehouse' | 'boutique'
  count: number
  total: number
  zeroCount: number
  inventoryModelVersion?: number
  reservedTotal?: number
  availableTotal?: number
  items: InventoryStockRecord[]
  movements: InventoryMovementRecord[]
  movementsIncluded?: boolean
}



export type CatalogReviewItem = {
  orderItemId: number
  orderId: number
  externalId: string
  orderDate: string
  shippingStatus: string
  shippingDate: string
  productId: number | null
  variantId: number | null
  productName: string
  category: 'adult' | 'child'
  gender: string
  color: string
  material: string
  length: string
  size: string
  quantity: number
  sourceType: string
  inputKey: string
  affectedCount?: number
}



export type CatalogReviewResponse = {
  ok: boolean
  mode?: 'current' | 'order'
  orderId?: number | null
  recentDays?: number
  count: number
  items: CatalogReviewItem[]
  autoResolved?: number
  affectedItems?: number
  historicalHiddenItems?: number
  historicalHiddenGroups?: number
  truncated?: boolean
  message?: string
}



export type InventoryLifecyclePendingItem = {
  id: number
  eventKey: string
  eventType: 'return_in' | 'exchange_old_in' | 'exchange_new_out' | string
  direction: 'in' | 'out' | string
  operationType: 'return' | 'exchange' | string
  operationId: number
  orderId: number
  orderItemId: number | null
  externalId: string
  orderDate: string
  inventorySource: InventorySourceKey
  quantity: number
  productId: number | null
  variantId: number | null
  productName: string
  category: 'adult' | 'child'
  gender: string
  color: string
  material: string
  length: string
  size: string
  isWorkshop: boolean
  pendingReason: string
  createdAt: string
}

export type InventoryLifecyclePendingResponse = {
  ok: boolean
  count: number
  items: InventoryLifecyclePendingItem[]
}

export type InventoryControlSettings = {
  ok: boolean
  autoWriteoffEnabled: boolean
  pendingWriteoffCount: number
}




export type InventoryAuditRow = {
  checkType: string
  source: string
  movementType: string
  referenceType: string
  referenceId: string
  externalOrderId?: string
  productName: string
  gender?: string | null
  color?: string | null
  material?: string | null
  length?: string | null
  size?: string | null
  variantId?: number | null
  quantityDelta: number
  status: 'ok' | 'missing' | 'resolved'
  note: string
  issueKey: string
  resolvedAt?: string
  resolutionComment?: string
}



export type InventoryAuditResponse = {
  ok: boolean
  checkedAt: string
  summary: {
    totalExpectedMovements: number
    okMovements: number
    resolvedMovements: number
    missingMovements: number
    lookupBatches: number
  }
  byType: Array<{ checkType: string; total: number; missing: number; resolved: number }>
  rows: InventoryAuditRow[]
  missing: InventoryAuditRow[]
  resolved: InventoryAuditRow[]
}




export type InventoryStockGroup = {
  key: string
  source: InventorySourceKey
  productName: string
  displayName: string
  positionMaterial: string
  positionLength: string
  category: 'adult' | 'child'
  adultVariantCount: number
  childVariantCount: number
  rows: InventoryStockRecord[]
  totalQuantity: number
  variantCount: number
  negativeCount: number
  zeroCount: number
  positiveCount: number
  updatedAt: string
  colors: string[]
  sizes: string[]
  materials: string[]
  genders: string[]
}



export type CatalogProductRecord = {
  id: number
  name: string
  category: string
  isActive: boolean
  variantsCount: number
  createdAt: string
  updatedAt: string
}



export type CatalogVariantRecord = {
  id: number
  productId: number
  productName: string
  productCategory: string
  gender: string
  color: string
  material: string
  length: string
  sizeLabel: string
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}



export type CatalogResponse = {
  ok: boolean
  products: CatalogProductRecord[]
  productAliases?: Array<{ rawValue: string; productId: number; productName: string }>
  valueAliases?: Array<{ kind: string; rawValue: string; canonicalValue: string }>
  variants: CatalogVariantRecord[]
}



export type WorkshopTaskRecord = {
  id: number
  orderId: number
  orderItemId?: number | null
  externalOrderId: string
  productName: string
  gender: string
  color: string
  material: string
  length: string
  size: string
  audienceType: string
  quantity: number
  comment: string
  urgent: boolean
  dueDate: string
  status: 'active' | 'ready' | 'done' | 'cancelled' | string
  orderDate: string
  managerId: number
  managerName: string
  customerPhone: string
  customerName: string
  city: string
  deliveryType: string
  totalAmount: number
  receivedAmount: number
  debtAmount: number
  shippingStatus: string
  shippingDate: string
  exchangeId?: number | null
  exchangeDate?: string
  createdAt: string
  updatedAt: string
}



export type WorkshopResponse = {
  ok: boolean
  view: 'active' | 'urgent' | 'invoice' | 'done'
  period: { dateFrom: string; dateTo: string }
  urgentOnly: boolean
  count: number
  countsIncluded?: boolean
  activeCount: number
  urgentCount: number
  doneCount: number
  tasks: WorkshopTaskRecord[]
}




export type DashboardLowStockItem = {
  id: number
  source: InventorySourceKey
  sourceLabel: string
  productId: number
  variantId: number
  productName: string
  gender: string
  color: string
  material: string
  length: string
  size: string
  audienceType: string
  quantity: number
  reservedQuantity: number
  demandQuantity: number
  demandOrders: number
  latestOrderId: string
  latestOrderDate: string
  demandSources: string[]
  lastAction: string
  lastSourceRef: string
  updatedAt: string
  priorityScore: number
  reason: string
}



export type DashboardWorkshopWarning = {
  id: number
  orderId: number
  externalOrderId: string
  productId: number
  variantId: number
  productName: string
  gender: string
  color: string
  material: string
  length: string
  size: string
  audienceType: string
  quantity: number
  comment: string
  urgent: boolean
  dueDate: string
  status: string
  orderDate: string
  waitingDays: number
  overdueDays: number
  managerName: string
  customerPhone: string
  customerName: string
  city: string
  deliveryType: string
  priorityScore: number
  reason: string
}



export type DashboardInsightsResponse = {
  ok: boolean
  generatedAt: string
  thresholds: {
    lowStockLimit: number
    workshopAgeLimit: number
  }
  summary: {
    monthPlan?: number
    monthPlanCompletion?: number
    monthOrderCount?: number
    monthTotalSales?: number
    monthTotalReceived?: number
    monthTotalReturns?: number
    monthCurrentDebt?: number
    monthAvgCheck?: number
    monthSentOrders?: number
    monthNotSentOrders?: number
    monthNewClients?: number
    monthRepeatClients?: number
    criticalStockCount: number
    negativeStockCount: number
    zeroStockCount: number
    popularLowStockCount: number
    workshopWarningCount: number
    workshopActiveTotal: number
    warehouseWarnings: number
    boutiqueWarnings: number
  }
  lowStock: DashboardLowStockItem[]
  workshopWarnings: DashboardWorkshopWarning[]
}



export type WorkshopInvoiceRow = {
  key: string
  priority: number
  urgent: boolean
  hasComment: boolean
  isSpecialOrder: boolean
  orderId: number
  orderDate: string
  productName: string
  characteristics: string
  quantity: number
  orderRef: string
  comment: string
  dueDate: string
}



export type WorkshopView = 'active' | 'urgent' | 'invoice' | 'done'


export type WorkshopPeriodPreset = 'today' | 'yesterday' | 'month' | 'custom'



export type WorkspaceModule = {
  id: string
  label: string
  icon: string
  note: string
  href: string
  status: 'active' | 'ready' | 'planned'
}



export type EditorDraft = {
  orderDate: string
  managerId: number
  managerName: string
  customerPhone: string
  customerName: string
  city: string
  deliveryType: string
  sourceType: 'warehouse' | 'boutique'
  orderTotal: string
  workshopStatus: 'in_workshop' | 'ready' | 'shipped' | 'cancelled'
  orderStatus: 'active' | 'closed' | 'archived' | 'deleted'
  comment: string
  items: EditorItem[]
  payments: EditorPayment[]
}





export type InventoryArrivalSizeLine = {
  id: string
  size: string
  color: string
  quantity: number
}

export type InventoryArrivalPosition = {
  id: string
  productId: string
  productName: string
  category: 'adult' | 'child'
  gender: string
  material: string
  length: string
  sizes: InventoryArrivalSizeLine[]
}

export type CashRegisterEntry = {
  id: number
  occurredAt: string
  businessDate: string
  direction: 'in' | 'out'
  amount: number
  entryType: string
  sourceType: string
  sourceId?: string | null
  orderId?: number | null
  externalOrderId?: string | null
  paymentMethod?: string | null
  comment?: string | null
  createdBy?: string | null
  createdAt: string
  balanceAfter: number
  reversible?: boolean
  reversed?: boolean
}

export type CashRegisterCycle = {
  id: number
  startedAt?: string | null
  closedAt: string
  closedBusinessDate?: string | null
  closedBy?: string | null
  closeComment?: string | null
  entryCount: number
  totalIn: number
  totalOut: number
  closingBalance: number
}

export type CashRegisterCyclesResponse = { ok: boolean; cycles: CashRegisterCycle[]; hasMore?: boolean; offset?: number; limit?: number }

export type CashRegisterResponse = {
  ok: boolean
  initialized: boolean
  autoTrackingEnabled: boolean
  initializedAt?: string | null
  activatedAt?: string | null
  openingAmount: number
  currentBalance: number
  totalIn: number
  totalOut: number
  todayIn: number
  todayOut: number
  archivedEntriesCount?: number
  currentCycleStartedAt?: string | null
  entries: CashRegisterEntry[]
}


export type InventoryDraftItem = {
  productId: string
  variantId: string
  productName: string
  category: 'adult' | 'child'
  gender: string
  color: string
  material: string
  length: string
  size: string
  quantity: number
  touched?: boolean
  expectedQuantity?: number
  observedPhysicalQuantity?: number | null
}



export type InventoryMatrixDraft = {
  productId: string
  productName: string
  category: 'adult' | 'child'
  gender: string
  material: string
  length: string
  extraColors: string[]
  extraSizes: string[]
  ready: boolean
}



export type InventoryDraft = {
  source: 'warehouse' | 'boutique'
  targetSource: 'warehouse' | 'boutique'
  movementType: 'arrival' | 'manual_set' | 'writeoff' | 'transfer'
  comment: string
  items: InventoryDraftItem[]
}


export type InventoryOperationVariantDraft = {
  category: 'adult' | 'child'
  gender: string
  color: string
  material: string
  length: string
  size: string
}




export type SmartPickerRank = {
  matched: boolean
  score: number
  position: number
}



export type SmartPickerInputProps = {
  value: string
  options: string[]
  placeholder?: string
  onChange: (value: string) => void
  onPick?: (value: string) => void
  ariaLabel?: string
  disabled?: boolean
  className?: string
}




export type FriendlyNumberInputProps = React.InputHTMLAttributes<HTMLInputElement>



export type ManagerPickerProps = {
  valueId: number
  valueName?: string
  options: ManagerOption[]
  placeholder?: string
  disabled?: boolean
  onChange: (manager: ManagerOption | null) => void
}



export type ChoicePillsProps = {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  className?: string
}
