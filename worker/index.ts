// Step 190.6A: Worker composition root. Domain logic lives under worker/core and worker/domains.
import { json, measuredJsonRead, measuredResponseRead, publicApiError, readJson } from './core/http.ts'
import { cleanText, normalizeDate, normalizeOrderStatus, normalizeShippingStatus, normalizeSourceType, toInt, upperText } from './core/text.ts'
import type { AuthUser, Env, InventoryItemInput, OrderInput, ReferenceKind } from './core/types.ts'
import { listActivityLog, listOrdersFinanceSummary, listReturnHistory, writeActivityLog } from './domains/activity.ts'
import { authUserPayload, createAuthUser, deleteAuthUser, ensureAuthSchema, handleAuthChangePassword, handleAuthLogin, handleAuthLogout, handleAuthSetup, handleAuthStatus, handleSimpleAdminLogin, handleSimpleAdminLogout, handleSimpleAdminPasswordChange, handleSimpleAdminStatus, isDiagnosticsEnabled, listAuthUsers, makeSimpleAccessUser, normalizeAccessRole, publicAuthPath, requireAdminAccess, requireAdminUser, updateAuthUser, withAuthenticatedHeaders } from './domains/auth.ts'
import { activateCashRegister, addManualCashRegisterMovement, getCashRegisterState, listCashRegisterCycles, listFinancialHistory, reconcileCashRegister, resetCashRegisterCycle, reverseManualCashRegisterMovement, setCashAutoTracking, setupCashRegister } from './domains/cash.ts'
import { createCatalogProduct, createCatalogVariant, isHumanInventoryModelEnabled, listCatalog, updateCatalogProduct, updateCatalogVariant } from './domains/catalog.ts'
import type { CatalogReviewFactsInput } from './domains/catalog-review.ts'
import { excludeCatalogReviewQueueItem, getCatalogReviewContext, listCatalogReviewQueue, reconcileCatalogReviewQueue, resolveCatalogReviewFacts, resolveCatalogReviewQueueItem } from './domains/catalog-review.ts'
import { getClientDetails, listClients } from './domains/clients.ts'
import { criticalOperationErrorResponse } from './domains/critical.ts'
import { listFinanceReports } from './domains/finance-reports.ts'
import { applyInventoryMovement, applyInventoryTransfer, applyPendingInventoryWriteoffs, getInventoryControlSettings, reverseInventoryMovementOperation, updateInventoryControlSettings } from './domains/inventory-movement.ts'
import { getDashboardInsights, getInventoryHardAudit, listInventory, setInventoryAuditResolution } from './domains/inventory-read.ts'
import { listInventoryReservations } from './domains/inventory-reservations.ts'
import { addInventoryStocktakeCombination, addInventoryStocktakeVariant, cancelInventoryStocktakeSession, completeInventoryStocktakeSession, createInventoryStocktakeSession, listInventoryCheckHistory, listInventoryCycleCountSuggestions, listInventoryHistory, listInventoryStocktakeSessions, quickInventoryStocktake, quickInventoryStocktakeBatch, saveInventoryStocktakeCount, serializeInventoryStocktakeSession } from './domains/inventory-stocktake.ts'
import { getInventoryLifecycleContext, listInventoryLifecyclePending, reconcileKnownPendingInventoryInbound, resolveInventoryLifecycleFacts } from './domains/lifecycle.ts'
import { createManualOrderPaymentCritical } from './domains/money.ts'
import { OrderInputValidationError } from './domains/order-core.ts'
import { activeStocktakeSessionForHandover, confirmItemStillHere, fulfillOrderReservationsV2, getOrderShipmentInventoryBlockers, getOrderStockHandoverState, normalizeShipmentObservations, OrderStockShortageError, orderHandoverReviewBlockers, orderShipmentInventoryBlockerMessage, orderWorkshopPendingForShipping, reconcileIssuedBeforeCheckpoint } from './domains/order-reservations.ts'
import type { ArchiveRuleInput } from './domains/orders-read.ts'
import { archiveOrders, getArchivePreview, listOpenDebtOrders, listOrders, restoreArchivedOrder } from './domains/orders-read.ts'
import { createOrder, getOrder, updateOrderCritical } from './domains/orders-write.ts'
import { createReferenceValue, deleteReferenceValue, getReferenceData, getReferenceValueCounts, listReferenceValues, normalizeReferenceKind, updateReferenceValue } from './domains/references.ts'
import { cancelExchange, cancelReturn, createExchange, createReturn, listExchanges } from './domains/returns-exchanges.ts'
import { continueDatabaseStorageCleanup, getDatabaseStorageStatus, startDatabaseStorageCleanup, updateDatabaseStorageCapacity } from './domains/storage.ts'
import type { CallCentreInput, DepartmentPlanInput, EmployeeInput, LeadInput, PlanInput, TimesheetInput } from './domains/team.ts'
import { deleteCallCentreRecord, deleteDepartmentPlanRecord, deleteLeadRecord, deleteManagerPlanRecord, deleteTeamEmployee, listCallCentreRecords, listLeadRecords, listPlans, listTeamActivity, listTeamEmployees, listTeamSalaryPreview, listTeamTimesheet, saveCallCentreRecord, saveDepartmentPlan, saveLeadRecord, saveManagerPlan, saveTeamEmployee, saveTeamTimesheet, setTeamEmployeeActive } from './domains/team.ts'
import { bulkUpdateWorkshopTasks, listWorkshopTasks, readWorkshopCounts, updateWorkshopTask } from './domains/workshop.ts'
import { ensureOrderItemWorkshopColumn } from './domains/workshop-schema.ts'
import { getWarehouseAttentionSummary } from './domains/warehouse-attention.ts'

// Step 78 keeps old account-auth handlers only as a dormant compatibility fallback.
// The live application now uses the simple admin mode and does not call them.
void ensureAuthSchema;
void handleAuthStatus;
void handleAuthSetup;
void handleAuthLogin;
void handleAuthLogout;



export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      await ensureOrderItemWorkshopColumn(env.DB);

      if (url.pathname === '/api/admin-mode/status' && request.method === 'GET') {
        return handleSimpleAdminStatus(env, request);
      }

      if (url.pathname === '/api/admin-mode/login' && request.method === 'POST') {
        return handleSimpleAdminLogin(env.DB, env, request);
      }

      if (url.pathname === '/api/admin-mode/logout' && request.method === 'POST') {
        return handleSimpleAdminLogout(request);
      }

      if (url.pathname === '/api/auth/status' && request.method === 'GET') {
        return json({ ok: true, hasUsers: false, authDisabled: true, user: null });
      }

      if (url.pathname === '/api/auth/setup' && request.method === 'POST') {
        return json({ ok: false, message: 'Авторизация аккаунтами отключена. Используйте простой админ-режим.' }, { status: 410 });
      }

      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return json({ ok: false, message: 'Авторизация аккаунтами отключена. Используйте простой админ-режим.' }, { status: 410 });
      }

      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        return handleSimpleAdminLogout(request);
      }

      let authUser: AuthUser | null = null;
      if (url.pathname.startsWith('/api/') && !publicAuthPath(url.pathname)) {
        authUser = await makeSimpleAccessUser(request, env);
        request = withAuthenticatedHeaders(request, authUser) as any;
      }

      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        return json({ ok: true, user: authUser ? authUserPayload(authUser) : null });
      }

      if (url.pathname === '/api/admin-mode/change-password' && request.method === 'POST') {
        const denied = requireAdminUser(authUser);
        if (denied) return denied;
        return handleSimpleAdminPasswordChange(env.DB, env, request);
      }

      if (url.pathname === '/api/admin/storage' && request.method === 'GET') {
        const denied = requireAdminUser(authUser, 'Хранилище базы доступно только администратору.');
        if (denied) return denied;
        return json(await getDatabaseStorageStatus(env.DB, url.searchParams.get('months') === '1'));
      }

      if (url.pathname === '/api/admin/storage/capacity' && request.method === 'POST') {
        const denied = requireAdminUser(authUser, 'Настройка хранилища доступна только администратору.');
        if (denied) return denied;
        return updateDatabaseStorageCapacity(env.DB, env, request);
      }

      if (url.pathname === '/api/admin/storage/cleanup/start' && request.method === 'POST') {
        const denied = requireAdminUser(authUser, 'Удаление старых данных доступно только администратору.');
        if (denied) return denied;
        return startDatabaseStorageCleanup(env.DB, env, request);
      }

      if (url.pathname === '/api/admin/storage/cleanup/continue' && request.method === 'POST') {
        const denied = requireAdminUser(authUser, 'Удаление старых данных доступно только администратору.');
        if (denied) return denied;
        return continueDatabaseStorageCleanup(env.DB, request);
      }

      if (url.pathname === '/api/auth/change-password' && request.method === 'POST') {
        return handleAuthChangePassword(env.DB, request, authUser as AuthUser);
      }

      if (url.pathname === '/api/auth/users' && request.method === 'GET') {
        const denied = requireAdminUser(authUser);
        if (denied) return denied;
        return json(await listAuthUsers(env.DB));
      }

      if (url.pathname === '/api/auth/users' && request.method === 'POST') {
        const denied = requireAdminUser(authUser);
        if (denied) return denied;
        return createAuthUser(env.DB, request);
      }

      const authUserMatch = url.pathname.match(/^\/api\/auth\/users\/(\d+)$/);
      if (authUserMatch && request.method === 'PATCH') {
        const denied = requireAdminUser(authUser);
        if (denied) return denied;
        return updateAuthUser(env.DB, toInt(authUserMatch[1], 0), request, authUser as AuthUser);
      }

      if (authUserMatch && request.method === 'DELETE') {
        const denied = requireAdminUser(authUser);
        if (denied) return denied;
        return deleteAuthUser(env.DB, toInt(authUserMatch[1], 0), authUser as AuthUser);
      }

      if (url.pathname === '/api/health') {
        return json({
          ok: true,
          service: 'orders-app',
          warehouseCatalogFilter: '188k2-post-stocktake',
          catalogFullRetirementUiHide: '188k2',
          safeEarlyHandover: '188k3-v5',
          delayedOrderHandoverReview: '188k3-v5',
          catalogReviewOperationalQueue: '189a2',
          storageCleanupSafety: '189a2',
          businessHistoryVisibility: '189b',
          reliableMoneyHistory: '189c',
          teamActivityCleanup: '189d1',
          preAuditStability: '189d1',
          teamActivityQueryPlan: 'split-selects-r2',
          criticalOperationReliability: '1901',
        cloudflareBulkLimits: '1902',
          readPathSafety: '1903',
          storageDatabaseHygiene: '1904',
          uiSmallScreenAcceptance: '1905',
          structuralModularization: '1906a',
          frontendControllerModularization: '1906b',
          deadLegacyCleanup: '1906c',
          bundleLazyLoading: '1906d',
          typeApiBoundaryCleanup: '1906e',
          transferRuntimeSafety: '191d',
          runtimeLimitsAtomicity: '191e',
          adminSessionIntegrity: '191f',
          warehouseTruthFreshness: '192a1',
          catalogTruthFinalizer: '192a2',
          warehouseAttentionTruthGates: '192b1',
          warehouseDailyAttentionUx: '192b2a',
          warehouseAttentionContextFix: '192b2a2',
          orderCreateSaveIntegrity: '192b2a4',
          time: new Date().toISOString(),
        });
      }

      if (url.pathname === '/api/d1-check') {
        const denied = requireAdminUser(authUser, 'Диагностика базы доступна только администратору.');
        if (denied) return denied;
        if (!isDiagnosticsEnabled(env)) {
          return json({ ok: false, message: 'Диагностика базы закрыта в рабочей версии. Для аварийной проверки включите DIAGNOSTICS_ENABLED=true.' }, { status: 403 });
        }
        const result = await env.DB.prepare('SELECT 1 AS ok, datetime(\'now\') AS now').first<{ ok: number; now: string }>();
        return json({
          ok: true,
          database: 'orders_db',
          result,
        });
      }

      if (url.pathname === '/api/dashboard' && request.method === 'GET') {
        return json(await getDashboardInsights(env.DB));
      }

      if (url.pathname === '/api/reference-data' && request.method === 'GET') {
        return json(await getReferenceData(env.DB));
      }

      if (url.pathname === '/api/reference-values/counts' && request.method === 'GET') {
        const requested = cleanText(url.searchParams.get('kinds'))
          .split(',')
          .map(value => normalizeReferenceKind(value))
          .filter((value): value is ReferenceKind => Boolean(value));
        return json(await getReferenceValueCounts(env.DB, requested));
      }

      if (url.pathname === '/api/reference-values' && request.method === 'GET') {
        const kind = normalizeReferenceKind(url.searchParams.get('kind'));
        if (!kind) {
          return json({ ok: false, message: 'Unknown reference kind.' }, { status: 400 });
        }
        return json(await listReferenceValues(env.DB, kind));
      }

      if (url.pathname === '/api/reference-values' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return await createReferenceValue(env.DB, request);
      }

      const referenceMatch = url.pathname.match(/^\/api\/reference-values\/(\d+)$/);
      if (referenceMatch && request.method === 'PATCH') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return await updateReferenceValue(env.DB, toInt(referenceMatch[1], 0), request);
      }

      if (referenceMatch && request.method === 'DELETE') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return await deleteReferenceValue(env.DB, toInt(referenceMatch[1], 0), request);
      }


      if (url.pathname === '/api/reports/orders-summary' && request.method === 'GET') {
        return json(await listOrdersFinanceSummary(env.DB, url));
      }

      if (url.pathname === '/api/reports/finance' && request.method === 'GET') {
        return json(await listFinanceReports(env.DB, url));
      }

      if (url.pathname === '/api/finance/money-history' && request.method === 'GET') {
        return json(await listFinancialHistory(env.DB, url));
      }

      if (url.pathname === '/api/finance/cash-register' && request.method === 'GET') {
        return json(await getCashRegisterState(env.DB));
      }

      if (url.pathname === '/api/finance/cash-register/cycles' && request.method === 'GET') {
        return measuredJsonRead('cash.cycles', () => listCashRegisterCycles(env.DB, url));
      }

      if (url.pathname === '/api/finance/cash-register/setup' && request.method === 'POST') {
        const input = await readJson<{ amount?: number }>(request);
        return json(await setupCashRegister(env.DB, input, authUser));
      }

      if (url.pathname === '/api/finance/cash-register/activate' && request.method === 'POST') {
        return json(await activateCashRegister(env.DB, authUser));
      }

      if (url.pathname === '/api/finance/cash-register/auto-tracking' && request.method === 'POST') {
        const input = await readJson<{ enabled?: boolean }>(request);
        return json(await setCashAutoTracking(env.DB, Boolean(input.enabled), authUser));
      }

      if (url.pathname === '/api/finance/cash-register/movements' && request.method === 'POST') {
        const input = await readJson<{ direction?: unknown; amount?: number; comment?: string; requestId?: unknown }>(request);
        return json(await addManualCashRegisterMovement(env.DB, input, authUser), { status: 201 });
      }

      const cashMovementReverseMatch = url.pathname.match(/^\/api\/finance\/cash-register\/movements\/(\d+)\/reverse$/);
      if (cashMovementReverseMatch && request.method === 'POST') {
        return json(await reverseManualCashRegisterMovement(env.DB, toInt(cashMovementReverseMatch[1], 0), authUser));
      }

      if (url.pathname === '/api/finance/cash-register/reconcile' && request.method === 'POST') {
        const input = await readJson<{ amount?: number; comment?: string; requestId?: unknown }>(request);
        return json(await reconcileCashRegister(env.DB, input, authUser));
      }

      if (url.pathname === '/api/finance/cash-register/reset-cycle' && request.method === 'POST') {
        const denied = requireAdminUser(authUser);
        if (denied) return denied;
        const input = await readJson<{ comment?: string }>(request);
        return json(await resetCashRegisterCycle(env.DB, input, authUser));
      }

      if (url.pathname === '/api/team' && request.method === 'GET') {
        return json(await listTeamEmployees(env.DB));
      }

      if (url.pathname === '/api/team/employees' && request.method === 'POST') {
        const denied = requireAdminUser(authUser);
        if (denied) return denied;
        const input = await readJson<EmployeeInput>(request);
        return json(await saveTeamEmployee(env.DB, input), { status: 201 });
      }

      const teamEmployeeMatch = url.pathname.match(/^\/api\/team\/employees\/(\d+)$/);
      const teamEmployeeStatusMatch = url.pathname.match(/^\/api\/team\/employees\/(\d+)\/status$/);
      if (teamEmployeeStatusMatch && request.method === 'PATCH') {
        const denied = requireAdminUser(authUser);
        if (denied) return denied;
        const input = await readJson<{ isActive?: unknown }>(request);
        return await setTeamEmployeeActive(env.DB, toInt(teamEmployeeStatusMatch[1], 0), input.isActive);
      }

      if (teamEmployeeMatch && request.method === 'DELETE') {
        const denied = requireAdminUser(authUser);
        if (denied) return denied;
        return await deleteTeamEmployee(env.DB, toInt(teamEmployeeMatch[1], 0));
      }

      if (url.pathname === '/api/leads' && request.method === 'GET') {
        return json(await listLeadRecords(env.DB, url));
      }

      if (url.pathname === '/api/leads' && request.method === 'POST') {
        const input = await readJson<LeadInput>(request);
        return json(await saveLeadRecord(env.DB, input), { status: 201 });
      }

      const leadMatch = url.pathname.match(/^\/api\/leads\/(\d+)$/);
      if (leadMatch && request.method === 'DELETE') {
        const denied = requireAdminUser(authUser, 'Удаление лидов доступно только администратору.');
        if (denied) return denied;
        return json(await deleteLeadRecord(env.DB, toInt(leadMatch[1], 0)));
      }

      if (url.pathname === '/api/call-centre' && request.method === 'GET') {
        return json(await listCallCentreRecords(env.DB, url));
      }

      if (url.pathname === '/api/call-centre' && request.method === 'POST') {
        const input = await readJson<CallCentreInput>(request);
        return json(await saveCallCentreRecord(env.DB, input), { status: 201 });
      }

      const callCentreMatch = url.pathname.match(/^\/api\/call-centre\/(\d+)$/);
      if (callCentreMatch && request.method === 'DELETE') {
        const denied = requireAdminUser(authUser, 'Удаление записей Call Centre доступно только администратору.');
        if (denied) return denied;
        return json(await deleteCallCentreRecord(env.DB, toInt(callCentreMatch[1], 0)));
      }

      if (url.pathname === '/api/plans' && request.method === 'GET') {
        return json(await listPlans(env.DB, url));
      }

      if (url.pathname === '/api/plans' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<PlanInput>(request);
        return json(await saveManagerPlan(env.DB, input), { status: 201 });
      }

      const planMatch = url.pathname.match(/^\/api\/plans\/(\d+)$/);
      if (planMatch && request.method === 'DELETE') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json(await deleteManagerPlanRecord(env.DB, toInt(planMatch[1], 0)));
      }

      if (url.pathname === '/api/department-plans' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<DepartmentPlanInput>(request);
        return json(await saveDepartmentPlan(env.DB, input), { status: 201 });
      }

      const departmentPlanMatch = url.pathname.match(/^\/api\/department-plans\/(\d+)$/);
      if (departmentPlanMatch && request.method === 'DELETE') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json(await deleteDepartmentPlanRecord(env.DB, toInt(departmentPlanMatch[1], 0)));
      }

      if (url.pathname === '/api/team/timesheet' && request.method === 'GET') {
        return json(await listTeamTimesheet(env.DB, url));
      }

      if (url.pathname === '/api/team/timesheet' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<TimesheetInput>(request);
        return json(await saveTeamTimesheet(env.DB, input), { status: 201 });
      }

      if (url.pathname === '/api/team/salary' && request.method === 'GET') {
        return json(await listTeamSalaryPreview(env.DB, url));
      }

      if (url.pathname === '/api/team/activity' && request.method === 'GET') {
        return measuredJsonRead('team.activity', () => listTeamActivity(env.DB, url));
      }

      if (url.pathname === '/api/activity' && request.method === 'GET') {
        return json(await listActivityLog(env.DB, url));
      }

      if (url.pathname === '/api/workshop/counts' && request.method === 'GET') {
        return json({ ok: true, ...(await readWorkshopCounts(env.DB)) });
      }

      if (url.pathname === '/api/workshop' && request.method === 'GET') {
        return json(await listWorkshopTasks(env.DB, url));
      }

      if (url.pathname === '/api/workshop/bulk' && request.method === 'PATCH') {
        const input = await readJson<{ ids?: unknown; status?: unknown; urgent?: unknown; dueDate?: unknown; comment?: unknown }>(request);
        const result = await bulkUpdateWorkshopTasks(env.DB, input);
        await writeActivityLog(env.DB, {
          eventType: 'workshop_bulk_updated',
          entityType: 'workshop_task',
          title: 'Массовое изменение цеха',
          details: `Позиций: ${(result as any).updated || 0}; статус: ${cleanText(input.status) || 'без изменения'}; срочно: ${input.urgent === undefined ? 'без изменения' : (input.urgent ? 'да' : 'нет')}`,
        });
        return json(result);
      }

      const workshopMatch = url.pathname.match(/^\/api\/workshop\/(\d+)$/);
      if (workshopMatch && request.method === 'PATCH') {
        const input = await readJson<{ status?: unknown; urgent?: unknown; dueDate?: unknown; comment?: unknown; orderItemId?: unknown }>(request);
        const taskId = toInt(workshopMatch[1], 0);
        const result = await updateWorkshopTask(env.DB, taskId, input);
        if ((result as any).changed) {
          await writeActivityLog(env.DB, {
            eventType: 'workshop_updated',
            entityType: 'workshop_task',
            entityId: taskId,
            orderId: toInt((result as any).task?.order_id, 0) || null,
            externalOrderId: cleanText((result as any).task?.external_order_id),
            title: `Изменена позиция цеха #${taskId}`,
            details: `Статус: ${cleanText((result as any).previousStatus)} → ${cleanText((result as any).task?.status)}; позиция заказа: ${toInt((result as any).task?.order_item_id, 0) || 'не связана'}; товар: ${cleanText((result as any).task?.product_name_snapshot)}; срочно: ${toInt((result as any).task?.urgent, 0) ? 'да' : 'нет'}`,
          });
        }
        return json(result);
      }


      if (url.pathname === '/api/orders/archive/preview' && request.method === 'GET') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json(await getArchivePreview(env.DB, url.searchParams));
      }

      if (url.pathname === '/api/orders/archive' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<ArchiveRuleInput>(request);
        const actor = cleanText(request.headers.get('X-Archive-Actor')) || normalizeAccessRole(request.headers.get('X-Access-Role'));
        return json(await archiveOrders(env.DB, input, actor));
      }

      if (url.pathname === '/api/clients' && request.method === 'GET') {
        return measuredJsonRead('clients.list', () => listClients(env.DB, url));
      }

      const clientMatch = url.pathname.match(/^\/api\/clients\/(\d+)$/);
      if (clientMatch && request.method === 'GET') {
        return measuredResponseRead('clients.details', () => getClientDetails(env.DB, Number(clientMatch[1]), url));
      }

      if (url.pathname === '/api/orders/open-debts' && request.method === 'GET') {
        return measuredJsonRead('orders.open-debts', () => listOpenDebtOrders(env.DB, url));
      }

      if (url.pathname === '/api/orders' && request.method === 'GET') {
        return measuredJsonRead('orders.list', () => listOrders(env.DB, url));
      }

      if (url.pathname === '/api/orders' && request.method === 'POST') {
        const input = await readJson<OrderInput>(request);
        input.requestId = cleanText(input.requestId) || cleanText(request.headers.get('X-Idempotency-Key')) || undefined;
        try {
          return json(await createOrder(env.DB, input, authUser), { status: 201 });
        } catch (error) {
          if (error instanceof OrderInputValidationError) {
            return json({ ok: false, code: error.code, message: error.message }, { status: error.status });
          }
          if (error instanceof OrderStockShortageError) {
            return json({ ok: false, code: error.code, message: error.message, shortages: error.shortages }, { status: 409 });
          }
          const criticalResponse = criticalOperationErrorResponse(error);
          if (criticalResponse) return criticalResponse;
          throw error;
        }
      }


      if (url.pathname === '/api/inventory/attention' && request.method === 'GET') {
        return measuredJsonRead('inventory.attention', () => getWarehouseAttentionSummary(env.DB, url));
      }

      if (url.pathname === '/api/inventory/settings' && request.method === 'GET') {
        return json(await getInventoryControlSettings(env.DB));
      }

      if (url.pathname === '/api/inventory/settings' && request.method === 'PATCH') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ autoWriteoffEnabled?: unknown }>(request);
        const result = await updateInventoryControlSettings(env.DB, input);
        await writeActivityLog(env.DB, {
          eventType: 'inventory_settings',
          entityType: 'inventory',
          title: result.autoWriteoffEnabled ? 'Автосписание заказов включено' : 'Автосписание заказов выключено',
          details: result.autoWriteoffEnabled
            ? 'Новые заказы снова автоматически меняют остатки склада/бутика.'
            : 'Новые заказы сохраняются без изменения остатков до ручного запуска списания.',
        });
        return json(result);
      }

      if (url.pathname === '/api/inventory/pending-writeoffs/apply' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const result = await applyPendingInventoryWriteoffs(env.DB);
        await writeActivityLog(env.DB, {
          eventType: 'inventory_pending_writeoff',
          entityType: 'inventory',
          title: 'Запущено отложенное списание заказов',
          details: `Списано позиций: ${result.applied}; уже было учтено и синхронизировано: ${result.reconciled}; осталось: ${result.pendingWriteoffCount}`,
        });
        return json(result);
      }

      const reverseInventoryMovementMatch = url.pathname.match(/^\/api\/inventory\/movements\/(\d+)\/reverse$/);
      if (reverseInventoryMovementMatch && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ comment?: unknown }>(request);
        const actor = cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role'));
        const returnInventory = url.searchParams.get('returnInventory') !== '0';
        const result = await reverseInventoryMovementOperation(
          env.DB,
          toInt(reverseInventoryMovementMatch[1], 0),
          actor,
          cleanText(input.comment),
          returnInventory,
        );
        await writeActivityLog(env.DB, {
          eventType: 'inventory_reversal',
          entityType: 'inventory',
          entityId: toInt(reverseInventoryMovementMatch[1], 0),
          title: 'Отменена складская операция',
          details: `${result.operationReferenceId}; восстановлено движений: ${result.reversedRows}`,
        });
        return json(result);
      }

      if (url.pathname === '/api/inventory/audit' && request.method === 'GET') {
        return json(await getInventoryHardAudit(env.DB));
      }

      if (url.pathname === '/api/inventory/audit/resolve' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ issueKey?: unknown; resolved?: unknown; comment?: unknown }>(request);
        const actor = cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role'));
        const resolved = input.resolved !== false && cleanText(input.resolved).toLowerCase() !== 'false' && cleanText(input.resolved) !== '0';
        const result = await setInventoryAuditResolution(env.DB, cleanText(input.issueKey), resolved, actor, cleanText(input.comment));
        await writeActivityLog(env.DB, {
          eventType: resolved ? 'inventory_integrity_resolved' : 'inventory_integrity_reopened',
          entityType: 'inventory',
          title: resolved ? 'Проверка склада подтверждена после сверки' : 'Проблема склада возвращена в проверку',
          details: `${cleanText(input.issueKey)}${cleanText(input.comment) ? `; ${cleanText(input.comment)}` : ''}`,
        });
        return json(result);
      }

      if (url.pathname === '/api/inventory/cycle-counts' && request.method === 'GET') {
        return json(await listInventoryCycleCountSuggestions(env.DB, url));
      }

      if (url.pathname === '/api/inventory/cycle-counts/apply' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await request.json<Record<string, unknown>>();
        const actor = cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role'));
        const result = await quickInventoryStocktakeBatch(env.DB, input, { actor, checkType: 'cycle_count', referenceType: 'cycle_count' });
        if (result.ok) {
          await writeActivityLog(env.DB, { eventType: 'inventory_cycle_count', entityType: 'inventory', title: 'Короткая циклическая сверка', details: `${cleanText(input.source)}; проверено: ${Array.isArray(input.items) ? input.items.length : 0}; расхождений: ${result.changedCount || 0}` });
        }
        return json(result, { status: result.ok ? 200 : 409 });
      }

      if (url.pathname === '/api/inventory/stocktakes' && request.method === 'GET') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json(await listInventoryStocktakeSessions(env.DB, url));
      }

      if (url.pathname === '/api/inventory/stocktakes' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ source?: unknown }>(request);
        const actor = cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role'));
        const result = await createInventoryStocktakeSession(env.DB, input, actor);
        if (!result.ok) return json(result, { status: 409 });
        const session = result.session;
        if (!session) throw new Error('Не удалось загрузить созданную ревизию.');
        await writeActivityLog(env.DB, {
          eventType: 'inventory_stocktake_started', entityType: 'inventory', entityId: null,
          title: 'Начата ревизия',
          details: `${session.source}; ${session.id}; позиций: ${session.totalItems}`,
        });
        return json(result, { status: 201 });
      }

      if (url.pathname === '/api/inventory/stocktakes/quick-batch' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await request.json<Record<string, unknown>>();
        const actor = cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role'));
        const result = await quickInventoryStocktakeBatch(env.DB, input, { actor });
        if (result.ok) {
          await writeActivityLog(env.DB, { eventType: 'inventory_quick_stocktake', entityType: 'inventory', title: 'Быстрая сверка остатков', details: `${cleanText(input.source)}; позиций: ${Array.isArray(input.items) ? input.items.length : 0}; изменений: ${result.changedCount || 0}` });
        }
        return json(result, { status: result.ok ? 200 : 409 });
      }

      if (url.pathname === '/api/inventory/stocktakes/quick' && request.method === 'POST') {
        const input = await readJson<{ source?: unknown; variantId?: unknown; expectedQuantity?: unknown; countedQuantity?: unknown }>(request);
        const actor = cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role'));
        const result = await quickInventoryStocktake(env.DB, input, { actor });
        if (result.ok) {
          await writeActivityLog(env.DB, { eventType: 'inventory_quick_stocktake', entityType: 'inventory', title: 'Точечная сверка остатка', details: `${cleanText(input.source)}; variant ${toInt(input.variantId, 0)}; ${result.previousQuantity} → ${result.physical}` });
        }
        return json(result, { status: result.ok ? 200 : 409 });
      }

      const inventoryStocktakeMatch = url.pathname.match(/^\/api\/inventory\/stocktakes\/([^/]+)$/);
      if (inventoryStocktakeMatch && request.method === 'GET') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json({ ok: true, session: await serializeInventoryStocktakeSession(env.DB, decodeURIComponent(inventoryStocktakeMatch[1])) });
      }

      const inventoryStocktakeItemMatch = url.pathname.match(/^\/api\/inventory\/stocktakes\/([^/]+)\/items\/(\d+)$/);
      if (inventoryStocktakeItemMatch && request.method === 'PATCH') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ countedQuantity?: unknown }>(request);
        return json(await saveInventoryStocktakeCount(env.DB, decodeURIComponent(inventoryStocktakeItemMatch[1]), toInt(inventoryStocktakeItemMatch[2], 0), input));
      }

      const inventoryStocktakeAddCombinationMatch = url.pathname.match(/^\/api\/inventory\/stocktakes\/([^/]+)\/items\/combination$/);
      if (inventoryStocktakeAddCombinationMatch && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ productId?: unknown; material?: unknown; length?: unknown; category?: unknown; gender?: unknown; color?: unknown; size?: unknown; createReferenceFields?: unknown }>(request);
        return json(await addInventoryStocktakeCombination(env.DB, decodeURIComponent(inventoryStocktakeAddCombinationMatch[1]), input), { status: 201 });
      }

      const inventoryStocktakeAddItemMatch = url.pathname.match(/^\/api\/inventory\/stocktakes\/([^/]+)\/items$/);
      if (inventoryStocktakeAddItemMatch && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ variantId?: unknown }>(request);
        return json(await addInventoryStocktakeVariant(env.DB, decodeURIComponent(inventoryStocktakeAddItemMatch[1]), input), { status: 201 });
      }

      const inventoryStocktakeCompleteMatch = url.pathname.match(/^\/api\/inventory\/stocktakes\/([^/]+)\/complete$/);
      if (inventoryStocktakeCompleteMatch && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const result = await completeInventoryStocktakeSession(env.DB, decodeURIComponent(inventoryStocktakeCompleteMatch[1]));
        if (result.ok) {
          await writeActivityLog(env.DB, {
            eventType: 'inventory_stocktake_completed', entityType: 'inventory', title: 'Завершена ревизия',
            details: `${result.session.source}; ${result.session.id}; исправлено: ${result.changed}; нехваток под заказы: ${(result.shortages || []).length}`,
          });
        }
        return json(result, { status: result.ok ? 200 : 409 });
      }

      const inventoryStocktakeCancelMatch = url.pathname.match(/^\/api\/inventory\/stocktakes\/([^/]+)\/cancel$/);
      if (inventoryStocktakeCancelMatch && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const sessionId = decodeURIComponent(inventoryStocktakeCancelMatch[1]);
        const result = await cancelInventoryStocktakeSession(env.DB, sessionId);
        await writeActivityLog(env.DB, {
          eventType: 'inventory_stocktake_cancelled', entityType: 'inventory', title: 'Отменена ревизия', details: sessionId,
        });
        return json(result);
      }

      if (url.pathname === '/api/inventory/history' && request.method === 'GET') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json(await listInventoryHistory(env.DB, url));
      }

      if (url.pathname === '/api/inventory/check-history' && request.method === 'GET') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json(await listInventoryCheckHistory(env.DB, url));
      }

      if (url.pathname === '/api/inventory/reservations' && request.method === 'GET') {
        return json(await listInventoryReservations(env.DB, url));
      }

      if (url.pathname === '/api/inventory' && request.method === 'GET') {
        return json(await listInventory(env.DB, url));
      }

      if (url.pathname === '/api/inventory/movements' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ requestId?: unknown; inventorySource?: unknown; movementType?: unknown; comment?: unknown; items?: InventoryItemInput[] }>(request);
        const returnInventory = url.searchParams.get('returnInventory') !== '0';
        const actor = cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role'));
        const result = await applyInventoryMovement(env.DB, input, returnInventory, actor);
        await writeActivityLog(env.DB, {
          eventType: 'inventory_movement',
          entityType: 'inventory',
          title: `Движение остатков: ${cleanText(input.movementType) || 'операция'}`,
          details: `${cleanText(input.inventorySource) || 'источник не указан'}; позиций: ${Array.isArray(input.items) ? input.items.length : 0}${cleanText(input.comment) ? `; ${cleanText(input.comment)}` : ''}`,
        });
        return json(result, { status: 201 });
      }

      if (url.pathname === '/api/inventory/transfer' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ requestId?: unknown; fromSource?: unknown; toSource?: unknown; comment?: unknown; items?: InventoryItemInput[] }>(request);
        const returnInventory = url.searchParams.get('returnInventory') !== '0';
        const result = await applyInventoryTransfer(env.DB, input, authUser?.displayName || '', returnInventory);
        if (!result.duplicate) {
          await writeActivityLog(env.DB, {
            eventType: 'inventory_transfer',
            entityType: 'inventory',
            title: 'Перемещение остатков',
            details: `${cleanText(result.externalId) || 'перемещение'}; ${cleanText(input.fromSource) || 'источник'} → ${cleanText(input.toSource) || 'назначение'}; позиций: ${toInt(result.applied, Array.isArray(input.items) ? input.items.length : 0)}; количество: ${toInt(result.totalQuantity, 0)}${cleanText(input.comment) ? `; ${cleanText(input.comment)}` : ''}`,
          });
        }
        return json(result, { status: result.duplicate ? 200 : 201 });
      }

      if (url.pathname === '/api/catalog' && request.method === 'GET') {
        return json(await listCatalog(env.DB));
      }

      if (url.pathname === '/api/inventory/lifecycle/pending' && request.method === 'GET') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json(await listInventoryLifecyclePending(env.DB, url));
      }

      const inventoryLifecycleContextMatch = url.pathname.match(/^\/api\/inventory\/lifecycle\/(\d+)\/context$/);
      if (inventoryLifecycleContextMatch && request.method === 'GET') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json(await getInventoryLifecycleContext(env.DB, toInt(inventoryLifecycleContextMatch[1], 0)));
      }

      const inventoryLifecycleResolveMatch = url.pathname.match(/^\/api\/inventory\/lifecycle\/(\d+)\/resolve-facts$/);
      if (inventoryLifecycleResolveMatch && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const eventId = toInt(inventoryLifecycleResolveMatch[1], 0);
        const input = await readJson<CatalogReviewFactsInput>(request);
        const result = await resolveInventoryLifecycleFacts(env.DB, eventId, input);
        await writeActivityLog(env.DB, {
          eventType: 'inventory_lifecycle_resolved',
          entityType: 'inventory',
          entityId: eventId,
          title: 'Разобрана физическая складская позиция',
          details: cleanText(result.message),
        });
        return json(result);
      }

      const inventoryLifecycleKnownMatch = url.pathname.match(/^\/api\/inventory\/lifecycle\/(\d+)\/reconcile-known$/);
      if (inventoryLifecycleKnownMatch && request.method === 'POST') {
        const eventId = toInt(inventoryLifecycleKnownMatch[1], 0);
        const result = await reconcileKnownPendingInventoryInbound(env.DB, eventId);
        if (result.ok) {
          await writeActivityLog(env.DB, {
            eventType: 'inventory_lifecycle_known_reconciled',
            entityType: 'inventory',
            entityId: eventId,
            title: 'Завершена приёмка известной позиции',
            details: cleanText(result.message),
          });
        }
        return json(result, { status: result.ok ? 200 : 409 });
      }

      if (url.pathname === '/api/catalog/review/reconcile' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json(await reconcileCatalogReviewQueue(env.DB, url));
      }

      if (url.pathname === '/api/catalog/review' && request.method === 'GET') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json(await listCatalogReviewQueue(env.DB, url));
      }

      const catalogReviewContextMatch = url.pathname.match(/^\/api\/catalog\/review\/(\d+)\/context$/);
      if (catalogReviewContextMatch && request.method === 'GET') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        return json(await getCatalogReviewContext(env.DB, toInt(catalogReviewContextMatch[1], 0)));
      }

      const catalogReviewFactsMatch = url.pathname.match(/^\/api\/catalog\/review\/(\d+)\/resolve-facts$/);
      if (catalogReviewFactsMatch && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<CatalogReviewFactsInput>(request);
        const result = await resolveCatalogReviewFacts(env.DB, toInt(catalogReviewFactsMatch[1], 0), input);
        await writeActivityLog(env.DB, { eventType: 'catalog_review_resolved', entityType: 'catalog', entityId: toInt(catalogReviewFactsMatch[1], 0), title: 'Разобрана позиция каталога', details: cleanText(result.message) });
        return json(result);
      }

      const catalogReviewExcludeMatch = url.pathname.match(/^\/api\/catalog\/review\/(\d+)\/exclude$/);
      if (catalogReviewExcludeMatch && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const result = await excludeCatalogReviewQueueItem(env.DB, toInt(catalogReviewExcludeMatch[1], 0));
        await writeActivityLog(env.DB, {
          eventType: 'catalog_review_excluded',
          entityType: 'catalog',
          entityId: toInt(catalogReviewExcludeMatch[1], 0),
          title: 'Позиция оставлена вне каталога',
          details: cleanText(result.message),
        });
        return json(result);
      }

      const catalogReviewResolveMatch = url.pathname.match(/^\/api\/catalog\/review\/(\d+)\/resolve$/);
      if (catalogReviewResolveMatch && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ variantId?: unknown }>(request);
        const result = await resolveCatalogReviewQueueItem(env.DB, toInt(catalogReviewResolveMatch[1], 0), toInt(input.variantId, 0));
        await writeActivityLog(env.DB, {
          eventType: 'catalog_review_resolved',
          entityType: 'catalog',
          entityId: toInt(catalogReviewResolveMatch[1], 0),
          title: 'Разобрана неизвестная позиция каталога',
          details: `Связано позиций: ${result.linked}; зарезервировано: ${result.reserved}; исторически связано без изменения остатка: ${result.historicalLinked || 0}`,
        });
        return json(result);
      }

      if (url.pathname === '/api/catalog/products' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ name?: unknown; category?: unknown }>(request);
        return json(await createCatalogProduct(env.DB, input), { status: 201 });
      }

      const productMatch = url.pathname.match(/^\/api\/catalog\/products\/(\d+)$/);
      if (productMatch && request.method === 'PATCH') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ name?: unknown; category?: unknown; isActive?: unknown }>(request);
        return json(await updateCatalogProduct(env.DB, toInt(productMatch[1], 0), input));
      }

      if (url.pathname === '/api/catalog/variants' && request.method === 'POST') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ productId?: unknown; category?: unknown; gender?: unknown; color?: unknown; material?: unknown; length?: unknown; sizeLabel?: unknown; sortOrder?: unknown }>(request);
        return json(await createCatalogVariant(env.DB, input), { status: 201 });
      }

      const variantMatch = url.pathname.match(/^\/api\/catalog\/variants\/(\d+)$/);
      if (variantMatch && request.method === 'PATCH') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ productId?: unknown; category?: unknown; gender?: unknown; color?: unknown; material?: unknown; length?: unknown; sizeLabel?: unknown; isActive?: unknown; sortOrder?: unknown }>(request);
        return json(await updateCatalogVariant(env.DB, toInt(variantMatch[1], 0), input));
      }

      const orderRestoreMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/restore$/);
      if (orderRestoreMatch && request.method === 'PATCH') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const result = await restoreArchivedOrder(env.DB, toInt(orderRestoreMatch[1], 0), normalizeAccessRole(request.headers.get('X-Access-Role')));
        if (!(result as any).ok) return json(result, { status: (result as any).status || 400 });
        return json(result);
      }

      const orderStockHandoverMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/stock-handover$/);
      if (orderStockHandoverMatch && (request.method === 'GET' || request.method === 'PATCH')) {
        const id = toInt(orderStockHandoverMatch[1], 0);
        const state = await getOrderStockHandoverState(env.DB, id);
        if (!state) return json({ ok: false, message: 'Заказ не найден.' }, { status: 404 });
        const order = await env.DB.prepare(
          `SELECT order_status, archived_at, shipping_status FROM orders WHERE id = ?`
        ).bind(id).first<Record<string, unknown>>();
        if (normalizeOrderStatus(order?.order_status) === 'archived' || cleanText(order?.archived_at)) {
          return json({ ok: false, message: 'Архивный заказ доступен только для просмотра.' }, { status: 409 });
        }
        if (request.method === 'GET') return json(state);
        if (normalizeShippingStatus(order?.shipping_status) === 'sent') {
          return json({ ok: false, message: 'Этот заказ уже отправлен клиенту. Повторная выдача товаров запрещена.' }, { status: 409 });
        }

        const input = await readJson<{ action?: unknown; orderItemId?: unknown; checkpointId?: unknown; checkpointAt?: unknown }>(request);
        const action = cleanText(input.action);
        const orderItemId = toInt(input.orderItemId, 0);
        const checkpointId = toInt(input.checkpointId, 0);
        if (!orderItemId) return json({ ok: false, message: 'Не выбрана позиция заказа.' }, { status: 400 });
        const item = state.items.find((row) => row.orderItemId === orderItemId);
        if (!item) return json({ ok: false, message: 'Этой складской позиции больше нет в заказе. Обновите страницу.' }, { status: 409 });
        const actor = cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role'));
        const activeStocktake = await activeStocktakeSessionForHandover(env.DB, item.source);
        if (activeStocktake) {
          const sourceLabel = item.source === 'warehouse' ? 'Склад' : 'Бутик';
          return json({
            ok: false,
            code: 'stocktake_active',
            message: `Сейчас в точке «${sourceLabel}» открыта ревизия. Сначала завершите или отмените её, затем выдавайте или уточняйте этот товар.`,
            stocktakeId: activeStocktake.id,
          }, { status: 409 });
        }

        const safeHandoverReadback = async () => {
          let nextState = null;
          let nextOrder = null;
          try {
            nextState = await getOrderStockHandoverState(env.DB, id);
          } catch (error) {
            console.warn('Order stock handover state readback after committed action failed', error);
          }
          try {
            nextOrder = await getOrder(env.DB, id);
          } catch (error) {
            console.warn('Order stock handover order readback after committed action failed', error);
          }
          return {
            ...(nextState ? { state: nextState } : {}),
            ...(nextOrder ? { order: nextOrder } : {}),
            refreshRequired: !nextState || !nextOrder,
          };
        };

        try {
          if (action === 'issue_now') {
            if (item.reviewNeeded) {
              return json({ ok: false, message: `Сначала уточните, где находился товар «${item.productName}» во время последней физической ревизии или сверки.` }, { status: 409 });
            }
            if (item.state === 'already_issued') {
              return json({ ok: true, alreadyIssued: true, ...(await safeHandoverReadback()) });
            }
            if (!item.reservationId || item.reservationStatus !== 'active') {
              return json({ ok: false, message: `«${item.productName}» нельзя выдать сейчас: складская привязка требует проверки.` }, { status: 409 });
            }
            const inventoryDelivery = await fulfillOrderReservationsV2(env.DB, id, state.externalId, new Date().toISOString(), {
              checkedBy: actor,
              orderItemIds: [orderItemId],
            });
            if (inventoryDelivery.unresolved) {
              return json({ ok: false, message: `«${item.productName}» нельзя выдать: позиция требует разбора на Складе.` }, { status: 409 });
            }
            try {
              await writeActivityLog(env.DB, {
                eventType: 'order_stock_issued_before_full_shipping',
                entityType: 'order_item',
                entityId: orderItemId,
                orderId: id,
                externalOrderId: state.externalId,
                title: `Товар выдан до завершения заказа ${state.externalId}`,
                details: `${item.productName}; заказ остался не отправленным, потому что выдача складской части не завершает весь заказ.`,
                createdAt: new Date().toISOString(),
              });
            } catch (error) {
              console.warn('Order stock issue activity log after committed handover failed', error);
            }
            return json({ ok: true, inventoryDelivery, ...(await safeHandoverReadback()) });
          }

          if (action === 'issued_before_checkpoint') {
            await reconcileIssuedBeforeCheckpoint(env.DB, id, state.externalId, item, checkpointId, cleanText(input.checkpointAt), actor);
            return json({ ok: true, ...(await safeHandoverReadback()) });
          }

          if (action === 'still_here') {
            await confirmItemStillHere(env.DB, id, state.externalId, item, checkpointId, cleanText(input.checkpointAt), actor);
            return json({ ok: true, ...(await safeHandoverReadback()) });
          }

          return json({ ok: false, message: 'Неизвестное действие с товаром.' }, { status: 400 });
        } catch (error) {
          const publicError = publicApiError(error);
          return json({ ok: false, ...(publicError.code ? { code: publicError.code } : {}), message: publicError.message }, { status: publicError.status });
        }
      }

      const orderShippingMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/shipping$/);
      if (orderShippingMatch && request.method === 'PATCH') {
        const id = toInt(orderShippingMatch[1], 0);
        const input = await readJson<{ shippingStatus?: unknown; shippingDate?: unknown; observations?: unknown }>(request);
        const existing = await env.DB.prepare(
          `SELECT id, external_id, manager_id, order_status, archived_at, shipping_status, shipping_date
           FROM orders WHERE id = ?`
        ).bind(id).first<Record<string, unknown>>();
        if (!existing) return json({ ok: false, message: 'Order not found' }, { status: 404 });
        if (normalizeOrderStatus(existing.order_status) === 'archived' || cleanText(existing.archived_at)) {
          return json({ ok: false, message: `Заказ ${cleanText(existing.external_id)} находится в архиве. Архивные заказы доступны только для просмотра.` }, { status: 409 });
        }
        const nextShippingStatus = normalizeShippingStatus(input.shippingStatus);
        if (nextShippingStatus !== 'sent') {
          return json({ ok: false, message: 'Операционный маршрут позволяет только отметить заказ отправленным.' }, { status: 400 });
        }
        if (normalizeShippingStatus(existing.shipping_status) === 'sent') {
          let alreadySentOrder = null;
          try {
            alreadySentOrder = await getOrder(env.DB, id);
          } catch (error) {
            console.warn('Order shipping readback after already-sent retry failed', error);
          }
          return json({
            ok: true,
            alreadySent: true,
            ...(alreadySentOrder ? { order: alreadySentOrder } : {}),
            refreshRequired: !alreadySentOrder,
            inventoryDelivery: { fulfilled: 0, unresolved: 0 },
          });
        }
        const workshop = await orderWorkshopPendingForShipping(env.DB, id);
        if (workshop.pending) {
          return json({
            ok: false,
            code: 'workshop_not_ready',
            message: 'Товары из Цеха ещё не готовы. Готовые товары со Склада и Бутика можно выдать клиенту отдельно через кнопку «Выдать готовые товары».',
          }, { status: 409 });
        }
        const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(env.DB);
        const normalizedObservations = humanInventoryModelEnabled ? normalizeShipmentObservations(input.observations) : [];
        if (humanInventoryModelEnabled) {
          const handoverReviewBlockers = await orderHandoverReviewBlockers(env.DB, id);
          if (handoverReviewBlockers.length) {
            return json({
              ok: false,
              code: 'stock_handover_review_required',
              message: 'Перед отправкой уточните товары со Склада и Бутика: после даты заказа была физическая ревизия или сверка, поэтому нужно один раз подтвердить, где находился товар в тот момент.',
              items: handoverReviewBlockers,
            }, { status: 409 });
          }
          const blockers = await getOrderShipmentInventoryBlockers(env.DB, id);
          const unresolvedBlockers = blockers.filter((row) => cleanText(row.blocker_reason) !== 'insufficient_physical');
          if (unresolvedBlockers.length) {
            return json({ ok: false, code: 'catalog_review_required', reviewOrderId: id, message: orderShipmentInventoryBlockerMessage(unresolvedBlockers) }, { status: 409 });
          }
          const shortageBlockers = blockers.filter((row) => cleanText(row.blocker_reason) === 'insufficient_physical');
          const uncoveredShortages = shortageBlockers.filter((row) => {
            const source = normalizeSourceType(row.inventory_source);
            const variantId = toInt(row.reservation_variant_id, 0);
            const required = Math.max(1, toInt(row.required_quantity, 1));
            const physical = toInt(row.physical_quantity, 0);
            const observation = normalizedObservations.find((candidate) => candidate.source === source && candidate.variantId === variantId);
            return !observation || observation.expectedQuantity !== physical || observation.countedQuantity < required;
          });
          if (uncoveredShortages.length) {
            return json({
              ok: false,
              code: 'inventory_physical_shortage',
              message: orderShipmentInventoryBlockerMessage(uncoveredShortages),
              blockers: uncoveredShortages,
            }, { status: 409 });
          }
        }
        const timestamp = new Date().toISOString();
        const nextShippingDate = normalizeDate(input.shippingDate || timestamp);
        const inventoryDelivery = humanInventoryModelEnabled
          ? await fulfillOrderReservationsV2(env.DB, id, cleanText(existing.external_id), timestamp, {
              observations: normalizedObservations,
              shippingDate: nextShippingDate,
              checkedBy: cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role')),
            })
          : null;
        if (inventoryDelivery?.unresolved) {
          return json({ ok: false, message: 'Отправка остановлена: в заказе остались неразобранные складские позиции.' }, { status: 409 });
        }
        if (!humanInventoryModelEnabled) {
          await env.DB.prepare(
            `UPDATE orders
             SET shipping_status = 'sent', shipping_date = ?, updated_at = ?
             WHERE id = ?`
          ).bind(nextShippingDate, timestamp, id).run();
        }
        // Physical fulfillment + shipping_status above are the critical commit. A secondary readback
        // must never turn an already-sent order into a false failure response and invite a retry.
        let updatedOrder = null;
        try {
          updatedOrder = await getOrder(env.DB, id);
        } catch (error) {
          console.warn('Order shipping readback after committed send failed', error);
        }
        try {
          await writeActivityLog(env.DB, {
            eventType: 'order_shipping_updated',
            entityType: 'order',
            entityId: id,
            orderId: id,
            externalOrderId: cleanText(existing.external_id),
            title: `Заказ ${cleanText(existing.external_id)} отмечен отправленным`,
            details: `Дата отправки: ${nextShippingDate}; менеджер сохранён: ${toInt(existing.manager_id, 0) || 'не указан'}`,
            createdAt: timestamp,
          });
        } catch (error) {
          console.warn('Order shipping activity log after committed send failed', error);
        }
        return json({
          ok: true,
          ...(updatedOrder ? { order: updatedOrder } : {}),
          refreshRequired: !updatedOrder,
          inventoryDelivery,
        });
      }

      const orderMatch = url.pathname.match(/^\/api\/orders\/(\d+)$/);
      if (orderMatch) {
        const id = toInt(orderMatch[1], 0);
        if (request.method === 'GET') {
          const order = await getOrder(env.DB, id);
          if (!order) {
            return json({ ok: false, message: 'Order not found' }, { status: 404 });
          }
          return json({ ok: true, order });
        }

        if (request.method === 'PATCH') {
          const denied = requireAdminAccess(request);
          if (denied) return denied;
          const input = await readJson<OrderInput>(request);
          input.requestId = cleanText(input.requestId) || cleanText(request.headers.get('X-Idempotency-Key')) || undefined;
          try {
            const result = await updateOrderCritical(
              env.DB, id, input, authUser,
              cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role')),
            );
            return json(result);
          } catch (error) {
            if (error instanceof OrderInputValidationError) {
              return json({ ok: false, code: error.code, message: error.message }, { status: error.status });
            }
            if (error instanceof OrderStockShortageError) {
              return json({ ok: false, code: error.code, message: error.message, shortages: error.shortages }, { status: 409 });
            }
            const criticalResponse = criticalOperationErrorResponse(error);
            if (criticalResponse) return criticalResponse;
            throw error;
          }
        }
      }

      if (url.pathname === '/api/payments' && request.method === 'POST') {
        const input = await readJson<{ requestId?: string; orderId?: number; paymentDate?: string; method?: string; amount?: number; paymentKind?: string; comment?: string }>(request);
        const orderId = toInt(input.orderId, 0);
        const rawAmount = Number(input.amount);
        const method = upperText(input.method);
        if (!orderId) return json({ ok: false, message: 'orderId is required' }, { status: 400 });
        if (!method || !Number.isInteger(rawAmount) || rawAmount <= 0) {
          return json({ ok: false, message: 'Укажите способ оплаты и целую сумму больше нуля.' }, { status: 400 });
        }
        input.requestId = cleanText(input.requestId) || cleanText(request.headers.get('X-Idempotency-Key')) || undefined;
        try {
          const saved = await createManualOrderPaymentCritical(env.DB, {
            ...input,
            orderId,
            method,
            amount: rawAmount,
          });
          let refreshed = null;
          try {
            refreshed = await getOrder(env.DB, orderId);
          } catch (error) {
            console.warn('Order payment readback after committed payment failed', error);
          }
          const debtClosed = refreshed ? toInt((refreshed as any).debt_amount, 0) <= 0 : undefined;
          if (!saved.replayed) {
            try {
              await writeActivityLog(env.DB, {
                eventType: debtClosed ? 'debt_closed' : 'payment_added',
                entityType: 'payment',
                entityId: toInt(saved.paymentId, 0) || null,
                orderId,
                externalOrderId: cleanText(saved.externalOrderId),
                title: debtClosed
                  ? `Закрыт долг по заказу ${cleanText(saved.externalOrderId)}`
                  : `Добавлена оплата по заказу ${cleanText(saved.externalOrderId)}`,
                details: `${cleanText(saved.method)}${cleanText(input.comment) ? `: ${cleanText(input.comment)}` : ''}`,
                amount: toInt(saved.amount, 0),
                createdAt: cleanText(saved.createdAt) || new Date().toISOString(),
              });
            } catch (error) {
              console.warn('Order payment activity log after committed payment failed', error);
            }
          }
          return json({
            ...saved,
            ...(refreshed ? { order: refreshed, debtClosed, refreshRequired: false } : { refreshRequired: true }),
          }, { status: 201 });
        } catch (error) {
          const criticalResponse = criticalOperationErrorResponse(error);
          if (criticalResponse) return criticalResponse;
          const publicError = publicApiError(error);
          return json({ ok: false, ...(publicError.code ? { code: publicError.code } : {}), message: publicError.message }, { status: publicError.status });
        }
      }

      if (url.pathname === '/api/returns' && request.method === 'GET') {
        return json(await listReturnHistory(env.DB, url));
      }

      if (url.pathname === '/api/returns' && request.method === 'POST') {
        const input = await readJson<{ requestId?: string; orderId?: number; returnDate?: string; amount?: number; paymentMethod?: string; comment?: string; restockSource?: unknown; items?: Array<{ orderItemId?: number; quantity?: number; amount?: number; restock?: boolean }> }>(request);
        input.requestId = cleanText(input.requestId) || cleanText(request.headers.get('X-Idempotency-Key')) || undefined;
        try {
          return json(await createReturn(env.DB, input), { status: 201 });
        } catch (error) {
          const criticalResponse = criticalOperationErrorResponse(error);
          if (criticalResponse) return criticalResponse;
          throw error;
        }
      }

      if (url.pathname === '/api/exchanges' && request.method === 'GET') {
        return json(await listExchanges(env.DB, url));
      }

      const returnCancelMatch = url.pathname.match(/^\/api\/returns\/(\d+)\/cancel$/);
      if (returnCancelMatch && request.method === 'PATCH') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ requestId?: string; comment?: string }>(request);
        input.requestId = cleanText(input.requestId) || cleanText(request.headers.get('X-Idempotency-Key')) || undefined;
        try {
          return json(await cancelReturn(env.DB, Number(returnCancelMatch[1]), input));
        } catch (error) {
          const criticalResponse = criticalOperationErrorResponse(error);
          if (criticalResponse) return criticalResponse;
          throw error;
        }
      }

      if (url.pathname === '/api/exchanges' && request.method === 'POST') {
        const input = await readJson<{ requestId?: string; orderId?: number; exchangeDate?: string; oldItemId?: number; oldQuantity?: number; oldReturnSource?: unknown; newItem?: NonNullable<OrderInput['items']>[number]; newSourceWasManuallyChanged?: boolean; financialAction?: unknown; financialAmount?: number; paymentMethod?: string; comment?: string }>(request);
        input.requestId = cleanText(input.requestId) || cleanText(request.headers.get('X-Idempotency-Key')) || undefined;
        try {
          return json(await createExchange(env.DB, input), { status: 201 });
        } catch (error) {
          const criticalResponse = criticalOperationErrorResponse(error);
          if (criticalResponse) return criticalResponse;
          throw error;
        }
      }

      const exchangeCancelMatch = url.pathname.match(/^\/api\/exchanges\/(\d+)\/cancel$/);
      if (exchangeCancelMatch && request.method === 'PATCH') {
        const denied = requireAdminAccess(request);
        if (denied) return denied;
        const input = await readJson<{ requestId?: string; comment?: string }>(request);
        input.requestId = cleanText(input.requestId) || cleanText(request.headers.get('X-Idempotency-Key')) || undefined;
        try {
          return json(await cancelExchange(env.DB, Number(exchangeCancelMatch[1]), input));
        } catch (error) {
          const criticalResponse = criticalOperationErrorResponse(error);
          if (criticalResponse) return criticalResponse;
          throw error;
        }
      }

      return new Response(null, { status: 404 });
    } catch (error) {
      console.error(error);
      const publicError = publicApiError(error);
      return json({
        ok: false,
        ...(publicError.code ? { code: publicError.code } : {}),
        message: publicError.message,
      }, { status: publicError.status });
    }
  },
} satisfies ExportedHandler<Env>;