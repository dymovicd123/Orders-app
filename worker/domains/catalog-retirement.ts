// Branch2-first safe Catalog retirement.
// Working Catalog/Inventory state is removed without deleting historical order/movement facts.
import { cleanText, toInt } from '../core/text.ts'

export type CatalogRetirementEntityType = 'execution' | 'product';

export type CatalogRetirementPreview = {
  entityType: CatalogRetirementEntityType;
  entityId: number;
  productId: number;
  productName: string;
  material: string | null;
  length: string | null;
  active: boolean;
  activeVariantCount: number;
  physicalQuantity: number;
  stockReservedQuantity: number;
  activeReservationQuantity: number;
  historicalOrderItemCount: number;
  openOrderItemCount: number;
  activeWorkshopTaskCount: number;
  activeStocktake: boolean;
  pendingLifecycle: boolean;
};

function catalogRetirementVariantPredicate(entityType: CatalogRetirementEntityType, alias = 'v') {
  return entityType === 'execution'
    ? `${alias}.stock_position_id = ?`
    : `${alias}.product_id = ?`;
}

async function loadCatalogRetirementTarget(db: D1Database, entityType: CatalogRetirementEntityType, entityId: number) {
  if (entityType === 'execution') {
    return await db.prepare(
      `SELECT sp.id AS entity_id, sp.product_id, p.name AS product_name,
              sp.material, sp.length, sp.is_active AS entity_active, p.is_active AS product_active
       FROM catalog_stock_positions sp
       JOIN catalog_products p ON p.id = sp.product_id
       WHERE sp.id = ? LIMIT 1`
    ).bind(entityId).first<Record<string, unknown>>();
  }
  return await db.prepare(
    `SELECT p.id AS entity_id, p.id AS product_id, p.name AS product_name,
            NULL AS material, NULL AS length, p.is_active AS entity_active, p.is_active AS product_active
     FROM catalog_products p
     WHERE p.id = ? LIMIT 1`
  ).bind(entityId).first<Record<string, unknown>>();
}

export async function previewCatalogRetirement(
  db: D1Database,
  entityType: CatalogRetirementEntityType,
  entityId: number,
): Promise<CatalogRetirementPreview> {
  if (!entityId) throw new Error(entityType === 'execution' ? 'Исполнение не найдено.' : 'Товар не найден.');
  const target = await loadCatalogRetirementTarget(db, entityType, entityId);
  if (!target?.entity_id) throw new Error(entityType === 'execution' ? 'Исполнение не найдено.' : 'Товар не найден.');
  const predicate = catalogRetirementVariantPredicate(entityType);
  const row = await db.prepare(
    `WITH all_variants AS (
       SELECT id FROM catalog_variants v WHERE ${predicate}
     ), active_variants AS (
       SELECT id FROM catalog_variants v WHERE ${predicate} AND v.is_active = 1
     )
     SELECT
       (SELECT COUNT(*) FROM active_variants) AS active_variant_count,
       COALESCE((SELECT SUM(COALESCE(s.quantity,0)) FROM inventory_stock s WHERE s.variant_id IN (SELECT id FROM active_variants)),0) AS physical_quantity,
       COALESCE((SELECT SUM(COALESCE(s.reserved_quantity,0)) FROM inventory_stock s WHERE s.variant_id IN (SELECT id FROM active_variants)),0) AS stock_reserved_quantity,
       COALESCE((SELECT SUM(COALESCE(r.quantity,0)) FROM inventory_reservations r WHERE r.variant_id IN (SELECT id FROM active_variants) AND r.status='active'),0) AS active_reservation_quantity,
       (SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id IN (SELECT id FROM all_variants)) AS historical_order_item_count,
       (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id
          WHERE oi.variant_id IN (SELECT id FROM active_variants)
            AND COALESCE(o.order_status,'active')='active'
            AND COALESCE(o.shipping_status,'not_sent')<>'sent'
            AND COALESCE(oi.quantity,0)>0) AS open_order_item_count,
       (SELECT COUNT(*) FROM workshop_tasks wt
          WHERE wt.variant_id IN (SELECT id FROM active_variants) AND wt.status IN ('active','ready')) AS active_workshop_task_count,
       EXISTS(
         SELECT 1 FROM inventory_stocktake_items i
         JOIN inventory_stocktake_sessions s ON s.id=i.session_id
         WHERE i.variant_id IN (SELECT id FROM active_variants) AND s.status='active'
         LIMIT 1
       ) AS active_stocktake,
       EXISTS(
         SELECT 1 FROM inventory_lifecycle_events e
         WHERE e.variant_id IN (SELECT id FROM active_variants) AND e.status='pending'
         LIMIT 1
       ) AS pending_lifecycle`
  ).bind(entityId, entityId).first<Record<string, unknown>>();

  return {
    entityType,
    entityId,
    productId: toInt(target.product_id, 0),
    productName: cleanText(target.product_name),
    material: cleanText(target.material) || null,
    length: cleanText(target.length) || null,
    active: toInt(target.entity_active, 0) === 1 && toInt(target.product_active, 0) === 1,
    activeVariantCount: Math.max(0, toInt(row?.active_variant_count, 0)),
    physicalQuantity: toInt(row?.physical_quantity, 0),
    stockReservedQuantity: toInt(row?.stock_reserved_quantity, 0),
    activeReservationQuantity: Math.max(0, toInt(row?.active_reservation_quantity, 0)),
    historicalOrderItemCount: Math.max(0, toInt(row?.historical_order_item_count, 0)),
    openOrderItemCount: Math.max(0, toInt(row?.open_order_item_count, 0)),
    activeWorkshopTaskCount: Math.max(0, toInt(row?.active_workshop_task_count, 0)),
    activeStocktake: toInt(row?.active_stocktake, 0) === 1,
    pendingLifecycle: toInt(row?.pending_lifecycle, 0) === 1,
  };
}

export async function retireCatalogEntity(
  db: D1Database,
  entityType: CatalogRetirementEntityType,
  entityId: number,
  input: { requestId?: unknown; reason?: unknown; actor?: unknown } = {},
) {
  const requestId = cleanText(input.requestId);
  if (!requestId || requestId.length < 8) throw new Error('Для безопасного удаления нужен requestId операции.');
  const replay = await db.prepare(
    `SELECT id, request_id, entity_type, entity_id, product_id, product_name, variant_count,
            physical_quantity, stock_reserved_quantity, active_reservation_quantity, open_order_item_count,
            status, created_at, completed_at
     FROM catalog_retirement_operations WHERE request_id = ? LIMIT 1`
  ).bind(requestId).first<Record<string, unknown>>();
  if (replay?.id) {
    if (cleanText(replay.entity_type) !== entityType || toInt(replay.entity_id, 0) !== entityId) {
      throw new Error('Этот requestId уже использован для другой операции удаления.');
    }
    return {
      ok: true,
      replayed: true,
      requestId,
      retirementId: toInt(replay.id, 0),
      status: cleanText(replay.status),
      variantCount: toInt(replay.variant_count, 0),
      physicalRemoved: toInt(replay.physical_quantity, 0),
      reservationsReleased: toInt(replay.active_reservation_quantity, 0),
    };
  }

  const preview = await previewCatalogRetirement(db, entityType, entityId);
  const hasWorkingState = preview.active
    || preview.activeVariantCount > 0
    || preview.physicalQuantity !== 0
    || preview.stockReservedQuantity !== 0
    || preview.activeReservationQuantity > 0;
  if (!hasWorkingState) {
    return { ok: true, alreadyRetired: true, requestId, entityType, entityId };
  }
  if (preview.activeStocktake) {
    throw new Error('Нельзя удалить позицию во время активной ревизии. Завершите или отмените ревизию и повторите.');
  }
  if (preview.pendingLifecycle) {
    throw new Error('По этой позиции есть незавершённая приёмка/возврат. Сначала завершите её и повторите удаление.');
  }

  const now = new Date().toISOString();
  const reason = cleanText(input.reason) || 'Удалено администратором из рабочего каталога';
  const actor = cleanText(input.actor) || null;
  const targetPredicate = catalogRetirementVariantPredicate(entityType);
  const entityGuardSql = entityType === 'execution'
    ? `sp.id = ? AND p.is_active = 1
       AND (
         sp.is_active = 1
         OR EXISTS (
           SELECT 1 FROM catalog_variants repair_v
           WHERE repair_v.stock_position_id = sp.id AND repair_v.is_active = 1
         )
       )`
    : `p.id = ?
       AND (
         p.is_active = 1
         OR EXISTS (
           SELECT 1 FROM catalog_variants repair_v
           WHERE repair_v.product_id = p.id AND repair_v.is_active = 1
         )
         OR EXISTS (
           SELECT 1 FROM catalog_stock_positions repair_sp
           WHERE repair_sp.product_id = p.id AND repair_sp.is_active = 1
         )
       )`;

  const insertOperation = entityType === 'execution'
    ? db.prepare(
      `INSERT INTO catalog_retirement_operations (
         request_id, entity_type, entity_id, product_id, product_name, material, length,
         reason, created_by, status, created_at
       )
       SELECT ?, 'execution', sp.id, sp.product_id, p.name, sp.material, sp.length,
              ?, ?, 'started', ?
       FROM catalog_stock_positions sp
       JOIN catalog_products p ON p.id=sp.product_id
       WHERE ${entityGuardSql}
         AND NOT EXISTS (
           SELECT 1 FROM inventory_stocktake_items i
           JOIN inventory_stocktake_sessions s ON s.id=i.session_id
           JOIN catalog_variants v ON v.id=i.variant_id
           WHERE v.stock_position_id=sp.id AND v.is_active=1 AND s.status='active'
         )
         AND NOT EXISTS (
           SELECT 1 FROM inventory_lifecycle_events e
           JOIN catalog_variants v ON v.id=e.variant_id
           WHERE v.stock_position_id=sp.id AND v.is_active=1 AND e.status='pending'
         )
         AND NOT EXISTS (SELECT 1 FROM catalog_retirement_operations op WHERE op.request_id=?)`
    ).bind(requestId, reason, actor, now, entityId, requestId)
    : db.prepare(
      `INSERT INTO catalog_retirement_operations (
         request_id, entity_type, entity_id, product_id, product_name, material, length,
         reason, created_by, status, created_at
       )
       SELECT ?, 'product', p.id, p.id, p.name, NULL, NULL,
              ?, ?, 'started', ?
       FROM catalog_products p
       WHERE ${entityGuardSql}
         AND NOT EXISTS (
           SELECT 1 FROM inventory_stocktake_items i
           JOIN inventory_stocktake_sessions s ON s.id=i.session_id
           JOIN catalog_variants v ON v.id=i.variant_id
           WHERE v.product_id=p.id AND v.is_active=1 AND s.status='active'
         )
         AND NOT EXISTS (
           SELECT 1 FROM inventory_lifecycle_events e
           JOIN catalog_variants v ON v.id=e.variant_id
           WHERE v.product_id=p.id AND v.is_active=1 AND e.status='pending'
         )
         AND NOT EXISTS (SELECT 1 FROM catalog_retirement_operations op WHERE op.request_id=?)`
    ).bind(requestId, reason, actor, now, entityId, requestId);

  const statements: D1PreparedStatement[] = [insertOperation];

  statements.push(
    db.prepare(
      `INSERT OR IGNORE INTO catalog_retirement_variants (
         retirement_id, variant_id, stock_position_id, product_id, category, gender, color, material, length, size_label,
         warehouse_quantity, warehouse_reserved_quantity, boutique_quantity, boutique_reserved_quantity,
         active_reservation_quantity, captured_at
       )
       SELECT op.id, v.id, v.stock_position_id, v.product_id, v.category, v.gender, v.color, v.material, v.length, v.size_label,
              COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
              COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
              COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
              COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
              COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
              ?
       FROM catalog_retirement_operations op
       JOIN catalog_variants v ON ${targetPredicate}
       WHERE op.request_id=? AND op.status='started' AND v.is_active=1`
    ).bind(now, entityId, requestId),

    db.prepare(
      `UPDATE catalog_retirement_operations
       SET variant_count = (SELECT COUNT(*) FROM catalog_retirement_variants rv WHERE rv.retirement_id=catalog_retirement_operations.id),
           physical_quantity = COALESCE((SELECT SUM(rv.warehouse_quantity + rv.boutique_quantity) FROM catalog_retirement_variants rv WHERE rv.retirement_id=catalog_retirement_operations.id),0),
           stock_reserved_quantity = COALESCE((SELECT SUM(rv.warehouse_reserved_quantity + rv.boutique_reserved_quantity) FROM catalog_retirement_variants rv WHERE rv.retirement_id=catalog_retirement_operations.id),0),
           active_reservation_quantity = COALESCE((SELECT SUM(rv.active_reservation_quantity) FROM catalog_retirement_variants rv WHERE rv.retirement_id=catalog_retirement_operations.id),0),
           open_order_item_count = COALESCE((
             SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id
             WHERE oi.variant_id IN (SELECT rv.variant_id FROM catalog_retirement_variants rv WHERE rv.retirement_id=catalog_retirement_operations.id)
               AND COALESCE(o.order_status,'active')='active'
               AND COALESCE(o.shipping_status,'not_sent')<>'sent'
               AND COALESCE(oi.quantity,0)>0
           ),0)
       WHERE request_id=? AND status='started'`
    ).bind(requestId),

    db.prepare(
      `INSERT INTO inventory_movements (
         inventory_source, movement_type, product_id, variant_id, product_name_snapshot,
         gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot,
         quantity_delta, quantity_after, reference_type, reference_id, comment, created_at
       )
       SELECT s.inventory_source, 'delete', s.product_id, s.variant_id, s.product_name_snapshot,
              s.gender_snapshot, s.color_snapshot, s.material_snapshot, s.length_snapshot, s.size_snapshot,
              0 - COALESCE(s.quantity,0), 0, 'catalog_retirement', ?,
              'Удаление из рабочего каталога: физический остаток выведен из рабочего склада; история сохранена.', ?
       FROM inventory_stock s
       JOIN catalog_retirement_variants rv ON rv.variant_id=s.variant_id
       JOIN catalog_retirement_operations op ON op.id=rv.retirement_id
       WHERE op.request_id=? AND op.status='started' AND COALESCE(s.quantity,0) <> 0`
    ).bind(requestId, now, requestId),

    db.prepare(
      `UPDATE order_items
       SET stock_writeoff_status='catalog_retired',
           stock_quantity_before=NULL,
           stock_quantity_after=NULL
       WHERE id IN (
         SELECT r.order_item_id
         FROM inventory_reservations r
         JOIN catalog_retirement_variants rv ON rv.variant_id=r.variant_id
         JOIN catalog_retirement_operations op ON op.id=rv.retirement_id
         WHERE op.request_id=? AND op.status='started' AND r.status='active'
       )`
    ).bind(requestId),

    db.prepare(
      `UPDATE inventory_reservations
       SET status='released', released_at=?, fulfilled_at=NULL,
           unresolved_reason='catalog_retired', updated_at=?
       WHERE status='active'
         AND variant_id IN (
           SELECT rv.variant_id FROM catalog_retirement_variants rv
           JOIN catalog_retirement_operations op ON op.id=rv.retirement_id
           WHERE op.request_id=? AND op.status='started'
         )`
    ).bind(now, now, requestId),

    db.prepare(
      `UPDATE inventory_stock
       SET quantity=0, reserved_quantity=0,
           last_action='Удалено из рабочего каталога',
           last_source_ref=?, updated_at=?
       WHERE variant_id IN (
         SELECT rv.variant_id FROM catalog_retirement_variants rv
         JOIN catalog_retirement_operations op ON op.id=rv.retirement_id
         WHERE op.request_id=? AND op.status='started'
       )`
    ).bind(`catalog_retirement:${requestId}`, now, requestId),

    db.prepare(
      `UPDATE catalog_variants
       SET is_active=0, updated_at=?
       WHERE is_active=1
         AND id IN (
           SELECT rv.variant_id FROM catalog_retirement_variants rv
           JOIN catalog_retirement_operations op ON op.id=rv.retirement_id
           WHERE op.request_id=? AND op.status='started'
         )`
    ).bind(now, requestId),
  );

  if (entityType === 'execution') {
    statements.push(
      db.prepare(
        `UPDATE catalog_stock_positions
         SET is_active=0, is_default=0, updated_at=?
         WHERE id=? AND is_active=1
           AND EXISTS (SELECT 1 FROM catalog_retirement_operations WHERE request_id=? AND status='started')`
      ).bind(now, entityId, requestId),
    );
  } else {
    statements.push(
      db.prepare(
        `UPDATE catalog_stock_positions
         SET is_active=0, is_default=0, updated_at=?
         WHERE product_id=? AND is_active=1
           AND EXISTS (SELECT 1 FROM catalog_retirement_operations WHERE request_id=? AND status='started')`
      ).bind(now, entityId, requestId),
      db.prepare(
        `UPDATE catalog_products
         SET is_active=0, updated_at=?
         WHERE id=? AND is_active=1
           AND EXISTS (SELECT 1 FROM catalog_retirement_operations WHERE request_id=? AND status='started')`
      ).bind(now, entityId, requestId),
    );
  }

  statements.push(
    db.prepare(
      `UPDATE catalog_retirement_operations
       SET status='completed', completed_at=?
       WHERE request_id=? AND status='started'`
    ).bind(now, requestId),
  );

  await db.batch(statements);

  const after = await previewCatalogRetirement(db, entityType, entityId);
  if (after.activeVariantCount > 0 || after.physicalQuantity !== 0 || after.stockReservedQuantity !== 0 || after.activeReservationQuantity > 0) {
    throw new Error('Удаление выполнено не полностью. Обновите каталог и повторите удаление; история не повреждена.');
  }

  const operation = await db.prepare(
    `SELECT id, status, variant_count, physical_quantity, stock_reserved_quantity,
            active_reservation_quantity, open_order_item_count
     FROM catalog_retirement_operations WHERE request_id=? LIMIT 1`
  ).bind(requestId).first<Record<string, unknown>>();
  if (!operation?.id) {
    const fresh = await previewCatalogRetirement(db, entityType, entityId);
    const freshHasWorkingState = fresh.active
      || fresh.activeVariantCount > 0
      || fresh.physicalQuantity !== 0
      || fresh.stockReservedQuantity !== 0
      || fresh.activeReservationQuantity > 0;
    if (!freshHasWorkingState) return { ok: true, alreadyRetired: true, requestId, entityType, entityId };
    if (fresh.activeStocktake) throw new Error('Удаление не выполнено: началась ревизия этой позиции. Завершите или отмените её и повторите.');
    if (fresh.pendingLifecycle) throw new Error('Удаление не выполнено: появилась незавершённая приёмка/возврат. Завершите её и повторите.');
    throw new Error('Удаление не выполнено из-за изменения данных. Обновите Каталог и повторите.');
  }

  return {
    ok: true,
    requestId,
    retirementId: toInt(operation.id, 0),
    status: cleanText(operation.status),
    variantCount: Math.max(0, toInt(operation.variant_count, 0)),
    physicalRemoved: toInt(operation.physical_quantity, 0),
    stockReservedRemoved: toInt(operation.stock_reserved_quantity, 0),
    reservationsReleased: Math.max(0, toInt(operation.active_reservation_quantity, 0)),
    openOrderItemsPreserved: Math.max(0, toInt(operation.open_order_item_count, 0)),
  };
}

