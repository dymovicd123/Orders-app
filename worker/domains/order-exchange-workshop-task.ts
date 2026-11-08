import { cleanText, toInt } from '../core/text.ts'
import { assertWorkshopTaskDetailSchema } from './workshop-schema.ts'

export async function ensureExchangeWorkshopReplacementTask(
  db: D1Database,
  input: {
    exchangeId: number;
    orderId: number;
    externalId: string;
    orderItemId: number;
    timestamp: string;
  },
) {
  const { exchangeId, orderId, externalId, orderItemId, timestamp } = input;
  await assertWorkshopTaskDetailSchema(db);
  const item = await db.prepare(
    `SELECT id, order_id, product_id, variant_id, product_name_snapshot,
            gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot,
            quantity, workshop_comment, workshop_urgent, workshop_due_date
     FROM order_items
     WHERE id = ? AND order_id = ? AND quantity > 0`
  ).bind(orderItemId, orderId).first<Record<string, unknown>>();
  if (!item) throw new Error('Новая цеховая позиция обмена не найдена после сохранения.');

  const exactTasks = await db.prepare(
    `SELECT id FROM workshop_tasks WHERE order_id = ? AND order_item_id = ? ORDER BY id ASC`
  ).bind(orderId, orderItemId).all<{ id: number }>();
  const keeperId = toInt(exactTasks.results?.[0]?.id, 0);
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE order_items
       SET is_workshop = 1,
           source_type = 'warehouse',
           stock_writeoff_status = 'workshop',
           stock_quantity_before = NULL,
           stock_quantity_after = NULL
       WHERE id = ? AND order_id = ? AND quantity > 0`
    ).bind(orderItemId, orderId),
    db.prepare(`UPDATE exchanges SET new_source_type = 'workshop', new_order_item_id = ? WHERE id = ? AND order_id = ?`)
      .bind(orderItemId, exchangeId, orderId),
    db.prepare(`UPDATE exchange_items SET inventory_source = 'workshop' WHERE exchange_id = ? AND role = 'new'`)
      .bind(exchangeId),
  ];

  if (keeperId) {
    statements.push(db.prepare(
      `UPDATE workshop_tasks
       SET external_order_id = ?, product_id = ?, variant_id = ?, product_name_snapshot = ?,
           gender_snapshot = ?, color_snapshot = ?, material_snapshot = ?, length_snapshot = ?, size_snapshot = ?,
           quantity = ?, comment = ?, urgent = ?, due_date = ?, status = 'active', updated_at = ?
       WHERE id = ? AND order_id = ? AND order_item_id = ?`
    ).bind(
      externalId,
      toInt(item.product_id, 0) || null,
      toInt(item.variant_id, 0) || null,
      cleanText(item.product_name_snapshot),
      cleanText(item.gender_snapshot) || null,
      cleanText(item.color_snapshot) || null,
      cleanText(item.material_snapshot) || null,
      cleanText(item.length_snapshot) || null,
      cleanText(item.size_snapshot) || null,
      Math.max(1, toInt(item.quantity, 1)),
      cleanText(item.workshop_comment) || null,
      toInt(item.workshop_urgent, 0) ? 1 : 0,
      cleanText(item.workshop_due_date) || null,
      timestamp,
      keeperId,
      orderId,
      orderItemId,
    ));
    statements.push(db.prepare(
      `UPDATE workshop_tasks
       SET quantity = 0, status = 'cancelled', updated_at = ?
       WHERE order_id = ? AND order_item_id = ? AND id <> ?`
    ).bind(timestamp, orderId, orderItemId, keeperId));
  } else {
    statements.push(db.prepare(
      `INSERT INTO workshop_tasks (
        order_id, external_order_id, order_item_id, product_id, variant_id, product_name_snapshot,
        gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot,
        quantity, comment, urgent, due_date, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).bind(
      orderId,
      externalId,
      orderItemId,
      toInt(item.product_id, 0) || null,
      toInt(item.variant_id, 0) || null,
      cleanText(item.product_name_snapshot),
      cleanText(item.gender_snapshot) || null,
      cleanText(item.color_snapshot) || null,
      cleanText(item.material_snapshot) || null,
      cleanText(item.length_snapshot) || null,
      cleanText(item.size_snapshot) || null,
      Math.max(1, toInt(item.quantity, 1)),
      cleanText(item.workshop_comment) || null,
      toInt(item.workshop_urgent, 0) ? 1 : 0,
      cleanText(item.workshop_due_date) || null,
      timestamp,
      timestamp,
    ));
  }

  await db.batch(statements);
  const verification = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM workshop_tasks
     WHERE order_id = ? AND order_item_id = ? AND status = 'active' AND quantity > 0`
  ).bind(orderId, orderItemId).first<{ count: number }>();
  if (toInt(verification?.count, 0) !== 1) {
    throw new Error('Не удалось закрепить новую позицию обмена в цехе. Обратитесь к администратору.');
  }
}
