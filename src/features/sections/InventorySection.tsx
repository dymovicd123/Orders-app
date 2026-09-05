import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, Dispatch, SetStateAction } from 'react'
import type { CatalogResolutionContext, CatalogResolutionFacts, InventoryCycleCountSuggestionsResponse, InventoryReservation, InventoryStocktakeSession, InventoryStocktakeSessionSummary } from '../../../shared/api-contracts.ts'
import type { CatalogResponse, CatalogVariantRecord, FriendlyNumberInputProps, InventoryArrivalPosition, InventoryCheckHistoryRow, InventoryHistoryResponse, InventorySourceKey, SmartPickerInputProps } from '../../app/types'
import { renderInventoryHealthPanel } from '../inventory/views/renderInventoryHealthPanel'
import { renderInventoryExactPanel } from '../inventory/views/renderInventoryExactPanel'
import { renderInventorySourceToolbar } from '../inventory/views/renderInventorySourceToolbar'
import { renderInventoryOverviewPanel } from '../inventory/views/renderInventoryOverviewPanel'
import { renderInventoryAttentionPanel } from '../inventory/views/renderInventoryAttentionPanel'
import { useInventoryAttentionActions } from '../inventory/useInventoryAttentionActions'
import { runRoutineCycleCount } from '../inventory/routineCycleCount'
import { renderInventoryStocktakePanel } from '../inventory/views/renderInventoryStocktakePanel'
import { renderInventoryWarehousePanel } from '../inventory/views/renderInventoryWarehousePanel'
import { renderInventoryBoutiquePanel } from '../inventory/views/renderInventoryBoutiquePanel'
import { renderInventoryCatalogPanel } from '../inventory/views/renderInventoryCatalogPanel'
import { renderInventoryMovementPanel } from '../inventory/views/renderInventoryMovementPanel'
import { renderInventoryHistoryPanel } from '../inventory/views/renderInventoryHistoryPanel'
import '../../styles/180-inventory-simple-stock.css'
import '../../styles/181-inventory-stock-a2.css'
import '../../styles/182-inventory-stocktake-human.css'
import '../../styles/183-inventory-stocktake-workflow.css'
import '../../styles/184-inventory-operations-human.css'
import '../../styles/185-inventory-stocktake-state.css'
import '../../styles/186-inventory-products-admin.css'
import '../../styles/187-inventory-health.css'
import '../../styles/188-inventory-integrity.css'
import '../../styles/188a-human-inventory.css'
import '../../styles/188b-human-inventory-ui.css'
import '../../styles/188c-inventory-calm-ui.css'
import '../../styles/188e-inventory-stocktake-sessions.css'
import '../../styles/188e1-inventory-catalog-bridge.css'
import '../../styles/188e2-resolution-workflows.css'
import '../../styles/188e3-input-consistency.css'
import '../../styles/188e4-stocktake-usability.css'
import '../../styles/188g-inventory-lifecycle.css'
import '../../styles/188h-physical-transfers.css'
import '../../styles/188i-cycle-counts.css'
import '../../styles/188k1-stocktake-inline-add.css'
import '../../styles/192b2a-warehouse-attention-actions.css'

type SimpleStockDetail = {
  source: InventorySourceKey
  productId: number
  variantId: number
  productName: string
  category: string
  gender: string
  material: string
  length: string
  size: string
  color: string
  physical: number
  reserved: number
  free: number
  aggregate: boolean
  label: string
  hasDataIssue: boolean
}

type InventoryHistoryFilter = {
  source: InventorySourceKey
  variantId: number
  productId?: number
  productName?: string
  color?: string
  size?: string
}

type ResolutionFactsState = CatalogResolutionFacts & { productId: number }
type ResolutionContextState = Partial<CatalogResolutionContext> & { error?: string }
type ResolutionEditableField = 'material' | 'length' | 'color' | 'size'
type ResolutionKnownField = ResolutionEditableField | 'gender' | 'category'

const resolutionEditableFields: readonly ResolutionEditableField[] = ['material', 'length', 'color', 'size']

type SectionContext = Record<string, any> & {
  catalogData: CatalogResponse | null
  inventoryArrivalPositions: InventoryArrivalPosition[]
  inventoryArrivalReadyVariants: (position: InventoryArrivalPosition) => CatalogVariantRecord[]
  selectInventoryArrivalVariant: (positionId: string, variant: CatalogVariantRecord) => void
  SmartPickerInput: ComponentType<SmartPickerInputProps>
  FriendlyNumberInput: ComponentType<FriendlyNumberInputProps>
  setInventoryArrivalVariantOpen: Dispatch<SetStateAction<Record<string, boolean>>>
}

export function InventorySection({ ctx }: { ctx: SectionContext }) {
  const {
    activeSector,
    applyPendingInventoryWriteoffs,
    buildInventoryMatrix,
    catalogCategoryFilter,
    catalogOnlyWithoutVariants,
    setCatalogOnlyWithoutVariants,
    catalogData,
    catalogReview,
    catalogReviewBusy,
    inventoryLifecycle,
    inventoryLifecycleBusy,
    warehouseAttention,
    catalogIssueStats,
    catalogProductDraft,
    catalogVariantDraft,
    catalogVariantsByProductId,
    ChoicePills,
    createEmptyInventoryItem,
    createEmptyInventoryMatrixDraft,
    expandedCatalogProducts,
    filteredInventoryRows,
    filteredReferenceItems,
    formatDateShort,
    formatMoney,
    FriendlyNumberInput,
    getCatalogProductEffectiveCategory,
    getCatalogVariantCategory,
    getInventoryRowCategory,
    getStockQuantityForVariant,
    groupedInventoryRows,
    handleInventoryMatrixKeyDown,
    inventoryArrivalPositions,
    inventoryArrivalSummary,
    inventoryArrivalVariantOpen,
    inventoryArrivalReadyVariants,
    selectInventoryArrivalVariant,
    selectInventoryArrivalProduct,
    updateInventoryArrivalPosition,
    addInventoryArrivalSize,
    updateInventoryArrivalSize,
    removeInventoryArrivalSize,
    addInventoryArrivalPosition,
    removeInventoryArrivalPosition,
    resetInventoryArrivalForm,
    setInventoryArrivalVariantOpen,
    inventoryAudit,
    inventoryAuditBusy,
    resolveInventoryAuditIssue,
    inventoryCategoryFilter,
    inventoryControlBusy,
    inventoryControlSettings,
    inventoryMovementBusy,
    inventoryDraft,
    inventoryDraftSummary,
    inventoryMatrix,
    inventoryMatrixAxisLabel,
    inventoryMatrixCellKey,
    inventoryMatrixCellMap,
    inventoryMatrixColors,
    inventoryMatrixDraftItem,
    inventoryMatrixSizes,
    inventoryMatrixSummary,
    inventoryModelVersion,
    inventoryMovementText,
    inventoryOperationAllProductGroups,
    inventoryOperationProductGroups,
    inventoryOperationSearch,
    inventoryExistingVariantSearch,
    inventoryPanel,
    inventoryPanelStyle,
    inventoryPickerOptions,
    inventoryProblemRows,
    inventoryQuery,
    inventoryQuickFilters,
    inventorySortMode,
    inventorySourceRows,
    inventoryStats,
    inventoryStocktakeAllGroups,
    inventoryStocktakeGroups,
    printInventoryStocktakePdf,
    inventoryStatusFilter,
    isAdmin,
    loadCatalogData,
    loadCatalogReview,
    reconcileCatalogReview,
    loadCatalogReviewContext,
    resolveCatalogReviewFacts,
    excludeCatalogReviewItem,
    loadInventoryLifecycle,
    loadInventoryLifecycleContext,
    resolveInventoryLifecycleFacts,
    reconcileKnownInventoryLifecycle,
    loadWarehouseAttention,
    loadInventoryAudit,
    loadInventoryData,
    loadInventoryHistory,
    loadInventoryCheckHistory,
    loadInventoryReservations,
    loadInventoryStocktakeSessions,
    loadInventoryStocktakeSession,
    createInventoryStocktakeSession,
    saveInventoryStocktakeCount,
    addInventoryStocktakeVariant,
    addInventoryStocktakeCombination,
    loadInventoryCycleCounts,
    applyInventoryCycleCounts,
    quickInventoryStocktake,
    completeInventoryStocktakeSession,
    cancelInventoryStocktakeSession,
    loadReferenceItems,
    loadReferencesData,
    references,
    normalizeSuggestion,
    openInventoryPanel,
    openOrderFromFinance,
    openOrderStockHandoverById,
    inventoryProductReferenceGroups,
    inventoryWriteoffReferenceGroups,
    productCategoryLabel,
    referenceBusy,
    referenceDraft,
    referenceItems,
    referenceKind,
    referenceSearch,
    referenceStatusFilter,
    refreshInventoryModule,
    removeReferenceEntry,
    renderInventoryStockGroups,
    resetReferenceDraft,
    resetInventoryOperationSelection,
    removeInventoryVariantOperationItem,
    reverseInventoryMovement,
    reversingInventoryMovementId,
    saveCatalogProduct,
    saveCatalogVariant,
    saveInventoryMovement,
    saveReferenceEntry,
    selectedCatalogProduct,
    selectedReferenceKindConfig,
    selectedInventoryOperationGroup,
    selectInventoryOperationVariant,
    setCatalogCategoryFilter,
    setCatalogProductDraft,
    setCatalogVariantDraft,
    setExpandedCatalogProducts,
    setInventoryCategoryFilter,
    setInventoryDraft,
    setInventoryMatrix,
    setInventoryMatrixCell,
    setInventoryMatrixColorToAdd,
    setInventoryMatrixSizeToAdd,
    setInventoryExistingVariantSearch,
    setInventoryQuery,
    setInventoryQuickFilters,
    setInventorySortMode,
    setInventoryStatusFilter,
    setInventoryTransferObservedQuantity,
    setInventoryVariantOperationQuantity,
    setReferenceDraft,
    setReferenceSearch,
    setReferenceStatusFilter,
    selectReferenceKind,
    SmartPickerInput,
    sourceLabel,
    suggestionValues,
    arrivalSuggestionValues,
    toggleInventoryAutoWriteoff,
    updateInventoryMatrixCategory,
    updateInventoryMatrixGender,
    updateInventoryMatrixLength,
    updateInventoryMatrixMaterial,
    updateInventoryMatrixProductInput,
    updateInventoryDirectProductInput,
    visibleCatalogProducts,
  } = ctx

  const [simpleStockSource, setSimpleStockSource] = useState<'warehouse' | 'boutique'>('warehouse')
  const [simpleStockCategory, setSimpleStockCategory] = useState<'all' | 'adult' | 'child'>('all')
  const [simpleStockAvailabilityFilter, setSimpleStockAvailabilityFilter] = useState<'free' | 'reserved' | 'attention' | 'all'>('free')
  const [simpleStockDetail, setSimpleStockDetail] = useState<SimpleStockDetail | null>(null)
  const [simpleStockReservations, setSimpleStockReservations] = useState<InventoryReservation[]>([])
  const [simpleStockReservationsBusy, setSimpleStockReservationsBusy] = useState(false)
  const [historyVariantFilter, setHistoryVariantFilter] = useState<InventoryHistoryFilter | null>(null)
  const [historyMode, setHistoryMode] = useState<'movements' | 'checks'>('movements')
  const [historyRows, setHistoryRows] = useState<InventoryHistoryResponse['movements']>([])
  const [historyCheckRows, setHistoryCheckRows] = useState<InventoryCheckHistoryRow[]>([])
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyNextBeforeId, setHistoryNextBeforeId] = useState<number | null>(null)
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyStocktakeDetail, setHistoryStocktakeDetail] = useState<InventoryStocktakeSession | null>(null)
  const [historyStocktakeDetailBusy, setHistoryStocktakeDetailBusy] = useState(false)
  const [simpleStockOpenProductKey, setSimpleStockOpenProductKey] = useState('')
  const [catalogAdminMode, setCatalogAdminMode] = useState<'catalog' | 'review' | 'lifecycle' | 'attributes'>('catalog')
  const [catalogReviewTaskIndex, setCatalogReviewTaskIndex] = useState(0)
  const [catalogReviewProductId, setCatalogReviewProductId] = useState(0)
  const [catalogReviewExecutionKey, setCatalogReviewExecutionKey] = useState('')
  const [catalogReviewVariantId, setCatalogReviewVariantId] = useState(0)
  const [catalogReviewContext, setCatalogReviewContext] = useState<ResolutionContextState | null>(null)
  const [catalogReviewContextBusy, setCatalogReviewContextBusy] = useState(false)
  const [catalogReviewFacts, setCatalogReviewFacts] = useState<ResolutionFactsState>({ productId: 0, material: 'СТАНДАРТ', length: 'СТАНДАРТ', category: 'adult', gender: '', color: '', size: '' })
  const [catalogReviewCreateFields, setCatalogReviewCreateFields] = useState<Record<string, boolean>>({})
  const [catalogReviewCreateProduct, setCatalogReviewCreateProduct] = useState(false)
  const [catalogReviewNewProductName, setCatalogReviewNewProductName] = useState('')
  const [inventoryLifecycleTaskIndex, setInventoryLifecycleTaskIndex] = useState(0)
  const [inventoryLifecycleContext, setInventoryLifecycleContext] = useState<ResolutionContextState | null>(null)
  const [inventoryLifecycleContextBusy, setInventoryLifecycleContextBusy] = useState(false)
  const [inventoryLifecycleFacts, setInventoryLifecycleFacts] = useState<ResolutionFactsState>({ productId: 0, material: 'СТАНДАРТ', length: 'СТАНДАРТ', category: 'adult', gender: '', color: '', size: '' })
  const [inventoryLifecycleCreateFields, setInventoryLifecycleCreateFields] = useState<Record<string, boolean>>({})
  const [inventoryLifecycleCreateProduct, setInventoryLifecycleCreateProduct] = useState(false)
  const [inventoryLifecycleNewProductName, setInventoryLifecycleNewProductName] = useState('')
  const [movementSourceLoading, setMovementSourceLoading] = useState(false)
  const [movementSourceLoadError, setMovementSourceLoadError] = useState('')
  const [movementSourceRefreshToken, setMovementSourceRefreshToken] = useState(0)
  const movementSourceRequestRef = useRef(0)

  const catalogReviewGroups = useMemo(() => {
    const groups = new Map<string, any>()
    for (const item of catalogReview?.items || []) {
      const key = item.inputKey || `order-item:${item.orderItemId}`
      const current = groups.get(key) || { key, sample: item, items: [], affectedCount: 0 }
      current.items.push(item)
      current.affectedCount += Math.max(1, Number((item as any).affectedCount || 1))
      groups.set(key, current)
    }
    return Array.from(groups.values())
  }, [catalogReview])

  const catalogExecutionKey = (material: unknown, length: unknown) => `${String(material || 'СТАНДАРТ').trim().toUpperCase() || 'СТАНДАРТ'}¦${String(length || 'СТАНДАРТ').trim().toUpperCase() || 'СТАНДАРТ'}`
  const catalogExecutionLabel = (material: unknown, length: unknown) => [String(material || 'СТАНДАРТ').trim() || 'СТАНДАРТ', String(length || 'СТАНДАРТ').trim() || 'СТАНДАРТ'].join(' · ')
  const catalogCombinationLabel = (variant: any) => [productCategoryLabel(getCatalogVariantCategory(variant)), variant.gender, variant.color, variant.sizeLabel].filter(Boolean).join(' · ') || 'Стандартная комбинация'

  const catalogActiveProducts = useMemo(() => (catalogData?.products || [])
    .filter((product: any) => product.isActive)
    .slice()
    .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''), 'ru', { numeric: true })), [catalogData])

  const catalogReviewActiveGroup = catalogReviewGroups.length
    ? catalogReviewGroups[Math.min(catalogReviewTaskIndex, catalogReviewGroups.length - 1)]
    : null
  const catalogReviewActiveItem = catalogReviewActiveGroup?.sample || null

  const catalogReviewExecutionOptions = useMemo(() => {
    if (!catalogReviewProductId) return []
    const map = new Map<string, any>()
    for (const variant of catalogData?.variants || []) {
      if (!variant.isActive || Number(variant.productId || 0) !== catalogReviewProductId) continue
      const key = catalogExecutionKey(variant.material, variant.length)
      if (!map.has(key)) map.set(key, { key, material: variant.material || 'СТАНДАРТ', length: variant.length || 'СТАНДАРТ', label: catalogExecutionLabel(variant.material, variant.length) })
    }
    return Array.from(map.values()).sort((a: any, b: any) => a.label.localeCompare(b.label, 'ru', { numeric: true }))
  }, [catalogData, catalogReviewProductId])

  const catalogReviewCombinationOptions = useMemo(() => {
    if (!catalogReviewProductId || !catalogReviewExecutionKey) return []
    return (catalogData?.variants || [])
      .filter((variant: any) => variant.isActive && Number(variant.productId || 0) === catalogReviewProductId && catalogExecutionKey(variant.material, variant.length) === catalogReviewExecutionKey)
      .slice()
      .sort((a: any, b: any) => catalogCombinationLabel(a).localeCompare(catalogCombinationLabel(b), 'ru', { numeric: true }))
  }, [catalogData, catalogReviewProductId, catalogReviewExecutionKey])

  useEffect(() => {
    setCatalogReviewTaskIndex((current) => Math.min(current, Math.max(0, catalogReviewGroups.length - 1)))
  }, [catalogReviewGroups.length])

  useEffect(() => {
    if (catalogReview?.mode !== 'order') return
    setCatalogAdminMode('review')
    setCatalogReviewTaskIndex(0)
  }, [catalogReview?.mode, catalogReview?.orderId])

  useEffect(() => {
    const item = catalogReviewActiveItem
    setCatalogReviewContext(null)
    setCatalogReviewCreateFields({})
    setCatalogReviewCreateProduct(false)
    setCatalogReviewNewProductName(String(item?.productName || '').trim())
    if (!item?.orderItemId || catalogAdminMode !== 'review') return
    let cancelled = false
    setCatalogReviewContextBusy(true)
    void loadCatalogReviewContext(Number(item.orderItemId)).then((context: any) => {
      if (cancelled) return
      setCatalogReviewContext(context)
      const facts = context?.facts || {}
      setCatalogReviewFacts({
        productId: Number(context?.product?.id || 0),
        material: facts.material || 'СТАНДАРТ',
        length: facts.length || 'СТАНДАРТ',
        category: facts.category || 'adult',
        gender: facts.gender || '',
        color: facts.color || '',
        size: facts.size || '',
      })
    }).catch((error: any) => {
      if (!cancelled) setCatalogReviewContext({ error: error instanceof Error ? error.message : 'Не удалось определить причину.' })
    }).finally(() => { if (!cancelled) setCatalogReviewContextBusy(false) })
    return () => { cancelled = true }
  }, [catalogReviewActiveGroup?.key, catalogAdminMode])

  const catalogReviewReferences = catalogReviewContext?.references || { materials: [], lengths: [], colors: [], sizes: [], childAges: [] }
  const reviewFieldUnknown = (field: ResolutionKnownField) => (catalogReviewContext?.unknownFields || []).includes(field)
  const reviewValueNeedsCreation = (field: ResolutionEditableField, value: string) => reviewFieldUnknown(field) && normalizeSuggestion(value) === normalizeSuggestion((catalogReviewContext?.facts || {})[field] || '')
  const reviewFieldOptions = (field: ResolutionEditableField) => {
    if (field === 'material') return catalogReviewReferences.materials || []
    if (field === 'length') return catalogReviewReferences.lengths || []
    if (field === 'color') return catalogReviewReferences.colors || []
    if (field === 'size') return catalogReviewFacts.category === 'child' ? (catalogReviewReferences.childAges || []) : (catalogReviewReferences.sizes || [])
    return []
  }
  const reviewOptionsWithCurrent = (field: ResolutionEditableField) => {
    const current = String(catalogReviewFacts[field] || '').trim()
    const values = reviewFieldOptions(field).slice()
    if (current && !values.some((value: string) => normalizeSuggestion(value) === normalizeSuggestion(current))) values.unshift(current)
    return values
  }

  const catalogReviewIssueCopy: Record<string, { title: string; text: string }> = {
    unknown_product: { title: 'Неизвестен базовый товар', text: 'Определите товар. Если вместе с ним есть неизвестная характеристика, интерфейс покажет её отдельно — случайно узаконить новое значение не получится.' },
    workshop_product: { title: 'Цеховая позиция: нужен только товар', text: 'Для цеховой позиции складскую комбинацию создавать не нужно. Достаточно связать её с базовым товаром.' },
    unknown_attribute: { title: 'Неизвестна конкретная характеристика', text: 'Товар уже понятен. Исправьте только неизвестное значение или явно добавьте его как новое.' },
    new_execution: { title: 'Новое исполнение товара', text: 'Товар известен, но сочетание материала и длины раньше не встречалось. Подтвердите факты — система создаст исполнение.' },
    missing_combination: { title: 'Новая обычная комбинация', text: 'Все значения известны. Система может создать недостающую цвето-размерную комбинацию без изменения остатка.' },
    exact_existing: { title: 'Точная комбинация уже существует', text: 'Это безопасное совпадение. Подтвердите связь; выбирать похожий размер или цвет не нужно.' },
  }
  const catalogReviewIssue = (catalogReviewContext?.issueType ? catalogReviewIssueCopy[catalogReviewContext.issueType] : undefined) || { title: 'Нужно уточнить позицию', text: 'Укажите только факты, в которых уверены.' }
  const catalogReviewUnconfirmedFields = resolutionEditableFields.filter((field) => reviewValueNeedsCreation(field, String(catalogReviewFacts[field] || '')) && !catalogReviewCreateFields[field])
  const catalogReviewGenderNeedsChoice = reviewFieldUnknown('gender') && !['', 'ЖЕН', 'МУЖ'].includes(normalizeSuggestion(catalogReviewFacts.gender))
  const catalogReviewBlockingFields = [...catalogReviewUnconfirmedFields, ...(catalogReviewGenderNeedsChoice ? ['gender'] : [])]

  async function submitCatalogReviewFacts() {
    if (!catalogReviewActiveItem?.orderItemId || catalogReviewBusy || catalogReviewContextBusy) return
    const productId = Number(catalogReviewFacts.productId || 0)
    if (!productId && !catalogReviewCreateProduct) return
    const createFields = Object.entries(catalogReviewCreateFields).filter(([, enabled]) => enabled).map(([field]) => field)
    const result = await resolveCatalogReviewFacts(Number(catalogReviewActiveItem.orderItemId), {
      ...catalogReviewFacts,
      productId,
      createProduct: catalogReviewCreateProduct,
      productName: catalogReviewCreateProduct ? catalogReviewNewProductName : catalogReviewActiveItem.productName,
      createFields,
    })
    if (result) {
      setCatalogReviewTaskIndex(0)
      setCatalogReviewContext(null)
      setCatalogReviewCreateFields({})
      setCatalogReviewCreateProduct(false)
    }
  }

  async function excludeCurrentCatalogReviewItem() {
    if (!catalogReviewActiveItem?.orderItemId || catalogReviewBusy || catalogReviewContextBusy) return
    const affected = Math.max(1, Number(catalogReviewActiveGroup?.affectedCount || 1))
    const itemLabel = String(catalogReviewActiveItem.productName || 'эта позиция').trim()
    const question = affected > 1
      ? `Не добавлять «${itemLabel}» в каталог для ${affected} одинаковых текущих позиций? Они останутся в своих заказах как введённый текст и не будут участвовать в складском учёте.`
      : `Не добавлять «${itemLabel}» в каталог? Позиция останется в заказе как введённый текст и не будет участвовать в складском учёте.`
    if (!window.confirm(question)) return
    const result = await excludeCatalogReviewItem(Number(catalogReviewActiveItem.orderItemId))
    if (result) {
      setCatalogReviewTaskIndex(0)
      setCatalogReviewContext(null)
      setCatalogReviewCreateFields({})
      setCatalogReviewCreateProduct(false)
    }
  }

  const inventoryLifecycleItems = inventoryLifecycle?.items || []
  const inventoryLifecycleActiveItem = inventoryLifecycleItems.length
    ? inventoryLifecycleItems[Math.min(inventoryLifecycleTaskIndex, inventoryLifecycleItems.length - 1)]
    : null

  useEffect(() => {
    setInventoryLifecycleTaskIndex((current) => Math.min(current, Math.max(0, inventoryLifecycleItems.length - 1)))
  }, [inventoryLifecycleItems.length])

  useEffect(() => {
    const item = inventoryLifecycleActiveItem
    setInventoryLifecycleContext(null)
    setInventoryLifecycleCreateFields({})
    setInventoryLifecycleCreateProduct(false)
    setInventoryLifecycleNewProductName(String(item?.productName || '').trim())
    if (!item?.id || catalogAdminMode !== 'lifecycle') return
    let cancelled = false
    setInventoryLifecycleContextBusy(true)
    void loadInventoryLifecycleContext(Number(item.id)).then((context: any) => {
      if (cancelled) return
      setInventoryLifecycleContext(context)
      const facts = context?.facts || {}
      setInventoryLifecycleFacts({
        productId: Number(context?.product?.id || item.productId || 0),
        material: facts.material || item.material || 'СТАНДАРТ',
        length: facts.length || item.length || 'СТАНДАРТ',
        category: facts.category || item.category || 'adult',
        gender: facts.gender || item.gender || '',
        color: facts.color || item.color || '',
        size: facts.size || item.size || '',
      })
    }).catch((error: any) => {
      if (!cancelled) setInventoryLifecycleContext({ error: error instanceof Error ? error.message : 'Не удалось определить причину.' })
    }).finally(() => { if (!cancelled) setInventoryLifecycleContextBusy(false) })
    return () => { cancelled = true }
  }, [inventoryLifecycleActiveItem?.id, catalogAdminMode])

  const inventoryLifecycleReferences = inventoryLifecycleContext?.references || { materials: [], lengths: [], colors: [], sizes: [], childAges: [] }
  const lifecycleReferenceOptions = (field: ResolutionEditableField) => {
    if (field === 'material') return inventoryLifecycleReferences.materials || []
    if (field === 'length') return inventoryLifecycleReferences.lengths || []
    if (field === 'color') return inventoryLifecycleReferences.colors || []
    if (field === 'size') return inventoryLifecycleFacts.category === 'child' ? (inventoryLifecycleReferences.childAges || []) : (inventoryLifecycleReferences.sizes || [])
    return []
  }
  const lifecycleOptionsWithCurrent = (field: ResolutionEditableField) => {
    const current = String(inventoryLifecycleFacts[field] || '').trim()
    const values = lifecycleReferenceOptions(field).slice()
    if (current && !values.some((value: string) => normalizeSuggestion(value) === normalizeSuggestion(current))) values.unshift(current)
    return values
  }
  const lifecycleFactsMatchExactVariant = Boolean(inventoryLifecycleContext?.existingVariantId)
    && Number(inventoryLifecycleFacts.productId || 0) === Number(inventoryLifecycleContext?.product?.id || 0)
    && normalizeSuggestion(inventoryLifecycleFacts.material) === normalizeSuggestion(inventoryLifecycleContext?.facts?.material || '')
    && normalizeSuggestion(inventoryLifecycleFacts.length) === normalizeSuggestion(inventoryLifecycleContext?.facts?.length || '')
    && normalizeSuggestion(inventoryLifecycleFacts.category) === normalizeSuggestion(inventoryLifecycleContext?.facts?.category || '')
    && normalizeSuggestion(inventoryLifecycleFacts.gender) === normalizeSuggestion(inventoryLifecycleContext?.facts?.gender || '')
    && normalizeSuggestion(inventoryLifecycleFacts.color) === normalizeSuggestion(inventoryLifecycleContext?.facts?.color || '')
    && normalizeSuggestion(inventoryLifecycleFacts.size) === normalizeSuggestion(inventoryLifecycleContext?.facts?.size || '')
  const lifecycleValueNeedsCreation = (field: ResolutionEditableField, value: string) => {
    if (lifecycleFactsMatchExactVariant) return false
    const normalized = normalizeSuggestion(value)
    if (!normalized) return false
    if ((field === 'material' || field === 'length') && normalized === normalizeSuggestion('СТАНДАРТ')) return false
    return !lifecycleReferenceOptions(field).some((entry: string) => normalizeSuggestion(entry) === normalized)
  }
  const inventoryLifecycleUnconfirmedFields = resolutionEditableFields.filter((field) => lifecycleValueNeedsCreation(field, String(inventoryLifecycleFacts[field] || '')) && !inventoryLifecycleCreateFields[field])
  const inventoryLifecycleGenderNeedsChoice = !['', 'ЖЕН', 'МУЖ'].includes(normalizeSuggestion(inventoryLifecycleFacts.gender))
  const inventoryLifecycleBlockingFields = [...inventoryLifecycleUnconfirmedFields, ...(inventoryLifecycleGenderNeedsChoice ? ['gender'] : [])]

  async function submitInventoryLifecycleFacts() {
    if (!inventoryLifecycleActiveItem?.id || inventoryLifecycleBusy || inventoryLifecycleContextBusy) return
    const productId = Number(inventoryLifecycleFacts.productId || 0)
    if (!productId && !inventoryLifecycleCreateProduct) return
    const createFields = Object.entries(inventoryLifecycleCreateFields).filter(([, enabled]) => enabled).map(([field]) => field)
    const result = await resolveInventoryLifecycleFacts(Number(inventoryLifecycleActiveItem.id), {
      ...inventoryLifecycleFacts,
      productId,
      createProduct: inventoryLifecycleCreateProduct,
      productName: inventoryLifecycleCreateProduct ? inventoryLifecycleNewProductName : inventoryLifecycleActiveItem.productName,
      createFields,
    })
    if (result) {
      setInventoryLifecycleTaskIndex(0)
      setInventoryLifecycleContext(null)
      setInventoryLifecycleCreateFields({})
      setInventoryLifecycleCreateProduct(false)
    }
  }

  type StocktakeSource = 'warehouse' | 'boutique' 
  type StocktakeInlineAddState = {
    mode: 'size' | 'color'
    positionKey: string
    color: string
    sizes: string[]
  }

  const [stocktakeSource, setStocktakeSource] = useState<StocktakeSource>('warehouse')
  const [stocktakeStartMode, setStocktakeStartMode] = useState<'selective' | 'full'>('selective')
  const [stocktakeStartSearch, setStocktakeStartSearch] = useState('')
  const [stocktakeSelectedProductIds, setStocktakeSelectedProductIds] = useState<number[]>([])
  const [stocktakeSession, setStocktakeSession] = useState<InventoryStocktakeSession | null>(null)
  const [stocktakeActiveSessions, setStocktakeActiveSessions] = useState<InventoryStocktakeSessionSummary[]>([])
  const [stocktakeBusy, setStocktakeBusy] = useState(false)
  const [stocktakeNotice, setStocktakeNotice] = useState('')
  const [stocktakeProductIndex, setStocktakeProductIndex] = useState(0)
  const [stocktakeProductSearch, setStocktakeProductSearch] = useState('')
  const [stocktakeReviewMode, setStocktakeReviewMode] = useState(false)
  const [stocktakeFacts, setStocktakeFacts] = useState<Record<string, string>>({})
  const [stocktakeSavingIds, setStocktakeSavingIds] = useState<number[]>([])
  const [stocktakeFoundProductId, setStocktakeFoundProductId] = useState(0)
  const [stocktakeFoundExecutionKey, setStocktakeFoundExecutionKey] = useState('')
  const [stocktakeFoundVariantId, setStocktakeFoundVariantId] = useState(0)
  const [stocktakeFoundCreateMode, setStocktakeFoundCreateMode] = useState(false)
  const [stocktakeFoundDraft, setStocktakeFoundDraft] = useState({ material: '', length: '', category: 'adult', gender: '', color: '', size: '' })
  const [stocktakeFoundSizes, setStocktakeFoundSizes] = useState<string[]>([])
  const [stocktakeFoundCustom, setStocktakeFoundCustom] = useState({ material: '', length: '', color: '', size: '' })
  const [stocktakeFoundNewFields, setStocktakeFoundNewFields] = useState<Record<string, boolean>>({})
  const [stocktakeFoundOtherProduct, setStocktakeFoundOtherProduct] = useState(false)
  const [stocktakeFoundOpen, setStocktakeFoundOpen] = useState(false)
  const [stocktakeAddingVariantId, setStocktakeAddingVariantId] = useState(0)
  const [stocktakeInlineAdd, setStocktakeInlineAdd] = useState<StocktakeInlineAddState | null>(null)
  const [stocktakeInlineAddBusy, setStocktakeInlineAddBusy] = useState(false)
  const [quickStocktakeOpen, setQuickStocktakeOpen] = useState(false)
  const [quickStocktakeValues, setQuickStocktakeValues] = useState<Record<string, string>>({})
  const [quickStocktakeBusy, setQuickStocktakeBusy] = useState(false)
  const [quickStocktakeNotice, setQuickStocktakeNotice] = useState('')
  const [cycleCountData, setCycleCountData] = useState<InventoryCycleCountSuggestionsResponse | null>(null)
  const [cycleCountOpen, setCycleCountOpen] = useState(false)
  const [cycleCountValues, setCycleCountValues] = useState<Record<string, string>>({})
  const [cycleCountBusy, setCycleCountBusy] = useState(false)
  const [cycleCountLoading, setCycleCountLoading] = useState(false)
  const [cycleCountNotice, setCycleCountNotice] = useState('')
  const cycleCountLoadSeq = useRef(0)
  const stocktakeSaveTimers = useRef<Map<number, number>>(new Map())
  const stocktakeSaveInFlight = useRef<Map<number, Promise<boolean>>>(new Map())
  const stocktakePendingValues = useRef<Map<number, string>>(new Map())
  const stocktakeLastPersistedValues = useRef<Map<number, string>>(new Map())
  const stocktakeTouchedIds = useRef<Set<number>>(new Set())

  const stocktakeSourceTitle = (source: StocktakeSource) => source === 'warehouse' ? 'Склад' : 'Бутик'
  const stocktakeSourceGenitive = (source: StocktakeSource) => source === 'warehouse' ? 'склада' : 'бутика'
  const stocktakePositionKey = (row: any) => [row.material || 'СТАНДАРТ', row.length || 'СТАНДАРТ', row.category || 'adult', row.gender || ''].join('::')
  const stocktakePositionLabel = (row: any) => {
    const executionParts = [row.material, row.length].filter((value) => value && value !== 'СТАНДАРТ')
    const audienceParts = [row.category === 'child' ? 'Детский' : '', row.gender].filter(Boolean)
    const parts = [...executionParts, ...audienceParts]
    return parts.length ? parts.join(' · ') : 'Стандартное исполнение'
  }
  const formatStocktakeMoment = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
  }

  function adoptStocktakeSession(session: InventoryStocktakeSession | null | undefined) {
    if (!session) return
    setStocktakeSession(session)
    setStocktakeSource(session.source)
    const persistedFacts = Object.fromEntries((session.items || []).map((item: any) => [String(item.id), item.countedQuantity === null || item.countedQuantity === undefined ? '' : String(item.countedQuantity)]))
    setStocktakeFacts(persistedFacts)
    stocktakeLastPersistedValues.current = new Map((session.items || []).map((item: any) => [Number(item.id), item.countedQuantity === null || item.countedQuantity === undefined ? '' : String(item.countedQuantity)]))
    stocktakePendingValues.current.clear()
    stocktakeTouchedIds.current.clear()
    setStocktakeProductIndex(0)
    setStocktakeProductSearch('')
    setStocktakeFoundExecutionKey('')
    setStocktakeFoundVariantId(0)
    setStocktakeFoundCreateMode(false)
    setStocktakeFoundOtherProduct(false)
    setStocktakeFoundOpen(false)
    setStocktakeInlineAdd(null)
    setStocktakeFoundDraft({ material: '', length: '', category: 'adult', gender: '', color: '', size: '' })
    setStocktakeFoundSizes([])
    setStocktakeFoundCustom({ material: '', length: '', color: '', size: '' })
    setStocktakeFoundNewFields({})
    setStocktakeReviewMode(false)
  }

  async function refreshActiveStocktakes() {
    if (!isAdmin) return
    try {
      const data = await loadInventoryStocktakeSessions('')
      setStocktakeActiveSessions(Array.isArray(data?.sessions) ? data.sessions : [])
    } catch (error) {
      setStocktakeNotice(error instanceof Error ? error.message : 'Не удалось проверить незавершённые ревизии.')
    }
  }

  useEffect(() => {
    if (inventoryPanel !== 'stocktake' || !isAdmin) return
    void refreshActiveStocktakes()
  }, [inventoryPanel, isAdmin])

  useEffect(() => {
    if (!isAdmin || activeSector !== 'inventory') return
    if (inventoryPanel !== 'stocktake' && inventoryPanel !== 'catalog') return
    if (!references) void loadReferencesData()
  }, [activeSector, inventoryPanel, isAdmin, references])

  useEffect(() => () => {
    for (const timer of stocktakeSaveTimers.current.values()) window.clearTimeout(timer)
    stocktakeSaveTimers.current.clear()
    stocktakePendingValues.current.clear()
    stocktakeTouchedIds.current.clear()
  }, [])

  const stocktakeRows = useMemo(() => {
    return (stocktakeSession?.items || []).map((item: any, index: number) => ({ ...item, rowNumber: index + 1 }))
  }, [stocktakeSession])

  const stocktakeGroups = useMemo(() => {
    const groups = new Map<string, any>()
    for (const row of stocktakeRows) {
      const key = Number(row.productId || 0) > 0 ? `product:${row.productId}` : `name:${normalizeSuggestion(row.productName)}`
      const current = groups.get(key) || { key, productId: row.productId, productName: row.productName, rows: [] }
      current.rows.push(row)
      groups.set(key, current)
    }
    return Array.from(groups.values())
  }, [stocktakeRows])

  const filteredStocktakeProductGroups = useMemo(() => {
    const query = normalizeSuggestion(stocktakeProductSearch)
    if (!query) return stocktakeGroups
    return stocktakeGroups.filter((group: any) => normalizeSuggestion(group.productName).includes(query))
  }, [stocktakeGroups, stocktakeProductSearch])

  const stocktakeReferenceReady = Boolean(references)

  const stocktakeProgress = useMemo(() => {
    let filled = 0
    let differences = 0
    let recount = 0
    let shortages = 0
    for (const row of stocktakeRows) {
      const raw = stocktakeFacts[String(row.id)] ?? ''
      if (raw !== '') {
        filled += 1
        const fact = Number(raw)
        if (fact !== Number(row.baselineQuantity || 0)) differences += 1
        if (fact - Number(row.reservedQuantity || 0) < 0) shortages += 1
      }
      if (row.status === 'recount_required') recount += 1
    }
    return { total: stocktakeRows.length, filled, unfilled: stocktakeRows.length - filled, differences, recount, shortages }
  }, [stocktakeRows, stocktakeFacts])

  const stocktakeReadyForReview = stocktakeProgress.unfilled === 0 && stocktakeProgress.recount === 0
  const stocktakeUnsavedCount = useMemo(() => (stocktakeSession?.items || []).filter((item: any) => {
    const raw = stocktakeFacts[String(item.id)] ?? ''
    const persisted = item.countedQuantity === null || item.countedQuantity === undefined ? '' : String(item.countedQuantity)
    return raw !== persisted || (item.status === 'recount_required' && stocktakeTouchedIds.current.has(Number(item.id)))
  }).length, [stocktakeSession, stocktakeFacts])

  const stocktakeSourceStats = useMemo(() => {
    const rows = (inventoryStocktakeAllGroups || []).flatMap((group: any) => group.rows || [])
    const countFor = (source: StocktakeSource) => rows.filter((row: any) => {
      const physical = source === 'warehouse' ? Number(row.warehouseQuantity || 0) : Number(row.boutiqueQuantity || 0)
      const reserved = source === 'warehouse' ? Number(row.warehouseReserved || 0) : Number(row.boutiqueReserved || 0)
      return physical !== 0 || reserved !== 0
    }).length
    return { warehouse: countFor('warehouse'), boutique: countFor('boutique') }
  }, [inventoryStocktakeAllGroups])

  const stocktakeSelectableProducts = useMemo(() => {
    return (inventoryStocktakeAllGroups || []).map((group: any) => {
      const activeRows = (group.rows || []).filter((row: any) => {
        const physical = stocktakeSource === 'warehouse' ? Number(row.warehouseQuantity || 0) : Number(row.boutiqueQuantity || 0)
        const reserved = stocktakeSource === 'warehouse' ? Number(row.warehouseReserved || 0) : Number(row.boutiqueReserved || 0)
        return physical !== 0 || reserved !== 0
      })
      return { productId: Number(group.productId || 0), productName: group.productName, positionCount: activeRows.length }
    }).filter((row: any) => row.productId && row.positionCount > 0)
      .sort((a: any, b: any) => String(a.productName || '').localeCompare(String(b.productName || ''), 'ru'))
  }, [inventoryStocktakeAllGroups, stocktakeSource])

  const filteredStocktakeSelectableProducts = useMemo(() => {
    const query = normalizeSuggestion(stocktakeStartSearch)
    if (!query) return stocktakeSelectableProducts
    return stocktakeSelectableProducts.filter((row: any) => normalizeSuggestion(row.productName).includes(query))
  }, [stocktakeSelectableProducts, stocktakeStartSearch])

  const selectedStocktakePositionCount = useMemo(() => {
    const selected = new Set(stocktakeSelectedProductIds)
    return stocktakeSelectableProducts.reduce((sum: number, row: any) => sum + (selected.has(Number(row.productId)) ? Number(row.positionCount || 0) : 0), 0)
  }, [stocktakeSelectableProducts, stocktakeSelectedProductIds])

  const stocktakeReviewRows = useMemo(() => stocktakeRows.filter((row: any) => {
    const raw = stocktakeFacts[String(row.id)] ?? ''
    if (raw === '') return false
    const fact = Number(raw)
    return fact !== Number(row.baselineQuantity || 0) || fact - Number(row.reservedQuantity || 0) < 0 || row.status === 'recount_required'
  }), [stocktakeRows, stocktakeFacts])

  const currentStocktakeGroup = stocktakeGroups[stocktakeProductIndex] || null
  const stocktakeActiveForSelectedSource = stocktakeActiveSessions.find((entry: any) => entry.source === stocktakeSource) || null
  const cycleCountFilledCount = Object.values(cycleCountValues).filter((value) => value !== '').length
  const submitRoutineCycleCount = (row: any, countedQuantity: number) => runRoutineCycleCount({ row, countedQuantity, source: simpleStockSource, busy: cycleCountBusy, quickInventoryStocktake, refreshInventoryModule, refreshSuggestions: refreshCycleCountSuggestions, setBusy: setCycleCountBusy, setNotice: setCycleCountNotice, setData: setCycleCountData, setValues: setCycleCountValues })

  async function refreshCycleCountSuggestions(source: StocktakeSource = stocktakeSource, keepNotice = false, limit = 12) {
    const seq = ++cycleCountLoadSeq.current
    setCycleCountLoading(true)
    setCycleCountData((current: any) => current?.source === source ? current : null)
    if (!keepNotice) setCycleCountNotice('')
    try {
      const data = await loadInventoryCycleCounts(source, limit <= 5 ? 12 : limit)
      if (seq !== cycleCountLoadSeq.current) return
      setCycleCountData(limit <= 5 ? {
        ...data,
        items: (data.items || []).filter((row: any) => !(row.lastCheckedAt && row.daysSinceCheck === 0 && row.movementsSinceCheck === 0)).slice(0, limit),
      } : data)
    } catch (error) {
      if (seq !== cycleCountLoadSeq.current) return
      setCycleCountData(null)
      setCycleCountNotice(error instanceof Error ? error.message : 'Не удалось подобрать позиции для короткой сверки.')
    } finally {
      if (seq === cycleCountLoadSeq.current) setCycleCountLoading(false)
    }
  }

  async function submitCycleCount() {
    if (cycleCountBusy || cycleCountLoading || cycleCountData?.source !== stocktakeSource || !cycleCountData?.items?.length) return
    const selected = (cycleCountData.items || []).flatMap((row: any) => {
      const raw = cycleCountValues[String(row.variantId)] ?? ''
      if (raw === '') return []
      const counted = Number(raw)
      if (!Number.isInteger(counted) || counted < 0) return []
      return [{ variantId: Number(row.variantId), expectedQuantity: Number(row.physical || 0), countedQuantity: counted }]
    })
    if (!selected.length) { setCycleCountNotice('Введите факт хотя бы для одной реально пересчитанной позиции.'); return }
    setCycleCountBusy(true)
    setCycleCountNotice('')
    try {
      const result = await applyInventoryCycleCounts({ source: stocktakeSource, items: selected })
      if (!result?.ok) {
        setCycleCountNotice(result?.message || 'Сверку пока нельзя применить.')
        if (result?.code === 'changed') {
          setCycleCountValues({})
          await refreshInventoryModule(true)
          await refreshCycleCountSuggestions(stocktakeSource, true)
        }
        return
      }
      setCycleCountValues({})
      setCycleCountNotice(result.changedCount
        ? `Проверено ${selected.length}. Расхождений исправлено: ${result.changedCount}.`
        : `Проверено ${selected.length}. Остатки совпали.`)
      await refreshInventoryModule(true)
      await refreshCycleCountSuggestions(stocktakeSource, true)
    } catch (error) {
      setCycleCountNotice(error instanceof Error ? error.message : 'Не удалось сохранить короткую сверку.')
    } finally {
      setCycleCountBusy(false)
    }
  }

  useEffect(() => {
    if (inventoryPanel === 'overview' && cycleCountData && cycleCountData.source !== simpleStockSource) {
      setCycleCountData(null)
      setCycleCountValues({})
    }
    if (inventoryPanel !== 'stocktake' || !isAdmin || stocktakeSession) return
    setCycleCountValues({})
    void refreshCycleCountSuggestions(stocktakeSource)
  }, [inventoryPanel, activeSector, isAdmin, simpleStockSource, stocktakeSource, stocktakeSession?.id, cycleCountData?.source])

  useEffect(() => {
    if (!stocktakeSession || !currentStocktakeGroup || stocktakeFoundOtherProduct) return
    setStocktakeFoundProductId(Number(currentStocktakeGroup.productId || 0))
  }, [stocktakeSession?.id, currentStocktakeGroup?.key, stocktakeFoundOtherProduct])
  const currentStocktakePositions = useMemo(() => {
    if (!currentStocktakeGroup) return []
    const positions = new Map<string, any>()
    for (const row of currentStocktakeGroup.rows || []) {
      const key = stocktakePositionKey(row)
      const current = positions.get(key) || { key, label: stocktakePositionLabel(row), rows: [] }
      current.rows.push(row)
      positions.set(key, current)
    }
    return Array.from(positions.values())
  }, [currentStocktakeGroup])

  const stocktakeFoundExecutions = useMemo(() => {
    if (!stocktakeFoundProductId) return []
    const map = new Map<string, any>()
    for (const variant of catalogData?.variants || []) {
      if (!variant.isActive || Number(variant.productId || 0) !== stocktakeFoundProductId) continue
      const key = catalogExecutionKey(variant.material, variant.length)
      if (!map.has(key)) map.set(key, { key, material: variant.material || 'СТАНДАРТ', length: variant.length || 'СТАНДАРТ', label: catalogExecutionLabel(variant.material, variant.length) })
    }
    return Array.from(map.values()).sort((a: any, b: any) => a.label.localeCompare(b.label, 'ru', { numeric: true }))
  }, [catalogData, stocktakeFoundProductId])

  const stocktakeFoundVariants = useMemo(() => {
    if (!stocktakeFoundProductId || !stocktakeFoundExecutionKey) return []
    const used = new Set((stocktakeSession?.items || []).map((item: any) => Number(item.variantId || 0)).filter(Boolean))
    return (catalogData?.variants || [])
      .filter((variant: any) => variant.isActive
        && Number(variant.productId || 0) === stocktakeFoundProductId
        && catalogExecutionKey(variant.material, variant.length) === stocktakeFoundExecutionKey
        && !used.has(Number(variant.id || 0)))
      .slice()
      .sort((a: any, b: any) => catalogCombinationLabel(a).localeCompare(catalogCombinationLabel(b), 'ru', { numeric: true }))
  }, [catalogData, stocktakeFoundProductId, stocktakeFoundExecutionKey, stocktakeSession])

  const stocktakeFoundExecution = stocktakeFoundExecutions.find((entry: any) => entry.key === stocktakeFoundExecutionKey) || null

  useEffect(() => {
    if (!currentStocktakeGroup) return
    setStocktakeFoundOpen(false)
    setStocktakeInlineAdd(null)
    const sample = currentStocktakeGroup?.rows?.[0]
    if (!stocktakeFoundOtherProduct) setStocktakeFoundProductId(Number(currentStocktakeGroup.productId || 0))
    setStocktakeFoundExecutionKey('')
    setStocktakeFoundVariantId(0)
    setStocktakeFoundCreateMode(false)
    setStocktakeFoundDraft({
      material: '',
      length: '',
      category: sample?.category === 'child' ? 'child' : 'adult',
      gender: '',
      color: '',
      size: '',
    })
    setStocktakeFoundSizes([])
    setStocktakeFoundCustom({ material: '', length: '', color: '', size: '' })
    setStocktakeFoundNewFields({})
  }, [currentStocktakeGroup?.key])

  function stocktakeInlinePosition(positionKey: string) {
    return currentStocktakePositions.find((position: any) => String(position.key) === String(positionKey)) || null
  }

  function stocktakeInlineSizeOptions(position: any, color: string) {
    const sample = (position?.rows || [])[0]
    const source = sample?.category === 'child' ? (suggestionValues.childAges || []) : (suggestionValues.sizes || [])
    const used = new Set((position?.rows || [])
      .filter((row: any) => normalizeSuggestion(String(row.color || '')) === normalizeSuggestion(color))
      .map((row: any) => normalizeSuggestion(String(row.size || '')))
      .filter(Boolean))
    return source.filter((value: string) => !used.has(normalizeSuggestion(value)))
  }

  function stocktakeInlineColorOptions(position: any) {
    const used = new Set((position?.rows || []).map((row: any) => normalizeSuggestion(String(row.color || ''))))
    return (suggestionValues.colors || []).filter((value: string) => !used.has(normalizeSuggestion(value)))
  }

  function openStocktakeInlineSize(position: any, color: string) {
    setStocktakeNotice('')
    setStocktakeInlineAdd({ mode: 'size', positionKey: String(position.key), color: String(color || ''), sizes: [] })
  }

  function openStocktakeInlineColor(position: any) {
    setStocktakeNotice('')
    setStocktakeInlineAdd({ mode: 'color', positionKey: String(position.key), color: '', sizes: [] })
  }

  function toggleStocktakeInlineSize(value: string) {
    setStocktakeInlineAdd((current) => {
      if (!current) return current
      const selected = current.sizes.some((item) => normalizeSuggestion(item) === normalizeSuggestion(value))
      return { ...current, sizes: selected ? current.sizes.filter((item) => normalizeSuggestion(item) !== normalizeSuggestion(value)) : [...current.sizes, value] }
    })
  }

  function openStocktakeFoundForPosition(position: any, color = '') {
    const sample = (position?.rows || [])[0]
    if (!sample || !currentStocktakeGroup) return
    setStocktakeFoundOtherProduct(false)
    setStocktakeFoundProductId(Number(currentStocktakeGroup.productId || sample.productId || 0))
    setStocktakeFoundExecutionKey('')
    setStocktakeFoundVariantId(0)
    setStocktakeFoundCreateMode(false)
    setStocktakeFoundDraft({
      material: sample.material || 'СТАНДАРТ',
      length: sample.length || 'СТАНДАРТ',
      category: sample.category === 'child' ? 'child' : 'adult',
      gender: sample.gender || '',
      color: String(color || ''),
      size: '',
    })
    setStocktakeFoundSizes([])
    setStocktakeFoundCustom({ material: '', length: '', color: '', size: '' })
    setStocktakeFoundNewFields({})
    setStocktakeInlineAdd(null)
    setStocktakeFoundOpen(true)
  }

  async function submitStocktakeInlineAdd() {
    if (!stocktakeSession?.id || !currentStocktakeGroup || !stocktakeInlineAdd || stocktakeInlineAddBusy || stocktakeAddingVariantId) return
    if (!stocktakeReferenceReady) {
      setStocktakeNotice('Справочники характеристик ещё загружаются. Подождите несколько секунд и повторите.')
      void loadReferencesData()
      return
    }
    const position = stocktakeInlinePosition(stocktakeInlineAdd.positionKey)
    const sample = (position?.rows || [])[0]
    if (!position || !sample) {
      setStocktakeNotice('Исполнение товара изменилось. Откройте товар заново и повторите добавление.')
      setStocktakeInlineAdd(null)
      return
    }
    const color = String(stocktakeInlineAdd.color || '').trim()
    const sizes = Array.from(new Set(stocktakeInlineAdd.sizes.map((value) => String(value || '').trim()).filter(Boolean)))
    if (stocktakeInlineAdd.mode === 'color' && !color) {
      setStocktakeNotice('Выберите цвет из справочника.')
      return
    }
    if (!sizes.length) {
      setStocktakeNotice(sample.category === 'child' ? 'Выберите хотя бы один возраст.' : 'Выберите хотя бы один размер.')
      return
    }

    const keepProductId = Number(currentStocktakeGroup.productId || sample.productId || 0)
    const keepProductKey = currentStocktakeGroup.key
    setStocktakeInlineAddBusy(true)
    setStocktakeNotice('')
    try {
      const result = await addInventoryStocktakeCombination(stocktakeSession.id, {
        productId: keepProductId,
        material: sample.material || 'СТАНДАРТ',
        length: sample.length || 'СТАНДАРТ',
        category: sample.category === 'child' ? 'child' : 'adult',
        gender: sample.gender || '',
        color,
        sizes,
        createReferenceFields: [],
      })
      if (result?.session) {
        adoptStocktakeSession(result.session)
        const nextGroups = new Map<string, any>()
        for (const item of result.session.items || []) {
          const key = Number(item.productId || 0) > 0 ? `product:${item.productId}` : `name:${normalizeSuggestion(item.productName)}`
          if (!nextGroups.has(key)) nextGroups.set(key, item)
        }
        const groupIndex = Array.from(nextGroups.keys()).findIndex((key) => key === keepProductKey || key === `product:${keepProductId}`)
        if (groupIndex >= 0) setStocktakeProductIndex(groupIndex)
      }
      await loadCatalogData(true)
      const added = Number(result?.addedCount || 0)
      const existing = Number(result?.alreadyPresentCount || 0)
      setStocktakeInlineAdd(null)
      setStocktakeNotice(`${added ? `Добавлено в ревизию: ${added}. ` : ''}${existing ? `Уже были в ревизии: ${existing}. ` : ''}Введите фактическое количество рядом с новой позицией.`)
    } catch (error) {
      setStocktakeNotice(error instanceof Error ? error.message : 'Не удалось добавить позицию в ревизию.')
    } finally {
      setStocktakeInlineAddBusy(false)
    }
  }

  async function resumeStocktake(summary: any) {
    if (!summary?.id) return
    setStocktakeBusy(true)
    setStocktakeNotice('')
    try {
      const data = await loadInventoryStocktakeSession(summary.id)
      adoptStocktakeSession(data?.session)
    } catch (error) {
      setStocktakeNotice(error instanceof Error ? error.message : 'Не удалось открыть ревизию.')
    } finally {
      setStocktakeBusy(false)
    }
  }

  async function startStocktake() {
    if (!isAdmin || stocktakeBusy) return
    const existing = stocktakeActiveSessions.find((entry: any) => entry.source === stocktakeSource)
    if (existing) return void resumeStocktake(existing)
    if (stocktakeStartMode === 'selective' && !stocktakeSelectedProductIds.length) {
      setStocktakeNotice('Для выборочной ревизии отметьте хотя бы один товар.')
      return
    }
    if (stocktakeStartMode === 'full' && stocktakeSourceStats[stocktakeSource] > 150 && !window.confirm(`Полная ревизия содержит ${stocktakeSourceStats[stocktakeSource]} позиций. Её можно закрыть и продолжить позже. Начать?`)) return
    setStocktakeBusy(true)
    setStocktakeNotice('')
    try {
      const productIds = stocktakeStartMode === 'selective' ? stocktakeSelectedProductIds : []
      const data = await createInventoryStocktakeSession(stocktakeSource, productIds)
      adoptStocktakeSession(data?.session)
      setStocktakeSelectedProductIds([])
      setStocktakeStartSearch('')
      await refreshActiveStocktakes()
    } catch (error) {
      setStocktakeNotice(error instanceof Error ? error.message : 'Не удалось начать ревизию.')
    } finally {
      setStocktakeBusy(false)
    }
  }

  function stocktakePersistedRaw(itemId: number) {
    const remembered = stocktakeLastPersistedValues.current.get(itemId)
    if (remembered !== undefined) return remembered
    const item = (stocktakeSession?.items || []).find((row: any) => Number(row.id) === Number(itemId))
    return item?.countedQuantity === null || item?.countedQuantity === undefined ? '' : String(item.countedQuantity)
  }

  function stocktakeFactNeedsSave(itemId: number, rawValue: string) {
    const item = (stocktakeSession?.items || []).find((row: any) => Number(row.id) === Number(itemId))
    const recountTouched = item?.status === 'recount_required' && stocktakeTouchedIds.current.has(itemId)
    return stocktakePersistedRaw(itemId) !== rawValue || recountTouched
  }

  async function persistStocktakeFact(itemId: number, rawValue: string): Promise<boolean> {
    if (!stocktakeSession?.id) return false
    const pendingTimer = stocktakeSaveTimers.current.get(itemId)
    if (pendingTimer) {
      window.clearTimeout(pendingTimer)
      stocktakeSaveTimers.current.delete(itemId)
    }

    if (!stocktakeFactNeedsSave(itemId, rawValue)) return true
    stocktakePendingValues.current.set(itemId, rawValue)
    const existingRun = stocktakeSaveInFlight.current.get(itemId)
    if (existingRun) return await existingRun

    const sessionId = stocktakeSession.id
    const run = (async () => {
      let allSaved = true
      setStocktakeSavingIds((current) => current.includes(itemId) ? current : [...current, itemId])
      try {
        while (stocktakePendingValues.current.has(itemId)) {
          const value = stocktakePendingValues.current.get(itemId) ?? ''
          stocktakePendingValues.current.delete(itemId)
          if (!stocktakeFactNeedsSave(itemId, value)) continue
          try {
            const data = await saveInventoryStocktakeCount(sessionId, itemId, value === '' ? null : Number(value))
            if (data?.ok === false) throw new Error(data?.message || 'Система не подтвердила сохранение количества.')
            const persistedRaw = data?.item
              ? (data.item.countedQuantity === null || data.item.countedQuantity === undefined ? '' : String(data.item.countedQuantity))
              : value
            stocktakeLastPersistedValues.current.set(itemId, persistedRaw)
            stocktakeTouchedIds.current.delete(itemId)
            if (data?.item) {
              setStocktakeSession((current: any) => current ? {
                ...current,
                items: (current.items || []).map((item: any) => item.id === itemId ? { ...item, ...data.item } : item),
                updatedAt: new Date().toISOString(),
              } : current)
              if (data.item.countedQuantity === null || data.item.countedQuantity === undefined) {
                setStocktakeFacts((current) => ({ ...current, [String(itemId)]: '' }))
              }
            }
          } catch (error) {
            allSaved = false
            setStocktakeNotice(error instanceof Error ? error.message : 'Не удалось сохранить количество. Эта позиция осталась несохранённой.')
          }
        }
      } finally {
        setStocktakeSavingIds((current) => current.filter((id) => id !== itemId))
        stocktakeSaveInFlight.current.delete(itemId)
      }
      return allSaved
    })()
    stocktakeSaveInFlight.current.set(itemId, run)
    return await run
  }

  function setStocktakeFact(itemId: number, rawValue: string) {
    const cleaned = rawValue === '' ? '' : String(Math.max(0, Math.trunc(Number(rawValue || 0))))
    stocktakeTouchedIds.current.add(itemId)
    setStocktakeFacts((current) => ({ ...current, [String(itemId)]: cleaned }))
    const oldTimer = stocktakeSaveTimers.current.get(itemId)
    if (oldTimer) window.clearTimeout(oldTimer)
    if (!stocktakeFactNeedsSave(itemId, cleaned)) {
      stocktakeSaveTimers.current.delete(itemId)
      return
    }
    const timer = window.setTimeout(() => {
      stocktakeSaveTimers.current.delete(itemId)
      void persistStocktakeFact(itemId, cleaned)
    }, 550)
    stocktakeSaveTimers.current.set(itemId, timer)
  }

  function focusNextStocktakeCountInput(itemId: number) {
    window.requestAnimationFrame(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-stocktake-count-input="1"]'))
      const currentIndex = inputs.findIndex((input) => Number(input.dataset.stocktakeItemId || 0) === Number(itemId))
      if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
        inputs[currentIndex + 1].focus()
        inputs[currentIndex + 1].select()
      }
    })
  }

  async function markCurrentStocktakeProductRemainingZero() {
    if (!currentStocktakeGroup || stocktakeBusy) return
    const rows = (currentStocktakeGroup.rows || []).filter((row: any) => (stocktakeFacts[String(row.id)] ?? '') === '')
    if (!rows.length) {
      setStocktakeNotice('У этого товара уже заполнены все позиции.')
      return
    }
    if (!window.confirm(`Вы физически проверили весь товар «${currentStocktakeGroup.productName}»? Для ${rows.length} непосчитанных позиций будет записан 0.`)) return
    setStocktakeBusy(true)
    for (const row of rows) stocktakeTouchedIds.current.add(Number(row.id))
    setStocktakeFacts((current) => ({ ...current, ...Object.fromEntries(rows.map((row: any) => [String(row.id), '0'])) }))
    try {
      let saved = 0
      const failedIds: number[] = []
      for (const row of rows) {
        if (await persistStocktakeFact(Number(row.id), '0')) saved += 1
        else failedIds.push(Number(row.id))
      }
      if (failedIds.length) {
        for (const id of failedIds) stocktakeTouchedIds.current.delete(id)
        setStocktakeFacts((current) => ({ ...current, ...Object.fromEntries(failedIds.map((id) => [String(id), ''])) }))
        setStocktakeNotice(`Сохранено ${saved} из ${rows.length}. Не удалось сохранить ${failedIds.length} — эти поля снова оставлены пустыми. Нажмите «Остальные = 0» ещё раз.`)
      } else {
        setStocktakeNotice(`Для ${rows.length} позиций товара «${currentStocktakeGroup.productName}» сохранён факт 0.`)
      }
    } finally {
      setStocktakeBusy(false)
    }
  }

  async function flushStocktakeFacts() {
    if (!stocktakeSession) return true
    for (const [itemId, timer] of stocktakeSaveTimers.current.entries()) {
      window.clearTimeout(timer)
      stocktakeSaveTimers.current.delete(itemId)
    }
    const dirty = (stocktakeSession.items || []).filter((item: any) => {
      const raw = stocktakeFacts[String(item.id)] ?? ''
      return stocktakeFactNeedsSave(Number(item.id), raw)
    })
    let allSaved = true
    for (const item of dirty) {
      if (!await persistStocktakeFact(Number(item.id), stocktakeFacts[String(item.id)] ?? '')) allSaved = false
    }
    if (!allSaved) setStocktakeNotice('Не все изменения сохранились. Исправьте несохранённые поля и повторите проверку.')
    return allSaved
  }

  async function discardStocktake() {
    if (!stocktakeSession?.id || stocktakeBusy) return
    if (!window.confirm('Отменить текущую ревизию? Уже введённые числа останутся только в истории отменённой сессии и не изменят остатки.')) return
    setStocktakeBusy(true)
    try {
      await cancelInventoryStocktakeSession(stocktakeSession.id)
      setStocktakeSession(null)
      setStocktakeFacts({})
      setStocktakeReviewMode(false)
      setStocktakeNotice('Ревизия отменена. Остатки не изменялись.')
      await refreshActiveStocktakes()
    } catch (error) {
      setStocktakeNotice(error instanceof Error ? error.message : 'Не удалось отменить ревизию.')
    } finally {
      setStocktakeBusy(false)
    }
  }

  function jumpToStocktakeProduct() {
    if (!stocktakeSession) return
    const normalized = normalizeSuggestion(stocktakeProductSearch)
    if (!normalized) return
    const index = stocktakeGroups.findIndex((group: any) => normalizeSuggestion(group.productName).includes(normalized))
    if (index < 0) {
      setStocktakeNotice('Товар в текущей ревизии не найден. Если он физически есть, добавьте его через блок «Нашли ещё товар».')
      return
    }
    setStocktakeProductIndex(index)
    setStocktakeReviewMode(false)
    setStocktakeNotice('')
  }

  function goToNextUnfilledStocktakeProduct() {
    if (!stocktakeSession) return
    const start = Math.max(0, stocktakeProductIndex + 1)
    const ordered = [...stocktakeGroups.slice(start), ...stocktakeGroups.slice(0, start)]
    const target = ordered.find((group: any) => (group.rows || []).some((row: any) => (stocktakeFacts[String(row.id)] ?? '') === '' || row.status === 'recount_required'))
    if (!target) {
      setStocktakeNotice('Все позиции заполнены. Можно перейти к проверке.')
      return
    }
    const index = stocktakeGroups.findIndex((group: any) => group.key === target.key)
    if (index >= 0) setStocktakeProductIndex(index)
  }

  async function openStocktakeReview() {
    if (!stocktakeSession?.id) return
    if (!await flushStocktakeFacts()) return
    try {
      const latestData = await loadInventoryStocktakeSession(stocktakeSession.id)
      const latest = latestData?.session
      if (!latest) throw new Error('Не удалось перечитать ревизию.')
      adoptStocktakeSession(latest)
      const unfilled = (latest.items || []).filter((item: any) => item.countedQuantity === null || item.countedQuantity === undefined).length
      const recount = (latest.items || []).filter((item: any) => item.status === 'recount_required').length
      if (unfilled > 0) {
        setStocktakeNotice(`Сначала пересчитайте ещё ${unfilled} позиций. Если товара нет — укажите 0.`)
        return
      }
      if (recount > 0) {
        setStocktakeNotice(`После изменений склада нужно повторно пересчитать ${recount} позиций.`)
        return
      }
      setStocktakeNotice('')
      setStocktakeReviewMode(true)
    } catch (error) {
      setStocktakeNotice(error instanceof Error ? error.message : 'Не удалось подготовить финальную проверку.')
    }
  }

  async function applyStocktake() {
    if (!stocktakeSession?.id || stocktakeBusy) return
    if (!await flushStocktakeFacts()) return
    setStocktakeBusy(true)
    try {
      const result = await completeInventoryStocktakeSession(stocktakeSession.id)
      if (!result?.ok) {
        if (result?.session) adoptStocktakeSession(result.session)
        setStocktakeNotice(result?.message || 'Ревизию пока нельзя завершить.')
        return
      }
      setStocktakeNotice(result.message || 'Ревизия завершена.')
      setStocktakeSession(null)
      setStocktakeFacts({})
      setStocktakeReviewMode(false)
      await Promise.all([refreshInventoryModule(true), refreshActiveStocktakes()])
    } catch (error) {
      setStocktakeNotice(error instanceof Error ? error.message : 'Не удалось завершить ревизию.')
    } finally {
      setStocktakeBusy(false)
    }
  }

  async function addStocktakeCatalogVariant(variantId: number) {
    if (!stocktakeSession?.id || !variantId || stocktakeAddingVariantId) return
    setStocktakeAddingVariantId(variantId)
    try {
      const keepProductIndex = stocktakeProductIndex
      const result = await addInventoryStocktakeVariant(stocktakeSession.id, variantId)
      if (result?.session) { adoptStocktakeSession(result.session); setStocktakeProductIndex(keepProductIndex) }
      setStocktakeFoundVariantId(0)
      setStocktakeFoundCreateMode(false)
      setStocktakeNotice(result?.alreadyPresent ? 'Эта комбинация уже есть в ревизии.' : 'Комбинация добавлена в ревизию. Теперь укажите фактическое количество.')
    } catch (error) {
      setStocktakeNotice(error instanceof Error ? error.message : 'Не удалось добавить комбинацию в ревизию.')
    } finally {
      setStocktakeAddingVariantId(0)
    }
  }

  async function addStocktakeNewCombination() {
    if (!stocktakeSession?.id || !stocktakeFoundProductId || stocktakeAddingVariantId) return
    if (!stocktakeReferenceReady) {
      setStocktakeNotice('Справочники характеристик ещё загружаются. Подождите несколько секунд и повторите.')
      void loadReferencesData()
      return
    }

    const optionsFor = (field: 'material' | 'length' | 'color' | 'size') => {
      if (field === 'material') return ['СТАНДАРТ', ...(suggestionValues.materials || []).filter((value: string) => normalizeSuggestion(value) !== 'СТАНДАРТ')]
      if (field === 'length') return ['СТАНДАРТ', ...(suggestionValues.lengths || []).filter((value: string) => normalizeSuggestion(value) !== 'СТАНДАРТ')]
      if (field === 'color') return suggestionValues.colors || []
      return stocktakeFoundDraft.category === 'child' ? (suggestionValues.childAges || []) : (suggestionValues.sizes || [])
    }
    const resolveSingleField = (field: 'material' | 'length' | 'color') => {
      if (!stocktakeFoundNewFields[field]) return { value: String((stocktakeFoundDraft as any)[field] || '').trim(), create: false }
      const typed = String((stocktakeFoundCustom as any)[field] || '').trim()
      const existing = optionsFor(field).find((value: string) => normalizeSuggestion(value) === normalizeSuggestion(typed))
      if (existing) return { value: existing, create: false }
      return { value: typed, create: Boolean(typed) }
    }

    const materialFact = resolveSingleField('material')
    const lengthFact = resolveSingleField('length')
    const colorFact = resolveSingleField('color')
    const material = materialFact.value || 'СТАНДАРТ'
    const length = lengthFact.value || 'СТАНДАРТ'
    const color = colorFact.value

    const selectedSizes = [...stocktakeFoundSizes]
    let createSize = false
    if (stocktakeFoundNewFields.size) {
      const typed = String(stocktakeFoundCustom.size || '').trim()
      if (typed) {
        const existing = optionsFor('size').find((value: string) => normalizeSuggestion(value) === normalizeSuggestion(typed))
        const resolved = existing || typed
        if (!selectedSizes.some((value) => normalizeSuggestion(value) === normalizeSuggestion(resolved))) selectedSizes.push(resolved)
        createSize = !existing
      }
    }
    const sizes = Array.from(new Set(selectedSizes.map((value) => String(value || '').trim()).filter(Boolean)))
    if (!stocktakeFoundDraft.gender || !color || !sizes.length) {
      setStocktakeNotice('Выберите пол, цвет и хотя бы один размер / возраст. Если значения нет в справочнике, используйте «Нет в списке».')
      return
    }
    const createReferenceFields = ([
      ['material', materialFact.create], ['length', lengthFact.create], ['color', colorFact.create], ['size', createSize],
    ] as const).filter(([, create]) => create).map(([field]) => field)
    if (createReferenceFields.length) {
      const newValues = [
        materialFact.create ? `материал «${material}»` : '',
        lengthFact.create ? `длину «${length}»` : '',
        colorFact.create ? `цвет «${color}»` : '',
        createSize ? `${stocktakeFoundDraft.category === 'child' ? 'возраст' : 'размер'} «${String(stocktakeFoundCustom.size || '').trim()}»` : '',
      ].filter(Boolean).join(', ')
      if (!window.confirm(`Добавить в канонические справочники: ${newValues}? Эти значения станут доступны во всей системе.`)) return
    }

    setStocktakeAddingVariantId(-1)
    try {
      const keepProductId = stocktakeFoundProductId
      const result = await addInventoryStocktakeCombination(stocktakeSession.id, {
        productId: keepProductId,
        material,
        length,
        category: stocktakeFoundDraft.category as 'adult' | 'child',
        gender: stocktakeFoundDraft.gender,
        color,
        sizes,
        createReferenceFields,
      })
      if (result?.session) {
        adoptStocktakeSession(result.session)
        const newIndex = (result.session.items || []).findIndex((item: any) => Number(item.productId || 0) === Number(keepProductId))
        if (newIndex >= 0) {
          const key = `product:${keepProductId}`
          const groupIndex = Array.from(new Map((result.session.items || []).map((item: any) => [Number(item.productId || 0) > 0 ? `product:${item.productId}` : `name:${normalizeSuggestion(item.productName)}`, item])).keys()).findIndex((entry) => entry === key)
          if (groupIndex >= 0) setStocktakeProductIndex(groupIndex)
        }
      }
      await Promise.all([loadCatalogData(true), createReferenceFields.length ? loadReferencesData(true) : Promise.resolve(null)])
      setStocktakeFoundDraft({ material: '', length: '', category: stocktakeFoundDraft.category, gender: '', color: '', size: '' })
      setStocktakeFoundSizes([])
      setStocktakeFoundCustom({ material: '', length: '', color: '', size: '' })
      setStocktakeFoundNewFields({})
      const added = Number(result?.addedCount || 0)
      const existing = Number(result?.alreadyPresentCount || 0)
      setStocktakeNotice(`${added ? `Добавлено в ревизию: ${added}. ` : ''}${existing ? `Уже были в ревизии: ${existing}. ` : ''}Теперь укажите фактическое количество по найденным размерам.`)
      setStocktakeFoundOpen(false)
    } catch (error) {
      setStocktakeNotice(error instanceof Error ? error.message : 'Не удалось добавить позиции в ревизию.')
    } finally {
      setStocktakeAddingVariantId(0)
    }
  }

  async function openStocktakeOrders(row: any) {
    if (!stocktakeSession || Number(row.reservedQuantity || 0) <= 0) return
    const source = stocktakeSession.source as StocktakeSource
    const physical = Number(stocktakeFacts[String(row.id)] !== '' && stocktakeFacts[String(row.id)] !== undefined ? stocktakeFacts[String(row.id)] : row.currentQuantity || 0)
    const reserved = Number(row.reservedQuantity || 0)
    const stockRow = {
      productId: row.productId,
      variantId: row.variantId,
      productName: row.productName,
      category: row.category,
      gender: row.gender,
      color: row.color,
      material: row.material,
      length: row.length,
      size: row.size,
      warehouseQuantity: source === 'warehouse' ? physical : 0,
      warehouseReserved: source === 'warehouse' ? reserved : 0,
      warehouseAvailable: source === 'warehouse' ? physical - reserved : 0,
      boutiqueQuantity: source === 'boutique' ? physical : 0,
      boutiqueReserved: source === 'boutique' ? reserved : 0,
      boutiqueAvailable: source === 'boutique' ? physical - reserved : 0,
    }
    await openSimpleStockRowsDetail([stockRow], { source, label: [row.color, row.size].filter(Boolean).join(' · ') })
  }

  const simpleStockPhysical = (row: any) => simpleStockSource === 'warehouse'
    ? Number(row.warehouseQuantity || 0)
    : Number(row.boutiqueQuantity || 0)
  const simpleStockReserved = (row: any) => simpleStockSource === 'warehouse'
    ? Number(row.warehouseReserved || 0)
    : Number(row.boutiqueReserved || 0)
  const simpleStockQuantity = (row: any) => simpleStockSource === 'warehouse'
    ? Number(row.warehouseAvailable ?? (Number(row.warehouseQuantity || 0) - Number(row.warehouseReserved || 0)))
    : Number(row.boutiqueAvailable ?? (Number(row.boutiqueQuantity || 0) - Number(row.boutiqueReserved || 0)))

  const simpleStockGroups = useMemo(() => {
    const result: any[] = []
    for (const product of inventoryStocktakeGroups || []) {
      const productRows = product.rows || []
      const allRows = simpleStockCategory === 'all'
        ? productRows
        : productRows.filter((row: any) => (row.category || 'adult') === simpleStockCategory)
      const visibleRows = allRows.filter((row: any) => {
        const free = simpleStockQuantity(row)
        const reserved = simpleStockReserved(row)
        const physical = simpleStockPhysical(row)
        if (simpleStockAvailabilityFilter === 'all') {
          if (inventoryQuery.trim()) return true
          return physical !== 0 || reserved !== 0
        }
        if (simpleStockAvailabilityFilter === 'free') return free > 0
        if (simpleStockAvailabilityFilter === 'reserved') return reserved > 0
        return free < 0 || physical < 0
      })
      if (!visibleRows.length) continue
      result.push({ ...product, rows: visibleRows })
    }
    return result
  }, [inventoryStocktakeGroups, simpleStockSource, simpleStockAvailabilityFilter, simpleStockCategory, inventoryQuery])

  const simpleStockStats = useMemo(() => {
    const allRows = (inventoryStocktakeGroups || []).flatMap((group: any) => group.rows || [])
    const rows = simpleStockCategory === 'all'
      ? allRows
      : allRows.filter((row: any) => (row.category || 'adult') === simpleStockCategory)
    const availableFor = (row: any, source: 'warehouse' | 'boutique') => source === 'warehouse'
      ? Number(row.warehouseAvailable ?? (Number(row.warehouseQuantity || 0) - Number(row.warehouseReserved || 0)))
      : Number(row.boutiqueAvailable ?? (Number(row.boutiqueQuantity || 0) - Number(row.boutiqueReserved || 0)))
    const currentQuantity = (row: any) => availableFor(row, simpleStockSource)
    return {
      warehouse: rows.reduce((sum: number, row: any) => sum + availableFor(row, 'warehouse'), 0),
      warehousePhysical: rows.reduce((sum: number, row: any) => sum + Number(row.warehouseQuantity || 0), 0),
      warehouseReserved: rows.reduce((sum: number, row: any) => sum + Number(row.warehouseReserved || 0), 0),
      boutique: rows.reduce((sum: number, row: any) => sum + availableFor(row, 'boutique'), 0),
      boutiquePhysical: rows.reduce((sum: number, row: any) => sum + Number(row.boutiqueQuantity || 0), 0),
      boutiqueReserved: rows.reduce((sum: number, row: any) => sum + Number(row.boutiqueReserved || 0), 0),
      negativeWarehouse: rows.filter((row: any) => availableFor(row, 'warehouse') < 0).length,
      negativeBoutique: rows.filter((row: any) => availableFor(row, 'boutique') < 0).length,
      variants: rows.length,
      hiddenZero: rows.filter((row: any) => currentQuantity(row) === 0).length,
      freeVariants: rows.filter((row: any) => currentQuantity(row) > 0).length,
      reservedVariants: rows.filter((row: any) => simpleStockReserved(row) > 0).length,
      attentionVariants: rows.filter((row: any) => currentQuantity(row) < 0 || simpleStockPhysical(row) < 0).length,
      adultVariants: allRows.filter((row: any) => (row.category || 'adult') === 'adult').length,
      childVariants: allRows.filter((row: any) => (row.category || 'adult') === 'child').length,
    }
  }, [inventoryStocktakeGroups, simpleStockCategory, simpleStockSource])



  async function openSimpleStockRowsDetail(rows: any[], options: { aggregate?: boolean; label?: string; source?: 'warehouse' | 'boutique' } = {}) {
    if (!rows?.length) return
    const detailSource = options.source || simpleStockSource
    const physical = rows.reduce((sum, row) => sum + (detailSource === 'warehouse' ? Number(row.warehouseQuantity || 0) : Number(row.boutiqueQuantity || 0)), 0)
    const reserved = rows.reduce((sum, row) => sum + (detailSource === 'warehouse' ? Number(row.warehouseReserved || 0) : Number(row.boutiqueReserved || 0)), 0)
    const free = rows.reduce((sum, row) => sum + (detailSource === 'warehouse' ? Number(row.warehouseAvailable ?? (Number(row.warehouseQuantity || 0) - Number(row.warehouseReserved || 0))) : Number(row.boutiqueAvailable ?? (Number(row.boutiqueQuantity || 0) - Number(row.boutiqueReserved || 0)))), 0)
    const row = rows[0]
    const variantIds = Array.from(new Set(rows.map((entry) => Number(entry.variantId || 0)).filter(Boolean)))
    const aggregate = Boolean(options.aggregate || variantIds.length !== 1)
    const detail = {
      source: detailSource,
      productId: Number(row.productId || 0),
      variantId: aggregate ? 0 : Number(variantIds[0] || 0),
      productName: row.productName,
      category: row.category,
      gender: aggregate ? '' : row.gender,
      material: aggregate ? '' : row.material,
      length: aggregate ? '' : row.length,
      size: aggregate ? '' : row.size,
      color: aggregate ? '' : row.color,
      physical,
      reserved,
      free,
      aggregate,
      label: options.label || '',
      hasDataIssue: rows.length > 1 && !aggregate,
    }
    setSimpleStockDetail(detail)
    setQuickStocktakeOpen(false)
    setQuickStocktakeValues({})
    setQuickStocktakeNotice('')
    setSimpleStockReservations([])
    if (reserved <= 0 || (!detail.variantId && !detail.productId)) return
    setSimpleStockReservationsBusy(true)
    try {
      const data = await loadInventoryReservations(detailSource, detail.variantId, aggregate ? detail.productId : 0)
      setSimpleStockReservations(Array.isArray(data?.reservations) ? data.reservations : [])
    } catch {
      setSimpleStockReservations([])
    } finally {
      setSimpleStockReservationsBusy(false)
    }
  }

  const formatHistoryMoment = (value: unknown) => {
    const text = String(value || '').trim()
    if (!text) return '—'
    const date = new Date(text)
    if (Number.isNaN(date.getTime())) return text
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
  }

  const historyCheckLabel = (row: any) => {
    if (row.checkType === 'full_stocktake') return 'Полная ревизия'
    if (row.checkType === 'selective_stocktake') return 'Выборочная ревизия'
    if (row.checkType === 'cycle_count') return 'Плановая сверка'
    if (row.checkType === 'order_observation') return 'Сверка при заказе'
    if (row.checkType === 'exchange_observation') return 'Сверка при обмене'
    if (row.checkType === 'transfer_observation') return 'Сверка при перемещении'
    return 'Короткая сверка'
  }

  async function loadHistoryMovements(reset = true) {
    if (!isAdmin || historyBusy) return
    setHistoryBusy(true)
    setHistoryError('')
    try {
      const data = await loadInventoryHistory({
        source: historyVariantFilter?.source || '',
        variantId: Number(historyVariantFilter?.variantId || 0),
        q: historyQuery,
        beforeId: reset ? 0 : Number(historyNextBeforeId || 0),
        limit: 50,
      })
      const rows = Array.isArray(data?.movements) ? data.movements : []
      setHistoryRows((current) => reset ? rows : [...current, ...rows])
      setHistoryHasMore(Boolean(data?.hasMore))
      setHistoryNextBeforeId(Number(data?.nextBeforeId || 0) || null)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Не удалось загрузить историю склада.')
    } finally {
      setHistoryBusy(false)
    }
  }

  async function loadHistoryChecks() {
    if (!isAdmin || historyBusy) return
    setHistoryBusy(true)
    setHistoryError('')
    setHistoryStocktakeDetail(null)
    try {
      const data = await loadInventoryCheckHistory({ source: historyVariantFilter?.source || '', variantId: Number(historyVariantFilter?.variantId || 0), limit: 40 })
      setHistoryCheckRows(Array.isArray(data?.rows) ? data.rows : [])
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Не удалось загрузить ревизии и сверки.')
    } finally {
      setHistoryBusy(false)
    }
  }

  async function openHistoryStocktake(sessionId: string) {
    if (!sessionId || historyStocktakeDetailBusy) return
    if (historyStocktakeDetail?.id === sessionId) { setHistoryStocktakeDetail(null); return }
    setHistoryStocktakeDetailBusy(true)
    setHistoryError('')
    try {
      const data = await loadInventoryStocktakeSession(sessionId)
      setHistoryStocktakeDetail(data?.session || null)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Не удалось открыть детали ревизии.')
    } finally {
      setHistoryStocktakeDetailBusy(false)
    }
  }

  const historyDisplayRows = useMemo(() => {
    const result: any[] = []
    const seenTransfers = new Set<string>()
    for (const row of historyRows) {
      const transfer = ['transfer_in', 'transfer_out'].includes(String(row.referenceType || '')) && row.referenceId
      if (!transfer) { result.push({ kind: 'movement', row }); continue }
      const key = String(row.referenceId)
      if (seenTransfers.has(key)) continue
      seenTransfers.add(key)
      const rows = historyRows.filter((candidate: any) => String(candidate.referenceId || '') === key && ['transfer_in', 'transfer_out'].includes(String(candidate.referenceType || '')))
      const outgoing = rows.filter((candidate: any) => candidate.referenceType === 'transfer_out')
      result.push({ kind: 'transfer', row, rows, variantCount: new Set(outgoing.map((candidate: any) => candidate.variantId)).size, totalQuantity: outgoing.reduce((sum: number, candidate: any) => sum + Math.abs(Number(candidate.quantityDelta || 0)), 0) })
    }
    return result
  }, [historyRows])

  useEffect(() => {
    if (!isAdmin || inventoryPanel !== 'history') return
    if (historyMode === 'movements') void loadHistoryMovements(true)
    else void loadHistoryChecks()
  }, [inventoryPanel, historyMode, historyVariantFilter?.variantId, historyVariantFilter?.source])

  function openSimpleStockHistory(detail: InventoryHistoryFilter) {
    setHistoryVariantFilter(detail)
    setHistoryMode('movements')
    setHistoryQuery('')
    setSimpleStockDetail(null)
    openInventoryPanel('history')
  }

  const {
    applyQuickStocktake,
    attentionCategory,
    attentionError,
    attentionIntakeBusyId,
    attentionLoading,
    openAttentionCatalog,
    openAttentionHandover,
    openAttentionIntake,
    openAttentionLifecycle,
    openAttentionShortage,
    openAttentionStocktake,
    refreshWarehouseAttention,
    setAttentionCategory,
  } = useInventoryAttentionActions({
    activeSector,
    inventoryPanel,
    simpleStockDetail,
    quickStocktakeBusy,
    quickStocktakeValues,
    setQuickStocktakeBusy,
    setQuickStocktakeValues,
    setQuickStocktakeNotice,
    setQuickStocktakeOpen,
    setSimpleStockDetail,
    setSimpleStockSource,
    setSimpleStockReservations,
    setSimpleStockReservationsBusy,
    setCatalogAdminMode,
    setCatalogReviewTaskIndex,
    setInventoryLifecycleTaskIndex,
    setStocktakeSource,
    loadWarehouseAttention,
    loadInventoryLifecycle,
    loadCatalogReview,
    reconcileKnownInventoryLifecycle,
    quickInventoryStocktake,
    loadInventoryData,
    loadInventoryReservations,
    openInventoryPanel,
    openOrderStockHandoverById,
  })


  useEffect(() => {
    if (activeSector !== 'inventory' || inventoryPanel !== 'movement' || inventoryDraft.movementType === 'arrival') return

    const requestId = ++movementSourceRequestRef.current
    const sources = inventoryDraft.movementType === 'transfer'
      ? Array.from(new Set([inventoryDraft.source, inventoryDraft.targetSource]))
      : [inventoryDraft.source]

    setMovementSourceLoading(true)
    setMovementSourceLoadError('')
    void Promise.all(sources.map((source: 'warehouse' | 'boutique') => loadInventoryData(source, true, '', false)))
      .then((results: any[]) => {
        if (requestId !== movementSourceRequestRef.current) return
        if (results.some((result) => !result?.ok)) {
          setMovementSourceLoadError(`Не удалось обновить товары точки «${sourceLabel(inventoryDraft.source)}».`)
        }
      })
      .catch((error: unknown) => {
        if (requestId !== movementSourceRequestRef.current) return
        setMovementSourceLoadError(error instanceof Error ? error.message : `Не удалось обновить товары точки «${sourceLabel(inventoryDraft.source)}».`)
      })
      .finally(() => {
        if (requestId === movementSourceRequestRef.current) setMovementSourceLoading(false)
      })
  }, [activeSector, inventoryPanel, inventoryDraft.source, inventoryDraft.targetSource, inventoryDraft.movementType, movementSourceRefreshToken])

  const operationVisibleRows = useMemo(() => {
    const rows = [...(selectedInventoryOperationGroup?.rows || [])]
    const tokens = String(inventoryExistingVariantSearch || '').trim().toLocaleUpperCase('ru-RU').split(/\s+/).filter(Boolean)
    return rows
      .filter((row: any) => {
        if (!tokens.length) return true
        const haystack = [
          productCategoryLabel(getInventoryRowCategory(row)),
          row.gender,
          row.color,
          row.material,
          row.length,
          row.size,
          String(row.quantity ?? ''),
        ].filter(Boolean).join(' ').toLocaleUpperCase('ru-RU')
        return tokens.every((token: string) => haystack.includes(token))
      })
      .sort((a: any, b: any) => {
        const left = [a.material, a.length, a.color, a.size, a.gender].filter(Boolean).join(' ')
        const right = [b.material, b.length, b.color, b.size, b.gender].filter(Boolean).join(' ')
        return left.localeCompare(right, 'ru', { numeric: true })
      })
  }, [selectedInventoryOperationGroup, inventoryExistingVariantSearch])

  const selectedOperationDraftItems = useMemo(() => {
    const rowsByVariant = new Map<string, any>()
    for (const group of inventoryOperationAllProductGroups || []) {
      for (const row of group.rows || []) rowsByVariant.set(String(row.variantId || ''), row)
    }
    return inventoryDraft.items
      .filter((item: any) => item.variantId && (inventoryDraft.movementType === 'manual_set' ? item.touched : Number(item.quantity || 0) > 0))
      .map((item: any) => ({ item, row: rowsByVariant.get(String(item.variantId || '')) || null }))
  }, [inventoryDraft.items, inventoryDraft.movementType, inventoryOperationAllProductGroups])

  const operationDraftItem = (variantId: string | number) => inventoryDraft.items.find(
    (item: any) => String(item.variantId || '') === String(variantId || ''),
  )

  const inventoryOperationRowPrimary = (row: any) => {
    const main = [row.color, row.size].filter(Boolean).join(' · ')
    return main || 'Без цвета / размера'
  }

  const inventoryOperationRowSecondary = (row: any) => [
    row.material && row.material !== 'СТАНДАРТ' ? row.material : '',
    row.length && row.length !== 'СТАНДАРТ' ? row.length : '',
    productCategoryLabel(getInventoryRowCategory(row)),
    row.gender,
  ].filter(Boolean).join(' · ') || 'Стандартный вариант'

  const setInventoryCorrectionValue = (row: any, rawValue: string) => {
    const variantId = String(row.variantId || '')
    if (!variantId) return
    setInventoryDraft((current: any) => {
      const rest = current.items.filter((item: any) => String(item.variantId || '') !== variantId && (item.variantId || item.productName))
      if (rawValue === '') return { ...current, items: rest.length ? rest : [createEmptyInventoryItem()] }
      const parsed = Math.max(0, Math.trunc(Number(rawValue || 0)))
      const nextItem = {
        productId: row.productId ? String(row.productId) : '',
        variantId,
        productName: row.productName || '',
        category: getInventoryRowCategory(row),
        gender: row.gender || '',
        color: row.color || '',
        material: row.material || '',
        length: row.length || '',
        size: row.size || '',
        quantity: parsed,
        touched: true,
        expectedQuantity: Number(row.quantity || 0),
      }
      return { ...current, items: [...rest, nextItem] }
    })
  }

  const changeInventoryOperationSource = (nextSource: 'warehouse' | 'boutique') => {
    resetInventoryOperationSelection()
    setInventoryDraft((current: any) => ({
      ...current,
      source: nextSource,
      targetSource: current.targetSource === nextSource ? (nextSource === 'warehouse' ? 'boutique' : 'warehouse') : current.targetSource,
      items: [createEmptyInventoryItem()],
    }))
  }

  const swapInventoryTransferDirection = () => {
    resetInventoryOperationSelection()
    setInventoryDraft((current: any) => ({
      ...current,
      source: current.targetSource,
      targetSource: current.source,
      items: [createEmptyInventoryItem()],
    }))
  }

  const selectInventoryOperationMode = (mode: any) => {
    resetInventoryOperationSelection()
    setInventoryDraft((current: any) => ({
      ...current,
      movementType: mode,
      targetSource: mode === 'transfer' && current.targetSource === current.source
        ? (current.source === 'warehouse' ? 'boutique' : 'warehouse')
        : current.targetSource,
      items: [createEmptyInventoryItem()],
      comment: '',
    }))
    setInventoryMatrix(createEmptyInventoryMatrixDraft())
    setInventoryMatrixColorToAdd('')
    setInventoryMatrixSizeToAdd('')
  }

  const inventoryMovementHumanLabel = (movement: any) => {
    if (movement.referenceType === 'transfer_out') return 'Перемещение из точки'
    if (movement.referenceType === 'transfer_in') return 'Перемещение в точку'
    if (movement.movementType === 'arrival') return 'Приход'
    if (movement.movementType === 'writeoff') return 'Списание'
    if (movement.movementType === 'manual_set') return 'Корректировка'
    if (movement.movementType === 'sale') return 'Продажа'
    if (movement.movementType === 'return') return 'Возврат'
    if (movement.movementType === 'revision') return 'Восстановление / корректировка'
    if (movement.movementType === 'delete') return 'Удаление / списание'
    return 'Движение'
  }

  const renderInventoryReferenceManager = (groups: any[], title: string, description: string) => (
    <div className="inventory-reference-manager" data-step186-reference-manager={referenceKind}>
      <div className="inventory-reference-manager-head">
        <div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
        <span className="soft-badge">{selectedReferenceKindConfig?.label || 'Справочник'}</span>
      </div>

      <div className="reference-kind-grid inventory-reference-kind-grid">
        {groups.map((group: any) => (
          <button
            key={group.kind}
            type="button"
            className={`reference-kind-card ${referenceKind === group.kind ? 'is-active' : ''}`}
            onClick={() => selectReferenceKind(group.kind)}
          >
            <span className="reference-kind-card-top"><strong>{group.label}</strong><span>{group.count}</span></span>
            <small>{group.help}</small>
          </button>
        ))}
      </div>

      <div className="references-toolbar inventory-reference-toolbar">
        <label className="inventory-search">
          <span>Поиск</span>
          <div className="references-search-shell">
            <input value={referenceSearch} onChange={(event) => setReferenceSearch(event.target.value)} placeholder="Поиск по значению" />
            {referenceSearch ? <button className="secondary compact reference-clear-btn" type="button" onClick={() => setReferenceSearch('')}>Очистить</button> : null}
          </div>
        </label>
        <div className="reference-status-filters">
          <button type="button" className={`secondary compact ${referenceStatusFilter === 'all' ? 'is-active' : ''}`} onClick={() => setReferenceStatusFilter('all')}>Все</button>
          <button type="button" className={`secondary compact ${referenceStatusFilter === 'active' ? 'is-active' : ''}`} onClick={() => setReferenceStatusFilter('active')}>Активные</button>
          <button type="button" className={`secondary compact ${referenceStatusFilter === 'inactive' ? 'is-active' : ''}`} onClick={() => setReferenceStatusFilter('inactive')}>Отключённые</button>
        </div>
        <button className="secondary compact" type="button" onClick={() => void loadReferenceItems(referenceKind, true)}>{referenceBusy ? 'Загружаю...' : 'Обновить'}</button>
      </div>

      <div className="references-layout inventory-reference-layout">
        <section className="mini-panel reference-list-panel">
          <div className="mini-panel-head">
            <div>
              <h3>{selectedReferenceKindConfig?.label}</h3>
              <p className="mini-panel-note">Значения сразу используются в связанных рабочих формах системы.</p>
            </div>
            <button className="secondary compact" type="button" onClick={() => resetReferenceDraft()}>Новый элемент</button>
          </div>
          <div className="reference-list">
            {referenceBusy && !referenceItems.length ? (
              <div className="empty-state">Загружаю значения...</div>
            ) : filteredReferenceItems.length ? filteredReferenceItems.map((item: any) => (
              <div
                key={item.id}
                className={`reference-row ${item.isActive ? '' : 'is-disabled'} ${referenceDraft.id === item.id ? 'is-selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setReferenceDraft({ id: item.id, value: item.value, sortOrder: String(item.sortOrder ?? 0), isActive: item.isActive })}
              >
                <div className="reference-row-main">
                  <div className="reference-row-title">
                    <strong>{item.value}</strong>
                    <span className={`status-pill ${item.isActive ? 'status-online' : 'status-offline'}`}>{item.isActive ? 'Активно' : 'Отключено'}</span>
                  </div>
                  <span>Порядок: {item.sortOrder ?? 0} · Обновлено: {formatDateShort(item.updatedAt || item.createdAt || '')}</span>
                </div>
                <div className="reference-row-side">
                  <span className="reference-row-order">#{item.sortOrder ?? 0}</span>
                  <div className="reference-row-actions">
                    <button className="secondary compact" type="button" onClick={(event) => { event.stopPropagation(); setReferenceDraft({ id: item.id, value: item.value, sortOrder: String(item.sortOrder ?? 0), isActive: item.isActive }) }}>Править</button>
                    <button className="ghost danger compact" type="button" onClick={(event) => { event.stopPropagation(); void removeReferenceEntry(item.id) }}>Убрать</button>
                  </div>
                </div>
              </div>
            )) : (
              <div className="empty-state">По запросу ничего не найдено.</div>
            )}
          </div>
        </section>

        <section className="mini-panel reference-editor-panel">
          <div className="mini-panel-head"><div><h3>{referenceDraft.id ? 'Редактирование' : 'Добавление'}</h3><p className="mini-panel-note">Изменение сразу попадёт в рабочие подсказки системы.</p></div></div>
          <div className="reference-editor-preview">
            <span className="status-pill status-online">Раздел: {selectedReferenceKindConfig?.label}</span>
            <strong>{normalizeSuggestion(referenceDraft.value) || selectedReferenceKindConfig?.placeholder}</strong>
            <p>{selectedReferenceKindConfig?.help}</p>
          </div>
          <div className="subgrid reference-form-grid">
            <label className="wide-field"><span>Значение</span><input value={referenceDraft.value} onChange={(event) => setReferenceDraft((current: any) => ({ ...current, value: normalizeSuggestion(event.target.value) }))} placeholder={selectedReferenceKindConfig?.placeholder} /></label>
            <label><span>Порядок</span><FriendlyNumberInput type="number" value={referenceDraft.sortOrder} onChange={(event) => setReferenceDraft((current: any) => ({ ...current, sortOrder: event.target.value }))} placeholder="0" /></label>
            <label className="checkbox-row reference-active-toggle"><input type="checkbox" checked={referenceDraft.isActive} onChange={(event) => setReferenceDraft((current: any) => ({ ...current, isActive: event.target.checked }))} />Активно</label>
          </div>
          <div className="actions">
            <button className="primary" type="button" onClick={() => void saveReferenceEntry()}>{referenceDraft.id ? 'Сохранить изменения' : 'Добавить значение'}</button>
            <button className="secondary" type="button" onClick={() => resetReferenceDraft()}>Сбросить</button>
          </div>
        </section>
      </div>
    </div>
  )

  const inventoryModuleVisible = activeSector === 'inventory'

  // Step 190.6E: these legacy controller hook values are intentionally retained to preserve accepted hook order;
  // extracted panels no longer consume them directly. The explicit void reads keep strict noUnusedLocals enabled.
  void setCatalogReviewProductId
  void setCatalogReviewExecutionKey
  void catalogReviewVariantId
  void setCatalogReviewVariantId
  void catalogReviewExecutionOptions
  void catalogReviewCombinationOptions
  void stocktakeFoundVariantId
  void stocktakeFoundCreateMode
  void stocktakeSourceGenitive
  void stocktakeFoundVariants
  void stocktakeFoundExecution
  void jumpToStocktakeProduct
  void addStocktakeCatalogVariant

  const pendingWriteoffCount = inventoryModelVersion >= 2 ? 0 : Number(inventoryControlSettings?.pendingWriteoffCount || 0)
  const missingMovementCount = Number(inventoryAudit?.summary.missingMovements || 0)
  const resolvedMovementCount = Number(inventoryAudit?.summary.resolvedMovements || 0)
  const negativeStockCount = inventoryProblemRows.length
  const zeroStockCount = inventorySourceRows
    .flatMap((entry: any) => entry.data?.items || [])
    .filter((row: any) => Number(row.quantity || 0) === 0).length
  const autoWriteoffStopped = inventoryModelVersion >= 2 ? false : inventoryControlSettings?.autoWriteoffEnabled === false
  const inventoryNeedsAttention = autoWriteoffStopped || pendingWriteoffCount > 0 || missingMovementCount > 0 || negativeStockCount > 0
  const inventoryHealthTitle = inventoryNeedsAttention ? 'Требует внимания' : 'Работает нормально'
  const inventoryHealthText = inventoryNeedsAttention
    ? 'Ниже показано, что именно требует действия администратора. Технические детали спрятаны отдельно.'
    : inventoryAudit
      ? resolvedMovementCount > 0
        ? `Резервирование и физическое списание работают. ${resolvedMovementCount} исторических расхождений уже подтверждены сотрудником после сверки.`
        : 'Резервы и физические остатки работают, отрицательных остатков и пропущенных следов операций в последней проверке не найдено.'
      : 'Основные функции склада работают. Глубокую проверку цепочки операций можно запустить вручную при необходимости.'


  const arrivalWorkspace = (
<div className="inventory-arrival-legacy-workspace">
                      <div className="inventory-arrival-legacy-summary">
                        <div>
                          <strong>Приход товара</strong>
                          <span>Позиции заполняются списком размеров, как в старом приходе. Готовый вариант можно подставить одной кнопкой.</span>
                        </div>
                        <div className="inventory-arrival-summary-chips">
                          <span>{inventoryArrivalSummary.positions} поз.</span>
                          <span>{inventoryArrivalSummary.rows} вариантов</span>
                          <strong>{inventoryArrivalSummary.totalQuantity} шт.</strong>
                        </div>
                      </div>

                      <div className="inventory-arrival-position-list">
                        {inventoryArrivalPositions.map((position, positionIndex) => {
                          const readyVariants = inventoryArrivalReadyVariants(position)
                          return (
                            <article className="inventory-arrival-position-card" key={position.id}>
                              <div className="inventory-arrival-position-head">
                                <div>
                                  <span className="inventory-step-badge">Позиция {positionIndex + 1}</span>
                                  <strong>{position.productName || 'Новый товар'}</strong>
                                </div>
                                {inventoryArrivalPositions.length > 1 ? (
                                  <button className="ghost compact" type="button" onClick={() => removeInventoryArrivalPosition(position.id)}>Убрать позицию</button>
                                ) : null}
                              </div>

                              <div className="inventory-arrival-common-grid">
                                <label className="wide-field">
                                  <span>Наименование</span>
                                  <SmartPickerInput
                                    value={position.productName}
                                    options={(catalogData?.products || []).filter((product) => product.isActive).map((product) => product.name)}
                                    placeholder="Выберите существующий товар или введите новый"
                                    onChange={(value) => selectInventoryArrivalProduct(position.id, value)}
                                    ariaLabel={`Наименование позиции ${positionIndex + 1}`}
                                  />
                                </label>
                                <label>
                                  <span>Тип</span>
                                  <select value={position.category} onChange={(event) => updateInventoryArrivalPosition(position.id, 'category', event.target.value)}>
                                    <option value="adult">Взрослый</option>
                                    <option value="child">Детский</option>
                                  </select>
                                </label>
                                <label>
                                  <span>Материал</span>
                                  <SmartPickerInput value={position.material} options={arrivalSuggestionValues.materials} onChange={(value) => updateInventoryArrivalPosition(position.id, 'material', value)} placeholder="Материал" />
                                </label>
                                <label>
                                  <span>Длина</span>
                                  <SmartPickerInput value={position.length} options={arrivalSuggestionValues.lengths} onChange={(value) => updateInventoryArrivalPosition(position.id, 'length', value)} placeholder="Длина" />
                                </label>
                                <label>
                                  <span>Пол</span>
                                  <SmartPickerInput value={position.gender} options={arrivalSuggestionValues.genders} onChange={(value) => updateInventoryArrivalPosition(position.id, 'gender', value)} placeholder="Пол" />
                                </label>
                                <label>
                                  <span>Цвет</span>
                                  <SmartPickerInput
                                    value={position.sizes[0]?.color || ''}
                                    options={arrivalSuggestionValues.colors}
                                    onChange={(value) => position.sizes.forEach((line) => updateInventoryArrivalSize(position.id, line.id, { color: value }))}
                                    placeholder="Цвет"
                                    ariaLabel={`Цвет позиции ${positionIndex + 1}`}
                                  />
                                </label>
                              </div>

                              <div className="inventory-arrival-size-table">
                                <div className="inventory-arrival-size-head">
                                  <span>№</span><span>{position.category === 'child' ? 'Возраст' : 'Размер'}</span><span>Пришло</span><span></span>
                                </div>
                                {position.sizes.map((line, lineIndex) => (
                                  <div className="inventory-arrival-size-row" key={line.id}>
                                    <strong>{lineIndex + 1}</strong>
                                    <SmartPickerInput
                                      value={line.size}
                                      options={position.category === 'child' ? arrivalSuggestionValues.childAges : arrivalSuggestionValues.sizes}
                                      onChange={(value) => updateInventoryArrivalSize(position.id, line.id, { size: value })}
                                      placeholder={position.category === 'child' ? 'Возраст' : 'Размер'}
                                      ariaLabel={`${position.category === 'child' ? 'Возраст' : 'Размер'} позиции ${positionIndex + 1}`}
                                    />
                                    <FriendlyNumberInput
                                      type="number"
                                      min="0"
                                      value={line.quantity || ''}
                                      onChange={(event) => updateInventoryArrivalSize(position.id, line.id, { quantity: Math.max(0, Number(event.target.value || 0)) })}
                                    />
                                    <button className="ghost compact" type="button" title="Убрать размер" onClick={() => removeInventoryArrivalSize(position.id, line.id)}>×</button>
                                  </div>
                                ))}
                              </div>

                              <div className="inventory-arrival-position-actions">
                                <button className="secondary" type="button" onClick={() => addInventoryArrivalSize(position.id)}>+ Ещё {position.category === 'child' ? 'возраст' : 'размер'}</button>
                                <button className="secondary" type="button" disabled={!readyVariants.length} onClick={() => setInventoryArrivalVariantOpen((current) => ({ ...current, [position.id]: !current[position.id] }))}>
                                  {inventoryArrivalVariantOpen[position.id] ? 'Скрыть готовые варианты' : `Готовые варианты${readyVariants.length ? ` (${readyVariants.length})` : ''}`}
                                </button>
                              </div>

                              {inventoryArrivalVariantOpen[position.id] ? (
                                <div className="inventory-arrival-ready-variants">
                                  {readyVariants.map((variant) => (
                                    <button type="button" className="inventory-arrival-ready-variant" key={`arrival-ready-${position.id}-${variant.id}`} onClick={() => selectInventoryArrivalVariant(position.id, variant)}>
                                      <strong>{[variant.color, variant.sizeLabel].filter(Boolean).join(' · ') || 'Без цвета / размера'}</strong>
                                      <span>{[productCategoryLabel(getCatalogVariantCategory(variant)), variant.gender, variant.material, variant.length].filter(Boolean).join(' · ')}</span>
                                    </button>
                                  ))}
                                  {!readyVariants.length ? <div className="empty-state">У выбранного товара пока нет готовых вариантов.</div> : null}
                                </div>
                              ) : null}
                            </article>
                          )
                        })}
                      </div>

                      <button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>
                    </div>
  )

  return (
    <section className="card wide sector-inventory unified-inventory" id="inventory" style={inventoryModuleVisible ? undefined : { display: 'none' }}>
              <div className="inventory-compact-title">
                <div className="card-label">Склад</div>
                <div className="inventory-compact-statuses human-inventory-rule">
                  <span className="soft-badge">Склад показывает, сколько товара на месте, сколько уже обещано заказам и сколько ещё свободно</span>
                </div>
              </div>

              <div className="warehouse-w2-navigation" data-w2-human-warehouse="task-navigation">
                <div className="warehouse-w2-primary" aria-label="Основные действия склада">
                  {[
                    { value: 'overview' as const, label: 'Остатки', hint: 'Что сейчас есть на складе и в бутике' },
                    { value: 'movement' as const, label: 'Операции', hint: 'Приход, списание, перемещение и точечная корректировка' },
                    { value: 'stocktake' as const, label: 'Проверка', hint: 'Физически пересчитать товар' },
                    { value: 'history' as const, label: 'История', hint: 'Что менялось на складе и в бутике' },
                  ].map((entry) => (
                    <button key={entry.value} type="button" className={inventoryPanel === entry.value ? 'is-active' : ''} onClick={() => openInventoryPanel(entry.value)} title={entry.hint}>
                      <strong>{entry.label}</strong>
                    </button>
                  ))}
                </div>
                <div className="warehouse-w2-secondary">
                  <button type="button" className={`warehouse-w2-recovery ${inventoryPanel === 'attention' ? 'is-active' : ''}`} onClick={() => openInventoryPanel('attention')} title="Вопросы, которые нельзя безопасно решить автоматически">
                    <span>Нужно уточнить</span>{Number(warehouseAttention?.total || 0) > 0 ? <b>{warehouseAttention?.total}</b> : null}
                  </button>
                  {isAdmin ? <button type="button" className={inventoryPanel === 'catalog' ? 'is-active' : ''} onClick={() => openInventoryPanel('catalog')} title="Товары и характеристики">Товары</button> : null}
                </div>
              </div>

              {renderInventoryAttentionPanel({
        attentionCategory,
        attentionError,
        attentionIntakeBusyId,
        attentionLoading,
        formatDateShort,
        inventoryPanelStyle,
        isAdmin,
        openAttentionCatalog,
        openAttentionHandover,
        openAttentionIntake,
        openAttentionLifecycle,
        openAttentionShortage,
        openAttentionStocktake,
        refreshWarehouseAttention,
        setAttentionCategory,
        sourceLabel,
        warehouseAttention,
      })}

              {renderInventoryHealthPanel({
        applyPendingInventoryWriteoffs,
        autoWriteoffStopped,
        inventoryAudit,
        inventoryAuditBusy,
        inventoryControlBusy,
        inventoryHealthText,
        inventoryHealthTitle,
        inventoryModelVersion,
        inventoryNeedsAttention,
        inventoryPanelStyle,
        inventoryProblemRows,
        inventoryWriteoffReferenceGroups,
        isAdmin,
        loadInventoryAudit,
        missingMovementCount,
        negativeStockCount,
        openInventoryPanel,
        pendingWriteoffCount,
        renderInventoryReferenceManager,
        resolveInventoryAuditIssue,
        resolvedMovementCount,
        selectInventoryOperationMode,
        sourceLabel,
        toggleInventoryAutoWriteoff,
        zeroStockCount
      })}

              {renderInventoryExactPanel({
        ChoicePills,
        FriendlyNumberInput,
        SmartPickerInput,
        buildInventoryMatrix,
        changeInventoryOperationSource,
        createEmptyInventoryItem,
        createEmptyInventoryMatrixDraft,
        handleInventoryMatrixKeyDown,
        inventoryDraft,
        inventoryMatrix,
        inventoryMatrixAxisLabel,
        inventoryMatrixCellKey,
        inventoryMatrixCellMap,
        inventoryMatrixColors,
        inventoryMatrixDraftItem,
        inventoryMatrixSizes,
        inventoryMatrixSummary,
        inventoryMovementBusy,
        inventoryOperationProductGroups,
        inventoryOperationSearch,
        inventoryPanelStyle,
        isAdmin,
        resetInventoryOperationSelection,
        saveInventoryMovement,
        setInventoryDraft,
        setInventoryMatrix,
        setInventoryMatrixCell,
        setInventoryMatrixColorToAdd,
        setInventoryMatrixSizeToAdd,
        sourceLabel,
        suggestionValues,
        updateInventoryMatrixCategory,
        updateInventoryMatrixGender,
        updateInventoryMatrixLength,
        updateInventoryMatrixMaterial,
        updateInventoryMatrixProductInput
      })}

              {renderInventorySourceToolbar({
        SmartPickerInput,
        inventoryCategoryFilter,
        inventoryPanel,
        inventoryPickerOptions,
        inventoryQuery,
        inventoryQuickFilters,
        inventorySortMode,
        inventoryStatusFilter,
        openInventoryPanel,
        refreshInventoryModule,
        setInventoryCategoryFilter,
        setInventoryQuery,
        setInventoryQuickFilters,
        setInventorySortMode,
        setInventoryStatusFilter
      })}
    
              {renderInventoryOverviewPanel({
        SmartPickerInput,
        applyQuickStocktake,
        cycleCountBusy,
        cycleCountData,
        cycleCountLoading,
        cycleCountNotice,
        cycleCountValues,
        formatMoney,
        inventoryPanelStyle,
        inventoryPickerOptions,
        inventoryQuery,
        isAdmin,
        openInventoryPanel,
        openOrderFromFinance,
        openSimpleStockHistory,
        openSimpleStockRowsDetail,
        productCategoryLabel,
        quickStocktakeBusy,
        quickStocktakeNotice,
        quickStocktakeOpen,
        quickStocktakeValues,
        refreshCycleCountSuggestions,
        refreshInventoryModule,
        setInventoryQuery,
        setQuickStocktakeNotice,
        setQuickStocktakeOpen,
        setQuickStocktakeValues,
        setCycleCountValues,
        setSimpleStockAvailabilityFilter,
        setSimpleStockCategory,
        setSimpleStockDetail,
        setSimpleStockOpenProductKey,
        setSimpleStockSource,
        simpleStockAvailabilityFilter,
        simpleStockCategory,
        simpleStockDetail,
        simpleStockGroups,
        simpleStockOpenProductKey,
        simpleStockPhysical,
        simpleStockQuantity,
        simpleStockReservations,
        simpleStockReservationsBusy,
        simpleStockReserved,
        simpleStockSource,
        simpleStockStats,
        sourceLabel,
        submitRoutineCycleCount
      })}

              {renderInventoryStocktakePanel({
        addStocktakeNewCombination,
        applyStocktake,
        catalogActiveProducts,
        currentStocktakeGroup,
        currentStocktakePositions,
        cycleCountBusy,
        cycleCountData,
        cycleCountFilledCount,
        cycleCountLoading,
        cycleCountNotice,
        cycleCountOpen,
        cycleCountValues,
        discardStocktake,
        filteredStocktakeProductGroups,
        filteredStocktakeSelectableProducts,
        focusNextStocktakeCountInput,
        formatStocktakeMoment,
        goToNextUnfilledStocktakeProduct,
        inventoryPanelStyle,
        markCurrentStocktakeProductRemainingZero,
        normalizeSuggestion,
        openStocktakeFoundForPosition,
        openStocktakeInlineColor,
        openStocktakeInlineSize,
        openStocktakeOrders,
        openStocktakeReview,
        persistStocktakeFact,
        printInventoryStocktakePdf,
        refreshCycleCountSuggestions,
        resumeStocktake,
        selectedStocktakePositionCount,
        setCycleCountData,
        setCycleCountNotice,
        setCycleCountOpen,
        setCycleCountValues,
        setStocktakeFact,
        setStocktakeFoundCustom,
        setStocktakeFoundDraft,
        setStocktakeFoundNewFields,
        setStocktakeFoundOpen,
        setStocktakeFoundOtherProduct,
        setStocktakeFoundProductId,
        setStocktakeFoundSizes,
        setStocktakeInlineAdd,
        setStocktakeNotice,
        setStocktakeProductIndex,
        setStocktakeProductSearch,
        setStocktakeReviewMode,
        setStocktakeSelectedProductIds,
        setStocktakeSource,
        setStocktakeStartMode,
        setStocktakeStartSearch,
        startStocktake,
        stocktakeActiveForSelectedSource,
        stocktakeActiveSessions,
        stocktakeAddingVariantId,
        stocktakeBusy,
        stocktakeFacts,
        stocktakeFoundCustom,
        stocktakeFoundDraft,
        stocktakeFoundNewFields,
        stocktakeFoundOpen,
        stocktakeFoundOtherProduct,
        stocktakeFoundProductId,
        stocktakeFoundSizes,
        stocktakeGroups,
        stocktakeInlineAdd,
        stocktakeInlineAddBusy,
        stocktakeInlineColorOptions,
        stocktakeInlineSizeOptions,
        stocktakeNotice,
        stocktakePositionKey,
        stocktakePositionLabel,
        stocktakeProductIndex,
        stocktakeProductSearch,
        stocktakeProgress,
        stocktakeReadyForReview,
        stocktakeReferenceReady,
        stocktakeReviewMode,
        stocktakeReviewRows,
        stocktakeSavingIds,
        stocktakeSelectedProductIds,
        stocktakeSession,
        stocktakeSource,
        stocktakeSourceStats,
        stocktakeSourceTitle,
        stocktakeStartMode,
        stocktakeStartSearch,
        stocktakeUnsavedCount,
        submitCycleCount,
        submitStocktakeInlineAdd,
        suggestionValues,
        toggleStocktakeInlineSize
      })}


              {renderInventoryWarehousePanel({
        filteredInventoryRows,
        formatMoney,
        groupedInventoryRows,
        inventoryPanelStyle,
        inventoryStats,
        loadInventoryData,
        renderInventoryStockGroups
      })}
    
              {renderInventoryBoutiquePanel({
        filteredInventoryRows,
        formatMoney,
        groupedInventoryRows,
        inventoryPanelStyle,
        inventoryStats,
        loadInventoryData,
        renderInventoryStockGroups
      })}
    
              {renderInventoryCatalogPanel({
        catalogActiveProducts,
        catalogAdminMode,
        catalogCategoryFilter,
        catalogData,
        catalogIssueStats,
        catalogOnlyWithoutVariants,
        catalogProductDraft,
        catalogReview,
        catalogReviewActiveGroup,
        catalogReviewActiveItem,
        catalogReviewBlockingFields,
        catalogReviewBusy,
        catalogReviewContext,
        catalogReviewContextBusy,
        catalogReviewCreateFields,
        catalogReviewCreateProduct,
        catalogReviewFacts,
        catalogReviewGroups,
        catalogReviewIssue,
        catalogReviewNewProductName,
        catalogReviewTaskIndex,
        catalogVariantDraft,
        catalogVariantsByProductId,
        excludeCurrentCatalogReviewItem,
        expandedCatalogProducts,
        getCatalogProductEffectiveCategory,
        getCatalogVariantCategory,
        getStockQuantityForVariant,
        inventoryLifecycle,
        inventoryLifecycleActiveItem,
        inventoryLifecycleBlockingFields,
        inventoryLifecycleBusy,
        inventoryLifecycleContext,
        inventoryLifecycleContextBusy,
        inventoryLifecycleCreateFields,
        inventoryLifecycleCreateProduct,
        inventoryLifecycleFacts,
        inventoryLifecycleGenderNeedsChoice,
        inventoryLifecycleItems,
        inventoryLifecycleNewProductName,
        inventoryLifecycleTaskIndex,
        inventoryPanelStyle,
        inventoryProductReferenceGroups,
        lifecycleFactsMatchExactVariant,
        lifecycleOptionsWithCurrent,
        lifecycleValueNeedsCreation,
        loadCatalogData,
        loadCatalogReview,
        loadInventoryLifecycle,
        loadReferenceItems,
        normalizeSuggestion,
        openInventoryPanel,
        openOrderFromFinance,
        productCategoryLabel,
        reconcileCatalogReview,
        referenceItems,
        referenceKind,
        renderInventoryReferenceManager,
        reviewFieldUnknown,
        reviewOptionsWithCurrent,
        reviewValueNeedsCreation,
        saveCatalogProduct,
        saveCatalogVariant,
        selectReferenceKind,
        selectedCatalogProduct,
        setCatalogAdminMode,
        setCatalogCategoryFilter,
        setCatalogOnlyWithoutVariants,
        setCatalogProductDraft,
        setCatalogReviewCreateFields,
        setCatalogReviewCreateProduct,
        setCatalogReviewFacts,
        setCatalogReviewNewProductName,
        setCatalogReviewTaskIndex,
        setCatalogVariantDraft,
        setExpandedCatalogProducts,
        setInventoryLifecycleCreateFields,
        setInventoryLifecycleCreateProduct,
        setInventoryLifecycleFacts,
        setInventoryLifecycleNewProductName,
        setInventoryLifecycleTaskIndex,
        setInventoryQuery,
        sourceLabel,
        stocktakeReferenceReady,
        submitCatalogReviewFacts,
        submitInventoryLifecycleFacts,
        suggestionValues,
        visibleCatalogProducts
      })}
    
              {renderInventoryMovementPanel({
        arrivalWorkspace,
        FriendlyNumberInput,
        SmartPickerInput,
        changeInventoryOperationSource,
        createEmptyInventoryItem,
        createEmptyInventoryMatrixDraft,
        getStockQuantityForVariant,
        inventoryArrivalSummary,
        inventoryDraft,
        inventoryDraftSummary,
        inventoryExistingVariantSearch,
        inventoryMovementBusy,
        inventoryMovementText,
        inventoryOperationAllProductGroups,
        inventoryOperationRowPrimary,
        inventoryOperationRowSecondary,
        inventoryOperationSearch,
        inventoryPanelStyle,
        movementSourceLoadError,
        movementSourceLoading,
        operationDraftItem,
        operationVisibleRows,
        removeInventoryVariantOperationItem,
        resetInventoryArrivalForm,
        resetInventoryOperationSelection,
        saveInventoryMovement,
        selectInventoryOperationMode,
        selectInventoryOperationVariant,
        selectedInventoryOperationGroup,
        selectedOperationDraftItems,
        setInventoryCorrectionValue,
        setInventoryDraft,
        setInventoryExistingVariantSearch,
        setInventoryMatrix,
        setInventoryMatrixColorToAdd,
        setInventoryMatrixSizeToAdd,
        setInventoryTransferObservedQuantity,
        setInventoryVariantOperationQuantity,
        setMovementSourceRefreshToken,
        sourceLabel,
        suggestionValues,
        swapInventoryTransferDirection,
        updateInventoryDirectProductInput
      })}

              {renderInventoryHistoryPanel({
        formatHistoryMoment,
        historyBusy,
        historyCheckLabel,
        historyCheckRows,
        historyDisplayRows,
        historyError,
        historyHasMore,
        historyMode,
        historyQuery,
        historyRows,
        historyStocktakeDetail,
        historyStocktakeDetailBusy,
        historyVariantFilter,
        inventoryMovementHumanLabel,
        inventoryPanelStyle,
        isAdmin,
        loadHistoryChecks,
        loadHistoryMovements,
        openHistoryStocktake,
        openInventoryPanel,
        reverseInventoryMovement,
        reversingInventoryMovementId,
        setHistoryMode,
        setHistoryQuery,
        setHistoryVariantFilter,
        sourceLabel
      })}
            </section>
  )
}
