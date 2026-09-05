export type ApiOkResponse = {
  ok: boolean
  message?: string
  code?: string
}

export type InventorySource = 'warehouse' | 'boutique'
export type AudienceCategory = 'adult' | 'child'
export type PaymentKind = 'primary' | 'debt_close' | 'extra'
export type OrderItemSource = InventorySource | 'workshop'
export type OrderStatus = 'active' | 'closed' | 'archived' | 'deleted'
export type ShippingStatus = 'not_sent' | 'sent'

export type CatalogResolutionFacts = {
  productId?: number
  material: string
  length: string
  category: AudienceCategory
  gender: string
  color: string
  size: string
}


export type WarehouseAttentionShortageItem = {
  source: InventorySource
  variantId: number
  productId: number
  productName: string
  category: AudienceCategory
  gender: string
  color: string
  material: string
  length: string
  size: string
  physical: number
  reserved: number
  handoverReserved?: number
  countRelevantReserved?: number
  free: number
}

export type WarehouseAttentionLifecycleItem = {
  id: number
  eventType: string
  direction: string
  orderId: number
  orderItemId?: number | null
  externalId: string
  orderDate: string
  source: InventorySource
  quantity: number
  productId?: number | null
  variantId?: number | null
  productName: string
  category: AudienceCategory
  gender: string
  color: string
  material: string
  length: string
  size: string
  isWorkshop: boolean
  pendingReason: string
  createdAt: string
  exactKnown?: boolean
}

export type WarehouseAttentionCatalogItem = {
  orderItemId: number
  orderId: number
  externalId: string
  orderDate: string
  affectedCount: number
  productName: string
  category: AudienceCategory
  gender: string
  color: string
  material: string
  length: string
  size: string
  source: string
  isWorkshop: boolean
}

export type WarehouseAttentionHandoverItem = {
  orderId: number
  externalId: string
  orderDate: string
  orderCreatedAt?: string
  customerName?: string
  orderItemId: number
  productName: string
  itemDetails: string
  source: InventorySource
  quantity: number
  checkpointAt?: string | null
  checkpointKind?: 'revision' | 'check' | null
  reviewReason?: 'late_entry' | 'mixed_order_after_check' | null
  itemCreatedAt?: string | null
}

export type WarehouseAttentionFoundItem = {
  stockId: number
  source: InventorySource
  productId: number
  productName: string
  category: AudienceCategory
  gender: string
  color: string
  material: string
  length: string
  size: string
  physical: number
  createdAt: string
  updatedAt: string
  exactVariantId?: number | null
  exactKnown?: boolean
}

export type WarehouseAttentionStocktakeItem = {
  id: string
  source: InventorySource
  startedAt: string
  updatedAt: string
  totalItems: number
  countedItems: number
  recountItems: number
}

export type WarehouseAttentionSummaryResponse = ApiOkResponse & {
  total: number
  counts: {
    shortage: number
    intake: number
    lifecycle: number
    catalog: number
    handover: number
    stocktake: number
    found?: number
  }
  items?: {
    shortages: WarehouseAttentionShortageItem[]
    intake: WarehouseAttentionLifecycleItem[]
    lifecycle: WarehouseAttentionLifecycleItem[]
    catalog: WarehouseAttentionCatalogItem[]
    handover: WarehouseAttentionHandoverItem[]
    stocktakes: WarehouseAttentionStocktakeItem[]
    found?: WarehouseAttentionFoundItem[]
  }
}

export type CatalogReferenceOptions = {
  materials: string[]
  lengths: string[]
  colors: string[]
  sizes: string[]
  childAges: string[]
  [key: string]: string[]
}

export type CatalogResolutionProduct = {
  id: number
  name: string
  category?: string
}

export type CatalogResolutionExecution = {
  id: number
  material: string
  length: string
}

export type CatalogResolutionContext = {
  ok: boolean
  issueType?: string
  unknownFields?: string[]
  facts?: CatalogResolutionFacts
  product?: CatalogResolutionProduct | null
  execution?: CatalogResolutionExecution | null
  existingVariantId?: number | null
  products?: CatalogResolutionProduct[]
  references?: CatalogReferenceOptions
  orderItemId?: number
  eventId?: number
  isWorkshop?: boolean
  eventType?: string
  direction?: string
  inventorySource?: string
  quantity?: number
  shippingStatus?: string
  executions?: CatalogResolutionExecution[]
  error?: string
  message?: string
  status?: string
  completed?: boolean
}

export type CatalogResolutionInput = CatalogResolutionFacts & {
  productId: number
  createProduct?: boolean
  productName?: string
  createFields?: string[]
}

export type CatalogResolutionResponse = ApiOkResponse & {
  already?: boolean
  applied?: boolean
  eventId?: number
  createdCombination?: boolean
  resolvedGroups?: number
  linked?: number
  linkedItems?: number
  workshopLinked?: number
  reserved?: number
  historicalLinked?: number
  fulfilled?: number
  skipped?: number
  scannedGroups?: number
  excluded?: number
  releasedReservations?: number
}

export type InventoryReservation = {
  id: number
  orderId: number
  orderItemId: number
  source: InventorySource | string
  productId: number
  variantId: number
  quantity: number
  status: string
  externalOrderId: string
  orderDate: string
  shippingStatus: string
  managerName: string
  customerName: string
  customerPhone: string
  productName: string
  gender: string
  color: string
  material: string
  length: string
  size: string
}

export type InventoryReservationsResponse = ApiOkResponse & {
  source: InventorySource
  variantId: number
  productId: number
  totalQuantity: number
  reservations: InventoryReservation[]
}

export type InventoryStocktakeSessionSummary = {
  id: string
  source: InventorySource
  scope: 'full' | 'selective'
  status: string
  createdBy: string
  startedAt: string
  updatedAt: string
  totalItems: number
  countedCount: number
  recountCount: number
}

export type InventoryStocktakeItem = {
  id: number
  sessionId: string
  source: InventorySource
  stockId: number | null
  productId: number
  variantId: number
  productName: string
  category: AudienceCategory
  gender: string
  color: string
  material: string
  length: string
  size: string
  openingQuantity: number
  openingReservedQuantity: number
  baselineQuantity: number
  countedQuantity: number | null
  countedAt: string | null
  status: string
  conflictQuantity: number | null
  appliedQuantity: number | null
  currentQuantity: number
  reservedQuantity: number
}

export type InventoryStocktakeSession = InventoryStocktakeSessionSummary & {
  completedAt: string | null
  cancelledAt: string | null
  shortageCount: number
  items: InventoryStocktakeItem[]
}

export type InventoryStocktakeSessionsResponse = ApiOkResponse & {
  sessions: InventoryStocktakeSessionSummary[]
}

export type InventoryStocktakeCountItem = {
  id: number
  stockId: number | null
  baselineQuantity: number
  countedQuantity: number | null
  countedAt: string | null
  status: string
  conflictQuantity: number | null
  currentQuantity: number
  reservedQuantity?: number
}

export type InventoryStocktakeMutationResponse = ApiOkResponse & {
  resumed?: boolean
  alreadyPresent?: boolean
  sessionId?: string
  session?: InventoryStocktakeSession
  variantIds?: number[]
  createdCount?: number
  addedCount?: number
  alreadyPresentCount?: number
  deferredUnknownCount?: number
  unresolvedFoundCount?: number
  item?: InventoryStocktakeCountItem
}

export type InventoryCycleCountSuggestion = {
  productId: number
  variantId: number
  productName: string
  category: AudienceCategory
  gender: string
  color: string
  material: string
  length: string
  size: string
  physical: number
  reserved: number
  free: number
  lastCheckedAt: string | null
  daysSinceCheck: number | null
  movementsSinceCheck: number
  lastDifference: number
  lastCheckType: string
  reasons: string[]
  priority: number
}

export type InventoryCycleCountSuggestionsResponse = ApiOkResponse & {
  source: InventorySource
  blockedByStocktake: boolean
  activeStocktakeId: string | null
  totalPositions: number
  recommendedCount: number
  items: InventoryCycleCountSuggestion[]
  policy: {
    dueAfterDays: number
    highDueAfterDays: number
    movementAttention: number
    movementHigh: number
  }
}

export type InventoryCycleCountConflict = {
  variantId: number
  expectedQuantity: number
  currentQuantity: number
  productName?: string
  color?: string
  size?: string
}

export type InventoryCycleCountResult = {
  variantId: number
  previousQuantity: number
  physical: number
  reserved: number
  free: number
  changed: boolean
}

export type InventoryCycleCountApplyResponse = ApiOkResponse & {
  sessionId?: string
  conflicts?: InventoryCycleCountConflict[]
  changedCount?: number
  results?: InventoryCycleCountResult[]
  changed?: boolean
  previousQuantity?: number
  physical?: number
  reserved?: number
  free?: number
}
