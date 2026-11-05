import { cleanText, toInt } from '../core/text.ts'

// Main's Stage 5 selective-dispatch code was introduced in commit
// e28a5fb4a6554b008d6c3b3384362b65c8eebd16 (2026-11-02T09:26:53Z).
// This is a compatibility boundary, not a proxy for the stock movement itself.
export const SELECTIVE_DISPATCH_CUTOVER_AT = '2026-11-02T09:26:53Z'

export function isPreSelectiveDispatchOrder(createdAt: unknown): boolean {
  const created = Date.parse(cleanText(createdAt))
  return Number.isFinite(created) && created < Date.parse(SELECTIVE_DISPATCH_CUTOVER_AT)
}

/**
 * Proof of a specific prior stock handover, attached to the exact item and
 * fulfilled reservation. Neither a fulfilled status nor an order date alone
 * proves that the customer-facing shipment remains to be confirmed.
 *
 * The stocktake review is transactional evidence. The activity events are the
 * existing audit records for the distinct early handover operation.
 */
export const priorIssueEvidenceSql = (item = 'oi', reservation = 'r') => `(
  EXISTS (
    SELECT 1 FROM inventory_handover_reviews hr
    WHERE hr.order_id=${item}.order_id AND hr.order_item_id=${item}.id
      AND hr.reservation_id=${reservation}.id
      AND hr.decision='issued_before_checkpoint'
  )
  OR EXISTS (
    SELECT 1 FROM activity_log a
    WHERE a.order_id=${item}.order_id AND a.entity_type='order_item'
      AND a.entity_id=${item}.id
      AND a.event_type='order_stock_issued_before_full_shipping'
      AND julianday(a.created_at)>=julianday(${reservation}.created_at)
  )
  OR EXISTS (
    SELECT 1 FROM activity_log a
    WHERE a.order_id=${item}.order_id AND a.entity_type='order_item'
      AND a.entity_id=${item}.id
      AND a.event_type='order_stock_handover_reconciled'
      AND julianday(a.created_at)>=julianday(${reservation}.created_at)
  )
)`

export async function readPriorIssuedItemIds(db: D1Database, orderId: number): Promise<Set<number>> {
  const result = await db.prepare(`
    SELECT DISTINCT oi.id AS order_item_id
    FROM order_items oi
    JOIN inventory_reservations r ON r.order_id=oi.order_id AND r.order_item_id=oi.id
    WHERE oi.order_id=? AND oi.quantity>0 AND COALESCE(oi.is_workshop,0)=0
      AND oi.stock_writeoff_status='fulfilled'
      AND r.status='fulfilled' AND r.quantity=oi.quantity
      AND r.variant_id IS NOT NULL AND r.variant_id>0
      AND r.inventory_source=oi.source_type
      AND ${priorIssueEvidenceSql('oi','r')}
      AND NOT EXISTS (
        SELECT 1 FROM order_dispatch_items di
        WHERE di.order_item_id=oi.id AND di.cancelled_quantity<di.quantity
      )
  `).bind(orderId).all<{order_item_id: number}>()
  return new Set((result.results || [])
    .map(row => toInt(row.order_item_id,0)).filter(id => id>0))
}
