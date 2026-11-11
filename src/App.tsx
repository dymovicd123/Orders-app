import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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
import type { AccessRole, ActivityLogEntry, ApiState, AppSector, ArchiveMode, ArchivePreviewResponse, AuthUser, CallCentreRecord, CatalogResponse, CatalogReviewResponse, ClientDetailsResponse, ClientMode, ClientOrderRecord, ClientsResponse, DashboardInsightsResponse, DashboardLowStockItem, DashboardWorkshopWarning, DepartmentPlanRecord, EditorDraft, EditorItem, EditorPayment, CashRegisterResponse, CashRegisterCycle, FinanceReportType, InventoryAuditResponse, InventoryCategoryFilter, InventoryControlSettings, InventoryLifecyclePendingResponse, InventoryArrivalPosition, InventoryDraft, InventoryMatrixDraft, InventoryOperationVariantDraft, InventoryPanel, InventorySortMode, InventorySourceKey, InventoryStatusFilter, InventoryStockGroup, LeadRecord, ManagedAuthUser, ManagerPlanRecord, OrderListResponse, OrderPanel, OrderPeriodPreset, OrderPeriodStats, OrderRecord, ReferenceData, ReferenceKind, ReferenceListItem, AuthStatusResponse, TeamActivityResponse, TeamActivityType, TeamEmployee, TeamMode, TeamSalaryResponse, TeamTimesheetResponse, WorkshopPeriodPreset, WorkshopTaskRecord, WorkshopView } from './app/types'
import { MANAGER_COLOR_OPTIONS, orderPanelOptions, workspaceModules } from './app/constants'
import { canOpenWorkspaceSector, canSeeWorkspaceMenuItem } from './app/managerWorkspaceAccess'
import { createDebtClosePayment, createEditorDraft, createEmptyInventoryItem, createEmptyInventoryMatrixDraft, createEmptyOrderDraft, createExchangeDraft, createReturnDraft, formatDateShort, formatLocalDateInput, formatMoney, formatOrderItemDetails, formatOrderItemTitle, formatPercent, getCatalogVariantCategory, getClosedArchiveMonth, getPeriodRange, inventoryMatrixAxisLabel, inventoryMatrixCellKey, isArchivedOrderRecord, isLikelyAdultSizeValue, monthEndFromInput, monthLabelFromInput, normalizeAccessRole, normalizeAudienceTypeValue, normalizeSearchText, normalizeSuggestion, orderLifecycleLabel, productCategoryLabel, readJsonResponse, isTransientApiError, sectorFromHash, shippingStatusLabel, sourceLabel, summarizeOrderItemLines, summarizeOrderPaymentLines, waitingDaysLabel, workshopCustomerIdentity, workshopDetailRows, } from './app/utils'
import { ChoicePills, FriendlyNumberInput, ManagerBadge, ManagerPicker, SmartPickerInput, resolveManagerDisplayColor } from './components'
import { TableDragScrollManager } from './components/tables/TableDragScrollManager'
import { DatabaseStorageModal, DatabaseStorageWarning, useDatabaseStorageMaintenance } from './features/storage/DatabaseStorageMaintenance'
import { DashboardSection, ClientsSection, ReferencesSection, InventorySection, WorkshopSection, OrdersHeaderSection, OrderFiltersSection, CreateOrderSection, OrderEditorSection, OrdersTableSection, OrderDetailsSection, OrderDebtSection, OrderReturnsSection, OrderExchangeSection, TeamSection, LeadsSection, PlanSection, FinanceSection, ReportsSection, OrderActivitySection, OrderCatalogResolutionModal, StockResolutionConfirmModal, ReturnedItemResolutionModal, ArrivalRecoveryDialog, DeferredSection } from './app/lazySections'
import { InventoryStockGroupsRenderer } from './features/renderers/InventoryStockGroupsRenderer'
import type { ArrivalRecoveryPrompt } from './features/inventory/views/ArrivalRecoveryDialog'
import type { StockResolutionPrompt } from './features/orders/StockResolutionConfirmModal'
import { useFinanceReportReads } from './features/finance/useFinanceReportReads'
import { createCashRegisterActions } from './features/finance/cashRegisterActions'
import { createFinancePaymentMethodActions } from './features/finance/paymentMethodActions'
import { createTeamEmployeeActions } from './features/team/teamEmployeeActions'
import { createTeamTimesheetActions } from './features/team/teamTimesheetActions'
import { createTeamReportActions } from './features/team/teamReportActions'
import { createPlanActions } from './features/plans/planActions'
import { createReportExportActions } from './features/export/reportExportActions'
import { createReferenceActions } from './features/references/referenceActions'
import { loadManagedAuthUsers, saveManagedAuthUser, disableManagedAuthUser } from './features/auth/managedAccountActions'
import { AuthGate } from './features/auth/AuthGate'
import { ArchiveMonthModal } from './features/orders/ArchiveMonthModal'
import { useWorkshopReads } from './features/workshop/useWorkshopReads'
import { createWorkshopTaskActions } from './features/workshop/workshopTaskActions'
import { createWorkshopInvoiceActions } from './features/workshop/workshopInvoiceActions'
import { useApiClient } from './app/controllers/useApiClient'
import { createLatestRequestGuard } from './app/latestRequestGuard'
import { useOperationalViewModel } from './app/controllers/useOperationalViewModel'
import { useWorkspaceViewModel } from './app/controllers/useWorkspaceViewModel'
import { useReturnExchangeWorkspace } from './app/controllers/useReturnExchangeWorkspace'
import { useMoneyHistoryWorkspace } from './app/controllers/useMoneyHistoryWorkspace'
import { evaluateItemizedCreatePricing } from './app/order-pricing'
import { createEmptyArrivalPosition, createEmptyInventoryOperationVariantDraft, inventoryUiId } from './features/inventory/inventoryDraftFactories'
import { useInventoryMatrixWorkspace } from './features/inventory/useInventoryMatrixWorkspace'
import { useWarehouseSnapshots } from './features/inventory/useWarehouseSnapshots'
import { createInventoryStocktakeClient } from './features/inventory/inventoryStocktakeClient'
import { createInventoryOperationEditorActions } from './features/inventory/inventoryOperationEditor'
import { createInventoryMovementActions } from './features/inventory/inventoryMovementActions'
import { createWarehouseRecoveryActions } from './features/inventory/warehouseRecoveryActions'
import { createWarehouseGovernanceActions } from './features/inventory/warehouseGovernanceActions'
import { createOrderCreationActions } from './features/orders/orderCreationActions'
import { createOrderEditorActions } from './features/orders/orderEditorActions'
import { createOrderEditPersistenceActions } from './features/orders/orderEditPersistenceActions'
import { createOrderEditSessionActions } from './features/orders/orderEditSessionActions'
import { createOrderCorrectionsActions } from './features/orders/orderCorrectionsActions'
import { createOrderShippingHandoverActions, handoverCheckpointDateLabel, handoverSourceLabel, type OrderStockHandoverResponse } from './features/orders/orderShippingHandoverActions'
import { createReturnExchangeCreationActions } from './features/orders/returnExchangeCreationActions'
import { createReturnExchangeAftercareActions } from './features/orders/returnExchangeAftercareActions'
import { createOrderDependentCancellationActions } from './features/orders/orderDependentCancellationActions'
import { ActionConfirmationModal } from './components/dialogs/ActionConfirmationModal'
import { ActionTextPromptModal } from './components/dialogs/ActionTextPromptModal'
import './styles/1905-small-screen-acceptance.css'
import './styles/192b1-warehouse-attention.css'
import './styles/192c-arrival-recovery.css'
import './styles/195-kaspi-orders.css'




type BrowserPasswordCredentialConstructor = new (data: { id: string; password: string; name?: string }) => Credential

async function offerBrowserPasswordSave(login: string, password: string) {
  const username = login.trim()
  if (!username || !password || typeof window === 'undefined') return
  const PasswordCredentialCtor = (window as Window & { PasswordCredential?: BrowserPasswordCredentialConstructor }).PasswordCredential
  if (!PasswordCredentialCtor || !navigator.credentials?.store) return
  try {
    const credential = new PasswordCredentialCtor({ id: username, password, name: username })
    await navigator.credentials.store(credential)
  } catch (error) {
    console.debug('Password manager did not accept the credential storage request.', error)
  }
}

function handoverDateTimeLabel(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function App() {
  const [health, setHealth] = useState<ApiState | null>(null)
  const [dbState, setDbState] = useState<ApiState | null>(null)
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [orderPeriodStats, setOrderPeriodStats] = useState<OrderPeriodStats | null>(null)
  const [orderPageOffset, setOrderPageOffset] = useState(0)
  const [orderPageInfo, setOrderPageInfo] = useState({ offset: 0, limit: 100, totalCount: 0, hasMore: false, hasPrevious: false })
  const orderListReadGuardRef = useRef(createLatestRequestGuard())
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
  const [orderCatalogResolutionOrder, setOrderCatalogResolutionOrder] = useState<OrderRecord | null>(null)
  const [references, setReferences] = useState<ReferenceData | null>(null)
  const [catalogData, setCatalogData] = useState<CatalogResponse | null>(null)
  const [catalogReview, setCatalogReview] = useState<CatalogReviewResponse | null>(null)
  const [catalogReviewBusy, setCatalogReviewBusy] = useState(false)
  const [inventoryLifecycle, setInventoryLifecycle] = useState<InventoryLifecyclePendingResponse | null>(null)
  const [inventoryLifecycleBusy, setInventoryLifecycleBusy] = useState(false)
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
  const [workshopInvoiceMode, setWorkshopInvoiceMode] = useState<'urgent' | 'period' | 'kaspi'>('period')
  const [workshopSortDirection, setWorkshopSortDirection] = useState<'oldest' | 'newest'>('oldest')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [stockResolutionPrompt, setStockResolutionPrompt] = useState<StockResolutionPrompt | null>(null)
  const stockResolutionDecisionRef = useRef<((value: boolean) => void) | null>(null)
  const [actionConfirmationText, setActionConfirmationText] = useState<string | null>(null)
  const actionConfirmationDecisionRef = useRef<((approved: boolean) => void) | null>(null)
  const [actionTextPrompt, setActionTextPrompt] = useState<{ title: string; initialValue: string; minLength: number } | null>(null)
  const actionTextDecisionRef = useRef<((value: string | null) => void) | null>(null)
  const askActionConfirmation = useCallback((text: string) => {
    if (actionConfirmationDecisionRef.current || actionTextDecisionRef.current) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      actionConfirmationDecisionRef.current = resolve
      setActionConfirmationText(text)
    })
  }, [])
  const answerActionConfirmation = useCallback((approved: boolean) => {
    const resolve = actionConfirmationDecisionRef.current
    actionConfirmationDecisionRef.current = null
    setActionConfirmationText(null)
    resolve?.(approved)
  }, [])
  const askActionTextPrompt = useCallback((title: string, initialValue = '', minLength = 1) => {
    if (actionConfirmationDecisionRef.current || actionTextDecisionRef.current) return Promise.resolve(null)
    return new Promise<string | null>((resolve) => {
      actionTextDecisionRef.current = resolve
      setActionTextPrompt({ title, initialValue, minLength })
    })
  }, [])
  const answerActionTextPrompt = useCallback((value: string | null) => {
    const resolve = actionTextDecisionRef.current
    actionTextDecisionRef.current = null
    setActionTextPrompt(null)
    resolve?.(value)
  }, [])
  useEffect(() => () => {
    actionConfirmationDecisionRef.current?.(false)
    actionConfirmationDecisionRef.current = null
    actionTextDecisionRef.current?.(null)
    actionTextDecisionRef.current = null
  }, [])

  const [returnedItemResolutionEventId, setReturnedItemResolutionEventId] = useState<number | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [authHasUsers, setAuthHasUsers] = useState(true)
  const [authBusy, setAuthBusy] = useState(false)
  const [authLogin, setAuthLogin] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authDisplayName, setAuthDisplayName] = useState('')
  const [authBootstrapLogin, setAuthBootstrapLogin] = useState('admin')
  const [authBootstrapPassword, setAuthBootstrapPassword] = useState('')
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false)
  const [passwordChangeBusy, setPasswordChangeBusy] = useState(false)
  const [passwordChangeDraft, setPasswordChangeDraft] = useState({ currentPassword: '', newPassword: '' })
  const [authUsersOpen, setAuthUsersOpen] = useState(false)
  const [authUsersBusy, setAuthUsersBusy] = useState(false)
  const [authUsers, setAuthUsers] = useState<ManagedAuthUser[]>([])
  const [authUserDraft, setAuthUserDraft] = useState({ id: 0, login: '', password: '', role: 'manager' as AccessRole, managerId: 0, displayName: '', isActive: true, mustChangePassword: true })
  const askStockResolution = (prompt: StockResolutionPrompt) => new Promise<boolean>((resolve) => {
    if (stockResolutionDecisionRef.current) stockResolutionDecisionRef.current(false)
    stockResolutionDecisionRef.current = resolve
    setStockResolutionPrompt(prompt)
  })
  const answerStockResolution = (confirmed: boolean) => {
    const resolve = stockResolutionDecisionRef.current
    stockResolutionDecisionRef.current = null
    setStockResolutionPrompt(null)
    resolve?.(confirmed)
  }

  const accessRole: AccessRole = authUser?.role || 'manager'
  const isAdmin = authUser?.role === 'admin'
  const canManageWarehouse = isAdmin || authUser?.employeeRole === 'Завсклад'
  const authReady = !authChecking
  const handleAuthInvalid = useCallback((reason: 'unauthorized' | 'password_change_required') => {
    setError(null)
    setAuthUsersOpen(false)
    setPasswordChangeOpen(false)
    if (reason === 'password_change_required') {
      setAuthUser((current) => current ? { ...current, mustChangePassword: true } : current)
      setMessage('Для продолжения работы нужно сменить пароль.')
      return
    }
    setAuthUser(null)
    setMessage('Сессия завершена. Войдите снова.')
  }, [])
  const { apiFetch, prepareCriticalRequest, completeCriticalRequest } = useApiClient({
    accessRole,
    setError,
    setMessage,
    onAuthInvalid: handleAuthInvalid,
  })
  const criticalReturnExchangeClient = { apiFetch, prepareCriticalRequest, completeCriticalRequest }
  
  

  

  

  

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
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    try {
      const response = await fetch('/api/auth/status', {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      })
      const data = await readJsonResponse<AuthStatusResponse>(response, 'Проверка авторизации')
      setAuthHasUsers(Boolean(data.hasUsers))
      setAuthUser(data.user || null)
    } catch (error) {
      console.error(error)
      setAuthUser(null)
      setError(error instanceof DOMException && error.name === 'AbortError'
        ? 'Проверка сессии заняла слишком много времени. Попробуйте войти или обновить страницу.'
        : 'Не удалось проверить текущую сессию. Попробуйте войти или обновить страницу.')
    } finally {
      window.clearTimeout(timeout)
      setAuthChecking(false)
    }
  }, [])


  const submitAuth = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthBusy(true)
    setError(null)
    try {
      const finishAuthenticated = async (user: AuthUser, message: string) => {
        if (!user.mustChangePassword) await offerBrowserPasswordSave(authLogin, authPassword)
        setAuthUser(user)
        setAuthHasUsers(true)
        setAuthPassword('')
        setAuthBootstrapPassword('')
        setMessage(user.mustChangePassword ? 'Вход выполнен. Нужно сменить временный пароль.' : message)
      }

      if (authHasUsers) {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          cache: 'no-store',
          body: JSON.stringify({ login: authLogin, password: authPassword }),
        })
        const data = await readJsonResponse<{ ok?: boolean; user?: AuthUser; code?: string; message?: string }>(response, 'Вход', { allowHttpError: true })
        if (!response.ok || data.ok === false || !data.user) {
          throw new Error(data.message || 'Не удалось войти.')
        }
        await finishAuthenticated(data.user, 'Вход выполнен.')
        return
      }

      const setupResponse = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({
          login: authLogin,
          password: authPassword,
          displayName: authDisplayName || 'Администратор',
          bootstrapLogin: authBootstrapLogin,
          bootstrapPassword: authBootstrapPassword,
        }),
      })
      const setupData = await readJsonResponse<{ ok?: boolean; user?: AuthUser; code?: string; message?: string }>(setupResponse, 'Первый администратор', { allowHttpError: true })
      if (setupResponse.ok && setupData.ok !== false && setupData.user) {
        await finishAuthenticated(setupData.user, 'Первый администратор создан.')
        return
      }

      if (setupData.code === 'AUTH_SETUP_ALREADY_COMPLETED' || setupResponse.status === 409) {
        setAuthHasUsers(true)
        setAuthBootstrapPassword('')
        const statusResponse = await fetch('/api/auth/status', {
          credentials: 'include',
          cache: 'no-store',
        })
        const statusData = await readJsonResponse<AuthStatusResponse>(statusResponse, 'Проверка созданного администратора', { allowHttpError: true })
        if (statusResponse.ok && statusData.user) {
          setAuthUser(statusData.user)
          setAuthPassword('')
          setMessage('Администратор уже был создан. Текущая сессия восстановлена.')
          return
        }
        throw new Error('Первый администратор уже создан. Войдите через обычную форму тем логином, который был создан первым.')
      }

      throw new Error(setupData.message || 'Не удалось создать первого администратора.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось войти.')
    } finally {
      setAuthBusy(false)
    }
  }, [authBootstrapLogin, authBootstrapPassword, authDisplayName, authHasUsers, authLogin, authPassword])

  const logout = useCallback(async () => {
    setError(null)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      })
      await readJsonResponse(response, 'Выход')
      setAuthUser(null)
      setAuthUsersOpen(false)
      setPasswordChangeOpen(false)
      setPasswordChangeDraft({ currentPassword: '', newPassword: '' })
      setMessage('Вы вышли из системы.')
    } catch (error) {
      setError(error instanceof DOMException && error.name === 'AbortError'
        ? 'Не удалось завершить сессию вовремя. Проверьте связь и повторите выход.'
        : error instanceof Error ? error.message : 'Не удалось завершить сессию. Повторите выход.')
    } finally {
      window.clearTimeout(timeout)
    }
  }, [])

  const submitPasswordChange = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!authUser) return
    setPasswordChangeBusy(true)
    setError(null)
    try {
      const currentPassword = passwordChangeDraft.currentPassword
      const newPassword = passwordChangeDraft.newPassword
      if (newPassword.length < 8) throw new Error('Новый пароль должен быть не короче 8 символов.')
      const response = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await readJsonResponse<{ ok: boolean; user?: AuthUser; message?: string }>(response, 'Смена пароля')
      await offerBrowserPasswordSave(authUser.login, newPassword)
      if (data.user) setAuthUser(data.user)
      setPasswordChangeDraft({ currentPassword: '', newPassword: '' })
      setPasswordChangeOpen(false)
      setMessage(data.message || 'Пароль изменён.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сменить пароль.')
    } finally {
      setPasswordChangeBusy(false)
    }
  }, [apiFetch, authUser, passwordChangeDraft])

  const loadAuthUsers = useCallback(async () => {
    return loadManagedAuthUsers({ isAdmin, apiFetch, setAuthUsersBusy, setAuthUsers, setError, setMessage })
  }, [apiFetch, isAdmin])

  const saveAuthUser = useCallback(async () => {
    return saveManagedAuthUser({ isAdmin, apiFetch, authUserDraft, authUsers, setAuthUserDraft, setAuthUsersBusy, setError, setMessage, loadAuthUsers })
  }, [apiFetch, authUserDraft, authUsers, isAdmin, loadAuthUsers])

  const disableAuthUser = useCallback(async (id: number) => {
    return disableManagedAuthUser(id, { isAdmin, apiFetch, setAuthUsersBusy, setError, setMessage, loadAuthUsers, askActionConfirmation })
  }, [apiFetch, isAdmin, loadAuthUsers, askActionConfirmation])

  const [editorDraft, setEditorDraft] = useState<EditorDraft | null>(null)
  const [inventoryDraft, setInventoryDraft] = useState<InventoryDraft>({
    source: 'warehouse',
    targetSource: 'boutique',
    movementType: 'transfer',
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
  const [inventoryMovementError, setInventoryMovementError] = useState('')
  const [arrivalRecoveryPrompt, setArrivalRecoveryPrompt] = useState<ArrivalRecoveryPrompt | null>(null)
  const [arrivalRecoveryError, setArrivalRecoveryError] = useState('')
  const arrivalRecoveryContinueRef = useRef<(() => Promise<void>) | null>(null)
  const [inventoryTransferRequestId, setInventoryTransferRequestId] = useState(() => makeCashRequestId('inventory-transfer'))
  const [inventoryManualRequestId, setInventoryManualRequestId] = useState(() => makeCashRequestId('inventory-manual'))
  const [reversingInventoryMovementId, setReversingInventoryMovementId] = useState<number | null>(null)
  const [catalogProductDraft, setCatalogProductDraft] = useState({
    id: 0,
    name: '',
    category: 'adult' as 'adult' | 'child',
    genderScope: '' as '' | 'female' | 'male' | 'unisex',
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
  const {
    returnSelectedOrderId,
    setReturnSelectedOrderId,
    returnDraft,
    setReturnDraft,
    returnBusy,
    setReturnBusy,
    returnHistory,
    returnHistoryBusy,
    returnHistoryError,
    returnHistoryFilters,
    setReturnHistoryFilters,
    returnHistoryHasMore,
    returnHistorySummary,
    returnPendingInbox,
    exchangeSelectedOrderId,
    setExchangeSelectedOrderId,
    exchangeDraft,
    setExchangeDraft,
    exchangeBusy,
    setExchangeBusy,
    exchangeHistory,
    exchangeHistoryBusy,
    exchangeHistoryError,
    exchangeHistoryFilters,
    setExchangeHistoryFilters,
    exchangeHistoryHasMore,
    exchangeHistorySummary,
    exchangePendingInbox,
    loadReturnPendingInbox,
    loadExchangePendingInbox,
    loadReturnHistory,
    loadExchangeHistory,
  } = useReturnExchangeWorkspace({ apiFetch, reportReadFailure })
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [activityBusy, setActivityBusy] = useState(false)
  const [activityFilters, setActivityFilters] = useState({ q: '', eventType: 'all', orderId: '' })
  const [financeReportFilters, setFinanceReportFilters] = useState({ dateFrom: getPeriodRange('month').dateFrom, dateTo: getPeriodRange('month').dateTo })
  const [financeReportType, setFinanceReportType] = useState<FinanceReportType>('payments')
  const {
    moneyHistory,
    moneyHistoryBusy,
    moneyHistoryError,
    moneyHistoryQuery,
    setMoneyHistoryQuery,
    moneyHistoryType,
    setMoneyHistoryType,
    moneyHistoryHasMore,
    moneyHistorySummary,
    loadMoneyHistory,
  } = useMoneyHistoryWorkspace({ apiFetch, financeReportFilters })
  const [financeMode, setFinanceMode] = useState<'summary' | 'payments' | 'debts' | 'returns' | 'methods' | 'cash' | 'dds'>('summary')
  const [cashRegister, setCashRegister] = useState<CashRegisterResponse | null>(null)
  const [cashRegisterBusy, setCashRegisterBusy] = useState(false)
  const [cashRegisterCycles, setCashRegisterCycles] = useState<CashRegisterCycle[]>([])
  const [cashRegisterCyclesBusy, setCashRegisterCyclesBusy] = useState(false)
  const [cashRegisterCyclesHasMore, setCashRegisterCyclesHasMore] = useState(false)
  const [cashRegisterCyclesOpen, setCashRegisterCyclesOpen] = useState(false)
  const [cashSetupAmount, setCashSetupAmount] = useState(0)
  const [cashMovementDraft, setCashMovementDraft] = useState<{ direction: 'in' | 'out'; amount: number; comment: string; businessDate: string }>({ direction: 'out', amount: 0, comment: '', businessDate: '' })
  const [cashReconcileAmount, setCashReconcileAmount] = useState(0)
  const [cashReconcileComment, setCashReconcileComment] = useState('')
  const cashMutationLockRef = useRef(false)
  const [financePaymentMethods, setFinancePaymentMethods] = useState<ReferenceListItem[]>([])
  const [financeMethodsBusy, setFinanceMethodsBusy] = useState(false)
  const [financeMethodDraft, setFinanceMethodDraft] = useState({ id: 0, value: '', sortOrder: '0', isActive: true })
  const [teamEmployees, setTeamEmployees] = useState<TeamEmployee[]>([])
  const [teamBusy, setTeamBusy] = useState(false)
  const [teamDraft, setTeamDraft] = useState({ id: 0, name: '', role: 'Менеджер', phone: '', birthDate: '', colorKey: '#2563EB', hiredAt: formatLocalDateInput(), comment: '', isActive: true, createAccount: true, login: '', password: '', mustChangePassword: true })
  const [teamRosterView, setTeamRosterView] = useState<'active' | 'former'>('active')
  const [teamFormOpen, setTeamFormOpen] = useState(false)
  const [teamColorEditorId, setTeamColorEditorId] = useState<number | null>(null)
  const [expandedOrderItemCounts, setExpandedOrderItemCounts] = useState<Record<number, number>>({})
  const [teamMode, setTeamMode] = useState<TeamMode>('employees')
  const [timesheetMonth, setTimesheetMonth] = useState(formatLocalDateInput().slice(0, 7))
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
    deliveryType: 'all',
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
  const {
    inventoryData,
    inventorySnapshotLoadErrors,
    warehouseAttention,
    loadWarehouseAttention,
    loadInventoryData,
    invalidateInventoryStockCaches,
  } = useWarehouseSnapshots({
    apiFetch,
    activeSector,
    inventoryPanel,
    inventorySource: inventoryDraft.source,
    clearCatalogReview: () => setCatalogReview(null),
  })

  const {
    loadInventoryReservations,
    loadInventoryStocktakeSessions,
    loadInventoryStocktakeSession,
    createInventoryStocktakeSession,
    saveInventoryStocktakeCount,
    addInventoryStocktakeVariant,
    addInventoryStocktakeCombination,
    reconcileFoundInventoryStock,
    loadInventoryCycleCounts,
    applyInventoryCycleCounts,
    quickInventoryStocktakeBatch,
    quickInventoryStocktake,
    completeInventoryStocktakeSession,
    cancelInventoryStocktakeSession,
    loadInventoryHistory,
    loadInventoryCheckHistory,
  } = createInventoryStocktakeClient(apiFetch)

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
    if (!authUser || authUser.mustChangePassword) return
    const syncSectorFromHash = () => {
      const rawHash = window.location.hash.replace('#', '').toLowerCase()
      const nextSector = sectorFromHash(window.location.hash)
      if (!canOpenWorkspaceSector(authUser.role, nextSector)) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#orders`)
        setActiveSector('orders')
        return
      }
      if (nextSector === 'inventory') {
        const isCatalogLink = rawHash === 'catalog' || rawHash === 'products'
        const isSettingsLink = rawHash === 'more' || rawHash === 'tools' || rawHash === 'technical'
        if (authUser.role === 'admin') {
          if (isCatalogLink) setInventoryPanel('catalog')
          if (isSettingsLink) setInventoryPanel('settings')
        } else if (isCatalogLink || isSettingsLink) {
          setInventoryPanel('overview')
          window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#inventory`)
        }
      }
      setActiveSector(nextSector)
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    }

    syncSectorFromHash()
    window.addEventListener('hashchange', syncSectorFromHash)
    return () => window.removeEventListener('hashchange', syncSectorFromHash)
  }, [authUser?.id, authUser?.role, authUser?.mustChangePassword])


  useEffect(() => {
    setMobileNavOpen(false)
    if (activeSector === 'orders' && orderPanel === 'zammler') setOrderPanel('list')
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
  }, [activeSector, authReady, orderPanel, filters.q, filters.status, filters.shippingStatus, filters.deliveryType, filters.archiveMode, filters.manager, filters.managerId, filters.dateFrom, filters.dateTo])

  useEffect(() => {
    if (!authReady || activeSector !== 'orders' || orderPanel !== 'debt') return
    void loadAllOpenDebtOrders()
  }, [activeSector, authReady, orderPanel])

  useEffect(() => {
    if (!authReady || activeSector !== 'orders') return
    // Pending physical returns/exchanges are operational work, not buried history.
    // Load their summaries as soon as Orders opens so the tabs can show an attention badge.
    void Promise.allSettled([loadReturnHistory(), loadExchangeHistory()])
  }, [activeSector, authReady])

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
    if (!['create', 'zammler'].includes(orderPanel) || authUser?.role !== 'manager' || Number(authUser.managerId || 0) <= 0) return
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
    getWorkshopInvoiceDeadlineLabel,
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
    summary,
    updateInventoryArrivalPosition,
    updateInventoryArrivalSize,
    variantsForProduct,
    visibleCatalogProducts,
    workshopInvoiceIsKaspi,
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
    isAdmin: canManageWarehouse,
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
    workshopInvoiceMode,
    workshopSortDirection,
  })
  // A missing Workshop cost never grants editing permission or guesses a SKU.
  // Exact matches open the corresponding Catalog product; unlinked items open
  // a name search for administrator review instead.
  const openWorkshopCatalogPrice = (productId: number | null, productName: string) => {
    if (!isAdmin) return
    const exactProductId = Number.isSafeInteger(productId) && Number(productId) > 0 ? Number(productId) : 0
    setCatalogCategoryFilter('all')
    setCatalogOnlyWithoutVariants(false)
    setInventoryQuery(exactProductId ? '' : String(productName || '').trim())
    setExpandedCatalogProducts(exactProductId ? { [String(exactProductId)]: true } : {})
    setInventoryPanel('catalog')
    setActiveSector('inventory')
    window.location.hash = '#catalog'
  }
  const openInventoryPanel = (panel: InventoryPanel) => {
    const nextPanel: InventoryPanel = panel === 'audit' ? 'settings' : panel
    if ((!canManageWarehouse && (nextPanel === 'catalog' || nextPanel === 'settings')) || (nextPanel === 'reports' && !isAdmin)) {
      setInventoryPanel('overview')
      return
    }
    setInventoryPanel(nextPanel)
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
    void loadInventoryData(item.source, true, '', false)
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
      canManageWarehouse ? loadInventoryLifecycle(force) : Promise.resolve(null),
      loadWarehouseAttention(),
    ])
  }
  const {
    addExchangeSetNewItem,
    applyCreateProductPick,
    applyEditorProductPick,
    applyExchangeItemPatch,
    applyExchangeProductPick,
    applyExchangeSetNewItemPatch,
    applyExchangeSetNewProductPick,
    removeExchangeSetNewItem,
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
    selectedOrder,
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
  const {
    inventoryMatrixActiveGroupKey,
    inventoryMatrixBatchGroups,
    inventoryMatrixSummary,
    clearInventoryMatrixValues,
    startNextInventoryMatrixProduct,
    openInventoryMatrixBatchGroup,
    removeInventoryMatrixBatchGroup,
    updateInventoryMatrixProductInput,
    updateInventoryMatrixCategory,
    updateInventoryMatrixGender,
    updateInventoryMatrixMaterial,
    updateInventoryMatrixLength,
    buildInventoryMatrix,
    addInventoryMatrixColor,
    addInventoryMatrixSize,
    inventoryMatrixDraftItem,
    setInventoryMatrixCell,
    handleInventoryMatrixKeyDown,
  } = useInventoryMatrixWorkspace({
    inventoryDraft,
    setInventoryDraft,
    inventoryMatrix,
    setInventoryMatrix,
    inventoryMatrixColorToAdd,
    setInventoryMatrixColorToAdd,
    inventoryMatrixSizeToAdd,
    setInventoryMatrixSizeToAdd,
    inventoryOperationSourceRows,
    catalogData,
    variantsForProduct,
    getInventoryRowCategory,
    inventoryMatrixCellMap,
    inventoryMatrixColors,
    suggestionValues,
    setInventoryOperationSearch,
    setInventoryOperationProductKey,
    setError,
    setMessage,
  })

  const {
    selectInventoryOperationVariant,
    updateInventoryDirectProductInput,
    updateInventoryOperationVariantField,
    setInventoryVariantOperationQuantity,
    startInventoryTransferFromStockRow,
    removeInventoryVariantOperationItem,
  } = createInventoryOperationEditorActions({
    inventoryDraft,
    setInventoryDraft,
    inventoryOperationVariant,
    setInventoryOperationVariant,
    inventoryOperationAllProductGroups,
    selectedInventoryOperationGroup,
    matchedInventoryOperationVariant,
    getInventoryRowCategory,
    setInventoryOperationProductKey,
    setInventoryOperationSearch,
    setInventoryOperationActiveVariantId,
    setInventoryExistingVariantOpen,
    setInventoryExistingVariantSearch,
    resetInventoryOperationSelection,
    setInventoryTransferRequestId,
    makeCashRequestId,
    openInventoryPanel,
  })

  const {
    applyInventoryStocktakeChanges,
    saveInventoryMovement,
  } = createInventoryMovementActions({
    inventoryMovementBusy,
    setInventoryMovementBusy,
    setInventoryMovementError,
    setError,
    setMessage,
    inventoryDraft,
    setInventoryDraft,
    flattenInventoryArrivalPositions,
    inventoryOperationSourceRows,
    getInventoryRowCategory,
    inventoryTransferRequestId,
    inventoryManualRequestId,
    apiFetch,
    loadInventoryData,
    loadCatalogData,
    setInventoryTransferRequestId,
    setInventoryManualRequestId,
    makeCashRequestId,
    setInventoryArrivalPositions,
    setInventoryArrivalVariantOpen,
    resetInventoryOperationSelection,
    setInventoryMatrix,
    setInventoryMatrixColorToAdd,
    setInventoryMatrixSizeToAdd,
    setArrivalRecoveryPrompt,
    setArrivalRecoveryError,
    arrivalRecoveryContinueRef,
    askStockResolution,
  })

  const {
    loadCatalogReview,
    reconcileCatalogReview,
    loadCatalogReviewContext,
    resolveCatalogReviewFacts,
    excludeCatalogReviewItem,
    loadInventoryLifecycle,
    loadInventoryLifecycleContext,
    resolveInventoryLifecycleFacts,
    reconcileKnownInventoryLifecycle,
    resolveCatalogReviewItem,
  } = createWarehouseRecoveryActions({
    canManageWarehouse,
    catalogReview,
    catalogReviewBusy,
    setCatalogReview,
    setCatalogReviewBusy,
    inventoryLifecycle,
    inventoryLifecycleBusy,
    setInventoryLifecycle,
    setInventoryLifecycleBusy,
    apiFetch,
    setError,
    setMessage,
    loadInventoryData,
    loadCatalogData,
    loadReferencesData,
    loadWarehouseAttention,
  })

  const {
    loadInventoryAudit,
    resolveInventoryAuditIssue,
    loadInventoryControlSettings,
    toggleInventoryAutoWriteoff,
    applyPendingInventoryWriteoffs,
    reverseInventoryMovement,
  } = createWarehouseGovernanceActions({
    askActionConfirmation,
    canManageWarehouse,
    inventoryAuditBusy,
    setInventoryAuditBusy,
    setInventoryAudit,
    inventoryControlBusy,
    setInventoryControlBusy,
    inventoryControlSettings,
    setInventoryControlSettings,
    reversingInventoryMovementId,
    setReversingInventoryMovementId,
    apiFetch,
    setError,
    setMessage,
    loadInventoryData,
  })

  const {
    updateCreateDraft,
    updateCreateItem,
    addCreateItem,
    removeCreateItem,
    updateCreatePayment,
    addCreatePayment,
    removeCreatePayment,
    createOrderDraftWithDefaultManager,
    resetCreateOrderDraft,
    createOrderFromDraft,
  } = createOrderCreationActions({
    askActionConfirmation,
    createDraft,
    setCreateDraft,
    catalogData,
    orderPanel,
    authUser,
    references,
    activeSector,
    getSizeOptions,
    setOrderBusy,
    setError,
    setMessage,
    setOrderPanel,
    setSelectedOrderId,
    setEditorDraft,
    setEditorOpen,
    prepareCriticalRequest,
    completeCriticalRequest,
    apiFetch,
    invalidateFinanceReadCaches,
    invalidateInventoryStockCaches,
    upsertOrderInState,
    refreshOrderList: () => { void loadDashboard(false, filters, 0) },
    refreshWorkshop: () => { void loadWorkshopData() },
    refreshOrderFinance: () => { void loadOrdersFinanceSummary(filters, true) },
  })

  const {
    updateEditorDraft,
    updateEditorItem,
    updateEditorPayment,
    addEditorPayment,
    removeEditorPayment,
    saveEditorPayment,
    addEditorItem,
    removeEditorItem,
    correctRecordedPaymentMethod,
  } = createOrderEditorActions({
    editorDraft,
    selectedOrder,
    savingOrder,
    catalogData,
    getSizeOptions,
    isAdmin,
    setEditorDraft,
    setSavingOrder,
    setError,
    setMessage,
    prepareCriticalRequest,
    completeCriticalRequest,
    apiFetch,
    upsertOrderInState,
    setSelectedOrderId,
    setEditorOrderOverride,
    invalidateFinanceReadCaches,
    refreshDashboard: () => { void loadDashboard(false) },
    refreshFinanceReports: refreshFinanceReportsIfVisible,
  })

  const {
    closeOrderEditor,
    expandOrderItems,
    handleEditOrder,
  } = createOrderEditSessionActions({
    isAdmin,
    editorReturnSector,
    setEditorReturnSector,
    setEditorOpen,
    setEditorOrderOverride,
    setSelectedOrderId,
    setActiveSector,
    setOrderPanel,
    setMessage,
    setError,
    setExpandedOrderItemCounts,
    setEditorDraft,
    apiFetch,
    getOrderOperationalProjection,
    upsertOrderInState,
    loadCatalogData,
    loadInventoryData,
  })

  const {
    correctOrderMetadata,
    correctRecordedOrderItemPrice,
    correctRecordedOrderItemPrices,
    loadRetiredExchangePriceOptions,
    correctRetiredExchangePrice,
  } = createOrderCorrectionsActions({
    setSavingOrder,
    setError,
    setMessage,
    prepareCriticalRequest,
    completeCriticalRequest,
    apiFetch,
    upsertOrderInState,
    refreshDashboard: () => { void loadDashboard() },
  })

  const {
    openOrderStockHandover,
    openOrderStockHandoverById,
    closeOrderStockHandover,
    runOrderStockHandoverAction,
    markOrderSentToClient,
    correctMistakenOrderShipping,
  } = createOrderShippingHandoverActions({
    askActionConfirmation,
    orders,
    stockHandoverOrder,
    stockHandoverActionItemId,
    savingOrder,
    setStockHandoverOrder,
    setStockHandoverData,
    setStockHandoverBusy,
    setStockHandoverActionItemId,
    setError,
    setMessage,
    setSavingOrder,
    setSelectedOrderId,
    setOrderCatalogResolutionOrder,
    apiFetch,
    askStockResolution,
    getOrderOperationalProjection,
    prepareCriticalRequest,
    completeCriticalRequest,
    upsertOrderInState,
    invalidateInventoryStockCaches,
    invalidateFinanceReadCaches,
    refreshDashboard: (force?: boolean) => { void loadDashboard(force) },
    refreshWorkshop: () => { void loadWorkshopData() },
  })

  const { saveReturn, saveExchange } = createReturnExchangeCreationActions({
    returnSelectedOrder,
    returnDraft,
    exchangeSelectedOrder,
    exchangeDraft,
    getOrderSourceAvailability,
    isAdmin,
    setReturnBusy,
    setExchangeBusy,
    setError,
    setMessage,
    setReturnSelectedOrderId,
    setReturnDraft,
    setExchangeSelectedOrderId,
    setExchangeDraft,
    setSelectedOrderId,
    setOrderPanel,
    apiFetch,
    prepareCriticalRequest,
    completeCriticalRequest,
    upsertOrderInState,
    loadReturnHistory,
    loadExchangeHistory,
    refreshActivityLogIfVisible,
    refreshFinanceReportsIfVisible,
    loadDashboard,
    loadInventoryData,
    loadInventoryLifecycle,
    loadWorkshopData,
  })

  const {
    receiveReturnedItemAction,
    cancelReturnEntry,
    correctExchangeFinancialEntry,
    cancelExchangeEntry,
  } = createReturnExchangeAftercareActions({
    askActionConfirmation,
    apiFetch,
    askStockResolution,
    criticalReturnExchangeClient,
    setReturnBusy,
    setExchangeBusy,
    setError,
    setMessage,
    setReturnedItemResolutionEventId,
    isAdmin,
    cashRegister,
    setReturnSelectedOrderId,
    setReturnDraft,
    setExchangeSelectedOrderId,
    setSelectedOrderId,
    upsertOrderInState,
    prepareCriticalRequest,
    completeCriticalRequest,
    invalidateInventoryStockCaches,
    invalidateFinanceReadCaches,
    loadReturnHistory,
    loadExchangeHistory,
    refreshActivityLogIfVisible,
    refreshFinanceReportsIfVisible,
    loadDashboard,
    loadWorkshopData,
    loadInventoryData,
    loadInventoryLifecycle,
    loadCashRegister,
  })

  const {
    loadExchangeCancellationPreview,
    loadOrderExchangeCancellationPlan,
    cancelOrderExchangeChain,
    loadOrderReturnCancellationChoices,
    cancelOrderReturnChoice,
  } = createOrderDependentCancellationActions({
    apiFetch,
    prepareCriticalRequest,
    completeCriticalRequest,
    setSavingOrder,
    setError,
    setMessage,
    upsertOrderInState,
    invalidateInventoryStockCaches,
    invalidateFinanceReadCaches,
    loadExchangeHistory,
    loadReturnHistory,
    loadDashboard,
    loadWorkshopData,
    refreshFinanceReportsIfVisible,
    loadInventoryLifecycle,
  })

  const { persistOrder } = createOrderEditPersistenceActions({
    isAdmin,
    selectedOrder,
    activeSector,
    orderPanel,
    setSavingOrder,
    setError,
    setMessage,
    getOrderOperationalProjection,
    prepareCriticalRequest,
    completeCriticalRequest,
    apiFetch,
    setEditorDraft,
    setEditorOrderOverride,
    setSelectedOrderId,
    setEditorOpen,
    invalidateFinanceReadCaches,
    invalidateInventoryStockCaches,
    upsertOrderInState,
    closeOrderEditor,
    refreshDashboard: () => { void loadDashboard(false) },
    refreshWorkshop: () => { void loadWorkshopData() },
    refreshOrderFinance: () => { void loadOrdersFinanceSummary(filters, true) },
  })

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
    if (activeSector === 'inventory') {
      void loadWarehouseAttention()
      // Весь склад живёт в одном разделе. Журнал движений по-прежнему не грузится без явного открытия истории.
      void loadInventoryData('warehouse')
      void loadInventoryData('boutique')
      // Full catalog variants are unnecessary for ordinary Остатки/Внимание/История reads.
      // Movement keeps them because the frozen Arrival workspace depends on catalog variants.
      if (inventoryPanel === 'movement') void loadCatalogData(true)
      else if (inventoryPanel === 'stocktake' || inventoryPanel === 'catalog') void loadCatalogData()
      // Inventory admin forms must always use the canonical reference dictionaries.
      // Do not rely on another screen having loaded them earlier in the session.
      void loadReferencesData()
      void loadInventoryControlSettings()
      if (!canManageWarehouse && inventoryPanel === 'catalog') setInventoryPanel('overview')
      if ((canManageWarehouse && !inventoryAdminPanels.includes(inventoryPanel)) || (inventoryPanel === 'reports' && !isAdmin)) setInventoryPanel('overview')
    }
    if ((activeSector === 'orders' && (orderPanel === 'create' || orderPanel === 'edit' || orderPanel === 'exchange'))) {
      // R7.5: order forms may reuse a very recent stock snapshot instead of rescanning both sources
      // on every panel transition. The server still performs the authoritative stock/CAS validation
      // on every write, and committed inventory mutations invalidate this snapshot explicitly.
      void loadInventoryData('warehouse', false, '', false)
      void loadInventoryData('boutique', false, '', false)
      void loadCatalogData()
    }
  }, [activeSector, authReady, orderPanel, isAdmin, canManageWarehouse, inventoryPanel])

  useEffect(() => {
    if (!authReady || canManageWarehouse) return
    if (activeSector === 'inventory' && inventoryPanel === 'catalog') setInventoryPanel('overview')
  }, [activeSector, authReady, inventoryPanel, canManageWarehouse])

  useEffect(() => {
    if (!authReady || !canManageWarehouse || activeSector !== 'inventory' || inventoryPanel !== 'catalog') return
    void loadReferenceKindCounts(['colors', 'materials', 'lengths', 'sizes', 'childAges'])
  }, [activeSector, authReady, inventoryPanel, canManageWarehouse])

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
      void Promise.all([
        loadTeamEmployees(),
        isAdmin ? loadAuthUsers() : Promise.resolve(),
      ])
    }
    if (activeSector === 'leads') {
      void loadLeadRecords()
      void loadCallCentreRecords()
    }
    if (activeSector === 'plan' && isAdmin) {
      void loadPlans()
    }
    if (activeSector === 'finance') {
      void loadFinancePaymentMethods()
      // Сводка ниже загружается отдельным effect и использует scoped cache.
    }
    if (activeSector === 'reports') {
      void loadFinanceReports()
    }
  }, [activeSector, authReady, financeReportType, isAdmin])

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
    if (!authReady || activeSector !== 'finance' || financeMode === 'cash' || financeMode === 'methods' || financeMode === 'dds') return
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

  const {
    loadReferencesData: loadReferencesDataAction,
    loadReferenceKindCounts: loadReferenceKindCountsAction,
    loadReferenceItems: loadReferenceItemsAction,
    saveReferenceEntry,
    removeReferenceEntry,
    resetReferenceDraft,
    selectReferenceKind,
  } = createReferenceActions({
    isAdmin,
    canManageWarehouse,
    references,
    referenceKind,
    referenceDraft,
    referenceItems,
    referenceItemsCache,
    referenceKindCounts,
    referenceBusy,
    referenceRequestIdRef,
    setReferences,
    setReferenceItems,
    setReferenceItemsCache,
    setReferenceKindCounts,
    setReferenceBusy,
    setReferenceDraft,
    setReferenceKind,
    setReferenceSearch,
    setReferenceStatusFilter,
    setError,
    setMessage,
    apiFetch,
  })

  // Effects above retain their original hoisted loader names.
  function loadReferencesData(force = false) { return loadReferencesDataAction(force) }
  function loadReferenceKindCounts(kinds: ReferenceKind[], force = false) { return loadReferenceKindCountsAction(kinds, force) }
  function loadReferenceItems(kind = referenceKind, force = false) { return loadReferenceItemsAction(kind, force) }

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



  async function loadCatalogData(force = false) {
    if (catalogData && !force) return catalogData
    const response = await apiFetch('/api/catalog')
    if (!response.ok) return null
    const data = await readJsonResponse<CatalogResponse>(response, 'Каталог')
    setCatalogData(data)
    return data
  }



  async function loadWorkshopData(
    nextFilters = workshopFilters,
    options: { force?: boolean; refreshCounts?: boolean } = { force: true, refreshCounts: true },
  ) {
    const data = await loadWorkshopRead(nextFilters, workshopSortDirection, options)
    if (data) setSelectedWorkshopTaskIds((current) => current.filter((id) => data.tasks.some((task) => task.id === id)))
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
    return loadFinanceReportsForRange(nextFilters, { ...options, scope, reportType: activeSector === 'reports' ? financeReportType : undefined })
  }

  function refreshFinanceReportsIfVisible() {
    invalidateFinanceReadCaches()
    if (activeSector === 'finance' || activeSector === 'reports') {
      if (activeSector === 'finance' && financeMode === 'payments') void loadMoneyHistory()
      return loadFinanceReports(financeReportFilters, { force: true })
    }
    return Promise.resolve(null)
  }

  function reloadFinanceReports() {
    return loadFinanceReports(financeReportFilters, { force: true })
  }

  function makeCashRequestId(prefix: string) {
    const cryptoId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    return `${prefix}-${cryptoId}`
  }

  const {
    loadCashRegister: loadCashRegisterAction,
    loadCashRegisterCycles,
    setupCashRegister,
    setCashAutoTracking,
    activateCashRegister,
    saveCashRegisterMovement,
    reconcileCashRegister,
    reverseCashRegisterMovement,
    resetCashRegisterCycle,
  } = createCashRegisterActions({
    askActionConfirmation,
    askActionTextPrompt,
    isAdmin,
    cashRegister,
    cashRegisterCycles,
    cashRegisterCyclesOpen,
    cashSetupAmount,
    cashMovementDraft,
    cashReconcileAmount,
    cashReconcileComment,
    cashMutationLockRef,
    setCashRegister,
    setCashRegisterBusy,
    setCashRegisterCycles,
    setCashRegisterCyclesBusy,
    setCashRegisterCyclesHasMore,
    setCashMovementDraft,
    setCashReconcileAmount,
    setCashReconcileComment,
    setError,
    setMessage,
    apiFetch,
    makeCashRequestId,
  })

  // Preserve the original hoisted function contract for earlier workspace setup.
  function loadCashRegister() { return loadCashRegisterAction() }

  const { loadFinancePaymentMethods, saveFinancePaymentMethod, removeFinancePaymentMethod } = createFinancePaymentMethodActions({
    isAdmin,
    financePaymentMethods,
    financeMethodDraft,
    setFinancePaymentMethods,
    setFinanceMethodsBusy,
    setFinanceMethodDraft,
    setError,
    setMessage,
    apiFetch,
    reportReadFailure,
    loadReferencesData,
  })

  const {
    loadTeamEmployees: loadTeamEmployeesAction,
    saveTeamEmployee,
    saveTeamEmployeeColor,
    setTeamEmployeeEmploymentStatus,
    removeTeamEmployee,
  } = createTeamEmployeeActions({
    askActionConfirmation,
    isAdmin,
    teamDraft,
    teamEmployees,
    authUsers,
    setTeamBusy,
    setTeamEmployees,
    setTeamDraft,
    setTeamFormOpen,
    setTeamColorEditorId,
    setError,
    setMessage,
    apiFetch,
    reportReadFailure,
    loadAuthUsers,
    loadReferencesData,
  })

  // These loaders are also referenced by the earlier sector effects.
  function loadTeamEmployees() { return loadTeamEmployeesAction() }

  const {
    shiftTimesheetMonth,
    setTimesheetCurrentMonth,
    getTimesheetCalendarSlots,
    getTimesheetWeekdayLabel,
    getTimesheetEntriesForDate,
    loadTeamTimesheet: loadTeamTimesheetAction,
    saveTeamTimesheet,
    setTimesheetDaysPreset,
    toggleTimesheetDay,
    toggleTimesheetManager,
  } = createTeamTimesheetActions({
    isAdmin,
    timesheetMonth,
    timesheetData,
    timesheetSelectedDays,
    timesheetSelectedManagers,
    timesheetWorkUntil,
    timesheetComment,
    setTimesheetMonth,
    setTimesheetSelectedDays,
    setTimesheetSelectedManagers,
    setTimesheetData,
    setTimesheetBusy,
    setError,
    setMessage,
    apiFetch,
    reportReadFailure,
    loadTeamSalaryReport,
    refreshActivityLogIfVisible,
  })

  function loadTeamTimesheet(monthValue = timesheetMonth) { return loadTeamTimesheetAction(monthValue) }

  const {
    editManagerPlan,
    editDepartmentPlan,
    deleteManagerPlan,
    deleteDepartmentPlan,
    loadPlans: loadPlansAction,
    saveManagerPlan,
    saveDepartmentPlan,
  } = createPlanActions({
    askActionConfirmation,
    isAdmin,
    planFilters,
    planReport,
    managerPlanDraft,
    departmentPlanDraft,
    setManagerPlanDraft,
    setDepartmentPlanDraft,
    setPlanBusy,
    setPlanReport,
    setError,
    setMessage,
    apiFetch,
    reportReadFailure,
    refreshFinanceReportsIfVisible,
  })

  // Earlier sector effects retain the former hoisted loader entrypoint.
  function loadPlans(nextFilters = planFilters) { return loadPlansAction(nextFilters) }

  const { loadTeamSalaryReport: loadTeamSalaryReportAction, loadTeamActivityReport: loadTeamActivityReportAction } = createTeamReportActions({
    teamSalaryFilters,
    teamSalaryReport,
    teamActivityFilters,
    teamActivityReport,
    setTeamBusy,
    setTeamSalaryReport,
    setTeamActivityBusy,
    setTeamActivityLoadFailed,
    setTeamActivityReport,
    apiFetch,
    reportReadFailure,
  })

  function loadTeamSalaryReport(nextFilters = teamSalaryFilters) { return loadTeamSalaryReportAction(nextFilters) }
  function loadTeamActivityReport(nextFilters = teamActivityFilters, options: { append?: boolean } = {}) { return loadTeamActivityReportAction(nextFilters, options) }

  const {
    printHtmlDocument,
    exportPlanReportWord,
    printPlanReportPdf,
    printInventoryStocktakePdf,
    exportTeamPlanReportWord,
    printTeamPlanReportPdf,
    exportSelectedFinanceReportWord,
    printSelectedFinanceReportPdf,
  } = createReportExportActions({
    planDateFrom: planFilters.dateFrom,
    planDateTo: planFilters.dateTo,
    financeReportType,
    financeDateFrom: financeReportFilters.dateFrom,
    financeDateTo: financeReportFilters.dateTo,
    setError,
  })

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
    if (!id || !(await askActionConfirmation('Удалить запись лидов?'))) return
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
    if (!id || !(await askActionConfirmation('Удалить запись Call Centre?'))) return
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



  const { applyWorkshopPeriodPreset, markWorkshopTaskDone, restoreWorkshopTaskActive } = createWorkshopTaskActions({
    workshopFilters,
    setWorkshopFilters,
    setWorkshopBusy,
    setError,
    setMessage,
    apiFetch,
    loadWorkshopData,
    applyWorkshopTaskStatusChange,
    upsertOrderInState,
    loadDashboard,
  })

  const { copyWorkshopInvoiceText, exportWorkshopInvoiceWord, downloadWorkshopInvoicePdf, printWorkshopInvoice } = createWorkshopInvoiceActions({
    invoiceRows: workshopInvoiceRows,
    invoiceIsKaspi: workshopInvoiceIsKaspi,
    invoiceTaskCount: workshopScopeTasks.length,
    invoiceDateFrom: workshopFilters.dateFrom,
    invoiceDateTo: workshopFilters.dateTo,
    getWorkshopInvoiceDeadlineLabel,
    getWorkshopInvoiceImportanceLabel,
    printHtmlDocument,
    setError,
    setMessage,
  })



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
    const requestId = orderListReadGuardRef.current.begin()
    const isCurrentRead = () => orderListReadGuardRef.current.isCurrent(requestId)
    const activeFilters = overrideFilters
    const searchQuery = activeFilters.q.trim()
    if (searchQuery && Array.from(searchQuery).length < 3) {
      setBusy(false)
      setError(null)
      setMessage('Введите минимум 3 символа для поиска заказа.')
      setOrders([])
      setOrderPeriodStats(null)
      setOrderPageOffset(0)
      setOrderPageInfo((current) => ({ ...current, offset: 0, totalCount: 0, hasMore: false, hasPrevious: false }))
      setSelectedOrderId(null)
      setEditorOpen(false)
      return null
    }

    setBusy(true)
    setError(null)
    setMessage(null)

    try {
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
      if (activeFilters.deliveryType === 'zammler') params.set('deliveryType', 'ЗАММЛЕР')
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
      // A prior filter/page read must never overwrite a newer shipment refresh.
      if (!isCurrentRead()) return null

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

      // Even optional health/reference responses must not replace newer list feedback.
      if (!isCurrentRead()) return null
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

      // Orders including Kaspi use the same paginated read and period summary.
      // Do not add a duplicate D1 summary read during each page fetch.
      return ordersData
    } catch (err) {
      if (!isCurrentRead()) return null
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
      if (isCurrentRead()) setBusy(false)
    }
  }

  async function changeOrderPage(direction: 'previous' | 'next') {
    const step = Math.max(20, Number(orderPageInfo.limit || 100))
    const nextOffset = direction === 'next'
      ? orderPageInfo.offset + step
      : Math.max(0, orderPageInfo.offset - step)
    if (nextOffset === orderPageInfo.offset) return
    const lastOrder = direction === 'next' && orders.length ? orders[orders.length - 1] : null
    const activeListFilters = filters
    await loadDashboard(false, activeListFilters, nextOffset, { afterOrderDate: lastOrder?.order_date || '', afterOrderId: Number(lastOrder?.id || 0), reusePeriodStats: true })
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
      deliveryType: 'all',
      source: 'all',
      manager: '',
      managerId: 0,
      archiveMode: 'active',
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      pageSize: '100',
    })
  }

  const createPricing = useMemo(
    () => evaluateItemizedCreatePricing(createDraft.items, createDraft.payments),
    [createDraft.items, createDraft.payments],
  )
  const createTotals = useMemo(() => ({
    totalAmount: createPricing.totalAmount ?? 0,
    receivedAmount: createPricing.receivedAmount,
    debtAmount: createPricing.debtAmount ?? 0,
  }), [createPricing])

  useEffect(() => {
    if (orderPanel === 'create') setCreateDraft(createOrderDraftWithDefaultManager())
  }, [orderPanel])

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

    const projection = await getOrderOperationalProjection(order)
    if (!projection.canEdit) {
      setMessage(projection.hasCommittedDownstreamOperation
        ? 'Заказ из Цеха нельзя переписывать: по нему уже проведён возврат или обмен. Сначала отмените или исправьте эту последующую операцию штатным действием.'
        : 'Этот заказ из Цеха сейчас недоступен для обычного редактирования.')
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
        ...(order.pricing_mode === 'itemized_v1' && exactWorkshopItem ? {
          unitPrice: Number.isSafeInteger(Number(exactWorkshopItem.unitPrice)) && Number(exactWorkshopItem.unitPrice) >= 0
            ? Number(exactWorkshopItem.unitPrice)
            : undefined,
          catalogPriceSnapshot: null,
          priceOrigin: Number.isSafeInteger(Number(exactWorkshopItem.unitPrice)) && Number(exactWorkshopItem.unitPrice) >= 0 ? 'manual' : 'missing',
          priceNeedsConfirmation: false,
        } : {}),
      },
    })
    setMessage(`Открыта форма обмена по заказу ${order.external_id}.`)
  }

  async function saveCatalogProduct() {
    if (!canManageWarehouse) {
      setError('Редактирование каталога товаров доступно только администратору.')
      return
    }

    const payload = {
      name: catalogProductDraft.name,
      category: catalogProductDraft.category,
      genderScope: catalogProductDraft.genderScope,
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
    setCatalogProductDraft({ id: 0, name: '', category: catalogCategoryFilter === 'child' ? 'child' : 'adult', genderScope: '' })
    setMessage(isEdit ? 'Товар обновлён.' : 'Товар добавлен.')
  }

  async function saveCatalogVariant() {
    if (!canManageWarehouse) {
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

  async function getOrderOperationalProjection(order: OrderRecord) {
    const { projectOrderOperationalState } = await import('./app/orderOperationalProjection')
    return projectOrderOperationalState(order, { isAdmin })
  }

  async function handleOpenDebt(order: OrderRecord) {
    const projection = await getOrderOperationalProjection(order)
    if (!projection.canOpenDebt) {
      setSelectedOrderId(order.id)
      setMessage(projection.debtAmount <= 0
        ? 'У заказа нет открытого долга.'
        : 'Этот заказ доступен только как история. Долг по нему не закрывается из рабочей таблицы.')
      return
    }
    setActiveSector('orders')
    setOrderPanel('debt')
    setDebtSelectedOrderId(order.id)
    setDebtPayments([createDebtClosePayment(formatLocalDateInput(), Number(order.debt_amount || 0))])
    setSelectedOrderId(order.id)
    setEditorOpen(false)
  }

  async function handleOpenReturn(order: OrderRecord) {
    const projection = await getOrderOperationalProjection(order)
    if (!projection.canOpenReturn) {
      setSelectedOrderId(order.id)
      setMessage('По этому заказу нельзя оформлять возврат из рабочего режима. Он доступен только как история.')
      return
    }
    setActiveSector('orders')
    setOrderPanel('returns')
    setReturnSelectedOrderId(order.id)
    setSelectedOrderId(order.id)
    setEditorOpen(false)
  }

  async function handleOpenExchange(order: OrderRecord) {
    const projection = await getOrderOperationalProjection(order)
    if (!projection.canOpenExchange) {
      setSelectedOrderId(order.id)
      setMessage('По этому заказу нельзя оформлять обмен из рабочего режима. Он доступен только как история.')
      return
    }
    setActiveSector('orders')
    setOrderPanel('exchange')
    setExchangeSelectedOrderId(order.id)
    setExchangeDraft(createExchangeDraft(order))
    setSelectedOrderId(order.id)
    setEditorOpen(false)
  }

  // Admin correction of a recorded payment method, including an exchange-
  // linked extra payment. This is not a second payment and does not submit the
  // item/payment editor draft or rewrite the order after a completed exchange.
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
    const confirmed = await askActionConfirmation(`Архивировать ${readyCount} закрытых заказов? Они останутся в отчётах, но станут доступны только для просмотра.`)
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
    const confirmed = await askActionConfirmation(`Вернуть заказ ${order.external_id} из архива в закрытые заказы?`)
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

  async function loadAdminOrderDeletePreview(order: OrderRecord) {
    const [response,chainResponse]=await Promise.all([
      apiFetch(`/api/orders/${order.id}/delete-preview`),
      apiFetch(`/api/orders/${order.id}/delete-chain`),
    ])
    const data=await readJsonResponse<{
      ok?:boolean;message?:string;
      preview?:{
        orderId:number;externalId:string;canAttemptDelete:boolean;canStartChain:boolean;requiresPhysicalFact:boolean;
        activeExchanges:number[];activeReturns:number[];
        receivedAmount:number;returnAmount:number;paymentCount:number;
        registeredPayments:number;recordedRefunds:number;issuedItemCount:number;issuedQuantity:number;
        reasons:string[];explanations:string[];
        impact:{saleAmount:number;debtAmount:number;paymentReversal:number;refundReversal:number;netMoneyReversal:number;
          payments:Array<{id:number;date:string;method:string;amount:number;kind:string}>;
          refunds:Array<{id:number;date:string;method:string;amount:number}>;
          exchanges:Array<{id:number;financialAction:string;financialAmount:number}>;
          reservations:Array<{orderItemId:number;name:string;source:string;quantity:number;status:string;action:string}>;truncated:boolean};
        chainPlan:{
          snapshotFingerprint:string;steps:Array<{type:'exchange'|'return';id:number;order:number;reason:string;requiresManualReview:boolean}>;
          activeExchangeIds:number[];activeReturnIds:number[];generatedExchangeRefundIds:number[];
          manualReviewRequired:boolean;canExecuteAutomatically:boolean;blockers:string[];
        };
      }
    }>(response,'Предварительная проверка удаления')
    if(!response.ok||data.ok===false||!data.preview)
      throw new Error(data.message||'Не удалось проверить последствия удаления.')
    const saga=await readJsonResponse<{
      ok?:boolean;progress?:{requestId:string;status:string;nextStep:number;totalSteps:number}
    }>(chainResponse,'Проверка удаления')
    if(!chainResponse.ok||saga.ok===false)
      throw new Error('Не удалось проверить уже начатое удаление.')
    return {...data.preview,activeSaga:saga.progress||null}
  }

  async function confirmAdminDeletePhysicalBeforeChain(order:OrderRecord,expectedSnapshot:string){
    if(!/^[0-9a-f]{64}$/.test(expectedSnapshot))throw new Error('Предпросмотр устарел.')
    const response=await apiFetch('/api/orders/'+order.id+'/delete-physical-confirm',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({expectedSnapshot,physicalOutcome:'not_issued'}),
    })
    const result=await readJsonResponse<{
      ok?:boolean;message?:string;
      preview?:Awaited<ReturnType<typeof loadAdminOrderDeletePreview>>
    }>(response,'Проверка фактической выдачи перед удалением')
    if(!response.ok||result.ok===false)
      throw new Error(result.message||'Не удалось безопасно исправить выдачу.')
    invalidateInventoryStockCaches(true)
    // The Worker already calculated a fresh preview AFTER the correction.
    // Reuse it instead of issuing another heavyweight delete-preview GET.
    // A missing/malformed preview falls back to a fresh read, never to old data.
    if(result.preview?.chainPlan?.snapshotFingerprint
      && /^[a-f0-9]{64}$/.test(result.preview.chainPlan.snapshotFingerprint))
      return {...result.preview,activeSaga:null}
    return await loadAdminOrderDeletePreview(order)
  }

  // Resume the SAME durable cancellation after a lost response or page reload.
  // Each HTTP call executes no more than one verified operation.
  async function executeAdminDeleteChain(order:OrderRecord,expectedSnapshot:string,
    onProgress?:(done:number,total:number)=>void,physicalOutcome?:'not_issued'):Promise<boolean>{
    if(!/^[0-9a-f]{64}$/.test(expectedSnapshot))return false
    setSavingOrder(true);setError(null);setMessage(null)
    try{
      const key='admin-delete-chain:'+order.id
      const check=await apiFetch('/api/orders/'+order.id+'/delete-chain')
      const state=await readJsonResponse<{ok?:boolean;progress?:{requestId:string}}>(check,'Восстановление удаления')
      if(!check.ok)throw new Error('Не удалось проверить ранее начатое удаление.')
      const prepared=prepareCriticalRequest(key,{expectedSnapshot})
      const requestId=state.progress?.requestId||prepared.requestId
      const maxSteps=125
      for(let index=0;index<maxSteps;index++){
        const response=await apiFetch('/api/orders/'+order.id+'/delete-chain',{
          method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':requestId},
          body:JSON.stringify({requestId,expectedSnapshot, ...(physicalOutcome?{physicalOutcome}:{})}),
        })
        const data=await readJsonResponse<{
          ok?:boolean;message?:string;
          progress?:{requestId:string;status:string;nextStep:number;totalSteps:number;lastError:string};
        }>(response,'Отмена зависимых операций')
        if(!response.ok||data.ok===false||!data.progress)
          throw new Error(data.message||'Удаление остановлено. Повторите — уже завершённые шаги не выполнятся повторно.')
        onProgress?.(data.progress.nextStep,data.progress.totalSteps)
        if(data.progress.status==='completed'){
          completeCriticalRequest(key,prepared.requestId)
          setOrders(current=>current.filter(entry=>entry.id!==order.id))
          if(selectedOrderId===order.id){setSelectedOrderId(null);setEditorOpen(false)}
          invalidateFinanceReadCaches()
          invalidateInventoryStockCaches(true)
          setMessage(data.message||'Заказ и его связанные записи аннулированы.')
          void loadDashboard()
          return true
        }
      }
      throw new Error('Цепочка слишком длинная. Повторите удаление для безопасного продолжения.')
    }catch(err){
      setError(err instanceof Error?err.message:'Не удалось завершить удаление.')
      return false
    }finally{setSavingOrder(false)}
  }

  async function deleteOrderAsAdmin(order: OrderRecord, previewAcknowledged = false, expectedSnapshot = '', physicalOutcome?: 'not_issued'): Promise<boolean> {
    if (!previewAcknowledged || !/^[0-9a-f]{64}$/.test(expectedSnapshot)) return false // Only approved and current preview may authorize execution.
    if (isArchivedOrderRecord(order)) {
      setMessage('Архивный заказ нельзя удалить. Сначала верните его из архива.')
      return false
    }
    setSavingOrder(true)
    setError(null)
    setMessage(null)
    try {
      const criticalKey = `order-delete:${order.id}`
      const sendDelete = async (physicalOutcome?: 'not_issued') => {
        const payload = {
          comment: order.comment || 'Удалено сотрудником как ошибочный заказ',
          expectedSnapshot,
          ...(physicalOutcome ? { physicalOutcome } : {}),
        }
        const critical = prepareCriticalRequest(criticalKey, payload)
        const response = await apiFetch(`/api/orders/${order.id}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
          body: JSON.stringify(critical.payload),
        })
        const result = await readJsonResponse<{
          ok?: boolean; code?: string; message?: string; order?: OrderRecord;
          details?: {
            shippingStatus: 'sent' | 'not_sent';
            issuedItemsTotal: number;
            issuedItems: Array<{
              orderItemId: number; variantId: number; productName: string;
              color: string; material: string; size: string;
              quantity: number; source: string; fulfilledAt: string;
            }>;
            activeExchangeCount: number;
            activeReturnCount: number;
          };
        }>(response, 'Удаление заказа')
        return { response, result, critical }
      }

      let attempt = await sendDelete(physicalOutcome)
      if (!attempt.response.ok && attempt.result.code === 'order_delete_physical_confirmation_required')
        throw new Error('Перед удалением подтвердите в окне, что товар действительно не передавался клиенту.')
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
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      return false
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

  function renderInventoryStockGroups(source: InventorySourceKey, groups: InventoryStockGroup[]) {
    return InventoryStockGroupsRenderer(source, groups, { expandedInventoryGroups, getInventoryRowCategory, hasInventoryQuickFilters, inventorySearchTokens, isAdmin: canManageWarehouse, productCategoryLabel, sourceLabel, startInventoryTransferFromStockRow, toggleInventoryGroup })
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

  const authGateProps = {
    authUser,
    authHasUsers,
    authLogin,
    authPassword,
    authDisplayName,
    authBootstrapLogin,
    authBootstrapPassword,
    authBusy,
    passwordChangeBusy,
    passwordChangeDraft,
    error,
    setError,
    setAuthLogin,
    setAuthPassword,
    setAuthDisplayName,
    setAuthBootstrapLogin,
    setAuthBootstrapPassword,
    setPasswordChangeDraft,
    submitAuth,
    submitPasswordChange,
    logout,
  }

  if (authChecking) return <AuthGate stage="checking" {...authGateProps} />
  if (!authUser) return <AuthGate stage="login" {...authGateProps} />
  if (authUser.mustChangePassword) return <AuthGate stage="change-password" {...authGateProps} />

  if (!canOpenWorkspaceSector(accessRole, activeSector)) {
    return <main className="auth-shell" role="status">Открываем раздел «Заказы»…</main>
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
          <div className="card-label">Аккаунт</div>
          <div className="access-role-control">
            <div className="auth-user-card">
              <strong>{authUser.displayName || authUser.managerName || authUser.login}</strong>
              <span>@{authUser.login}{authUser.managerName ? ` · ${authUser.managerName}` : ''}</span>
              <em>{isAdmin ? 'Администратор' : authUser?.employeeRole === 'Завсклад' ? 'Завсклад' : authUser?.employeeRole === 'Упаковщик' ? 'Упаковщик' : 'Менеджер'}</em>
            </div>
            <div className="access-role-actions">
              {isAdmin ? (
                <>
                  <button className="secondary compact" type="button" onClick={storageMaintenance.openPanel}>
                    Хранилище
                  </button>
                  <button className="secondary compact" type="button" onClick={() => { setAuthUsersOpen(true); void loadAuthUsers() }}>
                    Аккаунты
                  </button>
                </>
              ) : null}
              <button className="secondary compact" type="button" onClick={() => setPasswordChangeOpen(true)}>
                Сменить пароль
              </button>
              <button className="secondary compact" type="button" onClick={() => void logout()}>
                Выйти
              </button>
            </div>
          </div>
        </div>

        <nav className="erp-primary-nav" id="primary-workspace-navigation" aria-label="Основные разделы">
          {workspaceModules.filter((module) => canSeeWorkspaceMenuItem(accessRole, module.id)).map((module) => (
            <a
              key={module.id}
              className={`erp-primary-nav-button ${module.status === 'planned' ? 'is-planned' : ''} ${(module.id === 'dashboard' ? activeSector === 'overview' : module.id === activeSector) ? 'is-current' : ''}`}
              href={module.href}
              title={module.note}
              onClick={() => setMobileNavOpen(false)}
            >
              <span className="erp-nav-icon">{module.icon}</span>
              <span>{module.label}</span>
            </a>
          ))}
        </nav>

        <div className="erp-sidebar-footer">
          {isAdmin ? 'Рабочая панель: разделы управления и аналитики.' : 'Рабочая панель: заказы, цех и склад.'}
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
                <p>Уточнение после ревизии исправляет учёт резерва на основании ответа сотрудника. Оно не устанавливает статус «Отправлен» и не доказывает доставку клиенту. Остатки других товаров не меняются.</p>
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
                            <strong>По учёту выдача уже отмечена.</strong>
                            <span>{item.reviewDecision === 'issued_before_checkpoint' ? `Сотрудник отметил выдачу до ${checkpointWord} ${handoverCheckpointDateLabel(item.reviewedCheckpointAt || item.checkpointAt)}. Резерв закрыт, физический остаток второй раз не уменьшался. Это не подтверждение отправки заказа.` : 'При окончательной отправке заказа этот товар второй раз не спишется.'}</span>
                          </div>
                        ) : item.state === 'handover_review' ? (
                          <div className="order-stock-handover-legacy-choice">
                            <div className="order-stock-handover-question">
                              <strong>К моменту {checkpointWord} {checkpointDate} товар уже был у клиента?</strong>
                              <span>{item.reviewReason === 'late_entry' ? 'Заказ внесли в систему после проверки за более раннюю дату.' : 'После оформления заказа была физическая проверка. Уточните, где находилась вещь в тот день.'}</span>
                              {item.itemCreatedAt ? <span>Позиция в учёте с {handoverDateTimeLabel(item.itemCreatedAt)}.</span> : null}
                              <span>Отмечайте только то, что известно по факту. Ответ «выдали до проверки» закрывает резерв без повторного списания, но НЕ отмечает заказ отправленным. Если вещь была на месте, резерв сохраняется до отправки.</span>
                            </div>
                            <div className="order-stock-handover-choice-grid">
                              <button
                                className="secondary order-stock-handover-choice is-client"
                                type="button"
                                disabled={stockHandoverActionItemId !== null}
                                onClick={() => void runOrderStockHandoverAction(item, 'issued_before_checkpoint')}
                              >
                                <strong>Да, клиент получил до проверки</strong>
                                <span>Закрыть резерв, не уменьшать остаток повторно</span>
                              </button>
                              <button
                                className="secondary order-stock-handover-choice is-here"
                                type="button"
                                disabled={stockHandoverActionItemId !== null}
                                onClick={() => void runOrderStockHandoverAction(item, 'still_here')}
                              >
                                <strong>Нет, во время проверки был на месте</strong>
                                <span>Сохранить резерв, затем оформить фактическую отправку</span>
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

      <ActionConfirmationModal message={actionConfirmationText} onDecision={answerActionConfirmation} />
      {actionTextPrompt ? (
        <ActionTextPromptModal title={actionTextPrompt.title}
          initialValue={actionTextPrompt.initialValue} minLength={actionTextPrompt.minLength} onDecision={answerActionTextPrompt} />
      ) : null}
       <StockResolutionConfirmModal prompt={stockResolutionPrompt} onDecision={answerStockResolution} />

      <ArrivalRecoveryDialog
        prompt={arrivalRecoveryPrompt}
        busy={inventoryMovementBusy}
        error={arrivalRecoveryError}
        onConfirm={() => { void arrivalRecoveryContinueRef.current?.() }}
        onClose={() => {
          if (inventoryMovementBusy) return
          setArrivalRecoveryPrompt(null)
          setArrivalRecoveryError('')
          arrivalRecoveryContinueRef.current = null
        }}
      />

      <ReturnedItemResolutionModal
        eventId={returnedItemResolutionEventId}
        apiFetch={apiFetch}
        isAdmin={isAdmin}
        onClose={() => setReturnedItemResolutionEventId(null)}
        onCompleted={async () => {
          await Promise.allSettled([
            loadReturnHistory(),
            loadExchangeHistory(),
            loadInventoryData('warehouse', true, '', false),
            loadInventoryData('boutique', true, '', false),
            loadDashboard(false),
          ])
          setMessage('Товар определён и приёмка завершена.')
        }}
      />



      <Suspense fallback={null}>
      <OrderCatalogResolutionModal
        order={orderCatalogResolutionOrder}
        apiFetch={apiFetch}
        isAdmin={isAdmin}
        askActionConfirmation={askActionConfirmation}
        onClose={() => setOrderCatalogResolutionOrder(null)}
        onCompleted={async (resolvedOrder: OrderRecord) => {
          const freshResponse = await apiFetch(`/api/orders/${resolvedOrder.id}`, { cache: 'no-store' })
          if (freshResponse.headers.get('X-Orders-App-Stale') === '1') {
            throw new Error('Не удалось подтвердить свежий заказ после уточнения товара. Повторите продолжение отправки.')
          }
          const freshResult = await readJsonResponse<{ ok?: boolean; order?: OrderRecord; message?: string }>(freshResponse, 'Обновление заказа после уточнения товара')
          if (!freshResponse.ok || freshResult.ok === false || !freshResult.order || freshResult.order.id !== resolvedOrder.id) {
            throw new Error(freshResult.message || 'Не удалось получить свежий заказ после уточнения товара.')
          }
          upsertOrderInState(freshResult.order)
          setSelectedOrderId(freshResult.order.id)
          setOrderCatalogResolutionOrder(null)
          setMessage('Товар уточнён. Выберите готовые вещи через «Отправить товары».')
          return true
        }}
        onEditOrder={async (blockedOrder: OrderRecord) => {
          setOrderCatalogResolutionOrder(null)
          await handleEditOrder(blockedOrder)
        }}
        onOpenFullReview={async (blockedOrder: OrderRecord) => {
          setOrderCatalogResolutionOrder(null)
          await loadCatalogReview(true, blockedOrder.id)
          setActiveSector('inventory')
          openInventoryPanel('catalog')
          setMessage('Открыт полный разбор только этого заказа. Используйте его, если нужной комбинации ещё нет в каталоге.')
        }}
      />
      </Suspense>

      <DatabaseStorageModal maintenance={storageMaintenance} onOpenReports={openStorageMonthReports} />

      {passwordChangeOpen ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card auth-users-modal" role="dialog" aria-modal="true" aria-label="Смена пароля" onSubmit={submitPasswordChange} method="post" action="/api/auth/change-password" autoComplete="on">
            <div className="modal-head">
              <div>
                <div className="card-label">Доступ</div>
                <h3>Сменить пароль</h3>
                <p>Введите нынешний пароль и новый пароль.</p>
              </div>
              <button className="secondary compact" type="button" onClick={() => { setPasswordChangeOpen(false); setPasswordChangeDraft({ currentPassword: '', newPassword: '' }) }}>Закрыть</button>
            </div>
            <div className="form-grid compact-form-grid">
              <label><span>Логин</span><input name="username" value={authUser.login} autoComplete="username" readOnly /></label>
              <label><span>Текущий пароль</span><input name="current-password" type="password" autoComplete="current-password" value={passwordChangeDraft.currentPassword} onChange={(event) => setPasswordChangeDraft((draft) => ({ ...draft, currentPassword: event.target.value }))} required /></label>
              <label><span>Новый пароль</span><input name="new-password" type="password" autoComplete="new-password" value={passwordChangeDraft.newPassword} onChange={(event) => setPasswordChangeDraft((draft) => ({ ...draft, newPassword: event.target.value }))} required minLength={8} /></label>
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
                  <label><span>Логин</span><input value={authUserDraft.login} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, login: event.target.value }))} placeholder="Например: asel" minLength={3} maxLength={32} /></label>
                  <label><span>Пароль</span><input type="password" value={authUserDraft.password} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, password: event.target.value }))} placeholder={authUserDraft.id ? 'Не менять' : 'Минимум 8 символов'} /></label>
                  <label><span>Роль</span><select value={authUserDraft.role} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, role: normalizeAccessRole(event.target.value) }))}><option value="manager">Менеджер</option><option value="admin">Админ</option></select></label>
                  <label><span>Сотрудник</span><select value={authUserDraft.managerId || 0} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, managerId: Number(event.target.value) || 0 }))}><option value={0}>Не привязан</option>{teamEmployees.map((employee) => <option key={`auth-employee-${employee.id}`} value={employee.id}>{employee.name}</option>)}</select></label>
                  <label><span>Имя в системе</span><input value={authUserDraft.displayName} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, displayName: event.target.value }))} placeholder="Можно оставить пустым" /></label>
                  <label className="checkbox-line"><input type="checkbox" checked={authUserDraft.isActive} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, isActive: event.target.checked }))} /> Доступ включён</label>
                  <label className="checkbox-line"><input type="checkbox" checked={authUserDraft.mustChangePassword} onChange={(event) => setAuthUserDraft((draft) => ({ ...draft, mustChangePassword: event.target.checked }))} /> Потребовать смену пароля</label>
                </div>
                <div className="modal-actions">
                  <button className="primary" type="button" onClick={() => void saveAuthUser()} disabled={authUsersBusy}>{authUserDraft.id ? 'Сохранить' : 'Создать'}</button>
                  {authUserDraft.id ? <button className="secondary" type="button" onClick={() => setAuthUserDraft({ id: 0, login: '', password: '', role: 'manager', managerId: 0, displayName: '', isActive: true, mustChangePassword: true })}>Новый</button> : null}
                </div>
              </section>

              <section className="mini-panel">
                <div className="mini-panel-head">
                  <div>
                    <h4>Аккаунты</h4>
                    <p className="mini-panel-note">Показано {authUsers.length}. Отключение аккаунта закрывает его активные сессии.</p>
                  </div>
                  <button className="secondary compact" type="button" onClick={() => void loadAuthUsers()}>{authUsersBusy ? 'Загружаю...' : 'Обновить'}</button>
                </div>
                <div className="auth-users-list">
                  {authUsers.map((user) => (
                    <div className={`auth-user-row ${user.isActive ? '' : 'is-disabled'}`} key={`auth-user-${user.id}`}>
                      <div>
                        <strong>@{user.login}</strong>
                        <span>{user.role === 'admin' ? 'Админ' : 'Менеджер'}{user.managerName ? ` · ${user.managerName}` : ''}</span>
                        <small>{user.mustChangePassword ? 'Нужно сменить временный пароль' : user.lastLoginAt ? `Последний вход: ${formatDateShort(user.lastLoginAt)}` : 'Входов пока нет'}</small>
                      </div>
                      <div className="row-actions">
                        <button className="secondary compact" type="button" onClick={() => setAuthUserDraft({ id: user.id, login: user.login, password: '', role: user.role, managerId: user.managerId || 0, displayName: user.displayName || '', isActive: user.isActive, mustChangePassword: Boolean(user.mustChangePassword) })}>Править</button>
                        <button className="danger subtle compact" type="button" disabled={!user.isActive} onClick={() => void disableAuthUser(user.id)}>Отключить</button>
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
              <span className="hint">Роль: <strong>{isAdmin ? 'Админ' : authUser?.employeeRole === 'Завсклад' ? 'Завсклад' : authUser?.employeeRole === 'Упаковщик' ? 'Упаковщик' : 'Менеджер'}</strong></span>
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
        <ReferencesSection ctx={{ apiFetch, askActionConfirmation, loadReferencesData, loadReferenceKindCounts, filteredReferenceItems, formatDateShort, FriendlyNumberInput, isAdmin, loadReferenceItems, normalizeSuggestion, referenceBusy, referenceDraft, referenceGroups, referenceItems, referenceKind, referenceSearch, referenceStats, referenceStatusFilter, removeReferenceEntry, resolveCatalogReviewItem, resetReferenceDraft, saveReferenceEntry, sectorStyle, selectedReferenceKindConfig, selectReferenceKind, setReferenceDraft, setReferenceSearch, setReferenceStatusFilter }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'inventory'} label="Склад">
        <InventorySection ctx={{ askActionConfirmation, onInlineCorrectionVariant: (seed: {productId:number|string;productName:string;category:'adult'|'child';gender:string;material:string;length:string;color:string;size:string;quantity:number})=>{
          const draftKey=inventoryUiId('correction')
          setInventoryDraft(current=>{
            // Two fast clicks on +размер/+цвет must never add the same SKU twice:
            // manual_set is an absolute count, not two separate arrivals.
            const same = (a: unknown, b: unknown) => normalizeSearchText(a) === normalizeSearchText(b)
            const alreadyInDraft = current.items.some(item =>
              item.createMissingVariant
              && String(item.productId) === String(seed.productId)
              && item.category === seed.category
              && same(item.gender,seed.gender)
              && same(item.material,seed.material)
              && same(item.length,seed.length)
              && same(item.color,seed.color)
              && same(item.size,seed.size))
            if(alreadyInDraft)return current
            return {
              ...current,
              items:[
                ...current.items.filter(item=>item.variantId||item.productName),
                {productId:String(seed.productId),variantId:'',draftKey,createMissingVariant:true,
                 productName:seed.productName,category:seed.category,gender:seed.gender,
                 material:seed.material,length:seed.length,color:seed.color,size:seed.size,
                 quantity:seed.quantity,expectedQuantity:0,touched:true}
              ],
            }
          })
        }, inventoryMovementError, clearInventoryMovementError: () => setInventoryMovementError(''), onInlineArrivalVariant: (seed: { productId: number | string; productName: string; category: 'adult' | 'child'; gender: string; material: string; length: string; color: string; size: string; quantity: number }) => {
          setInventoryArrivalPositions((current) => [
            ...current.filter(position => Boolean(position.productName) ||
              position.sizes.some(line => Boolean(line.color || line.size))),
            createEmptyArrivalPosition({
              productId: String(seed.productId || ''),
              productName: seed.productName,
              category: seed.category,
              gender: seed.gender,
              material: seed.material,
              length: seed.length,
              sizes: [{ id: inventoryUiId('size'), color: seed.color, size: seed.size, quantity: seed.quantity }],
            }),
          ])
        }, activeSector, addInventoryMatrixColor, addInventoryMatrixSize, applyPendingInventoryWriteoffs, buildInventoryMatrix, catalogCategoryFilter, catalogOnlyWithoutVariants, setCatalogOnlyWithoutVariants, catalogData, catalogReview, catalogReviewBusy, catalogIssueStats, catalogProductDraft, catalogProductStockSummary, catalogVariantDraft, catalogVariantsByProductId, ChoicePills, clearInventoryMatrixValues, createEmptyInventoryItem, createEmptyInventoryMatrixDraft, expandedCatalogProducts, filteredInventoryRows, formatMoney, FriendlyNumberInput, filteredReferenceItems, formatDateShort, getCatalogProductEffectiveCategory, getCatalogVariantCategory, getInventoryRowCategory, getStockQuantityForVariant, groupedInventoryRows, handleInventoryMatrixKeyDown, inventoryArrivalProductChoices, inventoryArrivalPositions, inventoryArrivalSummary, inventoryArrivalVariantOpen, inventoryArrivalReadyVariants, selectInventoryArrivalVariant, selectInventoryArrivalProduct, updateInventoryArrivalPosition, addInventoryArrivalSize, updateInventoryArrivalSize, removeInventoryArrivalSize, addInventoryArrivalPosition, removeInventoryArrivalPosition, resetInventoryArrivalForm, setInventoryArrivalVariantOpen, inventoryAudit, inventoryAuditBusy, resolveInventoryAuditIssue, inventoryCategoryFilter, inventoryControlBusy, inventoryControlSettings, inventoryMovementBusy, inventoryDraft, inventoryDraftSummary, inventoryHistoryRows, inventoryMatrix, inventoryMatrixActiveGroupKey, inventoryMatrixAxisLabel, inventoryMatrixBatchGroups, inventoryMatrixCellKey, inventoryMatrixCellMap, inventoryMatrixColors, inventoryMatrixColorToAdd, inventoryMatrixDraftItem, inventoryMatrixSizes, inventoryMatrixSizeToAdd, inventoryMatrixSummary, inventoryModelVersion, inventoryMovementText, matchedInventoryOperationVariant, activeInventoryOperationItem, selectedInventoryOperationItems, inventoryOperationAllProductGroups, inventoryOperationProductGroups, inventoryOperationSearch, inventoryOperationVariant, inventoryOperationActiveVariantId, inventoryExistingVariantOpen, inventoryExistingVariantSearch, inventoryExistingVariantRows, inventoryPanel, inventoryPanelStyle, inventoryPickerOptions, inventoryProblemRows, inventoryQuery, inventoryQuickFilters, inventorySortMode, inventorySourceRows, inventorySnapshotLoadErrors, inventoryStats, inventoryStocktakeAllGroups, inventoryStocktakeGroups, inventoryStocktakeStats, printInventoryStocktakePdf, applyInventoryStocktakeChanges, inventoryStatusFilter, isAdmin: canManageWarehouse, isFinanceAdmin: isAdmin, latestManualMovements, latestReturnExchangeMovements, latestSaleMovements, loadCatalogData, loadCatalogReview, reconcileCatalogReview, loadCatalogReviewContext, resolveCatalogReviewFacts, excludeCatalogReviewItem, inventoryLifecycle, inventoryLifecycleBusy, warehouseAttention, loadInventoryLifecycle, loadInventoryLifecycleContext, resolveInventoryLifecycleFacts, reconcileKnownInventoryLifecycle, reconcileFoundInventoryStock, loadWarehouseAttention, loadInventoryAudit, loadInventoryData, loadInventoryHistory, loadInventoryCheckHistory, loadInventoryReservations, loadInventoryStocktakeSessions, loadInventoryStocktakeSession, createInventoryStocktakeSession, saveInventoryStocktakeCount, addInventoryStocktakeVariant, addInventoryStocktakeCombination, loadInventoryCycleCounts, applyInventoryCycleCounts, quickInventoryStocktake, quickInventoryStocktakeBatch, completeInventoryStocktakeSession, cancelInventoryStocktakeSession, loadReferenceItems, loadReferencesData, references, normalizeSuggestion, openInventoryPanel, openOrderFromFinance, openOrderStockHandoverById, operationVariantOptions, inventoryProductReferenceGroups, inventoryWriteoffReferenceGroups, referenceBusy, referenceDraft, referenceItems, referenceKind, referenceSearch, referenceStatusFilter, removeReferenceEntry, resolveCatalogReviewItem, resetReferenceDraft, saveReferenceEntry, selectedReferenceKindConfig, selectReferenceKind, setReferenceDraft, setReferenceSearch, setReferenceStatusFilter, productCategoryLabel, productHasVariantCategory, refreshInventoryModule, renderInventoryStockGroups, resetInventoryOperationSelection, removeInventoryVariantOperationItem, reverseInventoryMovement, reversingInventoryMovementId, saveCatalogProduct, saveCatalogVariant, saveInventoryMovement, sectorStyle, startNextInventoryMatrixProduct, openInventoryMatrixBatchGroup, removeInventoryMatrixBatchGroup, selectedCatalogProduct, selectedInventoryOperationGroup, selectInventoryOperationVariant, setCatalogCategoryFilter, setCatalogProductDraft, setCatalogVariantDraft, setExpandedCatalogProducts, setInventoryCategoryFilter, setInventoryDraft, setInventoryMatrix, setInventoryMatrixCell, setInventoryMatrixColorToAdd, setInventoryMatrixSizeToAdd, setInventoryExistingVariantOpen, setInventoryExistingVariantSearch, setInventoryQuery, setInventoryQuickFilters, setInventorySortMode, setInventoryStatusFilter, setInventoryVariantOperationQuantity, SmartPickerInput, sourceLabel, suggestionValues, arrivalSuggestionValues, toggleInventoryAutoWriteoff, updateInventoryMatrixCategory, updateInventoryMatrixGender, updateInventoryMatrixLength, updateInventoryMatrixMaterial, updateInventoryMatrixProductInput, updateInventoryDirectProductInput, updateInventoryOperationVariantField, visibleCatalogProducts }} />
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
        <WorkshopSection ctx={{ askActionConfirmation, askActionTextPrompt, activeWorkshopTasks, applyWorkshopPeriodPreset, copyWorkshopInvoiceText, downloadWorkshopInvoicePdf, exportWorkshopInvoiceWord, formatDateShort, getPeriodRange, getWorkshopInvoiceDeadlineLabel, getWorkshopInvoiceImportanceLabel, isAdmin, markWorkshopTaskDone, openWorkshopExchange, openWorkshopOrderEditor, openWorkshopCatalogPrice, printWorkshopInvoice, restoreWorkshopTaskActive, sectorStyle, setWorkshopFilters, setWorkshopInvoiceMode, setWorkshopSortDirection, workshopBusy, workshopCustomerIdentity, workshopData, workshopDetailRows, workshopFilters, workshopInvoiceIsKaspi, workshopInvoiceMode, workshopInvoiceRows, workshopScopeTasks, workshopSortDirection }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders'} label="Заказы">
        <OrdersHeaderSection ctx={{ orderPanel, orderPanelOptions, returnHistorySummary, exchangeHistorySummary, sectorStyle, setEditorOpen, setOrderPanel }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'list'} label="Заказы">
        <OrderFiltersSection ctx={{ applyOrderPeriodPreset, busy, ChoicePills, filters, ManagerPicker, orderPanelStyle, orderPeriodPreset, references, resetOrderFilters, sectorStyle, setFilters }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'create'} label="Создание заказа">
        <CreateOrderSection ctx={{ addCreateItem, addCreatePayment, applyCreateProductPick, ChoicePills, createDraft, createOrderFromDraft, createPricing, createTotals, resetCreateOrderDraft, formatMoney, formatOrderItemDetails, formatOrderItemTitle, FriendlyNumberInput, ManagerPicker, normalizeAudienceTypeValue, normalizeSuggestion, orderBusy, orderPanelStyle, references, removeCreateItem, removeCreatePayment, renderOrderSizeSelect, renderOrderSourceAvailability, sectorStyle, setCreateDraft, setOrderPanel, SmartPickerInput, sourceLabel, suggestionValues, updateCreateDraft, updateCreateItem, updateCreatePayment }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'edit'} label="Редактирование заказа">
        <OrderEditorSection ctx={{ addEditorItem, addEditorPayment, applyEditorProductPick, ChoicePills, closeOrderEditor, createEditorDraft, editorDraft, editorFormRef, editorOpen, editorReturnSector, formatMoney, formatOrderItemTitle, FriendlyNumberInput, isAdmin, isArchivedOrderRecord, ManagerPicker, normalizeAudienceTypeValue, normalizeSuggestion, orderPanelStyle, references, removeEditorItem, removeEditorPayment, renderOrderSizeSelect, renderOrderSourceAvailability, saveEditorPayment, saveSelectedOrder, savingOrder, sectorStyle, selectedOrder, setEditorDraft, SmartPickerInput, sourceLabel, suggestionValues, updateEditorDraft, updateEditorItem, updateEditorPayment }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'list'} label="Список заказов">
        <OrdersTableSection ctx={{ correctMistakenOrderShipping, correctOrderMetadata, correctRecordedOrderItemPrice, correctRecordedOrderItemPrices, loadRetiredExchangePriceOptions, correctRecordedPaymentMethod, correctRetiredExchangePrice, loadExchangeCancellationPreview, loadOrderExchangeCancellationPlan, cancelOrderExchangeChain, loadOrderReturnCancellationChoices, cancelOrderReturnChoice, loadAdminOrderDeletePreview, deleteOrderAsAdmin, executeAdminDeleteChain, confirmAdminDeletePhysicalBeforeChain, expandedOrderItemCounts, expandOrderItems, filters, formatDateShort, formatMoney, handleEditOrder, handleOpenDebt, handleOpenExchange, handleOpenReturn, isAdmin, ManagerBadge, markOrderSentToClient, apiFetch, askActionConfirmation, askStockResolution,
        onShipmentChange: async () => { invalidateInventoryStockCaches(true); return (await loadDashboard(false)) != null },
        setMessage, openOrderStockHandover, normalizeSuggestion, ordinaryOrdersSeparated: true, orderFinanceBusy: ordersFinanceBusy, orderFinanceReport: ordersFinanceReport, orderPanelStyle, orders, restoreArchivedOrder, savingOrder, sectorStyle, selectedOrderId, setExpandedOrderItemCounts, shippingStatusLabel, suggestionValues, busy, changeOrderPage, orderPageInfo, summarizeOrderItemLines, summarizeOrderPaymentLines, summary, waitingDaysLabel }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'list'} label="Детали заказа">
        <OrderDetailsSection ctx={{ formatDateShort, formatMoney, formatOrderItemTitle, handleEditOrder, isAdmin, orderPanelStyle, restoreArchivedOrder, savingOrder, sectorStyle, selectedOrder, sourceLabel }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'debt'} label="Закрытие долга">
        <OrderDebtSection ctx={{ addDebtPayment, closeDebtForm, createDebtClosePayment, debtBusy, debtCloseHistory, debtFilters, debtFormRef, debtLoadBusy, debtOrders, debtOverview, loadAllOpenDebtOrders, debtOverpayAmount, debtPayments, debtPaymentTotal, debtRemainingAmount, debtSelectedOrder, formatLocalDateInput, formatMoney, FriendlyNumberInput, handleSelectDebtOrder, ManagerBadge, managerColorFor, orderPanelStyle, removeDebtPayment, saveDebtClose, sectorStyle, setDebtFilters, setDebtPayments, SmartPickerInput, suggestionValues, summarizeOrderItemLines, updateDebtPayment }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'returns'} label="Возврат">
        <OrderReturnsSection ctx={{ cancelReturnEntry, closeReturnForm, createReturnDraft, formatMoney, FriendlyNumberInput, handleEditOrder, isAdmin, loadReturnHistory, ManagerBadge, managerColorFor, orderPanelStyle, receiveReturnedItemAction, reconcileKnownInventoryLifecycle, returnBusy, returnDraft, returnFormRef, returnHistory, returnHistoryBusy, returnHistoryError, returnHistoryFilters, returnHistoryHasMore, returnHistorySummary, returnPendingInbox, loadReturnPendingInbox, returnSelectedOrder, saveReturn, sectorStyle, setOrderPanel, setReturnDraft, setReturnHistoryFilters, SmartPickerInput, suggestionValues }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'exchange'} label="Обмен">
        <OrderExchangeSection ctx={{ addExchangeSetNewItem, applyExchangeItemPatch, applyExchangeProductPick, applyExchangeSetNewItemPatch, applyExchangeSetNewProductPick, cancelExchangeEntry, closeExchangeForm, correctExchangeFinancialEntry, createExchangeDraft, exchangeBusy, exchangeDraft, exchangeFormRef, exchangeHistory, exchangeHistoryBusy, exchangeHistoryError, exchangeHistoryFilters, exchangeHistoryHasMore, exchangeHistorySummary, exchangePendingInbox, loadExchangePendingInbox, exchangeSelectedOrder, formatMoney, FriendlyNumberInput, getOrderSourceAvailability, isAdmin, loadExchangeHistory, ManagerBadge, managerColorFor, orderPanelStyle, receiveReturnedItemAction, reconcileKnownInventoryLifecycle, removeExchangeSetNewItem, saveExchange, sectorStyle, setExchangeDraft, setExchangeHistoryFilters, setOrderPanel, SmartPickerInput, sourceLabel, suggestionValues }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'team'} label="Команда">
        <TeamSection ctx={{ apiFetch, askActionConfirmation, authUser, authUsers, authUsersBusy, exportTeamPlanReportWord, formatDateShort, formatLocalDateInput, formatMoney, formatPercent, getTimesheetCalendarSlots, getTimesheetEntriesForDate, getTimesheetWeekdayLabel, isAdmin, loadPlans, loadTeamActivityReport, loadTeamSalaryReport, loadTeamTimesheet, MANAGER_COLOR_OPTIONS, ManagerBadge, loadAuthUsers, planBusy, planFilters, planReport, printTeamPlanReportPdf, removeTeamEmployee, resolveManagerDisplayColor, readJsonResponse, saveTeamEmployee, saveTeamEmployeeColor, saveTeamTimesheet, sectorStyle, setError, setMessage, setPlanFilters, setTeamActivityFilters, setTeamColorEditorId, setTeamDraft, setTeamEmployeeEmploymentStatus, setTeamFormOpen, setTeamMode, setTeamRosterView, setTeamSalaryFilters, setTimesheetComment, setTimesheetCurrentMonth, setTimesheetDaysPreset, setTimesheetMonth, setTimesheetSelectedDays, setTimesheetSelectedManagers, setTimesheetWorkUntil, shiftTimesheetMonth, teamActivityBusy, teamActivityFilters, teamActivityLoadFailed, teamActivityReport, teamBusy, teamColorEditorId, teamDraft, teamEmployees, teamFormOpen, teamMode, teamRosterView, teamSalaryFilters, teamSalaryReport, timesheetBusy, timesheetComment, timesheetData, timesheetMonth, timesheetSelectedDays, timesheetSelectedManagers, timesheetWorkUntil, toggleTimesheetDay, toggleTimesheetManager }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'leads'} label="Лиды">
        <LeadsSection ctx={{ isAdmin, callCentreDraft, callCentreRecords, deleteCallCentreRecord, deleteLeadRecord, editCallCentreRecord, editLeadRecord, formatDateShort, formatLocalDateInput, formatPercent, FriendlyNumberInput, getPeriodRange, leadBusy, leadDraft, leadFilters, leadMode, leadRecords, loadCallCentreRecords, loadLeadRecords, ManagerBadge, ManagerPicker, references, saveCallCentreRecord, saveLeadRecord, sectorStyle, setCallCentreDraft, setLeadDraft, setLeadFilters, setLeadMode }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'plan'} label="План">
        <PlanSection ctx={{ apiFetch, askActionConfirmation, currentManagerId: authUser?.managerId || 0, deleteDepartmentPlan, deleteManagerPlan, departmentPlanDraft, editDepartmentPlan, editManagerPlan, exportPlanReportWord, formatDateShort, formatMoney, formatPercent, FriendlyNumberInput, isAdmin, loadPlans, ManagerBadge, ManagerPicker, managerPlanDraft, planBusy, planFilters, planReport, printPlanReportPdf, references, saveDepartmentPlan, saveManagerPlan, sectorStyle, setDepartmentPlanDraft, setManagerPlanDraft, setPlanFilters }} />
        </DeferredSection>
        <DeferredSection active={activeSector === 'finance'} label="Финансы">
        <FinanceSection ctx={{ apiFetch, active: activeSector === 'finance' && authReady, accessRole, financeMode, financeReportBusy, financeReportFilters, getPeriodRange, sectorStyle, setFinanceReportFilters, financeDashboardCtx: { apiFetch, cashMovementDraft, cashRegister, cashRegisterBusy, cashRegisterCycles, cashRegisterCyclesBusy, cashRegisterCyclesHasMore, cashRegisterCyclesOpen, cashSetupAmount, cashReconcileAmount, cashReconcileComment, financeMethodDraft, financeMethodsBusy, financeMode, financePaymentMethods, financeReport, financeReportBusy, moneyHistory, moneyHistoryBusy, moneyHistoryError, moneyHistoryHasMore, moneyHistoryQuery, moneyHistorySummary, moneyHistoryType, loadMoneyHistory, setMoneyHistoryQuery, setMoneyHistoryType, reloadFinanceReports, formatDateShort, formatMoney, formatPercent, FriendlyNumberInput, isAdmin, loadCashRegister, loadCashRegisterCycles, loadFinancePaymentMethods, ManagerBadge, managerColorFor, normalizeSuggestion, openOrderFromFinance, removeFinancePaymentMethod, saveCashRegisterMovement, saveFinancePaymentMethod, setCashMovementDraft, setCashRegisterCyclesOpen, setCashSetupAmount, setCashReconcileAmount, setCashReconcileComment, setupCashRegister, activateCashRegister, setCashAutoTracking, reconcileCashRegister, reverseCashRegisterMovement, resetCashRegisterCycle, setFinanceMethodDraft, setFinanceMode } }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'reports'} label="Отчёты">
        <ReportsSection ctx={{ financeReportBusy, financeReportFilters, financeReportOptions, financeReportType, getPeriodRange, reloadFinanceReports, sectorStyle, setFinanceReportFilters, setFinanceReportType, financeReportContentCtx: { apiFetch, openOrderFromFinance, exportSelectedFinanceReportWord, financeReport, financeReportOptions, financeReportType, formatDateShort, formatMoney, formatPercent, ManagerBadge, managerColorFor, printSelectedFinanceReportPdf } }} />
        </DeferredSection>

        <DeferredSection active={activeSector === 'orders' && orderPanel === 'activity'} label="Журнал действий">
        <OrderActivitySection ctx={{ activityBusy, activityFilters, activityLog, formatDateShort, formatMoney, loadActivityLog, ManagerBadge, managerColorFor, orderPanelStyle, sectorStyle, setActivityFilters }} />
        </DeferredSection>
      </div>
      {archiveModalOpen ? (
        <ArchiveMonthModal
          archiveDraft={archiveDraft}
          archivePreview={archivePreview}
          archiveBusy={archiveBusy}
          setArchiveDraft={setArchiveDraft}
          setArchivePreview={setArchivePreview}
          setArchiveModalOpen={setArchiveModalOpen}
          loadArchivePreview={loadArchivePreview}
          runArchiveOrders={runArchiveOrders}
        />
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
