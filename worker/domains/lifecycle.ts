// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import type { CatalogReferenceOptions, CatalogResolutionContext, CatalogResolutionResponse } from '../../shared/api-contracts.ts'
import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, normalizeSourceType, toInt, upperText } from '../core/text.ts'
import type { ReferenceKind } from '../core/types.ts'
import { assertCatalogProductAliasTargetAvailable, catalogReferenceDbValueExists, createCatalogCombinationV3, createCatalogProduct, ensureCatalogExecutionV3, findCatalogCombinationV3, findCatalogExecutionV3, findCatalogProductByIdentity, loadCanonicalVariantSnapshot, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, rememberCatalogProductAlias, rememberCatalogValueAlias, resolveCatalogValueAlias } from './catalog.ts'
import type { CatalogReviewFactsInput } from './catalog-review.ts'
import { catalogReviewRowToOrderItem } from './catalog-review.ts'
import type { ResolvedOrderCatalogReference } from './order-reservations.ts'
import { catalogOrderInputKey, ensureHumanInventoryStockRow, resolveCatalogProductAndVariantV2 } from './order-reservations.ts'
import { upsertReferenceValue } from './references.ts'

export async function getOrderItemForReturnOrExchange(db: D1Database, orderId: number, orderItemId: number) {
  if (!orderItemId) return null;
  return await db.prepare(
    `SELECT id, order_id, product_id, variant_id, product_name_snapshot, audience_type,
            gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot,
            quantity, unit_price, line_total, is_workshop, source_type, stock_writeoff_status, stock_quantity_before, stock_quantity_after
     FROM order_items
     WHERE id = ? AND order_id = ?
     LIMIT 1`
  ).bind(orderItemId, orderId).first<Record<string, unknown>>();
}


export type InventoryLifecycleEventRow = Record<string, unknown> & {
  id: number;
  event_key: string;
  operation_type: 'return' | 'exchange';
  operation_id: number;
  operation_item_id: number | null;
  order_id: number;
  order_item_id: number | null;
  event_type: 'return_in' | 'exchange_old_in' | 'exchange_new_out';
  direction: 'in' | 'out';
  inventory_source: 'warehouse' | 'boutique';
  quantity: number;
  product_id: number | null;
  variant_id: number | null;
  status: 'pending' | 'applied' | 'cancelled';
};


export function inventoryLifecyclePendingReason(resolved: ResolvedOrderCatalogReference, isWorkshop: boolean) {
  if (isWorkshop) return 'workshop_intake';
  if (!resolved.productId) return 'product';
  if (!resolved.variantId) return cleanText(resolved.matchStatus) || 'variant';
  return '';
}


export function inventoryLifecycleItemFromRow(row: Record<string, unknown>) {
  return catalogReviewRowToOrderItem({
    ...row,
    product_name_snapshot: row.product_name_snapshot,
    audience_type: row.audience_type,
    gender_snapshot: row.gender_snapshot,
    color_snapshot: row.color_snapshot,
    material_snapshot: row.material_snapshot,
    length_snapshot: row.length_snapshot,
    size_snapshot: row.size_snapshot,
    source_type: row.inventory_source || row.source_type,
    is_workshop: 0,
  });
}


export async function resolveWorkshopCatalogExactCandidate(
  db: D1Database,
  item: Record<string, unknown>,
): Promise<ResolvedOrderCatalogReference> {
  const normalized = inventoryLifecycleItemFromRow(item);
  const inputKey = catalogOrderInputKey(normalized);
  const product = await findCatalogProductByIdentity(db, normalized.productName, 0, { activeOnly: true }) as { id: number } | null;
  if (!product?.id) return { productId: null, variantId: null, matchStatus: 'unresolved_product', inputKey };

  const category = normalizeAudienceCategory(normalized.category, normalized.size);
  const material = await resolveCatalogValueAlias(db, 'material', canonicalStockPositionValue(normalized.material));
  const length = await resolveCatalogValueAlias(db, 'length', canonicalStockPositionValue(normalized.length));
  const gender = normalizeCatalogCombinationGender(normalized.gender);
  const color = await resolveCatalogValueAlias(db, 'color', normalizeCatalogCombinationColor(normalized.color));
  const size = await resolveCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', normalizeCatalogCombinationSize(normalized.size));
  const execution = await findCatalogExecutionV3(db, product.id, material, length);
  if (!execution?.id) return { productId: product.id, variantId: null, matchStatus: 'unresolved_variant', inputKey };
  const variant = await findCatalogCombinationV3(db, execution.id, category, gender, color, size);
  if (!variant?.id) return { productId: product.id, variantId: null, matchStatus: 'unresolved_variant', inputKey };
  return { productId: product.id, variantId: variant.id, matchStatus: 'matched', inputKey };
}


export async function resolveInventoryLifecycleCandidate(
  db: D1Database,
  item: Record<string, unknown>,
  isWorkshop: boolean,
): Promise<ResolvedOrderCatalogReference> {
  if (isWorkshop) return await resolveWorkshopCatalogExactCandidate(db, item);

  const existingVariantId = toInt(item.variant_id, 0);
  if (existingVariantId) {
    try {
      const canonical = await loadCanonicalVariantSnapshot(db, existingVariantId);
      return { productId: canonical.productId, variantId: canonical.variantId, matchStatus: 'matched', inputKey: catalogOrderInputKey(inventoryLifecycleItemFromRow(item)) };
    } catch {
      // A stale legacy link is not trusted for a new physical movement. Fall through to
      // independent identity resolution from the recorded item facts.
    }
  }
  return await resolveCatalogProductAndVariantV2(db, inventoryLifecycleItemFromRow(item));
}


export async function trustedInventoryFullStocktakeBoundary(db: D1Database, inventorySource: unknown) {
  const source = normalizeSourceType(inventorySource);
  const row = await db.prepare(
    `SELECT s.id, s.started_at, s.completed_at,
            (SELECT COUNT(*) FROM inventory_stocktake_items i WHERE i.session_id = s.id) AS total_items,
            (SELECT COUNT(*) FROM inventory_stocktake_items i WHERE i.session_id = s.id AND i.counted_quantity IS NOT NULL) AS counted_items,
            (SELECT COUNT(*) FROM inventory_stocktake_items i WHERE i.session_id = s.id AND i.status = 'applied') AS applied_items,
            (SELECT COUNT(*) FROM inventory_stock_checks c WHERE c.reference_type = 'stocktake' AND c.reference_id = s.id AND c.check_type = 'full_stocktake') AS full_check_rows,
            (SELECT id FROM inventory_stocktake_sessions a WHERE a.inventory_source = ? AND a.status = 'active' ORDER BY a.started_at DESC LIMIT 1) AS active_session_id
     FROM inventory_stocktake_sessions s
     WHERE s.inventory_source = ? AND s.status = 'completed' AND s.completed_at IS NOT NULL
       AND s.id LIKE 'REV-%-F-%'
     ORDER BY s.completed_at DESC, s.id DESC
     LIMIT 1`
  ).bind(source, source).first<Record<string, unknown>>();
  if (!row?.id) return { trusted: false, source, reason: 'NO_COMPLETED_FULL_STOCKTAKE' as const };
  const totalItems = Math.max(0, toInt(row.total_items, 0));
  const countedItems = Math.max(0, toInt(row.counted_items, 0));
  const appliedItems = Math.max(0, toInt(row.applied_items, 0));
  const fullCheckRows = Math.max(0, toInt(row.full_check_rows, 0));
  const activeSessionId = cleanText(row.active_session_id);
  const trusted = !activeSessionId && totalItems > 0 && countedItems === totalItems && appliedItems === totalItems && fullCheckRows === totalItems;
  return {
    trusted, source,
    reason: trusted ? 'TRUSTED_FULL_PHYSICAL_BASELINE' as const : activeSessionId ? 'ACTIVE_STOCKTAKE' as const : 'INCOMPLETE_FULL_STOCKTAKE_EVIDENCE' as const,
    sessionId: cleanText(row.id), startedAt: cleanText(row.started_at), completedAt: cleanText(row.completed_at),
    totalItems, countedItems, appliedItems, fullCheckRows, activeSessionId,
  };
}


export type InventoryLifecycleDeferredInboundDisposition = {
  action: 'apply' | 'supersede' | 'hold';
  reason: 'not_inbound' | 'not_pending' | 'no_trusted_baseline' | 'active_stocktake' | 'stale_before_full_stocktake' | 'overlaps_full_stocktake' | 'later_physical_check' | 'fresh';
  boundarySessionId?: string;
  boundaryCompletedAt?: string;
  laterCheckId?: number;
};


export async function inventoryLifecycleDeferredInboundDisposition(
  db: D1Database,
  event: InventoryLifecycleEventRow,
  exactVariantId = 0,
  checkLaterPhysical = true,
): Promise<InventoryLifecycleDeferredInboundDisposition> {
  if (cleanText(event.direction) !== 'in') return { action: 'apply', reason: 'not_inbound' };
  if (cleanText(event.status) !== 'pending') return { action: 'hold', reason: 'not_pending' };
  const createdAt = cleanText(event.created_at);

  // A newer exact physical count is already a stronger fact than an older pending
  // inbound. Check it before requiring a historical full-stocktake boundary so a
  // normal quick/selective check can retire stale uncertainty by itself.
  if (checkLaterPhysical && exactVariantId > 0 && createdAt) {
    const laterPhysicalCheck = await db.prepare(
      `SELECT id FROM inventory_stock_checks
       WHERE inventory_source = ? AND variant_id = ? AND checked_at >= ?
       ORDER BY checked_at DESC, id DESC LIMIT 1`
    ).bind(normalizeSourceType(event.inventory_source), exactVariantId, createdAt).first<{ id: number }>();
    if (laterPhysicalCheck?.id) {
      return { action: 'supersede', reason: 'later_physical_check', laterCheckId: toInt(laterPhysicalCheck.id, 0) };
    }
  }

  const boundary = await trustedInventoryFullStocktakeBoundary(db, event.inventory_source);
  if (!boundary.trusted) {
    return {
      action: 'hold',
      reason: boundary.reason === 'ACTIVE_STOCKTAKE' ? 'active_stocktake' : 'no_trusted_baseline',
      boundarySessionId: boundary.sessionId,
      boundaryCompletedAt: boundary.completedAt,
    };
  }
  if (!createdAt || !boundary.startedAt || !boundary.completedAt) {
    return { action: 'hold', reason: 'no_trusted_baseline', boundarySessionId: boundary.sessionId, boundaryCompletedAt: boundary.completedAt };
  }
  if (createdAt < boundary.startedAt) {
    return { action: 'supersede', reason: 'stale_before_full_stocktake', boundarySessionId: boundary.sessionId, boundaryCompletedAt: boundary.completedAt };
  }
  if (createdAt <= boundary.completedAt) {
    return { action: 'hold', reason: 'overlaps_full_stocktake', boundarySessionId: boundary.sessionId, boundaryCompletedAt: boundary.completedAt };
  }
  return { action: 'apply', reason: 'fresh', boundarySessionId: boundary.sessionId, boundaryCompletedAt: boundary.completedAt };
}


export async function supersedeInventoryLifecycleInboundWithoutStockChange(
  db: D1Database,
  event: InventoryLifecycleEventRow,
  variantId: number,
  timestamp: string,
  reason: InventoryLifecycleDeferredInboundDisposition['reason'],
) {
  const reasonText = reason === 'stale_before_full_stocktake'
    ? 'Позиция не добавлена повторно: более поздняя полная ревизия уже стала физической точкой отсчёта.'
    : 'Позиция не добавлена повторно: после события уже была более свежая физическая сверка.';
  await db.prepare(
    `UPDATE inventory_lifecycle_events
     SET variant_id = COALESCE(NULLIF(?, 0), variant_id), status = 'cancelled', pending_reason = NULL,
         resolution_comment = ?, cancelled_at = ?, updated_at = ?
     WHERE id = ? AND status = 'pending'`
  ).bind(variantId, reasonText, timestamp, timestamp, event.id).run();
  return { ok: true, applied: false, eventId: event.id, message: reasonText };
}


export async function canAutoApplyFreshWorkshopInbound(
  db: D1Database,
  event: InventoryLifecycleEventRow,
  exactVariantId: number,
) {
  if (!toInt(event.is_workshop, 0) || cleanText(event.direction) !== 'in' || !exactVariantId) return false;
  const disposition = await inventoryLifecycleDeferredInboundDisposition(db, event, exactVariantId, false);
  return disposition.action === 'apply';
}

export async function reconcileKnownPendingInventoryInbound(
  db: D1Database,
  eventId: number,
) {
  const event = await db.prepare(`SELECT * FROM inventory_lifecycle_events WHERE id = ? LIMIT 1`).bind(eventId).first<InventoryLifecycleEventRow>();
  if (!event?.id) throw new Error('Складская задача не найдена.');
  const status = cleanText(event.status);
  if (status === 'applied' || status === 'cancelled') return { ok: true, applied: status === 'applied', already: true, eventId: event.id, message: 'Эта складская задача уже завершена.' };
  if (status !== 'pending') throw new Error('Складская задача уже не ожидает решения.');
  if (cleanText(event.direction) !== 'in') throw new Error('Автоматическое завершение доступно только для приёмки товара.');

  const resolved = await resolveInventoryLifecycleCandidate(db, event, Boolean(toInt(event.is_workshop, 0)));
  const variantId = toInt(resolved.variantId, 0);
  if (!variantId) throw new Error('Точный существующий вариант не найден. Нужно определить товар вручную.');

  const disposition = await inventoryLifecycleDeferredInboundDisposition(db, event, variantId);
  const timestamp = new Date().toISOString();
  if (disposition.action === 'supersede') {
    return await supersedeInventoryLifecycleInboundWithoutStockChange(db, event, variantId, timestamp, disposition.reason);
  }
  if (disposition.action !== 'apply') {
    const message = disposition.reason === 'active_stocktake'
      ? 'На этой точке сейчас идёт ревизия. Завершите её и обновите задачу.'
      : disposition.reason === 'overlaps_full_stocktake'
        ? 'Событие произошло во время полной ревизии. Автоматически менять остаток нельзя.'
        : 'Нет достаточно надёжной физической точки отсчёта. Автоматически менять остаток нельзя.';
    return { ok: false, applied: false, eventId: event.id, code: disposition.reason, message };
  }

  await db.prepare(`UPDATE inventory_lifecycle_events SET product_id = COALESCE(product_id, ?), variant_id = ?, pending_reason = NULL, updated_at = ? WHERE id = ? AND status = 'pending'`)
    .bind(toInt(resolved.productId, 0) || null, variantId, timestamp, event.id).run();
  const applied = await applyCanonicalInventoryLifecycleEvent(db, event.id, variantId, timestamp, 'Точный существующий вариант подтверждён автоматически.');
  return {
    ok: true, applied: Boolean(applied.applied || applied.already), eventId: event.id,
    message: `Позиция принята в ${normalizeSourceType(event.inventory_source) === 'warehouse' ? 'Склад' : 'Бутик'} и учтена в фактическом остатке.`,
  };
}


export async function insertInventoryLifecycleEvent(
  db: D1Database,
  input: {
    eventKey: string;
    operationType: 'return' | 'exchange';
    operationId: number;
    operationItemId?: number | null;
    orderId: number;
    orderItemId?: number | null;
    eventType: 'return_in' | 'exchange_old_in' | 'exchange_new_out';
    direction: 'in' | 'out';
    inventorySource: 'warehouse' | 'boutique';
    quantity: number;
    item: Record<string, unknown>;
    isWorkshop: boolean;
    productId?: number | null;
    variantId?: number | null;
    pendingReason?: string;
    timestamp: string;
  },
) {
  await db.prepare(
    `INSERT OR IGNORE INTO inventory_lifecycle_events (
      event_key, operation_type, operation_id, operation_item_id, order_id, order_item_id,
      event_type, direction, inventory_source, quantity, product_id, variant_id,
      product_name_snapshot, audience_type, gender_snapshot, color_snapshot, material_snapshot,
      length_snapshot, size_snapshot, is_workshop, status, pending_reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).bind(
    input.eventKey,
    input.operationType,
    input.operationId,
    input.operationItemId || null,
    input.orderId,
    input.orderItemId || null,
    input.eventType,
    input.direction,
    input.inventorySource,
    Math.max(1, toInt(input.quantity, 1)),
    input.productId || null,
    input.variantId || null,
    cleanText(input.item.product_name_snapshot),
    cleanText(input.item.audience_type) || null,
    cleanText(input.item.gender_snapshot) || null,
    cleanText(input.item.color_snapshot) || null,
    canonicalStockPositionValue(input.item.material_snapshot) || null,
    canonicalStockPositionValue(input.item.length_snapshot) || null,
    cleanText(input.item.size_snapshot) || null,
    input.isWorkshop ? 1 : 0,
    cleanText(input.pendingReason) || null,
    input.timestamp,
    input.timestamp,
  ).run();

  const event = await db.prepare(`SELECT * FROM inventory_lifecycle_events WHERE event_key = ? LIMIT 1`).bind(input.eventKey).first<InventoryLifecycleEventRow>();
  if (!event?.id) throw new Error('Не удалось создать безопасное складское событие. Операция остановлена.');
  return event;
}


export function inventoryLifecycleMovementReference(event: InventoryLifecycleEventRow, cancellation = false) {
  const operationId = toInt(event.operation_id, 0);
  if (cancellation) {
    return {
      type: event.operation_type === 'return' ? 'return_cancel' : 'exchange_cancel',
      id: String(operationId),
    };
  }
  if (event.event_type === 'return_in') return { type: 'return', id: `return:${operationId}` };
  if (event.event_type === 'exchange_old_in') return { type: 'exchange', id: `exchange:${operationId}` };
  return { type: 'exchange_new', id: String(operationId) };
}


export function inventoryLifecycleActionText(event: InventoryLifecycleEventRow, cancellation = false) {
  if (cancellation) return event.operation_type === 'return' ? 'Отмена возврата' : 'Отмена обмена';
  if (event.event_type === 'return_in') return 'Возврат клиента';
  if (event.event_type === 'exchange_old_in') return 'Возврат старой позиции обмена';
  return 'Выдана новая позиция обмена';
}


export async function applyCanonicalInventoryLifecycleEvent(
  db: D1Database,
  eventId: number,
  variantId: number,
  timestamp: string,
  resolutionComment = '',
) {
  let event = await db.prepare(`SELECT * FROM inventory_lifecycle_events WHERE id = ? LIMIT 1`).bind(eventId).first<InventoryLifecycleEventRow>();
  if (!event?.id) throw new Error('Складское событие не найдено.');
  if (cleanText(event.status) === 'applied') return { applied: false, already: true, event };
  if (cleanText(event.status) === 'cancelled') throw new Error('Эта складская задача уже отменена.');

  const canonical = await loadCanonicalVariantSnapshot(db, variantId);
  const source = normalizeSourceType(event.inventory_source);
  const qty = Math.max(1, toInt(event.quantity, 1));
  const delta = cleanText(event.direction) === 'in' ? qty : -qty;
  const stock = await ensureHumanInventoryStockRow(db, source, canonical, timestamp);
  const reference = inventoryLifecycleMovementReference(event);
  const action = inventoryLifecycleActionText(event);
  const isOutgoingExchange = cleanText(event.event_type) === 'exchange_new_out';

  const reservation = isOutgoingExchange && toInt(event.order_item_id, 0)
    ? await db.prepare(`SELECT id, status, quantity, inventory_source, variant_id FROM inventory_reservations WHERE order_item_id = ? LIMIT 1`).bind(toInt(event.order_item_id, 0)).first<Record<string, unknown>>()
    : null;
  if (isOutgoingExchange && (!reservation?.id || !['active', 'unresolved'].includes(cleanText(reservation.status)))) {
    throw new Error('У ожидающей выдачи обмена нет действующего резерва. Физическое списание остановлено, чтобы не разойтись с резервами заказа.');
  }
  const reservationQuantity = isOutgoingExchange ? Math.max(1, toInt(reservation?.quantity, qty)) : 0;
  if (isOutgoingExchange && reservationQuantity !== qty) {
    throw new Error(`Количество резерва новой позиции обмена (${reservationQuantity}) не совпадает с физическим движением (${qty}). Списание остановлено, чтобы не разойтись с заказом.`);
  }
  if (isOutgoingExchange && toInt(stock.quantity, 0) < qty) {
    throw new Error(`Недостаточно товара на месте для выдачи обмена: по учёту ${Math.max(0, toInt(stock.quantity, 0))} шт., требуется ${qty}. Если товар физически есть, сначала уточните фактический остаток.`);
  }
  const activeReservationQuantity = cleanText(reservation?.status) === 'active' ? reservationQuantity : 0;
  const activeReservationVariantId = activeReservationQuantity ? toInt(reservation?.variant_id, 0) : 0;
  const activeReservationSource = activeReservationQuantity ? normalizeSourceType(reservation?.inventory_source) : source;
  const reservationMatchesTarget = Boolean(
    activeReservationQuantity
    && activeReservationVariantId === canonical.variantId
    && activeReservationSource === source
  );
  const decrementReserved = reservationMatchesTarget ? activeReservationQuantity : 0;

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE inventory_stock
       SET quantity = quantity + ?,
           reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) - ?),
           product_id = ?, variant_id = ?, product_name_snapshot = ?, gender_snapshot = ?, color_snapshot = ?,
           material_snapshot = ?, length_snapshot = ?, size_snapshot = ?,
           last_action = ?, last_source_ref = ?, updated_at = ?
       WHERE id = ?
         AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'pending')`
    ).bind(
      delta,
      decrementReserved,
      canonical.productId,
      canonical.variantId,
      canonical.productName,
      canonical.gender,
      canonical.color,
      canonical.material,
      canonical.length,
      canonical.size,
      action,
      `${reference.type}:${reference.id}`,
      timestamp,
      stock.id,
      event.id,
    ),
    db.prepare(
      `INSERT INTO inventory_movements (
        inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
        color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
        reference_type, reference_id, comment, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, s.quantity, ?, ?, ?, ?
      FROM inventory_stock s
      WHERE s.id = ?
        AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'pending')`
    ).bind(
      source,
      delta > 0 ? 'return' : 'sale',
      canonical.productId,
      canonical.variantId,
      canonical.productName,
      canonical.gender,
      canonical.color,
      canonical.material,
      canonical.length,
      canonical.size,
      delta,
      reference.type,
      reference.id,
      resolutionComment || action,
      timestamp,
      stock.id,
      event.id,
    ),
  ];

  if (isOutgoingExchange && activeReservationQuantity && activeReservationVariantId && !reservationMatchesTarget) {
    // Defensive legacy/race guard: if an active reservation still points at a different SKU,
    // release its reserved quantity from that exact old SKU before the reservation is rebound.
    statements.push(
      db.prepare(
        `UPDATE inventory_stock
         SET reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) - ?),
             last_action = 'Резерв обмена перенесён на каноническую позицию', last_source_ref = ?, updated_at = ?
         WHERE inventory_source = ? AND variant_id = ?
           AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'pending')`
      ).bind(
        activeReservationQuantity,
        `exchange:${event.operation_id}`,
        timestamp,
        activeReservationSource,
        activeReservationVariantId,
        event.id,
      ),
    );
  }

  if (isOutgoingExchange && toInt(event.order_item_id, 0)) {
    statements.push(
      db.prepare(
        `UPDATE inventory_reservations
         SET product_id = ?, variant_id = ?, status = 'fulfilled', unresolved_reason = NULL,
             fulfilled_at = ?, released_at = NULL, updated_at = ?
         WHERE order_item_id = ? AND status IN ('active', 'unresolved')
           AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'pending')`
      ).bind(canonical.productId, canonical.variantId, timestamp, timestamp, toInt(event.order_item_id, 0), event.id),
      db.prepare(
        `UPDATE order_items
         SET product_id = ?, variant_id = ?, stock_writeoff_status = 'fulfilled',
             stock_quantity_before = (SELECT quantity - ? FROM inventory_stock WHERE id = ?),
             stock_quantity_after = (SELECT quantity FROM inventory_stock WHERE id = ?)
         WHERE id = ?
           AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'pending')`
      ).bind(canonical.productId, canonical.variantId, delta, stock.id, stock.id, toInt(event.order_item_id, 0), event.id),
    );
  } else if (toInt(event.order_item_id, 0)) {
    if (toInt(event.is_workshop, 0)) {
      statements.push(
        db.prepare(`UPDATE order_items SET product_id = ?, variant_id = NULL WHERE id = ? AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'pending')`)
          .bind(canonical.productId, toInt(event.order_item_id, 0), event.id),
      );
    } else {
      statements.push(
        db.prepare(`UPDATE order_items SET product_id = ?, variant_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'pending')`)
          .bind(canonical.productId, canonical.variantId, toInt(event.order_item_id, 0), event.id),
      );
    }
  }

  if (cleanText(event.event_type) === 'return_in' && toInt(event.operation_item_id, 0)) {
    statements.push(
      db.prepare(`UPDATE return_items SET restocked = 1 WHERE id = ? AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'pending')`)
        .bind(toInt(event.operation_item_id, 0), event.id),
    );
  }

  statements.push(
    db.prepare(
      `UPDATE inventory_lifecycle_events
       SET product_id = ?, variant_id = ?, status = 'applied', pending_reason = NULL,
           resolution_comment = ?, applied_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`
    ).bind(canonical.productId, canonical.variantId, cleanText(resolutionComment) || null, timestamp, timestamp, event.id),
  );

  await db.batch(statements);
  event = await db.prepare(`SELECT * FROM inventory_lifecycle_events WHERE id = ? LIMIT 1`).bind(event.id).first<InventoryLifecycleEventRow>();
  if (!event?.id || cleanText(event.status) !== 'applied') {
    throw new Error('Складское событие не было применено. Обновите данные и повторите попытку.');
  }

  const movement = await db.prepare(
    `SELECT id FROM inventory_movements
     WHERE inventory_source = ? AND variant_id = ? AND reference_type = ? AND reference_id = ?
       AND quantity_delta = ? AND created_at = ?
     ORDER BY id DESC LIMIT 1`
  ).bind(source, canonical.variantId, reference.type, reference.id, delta, timestamp).first<{ id: number }>();
  if (movement?.id && !toInt(event.movement_id, 0)) {
    await db.prepare(`UPDATE inventory_lifecycle_events SET movement_id = ?, updated_at = ? WHERE id = ? AND movement_id IS NULL`).bind(movement.id, timestamp, event.id).run();
  }

  const after = await db.prepare(`SELECT quantity, reserved_quantity FROM inventory_stock WHERE id = ?`).bind(stock.id).first<Record<string, unknown>>();
  return {
    applied: true,
    already: false,
    event: { ...event, movement_id: movement?.id || event.movement_id },
    source,
    productName: canonical.productName,
    quantityAfter: toInt(after?.quantity, 0),
    reservedAfter: Math.max(0, toInt(after?.reserved_quantity, 0)),
  };
}



type InventoryLifecycleCancellationDisposition = {
  reversePhysical: boolean;
  reason: 'safe' | 'active_stocktake' | 'later_physical_check' | 'unknown_event_time' | 'insufficient_current_physical';
  eventAt?: string;
  activeStocktakeId?: string;
  laterCheckId?: number;
  laterCheckAt?: string;
  currentPhysical?: number;
};


async function inventoryLifecycleCancellationDisposition(
  db: D1Database,
  event: InventoryLifecycleEventRow,
): Promise<InventoryLifecycleCancellationDisposition> {
  const source = normalizeSourceType(event.inventory_source);
  const variantId = toInt(event.variant_id, 0);
  const quantity = Math.max(1, toInt(event.quantity, 1));
  const eventAt = cleanText(event.applied_at) || cleanText(event.created_at);

  const activeStocktake = await db.prepare(
    `SELECT id, started_at
     FROM inventory_stocktake_sessions
     WHERE inventory_source = ? AND status = 'active'
     ORDER BY started_at DESC, id DESC
     LIMIT 1`
  ).bind(source).first<{ id: string; started_at: string | null }>();
  if (activeStocktake?.id) {
    return {
      reversePhysical: false,
      reason: 'active_stocktake',
      eventAt,
      activeStocktakeId: cleanText(activeStocktake.id),
    };
  }

  // Applied lifecycle rows should always have a timestamp. If a historical/corrupt row does not,
  // cancellation may still finish financially and logically, but must not guess across physical truth.
  if (!eventAt) {
    return { reversePhysical: false, reason: 'unknown_event_time' };
  }

  if (variantId) {
    const laterCheck = await db.prepare(
      `SELECT id, checked_at
       FROM inventory_stock_checks
       WHERE inventory_source = ? AND variant_id = ?
         AND datetime(checked_at) > datetime(?)
       ORDER BY datetime(checked_at) DESC, id DESC
       LIMIT 1`
    ).bind(source, variantId, eventAt).first<{ id: number; checked_at: string }>();
    if (laterCheck?.id) {
      return {
        reversePhysical: false,
        reason: 'later_physical_check',
        eventAt,
        laterCheckId: toInt(laterCheck.id, 0),
        laterCheckAt: cleanText(laterCheck.checked_at),
      };
    }

    // Cancelling an inbound lifecycle event means subtracting the quantity that was added earlier.
    // Never manufacture a negative physical balance just because later operational movements used it.
    if (cleanText(event.direction) === 'in') {
      const stock = await db.prepare(
        `SELECT quantity
         FROM inventory_stock
         WHERE inventory_source = ? AND variant_id = ?
         ORDER BY id ASC LIMIT 1`
      ).bind(source, variantId).first<{ quantity: number }>();
      const currentPhysical = Math.max(0, toInt(stock?.quantity, 0));
      if (currentPhysical < quantity) {
        return {
          reversePhysical: false,
          reason: 'insufficient_current_physical',
          eventAt,
          currentPhysical,
        };
      }
    }
  }

  return { reversePhysical: true, reason: 'safe', eventAt };
}


export async function cancelInventoryLifecycleEvent(
  db: D1Database,
  eventId: number,
  timestamp: string,
  comment: string,
) {
  let event = await db.prepare(`SELECT * FROM inventory_lifecycle_events WHERE id = ? LIMIT 1`).bind(eventId).first<InventoryLifecycleEventRow>();
  if (!event?.id) return { cancelled: false, missing: true };
  if (cleanText(event.status) === 'cancelled') return { cancelled: false, already: true, event };

  const isOutgoingExchange = cleanText(event.event_type) === 'exchange_new_out';
  if (cleanText(event.status) === 'pending') {
    const statements: D1PreparedStatement[] = [];
    if (isOutgoingExchange && toInt(event.order_item_id, 0)) {
      const reservation = await db.prepare(`SELECT id, status, inventory_source, variant_id, quantity FROM inventory_reservations WHERE order_item_id = ? LIMIT 1`).bind(toInt(event.order_item_id, 0)).first<Record<string, unknown>>();
      if (cleanText(reservation?.status) === 'active' && toInt(reservation?.variant_id, 0)) {
        statements.push(db.prepare(
          `UPDATE inventory_stock
           SET reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) - ?), last_action = 'Резерв обмена отменён', last_source_ref = ?, updated_at = ?
           WHERE inventory_source = ? AND variant_id = ?
             AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'pending')`
        ).bind(
          Math.max(1, toInt(reservation?.quantity, 1)),
          `exchange_cancel:${event.operation_id}`,
          timestamp,
          normalizeSourceType(reservation?.inventory_source),
          toInt(reservation?.variant_id, 0),
          event.id,
        ));
      }
      statements.push(db.prepare(
        `UPDATE inventory_reservations SET status = 'released', released_at = ?, updated_at = ?
         WHERE order_item_id = ? AND status IN ('active', 'unresolved')
           AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'pending')`
      ).bind(timestamp, timestamp, toInt(event.order_item_id, 0), event.id));
    }
    if (cleanText(event.event_type) === 'return_in' && toInt(event.operation_item_id, 0)) {
      statements.push(db.prepare(
        `UPDATE return_items SET restocked = 0
         WHERE id = ? AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'pending')`
      ).bind(toInt(event.operation_item_id, 0), event.id));
    }
    statements.push(db.prepare(
      `UPDATE inventory_lifecycle_events SET status = 'cancelled', cancelled_at = ?, updated_at = ?, resolution_comment = COALESCE(resolution_comment, ?)
       WHERE id = ? AND status = 'pending'`
    ).bind(timestamp, timestamp, cleanText(comment) || null, event.id));
    await db.batch(statements);
    return { cancelled: true, pendingOnly: true, eventId: event.id };
  }

  const variantId = toInt(event.variant_id, 0);
  if (!variantId) throw new Error(`Событие ${cleanText(event.event_key)} было применено без канонической комбинации. Автоматическая отмена остановлена.`);
  const canonical = await loadCanonicalVariantSnapshot(db, variantId);
  const source = normalizeSourceType(event.inventory_source);
  const qty = Math.max(1, toInt(event.quantity, 1));
  const originalDelta = cleanText(event.direction) === 'in' ? qty : -qty;
  const reversalDelta = -originalDelta;
  const physicalDisposition = await inventoryLifecycleCancellationDisposition(db, event);
  if (!physicalDisposition.reversePhysical) {
    const reasonText = physicalDisposition.reason === 'active_stocktake'
      ? 'Физический остаток не откатывался: на точке идёт ревизия, которая является текущей физической истиной.'
      : physicalDisposition.reason === 'later_physical_check'
        ? 'Физический остаток не откатывался: после операции уже была более свежая физическая сверка.'
        : physicalDisposition.reason === 'insufficient_current_physical'
          ? 'Физический остаток не откатывался: обратное списание сделало бы остаток отрицательным.'
          : 'Физический остаток не откатывался: у исторического события нет надёжной временной границы.';
    const bookkeeping: D1PreparedStatement[] = [];
    if (isOutgoingExchange && toInt(event.order_item_id, 0)) {
      bookkeeping.push(db.prepare(
        `UPDATE inventory_reservations SET status = 'released', released_at = ?, updated_at = ?
         WHERE order_item_id = ? AND status = 'fulfilled'
           AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'applied')`
      ).bind(timestamp, timestamp, toInt(event.order_item_id, 0), event.id));
    }
    if (cleanText(event.event_type) === 'return_in' && toInt(event.operation_item_id, 0)) {
      bookkeeping.push(db.prepare(
        `UPDATE return_items SET restocked = 0
         WHERE id = ? AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'applied')`
      ).bind(toInt(event.operation_item_id, 0), event.id));
    }
    bookkeeping.push(db.prepare(
      `UPDATE inventory_lifecycle_events
       SET status = 'cancelled', cancelled_at = ?, updated_at = ?,
           resolution_comment = CASE
             WHEN COALESCE(resolution_comment, '') = '' THEN ?
             ELSE resolution_comment || ' | ' || ?
           END
       WHERE id = ? AND status = 'applied'`
    ).bind(timestamp, timestamp, reasonText, reasonText, event.id));
    await db.batch(bookkeeping);
    event = await db.prepare(`SELECT * FROM inventory_lifecycle_events WHERE id = ? LIMIT 1`).bind(event.id).first<InventoryLifecycleEventRow>();
    return {
      cancelled: true,
      pendingOnly: false,
      event,
      source,
      productName: canonical.productName,
      quantityDelta: 0,
      physicalReversalSkipped: true,
      physicalReversalReason: physicalDisposition.reason,
      protectedPhysicalTruth: true,
      activeStocktakeId: physicalDisposition.activeStocktakeId || null,
      laterCheckId: physicalDisposition.laterCheckId || null,
      laterCheckAt: physicalDisposition.laterCheckAt || null,
      currentPhysical: physicalDisposition.currentPhysical ?? null,
    };
  }
  const stock = await ensureHumanInventoryStockRow(db, source, canonical, timestamp);
  const reference = inventoryLifecycleMovementReference(event, true);
  const action = inventoryLifecycleActionText(event, true);

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE inventory_stock
       SET quantity = quantity + ?, product_id = ?, variant_id = ?, product_name_snapshot = ?, gender_snapshot = ?, color_snapshot = ?,
           material_snapshot = ?, length_snapshot = ?, size_snapshot = ?, last_action = ?, last_source_ref = ?, updated_at = ?
       WHERE id = ? AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'applied')`
    ).bind(
      reversalDelta,
      canonical.productId,
      canonical.variantId,
      canonical.productName,
      canonical.gender,
      canonical.color,
      canonical.material,
      canonical.length,
      canonical.size,
      action,
      `${reference.type}:${reference.id}`,
      timestamp,
      stock.id,
      event.id,
    ),
    db.prepare(
      `INSERT INTO inventory_movements (
        inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
        color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
        reference_type, reference_id, comment, created_at
      )
      SELECT ?, 'revision', ?, ?, ?, ?, ?, ?, ?, ?, ?, s.quantity, ?, ?, ?, ?
      FROM inventory_stock s
      WHERE s.id = ? AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'applied')`
    ).bind(
      source,
      canonical.productId,
      canonical.variantId,
      canonical.productName,
      canonical.gender,
      canonical.color,
      canonical.material,
      canonical.length,
      canonical.size,
      reversalDelta,
      reference.type,
      reference.id,
      comment || action,
      timestamp,
      stock.id,
      event.id,
    ),
  ];

  if (isOutgoingExchange && toInt(event.order_item_id, 0)) {
    statements.push(db.prepare(
      `UPDATE inventory_reservations SET status = 'released', released_at = ?, updated_at = ?
       WHERE order_item_id = ? AND status = 'fulfilled'
         AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'applied')`
    ).bind(timestamp, timestamp, toInt(event.order_item_id, 0), event.id));
  }
  if (cleanText(event.event_type) === 'return_in' && toInt(event.operation_item_id, 0)) {
    statements.push(db.prepare(
      `UPDATE return_items SET restocked = 0
       WHERE id = ? AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'applied')`
    ).bind(toInt(event.operation_item_id, 0), event.id));
  }
  statements.push(db.prepare(
    `UPDATE inventory_lifecycle_events
     SET status = 'cancelled', cancelled_at = ?, updated_at = ?, resolution_comment = COALESCE(resolution_comment, ?)
     WHERE id = ? AND status = 'applied'`
  ).bind(timestamp, timestamp, cleanText(comment) || null, event.id));
  await db.batch(statements);

  const movement = await db.prepare(
    `SELECT id FROM inventory_movements
     WHERE inventory_source = ? AND variant_id = ? AND reference_type = ? AND reference_id = ?
       AND quantity_delta = ? AND created_at = ?
     ORDER BY id DESC LIMIT 1`
  ).bind(source, canonical.variantId, reference.type, reference.id, reversalDelta, timestamp).first<{ id: number }>();
  if (movement?.id) {
    await db.prepare(`UPDATE inventory_lifecycle_events SET reversal_movement_id = ?, updated_at = ? WHERE id = ? AND reversal_movement_id IS NULL`).bind(movement.id, timestamp, event.id).run();
  }
  event = await db.prepare(`SELECT * FROM inventory_lifecycle_events WHERE id = ? LIMIT 1`).bind(event.id).first<InventoryLifecycleEventRow>();
  return { cancelled: true, pendingOnly: false, event, source, productName: canonical.productName, quantityDelta: reversalDelta };
}


export async function listInventoryLifecyclePending(db: D1Database, url: URL) {
  const limit = Math.min(100, Math.max(10, toInt(url.searchParams.get('limit'), 40)));
  const result = await db.prepare(
    `SELECT e.*, o.external_id, o.order_date
     FROM inventory_lifecycle_events e
     JOIN orders o ON o.id = e.order_id
     WHERE e.status = 'pending'
     ORDER BY e.created_at ASC, e.id ASC
     LIMIT ?`
  ).bind(limit).all<Record<string, unknown>>();
  const countRow = await db.prepare(`SELECT COUNT(*) AS count FROM inventory_lifecycle_events WHERE status = 'pending'`).first<{ count: number }>();
  return {
    ok: true,
    count: Math.max(0, toInt(countRow?.count, 0)),
    items: (result.results || []).map((row) => ({
      id: toInt(row.id, 0),
      eventKey: cleanText(row.event_key),
      eventType: cleanText(row.event_type),
      direction: cleanText(row.direction),
      operationType: cleanText(row.operation_type),
      operationId: toInt(row.operation_id, 0),
      orderId: toInt(row.order_id, 0),
      orderItemId: toInt(row.order_item_id, 0) || null,
      externalId: cleanText(row.external_id),
      orderDate: cleanText(row.order_date),
      inventorySource: cleanText(row.inventory_source),
      quantity: Math.max(1, toInt(row.quantity, 1)),
      productId: toInt(row.product_id, 0) || null,
      variantId: toInt(row.variant_id, 0) || null,
      productName: cleanText(row.product_name_snapshot),
      category: normalizeAudienceCategory(row.audience_type, row.size_snapshot),
      gender: cleanText(row.gender_snapshot),
      color: cleanText(row.color_snapshot),
      material: canonicalStockPositionValue(row.material_snapshot),
      length: canonicalStockPositionValue(row.length_snapshot),
      size: cleanText(row.size_snapshot),
      isWorkshop: Boolean(toInt(row.is_workshop, 0)),
      pendingReason: cleanText(row.pending_reason),
      createdAt: cleanText(row.created_at),
    })),
  };
}


export async function getInventoryLifecycleContext(db: D1Database, eventId: number): Promise<CatalogResolutionContext> {
  const event = await db.prepare(`SELECT * FROM inventory_lifecycle_events WHERE id = ? LIMIT 1`).bind(eventId).first<InventoryLifecycleEventRow>();
  if (!event?.id) throw new Error('Складская задача не найдена.');
  if (cleanText(event.status) !== 'pending') return { ok: true, eventId, status: cleanText(event.status), completed: true };

  const category = normalizeAudienceCategory(event.audience_type, event.size_snapshot);
  const facts = {
    productName: cleanText(event.product_name_snapshot),
    material: canonicalStockPositionValue(event.material_snapshot),
    length: canonicalStockPositionValue(event.length_snapshot),
    category,
    gender: normalizeCatalogCombinationGender(event.gender_snapshot),
    color: normalizeCatalogCombinationColor(event.color_snapshot),
    size: normalizeCatalogCombinationSize(event.size_snapshot),
  };
  const product = toInt(event.product_id, 0)
    ? await db.prepare(`SELECT id, name, category FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1`).bind(toInt(event.product_id, 0)).first<{ id: number; name: string; category: string }>()
    : await findCatalogProductByIdentity(db, facts.productName, 0, { activeOnly: true }) as { id: number; name: string; category: string } | null;

  const referencesResult = await db.prepare(
    `SELECT kind, value FROM reference_values WHERE is_active = 1 AND kind IN ('material','length','color','size','child_age') ORDER BY sort_order, value`
  ).all<{ kind: string; value: string }>();
  const productsResult = product?.id
    ? { results: [] as Array<{ id: number; name: string; category: string }> }
    : await db.prepare(`SELECT id, name, category FROM catalog_products WHERE is_active = 1 ORDER BY name COLLATE NOCASE, id LIMIT 300`).all<{ id: number; name: string; category: string }>();
  const references: CatalogReferenceOptions = { materials: ['СТАНДАРТ'], lengths: ['СТАНДАРТ'], colors: [], sizes: [], childAges: [] };
  for (const row of referencesResult.results || []) {
    const value = upperText(row.value);
    if (!value) continue;
    if (row.kind === 'material' && !references.materials.includes(value)) references.materials.push(value);
    else if (row.kind === 'length' && !references.lengths.includes(value)) references.lengths.push(value);
    else if (row.kind === 'color' && !references.colors.includes(value)) references.colors.push(value);
    else if (row.kind === 'size' && !references.sizes.includes(value)) references.sizes.push(value);
    else if (row.kind === 'child_age' && !references.childAges.includes(value)) references.childAges.push(value);
  }

  let execution: { id: number; material: string; length: string } | null = null;
  let existingVariant: { id: number } | null = null;
  const unknownFields: string[] = [];
  if (product?.id) {
    execution = await findCatalogExecutionV3(db, product.id, facts.material, facts.length);
    if (execution?.id) existingVariant = await findCatalogCombinationV3(db, execution.id, facts.category, facts.gender, facts.color, facts.size);
  }
  if (!existingVariant?.id) {
    if (!await catalogReferenceDbValueExists(db, 'material', facts.material)) unknownFields.push('material');
    if (!await catalogReferenceDbValueExists(db, 'length', facts.length)) unknownFields.push('length');
    if (facts.gender && facts.gender !== 'ЖЕН' && facts.gender !== 'МУЖ') unknownFields.push('gender');
    if (!await catalogReferenceDbValueExists(db, 'color', facts.color)) unknownFields.push('color');
    if (!await catalogReferenceDbValueExists(db, facts.category === 'child' ? 'child_age' : 'size', facts.size)) unknownFields.push('size');
  }
  let issueType = !product?.id ? 'unknown_product' : existingVariant?.id ? 'exact_existing' : unknownFields.length ? 'unknown_attribute' : !execution?.id ? 'new_execution' : 'missing_combination';
  if (toInt(event.is_workshop, 0)) issueType = product?.id && existingVariant?.id ? 'workshop_intake' : issueType;

  return {
    ok: true,
    eventId,
    issueType,
    unknownFields,
    isWorkshop: Boolean(toInt(event.is_workshop, 0)),
    eventType: cleanText(event.event_type),
    direction: cleanText(event.direction),
    inventorySource: cleanText(event.inventory_source),
    quantity: Math.max(1, toInt(event.quantity, 1)),
    facts,
    product: product ? { id: product.id, name: cleanText(product.name), category: cleanText(product.category) } : null,
    execution: execution ? { id: execution.id, material: execution.material, length: execution.length } : null,
    existingVariantId: toInt(existingVariant?.id, 0) || null,
    products: (productsResult.results || []).map((row) => ({ id: toInt(row.id, 0), name: cleanText(row.name), category: cleanText(row.category) })),
    references,
  };
}


export async function resolveInventoryLifecycleFacts(db: D1Database, eventId: number, input: CatalogReviewFactsInput): Promise<CatalogResolutionResponse> {
  const event = await db.prepare(`SELECT * FROM inventory_lifecycle_events WHERE id = ? LIMIT 1`).bind(eventId).first<InventoryLifecycleEventRow>();
  if (!event?.id) throw new Error('Складская задача не найдена.');
  if (cleanText(event.status) === 'applied') return { ok: true, already: true, message: 'Эта складская задача уже выполнена.' };
  if (cleanText(event.status) === 'cancelled') throw new Error('Эта складская задача уже отменена.');

  const preResolutionDisposition = await inventoryLifecycleDeferredInboundDisposition(db, event);
  if (preResolutionDisposition.action === 'supersede') {
    return await supersedeInventoryLifecycleInboundWithoutStockChange(db, event, 0, new Date().toISOString(), preResolutionDisposition.reason);
  }
  if (preResolutionDisposition.action === 'hold') {
    if (preResolutionDisposition.reason === 'overlaps_full_stocktake') throw new Error('Эта позиция появилась во время полной ревизии. Нельзя безопасно прибавлять её задним числом — оставьте задачу до отдельной физической проверки.');
    if (preResolutionDisposition.reason === 'active_stocktake') throw new Error('Сейчас идёт ревизия этой точки. Завершите или отмените её перед разбором физического возврата.');
    throw new Error('Для этой точки нет подтверждённой полной ревизии. Физический возврат оставлен на проверке, чтобы не изменить остаток по догадке.');
  }

  const category = normalizeAudienceCategory(input.category ?? event.audience_type, input.size ?? event.size_snapshot);
  const createProduct = Boolean(input.createProduct);
  let productId = Math.max(0, toInt(input.productId, 0));
  const requestedProductName = cleanText(input.productName) || cleanText(event.product_name_snapshot);
  let product: { id: number; name: string } | null = null;
  if (productId) {
    product = await db.prepare(`SELECT id, name FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1`).bind(productId).first<{ id: number; name: string }>();
    if (!product?.id) throw new Error('Выбранный товар не найден или отключён.');
  } else if (!createProduct) {
    throw new Error('Выберите существующий товар или явно подтвердите создание нового базового товара.');
  } else {
    if (!requestedProductName) throw new Error('Введите название нового товара для каталога.');
    const duplicate = await findCatalogProductByIdentity(db, requestedProductName);
    if (duplicate?.id) throw new Error(`Такой базовый товар уже существует: ${cleanText(duplicate.name)}. Выберите его вместо создания дубля.`);
  }

  // Validate the learned raw spelling before creating any product/reference/execution. An alias
  // conflict must never leave half-created master data behind.
  await assertCatalogProductAliasTargetAvailable(db, event.product_name_snapshot, product?.id || 0);

  const createFields = new Set(Array.isArray(input.createFields) ? (input.createFields as unknown[]).map(cleanText) : []);
  const material = await resolveCatalogValueAlias(db, 'material', canonicalStockPositionValue(input.material ?? event.material_snapshot));
  const length = await resolveCatalogValueAlias(db, 'length', canonicalStockPositionValue(input.length ?? event.length_snapshot));
  const gender = normalizeCatalogCombinationGender(input.gender ?? event.gender_snapshot);
  const color = await resolveCatalogValueAlias(db, 'color', normalizeCatalogCombinationColor(input.color ?? event.color_snapshot));
  const size = await resolveCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', normalizeCatalogCombinationSize(input.size ?? event.size_snapshot));
  if (gender && gender !== 'ЖЕН' && gender !== 'МУЖ') throw new Error('Пол должен быть выбран из списка.');

  // Step 188G keeps the Step 188E invariant: an already-existing exact canonical variant is
  // truth even if an old reference dictionary is incomplete. Reference validation is needed
  // only when we are about to create a genuinely new execution/combination.
  let exactExecution: { id: number; material: string; length: string } | null = null;
  let exactVariant: { id: number } | null = null;
  if (product?.id) {
    exactExecution = await findCatalogExecutionV3(db, product.id, material, length);
    if (exactExecution?.id) exactVariant = await findCatalogCombinationV3(db, exactExecution.id, category, gender, color, size);
  }

  const referencePlan: Array<{ field: string; dbKind: string; apiKind: ReferenceKind; value: string }> = [
    { field: 'material', dbKind: 'material', apiKind: 'materials', value: material },
    { field: 'length', dbKind: 'length', apiKind: 'lengths', value: length },
    { field: 'color', dbKind: 'color', apiKind: 'colors', value: color },
    { field: 'size', dbKind: category === 'child' ? 'child_age' : 'size', apiKind: category === 'child' ? 'childAges' : 'sizes', value: size },
  ];
  const missingReferences: typeof referencePlan = [];
  if (!exactVariant?.id) {
    for (const entry of referencePlan) {
      if (!entry.value || ((entry.dbKind === 'material' || entry.dbKind === 'length') && entry.value === 'СТАНДАРТ')) continue;
      if (!await catalogReferenceDbValueExists(db, entry.dbKind, entry.value)) missingReferences.push(entry);
    }
    const unconfirmed = missingReferences.find((entry) => !createFields.has(entry.field));
    if (unconfirmed) throw new Error(`Значение «${unconfirmed.value}» ещё не существует. Выберите существующее или явно добавьте его как новое.`);
  }

  if (!product?.id) {
    const created = await createCatalogProduct(db, { name: requestedProductName, category });
    productId = toInt(created.id, 0);
    product = { id: productId, name: cleanText(created.name) };
  }
  if (!product?.id) throw new Error('Не удалось определить базовый товар.');
  for (const entry of missingReferences) await upsertReferenceValue(db, { kind: entry.apiKind, value: entry.value, isActive: 1, sortOrder: 0 });

  const timestamp = new Date().toISOString();
  let combination: { id: number; created?: boolean };
  if (exactVariant?.id) {
    combination = { id: exactVariant.id, created: false };
  } else {
    const execution = exactExecution || await ensureCatalogExecutionV3(db, product.id, material, length, timestamp);
    combination = await createCatalogCombinationV3(db, {
      productId: product.id,
      executionId: execution.id,
      category,
      gender,
      color,
      material: execution.material,
      length: execution.length,
      sizeLabel: size,
      externalId: makeVariantExternalId(product.name, category, gender, color, execution.material, execution.length, size),
    }, timestamp);
  }
  if (!combination.id) throw new Error('Не удалось определить каноническую комбинацию товара.');

  await rememberCatalogProductAlias(db, event.product_name_snapshot, product.id, timestamp);
  await rememberCatalogValueAlias(db, 'material', event.material_snapshot, material, timestamp);
  await rememberCatalogValueAlias(db, 'length', event.length_snapshot, length, timestamp);
  await rememberCatalogValueAlias(db, 'color', event.color_snapshot, color, timestamp);
  await rememberCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', event.size_snapshot, size, timestamp);

  const finalDisposition = await inventoryLifecycleDeferredInboundDisposition(db, event, combination.id);
  if (finalDisposition.action === 'supersede') {
    await db.prepare(`UPDATE inventory_lifecycle_events SET product_id = ?, variant_id = ? WHERE id = ? AND status = 'pending'`)
      .bind(product.id, combination.id, event.id).run();
    return await supersedeInventoryLifecycleInboundWithoutStockChange(db, event, combination.id, timestamp, finalDisposition.reason);
  }
  if (finalDisposition.action !== 'apply') throw new Error('Физическое состояние изменилось во время разбора. Обновите складскую задачу и проверьте её ещё раз.');

  await db.prepare(
    `UPDATE inventory_lifecycle_events SET product_id = ?, variant_id = ?, pending_reason = NULL, resolution_comment = ?, updated_at = ? WHERE id = ? AND status = 'pending'`
  ).bind(product.id, combination.id, cleanText(input.productName) || null, timestamp, event.id).run();

  const applied = await applyCanonicalInventoryLifecycleEvent(
    db,
    event.id,
    combination.id,
    timestamp,
    `Администратор подтвердил физическую позицию: ${cleanText(product.name)}`,
  );
  return {
    ok: true,
    applied: Boolean(applied.applied || applied.already),
    eventId: event.id,
    createdCombination: Boolean(combination.created),
    message: cleanText(event.direction) === 'in'
      ? `Позиция принята в ${normalizeSourceType(event.inventory_source) === 'warehouse' ? 'Склад' : 'Бутик'} и учтена в фактическом остатке.`
      : `Выданная позиция определена и физическое списание применено к правильной комбинации.`,
  };
}
