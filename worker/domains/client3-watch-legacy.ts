import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

/** Historical orders in third D1 are preserved, never assigned an invented watch brand. */
export async function listLegacyClient3Orders(db:D1Database,actor:AuthUser) {
 if(actor.role!=='admin')return json({ok:false,code:'WATCH_LEGACY_ADMIN_ONLY'},{status:403})
 const rows=await db.prepare(
   `SELECT o.id AS orderId,o.external_id AS externalId,o.order_date AS orderDate,
     o.manager_snapshot_name AS managerName,o.source_type AS legacySource,
     o.shipping_status AS shippingStatus,o.total_amount AS totalAmount,
     o.received_amount AS receivedAmount,o.debt_amount AS debtAmount,
     (SELECT GROUP_CONCAT(oi.product_name_snapshot,' · ') FROM order_items oi WHERE oi.order_id=o.id) AS items
    FROM orders o WHERE NOT EXISTS(
      SELECT 1 FROM watch_order_details wd WHERE wd.order_id=o.id
    ) ORDER BY o.id DESC LIMIT 100`,
 ).all<Record<string,unknown>>()
 return json({ok:true,rows:rows.results||[],readOnly:true,unbrandedHistoricalData:true})
}
