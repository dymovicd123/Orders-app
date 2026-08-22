// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { cleanText, toInt } from '../core/text.ts'
import { matchWorkshopTasksToOrderItems } from './workshop-matching.ts'
import { fetchOrderStockHandoverRows, stockHandoverItemFromRow } from './order-reservations.ts'

export async function fetchOrderRelations(db: D1Database, orderIds: number[]) {
  const itemsByOrderId = new Map<number, unknown[]>();
  const paymentsByOrderId = new Map<number, unknown[]>();
  const returnsByOrderId = new Map<number, unknown[]>();
  const workshopTasksByOrderId = new Map<number, unknown[]>();
  const handoverReviewByOrderId = new Map<number, unknown[]>();
  const activeStockHandoverByOrderId = new Map<number, unknown[]>();

  if (!orderIds.length) {
    return { itemsByOrderId, paymentsByOrderId, returnsByOrderId, workshopTasksByOrderId, handoverReviewByOrderId, activeStockHandoverByOrderId };
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

    const [itemsResult, paymentsResult, returnsResult, workshopTasksResult, handoverReviewResult, activeStockHandoverResult] = await Promise.all([
      db.prepare(
        `SELECT oi.*,
                p.name AS canonical_product_name,
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
      fetchOrderStockHandoverRows(db, chunk),
      db.prepare(
        `SELECT order_id, order_item_id
         FROM inventory_reservations
         WHERE order_id IN (${placeholders})
           AND status = 'active'
           AND variant_id IS NOT NULL
         ORDER BY id ASC`
      ).bind(...chunk).all(),
    ]);

    appendRows(itemsByOrderId, itemsResult.results || []);
    appendRows(paymentsByOrderId, paymentsResult.results || []);
    appendRows(returnsByOrderId, returnsResult.results || []);
    appendRows(workshopTasksByOrderId, workshopTasksResult.results || []);
    appendRows(handoverReviewByOrderId, (handoverReviewResult || []).map((row) => ({ order_id: row.order_id, order_item_id: row.order_item_id, review_needed: stockHandoverItemFromRow(row).reviewNeeded })).filter((row) => row.review_needed));
    appendRows(activeStockHandoverByOrderId, activeStockHandoverResult.results || []);
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

  return { itemsByOrderId, paymentsByOrderId, returnsByOrderId, workshopTasksByOrderId, handoverReviewByOrderId, activeStockHandoverByOrderId };
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
