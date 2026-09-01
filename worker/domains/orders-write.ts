// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { cleanText, isArchivedOrder, normalizeDate, normalizeOrderStatus, normalizePhone, normalizeShippingStatus, normalizeSourceType, normalizeWorkshopStatus, toInt, upperText } from '../core/text.ts'
import type { AuthUser, OrderInput, OrderListRow } from '../core/types.ts'
import { resolveActiveManagerId, writeActivityLog } from './activity.ts'
import { isHumanInventoryModelEnabled } from './catalog.ts'
import type { CriticalOperationHandle } from './critical.ts'
import { advanceCriticalOperation, beginCriticalOperation, completeCriticalOperation, CriticalOperationConflictError, criticalOperationEntityId, failCriticalOperation, insertCriticalMappedEntity, parseCriticalContext, updateCriticalOperationTargetFromLastInsert } from './critical.ts'
import { buildPaymentAndMoneyEventStatements, financialEventStatement, financialOperationTypeFromPaymentKind, removeOrderPaymentsWithMoneyEvents } from './money.ts'
import { assertOrderItemInputs, assertOrderPaymentInputs, assertOrderTotalInput, calculateTotals, completedOrderOperationCounts, normalizeOrderItems, normalizeOrderPayments, OrderInputValidationError, sameNormalizedOrderItemsForEdit, sameNormalizedOrderPaymentsForEdit } from './order-core.ts'
import { assertCreateOrderShortageDecisions, fulfillOrderReservationsV2, getOrderShipmentInventoryBlockers, OrderStockShortageError, orderShipmentInventoryBlockerMessage, releaseOrderReservationsV2, reserveOrderItemV2, resolveCatalogProductAndVariant, resolveWorkshopCatalogProductOnly } from './order-reservations.ts'
import { fetchOrderRelations, workshopTaskStatusForOrderItem } from './orders-relations.ts'
import { upsertCustomerIdentityForOrderCreate } from './references.ts'
import { isInventoryAutoWriteoffEnabled, recalculateCustomersAfterStorageCleanup } from './storage.ts'
import { assertWorkshopTaskDetailSchema } from './workshop-schema.ts'

export async function applyOrderStockWriteOff(
  db: D1Database,
  orderId: number,
  externalId: string,
  item: ReturnType<typeof normalizeOrderItems>[number],
  productId: number | null,
  variantId: number | null,
  timestamp: string,
  orderItemId?: number | null,
  referenceType = 'order',
  referenceId = externalId,
  movementComment?: string,
) {
  if (await isHumanInventoryModelEnabled(db)) {
    return await reserveOrderItemV2(db, orderId, externalId, item, productId, variantId, timestamp, orderItemId, referenceType, referenceId);
  }
  if (orderItemId) {
    const existingWriteoff = await db.prepare(
      `SELECT stock_writeoff_status, stock_quantity_before, stock_quantity_after
       FROM order_items WHERE id = ? AND order_id = ? LIMIT 1`
    ).bind(orderItemId, orderId).first<Record<string, unknown>>();
    const existingStatus = cleanText(existingWriteoff?.stock_writeoff_status);
    if (existingStatus === 'written_off' || existingStatus === 'negative') {
      return {
        source: item.inventorySource, productName: item.productName, variantId,
        quantityBefore: toInt(existingWriteoff?.stock_quantity_before, 0),
        quantityAfter: toInt(existingWriteoff?.stock_quantity_after, 0),
        referenceType, referenceId: cleanText(referenceId) || externalId, alreadyApplied: true,
      };
    }
  }
  const inventorySource = item.inventorySource;
  const existing = variantId
    ? await db.prepare(
      `SELECT id, quantity FROM inventory_stock
       WHERE inventory_source = ? AND variant_id = ?
       ORDER BY id ASC LIMIT 1`
    ).bind(inventorySource, variantId).first<{ id: number; quantity: number }>()
    : null;

  const quantityBefore = Number(existing?.quantity || 0);
  const quantityAfter = quantityBefore - item.quantity;
  const safeReferenceId = cleanText(referenceId) || externalId;
  const reference = `${referenceType}:${safeReferenceId}`;
  const stockStatement = existing?.id
    ? db.prepare(
      `UPDATE inventory_stock
       SET product_id = ?, variant_id = ?, product_name_snapshot = ?, gender_snapshot = ?, color_snapshot = ?,
           material_snapshot = ?, length_snapshot = ?, size_snapshot = ?, quantity = ?,
           last_action = ?, last_source_ref = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      productId,
      variantId,
      item.productName,
      item.gender || null,
      item.color || null,
      item.material || null,
      item.length || null,
      item.size || null,
      quantityAfter,
      'Продажа',
      reference,
      timestamp,
      existing.id,
    )
    : db.prepare(
      `INSERT INTO inventory_stock (
        inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
        material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
        last_action, last_source_ref, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    ).bind(
      inventorySource,
      productId,
      variantId,
      item.productName,
      item.gender || null,
      item.color || null,
      item.material || null,
      item.length || null,
      item.size || null,
      quantityAfter,
      'Продажа',
      reference,
      timestamp,
      timestamp,
    );
  const movementStatement = db.prepare(
    `INSERT INTO inventory_movements (
      inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
      color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
      reference_type, reference_id, comment, created_at
    ) VALUES (?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    inventorySource,
    productId,
    variantId,
    item.productName,
    item.gender || null,
    item.color || null,
    item.material || null,
    item.length || null,
    item.size || null,
    -item.quantity,
    quantityAfter,
    referenceType,
    safeReferenceId,
    movementComment || `Автосписание по заказу ${externalId}`,
    timestamp,
  );

  if (orderItemId) {
    // Legacy inventory must be retry-safe too. The stock mutation, movement, and item marker are one
    // D1 transaction so a retry can never apply the physical write-off twice after a partial failure.
    await db.batch([
      stockStatement,
      movementStatement,
      db.prepare(
        `UPDATE order_items
         SET stock_writeoff_status = ?, stock_quantity_before = ?, stock_quantity_after = ?
         WHERE id = ? AND order_id = ?
           AND COALESCE(stock_writeoff_status, '') NOT IN ('written_off', 'negative')`
      ).bind(
        quantityAfter < 0 ? 'negative' : 'written_off',
        quantityBefore,
        quantityAfter,
        orderItemId,
        orderId,
      ),
    ]);
  } else {
    // Historical/manual fallback without a concrete order_item_id. Existing callers in the order
    // create/edit paths always pass orderItemId, so this branch is retained only for compatibility.
    await db.batch([
      stockStatement,
      movementStatement,
      db.prepare(
        `UPDATE order_items
         SET stock_writeoff_status = ?, stock_quantity_before = ?, stock_quantity_after = ?
         WHERE order_id = ? AND variant_id IS ? AND product_name_snapshot = ? AND created_at = ?`
      ).bind(
        quantityAfter < 0 ? 'negative' : 'written_off',
        quantityBefore,
        quantityAfter,
        orderId,
        variantId,
        item.productName,
        timestamp,
      ),
    ]);
  }

  return {
    source: inventorySource,
    productName: item.productName,
    variantId,
    quantityBefore,
    quantityAfter,
    referenceType,
    referenceId: safeReferenceId,
  };
}


export async function reverseOrderStockWriteOffsForEdit(
  db: D1Database,
  orderId: number,
  externalId: string,
  timestamp: string,
) {
  if (await isHumanInventoryModelEnabled(db)) {
    await releaseOrderReservationsV2(db, orderId, timestamp, `Редактирование заказа ${externalId}`);
    return [];
  }
  const oldItems = await db.prepare(
    `SELECT id, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
            material_snapshot, length_snapshot, size_snapshot, quantity, source_type, stock_writeoff_status
     FROM order_items
     WHERE order_id = ? AND is_workshop = 0`
  ).bind(orderId).all<Record<string, unknown>>();

  const reversals: Array<{ source: string; productName: string; variantId: number | null; quantityBefore: number; quantityAfter: number }> = [];

  for (const row of oldItems.results || []) {
    const status = cleanText(row.stock_writeoff_status);
    const source = normalizeSourceType(row.source_type);
    const quantity = Math.max(0, toInt(row.quantity, 0));
    if (!quantity || !['written_off', 'negative', 'pending_writeoff'].includes(status)) {
      continue;
    }

    const orderItemId = toInt(row.id, 0);
    const variantId = toInt(row.variant_id, 0) || null;
    const productId = toInt(row.product_id, 0) || null;
    let stockRow = variantId
      ? await db.prepare(
        `SELECT id, quantity FROM inventory_stock
         WHERE inventory_source = ? AND variant_id = ?
         ORDER BY id ASC LIMIT 1`
      ).bind(source, variantId).first<{ id: number; quantity: number }>()
      : null;

    if (!stockRow?.id) {
      stockRow = await db.prepare(
        `SELECT id, quantity FROM inventory_stock
         WHERE inventory_source = ?
           AND product_name_snapshot = ?
           AND COALESCE(gender_snapshot, '') = COALESCE(?, '')
           AND COALESCE(color_snapshot, '') = COALESCE(?, '')
           AND COALESCE(NULLIF(UPPER(TRIM(material_snapshot)), ''), 'СТАНДАРТ') = COALESCE(NULLIF(UPPER(TRIM(?)), ''), 'СТАНДАРТ')
           AND COALESCE(NULLIF(UPPER(TRIM(length_snapshot)), ''), 'СТАНДАРТ') = COALESCE(NULLIF(UPPER(TRIM(?)), ''), 'СТАНДАРТ')
           AND COALESCE(size_snapshot, '') = COALESCE(?, '')
         ORDER BY id ASC LIMIT 1`
      ).bind(
        source,
        cleanText(row.product_name_snapshot),
        cleanText(row.gender_snapshot) || null,
        cleanText(row.color_snapshot) || null,
        cleanText(row.material_snapshot) || null,
        cleanText(row.length_snapshot) || null,
        cleanText(row.size_snapshot) || null,
      ).first<{ id: number; quantity: number }>();
    }

    const quantityBefore = Number(stockRow?.quantity || 0);
    const quantityAfter = quantityBefore + quantity;
    const ref = `order-edit:${externalId}`;
    const stockStatement = stockRow?.id
      ? db.prepare(
        `UPDATE inventory_stock
         SET quantity = ?, last_action = ?, last_source_ref = ?, updated_at = ?
         WHERE id = ?`
      ).bind(quantityAfter, 'Откат редактирования заказа', ref, timestamp, stockRow.id)
      : db.prepare(
        `INSERT INTO inventory_stock (
          inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
          material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
          last_action, last_source_ref, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
      ).bind(
        source,
        productId,
        variantId,
        cleanText(row.product_name_snapshot),
        cleanText(row.gender_snapshot) || null,
        cleanText(row.color_snapshot) || null,
        cleanText(row.material_snapshot) || null,
        cleanText(row.length_snapshot) || null,
        cleanText(row.size_snapshot) || null,
        quantityAfter,
        'Откат редактирования заказа',
        ref,
        timestamp,
        timestamp,
      );
    const movementStatement = db.prepare(
      `INSERT INTO inventory_movements (
        inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
        color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
        reference_type, reference_id, comment, created_at
      ) VALUES (?, 'revision', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'order_edit', ?, ?, ?)`
    ).bind(
      source,
      productId,
      variantId,
      cleanText(row.product_name_snapshot),
      cleanText(row.gender_snapshot) || null,
      cleanText(row.color_snapshot) || null,
      cleanText(row.material_snapshot) || null,
      cleanText(row.length_snapshot) || null,
      cleanText(row.size_snapshot) || null,
      quantity,
      quantityAfter,
      externalId,
      `Откат старого списания перед редактированием заказа ${externalId}`,
      timestamp,
    );

    // The stock restore, movement, and per-item retry marker are one transaction. A crash after this
    // batch is harmless: the next retry sees reversed_edit and cannot restore the same units twice.
    await db.batch([
      stockStatement,
      movementStatement,
      db.prepare(
        `UPDATE order_items
         SET stock_writeoff_status = 'reversed_edit', stock_quantity_before = ?, stock_quantity_after = ?
         WHERE id = ? AND order_id = ?
           AND stock_writeoff_status IN ('written_off', 'negative', 'pending_writeoff')`
      ).bind(quantityBefore, quantityAfter, orderItemId, orderId),
    ]);

    reversals.push({ source, productName: cleanText(row.product_name_snapshot), variantId, quantityBefore, quantityAfter });
  }

  return reversals;
}


export function inventoryObligationIdentityKey(item: Record<string, unknown>) {
  const workshop = toInt(item.is_workshop ?? item.isWorkshop, 0) ? 'workshop' : 'stock';
  const source = workshop === 'workshop' ? 'warehouse' : normalizeSourceType(item.source_type ?? item.sourceType ?? item.inventorySource);
  const quantity = Math.max(1, toInt(item.quantity, 1));
  return [
    workshop, source,
    upperText(item.product_name_snapshot ?? item.productName),
    upperText(item.audience_type ?? item.audienceType),
    upperText(item.gender_snapshot ?? item.gender),
    upperText(item.color_snapshot ?? item.color),
    upperText(item.material_snapshot ?? item.material),
    upperText(item.length_snapshot ?? item.length),
    upperText(item.size_snapshot ?? item.size),
    quantity,
  ].join('|');
}


export async function inventoryObligationLineageForRewrite(
  db: D1Database,
  orderId: number,
  nextItems: ReturnType<typeof normalizeOrderItems>,
) {
  const existing = await db.prepare(
    `SELECT id, product_name_snapshot, audience_type, gender_snapshot, color_snapshot, material_snapshot, length_snapshot,
            size_snapshot, quantity, is_workshop, source_type, created_at, inventory_obligation_key, inventory_obligation_origin_at
     FROM order_items WHERE order_id = ? AND quantity > 0 ORDER BY id ASC`
  ).bind(orderId).all<Record<string, unknown>>();
  const pools = new Map<string, Array<{ key: string; originAt: string }>>();
  for (const row of existing.results || []) {
    const identity = inventoryObligationIdentityKey(row);
    if (!pools.has(identity)) pools.set(identity, []);
    pools.get(identity)!.push({
      key: cleanText(row.inventory_obligation_key) || `legacy-order-item:${toInt(row.id, 0)}`,
      originAt: cleanText(row.inventory_obligation_origin_at) || cleanText(row.created_at),
    });
  }
  return nextItems.map((item) => {
    const queue = pools.get(inventoryObligationIdentityKey(item as unknown as Record<string, unknown>));
    return queue?.length ? queue.shift()! : null;
  });
}


export async function retireOrderItemsForRewrite(db: D1Database, orderId: number, timestamp: string) {
  // Step 74: do not DELETE order_items during order editing.
  // Returns and exchanges keep foreign keys to historical order_items, so deleting rows can break saving
  // even when the admin only changed a harmless field like the order comment.
  // Quantity 0 hides replaced rows from active order views because fetchOrderRelations already filters quantity > 0.
  await db.prepare(
    `UPDATE order_items
     SET quantity = 0,
         unit_price = 0,
         line_total = 0,
         is_workshop = 0,
         workshop_comment = NULL,
         workshop_urgent = 0,
         workshop_due_date = NULL,
         stock_writeoff_status = CASE
           WHEN COALESCE(stock_writeoff_status, '') IN ('written_off', 'negative', 'pending_writeoff', 'reversed_edit', 'reserved', 'catalog_unresolved', 'reservation_released', 'pending_reservation') THEN 'replaced_edit'
           WHEN COALESCE(stock_writeoff_status, '') = 'workshop' THEN 'replaced_edit'
           ELSE COALESCE(NULLIF(stock_writeoff_status, ''), 'replaced_edit')
         END
     WHERE order_id = ?
       AND quantity > 0`
  ).bind(orderId).run();
  await db.prepare(
    `UPDATE workshop_tasks
     SET status = 'cancelled', updated_at = ?
     WHERE order_id = ? AND status = 'active'`
  ).bind(timestamp, orderId).run();
}


export async function insertOrderContent(
  db: D1Database,
  orderId: number,
  externalId: string,
  items: ReturnType<typeof normalizeOrderItems>,
  payments: ReturnType<typeof normalizeOrderPayments>,
  timestamp: string,
  stockReferenceType = 'order',
  stockReferenceId = externalId,
  stockMovementComment?: string,
  preResolvedCatalog?: Array<{ productId: number | null; variantId: number | null }>,
  criticalOperation?: CriticalOperationHandle | null,
  criticalEntityPrefix = 'order_content',
  inventoryObligationLineage?: Array<{ key: string; originAt: string } | null>,
) {
  const stockResults: Array<{ source: string; productName: string; variantId: number | null; quantityBefore: number; quantityAfter: number }> = [];
  let workshopCount = 0;
  const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db);
  const autoWriteoffEnabled = humanInventoryModelEnabled ? true : await isInventoryAutoWriteoffEnabled(db);

  for (const [itemIndex, item] of items.entries()) {
    const resolved = preResolvedCatalog?.[itemIndex]
      || (item.isWorkshop ? await resolveWorkshopCatalogProductOnly(db, item) : await resolveCatalogProductAndVariant(db, item, timestamp));
    const orderItemInsert = db.prepare(
      `INSERT INTO order_items (
        order_id, product_id, variant_id, product_name_snapshot, audience_type,
        gender_snapshot, color_snapshot, material_snapshot, length_snapshot,
        size_snapshot, quantity, unit_price, line_total, is_workshop,
        source_type, workshop_comment, workshop_urgent, workshop_due_date, stock_writeoff_status, created_at,
        inventory_obligation_key, inventory_obligation_origin_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      orderId,
      resolved.productId,
      resolved.variantId,
      item.productName,
      item.audienceType,
      item.gender || null,
      item.color || null,
      item.material || null,
      item.length || null,
      item.size || null,
      item.quantity,
      item.unitPrice,
      item.lineTotal,
      item.isWorkshop ? 1 : 0,
      item.isWorkshop ? 'warehouse' : item.inventorySource,
      item.workshopComment || null,
      item.isWorkshop && item.workshopUrgent ? 1 : 0,
      item.isWorkshop && item.workshopUrgent ? item.workshopDueDate : null,
      item.isWorkshop ? 'workshop' : (humanInventoryModelEnabled ? ((!resolved.productId || !resolved.variantId) ? 'catalog_unresolved' : 'pending_reservation') : (autoWriteoffEnabled ? 'pending_writeoff' : 'writeoff_disabled')),
      timestamp,
      inventoryObligationLineage?.[itemIndex]?.key || `${externalId}:${stockReferenceType}:${timestamp}:item:${itemIndex + 1}`,
      inventoryObligationLineage?.[itemIndex]?.originAt || timestamp,
    );
    let orderItemId: number | null = null;
    if (criticalOperation) {
      const mapped = await insertCriticalMappedEntity(
        db,
        criticalOperation,
        'order_item',
        `${criticalEntityPrefix}:item:${itemIndex + 1}`,
        orderItemInsert,
      );
      orderItemId = mapped.id;
    } else {
      const insertedItem = await orderItemInsert.run();
      orderItemId = Number(insertedItem.meta?.last_row_id || 0) || null;
    }
    if (item.isWorkshop) {
      workshopCount += 1;
      await createWorkshopTaskForOrderItem(db, orderId, externalId, orderItemId, item, resolved.productId, resolved.variantId, timestamp);
    } else if (autoWriteoffEnabled) {
      stockResults.push(await applyOrderStockWriteOff(
        db,
        orderId,
        externalId,
        item,
        resolved.productId,
        resolved.variantId,
        timestamp,
        orderItemId,
        stockReferenceType,
        stockReferenceId,
        stockMovementComment,
      ));
    }
  }

  if (criticalOperation) {
    for (const [paymentIndex, payment] of payments.entries()) {
      const entityKey = `${criticalEntityPrefix}:payment:${paymentIndex + 1}`;
      const existingPaymentId = await criticalOperationEntityId(db, criticalOperation.requestId, 'payment', entityKey);
      if (existingPaymentId) continue;
      const pair = buildPaymentAndMoneyEventStatements(db, {
        orderId,
        externalOrderId: externalId,
        paymentDate: payment.paymentDate,
        method: payment.method,
        amount: payment.amount,
        paymentKind: payment.paymentKind,
        comment: payment.comment || null,
        timestamp,
        sourceType: stockReferenceType === 'order_edit_new' ? 'order' : 'payment',
        sourceRef: `${stockReferenceType}:${stockReferenceId}:payment:${paymentIndex + 1}`,
        reason: stockReferenceType === 'order_edit_new' ? 'order_edit' : 'order_create',
        eventKey: `1901:${criticalOperation.requestId}:payment:${paymentIndex + 1}`,
      });
      await db.batch([
        pair.payment,
        db.prepare(
          `INSERT INTO critical_operation_entities (request_id, entity_type, entity_key, entity_id, created_at)
           VALUES (?, 'payment', ?, last_insert_rowid(), ?)
           ON CONFLICT(request_id, entity_type, entity_key) DO NOTHING`
        ).bind(criticalOperation.requestId, entityKey, timestamp),
        pair.event,
      ]);
    }
  } else {
    const paymentStatements = payments.flatMap((payment, paymentIndex) => {
      const pair = buildPaymentAndMoneyEventStatements(db, {
        orderId,
        externalOrderId: externalId,
        paymentDate: payment.paymentDate,
        method: payment.method,
        amount: payment.amount,
        paymentKind: payment.paymentKind,
        comment: payment.comment || null,
        timestamp,
        sourceType: stockReferenceType === 'order_edit_new' ? 'order' : 'payment',
        sourceRef: `${stockReferenceType}:${stockReferenceId}:payment:${paymentIndex + 1}`,
        reason: stockReferenceType === 'order_edit_new' ? 'order_edit' : 'order_create',
      });
      return [pair.payment, pair.event];
    });
    if (paymentStatements.length) await db.batch(paymentStatements);
  }

  return { stockResults, workshopCount };
}


export async function createWorkshopTaskForOrderItem(
  db: D1Database,
  orderId: number,
  externalId: string,
  orderItemId: number | null,
  item: ReturnType<typeof normalizeOrderItems>[number],
  productId: number | null,
  variantId: number | null,
  timestamp: string,
) {
  await assertWorkshopTaskDetailSchema(db);
  if (orderItemId) {
    const existingTask = await db.prepare(
      `SELECT id FROM workshop_tasks WHERE order_id = ? AND order_item_id = ? ORDER BY id ASC LIMIT 1`
    ).bind(orderId, orderItemId).first<{ id: number }>();
    if (existingTask?.id) return;
  }
  await db.prepare(
    `INSERT INTO workshop_tasks (
      order_id, external_order_id, order_item_id, product_id, variant_id, product_name_snapshot,
      gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot,
      quantity, comment, urgent, due_date, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).bind(
    orderId,
    externalId,
    orderItemId,
    productId,
    variantId,
    item.productName,
    item.gender || null,
    item.color || null,
    item.material || null,
    item.length || null,
    item.size || null,
    item.quantity,
    item.workshopComment || null,
    item.workshopUrgent ? 1 : 0,
    item.workshopUrgent ? item.workshopDueDate : null,
    timestamp,
    timestamp,
  ).run();
}



export async function writeOrderManagerAudit(
  db: D1Database,
  input: {
    orderId: number;
    externalId: string;
    previousManagerId?: number | null;
    previousManagerName?: string | null;
    newManagerId?: number | null;
    newManagerName?: string | null;
    action: string;
    source: string;
    actor?: AuthUser | null;
    details?: string | null;
    createdAt?: string;
  },
) {
  const createdAt = input.createdAt || new Date().toISOString();
  await db.prepare(
    `INSERT INTO order_manager_audit (
      order_id, external_id, previous_manager_id, previous_manager_name,
      new_manager_id, new_manager_name, action, source,
      actor_role, actor_label, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    input.orderId,
    input.externalId,
    input.previousManagerId ?? null,
    cleanText(input.previousManagerName) || null,
    input.newManagerId ?? null,
    cleanText(input.newManagerName) || null,
    cleanText(input.action) || 'manager_update',
    cleanText(input.source) || 'worker',
    input.actor?.role || null,
    cleanText(input.actor?.displayName || input.actor?.email) || null,
    cleanText(input.details) || null,
    createdAt,
  ).run();
}


async function markCreateCustomerOrderCount(
  db: D1Database,
  criticalOperation: CriticalOperationHandle,
  customerId: number | null,
  timestamp: string,
) {
  if (!customerId) return
  const entityType = 'customer_order_count'
  const entityKey = 'order_create'
  const [updateResult] = await db.batch([
    db.prepare(
      `UPDATE customers
       SET orders_count = COALESCE(orders_count, 0) + 1,
           first_order_at = CASE WHEN first_order_at IS NULL OR first_order_at > ? THEN ? ELSE first_order_at END,
           last_order_at = CASE WHEN last_order_at IS NULL OR last_order_at < ? THEN ? ELSE last_order_at END,
           updated_at = ?
       WHERE id = ?
         AND NOT EXISTS (
           SELECT 1 FROM critical_operation_entities
           WHERE request_id = ? AND entity_type = ? AND entity_key = ?
         )`
    ).bind(timestamp, timestamp, timestamp, timestamp, timestamp, customerId, criticalOperation.requestId, entityType, entityKey),
    db.prepare(
      `INSERT INTO critical_operation_entities (request_id, entity_type, entity_key, entity_id, created_at)
       SELECT ?, ?, ?, id, ? FROM customers WHERE id = ?
       ON CONFLICT(request_id, entity_type, entity_key) DO NOTHING`
    ).bind(criticalOperation.requestId, entityType, entityKey, timestamp, customerId),
  ])
  if (toInt(updateResult.meta?.changes, 0) > 0) return
  if (await criticalOperationEntityId(db, criticalOperation.requestId, entityType, entityKey)) return
  throw new Error('Не удалось обновить статистику клиента для создаваемого заказа.')
}


export async function createOrder(db: D1Database, input: OrderInput, actor?: AuthUser | null) {
  let criticalOperation: CriticalOperationHandle | null = null;
  try {
    const requestedAt = new Date().toISOString();
    const proposedExternalId = cleanText(input.externalId)
      || `ORD-${requestedAt.replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    criticalOperation = await beginCriticalOperation(
      db,
      'order_create',
      input.requestId,
      input,
      { externalId: proposedExternalId, createdAt: requestedAt },
    );
    if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse;

    let operationContext = parseCriticalContext<Record<string, any>>(criticalOperation.row);
    let plan = operationContext.plan as Record<string, any> | undefined;

    // Step 192B2A4: freeze the validated create plan before the first order write. A retry after a
    // partial save must continue the same accepted operation instead of re-running live shortage,
    // manager, or catalog decisions against state already changed by this very order.
    if (!plan) {
      const existingTargetId = toInt(criticalOperation.row.target_id, 0);
      const legacyInFlight = existingTargetId > 0 && ['order_created', 'content_written'].includes(criticalOperation.row.step);

      if (legacyInFlight) {
        // Compatibility bridge for operations started by the pre-192B2A4 code. Those rows have an
        // order target but no persisted plan. Rebuild only from the already-created order + original
        // fingerprinted request; never run shortage preflight again because this order may already
        // own active reservations that would otherwise be counted as somebody else's reservation.
        const existingOrder = await db.prepare(
          `SELECT id, external_id, order_date, manager_id, manager_snapshot_name, customer_id, city,
                  delivery_type, source_type, workshop_status, order_status, total_amount,
                  received_amount, debt_amount, comment, created_at
           FROM orders WHERE id = ? LIMIT 1`
        ).bind(existingTargetId).first<Record<string, unknown>>();
        if (!existingOrder) {
          throw new CriticalOperationConflictError('Незавершённая операция ссылается на заказ, которого больше нет. Обновите список заказов перед повтором.');
        }

        const sourceType = normalizeSourceType(existingOrder.source_type);
        const orderDate = normalizeDate(existingOrder.order_date);
        const rawItems = Array.isArray(input.items) ? input.items : [];
        const rawPayments = Array.isArray(input.payments) ? input.payments : [];
        assertOrderItemInputs(rawItems);
        assertOrderPaymentInputs(rawPayments);
        const normalizedItems = normalizeOrderItems(rawItems, sourceType);
        const normalizedPayments = normalizeOrderPayments(rawPayments, orderDate).map(payment => (
          payment.paymentKind === 'primary'
            ? { ...payment, paymentDate: orderDate }
            : payment
        ));
        if (!normalizedItems.length) {
          throw new CriticalOperationConflictError('Незавершённый заказ не содержит исходных товарных позиций. Обновите страницу и проверьте уже созданный заказ.');
        }
        if (normalizedItems.some(item => item.isWorkshop)) await assertWorkshopTaskDetailSchema(db);

        const preResolvedCatalog: Array<{ productId: number | null; variantId: number | null }> = [];
        for (const [itemIndex, item] of normalizedItems.entries()) {
          const mappedItemId = await criticalOperationEntityId(
            db,
            criticalOperation.requestId,
            'order_item',
            `order_create:item:${itemIndex + 1}`,
          );
          const mappedItem = mappedItemId
            ? await db.prepare(`SELECT product_id, variant_id FROM order_items WHERE id = ? AND order_id = ? LIMIT 1`)
              .bind(mappedItemId, existingTargetId)
              .first<Record<string, unknown>>()
            : null;
          if (mappedItemId && mappedItem) {
            preResolvedCatalog.push({
              productId: toInt(mappedItem.product_id, 0) || null,
              variantId: toInt(mappedItem.variant_id, 0) || null,
            });
          } else {
            preResolvedCatalog.push(item.isWorkshop
              ? await resolveWorkshopCatalogProductOnly(db, item)
              : await resolveCatalogProductAndVariant(db, item, cleanText(existingOrder.created_at) || requestedAt));
          }
        }

        const totalAmount = Math.max(0, toInt(existingOrder.total_amount, 0));
        const receivedAmount = Math.max(0, toInt(existingOrder.received_amount, 0));
        const debtAmount = Math.max(0, toInt(existingOrder.debt_amount, Math.max(0, totalAmount - receivedAmount)));
        const paymentStatus = debtAmount <= 0 ? 'Оплачено' : receivedAmount > 0 ? 'Частично' : 'Не оплачено';
        plan = {
          externalId: cleanText(existingOrder.external_id),
          createdAt: cleanText(existingOrder.created_at) || requestedAt,
          orderDate,
          managerId: toInt(existingOrder.manager_id, 0) || null,
          managerName: cleanText(existingOrder.manager_snapshot_name),
          customerId: toInt(existingOrder.customer_id, 0) || null,
          city: cleanText(existingOrder.city),
          deliveryType: cleanText(existingOrder.delivery_type),
          sourceType,
          workshopStatus: normalizeWorkshopStatus(existingOrder.workshop_status),
          orderStatus: normalizeOrderStatus(existingOrder.order_status),
          comment: cleanText(existingOrder.comment),
          normalizedItems,
          normalizedPayments,
          totals: { totalAmount, receivedAmount, debtAmount },
          paymentStatus,
          preResolvedCatalog,
        };
        // Pre-192B2A4 create incremented customers.orders_count before the order target was written.
        // If a target already exists, that increment has already happened, so seed the new marker
        // without incrementing again. A post-success exact reconciliation below repairs any older drift.
        if (plan.customerId) {
          await db.prepare(
            `INSERT INTO critical_operation_entities (request_id, entity_type, entity_key, entity_id, created_at)
             VALUES (?, 'customer_order_count', 'order_create', ?, ?)
             ON CONFLICT(request_id, entity_type, entity_key) DO NOTHING`
          ).bind(criticalOperation.requestId, plan.customerId, requestedAt).run();
        }
        operationContext = { ...operationContext, plan, recoveredLegacyCreatePlan: true };
        await advanceCriticalOperation(db, criticalOperation, criticalOperation.row.step, { context: operationContext });
      } else {
        const orderDate = normalizeDate(input.orderDate);
        const externalId = cleanText(operationContext.externalId) || proposedExternalId;
        const managerName = upperText(input.managerName);
        let managerId: number | null = null;
        try {
          managerId = await resolveActiveManagerId(db, input.managerId, managerName);
        } catch (error) {
          throw new OrderInputValidationError(error instanceof Error ? error.message : 'Выберите действующего менеджера перед созданием заказа.');
        }
        if (!managerId) throw new OrderInputValidationError('Выберите действующего менеджера перед созданием заказа.');

        const customerPhone = normalizePhone(input.customerPhone);
        if (cleanText(input.customerPhone) && !customerPhone) {
          throw new OrderInputValidationError('Телефон клиента должен содержать цифры.');
        }
        const customerName = cleanText(input.customerName);
        const city = cleanText(input.city);
        const deliveryType = cleanText(input.deliveryType);
        const sourceType = normalizeSourceType(input.sourceType);
        const workshopStatus = normalizeWorkshopStatus(input.workshopStatus);
        const orderStatus = normalizeOrderStatus(input.orderStatus);
        const comment = cleanText(input.comment);
        const items = Array.isArray(input.items) ? input.items : [];
        const payments = Array.isArray(input.payments) ? input.payments : [];

        assertOrderItemInputs(items);
        assertOrderPaymentInputs(payments);
        assertOrderTotalInput(input.orderTotal);
        const normalizedItems = normalizeOrderItems(items, sourceType);
        const normalizedPayments = normalizeOrderPayments(payments, orderDate).map(payment => (
          payment.paymentKind === 'primary'
            ? { ...payment, paymentDate: orderDate }
            : payment
        ));

        for (const item of normalizedItems) {
          if (item.observedPhysicalQuantity === null) continue;
          if (item.isWorkshop) {
            throw new OrderInputValidationError('Фактический остаток можно уточнить только для Склада или Бутика, не для Цеха.');
          }
          if (!Number.isInteger(item.observedPhysicalQuantity) || item.observedPhysicalQuantity < 0) {
            throw new OrderInputValidationError(`Фактическое количество для «${item.productName}» должно быть целым числом от 0.`);
          }
        }
        if (!normalizedItems.length) throw new OrderInputValidationError('Добавьте хотя бы один товар в заказ.');

        const totals = calculateTotals(normalizedItems, normalizedPayments, input.orderTotal);
        if (totals.receivedAmount > totals.totalAmount) {
          throw new OrderInputValidationError(`Оплаты (${totals.receivedAmount}) больше цены заказа (${totals.totalAmount}). Исправьте цену или оплаты.`);
        }
        const paymentStatus = totals.debtAmount <= 0
          ? 'Оплачено'
          : totals.receivedAmount > 0
            ? 'Частично'
            : 'Не оплачено';
        const createdAt = cleanText(operationContext.createdAt) || requestedAt;
        if (normalizedItems.some(item => item.isWorkshop)) await assertWorkshopTaskDetailSchema(db);

        const preResolvedCatalog: Array<{ productId: number | null; variantId: number | null }> = [];
        const observedByVariant = new Map<string, number>();
        for (const item of normalizedItems) {
          const resolved = item.isWorkshop
            ? await resolveWorkshopCatalogProductOnly(db, item)
            : await resolveCatalogProductAndVariant(db, item, createdAt);
          preResolvedCatalog.push(resolved);
          if (item.observedPhysicalQuantity === null) continue;
          if (!resolved.productId || !resolved.variantId) {
            throw new OrderInputValidationError(`Нельзя подтверждать фактический остаток для «${item.productName}», пока товар или одна из характеристик не распознаны системой.`);
          }
          const observationKey = `${item.inventorySource}:${resolved.variantId}`;
          const previous = observedByVariant.get(observationKey);
          if (previous !== undefined && previous !== item.observedPhysicalQuantity) {
            throw new OrderInputValidationError(`Для одной позиции «${item.productName}» указаны разные фактические количества (${previous} и ${item.observedPhysicalQuantity}). Оставьте одно подтверждённое значение.`);
          }
          if (previous !== undefined) {
            item.observedPhysicalQuantity = null;
          } else {
            observedByVariant.set(observationKey, item.observedPhysicalQuantity);
          }
        }

        await assertCreateOrderShortageDecisions(db, normalizedItems, preResolvedCatalog);
        const customerId = await upsertCustomerIdentityForOrderCreate(db, customerPhone, customerName, city, createdAt);
        plan = {
          externalId,
          createdAt,
          orderDate,
          managerId,
          managerName,
          customerId,
          city,
          deliveryType,
          sourceType,
          workshopStatus,
          orderStatus,
          comment,
          normalizedItems,
          normalizedPayments,
          totals,
          paymentStatus,
          preResolvedCatalog,
        };
        operationContext = { ...operationContext, plan };
        await advanceCriticalOperation(db, criticalOperation, 'validated', { context: operationContext });
      }
    }

    if (!plan) throw new Error('Не удалось восстановить безопасный план создания заказа.');
    const externalId = cleanText(plan.externalId);
    const createdAt = cleanText(plan.createdAt) || requestedAt;
    const normalizedItems = plan.normalizedItems as ReturnType<typeof normalizeOrderItems>;
    const normalizedPayments = plan.normalizedPayments as ReturnType<typeof normalizeOrderPayments>;
    const preResolvedCatalog = plan.preResolvedCatalog as Array<{ productId: number | null; variantId: number | null }>;
    const totals = plan.totals as { totalAmount: number; receivedAmount: number; debtAmount: number };
    const managerId = toInt(plan.managerId, 0) || null;
    const managerName = cleanText(plan.managerName);
    const customerId = toInt(plan.customerId, 0) || null;
    const city = cleanText(plan.city);
    const deliveryType = cleanText(plan.deliveryType);
    const sourceType = normalizeSourceType(plan.sourceType);
    const workshopStatus = normalizeWorkshopStatus(plan.workshopStatus);
    const orderStatus = normalizeOrderStatus(plan.orderStatus);
    const comment = cleanText(plan.comment);
    const orderDate = normalizeDate(plan.orderDate);
    const paymentStatus = cleanText(plan.paymentStatus) || (totals.debtAmount <= 0 ? 'Оплачено' : totals.receivedAmount > 0 ? 'Частично' : 'Не оплачено');

    let orderId = toInt(criticalOperation.row.target_id, 0);
    if (!orderId) {
      if (criticalOperation.row.step !== 'validated') {
        throw new CriticalOperationConflictError('Безопасное создание заказа остановилось на неожиданном этапе. Повторите сохранение после обновления страницы.');
      }
      const orderStatement = db.prepare(
        `INSERT INTO orders (
          external_id, order_date, manager_id, manager_snapshot_name, customer_id, city,
          delivery_type, source_type, workshop_status, order_status, total_amount,
          received_amount, debt_amount, return_amount, comment, shipping_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'not_sent', ?, ?)`
      ).bind(
        externalId, orderDate, managerId, managerName, customerId, city || null, deliveryType || null,
        sourceType, workshopStatus, orderStatus, totals.totalAmount, totals.receivedAmount, totals.debtAmount,
        comment || null, createdAt, createdAt,
      );
      orderId = await updateCriticalOperationTargetFromLastInsert(
        db, criticalOperation, 'order', externalId, orderStatement, 'order_created',
      );
    }
    if (!orderId) throw new Error('Заказ не был создан в базе.');

    let insertedContent = operationContext.insertedContent as { stockResults?: unknown[]; workshopCount?: number } | undefined;
    if (criticalOperation.row.step === 'order_created' || (criticalOperation.row.step === 'content_written' && !insertedContent)) {
      await markCreateCustomerOrderCount(db, criticalOperation, customerId, createdAt);
      const content = await insertOrderContent(
        db,
        orderId,
        externalId,
        normalizedItems,
        normalizedPayments,
        createdAt,
        'order',
        externalId,
        undefined,
        preResolvedCatalog,
        criticalOperation,
        'order_create',
      );
      insertedContent = {
        stockResults: content.stockResults,
        workshopCount: content.workshopCount,
      };
      operationContext = { ...operationContext, insertedContent };
      await advanceCriticalOperation(db, criticalOperation, 'content_written', { context: operationContext });
    }

    if (criticalOperation.row.step !== 'content_written') {
      throw new CriticalOperationConflictError('Безопасное создание заказа остановилось до записи содержимого. Нажмите «Сохранить заказ» ещё раз.');
    }

    const stockResults = Array.isArray(insertedContent?.stockResults) ? insertedContent.stockResults : [];
    const workshopCount = Math.max(0, toInt(insertedContent?.workshopCount, normalizedItems.filter(item => item.isWorkshop).length));
    const response = {
      ok: true,
      orderId,
      externalId,
      totalAmount: totals.totalAmount,
      receivedAmount: totals.receivedAmount,
      debtAmount: totals.debtAmount,
      paymentStatus,
      stockWriteOff: stockResults,
      workshopCount,
    };
    await completeCriticalOperation(db, criticalOperation, response);

    // Exact reconciliation is deliberately post-commit: it repairs historical counter drift (including
    // an old pre-192B2A4 retry that incremented before creating the target) but can never make an
    // otherwise valid order report failure.
    if (customerId) {
      try {
        await recalculateCustomersAfterStorageCleanup(db, [customerId]);
      } catch (error) {
        console.warn('Customer statistics reconciliation after safe create failed', error);
      }
    }

    try {
      const existingCreateAudit = await db.prepare(
        `SELECT id FROM order_manager_audit WHERE order_id = ? AND action = 'created' AND source = 'order_create' ORDER BY id ASC LIMIT 1`
      ).bind(orderId).first<{ id: number }>();
      if (!existingCreateAudit?.id) {
        await writeOrderManagerAudit(db, {
          orderId,
          externalId,
          previousManagerId: null,
          previousManagerName: null,
          newManagerId: managerId,
          newManagerName: managerName,
          action: 'created',
          source: 'order_create',
          actor,
          details: 'Менеджер зафиксирован при создании заказа.',
          createdAt,
        });
      }
    } catch (error) {
      console.warn('Order manager audit after safe create failed', error);
    }
    try {
      await writeActivityLog(db, {
        eventType: 'order_created',
        entityType: 'order',
        entityId: orderId,
        orderId,
        externalOrderId: externalId,
        title: `Создан заказ ${externalId}`,
        details: `Позиций: ${normalizedItems.length}; оплат: ${normalizedPayments.length}; цех: ${workshopCount}`,
        amount: totals.totalAmount,
        createdAt,
      });
    } catch (error) {
      console.warn('Order activity log after safe create failed', error);
    }
    return response;
  } catch (error) {
    const contentAlreadyWritten = criticalOperation?.row.status === 'started' && criticalOperation.row.step === 'content_written';
    if (
      criticalOperation?.leaseToken
      && criticalOperation.row.step === 'started'
      && !criticalOperation.row.target_id
      && (error instanceof OrderInputValidationError || error instanceof OrderStockShortageError || error instanceof CriticalOperationConflictError)
    ) {
      try {
        const discarded = await db.prepare(
          `DELETE FROM critical_operations
           WHERE request_id = ? AND status = 'started' AND step = 'started' AND target_id IS NULL AND lease_token = ?
             AND NOT EXISTS (SELECT 1 FROM critical_operation_entities e WHERE e.request_id = critical_operations.request_id)`
        ).bind(criticalOperation.requestId, criticalOperation.leaseToken).run();
        if (toInt(discarded.meta?.changes, 0) > 0) criticalOperation = null;
      } catch {
        // If cleanup fails, failCriticalOperation below still releases the lease for a safe retry.
      }
    }
    await failCriticalOperation(db, criticalOperation, error);
    if (contentAlreadyWritten) {
      throw new CriticalOperationConflictError('Основные данные заказа уже записаны, но подтверждение операции не завершилось. Нажмите «Сохранить заказ» ещё раз — повторная отправка безопасно продолжит тот же запрос.');
    }
    throw error;
  }
}


export async function updateOrderCritical(
  db: D1Database,
  id: number,
  input: OrderInput,
  actor: AuthUser | null,
  checkedBy: string,
) {
  let criticalOperation: CriticalOperationHandle | null = null;
  try {
    criticalOperation = await beginCriticalOperation(db, 'order_edit', input.requestId, { orderId: id, ...input }, { orderId: id });
    if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse;
    let operationContext = parseCriticalContext<Record<string, any>>(criticalOperation.row);
    let plan = operationContext.plan as Record<string, any> | undefined;

    if (!plan) {
      const existing = await getOrder(db, id);
      if (!existing) throw new CriticalOperationConflictError('Заказ не найден. Обновите список заказов и повторите действие.');
      if (isArchivedOrder(existing)) throw new CriticalOperationConflictError(`Заказ ${(existing as any).external_id} находится в архиве. Архивные заказы доступны только для просмотра.`);

      const existingAny = existing as any;
      const timestamp = new Date().toISOString();
      const nextOrderDate = normalizeDate(input.orderDate ?? existingAny.order_date);
      const nextManager = input.managerName !== undefined ? upperText(input.managerName) : cleanText(existingAny.manager_name);
      const existingManagerId = toInt(existingAny.manager_id ?? existingAny.managerId, 0) || null;
      let nextManagerId: number | null = existingManagerId;
      try {
        nextManagerId = input.managerId !== undefined
          ? await resolveActiveManagerId(db, input.managerId, nextManager)
          : (input.managerName !== undefined ? await resolveActiveManagerId(db, null, nextManager) : existingManagerId);
      } catch (error) {
        throw new OrderInputValidationError(error instanceof Error ? error.message : 'У заказа должен быть выбран действующий менеджер.');
      }
      if (!nextManagerId) throw new OrderInputValidationError('У заказа должен быть выбран действующий менеджер.');
      const nextPhone = input.customerPhone !== undefined ? normalizePhone(input.customerPhone) : cleanText(existingAny.customer_phone);
      if (input.customerPhone !== undefined && cleanText(input.customerPhone) && !nextPhone) throw new OrderInputValidationError('Телефон клиента должен содержать цифры.');
      const nextCustomerName = input.customerName !== undefined ? cleanText(input.customerName) : cleanText(existingAny.customer_name);
      const nextCity = input.city !== undefined ? cleanText(input.city) : cleanText(existingAny.city);
      let nextCustomerId: number | null = null;
      const nextDelivery = input.deliveryType !== undefined ? cleanText(input.deliveryType) : cleanText(existingAny.delivery_type);
      const nextSource = input.sourceType ? normalizeSourceType(input.sourceType) : normalizeSourceType(existingAny.source_type);
      const nextWorkshopStatus = input.workshopStatus ? normalizeWorkshopStatus(input.workshopStatus) : normalizeWorkshopStatus(existingAny.workshop_status);
      const nextOrderStatus = input.orderStatus ? normalizeOrderStatus(input.orderStatus) : normalizeOrderStatus(existingAny.order_status);
      const existingOrderStatus = normalizeOrderStatus(existingAny.order_status);
      const existingWorkshopStatus = normalizeWorkshopStatus(existingAny.workshop_status);
      const existingShippingStatus = normalizeShippingStatus(existingAny.shipping_status);
      const workingModeEdit = actor?.role !== 'admin';
      if (workingModeEdit && (existingOrderStatus !== 'active' || existingShippingStatus === 'sent')) {
        throw new CriticalOperationConflictError('Этот заказ уже вышел из обычного активного редактирования. Используйте его штатное действие: возврат, обмен, отправку или административное восстановление.');
      }
      const deletingOrder = existingOrderStatus !== 'deleted' && nextOrderStatus === 'deleted';
      const finalWorkshopStatus = deletingOrder && nextWorkshopStatus === 'in_workshop' ? 'cancelled' : nextWorkshopStatus;
      const nextComment = input.comment !== undefined ? cleanText(input.comment) : cleanText(existingAny.comment);
      const nextShippingStatus = input.shippingStatus !== undefined
        ? normalizeShippingStatus(input.shippingStatus)
        : existingShippingStatus;
      if (workingModeEdit && (
        nextOrderStatus !== existingOrderStatus
        || nextWorkshopStatus !== existingWorkshopStatus
        || nextShippingStatus !== existingShippingStatus
      )) {
        throw new CriticalOperationConflictError('В рабочем режиме редактор исправляет данные заказа, но не меняет его жизненный цикл. Для статуса Цеха, отправки и удаления используйте отдельные штатные действия.');
      }
      const nextShippingDate = nextShippingStatus === 'sent'
        ? normalizeDate(input.shippingDate || existingAny.shipping_date || timestamp)
        : null;

      if (Array.isArray(input.items)) assertOrderItemInputs(input.items);
      if (Array.isArray(input.payments)) assertOrderPaymentInputs(input.payments);
      if (input.orderTotal !== undefined) assertOrderTotalInput(input.orderTotal);
      const requestedItems = Array.isArray(input.items) ? normalizeOrderItems(input.items, nextSource) : null;
      const requestedPayments = Array.isArray(input.payments) ? normalizeOrderPayments(input.payments, nextOrderDate) : null;
      const existingItemsForEdit = normalizeOrderItems((existingAny.items || []) as OrderInput['items'], nextSource);
      const existingPaymentsForEdit = normalizeOrderPayments((existingAny.payments || []) as OrderInput['payments'], nextOrderDate);
      const rawPaymentMethodCorrections = Array.isArray((input as any).paymentMethodCorrections)
        ? (input as any).paymentMethodCorrections as Array<{ paymentId?: unknown; method?: unknown }>
        : [];
      const requestedPaymentMethodCorrections = new Map<number, string>();
      for (const correction of rawPaymentMethodCorrections) {
        const paymentId = toInt(correction?.paymentId, 0);
        const method = upperText(correction?.method);
        if (!paymentId) throw new OrderInputValidationError('Не удалось определить оплату для исправления способа. Обновите заказ и повторите.');
        if (!method) throw new OrderInputValidationError('Способ оплаты не может быть пустым.');
        requestedPaymentMethodCorrections.set(paymentId, method);
      }
      const paymentMethodCorrections: Array<Record<string, any>> = [];
      const isCashPaymentMethod = (value: unknown) => {
        const method = upperText(value);
        return method === 'CASH' || method.includes('НАЛИЧ');
      };
      for (const [paymentId, newMethod] of requestedPaymentMethodCorrections) {
        const payment = await db.prepare(
          `SELECT p.id, p.payment_date, p.method, p.amount, COALESCE(p.payment_kind, 'primary') AS payment_kind,
                  p.comment, o.created_at AS order_created_at,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM exchanges e
                    WHERE e.payment_id = p.id AND e.financial_action = 'extra_payment'
                      AND COALESCE(e.status, 'completed') <> 'cancelled'
                  ) THEN 1 ELSE 0 END AS is_exchange_extra,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM cash_register_entries c WHERE c.source_key = 'payment:' || p.id
                  ) THEN 1 ELSE 0 END AS cash_entry_tracked,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM cash_register_settings s
                    WHERE s.id = 1 AND s.auto_tracking_enabled = 1
                      AND (
                        COALESCE(p.payment_kind, 'primary') IN ('debt_close', 'extra')
                        OR COALESCE(o.created_at, '') >= COALESCE(s.activated_at, '')
                      )
                  ) THEN 1 ELSE 0 END AS cash_tracking_eligible
           FROM payments p
           JOIN orders o ON o.id = p.order_id
           WHERE p.id = ? AND p.order_id = ?
           LIMIT 1`
        ).bind(paymentId, id).first<Record<string, unknown>>();
        if (!payment?.id) throw new OrderInputValidationError('Одна из оплат заказа уже изменилась. Обновите заказ и повторите исправление способа оплаты.');
        const oldMethod = upperText(payment.method);
        if (oldMethod === newMethod) continue;
        const paymentKind = cleanText(payment.payment_kind);
        const relatedType = toInt(payment.is_exchange_extra, 0) > 0
          ? 'exchange_extra'
          : financialOperationTypeFromPaymentKind(paymentKind);
        paymentMethodCorrections.push({
          paymentId,
          paymentDate: normalizeDate(payment.payment_date || nextOrderDate),
          amount: Math.max(0, toInt(payment.amount, 0)),
          paymentKind,
          relatedType,
          oldMethod,
          newMethod,
          comment: cleanText(payment.comment),
          oldIsCash: isCashPaymentMethod(oldMethod),
          newIsCash: isCashPaymentMethod(newMethod),
          cashEntryTracked: toInt(payment.cash_entry_tracked, 0) > 0,
          cashTrackingEligible: toInt(payment.cash_tracking_eligible, 0) > 0,
        });
      }
      const rewriteItems = Boolean(requestedItems && !sameNormalizedOrderItemsForEdit(existingItemsForEdit, requestedItems));
      const rewritePayments = !deletingOrder && Boolean(requestedPayments && !sameNormalizedOrderPaymentsForEdit(existingPaymentsForEdit, requestedPayments));
      const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db);
      const deferShippingCommit = humanInventoryModelEnabled && existingShippingStatus !== 'sent' && nextShippingStatus === 'sent';
      const persistedShippingStatus = deferShippingCommit ? existingShippingStatus : nextShippingStatus;
      const persistedShippingDate = deferShippingCommit ? (cleanText(existingAny.shipping_date) || null) : nextShippingDate;
      if (humanInventoryModelEnabled && existingShippingStatus === 'sent' && nextShippingStatus !== 'sent') {
        throw new CriticalOperationConflictError('Отправленный заказ нельзя вернуть в состояние «не отправлено». Физическое движение товара уже зафиксировано.');
      }
      if (humanInventoryModelEnabled && existingShippingStatus === 'sent' && (rewriteItems || deletingOrder)) {
        throw new CriticalOperationConflictError('Товар уже был физически выдан / отправлен. Состав такого заказа нельзя переписывать или удалять напрямую — используйте возврат, обмен или складскую корректировку.');
      }
      if (humanInventoryModelEnabled && existingShippingStatus !== 'sent' && (rewriteItems || deletingOrder)) {
        const issuedBeforeFullShipping = await db.prepare(
          `SELECT COUNT(*) AS count FROM inventory_reservations WHERE order_id = ? AND status = 'fulfilled'`
        ).bind(id).first<{ count: number }>();
        if (toInt(issuedBeforeFullShipping?.count, 0) > 0) {
          throw new CriticalOperationConflictError('Часть товаров этого заказа уже передана клиенту. Состав заказа нельзя менять или удалять напрямую. Для замены товара используйте «Обмен», для возврата — «Возврат».');
        }
      }
      const nextItems = requestedItems || existingItemsForEdit;
      const nextPayments = deletingOrder ? existingPaymentsForEdit : (requestedPayments || existingPaymentsForEdit);
      if (rewriteItems && nextItems.some(item => item.isWorkshop)) await assertWorkshopTaskDetailSchema(db);
      const inventoryObligationLineage = rewriteItems
        ? await inventoryObligationLineageForRewrite(db, id, nextItems)
        : [];
      let rewritePreResolvedCatalog: Array<{ productId: number | null; variantId: number | null }> | undefined;
      if (rewriteItems) {
        for (const item of nextItems) {
          if (item.observedPhysicalQuantity === null) continue;
          if (item.isWorkshop) throw new OrderInputValidationError('Фактический остаток можно уточнить только для Склада или Бутика, не для Цеха.');
          if (!Number.isInteger(item.observedPhysicalQuantity) || item.observedPhysicalQuantity < 0) {
            throw new OrderInputValidationError(`Фактическое количество для «${item.productName}» должно быть целым числом от 0.`);
          }
        }

        rewritePreResolvedCatalog = [];
        const observedByVariant = new Map<string, number>();
        for (const item of nextItems) {
          const resolved = item.isWorkshop
            ? await resolveWorkshopCatalogProductOnly(db, item)
            : await resolveCatalogProductAndVariant(db, item, timestamp);
          rewritePreResolvedCatalog.push({ productId: resolved.productId, variantId: resolved.variantId });
          if (item.observedPhysicalQuantity === null) continue;
          if (!resolved.productId || !resolved.variantId) {
            throw new OrderInputValidationError(`Нельзя подтверждать фактический остаток для «${item.productName}», пока товар или одна из характеристик не распознаны системой.`);
          }
          const observationKey = `${item.inventorySource}:${resolved.variantId}`;
          const previous = observedByVariant.get(observationKey);
          if (previous !== undefined && previous !== item.observedPhysicalQuantity) {
            throw new OrderInputValidationError(`Для одной позиции «${item.productName}» указаны разные фактические количества (${previous} и ${item.observedPhysicalQuantity}). Оставьте одно подтверждённое значение.`);
          }
          if (previous !== undefined) {
            item.observedPhysicalQuantity = null;
          } else {
            observedByVariant.set(observationKey, item.observedPhysicalQuantity);
          }
        }
        await assertCreateOrderShortageDecisions(db, nextItems, rewritePreResolvedCatalog, { excludeOrderId: id });
      }
      if (humanInventoryModelEnabled && existingShippingStatus !== 'sent' && nextShippingStatus === 'sent') {
        if (rewriteItems) {
          const unresolvedNames = nextItems
            .map((item, index) => ({ item, resolved: rewritePreResolvedCatalog?.[index] }))
            .filter(({ item, resolved }) => !item.isWorkshop && (!resolved?.productId || !resolved?.variantId))
            .map(({ item }) => item.productName);
          if (unresolvedNames.length) {
            throw new CriticalOperationConflictError(`Нельзя одновременно сохранить состав и отметить заказ отправленным: ${unresolvedNames.length} позици${unresolvedNames.length === 1 ? 'я требует' : 'и требуют'} разбора (${unresolvedNames.slice(0, 3).join(', ')}). Сначала сохраните заказ и разберите неизвестные факты.`);
          }
        } else {
          const blockers = await getOrderShipmentInventoryBlockers(db, id);
          if (blockers.length) throw new CriticalOperationConflictError(orderShipmentInventoryBlockerMessage(blockers));
        }
      }
      if (!nextItems.length) throw new OrderInputValidationError('В заказе должна быть хотя бы одна позиция.');
      const totals = calculateTotals(nextItems, nextPayments, input.orderTotal !== undefined ? input.orderTotal : existingAny.total_amount);
      if (totals.receivedAmount > totals.totalAmount) throw new OrderInputValidationError(`Оплаты (${totals.receivedAmount}) больше цены заказа (${totals.totalAmount}). Исправьте цену или оплаты.`);
      if (rewriteItems || rewritePayments || deletingOrder) {
        const operations = await completedOrderOperationCounts(db, id);
        if (operations.returns > 0 || operations.exchanges > 0) {
          const parts = [
            operations.returns > 0 ? `возвратов: ${operations.returns}` : '',
            operations.exchanges > 0 ? `обменов: ${operations.exchanges}` : '',
          ].filter(Boolean).join(', ');
          throw new CriticalOperationConflictError(`У заказа есть действующие операции (${parts}). Сначала отмените возвраты или обмены, затем редактируйте либо удаляйте заказ.`);
        }
      }

      nextCustomerId = await upsertCustomerIdentityForOrderCreate(db, nextPhone, nextCustomerName, nextCity, timestamp);

      plan = {
        timestamp,
        externalId: cleanText(existingAny.external_id),
        existingManagerId, existingCustomerId: toInt(existingAny.customer_id, 0) || null,
        previousManagerName: cleanText(existingAny.manager_name || existingAny.manager_snapshot_name),
        nextOrderDate, nextManager, nextManagerId, nextCustomerId, nextCity, nextDelivery, nextSource,
        finalWorkshopStatus, nextOrderStatus, nextShippingStatus, nextShippingDate,
        persistedShippingStatus, persistedShippingDate, nextComment,
        rewriteItems, rewritePayments, deletingOrder, deferShippingCommit,
        paymentMethodCorrections,
        nextItems, nextPayments, totals, rewritePreResolvedCatalog: rewritePreResolvedCatalog || null,
        inventoryObligationLineage, humanInventoryModelEnabled,
      };
      operationContext = { ...operationContext, plan };
      await advanceCriticalOperation(db, criticalOperation, 'validated', { targetType: 'order', targetId: id, targetRef: plan.externalId, context: operationContext });
    }

    const p = plan!;
    let stockReversals = Array.isArray(operationContext.stockReversals) ? operationContext.stockReversals : [];
    if (criticalOperation.row.step === 'validated') {
      stockReversals = (p.rewriteItems || p.deletingOrder)
        ? await reverseOrderStockWriteOffsForEdit(db, id, p.externalId, p.timestamp)
        : [];
      if (p.deletingOrder) {
        await db.batch([
          db.prepare(
            `UPDATE order_items SET stock_writeoff_status = 'reversed_delete'
             WHERE order_id = ? AND is_workshop = 0 AND stock_writeoff_status IN ('written_off', 'negative', 'pending_writeoff', 'reversed_edit')`
          ).bind(id),
          db.prepare(`UPDATE workshop_tasks SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'active'`).bind(p.timestamp, id),
        ]);
      }
      if (p.rewriteItems) await retireOrderItemsForRewrite(db, id, p.timestamp);
      if (p.deletingOrder) {
        // Deletion is logical for the order and must preserve original payment rows as historical facts.
        // Append one idempotent reversal per payment; the existing cash order-delete trigger owns physical cash out.
        await removeOrderPaymentsWithMoneyEvents(db, {
          orderId: id, externalOrderId: p.externalId, timestamp: p.timestamp,
          reason: 'order_delete',
          comment: `Оплаты сняты при удалении заказа ${p.externalId}`,
          preservePayments: true,
        });
      } else if (p.rewritePayments) {
        await removeOrderPaymentsWithMoneyEvents(db, {
          orderId: id, externalOrderId: p.externalId, timestamp: p.timestamp,
          reason: 'order_edit',
          comment: `Старые оплаты сняты при исправлении заказа ${p.externalId}`,
        });
      }
      operationContext = { ...operationContext, stockReversals };
      await advanceCriticalOperation(db, criticalOperation, 'old_content_retired', { context: operationContext });
    }

    if (criticalOperation.row.step === 'old_content_retired') {
      await db.prepare(
        `UPDATE orders SET order_date = ?, manager_id = ?, manager_snapshot_name = ?, customer_id = ?, city = ?,
            delivery_type = ?, source_type = ?, workshop_status = ?, order_status = ?, shipping_status = ?, shipping_date = ?,
            total_amount = ?, received_amount = ?, debt_amount = ?, updated_at = ?, comment = ? WHERE id = ?`
      ).bind(
        p.nextOrderDate, p.nextManagerId, p.nextManager, p.nextCustomerId, p.nextCity || null, p.nextDelivery || null,
        p.nextSource, p.finalWorkshopStatus, p.nextOrderStatus, p.persistedShippingStatus, p.persistedShippingDate,
        p.totals.totalAmount, p.totals.receivedAmount, p.totals.debtAmount, p.timestamp, p.nextComment || null, id,
      ).run();
      await advanceCriticalOperation(db, criticalOperation, 'order_updated');
    }

    let insertedContent = operationContext.insertedContent || { stockResults: [], workshopCount: 0 };
    if (criticalOperation.row.step === 'order_updated') {
      if (p.rewriteItems || p.rewritePayments) {
        insertedContent = await insertOrderContent(
          db, id, p.externalId,
          p.rewriteItems ? p.nextItems : [], p.rewritePayments ? p.nextPayments : [], p.timestamp,
          'order_edit_new', p.externalId,
          p.rewriteItems ? `Новый резерв после редактирования заказа ${p.externalId}` : undefined,
          p.rewriteItems && Array.isArray(p.rewritePreResolvedCatalog) ? p.rewritePreResolvedCatalog : undefined,
          criticalOperation, 'order_edit',
          Array.isArray(p.inventoryObligationLineage) ? p.inventoryObligationLineage : undefined,
        );
      }
      operationContext = { ...operationContext, insertedContent };
      await advanceCriticalOperation(db, criticalOperation, 'new_content_written', { context: operationContext });
    }

    let inventoryDelivery = operationContext.inventoryDelivery || null;
    if (criticalOperation.row.step === 'new_content_written') {
      inventoryDelivery = p.deferShippingCommit
        ? await fulfillOrderReservationsV2(db, id, p.externalId, p.timestamp, { shippingDate: p.nextShippingDate, checkedBy })
        : null;
      operationContext = { ...operationContext, inventoryDelivery };
      await advanceCriticalOperation(db, criticalOperation, 'shipping_committed', { context: operationContext });
    }

    const paymentMethodCorrectionCount = Array.isArray(p.paymentMethodCorrections) ? p.paymentMethodCorrections.length : 0;
    if (criticalOperation.row.step === 'shipping_committed' && paymentMethodCorrectionCount) {
      for (const correction of p.paymentMethodCorrections as Array<Record<string, any>>) {
        const eventSourceRef = `payments:${correction.paymentId}:method-correction:${criticalOperation.requestId}`;
        const amount = Math.abs(toInt(correction.amount, 0));
        const statements: D1PreparedStatement[] = [
          db.prepare(`UPDATE payments SET method = ? WHERE id = ? AND order_id = ?`)
            .bind(correction.newMethod, correction.paymentId, id),
        ];
        if (amount > 0) {
          statements.unshift(
            financialEventStatement(db, {
              eventKey: `1901:${criticalOperation.requestId}:payment-method:${correction.paymentId}:old`,
              orderId: id,
              externalOrderId: p.externalId,
              eventDate: correction.paymentDate,
              eventAt: p.timestamp,
              eventType: 'payment_reversal',
              relatedType: correction.relatedType,
              amountDelta: -amount,
              paymentMethod: correction.oldMethod,
              sourceType: 'payment',
              sourceId: correction.paymentId,
              sourceRef: eventSourceRef,
              reason: 'payment_method_correction',
              comment: `Исправлен способ оплаты: ${correction.oldMethod} → ${correction.newMethod}`,
            }),
            financialEventStatement(db, {
              eventKey: `1901:${criticalOperation.requestId}:payment-method:${correction.paymentId}:new`,
              orderId: id,
              externalOrderId: p.externalId,
              eventDate: correction.paymentDate,
              eventAt: p.timestamp,
              eventType: correction.relatedType,
              amountDelta: amount,
              paymentMethod: correction.newMethod,
              sourceType: 'payment',
              sourceId: correction.paymentId,
              sourceRef: eventSourceRef,
              reason: 'payment_method_correction',
              comment: `Исправлен способ оплаты: ${correction.oldMethod} → ${correction.newMethod}`,
            }),
          );
        }
        const cashDirection = amount > 0 && correction.oldIsCash && !correction.newIsCash && correction.cashEntryTracked
          ? 'out'
          : (amount > 0 && !correction.oldIsCash && correction.newIsCash && correction.cashTrackingEligible ? 'in' : '');
        if (cashDirection) {
          statements.push(db.prepare(
            `INSERT OR IGNORE INTO cash_register_entries (
              occurred_at, business_date, direction, amount, entry_type,
              source_type, source_id, source_key, order_id, external_order_id,
              payment_method, comment, created_by, created_at
            ) VALUES (?, date('now', '+5 hours'), ?, ?, 'payment_method_correction',
                      'payment_method_correction', ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            p.timestamp,
            cashDirection,
            amount,
            String(correction.paymentId),
            `payment-method-correction:${criticalOperation.requestId}:${correction.paymentId}:${cashDirection}`,
            id,
            p.externalId,
            correction.newMethod,
            `Исправлен способ оплаты: ${correction.oldMethod} → ${correction.newMethod}`,
            cleanText(checkedBy) || 'admin',
            p.timestamp,
          ));
        }
        await db.batch(statements);
      }
    }

    const completedResponse = {
      ok: true,
      refreshRequired: true,
      stockReversals: operationContext.stockReversals || stockReversals,
      stockWriteOff: operationContext.insertedContent?.stockResults || insertedContent.stockResults || [],
      workshopCount: operationContext.insertedContent?.workshopCount ?? insertedContent.workshopCount ?? 0,
      inventoryDelivery: operationContext.inventoryDelivery ?? inventoryDelivery,
      paymentMethodCorrectionCount,
    };
    await completeCriticalOperation(db, criticalOperation, completedResponse);

    try {
      await recalculateCustomersAfterStorageCleanup(db, [p.existingCustomerId, p.nextCustomerId].map((value) => toInt(value, 0)).filter(Boolean));
    } catch (error) {
      console.warn('Customer statistics reconciliation after safe edit failed', error);
    }

    let updatedOrder = null;
    try {
      updatedOrder = await getOrder(db, id);
    } catch (error) {
      console.warn('Order readback after safe edit failed', error);
    }
    const response = updatedOrder
      ? { ...completedResponse, order: updatedOrder, refreshRequired: false }
      : completedResponse;

    if (p.existingManagerId !== p.nextManagerId || upperText(p.previousManagerName) !== upperText(p.nextManager)) {
      try {
        await writeOrderManagerAudit(db, {
          orderId: id, externalId: p.externalId, previousManagerId: p.existingManagerId,
          previousManagerName: p.previousManagerName, newManagerId: p.nextManagerId, newManagerName: p.nextManager,
          action: 'changed', source: 'admin_order_edit', actor,
          details: 'Менеджер исправлен через полное редактирование заказа.', createdAt: p.timestamp,
        });
      } catch (error) { console.warn('Order manager audit after safe edit failed', error); }
    }
    try {
      await writeActivityLog(db, {
        eventType: 'order_updated', entityType: 'order', entityId: id, orderId: id, externalOrderId: p.externalId,
        title: `Изменён заказ ${p.externalId}`,
        details: `${p.deletingOrder ? (p.humanInventoryModelEnabled ? 'Заказ удалён; резерв освобождён; цех снят; ' : 'Заказ удалён; остатки возвращены; цех снят; ') : ''}${p.rewriteItems ? 'Товары обновлены; ' : ''}${p.rewritePayments ? 'оплаты обновлены; ' : ''}${paymentMethodCorrectionCount ? `способ оплаты исправлен: ${paymentMethodCorrectionCount}; ` : ''}статус отправки: ${p.nextShippingStatus}`,
        amount: p.totals.totalAmount, createdAt: p.timestamp,
      });
    } catch (error) {
      console.warn('Order activity log after safe edit failed', error);
    }
    return response;
  } catch (error) {
    const editAlreadyWritten = criticalOperation?.row.status === 'started' && criticalOperation.row.step === 'shipping_committed';
    if (criticalOperation?.leaseToken && criticalOperation.row.step === 'started' && !criticalOperation.row.target_id && (error instanceof OrderInputValidationError || error instanceof OrderStockShortageError || error instanceof CriticalOperationConflictError)) {
      try {
        const discarded = await db.prepare(
          `DELETE FROM critical_operations
           WHERE request_id = ? AND status = 'started' AND step = 'started' AND target_id IS NULL AND lease_token = ?
             AND NOT EXISTS (SELECT 1 FROM critical_operation_entities e WHERE e.request_id = critical_operations.request_id)`
        ).bind(criticalOperation.requestId, criticalOperation.leaseToken).run();
        if (toInt(discarded.meta?.changes, 0) > 0) criticalOperation = null;
      } catch {
        // If cleanup fails, failCriticalOperation below still releases the lease for a safe retry.
      }
    }
    await failCriticalOperation(db, criticalOperation, error);
    if (editAlreadyWritten) {
      throw new CriticalOperationConflictError('Изменения заказа уже записаны, но подтверждение операции не завершилось. Нажмите «Сохранить» ещё раз — повторная отправка безопасно продолжит тот же запрос.');
    }
    throw error;
  }
}


export async function getOrder(db: D1Database, id: number) {
  const order = await db.prepare(
    `SELECT
      o.id, o.external_id, o.order_date, o.manager_id, o.customer_id,
      CASE WHEN m.id IS NOT NULL THEN m.name WHEN NULLIF(TRIM(COALESCE(o.manager_snapshot_name, '')), '') IS NOT NULL THEN o.manager_snapshot_name || ' · исторический менеджер' ELSE 'Менеджер требует уточнения' END AS manager_name,
      o.manager_snapshot_name,
      COALESCE(m.color_key, '#64748B') AS manager_color,
      c.phone_normalized AS customer_phone, c.display_name AS customer_name,
      o.city, o.delivery_type, o.source_type, o.workshop_status, o.order_status,
      o.total_amount, o.received_amount, o.debt_amount, o.return_amount, o.comment, o.shipping_status, o.shipping_date,
      o.archived_at, o.archived_by, o.archive_reason, o.archive_batch_id, o.created_at, o.updated_at
     FROM orders o
     LEFT JOIN managers m ON m.id = o.manager_id
     LEFT JOIN customers c ON c.id = o.customer_id
     WHERE o.id = ?`
  ).bind(id).first<OrderListRow & { created_at: string; updated_at: string }>();

  if (!order) {
    return null;
  }

  const relations = await fetchOrderRelations(db, [id]);
  return {
    ...order,
    items: (relations.itemsByOrderId.get(id) || []).map(item => ({
      id: (item as any).id,
      productName: toInt((item as any).product_id, 0) ? cleanText((item as any).canonical_product_name) : cleanText((item as any).product_name_snapshot),
      audienceType: cleanText((item as any).audience_type) || (cleanText((item as any).canonical_category).toLowerCase() === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ'),
      gender: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_gender) : cleanText((item as any).gender_snapshot),
      color: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_color) : cleanText((item as any).color_snapshot),
      material: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_material) : cleanText((item as any).material_snapshot),
      length: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_length) : cleanText((item as any).length_snapshot),
      size: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_size) : cleanText((item as any).size_snapshot),
      quantity: (item as any).quantity,
      unitPrice: (item as any).unit_price,
      lineTotal: (item as any).line_total,
      sourceType: (item as any).is_workshop ? 'workshop' : (item as any).source_type,
      isWorkshop: Boolean((item as any).is_workshop),
      workshopComment: (item as any).workshop_comment,
      workshopUrgent: Boolean((item as any).workshop_urgent),
      workshopDueDate: (item as any).workshop_due_date || '',
      workshopTaskStatus: workshopTaskStatusForOrderItem(
        item as Record<string, unknown>,
        relations.workshopTasksByOrderId.get(id) || [],
      ),
    })),
    payments: (relations.paymentsByOrderId.get(id) || []).map(payment => ({
      id: (payment as any).id,
      paymentDate: (payment as any).payment_date,
      method: (payment as any).method,
      amount: (payment as any).amount,
      paymentKind: (payment as any).payment_kind,
      comment: (payment as any).comment,
    })),
    returns: (relations.returnsByOrderId.get(id) || []).map(ret => ({
      id: (ret as any).id,
      returnDate: (ret as any).return_date,
      amount: (ret as any).amount,
      comment: (ret as any).comment,
      status: (ret as any).status || 'completed',
      cancelledAt: (ret as any).cancelled_at || null,
      cancellationComment: (ret as any).cancellation_comment || null,
    })),
  };
}
