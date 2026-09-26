// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { json, readJson } from '../core/http.ts'
import { deleteAppSetting, getAppSetting, setAppSetting } from '../core/settings.ts'
import { chunksOf, sqlQuestionMarks } from '../core/sql.ts'
import { cleanText, normalizeImportConfirmText, toInt } from '../core/text.ts'
import type { Env } from '../core/types.ts'
import { writeActivityLog } from './activity.ts'
import { randomToken, sha256Base64Url, verifySimpleAdminPassword } from './auth.ts'

export const D1_FREE_DATABASE_LIMIT_BYTES = 500_000_000;

export const D1_PAID_DATABASE_LIMIT_BYTES = 10_000_000_000;

export const DATABASE_STORAGE_WARNING_PERCENT = 80;

export const DATABASE_STORAGE_CRITICAL_PERCENT = 90;

export const DATABASE_STORAGE_RETENTION_MONTHS = 12;

export const DATABASE_STORAGE_CLEANUP_BATCH_SIZE = 5;

export const DATABASE_STORAGE_MAX_SELECTED_MONTHS = 24;

export const DATABASE_STORAGE_MAX_MOVEMENT_COMPONENT = 800;

export const DATABASE_STORAGE_CAPACITY_SETTING = 'database_storage_capacity_bytes';

export const DATABASE_STORAGE_OPERATION_SETTING = 'database_storage_cleanup_operation';

export const DATABASE_STORAGE_LAST_CLEANUP_SETTING = 'database_storage_last_cleanup';

export const DATABASE_STORAGE_ALLOWED_CAPACITIES = new Set([D1_FREE_DATABASE_LIMIT_BYTES, D1_PAID_DATABASE_LIMIT_BYTES]);


export type DatabaseStorageWarningLevel = 'normal' | 'warning' | 'critical';


export type DatabaseStorageMonthSummary = {
  month: string;
  label: string;
  orderCount: number;
  totalAmount: number;
  receivedAmount: number;
  returnAmount: number;
  debtOrderCount: number;
  unsentOrderCount: number;
  liveWorkshopTaskCount: number;
  recentLinkedOperationCount: number;
  activeReservationCount: number;
  pendingLifecycleCount: number;
  canDelete: boolean;
  blockedReasons: string[];
};


export type DatabaseStorageCleanupPendingBatch = {
  month: string;
  orderRows: Array<{ id: number; external_id: string; customer_id: number }>;
  customerIds: number[];
  returnIds: number[];
  exchangeIds: number[];
  workshopTaskIds: number[];
  movementQueue: number[];
  phase: 'movements' | 'legacy' | 'activity' | 'core';
};


export type DatabaseStorageCleanupOperation = {
  version: 2;
  months: string[];
  tokenHash: string;
  initialOrdersByMonth: Record<string, number>;
  initialOrders: number;
  currentMonthIndex: number;
  completedMonths: string[];
  sizeBeforeBytes: number;
  startedAt: string;
  expiresAt: string;
  lastProgressAt?: string;
  pendingBatch?: DatabaseStorageCleanupPendingBatch | null;
};


export type DatabaseStorageCleanupRecord = {
  months: string[];
  deletedOrders: number;
  completedAt: string;
  sizeBeforeBytes: number;
  sizeAfterBytes: number;
};


export async function storageLimitBytes(db: D1Database) {
  const configured = Number(await getAppSetting(db, DATABASE_STORAGE_CAPACITY_SETTING, String(D1_FREE_DATABASE_LIMIT_BYTES)));
  if (DATABASE_STORAGE_ALLOWED_CAPACITIES.has(configured)) return configured;
  return D1_FREE_DATABASE_LIMIT_BYTES;
}


export function storageCapacityLabel(limitBytes: number) {
  if (limitBytes === D1_PAID_DATABASE_LIMIT_BYTES) return '10 ГБ';
  return '500 МБ';
}


export async function updateDatabaseStorageCapacity(db: D1Database, env: Env, request: Request) {
  const input = await readJson<{ limitBytes?: unknown; currentPassword?: unknown }>(request);
  const limitBytes = Math.floor(Number(input.limitBytes));
  if (!DATABASE_STORAGE_ALLOWED_CAPACITIES.has(limitBytes)) {
    return json({ ok: false, message: 'Выберите доступный объём 500 МБ или 10 ГБ.' }, { status: 400 });
  }
  const currentPassword = cleanText(input.currentPassword);
  if (!currentPassword || !(await verifySimpleAdminPassword(db, env, currentPassword))) {
    return json({ ok: false, message: 'Текущий пароль администратора указан неверно.' }, { status: 401 });
  }
  await setAppSetting(db, DATABASE_STORAGE_CAPACITY_SETTING, String(limitBytes));
  await writeActivityLog(db, {
    eventType: 'database_storage_capacity_changed',
    entityType: 'database_storage',
    title: 'Изменён доступный объём базы',
    details: `Новый доступный объём: ${storageCapacityLabel(limitBytes)}.`,
  });
  return json({ ok: true, limitBytes, capacityLabel: storageCapacityLabel(limitBytes), message: `Доступный объём базы обновлён: ${storageCapacityLabel(limitBytes)}.` });
}


export async function readDatabaseSizeBytes(db: D1Database) {
  const result = await db.prepare('SELECT 1 AS storage_probe').run();
  const sizeAfter = Number((result.meta as Record<string, unknown> | undefined)?.size_after);
  if (!Number.isFinite(sizeAfter) || sizeAfter <= 0) throw new Error('D1 не вернула фактический размер базы. Очистка остаётся заблокированной.');
  return Math.floor(sizeAfter);
}


export function almatyCurrentMonthKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value || String(new Date().getUTCFullYear());
  const month = parts.find((part) => part.type === 'month')?.value || String(new Date().getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}


export function shiftMonthKey(monthKey: string, deltaMonths: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return '';
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + deltaMonths, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}


export function normalizeStorageMonth(value: unknown) {
  const month = cleanText(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return '';
  return month;
}


export function normalizeStorageMonths(value: unknown) {
  const source = Array.isArray(value) ? value : [value];
  return Array.from(new Set(source.map(normalizeStorageMonth).filter(Boolean))).sort();
}


export function storageMonthBounds(month: string) {
  return {
    start: `${month}-01`,
    end: `${shiftMonthKey(month, 1)}-01`,
  };
}


export function storageProtectedStart() {
  const cutoffMonth = shiftMonthKey(almatyCurrentMonthKey(), -DATABASE_STORAGE_RETENTION_MONTHS);
  return storageMonthBounds(cutoffMonth).end;
}


export function storageMonthLabel(month: string) {
  const monthNames = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return `${monthNames[Number(match[2]) - 1] || match[2]} ${match[1]}`;
}


export function storageMonthIsOldEnough(month: string) {
  const currentMonth = almatyCurrentMonthKey();
  const currentYear = currentMonth.slice(0, 4);
  const cutoffMonth = shiftMonthKey(currentMonth, -DATABASE_STORAGE_RETENTION_MONTHS);
  return Boolean(month && month.slice(0, 4) < currentYear && month <= cutoffMonth);
}


export function storageCleanupConfirmation(months: string[]) {
  return `УДАЛИТЬ ${months.join(' ')}`;
}


export function parseJsonSetting<T>(value: string): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}


export function storageBlockedReasons(row: Record<string, unknown>) {
  const reasons: string[] = [];
  const debt = toInt(row.debt_order_count, 0);
  const unsent = toInt(row.unsent_order_count, 0);
  const workshop = toInt(row.live_workshop_task_count, 0);
  const recent = toInt(row.recent_linked_operation_count, 0);
  const reservations = toInt(row.active_reservation_count, 0);
  const lifecycle = toInt(row.pending_lifecycle_count, 0);
  if (debt > 0) reasons.push(`незакрытых долгов: ${debt}`);
  if (unsent > 0) reasons.push(`неотправленных заказов: ${unsent}`);
  if (workshop > 0) reasons.push(`активных задач цеха: ${workshop}`);
  if (reservations > 0) reasons.push(`активных или неразобранных резервов: ${reservations}`);
  if (lifecycle > 0) reasons.push(`незавершённых складских возвратов/обменов: ${lifecycle}`);
  if (recent > 0) reasons.push(`операций в защищённом периоде: ${recent}`);
  return reasons;
}


export function mapStorageMonthSummary(row: Record<string, unknown>): DatabaseStorageMonthSummary {
  const blockedReasons = storageBlockedReasons(row);
  const month = cleanText(row.month_key);
  return {
    month,
    label: storageMonthLabel(month),
    orderCount: toInt(row.order_count, 0),
    totalAmount: toInt(row.total_amount, 0),
    receivedAmount: toInt(row.received_amount, 0),
    returnAmount: toInt(row.return_amount, 0),
    debtOrderCount: toInt(row.debt_order_count, 0),
    unsentOrderCount: toInt(row.unsent_order_count, 0),
    liveWorkshopTaskCount: toInt(row.live_workshop_task_count, 0),
    recentLinkedOperationCount: toInt(row.recent_linked_operation_count, 0),
    activeReservationCount: toInt(row.active_reservation_count, 0),
    pendingLifecycleCount: toInt(row.pending_lifecycle_count, 0),
    canDelete: blockedReasons.length === 0 && toInt(row.order_count, 0) > 0,
    blockedReasons,
  };
}


export async function listDatabaseStorageMonths(db: D1Database) {
  const cutoffMonth = shiftMonthKey(almatyCurrentMonthKey(), -DATABASE_STORAGE_RETENTION_MONTHS);
  const cutoffEnd = storageMonthBounds(cutoffMonth).end;
  const protectedStart = storageProtectedStart();
  const rows = await db.prepare(
    `WITH month_orders AS (
       SELECT
         substr(o.order_date, 1, 7) AS month_key,
         COUNT(*) AS order_count,
         COALESCE(SUM(o.total_amount), 0) AS total_amount,
         COALESCE(SUM(o.received_amount), 0) AS received_amount,
         COALESCE(SUM(o.return_amount), 0) AS return_amount,
         COALESCE(SUM(CASE WHEN COALESCE(o.debt_amount, 0) > 0 THEN 1 ELSE 0 END), 0) AS debt_order_count,
         COALESCE(SUM(CASE
           WHEN COALESCE(o.order_status, 'active') = 'active'
             AND COALESCE(o.shipping_status, 'not_sent') <> 'sent'
             AND COALESCE(o.return_amount, 0) < COALESCE(o.total_amount, 0)
           THEN 1 ELSE 0 END), 0) AS unsent_order_count
       FROM orders o
       WHERE o.order_date < ?
       GROUP BY substr(o.order_date, 1, 7)
     ), live_workshop AS (
       SELECT substr(o.order_date, 1, 7) AS month_key, COUNT(*) AS live_workshop_task_count
       FROM workshop_tasks wt
       JOIN orders o ON o.id = wt.order_id
       WHERE o.order_date < ? AND wt.status IN ('active', 'ready')
       GROUP BY substr(o.order_date, 1, 7)
     ), recent_operations AS (
       SELECT month_key, SUM(operation_count) AS recent_linked_operation_count
       FROM (
         SELECT substr(o.order_date, 1, 7) AS month_key, COUNT(*) AS operation_count
         FROM orders o
         WHERE o.order_date < ? AND (
           COALESCE(o.shipping_date, '') >= ? OR COALESCE(o.ready_at, '') >= ? OR COALESCE(o.warehouse_received_at, '') >= ?
         ) GROUP BY substr(o.order_date, 1, 7)
         UNION ALL
         SELECT substr(o.order_date, 1, 7), COUNT(*)
         FROM payments p JOIN orders o ON o.id = p.order_id
         WHERE o.order_date < ? AND p.payment_date >= ? GROUP BY substr(o.order_date, 1, 7)
         UNION ALL
         SELECT substr(o.order_date, 1, 7), COUNT(*)
         FROM returns r JOIN orders o ON o.id = r.order_id
         WHERE o.order_date < ? AND (r.return_date >= ? OR COALESCE(r.cancelled_at, '') >= ?) GROUP BY substr(o.order_date, 1, 7)
         UNION ALL
         SELECT substr(o.order_date, 1, 7), COUNT(*)
         FROM exchanges e JOIN orders o ON o.id = e.order_id
         WHERE o.order_date < ? AND (e.exchange_date >= ? OR COALESCE(e.cancelled_at, '') >= ?) GROUP BY substr(o.order_date, 1, 7)
       ) grouped_recent
       GROUP BY month_key
     ), active_reservations AS (
       SELECT substr(o.order_date, 1, 7) AS month_key, COUNT(*) AS active_reservation_count
       FROM inventory_reservations ir JOIN orders o ON o.id = ir.order_id
       WHERE o.order_date < ? AND ir.status IN ('active', 'unresolved')
       GROUP BY substr(o.order_date, 1, 7)
     ), pending_lifecycle AS (
       SELECT substr(o.order_date, 1, 7) AS month_key, COUNT(*) AS pending_lifecycle_count
       FROM inventory_lifecycle_events ile JOIN orders o ON o.id = ile.order_id
       WHERE o.order_date < ? AND ile.status = 'pending'
       GROUP BY substr(o.order_date, 1, 7)
     )
     SELECT m.*, COALESCE(w.live_workshop_task_count, 0) AS live_workshop_task_count,
       COALESCE(r.recent_linked_operation_count, 0) AS recent_linked_operation_count,
       COALESCE(ar.active_reservation_count, 0) AS active_reservation_count,
       COALESCE(pl.pending_lifecycle_count, 0) AS pending_lifecycle_count
     FROM month_orders m
     LEFT JOIN live_workshop w ON w.month_key = m.month_key
     LEFT JOIN recent_operations r ON r.month_key = m.month_key
     LEFT JOIN active_reservations ar ON ar.month_key = m.month_key
     LEFT JOIN pending_lifecycle pl ON pl.month_key = m.month_key
     ORDER BY m.month_key ASC
     LIMIT 120`
  ).bind(
    cutoffEnd,
    cutoffEnd,
    cutoffEnd, protectedStart, protectedStart, protectedStart,
    cutoffEnd, protectedStart,
    cutoffEnd, protectedStart, protectedStart,
    cutoffEnd, protectedStart, protectedStart,
    cutoffEnd,
    cutoffEnd,
  ).all<Record<string, unknown>>();
  return (rows.results || []).map(mapStorageMonthSummary);
}


export async function getDatabaseStorageMonthSummary(db: D1Database, month: string) {
  const bounds = storageMonthBounds(month);
  const protectedStart = storageProtectedStart();
  const row = await db.prepare(
    `SELECT
       ? AS month_key,
       COUNT(*) AS order_count,
       COALESCE(SUM(o.total_amount), 0) AS total_amount,
       COALESCE(SUM(o.received_amount), 0) AS received_amount,
       COALESCE(SUM(o.return_amount), 0) AS return_amount,
       COALESCE(SUM(CASE WHEN COALESCE(o.debt_amount, 0) > 0 THEN 1 ELSE 0 END), 0) AS debt_order_count,
       COALESCE(SUM(CASE
         WHEN COALESCE(o.order_status, 'active') = 'active'
           AND COALESCE(o.shipping_status, 'not_sent') <> 'sent'
           AND COALESCE(o.return_amount, 0) < COALESCE(o.total_amount, 0)
         THEN 1 ELSE 0 END), 0) AS unsent_order_count,
       COALESCE((SELECT COUNT(*) FROM workshop_tasks wt JOIN orders wo ON wo.id = wt.order_id
         WHERE wo.order_date >= ? AND wo.order_date < ? AND wt.status IN ('active', 'ready')), 0) AS live_workshop_task_count,
       COALESCE((SELECT COUNT(*) FROM orders ro WHERE ro.order_date >= ? AND ro.order_date < ? AND (
         COALESCE(ro.shipping_date, '') >= ? OR COALESCE(ro.ready_at, '') >= ? OR COALESCE(ro.warehouse_received_at, '') >= ?)), 0)
       + COALESCE((SELECT COUNT(*) FROM payments p JOIN orders po ON po.id = p.order_id
         WHERE po.order_date >= ? AND po.order_date < ? AND p.payment_date >= ?), 0)
       + COALESCE((SELECT COUNT(*) FROM returns r JOIN orders rr ON rr.id = r.order_id
         WHERE rr.order_date >= ? AND rr.order_date < ? AND (r.return_date >= ? OR COALESCE(r.cancelled_at, '') >= ?)), 0)
       + COALESCE((SELECT COUNT(*) FROM exchanges e JOIN orders eo ON eo.id = e.order_id
         WHERE eo.order_date >= ? AND eo.order_date < ? AND (e.exchange_date >= ? OR COALESCE(e.cancelled_at, '') >= ?)), 0)
       AS recent_linked_operation_count,
       COALESCE((SELECT COUNT(*) FROM inventory_reservations ir JOIN orders iro ON iro.id = ir.order_id
         WHERE iro.order_date >= ? AND iro.order_date < ? AND ir.status IN ('active', 'unresolved')), 0) AS active_reservation_count,
       COALESCE((SELECT COUNT(*) FROM inventory_lifecycle_events ile JOIN orders ilo ON ilo.id = ile.order_id
         WHERE ilo.order_date >= ? AND ilo.order_date < ? AND ile.status = 'pending'), 0) AS pending_lifecycle_count
     FROM orders o
     WHERE o.order_date >= ? AND o.order_date < ?`
  ).bind(
    month,
    bounds.start, bounds.end,
    bounds.start, bounds.end, protectedStart, protectedStart, protectedStart,
    bounds.start, bounds.end, protectedStart,
    bounds.start, bounds.end, protectedStart, protectedStart,
    bounds.start, bounds.end, protectedStart, protectedStart,
    bounds.start, bounds.end,
    bounds.start, bounds.end,
    bounds.start, bounds.end,
  ).first<Record<string, unknown>>();
  return mapStorageMonthSummary(row || { month_key: month });
}


export async function countOrdersInStorageMonth(db: D1Database, month: string) {
  const bounds = storageMonthBounds(month);
  const row = await db.prepare('SELECT COUNT(*) AS count FROM orders WHERE order_date >= ? AND order_date < ?').bind(bounds.start, bounds.end).first<{ count: number }>();
  return toInt(row?.count, 0);
}


export async function countOrdersInStorageMonths(db: D1Database, months: string[]) {
  if (!months.length) return 0;
  const clauses: string[] = [];
  const binds: string[] = [];
  for (const month of months) {
    const bounds = storageMonthBounds(month);
    clauses.push('(order_date >= ? AND order_date < ?)');
    binds.push(bounds.start, bounds.end);
  }
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE ${clauses.join(' OR ')}`).bind(...binds).first<{ count: number }>();
  return toInt(row?.count, 0);
}


export async function finalizeDatabaseStorageCleanup(db: D1Database, operation: DatabaseStorageCleanupOperation, deletedThisBatch = 0) {
  if (operation.pendingBatch) throw new Error('Нельзя завершить очистку, пока не обработана текущая партия.');
  const completedAt = new Date().toISOString();
  const sizeAfterBytes = await readDatabaseSizeBytes(db);
  const remainingOrders = await countOrdersInStorageMonths(db, operation.months);
  const deletedOrders = Math.max(0, operation.initialOrders - remainingOrders);
  const record: DatabaseStorageCleanupRecord = {
    months: operation.months,
    deletedOrders,
    completedAt,
    sizeBeforeBytes: operation.sizeBeforeBytes,
    sizeAfterBytes,
  };
  await setAppSetting(db, DATABASE_STORAGE_LAST_CLEANUP_SETTING, JSON.stringify(record));
  await deleteAppSetting(db, DATABASE_STORAGE_OPERATION_SETTING);
  await writeActivityLog(db, {
    eventType: 'database_old_months_deleted',
    entityType: 'database_storage',
    title: `Удалены старые данные: ${operation.months.map(storageMonthLabel).join(', ')}`,
    details: `Месяцев: ${operation.months.length}; заказов: ${deletedOrders}; размер до: ${operation.sizeBeforeBytes}; размер после: ${sizeAfterBytes}.`,
    createdAt: completedAt,
  });
  return {
    ok: true,
    done: true,
    months: operation.months,
    currentMonth: operation.months.at(-1) || '',
    completedMonths: operation.months,
    initialOrders: operation.initialOrders,
    deletedOrders,
    deletedThisBatch,
    remainingOrders: 0,
    sizeAfterBytes,
    message: `Удаление выбранных месяцев завершено. Удалено заказов: ${deletedOrders}.`,
  };
}


export async function activeDatabaseStorageStocktakeCount(db: D1Database) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM inventory_stocktake_sessions WHERE status = 'active'`).first<{ count: number }>();
  return Math.max(0, toInt(row?.count, 0));
}


export async function databaseStoragePendingBatchBlockReason(db: D1Database, pending: DatabaseStorageCleanupPendingBatch) {
  const activeStocktakes = await activeDatabaseStorageStocktakeCount(db);
  if (activeStocktakes > 0) return `сейчас открыта ревизия (${activeStocktakes}). Завершите или отмените её перед очисткой базы`;
  const ids = pending.orderRows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return '';
  const marks = sqlQuestionMarks(ids.length);
  const row = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM inventory_reservations WHERE order_id IN (${marks}) AND status IN ('active', 'unresolved')) AS reservations,
       (SELECT COUNT(*) FROM inventory_lifecycle_events WHERE order_id IN (${marks}) AND status = 'pending') AS lifecycle`
  ).bind(...ids, ...ids).first<Record<string, unknown>>();
  const reservations = toInt(row?.reservations, 0);
  const lifecycle = toInt(row?.lifecycle, 0);
  if (reservations > 0) return `в текущей партии появились активные или неразобранные резервы (${reservations})`;
  if (lifecycle > 0) return `в текущей партии появились незавершённые складские возвраты/обмены (${lifecycle})`;
  return '';
}


export async function getDatabaseStorageStatus(db: D1Database, includeMonths: boolean) {
  const currentSizeBytes = await readDatabaseSizeBytes(db);
  const limitBytes = await storageLimitBytes(db);
  const usagePercent = limitBytes > 0 ? (currentSizeBytes / limitBytes) * 100 : 0;
  const activeStocktakeCount = await activeDatabaseStorageStocktakeCount(db);
  const warningLevel: DatabaseStorageWarningLevel = usagePercent >= DATABASE_STORAGE_CRITICAL_PERCENT
    ? 'critical'
    : usagePercent >= DATABASE_STORAGE_WARNING_PERCENT
      ? 'warning'
      : 'normal';
  const parsedOperation = parseJsonSetting<DatabaseStorageCleanupOperation>(await getAppSetting(db, DATABASE_STORAGE_OPERATION_SETTING, ''));
  const operation = parsedOperation?.version === 2 && Array.isArray(parsedOperation.months) ? parsedOperation : null;
  const remainingOrders = operation ? await countOrdersInStorageMonths(db, operation.months) : 0;
  const lastCleanup = parseJsonSetting<DatabaseStorageCleanupRecord>(await getAppSetting(db, DATABASE_STORAGE_LAST_CLEANUP_SETTING, ''));
  return {
    ok: true,
    currentSizeBytes,
    limitBytes,
    usagePercent,
    warningLevel,
    cleanupThresholdPercent: DATABASE_STORAGE_WARNING_PERCENT,
    cleanupAllowed: usagePercent >= DATABASE_STORAGE_WARNING_PERCENT && activeStocktakeCount === 0,
    cleanupThresholdReached: usagePercent >= DATABASE_STORAGE_WARNING_PERCENT,
    activeStocktakeCount,
    cleanupBlockedReason: activeStocktakeCount > 0 ? 'Сейчас открыта ревизия. Очистка базы станет доступна после её завершения или отмены.' : '',
    capacityLabel: storageCapacityLabel(limitBytes),
    retentionMonths: DATABASE_STORAGE_RETENTION_MONTHS,
    maxSelectedMonths: DATABASE_STORAGE_MAX_SELECTED_MONTHS,
    months: includeMonths ? await listDatabaseStorageMonths(db) : [],
    activeCleanup: operation ? {
      months: operation.months,
      currentMonth: operation.months[Math.min(operation.currentMonthIndex, operation.months.length - 1)] || '',
      initialOrders: operation.initialOrders,
      remainingOrders,
      startedAt: operation.startedAt,
    } : null,
    lastCleanup,
  };
}


export async function tableNames(db: D1Database, names: string[]) {
  if (!names.length) return new Set<string>();
  const rows = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${sqlQuestionMarks(names.length)})`).bind(...names).all<{ name: string }>();
  return new Set((rows.results || []).map((row) => cleanText(row.name)).filter(Boolean));
}


export async function deleteByNumericIds(db: D1Database, table: string, column: string, ids: number[]) {
  for (const chunk of chunksOf(Array.from(new Set(ids.filter(Boolean))), 80)) {
    await db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${sqlQuestionMarks(chunk.length)})`).bind(...chunk).run();
  }
}


export async function recalculateCustomersAfterStorageCleanup(db: D1Database, customerIds: number[]) {
  const now = new Date().toISOString();
  for (const chunk of chunksOf(Array.from(new Set(customerIds.filter(Boolean))), 70)) {
    await db.prepare(
      `UPDATE customers
       SET orders_count = COALESCE((
             SELECT COUNT(*) FROM (
               SELECT o.order_date FROM orders o WHERE o.customer_id = customers.id AND o.order_status <> 'deleted'
               UNION ALL
               SELECT s.order_date FROM retained_order_summaries s WHERE s.customer_id = customers.id AND NOT EXISTS (SELECT 1 FROM orders current_order WHERE current_order.id = s.original_order_id)
             ) history
           ), 0),
           first_order_at = (
             SELECT MIN(order_date) FROM (
               SELECT o.order_date FROM orders o WHERE o.customer_id = customers.id AND o.order_status <> 'deleted'
               UNION ALL
               SELECT s.order_date FROM retained_order_summaries s WHERE s.customer_id = customers.id AND NOT EXISTS (SELECT 1 FROM orders current_order WHERE current_order.id = s.original_order_id)
             ) history
           ),
           last_order_at = (
             SELECT MAX(order_date) FROM (
               SELECT o.order_date FROM orders o WHERE o.customer_id = customers.id AND o.order_status <> 'deleted'
               UNION ALL
               SELECT s.order_date FROM retained_order_summaries s WHERE s.customer_id = customers.id AND NOT EXISTS (SELECT 1 FROM orders current_order WHERE current_order.id = s.original_order_id)
             ) history
           ),
           updated_at = ?
       WHERE id IN (${sqlQuestionMarks(chunk.length)})`
    ).bind(now, ...chunk).run();
  }
}


export async function loadDatabaseStorageCleanupBatch(db: D1Database, month: string) {
  const bounds = storageMonthBounds(month);
  const rows = await db.prepare(
    `SELECT id, external_id, customer_id FROM orders
     WHERE order_date >= ? AND order_date < ? ORDER BY id ASC LIMIT ?`
  ).bind(bounds.start, bounds.end, DATABASE_STORAGE_CLEANUP_BATCH_SIZE).all<Record<string, unknown>>();
  return rows.results || [];
}


export function valuesCte(rows: Array<{ id: number; external_id: string }>) {
  return {
    sql: rows.map(() => '(?, ?)').join(', '),
    binds: rows.flatMap((row) => [row.id, row.external_id]),
  };
}


export async function prepareDatabaseStorageCleanupPendingBatch(db: D1Database, month: string) {
  const rawRows = await loadDatabaseStorageCleanupBatch(db, month);
  const orderRows = rawRows.map((row) => ({
    id: toInt(row.id, 0),
    external_id: cleanText(row.external_id),
    customer_id: toInt(row.customer_id, 0),
  })).filter((row) => row.id > 0);
  if (!orderRows.length) return null;
  const orderIds = orderRows.map((row) => row.id);
  const relatedRows = await db.prepare(
    `WITH target_orders(id) AS (VALUES ${orderIds.map(() => '(?)').join(', ')})
     SELECT 'return' AS kind, id FROM returns WHERE order_id IN (SELECT id FROM target_orders)
     UNION ALL SELECT 'exchange', id FROM exchanges WHERE order_id IN (SELECT id FROM target_orders)
     UNION ALL SELECT 'workshop_task', id FROM workshop_tasks WHERE order_id IN (SELECT id FROM target_orders)`
  ).bind(...orderIds).all<Record<string, unknown>>();
  const related = new Map<string, number[]>();
  for (const row of relatedRows.results || []) {
    const kind = cleanText(row.kind);
    const id = toInt(row.id, 0);
    if (!kind || !id) continue;
    const ids = related.get(kind) || [];
    ids.push(id);
    related.set(kind, ids);
  }
  const cte = valuesCte(orderRows);
  const movementRows = await db.prepare(
    `WITH target_orders(order_id, external_id) AS (VALUES ${cte.sql})
     SELECT id FROM inventory_movements
     WHERE (reference_type IN ('order', 'order_edit_new', 'order_manual_writeoff') AND reference_id IN (SELECT external_id FROM target_orders))
        OR (reference_type = 'return' AND reference_id IN (SELECT 'return:' || id FROM returns WHERE order_id IN (SELECT order_id FROM target_orders)))
        OR (reference_type = 'return_cancel' AND reference_id IN (SELECT CAST(id AS TEXT) FROM returns WHERE order_id IN (SELECT order_id FROM target_orders)))
        OR (reference_type = 'exchange' AND reference_id IN (SELECT 'exchange:' || id FROM exchanges WHERE order_id IN (SELECT order_id FROM target_orders)))
        OR (reference_type IN ('exchange_new', 'exchange_cancel') AND reference_id IN (SELECT CAST(id AS TEXT) FROM exchanges WHERE order_id IN (SELECT order_id FROM target_orders)))`
  ).bind(...cte.binds).all<{ id: number }>();
  return {
    month,
    orderRows,
    customerIds: Array.from(new Set(orderRows.map((row) => row.customer_id).filter(Boolean))),
    returnIds: Array.from(new Set((related.get('return') || []).filter(Boolean))),
    exchangeIds: Array.from(new Set((related.get('exchange') || []).filter(Boolean))),
    workshopTaskIds: Array.from(new Set((related.get('workshop_task') || []).filter(Boolean))),
    movementQueue: Array.from(new Set((movementRows.results || []).map((row) => toInt(row.id, 0)).filter(Boolean))),
    phase: 'movements' as const,
  };
}


export async function processDatabaseStorageMovementPhase(db: D1Database, pending: DatabaseStorageCleanupPendingBatch) {
  if (!pending.movementQueue.length) {
    pending.phase = 'legacy';
    return;
  }
  const seeds = pending.movementQueue.slice(0, 30);
  const connectedRows = await db.prepare(
    `WITH RECURSIVE connected(id) AS (
       VALUES ${seeds.map(() => '(?)').join(', ')}
       UNION
       SELECT imr.original_movement_id
       FROM inventory_movement_reversals imr JOIN connected c ON imr.reversal_movement_id = c.id
       WHERE imr.original_movement_id IS NOT NULL
       UNION
       SELECT imr.reversal_movement_id
       FROM inventory_movement_reversals imr JOIN connected c ON imr.original_movement_id = c.id
       WHERE imr.reversal_movement_id IS NOT NULL
     )
     SELECT DISTINCT id FROM connected WHERE id IS NOT NULL`
  ).bind(...seeds).all<{ id: number }>();
  const connectedIds = Array.from(new Set([
    ...seeds,
    ...(connectedRows.results || []).map((row) => toInt(row.id, 0)),
  ].filter(Boolean)));
  if (connectedIds.length > DATABASE_STORAGE_MAX_MOVEMENT_COMPONENT) {
    throw new Error(`У одного заказа найдено слишком много связанных складских движений (${connectedIds.length}). Очистка остановлена без удаления этой партии.`);
  }
  const orderIds = pending.orderRows.map((row) => row.id).filter(Boolean);
  const movementMarks = sqlQuestionMarks(connectedIds.length);
  const orderMarks = sqlQuestionMarks(orderIds.length);
  const foreignLifecycle = connectedIds.length && orderIds.length
    ? await db.prepare(
        `SELECT COUNT(*) AS count FROM inventory_lifecycle_events
         WHERE (movement_id IN (${movementMarks}) OR reversal_movement_id IN (${movementMarks}))
           AND order_id NOT IN (${orderMarks})`
      ).bind(...connectedIds, ...connectedIds, ...orderIds).first<{ count: number }>()
    : null;
  if (toInt(foreignLifecycle?.count, 0) > 0) {
    throw new Error('Связанное складское движение используется другой операцией. Очистка остановлена до ручной проверки.');
  }
  if (orderIds.length) {
    const pendingLifecycle = await db.prepare(`SELECT COUNT(*) AS count FROM inventory_lifecycle_events WHERE order_id IN (${orderMarks}) AND status = 'pending'`).bind(...orderIds).first<{ count: number }>();
    if (toInt(pendingLifecycle?.count, 0) > 0) throw new Error('В партии появился незавершённый складской возврат или обмен. Очистка остановлена.');
    await deleteByNumericIds(db, 'inventory_lifecycle_events', 'order_id', orderIds);
  }
  for (const chunk of chunksOf(connectedIds, 80)) {
    const marks = sqlQuestionMarks(chunk.length);
    await db.prepare(`DELETE FROM activity_log WHERE entity_type = 'inventory' AND entity_id IN (${marks})`).bind(...chunk).run();
    await db.prepare(`DELETE FROM inventory_movement_reversals WHERE original_movement_id IN (${marks}) OR reversal_movement_id IN (${marks})`).bind(...chunk, ...chunk).run();
  }
  await deleteByNumericIds(db, 'inventory_movements', 'id', connectedIds);
  const removed = new Set(connectedIds);
  pending.movementQueue = pending.movementQueue.filter((id) => !removed.has(id));
  if (!pending.movementQueue.length) pending.phase = 'legacy';
}


export async function processDatabaseStorageLegacyPhase(db: D1Database, pending: DatabaseStorageCleanupPendingBatch) {
  const orderIds = pending.orderRows.map((row) => row.id);
  const optionalTables = await tableNames(db, ['financial_integrity_repairs', 'order_manager_audit', 'manager_integrity_repairs', 'workshop_integrity_repairs']);
  if (optionalTables.has('financial_integrity_repairs')) await deleteByNumericIds(db, 'financial_integrity_repairs', 'order_id', orderIds);
  if (optionalTables.has('order_manager_audit')) await deleteByNumericIds(db, 'order_manager_audit', 'order_id', orderIds);
  if (optionalTables.has('manager_integrity_repairs')) await deleteByNumericIds(db, 'manager_integrity_repairs', 'order_id', orderIds);
  if (optionalTables.has('workshop_integrity_repairs')) await deleteByNumericIds(db, 'workshop_integrity_repairs', 'order_id', orderIds);
  pending.phase = 'activity';
}


export async function processDatabaseStorageActivityPhase(db: D1Database, pending: DatabaseStorageCleanupPendingBatch) {
  const cte = valuesCte(pending.orderRows);
  await db.prepare(
    `WITH target_orders(order_id, external_id) AS (VALUES ${cte.sql})
     DELETE FROM activity_log WHERE
       order_id IN (SELECT order_id FROM target_orders)
       OR external_order_id IN (SELECT external_id FROM target_orders)
       OR (entity_type = 'order' AND entity_id IN (SELECT order_id FROM target_orders))
       OR (entity_type = 'payment' AND entity_id IN (SELECT id FROM payments WHERE order_id IN (SELECT order_id FROM target_orders)))
       OR (entity_type = 'return' AND entity_id IN (SELECT id FROM returns WHERE order_id IN (SELECT order_id FROM target_orders)))
       OR (entity_type = 'exchange' AND entity_id IN (SELECT id FROM exchanges WHERE order_id IN (SELECT order_id FROM target_orders)))
       OR (entity_type = 'workshop_task' AND entity_id IN (SELECT id FROM workshop_tasks WHERE order_id IN (SELECT order_id FROM target_orders)))`
  ).bind(...cte.binds).run();
  if (pending.returnIds.length) await deleteByNumericIds(db, 'return_workshop_task_reversals', 'return_id', pending.returnIds);
  if (pending.workshopTaskIds.length) await deleteByNumericIds(db, 'return_workshop_task_reversals', 'workshop_task_id', pending.workshopTaskIds);
  pending.phase = 'core';
}


export async function retainOrderSummariesForStorageCleanup(db: D1Database, orderIds: number[]) {
  const uniqueIds = Array.from(new Set(orderIds.filter(Boolean)));
  if (!uniqueIds.length) return;
  const now = new Date().toISOString();
  for (const chunk of chunksOf(uniqueIds, 70)) {
    const marks = sqlQuestionMarks(chunk.length);
    await db.prepare(
      `INSERT INTO retained_order_summaries (
         original_order_id, external_id, order_date, customer_id, customer_phone, customer_name,
         manager_id, manager_name, city, delivery_type, source_type,
         total_amount, received_amount, debt_amount, return_amount,
         order_status, shipping_status, shipping_date,
         item_count, payment_count, return_count, item_summary,
         retained_reason, retained_at
       )
       SELECT
         o.id, o.external_id, o.order_date, o.customer_id, c.phone_normalized, c.display_name,
         o.manager_id, COALESCE(NULLIF(m.name, ''), NULLIF(o.manager_snapshot_name, ''), ''),
         o.city, o.delivery_type, o.source_type,
         o.total_amount, o.received_amount, o.debt_amount, o.return_amount,
         o.order_status, o.shipping_status, o.shipping_date,
         (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.quantity > 0),
         (SELECT COUNT(*) FROM payments p WHERE p.order_id = o.id),
         (SELECT COUNT(*) FROM returns r WHERE r.order_id = o.id AND COALESCE(r.status, 'completed') <> 'cancelled'),
         COALESCE((
           SELECT GROUP_CONCAT(
             TRIM(COALESCE(oi.product_name_snapshot, '') ||
               CASE WHEN NULLIF(TRIM(COALESCE(oi.size_snapshot, '')), '') IS NOT NULL THEN ' · ' || TRIM(oi.size_snapshot) ELSE '' END ||
               ' × ' || CAST(COALESCE(oi.quantity, 0) AS TEXT)),
             '; '
           )
           FROM order_items oi
           WHERE oi.order_id = o.id AND oi.quantity > 0
         ), ''),
         'storage_cleanup', ?
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN managers m ON m.id = o.manager_id
       WHERE o.id IN (${marks})
       ON CONFLICT(external_id) DO UPDATE SET
         original_order_id = excluded.original_order_id,
         order_date = excluded.order_date,
         customer_id = excluded.customer_id,
         customer_phone = excluded.customer_phone,
         customer_name = excluded.customer_name,
         manager_id = excluded.manager_id,
         manager_name = excluded.manager_name,
         city = excluded.city,
         delivery_type = excluded.delivery_type,
         source_type = excluded.source_type,
         total_amount = excluded.total_amount,
         received_amount = excluded.received_amount,
         debt_amount = excluded.debt_amount,
         return_amount = excluded.return_amount,
         order_status = excluded.order_status,
         shipping_status = excluded.shipping_status,
         shipping_date = excluded.shipping_date,
         item_count = excluded.item_count,
         payment_count = excluded.payment_count,
         return_count = excluded.return_count,
         item_summary = excluded.item_summary,
         retained_reason = excluded.retained_reason,
         retained_at = excluded.retained_at`
    ).bind(now, ...chunk).run();

    const verification = await db.prepare(
      `SELECT COUNT(*) AS count FROM retained_order_summaries WHERE original_order_id IN (${marks})`
    ).bind(...chunk).first<{ count: number }>();
    if (toInt(verification?.count, 0) !== chunk.length) {
      throw new Error('Не удалось сохранить краткую историю всех заказов. Очистка остановлена до удаления деталей.');
    }
  }
}


export async function processDatabaseStorageCorePhase(db: D1Database, pending: DatabaseStorageCleanupPendingBatch) {
  const orderIds = pending.orderRows.map((row) => row.id);
  await retainOrderSummariesForStorageCleanup(db, orderIds);
  if (pending.exchangeIds.length) await deleteByNumericIds(db, 'exchange_items', 'exchange_id', pending.exchangeIds);
  if (pending.returnIds.length) await deleteByNumericIds(db, 'return_items', 'return_id', pending.returnIds);
  await deleteByNumericIds(db, 'exchanges', 'order_id', orderIds);
  await deleteByNumericIds(db, 'returns', 'order_id', orderIds);
  await deleteByNumericIds(db, 'workshop_tasks', 'order_id', orderIds);
  await deleteByNumericIds(db, 'payments', 'order_id', orderIds);
  await deleteByNumericIds(db, 'order_items', 'order_id', orderIds);
  await deleteByNumericIds(db, 'orders', 'id', orderIds);
  await recalculateCustomersAfterStorageCleanup(db, pending.customerIds);
  return orderIds.length;
}


export async function startDatabaseStorageCleanup(db: D1Database, env: Env, request: Request) {
  const input = await readJson<{ months?: unknown; confirmation?: unknown; currentPassword?: unknown; reportsConfirmed?: unknown }>(request);
  const months = normalizeStorageMonths(input.months);
  if (!months.length || months.length > DATABASE_STORAGE_MAX_SELECTED_MONTHS || months.some((month) => !storageMonthIsOldEnough(month))) {
    return json({ ok: false, message: 'Выбранные месяцы ещё нельзя удалять. Текущий год и последние 12 месяцев защищены.' }, { status: 409 });
  }
  let existing = parseJsonSetting<DatabaseStorageCleanupOperation>(await getAppSetting(db, DATABASE_STORAGE_OPERATION_SETTING, ''));
  const existingMonths = Array.isArray(existing?.months) ? existing!.months : [];
  const sameSelection = Boolean(existing?.version === 2 && existingMonths.join('|') === months.join('|'));
  const currentSizeBytes = await readDatabaseSizeBytes(db);
  const limitBytes = await storageLimitBytes(db);
  const usagePercent = limitBytes > 0 ? (currentSizeBytes / limitBytes) * 100 : 0;
  const activeStocktakes = await activeDatabaseStorageStocktakeCount(db);
  if (activeStocktakes > 0) {
    return json({ ok: false, message: 'Очистка базы недоступна, пока открыта ревизия. Завершите или отмените ревизию и повторите.' }, { status: 409 });
  }
  if (usagePercent < DATABASE_STORAGE_WARNING_PERCENT && !sameSelection) {
    return json({ ok: false, message: `Очистка заблокирована: база заполнена только на ${usagePercent.toFixed(2)}%. Удаление открывается после ${DATABASE_STORAGE_WARNING_PERCENT}%.` }, { status: 409 });
  }
  if (input.reportsConfirmed !== true) return json({ ok: false, message: 'Подтвердите, что нужные отчёты сохранены.' }, { status: 400 });
  const expected = storageCleanupConfirmation(months);
  if (normalizeImportConfirmText(input.confirmation) !== expected) {
    return json({ ok: false, message: `Введите точное подтверждение: ${expected}` }, { status: 400 });
  }
  const currentPassword = cleanText(input.currentPassword);
  if (!currentPassword || !(await verifySimpleAdminPassword(db, env, currentPassword))) {
    return json({ ok: false, message: 'Текущий пароль администратора указан неверно.' }, { status: 401 });
  }

  const summaries: DatabaseStorageMonthSummary[] = [];
  for (const month of months) summaries.push(await getDatabaseStorageMonthSummary(db, month));

  const now = new Date();
  const emptyMonth = summaries.find((summary) => !summary.orderCount);
  if (emptyMonth && !sameSelection) return json({ ok: false, message: `В месяце ${emptyMonth.month} больше нет заказов.` }, { status: 404 });
  const blocked = summaries.find((summary) => summary.orderCount > 0 && !summary.canDelete);
  if (blocked) return json({ ok: false, message: `${blocked.label} нельзя удалить: ${blocked.blockedReasons.join(', ')}.` }, { status: 409 });
  if (existing && !sameSelection) {
    const previousRemaining = existingMonths.length ? await countOrdersInStorageMonths(db, existingMonths) : 0;
    if (previousRemaining > 0 || existing.pendingBatch) {
      return json({ ok: false, message: `Сначала завершите текущую очистку: ${existingMonths.join(', ') || 'неизвестный период'}.` }, { status: 409 });
    }
    await deleteAppSetting(db, DATABASE_STORAGE_OPERATION_SETTING);
    existing = null;
  }

  const operationToken = randomToken(24);
  const tokenHash = await sha256Base64Url(operationToken);
  let operation: DatabaseStorageCleanupOperation;
  if (sameSelection && existing?.version === 2) {
    operation = {
      ...existing,
      tokenHash,
      expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      lastProgressAt: now.toISOString(),
    };
  } else {
    const initialOrdersByMonth = Object.fromEntries(summaries.map((summary) => [summary.month, summary.orderCount]));
    operation = {
      version: 2,
      months,
      tokenHash,
      initialOrdersByMonth,
      initialOrders: summaries.reduce((sum, summary) => sum + summary.orderCount, 0),
      currentMonthIndex: 0,
      completedMonths: [],
      sizeBeforeBytes: currentSizeBytes,
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      pendingBatch: null,
    };
  }
  await setAppSetting(db, DATABASE_STORAGE_OPERATION_SETTING, JSON.stringify(operation));
  return json({
    ok: true,
    operationToken,
    months,
    initialOrders: operation.initialOrders,
    remainingOrders: await countOrdersInStorageMonths(db, months),
    message: sameSelection ? 'Незавершённая очистка безопасно продолжена.' : `Очистка подготовлена. Выбрано месяцев: ${months.length}.`,
  });
}


export async function continueDatabaseStorageCleanup(db: D1Database, request: Request) {
  const input = await readJson<{ operationToken?: unknown }>(request);
  const operationToken = cleanText(input.operationToken);
  const operation = parseJsonSetting<DatabaseStorageCleanupOperation>(await getAppSetting(db, DATABASE_STORAGE_OPERATION_SETTING, ''));
  if (!operation || operation.version !== 2 || !operationToken || new Date(operation.expiresAt).getTime() <= Date.now()) {
    return json({ ok: false, message: 'Сессия очистки истекла или относится к старой версии. Снова выберите те же месяцы и подтвердите удаление.' }, { status: 409 });
  }
  if ((await sha256Base64Url(operationToken)) !== operation.tokenHash) return json({ ok: false, message: 'Неверный ключ операции очистки.' }, { status: 403 });
  const activeStocktakes = await activeDatabaseStorageStocktakeCount(db);
  if (activeStocktakes > 0) return json({ ok: false, message: 'Очистка приостановлена: сейчас открыта ревизия. Завершите или отмените её и продолжите ту же очистку.' }, { status: 409 });
  if (operation.pendingBatch) {
    const pendingBlock = await databaseStoragePendingBatchBlockReason(db, operation.pendingBatch);
    if (pendingBlock) return json({ ok: false, message: `Очистка приостановлена: ${pendingBlock}. После устранения причины продолжите ту же очистку.` }, { status: 409 });
  }

  let deletedThisBatch = 0;
  while (!operation.pendingBatch && operation.currentMonthIndex < operation.months.length) {
    const month = operation.months[operation.currentMonthIndex];
    if (await countOrdersInStorageMonth(db, month) > 0) break;
    if (!operation.completedMonths.includes(month)) operation.completedMonths.push(month);
    operation.currentMonthIndex += 1;
  }
  if (!operation.pendingBatch && operation.currentMonthIndex >= operation.months.length) return json(await finalizeDatabaseStorageCleanup(db, operation));

  const currentMonth = operation.pendingBatch?.month || operation.months[operation.currentMonthIndex];
  if (!operation.pendingBatch) {
    const summary = await getDatabaseStorageMonthSummary(db, currentMonth);
    if (summary.orderCount > 0 && !summary.canDelete) {
      return json({ ok: false, message: `Очистка остановлена на ${summary.label}: ${summary.blockedReasons.join(', ')}.` }, { status: 409 });
    }
    operation.pendingBatch = await prepareDatabaseStorageCleanupPendingBatch(db, currentMonth);
    if (!operation.pendingBatch) {
      if (!operation.completedMonths.includes(currentMonth)) operation.completedMonths.push(currentMonth);
      operation.currentMonthIndex += 1;
    }
  } else if (operation.pendingBatch.phase === 'movements') {
    await processDatabaseStorageMovementPhase(db, operation.pendingBatch);
  } else if (operation.pendingBatch.phase === 'legacy') {
    await processDatabaseStorageLegacyPhase(db, operation.pendingBatch);
  } else if (operation.pendingBatch.phase === 'activity') {
    await processDatabaseStorageActivityPhase(db, operation.pendingBatch);
  } else if (operation.pendingBatch.phase === 'core') {
    deletedThisBatch = await processDatabaseStorageCorePhase(db, operation.pendingBatch);
    operation.pendingBatch = null;
    if (await countOrdersInStorageMonth(db, currentMonth) === 0) {
      if (!operation.completedMonths.includes(currentMonth)) operation.completedMonths.push(currentMonth);
      operation.currentMonthIndex += 1;
    }
  }

  const remainingOrders = await countOrdersInStorageMonths(db, operation.months);
  const deletedOrders = Math.max(0, operation.initialOrders - remainingOrders);
  if (remainingOrders === 0 && !operation.pendingBatch) return json(await finalizeDatabaseStorageCleanup(db, operation, deletedThisBatch));

  operation.lastProgressAt = new Date().toISOString();
  operation.expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  await setAppSetting(db, DATABASE_STORAGE_OPERATION_SETTING, JSON.stringify(operation));
  return json({
    ok: true,
    done: false,
    months: operation.months,
    currentMonth: operation.pendingBatch?.month || operation.months[Math.min(operation.currentMonthIndex, operation.months.length - 1)] || currentMonth,
    completedMonths: operation.completedMonths,
    initialOrders: operation.initialOrders,
    deletedOrders,
    deletedThisBatch,
    remainingOrders,
  });
}



export async function isInventoryAutoWriteoffEnabled(db: D1Database) {
  return (await getAppSetting(db, 'inventory_auto_writeoff_enabled', '1')) !== '0';
}
