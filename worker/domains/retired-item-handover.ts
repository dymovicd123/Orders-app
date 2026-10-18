import { cleanText, toInt } from '../core/text.ts';

/**
 * Issue one explicitly confirmed *already physically delivered* retired SKU.
 * Retirement has previously zeroed the operational stock and released the
 * reservation. Never write inventory_stock, inventory_movements, payments or
 * a new catalog SKU here.
 *
 * One unique journal row per order_item_id plus conditional status update in
 * a single D1 batch makes retries safe, including after a lost HTTP response.
 */
export async function confirmRetiredOrderItemDelivered(
  db: D1Database,
  input: {
    orderId: number; orderItemId: number; expectedVariantId: number;
    expectedQuantity: number; confirmedPhysicallyDelivered: boolean; actor: string;
  },
) {
  const orderId = toInt(input.orderId, 0);
  const itemId = toInt(input.orderItemId, 0);
  const variantId = toInt(input.expectedVariantId, 0);
  const qty = toInt(input.expectedQuantity, 0);
  const actor = cleanText(input.actor);
  if (!orderId || !itemId || !variantId || qty <= 0 || !actor || input.confirmedPhysicallyDelivered !== true) {
    throw new Error('Укажите позицию, количество и подтвердите, что именно эта вещь фактически передана клиенту.');
  }
  const row = await db.prepare(`
    SELECT oi.id, oi.quantity, oi.variant_id, oi.is_workshop,
           oi.stock_writeoff_status, oi.product_name_snapshot,
           o.external_id, o.shipping_status, o.order_status, o.archived_at,
           v.is_active AS variant_active, sp.is_active AS execution_active
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    LEFT JOIN catalog_variants v ON v.id=oi.variant_id
    LEFT JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
    WHERE oi.order_id=? AND oi.id=? LIMIT 1
  `).bind(orderId,itemId).first<Record<string,unknown>>();
  if (!row) throw new Error('Позиция заказа не найдена.');
  const saved = await db.prepare(
    'SELECT order_item_id, retired_variant_id, quantity FROM retired_order_item_issues WHERE order_item_id=? LIMIT 1'
  ).bind(itemId).first<{order_item_id:number; retired_variant_id:number; quantity:number}>();
  if (saved) {
    if (toInt(saved.retired_variant_id,0)!==variantId || toInt(saved.quantity,0)!==qty) {
      throw new Error('Подтверждение уже записано для другого количества или варианта. Обновите заказ.');
    }
    if (cleanText(row.stock_writeoff_status)!=='retired_physically_issued') {
      throw new Error('Запись выдачи и состояние заказа расходятся. Попросите администратора проверить историю.');
    }
    return {ok:true,alreadyConfirmed:true,orderId,orderItemId:itemId};
  }
  if (cleanText(row.order_status)!=='active' || cleanText(row.archived_at) || cleanText(row.shipping_status)==='sent') {
    throw new Error('Уже отправленный, закрытый или архивный заказ здесь изменить нельзя.');
  }
  if (toInt(row.is_workshop,0) || cleanText(row.stock_writeoff_status)!=='catalog_retired'
      || toInt(row.variant_id,0)!==variantId || toInt(row.quantity,0)!==qty
      || toInt(row.variant_active,-1)!==0 || toInt(row.execution_active,-1)!==0) {
    throw new Error('Позиция изменилась либо не относится к удалённому исполнению. Обновите заказ.');
  }
  const now=new Date().toISOString();
  const writes = await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO retired_order_item_issues(
        order_item_id,order_id,retired_variant_id,quantity,confirmed_by,confirmed_at
      )
      SELECT oi.id,oi.order_id,oi.variant_id,oi.quantity,?,?
      FROM order_items oi
      JOIN orders o ON o.id=oi.order_id
      JOIN catalog_variants v ON v.id=oi.variant_id
      JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
      WHERE oi.id=? AND oi.order_id=? AND oi.quantity=? AND oi.variant_id=?
        AND oi.is_workshop=0 AND oi.stock_writeoff_status='catalog_retired'
        AND v.is_active=0 AND sp.is_active=0
        AND COALESCE(o.order_status,'active')='active'
        AND COALESCE(o.archived_at,'')=''
        AND COALESCE(o.shipping_status,'not_sent')<>'sent'
        AND NOT EXISTS (
          SELECT 1 FROM inventory_reservations r
          WHERE r.order_item_id=oi.id AND r.status IN ('active','unresolved')
        )
        AND NOT EXISTS (
          SELECT 1 FROM return_items ri JOIN returns ret ON ret.id=ri.return_id
          WHERE ri.order_item_id=oi.id AND COALESCE(ret.status,'completed')<>'cancelled'
        )
    `).bind(actor,now,itemId,orderId,qty,variantId),
    db.prepare(`
      UPDATE order_items
      SET stock_writeoff_status='retired_physically_issued',
          stock_quantity_before=NULL, stock_quantity_after=NULL
      WHERE id=? AND order_id=? AND variant_id=? AND quantity=?
        AND stock_writeoff_status='catalog_retired'
        AND EXISTS (SELECT 1 FROM retired_order_item_issues j WHERE j.order_item_id=order_items.id)
    `).bind(itemId,orderId,variantId,qty),
  ]);
  const confirmed=await db.prepare(`
    SELECT j.order_item_id,j.retired_variant_id,j.quantity,oi.stock_writeoff_status
    FROM retired_order_item_issues j JOIN order_items oi ON oi.id=j.order_item_id
    WHERE j.order_item_id=? AND j.order_id=? LIMIT 1
  `).bind(itemId,orderId).first<Record<string,unknown>>();
  if (toInt(confirmed?.retired_variant_id,0)!==variantId
      || toInt(confirmed?.quantity,0)!==qty
      || cleanText(confirmed?.stock_writeoff_status)!=='retired_physically_issued') {
    throw new Error('Подтверждение не записано: заказ или резерв изменились. Обновите страницу.');
  }
  // A racing retry can pass the initial read but lose INSERT OR IGNORE.
  // In that case there is only one journal event, and no second activity event.
  return {ok:true,alreadyConfirmed:toInt(writes[0]?.meta?.changes,0)===0,orderId,orderItemId:itemId};
}
