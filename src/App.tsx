import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './styles/00-foundation.css'
import './styles/10-workshop-reports-team.css'
import './styles/20-inventory-dashboard.css'
import './styles/30-erp-stabilization.css'
import './styles/40-auth-import-catalog.css'
import './styles/50-inventory-matrix.css'
import './styles/60-shared-ui-regression.css'
import './styles/70-manager-ui.css'
import './styles/80-compact-operator.css'
import './styles/90-balanced-operator.css'
import './styles/95-scroll-and-layout-fixes.css'
import './styles/99-verified-workspace.css'
import './styles/100-natural-page-scroll.css'
import './styles/110-mobile-desktop-parity.css'
import './styles/120-inventory-direct-operations.css'
import './styles/130-native-table-scrolling.css'
import './styles/140-finance-truth.css'
import './styles/150-orders-finance-sync.css'
import './styles/160-inventory-matrix-usability.css'
import './styles/170-cash-stocktake-arrival.css'
import './styles/188g-adaptive-sidebar-scroll.css'
import './styles/188k3-safe-early-handover.css'
import './styles/189b-business-history.css'
import './styles/189c-reliable-money-history.css'
import './styles/finance-f4-money-journal.css'
import './styles/189d-team-activity-cleanup.css'
import type { AccessRole, ActivityLogEntry, ApiState, AppSector, ArchiveMode, ArchivePreviewResponse, AuthUser, CallCentreRecord, CatalogResponse, CatalogReviewResponse, ClientDetailsResponse, ClientMode, ClientOrderRecord, ClientsResponse, DashboardInsightsResponse, DashboardLowStockItem, DashboardWorkshopWarning, DepartmentPlanRecord, EditorDraft, EditorItem, EditorPayment, ExchangeDraft, ExchangeHistoryEntry, ExchangeHistoryResponse, CashRegisterResponse, CashRegisterCycle, CashRegisterCyclesResponse, InventoryHistoryResponse, InventoryCheckHistoryResponse, FinancialHistoryEntry, FinancialHistoryResponse, FinanceReportType, InventoryAuditResponse, InventoryCategoryFilter, InventoryControlSettings, InventoryLifecyclePendingResponse, InventoryArrivalPosition, InventoryDraft, InventoryDraftItem, InventoryMatrixDraft, InventoryMovementRecord, InventoryOperationVariantDraft, InventoryPanel, InventoryResponse, InventorySortMode, InventorySourceKey, InventoryStatusFilter, InventoryStockGroup, InventoryStockRecord, LeadRecord, ManagedAuthUser, ManagerPlanRecord, OrderListResponse, OrderPanel, OrderPeriodPreset, OrderPeriodStats, OrderRecord, ReferenceData, ReferenceKind, ReferenceListItem, ReturnDraft, ReturnHistoryEntry, ReturnHistoryResponse, SimpleAdminStatusResponse, TeamActivityResponse, TeamActivityType, TeamEmployee, TeamMode, TeamSalaryResponse, TeamTimesheetResponse, WorkshopInvoiceRow, WorkshopPeriodPreset, WorkshopTaskRecord, WorkshopView } from './app/types'
import type { CatalogResolutionContext, CatalogResolutionInput, CatalogResolutionResponse, InventoryCycleCountApplyResponse, InventoryCycleCountSuggestionsResponse, InventoryReservationsResponse, InventoryStocktakeMutationResponse, InventoryStocktakeSessionsResponse, WarehouseAttentionSummaryResponse } from '../shared/api-contracts.ts'
import { MANAGER_COLOR_OPTIONS, SIMPLE_ADMIN_USER, SIMPLE_MANAGER_USER, orderPanelOptions, workspaceModules } from './app/constants'
import { calculateTotals, createDebtClosePayment, createEditorDraft, createEmptyEditorItem, createEmptyEditorPayment, createEmptyInventoryItem, createEmptyInventoryMatrixDraft, createEmptyOrderDraft, createExchangeDraft, createReturnDraft, deriveOrderSourceType, formatDateShort, formatLocalDateInput, formatMoney, formatOrderItemDetails, formatOrderItemTitle, formatPercent, getCatalogVariantCategory, getClosedArchiveMonth, getPeriodRange, htmlEscape, inventoryMatrixAxisLabel, inventoryMatrixCellKey, isArchivedOrderRecord, isLikelyAdultSizeValue, isReturnedOrderRecord, monthEndFromInput, monthLabelFromInput, monthStartFromInput, normalizeAccessRole, normalizeAudienceTypeValue, normalizeSearchText, normalizeSuggestion, orderLifecycleLabel, paymentStatusClass, paymentStatusLabel, productCategoryLabel, readJsonResponse, isTransientApiError, resolvePaymentKind, sectorFromHash, shippingStatusLabel, sortSizeLikeValues, sourceLabel, statusLabelByState, summarizeOrderItemLines, summarizeOrderPaymentLines, waitingDaysLabel, workshopCustomerIdentity, workshopDetailRows, } from './app/utils'
import { ChoicePills, FriendlyNumberInput, ManagerBadge, ManagerPicker, SmartPickerInput, resolveManagerDisplayColor } from './components'
import { TableDragScrollManager } from './components/tables/TableDragScrollManager'
import { DatabaseStorageModal, DatabaseStorageWarning, useDatabaseStorageMaintenance } from './features/storage/DatabaseStorageMaintenance'
import { DashboardSection, ClientsSection, ReferencesSection, InventorySection, WorkshopSection, OrdersHeaderSection, OrderFiltersSection, CreateOrderSection, OrderEditorSection, OrdersTableSection, OrderDetailsSection, OrderDebtSection, OrderReturnsSection, OrderExchangeSection, TeamSection, LeadsSection, PlanSection, FinanceSection, ReportsSection, OrderActivitySection, DeferredSection } from './app/lazySections'
import { InventoryStockGroupsRenderer } from './features/renderers/InventoryStockGroupsRenderer'
import { useFinanceReportReads } from './features/finance/useFinanceReportReads'
import { useWorkshopReads } from './features/workshop/useWorkshopReads'
import { useApiClient } from './app/controllers/useApiClient'
import { useOperationalViewModel } from './app/controllers/useOperationalViewModel'
import { useWorkspaceViewModel } from './app/controllers/useWorkspaceViewModel'
import { createEmptyArrivalPosition, createEmptyInventoryOperationVariantDraft } from './features/inventory/inventoryDraftFactories'
import { downloadBlobFile, makeExportHtml } from './features/export/documentExport'
import './styles/1905-small-screen-acceptance.css'
import './styles/192b1-warehouse-attention.css'




type InventoryStocktakeApplyItem = {
  key: string
  productId: number
  variantId: number
  productName: string
  category: 'adult' | 'child'
  gender: string
  color: string
  material: string
  length: string
  size: string
  quantity: number
  expectedQuantity: number
}

type InventoryStocktakeApplyResult = {
  ok: boolean
  appliedKeys: string[]
  message: string
}




















type OrderStockHandoverItemView = {
  orderItemId: number
  productName: string
  itemDetails: string
  source: InventorySourceKey
  quantity: number
  reservationId: number | null
  reservationStatus: string
  physicalQuantity: number
  totalReservedQuantity: number
  checkpointId: number | null
  checkpointAt: string | null
  checkpointType: string | null
  checkpointKind: 'revision' | 'check' | null
  reviewNeeded: boolean
  reviewReason: 'late_entry' | 'mixed_order_after_check' | null
  reviewDecision: string | null
  reviewedCheckpointId: number | null
  reviewedCheckpointAt: string | null
  itemCreatedAt: string | null
  state: 'already_issued' | 'handover_review' | 'ready_to_issue' | 'needs_attention'
}

type OrderStockHandoverResponse = {
  ok: boolean
  message?: string
  orderId?: number
  externalId?: string
  orderDate?: string
  orderCreatedAt?: string
  customerName?: string
  shippingStatus?: string
  workshopPending?: boolean
  workshopItemCount?: number
  activeWorkshopTaskCount?: number
  items?: OrderStockHandoverItemView[]
  state?: OrderStockHandoverResponse
  order?: OrderRecord
  refreshRequired?: boolean
}


const WAREHOUSE_ATTENTION_SUMMARY_TTL_MS = 20_000
let warehouseAttentionSummaryCache: { data: WarehouseAttentionSummaryResponse; loadedAt: number } | null = null
let warehouseAttentionSummaryInFlight: Promise<WarehouseAttentionSummaryResponse | null> | null = null
let warehouseAttentionRequestToken = 0

function handoverCheckpointDateLabel(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return 'последней сверки'
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10)
  return date.toLocaleDateString('ru-RU')
}

function handoverDateTimeLabel(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function handoverSourceLabel(source: InventorySourceKey | string) {
  return source === 'boutique' ? 'Бутик' : 'Склад'
}

async function settleCatalogReviewRefreshes(tasks: Promise<unknown>[]) { return (await Promise.allSettled(tasks)).some((entry) => entry.status === 'rejected') }
function App() {
  const [health, setHealth] = useState<ApiState | null>(null)
  const [dbState, setDbState] = useState<ApiState | null>(null)
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [orderPeriodStats, setOrderPeriodStats] = useState<OrderPeriodStats | null>(null)
  const [orderPageOffset, setOrderPageOffset] = useState(0)
  const [orderPageInfo, setOrderPageInfo] = useState({ offset: 0, limit: 100, totalCount: 0, hasMore: false, hasPrevious: false })
  const [clientsData, setClientsData] = useState<ClientsResponse | null>(null)
  const [clientMode, setClientMode] = useState<ClientMode>('all')
  const [clientQuery, setClientQuery] = useState('')
  const [clientBusy, setClientBusy] = useState(false)
  const [clientDetailsBusy, setClientDetailsBusy] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null)
  const [clientDetails, setClientDetails] = useState<ClientDetailsResponse | null>(null)
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null)
  const [editorOrderOverride, setEditorOrderOverride] = useState<OrderRecord | null>(null)
  const [editorReturnSector, setEditorReturnSector] = useState<'orders' | 'workshop'>('orders')
  const [editorOpen, setEditorOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [orderBusy, setOrderBusy] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [stockHandoverOrder, setStockHandoverOrder] = useState<OrderRecord | null>(null)
  const [stockHandoverData, setStockHandoverData] = useState<OrderStockHandoverResponse | null>(null)
  const [stockHandoverBusy, setStockHandoverBusy] = useState(false)
  const [stockHandoverActionItemId, setStockHandoverActionItemId] = useState<number | null>(null)
  const [references, setReferences] = useState<ReferenceData | null>(null)
  const [inventoryData, setInventoryData] = useState<{
    warehouse: InventoryResponse | null
    boutique: InventoryResponse | null
  }>({
    warehouse: null,
    boutique: null,
  })
  const [catalogData, setCatalogData] = useState<CatalogResponse | null>(null)
  const [catalogReview, setCatalogReview] = useState<CatalogReviewResponse | null>(null)
  const [catalogReviewBusy, setCatalogReviewBusy] = useState(false)
  const [inventoryLifecycle, setInventoryLifecycle] = useState<InventoryLifecyclePendingResponse | null>(null)
  const [inventoryLifecycleBusy, setInventoryLifecycleBusy] = useState(false)
  const [warehouseAttention, setWarehouseAttention] = useState<WarehouseAttentionSummaryResponse | null>(null)
  const [dashboardInsights, setDashboardInsights] = useState<DashboardInsightsResponse | null>(null)
  const [workshopFilters, setWorkshopFilters] = useState({
    view: 'active' as WorkshopView,
    period: 'all' as WorkshopPeriodPreset,
    dateFrom: '',
    dateTo: '',
    urgentOnly: false,
    q: '',
  })
  const [selectedWorkshopTaskIds, setSelectedWorkshopTaskIds] = useState<number[]>([])
  const [workshopInvoiceMode, setWorkshopInvoiceMode] = useState<'urgent' | 'period'>('period')
  const [workshopSortDirection, setWorkshopSortDirection] = useState<'oldest' | 'newest'>('oldest')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [authUser, setAuthUser] = useState<AuthUser | null>(SIMPLE_MANAGER_USER)
  const [authChecking, setAuthChecking] = useState(true)
  const [simpleAdminMode, setSimpleAdminMode] = useState(false)
  const [adminModeOpen, setAdminModeOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [adminModeBusy, setAdminModeBusy] = useState(false)
  const [adminModeDraft, setAdminModeDraft] = useState({ login: 'admin', password: '' })
  const [authHasUsers, setAuthHasUsers] = useState(true)
  const [authBusy, setAuthBusy] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authDisplayName, setAuthDisplayName] = useState('')
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false)
  const [passwordChangeBusy, setPasswordChangeBusy] = useState(false)
  const [passwordChangeDraft, setPasswordChangeDraft] = useState({ currentPassword: '', newPassword: '' })
  const [authUsersOpen, setAuthUsersOpen] = useState(false)
  const [authUsersBusy, setAuthUsersBusy] = useState(false)
  const [authUsers, setAuthUsers] = useState<ManagedAuthUser[]>([])
  const [authUserDraft, setAuthUserDraft] = useState({ id: 0, email: '', password: '', role: 'manager' as AccessRole, managerId: 0, displayName: '', isActive: true, mustChangePassword: true })
  const accessRole: AccessRole = simpleAdminMode ? 'admin' : 'manager'
  const isAdmin = accessRole === 'admin'
  const authReady = !authChecking
  const { apiFetch, prepareCriticalRequest, completeCriticalRequest } = useApiClient({ accessRole, setError, setMessage })
  
  

  

  

  

  const refreshHealth = useCallback(async () => {
    setHealth(null)
    try {
      const response = await fetch(`/api/health?_status=${Date.now()}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await readJsonResponse<ApiState>(response, 'Проверка связи')
      if (!response.ok) throw new Error(`Health check failed: ${response.status}`)
      setHealth(data)
    } catch (error) {
      console.error(error)
      setHealth({ ok: false, service: 'orders-app', time: 'Связь недоступна' })
    }
  }, [])

  const storageMaintenance = useDatabaseStorageMaintenance({ apiFetch, isAdmin, setError, setMessage })

  const reportReadFailure = useCallback((errorValue: unknown, label: string, hasPreviousData: boolean) => {
    const details = errorValue instanceof Error ? errorValue.message : `Не удалось обновить ${label.toLowerCase()}.`
    if (hasPreviousData && isTransientApiError(errorValue)) {
      setError(null)
      setMessage(`${label}: временно не удалось обновить данные. Показаны последние успешно загруженные данные.`)
      return
    }
    setError(details)
  }, [])


  const {
    financeReport,
    financeReportBusy,
    ordersFinanceReport,
    ordersFinanceBusy,
    invalidateFinanceReadCaches,
    loadFinanceReports: loadFinanceReportsForRange,
    loadOrdersFinanceSummary: loadOrdersFinanceSummaryForRange,
  } = useFinanceReportReads({ apiFetch, reportReadFailure })

  const {
    workshopData,
    workshopBusy,
    setWorkshopBusy,
    loadWorkshopData: loadWorkshopRead,
    applyWorkshopTaskStatusChange,
  } = useWorkshopReads({ apiFetch, reportReadFailure })

  const refreshAuth = useCallback(async () => {
    setAuthChecking(true)
    try {
      const response = await fetch('/api/admin-mode/status', { credentials: 'include' })
      const data = await readJsonResponse<SimpleAdminStatusResponse>(response, 'Проверка админ-режима')
      const nextAdmin = Boolean(data.isAdmin)
      setSimpleAdminMode(nextAdmin)
      setAuthUser(nextAdmin ? SIMPLE_ADMIN_USER : SIMPLE_MANAGER_USER)
      setAuthHasUsers(true)
    } catch (error) {
      console.error(error)
      setSimpleAdminMode(false)
      setAuthUser(SIMPLE_MANAGER_USER)
    } finally {
      setAuthChecking(false)
    }
  }, [])

  const submitAdminMode = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    setAdminModeBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/admin-mode/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(adminModeDraft),
      })
      await readJsonResponse<SimpleAdminStatusResponse>(response, 'Админ-режим')
      setSimpleAdminMode(true)
      setAuthUser(SIMPLE_ADMIN_USER)
      setAdminModeDraft({ login: 'admin', password: '' })
      setAdminModeOpen(false)
      setMessage('Админ-режим включён.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось включить админ-режим.')
    } finally {
      setAdminModeBusy(false)
    }
  }, [adminModeDraft])


  const submitAuth = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthBusy(true)
    setError(null)
    try {
      const endpoint = authHasUsers ? '/api/auth/login' : '/api/auth/setup'
      const payload = authHasUsers
        ? { email: authEmail, password: authPassword }
        : { email: authEmail, password: authPassword, displayName: authDisplayName || 'Администратор' }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await readJsonResponse<{ ok: boolean; user?: AuthUser }>(response, authHasUsers ? 'Вход' : 'Первый администратор')
      setAuthUser(data.user || null)
      setAuthPassword('')
      if (data.user?.mustChangePassword) {
        setMessage('Вход выполнен. Нужно сменить временный пароль.')
      } else {
        setMessage(authHasUsers ? 'Вход выполнен.' : 'Первый администратор создан.')
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось войти.')
    } finally {
      setAuthBusy(false)
    }
  }, [authDisplayName, authEmail, authHasUsers, authPassword])

  const logout = useCallback(async () => {
    await fetch('/api/admin-mode/logout', { method: 'POST', credentials: 'include' })
    setSimpleAdminMode(false)
    setAuthUser(SIMPLE_MANAGER_USER)
    setMessage('Админ-режим выключен.')
  }, [])

  const submitPasswordChange = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!isAdmin) return
    setPasswordChangeBusy(true)
    setError(null)
    try {
      const currentPassword = passwordChangeDraft.currentPassword
      const newPassword = passwordChangeDraft.newPassword
      if (newPassword.length < 8) throw new Error('Новый пароль должен быть не короче 8 символов.')
      const response = await apiFetch('/api/admin-mode/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await readJsonResponse<{ ok: boolean; message?: string }>(response, 'Смена пароля')
      setPasswordChangeDraft({ currentPassword: '', newPassword: '' })
      setPasswordChangeOpen(false)
      setMessage(data.message || 'Пароль админ-режима изменён.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сменить пароль.')
    } finally {
      setPasswordChangeBusy(false)
    }
  }, [apiFetch, isAdmin, passwordChangeDraft])

  const loadAuthUsers = useCallback(async () => {
    if (!isAdmin) return
    setAuthUsersBusy(true)
    try {
      const response = await apiFetch('/api/auth/users')
      const data = await readJsonResponse<{ ok: boolean; items?: ManagedAuthUser[] }>(response, 'Пользователи')
      setAuthUsers(data.items || [])
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось загрузить пользователей.')
    } finally {
      setAuthUsersBusy(false)
    }
  }, [apiFetch, isAdmin])

  const saveAuthUser = useCallback(async () => {
    if (!isAdmin) return
    setAuthUsersBusy(true)
    setError(null)
    try {
      const isEdit = Boolean(authUserDraft.id)
      const payload = {
        email: authUserDraft.email,
        password: authUserDraft.password || undefined,
        role: authUserDraft.role,
        managerId: authUserDraft.managerId || undefined,
        displayName: authUserDraft.displayName,
        isActive: authUserDraft.isActive,
        mustChangePassword: authUserDraft.mustChangePassword,
      }
      const response = await apiFetch(isEdit ? `/api/auth/users/${authUserDraft.id}` : '/api/auth/users', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await readJsonResponse(response, 'Пользователь')
      setAuthUserDraft({ id: 0, email: '', password: '', role: 'manager', managerId: 0, displayName: '', isActive: true, mustChangePassword: true })
      setMessage(isEdit ? 'Пользователь обновлён.' : 'Пользователь создан.')
      await loadAuthUsers()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить пользователя.')
    } finally {
      setAuthUsersBusy(false)
    }
  }, [apiFetch, authUserDraft, isAdmin, loadAuthUsers])

  const deleteAuthUser = useCallback(async (id: number) => {
    if (!isAdmin || !window.confirm('Удалить пользователя? Его активные сессии будут закрыты.')) return
    setAuthUsersBusy(true)
    try {
      const response = await apiFetch(`/api/auth/users/${id}`, { method: 'DELETE' })
      await readJsonResponse(response, 'Удаление пользователя')
      setMessage('Пользователь удалён.')
      await loadAuthUsers()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось удалить пользователя.')
    } finally {
      setAuthUsersBusy(false)
    }
  }, [apiFetch, isAdmin, loadAuthUsers])


  const [editorDraft, setEditorDraft] = useState<EditorDraft | null>(null)
  const [inventoryDraft, setInventoryDraft] = useState<InventoryDraft>({
    source: 'warehouse',
    targetSource: 'boutique',
    movementType: 'arrival',
    comment: '',
    items: [createEmptyInventoryItem()],
  })
  const [inventoryMatrix, setInventoryMatrix] = useState<InventoryMatrixDraft>(createEmptyInventoryMatrixDraft())
  const [inventoryArrivalPositions, setInventoryArrivalPositions] = useState<InventoryArrivalPosition[]>([createEmptyArrivalPosition()])
  const [inventoryArrivalVariantOpen, setInventoryArrivalVariantOpen] = useState<Record<string, boolean>>({})
  const [inventoryMatrixColorToAdd, setInventoryMatrixColorToAdd] = useState('')
  const [inventoryMatrixSizeToAdd, setInventoryMatrixSizeToAdd] = useState('')
  const [inventoryOperationSearch, setInventoryOperationSearch] = useState('')
  const [inventoryOperationProductKey, setInventoryOperationProductKey] = useState('')
  const [inventoryOperationVariant, setInventoryOperationVariant] = useState<InventoryOperationVariantDraft>(createEmptyInventoryOperationVariantDraft())
  const [inventoryOperationActiveVariantId, setInventoryOperationActiveVariantId] = useState('')
  const [inventoryExistingVariantOpen, setInventoryExistingVariantOpen] = useState(false)
  const [inventoryExistingVariantSearch, setInventoryExistingVariantSearch] = useState('')
  const [inventoryQuery, setInventoryQuery] = useState('')
  const [inventoryQuickFilters, setInventoryQuickFilters] = useState({ gender: '', color: '', material: '', length: '', size: '' })
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState<InventoryStatusFilter>('all')
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState<InventoryCategoryFilter>('all')
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState<InventoryCategoryFilter>('all')
  const [catalogOnlyWithoutVariants, setCatalogOnlyWithoutVariants] = useState(false)
  const [expandedCatalogProducts, setExpandedCatalogProducts] = useState<Record<string, boolean>>({})
  const [inventorySortMode, setInventorySortMode] = useState<InventorySortMode>('name')
  const [expandedInventoryGroups, setExpandedInventoryGroups] = useState<Record<string, boolean>>({})
  const [inventoryPanel, setInventoryPanel] = useState<InventoryPanel>('overview')
  const [inventoryAudit, setInventoryAudit] = useState<InventoryAuditResponse | null>(null)
  const [inventoryAuditBusy, setInventoryAuditBusy] = useState(false)
  const [inventoryControlSettings, setInventoryControlSettings] = useState<InventoryControlSettings | null>(null)
  const [inventoryControlBusy, setInventoryControlBusy] = useState(false)
  const [inventoryMovementBusy, setInventoryMovementBusy] = useState(false)
  const [inventoryTransferRequestId, setInventoryTransferRequestId] = useState(() => makeCashRequestId('inventory-transfer'))
  const [inventoryManualRequestId, setInventoryManualRequestId] = useState(() => makeCashRequestId('inventory-manual'))
  const [reversingInventoryMovementId, setReversingInventoryMovementId] = useState<number | null>(null)
  const [catalogProductDraft, setCatalogProductDraft] = useState({
    id: 0,
    name: '',
    category: 'adult' as 'adult' | 'child',
  })
  const [catalogVariantDraft, setCatalogVariantDraft] = useState({
    id: 0,
    productId: '',
    category: 'adult' as 'adult' | 'child',
    gender: '',
    color: '',
    material: 'СТАНДАРТ',
    length: 'СТАНДАРТ',
    sizeLabel: '',
    sortOrder: '0',
  })
  const [referenceKind, setReferenceKind] = useState<ReferenceKind>('cities')
  const [referenceItems, setReferenceItems] = useState<ReferenceListItem[]>([])
  const [referenceItemsCache, setReferenceItemsCache] = useState<Partial<Record<ReferenceKind, ReferenceListItem[]>>>({})
  const [referenceKindCounts, setReferenceKindCounts] = useState<Partial<Record<ReferenceKind, { total: number; active: number; inactive: number }>>>({})
  const [referenceDraft, setReferenceDraft] = useState({
    id: 0,
    value: '',
    sortOrder: '0',
    isActive: true,
  })
  const [referenceSearch, setReferenceSearch] = useState('')
  const [referenceStatusFilter, setReferenceStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [orderPanel, setOrderPanel] = useState<OrderPanel>('list')
  const [orderPeriodPreset, setOrderPeriodPreset] = useState<OrderPeriodPreset>('month')
  const defaultOrderRange = getPeriodRange('month')
  const [debtFilters, setDebtFilters] = useState({
    q: '',
    manager: '',
    orderDate: '',
  })
  const [debtAllOrders, setDebtAllOrders] = useState<OrderRecord[]>([])
  const [debtAllOrdersLoaded, setDebtAllOrdersLoaded] = useState(false)
  const [debtOverview, setDebtOverview] = useState({ count: 0, totalDebt: 0, hasMore: false, loadedCount: 0, historyCount: 0, historyAmount: 0 })
  const [debtCloseHistoryRows, setDebtCloseHistoryRows] = useState<Array<{ id: string; paymentDate: string; orderDate: string; orderId: string; manager: string; managerColor?: string; customer: string; method: string; amount: number; comment: string }>>([])
  const [debtLoadBusy, setDebtLoadBusy] = useState(false)
  const [debtSelectedOrderId, setDebtSelectedOrderId] = useState<number | null>(null)
  const [debtPayments, setDebtPayments] = useState<EditorPayment[]>([createDebtClosePayment()])
  const [debtBusy, setDebtBusy] = useState(false)
  const [returnSelectedOrderId, setReturnSelectedOrderId] = useState<number | null>(null)
  const [returnDraft, setReturnDraft] = useState<ReturnDraft>(createReturnDraft())
  const [returnBusy, setReturnBusy] = useState(false)
  const [returnHistory, setReturnHistory] = useState<ReturnHistoryEntry[]>([])
  const [returnHistoryBusy, setReturnHistoryBusy] = useState(false)
  const [returnHistoryError, setReturnHistoryError] = useState('')
  const [returnHistoryFilters, setReturnHistoryFilters] = useState({ q: '', dateFrom: '', dateTo: '', status: 'all' })
  const [returnHistoryHasMore, setReturnHistoryHasMore] = useState(false)
  const [returnHistorySummary, setReturnHistorySummary] = useState({ activeCount: 0, cancelledCount: 0, activeAmount: 0, count: 0 })
  const [exchangeSelectedOrderId, setExchangeSelectedOrderId] = useState<number | null>(null)
  const [exchangeDraft, setExchangeDraft] = useState<ExchangeDraft>(createExchangeDraft())
  const [exchangeBusy, setExchangeBusy] = useState(false)
  const [exchangeHistory, setExchangeHistory] = useState<ExchangeHistoryEntry[]>([])
  const [exchangeHistoryBusy, setExchangeHistoryBusy] = useState(false)
  const [exchangeHistoryError, setExchangeHistoryError] = useState('')
  const [exchangeHistoryFilters, setExchangeHistoryFilters] = useState({ q: '', dateFrom: '', dateTo: '', status: 'all' })
  const [exchangeHistoryHasMore, setExchangeHistoryHasMore] = useState(false)
  const [exchangeHistorySummary, setExchangeHistorySummary] = useState({ activeCount: 0, cancelledCount: 0, count: 0 })
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [activityBusy, setActivityBusy] = useState(false)
  const [activityFilters, setActivityFilters] = useState({ q: '', eventType: 'all', orderId: '' })
  const [financeReportFilters, setFinanceReportFilters] = useState({ dateFrom: getPeriodRange('month').dateFrom, dateTo: getPeriodRange('month').dateTo })
  const [financeReportType, setFinanceReportType] = useState<FinanceReportType>('payments')
  const [moneyHistory, setMoneyHistory] = useState<FinancialHistoryEntry[]>([])
  const [moneyHistoryBusy, setMoneyHistoryBusy] = useState(false)
  const [moneyHistoryError, setMoneyHistoryError] = useState('')
  const [moneyHistoryQuery, setMoneyHistoryQuery] = useState('')
  const [moneyHistoryType, setMoneyHistoryType] = useState({ flow: 'all' as 'all' | 'in' | 'out', operation: 'all' as 'all' | 'order_payment' | 'debt_close' | 'order_extra' | 'exchange_extra' | 'refund' | 'correction', trace: 'all' as 'all' | 'normal' | 'info' | 'review' | 'legacy' })
  const [moneyHistoryHasMore, setMoneyHistoryHasMore] = useState(false)
  const [moneyHistorySummary, setMoneyHistorySummary] = useState({ count: 0, totalIn: 0, totalOut: 0, net: 0 })
  const moneyHistoryRequestIdRef = useRef(0)
  const [financeMode, setFinanceMode] = useState<'summary' | 'payments' | 'debts' | 'returns' | 'methods' | 'cash'>('summary')
  const [cashRegister, setCashRegister] = useState<CashRegisterResponse | null>(null)
  const [cashRegisterBusy, setCashRegisterBusy] = useState(false)
  const [cashRegisterCycles, setCashRegisterCycles] = useState<CashRegisterCycle[]>([])
  const [cashRegisterCyclesBusy, setCashRegisterCyclesBusy] = useState(false)
  const [cashRegisterCyclesHasMore, setCashRegisterCyclesHasMore] = useState(false)
  const [cashRegisterCyclesOpen, setCashRegisterCyclesOpen] = useState(false)
  const [cashSetupAmount, setCashSetupAmount] = useState(0)
  const [cashMovementDraft, setCashMovementDraft] = useState<{ direction: 'in' | 'out'; amount: number; comment: string }>({ direction: 'out', amount: 0, comment: '' })
  const [cashReconcileAmount, setCashReconcileAmount] = useState(0)
  const [cashReconcileComment, setCashReconcileComment] = useState('')
  const cashMutationLockRef = useRef(false)
  const [financePaymentMethods, setFinancePaymentMethods] = useState<ReferenceListItem[]>([])
  const [financeMethodsBusy, setFinanceMethodsBusy] = useState(false)
  const [financeMethodDraft, setFinanceMethodDraft] = useState({ id: 0, value: '', sortOrder: '0', isActive: true })
  const [teamEmployees, setTeamEmployees] = useState<TeamEmployee[]>([])
  const [teamBusy, setTeamBusy] = useState(false)
  const [teamDraft, setTeamDraft] = useState({ id: 0, name: '', role: 'Менеджер', phone: '', colorKey: '#2563EB', hiredAt: formatLocalDateInput(), comment: '', isActive: true })
  const [teamRosterView, setTeamRosterView] = useState<'active' | 'former'>('active')
  const [teamFormOpen, setTeamFormOpen] = useState(false)
  const [teamColorEditorId, setTeamColorEditorId] = useState<number | null>(null)
  const [expandedOrderItemCounts, setExpandedOrderItemCounts] = useState<Record<number, number>>({})
  const [teamMode, setTeamMode] = useState<TeamMode>('employees')
  const [timesheetMonth, setTimesheetMonth] = useState(new Date().toISOString().slice(0, 7))
  const [timesheetData, setTimesheetData] = useState<TeamTimesheetResponse | null>(null)
  const [timesheetBusy, setTimesheetBusy] = useState(false)
  const [timesheetSelectedDays, setTimesheetSelectedDays] = useState<string[]>([])
  const [timesheetSelectedManagers, setTimesheetSelectedManagers] = useState<number[]>([])
  const [timesheetWorkUntil, setTimesheetWorkUntil] = useState('18:00')
  const [timesheetComment, setTimesheetComment] = useState('')
  const [teamSalaryFilters, setTeamSalaryFilters] = useState({ dateFrom: getPeriodRange('month').dateFrom, dateTo: getPeriodRange('month').dateTo })
  const [teamSalaryReport, setTeamSalaryReport] = useState<TeamSalaryResponse | null>(null)
  const [teamActivityReport, setTeamActivityReport] = useState<TeamActivityResponse | null>(null)
  const [teamActivityBusy, setTeamActivityBusy] = useState(false)
  const [teamActivityLoadFailed, setTeamActivityLoadFailed] = useState(false)
  const [teamActivityFilters, setTeamActivityFilters] = useState<{ dateFrom: string; dateTo: string; q: string; actionType: TeamActivityType }>({ dateFrom: getPeriodRange('month').dateFrom, dateTo: getPeriodRange('month').dateTo, q: '', actionType: 'all' })
  const [leadMode, setLeadMode] = useState<'leads' | 'callCentre'>('leads')
  const [leadRecords, setLeadRecords] = useState<LeadRecord[]>([])
  const [leadBusy, setLeadBusy] = useState(false)
  const [leadFilters, setLeadFilters] = useState({ dateFrom: getPeriodRange('month').dateFrom, dateTo: getPeriodRange('month').dateTo })
  const [leadDraft, setLeadDraft] = useState({ id: 0, date: formatLocalDateInput(), managerId: 0, managerName: '', acceptedCount: 0, badCount: 0, comment: '' })
  const [callCentreRecords, setCallCentreRecords] = useState<CallCentreRecord[]>([])
  const [callCentreDraft, setCallCentreDraft] = useState({ id: 0, date: formatLocalDateInput(), managerId: 0, managerName: '', acceptedLeads: 0, callsMade: 0, callsAccepted: 0, fakeCount: 0, refusalCount: 0, potentialCount: 0, comment: '' })
  const [planReport, setPlanReport] = useState<{ managerPlans: ManagerPlanRecord[]; departmentPlans: DepartmentPlanRecord[] } | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [planFilters, setPlanFilters] = useState({ dateFrom: getPeriodRange('month').dateFrom, dateTo: getPeriodRange('month').dateTo })
  const [managerPlanDraft, setManagerPlanDraft] = useState({ id: 0, periodStart: getPeriodRange('month').dateFrom, periodEnd: getPeriodRange('month').dateTo, managerId: 0, managerName: '', plannedAmount: 0, salaryBase: 100000, comment: '' })
  const [departmentPlanDraft, setDepartmentPlanDraft] = useState({ id: 0, periodStart: getPeriodRange('month').dateFrom, periodEnd: getPeriodRange('month').dateTo, plannedAmount: 0, comment: '' })
  const [filters, setFilters] = useState({
    q: '',
    status: 'all',
    shippingStatus: 'all',
    source: 'all',
    manager: '',
    managerId: 0,
    archiveMode: 'active' as ArchiveMode,
    dateFrom: defaultOrderRange.dateFrom,
    dateTo: defaultOrderRange.dateTo,
    pageSize: '100',
  })
  const closedArchiveMonth = getClosedArchiveMonth()
  const [archiveDraft, setArchiveDraft] = useState({
    month: closedArchiveMonth.value,
    cutoffDate: closedArchiveMonth.dateTo,
    includeNotSent: false,
    reason: `Закрытие месяца: ${closedArchiveMonth.label}`,
  })
  const [archivePreview, setArchivePreview] = useState<ArchivePreviewResponse | null>(null)
  const [archiveModalOpen, setArchiveModalOpen] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [createDraft, setCreateDraft] = useState<EditorDraft>(createEmptyOrderDraft())
  const [activeSector, setActiveSector] = useState<AppSector>(() => sectorFromHash(window.location.hash))
  const referenceRequestIdRef = useRef(0)
  const clientRequestIdRef = useRef(0)
  const lastSectorRef = useRef<AppSector | null>(null)
  const mainScrollRef = useRef<HTMLDivElement | null>(null)
  const debtFormRef = useRef<HTMLElement | null>(null)
  const returnFormRef = useRef<HTMLElement | null>(null)
  const exchangeFormRef = useRef<HTMLElement | null>(null)
  const editorFormRef = useRef<HTMLElement | null>(null)

  function managerColorFor(name?: string | null, id?: number | null, explicitColor?: string | null) {
    if (explicitColor) return resolveManagerDisplayColor(explicitColor, id || name || 'manager')
    const byId = id ? (references?.managerOptions || []).find((manager) => manager.id === id) || teamEmployees.find((manager) => manager.id === id) : null
    if (byId?.colorKey) return resolveManagerDisplayColor(byId.colorKey, byId.id)
    const normalizedName = normalizeSuggestion(name || '')
    const byName = normalizedName
      ? (references?.managerOptions || []).find((manager) => normalizeSuggestion(manager.name) === normalizedName)
        || teamEmployees.find((manager) => normalizeSuggestion(manager.name) === normalizedName)
      : null
    return resolveManagerDisplayColor(byName?.colorKey, byName?.id || name || 'manager')
  }

  useEffect(() => {
    const syncSectorFromHash = () => {
      const rawHash = window.location.hash.replace('#', '').toLowerCase()
      const nextSector = sectorFromHash(window.location.hash)
      if (nextSector === 'inventory') {
        if (rawHash === 'catalog' || rawHash === 'products') setInventoryPanel('catalog')
        if (rawHash === 'more' || rawHash === 'tools' || rawHash === 'technical') setInventoryPanel('settings')
      }
      setActiveSector(nextSector)
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    }

    syncSectorFromHash()
    window.addEventListener('hashchange', syncSectorFromHash)
    return () => window.removeEventListener('hashchange', syncSectorFromHash)
  }, [])


  useEffect(() => {
    setMobileNavOpen(false)
  }, [activeSector])

  useEffect(() => {
    document.body.classList.toggle('mobile-nav-open', mobileNavOpen)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    const handleResize = () => {
      if (window.innerWidth > 820) setMobileNavOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleResize)
    return () => {
      document.body.classList.remove('mobile-nav-open')
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleResize)
    }
  }, [mobileNavOpen])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    if (lastSectorRef.current && lastSectorRef.current !== activeSector) {
      setError(null)
      setMessage(null)
    }
    lastSectorRef.current = activeSector
  }, [activeSector])


  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
      const main = mainScrollRef.current
      if (!main) return
      main.scrollTop = 0
      main.scrollLeft = 0
      main.querySelectorAll<HTMLElement>('.table-shell, .table-scrollbar-top').forEach((shell) => {
        if (shell.offsetParent !== null) shell.scrollLeft = 0
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSector, orderPanel])

  useEffect(() => {
    if (!message) return undefined
    const timer = window.setTimeout(() => setMessage(null), 4200)
    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    const preventNumberWheel = (event: WheelEvent) => {
      const target = event.target as HTMLInputElement | null
      if (target?.tagName === 'INPUT' && target.type === 'number' && document.activeElement === target) {
        event.preventDefault()
      }
    }
    document.addEventListener('wheel', preventNumberWheel, { passive: false })
    return () => document.removeEventListener('wheel', preventNumberWheel)
  }, [])

  useEffect(() => {
    if (!authReady || activeSector !== 'clients') return
    const timer = window.setTimeout(() => {
      void loadClients(false, 0)
    }, clientQuery.trim() ? 320 : 80)
    return () => window.clearTimeout(timer)
  }, [activeSector, authReady, clientMode, clientQuery])

  useEffect(() => {
    if (!authReady || activeSector !== 'orders' || orderPanel !== 'list') return
    const timer = window.setTimeout(() => {
      setOrderPageOffset(0)
      void loadDashboard(false, filters, 0)
    }, filters.q.trim() ? 380 : 120)
    return () => window.clearTimeout(timer)
  }, [activeSector, authReady, orderPanel, filters.q, filters.status, filters.shippingStatus, filters.archiveMode, filters.manager, filters.managerId, filters.dateFrom, filters.dateTo])

  useEffect(() => {
    if (!authReady || activeSector !== 'orders' || orderPanel !== 'debt') return
    void loadAllOpenDebtOrders()
  }, [activeSector, authReady, orderPanel])

  useEffect(() => {
    if (!authReady || activeSector !== 'orders' || orderPanel !== 'returns') return
    void loadReturnHistory()
  }, [activeSector, authReady, orderPanel])

  useEffect(() => {
    if (!authReady || activeSector !== 'orders' || orderPanel !== 'exchange') return
    void loadExchangeHistory()
  }, [activeSector, authReady, orderPanel])

  useEffect(() => {
    if (!authReady || activeSector !== 'orders' || orderPanel !== 'activity') return
    void loadActivityLog()
  }, [activeSector, authReady, orderPanel])

  useEffect(() => {
    if (!authReady || activeSector !== 'overview') return
    void loadOverviewDashboard()
  }, [activeSector, authReady])

  useEffect(() => {
    if (!authReady || activeSector !== 'workshop') return
    const timer = window.setTimeout(() => {
      void loadWorkshopData(workshopFilters, { force: false })
    }, 100)
    return () => window.clearTimeout(timer)
  }, [activeSector, authReady, workshopFilters.view, workshopFilters.period, workshopFilters.dateFrom, workshopFilters.dateTo, workshopFilters.urgentOnly, workshopSortDirection])

  useEffect(() => {
    setInventoryOperationSearch('')
    setInventoryOperationProductKey('')
    setInventoryOperationVariant(createEmptyInventoryOperationVariantDraft())
    setInventoryOperationActiveVariantId('')
    setInventoryExistingVariantOpen(false)
    setInventoryExistingVariantSearch('')
    setInventoryMatrix(createEmptyInventoryMatrixDraft())
    setInventoryMatrixColorToAdd('')
    setInventoryMatrixSizeToAdd('')
    setInventoryArrivalVariantOpen({})
    if (inventoryDraft.movementType === 'arrival') setInventoryArrivalPositions([createEmptyArrivalPosition()])
  }, [inventoryDraft.source, inventoryDraft.movementType])

  useEffect(() => {
    void refreshAuth()
  }, [refreshAuth])

  useEffect(() => {
    if (!authReady) {
      setHealth(null)
      return
    }
    void refreshHealth()
  }, [authReady, accessRole, refreshHealth])

  useEffect(() => {
    if (!authUser || authUser.mustChangePassword) return
    if (authUser.role === 'manager' && authUser.managerName) {
      setCreateDraft((draft) => draft.managerId ? draft : { ...draft, managerId: Number(authUser.managerId || 0), managerName: authUser.managerName || '' })
      setLeadDraft((draft) => draft.managerId ? draft : { ...draft, managerId: Number(authUser.managerId || 0), managerName: authUser.managerName || '' })
      setCallCentreDraft((draft) => draft.managerId ? draft : { ...draft, managerId: Number(authUser.managerId || 0), managerName: authUser.managerName || '' })
    }
  }, [authUser?.id, authUser?.mustChangePassword])

  useEffect(() => {
    if (orderPanel !== 'create' || authUser?.role !== 'manager' || Number(authUser.managerId || 0) <= 0) return
    setCreateDraft((draft) => draft.managerId ? draft : {
      ...draft,
      managerId: Number(authUser.managerId || 0),
      managerName: authUser.managerName || '',
    })
  }, [orderPanel, authUser?.id, authUser?.role, authUser?.managerId, authUser?.managerName])

  const {
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
  } = useOperationalViewModel({
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
  })
  const openInventoryPanel = (panel: InventoryPanel) => {
    const nextPanel: InventoryPanel = panel === 'audit' ? 'settings' : panel
    if (!isAdmin && (nextPanel === 'catalog' || nextPanel === 'settings')) {
      setInventoryPanel('overview')
      return
    }
    setInventoryPanel(nextPanel)
    if (nextPanel === 'attention') void loadWarehouseAttention(true)
    if (nextPanel === 'warehouse' || nextPanel === 'boutique') {
      setInventoryDraft((current) => ({ ...current, source: nextPanel }))
    }
    if (nextPanel === 'movement') {
      // Movement forms can switch between Warehouse and Boutique without leaving the panel.
      // Load both sources up-front so Boutique write-off/correction lists are never empty just
      // because that source has not been opened elsewhere in the session yet.
      void Promise.all([
        loadInventoryData('warehouse', false, '', false),
        loadInventoryData('boutique', false, '', false),
      ])
    }
    if (nextPanel === 'stocktake') {
      void Promise.all([
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        loadCatalogData(),
      ])
    }
    if (nextPanel === 'catalog') {
      const productReferenceKinds: ReferenceKind[] = ['colors', 'materials', 'lengths', 'sizes', 'childAges']
      const nextKind: ReferenceKind = productReferenceKinds.includes(referenceKind) ? referenceKind : 'colors'
      if (nextKind !== referenceKind) setReferenceKind(nextKind)
      void Promise.all([
        loadCatalogData(),
        loadReferenceItems(nextKind, !referenceItemsCache[nextKind]),
        loadReferenceKindCounts(productReferenceKinds),
      ])
    }
    if (nextPanel === 'settings') {
      if (referenceKind !== 'writeoffReasons') setReferenceKind('writeoffReasons')
      void Promise.all([
        loadReferenceItems('writeoffReasons', !referenceItemsCache.writeoffReasons),
        loadReferenceKindCounts(['writeoffReasons']),
      ])
    }
    if (nextPanel === 'history') {
      // Step 189B: история загружается отдельным серверным endpoint с пагинацией.
      // Не тянем последние 120 движений вместе с обычным snapshot остатков.
    }
  }


  const buildDashboardInventoryQuery = (item: DashboardLowStockItem) => [
    item.productName,
    item.gender,
    item.color,
    item.material,
    item.length,
    item.size,
  ].map((part) => String(part || '').trim()).filter(Boolean).join(' ')

  const openDashboardStockItem = (item: DashboardLowStockItem) => {
    const query = buildDashboardInventoryQuery(item)
    setInventoryQuery(query)
    setInventoryStatusFilter('all')
    setExpandedInventoryGroups((current) => ({
      ...current,
      [`${item.source}:${normalizeSuggestion(item.productName) || item.productName}`]: true,
    }))
    openInventoryPanel('overview')
    window.location.hash = '#inventory'
    void loadInventoryData(item.source, true, query, false)
  }

  const openDashboardWorkshopItem = (item: DashboardWorkshopWarning) => {
    const query = item.externalOrderId || [item.productName, item.gender, item.color, item.size].filter(Boolean).join(' ')
    const nextFilters = {
      ...workshopFilters,
      view: 'active' as WorkshopView,
      period: 'custom' as WorkshopPeriodPreset,
      dateFrom: '',
      dateTo: '',
      urgentOnly: false,
      q: query,
    }
    setWorkshopFilters(nextFilters)
    setSelectedWorkshopTaskIds([item.id])
    window.location.hash = '#workshop'
    void loadWorkshopData(nextFilters)
  }

  const toggleInventoryGroup = (groupKey: string) => {
    setExpandedInventoryGroups((current) => ({ ...current, [groupKey]: !current[groupKey] }))
  }
  const refreshInventoryModule = async (force = true, includeMovements = false) => {
    await Promise.all([
      loadInventoryData('warehouse', force, '', includeMovements),
      loadInventoryData('boutique', force, '', includeMovements),
      loadCatalogData(force),
      loadReferencesData(force),
      loadInventoryControlSettings(),
      isAdmin ? loadInventoryLifecycle(force) : Promise.resolve(null),
      loadWarehouseAttention(),
    ])
  }
  const {
    applyCreateProductPick,
    applyEditorProductPick,
    applyExchangeProductPick,
    arrivalSuggestionValues,
    filteredReferenceItems,
    getOrderSourceAvailability,
    getSizeOptions,
    inventoryMatrixCellMap,
    inventoryMatrixColors,
    inventoryMatrixSizes,
    orderPanelStyle,
    pageTitle,
    referenceStats,
    renderOrderSourceAvailability,
    sectorStyle,
    selectedReferenceKindConfig,
    suggestionValues,
  } = useWorkspaceViewModel({
    activeCatalogVariants,
    activeSector,
    catalogData,
    catalogVariantsByProductId,
    createDraft,
    editorDraft,
    getCatalogProductEffectiveCategory,
    getInventoryRowCategory,
    getStockQuantityForVariant,
    inventoryData,
    inventoryDraft,
    inventoryMatrix,
    inventoryOperationSourceRows,
    orderPanel,
    referenceGroups,
    referenceItems,
    referenceKind,
    referenceSearch,
    referenceStatusFilter,
    references,
    setCreateDraft,
    setEditorDraft,
    setExchangeDraft,
    variantsForProduct,
  })
  const inventoryMatrixActiveGroupKey = inventoryMatrixGroupKey(inventoryMatrix)
  const inventoryMatrixCurrentGroupItems = useMemo(() => inventoryDraft.items.filter((item) => (
    item.touched
    && item.productName
    && inventoryMatrixGroupKey(item) === inventoryMatrixActiveGroupKey
  )), [inventoryDraft.items, inventoryMatrixActiveGroupKey])
  const inventoryMatrixBatchGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string
      productId: string
      productName: string
      category: 'adult' | 'child'
      gender: string
      material: string
      length: string
      colors: string[]
      sizes: string[]
      rows: number
      totalQuantity: number
    }>()

    for (const item of inventoryDraft.items) {
      if (!item.touched || !item.productName) continue
      if (inventoryDraft.movementType !== 'manual_set' && Number(item.quantity || 0) <= 0) continue
      const key = inventoryMatrixGroupKey(item)
      const existing = groups.get(key) || {
        key,
        productId: String(item.productId || ''),
        productName: item.productName,
        category: item.category,
        gender: item.gender,
        material: item.material,
        length: item.length,
        colors: [],
        sizes: [],
        rows: 0,
        totalQuantity: 0,
      }
      existing.rows += 1
      existing.totalQuantity += Number(item.quantity || 0)
      if (item.color && !existing.colors.includes(item.color)) existing.colors.push(item.color)
      if (item.size && !existing.sizes.includes(item.size)) existing.sizes.push(item.size)
      groups.set(key, existing)
    }

    return Array.from(groups.values()).map((group) => ({
      ...group,
      colors: [...group.colors].sort((left, right) => left.localeCompare(right, 'ru')),
      sizes: sortSizeLikeValues(group.sizes),
    }))
  }, [inventoryDraft.items, inventoryDraft.movementType])
  const inventoryMatrixSummary = useMemo(() => {
    const edited = inventoryMatrixCurrentGroupItems
    const currentTotal = Array.from(inventoryMatrixCellMap.values()).reduce((sum, cell) => sum + cell.current, 0)
    if (inventoryDraft.movementType === 'manual_set') {
      const delta = edited.reduce((sum, item) => sum + Number(item.quantity || 0) - Number(item.expectedQuantity || 0), 0)
      return { edited: edited.length, entered: edited.reduce((sum, item) => sum + Number(item.quantity || 0), 0), currentTotal, afterTotal: currentTotal + delta, delta }
    }
    const entered = edited.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    return { edited: edited.length, entered, currentTotal, afterTotal: currentTotal + entered, delta: entered }
  }, [inventoryMatrixCurrentGroupItems, inventoryDraft.movementType, inventoryMatrixCellMap])


  useEffect(() => {
    if (!selectedOrderId) return
    const exists = orders.some((order) => order.id === selectedOrderId) || editorOrderOverride?.id === selectedOrderId
    if (!exists) {
      setSelectedOrderId(null)
      setEditorOpen(false)
      setEditorOrderOverride(null)
    }
  }, [orders, selectedOrderId, editorOrderOverride])

  useEffect(() => {
    if (selectedOrder) {
      setEditorDraft(createEditorDraft(selectedOrder))
    } else {
      setEditorDraft(null)
      setEditorOpen(false)
    }
  }, [selectedOrder?.id])

  useEffect(() => {
    if (!debtSelectedOrderId) {
      return
    }
    if (!debtOrders.some((order) => order.id === debtSelectedOrderId)) {
      setDebtSelectedOrderId(null)
    }
  }, [debtOrders, debtSelectedOrderId])

  useEffect(() => {
    if (!debtSelectedOrder) {
      setDebtPayments([createDebtClosePayment()])
      return
    }
    setDebtPayments([createDebtClosePayment(formatLocalDateInput(), Number(debtSelectedOrder.debt_amount || 0))])
  }, [debtSelectedOrder?.id])

  useEffect(() => {
    if (!debtSelectedOrderId || !debtFormRef.current) return
    requestAnimationFrame(() => {
      debtFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [debtSelectedOrderId])

  useEffect(() => {
    if (!returnSelectedOrderId) {
      return
    }
    if (!returnOrders.some((order) => order.id === returnSelectedOrderId)) {
      setReturnSelectedOrderId(null)
    }
  }, [returnOrders, returnSelectedOrderId])

  useEffect(() => {
    if (!returnSelectedOrder) {
      setReturnDraft(createReturnDraft())
      return
    }
    setReturnDraft(createReturnDraft(returnSelectedOrder))
  }, [returnSelectedOrder?.id])

  useEffect(() => {
    if (!returnSelectedOrderId || !returnFormRef.current) return
    requestAnimationFrame(() => {
      returnFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [returnSelectedOrderId])

  useEffect(() => {
    if (!exchangeSelectedOrderId || !exchangeFormRef.current) return
    requestAnimationFrame(() => {
      exchangeFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [exchangeSelectedOrderId])

  useEffect(() => {
    if (!editorOpen || !selectedOrderId || !editorFormRef.current) return
    requestAnimationFrame(() => {
      editorFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [editorOpen, selectedOrderId])

  useEffect(() => {
    if (!authReady) return
    if (activeSector === 'inventory' || warehouseAttention === null) void loadWarehouseAttention()
    if (activeSector === 'inventory') {
      // Весь склад живёт в одном разделе. Журнал движений по-прежнему не грузится без явного открытия истории.
      void loadInventoryData('warehouse')
      void loadInventoryData('boutique')
      // Full catalog variants are unnecessary for ordinary Остатки/Внимание/История reads.
      // Movement keeps them because the frozen Arrival workspace depends on catalog variants.
      if (inventoryPanel === 'movement' || inventoryPanel === 'stocktake' || inventoryPanel === 'catalog') void loadCatalogData()
      // Inventory admin forms must always use the canonical reference dictionaries.
      // Do not rely on another screen having loaded them earlier in the session.
      void loadReferencesData()
      void loadInventoryControlSettings()
      if (!isAdmin && inventoryPanel === 'catalog') setInventoryPanel('overview')
      if (isAdmin && !inventoryAdminPanels.includes(inventoryPanel)) setInventoryPanel('overview')
    }
    if (activeSector === 'orders' && (orderPanel === 'create' || orderPanel === 'edit' || orderPanel === 'exchange')) {
      // Форма заказа всегда получает свежие остатки обеих точек, но журнал движений ей не нужен.
      // Каталог остаётся полным: список товаров и все варианты по-прежнему доступны при создании/редактировании.
      void loadInventoryData('warehouse', true, '', false)
      void loadInventoryData('boutique', true, '', false)
      void loadCatalogData()
    }
  }, [activeSector, authReady, orderPanel, isAdmin, inventoryPanel])

  useEffect(() => {
    if (!authReady || isAdmin) return
    if (activeSector === 'inventory' && inventoryPanel === 'catalog') setInventoryPanel('overview')
  }, [activeSector, authReady, inventoryPanel, isAdmin])

  useEffect(() => {
    if (!authReady || !isAdmin || activeSector !== 'inventory' || inventoryPanel !== 'catalog') return
    void loadReferenceKindCounts(['colors', 'materials', 'lengths', 'sizes', 'childAges'])
  }, [activeSector, authReady, inventoryPanel, isAdmin])

  useEffect(() => {
    if (!authReady) return
    if (activeSector === 'references') {
      const allowed = referenceGroups.some((group) => group.kind === referenceKind)
      const nextKind: ReferenceKind = allowed ? referenceKind : 'cities'
      if (nextKind !== referenceKind) setReferenceKind(nextKind)
      void Promise.all([
        loadReferenceItems(nextKind, !referenceItemsCache[nextKind]),
        loadReferenceKindCounts(referenceGroups.map((group) => group.kind)),
      ])
    }
  }, [activeSector, authReady, referenceKind, referenceItemsCache, referenceGroups])


  useEffect(() => {
    if (!authReady) return
    if (activeSector === 'team') {
      void loadTeamEmployees()
    }
    if (activeSector === 'leads') {
      void loadLeadRecords()
      void loadCallCentreRecords()
    }
    if (activeSector === 'plan') {
      void loadPlans()
    }
    if (activeSector === 'finance') {
      void loadFinancePaymentMethods()
      // Сводка ниже загружается отдельным effect и использует scoped cache.
    }
    if (activeSector === 'reports') {
      void loadFinanceReports()
    }
  }, [activeSector, authReady])

  useEffect(() => {
    if (!authReady || activeSector !== 'finance' || financeMode !== 'cash') return
    void loadCashRegister()
  }, [activeSector, authReady, financeMode])

  useEffect(() => {
    if (!authReady || activeSector !== 'team') return
    if (teamMode === 'timesheet') void loadTeamTimesheet()
    if (teamMode === 'plan') void loadPlans()
    if (teamMode === 'salary') void loadTeamSalaryReport()
    if (teamMode === 'activity') void loadTeamActivityReport()
  }, [activeSector, authReady, teamMode, timesheetMonth])

  useEffect(() => {
    if (!authReady || activeSector !== 'finance' || financeMode === 'cash') return
    if (!financeReportFilters.dateFrom || !financeReportFilters.dateTo) return
    const timer = window.setTimeout(() => {
      void loadFinanceReports(financeReportFilters)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [activeSector, authReady, financeMode, financeReportFilters.dateFrom, financeReportFilters.dateTo])


  useEffect(() => {
    if (!authReady || activeSector !== 'finance' || financeMode !== 'payments') return
    if (!financeReportFilters.dateFrom || !financeReportFilters.dateTo) return
    const timer = window.setTimeout(() => {
      void loadMoneyHistory()
    }, 250)
    return () => window.clearTimeout(timer)
  }, [activeSector, authReady, financeMode, financeReportFilters.dateFrom, financeReportFilters.dateTo, moneyHistoryQuery, moneyHistoryType.flow, moneyHistoryType.operation, moneyHistoryType.trace])

  async function loadReferencesData(force = false) {
    if (references && !force) return references
    const response = await apiFetch('/api/reference-data')
    if (!response.ok) return null
    const referenceData = await readJsonResponse<ReferenceData>(response, 'Справочники')
    setReferences(referenceData)
    return referenceData
  }

  async function loadClients(append = false, offsetOverride?: number) {
    const requestId = ++clientRequestIdRef.current
    const offset = typeof offsetOverride === 'number' ? offsetOverride : (append ? (clientsData?.clients.length || 0) : 0)
    const limit = 60
    setClientBusy(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        mode: clientMode,
        q: clientQuery.trim(),
        limit: String(limit),
        offset: String(offset),
      })
      const response = await apiFetch(`/api/clients?${params.toString()}`)
      const data = await readJsonResponse<ClientsResponse>(response, 'Клиенты')
      if (!response.ok) throw new Error('Не удалось загрузить клиентов.')
      if (requestId !== clientRequestIdRef.current) return data
      setClientsData((current) => {
        if (!append || !current) return data
        return {
          ...data,
          clients: [...current.clients, ...data.clients],
          offset: current.offset,
        }
      })
      if (!append && selectedClientId && !data.clients.some((client) => client.id === selectedClientId)) {
        setSelectedClientId(null)
        setClientDetails(null)
      }
      return data
    } catch (err) {
      reportReadFailure(err, 'Клиенты', Boolean(clientsData))
      return null
    } finally {
      if (requestId === clientRequestIdRef.current) {
        setClientBusy(false)
      }
    }
  }

  async function loadClientDetails(clientId: number, append = false) {
    setSelectedClientId(clientId)
    setClientDetailsBusy(true)
    setError(null)
    try {
      const currentOffset = append && clientDetails?.client?.id === clientId ? clientDetails.orders.length : 0
      const response = await apiFetch(`/api/clients/${clientId}?limit=40&offset=${currentOffset}`)
      const data = await readJsonResponse<ClientDetailsResponse & { message?: string }>(response, 'Карточка клиента')
      if (!response.ok) throw new Error(data.message || 'Не удалось открыть карточку клиента.')
      setClientDetails((current) => {
        if (!append || !current || current.client.id !== clientId) return data
        return { ...data, orders: [...current.orders, ...data.orders] }
      })
      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка открытия клиента')
      return null
    } finally {
      setClientDetailsBusy(false)
    }
  }

  async function openClientOrder(order: ClientOrderRecord) {
    const nextFilters = {
      ...filters,
      q: order.external_id || order.customer_phone || '',
      status: 'all',
      shippingStatus: 'all',
      source: 'all',
      manager: '',
      archiveMode: 'all' as ArchiveMode,
      dateFrom: '',
      dateTo: '',
      pageSize: '100',
    }
    setOrderPanel('list')
    setOrderPeriodPreset('custom')
    setFilters(nextFilters)
    setSelectedOrderId(order.id)
    setEditorOpen(false)
    window.location.hash = '#orders'

    setOrderPageOffset(0)
    try {
      await loadDashboard(false, nextFilters, 0)
    } catch {
      // Переход всё равно выполнен; пользователь сможет нажать «Показать заказы» вручную.
    }
  }

  async function loadReferenceKindCounts(kinds: ReferenceKind[], force = false) {
    const requested = Array.from(new Set(kinds)).filter(Boolean)
    if (!requested.length) return {}
    if (!force && requested.every((kind) => referenceKindCounts[kind])) {
      return referenceKindCounts
    }
    const response = await apiFetch(`/api/reference-values/counts?kinds=${encodeURIComponent(requested.join(','))}`)
    if (!response.ok) return null
    const data = await readJsonResponse<{ ok: boolean; counts?: Partial<Record<ReferenceKind, { total: number; active: number; inactive: number }>> }>(response, 'Счётчики справочников')
    const counts = data.counts || {}
    setReferenceKindCounts((current) => ({ ...current, ...counts }))
    return counts
  }

  async function loadReferenceItems(kind = referenceKind, force = false) {
    const cached = referenceItemsCache[kind]
    if (cached && !force) {
      setReferenceItems(cached)
      return cached
    }
    if (referenceBusy && !force) return referenceItems
    const requestId = ++referenceRequestIdRef.current
    setReferenceBusy(true)
    try {
      const response = await apiFetch(`/api/reference-values?kind=${encodeURIComponent(kind)}`)
      if (!response.ok) return null
      const data = await readJsonResponse<{ ok: boolean; items?: ReferenceListItem[] }>(response, 'Справочник')
      const items = Array.isArray(data.items) ? data.items : []
      if (requestId !== referenceRequestIdRef.current) {
        return items
      }
      setReferenceItems(items)
      setReferenceItemsCache((current) => ({ ...current, [kind]: items }))
      const activeCount = items.filter((item) => item.isActive).length
      setReferenceKindCounts((current) => ({
        ...current,
        [kind]: { total: items.length, active: activeCount, inactive: Math.max(0, items.length - activeCount) },
      }))
      return items
    } finally {
      if (requestId === referenceRequestIdRef.current) {
        setReferenceBusy(false)
      }
    }
  }

  async function loadWarehouseAttention(details = false, force = false) {
    if (!details && !force) {
      const cached = warehouseAttentionSummaryCache
      if (cached && Date.now() - cached.loadedAt < WAREHOUSE_ATTENTION_SUMMARY_TTL_MS) {
        setWarehouseAttention(cached.data)
        return cached.data
      }
      if (warehouseAttentionSummaryInFlight) {
        const data = await warehouseAttentionSummaryInFlight
        if (data) setWarehouseAttention(data)
        return data
      }
    }
    const requestToken = ++warehouseAttentionRequestToken
    const request = (async () => {
      const response = await apiFetch(`/api/inventory/attention${details ? '?details=1&limit=30' : ''}`)
      if (!response.ok) return null
      return await readJsonResponse<WarehouseAttentionSummaryResponse>(response, 'Склад')
    })()
    if (!details) warehouseAttentionSummaryInFlight = request
    try {
      const data = await request
      if (!data || requestToken !== warehouseAttentionRequestToken) return data
      setWarehouseAttention(data)
      if (!details) warehouseAttentionSummaryCache = { data, loadedAt: Date.now() }
      return data
    } finally {
      if (!details && warehouseAttentionSummaryInFlight === request) warehouseAttentionSummaryInFlight = null
    }
  }

  async function loadInventoryData(
    source: 'warehouse' | 'boutique' = inventoryDraft.source,
    force = false,
    query = '',
    includeMovements = false,
  ) {
    const cached = inventoryData[source]
    const cachedHasMovements = cached?.movementsIncluded !== false
    if (cached && !force && !query.trim() && (!includeMovements || cachedHasMovements)) {
      return cached
    }

    const params = new URLSearchParams({
      source,
      limit: '1000',
      q: query.trim(),
      includeMovements: includeMovements ? '1' : '0',
    })
    const response = await apiFetch(`/api/inventory?${params.toString()}`)
    if (!response.ok) return null
    const data = await readJsonResponse<InventoryResponse>(response, 'Склад')
    setInventoryData((current) => {
      const previous = current[source]
      if (!includeMovements && previous && previous.movementsIncluded !== false) {
        return {
          ...current,
          [source]: {
            ...data,
            movements: previous.movements,
            movementsIncluded: false,
          },
        }
      }
      return { ...current, [source]: data }
    })
    return data
  }

  function invalidateInventoryStockCaches(includeCatalogReview = false) {
    setInventoryData({ warehouse: null, boutique: null })
    if (includeCatalogReview) setCatalogReview(null)
    warehouseAttentionSummaryCache = null
    void loadWarehouseAttention(false, true)
  }

  async function loadCatalogData(force = false) {
    if (catalogData && !force) return catalogData
    const response = await apiFetch('/api/catalog')
    if (!response.ok) return null
    const data = await readJsonResponse<CatalogResponse>(response, 'Каталог')
    setCatalogData(data)
    return data
  }



  async function loadCatalogReview(force = false, orderId = 0) {
    if (!isAdmin) return null
    if (!orderId && catalogReview?.mode !== 'order' && catalogReview && !force) return catalogReview
    setCatalogReviewBusy(true)
    try {
      // Opening the review page is read-only. An orderId is used only when an old hidden
      // exception becomes operational because the user is trying to finish that exact order.
      const params = new URLSearchParams({ limit: '24' })
      if (orderId > 0) params.set('orderId', String(orderId))
      const response = await apiFetch(`/api/catalog/review?${params.toString()}`)
      if (!response.ok) return null
      const data = await readJsonResponse<CatalogReviewResponse>(response, 'Неразобранные товары')
      setCatalogReview(data)
      return data
    } finally {
      setCatalogReviewBusy(false)
    }
  }

  async function reconcileCatalogReview(limit = 20) {
    if (!isAdmin || catalogReviewBusy) return null
    setCatalogReviewBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/catalog/review/reconcile?limit=${Math.max(1, Math.min(20, limit))}`, { method: 'POST' })
      const result = await readJsonResponse<CatalogResolutionResponse>(response, 'Безопасное распознавание каталога')
      if (!response.ok) throw new Error(result?.message || 'Не удалось разобрать очевидные позиции.')
      const nextRefresh = loadCatalogReview(true)
      const refreshIncomplete = await settleCatalogReviewRefreshes([nextRefresh, ...(Number(result?.resolvedGroups || 0) > 0 ? [loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false), loadCatalogData(true)] : [])])
      const next = await nextRefresh.catch(() => catalogReview)
      const successMessage = Number(result?.resolvedGroups || 0) > 0 ? `Автоматически разобрано: ${result.resolvedGroups}.` : 'Очевидных безопасных совпадений больше нет.'
      setMessage(refreshIncomplete ? `${successMessage} Изменение сохранено, но часть экрана не обновилась. Нажмите «Обновить».` : successMessage)
      return { ...result, review: next }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось разобрать очевидные позиции.')
      return null
    } finally {
      setCatalogReviewBusy(false)
    }
  }

  async function loadCatalogReviewContext(orderItemId: number) {
    const response = await apiFetch(`/api/catalog/review/${orderItemId}/context`)
    const data = await readJsonResponse<CatalogResolutionContext>(response, 'Разбор позиции')
    if (!response.ok) throw new Error(data?.message || 'Не удалось определить, что именно требует уточнения.')
    return data
  }

  async function resolveCatalogReviewFacts(orderItemId: number, input: CatalogResolutionInput) {
    if (!isAdmin || !orderItemId || catalogReviewBusy) return null
    setCatalogReviewBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/catalog/review/${orderItemId}/resolve-facts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      })
      const result = await readJsonResponse<CatalogResolutionResponse>(response, 'Разбор позиции')
      if (!response.ok || result?.ok === false) throw new Error(result?.message || 'Не удалось разобрать позицию.')
      const createdReference = Array.isArray(input.createFields) && input.createFields.length > 0
      const refreshIncomplete = await settleCatalogReviewRefreshes([
        loadCatalogReview(true, catalogReview?.mode === 'order' ? Number(catalogReview.orderId || 0) : 0),
        loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false),
        createdReference ? loadReferencesData(true) : Promise.resolve(null), loadWarehouseAttention(false, true),
      ])
      setMessage(refreshIncomplete ? `${result?.message || 'Позиция разобрана.'} Изменение сохранено, но часть экрана не обновилась. Нажмите «Обновить».` : (result?.message || 'Позиция разобрана.'))
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось разобрать позицию.')
      return null
    } finally {
      setCatalogReviewBusy(false)
    }
  }

  async function excludeCatalogReviewItem(orderItemId: number) {
    if (!isAdmin || !orderItemId || catalogReviewBusy) return null
    setCatalogReviewBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/catalog/review/${orderItemId}/exclude`, { method: 'POST' })
      const result = await readJsonResponse<CatalogResolutionResponse>(response, 'Разбор позиции')
      if (!response.ok || result?.ok === false) throw new Error(result?.message || 'Не удалось оставить позицию вне каталога.')
      const refreshIncomplete = await settleCatalogReviewRefreshes([
        loadCatalogReview(true, catalogReview?.mode === 'order' ? Number(catalogReview.orderId || 0) : 0),
        loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false),
      ])
      setMessage(refreshIncomplete ? `${result?.message || 'Позиция оставлена только в заказе.'} Изменение сохранено, но часть экрана не обновилась. Нажмите «Обновить».` : (result?.message || 'Позиция оставлена только в заказе.'))
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось оставить позицию вне каталога.')
      return null
    } finally {
      setCatalogReviewBusy(false)
    }
  }

  async function loadInventoryLifecycle(force = false) {
    if (!isAdmin) {
      setInventoryLifecycle(null)
      return null
    }
    if (inventoryLifecycle && !force) return inventoryLifecycle
    setInventoryLifecycleBusy(true)
    try {
      const response = await apiFetch('/api/inventory/lifecycle/pending?limit=60')
      if (!response.ok) return null
      const data = await readJsonResponse<InventoryLifecyclePendingResponse>(response, 'Ожидающие складские движения')
      setInventoryLifecycle(data)
      return data
    } finally {
      setInventoryLifecycleBusy(false)
    }
  }

  async function loadInventoryLifecycleContext(eventId: number) {
    const response = await apiFetch(`/api/inventory/lifecycle/${eventId}/context`)
    const data = await readJsonResponse<CatalogResolutionContext>(response, 'Физическая позиция')
    if (!response.ok) throw new Error(data?.message || 'Не удалось определить, что именно нужно уточнить.')
    return data
  }

  async function resolveInventoryLifecycleFacts(eventId: number, input: CatalogResolutionInput) {
    if (!isAdmin || !eventId || inventoryLifecycleBusy) return null
    setInventoryLifecycleBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/inventory/lifecycle/${eventId}/resolve-facts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      })
      const result = await readJsonResponse<CatalogResolutionResponse>(response, 'Физическая позиция')
      if (!response.ok || result?.ok === false) throw new Error(result?.message || 'Не удалось применить складское движение.')
      const createdReference = Array.isArray(input.createFields) && input.createFields.length > 0
      await Promise.all([
        loadInventoryLifecycle(true),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        loadCatalogData(true),
        createdReference ? loadReferencesData(true) : Promise.resolve(null),
      ])
      setMessage(result?.message || 'Физическая позиция подтверждена и склад обновлён.')
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось применить складское движение.')
      return null
    } finally {
      setInventoryLifecycleBusy(false)
    }
  }

  async function reconcileKnownInventoryLifecycle(eventId: number) {
    if (!eventId) return null
    setError(null)
    try {
      const response = await apiFetch(`/api/inventory/lifecycle/${eventId}/reconcile-known`, { method: 'POST' })
      const result = await readJsonResponse<CatalogResolutionResponse>(response, 'Приёмка известной позиции')
      if (!response.ok || result?.ok === false) throw new Error(result?.message || 'Не удалось завершить приёмку.')
      await Promise.all([
        loadWarehouseAttention(true),
        isAdmin ? loadInventoryLifecycle(true) : Promise.resolve(null),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
      ])
      setMessage(result?.message || 'Приёмка завершена.')
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось завершить приёмку.')
      return null
    }
  }

  async function loadInventoryReservations(source: InventorySourceKey, variantId = 0, productId = 0): Promise<InventoryReservationsResponse> {
    if (!variantId && !productId) return { ok: true, source, variantId: 0, productId: 0, totalQuantity: 0, reservations: [] }
    const params = new URLSearchParams({ source })
    if (variantId) params.set('variantId', String(variantId))
    if (productId) params.set('productId', String(productId))
    const response = await apiFetch(`/api/inventory/reservations?${params.toString()}`)
    const data = await readJsonResponse<InventoryReservationsResponse>(response, 'Заказы по резерву')
    if (!response.ok) throw new Error(data?.message || 'Не удалось загрузить заказы, которые держат товар.')
    return data
  }

  async function loadInventoryStocktakeSessions(source: InventorySourceKey | '' = '') {
    const params = new URLSearchParams()
    if (source) params.set('source', source)
    const response = await apiFetch(`/api/inventory/stocktakes${params.toString() ? `?${params.toString()}` : ''}`)
    const data = await readJsonResponse<InventoryStocktakeSessionsResponse>(response, 'Активные ревизии')
    if (!response.ok) throw new Error(data?.message || 'Не удалось загрузить активные ревизии.')
    return data
  }

  async function loadInventoryStocktakeSession(sessionId: string) {
    const response = await apiFetch(`/api/inventory/stocktakes/${encodeURIComponent(sessionId)}`)
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Ревизия')
    if (!response.ok) throw new Error(data?.message || 'Не удалось загрузить ревизию.')
    return data
  }

  async function createInventoryStocktakeSession(source: InventorySourceKey, productIds: number[] = []) {
    const response = await apiFetch('/api/inventory/stocktakes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, productIds }),
    })
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Начало ревизии')
    if (!response.ok) throw new Error(data?.message || 'Не удалось начать ревизию.')
    return data
  }

  async function saveInventoryStocktakeCount(sessionId: string, itemId: number, countedQuantity: number | null) {
    const response = await apiFetch(`/api/inventory/stocktakes/${encodeURIComponent(sessionId)}/items/${itemId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ countedQuantity }),
    })
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Сохранение пересчёта')
    if (!response.ok) throw new Error(data?.message || 'Не удалось сохранить количество.')
    return data
  }

  async function addInventoryStocktakeVariant(sessionId: string, variantId: number) {
    const response = await apiFetch(`/api/inventory/stocktakes/${encodeURIComponent(sessionId)}/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variantId }),
    })
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Добавление товара в ревизию')
    if (!response.ok) throw new Error(data?.message || 'Не удалось добавить товар в ревизию.')
    return data
  }


  async function addInventoryStocktakeCombination(sessionId: string, input: {
    productId: number
    material: string
    length: string
    category: 'adult' | 'child'
    gender: string
    color: string
    size?: string
    sizes?: string[]
    createReferenceFields?: string[]
  }) {
    const response = await apiFetch(`/api/inventory/stocktakes/${encodeURIComponent(sessionId)}/items/combination`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Добавление комбинации в ревизию')
    if (!response.ok) throw new Error(data?.message || 'Не удалось добавить комбинацию товара в ревизию.')
    return data
  }

  async function loadInventoryCycleCounts(source: InventorySourceKey, limit = 12) {
    const params = new URLSearchParams({ source, limit: String(limit) })
    const response = await apiFetch(`/api/inventory/cycle-counts?${params.toString()}`)
    const data = await readJsonResponse<InventoryCycleCountSuggestionsResponse>(response, 'Короткие сверки')
    if (!response.ok) throw new Error(data?.message || 'Не удалось подобрать позиции для короткой сверки.')
    return data
  }

  async function applyInventoryCycleCounts(input: { source: InventorySourceKey; items: Array<{ variantId: number; expectedQuantity: number; countedQuantity: number }> }) {
    const response = await apiFetch('/api/inventory/cycle-counts/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })
    const data = await readJsonResponse<InventoryCycleCountApplyResponse>(response, 'Короткая сверка')
    if (!response.ok && data?.code !== 'changed' && data?.code !== 'stocktake_active') throw new Error(data?.message || 'Не удалось сохранить короткую сверку.')
    return data
  }

  async function quickInventoryStocktakeBatch(input: { source: InventorySourceKey; items: Array<{ variantId: number; expectedQuantity: number; countedQuantity: number }> }) {
    const response = await apiFetch('/api/inventory/stocktakes/quick-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })
    const data = await readJsonResponse<InventoryCycleCountApplyResponse>(response, 'Быстрая сверка')
    if (!response.ok && data?.code !== 'changed' && data?.code !== 'stocktake_active') throw new Error(data?.message || 'Не удалось сверить выбранные позиции.')
    return data
  }

  async function quickInventoryStocktake(input: { source: InventorySourceKey; variantId: number; expectedQuantity: number; countedQuantity: number }) {
    const response = await apiFetch('/api/inventory/stocktakes/quick', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })
    const data = await readJsonResponse<InventoryCycleCountApplyResponse>(response, 'Точечная сверка')
    if (!response.ok && data?.code !== 'changed') throw new Error(data?.message || 'Не удалось сверить количество.')
    return data
  }

  async function completeInventoryStocktakeSession(sessionId: string) {
    const response = await apiFetch(`/api/inventory/stocktakes/${encodeURIComponent(sessionId)}/complete`, { method: 'POST' })
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Завершение ревизии')
    if (!response.ok && data?.code !== 'recount_required' && data?.code !== 'unfilled') {
      throw new Error(data?.message || 'Не удалось завершить ревизию.')
    }
    return data
  }

  async function cancelInventoryStocktakeSession(sessionId: string) {
    const response = await apiFetch(`/api/inventory/stocktakes/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' })
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Отмена ревизии')
    if (!response.ok) throw new Error(data?.message || 'Не удалось отменить ревизию.')
    return data
  }

  async function resolveCatalogReviewItem(orderItemId: number, variantId: number) {
    if (!isAdmin || !orderItemId || !variantId || catalogReviewBusy) return false
    setCatalogReviewBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/catalog/review/${orderItemId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId }),
      })
      const result = await readJsonResponse<{ ok?: boolean; message?: string; linked?: number; reserved?: number; fulfilled?: number }>(response, 'Привязка товара')
      if (!response.ok || result.ok === false) throw new Error(result.message || 'Не удалось связать позицию с каталогом.')
      const refreshIncomplete = await settleCatalogReviewRefreshes([
        loadCatalogReview(true), loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false),
      ])
      const successMessage = result.message || `Позиция связана с каталогом${Number(result.linked || 0) > 1 ? `; одинаковых записей обработано: ${result.linked}` : ''}.`
      setMessage(refreshIncomplete ? `${successMessage} Изменение сохранено, но часть экрана не обновилась. Нажмите «Обновить».` : successMessage)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось связать позицию с каталогом.')
      return false
    } finally {
      setCatalogReviewBusy(false)
    }
  }

  async function loadInventoryAudit() {
    setInventoryAuditBusy(true)
    try {
      const response = await apiFetch('/api/inventory/audit')
      if (!response.ok) return null
      const data = await readJsonResponse<InventoryAuditResponse>(response, 'Проверка автосписания')
      setInventoryAudit(data)
      return data
    } finally {
      setInventoryAuditBusy(false)
    }
  }

  async function resolveInventoryAuditIssue(row: InventoryAuditResponse['missing'][number] | InventoryAuditResponse['resolved'][number], resolved = true) {
    if (!isAdmin || inventoryAuditBusy || !row?.issueKey) return
    if (resolved) {
      const question = 'Подтверждайте расхождение только после фактической сверки этой позиции. Система НЕ изменит остаток автоматически — она запомнит, что исторический разрыв проверен сотрудником. Продолжить?'
      if (!window.confirm(question)) return
    }
    setInventoryAuditBusy(true)
    setError(null)
    try {
      const response = await apiFetch('/api/inventory/audit/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueKey: row.issueKey,
          resolved,
          comment: resolved ? 'Фактический остаток проверен сотрудником после сверки.' : 'Проблема возвращена в активную проверку.',
        }),
      })
      if (!response.ok) throw new Error('Не удалось сохранить результат сверки.')
      const data = await readJsonResponse<InventoryAuditResponse>(response, 'Результат сверки склада')
      setInventoryAudit(data)
      setMessage(resolved ? 'Расхождение отмечено как проверенное. Остаток автоматически не изменялся.' : 'Расхождение снова требует проверки.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить результат сверки.')
    } finally {
      setInventoryAuditBusy(false)
    }
  }

  async function loadInventoryControlSettings() {
    const response = await apiFetch('/api/inventory/settings')
    if (!response.ok) return null
    const data = await readJsonResponse<InventoryControlSettings>(response, 'Настройки склада')
    setInventoryControlSettings(data)
    return data
  }

  async function toggleInventoryAutoWriteoff() {
    if (!isAdmin || inventoryControlBusy) return
    const nextEnabled = !(inventoryControlSettings?.autoWriteoffEnabled ?? true)
    const question = nextEnabled
      ? 'Включить автосписание? Новые заказы со склада и бутика снова будут сразу менять остатки.'
      : 'Выключить автосписание? Новые заказы сохранятся, но остатки не изменятся, пока администратор не запустит отложенное списание.'
    if (!window.confirm(question)) return
    setInventoryControlBusy(true)
    setError(null)
    try {
      const response = await apiFetch('/api/inventory/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoWriteoffEnabled: nextEnabled }),
      })
      const data = await readJsonResponse<InventoryControlSettings>(response, 'Настройки склада')
      setInventoryControlSettings(data)
      setMessage(nextEnabled ? 'Автосписание включено.' : 'Автосписание выключено. Новые заказы не меняют остатки.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить автосписание.')
    } finally {
      setInventoryControlBusy(false)
    }
  }

  async function applyPendingInventoryWriteoffs() {
    if (!isAdmin || inventoryControlBusy) return
    const pending = inventoryControlSettings?.pendingWriteoffCount || 0
    if (!pending) {
      setMessage('Отложенных списаний нет.')
      return
    }
    if (!window.confirm(`Списать остатки по ${pending} отложенным позициям заказов? Заказы не удаляются и не меняются.`)) return
    setInventoryControlBusy(true)
    setError(null)
    try {
      const response = await apiFetch('/api/inventory/pending-writeoffs/apply', { method: 'POST' })
      const data = await readJsonResponse<{ ok: boolean; applied: number; reconciled?: number; pendingWriteoffCount: number }>(response, 'Отложенное списание')
      setInventoryControlSettings((current) => current ? { ...current, pendingWriteoffCount: data.pendingWriteoffCount } : current)
      await Promise.all([
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
      ])
      const reconciled = Number(data.reconciled || 0)
      setMessage(`Списано позиций: ${data.applied}.${reconciled ? ` Уже учтено ранее и безопасно синхронизировано: ${reconciled}.` : ''} Осталось: ${data.pendingWriteoffCount}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить отложенное списание.')
    } finally {
      setInventoryControlBusy(false)
    }
  }

  async function reverseInventoryMovement(movement: InventoryMovementRecord) {
    if (!isAdmin || !movement.canReverse || reversingInventoryMovementId) return
    const label = `${movement.productName} · ${movement.quantityDelta >= 0 ? '+' : ''}${movement.quantityDelta}`
    if (!window.confirm(`Отменить складскую операцию «${label}»? Остаток будет восстановлен обратным движением. Заказ, возврат или обмен останется в системе.`)) return
    setReversingInventoryMovementId(movement.id)
    setError(null)
    try {
      const response = await apiFetch(`/api/inventory/movements/${movement.id}/reverse?returnInventory=0`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: 'Отменено из журнала склада' }),
      })
      const data = await readJsonResponse<{ ok: boolean; reversedRows: number }>(response, 'Отмена складской операции')
      await Promise.all([
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        loadInventoryControlSettings(),
      ])
      setMessage(`Операция отменена. Восстановлено движений: ${data.reversedRows}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отменить складскую операцию.')
    } finally {
      setReversingInventoryMovementId(null)
    }
  }

  async function loadWorkshopData(
    nextFilters = workshopFilters,
    options: { force?: boolean; refreshCounts?: boolean } = { force: true, refreshCounts: true },
  ) {
    const data = await loadWorkshopRead(nextFilters, workshopSortDirection, options)
    if (data) setSelectedWorkshopTaskIds((current) => current.filter((id) => data.tasks.some((task) => task.id === id)))
    return data
  }

  async function loadReturnHistory(options: { append?: boolean; filters?: typeof returnHistoryFilters } = {}) {
    const nextFilters = options.filters || returnHistoryFilters
    const append = Boolean(options.append)
    setReturnHistoryBusy(true)
    setReturnHistoryError('')
    try {
      const params = new URLSearchParams({ limit: '50', offset: append ? String(returnHistory.length) : '0' })
      if (nextFilters.q.trim()) params.set('q', nextFilters.q.trim())
      if (nextFilters.dateFrom) params.set('dateFrom', nextFilters.dateFrom)
      if (nextFilters.dateTo) params.set('dateTo', nextFilters.dateTo)
      if (nextFilters.status !== 'all') params.set('status', nextFilters.status)
      const response = await apiFetch(`/api/returns?${params.toString()}`)
      const data = await readJsonResponse<ReturnHistoryResponse>(response, 'История возвратов')
      if (!response.ok) throw new Error('Не удалось загрузить историю возвратов.')
      const rows = Array.isArray(data.returns) ? data.returns : []
      setReturnHistory((current) => append ? [...current, ...rows] : rows)
      setReturnHistoryHasMore(Boolean(data.hasMore))
      setReturnHistorySummary({
        activeCount: Number(data.summary?.activeCount || 0),
        cancelledCount: Number(data.summary?.cancelledCount || 0),
        activeAmount: Number(data.summary?.activeAmount || 0),
        count: Number(data.count || 0),
      })
      return rows
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить историю возвратов.'
      setReturnHistoryError(message)
      reportReadFailure(err, 'История возвратов', returnHistory.length > 0)
      return null
    } finally {
      setReturnHistoryBusy(false)
    }
  }

  async function loadExchangeHistory(options: { append?: boolean; filters?: typeof exchangeHistoryFilters } = {}) {
    const nextFilters = options.filters || exchangeHistoryFilters
    const append = Boolean(options.append)
    setExchangeHistoryBusy(true)
    setExchangeHistoryError('')
    try {
      const params = new URLSearchParams({ limit: '50', offset: append ? String(exchangeHistory.length) : '0' })
      if (nextFilters.q.trim()) params.set('q', nextFilters.q.trim())
      if (nextFilters.dateFrom) params.set('dateFrom', nextFilters.dateFrom)
      if (nextFilters.dateTo) params.set('dateTo', nextFilters.dateTo)
      if (nextFilters.status !== 'all') params.set('status', nextFilters.status)
      const response = await apiFetch(`/api/exchanges?${params.toString()}`)
      const data = await readJsonResponse<ExchangeHistoryResponse>(response, 'История обменов')
      if (!response.ok) throw new Error('Не удалось загрузить историю обменов.')
      const rows = Array.isArray(data.exchanges) ? data.exchanges : []
      setExchangeHistory((current) => append ? [...current, ...rows] : rows)
      setExchangeHistoryHasMore(Boolean(data.hasMore))
      setExchangeHistorySummary({ activeCount: Number(data.summary?.activeCount || 0), cancelledCount: Number(data.summary?.cancelledCount || 0), count: Number(data.count || 0) })
      return rows
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить историю обменов.'
      setExchangeHistoryError(message)
      return null
    } finally {
      setExchangeHistoryBusy(false)
    }
  }

  async function loadInventoryHistory(input: { source?: string; variantId?: number; q?: string; beforeId?: number; limit?: number } = {}) {
    const params = new URLSearchParams({ limit: String(input.limit || 50) })
    if (input.source) params.set('source', input.source)
    if (input.variantId) params.set('variantId', String(input.variantId))
    if (input.q?.trim()) params.set('q', input.q.trim())
    if (input.beforeId) params.set('beforeId', String(input.beforeId))
    const response = await apiFetch(`/api/inventory/history?${params.toString()}`)
    const data = await readJsonResponse<InventoryHistoryResponse>(response, 'История склада')
    if (!response.ok) throw new Error('Не удалось загрузить историю склада.')
    return data
  }

  async function loadInventoryCheckHistory(input: { source?: string; variantId?: number; limit?: number } = {}) {
    const params = new URLSearchParams({ limit: String(input.limit || 30) })
    if (input.source) params.set('source', input.source)
    if (input.variantId) params.set('variantId', String(input.variantId))
    const response = await apiFetch(`/api/inventory/check-history?${params.toString()}`)
    const data = await readJsonResponse<InventoryCheckHistoryResponse>(response, 'Ревизии и сверки')
    if (!response.ok) throw new Error('Не удалось загрузить ревизии и сверки.')
    return data
  }

  async function loadActivityLog(nextFilters = activityFilters) {
    setActivityBusy(true)
    try {
      const params = new URLSearchParams({
        limit: '200',
        q: nextFilters.q.trim(),
        eventType: nextFilters.eventType,
      })
      const orderId = Number(nextFilters.orderId || 0)
      if (orderId > 0) params.set('orderId', String(orderId))
      const response = await apiFetch(`/api/activity?${params.toString()}`)
      const data = await readJsonResponse<{ ok?: boolean; activities?: ActivityLogEntry[] }>(response, 'Журнал действий')
      if (!response.ok) throw new Error('Не удалось загрузить журнал действий.')
      setActivityLog(Array.isArray(data.activities) ? data.activities : [])
      return data
    } catch (err) {
      reportReadFailure(err, 'Журнал действий', activityLog.length > 0)
      return null
    } finally {
      setActivityBusy(false)
    }
  }

  function refreshActivityLogIfVisible() {
    if (activeSector === 'orders' && orderPanel === 'activity') {
      return loadActivityLog()
    }
    return Promise.resolve(null)
  }

  function loadOrdersFinanceSummary(nextFilters = filters, force = false) {
    return loadOrdersFinanceSummaryForRange(nextFilters, force)
  }

  function loadFinanceReports(nextFilters = financeReportFilters, options: { force?: boolean; scope?: 'full' | 'finance' } = {}) {
    const scope = options.scope || (activeSector === 'finance' ? 'finance' : 'full')
    return loadFinanceReportsForRange(nextFilters, { ...options, scope })
  }

  async function loadMoneyHistory(options: { append?: boolean } = {}) {
    const append = Boolean(options.append)
    if (!financeReportFilters.dateFrom || !financeReportFilters.dateTo) return null
    const requestId = ++moneyHistoryRequestIdRef.current
    const offset = append ? moneyHistory.length : 0
    const currentMonthStart = `${formatLocalDateInput().slice(0, 7)}-01`
    const includeLegacy = financeReportFilters.dateFrom < currentMonthStart
    const effectiveTrace = !includeLegacy && moneyHistoryType.trace === 'legacy' ? 'all' : moneyHistoryType.trace
    setMoneyHistoryBusy(true)
    setMoneyHistoryError('')
    try {
      const params = new URLSearchParams({
        dateFrom: financeReportFilters.dateFrom,
        dateTo: financeReportFilters.dateTo,
        q: moneyHistoryQuery.trim(),
        flow: moneyHistoryType.flow,
        operation: moneyHistoryType.operation,
        trace: effectiveTrace,
        includeLegacy: includeLegacy ? '1' : '0',
        limit: '50',
        offset: String(offset),
      })
      const response = await apiFetch(`/api/finance/money-history?${params.toString()}`)
      const data = await readJsonResponse<FinancialHistoryResponse & { message?: string }>(response, 'История денег')
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить историю денег.')
      if (requestId !== moneyHistoryRequestIdRef.current) return data
      setMoneyHistory((current) => append ? [...current, ...(data.events || [])] : (data.events || []))
      setMoneyHistoryHasMore(Boolean(data.hasMore))
      setMoneyHistorySummary({
        count: Number(data.count || 0),
        totalIn: Number(data.summary?.totalIn || 0),
        totalOut: Number(data.summary?.totalOut || 0),
        net: Number(data.summary?.net || 0),
      })
      return data
    } catch (err) {
      if (requestId === moneyHistoryRequestIdRef.current) {
        setMoneyHistoryError(err instanceof Error ? err.message : 'Не удалось загрузить историю денег.')
        if (!append) setMoneyHistory([])
      }
      return null
    } finally {
      if (requestId === moneyHistoryRequestIdRef.current) setMoneyHistoryBusy(false)
    }
  }

  function refreshFinanceReportsIfVisible() {
    invalidateFinanceReadCaches()
    if (activeSector === 'finance' || activeSector === 'reports') {
      if (activeSector === 'finance' && financeMode === 'payments') void loadMoneyHistory()
      return loadFinanceReportsForRange(financeReportFilters, { force: true, scope: activeSector === 'finance' ? 'finance' : 'full' })
    }
    return Promise.resolve(null)
  }

  function reloadFinanceReports() {
    return loadFinanceReportsForRange(financeReportFilters, { force: true, scope: activeSector === 'finance' ? 'finance' : 'full' })
  }

  function makeCashRequestId(prefix: string) {
    const cryptoId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    return `${prefix}-${cryptoId}`
  }

  async function runCashMutation<T>(action: () => Promise<T>) {
    if (cashMutationLockRef.current) return null
    cashMutationLockRef.current = true
    setCashRegisterBusy(true)
    setError(null)
    setMessage(null)
    try {
      return await action()
    } finally {
      cashMutationLockRef.current = false
      setCashRegisterBusy(false)
    }
  }

  async function loadCashRegister() {
    setCashRegisterBusy(true)
    try {
      const response = await apiFetch('/api/finance/cash-register')
      const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Инкассация')
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить кассу.')
      setCashRegister(data)
      if (data.initialized) setCashReconcileAmount(Number(data.currentBalance || 0))
      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить инкассацию.')
      return null
    } finally {
      setCashRegisterBusy(false)
    }
  }

  async function loadCashRegisterCycles(append = false) {
    setCashRegisterCyclesBusy(true)
    try {
      const offset = append ? cashRegisterCycles.length : 0
      const response = await apiFetch(`/api/finance/cash-register/cycles?limit=12&offset=${offset}`)
      const data = await readJsonResponse<CashRegisterCyclesResponse & { message?: string }>(response, 'Прошлые циклы кассы')
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить прошлые циклы кассы.')
      const nextCycles = Array.isArray(data.cycles) ? data.cycles : []
      setCashRegisterCycles((current) => append ? [...current, ...nextCycles] : nextCycles)
      setCashRegisterCyclesHasMore(Boolean(data.hasMore))
      return nextCycles
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить прошлые циклы кассы.')
      return []
    } finally {
      setCashRegisterCyclesBusy(false)
    }
  }

  async function setupCashRegister() {
    const amount = Math.max(0, Math.trunc(Number(cashSetupAmount || 0)))
    if (!window.confirm(`Зафиксировать начальный остаток наличных ${formatMoney(amount)}?`)) return
    await runCashMutation(async () => {
      try {
        const response = await apiFetch('/api/finance/cash-register/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount }),
        })
        const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Настройка инкассации')
        if (!response.ok) throw new Error(data.message || 'Не удалось установить начальный остаток.')
        setCashRegister(data)
        setCashReconcileAmount(data.currentBalance)
        setMessage('Начальный остаток сохранён. Автоучёт пока выключен.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось установить начальный остаток.')
      }
    })
  }

  async function setCashAutoTracking(enabled: boolean) {
    const prompt = enabled
      ? 'Включить автоучёт? Новые наличные оплаты будут увеличивать кассу, а возвраты наличными — уменьшать.'
      : 'Остановить автоучёт? Журнал, ручные операции и сверка остатка останутся доступны, но новые операции по заказам временно не будут менять кассу автоматически.'
    if (!window.confirm(prompt)) return
    await runCashMutation(async () => {
      try {
        const response = await apiFetch('/api/finance/cash-register/auto-tracking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        })
        const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Автоучёт наличных')
        if (!response.ok) throw new Error(data.message || 'Не удалось изменить состояние автоучёта.')
        setCashRegister(data)
        setMessage(enabled ? 'Автоучёт наличных включён.' : 'Автоучёт остановлен. Ручной учёт и журнал продолжают работать.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось изменить состояние автоучёта.')
      }
    })
  }

  async function activateCashRegister() {
    return setCashAutoTracking(true)
  }

  async function saveCashRegisterMovement() {
    const amount = Math.max(0, Math.trunc(Number(cashMovementDraft.amount || 0)))
    const comment = cashMovementDraft.comment.trim()
    if (amount <= 0) {
      setError('Укажите сумму больше нуля.')
      return
    }
    if (!comment) {
      setError('Комментарий обязателен: укажите, куда ушли или откуда пришли наличные.')
      return
    }
    if (cashMovementDraft.direction === 'out' && cashRegister && amount > cashRegister.currentBalance) {
      setError(`По учёту в кассе только ${formatMoney(cashRegister.currentBalance)}.`)
      return
    }
    if (cashMovementDraft.direction === 'out' && !window.confirm(`Выдать из кассы ${formatMoney(amount)}?\n\n${comment}`)) return
    const requestId = makeCashRequestId('manual')
    await runCashMutation(async () => {
      try {
        const response = await apiFetch('/api/finance/cash-register/movements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction: cashMovementDraft.direction, amount, comment, requestId }),
        })
        const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Ручное движение наличных')
        if (!response.ok) throw new Error(data.message || 'Не удалось сохранить движение наличных.')
        setCashRegister(data)
        setCashReconcileAmount(data.currentBalance)
        setCashMovementDraft((current) => ({ ...current, amount: 0, comment: '' }))
        setMessage(cashMovementDraft.direction === 'in' ? 'Внесение наличных записано.' : 'Выдача наличных записана.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось сохранить движение наличных.')
      }
    })
  }

  async function reconcileCashRegister() {
    if (!cashRegister?.initialized) return
    const amount = Math.max(0, Math.trunc(Number(cashReconcileAmount || 0)))
    const comment = cashReconcileComment.trim()
    if (!comment) {
      setError('Для сверки укажите причину изменения остатка.')
      return
    }
    if (amount === cashRegister.currentBalance) {
      setMessage('Фактический остаток уже совпадает с учётом.')
      return
    }
    if (!window.confirm(`Установить фактический остаток ${formatMoney(amount)}?\n\nСистема запишет только разницу отдельной строкой журнала.\nПричина: ${comment}`)) return
    const requestId = makeCashRequestId('reconcile')
    await runCashMutation(async () => {
      try {
        const response = await apiFetch('/api/finance/cash-register/reconcile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, comment, requestId }),
        })
        const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Сверка кассы')
        if (!response.ok) throw new Error(data.message || 'Не удалось скорректировать остаток.')
        setCashRegister(data)
        setCashReconcileAmount(data.currentBalance)
        setCashReconcileComment('')
        setMessage('Фактический остаток кассы обновлён. Разница сохранена в журнале.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось скорректировать остаток.')
      }
    })
  }

  async function reverseCashRegisterMovement(entryId: number) {
    if (!window.confirm('Отменить эту ручную операцию? Исходная строка останется в истории, а система добавит обратную запись.')) return
    await runCashMutation(async () => {
      try {
        const response = await apiFetch(`/api/finance/cash-register/movements/${entryId}/reverse`, { method: 'POST' })
        const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Отмена ручной операции')
        if (!response.ok) throw new Error(data.message || 'Не удалось отменить ручную операцию.')
        setCashRegister(data)
        setCashReconcileAmount(data.currentBalance)
        setMessage('Ручная операция отменена обратной записью.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось отменить ручную операцию.')
      }
    })
  }

  async function resetCashRegisterCycle() {
    if (!isAdmin) {
      setError('Начать новый цикл учёта может только администратор.')
      return
    }
    const comment = window.prompt('Причина сброса текущего журнала:', 'Перезапуск учёта наличных после сверки')?.trim() || ''
    if (!comment) return
    if (!window.confirm('Обнулить текущую кассу и начать новый чистый цикл?\n\nСтарые записи НЕ удалятся из базы, но будут отделены от нового журнала. Автоучёт будет остановлен.')) return
    await runCashMutation(async () => {
      try {
        const response = await apiFetch('/api/finance/cash-register/reset-cycle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment }),
        })
        const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Сброс кассы')
        if (!response.ok) throw new Error(data.message || 'Не удалось начать новый цикл кассы.')
        setCashRegister(data)
        setCashReconcileAmount(0)
        setCashReconcileComment('')
        setCashMovementDraft((current) => ({ ...current, amount: 0, comment: '' }))
        setMessage('Начат новый цикл кассы с 0 ₸. Старый журнал сохранён в базе. Автоучёт выключен.')
        if (cashRegisterCyclesOpen) void loadCashRegisterCycles()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось начать новый цикл кассы.')
      }
    })
  }

  async function loadFinancePaymentMethods(force = false) {
    if (financePaymentMethods.length && !force) return financePaymentMethods
    setFinanceMethodsBusy(true)
    try {
      const response = await apiFetch('/api/reference-values?kind=paymentMethods')
      const data = await readJsonResponse<{ ok?: boolean; items?: ReferenceListItem[] }>(response, 'Способы оплаты')
      if (!response.ok) throw new Error('Не удалось загрузить способы оплаты.')
      const rows = Array.isArray(data.items) ? data.items : []
      setFinancePaymentMethods(rows)
      return rows
    } catch (err) {
      reportReadFailure(err, 'Способы оплаты', financePaymentMethods.length > 0)
      return []
    } finally {
      setFinanceMethodsBusy(false)
    }
  }

  async function saveFinancePaymentMethod() {
    if (!isAdmin) {
      setError('Изменение способов оплаты доступно только администратору.')
      return null
    }
    const value = normalizeSuggestion(financeMethodDraft.value)
    if (!value) {
      setError('Введите способ оплаты.')
      return null
    }

    const isEdit = financeMethodDraft.id > 0
    const response = await apiFetch(isEdit ? `/api/reference-values/${financeMethodDraft.id}` : '/api/reference-values', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'paymentMethods',
        value,
        sortOrder: Number(financeMethodDraft.sortOrder || 0),
        isActive: true,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(text || 'Не удалось сохранить способ оплаты.')
    }

    setFinanceMethodDraft({ id: 0, value: '', sortOrder: '0', isActive: true })
    await Promise.all([loadFinancePaymentMethods(true), loadReferencesData(true)])
    setMessage('Способ оплаты обновлён. Формы заказов, долгов и обменов будут брать список отсюда.')
    return readJsonResponse(response, 'Способ оплаты')
  }

  async function removeFinancePaymentMethod(id: number) {
    if (!isAdmin) {
      setError('Удаление способа оплаты доступно только администратору.')
      return
    }
    if (!id) return
    const response = await apiFetch(`/api/reference-values/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'paymentMethods' }),
    })
    if (!response.ok) throw new Error('Не удалось отключить способ оплаты.')
    if (financeMethodDraft.id === id) {
      setFinanceMethodDraft({ id: 0, value: '', sortOrder: '0', isActive: true })
    }
    await Promise.all([loadFinancePaymentMethods(true), loadReferencesData(true)])
    setMessage('Способ оплаты отключён.')
  }

  async function loadTeamEmployees() {
    setTeamBusy(true)
    try {
      const response = await apiFetch('/api/team')
      const data = await readJsonResponse<{ ok?: boolean; employees?: TeamEmployee[] }>(response, 'Команда')
      if (!response.ok) throw new Error('Не удалось загрузить команду.')
      setTeamEmployees(Array.isArray(data.employees) ? data.employees : [])
      return data
    } catch (err) {
      reportReadFailure(err, 'Команда', teamEmployees.length > 0)
      return null
    } finally {
      setTeamBusy(false)
    }
  }

  async function saveTeamEmployee() {
    if (!isAdmin) {
      setError('Изменение команды доступно только администратору.')
      return
    }

    setTeamBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/team/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(teamDraft),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Сотрудник')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить сотрудника.')
      setTeamDraft({ id: 0, name: '', role: 'Менеджер', phone: '', colorKey: '#2563EB', hiredAt: formatLocalDateInput(), comment: '', isActive: true })
      await Promise.all([loadTeamEmployees(), loadReferencesData(true)])
      setTeamFormOpen(false)
      setMessage('Сотрудник сохранён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения сотрудника')
    } finally {
      setTeamBusy(false)
    }
  }

  async function saveTeamEmployeeColor(employee: TeamEmployee, colorKey: string) {
    if (!isAdmin || !employee?.id) return
    const normalizedColor = resolveManagerDisplayColor(colorKey, employee.id)
    setTeamBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/team/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: employee.id,
          name: employee.name,
          role: employee.role || 'Менеджер',
          phone: employee.phone || '',
          colorKey: normalizedColor,
          hiredAt: employee.hiredAt || formatLocalDateInput(),
          comment: employee.comment || '',
          isActive: employee.isActive,
        }),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Цвет сотрудника')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить цвет сотрудника.')
      setTeamEmployees((current) => current.map((item) => item.id === employee.id ? { ...item, colorKey: normalizedColor } : item))
      if (teamDraft.id === employee.id) setTeamDraft((draft) => ({ ...draft, colorKey: normalizedColor }))
      setTeamColorEditorId(null)
      void loadReferencesData(true)
      setMessage(`Цвет сотрудника ${employee.name} обновлён.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения цвета сотрудника')
    } finally {
      setTeamBusy(false)
    }
  }

  async function setTeamEmployeeEmploymentStatus(employee: TeamEmployee, isActive: boolean) {
    if (!isAdmin) {
      setError('Изменение статуса сотрудника доступно только администратору.')
      return
    }
    if (!employee?.id) return
    const confirmation = isActive
      ? `Вернуть сотрудника ${employee.name} в активную команду? Он снова появится в новых заказах и назначениях.`
      : `Отметить сотрудника ${employee.name} как уволенного? Старые заказы, планы, выплаты и отчёты сохранятся.`
    if (!window.confirm(confirmation)) return

    setTeamBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch(`/api/team/employees/${employee.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Статус сотрудника')
      if (teamDraft.id === employee.id) {
        setTeamDraft((draft) => ({ ...draft, isActive }))
      }
      await Promise.all([loadTeamEmployees(), loadReferencesData(true)])
      setMessage(data.message || (isActive ? 'Сотрудник возвращён в команду.' : 'Сотрудник отмечен как уволенный.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить статус сотрудника.')
    } finally {
      setTeamBusy(false)
    }
  }

  async function removeTeamEmployee(employee: TeamEmployee) {
    if (!isAdmin) {
      setError('Удаление сотрудников доступно только администратору.')
      return
    }
    if (!employee?.id) return
    if (!window.confirm(`Удалить сотрудника ${employee.name}? Если по нему есть заказы, планы или отчёты, система не даст удалить и предложит отметить его как уволенного.`)) return
    setTeamBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch(`/api/team/employees/${employee.id}`, { method: 'DELETE' })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Удаление сотрудника')
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить сотрудника.')
      if (teamDraft.id === employee.id) setTeamDraft({ id: 0, name: '', role: 'Менеджер', phone: '', colorKey: '#2563EB', hiredAt: formatLocalDateInput(), comment: '', isActive: true })
      await Promise.all([loadTeamEmployees(), loadReferencesData(true)])
      setMessage(data.message || 'Сотрудник удалён из команды.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления сотрудника')
    } finally {
      setTeamBusy(false)
    }
  }

  function getTimesheetMonthDays(monthValue = timesheetMonth) {
    const [yearText, monthText] = monthValue.split('-')
    const year = Number(yearText)
    const month = Number(monthText)
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return Array.from({ length: lastDay }, (_, index) => `${yearText}-${monthText}-${String(index + 1).padStart(2, '0')}`)
  }


  function shiftTimesheetMonth(offset: number) {
    const [yearText, monthText] = timesheetMonth.split('-')
    const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + offset, 1))
    setTimesheetMonth(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`)
    setTimesheetSelectedDays([])
  }

  function setTimesheetCurrentMonth() {
    setTimesheetMonth(new Date().toISOString().slice(0, 7))
    setTimesheetSelectedDays([])
  }

  function getTimesheetCalendarSlots() {
    const days = getTimesheetMonthDays()
    const first = days[0]
    const firstOffset = first ? ((new Date(`${first}T00:00:00`).getDay() + 6) % 7) : 0
    return [...Array.from({ length: firstOffset }, () => ''), ...days]
  }

  function getTimesheetWeekdayLabel(date: string) {
    const labels = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
    return labels[new Date(`${date}T00:00:00`).getDay()] || ''
  }

  function getTimesheetEntriesForDate(date: string) {
    return (timesheetData?.entries || []).filter((entry) => entry.date === date)
  }

  function editManagerPlan(row: ManagerPlanRecord) {
    setManagerPlanDraft({
      id: row.id,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      managerId: Number(row.managerId || 0),
      managerName: row.manager,
      plannedAmount: row.plannedAmount,
      salaryBase: row.salaryBase || 100000,
      comment: row.comment || '',
    })
  }

  function editDepartmentPlan(row: DepartmentPlanRecord) {
    setDepartmentPlanDraft({
      id: row.id,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      plannedAmount: row.plannedAmount,
      comment: row.comment || '',
    })
  }

  async function deleteManagerPlan(id: number) {
    if (!isAdmin || !id || !confirm('Удалить план менеджера?')) return
    setPlanBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/plans/${id}`, { method: 'DELETE' })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'План менеджера')
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить план менеджера.')
      await Promise.all([loadPlans(), refreshFinanceReportsIfVisible()])
      setMessage('План менеджера удалён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления плана')
    } finally {
      setPlanBusy(false)
    }
  }

  async function deleteDepartmentPlan(id: number) {
    if (!isAdmin || !id || !confirm('Удалить план отдела?')) return
    setPlanBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/department-plans/${id}`, { method: 'DELETE' })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'План отдела')
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить план отдела.')
      await Promise.all([loadPlans(), refreshFinanceReportsIfVisible()])
      setMessage('План отдела удалён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления плана отдела')
    } finally {
      setPlanBusy(false)
    }
  }

  async function loadTeamTimesheet(monthValue = timesheetMonth) {
    setTimesheetBusy(true)
    try {
      const response = await apiFetch(`/api/team/timesheet?month=${encodeURIComponent(monthValue)}`)
      const data = await readJsonResponse<TeamTimesheetResponse>(response, 'Табель')
      if (!response.ok) throw new Error('Не удалось загрузить табель.')
      setTimesheetData(data)
      return data
    } catch (err) {
      reportReadFailure(err, 'Табель', Boolean(timesheetData))
      return null
    } finally {
      setTimesheetBusy(false)
    }
  }

  async function saveTeamTimesheet(clear = false) {
    if (!isAdmin) {
      setError('Изменение табеля доступно только администратору.')
      return
    }

    setTimesheetBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/team/timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dates: timesheetSelectedDays,
          managerIds: timesheetSelectedManagers,
          workUntil: timesheetWorkUntil,
          comment: timesheetComment,
          clear,
        }),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Табель')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить табель.')
      await Promise.all([loadTeamTimesheet(), loadTeamSalaryReport(), refreshActivityLogIfVisible()])
      setMessage(clear ? 'Выбранные назначения табеля очищены.' : 'Табель сохранён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения табеля')
    } finally {
      setTimesheetBusy(false)
    }
  }

  async function loadTeamSalaryReport(nextFilters = teamSalaryFilters) {
    setTeamBusy(true)
    try {
      const params = new URLSearchParams({ startDate: nextFilters.dateFrom, endDate: nextFilters.dateTo })
      const response = await apiFetch(`/api/team/salary?${params.toString()}`)
      const data = await readJsonResponse<TeamSalaryResponse>(response, 'Зарплата команды')
      if (!response.ok) throw new Error('Не удалось загрузить зарплату команды.')
      setTeamSalaryReport(data)
      return data
    } catch (err) {
      reportReadFailure(err, 'Отчёт по зарплате', Boolean(teamSalaryReport))
      return null
    } finally {
      setTeamBusy(false)
    }
  }


  async function loadTeamActivityReport(nextFilters = teamActivityFilters, options: { append?: boolean } = {}) {
    const append = Boolean(options.append)
    setTeamActivityBusy(true)
    setTeamActivityLoadFailed(false)
    try {
      const offset = append ? Number(teamActivityReport?.rows?.length || 0) : 0
      const params = new URLSearchParams({
        startDate: nextFilters.dateFrom,
        endDate: nextFilters.dateTo,
        q: nextFilters.q.trim(),
        actionType: nextFilters.actionType,
        limit: '50',
        offset: String(offset),
      })
      const response = await apiFetch(`/api/team/activity?${params.toString()}`)
      const data = await readJsonResponse<TeamActivityResponse>(response, 'Работа с заказами')
      if (!response.ok) throw new Error('Не удалось загрузить работу с заказами.')
      setTeamActivityReport((current) => append && current
        ? { ...data, rows: [...(current.rows || []), ...(data.rows || [])] }
        : data)
      setTeamActivityLoadFailed(false)
      return data
    } catch (err) {
      setTeamActivityLoadFailed(true)
      reportReadFailure(err, 'Работа с заказами', Boolean(teamActivityReport))
      return null
    } finally {
      setTeamActivityBusy(false)
    }
  }

  function setTimesheetDaysPreset(kind: 'all' | 'weekdays' | 'weekends' | 'odd' | 'even' | 'clear') {
    const days = getTimesheetMonthDays()
    if (kind === 'clear') {
      setTimesheetSelectedDays([])
      return
    }
    const filtered = days.filter((date) => {
      const dayNumber = Number(date.slice(-2))
      const dayOfWeek = new Date(`${date}T00:00:00`).getDay()
      if (kind === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5
      if (kind === 'weekends') return dayOfWeek === 0 || dayOfWeek === 6
      if (kind === 'odd') return dayNumber % 2 === 1
      if (kind === 'even') return dayNumber % 2 === 0
      return true
    })
    setTimesheetSelectedDays(filtered)
  }

  function toggleTimesheetDay(date: string) {
    setTimesheetSelectedDays((current) => current.includes(date) ? current.filter((entry) => entry !== date) : [...current, date])
  }

  function toggleTimesheetManager(id: number) {
    setTimesheetSelectedManagers((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])
  }

  

  

  

  

  

  

  


  function getExportElementHtml(elementId: string) {
    const element = document.getElementById(elementId)
    if (!element) {
      setError('Сначала сформируй отчёт, потом скачивай его.')
      return ''
    }
    return element.innerHTML
  }

  function downloadWordDocument(filename: string, title: string, bodyHtml: string) {
    const blob = new Blob(['\ufeff', makeExportHtml(title, bodyHtml)], { type: 'application/msword;charset=utf-8' })
    downloadBlobFile(blob, `${filename}.doc`)
  }

  function exportElementWord(elementId: string, filename: string, title: string) {
    const bodyHtml = getExportElementHtml(elementId)
    if (!bodyHtml) return
    downloadWordDocument(filename, title, bodyHtml)
  }

  function printHtmlDocument(title: string, bodyHtml: string) {
    const iframe = document.createElement('iframe')
    iframe.title = title
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.visibility = 'hidden'
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document
    if (!doc) {
      iframe.remove()
      setError('Не удалось подготовить печать. Попробуйте ещё раз.')
      return
    }

    doc.open()
    doc.write(makeExportHtml(title, bodyHtml))
    doc.close()

    const doPrint = () => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
        window.setTimeout(() => iframe.remove(), 1200)
      } catch {
        iframe.remove()
        setError('Не удалось открыть печать. Проверьте настройки браузера.')
      }
    }

    window.setTimeout(doPrint, 80)
  }

  function printElementPdf(elementId: string, title: string) {
    const bodyHtml = getExportElementHtml(elementId)
    if (!bodyHtml) return
    printHtmlDocument(title, bodyHtml)
  }

    function exportPlanReportWord() {
    exportElementWord('planReportExport', `plan-report-${planFilters.dateFrom}-${planFilters.dateTo}`, 'План и зарплата')
  }

  function printPlanReportPdf() {
    printElementPdf('planReportExport', 'План и зарплата')
  }

  function printInventoryStocktakePdf() {
    printElementPdf('inventoryStocktakePrint', 'Ревизия остатков')
  }


  function exportTeamPlanReportWord() {
    exportElementWord('teamPlanReportExport', `team-plan-report-${planFilters.dateFrom}-${planFilters.dateTo}`, 'Выполнение плана команды')
  }

  function printTeamPlanReportPdf() {
    printElementPdf('teamPlanReportExport', 'Выполнение плана команды')
  }

  function getSelectedFinanceReportExportTitle() {
    if (financeReportType === 'payments') return 'Отчёт по способам оплаты'
    if (financeReportType === 'managers') return 'Отчёт менеджеров'
    if (financeReportType === 'products') return 'Отчёт по товарам'
    if (financeReportType === 'cities') return 'Отчёт по городам'
    if (financeReportType === 'returns') return 'Отчёт по возвратам'
    if (financeReportType === 'debts') return 'Отчёт по закрытым долгам'
    if (financeReportType === 'leads') return 'Отчёт по лидам'
    if (financeReportType === 'callCentre') return 'Отчёт Call Centre'
    return 'Отчёт'
  }

  function exportSelectedFinanceReportWord() {
    exportElementWord('selectedFinanceReportExport', `report-${financeReportType}-${financeReportFilters.dateFrom}-${financeReportFilters.dateTo}`, getSelectedFinanceReportExportTitle())
  }

  function printSelectedFinanceReportPdf() {
    printElementPdf('selectedFinanceReportExport', getSelectedFinanceReportExportTitle())
  }


  async function loadLeadRecords(nextFilters = leadFilters) {
    setLeadBusy(true)
    try {
      const params = new URLSearchParams({ startDate: nextFilters.dateFrom, endDate: nextFilters.dateTo })
      const response = await apiFetch(`/api/leads?${params.toString()}`)
      const data = await readJsonResponse<{ ok?: boolean; rows?: LeadRecord[] }>(response, 'Лиды')
      if (!response.ok) throw new Error('Не удалось загрузить лиды.')
      setLeadRecords(Array.isArray(data.rows) ? data.rows : [])
      return data
    } catch (err) {
      reportReadFailure(err, 'Лиды', leadRecords.length > 0)
      return null
    } finally {
      setLeadBusy(false)
    }
  }

  async function saveLeadRecord() {
    setLeadBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadDraft),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Лиды')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить лиды.')
      await Promise.all([loadLeadRecords(), refreshFinanceReportsIfVisible()])
      setLeadDraft({ id: 0, date: leadDraft.date, managerId: 0, managerName: '', acceptedCount: 0, badCount: 0, comment: '' })
      setMessage(leadDraft.id ? 'Запись лидов обновлена.' : 'Лиды сохранены.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения лидов')
    } finally {
      setLeadBusy(false)
    }
  }

  async function loadCallCentreRecords(nextFilters = leadFilters) {
    setLeadBusy(true)
    try {
      const params = new URLSearchParams({ startDate: nextFilters.dateFrom, endDate: nextFilters.dateTo })
      const response = await apiFetch(`/api/call-centre?${params.toString()}`)
      const data = await readJsonResponse<{ ok?: boolean; rows?: CallCentreRecord[] }>(response, 'Call Centre')
      if (!response.ok) throw new Error('Не удалось загрузить Call Centre.')
      setCallCentreRecords(Array.isArray(data.rows) ? data.rows : [])
      return data
    } catch (err) {
      reportReadFailure(err, 'Call Centre', callCentreRecords.length > 0)
      return null
    } finally {
      setLeadBusy(false)
    }
  }

  async function saveCallCentreRecord() {
    setLeadBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/call-centre', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callCentreDraft),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Call Centre')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить Call Centre.')
      await Promise.all([loadCallCentreRecords(), refreshFinanceReportsIfVisible()])
      setCallCentreDraft({ id: 0, date: callCentreDraft.date, managerId: 0, managerName: '', acceptedLeads: 0, callsMade: 0, callsAccepted: 0, fakeCount: 0, refusalCount: 0, potentialCount: 0, comment: '' })
      setMessage(callCentreDraft.id ? 'Запись Call Centre обновлена.' : 'Call Centre сохранён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения Call Centre')
    } finally {
      setLeadBusy(false)
    }
  }

  function editLeadRecord(row: LeadRecord) {
    setLeadMode('leads')
    setLeadDraft({
      id: row.id,
      date: row.date,
      managerId: Number(row.managerId || 0),
      managerName: row.manager,
      acceptedCount: row.acceptedCount,
      badCount: row.badCount,
      comment: row.comment || '',
    })
  }

  async function deleteLeadRecord(id: number) {
    if (!id || !confirm('Удалить запись лидов?')) return
    setLeadBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/leads/${id}`, { method: 'DELETE' })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Лиды')
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить запись лидов.')
      await Promise.all([loadLeadRecords(), refreshFinanceReportsIfVisible()])
      setMessage('Запись лидов удалена.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления лидов')
    } finally {
      setLeadBusy(false)
    }
  }

  function editCallCentreRecord(row: CallCentreRecord) {
    setLeadMode('callCentre')
    setCallCentreDraft({
      id: row.id,
      date: row.date,
      managerId: Number(row.managerId || 0),
      managerName: row.manager,
      acceptedLeads: row.acceptedLeads,
      callsMade: row.callsMade,
      callsAccepted: row.callsAccepted,
      fakeCount: row.fakeCount,
      refusalCount: row.refusalCount,
      potentialCount: row.potentialCount,
      comment: row.comment || '',
    })
  }

  async function deleteCallCentreRecord(id: number) {
    if (!id || !confirm('Удалить запись Call Centre?')) return
    setLeadBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/call-centre/${id}`, { method: 'DELETE' })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Call Centre')
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить запись Call Centre.')
      await Promise.all([loadCallCentreRecords(), refreshFinanceReportsIfVisible()])
      setMessage('Запись Call Centre удалена.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления Call Centre')
    } finally {
      setLeadBusy(false)
    }
  }

  async function loadPlans(nextFilters = planFilters) {
    setPlanBusy(true)
    try {
      const params = new URLSearchParams({ startDate: nextFilters.dateFrom, endDate: nextFilters.dateTo })
      const response = await apiFetch(`/api/plans?${params.toString()}`)
      const data = await readJsonResponse<{ ok?: boolean; managerPlans?: ManagerPlanRecord[]; departmentPlans?: DepartmentPlanRecord[] }>(response, 'План')
      if (!response.ok) throw new Error('Не удалось загрузить планы.')
      setPlanReport({ managerPlans: data.managerPlans || [], departmentPlans: data.departmentPlans || [] })
      return data
    } catch (err) {
      reportReadFailure(err, 'Планы', Boolean(planReport))
      return null
    } finally {
      setPlanBusy(false)
    }
  }

  async function saveManagerPlan() {
    if (!isAdmin) {
      setError('Изменение плана доступно только администратору.')
      return
    }

    setPlanBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...managerPlanDraft, salaryBase: managerPlanDraft.salaryBase || 100000, bonusHitPercent: 5, bonusMissPercent: 3 }),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'План менеджера')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить план менеджера.')
      await Promise.all([loadPlans(), refreshFinanceReportsIfVisible()])
      setManagerPlanDraft({ id: 0, periodStart: managerPlanDraft.periodStart, periodEnd: managerPlanDraft.periodEnd, managerId: 0, managerName: '', plannedAmount: 0, salaryBase: 100000, comment: '' })
      setMessage(managerPlanDraft.id ? 'План менеджера обновлён.' : 'План менеджера сохранён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения плана')
    } finally {
      setPlanBusy(false)
    }
  }

  async function saveDepartmentPlan() {
    if (!isAdmin) {
      setError('Изменение плана отдела доступно только администратору.')
      return
    }

    setPlanBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/department-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(departmentPlanDraft),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'План отдела')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить план отдела.')
      await Promise.all([loadPlans(), refreshFinanceReportsIfVisible()])
      setDepartmentPlanDraft({ id: 0, periodStart: departmentPlanDraft.periodStart, periodEnd: departmentPlanDraft.periodEnd, plannedAmount: 0, comment: '' })
      setMessage(departmentPlanDraft.id ? 'План отдела обновлён.' : 'План отдела сохранён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения плана отдела')
    } finally {
      setPlanBusy(false)
    }
  }

  function applyWorkshopPeriodPreset(preset: WorkshopPeriodPreset) {
    const range = preset === 'all' ? { dateFrom: '', dateTo: '' } : getPeriodRange(preset)
    setWorkshopFilters((current) => ({
      ...current, period: preset,
      dateFrom: preset === 'custom' ? current.dateFrom : range.dateFrom,
      dateTo: preset === 'custom' ? current.dateTo : range.dateTo,
    }))
  }



  async function markWorkshopTaskDone(task: WorkshopTaskRecord) {
    setWorkshopBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch(`/api/workshop/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done', orderItemId: task.orderItemId || null }),
      })
      const result = await readJsonResponse<{ ok?: boolean; message?: string; changed?: boolean; previousStatus?: string }>(response, 'Цех')
      if (!response.ok) {
        throw new Error(result.message || 'Не удалось отметить позицию готовой.')
      }
      if (result.changed === false) await loadWorkshopData(workshopFilters, { force: true, refreshCounts: true })
      else applyWorkshopTaskStatusChange(task, 'done', result.previousStatus || task.status)
      setMessage(`Позиция цеха по заказу ${task.externalOrderId} отмечена как готовая.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления цеха')
    } finally {
      setWorkshopBusy(false)
    }
  }

  async function restoreWorkshopTaskActive(task: WorkshopTaskRecord) {
    setWorkshopBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch(`/api/workshop/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active', orderItemId: task.orderItemId || null }),
      })
      const result = await readJsonResponse<{ ok?: boolean; message?: string; changed?: boolean; previousStatus?: string }>(response, 'Цех')
      if (!response.ok) {
        throw new Error(result.message || 'Не удалось вернуть позицию в актуальные.')
      }
      if (result.changed === false) await loadWorkshopData(workshopFilters, { force: true, refreshCounts: true })
      else applyWorkshopTaskStatusChange(task, 'active', result.previousStatus || task.status)
      setMessage(`Позиция цеха по заказу ${task.externalOrderId} возвращена в актуальные.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления цеха')
    } finally {
      setWorkshopBusy(false)
    }
  }

  function buildWorkshopInvoiceText() {
    const lines = [
      `Накладная цеха`,
      `Период: ${formatDateShort(workshopFilters.dateFrom)} — ${formatDateShort(workshopFilters.dateTo)}`,
      selectedWorkshopTasks.length ? `Выбрано позиций: ${selectedWorkshopTasks.length}` : `Позиций в фильтре: ${activeWorkshopTasks.length}`,
      '',
      'Изделие | Характеристики | Кол-во | Срочность | Комментарий | Заказ',
      ...workshopInvoiceRows.map((row) => [
        row.productName,
        row.characteristics || '—',
        `${row.quantity} шт.`,
        getWorkshopInvoiceImportanceLabel(row),
        row.comment || '—',
        row.orderRef || '—',
      ].join(' | ')),
    ]
    return lines.join('\n')
  }

  async function copyWorkshopInvoiceText() {
    const text = buildWorkshopInvoiceText()
    try {
      await navigator.clipboard.writeText(text)
      setMessage('Накладная скопирована в буфер обмена.')
    } catch {
      setError('Не удалось скопировать накладную. Используйте скачивание Word или PDF.')
    }
  }

  function buildWorkshopInvoiceHtmlTable(rows: WorkshopInvoiceRow[] = workshopInvoiceRows, pageLabel = '') {
    const detailRows = rows.map((row) => `
      <tr class="${row.priority === 0 ? 'urgent' : row.priority === 1 ? 'commented' : ''}">
        <td>${htmlEscape(row.productName)}</td>
        <td>${htmlEscape(row.characteristics || '—')}</td>
        <td>${row.quantity}</td>
        <td>${htmlEscape(getWorkshopInvoiceImportanceLabel(row))}</td>
        <td>${htmlEscape(row.comment || '—')}</td>
        <td>${htmlEscape(row.orderRef || '—')}</td>
      </tr>`).join('')

    return `
      <style>@page{size:A4 landscape;margin:8mm;}</style>
      <p class="note"><strong>Период:</strong> ${htmlEscape(formatDateShort(workshopFilters.dateFrom))} — ${htmlEscape(formatDateShort(workshopFilters.dateTo))} · ${selectedWorkshopTasks.length ? `выбрано ${selectedWorkshopTasks.length}` : `позиций в фильтре ${activeWorkshopTasks.length}`}${pageLabel ? ` · ${htmlEscape(pageLabel)}` : ''}</p>
      <table class="data-table strict-report-table">
        <thead><tr><th>Изделие</th><th>Характеристики</th><th>Кол-во</th><th>Срочность</th><th>Комментарий</th><th>Заказ</th></tr></thead>
        <tbody>${detailRows || '<tr><td colspan="6">Нет позиций</td></tr>'}</tbody>
      </table>`
  }

  async function exportWorkshopInvoiceWord() {
    if (!workshopInvoiceRows.length) return
    try {
      setError(null)
      const {
        AlignmentType,
        Document,
        HeadingLevel,
        PageOrientation,
        Packer,
        Paragraph,
        Table,
        TableCell,
        TableRow,
        TextRun,
        WidthType,
      } = await import('docx')

      const makeCell = (text: string, bold = false) => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text, bold, size: 18 })],
          spacing: { after: 0 },
        })],
      })
      const rows = [
        new TableRow({
          tableHeader: true,
          children: ['Изделие', 'Характеристики', 'Кол-во', 'Срочность', 'Комментарий', 'Заказ'].map((text) => makeCell(text, true)),
        }),
        ...workshopInvoiceRows.map((row) => new TableRow({
          children: [
            makeCell(row.productName),
            makeCell(row.characteristics || '—'),
            makeCell(String(row.quantity)),
            makeCell(getWorkshopInvoiceImportanceLabel(row)),
            makeCell(row.comment || '—'),
            makeCell(row.orderRef || '—'),
          ],
        })),
      ]
      const documentFile = new Document({
        sections: [{
          properties: {
            page: {
              size: { orientation: PageOrientation.LANDSCAPE },
              margin: { top: 500, right: 500, bottom: 500, left: 500 },
            },
          },
          children: [
            new Paragraph({
              text: 'Накладная цеха',
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
              spacing: { after: 120 },
            }),
            new Paragraph({
              text: `Период: ${formatDateShort(workshopFilters.dateFrom)} — ${formatDateShort(workshopFilters.dateTo)} · ${selectedWorkshopTasks.length ? `выбрано ${selectedWorkshopTasks.length}` : `позиций в фильтре ${activeWorkshopTasks.length}`}`,
              spacing: { after: 160 },
            }),
            new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
          ],
        }],
      })
      const blob = await Packer.toBlob(documentFile)
      downloadBlobFile(blob, `workshop-invoice-${workshopFilters.dateFrom}-${workshopFilters.dateTo}.docx`)
      setMessage('Накладная Word скачана в формате DOCX.')
    } catch (err) {
      setError(err instanceof Error ? `Не удалось создать Word: ${err.message}` : 'Не удалось создать файл Word.')
    }
  }

  async function downloadWorkshopInvoicePdf() {
    if (!workshopInvoiceRows.length) return
    try {
      setError(null)
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      const rowsPerPage = 18
      const chunks: WorkshopInvoiceRow[][] = []
      for (let index = 0; index < workshopInvoiceRows.length; index += rowsPerPage) {
        chunks.push(workshopInvoiceRows.slice(index, index + rowsPerPage))
      }
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })

      for (let pageIndex = 0; pageIndex < chunks.length; pageIndex += 1) {
        const iframe = document.createElement('iframe')
        iframe.title = `Накладная цеха — страница ${pageIndex + 1}`
        iframe.style.position = 'fixed'
        iframe.style.left = '-20000px'
        iframe.style.top = '0'
        iframe.style.width = '1200px'
        iframe.style.height = '900px'
        iframe.style.border = '0'
        document.body.appendChild(iframe)
        try {
          const doc = iframe.contentWindow?.document
          if (!doc) throw new Error('браузер не подготовил страницу документа')
          doc.open()
          doc.write(makeExportHtml('Накладная цеха', buildWorkshopInvoiceHtmlTable(chunks[pageIndex], `страница ${pageIndex + 1} из ${chunks.length}`)))
          doc.close()
          await new Promise((resolve) => window.setTimeout(resolve, 80))
          const fullHeight = Math.max(700, doc.documentElement.scrollHeight + 24)
          iframe.style.height = `${fullHeight}px`
          const canvas = await html2canvas(doc.body, {
            backgroundColor: '#ffffff',
            logging: false,
            scale: 1.6,
            useCORS: true,
            windowWidth: 1200,
            windowHeight: fullHeight,
          })
          if (pageIndex > 0) pdf.addPage('a4', 'landscape')
          const pageWidth = pdf.internal.pageSize.getWidth()
          const pageHeight = pdf.internal.pageSize.getHeight()
          const margin = 6
          const availableWidth = pageWidth - margin * 2
          const availableHeight = pageHeight - margin * 2
          const ratio = Math.min(availableWidth / canvas.width, availableHeight / canvas.height)
          const imageWidth = canvas.width * ratio
          const imageHeight = canvas.height * ratio
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imageWidth, imageHeight, undefined, 'FAST')
        } finally {
          iframe.remove()
        }
      }

      pdf.save(`workshop-invoice-${workshopFilters.dateFrom}-${workshopFilters.dateTo}.pdf`)
      setMessage('Накладная PDF скачана.')
    } catch (err) {
      setError(err instanceof Error ? `Не удалось создать PDF: ${err.message}` : 'Не удалось создать PDF.')
    }
  }

  function printWorkshopInvoice() {
    const html = buildWorkshopInvoiceHtmlTable().replace(/<script/gi, '&lt;script')
    printHtmlDocument('Накладная цеха', html)
  }

  async function saveReferenceEntry() {
    if (!isAdmin) {
      setError('Изменение справочников доступно только администратору.')
      return
    }

    const value = normalizeSuggestion(referenceDraft.value)
    if (!value) {
      setError('Введите значение для справочника.')
      return null
    }

    setError(null)
    const payload = {
      kind: referenceKind,
      value,
      sortOrder: Number(referenceDraft.sortOrder || 0),
      isActive: Boolean(referenceDraft.isActive),
    }

    const isEdit = referenceDraft.id > 0
    const response = await apiFetch(
      isEdit ? `/api/reference-values/${referenceDraft.id}` : '/api/reference-values',
      {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    if (!response.ok) {
      const result = await readJsonResponse<{ message?: string }>(response, 'Справочник')
      throw new Error(result.message || 'Не удалось сохранить справочник.')
    }

    setReferenceDraft({ id: 0, value: '', sortOrder: '0', isActive: true })
    await Promise.all([
      loadReferencesData(true),
      loadReferenceItems(referenceKind, true),
      loadReferenceKindCounts([referenceKind], true),
    ])
    setMessage('Справочник обновлён.')
    return readJsonResponse(response, 'Справочник')
  }

  async function removeReferenceEntry(id: number) {
    if (!isAdmin) {
      setError('Удаление значений справочника доступно только администратору.')
      return
    }

    if (!id) return
    const response = await apiFetch(`/api/reference-values/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: referenceKind }),
    })
    if (!response.ok) {
      throw new Error('Не удалось отключить значение.')
    }
    if (referenceDraft.id === id) {
      setReferenceDraft({ id: 0, value: '', sortOrder: '0', isActive: true })
    }
    await Promise.all([
      loadReferencesData(true),
      loadReferenceItems(referenceKind, true),
      loadReferenceKindCounts([referenceKind], true),
    ])
    setMessage('Значение отключено.')
  }

  function resetReferenceDraft() {
    setReferenceDraft({ id: 0, value: '', sortOrder: '0', isActive: true })
  }

  function selectReferenceKind(kind: ReferenceKind) {
    setReferenceKind(kind)
    setReferenceItems(referenceItemsCache[kind] || [])
    setReferenceSearch('')
    setReferenceStatusFilter('all')
    resetReferenceDraft()
    void loadReferenceItems(kind, !referenceItemsCache[kind])
  }

  async function loadAllOpenDebtOrders(append = false) {
    setDebtLoadBusy(true)
    setError(null)
    try {
      const offset = append ? debtAllOrders.length : 0
      const response = await apiFetch(`/api/orders/open-debts?limit=500&offset=${offset}`)
      const data = await readJsonResponse<OrderListResponse & {
        message?: string
        totalDebt?: number
        debtCloseCount?: number
        debtCloseAmount?: number
        hasMore?: boolean
        debtCloseHistory?: Array<{ id: string; paymentDate: string; orderDate: string; orderId: string; manager: string; managerColor?: string; customer: string; method: string; amount: number; comment: string }>
      }>(response, 'Все открытые долги')
      if (!response.ok) throw new Error(data.message || `Debt orders load failed: ${response.status}`)
      const nextOrders = Array.isArray(data.orders) ? data.orders : []
      setDebtAllOrders((current) => append ? [...current, ...nextOrders] : nextOrders)
      setDebtOverview({
        count: Number(data.count || 0),
        totalDebt: Number(data.totalDebt || 0),
        hasMore: Boolean(data.hasMore),
        loadedCount: offset + nextOrders.length,
        historyCount: Number(data.debtCloseCount || 0),
        historyAmount: Number(data.debtCloseAmount || 0),
      })
      if (!append) setDebtCloseHistoryRows(Array.isArray(data.debtCloseHistory) ? data.debtCloseHistory : [])
      setDebtAllOrdersLoaded(true)
      return data
    } catch (err) {
      reportReadFailure(err, 'Все открытые долги', debtAllOrdersLoaded || debtAllOrders.length > 0)
      return null
    } finally {
      setDebtLoadBusy(false)
    }
  }

  async function loadOverviewDashboard() {
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch('/api/dashboard')
      const data = await readJsonResponse<DashboardInsightsResponse>(response, 'Инфопанель')
      if (!response.ok) throw new Error(`Dashboard load failed: ${response.status}`)
      setDashboardInsights(data)
      return data
    } catch (err) {
      reportReadFailure(err, 'Инфопанель', Boolean(dashboardInsights))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function loadDashboard(forceReferences = false, overrideFilters: typeof filters = filters, overrideOffset = orderPageOffset, pageReadOptions: { afterOrderDate?: string; afterOrderId?: number; reusePeriodStats?: boolean } | null = null) {
    setBusy(true)
    setError(null)
    setMessage(null)

    try {
      const activeFilters = overrideFilters
      const params = new URLSearchParams({
        limit: activeFilters.pageSize || '100',
        offset: String(Math.max(0, overrideOffset)),
        q: activeFilters.q.trim(),
        status: activeFilters.status,
        shippingStatus: activeFilters.shippingStatus,
        archiveMode: activeFilters.archiveMode,
        manager: activeFilters.manager.trim(),
        managerId: String(activeFilters.managerId || 0),
        dateFrom: activeFilters.dateFrom,
        dateTo: activeFilters.dateTo,
        // R5.7: paymentCount is not rendered by the Orders UI. Opt out only where the Worker has
        // a proven received_amount/payment-sum equivalence and no payment-date window.
        includePaymentCount: activeFilters.archiveMode === 'active' && !activeFilters.dateFrom && !activeFilters.dateTo ? '0' : '1',
      })
      // R5.9: the visible pagination remains offset/page based, but sequential Next may provide
      // the last loaded row as an internal seek cursor. The Worker keeps offset as the logical page.
      if (overrideOffset > 0 && pageReadOptions?.afterOrderDate && Number(pageReadOptions.afterOrderId || 0) > 0) {
        params.set('afterOrderDate', pageReadOptions.afterOrderDate)
        params.set('afterOrderId', String(pageReadOptions.afterOrderId))
      }
      // The period summary is invariant while only the page changes. Reuse the exact page-1 value
      // and ask the Worker for count-only pagination metadata instead of repeating three aggregates.
      if (pageReadOptions?.reusePeriodStats && orderPeriodStats) params.set('includePeriodStats', '0')

      const ordersResponse = await apiFetch(`/api/orders?${params.toString()}`)
      const ordersData = await readJsonResponse<OrderListResponse>(ordersResponse, 'Заказы')
      if (!ordersResponse.ok) throw new Error(`Orders load failed: ${ordersResponse.status}`)

      const nextOrders = Array.isArray(ordersData.orders) ? ordersData.orders : []
      setOrders(nextOrders)
      if (ordersData.periodStats) {
        setOrderPeriodStats(ordersData.periodStats)
      } else if (!pageReadOptions?.reusePeriodStats) {
        setOrderPeriodStats(null)
      }
      const nextOffset = Number(ordersData.offset || 0)
      const nextLimit = Number(ordersData.limit || activeFilters.pageSize || 100)
      const totalCount = Number(ordersData.totalCount ?? ordersData.count ?? nextOrders.length)
      setOrderPageOffset(nextOffset)
      setOrderPageInfo({
        offset: nextOffset,
        limit: nextLimit,
        totalCount,
        hasMore: Boolean(ordersData.hasMore),
        hasPrevious: nextOffset > 0,
      })

      if (!nextOrders.length) {
        setSelectedOrderId(null)
        setEditorOpen(false)
      }

      setDbState({ ok: true, database: 'orders_db', time: new Date().toISOString() })

      const shouldLoadDashboardInsights = activeSector === 'overview'
      const optionalResults = await Promise.allSettled([
        apiFetch('/api/health').then(async (response) => {
          const data = await readJsonResponse<ApiState>(response, 'Health check')
          if (!response.ok) throw new Error(`Health check failed: ${response.status}`)
          return data
        }),
        shouldLoadDashboardInsights
          ? apiFetch('/api/dashboard').then(async (response) => {
              const data = await readJsonResponse<DashboardInsightsResponse>(response, 'Инфопанель')
              if (!response.ok) throw new Error(`Dashboard load failed: ${response.status}`)
              return data
            })
          : Promise.resolve(null),
        // R5.11: ordinary list/overview refreshes do not consume the 1,226-row variant catalog.
        // Product-aware forms load the catalog explicitly when their panel becomes active.
        loadReferencesData(forceReferences),
      ])

      const healthResult = optionalResults[0] as PromiseSettledResult<ApiState>
      const dashboardResult = optionalResults[1] as PromiseSettledResult<DashboardInsightsResponse | null>
      const referencesResult = optionalResults[2] as PromiseSettledResult<unknown>
      const softWarnings: string[] = []

      if (healthResult.status === 'fulfilled') {
        setHealth(healthResult.value)
      } else {
        setHealth({ ok: false, service: 'orders-app', time: 'Health недоступен' })
        softWarnings.push('health')
      }

      if (shouldLoadDashboardInsights) {
        if (dashboardResult.status === 'fulfilled' && dashboardResult.value) {
          setDashboardInsights(dashboardResult.value)
        } else {
          setDashboardInsights(null)
          softWarnings.push('инфопанель')
        }
      }

      if (referencesResult.status === 'rejected') {
        softWarnings.push('справочники')
      }

      if (softWarnings.length) {
        setMessage(`Заказы загружены из базы. Временно не обновились: ${softWarnings.join(', ')}.`)
      }

      if (activeSector === 'orders' && orderPanel === 'list') {
        void loadOrdersFinanceSummary(activeFilters)
      }
    } catch (err) {
      const hasPreviousData = orders.length > 0 || Boolean(orderPeriodStats)
      if (hasPreviousData && isTransientApiError(err)) {
        setError(null)
        setMessage('Список заказов временно не обновился. Показаны последние успешно загруженные данные.')
      } else {
        const messageText = err instanceof Error ? err.message : 'Неизвестная ошибка'
        setHealth({ ok: false, service: 'orders-app', time: 'API заказов недоступен' })
        setDbState({ ok: false, database: 'orders_db' })
        setError(`Не удалось загрузить список заказов: ${messageText}`)
      }
    } finally {
      setBusy(false)
    }
  }

  async function changeOrderPage(direction: 'previous' | 'next') {
    const step = Math.max(20, Number(orderPageInfo.limit || 100))
    const nextOffset = direction === 'next'
      ? orderPageInfo.offset + step
      : Math.max(0, orderPageInfo.offset - step)
    if (nextOffset === orderPageInfo.offset) return
    const lastOrder = direction === 'next' && orders.length ? orders[orders.length - 1] : null
    await loadDashboard(false, filters, nextOffset, { afterOrderDate: lastOrder?.order_date || '', afterOrderId: Number(lastOrder?.id || 0), reusePeriodStats: true })
    window.setTimeout(() => document.getElementById('orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function applyOrderPeriodPreset(preset: OrderPeriodPreset) {
    setOrderPeriodPreset(preset)
    const range = getPeriodRange(preset)
    setFilters((current) => ({
      ...current,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    }))
  }

  function resetOrderFilters() {
    const range = getPeriodRange('month')
    setOrderPeriodPreset('month')
    setFilters({
      q: '',
      status: 'all',
      shippingStatus: 'all',
      source: 'all',
      manager: '',
      managerId: 0,
      archiveMode: 'active',
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      pageSize: '100',
    })
  }

  function updateCreateDraft<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) {
    setCreateDraft((current) => {
      if (key === 'orderDate') {
        const orderDate = String(value || '').trim()
        return {
          ...current,
          [key]: value,
          payments: current.payments.map((payment) => (
            payment.paymentKind === 'primary'
              ? { ...payment, paymentDate: orderDate || payment.paymentDate }
              : payment
          )),
        }
      }
      return { ...current, [key]: value }
    })
  }

  function updateCreateItem(index: number, field: keyof EditorItem, value: string | number | boolean | null) {
    setCreateDraft((current) => {
      const nextItems = current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        const nextItem = { ...item, [field]: field === 'audienceType' ? normalizeAudienceTypeValue(value) : value }
        if (['productName', 'audienceType', 'gender', 'color', 'material', 'length', 'size', 'sourceType'].includes(String(field))) {
          nextItem.stockObservationEnabled = false
          nextItem.observedPhysicalQuantity = null
          nextItem.shortageAcknowledged = false
          nextItem.serverShortage = undefined
        }
        if (field === 'quantity') {
          nextItem.shortageAcknowledged = false
          nextItem.serverShortage = undefined
        }
        if (field === 'audienceType') {
          nextItem.audienceType = normalizeAudienceTypeValue(value)
        }
        if (field === 'audienceType') {
          const nextOptions = getSizeOptions(nextItem.productName, nextItem.audienceType)
          if (nextItem.size && !nextOptions.some((option) => normalizeSuggestion(option) === normalizeSuggestion(nextItem.size))) {
            nextItem.size = ''
          }
        }
        return nextItem
      })
      return { ...current, items: nextItems }
    })
  }

  function addCreateItem() {
    setCreateDraft((current) => ({ ...current, items: [...current.items, createEmptyEditorItem()] }))
  }

  function removeCreateItem(index: number) {
    setCreateDraft((current) => {
      const nextItems = current.items.filter((_, itemIndex) => itemIndex !== index)
      return { ...current, items: nextItems.length ? nextItems : [createEmptyEditorItem()] }
    })
  }

  function updateCreatePayment(index: number, field: keyof EditorPayment, value: string | number) {
    setCreateDraft((current) => {
      const nextPayments = current.payments.map((payment, paymentIndex) => (
        paymentIndex === index ? { ...payment, [field]: value } : payment
      ))
      return { ...current, payments: nextPayments }
    })
  }

  function addCreatePayment() {
    setCreateDraft((current) => ({ ...current, payments: [...current.payments, createEmptyEditorPayment(current.orderDate)] }))
  }

  function removeCreatePayment(index: number) {
    setCreateDraft((current) => {
      const nextPayments = current.payments.filter((_, paymentIndex) => paymentIndex !== index)
      return { ...current, payments: nextPayments.length ? nextPayments : [createEmptyEditorPayment(current.orderDate)] }
    })
  }

  const createTotals = useMemo(
    () => calculateTotals(createDraft.items, createDraft.payments, createDraft.orderTotal),
    [createDraft.items, createDraft.payments, createDraft.orderTotal],
  )

  function createOrderDraftWithDefaultManager() {
    const draft = createEmptyOrderDraft()
    if (authUser?.role === 'manager' && Number(authUser.managerId || 0) > 0) {
      return {
        ...draft,
        managerId: Number(authUser.managerId || 0),
        managerName: authUser.managerName || '',
      }
    }
    return draft
  }

  function resetCreateOrderDraft() {
    setCreateDraft(createOrderDraftWithDefaultManager())
  }

  async function createOrderFromDraft() {
    setOrderBusy(true)
    setError(null)
    setMessage(null)

    try {
      if (!Number(createDraft.managerId || 0)) {
        throw new Error('Выберите менеджера перед сохранением заказа.')
      }
      const missingObservation = createDraft.items.find((item) => item.sourceType !== 'workshop' && item.stockObservationEnabled && (item.observedPhysicalQuantity === null || item.observedPhysicalQuantity === undefined))
      if (missingObservation) {
        throw new Error(`Укажите фактическое количество для «${missingObservation.productName || 'позиции'}» или выберите «Сейчас проверить не могу».`)
      }

      const payload = {
        orderDate: createDraft.orderDate,
        managerId: createDraft.managerId || undefined,
        managerName: createDraft.managerName,
        customerPhone: createDraft.customerPhone,
        customerName: createDraft.customerName,
        city: createDraft.city,
        deliveryType: createDraft.deliveryType,
        sourceType: deriveOrderSourceType(createDraft.items),
        orderTotal: createDraft.orderTotal ? Number(createDraft.orderTotal) : undefined,
        workshopStatus: createDraft.workshopStatus,
        orderStatus: createDraft.orderStatus,
        comment: createDraft.comment,
        items: createDraft.items.map((item) => ({
          productName: item.productName,
          audienceType: item.audienceType || 'ВЗРОСЛЫЙ',
          gender: item.gender || null,
          color: item.color,
          material: item.material,
          length: item.length,
          size: item.size,
          quantity: item.quantity,
          unitPrice: 0,
          sourceType: item.sourceType,
          workshopComment: item.workshopComment,
          workshopUrgent: Boolean(item.workshopUrgent),
          workshopDueDate: item.workshopUrgent ? item.workshopDueDate : '',
          observedPhysicalQuantity: item.sourceType !== 'workshop' && item.stockObservationEnabled ? item.observedPhysicalQuantity : undefined,
          shortageAcknowledged: item.sourceType !== 'workshop' ? Boolean(item.shortageAcknowledged) : undefined,
        })),
        payments: createDraft.payments.map((payment, index) => ({
          paymentDate: payment.paymentDate,
          method: payment.method,
          amount: payment.amount,
          paymentKind: resolvePaymentKind(payment, index),
          comment: payment.comment,
        })),
      }

      const criticalKey = 'order-create'
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })

      type CreateOrderShortage = {
        inputIndexes?: number[]
        physicalQuantity?: number
        reservedQuantity?: number
        requestedQuantity?: number
        shortage?: number
      }
      const result = await readJsonResponse<{
        orderId?: number
        externalId?: string
        totalAmount?: number
        receivedAmount?: number
        debtAmount?: number
        code?: string
        shortages?: CreateOrderShortage[]
        stockWriteOff?: Array<{ productName?: string; concurrentShortage?: boolean; shortageAfter?: number }>
        message?: string
      }>(response, 'Создание заказа')
      if (!response.ok && result.code === 'order_stock_shortage' && Array.isArray(result.shortages) && result.shortages.length) {
        const shortageByInputIndex = new Map<number, CreateOrderShortage>()
        for (const shortage of result.shortages) {
          for (const inputIndex of shortage.inputIndexes || []) {
            if (Number.isInteger(Number(inputIndex)) && Number(inputIndex) >= 0) shortageByInputIndex.set(Number(inputIndex), shortage)
          }
        }
        setCreateDraft((current) => ({
          ...current,
          items: current.items.map((item, inputIndex) => {
            const shortage = shortageByInputIndex.get(inputIndex)
            if (!shortage || item.sourceType === 'workshop') return item
            return {
              ...item,
              stockObservationEnabled: false,
              observedPhysicalQuantity: null,
              shortageAcknowledged: false,
              serverShortage: {
                physicalQuantity: Number(shortage.physicalQuantity || 0),
                reservedQuantity: Math.max(0, Number(shortage.reservedQuantity || 0)),
                requestedQuantity: Math.max(0, Number(shortage.requestedQuantity || 0)),
                shortage: Math.max(1, Number(shortage.shortage || 1)),
              },
            }
          }),
        }))
        setError(result.message || 'Перед сохранением уточните отмеченные складские позиции.')
        return
      }
      if (!response.ok) {
        throw new Error(result.message || `Create failed: ${response.status}`)
      }
      // The server has durably completed the idempotent operation. Clear the browser retry token
      // before any non-critical UI/state work so a render/state error cannot keep a successful Save pending.
      completeCriticalRequest(criticalKey, critical.requestId)

      const postSaveShortages = (result.stockWriteOff || []).filter((entry) => Number(entry.shortageAfter || 0) > 0)
      const concurrentShortages = postSaveShortages.filter((entry) => entry.concurrentShortage)
      if (postSaveShortages.length) void loadWarehouseAttention()
      const createdOrderId = Number(result.orderId || 0)
      const createdExternalId = String(result.externalId || '').trim()
      if (!Number.isInteger(createdOrderId) || createdOrderId <= 0 || !createdExternalId) {
        invalidateFinanceReadCaches()
        invalidateInventoryStockCaches(true)
        if (concurrentShortages.length) {
          setMessage('Заказ сохранён. Пока он сохранялся, доступный остаток изменился; проверьте «Склад → Внимание». Обновляю список заказов.')
        } else {
          setMessage('Заказ сохранён. Обновляю список заказов.')
        }
        setOrderPanel('list')
        resetCreateOrderDraft()
        void loadDashboard(false)
        void loadWorkshopData()
        return
      }

      const createdOrder: OrderRecord = {
        id: createdOrderId,
        external_id: createdExternalId,
        order_date: createDraft.orderDate,
        manager_id: createDraft.managerId || null,
        manager_name: createDraft.managerName || null,
        manager_color: (references?.managerOptions || []).find((manager) => manager.id === createDraft.managerId)?.colorKey || null,
        customer_phone: createDraft.customerPhone || null,
        customer_name: createDraft.customerName || null,
        city: createDraft.city || null,
        delivery_type: createDraft.deliveryType || null,
        source_type: deriveOrderSourceType(createDraft.items),
        workshop_status: createDraft.workshopStatus,
        order_status: createDraft.orderStatus,
        total_amount: Number(result.totalAmount || 0),
        received_amount: Number(result.receivedAmount || 0),
        debt_amount: Number(result.debtAmount || 0),
        return_amount: 0,
        comment: createDraft.comment || null,
        items: createDraft.items.filter((item) => String(item.productName || '').trim()).map((item) => ({
          productName: item.productName,
          audienceType: item.audienceType || 'ВЗРОСЛЫЙ',
          gender: item.gender || null,
          color: item.color || null,
          material: item.material || null,
          length: item.length || null,
          size: item.size || null,
          quantity: item.quantity ?? 1,
          unitPrice: 0,
          lineTotal: 0,
          sourceType: item.sourceType || 'warehouse',
          workshopComment: item.workshopComment || null,
          workshopUrgent: Boolean(item.workshopUrgent),
          workshopDueDate: item.workshopUrgent ? item.workshopDueDate || null : null,
          isWorkshop: item.sourceType === 'workshop',
        })),
        payments: createDraft.payments
          .map((payment, index) => ({
            paymentDate: payment.paymentDate,
            method: payment.method,
            amount: payment.amount,
            paymentKind: resolvePaymentKind(payment, index),
            comment: payment.comment || null,
          }))
          .filter((payment) => String(payment.method || '').trim() && Number(payment.amount || 0) > 0),
        returns: [],
      }

      invalidateFinanceReadCaches()
      // Step 188A: order creation changes reservations. Do not keep a stale stock cache
      // that would later make Warehouse or the next availability hint show the pre-order number.
      invalidateInventoryStockCaches(true)
      if (concurrentShortages.length) {
        setMessage(`Заказ ${createdOrder.external_id} создан. Пока он сохранялся, доступный остаток изменился; проверьте «Склад → Внимание».`)
      } else {
        setMessage(`Заказ ${createdOrder.external_id} создан, сумма ${formatMoney(createdOrder.total_amount)} тенге.`)
      }
      upsertOrderInState(createdOrder)
      if (createdOrder.items.some((item) => item.isWorkshop || item.sourceType === 'workshop')) {
        void loadWorkshopData()
      }
      setSelectedOrderId(createdOrder.id)
      setEditorDraft(createEditorDraft(createdOrder))
      setEditorOpen(false)
      setOrderPanel('list')
      resetCreateOrderDraft()
      if (activeSector === 'orders' && orderPanel === 'list') void loadOrdersFinanceSummary(filters, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setOrderBusy(false)
    }
  }

  function preferredInventoryMatrixValue(values: string[], fallback = '') {
    if (!values.length) return fallback
    return values.find((value) => normalizeSuggestion(value) === 'СТАНДАРТ') ?? values[0] ?? fallback
  }

  function inventoryMatrixGroupKey(value: Pick<InventoryMatrixDraft, 'productId' | 'productName' | 'category' | 'gender' | 'material' | 'length'> | InventoryDraftItem) {
    const productKey = String(value.productId || '').trim()
      ? `id:${String(value.productId).trim()}`
      : `name:${normalizeSuggestion(value.productName)}`
    return [
      productKey,
      value.category,
      normalizeSuggestion(value.gender),
      normalizeSuggestion(value.material),
      normalizeSuggestion(value.length),
    ].join('¦')
  }

  function clearInventoryMatrixValues() {
    const activeKey = inventoryMatrixGroupKey(inventoryMatrix)
    if (!inventoryMatrix.productName.trim()) return
    setInventoryDraft((current) => {
      const nextItems = current.items.filter((item) => !item.touched || inventoryMatrixGroupKey(item) !== activeKey)
      return { ...current, items: nextItems.length ? nextItems : [createEmptyInventoryItem()] }
    })
  }

  function startNextInventoryMatrixProduct() {
    if (!inventoryMatrixCurrentGroupItems.length) {
      setError('Сначала укажите количество хотя бы в одной клетке текущего товара.')
      return
    }
    setError(null)
    setMessage(inventoryDraft.movementType === 'arrival'
      ? `«${inventoryMatrix.productName}» добавлен в текущий приход. Теперь выберите следующий товар.`
      : `«${inventoryMatrix.productName}» добавлен в текущую операцию. Теперь выберите следующую группу.`)
    setInventoryOperationSearch('')
    setInventoryOperationProductKey('')
    setInventoryMatrix(createEmptyInventoryMatrixDraft())
    setInventoryMatrixColorToAdd('')
    setInventoryMatrixSizeToAdd('')
  }

  function openInventoryMatrixBatchGroup(groupKey: string) {
    const group = inventoryMatrixBatchGroups.find((entry) => entry.key === groupKey)
    if (!group) return
    setError(null)
    setInventoryOperationSearch(group.productName)
    setInventoryOperationProductKey(group.productId ? `id:${group.productId}` : `name:${normalizeSuggestion(group.productName)}`)
    setInventoryMatrix({
      productId: group.productId,
      productName: group.productName,
      category: group.category,
      gender: group.gender,
      material: group.material,
      length: group.length,
      extraColors: group.colors,
      extraSizes: group.sizes,
      ready: true,
    })
    setInventoryMatrixColorToAdd('')
    setInventoryMatrixSizeToAdd('')
  }

  function removeInventoryMatrixBatchGroup(groupKey: string) {
    setInventoryDraft((current) => {
      const nextItems = current.items.filter((item) => !item.touched || inventoryMatrixGroupKey(item) !== groupKey)
      return { ...current, items: nextItems.length ? nextItems : [createEmptyInventoryItem()] }
    })
    if (inventoryMatrixActiveGroupKey === groupKey) {
      setInventoryOperationSearch('')
      setInventoryOperationProductKey('')
      setInventoryMatrix(createEmptyInventoryMatrixDraft())
      setInventoryMatrixColorToAdd('')
      setInventoryMatrixSizeToAdd('')
    }
  }

  function configureInventoryMatrixProduct(productId: string | number, productName: string, stockRows?: InventoryStockRecord[]) {
    const variants = productId ? variantsForProduct(productId) : []
    const sourceRows = stockRows || []
    const source = sourceRows.length ? sourceRows : variants

    const combinations = new Map<string, {
      category: 'adult' | 'child'
      gender: string
      material: string
      length: string
      count: number
      standardScore: number
    }>()

    for (const row of source) {
      const category = 'inventorySource' in row ? getInventoryRowCategory(row) : getCatalogVariantCategory(row)
      const gender = String(row.gender || '').trim()
      const material = String(row.material || '').trim()
      const length = String(row.length || '').trim()
      const key = [category, normalizeSuggestion(gender), normalizeSuggestion(material), normalizeSuggestion(length)].join('¦')
      const existing = combinations.get(key)
      if (existing) {
        existing.count += 1
      } else {
        combinations.set(key, {
          category,
          gender,
          material,
          length,
          count: 1,
          standardScore: (normalizeSuggestion(material) === 'СТАНДАРТ' ? 1 : 0) + (normalizeSuggestion(length) === 'СТАНДАРТ' ? 1 : 0),
        })
      }
    }

    const preferred = [...combinations.values()].sort((left, right) => (
      right.count - left.count
      || right.standardScore - left.standardScore
      || left.category.localeCompare(right.category)
      || left.gender.localeCompare(right.gender, 'ru')
      || left.material.localeCompare(right.material, 'ru')
      || left.length.localeCompare(right.length, 'ru', { numeric: true })
    ))[0]

    const category = preferred?.category || 'adult'
    const gender = preferred?.gender || (category === 'child' ? 'ДЕТСКИЙ' : '')
    const material = preferred?.material || preferredInventoryMatrixValue(suggestionValues.materials, 'СТАНДАРТ')
    const length = preferred?.length || preferredInventoryMatrixValue(suggestionValues.lengths, 'СТАНДАРТ')

    setInventoryMatrix({
      productId: String(productId || ''),
      productName,
      category,
      gender,
      material,
      length,
      extraColors: [],
      extraSizes: [],
      ready: false,
    })
    setInventoryMatrixColorToAdd('')
    setInventoryMatrixSizeToAdd('')
    clearInventoryMatrixValues()
  }

  function updateInventoryMatrixProductInput(value: string) {
    setInventoryOperationSearch(value)
    const normalized = normalizeSuggestion(value)

    if (!normalized) {
      setInventoryOperationProductKey('')
      setInventoryMatrix(createEmptyInventoryMatrixDraft())
      clearInventoryMatrixValues()
      return
    }

    if (inventoryDraft.movementType === 'arrival') {
      const product = (catalogData?.products || []).find((entry) => entry.isActive && normalizeSuggestion(entry.name) === normalized)
      if (product) {
        if (String(inventoryMatrix.productId) !== String(product.id)) {
          configureInventoryMatrixProduct(product.id, product.name)
        }
        return
      }

      setInventoryOperationProductKey('')
      setInventoryMatrix((current) => {
        const switchedFromCatalog = Boolean(current.productId)
        return {
          ...current,
          productId: '',
          productName: value,
          category: switchedFromCatalog ? 'adult' : current.category,
          gender: switchedFromCatalog ? '' : current.gender,
          material: switchedFromCatalog
            ? preferredInventoryMatrixValue(suggestionValues.materials, 'СТАНДАРТ')
            : (current.material || preferredInventoryMatrixValue(suggestionValues.materials, 'СТАНДАРТ')),
          length: switchedFromCatalog
            ? preferredInventoryMatrixValue(suggestionValues.lengths, 'СТАНДАРТ')
            : (current.length || preferredInventoryMatrixValue(suggestionValues.lengths, 'СТАНДАРТ')),
          extraColors: [],
          extraSizes: [],
          ready: false,
        }
      })
      clearInventoryMatrixValues()
      return
    }

    const stockRows = inventoryOperationSourceRows.filter((row) => normalizeSuggestion(row.productName) === normalized)
    if (stockRows.length) {
      const first = stockRows[0]
      const key = first.productId ? `id:${first.productId}` : `name:${normalized}`
      setInventoryOperationProductKey(key)
      if (String(inventoryMatrix.productId) !== String(first.productId || '') || normalizeSuggestion(inventoryMatrix.productName) !== normalized) {
        configureInventoryMatrixProduct(first.productId || '', first.productName, stockRows)
      }
      return
    }

    // An exact catalog product may have no row on the selected point yet. It is still
    // a valid choice: the matrix can create the missing combination instead of blocking it.
    const catalogProduct = (catalogData?.products || []).find((entry) => entry.isActive && normalizeSuggestion(entry.name) === normalized)
    if (catalogProduct) {
      setInventoryOperationProductKey(`id:${catalogProduct.id}`)
      configureInventoryMatrixProduct(catalogProduct.id, catalogProduct.name)
      return
    }

    setInventoryOperationProductKey('')
    setInventoryMatrix((current) => ({
      ...current,
      productId: '',
      productName: value,
      ready: false,
      extraColors: [],
      extraSizes: [],
    }))
    clearInventoryMatrixValues()
  }

  function updateInventoryMatrixCategory(category: 'adult' | 'child') {
    setInventoryMatrix((current) => ({
      ...current,
      category,
      gender: category === 'child' && !current.gender ? 'ДЕТСКИЙ' : current.gender,
      extraColors: [],
      extraSizes: [],
      ready: false,
    }))
    clearInventoryMatrixValues()
  }

  function updateInventoryMatrixGender(gender: string) {
    setInventoryMatrix((current) => ({ ...current, gender, extraColors: [], extraSizes: [], ready: false }))
    clearInventoryMatrixValues()
  }

  function updateInventoryMatrixMaterial(material: string) {
    setInventoryMatrix((current) => ({ ...current, material, extraColors: [], extraSizes: [], ready: false }))
    clearInventoryMatrixValues()
  }

  function updateInventoryMatrixLength(length: string) {
    setInventoryMatrix((current) => ({ ...current, length, extraColors: [], extraSizes: [], ready: false }))
    clearInventoryMatrixValues()
  }

  function buildInventoryMatrix() {
    const cleanProductName = inventoryMatrix.productName.trim()
    if (!cleanProductName) {
      setError('Сначала выберите или введите товар.')
      return
    }
    if (!inventoryMatrix.productId && inventoryMatrix.category === 'adult' && !inventoryMatrix.gender) {
      setError('Для нового взрослого товара выберите пол.')
      return
    }
    const finalProductName = inventoryDraft.movementType === 'arrival' && !inventoryMatrix.productId
      ? cleanProductName.toUpperCase()
      : cleanProductName
    setError(null)
    setInventoryOperationSearch(finalProductName)
    setInventoryMatrix((current) => ({ ...current, productName: finalProductName, ready: true }))
    clearInventoryMatrixValues()
  }

  function addInventoryMatrixColor(rawValue?: string) {
    const value = String(rawValue ?? inventoryMatrixColorToAdd).trim().toUpperCase()
    if (!value) return
    setInventoryMatrix((current) => ({ ...current, extraColors: Array.from(new Set([...current.extraColors, value])), ready: true }))
    setInventoryMatrixColorToAdd('')
  }

  function addInventoryMatrixSize(rawValue?: string) {
    const value = String(rawValue ?? inventoryMatrixSizeToAdd).trim().toUpperCase()
    if (!value) return
    setInventoryMatrix((current) => ({ ...current, extraSizes: Array.from(new Set([...current.extraSizes, value])), ready: true }))
    setInventoryMatrixSizeToAdd('')
  }

  function inventoryMatrixDraftItem(size: string, color: string) {
    const key = inventoryMatrixCellKey(size, color)
    return inventoryDraft.items.find((item) => (
      item.touched
      && inventoryMatrixGroupKey(item) === inventoryMatrixActiveGroupKey
      && inventoryMatrixCellKey(item.size, item.color) === key
    ))
  }

  function setInventoryMatrixCell(size: string, color: string, rawValue: string) {
    const key = inventoryMatrixCellKey(size, color)
    const existingCell = inventoryMatrixCellMap.get(key)
    const touched = rawValue !== ''
    const parsed = touched ? Math.max(0, Math.trunc(Number(rawValue || 0))) : 0
    const shouldKeep = touched && (inventoryDraft.movementType === 'manual_set' || parsed > 0)

    setInventoryDraft((current) => {
      const nextItems = current.items.filter((item) => !(
        item.touched
        && inventoryMatrixGroupKey(item) === inventoryMatrixActiveGroupKey
        && inventoryMatrixCellKey(item.size, item.color) === key
      ))
      if (shouldKeep) {
        nextItems.push({
          productId: inventoryMatrix.productId,
          variantId: existingCell?.variantId ? String(existingCell.variantId) : '',
          productName: inventoryMatrix.productName,
          category: inventoryMatrix.category,
          gender: inventoryMatrix.gender,
          color,
          material: inventoryMatrix.material,
          length: inventoryMatrix.length,
          size,
          quantity: parsed,
          touched: true,
          expectedQuantity: existingCell?.current ?? 0,
        })
      }
      return { ...current, items: nextItems.length ? nextItems : [createEmptyInventoryItem()] }
    })
  }

  function handleInventoryMatrixKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!['Enter', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.inventory-matrix-input:not(:disabled)'))
    const index = inputs.indexOf(event.currentTarget)
    if (index < 0) return
    const columns = Math.max(1, inventoryMatrixColors.length)
    const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowUp' ? -columns : event.key === 'ArrowDown' ? columns : 1
    const next = inputs[index + offset]
    if (next) {
      event.preventDefault()
      next.focus()
      next.select()
    }
  }

  function resetInventoryOperationSelection() {
    setInventoryOperationSearch('')
    setInventoryOperationProductKey('')
    setInventoryOperationVariant(createEmptyInventoryOperationVariantDraft())
    setInventoryOperationActiveVariantId('')
    setInventoryExistingVariantOpen(false)
    setInventoryExistingVariantSearch('')
  }

  async function openWorkshopOrderEditor(task: WorkshopTaskRecord) {
    setError(null)
    setMessage(null)
    setEditorOpen(false)

    let order = orders.find((entry) => entry.id === task.orderId)
    if (!order) {
      try {
        const response = await apiFetch(`/api/orders/${task.orderId}`)
        const data = await readJsonResponse<{ ok?: boolean; order?: OrderRecord; message?: string }>(response, 'Открытие заказа из цеха')
        if (!response.ok || !data.order) {
          throw new Error(data.message || 'Не удалось открыть заказ из цеха.')
        }
        order = data.order
        upsertOrderInState(order)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка открытия заказа из цеха')
      }
    }

    if (!order) {
      setMessage('Заказ найден в цехе, но не загрузился для редактирования. Попробуйте обновить страницу и открыть ещё раз.')
      return
    }

    setEditorReturnSector('workshop')
    setEditorOrderOverride(order)
    setSelectedOrderId(order.id)
    setEditorDraft(createEditorDraft(order))
    setActiveSector('orders')
    setOrderPanel('edit')
    setEditorOpen(true)
    window.location.hash = '#editor'
    setMessage(`Открыта форма редактирования заказа ${order.external_id}.`)
  }


  async function openWorkshopExchange(task: WorkshopTaskRecord) {
    setActiveSector('orders')
    setOrderPanel('exchange')
    setEditorOpen(false)
    window.location.hash = '#order-exchange'

    let order = orders.find((entry) => entry.id === task.orderId)
    if (!order) {
      const searchText = task.externalOrderId || String(task.orderId)
      try {
        const params = new URLSearchParams({
          limit: '20',
          q: searchText,
          status: 'all',
          shippingStatus: 'all',
          source: 'all',
          archiveMode: 'all',
          manager: '',
          dateFrom: '',
          dateTo: '',
        })
        const response = await apiFetch(`/api/orders?${params.toString()}`)
        const data = await readJsonResponse<OrderListResponse>(response, 'Открытие обмена из цеха')
        if (!response.ok) throw new Error('Не удалось открыть заказ для обмена.')
        const found = (data.orders || []).find((entry) => entry.id === task.orderId || entry.external_id === task.externalOrderId)
        if (found) {
          upsertOrderInState(found)
          order = found
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка открытия обмена из цеха')
      }
    }

    if (!order) {
      setMessage('Заказ найден в цехе, но не загрузился для обмена. Откройте его через таблицу заказов.')
      return
    }

    const exchangeDraftForTask = createExchangeDraft(order)
    const exactWorkshopItem = (order.items || []).find((item) => (
      Number(item.id || 0) === Number(task.orderItemId || 0)
      && Number(item.quantity || 0) > 0
    )) || null

    setSelectedOrderId(order.id)
    setExchangeSelectedOrderId(order.id)
    setExchangeDraft({
      ...exchangeDraftForTask,
      oldItemId: Number(exactWorkshopItem?.id || exchangeDraftForTask.oldItemId || 0),
      newSourceWasManuallyChanged: false,
      newItem: {
        ...exchangeDraftForTask.newItem,
        sourceType: 'workshop',
      },
    })
    setMessage(`Открыта форма обмена по заказу ${order.external_id}.`)
  }

  function inventoryOperationVariantFromRow(row: InventoryStockRecord): InventoryOperationVariantDraft {
    return {
      category: getInventoryRowCategory(row),
      gender: row.gender || '',
      color: row.color || '',
      material: row.material || '',
      length: row.length || '',
      size: row.size || '',
    }
  }

  function selectInventoryOperationVariant(row: InventoryStockRecord) {
    const group = inventoryOperationAllProductGroups.find((entry) => entry.rows.some((candidate) => Number(candidate.variantId || 0) === Number(row.variantId || 0)))
    if (group) {
      setInventoryOperationProductKey(group.key)
      setInventoryOperationSearch(group.productName)
    }
    setInventoryOperationVariant(inventoryOperationVariantFromRow(row))
    setInventoryOperationActiveVariantId(String(row.variantId || ''))
    setInventoryExistingVariantOpen(false)
    setInventoryExistingVariantSearch('')
  }

  function selectInventoryOperationProduct(key: string, preferredVariantId?: string | number) {
    const group = inventoryOperationAllProductGroups.find((entry) => entry.key === key)
    if (!group) {
      resetInventoryOperationSelection()
      return
    }
    const preferred = preferredVariantId
      ? group.rows.find((row) => String(row.variantId || '') === String(preferredVariantId))
      : null
    const row = preferred || group.rows[0] || null
    setInventoryOperationProductKey(group.key)
    setInventoryOperationSearch(group.productName)
    setInventoryExistingVariantOpen(false)
    setInventoryExistingVariantSearch('')
    if (row) {
      setInventoryOperationVariant(inventoryOperationVariantFromRow(row))
      setInventoryOperationActiveVariantId(String(row.variantId || ''))
    } else {
      setInventoryOperationVariant(createEmptyInventoryOperationVariantDraft())
      setInventoryOperationActiveVariantId('')
    }
  }

  function updateInventoryDirectProductInput(value: string) {
    setInventoryOperationSearch(value)
    const normalized = normalizeSearchText(value)
    const exact = inventoryOperationAllProductGroups.find((group) => normalizeSearchText(group.productName) === normalized)
    if (exact) {
      selectInventoryOperationProduct(exact.key)
      return
    }
    setInventoryOperationProductKey('')
    setInventoryOperationVariant(createEmptyInventoryOperationVariantDraft())
    setInventoryOperationActiveVariantId('')
    setInventoryExistingVariantOpen(false)
    setInventoryExistingVariantSearch('')
  }

  function updateInventoryOperationVariantField(field: keyof InventoryOperationVariantDraft, value: string) {
    const nextVariant = { ...inventoryOperationVariant, [field]: field === 'category' ? (value === 'child' ? 'child' : 'adult') : value } as InventoryOperationVariantDraft
    const previousRow = matchedInventoryOperationVariant
    const previousQuantity = previousRow ? Number(draftItemForVariant(previousRow.variantId)?.quantity || 0) : 0
    const same = (left: unknown, right: unknown) => normalizeSearchText(left) === normalizeSearchText(right)
    const nextRow = selectedInventoryOperationGroup?.rows.find((row) => (
      getInventoryRowCategory(row) === nextVariant.category
      && same(row.gender, nextVariant.gender)
      && same(row.color, nextVariant.color)
      && same(row.material, nextVariant.material)
      && same(row.length, nextVariant.length)
      && same(row.size, nextVariant.size)
      && (inventoryDraft.movementType !== 'writeoff' || Number(row.quantity || 0) > 0)
    )) || null

    setInventoryOperationVariant(nextVariant)
    setInventoryOperationActiveVariantId(nextRow ? String(nextRow.variantId || '') : '')

    if (previousRow && String(previousRow.variantId || '') !== String(nextRow?.variantId || '') && previousQuantity > 0) {
      setInventoryDraft((current) => {
        const remaining = current.items.filter((item) => String(item.variantId || '') !== String(previousRow.variantId || ''))
        if (!nextRow) return { ...current, items: remaining.length ? remaining : [createEmptyInventoryItem()] }
        const existingTargetQuantity = Number(remaining.find((item) => String(item.variantId || '') === String(nextRow.variantId || ''))?.quantity || 0)
        const safeQuantity = Math.min(previousQuantity + existingTargetQuantity, Math.max(0, Number(nextRow.quantity || 0)))
        const withoutTarget = remaining.filter((item) => String(item.variantId || '') !== String(nextRow.variantId || ''))
        const nextItems = safeQuantity > 0 ? [...withoutTarget, createInventoryItemFromStockRow(nextRow, safeQuantity)] : withoutTarget
        return { ...current, items: nextItems.length ? nextItems : [createEmptyInventoryItem()] }
      })
    }
  }

  function createInventoryItemFromStockRow(row: InventoryStockRecord, quantity: number): InventoryDraftItem {
    return {
      productId: row.productId ? String(row.productId) : '',
      variantId: String(row.variantId || ''),
      productName: row.productName || '',
      category: getInventoryRowCategory(row),
      gender: row.gender || '',
      color: row.color || '',
      material: row.material || '',
      length: row.length || '',
      size: row.size || '',
      quantity,
      expectedQuantity: Number(row.quantity || 0),
      observedPhysicalQuantity: null,
    }
  }

  function draftItemForVariant(variantId: string | number) {
    const id = String(variantId || '')
    return inventoryDraft.items.find((item) => String(item.variantId || '') === id)
  }

  function setInventoryVariantOperationQuantity(row: InventoryStockRecord, quantity: number) {
    const physical = Math.max(0, Number(row.quantity || 0))
    const requested = Math.max(0, Math.trunc(Number(quantity || 0)))
    const nextQuantity = inventoryDraft.movementType === 'transfer' || inventoryDraft.movementType === 'writeoff' ? requested : Math.min(physical, requested)
    const variantId = String(row.variantId || '')
    if (!variantId) return
    setInventoryDraft((current) => {
      const withoutEmpty = current.items.filter((item) => item.variantId || item.productName)
      const exists = withoutEmpty.some((item) => String(item.variantId || '') === variantId)
      let nextItems = exists
        ? withoutEmpty.map((item) => String(item.variantId || '') === variantId
          ? {
              ...item,
              quantity: nextQuantity,
              observedPhysicalQuantity: (current.movementType === 'transfer' || current.movementType === 'writeoff') && nextQuantity <= physical ? null : item.observedPhysicalQuantity,
            }
          : item)
        : [...withoutEmpty, createInventoryItemFromStockRow(row, nextQuantity)]
      nextItems = nextItems.filter((item) => item.quantity > 0 || String(item.variantId || '') !== variantId)
      return { ...current, items: nextItems.length ? nextItems : [createEmptyInventoryItem()] }
    })
  }

  function setInventoryTransferObservedQuantity(row: InventoryStockRecord, rawValue: string) {
    const variantId = String(row.variantId || '')
    if (!variantId) return
    setInventoryDraft((current) => ({
      ...current,
      items: current.items.map((item) => String(item.variantId || '') === variantId
        ? {
            ...item,
            expectedQuantity: Number(row.quantity || 0),
            observedPhysicalQuantity: rawValue === '' ? null : Math.max(0, Math.trunc(Number(rawValue || 0))),
          }
        : item),
    }))
  }

  function startInventoryTransferFromStockRow(source: InventorySourceKey, row: InventoryStockRecord) {
    if (!row.variantId || Number(row.quantity || 0) <= 0) return
    const targetSource: InventorySourceKey = source === 'warehouse' ? 'boutique' : 'warehouse'
    setInventoryTransferRequestId(makeCashRequestId('inventory-transfer'))
    setInventoryDraft({
      source,
      targetSource,
      movementType: 'transfer',
      comment: '',
      items: [createInventoryItemFromStockRow(row, 0)],
    })
    setInventoryOperationSearch(row.productName || '')
    const key = row.productId ? `id:${row.productId}` : `name:${normalizeSuggestion(row.productName)}`
    setInventoryOperationProductKey(key)
    setInventoryOperationVariant(inventoryOperationVariantFromRow(row))
    setInventoryOperationActiveVariantId(String(row.variantId || ''))
    setInventoryExistingVariantOpen(false)
    setInventoryExistingVariantSearch('')
    openInventoryPanel('movement')
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-transfer-variant="${row.variantId}"] input[type="number"]`)
      input?.focus()
      input?.select()
    })
  }

  function removeInventoryVariantOperationItem(variantId: string | number) {
    const id = String(variantId || '')
    setInventoryDraft((current) => {
      const nextItems = current.items.filter((item) => String(item.variantId || '') !== id)
      return { ...current, items: nextItems.length ? nextItems : [createEmptyInventoryItem()] }
    })
  }



  async function applyInventoryStocktakeChanges(
    source: InventorySourceKey,
    items: InventoryStocktakeApplyItem[],
    sessionId: string,
  ): Promise<InventoryStocktakeApplyResult> {
    const cleanItems = items.filter((item) => item.key && Number.isFinite(item.quantity) && Number.isFinite(item.expectedQuantity))
    if (!cleanItems.length) {
      return { ok: true, appliedKeys: [], message: 'Расхождений для применения нет.' }
    }

    setError(null)
    setMessage(null)
    const appliedKeys: string[] = []
    const chunkSize = 6
    const reference = `Ревизия ${sourceLabel(source)} · ${sessionId}`

    for (let index = 0; index < cleanItems.length; index += chunkSize) {
      const chunk = cleanItems.slice(index, index + chunkSize)
      try {
        const response = await apiFetch('/api/inventory/movements?returnInventory=0', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: makeCashRequestId(`stocktake-${sessionId}-${index}`),
            inventorySource: source,
            movementType: 'manual_set',
            comment: reference,
            items: chunk.map(({ key: _key, ...item }) => item),
          }),
        })
        const result = await readJsonResponse<{ message?: string }>(response, 'Применение ревизии')
        if (!response.ok) throw new Error(result.message || `Inventory stocktake save failed: ${response.status}`)
        appliedKeys.push(...chunk.map((item) => item.key))
      } catch (err) {
        await Promise.allSettled([
          loadInventoryData(source, true, '', false),
        ])
        const reason = err instanceof Error ? err.message : 'Не удалось применить результаты ревизии.'
        const message = appliedKeys.length
          ? `Часть ревизии сохранена (${appliedKeys.length} поз.). Дальше остановлено: ${reason}`
          : reason
        setError(message)
        return { ok: false, appliedKeys, message }
      }
    }

    await Promise.all([
      loadInventoryData(source, true, '', false),
    ])
    const message = `Ревизия ${sourceLabel(source)} применена: исправлено ${appliedKeys.length} поз.`
    setMessage(message)
    return { ok: true, appliedKeys, message }
  }


  async function saveInventoryMovement() {
    if (inventoryMovementBusy) return
    setInventoryMovementBusy(true)
    setError(null)
    setMessage(null)
    try {
      const movementItems = inventoryDraft.movementType === 'arrival'
        ? flattenInventoryArrivalPositions()
        : inventoryDraft.items
      const cleanItems = movementItems
        .filter((item) => (item.variantId || item.productName) && (inventoryDraft.movementType === 'manual_set' ? item.touched : Number(item.quantity || 0) > 0))
        .map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          category: item.category,
          gender: item.gender,
          color: item.color,
          material: item.material,
          length: item.length,
          size: item.size,
          quantity: Number(item.quantity || 0),
          expectedQuantity: item.expectedQuantity,
          observedPhysicalQuantity: item.observedPhysicalQuantity,
        }))

      if (!cleanItems.length) {
        throw new Error('Выберите хотя бы один товар/вариант.')
      }

      if (!isAdmin && inventoryDraft.movementType === 'arrival' && cleanItems.some((item) => !item.variantId)) {
        throw new Error('Новый товар или новая характеристика требуют админ-режима. В рабочем режиме выберите готовый существующий вариант.')
      }

      if ((inventoryDraft.movementType === 'writeoff' || inventoryDraft.movementType === 'manual_set') && !inventoryDraft.comment.trim()) {
        throw new Error(inventoryDraft.movementType === 'writeoff' ? 'Укажите причину списания.' : 'Укажите причину корректировки.')
      }

      if ((inventoryDraft.movementType === 'writeoff' || inventoryDraft.movementType === 'transfer') && cleanItems.some((item) => !item.variantId)) {
        throw new Error('Для списания и перемещения выберите существующий вариант из остатков выбранной точки.')
      }

      if (inventoryDraft.movementType === 'writeoff' || inventoryDraft.movementType === 'transfer' || inventoryDraft.movementType === 'manual_set') {
        const same = (left: unknown, right: unknown) => normalizeSearchText(left) === normalizeSearchText(right)
        const invalidItem = cleanItems.find((item) => {
          // Старые orphan-строки без variantId разрешены только для manual_set:
          // Worker всё равно требует уже существующую строку inventory_stock и ничего нового не создаёт.
          if (inventoryDraft.movementType === 'manual_set' && !item.variantId) return false
          const row = inventoryOperationSourceRows.find((entry) => String(entry.variantId || '') === String(item.variantId || ''))
          return !row
            || getInventoryRowCategory(row) !== item.category
            || !same(row.productName, item.productName)
            || !same(row.gender, item.gender)
            || !same(row.color, item.color)
            || !same(row.material, item.material)
            || !same(row.length, item.length)
            || !same(row.size, item.size)
        })
        if (invalidItem) {
          throw new Error('Выбранная комбинация больше не соответствует остаткам источника. Выберите существующий вариант заново.')
        }
      }

      const isTransfer = inventoryDraft.movementType === 'transfer'
      if (isTransfer || inventoryDraft.movementType === 'writeoff') {
        for (const item of cleanItems) {
          const row = inventoryOperationSourceRows.find((entry) => String(entry.variantId || '') === String(item.variantId || ''))
          const physical = Number(row?.quantity || 0)
          const requested = Math.max(0, Number(item.quantity || 0))
          if (requested <= Math.max(0, physical)) continue
          const observed = item.observedPhysicalQuantity === null || item.observedPhysicalQuantity === undefined
            ? null
            : Math.max(0, Math.trunc(Number(item.observedPhysicalQuantity || 0)))
          if (observed === null) {
            throw new Error(`По учёту «${item.productName}» на месте ${physical} шт., а ${isTransfer ? 'переместить' : 'списать'} нужно ${requested}. Если товар физически есть, укажите «Фактически на месте» прямо в этой строке.`)
          }
          if (observed < requested) {
            throw new Error(`Для «${item.productName}» подтверждено ${observed} шт., а ${isTransfer ? 'переместить' : 'списать'} нужно ${requested}. Исправьте фактическое количество или количество операции.`)
          }
        }
      }
      const response = await apiFetch(isTransfer ? '/api/inventory/transfer?returnInventory=0' : '/api/inventory/movements?returnInventory=0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isTransfer ? {
          requestId: inventoryTransferRequestId,
          fromSource: inventoryDraft.source,
          toSource: inventoryDraft.targetSource,
          comment: inventoryDraft.comment,
          items: cleanItems,
        } : {
          requestId: inventoryManualRequestId,
          inventorySource: inventoryDraft.source,
          movementType: inventoryDraft.movementType,
          comment: inventoryDraft.comment,
          items: cleanItems,
        }),
      })
      const result = await readJsonResponse<{ message?: string; externalId?: string; warnings?: Array<{ shortageAfter?: number }> }>(response, 'Сохранение движения склада')
      if (!response.ok) throw new Error(result.message || `Inventory save failed: ${response.status}`)

      const refreshes: Array<Promise<unknown>> = isTransfer
        ? [
            loadInventoryData('warehouse', true, '', false),
            loadInventoryData('boutique', true, '', false),
          ]
        : inventoryDraft.movementType === 'arrival'
          ? [
              loadInventoryData(inventoryDraft.source, true, '', false),
              loadCatalogData(true),
            ]
          : [
              loadInventoryData(inventoryDraft.source, true, '', false),
            ]
      // Arrival/manual inventory write is already committed once the POST above returned 2xx.
      // Follow-up reads are best-effort: a failed refresh must never turn a committed arrival
      // into a red 'operation failed' state that invites the employee to submit it again.
      await Promise.allSettled(refreshes)
      const transferShortage = isTransfer ? (result.warnings || []).reduce((sum, row) => sum + Math.max(0, Number(row.shortageAfter || 0)), 0) : 0
      setMessage(isTransfer
        ? `Перемещение ${sourceLabel(inventoryDraft.source)} → ${sourceLabel(inventoryDraft.targetSource)} сохранено${result.externalId ? ` · ${result.externalId}` : ''}.${transferShortage > 0 ? ` В исходной точке после перемещения не хватает ${transferShortage} шт. для активных заказов — резервы сохранены.` : ''}`
        : `${sourceLabel(inventoryDraft.source)} обновлён.`)
      if (isTransfer) setInventoryTransferRequestId(makeCashRequestId('inventory-transfer'))
      else setInventoryManualRequestId(makeCashRequestId('inventory-manual'))
      setInventoryDraft((current) => ({
        ...current,
        comment: '',
        items: [createEmptyInventoryItem()],
      }))
      if (inventoryDraft.movementType === 'arrival') {
        setInventoryArrivalPositions([createEmptyArrivalPosition()])
        setInventoryArrivalVariantOpen({})
      }
      resetInventoryOperationSelection()
      setInventoryMatrix(createEmptyInventoryMatrixDraft())
      setInventoryMatrixColorToAdd('')
      setInventoryMatrixSizeToAdd('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setInventoryMovementBusy(false)
    }
  }

  async function saveCatalogProduct() {
    if (!isAdmin) {
      setError('Редактирование каталога товаров доступно только администратору.')
      return
    }

    const payload = {
      name: catalogProductDraft.name,
      category: catalogProductDraft.category,
    }
    const isEdit = catalogProductDraft.id > 0
    const response = await apiFetch(
      isEdit ? `/api/catalog/products/${catalogProductDraft.id}` : '/api/catalog/products',
      {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    const result = await readJsonResponse<{ message?: string }>(response, 'Сохранение товара каталога')
    if (!response.ok) throw new Error(result.message || `Catalog product save failed: ${response.status}`)
    await Promise.all([loadCatalogData(true), loadCatalogReview(true)])
    setCatalogProductDraft({ id: 0, name: '', category: catalogCategoryFilter === 'child' ? 'child' : 'adult' })
    setMessage(isEdit ? 'Товар обновлён.' : 'Товар добавлен.')
  }

  async function saveCatalogVariant() {
    if (!isAdmin) {
      setError('Редактирование вариантов доступно только администратору.')
      return
    }

    const payload = {
      productId: catalogVariantDraft.productId,
      category: catalogVariantDraft.category,
      gender: catalogVariantDraft.gender,
      color: catalogVariantDraft.color,
      material: catalogVariantDraft.material,
      length: catalogVariantDraft.length,
      sizeLabel: catalogVariantDraft.sizeLabel,
      sortOrder: catalogVariantDraft.sortOrder,
    }
    const isEdit = catalogVariantDraft.id > 0
    const response = await apiFetch(
      isEdit ? `/api/catalog/variants/${catalogVariantDraft.id}` : '/api/catalog/variants',
      {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    const result = await readJsonResponse<{ message?: string }>(response, 'Сохранение варианта каталога')
    if (!response.ok) throw new Error(result.message || `Catalog variant save failed: ${response.status}`)
    await Promise.all([loadCatalogData(true), loadCatalogReview(true)])
    setCatalogVariantDraft({
      id: 0,
      productId: '',
      category: catalogCategoryFilter === 'child' ? 'child' : 'adult',
      gender: '',
      color: '',
      material: 'СТАНДАРТ',
      length: 'СТАНДАРТ',
      sizeLabel: '',
      sortOrder: '0',
    })
    setMessage(isEdit ? 'Вариант обновлён.' : 'Вариант добавлен.')
  }

  function updateEditorDraft<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) {
    setEditorDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  function updateEditorItem(index: number, field: keyof EditorItem, value: string | number | boolean) {
    setEditorDraft((current) => {
      if (!current) return current
      const nextItems = current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        const nextItem = { ...item, [field]: field === 'audienceType' ? normalizeAudienceTypeValue(value) : value }
        if (['productName', 'audienceType', 'gender', 'color', 'material', 'length', 'size', 'sourceType'].includes(String(field))) {
          nextItem.stockObservationEnabled = false
          nextItem.observedPhysicalQuantity = null
          nextItem.shortageAcknowledged = false
          nextItem.serverShortage = undefined
        }
        if (field === 'quantity') {
          nextItem.shortageAcknowledged = false
          nextItem.serverShortage = undefined
        }
        if (field === 'audienceType') {
          nextItem.audienceType = normalizeAudienceTypeValue(value)
        }
        if (field === 'audienceType') {
          const nextOptions = getSizeOptions(nextItem.productName, nextItem.audienceType)
          if (nextItem.size && !nextOptions.some((option) => normalizeSuggestion(option) === normalizeSuggestion(nextItem.size))) {
            nextItem.size = ''
          }
        }
        return nextItem
      })
      return { ...current, items: nextItems }
    })
  }

  function updateEditorPayment(index: number, field: keyof EditorPayment, value: string | number) {
    setEditorDraft((current) => {
      if (!current) return current
      const nextPayments = current.payments.map((payment, paymentIndex) => {
        if (paymentIndex !== index) return payment
        if (payment.id && field !== 'method') return payment
        if (field === 'paymentDate' && payment.paymentKind === 'primary') return payment
        if (field === 'paymentKind') {
          const nextKind: EditorPayment['paymentKind'] = value === 'debt_close' ? 'debt_close' : 'primary'
          return {
            ...payment,
            paymentKind: nextKind,
            paymentDate: nextKind === 'primary' ? (current.orderDate || payment.paymentDate) : (payment.paymentDate || formatLocalDateInput()),
          }
        }
        return { ...payment, [field]: value }
      })
      return { ...current, payments: nextPayments }
    })
  }

  function addEditorPayment(paymentKind: 'primary' | 'debt_close') {
    const draftKey = `editor-payment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    setEditorDraft((current) => {
      if (!current) return current
      const paymentDate = paymentKind === 'primary'
        ? (current.orderDate || formatLocalDateInput())
        : formatLocalDateInput()
      return {
        ...current,
        payments: [...current.payments, { ...createEmptyEditorPayment(paymentDate), paymentKind, draftKey }],
      }
    })
  }

  function removeEditorPayment(index: number) {
    setEditorDraft((current) => {
      if (!current || current.payments[index]?.id) return current
      return { ...current, payments: current.payments.filter((_, paymentIndex) => paymentIndex !== index) }
    })
  }

  async function saveEditorPayment(index: number) {
    if (!editorDraft || !selectedOrder || savingOrder) return
    const payment = editorDraft.payments[index]
    if (!payment || payment.id) return
    const paymentKind = payment.paymentKind === 'primary' || payment.paymentKind === 'debt_close'
      ? payment.paymentKind
      : null
    if (!paymentKind) {
      setError('Для обычного заказа доступны только первичная оплата и закрытие долга. Доплата оформляется только внутри обмена.')
      return
    }

    const amount = Number(payment.amount || 0)
    if (!payment.paymentDate) {
      setError('Укажите фактическую дату оплаты.')
      return
    }
    if (!String(payment.method || '').trim()) {
      setError('Выберите способ оплаты.')
      return
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      setError('Сумма оплаты должна быть целым числом больше нуля.')
      return
    }

    setSavingOrder(true)
    setError(null)
    setMessage(null)
    try {
      const payload = {
        orderId: selectedOrder.id,
        paymentDate: payment.paymentDate,
        method: payment.method,
        amount,
        paymentKind,
        comment: payment.comment || '',
      }
      const criticalKey = `order-editor-payment:${selectedOrder.id}:${payment.draftKey || index}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })
      const result = await readJsonResponse<{
        ok?: boolean
        message?: string
        paymentId?: number | null
        order?: OrderRecord
        refreshRequired?: boolean
      }>(response, 'Добавление оплаты')
      if (!response.ok || !result.ok) throw new Error(result.message || `Payment save failed: ${response.status}`)
      const paymentId = Number(result.paymentId || 0)
      if (!paymentId) {
        throw new Error('Оплата могла сохраниться, но сервер не вернул её идентификатор. Повторите сохранение этой строки — повтор безопасен.')
      }
      completeCriticalRequest(criticalKey, critical.requestId)
      setEditorDraft((current) => current ? ({
        ...current,
        payments: current.payments.map((entry, paymentIndex) => (
          paymentIndex === index ? { ...entry, id: paymentId, draftKey: undefined } : entry
        )),
      }) : current)
      if (result.order) {
        upsertOrderInState(result.order)
        setSelectedOrderId(result.order.id)
        setEditorOrderOverride(result.order)
      } else if (result.refreshRequired) {
        void loadDashboard(false)
      }
      invalidateFinanceReadCaches()
      setMessage(`Оплата по заказу ${selectedOrder.external_id} проведена отдельно и не переписывает предыдущие оплаты.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить оплату.')
    } finally {
      setSavingOrder(false)
    }
  }

  function addEditorItem() {
  setEditorDraft((current) => current ? { ...current, items: [...current.items, createEmptyEditorItem()] } : current)
}

function removeEditorItem(index: number) {
  setEditorDraft((current) => {
    if (!current) return current
    const nextItems = current.items.filter((_, itemIndex) => itemIndex !== index)
    return { ...current, items: nextItems.length ? nextItems : [createEmptyEditorItem()] }
  })
}

function updateDebtPayment(index: number, field: keyof EditorPayment, value: string | number) {
  setDebtPayments((current) => current.map((payment, paymentIndex) => (
    paymentIndex === index ? { ...payment, [field]: value, paymentKind: 'debt_close' } : payment
  )))
}

function addDebtPayment() {
  setDebtPayments((current) => [...current, createDebtClosePayment()])
}

function removeDebtPayment(index: number) {
  setDebtPayments((current) => {
    const next = current.filter((_, paymentIndex) => paymentIndex !== index)
    return next.length ? next : [createDebtClosePayment()]
  })
}

  function handleSelectDebtOrder(orderId: number) {
    setDebtSelectedOrderId(orderId)
  }

  function closeDebtForm(returnToList = false) {
    setDebtSelectedOrderId(null)
    setDebtPayments([createDebtClosePayment()])
    if (returnToList) setOrderPanel('list')
  }

  function closeReturnForm(returnToList = true) {
    setReturnSelectedOrderId(null)
    setReturnDraft(createReturnDraft())
    if (returnToList) setOrderPanel('list')
  }

  function closeExchangeForm(returnToList = false) {
    setExchangeSelectedOrderId(null)
    setExchangeDraft(createExchangeDraft())
    if (returnToList) setOrderPanel('list')
  }

  async function openOrderFromFinance(row: { orderId?: number; externalId?: string; orderDate?: string }) {
    const externalId = String(row.externalId || '').trim()
    const orderId = Number(row.orderId || 0)
    const orderDate = String(row.orderDate || '').trim()
    if (!externalId && !orderId) return

    const nextFilters = {
      ...filters,
      q: externalId || String(orderId),
      status: 'all',
      shippingStatus: 'all',
      source: 'all',
      manager: '',
      managerId: 0,
      archiveMode: 'all' as ArchiveMode,
      dateFrom: orderDate,
      dateTo: orderDate,
      pageSize: '100',
    }

    setActiveSector('orders')
    setOrderPanel('list')
    setOrderPeriodPreset('custom')
    setFilters(nextFilters)
    setOrderPageOffset(0)
    setSelectedOrderId(orderId || null)
    window.location.hash = '#orders'
    await loadDashboard(false, nextFilters, 0)
    if (orderId) setSelectedOrderId(orderId)
    window.setTimeout(() => {
      const target = document.querySelector(`[data-order-id="${orderId}"]`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    setMessage(`Показан заказ ${externalId || orderId}.`)
  }

  function handleOpenDebt(order: OrderRecord) {
    if (isArchivedOrderRecord(order)) {
      setSelectedOrderId(order.id)
      setMessage('Архивный заказ доступен только для просмотра. Долг по нему не закрывается из рабочей таблицы.')
      return
    }
    if (isReturnedOrderRecord(order)) {
      setSelectedOrderId(order.id)
      setMessage('Возвращённый заказ уже закрыт как возврат. Долг по нему не закрывается обычной оплатой.')
      return
    }
    if (Number(order.debt_amount || 0) <= 0) {
      setSelectedOrderId(order.id)
      setMessage('У заказа нет открытого долга.')
      return
    }
    setActiveSector('orders')
    setOrderPanel('debt')
    setDebtSelectedOrderId(order.id)
    setDebtPayments([createDebtClosePayment(formatLocalDateInput(), Number(order.debt_amount || 0))])
    setSelectedOrderId(order.id)
    setEditorOpen(false)
  }

  function handleOpenReturn(order: OrderRecord) {
    if (isArchivedOrderRecord(order)) {
      setSelectedOrderId(order.id)
      setMessage('По архивному заказу нельзя оформлять возврат. Он доступен только как история.')
      return
    }
    setActiveSector('orders')
    setOrderPanel('returns')
    setReturnSelectedOrderId(order.id)
    setSelectedOrderId(order.id)
    setEditorOpen(false)
  }

  function handleOpenExchange(order: OrderRecord) {
    if (isArchivedOrderRecord(order)) {
      setSelectedOrderId(order.id)
      setMessage('По архивному заказу нельзя оформлять обмен. Он доступен только как история.')
      return
    }
    setActiveSector('orders')
    setOrderPanel('exchange')
    setExchangeSelectedOrderId(order.id)
    setExchangeDraft(createExchangeDraft(order))
    setSelectedOrderId(order.id)
    setEditorOpen(false)
  }

  function closeOrderEditor() {
    setEditorOpen(false)
    setEditorOrderOverride(null)
    setSelectedOrderId(null)
    if (editorReturnSector === 'workshop') {
      setActiveSector('workshop')
      window.location.hash = '#workshop'
    } else {
      setActiveSector('orders')
      setOrderPanel('list')
      window.location.hash = '#orders'
    }
    setEditorReturnSector('orders')
  }

  function handleEditOrder(order: OrderRecord, returnSector: 'orders' | 'workshop' = 'orders') {
    if (isArchivedOrderRecord(order)) {
      setSelectedOrderId(order.id)
      setEditorOpen(false)
      setMessage('Архивный заказ открыт только для просмотра.')
      return
    }
    if (!isAdmin && (['deleted', 'archived'].includes(order.order_status) || order.shipping_status === 'sent')) {
      setSelectedOrderId(order.id)
      setEditorOpen(false)
      setMessage('Отправленный, удалённый или архивный заказ нельзя редактировать в рабочем режиме. Используйте его отдельное штатное действие.')
      return
    }
    setEditorReturnSector(returnSector)
    setEditorOrderOverride(order)
    setSelectedOrderId(order.id)
    setEditorDraft(createEditorDraft(order))
    setActiveSector('orders')
    setOrderPanel('edit')
    setEditorOpen(true)
    window.location.hash = '#editor'
  }

  function upsertOrderInState(nextOrder: OrderRecord) {
    setOrders((current) => {
      const exists = current.some((order) => order.id === nextOrder.id)
      const nextOrders = exists
        ? current.map((order) => (order.id === nextOrder.id ? nextOrder : order))
        : [nextOrder, ...current]
      return nextOrders.sort((a, b) => {
        if (a.order_date === b.order_date) return b.id - a.id
        return a.order_date < b.order_date ? 1 : -1
      })
    })
  }

  async function persistOrder(nextDraft: EditorDraft, targetOrder?: OrderRecord | null) {
    const order = targetOrder || selectedOrder
    if (!order) return
    if (!isAdmin && (['deleted', 'archived'].includes(order.order_status) || order.shipping_status === 'sent')) {
      setMessage('Отправленный, удалённый или архивный заказ нельзя редактировать в рабочем режиме. Используйте его отдельное штатное действие.')
      return
    }
    if (isArchivedOrderRecord(order)) {
      setMessage('Архивный заказ нельзя редактировать.')
      return
    }

    setSavingOrder(true)
    setError(null)
    setMessage(null)

    try {
      const missingObservation = nextDraft.items.find((item) => item.sourceType !== 'workshop' && item.stockObservationEnabled && (item.observedPhysicalQuantity === null || item.observedPhysicalQuantity === undefined))
      if (missingObservation) {
        throw new Error(`Укажите фактическое количество для «${missingObservation.productName || 'позиции'}» или выберите «Сейчас проверить не могу».`)
      }

      const payload = {
        orderDate: nextDraft.orderDate,
        managerId: nextDraft.managerId || undefined,
        managerName: nextDraft.managerName,
        customerPhone: nextDraft.customerPhone,
        customerName: nextDraft.customerName,
        city: nextDraft.city,
        deliveryType: nextDraft.deliveryType,
        sourceType: deriveOrderSourceType(nextDraft.items),
        orderTotal: nextDraft.orderTotal ? Number(nextDraft.orderTotal) : undefined,
        workshopStatus: nextDraft.workshopStatus,
        orderStatus: nextDraft.orderStatus,
        comment: nextDraft.comment,
        items: nextDraft.items.map((item) => ({
          productName: item.productName,
          audienceType: item.audienceType || 'ВЗРОСЛЫЙ',
          gender: item.gender,
          color: item.color,
          material: item.material,
          length: item.length,
          size: item.size,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice || 0),
          sourceType: item.sourceType,
          workshopComment: item.workshopComment,
          workshopUrgent: Boolean(item.workshopUrgent),
          workshopDueDate: item.workshopUrgent ? item.workshopDueDate : '',
          observedPhysicalQuantity: item.sourceType !== 'workshop' && item.stockObservationEnabled ? item.observedPhysicalQuantity : undefined,
          shortageAcknowledged: item.sourceType !== 'workshop' ? Boolean(item.shortageAcknowledged) : undefined,
        })),
        paymentMethodCorrections: nextDraft.payments
          .filter((payment) => Boolean(payment.id))
          .map((payment) => ({ paymentId: Number(payment.id), method: payment.method })),
      }

      const criticalKey = `order-edit:${order.id}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })

      type EditOrderShortage = {
        inputIndexes?: number[]
        physicalQuantity?: number
        reservedQuantity?: number
        requestedQuantity?: number
        shortage?: number
      }
      type OrderStockWriteResult = {
        productName?: string
        concurrentShortage?: boolean
        shortageAfter?: number
      }
      const result = await readJsonResponse<{
        message?: string
        order?: OrderRecord
        refreshRequired?: boolean
        code?: string
        shortages?: EditOrderShortage[]
        stockWriteOff?: OrderStockWriteResult[]
      }>(response, 'Сохранение заказа')
      if (!response.ok && result.code === 'order_stock_shortage' && Array.isArray(result.shortages) && result.shortages.length) {
        const shortageByInputIndex = new Map<number, EditOrderShortage>()
        for (const shortage of result.shortages) {
          for (const inputIndex of shortage.inputIndexes || []) {
            if (Number.isInteger(Number(inputIndex)) && Number(inputIndex) >= 0) shortageByInputIndex.set(Number(inputIndex), shortage)
          }
        }
        setEditorDraft((current) => current ? ({
          ...current,
          items: current.items.map((item, inputIndex) => {
            const shortage = shortageByInputIndex.get(inputIndex)
            if (!shortage || item.sourceType === 'workshop') return item
            return {
              ...item,
              stockObservationEnabled: false,
              observedPhysicalQuantity: null,
              shortageAcknowledged: false,
              serverShortage: {
                physicalQuantity: Number(shortage.physicalQuantity || 0),
                reservedQuantity: Math.max(0, Number(shortage.reservedQuantity || 0)),
                requestedQuantity: Math.max(0, Number(shortage.requestedQuantity || 0)),
                shortage: Math.max(1, Number(shortage.shortage || 1)),
              },
            }
          }),
        }) : current)
        setError(result.message || 'Перед сохранением уточните отмеченные складские позиции.')
        return null
      }
      if (!response.ok) {
        throw new Error(result.message || `Save failed: ${response.status}`)
      }
      // A 2xx response means the server-side critical operation is durably complete. Clear the
      // browser retry token before readback-driven UI work, including the common result.order path.
      completeCriticalRequest(criticalKey, critical.requestId)

      const pendingEditorPayments = nextDraft.payments.filter((payment) => !payment.id)
      const postSaveShortages = (result.stockWriteOff || []).filter((entry) => Number(entry.shortageAfter || 0) > 0)
      const concurrentShortages = postSaveShortages.filter((entry) => entry.concurrentShortage)
      if (postSaveShortages.length) void loadWarehouseAttention()
      invalidateFinanceReadCaches()
      // Unsent edits can release/recreate reservations; a sent transition can also fulfill them.
      invalidateInventoryStockCaches(true)
      if (concurrentShortages.length) {
        setMessage(`Заказ ${order.external_id} обновлён. Пока он сохранялся, доступный остаток изменился; проверьте «Склад → Внимание».`)
      } else {
        setMessage(`Заказ ${order.external_id} обновлён.`)
      }
      if (result?.order) {
        const savedOrder = result.order as OrderRecord
        upsertOrderInState(savedOrder)
        void loadWorkshopData()
        setSelectedOrderId(savedOrder.id)
        setEditorOrderOverride(savedOrder)
        const savedDraft = createEditorDraft(savedOrder)
        setEditorDraft(pendingEditorPayments.length ? { ...savedDraft, payments: [...savedDraft.payments, ...pendingEditorPayments] } : savedDraft)
        if (pendingEditorPayments.length) {
          setEditorOpen(true)
          setMessage(`Заказ ${order.external_id} обновлён. Новые оплаты ещё не проведены — сохраните каждую новой кнопкой «Провести оплату».`)
        } else {
          closeOrderEditor()
        }
        if (activeSector === 'orders' && orderPanel === 'list') void loadOrdersFinanceSummary(filters, true)
        return savedOrder
      }
      if (pendingEditorPayments.length) {
        setEditorOpen(true)
        setMessage(`Заказ ${order.external_id} сохранён. Новые оплаты ещё не проведены — сохраните каждую отдельно.`)
      } else {
        closeOrderEditor()
      }
      if (result.refreshRequired || !result.order) {
        void loadDashboard(false)
        void loadWorkshopData()
      }
      return null
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      return null
    } finally {
      setSavingOrder(false)
    }
  }


  async function loadArchivePreview() {
    if (!isAdmin) {
      setMessage('Архив доступен только администратору.')
      return
    }
    setArchiveBusy(true)
    setError(null)
    setMessage(null)
    try {
      const params = new URLSearchParams({
        cutoffDate: monthEndFromInput(archiveDraft.month),
        includeNotSent: archiveDraft.includeNotSent ? '1' : '0',
        reason: (archiveDraft.reason || `Закрытие месяца: ${monthLabelFromInput(archiveDraft.month)}`).trim(),
        limit: '1000',
      })
      const response = await apiFetch(`/api/orders/archive/preview?${params.toString()}`)
      const result = await readJsonResponse<ArchivePreviewResponse>(response, 'Предпросмотр архива')
      if (!response.ok) throw new Error(result.message || `Archive preview failed: ${response.status}`)
      setArchivePreview(result)
      setMessage(`К архивации готово: ${result.eligibleCount}. Заблокировано долгом: ${result.blocked.withDebt}, цехом: ${result.blocked.activeWorkshop}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setArchiveBusy(false)
    }
  }

  async function runArchiveOrders() {
    if (!isAdmin) {
      setMessage('Архивация доступна только администратору.')
      return
    }
    const readyCount = archivePreview?.eligibleCount || 0
    if (!readyCount) {
      setMessage('Сначала сделайте предпросмотр. Подходящих заказов пока нет.')
      return
    }
    const confirmed = window.confirm(`Архивировать ${readyCount} закрытых заказов? Они останутся в отчётах, но станут доступны только для просмотра.`)
    if (!confirmed) return

    setArchiveBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/orders/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cutoffDate: monthEndFromInput(archiveDraft.month),
          includeNotSent: archiveDraft.includeNotSent,
          reason: (archiveDraft.reason || `Закрытие месяца: ${monthLabelFromInput(archiveDraft.month)}`).trim(),
          limit: 1000,
        }),
      })
      const result = await readJsonResponse<ArchivePreviewResponse>(response, 'Архивация заказов')
      if (!response.ok) throw new Error(result.message || `Archive failed: ${response.status}`)
      setArchivePreview(result)
      invalidateFinanceReadCaches()
      setMessage(result.message || `Архивировано заказов: ${result.archivedCount || 0}.`)
      setArchiveModalOpen(false)
      // Archiving is already committed when the API returns 2xx. A secondary list refresh must not
      // turn that success into a false "archive failed" message.
      void loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setArchiveBusy(false)
    }
  }

  async function restoreArchivedOrder(order: OrderRecord) {
    if (!isAdmin) {
      setMessage('Возврат из архива доступен только администратору.')
      return
    }
    if (!isArchivedOrderRecord(order)) return
    const confirmed = window.confirm(`Вернуть заказ ${order.external_id} из архива в закрытые заказы?`)
    if (!confirmed) return
    setSavingOrder(true)
    setError(null)
    setMessage(null)
    try {
      const criticalKey = `order-restore:${order.id}`
      const critical = prepareCriticalRequest(criticalKey, { orderId: order.id })
      const response = await apiFetch(`/api/orders/${order.id}/restore`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })
      const result = await readJsonResponse<{ ok: boolean; message?: string; order?: OrderRecord; refreshRequired?: boolean; alreadyRestored?: boolean }>(response, 'Возврат из архива')
      if (!response.ok || !result.ok) throw new Error(result.message || `Restore failed: ${response.status}`)
      completeCriticalRequest(criticalKey, critical.requestId)
      if (result.order) {
        upsertOrderInState(result.order)
        setSelectedOrderId(result.order.id)
        setEditorDraft(createEditorDraft(result.order))
      }
      invalidateFinanceReadCaches()
      setMessage(`Заказ ${order.external_id} возвращён из архива.`)
      // Restore is already committed; refresh is secondary and must not reclassify success as failure.
      void loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSavingOrder(false)
    }
  }

  async function openOrderStockHandover(order: OrderRecord) {
    if (isArchivedOrderRecord(order)) {
      setMessage('Архивный заказ доступен только для просмотра.')
      return
    }
    setStockHandoverOrder(order)
    setStockHandoverData(null)
    setStockHandoverBusy(true)
    setStockHandoverActionItemId(null)
    setError(null)
    try {
      const response = await apiFetch(`/api/orders/${order.id}/stock-handover`)
      const result = await readJsonResponse<OrderStockHandoverResponse>(response, 'Товары со склада')
      if (!response.ok || !result.ok) throw new Error(result.message || `Stock handover failed: ${response.status}`)
      setStockHandoverData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть товары со склада.')
      setStockHandoverOrder(null)
      setStockHandoverData(null)
    } finally {
      setStockHandoverBusy(false)
    }
  }

  async function openOrderStockHandoverById(orderId: number, externalId = '') {
    const id = Number(orderId || 0)
    if (!id) return
    const known = orders.find((order) => Number(order.id) === id)
    if (known) {
      await openOrderStockHandover(known)
      return
    }
    const placeholder = {
      id,
      external_id: externalId || `#${id}`,
      order_status: 'active',
      shipping_status: 'not_sent',
    } as OrderRecord
    await openOrderStockHandover(placeholder)
  }

  function closeOrderStockHandover() {
    if (stockHandoverActionItemId !== null) return
    setStockHandoverOrder(null)
    setStockHandoverData(null)
    setStockHandoverBusy(false)
    setStockHandoverActionItemId(null)
  }

  async function runOrderStockHandoverAction(item: OrderStockHandoverItemView, action: 'issue_now' | 'issued_before_checkpoint' | 'still_here') {
    if (!stockHandoverOrder) return
    const checkpointDate = handoverCheckpointDateLabel(item.checkpointAt)
    const sourceName = handoverSourceLabel(item.source)
    let confirmText = ''
    if (action === 'issue_now') {
      confirmText = `Выдать клиенту сейчас: «${item.productName}» × ${item.quantity} (${sourceName})?\n\nФизический остаток уменьшится на ${item.quantity}. Сам заказ останется «Не отправлен», пока остальные товары не готовы.`
    } else if (action === 'issued_before_checkpoint') {
      confirmText = `На момент ${item.checkpointKind === 'revision' ? 'ревизии' : 'сверки'} ${checkpointDate} клиент уже получил «${item.productName}»?\n\nЕсли да, физический остаток не изменится и повторного списания не будет.`
    } else {
      confirmText = `На момент ${item.checkpointKind === 'revision' ? 'ревизии' : 'сверки'} ${checkpointDate} «${item.productName}» ещё находился в точке?\n\nЕсли да, резерв останется и товар спишется только при фактической выдаче.`
    }
    if (!window.confirm(confirmText)) return

    setStockHandoverActionItemId(item.orderItemId)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch(`/api/orders/${stockHandoverOrder.id}/stock-handover`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          orderItemId: item.orderItemId,
          checkpointId: item.checkpointId || undefined,
          checkpointAt: item.checkpointAt || undefined,
        }),
      })
      const result = await readJsonResponse<OrderStockHandoverResponse>(response, 'Товары со склада')
      if (!response.ok || !result.ok) throw new Error(result.message || `Stock handover failed: ${response.status}`)
      if (result.order) {
        upsertOrderInState(result.order)
        setSelectedOrderId(result.order.id)
        setStockHandoverOrder(result.order)
      }
      if (result.state) setStockHandoverData(result.state)
      if (result.refreshRequired) {
        if (!result.state) {
          try {
            const refresh = await apiFetch(`/api/orders/${stockHandoverOrder.id}/stock-handover`)
            const refreshed = await readJsonResponse<OrderStockHandoverResponse>(refresh, 'Обновление товаров со склада')
            if (refresh.ok && refreshed.ok) setStockHandoverData(refreshed)
          } catch {
            // The committed action remains successful; the modal can be reopened to refresh later.
          }
        }
        if (!result.order) void loadDashboard(false)
      }
      invalidateInventoryStockCaches(true)
      if (action === 'issue_now') {
        setMessage(`«${item.productName}» выдан клиенту. При окончательной отправке заказа этот товар второй раз не спишется.`)
      } else if (action === 'issued_before_checkpoint') {
        setMessage(`«${item.productName}»: подтверждено, что товар уже был у клиента. Остаток не изменён, повторного списания не будет.`)
      } else {
        setMessage(`«${item.productName}»: подтверждено, что во время ${item.checkpointKind === 'revision' ? 'ревизии' : 'сверки'} ${checkpointDate} товар ещё находился у вас.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить действие с товаром.')
      try {
        const refresh = await apiFetch(`/api/orders/${stockHandoverOrder.id}/stock-handover`)
        const refreshed = await readJsonResponse<OrderStockHandoverResponse>(refresh, 'Обновление товаров со склада')
        if (refresh.ok && refreshed.ok) setStockHandoverData(refreshed)
      } catch {
        // Keep the current modal open; the user can close and reopen it safely.
      }
    } finally {
      setStockHandoverActionItemId(null)
    }
  }

  async function markOrderSentToClient(order: OrderRecord) {
    if (isArchivedOrderRecord(order)) {
      setMessage('Архивный заказ нельзя отправлять клиенту или менять.')
      return
    }
    setSavingOrder(true)
    setError(null)
    setMessage(null)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const submitShipping = async (observations?: Array<{ source: InventorySourceKey; variantId: number; expectedQuantity: number; countedQuantity: number }>) => {
        const shippingPayload = { shippingStatus: 'sent', shippingDate: today, observations }
        const criticalKey = `order-shipping:${order.id}`
        const critical = prepareCriticalRequest(criticalKey, shippingPayload)
        const response = await apiFetch(`/api/orders/${order.id}/shipping`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
          body: JSON.stringify(critical.payload),
        })
        const result = await readJsonResponse<{ message?: string; order?: OrderRecord; refreshRequired?: boolean; code?: string; reviewOrderId?: number; blockers?: Array<{ blocker_reason?: string; product_name_snapshot?: string; inventory_source?: string; reservation_variant_id?: number; required_quantity?: number; physical_quantity?: number }> }>(response, 'Отправка клиенту')
        if (response.ok) completeCriticalRequest(criticalKey, critical.requestId)
        return { response, result }
      }
      let { response, result } = await submitShipping()
      if (!response.ok && (result.code === 'workshop_not_ready' || result.code === 'stock_handover_review_required')) {
        setMessage(result.message || 'Перед отправкой проверьте товары со склада.')
        await openOrderStockHandover(order)
        return
      }
      if (!response.ok && result.code === 'catalog_review_required') {
        if (isAdmin) {
          await loadCatalogReview(true, Number(result.reviewOrderId || order.id))
          setActiveSector('inventory')
          openInventoryPanel('catalog')
          setMessage('В этом заказе есть товар, который нужно один раз связать с каталогом. Открыт только этот заказ — старые записи не загружаются.')
        } else {
          setMessage(result.message || 'В заказе есть неразобранная складская позиция. Попросите администратора открыть «Склад → Товары → Требуют разбора».')
        }
        return
      }
      if (!response.ok && result.code === 'inventory_physical_shortage' && Array.isArray(result.blockers) && result.blockers.length) {
        const observations: Array<{ source: InventorySourceKey; variantId: number; expectedQuantity: number; countedQuantity: number }> = []
        for (const blocker of result.blockers.filter((row) => row.blocker_reason === 'insufficient_physical')) {
          const physical = Number(blocker.physical_quantity || 0)
          const required = Math.max(1, Number(blocker.required_quantity || 1))
          const name = blocker.product_name_snapshot || `variant #${blocker.reservation_variant_id || ''}`
          const raw = window.prompt(`По учёту «${name}» на месте ${physical} шт., для отправки нужно ${required}. Если товар физически перед вами, укажите сколько всего реально находится на месте. Отмена — ничего не менять.`, String(Math.max(required, physical)))
          if (raw === null) throw new Error('Отправка отменена. Остатки не изменялись.')
          const counted = Number(raw)
          if (!Number.isInteger(counted) || counted < required) throw new Error(`Для «${name}» нужно подтвердить целое фактическое количество не меньше ${required}.`)
          observations.push({
            source: blocker.inventory_source === 'boutique' ? 'boutique' : 'warehouse',
            variantId: Number(blocker.reservation_variant_id || 0),
            expectedQuantity: physical,
            countedQuantity: counted,
          })
        }
        ;({ response, result } = await submitShipping(observations))
      }
      if (!response.ok) {
        throw new Error(result.message || `Shipping failed: ${response.status}`)
      }
      if (result?.order) {
        upsertOrderInState(result.order as OrderRecord)
        void loadWorkshopData()
        setSelectedOrderId(result.order.id)
      }
      if (result.refreshRequired || !result.order) {
        void loadDashboard(false)
        void loadWorkshopData()
      }
      // Shipping is now the physical stock event. Invalidate cached physical/reserved/available values.
      invalidateInventoryStockCaches(true)
      setMessage(`Заказ ${order.external_id} отмечен как отправленный клиенту.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSavingOrder(false)
    }
  }

  async function deleteOrderAsAdmin(order: OrderRecord) {
    if (isArchivedOrderRecord(order)) {
      setMessage('Архивный заказ нельзя удалить. Сначала верните его из архива.')
      return
    }
    const confirmed = window.confirm(`Удалить заказ ${order.external_id}? Он исчезнет из рабочих таблиц, но запись останется в журнале.`)
    if (!confirmed) return
    setSavingOrder(true)
    setError(null)
    setMessage(null)
    try {
      const criticalKey = `order-delete:${order.id}`
      const sendDelete = async (physicalOutcome?: 'not_issued') => {
        const payload = {
          comment: order.comment || 'Удалено сотрудником как ошибочный заказ',
          ...(physicalOutcome ? { physicalOutcome } : {}),
        }
        const critical = prepareCriticalRequest(criticalKey, payload)
        const response = await apiFetch(`/api/orders/${order.id}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
          body: JSON.stringify(critical.payload),
        })
        const result = await readJsonResponse<{ ok?: boolean; code?: string; message?: string; order?: OrderRecord }>(response, 'Удаление заказа')
        return { response, result, critical }
      }

      let attempt = await sendDelete()
      if (!attempt.response.ok && attempt.result.code === 'order_delete_physical_confirmation_required') {
        const notIssued = window.confirm(
          `Заказ ${order.external_id} отмечен как выданный или отправленный.\n\nПодтвердите только если товар ФАКТИЧЕСКИ НЕ передавался клиенту и отметка выдачи ошибочная. Тогда система сама отменит ложное складское списание и продолжит удаление.\n\nЕсли товар реально передавался — нажмите «Отмена»: удаление остановится без изменений.`
        )
        if (!notIssued) {
          throw new Error('Удаление остановлено. Заказ с реальной выдачей нужно сначала привести к фактическому состоянию через возврат товара.')
        }
        attempt = await sendDelete('not_issued')
      }
      if (!attempt.response.ok) throw new Error(attempt.result.message || `Delete failed: ${attempt.response.status}`)
      completeCriticalRequest(criticalKey, attempt.critical.requestId)
      setOrders((current) => current.filter((entry) => entry.id !== order.id))
      if (selectedOrderId === order.id) {
        setSelectedOrderId(null)
        setEditorOpen(false)
      }
      invalidateFinanceReadCaches()
      invalidateInventoryStockCaches(true)
      setMessage(attempt.result.message || `Заказ ${order.external_id} удалён из активной работы.`)
      void loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSavingOrder(false)
    }
  }

  async function saveSelectedOrder() {
    if (!editorDraft) return
    await persistOrder(editorDraft)
  }

  async function saveDebtClose() {
    if (!debtSelectedOrder) {
      setError('Сначала выберите заказ с долгом.')
      return
    }

    const normalizedPayments = debtPayments
      .map((payment) => ({
        ...payment,
        amount: Math.max(0, Number(payment.amount || 0)),
        method: String(payment.method || '').trim(),
        paymentKind: 'debt_close' as const,
      }))
      .filter((payment) => payment.amount > 0 && payment.method)

    if (!normalizedPayments.length) {
      setError('Добавьте хотя бы одну оплату с суммой больше нуля и способом оплаты.')
      return
    }

    const closeAmount = normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0)
    if (closeAmount > Number(debtSelectedOrder.debt_amount || 0)) {
      setError(`Сумма закрытия ${formatMoney(closeAmount)} больше текущего долга ${formatMoney(debtSelectedOrder.debt_amount)}.`)
      return
    }

    setDebtBusy(true)
    setError(null)
    setMessage(null)
    let savedOrder: OrderRecord | null = debtSelectedOrder
    let savedPaymentCount = 0

    try {
      let hasFreshSavedOrder = false
      for (const [paymentIndex, payment] of normalizedPayments.entries()) {
        const payload = {
          orderId: debtSelectedOrder.id,
          paymentDate: payment.paymentDate,
          method: payment.method,
          amount: payment.amount,
          paymentKind: 'debt_close' as const,
          comment: payment.comment || '',
        }
        const criticalKey = `order-debt-payment:${debtSelectedOrder.id}:${paymentIndex}`
        const critical = prepareCriticalRequest(criticalKey, payload)
        const response = await apiFetch('/api/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
          body: JSON.stringify(critical.payload),
        })
        const result = await readJsonResponse<{ ok?: boolean; message?: string; order?: OrderRecord; debtClosed?: boolean; refreshRequired?: boolean }>(response, 'Закрытие долга')
        if (!response.ok) throw new Error(result.message || `Payment failed: ${response.status}`)
        completeCriticalRequest(criticalKey, critical.requestId)
        if (result.order) {
          savedOrder = result.order
          hasFreshSavedOrder = true
        }
        savedPaymentCount += 1
      }

      if (savedOrder && hasFreshSavedOrder) {
        upsertOrderInState(savedOrder)
        setDebtAllOrders((current) => current
          .map((entry) => entry.id === savedOrder?.id ? savedOrder : entry)
          .filter((entry) => Number(entry.debt_amount || 0) > 0 && entry.order_status !== 'deleted' && entry.order_status !== 'archived'))
      }
      setDebtSelectedOrderId(null)
      setDebtPayments([createDebtClosePayment()])
      const remainingDebt = Math.max(0, Number(savedOrder?.debt_amount || 0))
      setMessage(hasFreshSavedOrder
        ? (remainingDebt <= 0
            ? `Долг по заказу ${debtSelectedOrder.external_id} закрыт.`
            : `Оплата сохранена. Остаток долга по заказу ${debtSelectedOrder.external_id}: ${formatMoney(remainingDebt)}.`)
        : `Оплата по заказу ${debtSelectedOrder.external_id} сохранена. Список долгов обновляется.`)
      await Promise.allSettled([loadAllOpenDebtOrders(), refreshFinanceReportsIfVisible(), loadDashboard(false)])
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Не удалось сохранить оплату по долгу.'
      if (savedPaymentCount > 0) {
        setError(`Сохранено оплат: ${savedPaymentCount}. Следующая оплата не сохранилась: ${reason}`)
        await Promise.allSettled([loadAllOpenDebtOrders(), loadDashboard(false)])
      } else {
        setError(reason)
      }
    } finally {
      setDebtBusy(false)
    }
  }

  async function saveReturn() {
    if (!returnSelectedOrder) {
      setError('Сначала выберите заказ для возврата.')
      return
    }

    const amount = Math.max(0, Number(returnDraft.amount || 0))
    const availableAmount = Math.max(
      0,
      Number(returnSelectedOrder.received_amount || 0) - Number(returnSelectedOrder.return_amount || 0),
    )

    if (amount <= 0) {
      setError('Укажите сумму возврата больше нуля.')
      return
    }

    if (amount > availableAmount) {
      setError(`Сумма возврата ${formatMoney(amount)} больше доступной суммы ${formatMoney(availableAmount)}.`)
      return
    }
    if (!returnDraft.paymentMethod.trim()) {
      setError('Выберите способ возврата денег. Это нужно для правильного учёта наличных и финансов.')
      return
    }

    setReturnBusy(true)
    setError(null)
    setMessage(null)

    try {
      const payload = {
        orderId: returnSelectedOrder.id,
        returnDate: returnDraft.returnDate,
        amount,
        paymentMethod: returnDraft.paymentMethod,
        comment: returnDraft.comment,
        restockSource: returnDraft.restockSource,
        items: returnDraft.items
          .filter((item) => Number(item.orderItemId || 0) > 0 && Number(item.quantity || 0) > 0)
          .map((item) => ({
            orderItemId: item.orderItemId,
            quantity: item.quantity,
            restock: item.restock,
          })),
      }
      const criticalKey = `return-create:${returnSelectedOrder.id}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })

      const result = await readJsonResponse<{ ok?: boolean; message?: string; order?: OrderRecord; pendingInventoryCount?: number }>(response, 'Возврат')
      if (!response.ok) {
        throw new Error(result.message || `Return failed: ${response.status}`)
      }
      // The return is already durably completed on the server. Clear its retry token before any
      // secondary refresh so a read failure cannot make the UI treat a committed return as unsaved.
      completeCriticalRequest(criticalKey, critical.requestId)

      if (result.order) {
        upsertOrderInState(result.order)
        setSelectedOrderId(result.order.id)
      }
      setReturnSelectedOrderId(null)
      setReturnDraft(createReturnDraft())
      setOrderPanel('list')

      await Promise.allSettled([
        loadReturnHistory(),
        refreshActivityLogIfVisible(),
        refreshFinanceReportsIfVisible(),
        loadDashboard(false),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        isAdmin ? loadInventoryLifecycle(true) : Promise.resolve(null),
      ])
      const pendingInventoryCount = Math.max(0, Number(result.pendingInventoryCount || 0))
      setMessage(pendingInventoryCount > 0
        ? `Возврат по заказу ${returnSelectedOrder.external_id} сохранён. ${pendingInventoryCount} физ. позици${pendingInventoryCount === 1 ? 'я ожидает' : 'и ожидают'} подтверждения администратора; остаток по ним пока не изменён.`
        : `Возврат по заказу ${returnSelectedOrder.external_id} сохранён.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setReturnBusy(false)
    }
  }

  async function saveExchange() {
    if (!exchangeSelectedOrder) {
      setError('Сначала выберите заказ для обмена.')
      return
    }

    const exchangeableOldItems = exchangeSelectedOrder.items.filter((item) => Number(item.id || 0) > 0 && Number(item.quantity || 0) > 0)
    const requestedOldItem = exchangeableOldItems.find((item) => Number(item.id || 0) === Number(exchangeDraft.oldItemId || 0)) || null
    // The browser can display the first <option> even when the controlled value
    // matches no option. Submit the same concrete row that is visibly selected.
    const selectedOldItem = requestedOldItem || exchangeableOldItems[0] || null
    if (!selectedOldItem) {
      setError(exchangeableOldItems.length
        ? 'Выберите старую позицию, которую клиент возвращает.'
        : 'В заказе не осталось доступных позиций для обмена.')
      return
    }

    if (Number(exchangeDraft.oldQuantity || 0) > Number(selectedOldItem.quantity || 0)) {
      setError(`Для обмена доступно ${Number(selectedOldItem.quantity || 0)} шт.`)
      return
    }

    if (!exchangeDraft.newItem.productName.trim()) {
      setError('Заполните новый товар для обмена.')
      return
    }

    if (exchangeDraft.financialAction !== 'none' && Number(exchangeDraft.financialAmount || 0) <= 0) {
      setError('Укажите сумму доплаты или возврата больше нуля.')
      return
    }

    if (exchangeDraft.financialAction !== 'none' && !exchangeDraft.paymentMethod.trim()) {
      setError(exchangeDraft.financialAction === 'refund' ? 'Выберите способ возврата денег.' : 'Выберите способ оплаты для доплаты.')
      return
    }

    const inheritedReplacementSource = selectedOldItem.sourceType === 'workshop'
      ? 'workshop'
      : selectedOldItem.sourceType === 'boutique'
        ? 'boutique'
        : 'warehouse'
    const effectiveNewItem = exchangeDraft.newSourceWasManuallyChanged
      ? exchangeDraft.newItem
      : { ...exchangeDraft.newItem, sourceType: inheritedReplacementSource as EditorItem['sourceType'] }

    const exchangeAvailability = effectiveNewItem.sourceType === 'workshop'
      ? null
      : getOrderSourceAvailability(effectiveNewItem, Math.max(1, Number(effectiveNewItem.quantity || 1)))
    const exchangeRequiredQuantity = Math.max(1, Number(effectiveNewItem.quantity || 1))
    const exchangeNeedsPhysicalConfirmation = Boolean(
      exchangeAvailability?.canObservePhysical
      && Number(exchangeAvailability.currentPhysical || 0) < exchangeRequiredQuantity
    )
    if (exchangeNeedsPhysicalConfirmation && !effectiveNewItem.stockObservationEnabled) {
      setExchangeDraft((current) => ({
        ...current,
        newItem: { ...current.newItem, stockObservationEnabled: true, observedPhysicalQuantity: null },
      }))
      setError('По учёту физического количества новой позиции недостаточно. Если товар перед вами, укажите сколько реально лежит на месте — обмен продолжится сразу после этой сверки.')
      return
    }
    if (effectiveNewItem.stockObservationEnabled) {
      const observedPhysical = effectiveNewItem.observedPhysicalQuantity
      if (observedPhysical === null || observedPhysical === undefined || !Number.isInteger(Number(observedPhysical)) || Number(observedPhysical) < 0) {
        setError('Укажите целое фактическое количество новой позиции на месте.')
        return
      }
      if (Number(observedPhysical) < Math.max(1, Number(effectiveNewItem.quantity || 1))) {
        setError(`Для обмена нужно ${Math.max(1, Number(effectiveNewItem.quantity || 1))} шт., а вы подтвердили физически ${Number(observedPhysical)} шт.`)
        return
      }
    }

    setExchangeBusy(true)
    setError(null)
    setMessage(null)

    try {
      const payload = {
        orderId: exchangeSelectedOrder.id,
        exchangeDate: exchangeDraft.exchangeDate,
        oldItemId: Number(selectedOldItem.id || 0),
        oldQuantity: exchangeDraft.oldQuantity,
        oldReturnSource: exchangeDraft.oldReturnSource,
        newItem: effectiveNewItem,
        newSourceWasManuallyChanged: exchangeDraft.newSourceWasManuallyChanged,
        financialAction: exchangeDraft.financialAction,
        financialAmount: exchangeDraft.financialAmount,
        paymentMethod: exchangeDraft.paymentMethod,
        comment: exchangeDraft.comment,
      }
      const criticalKey = `exchange-create:${exchangeSelectedOrder.id}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch('/api/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })

      const result = await readJsonResponse<{ ok?: boolean; message?: string; order?: OrderRecord; exchangeId?: number; pendingInventoryCount?: number }>(response, 'Обмен')
      if (!response.ok) {
        throw new Error(result.message || `Exchange failed: ${response.status}`)
      }
      completeCriticalRequest(criticalKey, critical.requestId)

      if (result.order) {
        upsertOrderInState(result.order)
        setSelectedOrderId(result.order.id)
      }
      const exchangeTouchesWorkshop = selectedOldItem.sourceType === 'workshop' || effectiveNewItem.sourceType === 'workshop'
      setExchangeSelectedOrderId(null)
      setExchangeDraft(createExchangeDraft())
      await Promise.allSettled([
        loadExchangeHistory(),
        refreshActivityLogIfVisible(),
        refreshFinanceReportsIfVisible(),
        loadDashboard(false),
        exchangeTouchesWorkshop ? loadWorkshopData() : Promise.resolve(null),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        isAdmin ? loadInventoryLifecycle(true) : Promise.resolve(null),
      ])
      const pendingInventoryCount = Math.max(0, Number(result.pendingInventoryCount || 0))
      setMessage(pendingInventoryCount > 0
        ? `Обмен по заказу ${exchangeSelectedOrder.external_id} сохранён. ${pendingInventoryCount} складск${pendingInventoryCount === 1 ? 'ое движение ожидает' : 'их движения ожидают'} подтверждения администратора; система не угадывала остаток.`
        : `Обмен по заказу ${exchangeSelectedOrder.external_id} сохранён.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setExchangeBusy(false)
    }
  }

  async function cancelReturnEntry(entry: ReturnHistoryEntry) {
    if (!window.confirm(`Отменить возврат ${entry.externalId || ''} на ${formatMoney(entry.amount)}? Система отменит деньги и статус возврата. Более свежие фактические данные склада, если они уже появились, будут сохранены.`)) return
    setReturnBusy(true)
    setError(null)
    setMessage(null)
    try {
      const payload = { comment: 'Отменено из интерфейса Cloudflare' }
      const criticalKey = `return-cancel:${entry.id}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch(`/api/returns/${entry.id}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })
      const result = await readJsonResponse<{ ok?: boolean; message?: string; order?: OrderRecord }>(response, 'Отмена возврата')
      if (!response.ok) throw new Error(result.message || `Cancel return failed: ${response.status}`)
      completeCriticalRequest(criticalKey, critical.requestId)
      if (result.order) {
        upsertOrderInState(result.order)
        setReturnSelectedOrderId(result.order.id)
        setReturnDraft(createReturnDraft(result.order))
      }
      await Promise.allSettled([
        loadReturnHistory(),
        refreshActivityLogIfVisible(),
        refreshFinanceReportsIfVisible(),
        loadDashboard(false),
        loadWorkshopData(),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        loadInventoryLifecycle(true),
      ])
      setMessage(`Возврат по заказу ${entry.externalId || ''} отменён. Финансы, остатки и цех обновлены.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отмены возврата')
    } finally {
      setReturnBusy(false)
    }
  }

  async function cancelExchangeEntry(entry: ExchangeHistoryEntry) {

    if (!window.confirm(`Отменить обмен по заказу ${entry.externalId}? Система отменит деньги, статус и новую позицию. Более свежие фактические данные склада, если они уже появились, будут сохранены.`)) return
    setExchangeBusy(true)
    setError(null)
    setMessage(null)
    try {
      const payload = { comment: 'Отменено из интерфейса Cloudflare' }
      const criticalKey = `exchange-cancel:${entry.id}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch(`/api/exchanges/${entry.id}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })
      const result = await readJsonResponse<{ ok?: boolean; message?: string; order?: OrderRecord }>(response, 'Отмена обмена')
      if (!response.ok) throw new Error(result.message || `Cancel exchange failed: ${response.status}`)
      completeCriticalRequest(criticalKey, critical.requestId)
      if (result.order) {
        upsertOrderInState(result.order)
        setSelectedOrderId(result.order.id)
        setExchangeSelectedOrderId(result.order.id)
      }
      await Promise.allSettled([
        loadExchangeHistory(),
        refreshActivityLogIfVisible(),
        refreshFinanceReportsIfVisible(),
        loadDashboard(false),
        loadWorkshopData(),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        loadInventoryLifecycle(true),
      ])
      setMessage(`Обмен по заказу ${entry.externalId} отменён. Финансы, позиции, остатки и цех обновлены.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отмены обмена')
    } finally {
      setExchangeBusy(false)
    }
  }

  async function setSelectedWorkshopStatus(status: EditorDraft['workshopStatus'], targetOrder?: OrderRecord) {
    if (targetOrder && isArchivedOrderRecord(targetOrder)) {
      setMessage('Архивный заказ нельзя менять.')
      return
    }
    const baseDraft = targetOrder ? createEditorDraft(targetOrder) : editorDraft
    if (!baseDraft) return
    const nextDraft = { ...baseDraft, workshopStatus: status }
    setEditorDraft(nextDraft)
    await persistOrder(nextDraft, targetOrder)
  }


  function renderInventoryStockGroups(source: InventorySourceKey, groups: InventoryStockGroup[]) {
    return InventoryStockGroupsRenderer(source, groups, { expandedInventoryGroups, getInventoryRowCategory, hasInventoryQuickFilters, inventorySearchTokens, isAdmin, productCategoryLabel, sourceLabel, startInventoryTransferFromStockRow, toggleInventoryGroup })
  }

  const financeReportOptions: Array<{ value: FinanceReportType; label: string; note: string }> = [
    { value: 'payments', label: 'Способы оплаты', note: 'Деньги по фактической дате поступления.' },
    { value: 'managers', label: 'Менеджеры', note: 'Продажи по дате заказа, деньги и возвраты — по фактической дате операции.' },
    { value: 'products', label: 'Товары', note: 'Товары из заказов, созданных в выбранный период.' },
    { value: 'cities', label: 'Города', note: 'Продажи по дате заказа, деньги — по фактической дате поступления.' },
    { value: 'returns', label: 'Возвраты', note: 'Возвраты по фактической дате возврата.' },
    { value: 'debts', label: 'Закрытые долги', note: 'Закрытия долгов по фактической дате оплаты.' },
    { value: 'leads', label: 'Лиды', note: 'Лиды по менеджерам и итоговые показатели.' },
    { value: 'callCentre', label: 'Call Centre', note: 'Звонки, фейки, отказники и потенциалы.' },
  ]


  function renderOrderSizeSelect(
    item: EditorItem,
    index: number,
    onUpdate: (index: number, field: keyof EditorItem, value: string | number | boolean) => void,
    keyPrefix: string,
  ) {
    const audienceType = normalizeAudienceTypeValue(item.audienceType)
    const rawOptions = audienceType === 'ДЕТСКИЙ' ? suggestionValues.childAges : suggestionValues.sizes
    const normalizedOptions = (audienceType === 'ДЕТСКИЙ' ? rawOptions : rawOptions.filter(isLikelyAdultSizeValue))
    const currentSize = String(item.size || '').trim()
    const options = currentSize && !normalizedOptions.some((option) => normalizeSuggestion(option) === normalizeSuggestion(currentSize))
      ? [currentSize, ...normalizedOptions]
      : normalizedOptions
    return (
      <select
        key={`${keyPrefix}-size-${index}-${audienceType}`}
        value={currentSize}
        onChange={(event) => onUpdate(index, 'size', event.target.value)}
      >
        <option value="">{audienceType === 'ДЕТСКИЙ' ? 'Выберите возраст' : 'Выберите размер'}</option>
        {options.map((option) => <option key={`${keyPrefix}-size-${index}-${option}`} value={option}>{option}</option>)}
      </select>
    )
  }


  function openStorageMonthReports(months: string[]) {
    const sortedMonths = [...months].sort()
    const firstMonth = sortedMonths[0]
    const lastMonth = sortedMonths.at(-1)
    if (!firstMonth || !lastMonth) return
    storageMaintenance.hidePanelForReports()
    setFinanceReportFilters({ dateFrom: `${firstMonth}-01`, dateTo: monthEndFromInput(lastMonth) })
    setActiveSector('reports')
    window.location.hash = '#reports'
    setMessage(`Открыты отчёты за период ${firstMonth} — ${lastMonth}. Сохраните нужные Word/PDF перед удалением.`)
  }

  if (authChecking) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="erp-brand auth-brand">
            <div className="erp-brand-mark">S</div>
            <div>
              <div className="erp-brand-title">Система заказов</div>
              <div className="erp-brand-subtitle">Проверяем вход...</div>
            </div>
          </div>
          <p className="muted-note">Загрузка сессии.</p>
        </section>
      </main>
    )
  }

  if (!authUser) {
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={submitAuth}>
          <div className="erp-brand auth-brand">
            <div className="erp-brand-mark">S</div>
            <div>
              <div className="erp-brand-title">Система заказов</div>
              <div className="erp-brand-subtitle">{authHasUsers ? 'Вход по почте и паролю' : 'Первый запуск'}</div>
            </div>
          </div>
          <div>
            <h1>{authHasUsers ? 'Вход' : 'Создать администратора'}</h1>
            <p>
              {authHasUsers
                ? 'Введите почту и пароль. Роль больше не переключается вручную.'
                : 'Создайте первый аккаунт администратора. После этого можно будет добавить менеджеров.'}
            </p>
          </div>
          {error ? <div className="app-alert error"><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div> : null}
          {!authHasUsers ? (
            <label>
              <span>Имя администратора</span>
              <input value={authDisplayName} onChange={(event) => setAuthDisplayName(event.target.value)} placeholder="Например: Администратор" />
            </label>
          ) : null}
          <label>
            <span>Почта</span>
            <input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} type="email" autoComplete="email" required placeholder="name@example.com" />
          </label>
          <label>
            <span>Пароль</span>
            <input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} type="password" autoComplete={authHasUsers ? 'current-password' : 'new-password'} required minLength={8} placeholder="Минимум 8 символов" />
          </label>
          <button className="primary" type="submit" disabled={authBusy}>
            {authBusy ? 'Проверяю...' : authHasUsers ? 'Войти' : 'Создать администратора'}
          </button>
        </form>
      </main>
    )
  }

  if (authUser.mustChangePassword) {
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={submitPasswordChange}>
          <div className="erp-brand auth-brand">
            <div className="erp-brand-mark">S</div>
            <div>
              <div className="erp-brand-title">Система заказов</div>
              <div className="erp-brand-subtitle">Первый вход сотрудника</div>
            </div>
          </div>
          <div>
            <h1>Смените временный пароль</h1>
            <p>Администратор создал аккаунт с временным паролем. Перед работой нужно задать свой пароль.</p>
          </div>
          {error ? <div className="app-alert error"><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div> : null}
          <label>
            <span>Текущий временный пароль</span>
            <input value={passwordChangeDraft.currentPassword} onChange={(event) => setPasswordChangeDraft((draft) => ({ ...draft, currentPassword: event.target.value }))} type="password" autoComplete="current-password" required />
          </label>
          <label>
            <span>Новый пароль</span>
            <input value={passwordChangeDraft.newPassword} onChange={(event) => setPasswordChangeDraft((draft) => ({ ...draft, newPassword: event.target.value }))} type="password" autoComplete="new-password" required minLength={8} />
          </label>
          <button className="primary" type="submit" disabled={passwordChangeBusy}>
            {passwordChangeBusy ? 'Сохраняю...' : 'Сменить пароль и войти'}
          </button>
          <button className="secondary" type="button" onClick={() => void logout()} disabled={passwordChangeBusy}>Выйти</button>
        </form>
      </main>
    )
  }

  return (
    <main className="erp-shell" data-sector={activeSector}>
      <TableDragScrollManager />
      <div className="global-alert-stack" aria-live="assertive" aria-atomic="true">
        {error ? (
          <div className="error app-alert global-alert" role="alert">
            <span>{error}</span>
            <button type="button" aria-label="Закрыть ошибку" onClick={() => setError(null)}>×</button>
          </div>
        ) : null}
        {message ? (
          <div className="success app-alert global-alert" role="status">
            <span>{message}</span>
            <button type="button" aria-label="Закрыть сообщение" onClick={() => setMessage(null)}>×</button>
          </div>
        ) : null}
      </div>
      <DatabaseStorageWarning maintenance={storageMaintenance} />
      <aside className={`erp-sidebar ${mobileNavOpen ? 'is-mobile-open' : ''}`.trim()}>
        <div className="erp-sidebar-scroll" tabIndex={0} aria-label="Навигация и режим доступа">
        <div className="erp-brand">
          <div className="erp-brand-mark">S</div>
          <div>
            <div className="erp-brand-title">Система заказов</div>
            <div className="erp-brand-subtitle">Продажи · склад · цех</div>
          </div>
        </div>
        <button
          className="mobile-nav-toggle"
          type="button"
          aria-expanded={mobileNavOpen}
          aria-controls="primary-workspace-navigation"
          aria-label={mobileNavOpen ? 'Закрыть меню разделов' : 'Открыть меню разделов'}
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          <span className="mobile-nav-toggle-icon" aria-hidden="true"><i /><i /><i /></span>
          <span>{mobileNavOpen ? 'Закрыть' : 'Разделы'}</span>
        </button>


        <div className="erp-sidebar-card access-role-card">
          <div className="card-label">Режим доступа</div>
          <div className="access-role-control">
            <div className="auth-user-card">
              <strong>{isAdmin ? 'Админ режим' : 'Рабочий режим'}</strong>
              <span>{isAdmin ? 'Доступны настройки, удаления и служебные действия' : 'Обычная работа без входа'}</span>
              <em>{isAdmin ? 'Администратор' : 'Менеджер'}</em>
            </div>
            {isAdmin ? (
              <div className="access-role-actions">
                <button className="secondary compact" type="button" onClick={storageMaintenance.openPanel}>
                  Хранилище
                </button>
                <button className="secondary compact" type="button" onClick={() => setPasswordChangeOpen(true)}>
                  Сменить пароль
                </button>
                <button className="secondary compact" type="button" onClick={() => void logout()}>
                  Выйти из админ режима
                </button>
              </div>
            ) : (
              <button className="primary compact" type="button" onClick={() => setAdminModeOpen(true)}>
                Войти в админ режим
              </button>
            )}
          </div>
        </div>

        <nav className="erp-primary-nav" id="primary-workspace-navigation" aria-label="Основные разделы">
          {workspaceModules.map((module) => (
            <a
              key={module.id}
              className={`erp-primary-nav-button ${module.status === 'planned' ? 'is-planned' : ''} ${(module.id === 'dashboard' ? activeSector === 'overview' : module.id === activeSector) ? 'is-current' : ''}`}
              href={module.href}
              title={module.note}
              onClick={() => setMobileNavOpen(false)}
            >
              <span className="erp-nav-icon">{module.icon}</span>
              <span>{module.label}</span>
              {module.id === 'inventory' && Number(warehouseAttention?.total || 0) > 0 ? (
                <span className="warehouse-attention-nav-badge" aria-label={`Требует внимания: ${warehouseAttention?.total || 0}`}>{warehouseAttention?.total}</span>
              ) : null}
            </a>
          ))}
        </nav>

        <div className="erp-sidebar-footer">
          Рабочая панель: активные списки, склад, цех, клиенты и отчёты разделены по задачам.
        </div>
        </div>
      </aside>
      <button
        className={`mobile-nav-backdrop ${mobileNavOpen ? 'is-visible' : ''}`.trim()}
        type="button"
        aria-label="Закрыть меню разделов"
        tabIndex={mobileNavOpen ? 0 : -1}
        onClick={() => setMobileNavOpen(false)}
      />

      {stockHandoverOrder ? (
        <div className="modal-backdrop order-stock-handover-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeOrderStockHandover() }}>
          <section className="modal-card order-stock-handover-modal" role="dialog" aria-modal="true" aria-label={`Товары со склада · ${stockHandoverOrder.external_id}`}>
            <div className="modal-head order-stock-handover-head">
              <div>
                <div className="card-label">Товары со склада и Бутика</div>
                <h3>{stockHandoverOrder.external_id}</h3>
                <div className="order-stock-handover-context">
                  {stockHandoverData?.customerName ? <strong>{stockHandoverData.customerName}</strong> : null}
                  {stockHandoverData?.orderDate ? <span>Заказ от {handoverCheckpointDateLabel(stockHandoverData.orderDate)}</span> : null}
                  {stockHandoverData?.orderCreatedAt ? <span>Внесён в систему {handoverDateTimeLabel(stockHandoverData.orderCreatedAt)}</span> : null}
                </div>
                <p>Здесь фиксируется, где товар находится физически. Если товар уже был у клиента, система не спишет его второй раз.</p>
              </div>
              <button className="secondary compact" type="button" onClick={closeOrderStockHandover} disabled={stockHandoverActionItemId !== null}>Закрыть</button>
            </div>

            {stockHandoverBusy && !stockHandoverData ? (
              <div className="order-stock-handover-loading">Проверяю состояние товаров…</div>
            ) : stockHandoverData ? (
              <>
                {stockHandoverData.workshopPending ? (
                  <div className="order-stock-handover-rule is-workshop">
                    <strong>Товары из Цеха ещё не готовы.</strong>
                    <span>Готовые товары со Склада и Бутика можно выдать клиенту сейчас. Весь заказ останется «Не отправлен» до готовности Цеха.</span>
                  </div>
                ) : Number(stockHandoverData.workshopItemCount || 0) > 0 ? (
                  <div className="order-stock-handover-rule is-ready">
                    <strong>Товары из Цеха готовы.</strong>
                    <span>После уточнения можно закрыть это окно и нажать «Отправить клиенту».</span>
                  </div>
                ) : (
                  <div className="order-stock-handover-rule is-ready">
                    <strong>В заказе нет товаров из Цеха.</strong>
                    <span>Уточните отмеченные товары со Склада или Бутика. После этого заказ можно отправить обычной кнопкой «Отправить клиенту».</span>
                  </div>
                )}

                <div className="order-stock-handover-list">
                  {(stockHandoverData.items || []).map((item) => {
                    const actionBusy = stockHandoverActionItemId === item.orderItemId
                    const checkpointDate = handoverCheckpointDateLabel(item.checkpointAt)
                    const checkpointWord = item.checkpointKind === 'revision' ? 'ревизии' : 'сверки'
                    const sourceName = handoverSourceLabel(item.source)
                    return (
                      <article className={`order-stock-handover-item is-${item.state}`} key={`stock-handover-${item.orderItemId}`}>
                        <div className="order-stock-handover-item-main">
                          <div>
                            <strong>{item.productName}</strong>
                            {item.itemDetails ? <small>{item.itemDetails}</small> : null}
                            <span>{sourceName} · {item.quantity} шт.</span>
                          </div>
                        </div>

                        {item.state === 'already_issued' ? (
                          <div className="order-stock-handover-result is-done">
                            <strong>Уже выдано клиенту.</strong>
                            <span>{item.reviewDecision === 'issued_before_checkpoint' ? `Подтверждено, что товар был у клиента до ${checkpointWord} ${handoverCheckpointDateLabel(item.reviewedCheckpointAt || item.checkpointAt)}. Физический остаток второй раз не уменьшался.` : 'При окончательной отправке заказа этот товар второй раз не спишется.'}</span>
                          </div>
                        ) : item.state === 'handover_review' ? (
                          <div className="order-stock-handover-legacy-choice">
                            <div className="order-stock-handover-question">
                              <strong>К моменту {checkpointWord} {checkpointDate} клиент уже получил этот товар?</strong>
                              <span>{item.reviewReason === 'late_entry' ? 'Позиция появилась в системе после физической проверки.' : 'Это смешанный заказ, и после резерва складской позиции была физическая проверка.'}</span>
                              {item.itemCreatedAt ? <span>Позиция в учёте с {handoverDateTimeLabel(item.itemCreatedAt)}.</span> : null}
                              <span>Если уже получил — физический остаток не изменится и повторного списания не будет. Если товар ещё был здесь — резерв останется до обычной выдачи.</span>
                            </div>
                            <div className="order-stock-handover-choice-grid">
                              <button
                                className="secondary order-stock-handover-choice is-client"
                                type="button"
                                disabled={stockHandoverActionItemId !== null}
                                onClick={() => void runOrderStockHandoverAction(item, 'issued_before_checkpoint')}
                              >
                                <strong>Да, уже получил</strong>
                                <span>Не списывать этот товар повторно</span>
                              </button>
                              <button
                                className="secondary order-stock-handover-choice is-here"
                                type="button"
                                disabled={stockHandoverActionItemId !== null}
                                onClick={() => void runOrderStockHandoverAction(item, 'still_here')}
                              >
                                <strong>Нет, товар ещё был здесь</strong>
                                <span>Оставить товар в остатке до фактической выдачи клиенту</span>
                              </button>
                            </div>
                          </div>
                        ) : item.state === 'ready_to_issue' ? (
                          <div className="order-stock-handover-ready-action">
                            <div>
                              <strong>{item.reviewDecision === 'still_here' && item.reviewedCheckpointAt ? `Подтверждено: во время ${item.checkpointKind === 'revision' ? 'ревизии' : 'сверки'} ${handoverCheckpointDateLabel(item.reviewedCheckpointAt)} товар был ${item.source === 'boutique' ? 'в Бутике' : 'на Складе'}.` : 'По системе этот товар клиенту ещё не выдавали.'}</strong>
                              <span>{stockHandoverData.workshopPending ? 'Если клиент забирает этот товар сейчас, нажмите кнопку один раз.' : 'Закройте это окно и нажмите «Отправить клиенту». Тогда товар спишется один раз вместе с отправкой заказа.'}</span>
                            </div>
                            {stockHandoverData.workshopPending ? (
                              <button
                                className="primary compact"
                                type="button"
                                disabled={stockHandoverActionItemId !== null}
                                onClick={() => void runOrderStockHandoverAction(item, 'issue_now')}
                              >
                                {actionBusy ? 'Сохраняю…' : 'Выдать товар клиенту'}
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <div className="order-stock-handover-result is-attention">
                            <strong>Эту позицию нельзя безопасно выдать из заказа.</strong>
                            <span>Сначала откройте «Склад → Товары → Требуют разбора» и исправьте складскую привязку этой позиции.</span>
                          </div>
                        )}
                      </article>
                    )
                  })}
                  {!(stockHandoverData.items || []).length ? (
                    <div className="order-stock-handover-empty">В этом заказе нет товаров со Склада или Бутика.</div>
                  ) : null}
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}

      {adminModeOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdminModeOpen(false) }}>
          <form className="modal-card auth-users-modal" role="dialog" aria-modal="true" aria-label="Админ режим" onSubmit={submitAdminMode}>
            <div className="modal-head">
              <div>
                <div className="card-label">Админ режим</div>
                <h3>Войти в админ режим</h3>
                <p>Обычная работа доступна без входа. Пароль нужен только для удаления, настроек и служебных действий.</p>
              </div>
              <button className="secondary compact" type="button" onClick={() => { setAdminModeOpen(false); setAdminModeDraft({ login: 'admin', password: '' }) }}>Закрыть</button>
            </div>
            <div className="form-grid compact-form-grid">
              <label><span>Логин</span><input value={adminModeDraft.login} onChange={(event) => setAdminModeDraft((draft) => ({ ...draft, login: event.target.value }))} autoComplete="username" /></label>
              <label><span>Пароль</span><input type="password" value={adminModeDraft.password} onChange={(event) => setAdminModeDraft((draft) => ({ ...draft, password: event.target.value }))} autoComplete="current-password" autoFocus /></label>
            </div>
            <div className="modal-actions">
              <button className="primary" type="submit" disabled={adminModeBusy}>{adminModeBusy ? 'Проверяю...' : 'Войти'}</button>
              <button className="secondary" type="button" onClick={() => setAdminModeOpen(false)} disabled={adminModeBusy}>Отмена</button>
            </div>
          </form>
        </div>
      ) : null}

      <DatabaseStorageModal maintenance={storageMaintenance} onOpenReports={openStorageMonthReports} />

      {passwordChangeOpen ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card auth-users-modal" role="dialog" aria-modal="true" aria-label="Смена пароля" onSubmit={submitPasswordChange}>
            <div className="modal-head">
              <div>
                <div className="card-label">Доступ</div>
                <h3>Сменить пароль</h3>
                <p>Введите нынешний пароль и новый пароль.</p>
              </div>
              <button className="secondary compact" type="button" onClick={() => { setPasswordChangeOpen(false); setPasswordChangeDraft({ currentPassword: '', newPassword: '' }) }}>Закрыть</button>
            </div>
            <div className="form-grid compact-form-grid">
              <label><span>Текущий пароль</span><input type="password" value={passwordChangeDraft.currentPassword} onChange={(event) => setPasswordChangeDraft((draft) => ({ ...draft, currentPassword: event.target.value }))} required /></label>
              <label><span>Новый пароль</span><input type="password" value={passwordChangeDraft.newPassword} onChange={(event) => setPasswordChangeDraft((draft) => ({ ...draft, newPassword: event.target.value }))} required minLength={8} /></label>
            </div>
            <div className="modal-actions">
              <button className="primary" type="submit" disabled={passwordChangeBusy}>{passwordChangeBusy ? 'Обновляю...' : 'Обновить пароль'}</button>
              <button className="secondary" type="button" onClick={() => setPasswordChangeOpen(false)} disabled={passwordChangeBusy}>Отмена</button>
            </div>
          </form>
        </div>
      ) : null}

      {authUsersOpen && isAdmin ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card auth-users-modal" role="dialog" aria-modal="true" aria-label="Пользователи">
            <div className="modal-head">
              <div>
                <div className="card-label">Доступ</div>
                <h3>Пользователи системы</h3>
                <p>Роль берётся из аккаунта. Менеджера можно привязать к сотруднику из «Команды».</p>
              </div>
              <button className="secondary compact" type="button" onClick={() => setAuthUsersOpen(false)}>Закрыть</button>
            </div>

            <div className="auth-users-grid">
              <section className="mini-panel">
                <div className="mini-panel-head">
                  <div>
                    <h4>{authUserDraft.id ? 'Редактировать пользователя' : 'Новый пользователь'}</h4>
                    <p className="mini-panel-note">Пароль нужен при создании. При редактировании оставьте пустым, если менять пароль не нужно.</p>
                  </div>
                </div>
                <div className="form-grid compact-form-grid">
                  <label><span>Почта</span><input value={authUserDraft.email} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, email: event.target.value }))} placeholder="manager@example.com" /></label>
                  <label><span>Пароль</span><input type="password" value={authUserDraft.password} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, password: event.target.value }))} placeholder={authUserDraft.id ? 'Не менять' : 'Минимум 8 символов'} /></label>
                  <label><span>Роль</span><select value={authUserDraft.role} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, role: normalizeAccessRole(event.target.value) }))}><option value="manager">Менеджер</option><option value="admin">Админ</option></select></label>
                  <label><span>Сотрудник</span><select value={authUserDraft.managerId || 0} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, managerId: Number(event.target.value) || 0 }))}><option value={0}>Не привязан</option>{teamEmployees.map((employee) => <option key={`auth-employee-${employee.id}`} value={employee.id}>{employee.name}</option>)}</select></label>
                  <label><span>Имя в системе</span><input value={authUserDraft.displayName} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, displayName: event.target.value }))} placeholder="Можно оставить пустым" /></label>
                  <label className="checkbox-line"><input type="checkbox" checked={authUserDraft.isActive} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, isActive: event.target.checked }))} /> Доступ включён</label>
                  <label className="checkbox-line"><input type="checkbox" checked={authUserDraft.mustChangePassword} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, mustChangePassword: event.target.checked }))} /> Потребовать смену пароля</label>
                </div>
                <div className="modal-actions">
                  <button className="primary" type="button" onClick={() => void saveAuthUser()} disabled={authUsersBusy}>{authUserDraft.id ? 'Сохранить' : 'Создать'}</button>
                  {authUserDraft.id ? <button className="secondary" type="button" onClick={() => setAuthUserDraft({ id: 0, email: '', password: '', role: 'manager', managerId: 0, displayName: '', isActive: true, mustChangePassword: true })}>Новый</button> : null}
                </div>
              </section>

              <section className="mini-panel">
                <div className="mini-panel-head">
                  <div>
                    <h4>Аккаунты</h4>
                    <p className="mini-panel-note">Показано {authUsers.length}. Удаление закрывает сессии пользователя.</p>
                  </div>
                  <button className="secondary compact" type="button" onClick={() => void loadAuthUsers()}>{authUsersBusy ? 'Загружаю...' : 'Обновить'}</button>
                </div>
                <div className="auth-users-list">
                  {authUsers.map((user) => (
                    <div className={`auth-user-row ${user.isActive ? '' : 'is-disabled'}`} key={`auth-user-${user.id}`}>
                      <div>
                        <strong>{user.email}</strong>
                        <span>{user.role === 'admin' ? 'Админ' : 'Менеджер'}{user.managerName ? ` · ${user.managerName}` : ''}</span>
                        <small>{user.mustChangePassword ? 'Нужно сменить временный пароль' : user.lastLoginAt ? `Последний вход: ${formatDateShort(user.lastLoginAt)}` : 'Входов пока нет'}</small>
                      </div>
                      <div className="row-actions">
                        <button className="secondary compact" type="button" onClick={() => setAuthUserDraft({ id: user.id, email: user.email, password: '', role: user.role, managerId: user.managerId || 0, displayName: user.displayName || '', isActive: user.isActive, mustChangePassword: Boolean(user.mustChangePassword) })}>Править</button>
                        <button className="danger subtle compact" type="button" onClick={() => void deleteAuthUser(user.id)}>Удалить</button>
                      </div>
                    </div>
                  ))}
                  {!authUsers.length ? <div className="empty-state">Пользователей пока нет.</div> : null}
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      <div className="erp-main" ref={mainScrollRef}>
        <header className="erp-topbar">
          <div className="erp-page-context">
            <div className="erp-page-kicker">Рабочий раздел</div>
            <h2 className="erp-page-title">{pageTitle.title}</h2>
            <div className="erp-page-subtitle">{pageTitle.subtitle}</div>
          </div>

          <div className="erp-topbar-actions">
            <button className="primary" onClick={() => void loadDashboard()} disabled={busy}>
              {busy ? 'Обновляю...' : 'Обновить'}
            </button>
            <div className="erp-topbar-status">
              <span className="hint">Роль: <strong>{isAdmin ? 'Админ' : 'Менеджер'}</strong></span>
              <span className={`status-pill ${health === null ? 'status-warning' : health.ok ? 'status-online' : 'status-offline'}`}>
                {health === null ? 'Проверка...' : health.ok ? 'Готово' : 'Нет связи'}
              </span>
            </div>
          </div>
        </header>

        <DeferredSection active={activeSector === 'overview'} label="Инфопанель">
        <DashboardSection ctx={{ busy, dashboardInsights, dashboardLowStock, dashboardSummary, dashboardWorkshopWarnings, formatMoney, formatPercent, isAdmin, loadOverviewDashboard, openDashboardStockItem, openDashboardWorkshopItem, openInventoryPanel, sectorStyle, setInventoryDraft, setOrderPanel, summary, workshopData }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'clients'} label="Клиенты">
        <ClientsSection ctx={{ clientBusy, clientDetails, clientDetailsBusy, clientMode, clientQuery, clientsData, clientsShown, clientsTotal, clientSummary, formatDateShort, formatMoney, isArchivedOrderRecord, loadClientDetails, loadClients, ManagerBadge, openClientOrder, orderLifecycleLabel, sectorStyle, selectedClientId, selectedClientSummary, setClientDetails, setClientMode, setClientQuery, setSelectedClientId }} />
        </DeferredSection>


        <DeferredSection active={activeSector === 'references'} label="Справочники">
        <ReferencesSection ctx={{ filteredReferenceItems, formatDateShort, FriendlyNumberInput, isAdmin, loadReferenceItems, normalizeSuggestion, referenceBusy, referenceDraft, referenceGroups, referenceItems, referenceKind, referenceSearch, referenceStats, referenceStatusFilter, removeReferenceEntry, resolveCatalogReviewItem, resetReferenceDraft, saveReferenceEntry, sectorStyle, selectedReferenceKindConfig, selectReferenceKind, setReferenceDraft, setReferenceSearch, setReferenceStatusFilter }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'inventory'} label="Склад">
        <InventorySection ctx={{ activeSector, addInventoryMatrixColor, addInventoryMatrixSize, applyPendingInventoryWriteoffs, buildInventoryMatrix, catalogCategoryFilter, catalogOnlyWithoutVariants, setCatalogOnlyWithoutVariants, catalogData, catalogReview, catalogReviewBusy, catalogIssueStats, catalogProductDraft, catalogProductStockSummary, catalogVariantDraft, catalogVariantsByProductId, ChoicePills, clearInventoryMatrixValues, createEmptyInventoryItem, createEmptyInventoryMatrixDraft, expandedCatalogProducts, filteredInventoryRows, formatMoney, FriendlyNumberInput, filteredReferenceItems, formatDateShort, getCatalogProductEffectiveCategory, getCatalogVariantCategory, getInventoryRowCategory, getStockQuantityForVariant, groupedInventoryRows, handleInventoryMatrixKeyDown, inventoryArrivalProductChoices, inventoryArrivalPositions, inventoryArrivalSummary, inventoryArrivalVariantOpen, inventoryArrivalReadyVariants, selectInventoryArrivalVariant, selectInventoryArrivalProduct, updateInventoryArrivalPosition, addInventoryArrivalSize, updateInventoryArrivalSize, removeInventoryArrivalSize, addInventoryArrivalPosition, removeInventoryArrivalPosition, resetInventoryArrivalForm, setInventoryArrivalVariantOpen, inventoryAudit, inventoryAuditBusy, resolveInventoryAuditIssue, inventoryCategoryFilter, inventoryControlBusy, inventoryControlSettings, inventoryMovementBusy, inventoryDraft, inventoryDraftSummary, inventoryHistoryRows, inventoryMatrix, inventoryMatrixActiveGroupKey, inventoryMatrixAxisLabel, inventoryMatrixBatchGroups, inventoryMatrixCellKey, inventoryMatrixCellMap, inventoryMatrixColors, inventoryMatrixColorToAdd, inventoryMatrixDraftItem, inventoryMatrixSizes, inventoryMatrixSizeToAdd, inventoryMatrixSummary, inventoryModelVersion, inventoryMovementText, matchedInventoryOperationVariant, activeInventoryOperationItem, selectedInventoryOperationItems, inventoryOperationAllProductGroups, inventoryOperationProductGroups, inventoryOperationSearch, inventoryOperationVariant, inventoryOperationActiveVariantId, inventoryExistingVariantOpen, inventoryExistingVariantSearch, inventoryExistingVariantRows, inventoryPanel, inventoryPanelStyle, inventoryPickerOptions, inventoryProblemRows, inventoryQuery, inventoryQuickFilters, inventorySortMode, inventorySourceRows, inventoryStats, inventoryStocktakeAllGroups, inventoryStocktakeGroups, inventoryStocktakeStats, printInventoryStocktakePdf, applyInventoryStocktakeChanges, inventoryStatusFilter, isAdmin, latestManualMovements, latestReturnExchangeMovements, latestSaleMovements, loadCatalogData, loadCatalogReview, reconcileCatalogReview, loadCatalogReviewContext, resolveCatalogReviewFacts, excludeCatalogReviewItem, inventoryLifecycle, inventoryLifecycleBusy, warehouseAttention, loadInventoryLifecycle, loadInventoryLifecycleContext, resolveInventoryLifecycleFacts, reconcileKnownInventoryLifecycle, loadWarehouseAttention, loadInventoryAudit, loadInventoryData, loadInventoryHistory, loadInventoryCheckHistory, loadInventoryReservations, loadInventoryStocktakeSessions, loadInventoryStocktakeSession, createInventoryStocktakeSession, saveInventoryStocktakeCount, addInventoryStocktakeVariant, addInventoryStocktakeCombination, loadInventoryCycleCounts, applyInventoryCycleCounts, quickInventoryStocktake, quickInventoryStocktakeBatch, completeInventoryStocktakeSession, cancelInventoryStocktakeSession, loadReferenceItems, loadReferencesData, references, normalizeSuggestion, openInventoryPanel, openOrderFromFinance, openOrderStockHandoverById, operationVariantOptions, inventoryProductReferenceGroups, inventoryWriteoffReferenceGroups, referenceBusy, referenceDraft, referenceItems, referenceKind, referenceSearch, referenceStatusFilter, removeReferenceEntry, resolveCatalogReviewItem, resetReferenceDraft, saveReferenceEntry, selectedReferenceKindConfig, selectReferenceKind, setReferenceDraft, setReferenceSearch, setReferenceStatusFilter, productCategoryLabel, productHasVariantCategory, refreshInventoryModule, renderInventoryStockGroups, resetInventoryOperationSelection, removeInventoryVariantOperationItem, reverseInventoryMovement, reversingInventoryMovementId, saveCatalogProduct, saveCatalogVariant, saveInventoryMovement, sectorStyle, startNextInventoryMatrixProduct, openInventoryMatrixBatchGroup, removeInventoryMatrixBatchGroup, selectedCatalogProduct, selectedInventoryOperationGroup, selectInventoryOperationVariant, setCatalogCategoryFilter, setCatalogProductDraft, setCatalogVariantDraft, setExpandedCatalogProducts, setInventoryCategoryFilter, setInventoryDraft, setInventoryMatrix, setInventoryMatrixCell, setInventoryMatrixColorToAdd, setInventoryMatrixSizeToAdd, setInventoryExistingVariantOpen, setInventoryExistingVariantSearch, setInventoryQuery, setInventoryQuickFilters, setInventorySortMode, setInventoryStatusFilter, setInventoryTransferObservedQuantity, setInventoryVariantOperationQuantity, SmartPickerInput, sourceLabel, suggestionValues, arrivalSuggestionValues, toggleInventoryAutoWriteoff, updateInventoryMatrixCategory, updateInventoryMatrixGender, updateInventoryMatrixLength, updateInventoryMatrixMaterial, updateInventoryMatrixProductInput, updateInventoryDirectProductInput, updateInventoryOperationVariantField, visibleCatalogProducts }} />
        </DeferredSection>

        <section className="grid" style={sectorStyle('overview')}>
        <article className="card">
          <div className="card-label">Система</div>
          <div className="card-value">{health === null ? 'Проверка...' : health.ok ? 'Готово' : 'Нет связи'}</div>
          <div className="card-meta">{health === null ? 'Проверяем подключение' : health.ok ? 'Рабочее подключение' : 'Подключение недоступно'}</div>
          <div className="card-foot">{health?.time ?? '—'}</div>
        </article>

        <article className="card">
          <div className="card-label">Данные</div>
          <div className="card-value">{dbState?.ok ? 'Готово' : 'Ожидание'}</div>
          <div className="card-meta">{dbState?.ok ? 'Данные доступны' : 'Проверяем данные'}</div>
          <div className="card-foot">{dbState?.ok ? 'Готово к работе' : 'Нет подключения'}</div>
        </article>

        <article className="card">
          <div className="card-label">Сумма</div>
          <div className="card-value">{formatMoney(summary.total)}</div>
          <div className="card-meta">Получено: {formatMoney(summary.received)}</div>
          <div className="card-foot">Долг: {formatMoney(summary.debt)}</div>
        </article>

        <article className="card">
          <div className="card-label">Записей</div>
          <div className="card-value">{summary.count}</div>
          <div className="card-meta">Заказы по текущему фильтру.</div>
          <div className="card-foot">Измените фильтры, чтобы уточнить список.</div>
        </article>

        </section>

        <DeferredSection active={activeSector === 'workshop'} label="Цех">
        <WorkshopSection ctx={{ activeWorkshopTasks, applyWorkshopPeriodPreset, copyWorkshopInvoiceText, downloadWorkshopInvoicePdf, exportWorkshopInvoiceWord, formatDateShort, getPeriodRange, getWorkshopInvoiceImportanceLabel, isAdmin, markWorkshopTaskDone, openWorkshopExchange, openWorkshopOrderEditor, printWorkshopInvoice, restoreWorkshopTaskActive, sectorStyle, setWorkshopFilters, setWorkshopInvoiceMode, setWorkshopSortDirection, workshopBusy, workshopCustomerIdentity, workshopData, workshopDetailRows, workshopFilters, workshopInvoiceMode, workshopInvoiceRows, workshopScopeTasks, workshopSortDirection }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders'} label="Заказы">
        <OrdersHeaderSection ctx={{ orderPanel, orderPanelOptions, sectorStyle, setEditorOpen, setOrderPanel }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'list'} label="Заказы">
        <OrderFiltersSection ctx={{ applyOrderPeriodPreset, busy, ChoicePills, filters, ManagerPicker, orderPanelStyle, orderPeriodPreset, references, resetOrderFilters, sectorStyle, setFilters }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'create'} label="Создание заказа">
        <CreateOrderSection ctx={{ addCreateItem, addCreatePayment, applyCreateProductPick, ChoicePills, createDraft, createOrderFromDraft, createTotals, resetCreateOrderDraft, formatMoney, formatOrderItemDetails, formatOrderItemTitle, FriendlyNumberInput, ManagerPicker, normalizeAudienceTypeValue, normalizeSuggestion, orderBusy, orderPanelStyle, references, removeCreateItem, removeCreatePayment, renderOrderSizeSelect, renderOrderSourceAvailability, sectorStyle, setCreateDraft, setOrderPanel, SmartPickerInput, sourceLabel, suggestionValues, updateCreateDraft, updateCreateItem, updateCreatePayment }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'edit'} label="Редактирование заказа">
        <OrderEditorSection ctx={{ addEditorItem, addEditorPayment, applyEditorProductPick, ChoicePills, closeOrderEditor, createEditorDraft, editorDraft, editorFormRef, editorOpen, editorReturnSector, formatMoney, formatOrderItemTitle, FriendlyNumberInput, isAdmin, isArchivedOrderRecord, ManagerPicker, normalizeAudienceTypeValue, normalizeSuggestion, orderPanelStyle, references, removeEditorItem, removeEditorPayment, renderOrderSizeSelect, renderOrderSourceAvailability, saveEditorPayment, saveSelectedOrder, savingOrder, sectorStyle, selectedOrder, setEditorDraft, SmartPickerInput, sourceLabel, statusLabelByState, suggestionValues, updateEditorDraft, updateEditorItem, updateEditorPayment }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'list'} label="Список заказов">
        <OrdersTableSection ctx={{ deleteOrderAsAdmin, expandedOrderItemCounts, filters, formatDateShort, formatMoney, handleEditOrder, handleOpenDebt, handleOpenExchange, handleOpenReturn, isAdmin, isArchivedOrderRecord, isReturnedOrderRecord, ManagerBadge, markOrderSentToClient, openOrderStockHandover, normalizeSuggestion, orderFinanceBusy: ordersFinanceBusy, orderFinanceReport: ordersFinanceReport, orderLifecycleLabel, orderPanelStyle, orders, paymentStatusClass, paymentStatusLabel, restoreArchivedOrder, savingOrder, sectorStyle, selectedOrderId, setExpandedOrderItemCounts, shippingStatusLabel, busy, changeOrderPage, orderPageInfo, summarizeOrderItemLines, summarizeOrderPaymentLines, summary, waitingDaysLabel }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'list'} label="Детали заказа">
        <OrderDetailsSection ctx={{ formatDateShort, formatMoney, formatOrderItemTitle, handleEditOrder, isAdmin, isArchivedOrderRecord, isReturnedOrderRecord, orderPanelStyle, restoreArchivedOrder, savingOrder, sectorStyle, selectedOrder, setSelectedWorkshopStatus, sourceLabel }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'debt'} label="Закрытие долга">
        <OrderDebtSection ctx={{ addDebtPayment, closeDebtForm, createDebtClosePayment, debtBusy, debtCloseHistory, debtFilters, debtFormRef, debtLoadBusy, debtOrders, debtOverview, loadAllOpenDebtOrders, debtOverpayAmount, debtPayments, debtPaymentTotal, debtRemainingAmount, debtSelectedOrder, formatLocalDateInput, formatMoney, FriendlyNumberInput, handleSelectDebtOrder, ManagerBadge, managerColorFor, orderPanelStyle, removeDebtPayment, saveDebtClose, sectorStyle, setDebtFilters, setDebtPayments, SmartPickerInput, suggestionValues, summarizeOrderItemLines, updateDebtPayment }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'returns'} label="Возврат">
        <OrderReturnsSection ctx={{ cancelReturnEntry, closeReturnForm, createReturnDraft, formatMoney, FriendlyNumberInput, isAdmin, loadReturnHistory, ManagerBadge, managerColorFor, orderPanelStyle, returnBusy, returnDraft, returnFormRef, returnHistory, returnHistoryBusy, returnHistoryError, returnHistoryFilters, returnHistoryHasMore, returnHistorySummary, returnSelectedOrder, saveReturn, sectorStyle, setOrderPanel, setReturnDraft, setReturnHistoryFilters, SmartPickerInput, suggestionValues }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'exchange'} label="Обмен размера">
        <OrderExchangeSection ctx={{ applyExchangeProductPick, cancelExchangeEntry, closeExchangeForm, createExchangeDraft, exchangeBusy, exchangeDraft, exchangeFormRef, exchangeHistory, exchangeHistoryBusy, exchangeHistoryError, exchangeHistoryFilters, exchangeHistoryHasMore, exchangeHistorySummary, exchangeSelectedOrder, formatMoney, FriendlyNumberInput, getOrderSourceAvailability, isAdmin, loadExchangeHistory, ManagerBadge, managerColorFor, orderPanelStyle, saveExchange, sectorStyle, setExchangeDraft, setExchangeHistoryFilters, setOrderPanel, SmartPickerInput, sourceLabel, suggestionValues }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'team'} label="Команда">
        <TeamSection ctx={{ exportTeamPlanReportWord, formatDateShort, formatLocalDateInput, formatMoney, formatPercent, getTimesheetCalendarSlots, getTimesheetEntriesForDate, getTimesheetWeekdayLabel, isAdmin, loadPlans, loadTeamActivityReport, loadTeamSalaryReport, loadTeamTimesheet, MANAGER_COLOR_OPTIONS, ManagerBadge, planBusy, planFilters, planReport, printTeamPlanReportPdf, removeTeamEmployee, resolveManagerDisplayColor, saveTeamEmployee, saveTeamEmployeeColor, saveTeamTimesheet, sectorStyle, setPlanFilters, setTeamActivityFilters, setTeamColorEditorId, setTeamDraft, setTeamEmployeeEmploymentStatus, setTeamFormOpen, setTeamMode, setTeamRosterView, setTeamSalaryFilters, setTimesheetComment, setTimesheetCurrentMonth, setTimesheetDaysPreset, setTimesheetMonth, setTimesheetSelectedDays, setTimesheetSelectedManagers, setTimesheetWorkUntil, shiftTimesheetMonth, teamActivityBusy, teamActivityFilters, teamActivityLoadFailed, teamActivityReport, teamBusy, teamColorEditorId, teamDraft, teamEmployees, teamFormOpen, teamMode, teamRosterView, teamSalaryFilters, teamSalaryReport, timesheetBusy, timesheetComment, timesheetData, timesheetMonth, timesheetSelectedDays, timesheetSelectedManagers, timesheetWorkUntil, toggleTimesheetDay, toggleTimesheetManager }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'leads'} label="Лиды">
        <LeadsSection ctx={{ callCentreDraft, callCentreRecords, deleteCallCentreRecord, deleteLeadRecord, editCallCentreRecord, editLeadRecord, formatDateShort, formatLocalDateInput, formatPercent, FriendlyNumberInput, getPeriodRange, leadBusy, leadDraft, leadFilters, leadMode, leadRecords, loadCallCentreRecords, loadLeadRecords, ManagerBadge, ManagerPicker, references, saveCallCentreRecord, saveLeadRecord, sectorStyle, setCallCentreDraft, setLeadDraft, setLeadFilters, setLeadMode }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'plan'} label="План">
        <PlanSection ctx={{ deleteDepartmentPlan, deleteManagerPlan, departmentPlanDraft, editDepartmentPlan, editManagerPlan, exportPlanReportWord, formatDateShort, formatMoney, formatPercent, FriendlyNumberInput, isAdmin, loadPlans, ManagerBadge, ManagerPicker, managerPlanDraft, planBusy, planFilters, planReport, printPlanReportPdf, references, saveDepartmentPlan, saveManagerPlan, sectorStyle, setDepartmentPlanDraft, setManagerPlanDraft, setPlanFilters }} />
        </DeferredSection>
        <DeferredSection active={activeSector === 'finance'} label="Финансы">
        <FinanceSection ctx={{ financeMode, financeReportBusy, financeReportFilters, getPeriodRange, sectorStyle, setFinanceReportFilters, financeDashboardCtx: { cashMovementDraft, cashRegister, cashRegisterBusy, cashRegisterCycles, cashRegisterCyclesBusy, cashRegisterCyclesHasMore, cashRegisterCyclesOpen, cashSetupAmount, cashReconcileAmount, cashReconcileComment, financeMethodDraft, financeMethodsBusy, financeMode, financePaymentMethods, financeReport, financeReportBusy, moneyHistory, moneyHistoryBusy, moneyHistoryError, moneyHistoryHasMore, moneyHistoryQuery, moneyHistorySummary, moneyHistoryType, loadMoneyHistory, setMoneyHistoryQuery, setMoneyHistoryType, reloadFinanceReports, formatDateShort, formatMoney, formatPercent, FriendlyNumberInput, isAdmin, loadCashRegister, loadCashRegisterCycles, loadFinancePaymentMethods, ManagerBadge, managerColorFor, normalizeSuggestion, openOrderFromFinance, removeFinancePaymentMethod, saveCashRegisterMovement, saveFinancePaymentMethod, setCashMovementDraft, setCashRegisterCyclesOpen, setCashSetupAmount, setCashReconcileAmount, setCashReconcileComment, setupCashRegister, activateCashRegister, setCashAutoTracking, reconcileCashRegister, reverseCashRegisterMovement, resetCashRegisterCycle, setFinanceMethodDraft, setFinanceMode } }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'reports'} label="Отчёты">
        <ReportsSection ctx={{ financeReportBusy, financeReportFilters, financeReportOptions, financeReportType, getPeriodRange, reloadFinanceReports, sectorStyle, setFinanceReportFilters, setFinanceReportType, financeReportContentCtx: { exportSelectedFinanceReportWord, financeReport, financeReportOptions, financeReportType, formatDateShort, formatMoney, formatPercent, ManagerBadge, managerColorFor, printSelectedFinanceReportPdf } }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'activity'} label="Журнал действий">
        <OrderActivitySection ctx={{ activityBusy, activityFilters, activityLog, formatDateShort, formatMoney, loadActivityLog, ManagerBadge, managerColorFor, orderPanelStyle, sectorStyle, setActivityFilters }} />
        </DeferredSection>
      </div>
      {archiveModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setArchiveModalOpen(false) }}>
          <section className="modal-card archive-month-modal" role="dialog" aria-modal="true" aria-label="Архив месяца">
            <div className="modal-head">
              <div>
                <div className="card-label">Архив месяца</div>
                <h3>Убрать закрытый месяц из работы</h3>
                <p>Заказы не удаляются: они остаются в клиентах, отчётах и истории. Архив просто убирает закрытые записи из ежедневной таблицы.</p>
              </div>
              <button className="ghost compact" type="button" onClick={() => setArchiveModalOpen(false)}>Закрыть</button>
            </div>

            <div className="archive-month-controls">
              <label>
                <span>Месяц</span>
                <input
                  type="month"
                  max={getClosedArchiveMonth().value}
                  value={archiveDraft.month}
                  onChange={(event) => {
                    const month = event.target.value || getClosedArchiveMonth().value
                    setArchiveDraft((draft) => ({
                      ...draft,
                      month,
                      cutoffDate: monthEndFromInput(month),
                      reason: `Закрытие месяца: ${monthLabelFromInput(month)}`,
                    }))
                    setArchivePreview(null)
                  }}
                />
              </label>
              <div className="archive-month-range">
                <span>Период</span>
                <strong>{formatDateShort(monthStartFromInput(archiveDraft.month))} — {formatDateShort(monthEndFromInput(archiveDraft.month))}</strong>
              </div>
              <label className="checkbox-row archive-checkbox">
                <input
                  type="checkbox"
                  checked={archiveDraft.includeNotSent}
                  onChange={(event) => {
                    setArchiveDraft((draft) => ({ ...draft, includeNotSent: event.target.checked }))
                    setArchivePreview(null)
                  }}
                />
                <span>Разрешить закрытые, но не отправленные заказы</span>
              </label>
            </div>

            <div className="archive-month-message">
              {!archivePreview ? (
                <span>Сначала проверьте месяц. Система покажет, мешают ли долги, активный цех или неотправленные заказы.</span>
              ) : archivePreview.blocked.withDebt === 0 ? (
                <span className="is-good">Долги по выбранному месяцу закрыты. Можно архивировать подходящие заказы.</span>
              ) : (
                <span className="is-warning">Есть незакрытые долги: {archivePreview.blocked.withDebt}. Лучше закрыть их перед архивацией.</span>
              )}
            </div>

            {archivePreview ? (
              <div className="archive-preview-box">
                <div className="archive-preview-title">
                  <strong>Предпросмотр</strong>
                  <span>{archivePreview.eligibleCount ? `Можно архивировать: ${archivePreview.eligibleCount}` : 'Пока нечего архивировать'}</span>
                </div>
                <div className="archive-preview-stats">
                  <div className="is-good"><span>Готово</span><strong>{archivePreview.eligibleCount}</strong></div>
                  <div><span>Не закрыты</span><strong>{archivePreview.blocked.notClosed}</strong></div>
                  <div><span>С долгом</span><strong>{archivePreview.blocked.withDebt}</strong></div>
                  <div><span>Цех активен</span><strong>{archivePreview.blocked.activeWorkshop}</strong></div>
                  <div><span>Не отправлены</span><strong>{archivePreview.blocked.notSent}</strong></div>
                </div>
                <div className="archive-preview-list">
                  {(archivePreview.orders || []).slice(0, 10).map((order) => (
                    <div className="archive-preview-item" key={`archive-modal-${order.id}`}>
                      <strong>{order.externalId}</strong>
                      <span>{formatDateShort(order.orderDate)} · {order.manager || '—'} · {formatMoney(order.totalAmount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="modal-actions">
              <button className="secondary" type="button" onClick={() => void loadArchivePreview()} disabled={archiveBusy}>
                {archiveBusy ? 'Проверяю...' : 'Проверить месяц'}
              </button>
              <button className="primary" type="button" onClick={() => void runArchiveOrders()} disabled={archiveBusy || !archivePreview?.eligibleCount}>
                Архивировать месяц
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <datalist id="manager-list">
        {suggestionValues.managers.map((value) => <option value={value} key={value} />)}
      </datalist>
      <datalist id="city-list">
        {suggestionValues.cities.map((value) => <option value={value} key={value} />)}
      </datalist>
      <datalist id="delivery-list">
        {suggestionValues.deliveryTypes.map((value) => <option value={value} key={value} />)}
      </datalist>
      <datalist id="product-list">
        {suggestionValues.products.map((value) => <option value={value} key={value} />)}
      </datalist>
      <datalist id="color-list">
        {suggestionValues.colors.map((value) => <option value={value} key={value} />)}
      </datalist>
      <datalist id="material-list">
        {suggestionValues.materials.map((value) => <option value={value} key={value} />)}
      </datalist>
      <datalist id="length-list">
        {suggestionValues.lengths.map((value) => <option value={value} key={value} />)}
      </datalist>
      <datalist id="size-list">
        {suggestionValues.sizes.map((value) => <option value={value} key={value} />)}
      </datalist>
      <datalist id="child-age-list">
        {suggestionValues.childAges.map((value) => <option value={value} key={value} />)}
      </datalist>
    </main>
  )
}

export default App
