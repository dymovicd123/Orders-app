/**
 * Main's Return/Exchange cancellation reverses applied physical movements.
 * A later whole-product retirement zeroes that SKU and permanently deactivates
 * its physical stock. Reversing an earlier receipt/outbound at that point would
 * corrupt the historic retirement balance, even if old event snapshots exist.
 *
 * This is a read-only preflight, not an alternative cancellation engine. Safe
 * all-pending/no-stock operations continue through Main unchanged. Main still
 * owns compare-and-swap protection for concurrent alterations.
 */
export async function retiredAppliedMovementBlocker(
 db:D1Database,kind:'return'|'exchange',operationId:number,
){
 return db.prepare(`
   SELECT e.id,e.event_type,e.variant_id,oi.product_name_snapshot
   FROM inventory_lifecycle_events e
   LEFT JOIN catalog_variants v ON v.id=e.variant_id
   LEFT JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
   LEFT JOIN catalog_products p ON p.id=v.product_id
   LEFT JOIN order_items oi ON oi.id=e.order_item_id
   WHERE e.operation_type=? AND e.operation_id=? AND e.status='applied'
     AND e.variant_id IS NOT NULL
     AND (v.id IS NULL OR COALESCE(v.is_active,0)=0
          OR sp.id IS NULL OR COALESCE(sp.is_active,0)=0
          OR p.id IS NULL OR COALESCE(p.is_active,0)=0)
   ORDER BY e.id ASC LIMIT 1`)
   .bind(kind,operationId)
   .first<{id:number;event_type:string;variant_id:number;product_name_snapshot:string|null}>()
}
