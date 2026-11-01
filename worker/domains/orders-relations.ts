// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { cleanText, toInt } from '../core/text.ts'
import { matchWorkshopTasksToOrderItems } from './workshop-matching.ts'
import { fetchOrderStockHandoverRows } from './order-reservations.ts'

export async function isOrderPricingFoundationEnabled(db: D1Database) {
  try {
    await db.prepare(
      `SELECT
         (SELECT pricing_mode FROM orders LIMIT 1) AS pricing_mode,
         (SELECT catalog_price_snapshot FROM order_items LIMIT 1) AS catalog_price_snapshot`
    ).first();
    return true;
  } catch {
    // Migration 0073 is additive. Until it is applied, every existing order is legacy/manual
    // and order reads must keep working without pricing metadata columns.
    return false;
  }
}


export function canonicalItemProjection(item: Record<string, unknown>) {
  const productId = toInt(item.product_id, 0) || null;
  const variantId = toInt(item.variant_id, 0) || null;
  const originalSnapshot = {
    productName: cleanText(item.product_name_snapshot),
    audienceType: cleanText(item.audience_type),
    gender: cleanText(item.gender_snapshot),
    color: cleanText(item.color_snapshot),
    material: cleanText(item.material_snapshot),
    length: cleanText(item.length_snapshot),
    size: cleanText(item.size_snapshot),
  };

  const canonicalProductName = cleanText(item.canonical_product_name);
  const canonicalCategory = cleanText(item.canonical_category).toLowerCase();
  const canonicalProductActive = toInt(item.canonical_product_active, 0) === 1;
  const canonicalVariantActive = toInt(item.canonical_variant_active, 0) === 1;
  const retiredLinkedIdentity = Boolean((productId && !canonicalProductActive) || (variantId && !canonicalVariantActive));
  // Retired Catalog rows are historical identity anchors only. Once retired, an order must render
  // from its immutable order-time snapshots so later Catalog changes/reactivation cannot rewrite history.
  const hasCanonicalProduct = Boolean(productId && canonicalProductName && canonicalProductActive && !retiredLinkedIdentity);
  const hasCanonicalVariant = Boolean(variantId && canonicalVariantActive && hasCanonicalProduct);
  const canonicalAudienceType = hasCanonicalProduct && canonicalCategory
    ? (canonicalCategory === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ')
    : '';

  return {
    productId,
    variantId,
    catalogIdentity: hasCanonicalVariant ? 'variant' : (hasCanonicalProduct ? 'product' : 'snapshot'),
    productName: (hasCanonicalProduct ? canonicalProductName : '') || originalSnapshot.productName,
    audienceType: canonicalAudienceType || originalSnapshot.audienceType,
    // A base-product-only resolution is enough to update the product name/category, but not
    // enough to invent SKU characteristics. Exact variant links may safely project the
    // current canonical SKU while the immutable order-time values stay in originalSnapshot.
    gender: hasCanonicalVariant ? (cleanText(item.canonical_gender) || originalSnapshot.gender) : originalSnapshot.gender,
    color: hasCanonicalVariant ? (cleanText(item.canonical_color) || originalSnapshot.color) : originalSnapshot.color,
    material: hasCanonicalVariant ? (cleanText(item.canonical_material) || originalSnapshot.material) : originalSnapshot.material,
    length: hasCanonicalVariant ? (cleanText(item.canonical_length) || originalSnapshot.length) : originalSnapshot.length,
    size: hasCanonicalVariant ? (cleanText(item.canonical_size) || originalSnapshot.size) : originalSnapshot.size,
    originalSnapshot,
  };
}


export function orderItemAvailableOperationQuantity(item: Record<string, unknown>) {
  const currentQuantity = Math.max(0, toInt(item.quantity, 0));
  const activeStandaloneReturnedQuantity = Math.max(0, toInt(item.active_standalone_returned_quantity, 0));
  return Math.max(0, currentQuantity - activeStandaloneReturnedQuantity);
}


// Summarize what return records actually certify. A money refund never proves
// a physical receipt; physical_tracking=0 means legacy receipt is unknown.
export type OrderReturnPhysicalSummary = {
  moneyOnlyCount: number
  moneyAndGoodsCount: number
  goodsOnlyCount: number
  pendingQuantity: number
  receivedStockQuantity: number
  receivedNoStockQuantity: number
  legacyUnknownQuantity: number
}
export async function fetchOrderRelations(db: D1Database, orderIds: number[]) {
  const itemsByOrderId = new Map<number, unknown[]>();
  const paymentsByOrderId = new Map<number, unknown[]>();
  const returnsByOrderId = new Map<number, unknown[]>();
  const committedExchangeCountByOrderId = new Map<number, number>();
  const hasCommittedItemReturnByOrderId = new Map<number, boolean>();
  const returnPhysicalByOrderId = new Map<number, OrderReturnPhysicalSummary>();
  const workshopTasksByOrderId = new Map<number, unknown[]>();
  const handoverReviewByOrderId = new Map<number, unknown[]>();
  const activeStockHandoverByOrderId = new Map<number, unknown[]>();

  if (!orderIds.length) {
    return { itemsByOrderId, paymentsByOrderId, returnsByOrderId, committedExchangeCountByOrderId, hasCommittedItemReturnByOrderId, returnPhysicalByOrderId, workshopTasksByOrderId, handoverReviewByOrderId, activeStockHandoverByOrderId };
  }

  const appendRows = (target: Map<number, unknown[]>, rows: unknown[]) => {
    for (const row of rows || []) {
      const record = row as Record<string, unknown>;
      const orderId = toInt(record.order_id, 0);
      if (!orderId) continue;
      if (!target.has(orderId)) target.set(orderId, []);
      target.get(orderId)!.push(record);
    }
  };

  // Step 54: /api/orders can load hundreds of orders after Test1 import.
  // D1/SQLite must not receive one huge IN (?, ?, ...) list for all orders at once.
  // Fetch relations in safe chunks so the main orders table does not fall back to local demo rows.
  const chunkSize = 80;
  for (let index = 0; index < orderIds.length; index += chunkSize) {
    const chunk = orderIds.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const requestedOrderValues = chunk.map(() => '(?)').join(',');

    const [itemsResult, paymentsResult, returnsResult, workshopTasksResult, handoverStateResult, standaloneReturnedResult, returnPhysicalResult] = await Promise.all([
      db.prepare(
        `SELECT oi.*,
                (SELECT SUM(di.quantity - di.cancelled_quantity) FROM order_dispatch_items di WHERE di.order_item_id=oi.id) AS shipment_sent_quantity,
                (SELECT e.id FROM inventory_lifecycle_events e
                 JOIN exchanges exchange_row ON exchange_row.id=e.operation_id
                 WHERE e.order_item_id=oi.id AND e.operation_type='exchange'
                   AND e.event_type='exchange_new_out' AND e.status='pending' AND e.pending_reason='awaiting_dispatch'
                   AND COALESCE(exchange_row.status,'completed')<>'cancelled'
                 ORDER BY e.id DESC LIMIT 1) AS pending_exchange_dispatch_id,
                (SELECT e.id FROM exchanges e WHERE e.new_order_item_id=oi.id
                   AND e.order_id=oi.order_id AND oi.is_workshop=1
                   AND COALESCE(e.status,'completed')<>'cancelled'
                   AND NOT EXISTS(
                     SELECT 1 FROM order_dispatch_items di
                     WHERE di.order_item_id=oi.id AND di.cancelled_quantity<di.quantity
                   )
                 ORDER BY e.id DESC LIMIT 1) AS pending_exchange_workshop_id,
                p.name AS canonical_product_name,
                p.is_active AS canonical_product_active,
                v.is_active AS canonical_variant_active,
                COALESCE(v.category, p.category) AS canonical_category,
                v.gender AS canonical_gender,
                v.color AS canonical_color,
                v.material AS canonical_material,
                v.length AS canonical_length,
                v.size_label AS canonical_size
         FROM order_items oi
         LEFT JOIN catalog_products p ON p.id = oi.product_id
         LEFT JOIN catalog_variants v ON v.id = oi.variant_id
         WHERE oi.order_id IN (${placeholders}) AND oi.quantity > 0
         ORDER BY oi.id ASC`
      ).bind(...chunk).all(),
      db.prepare(
        `SELECT * FROM payments WHERE order_id IN (${placeholders}) ORDER BY payment_date ASC, id ASC`
      ).bind(...chunk).all(),
      db.prepare(
        `SELECT * FROM returns WHERE order_id IN (${placeholders}) ORDER BY return_date DESC, id DESC`
      ).bind(...chunk).all(),
      db.prepare(
        `SELECT * FROM workshop_tasks WHERE order_id IN (${placeholders}) ORDER BY id ASC`
      ).bind(...chunk).all(),
      fetchOrderStockHandoverRows(db, chunk, { listFlagsOnly: true }),
      db.prepare(
        `WITH requested_orders(order_id) AS (VALUES ${requestedOrderValues}),
         standalone_returns AS (
           SELECT r.order_id, ri.order_item_id, COALESCE(SUM(ri.quantity), 0) AS returned_quantity
           FROM requested_orders ro
           JOIN returns r ON r.order_id = ro.order_id
           JOIN return_items ri ON ri.return_id = r.id
           WHERE COALESCE(r.status, 'completed') <> 'cancelled'
             AND NOT EXISTS (
               SELECT 1
               FROM exchanges e
               WHERE e.refund_return_id = r.id
                 AND COALESCE(e.status, 'completed') <> 'cancelled'
             )
           GROUP BY r.order_id, ri.order_item_id
         ),
         exchange_counts AS (
           SELECT e.order_id, COUNT(*) AS committed_exchange_count
           FROM requested_orders ro
           JOIN exchanges e ON e.order_id = ro.order_id
           WHERE COALESCE(e.status, 'completed') <> 'cancelled'
           GROUP BY e.order_id
         )
         SELECT ro.order_id, sr.order_item_id, COALESCE(sr.returned_quantity, 0) AS returned_quantity,
                COALESCE(ec.committed_exchange_count, 0) AS committed_exchange_count
         FROM requested_orders ro
         LEFT JOIN standalone_returns sr ON sr.order_id = ro.order_id
         LEFT JOIN exchange_counts ec ON ec.order_id = ro.order_id`
      ).bind(...chunk).all<Record<string, unknown>>(),
      db.prepare(`
        WITH per_return AS (
          SELECT r.order_id, r.id, r.amount,
                 COALESCE(SUM(ri.quantity), 0) AS goods_quantity,
                 COALESCE(SUM(CASE WHEN ri.physical_tracking = 1
                    AND ri.physical_received_at IS NULL THEN ri.quantity ELSE 0 END), 0) AS pending_quantity,
                 COALESCE(SUM(CASE WHEN ri.physical_tracking = 1
                    AND ri.physical_received_at IS NOT NULL
                    AND ri.inventory_source IN ('warehouse','boutique') THEN ri.quantity ELSE 0 END), 0) AS received_stock_quantity,
                 COALESCE(SUM(CASE WHEN ri.physical_tracking = 1
                    AND ri.physical_received_at IS NOT NULL
                    AND ri.inventory_source IS NULL THEN ri.quantity ELSE 0 END), 0) AS received_no_stock_quantity,
                 COALESCE(SUM(CASE WHEN ri.id IS NOT NULL
                    AND COALESCE(ri.physical_tracking, 0) = 0 THEN ri.quantity ELSE 0 END), 0) AS legacy_unknown_quantity
          FROM returns r
          LEFT JOIN return_items ri ON ri.return_id = r.id
          WHERE r.order_id IN (${placeholders})
            AND COALESCE(r.status, 'completed') <> 'cancelled'
            AND NOT EXISTS (SELECT 1 FROM exchanges e
              WHERE e.refund_return_id = r.id
                AND COALESCE(e.status, 'completed') <> 'cancelled')
          GROUP BY r.id
        )
        SELECT order_id,
               SUM(CASE WHEN amount > 0 AND goods_quantity = 0 THEN 1 ELSE 0 END) AS money_only_count,
               SUM(CASE WHEN amount > 0 AND goods_quantity > 0 THEN 1 ELSE 0 END) AS money_and_goods_count,
               SUM(CASE WHEN amount = 0 AND goods_quantity > 0 THEN 1 ELSE 0 END) AS goods_only_count,
               SUM(pending_quantity) AS pending_quantity,
               SUM(received_stock_quantity) AS received_stock_quantity,
               SUM(received_no_stock_quantity) AS received_no_stock_quantity,
               SUM(legacy_unknown_quantity) AS legacy_unknown_quantity
        FROM per_return GROUP BY order_id
      `).bind(...chunk).all<Record<string, unknown>>(),
    ]);

    for (const raw of returnPhysicalResult.results || []) {
      const orderId = toInt(raw.order_id, 0);
      if (!orderId) continue;
      returnPhysicalByOrderId.set(orderId, {
        moneyOnlyCount: Math.max(0, toInt(raw.money_only_count, 0)),
        moneyAndGoodsCount: Math.max(0, toInt(raw.money_and_goods_count, 0)),
        goodsOnlyCount: Math.max(0, toInt(raw.goods_only_count, 0)),
        pendingQuantity: Math.max(0, toInt(raw.pending_quantity, 0)),
        receivedStockQuantity: Math.max(0, toInt(raw.received_stock_quantity, 0)),
        receivedNoStockQuantity: Math.max(0, toInt(raw.received_no_stock_quantity, 0)),
        legacyUnknownQuantity: Math.max(0, toInt(raw.legacy_unknown_quantity, 0)),
      });
    }
    const activeStandaloneReturnedByItem = new Map<number, number>();
    for (const row of standaloneReturnedResult.results || []) {
      const orderId = toInt(row.order_id, 0);
      if (orderId) committedExchangeCountByOrderId.set(orderId, Math.max(0, toInt(row.committed_exchange_count, 0)));
      const orderItemId = toInt(row.order_item_id, 0);
      const returnedQuantity = Math.max(0, toInt(row.returned_quantity, 0));
      if (!orderItemId) continue;
      if (returnedQuantity > 0) hasCommittedItemReturnByOrderId.set(orderId, true);
      activeStandaloneReturnedByItem.set(orderItemId, returnedQuantity);
    }
    for (const rawItem of itemsResult.results || []) {
      const item = rawItem as Record<string, unknown>;
      item.active_standalone_returned_quantity = activeStandaloneReturnedByItem.get(toInt(item.id, 0)) || 0;
    }

    appendRows(itemsByOrderId, itemsResult.results || []);
    appendRows(paymentsByOrderId, paymentsResult.results || []);
    appendRows(returnsByOrderId, returnsResult.results || []);
    appendRows(workshopTasksByOrderId, workshopTasksResult.results || []);
    appendRows(activeStockHandoverByOrderId, handoverStateResult || []);
    appendRows(handoverReviewByOrderId, (handoverStateResult || []).filter((row) => toInt((row as Record<string, unknown>).review_needed, 0) === 1));
  }

  // Step 161: resolve every workshop task to one concrete order item before the
  // orders table derives per-item readiness. Direct order_item_id links always win;
  // legacy unlinked rows use the same one-to-one matcher as the workshop screen.
  for (const orderId of orderIds) {
    const tasks = (workshopTasksByOrderId.get(orderId) || []).map((row) => row as Record<string, unknown>);
    const items = (itemsByOrderId.get(orderId) || []).map((row) => row as Record<string, unknown>);
    const matches = matchWorkshopTasksToOrderItems(tasks, items);
    for (const task of tasks) {
      const matched = matches.get(toInt(task.id, 0));
      task.resolved_order_item_id = toInt(matched?.id, 0) || toInt(task.order_item_id, 0) || null;
    }
  }

  return { itemsByOrderId, paymentsByOrderId, returnsByOrderId, committedExchangeCountByOrderId, hasCommittedItemReturnByOrderId, returnPhysicalByOrderId, workshopTasksByOrderId, handoverReviewByOrderId, activeStockHandoverByOrderId };
}


export function workshopItemMatchPart(value: unknown) {
  return cleanText(value).toUpperCase().replace(/\s+/g, ' ');
}


export function workshopItemMatchKey(row: Record<string, unknown>) {
  return [
    row.product_name_snapshot,
    row.gender_snapshot,
    row.color_snapshot,
    row.material_snapshot,
    row.length_snapshot,
    row.size_snapshot,
  ].map(workshopItemMatchPart).join('|');
}


export function workshopTaskStatusForOrderItem(item: Record<string, unknown>, tasks: unknown[]) {
  if (!toInt(item.is_workshop, 0)) return '';

  const itemId = toInt(item.id, 0);
  const records = (tasks || []).map(task => task as Record<string, unknown>);
  const linked = itemId > 0
    ? records.filter(task => {
      const resolvedId = toInt(task.resolved_order_item_id, 0) || toInt(task.order_item_id, 0);
      return resolvedId === itemId;
    })
    : [];

  // Never borrow a linked task's status for another item merely because the
  // product name/size looks similar. That was the cause of “Готово” moving to
  // the wrong line in orders containing duplicate or exchanged products.
  const candidates = linked.length
    ? linked
    : records.filter(task => !toInt(task.order_item_id, 0) && workshopItemMatchKey(task) === workshopItemMatchKey(item));
  const statuses = candidates.map(task => cleanText(task.status).toLowerCase()).filter(Boolean);

  if (statuses.includes('active')) return 'active';
  if (statuses.includes('ready')) return 'ready';
  if (statuses.includes('done')) return 'done';
  if (statuses.includes('cancelled')) return 'cancelled';
  return '';
}
