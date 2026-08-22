import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import type {
  CatalogProductRecord,
  CatalogResponse,
  CatalogVariantRecord,
  ClientDetailsResponse,
  ClientsResponse,
  InventoryArrivalPosition,
  InventoryCategoryFilter,
  InventoryDraft,
  InventoryDraftItem,
  InventoryOperationVariantDraft,
  InventoryPanel,
  InventoryResponse,
  InventorySortMode,
  InventorySourceKey,
  InventoryStatusFilter,
  InventoryStockRecord,
  OrderPeriodStats,
  OrderRecord,
  Payment,
  ReferenceData,
  ReferenceKind,
  WorkshopInvoiceRow,
  WorkshopPeriodPreset,
  WorkshopResponse,
  WorkshopView,
} from '../types'
import {
  formatDateShort,
  getCatalogVariantCategory,
  getVariantCategoryFromFields,
  inferProductCategoryFromVariants,
  isReturnedOrderRecord,
  normalizeSearchText,
  normalizeSuggestion,
  productCategoryLabel,
  sortSizeLikeValues,
  workshopInvoiceCharacteristics,
  workshopInvoiceProductTitle,
} from '../utils'
import { buildInventoryStockGroups } from '../../features/inventory/buildInventoryStockGroups'
import { createEmptyArrivalPosition, inventoryUiId } from '../../features/inventory/inventoryDraftFactories'

type OperationalViewModelArgs = {
  activeSector: import('../types').AppSector
  catalogCategoryFilter: InventoryCategoryFilter
  catalogData: CatalogResponse | null
  catalogOnlyWithoutVariants: boolean
  catalogProductDraft: { id: number; name: string; category: 'adult' | 'child' }
  catalogVariantDraft: { id: number; productId: string; category: 'adult' | 'child'; gender: string; color: string; material: string; length: string; sizeLabel: string; sortOrder: string }
  clientDetails: ClientDetailsResponse | null
  clientsData: ClientsResponse | null
  dashboardInsights: import('../types').DashboardInsightsResponse | null
  debtAllOrders: OrderRecord[]
  debtAllOrdersLoaded: boolean
  debtCloseHistoryRows: Array<{ id: string; paymentDate: string; orderDate: string; orderId: string; manager: string; managerColor?: string; customer: string; method: string; amount: number; comment: string }>
  debtFilters: { q: string; manager: string; orderDate: string }
  debtPayments: Payment[]
  debtSelectedOrderId: number | null
  editorOrderOverride: OrderRecord | null
  exchangeSelectedOrderId: number | null
  inventoryArrivalPositions: InventoryArrivalPosition[]
  inventoryCategoryFilter: InventoryCategoryFilter
  inventoryData: { warehouse: InventoryResponse | null; boutique: InventoryResponse | null }
  inventoryDraft: InventoryDraft
  inventoryExistingVariantSearch: string
  inventoryOperationProductKey: string
  inventoryOperationSearch: string
  inventoryOperationVariant: InventoryOperationVariantDraft
  inventoryPanel: InventoryPanel
  inventoryQuery: string
  inventoryQuickFilters: { gender: string; color: string; material: string; length: string; size: string }
  inventorySortMode: InventorySortMode
  inventoryStatusFilter: InventoryStatusFilter
  isAdmin: boolean
  orderPeriodStats: OrderPeriodStats | null
  orders: OrderRecord[]
  referenceKindCounts: Partial<Record<ReferenceKind, { total: number; active: number; inactive: number }>>
  references: ReferenceData | null
  returnSelectedOrderId: number | null
  selectedClientId: number | null
  selectedOrderId: number | null
  selectedWorkshopTaskIds: number[]
  setInventoryArrivalPositions: Dispatch<SetStateAction<InventoryArrivalPosition[]>>
  setInventoryArrivalVariantOpen: Dispatch<SetStateAction<Record<string, boolean>>>
  setSelectedWorkshopTaskIds: Dispatch<SetStateAction<number[]>>
  workshopData: WorkshopResponse | null
  workshopFilters: { view: WorkshopView; period: WorkshopPeriodPreset; dateFrom: string; dateTo: string; urgentOnly: boolean; q: string }
  workshopSortDirection: 'oldest' | 'newest'
}

export function useOperationalViewModel({
  activeSector,
  catalogCategoryFilter,
  catalogData,
  catalogOnlyWithoutVariants,
  catalogProductDraft,
  catalogVariantDraft,
  clientDetails,
  clientsData,
  dashboardInsights,
  debtAllOrders,
  debtAllOrdersLoaded,
  debtCloseHistoryRows,
  debtFilters,
  debtPayments,
  debtSelectedOrderId,
  editorOrderOverride,
  exchangeSelectedOrderId,
  inventoryArrivalPositions,
  inventoryCategoryFilter,
  inventoryData,
  inventoryDraft,
  inventoryExistingVariantSearch,
  inventoryOperationProductKey,
  inventoryOperationSearch,
  inventoryOperationVariant,
  inventoryPanel,
  inventoryQuery,
  inventoryQuickFilters,
  inventorySortMode,
  inventoryStatusFilter,
  isAdmin,
  orderPeriodStats,
  orders,
  referenceKindCounts,
  references,
  returnSelectedOrderId,
  selectedClientId,
  selectedOrderId,
  selectedWorkshopTaskIds,
  setInventoryArrivalPositions,
  setInventoryArrivalVariantOpen,
  setSelectedWorkshopTaskIds,
  workshopData,
  workshopFilters,
  workshopSortDirection,
}: OperationalViewModelArgs) {
const summary = useMemo(() => {
    const loadedTotal = orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0)
    const loadedDebt = orders.reduce((sum, order) => sum + Number(order.debt_amount || 0), 0)
    const loadedReturns = orders.reduce((sum, order) => sum + Number(order.return_amount || 0), 0)
    const loadedReceived = orders.reduce((sum, order) => sum + Number(order.received_amount || 0), 0)
    const active = orders.filter((order) => order.order_status === 'active').length
    const loadedWorkshop = orders.reduce((sum, order) => sum + (order.items || []).reduce((itemSum, item) => itemSum + (item.isWorkshop ? Math.max(1, Number(item.quantity || 1)) : 0), 0), 0)
    const paid = orders.filter((order) => Number(order.debt_amount || 0) <= 0).length
    return {
      total: orderPeriodStats?.totalAmount ?? loadedTotal,
      received: orderPeriodStats?.paymentAmount ?? loadedReceived,
      debt: orderPeriodStats?.debtAmount ?? loadedDebt,
      returns: orderPeriodStats?.returnAmount ?? loadedReturns,
      count: orderPeriodStats?.orderCount ?? orders.length,
      active,
      workshop: orderPeriodStats?.workshopUnits ?? loadedWorkshop,
      paid,
    }
  }, [orders, orderPeriodStats])

  const dashboardLowStock = dashboardInsights?.lowStock || []
  const dashboardWorkshopWarnings = dashboardInsights?.workshopWarnings || []
  const dashboardSummary = dashboardInsights?.summary || {
    monthPlan: 0,
    monthPlanCompletion: 0,
    monthOrderCount: 0,
    monthTotalSales: 0,
    monthTotalReceived: 0,
    monthTotalReturns: 0,
    monthCurrentDebt: 0,
    monthAvgCheck: 0,
    monthSentOrders: 0,
    monthNotSentOrders: 0,
    monthNewClients: 0,
    monthRepeatClients: 0,
    criticalStockCount: 0,
    negativeStockCount: 0,
    zeroStockCount: 0,
    popularLowStockCount: 0,
    workshopWarningCount: 0,
    workshopActiveTotal: 0,
    warehouseWarnings: 0,
    boutiqueWarnings: 0,
  }

  const clientSummary = clientsData?.summary || {
    totalClients: 0,
    repeatClients: 0,
    debtClients: 0,
    totalDebt: 0,
    totalSales: 0,
    totalReceived: 0,
    totalReturns: 0,
    orderCount: 0,
    activeOrderCount: 0,
    archivedOrderCount: 0,
    avgCheck: 0,
  }
  const clientsShown = clientsData?.clients?.length || 0
  const clientsTotal = clientsData?.count || 0
  const selectedClientSummary = selectedClientId
    ? (clientDetails?.client || clientsData?.clients.find((client) => client.id === selectedClientId) || null)
    : null

  const referenceSummary = useMemo(() => {
    return {
      cities: references?.cities?.length || 0,
      deliveryTypes: references?.deliveryTypes?.length || 0,
      colors: references?.colors?.length || 0,
      materials: references?.materials?.length || 0,
      lengths: references?.lengths?.length || 0,
      sizes: references?.sizes?.length || 0,
      childAges: references?.childAges?.length || 0,
      returnReasons: references?.returnReasons?.length || 0,
      writeoffReasons: references?.writeoffReasons?.length || 0,
    }
  }, [references])

  const referenceCount = (kind: ReferenceKind, fallback: number) => referenceKindCounts[kind]?.total ?? fallback
  const allReferenceGroups = useMemo(() => ([
    { kind: 'cities' as const, label: 'Города', count: referenceCount('cities', referenceSummary.cities), help: 'Подсказки для города при создании и редактировании заказа.' },
    { kind: 'deliveryTypes' as const, label: 'Доставка', count: referenceCount('deliveryTypes', referenceSummary.deliveryTypes), help: 'Способы доставки для формы заказа и отчётов.' },
    { kind: 'colors' as const, label: 'Цвета', count: referenceCount('colors', referenceSummary.colors), help: 'Цвета вариантов товаров в заказах, складе и бутике.' },
    { kind: 'materials' as const, label: 'Материалы', count: referenceCount('materials', referenceSummary.materials), help: 'Материалы вариантов товаров для склада и цеха.' },
    { kind: 'lengths' as const, label: 'Длины', count: referenceCount('lengths', referenceSummary.lengths), help: 'Длины изделий для товарных вариантов.' },
    { kind: 'sizes' as const, label: 'Размеры', count: referenceCount('sizes', referenceSummary.sizes), help: 'Взрослые размеры товарных вариантов.' },
    { kind: 'childAges' as const, label: 'Детские возраста', count: referenceCount('childAges', referenceSummary.childAges), help: 'Возрастные варианты детских товаров.' },
    { kind: 'returnReasons' as const, label: 'Причины возврата', count: referenceCount('returnReasons', referenceSummary.returnReasons), help: 'Быстрый выбор причины при оформлении возврата.' },
    { kind: 'writeoffReasons' as const, label: 'Причины списания', count: referenceCount('writeoffReasons', referenceSummary.writeoffReasons), help: 'Быстрый выбор причины при ручном списании.' },
  ]), [referenceSummary, referenceKindCounts])

  const referenceGroups = useMemo(
    () => allReferenceGroups.filter((group) => ['cities', 'deliveryTypes', 'returnReasons'].includes(group.kind)),
    [allReferenceGroups],
  )
  const inventoryProductReferenceGroups = useMemo(
    () => allReferenceGroups.filter((group) => ['colors', 'materials', 'lengths', 'sizes', 'childAges'].includes(group.kind)),
    [allReferenceGroups],
  )
  const inventoryWriteoffReferenceGroups = useMemo(
    () => allReferenceGroups.filter((group) => group.kind === 'writeoffReasons'),
    [allReferenceGroups],
  )

  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return null
    const fromList = orders.find((order) => order.id === selectedOrderId)
    if (fromList) return fromList
    if (editorOrderOverride?.id === selectedOrderId) return editorOrderOverride
    return null
  }, [orders, selectedOrderId, editorOrderOverride])

  const activeWorkshopTasks = useMemo(() => {
    const tasks = workshopData?.tasks || []
    const query = workshopFilters.q.trim().toLowerCase()
    if (!query) return tasks
    return tasks.filter((task) => [
      task.externalOrderId, task.productName, task.gender, task.color, task.material, task.length, task.size,
      task.comment, task.managerName, task.customerPhone, task.customerName, task.city, task.deliveryType,
      task.orderDate, task.exchangeDate,
    ].map((part) => String(part || '').toLowerCase()).join(' ').includes(query))
  }, [workshopData, workshopFilters.q])
  useEffect(() => {
    const visibleIds = new Set(activeWorkshopTasks.map((task) => task.id))
    setSelectedWorkshopTaskIds((current) => current.filter((id) => visibleIds.has(id)))
  }, [activeWorkshopTasks])
  const selectedWorkshopTaskSet = useMemo(() => new Set(selectedWorkshopTaskIds), [selectedWorkshopTaskIds])
  const selectedWorkshopTasks = useMemo(
    () => activeWorkshopTasks.filter((task) => selectedWorkshopTaskSet.has(task.id)),
    [activeWorkshopTasks, selectedWorkshopTaskSet],
  )
  const workshopScopeTasks = selectedWorkshopTasks.length ? selectedWorkshopTasks : activeWorkshopTasks
  const workshopInvoiceRows = useMemo<WorkshopInvoiceRow[]>(() => {
    // Step 72: в накладной важность считается на уровне всего заказа.
    // Если в заказе есть хотя бы одна срочная позиция — все позиции этого заказа идут сверху и не суммируются.
    // Если срочности нет, но есть комментарий — все позиции этого заказа идут вторым блоком и тоже не суммируются.
    // Только обычные позиции без срочности и комментариев можно объединять по идентичным характеристикам.
    const orderPriority = new Map<number, number>()
    workshopScopeTasks.forEach((task) => {
      const priority = task.urgent ? 0 : (String(task.comment || '').trim() ? 1 : 2)
      const current = orderPriority.get(task.orderId)
      if (current === undefined || priority < current) {
        orderPriority.set(task.orderId, priority)
      }
    })

    const grouped = new Map<string, WorkshopInvoiceRow>()
    workshopScopeTasks.forEach((task) => {
      const comment = String(task.comment || '').trim()
      const priority = orderPriority.get(task.orderId) ?? 2
      const isSpecialOrder = priority < 2
      const urgent = priority === 0
      const hasComment = priority === 1 || Boolean(comment)
      const productTitle = workshopInvoiceProductTitle(task)
      const characteristics = workshopInvoiceCharacteristics(task)
      const key = isSpecialOrder
        ? `order|${task.orderId}|${task.id}`
        : `normal|${productTitle}|${characteristics}`
      const current = grouped.get(key) || {
        key,
        priority,
        urgent,
        hasComment,
        isSpecialOrder,
        orderId: isSpecialOrder ? task.orderId : 0,
        orderDate: task.orderDate || '',
        productName: productTitle,
        characteristics,
        quantity: 0,
        orderRef: isSpecialOrder ? task.externalOrderId : '',
        comment,
        dueDate: task.urgent ? (task.dueDate || '') : '',
      }
      current.quantity += Number(task.quantity || 0)
      if (!current.comment && comment) current.comment = comment
      if (!current.dueDate && task.urgent && task.dueDate) current.dueDate = task.dueDate
      grouped.set(key, current)
    })

    const direction = workshopSortDirection === 'newest' ? -1 : 1
    return Array.from(grouped.values()).sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      if (a.isSpecialOrder && b.isSpecialOrder) {
        const byDate = a.orderDate.localeCompare(b.orderDate) * direction
        if (byDate) return byDate
        const byOrder = a.orderRef.localeCompare(b.orderRef, 'ru')
        if (byOrder) return byOrder
        return `${a.productName} ${a.characteristics}`.localeCompare(`${b.productName} ${b.characteristics}`, 'ru')
      }
      if (a.isSpecialOrder !== b.isSpecialOrder) return a.isSpecialOrder ? -1 : 1
      const byProduct = `${a.productName} ${a.characteristics}`.localeCompare(`${b.productName} ${b.characteristics}`, 'ru')
      if (byProduct) return byProduct
      return a.orderRef.localeCompare(b.orderRef, 'ru')
    })
  }, [workshopScopeTasks, workshopSortDirection])

  const getWorkshopInvoiceImportanceLabel = (row: WorkshopInvoiceRow) => {
    if (row.priority === 0) return `Срочный заказ${row.dueDate ? ` · до ${formatDateShort(row.dueDate)}` : ''}`
    if (row.priority === 1) return 'Заказ с комментарием'
    return 'Обычно'
  }

  const debtOrders = useMemo(() => {
    const search = normalizeSearchText(debtFilters.q)
    const sourceOrders = debtAllOrdersLoaded ? debtAllOrders : orders
    return sourceOrders.filter((order) => {
      if (Number(order.debt_amount || 0) <= 0) return false
      if (order.order_status === 'deleted' || order.order_status === 'archived') return false

      if (debtFilters.manager && normalizeSuggestion(order.manager_name || '') !== normalizeSuggestion(debtFilters.manager)) {
        return false
      }

      if (debtFilters.orderDate && order.order_date !== debtFilters.orderDate) {
        return false
      }

      if (!search) return true

      return [
        order.customer_phone,
        order.customer_name,
        order.city,
        order.manager_name,
        order.comment,
      ]
        .map((value) => normalizeSearchText(value))
        .some((value) => value.includes(search))
    })
  }, [debtAllOrders, debtAllOrdersLoaded, debtFilters.manager, debtFilters.orderDate, debtFilters.q, orders])

  const debtSelectedOrder = useMemo(
    () => debtOrders.find((order) => order.id === debtSelectedOrderId) || null,
    [debtOrders, debtSelectedOrderId],
  )

  const returnOrders = useMemo(
    () => orders.filter((order) => order.order_status !== 'deleted' && order.order_status !== 'archived' && !isReturnedOrderRecord(order)),
    [orders],
  )

  const returnSelectedOrder = useMemo(
    () => returnOrders.find((order) => order.id === returnSelectedOrderId) || null,
    [returnOrders, returnSelectedOrderId],
  )

  const exchangeOrders = useMemo(
    () => orders.filter((order) => order.order_status !== 'deleted' && order.order_status !== 'archived' && !isReturnedOrderRecord(order)),
    [orders],
  )

  const exchangeSelectedOrder = useMemo(
    () => exchangeOrders.find((order) => order.id === exchangeSelectedOrderId) || null,
    [exchangeOrders, exchangeSelectedOrderId],
  )

  const debtCloseHistory = debtCloseHistoryRows

  const debtPaymentTotal = useMemo(
    () => debtPayments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount || 0)), 0),
    [debtPayments],
  )

  const debtRemainingAmount = Math.max(0, Number(debtSelectedOrder?.debt_amount || 0) - debtPaymentTotal)
  const debtOverpayAmount = Math.max(0, debtPaymentTotal - Number(debtSelectedOrder?.debt_amount || 0))

  const warehouseInventory = inventoryData.warehouse
  const boutiqueInventory = inventoryData.boutique
  const inventoryModelVersion = Math.max(Number(warehouseInventory?.inventoryModelVersion || 1), Number(boutiqueInventory?.inventoryModelVersion || 1))
  const inventorySourceRows = useMemo(
    () => [
      { source: 'warehouse' as const, label: 'Склад', data: warehouseInventory },
      { source: 'boutique' as const, label: 'Бутик', data: boutiqueInventory },
    ],
    [warehouseInventory, boutiqueInventory],
  )
  const inventoryStats = useMemo(() => {
    const buildStats = (data: InventoryResponse | null) => {
      const rows = data?.items || []
      const productNames = new Set(rows.map((row) => normalizeSuggestion(row.productName)).filter(Boolean))
      const totalUnits = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
      const positiveUnits = rows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0)), 0)
      const negativeCount = rows.filter((row) => Number(row.quantity || 0) < 0).length
      const zeroCount = rows.filter((row) => Number(row.quantity || 0) === 0).length
      return {
        products: productNames.size,
        variants: rows.length,
        totalUnits,
        positiveUnits,
        zeroCount,
        negativeCount,
      }
    }
    const warehouse = buildStats(warehouseInventory)
    const boutique = buildStats(boutiqueInventory)
    return {
      warehouse,
      boutique,
      totalUnits: warehouse.totalUnits + boutique.totalUnits,
      totalPositiveUnits: warehouse.positiveUnits + boutique.positiveUnits,
      totalVariants: warehouse.variants + boutique.variants,
      totalProducts: new Set([
        ...((warehouseInventory?.items || []).map((row) => normalizeSuggestion(row.productName)).filter(Boolean)),
        ...((boutiqueInventory?.items || []).map((row) => normalizeSuggestion(row.productName)).filter(Boolean)),
      ]).size,
      zeroCount: warehouse.zeroCount + boutique.zeroCount,
      negativeCount: warehouse.negativeCount + boutique.negativeCount,
    }
  }, [warehouseInventory, boutiqueInventory])
  const inventoryStocktakeModel = useMemo(() => {
    const warehouseByVariant = new Map<number, InventoryStockRecord>()
    const boutiqueByVariant = new Map<number, InventoryStockRecord>()
    ;(warehouseInventory?.items || []).forEach((row) => {
      if (Number(row.variantId || 0) > 0) warehouseByVariant.set(Number(row.variantId), row)
    })
    ;(boutiqueInventory?.items || []).forEach((row) => {
      if (Number(row.variantId || 0) > 0) boutiqueByVariant.set(Number(row.variantId), row)
    })

    const rows = new Map<string, {
      key: string
      variantId: number
      productId: number
      productName: string
      category: 'adult' | 'child'
      gender: string
      color: string
      material: string
      length: string
      size: string
      warehouseQuantity: number
      warehouseReserved: number
      warehouseAvailable: number
      boutiqueQuantity: number
      boutiqueReserved: number
      boutiqueAvailable: number
      totalQuantity: number
      totalReserved: number
      totalAvailable: number
    }>()

    for (const variant of (catalogData?.variants || []).filter((entry) => entry.isActive)) {
      const warehouseRow = warehouseByVariant.get(Number(variant.id))
      const boutiqueRow = boutiqueByVariant.get(Number(variant.id))
      const warehouseQuantity = Number(warehouseRow?.quantity || 0)
      const warehouseReserved = Number(warehouseRow?.reservedQuantity || 0)
      const warehouseAvailable = Number(warehouseRow?.availableQuantity ?? (warehouseQuantity - warehouseReserved))
      const boutiqueQuantity = Number(boutiqueRow?.quantity || 0)
      const boutiqueReserved = Number(boutiqueRow?.reservedQuantity || 0)
      const boutiqueAvailable = Number(boutiqueRow?.availableQuantity ?? (boutiqueQuantity - boutiqueReserved))
      rows.set(`variant:${variant.id}`, {
        key: `variant:${variant.id}`,
        variantId: Number(variant.id),
        productId: Number(variant.productId || 0),
        productName: variant.productName || (catalogData?.products || []).find((product) => Number(product.id) === Number(variant.productId))?.name || 'Без названия',
        category: getCatalogVariantCategory(variant),
        gender: variant.gender || '',
        color: variant.color || '',
        material: variant.material || '',
        length: variant.length || '',
        size: variant.sizeLabel || '',
        warehouseQuantity,
        warehouseReserved,
        warehouseAvailable,
        boutiqueQuantity,
        boutiqueReserved,
        boutiqueAvailable,
        totalQuantity: warehouseQuantity + boutiqueQuantity,
        totalReserved: warehouseReserved + boutiqueReserved,
        totalAvailable: warehouseAvailable + boutiqueAvailable,
      })
    }

    const appendOrphanStockRow = (row: InventoryStockRecord, source: InventorySourceKey) => {
      const variantId = Number(row.variantId || 0)
      if (variantId > 0 && rows.has(`variant:${variantId}`)) return
      const key = variantId > 0
        ? `variant:${variantId}`
        : `snapshot:${normalizeSuggestion(row.productName)}:${normalizeSuggestion(row.gender)}:${normalizeSuggestion(row.color)}:${normalizeSuggestion(row.material)}:${normalizeSuggestion(row.length)}:${normalizeSuggestion(row.size)}`
      const existing = rows.get(key)
      const sourceQuantity = Number(row.quantity || 0)
      const sourceReserved = Number(row.reservedQuantity || 0)
      const sourceAvailable = Number(row.availableQuantity ?? (sourceQuantity - sourceReserved))
      if (existing) {
        if (source === 'warehouse') {
          existing.warehouseQuantity = sourceQuantity
          existing.warehouseReserved = sourceReserved
          existing.warehouseAvailable = sourceAvailable
        } else {
          existing.boutiqueQuantity = sourceQuantity
          existing.boutiqueReserved = sourceReserved
          existing.boutiqueAvailable = sourceAvailable
        }
        existing.totalQuantity = existing.warehouseQuantity + existing.boutiqueQuantity
        existing.totalReserved = existing.warehouseReserved + existing.boutiqueReserved
        existing.totalAvailable = existing.warehouseAvailable + existing.boutiqueAvailable
        return
      }
      rows.set(key, {
        key,
        variantId,
        productId: Number(row.productId || 0),
        productName: row.productName || 'Без названия',
        category: row.audienceType === 'ДЕТСКИЙ' ? 'child' : 'adult',
        gender: row.gender || '',
        color: row.color || '',
        material: row.material || '',
        length: row.length || '',
        size: row.size || '',
        warehouseQuantity: source === 'warehouse' ? sourceQuantity : 0,
        warehouseReserved: source === 'warehouse' ? sourceReserved : 0,
        warehouseAvailable: source === 'warehouse' ? sourceAvailable : 0,
        boutiqueQuantity: source === 'boutique' ? sourceQuantity : 0,
        boutiqueReserved: source === 'boutique' ? sourceReserved : 0,
        boutiqueAvailable: source === 'boutique' ? sourceAvailable : 0,
        totalQuantity: sourceQuantity,
        totalReserved: sourceReserved,
        totalAvailable: sourceAvailable,
      })
    }
    ;(warehouseInventory?.items || []).forEach((row) => appendOrphanStockRow(row, 'warehouse'))
    ;(boutiqueInventory?.items || []).forEach((row) => appendOrphanStockRow(row, 'boutique'))

    const sortedRows = Array.from(rows.values())
      .sort((a, b) => a.productName.localeCompare(b.productName, 'ru', { numeric: true })
        || [productCategoryLabel(a.category), a.gender, a.material, a.length].join(' ').localeCompare(
          [productCategoryLabel(b.category), b.gender, b.material, b.length].join(' '),
          'ru',
          { numeric: true },
        )
        || a.size.localeCompare(b.size, 'ru', { numeric: true })
        || a.color.localeCompare(b.color, 'ru', { numeric: true })
        || a.variantId - b.variantId)

    const groupRows = (inputRows: typeof sortedRows) => {
      const groups = new Map<string, { key: string; productId: number; productName: string; rows: typeof sortedRows }>()
      for (const row of inputRows) {
        const key = row.productId > 0 ? `product:${row.productId}` : `name:${normalizeSuggestion(row.productName)}`
        const group = groups.get(key) || { key, productId: row.productId, productName: row.productName, rows: [] as typeof sortedRows }
        group.rows.push(row)
        groups.set(key, group)
      }
      return Array.from(groups.values()).sort((a, b) => a.productName.localeCompare(b.productName, 'ru', { numeric: true }))
    }

    const tokens = normalizeSearchText(inventoryQuery).split(/\s+/).filter(Boolean)
    const filteredRows = tokens.length
      ? sortedRows.filter((row) => {
          const haystack = normalizeSearchText([
            row.productName,
            productCategoryLabel(row.category),
            row.gender,
            row.color,
            row.material,
            row.length,
            row.size,
            row.variantId ? `#${row.variantId}` : '',
          ].join(' '))
          return tokens.every((token) => haystack.includes(token))
        })
      : sortedRows

    return {
      allGroups: groupRows(sortedRows),
      filteredGroups: groupRows(filteredRows),
    }
  }, [catalogData, warehouseInventory, boutiqueInventory, inventoryQuery])
  const inventoryStocktakeAllGroups = inventoryStocktakeModel.allGroups
  const inventoryStocktakeGroups = inventoryStocktakeModel.filteredGroups

  const inventoryStocktakeStats = useMemo(() => {
    const rows = inventoryStocktakeGroups.flatMap((group) => group.rows)
    return {
      products: inventoryStocktakeGroups.length,
      variants: rows.length,
      warehouseUnits: rows.reduce((sum, row) => sum + Number(row.warehouseQuantity || 0), 0),
      boutiqueUnits: rows.reduce((sum, row) => sum + Number(row.boutiqueQuantity || 0), 0),
      totalUnits: rows.reduce((sum, row) => sum + Number(row.totalQuantity || 0), 0),
    }
  }, [inventoryStocktakeGroups])

  const inventorySearchTokens = useMemo(
    () => normalizeSearchText(inventoryQuery).split(/\s+/).filter(Boolean),
    [inventoryQuery],
  )

  const hasInventoryQuickFilters = Object.values(inventoryQuickFilters).some((value) => Boolean(String(value || '').trim()))

  const inventoryPickerOptions = useMemo(() => {
    const rows = [
      ...(warehouseInventory?.items || []),
      ...(boutiqueInventory?.items || []),
    ]
    const unique = (values: string[]) => Array.from(new Map(values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .map((value) => [normalizeSearchText(value), value])).values())
      .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
    const products = unique([
      ...rows.map((row) => row.productName),
      ...((catalogData?.products || []).filter((product) => product.isActive).map((product) => product.name)),
    ])
    const selectedProduct = products.find((product) => normalizeSearchText(product) === normalizeSearchText(inventoryQuery))
    const scopedRows = selectedProduct
      ? rows.filter((row) => normalizeSearchText(row.productName) === normalizeSearchText(selectedProduct))
      : rows
    return {
      products,
      genders: unique(scopedRows.map((row) => row.gender)),
      colors: unique(scopedRows.map((row) => row.color)),
      materials: unique(scopedRows.map((row) => row.material)),
      lengths: unique(scopedRows.map((row) => row.length)),
      sizes: sortSizeLikeValues(unique(scopedRows.map((row) => row.size))),
    }
  }, [warehouseInventory, boutiqueInventory, catalogData, inventoryQuery])

  const catalogVariantsByProductId = useMemo(() => {
    const map = new Map<number, CatalogVariantRecord[]>()
    for (const variant of catalogData?.variants || []) {
      const productId = Number(variant.productId || 0)
      if (!productId) continue
      const list = map.get(productId) || []
      list.push(variant)
      map.set(productId, list)
    }
    return map
  }, [catalogData])

  const catalogVariantCategoryById = useMemo(() => {
    const map = new Map<number, 'adult' | 'child'>()
    for (const variant of catalogData?.variants || []) {
      map.set(Number(variant.id), getCatalogVariantCategory(variant))
    }
    return map
  }, [catalogData])

  const getCatalogProductVariantStats = (product?: CatalogProductRecord | null) => {
    const variants = product ? (catalogVariantsByProductId.get(Number(product.id)) || []).filter((variant) => variant.isActive) : []
    const adult = variants.filter((variant) => getCatalogVariantCategory(variant) === 'adult').length
    const child = variants.filter((variant) => getCatalogVariantCategory(variant) === 'child').length
    const fallback = inferProductCategoryFromVariants(product?.category, [])
    return { adult, child, total: variants.length, fallback }
  }

  const productHasVariantCategory = (product: CatalogProductRecord, category: 'adult' | 'child') => {
    const stats = getCatalogProductVariantStats(product)
    if (stats.total === 0) return stats.fallback === category
    return category === 'child' ? stats.child > 0 : stats.adult > 0
  }

  const catalogProductVariantSummary = (product?: CatalogProductRecord | null) => {
    const stats = getCatalogProductVariantStats(product)
    if (!stats.total) return `${productCategoryLabel(stats.fallback)} · вариантов: 0`
    return [`Взрослые: ${stats.adult}`, `Детские: ${stats.child}`].join(' · ')
  }

  const catalogProductStockSummary = (product?: CatalogProductRecord | null) => {
    const variants = product ? (catalogVariantsByProductId.get(Number(product.id)) || []) : []
    const variantIds = new Set(variants.map((variant) => Number(variant.id || 0)).filter(Boolean))
    let warehouse = 0
    let boutique = 0
    for (const row of inventoryData.warehouse?.items || []) {
      if (variantIds.has(Number(row.variantId || 0))) warehouse += Number(row.quantity || 0)
    }
    for (const row of inventoryData.boutique?.items || []) {
      if (variantIds.has(Number(row.variantId || 0))) boutique += Number(row.quantity || 0)
    }
    return { warehouse, boutique, total: warehouse + boutique }
  }

  const getCatalogProductEffectiveCategory = (product?: CatalogProductRecord | null): 'adult' | 'child' => {
    const stats = getCatalogProductVariantStats(product)
    if (stats.child > 0 && stats.adult === 0) return 'child'
    return stats.fallback
  }

  const getInventoryRowCategory = (row: Pick<InventoryStockRecord, 'productId' | 'productName' | 'variantId' | 'gender' | 'size'>): 'adult' | 'child' => {
    const byVariant = catalogVariantCategoryById.get(Number(row.variantId || 0))
    if (byVariant) return byVariant
    return getVariantCategoryFromFields('', row.gender, row.size)
  }

  const matchInventoryRow = (row: InventoryStockRecord) => {
    const searchable = [
      row.productName,
      row.gender,
      row.color,
      row.material,
      row.length,
      row.size,
      row.lastAction,
      row.lastSourceRef,
    ].map(normalizeSearchText).join(' ')
    if (inventorySearchTokens.length && !inventorySearchTokens.every((token) => searchable.includes(token))) return false
    const quickMatches = (
      [
        ['gender', row.gender],
        ['color', row.color],
        ['material', row.material],
        ['length', row.length],
        ['size', row.size],
      ] as Array<[keyof typeof inventoryQuickFilters, string]>
    ).every(([field, value]) => {
      const selected = normalizeSearchText(inventoryQuickFilters[field])
      return !selected || normalizeSearchText(value) === selected
    })
    return quickMatches
  }

  const filterInventoryRows = (rows: InventoryStockRecord[]) => rows
    .filter(matchInventoryRow)
    .filter((row) => inventoryCategoryFilter === 'all' || getInventoryRowCategory(row) === inventoryCategoryFilter)
    .filter((row) => {
      const quantity = Number(row.quantity || 0)
      if (inventoryStatusFilter === 'positive') return quantity > 0
      if (inventoryStatusFilter === 'zero') return quantity === 0
      if (inventoryStatusFilter === 'negative') return quantity < 0
      return true
    })

  const buildInventoryGroups = (source: InventorySourceKey, rows: InventoryStockRecord[]) => buildInventoryStockGroups({
    source,
    rows,
    sortMode: inventorySortMode,
    getCategory: getInventoryRowCategory,
  })

  const filteredInventoryRows = useMemo(() => ({
    warehouse: filterInventoryRows(warehouseInventory?.items || []),
    boutique: filterInventoryRows(boutiqueInventory?.items || []),
  }), [warehouseInventory, boutiqueInventory, inventorySearchTokens.join('|'), inventoryQuickFilters, inventoryStatusFilter, inventoryCategoryFilter, catalogVariantCategoryById])

  const groupedInventoryRows = useMemo(() => ({
    warehouse: buildInventoryGroups('warehouse', filteredInventoryRows.warehouse),
    boutique: buildInventoryGroups('boutique', filteredInventoryRows.boutique),
  }), [filteredInventoryRows, inventorySortMode])

  const inventoryProblemRows = useMemo(() => inventorySourceRows
    .flatMap((entry) => (entry.data?.items || []).map((row) => ({ ...row, sourceLabel: entry.label })))
    .filter((row) => Number(row.quantity || 0) < 0)
    .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0) || a.productName.localeCompare(b.productName, 'ru')), [inventorySourceRows])
  const inventoryHistoryRows = useMemo(() => inventorySourceRows
    .flatMap((entry) => (entry.data?.movements || []).map((row) => ({ ...row, sourceLabel: entry.label })))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 120), [inventorySourceRows])
  const latestSaleMovements = useMemo(() => inventoryHistoryRows
    .filter((row) => row.movementType === 'sale' || row.referenceType === 'order' || row.referenceType === 'order_edit_new')
    .slice(0, 12), [inventoryHistoryRows])
  const latestManualMovements = useMemo(() => inventoryHistoryRows
    .filter((row) => row.referenceType === 'manual' || row.referenceType === 'transfer_in' || row.referenceType === 'transfer_out' || ['arrival', 'manual_set', 'writeoff'].includes(row.movementType))
    .slice(0, 12), [inventoryHistoryRows])
  const latestReturnExchangeMovements = useMemo(() => inventoryHistoryRows
    .filter((row) => row.referenceType.includes('return') || row.referenceType.includes('exchange'))
    .slice(0, 12), [inventoryHistoryRows])
  const catalogIssueStats = useMemo(() => {
    const products = catalogData?.products || []
    return {
      inactiveProducts: products.filter((product) => !product.isActive).length,
      productsWithoutVariants: products.filter((product) => product.isActive && Number(product.variantsCount || 0) === 0).length,
      inactiveVariants: (catalogData?.variants || []).filter((variant) => !variant.isActive).length,
    }
  }, [catalogData])
  const visibleCatalogProducts = useMemo(() => {
    const query = normalizeSearchText(inventoryQuery)
    return [...(catalogData?.products || [])]
      .filter((product) => product.isActive)
      .filter((product) => !catalogOnlyWithoutVariants || Number(product.variantsCount || 0) === 0)
      .filter((product) => catalogCategoryFilter === 'all' || productHasVariantCategory(product, catalogCategoryFilter))
      .filter((product) => !query || normalizeSearchText(product.name).includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }))
  }, [catalogData, inventoryQuery, catalogCategoryFilter, catalogVariantsByProductId, catalogOnlyWithoutVariants])
  const selectedCatalogProduct = useMemo(() => {
    const productId = catalogVariantDraft.productId || (catalogProductDraft.id ? String(catalogProductDraft.id) : '')
    return (catalogData?.products || []).find((product) => String(product.id) === String(productId)) || null
  }, [catalogData, catalogVariantDraft.productId, catalogProductDraft.id])
  const activeCatalogVariants = useMemo(() => (catalogData?.variants || []).filter((variant) => variant.isActive), [catalogData])
  const variantsForProduct = (productId: string | number) => activeCatalogVariants
    .filter((variant) => String(variant.productId) === String(productId || ''))
    .sort((a, b) => {
      const categoryDiff = getCatalogVariantCategory(a).localeCompare(getCatalogVariantCategory(b))
      return categoryDiff || [a.gender, a.color, a.material, a.length, a.sizeLabel].join(' ').localeCompare([b.gender, b.color, b.material, b.length, b.sizeLabel].join(' '), 'ru', { numeric: true })
    })
  const getStockQuantityForVariant = (source: InventorySourceKey, variantId: string | number) => {
    const id = Number(variantId || 0)
    if (!id) return null
    const row = (inventoryData[source]?.items || []).find((entry) => Number(entry.variantId || 0) === id)
    return row ? Number(row.quantity || 0) : 0
  }

  const inventoryStockRowsForSource = (source: InventorySourceKey) => (inventoryData[source]?.items || [])
    .filter((row) => Number(row.variantId || 0) > 0)
    .sort((a, b) => [a.productName, a.gender, a.color, a.material, a.length, a.size].join(' ').localeCompare([b.productName, b.gender, b.color, b.material, b.length, b.size].join(' '), 'ru'))

  const inventoryOperationSourceRows = useMemo(() => {
    const sourceRows = inventoryStockRowsForSource(inventoryDraft.source)
    if (inventoryDraft.movementType !== 'transfer') return sourceRows

    // A real source mismatch can mean that the canonical SKU is physically here even though
    // accounting only has a row in the other point. Surface that known SKU as a zero row so
    // the manager can confirm the actual source count inline and move it without inventing identity.
    const sourceVariantIds = new Set(sourceRows.map((row) => Number(row.variantId || 0)).filter(Boolean))
    const targetRows = inventoryStockRowsForSource(inventoryDraft.targetSource)
      .filter((row) => Number(row.variantId || 0) > 0 && !sourceVariantIds.has(Number(row.variantId || 0)))
      .map((row) => ({
        ...row,
        id: 0,
        inventorySource: inventoryDraft.source,
        quantity: 0,
        reservedQuantity: 0,
        availableQuantity: 0,
        lastAction: '',
        lastSourceRef: '',
      }))
    return [...sourceRows, ...targetRows]
  }, [inventoryData, inventoryDraft.source, inventoryDraft.targetSource, inventoryDraft.movementType])

  const inventoryOperationAllProductGroups = useMemo(() => {
    const groups = new Map<string, { key: string; productId: number; productName: string; category: 'adult' | 'child'; adultVariantCount: number; childVariantCount: number; variantsCount: number; totalQuantity: number; rows: InventoryStockRecord[] }>()
    inventoryOperationSourceRows.forEach((row) => {
      if (inventoryDraft.movementType === 'writeoff' && Number(row.quantity || 0) <= 0) return
      const rowCategory = getInventoryRowCategory(row)
      const key = row.productId ? `id:${row.productId}` : `name:${normalizeSuggestion(row.productName)}`
      const group = groups.get(key) || { key, productId: Number(row.productId || 0), productName: row.productName || 'Без названия', category: rowCategory, adultVariantCount: 0, childVariantCount: 0, variantsCount: 0, totalQuantity: 0, rows: [] }
      group.variantsCount += 1
      if (rowCategory === 'child') group.childVariantCount += 1
      else group.adultVariantCount += 1
      group.totalQuantity += Number(row.quantity || 0)
      group.rows.push(row)
      groups.set(key, group)
    })
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        rows: [...group.rows].sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))),
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName, 'ru', { numeric: true }))
  }, [inventoryOperationSourceRows, catalogVariantCategoryById, inventoryDraft.movementType])

  const inventoryOperationProductGroups = useMemo(() => {
    const searchTokens = normalizeSearchText(inventoryOperationSearch).split(/\s+/).filter(Boolean)
    if (!searchTokens.length) return inventoryOperationAllProductGroups.slice(0, 160)
    return inventoryOperationAllProductGroups
      .filter((group) => {
        const haystack = group.rows
          .map((row) => [row.productName, row.gender, row.color, row.material, row.length, row.size].map(normalizeSearchText).join(' '))
          .join(' ')
        return searchTokens.every((token) => haystack.includes(token))
      })
      .slice(0, 160)
  }, [inventoryOperationAllProductGroups, inventoryOperationSearch])

  const inventoryArrivalProductChoices = useMemo(() => {
    const searchTokens = normalizeSearchText(inventoryOperationSearch).split(/\s+/).filter(Boolean)
    const stockByProduct = new Map<number, { variantsCount: number; totalQuantity: number }>()
    for (const row of inventoryOperationSourceRows) {
      const id = Number(row.productId || 0)
      if (!id) continue
      const current = stockByProduct.get(id) || { variantsCount: 0, totalQuantity: 0 }
      current.variantsCount += 1
      current.totalQuantity += Number(row.quantity || 0)
      stockByProduct.set(id, current)
    }
    return (catalogData?.products || [])
      .filter((product) => product.isActive)
      .map((product) => {
        const stats = getCatalogProductVariantStats(product)
        return {
          key: `catalog:${product.id}`,
          product,
          productName: product.name,
          category: getCatalogProductEffectiveCategory(product),
          adultVariantsCount: stats.adult,
          childVariantsCount: stats.child,
          variantsCount: Number(product.variantsCount || 0),
          stockVariantsCount: stockByProduct.get(Number(product.id))?.variantsCount || 0,
          totalQuantity: stockByProduct.get(Number(product.id))?.totalQuantity || 0,
        }
      })
      .filter((entry) => inventoryCategoryFilter === 'all' || productHasVariantCategory(entry.product, inventoryCategoryFilter))
      .filter((entry) => {
        if (!searchTokens.length) return true
        const variants = (catalogData?.variants || []).filter((variant) => Number(variant.productId) === Number(entry.product.id))
        const haystack = [entry.productName, catalogProductVariantSummary(entry.product), ...variants.map((variant) => [productCategoryLabel(getCatalogVariantCategory(variant)), variant.gender, variant.color, variant.material, variant.length, variant.sizeLabel].join(' '))]
          .map(normalizeSearchText)
          .join(' ')
        return searchTokens.every((token) => haystack.includes(token))
      })
      .sort((a, b) => a.productName.localeCompare(b.productName, 'ru', { numeric: true }))
      .slice(0, 180)
  }, [catalogData, inventoryOperationSearch, inventoryOperationSourceRows, inventoryCategoryFilter, catalogVariantsByProductId])

  const selectedInventoryOperationGroup = useMemo(
    () => inventoryOperationAllProductGroups.find((group) => group.key === inventoryOperationProductKey) || null,
    [inventoryOperationAllProductGroups, inventoryOperationProductKey],
  )

  const operationVariantOptions = useMemo(() => {
    const rows = selectedInventoryOperationGroup?.rows || []
    const collect = (field: keyof InventoryStockRecord) => Array.from(new Set(rows.map((row) => String(row[field] || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
    return {
      gender: collect('gender'),
      color: collect('color'),
      material: collect('material'),
      length: collect('length'),
      size: collect('size'),
    }
  }, [selectedInventoryOperationGroup])

  const matchedInventoryOperationVariant = useMemo(() => {
    if (!selectedInventoryOperationGroup) return null
    const same = (left: unknown, right: unknown) => normalizeSearchText(left) === normalizeSearchText(right)
    return selectedInventoryOperationGroup.rows.find((row) => (
      getInventoryRowCategory(row) === inventoryOperationVariant.category
      && same(row.gender, inventoryOperationVariant.gender)
      && same(row.color, inventoryOperationVariant.color)
      && same(row.material, inventoryOperationVariant.material)
      && same(row.length, inventoryOperationVariant.length)
      && same(row.size, inventoryOperationVariant.size)
      && (inventoryDraft.movementType !== 'writeoff' || Number(row.quantity || 0) > 0)
    )) || null
  }, [selectedInventoryOperationGroup, inventoryOperationVariant, catalogVariantCategoryById, inventoryDraft.movementType])

  const inventoryExistingVariantRows = useMemo(() => {
    const tokens = normalizeSearchText(inventoryExistingVariantSearch).split(/\s+/).filter(Boolean)
    const rows = selectedInventoryOperationGroup?.rows || []
    return rows
      .filter((row) => inventoryDraft.movementType !== 'writeoff' || Number(row.quantity || 0) > 0)
      .filter((row) => {
        if (!tokens.length) return true
        const haystack = [productCategoryLabel(getInventoryRowCategory(row)), row.gender, row.color, row.material, row.length, row.size, String(row.quantity)].map(normalizeSearchText).join(' ')
        return tokens.every((token) => haystack.includes(token))
      })
      .slice(0, 180)
  }, [selectedInventoryOperationGroup, inventoryExistingVariantSearch, catalogVariantCategoryById, inventoryDraft.movementType])

  const activeInventoryOperationItem = matchedInventoryOperationVariant
    ? inventoryDraft.items.find((item) => String(item.variantId || '') === String(matchedInventoryOperationVariant.variantId || '')) || null
    : null

  const selectedInventoryOperationItems = useMemo(() => inventoryDraft.items
    .filter((item) => item.variantId && Number(item.quantity || 0) > 0)
    .map((item) => ({
      item,
      row: inventoryOperationSourceRows.find((row) => String(row.variantId || '') === String(item.variantId || '')) || null,
    })), [inventoryDraft.items, inventoryOperationSourceRows])

  const inventoryDraftSummary = useMemo(() => {
    const rows = inventoryDraft.items.filter((item) => (item.variantId || item.productName) && (inventoryDraft.movementType === 'manual_set' ? item.touched : Number(item.quantity || 0) > 0))
    const totalQuantity = rows.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    const newRows = rows.filter((item) => !item.variantId).length
    return { rows: rows.length, totalQuantity, newRows }
  }, [inventoryDraft.items, inventoryDraft.movementType])

  const inventoryArrivalSummary = useMemo(() => {
    const rows = inventoryArrivalPositions.flatMap((position) => position.sizes
      .filter((line) => Number(line.quantity || 0) > 0 && position.productName.trim())
      .map((line) => ({ position, line })))
    return {
      positions: inventoryArrivalPositions.filter((position) => position.productName.trim()).length,
      rows: rows.length,
      totalQuantity: rows.reduce((sum, row) => sum + Number(row.line.quantity || 0), 0),
    }
  }, [inventoryArrivalPositions])

  function updateInventoryArrivalPosition(id: string, field: keyof Omit<InventoryArrivalPosition, 'id' | 'sizes'>, value: string) {
    setInventoryArrivalPositions((current) => current.map((position) => {
      if (position.id !== id) return position
      if (field === 'productName') {
        const match = (catalogData?.products || []).find((product) => product.isActive && normalizeSuggestion(product.name) === normalizeSuggestion(value))
        return { ...position, productId: match ? String(match.id) : '', productName: value }
      }
      if (field === 'category') {
        const category = value === 'child' ? 'child' : 'adult'
        return { ...position, category, gender: category === 'child' && !position.gender ? 'ДЕТСКИЙ' : position.gender }
      }
      return { ...position, [field]: value }
    }))
  }

  function selectInventoryArrivalProduct(id: string, value: string) {
    const match = (catalogData?.products || []).find((product) => product.isActive && normalizeSuggestion(product.name) === normalizeSuggestion(value))
    if (!match) {
      updateInventoryArrivalPosition(id, 'productName', value)
      return
    }
    const variants = catalogVariantsByProductId.get(Number(match.id)) || []
    const first = variants.find((variant) => variant.isActive) || null
    setInventoryArrivalPositions((current) => current.map((position) => position.id === id ? {
      ...position,
      productId: String(match.id),
      productName: match.name,
      category: first ? getCatalogVariantCategory(first) : (match.category === 'child' ? 'child' : 'adult'),
      gender: first?.gender || position.gender,
      material: first?.material || position.material || 'СТАНДАРТ',
      length: first?.length || position.length || 'СТАНДАРТ',
    } : position))
  }

  function inventoryArrivalReadyVariants(position: InventoryArrivalPosition) {
    if (!position.productId) return []
    return [...(catalogVariantsByProductId.get(Number(position.productId)) || [])]
      .filter((variant) => variant.isActive)
      .sort((a, b) => [a.color, a.sizeLabel, a.gender, a.material, a.length].join(' ').localeCompare([b.color, b.sizeLabel, b.gender, b.material, b.length].join(' '), 'ru', { numeric: true }))
  }

  function selectInventoryArrivalVariant(positionId: string, variant: CatalogVariantRecord) {
    const product = (catalogData?.products || []).find((entry) => Number(entry.id) === Number(variant.productId))
    setInventoryArrivalPositions((current) => current.map((position) => position.id === positionId ? {
      ...position,
      productId: String(variant.productId),
      productName: product?.name || position.productName,
      category: getCatalogVariantCategory(variant),
      gender: variant.gender || '',
      material: variant.material || 'СТАНДАРТ',
      length: variant.length || 'СТАНДАРТ',
      sizes: [{ id: position.sizes[0]?.id || inventoryUiId('size'), size: variant.sizeLabel || '', color: variant.color || '', quantity: Math.max(1, Number(position.sizes[0]?.quantity || 1)) }],
    } : position))
    setInventoryArrivalVariantOpen((current) => ({ ...current, [positionId]: false }))
  }

  function addInventoryArrivalSize(positionId: string) {
    setInventoryArrivalPositions((current) => current.map((position) => position.id === positionId ? {
      ...position,
      sizes: [...position.sizes, { id: inventoryUiId('size'), size: '', color: position.sizes.at(-1)?.color || '', quantity: 1 }],
    } : position))
  }

  function updateInventoryArrivalSize(positionId: string, sizeId: string, patch: { size?: string; color?: string; quantity?: number }) {
    setInventoryArrivalPositions((current) => current.map((position) => position.id === positionId ? {
      ...position,
      sizes: position.sizes.map((line) => line.id === sizeId ? { ...line, ...patch } : line),
    } : position))
  }

  function removeInventoryArrivalSize(positionId: string, sizeId: string) {
    setInventoryArrivalPositions((current) => current.map((position) => {
      if (position.id !== positionId) return position
      const next = position.sizes.filter((line) => line.id !== sizeId)
      return { ...position, sizes: next.length ? next : [{ id: inventoryUiId('size'), size: '', color: '', quantity: 1 }] }
    }))
  }

  function addInventoryArrivalPosition() {
    setInventoryArrivalPositions((current) => [...current, createEmptyArrivalPosition()])
  }

  function removeInventoryArrivalPosition(id: string) {
    setInventoryArrivalPositions((current) => {
      const next = current.filter((position) => position.id !== id)
      return next.length ? next : [createEmptyArrivalPosition()]
    })
  }

  function resetInventoryArrivalForm() {
    setInventoryArrivalPositions([createEmptyArrivalPosition()])
    setInventoryArrivalVariantOpen({})
  }

  function flattenInventoryArrivalPositions(): InventoryDraftItem[] {
    const result: InventoryDraftItem[] = []
    for (const position of inventoryArrivalPositions) {
      const productName = position.productId ? position.productName.trim() : position.productName.trim().toUpperCase()
      if (!productName) continue
      const mergedSizes = new Map<string, { size: string; color: string; quantity: number }>()
      for (const line of position.sizes) {
        const quantity = Math.max(0, Math.trunc(Number(line.quantity || 0)))
        if (quantity <= 0) continue
        const normalizedSize = normalizeSuggestion(line.size || '') || '__EMPTY__'
        const normalizedColor = normalizeSuggestion(line.color || '') || '__EMPTY__'
        const key = `${normalizedSize}::${normalizedColor}`
        const existing = mergedSizes.get(key)
        if (existing) existing.quantity += quantity
        else mergedSizes.set(key, { size: String(line.size || '').trim(), color: String(line.color || '').trim(), quantity })
      }
      for (const line of mergedSizes.values()) {
        const exactVariant = position.productId ? inventoryArrivalReadyVariants(position).find((variant) => (
          getCatalogVariantCategory(variant) === position.category
          && normalizeSuggestion(variant.gender) === normalizeSuggestion(position.gender)
          && normalizeSuggestion(variant.color) === normalizeSuggestion(line.color)
          && normalizeSuggestion(variant.material) === normalizeSuggestion(position.material)
          && normalizeSuggestion(variant.length) === normalizeSuggestion(position.length)
          && normalizeSuggestion(variant.sizeLabel) === normalizeSuggestion(line.size)
        )) : null
        result.push({
          productId: position.productId,
          variantId: exactVariant ? String(exactVariant.id) : '',
          productName,
          category: position.category,
          gender: position.gender,
          color: line.color,
          material: position.material || 'СТАНДАРТ',
          length: position.length || 'СТАНДАРТ',
          size: line.size,
          quantity: line.quantity,
          touched: true,
        })
      }
    }
    return result
  }


  const inventoryMovementText = {
    arrival: {
      title: 'Приход товара',
      note: 'Можно выбрать существующий товар или сразу создать новую комбинацию. Новые варианты появятся в каталоге и в остатках выбранной точки.',
      button: 'Оформить приход',
      quantityLabel: 'Пришло',
    },
    writeoff: {
      title: 'Списание товара',
      note: 'Списание работает только по вариантам, которые уже есть на выбранной точке. Новые товары здесь не создаются.',
      button: 'Списать выбранное',
      quantityLabel: 'Списать',
    },
    manual_set: {
      title: 'Корректировка остатка',
      note: 'Быстро исправляет одну или несколько существующих позиций. Для массовой сверки используйте «Ревизию».',
      button: 'Сохранить корректировку',
      quantityLabel: 'Фактически',
    },
    transfer: {
      title: 'Перемещение между точками',
      note: 'Фиксируйте то, что реально перенесли между Складом и Бутиком. Резервы заказов не переезжают автоматически: если после перемещения в исходной точке возникнет нехватка, система покажет её как предупреждение, а не запрет.',
      button: 'Переместить выбранное',
      quantityLabel: 'Переместить',
    },
  }[inventoryDraft.movementType]

  const inventoryManagerPanels: InventoryPanel[] = ['overview', 'attention']
  const inventoryAdminPanels: InventoryPanel[] = ['overview', 'attention', 'stocktake', 'movement', 'catalog', 'history', 'settings', 'warehouse', 'boutique', 'exact']
  const inventoryPanelStyle = (panel: InventoryPanel) => ({
    display: activeSector === 'inventory'
      && (isAdmin ? inventoryAdminPanels.includes(panel) : inventoryManagerPanels.includes(panel))
      && inventoryPanel === panel ? undefined : 'none',
  })
  return {
    activeCatalogVariants,
    activeInventoryOperationItem,
    activeWorkshopTasks,
    addInventoryArrivalPosition,
    addInventoryArrivalSize,
    catalogIssueStats,
    catalogProductStockSummary,
    catalogVariantsByProductId,
    clientSummary,
    clientsShown,
    clientsTotal,
    dashboardLowStock,
    dashboardSummary,
    dashboardWorkshopWarnings,
    debtCloseHistory,
    debtOrders,
    debtOverpayAmount,
    debtPaymentTotal,
    debtRemainingAmount,
    debtSelectedOrder,
    exchangeSelectedOrder,
    filteredInventoryRows,
    flattenInventoryArrivalPositions,
    getCatalogProductEffectiveCategory,
    getInventoryRowCategory,
    getStockQuantityForVariant,
    getWorkshopInvoiceImportanceLabel,
    groupedInventoryRows,
    hasInventoryQuickFilters,
    inventoryAdminPanels,
    inventoryArrivalProductChoices,
    inventoryArrivalReadyVariants,
    inventoryArrivalSummary,
    inventoryDraftSummary,
    inventoryExistingVariantRows,
    inventoryHistoryRows,
    inventoryModelVersion,
    inventoryMovementText,
    inventoryOperationAllProductGroups,
    inventoryOperationProductGroups,
    inventoryOperationSourceRows,
    inventoryPanelStyle,
    inventoryPickerOptions,
    inventoryProblemRows,
    inventoryProductReferenceGroups,
    inventorySearchTokens,
    inventorySourceRows,
    inventoryStats,
    inventoryStocktakeAllGroups,
    inventoryStocktakeGroups,
    inventoryStocktakeStats,
    inventoryWriteoffReferenceGroups,
    latestManualMovements,
    latestReturnExchangeMovements,
    latestSaleMovements,
    matchedInventoryOperationVariant,
    operationVariantOptions,
    productHasVariantCategory,
    referenceGroups,
    removeInventoryArrivalPosition,
    removeInventoryArrivalSize,
    resetInventoryArrivalForm,
    returnOrders,
    returnSelectedOrder,
    selectInventoryArrivalProduct,
    selectInventoryArrivalVariant,
    selectedCatalogProduct,
    selectedClientSummary,
    selectedInventoryOperationGroup,
    selectedInventoryOperationItems,
    selectedOrder,
    selectedWorkshopTasks,
    summary,
    updateInventoryArrivalPosition,
    updateInventoryArrivalSize,
    variantsForProduct,
    visibleCatalogProducts,
    workshopInvoiceRows,
    workshopScopeTasks,
  }
}
