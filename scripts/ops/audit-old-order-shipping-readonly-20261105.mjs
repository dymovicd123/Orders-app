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


// Audit only which existing mechanism set the shipment marker; never change it.
const historySql=`SELECT
  (SELECT COUNT(*) FROM activity_log a WHERE a.order_id=o.id
    AND a.event_type='order_prior_issued_shipping_confirmed') AS status_only_confirmation_events,
  (SELECT COUNT(*) FROM activity_log a WHERE a.order_id=o.id
    AND a.event_type='order_stock_issued_before_full_shipping') AS early_handover_events,
  (SELECT COUNT(*) FROM inventory_handover_reviews hr WHERE hr.order_id=o.id
    AND hr.decision='issued_before_checkpoint') AS stocktake_prior_issue_reviews,
  (SELECT COUNT(*) FROM activity_log a WHERE a.order_id=o.id
    AND a.event_type='order_prior_issued_shipping_corrected') AS status_only_correction_events
FROM orders o
WHERE o.external_id='ORD-20261104091902-61F1772C'`
const historyRaw=execFileSync('npx',
 ['wrangler','d1','execute',db,'--remote','--config','wrangler.jsonc','--json','--command='+historySql],
 {encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']})
const hist=JSON.parse(historyRaw)
if(!Array.isArray(hist)||hist.length!==1||hist[0]?.success!==true||
 !Array.isArray(hist[0]?.results))throw Error('HISTORY_AUDIT_FAILED')
for(const r of hist[0].results){
 console.log('TARGET_HISTORY_PROOFS','STATUS_ONLY_CONFIRM',r.status_only_confirmation_events,
 'EARLY_HANDOVER',r.early_handover_events,'STOCKTAKE_PRIOR_ISSUES',r.stocktake_prior_issue_reviews,
 'STATUS_ONLY_CORRECTIONS',r.status_only_correction_events)
}


const discrepancySql = `SELECT cohort, explanation,
  COUNT(*) AS lines,COUNT(DISTINCT order_id) AS orders
FROM (
  SELECT o.id AS order_id,
    CASE WHEN julianday(o.created_at)<julianday('${cutoff}') THEN 'legacy'
      ELSE 'post_cutover' END AS cohort,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM order_dispatch_items di
        WHERE di.order_item_id=oi.id AND di.cancelled_quantity<di.quantity
      ) THEN 'active_selective_dispatch'
      WHEN EXISTS (
        SELECT 1 FROM order_dispatch_items di
        WHERE di.order_item_id=oi.id AND di.cancelled_quantity=di.quantity
      ) THEN 'selective_dispatch_cancelled'
      WHEN EXISTS (
        SELECT 1 FROM inventory_handover_reviews hr
        JOIN inventory_reservations r ON r.id=hr.reservation_id
        WHERE hr.order_item_id=oi.id AND r.order_item_id=oi.id
          AND hr.decision='issued_before_checkpoint'
      ) THEN 'physical_count_answer_issued_before'
      WHEN EXISTS (
        SELECT 1 FROM activity_log a
        WHERE a.order_id=o.id AND a.entity_type='order_item'
          AND a.entity_id=oi.id
          AND a.event_type='order_stock_issued_before_full_shipping'
      ) THEN 'early_handover_employee_action'
      WHEN EXISTS (
        SELECT 1 FROM activity_log a
        WHERE a.order_id=o.id AND a.entity_type='order_item'
          AND a.entity_id=oi.id
          AND a.event_type='order_stock_handover_reconciled'
      ) THEN 'historic_checkpoint_handover_action'
      ELSE 'no_positive_prior_issue_trace'
    END AS explanation
  FROM orders o JOIN order_items oi ON oi.order_id=o.id
  WHERE COALESCE(o.shipping_status,'not_sent')<>'sent'
    AND oi.quantity>0 AND oi.stock_writeoff_status='fulfilled'
    AND COALESCE(o.order_status,'') NOT IN ('deleted','archived')
    AND COALESCE(o.archived_at,'')=''
) x
GROUP BY cohort,explanation ORDER BY cohort,explanation`
if(!/^\s*SELECT\b/i.test(discrepancySql))throw Error('DISCREPANCY_MUST_BE_SELECT')
const discrepancyRaw=execFileSync('npx',
 ['wrangler','d1','execute',db,'--remote','--config','wrangler.jsonc','--json','--command='+discrepancySql],
 {encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']})
const discrepancyPayload=JSON.parse(discrepancyRaw)
if(!Array.isArray(discrepancyPayload)||discrepancyPayload.length!==1||
 discrepancyPayload[0]?.success!==true||!Array.isArray(discrepancyPayload[0]?.results)) {
 throw Error('DISCREPANCY_READ_FAILED')
}
for(const r of discrepancyPayload[0].results){
 if(!Number.isSafeInteger(r.lines)||!Number.isSafeInteger(r.orders))throw Error('DISCREPANCY_RESULT_INVALID')
 console.log('UNSENT_FULFILLED_TRIAGE',r.cohort,r.explanation,
  'LINES',r.lines,'ORDERS_TOUCHED',r.orders)
}


const unattributedSql = `SELECT
  COUNT(*) AS lines,
  SUM(CASE WHEN EXISTS(
    SELECT 1 FROM inventory_movements m
    WHERE m.reference_id=o.external_id AND m.movement_type='sale'
      AND m.variant_id=oi.variant_id AND m.inventory_source=oi.source_type
  ) THEN 1 ELSE 0 END) AS same_order_sale_movement,
  SUM(CASE WHEN EXISTS(
    SELECT 1 FROM inventory_movements m
    WHERE m.reference_id=o.external_id AND m.movement_type='revision'
      AND m.variant_id=oi.variant_id AND m.inventory_source=oi.source_type
  ) THEN 1 ELSE 0 END) AS same_order_revision_movement,
  SUM(CASE WHEN EXISTS(
    SELECT 1 FROM inventory_handover_reviews hr
    WHERE hr.order_item_id=oi.id AND hr.decision='still_here'
  ) THEN 1 ELSE 0 END) AS reviewed_still_here,
  SUM(CASE WHEN EXISTS(
    SELECT 1 FROM activity_log a
    WHERE a.order_id=o.id AND a.event_type='order_prior_issued_shipping_corrected'
  ) THEN 1 ELSE 0 END) AS past_status_only_correction,
  SUM(CASE WHEN EXISTS(
    SELECT 1 FROM order_dispatch_items di
    WHERE di.order_item_id=oi.id AND di.cancelled_quantity=di.quantity
  ) THEN 1 ELSE 0 END) AS canceled_dispatch,
  SUM(CASE WHEN EXISTS(
    SELECT 1 FROM return_items ri JOIN returns rt ON rt.id=ri.return_id
    WHERE ri.order_item_id=oi.id AND ri.quantity>0
      AND COALESCE(rt.status,'completed')<>'cancelled'
  ) THEN 1 ELSE 0 END) AS physical_return,
  SUM(CASE WHEN EXISTS(
    SELECT 1 FROM inventory_reservations r
    WHERE r.order_item_id=oi.id AND r.status='fulfilled'
  ) THEN 1 ELSE 0 END) AS fulfilled_reservation
FROM orders o JOIN order_items oi ON oi.order_id=o.id AND oi.quantity>0
WHERE julianday(o.created_at)<julianday('${cutoff}')
  AND COALESCE(o.shipping_status,'not_sent')<>'sent'
  AND oi.stock_writeoff_status='fulfilled'
  AND COALESCE(o.order_status,'') NOT IN ('deleted','archived')
  AND COALESCE(o.archived_at,'')=''
  AND NOT EXISTS(
    SELECT 1 FROM order_dispatch_items di
    WHERE di.order_item_id=oi.id AND di.cancelled_quantity<di.quantity
  )
  AND NOT EXISTS(
    SELECT 1 FROM inventory_handover_reviews hr
    WHERE hr.order_item_id=oi.id AND hr.decision='issued_before_checkpoint'
  )
  AND NOT EXISTS(
    SELECT 1 FROM activity_log a
    WHERE a.order_id=o.id AND a.entity_type='order_item' AND a.entity_id=oi.id
      AND a.event_type IN ('order_stock_issued_before_full_shipping','order_stock_handover_reconciled')
  )`
if(!/^\s*SELECT\b/i.test(unattributedSql))throw Error('UNATTRIBUTED_MUST_BE_SELECT')
const unattributedRaw=execFileSync('npx',
 ['wrangler','d1','execute',db,'--remote','--config','wrangler.jsonc','--json','--command='+unattributedSql],
 {encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']})
const unattributedResult=JSON.parse(unattributedRaw)
if(!Array.isArray(unattributedResult)||unattributedResult.length!==1||
 unattributedResult[0]?.success!==true||!Array.isArray(unattributedResult[0]?.results))throw Error('UNATTRIBUTED_READ_FAILED')
for(const row of unattributedResult[0].results){
 if(!Number.isSafeInteger(row.lines))throw Error('UNATTRIBUTED_COUNT_INVALID')
 for(const name of ['same_order_sale_movement','same_order_revision_movement','reviewed_still_here',
 'past_status_only_correction','canceled_dispatch','physical_return','fulfilled_reservation']){
  if(row[name]!==null && !Number.isSafeInteger(row[name]))throw Error('UNATTRIBUTED_INVALID_'+name)
 }
 console.log('UNATTRIBUTED_OLD_FULFILLED_PROVENANCE',JSON.stringify(row))
}


const catalogSql = `SELECT cohort, status, product_link, variant_link,
 COUNT(*) AS lines, COUNT(DISTINCT order_id) AS orders
FROM (
 SELECT o.id AS order_id,
  CASE WHEN julianday(o.created_at)<julianday('${cutoff}') THEN 'legacy'
    ELSE 'post_cutover' END AS cohort,
  COALESCE(NULLIF(oi.stock_writeoff_status,''),'unknown') AS status,
  CASE WHEN COALESCE(oi.product_id,0)=0 THEN 'missing_id'
    WHEN EXISTS(SELECT 1 FROM catalog_products p WHERE p.id=oi.product_id AND p.is_active=1)
      THEN 'active'
    WHEN EXISTS(SELECT 1 FROM catalog_products p WHERE p.id=oi.product_id)
      THEN 'retired'
    ELSE 'broken_id' END AS product_link,
  CASE WHEN COALESCE(oi.variant_id,0)=0 THEN 'missing_id'
    WHEN EXISTS(SELECT 1 FROM catalog_variants v WHERE v.id=oi.variant_id AND v.is_active=1)
      THEN 'active'
    WHEN EXISTS(SELECT 1 FROM catalog_variants v WHERE v.id=oi.variant_id)
      THEN 'retired'
    ELSE 'broken_id' END AS variant_link
 FROM orders o JOIN order_items oi ON oi.order_id=o.id
 WHERE oi.quantity>0 AND COALESCE(o.shipping_status,'not_sent')<>'sent'
   AND COALESCE(o.order_status,'') NOT IN ('deleted','archived')
   AND COALESCE(o.archived_at,'')=''
   AND oi.stock_writeoff_status IN (
     'catalog_unresolved','catalog_retired','pending_reservation','reservation_released'
   )
) x GROUP BY cohort,status,product_link,variant_link
ORDER BY cohort,status,product_link,variant_link`
if(!/^\s*SELECT\b/i.test(catalogSql))throw Error('CATALOG_TRIAGE_MUST_BE_SELECT')
const catalogRaw=execFileSync('npx',
 ['wrangler','d1','execute',db,'--remote','--config','wrangler.jsonc','--json','--command='+catalogSql],
 {encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']})
const catalogResult=JSON.parse(catalogRaw)
if(!Array.isArray(catalogResult)||catalogResult.length!==1||
 catalogResult[0]?.success!==true||!Array.isArray(catalogResult[0]?.results))throw Error('CATALOG_TRIAGE_FAILED')
for(const row of catalogResult[0].results){
 if(!Number.isSafeInteger(row.lines)||!Number.isSafeInteger(row.orders))throw Error('CATALOG_TRIAGE_RESULT_INVALID')
 console.log('CATALOG_TRIAGE',row.cohort,row.status,row.product_link,row.variant_link,
   'LINES',row.lines,'ORDERS_TOUCHED',row.orders)
}


const variantCandidatesSql = `SELECT cohort, source_state, snapshot_state,
 CASE WHEN exact_candidates=0 THEN 'no_exact_match'
   WHEN exact_candidates=1 THEN 'unique_exact_match'
   ELSE 'ambiguous' END AS match_state,
 COUNT(*) AS lines, COUNT(DISTINCT order_id) AS orders
FROM (
 SELECT o.id AS order_id,
 CASE WHEN julianday(o.created_at)<julianday('${cutoff}') THEN 'legacy' ELSE 'post_cutover' END AS cohort,
 CASE WHEN COALESCE(oi.product_id,0)>0 THEN 'known_product' ELSE 'unknown_product' END AS source_state,
 CASE WHEN TRIM(COALESCE(oi.gender_snapshot,''))<>'' AND
   TRIM(COALESCE(oi.color_snapshot,''))<>'' AND
   TRIM(COALESCE(oi.material_snapshot,''))<>'' AND
   TRIM(COALESCE(oi.length_snapshot,''))<>'' AND
   TRIM(COALESCE(oi.size_snapshot,''))<>''
   THEN 'all_characteristics_present'
   ELSE 'some_characteristics_missing' END AS snapshot_state,
 (SELECT COUNT(*)
  FROM catalog_variants v
  WHERE v.product_id=oi.product_id AND v.is_active=1
   AND (TRIM(COALESCE(oi.gender_snapshot,''))='' OR
        UPPER(TRIM(COALESCE(v.gender,'')))=UPPER(TRIM(oi.gender_snapshot)))
   AND (TRIM(COALESCE(oi.color_snapshot,''))='' OR
        UPPER(TRIM(COALESCE(v.color,'')))=UPPER(TRIM(oi.color_snapshot)))
   AND (TRIM(COALESCE(oi.material_snapshot,''))='' OR
        UPPER(TRIM(COALESCE(v.material,'')))=UPPER(TRIM(oi.material_snapshot)))
   AND (TRIM(COALESCE(oi.length_snapshot,''))='' OR
        UPPER(TRIM(COALESCE(v.length,'')))=UPPER(TRIM(oi.length_snapshot)))
   AND (TRIM(COALESCE(oi.size_snapshot,''))='' OR
        UPPER(TRIM(COALESCE(v.size_label,'')))=UPPER(TRIM(oi.size_snapshot)))
 ) AS exact_candidates
 FROM orders o JOIN order_items oi ON oi.order_id=o.id
 WHERE COALESCE(o.shipping_status,'not_sent')<>'sent'
   AND COALESCE(o.order_status,'') NOT IN ('deleted','archived')
   AND COALESCE(o.archived_at,'')=''
   AND oi.quantity>0 AND oi.stock_writeoff_status='catalog_unresolved'
) x
GROUP BY cohort,source_state,snapshot_state,match_state
ORDER BY cohort,source_state,snapshot_state,match_state`
if(!/^\s*SELECT\b/i.test(variantCandidatesSql))throw Error('VARIANT_CANDIDATES_MUST_BE_SELECT')
const variantsRaw=execFileSync('npx',
 ['wrangler','d1','execute',db,'--remote','--config','wrangler.jsonc','--json','--command='+variantCandidatesSql],
 {encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']})
const variantsResult=JSON.parse(variantsRaw)
if(!Array.isArray(variantsResult)||variantsResult.length!==1||
 variantsResult[0]?.success!==true||!Array.isArray(variantsResult[0]?.results))throw Error('VARIANT_CANDIDATES_FAILED')
for(const row of variantsResult[0].results){
 if(!Number.isSafeInteger(row.lines)||!Number.isSafeInteger(row.orders))throw Error('VARIANT_CANDIDATES_INVALID')
 console.log('CATALOG_UNRESOLVED_EXACT_MATCH',row.cohort,row.source_state,row.snapshot_state,row.match_state,
 'LINES',row.lines,'ORDERS_TOUCHED',row.orders)
}

console.log('HISTORICAL_SHIPPING_READ_ONLY_AUDIT_END_NO_WRITES')
// Totals in ORDERS_TOUCHED are overlapping across line categories. Do not sum them
// to claim the number of unique historical orders. A physical stock issue alone
// is NEVER proof of shipping to a customer.
