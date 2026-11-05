// Read-only inventory of historical shipment states. This script never executes
// mutations and prints ONLY aggregate counts (no client, manager or order IDs).
import { execFileSync } from 'node:child_process'

const db = 'orders_db_prod'
const cutoff = '2026-11-02T09:26:53Z'
const sql = `
SELECT cohort, category, COUNT(*) AS items, COUNT(DISTINCT order_id) AS orders
FROM (
  SELECT o.id AS order_id,
    CASE WHEN julianday(o.created_at) IS NULL THEN 'unknown_date'
      WHEN julianday(o.created_at)<julianday('${cutoff}') THEN 'legacy'
      ELSE 'post_cutover' END AS cohort,
    CASE
      WHEN COALESCE(o.shipping_status,'not_sent')='sent'
        THEN '01_recorded_sent'
      WHEN COALESCE(oi.is_workshop,0)<>0
        THEN '02_workshop_not_stock'
      WHEN EXISTS (
        SELECT 1 FROM return_items ri JOIN returns rt ON rt.id=ri.return_id
        WHERE ri.order_item_id=oi.id AND ri.quantity>0
          AND COALESCE(rt.status,'completed')<>'cancelled'
      ) OR EXISTS (
        SELECT 1 FROM exchanges ex WHERE ex.order_id=o.id
          AND COALESCE(ex.status,'completed')<>'cancelled'
      )
        THEN '03_return_or_exchange_review_separately'
      WHEN EXISTS (
        SELECT 1 FROM order_dispatch_items di
        WHERE di.order_item_id=oi.id AND di.cancelled_quantity<di.quantity
      )
        THEN '04_selective_dispatch_exists'
      WHEN oi.stock_writeoff_status='reserved' AND EXISTS (
        SELECT 1 FROM inventory_reservations r
        WHERE r.order_item_id=oi.id AND r.order_id=o.id
          AND r.status='active' AND r.quantity=oi.quantity
      )
        THEN '05_reserved_waiting_for_shipping'
      WHEN oi.stock_writeoff_status='fulfilled' AND EXISTS (
        SELECT 1 FROM inventory_reservations r
        WHERE r.order_item_id=oi.id AND r.order_id=o.id
          AND r.status='fulfilled' AND r.quantity=oi.quantity
          AND r.variant_id>0 AND r.inventory_source=oi.source_type
          AND (
            EXISTS (
              SELECT 1 FROM inventory_handover_reviews hr
              WHERE hr.order_id=o.id AND hr.order_item_id=oi.id
                AND hr.reservation_id=r.id
                AND hr.decision='issued_before_checkpoint'
            )
            OR EXISTS (
              SELECT 1 FROM activity_log a
              WHERE a.order_id=o.id AND a.entity_type='order_item'
                AND a.entity_id=oi.id
                AND a.event_type IN (
                  'order_stock_issued_before_full_shipping',
                  'order_stock_handover_reconciled'
                )
                AND julianday(a.created_at)>=julianday(r.created_at)
            )
          )
      )
        THEN '06_prior_stock_issue_proven_customer_status_unknown'
      WHEN oi.stock_writeoff_status='fulfilled'
        THEN '07_fulfilled_without_exact_prior_issue_proof'
      WHEN COALESCE(oi.stock_writeoff_status,'') IN (
        'written_off','negative','retired_physically_issued'
      )
        THEN '08_other_physical_issue_requires_lineage_check'
      ELSE '09_other_pending_or_inconsistent'
    END AS category
  FROM orders o
  JOIN order_items oi ON oi.order_id=o.id AND oi.quantity>0
  WHERE COALESCE(o.order_status,'') NOT IN ('deleted','archived')
    AND COALESCE(o.archived_at,'')=''
) classified
GROUP BY cohort, category ORDER BY cohort, category`

if (!/^\s*SELECT\b/i.test(sql) || /;\s*\S/.test(sql)) {
  throw new Error('READ_ONLY_SINGLE_SELECT_REQUIRED')
}
const args = ['wrangler','d1','execute',db,'--remote','--config','wrangler.jsonc','--json','--command='+sql]
const raw = execFileSync('npx',args,{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']})
const payload = JSON.parse(raw)
if (!Array.isArray(payload) || payload.length !== 1 || payload[0]?.success !== true ||
    !Array.isArray(payload[0]?.results)) {
  throw new Error('REMOTE_D1_READ_FAILED_OR_INCOMPLETE')
}
const rows = payload[0].results
const allowable = new Set([
 '01_recorded_sent','02_workshop_not_stock','03_return_or_exchange_review_separately',
 '04_selective_dispatch_exists','05_reserved_waiting_for_shipping',
 '06_prior_stock_issue_proven_customer_status_unknown',
 '07_fulfilled_without_exact_prior_issue_proof',
 '08_other_physical_issue_requires_lineage_check','09_other_pending_or_inconsistent',
])
if (rows.some(r=>!['legacy','post_cutover','unknown_date'].includes(r.cohort) || !allowable.has(r.category) || !Number.isSafeInteger(r.items) ||
    !Number.isSafeInteger(r.orders) || r.items<0 || r.orders<0 || r.orders>r.items)) {
  throw new Error('REMOTE_D1_AGGREGATE_INVALID')
}
console.log('HISTORICAL_SHIPPING_READ_ONLY_AUDIT_START')
console.log('CUTOFF_UTC',cutoff)
for (const row of rows) {
  console.log('COHORT',row.cohort,'CATEGORY',row.category,'ITEMS',row.items,'ORDERS_TOUCHED',row.orders)
}

const diagnostics = `SELECT cohort, item_state, reservation_state,
  COUNT(*) AS items, COUNT(DISTINCT order_id) AS orders
FROM (
  SELECT o.id AS order_id,
    CASE WHEN julianday(o.created_at) IS NULL THEN 'unknown_date'
      WHEN julianday(o.created_at)<julianday('${cutoff}') THEN 'legacy'
      ELSE 'post_cutover' END AS cohort,
    CASE WHEN COALESCE(oi.is_workshop,0)<>0 THEN 'workshop'
      ELSE COALESCE(NULLIF(oi.stock_writeoff_status,''),'none') END AS item_state,
    CASE
      WHEN EXISTS (SELECT 1 FROM inventory_reservations r
        WHERE r.order_item_id=oi.id AND r.status='active') THEN 'active'
      WHEN EXISTS (SELECT 1 FROM inventory_reservations r
        WHERE r.order_item_id=oi.id AND r.status='fulfilled') THEN 'fulfilled'
      WHEN EXISTS (SELECT 1 FROM inventory_reservations r
        WHERE r.order_item_id=oi.id AND r.status='unresolved') THEN 'unresolved'
      WHEN EXISTS (SELECT 1 FROM inventory_reservations r
        WHERE r.order_item_id=oi.id) THEN 'other_reservation'
      ELSE 'no_reservation'
    END AS reservation_state
  FROM orders o JOIN order_items oi ON oi.order_id=o.id
  WHERE oi.quantity>0
    AND COALESCE(o.shipping_status,'not_sent')<>'sent'
    AND COALESCE(o.order_status,'') NOT IN ('deleted','archived')
    AND COALESCE(o.archived_at,'')=''
) q GROUP BY cohort,item_state,reservation_state
ORDER BY cohort,item_state,reservation_state`
if (!/^\s*SELECT\b/i.test(diagnostics) || /;\s*\S/.test(diagnostics)) {
  throw new Error('DIAGNOSTIC_MUST_BE_SELECT')
}
const rawDiagnostic=execFileSync('npx',
 ['wrangler','d1','execute',db,'--remote','--config','wrangler.jsonc','--json','--command='+diagnostics],
 {encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']})
const diagnosticResponse=JSON.parse(rawDiagnostic)
if (!Array.isArray(diagnosticResponse)||diagnosticResponse.length!==1||
 diagnosticResponse[0]?.success!==true||!Array.isArray(diagnosticResponse[0]?.results)) {
 throw new Error('DIAGNOSTIC_FAILED_OR_INCOMPLETE')
}
for(const row of diagnosticResponse[0].results) {
 if(!Number.isSafeInteger(row.items)||!Number.isSafeInteger(row.orders)||row.orders>row.items) {
  throw new Error('DIAGNOSTIC_INVALID')
 }
 console.log('UNSENT_STATE',row.cohort,row.item_state,row.reservation_state,'ITEMS',row.items,'ORDERS_TOUCHED',row.orders)
}


const sentDiagnostics=diagnostics.replace(
  "COALESCE(o.shipping_status,'not_sent')<>'sent'",
  "COALESCE(o.shipping_status,'not_sent')='sent'",
)
if(sentDiagnostics===diagnostics)throw new Error('SENT_DIAGNOSTIC_NOT_RESTRICTED')
const rawSent=execFileSync('npx',
 ['wrangler','d1','execute',db,'--remote','--config','wrangler.jsonc','--json','--command='+sentDiagnostics],
 {encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']})
const parsedSent=JSON.parse(rawSent)
if(!Array.isArray(parsedSent)||parsedSent.length!==1||
 parsedSent[0]?.success!==true||!Array.isArray(parsedSent[0]?.results)){
 throw new Error('SENT_DIAGNOSTIC_INVALID')
}
for(const row of parsedSent[0].results) {
 if(!Number.isSafeInteger(row.items)||!Number.isSafeInteger(row.orders))throw Error('SENT_AGGREGATE_INVALID')
 console.log('SENT_STATE',row.cohort,row.item_state,row.reservation_state,'ITEMS',row.items,'ORDERS_TOUCHED',row.orders)
}

// Targeted, no client name, phone, address, price, manager, or order-item ID.
const targetSql=`SELECT
  COALESCE(o.shipping_status,'not_sent') AS shipping_state,
  COUNT(oi.id) AS lines,
  SUM(CASE WHEN oi.stock_writeoff_status='fulfilled' THEN 1 ELSE 0 END) AS fulfilled_lines,
  SUM(CASE WHEN EXISTS(
    SELECT 1 FROM order_dispatch_items di
    WHERE di.order_item_id=oi.id AND di.cancelled_quantity<di.quantity
  ) THEN 1 ELSE 0 END) AS active_dispatch_lines,
  SUM(CASE WHEN EXISTS(
    SELECT 1 FROM inventory_reservations r
    WHERE r.order_item_id=oi.id AND r.status='fulfilled' AND r.quantity=oi.quantity
      AND (EXISTS(
        SELECT 1 FROM inventory_handover_reviews hr WHERE hr.reservation_id=r.id
          AND hr.order_item_id=oi.id AND hr.decision='issued_before_checkpoint'
      ) OR EXISTS(
        SELECT 1 FROM activity_log a WHERE a.order_id=o.id AND a.entity_type='order_item'
          AND a.entity_id=oi.id
          AND a.event_type IN ('order_stock_issued_before_full_shipping','order_stock_handover_reconciled')
          AND julianday(a.created_at)>=julianday(r.created_at)
      ))
  ) THEN 1 ELSE 0 END) AS proven_prior_issued_lines
FROM orders o
JOIN order_items oi ON oi.order_id=o.id AND oi.quantity>0
WHERE o.external_id='ORD-20261104091902-61F1772C'
GROUP BY o.shipping_status`
if(!/^\s*SELECT\b/i.test(targetSql))throw Error('TARGET_MUST_BE_SELECT')
const rawTarget=execFileSync('npx',
 ['wrangler','d1','execute',db,'--remote','--config','wrangler.jsonc','--json','--command='+targetSql],
 {encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']})
const targetResponse=JSON.parse(rawTarget)
if(!Array.isArray(targetResponse)||targetResponse.length!==1||
  targetResponse[0]?.success!==true||!Array.isArray(targetResponse[0]?.results))throw Error('TARGET_QUERY_FAILED')
for(const row of targetResponse[0].results) {
 if(!Number.isSafeInteger(row.lines))throw Error('TARGET_RESPONSE_INVALID')
 console.log('TARGET_FROM_USER_SCREENSHOT','SHIPPING',row.shipping_state,'LINES',row.lines,
 'FULFILLED',row.fulfilled_lines,'DISPATCHED',row.active_dispatch_lines,
 'PRIOR_ISSUE_EVIDENCE',row.proven_prior_issued_lines)
}

console.log('HISTORICAL_SHIPPING_READ_ONLY_AUDIT_END_NO_WRITES')
// Totals in ORDERS_TOUCHED are overlapping across line categories. Do not sum them
// to claim the number of unique historical orders. A physical stock issue alone
// is NEVER proof of shipping to a customer.
