import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/order-reservations.ts', 'utf8')
const start = source.indexOf('    if (listFlagsOnly) {')
const end = source.indexOf('    const orderScope = chunk', start)
if (start < 0 || end < 0) throw new Error('Could not isolate compact handover branch')
const compact = source.slice(start, end)
const detailed = source.slice(end)
const requireText = (haystack, needle, message) => {
  if (!haystack.includes(needle)) throw new Error(message || `Missing: ${needle}`)
}
const rejectText = (haystack, needle, message) => {
  if (haystack.includes(needle)) throw new Error(message || `Unexpected: ${needle}`)
}

requireText(compact, 'lineage AS MATERIALIZED (', 'R5.4 compact lineage must be materialized once per scoped item')
requireText(compact, 'resolved AS MATERIALIZED (', 'R5.4 selected checkpoint must be resolved once per scoped item')
for (const legacy of ['latest_check AS (', 'latest_full_stocktake AS (', 'selected_checkpoint AS (', 'latest_review AS (']) {
  rejectText(compact, legacy, `Legacy windowed compact lineage survived: ${legacy}`)
}

for (const truth of [
  "c.inventory_source = si.inventory_source",
  "c.variant_id = si.variant_id",
  "datetime(c.checked_at) < datetime(si.origin_at)",
  "date(c.checked_at, '+5 hours') >= date(si.order_date)",
  "si.has_workshop = 1 AND datetime(c.checked_at) > datetime(si.origin_at)",
  "s.status = 'completed'",
  "s.id NOT LIKE 'REV-%-P-%'",
  "datetime(s.started_at) <= datetime(si.origin_at)",
  "date(s.completed_at, '+5 hours') >= date(si.order_date)",
  "exact_sku.reference_type = 'stocktake'",
  "exact_sku.reference_id = s.id",
  "COALESCE(NULLIF(reviewed_item.inventory_obligation_key, ''), 'legacy-order-item:' || reviewed_item.id) = si.obligation_key",
  "ORDER BY datetime(hr.checkpoint_at) DESC, hr.checkpoint_id DESC, hr.id DESC",
  "COALESCE(julianday(lineage_row.reviewed_checkpoint_at), 0) < julianday(lineage_row.checkpoint_at)",
  "COALESCE(lineage_row.reviewed_checkpoint_id, 0) <> lineage_row.checkpoint_id",
  "LEFT JOIN inventory_stock stock ON stock.inventory_source = ar.inventory_source AND stock.variant_id = ar.variant_id",
]) requireText(compact, truth, `R5.4 compact truth guard missing: ${truth}`)

for (const detailGuard of [
  'customer.display_name AS customer_name',
  'review.decision AS review_decision',
  'c.check_type AS checkpoint_type',
  'fs.id AS full_stocktake_session_id',
  "SELECT hr.id\n         FROM inventory_handover_reviews hr",
  "SELECT c2.id\n         FROM inventory_stock_checks c2",
  "SELECT s2.rowid\n         FROM inventory_stocktake_sessions s2",
]) requireText(detailed, detailGuard, `Detailed handover path drifted/missing: ${detailGuard}`)

if (/CREATE\s+(?:UNIQUE\s+)?INDEX|CREATE\s+TABLE|ALTER\s+TABLE/i.test(compact)) {
  throw new Error('R5.4 compact runtime rewrite must not smuggle DDL into the read path')
}

console.log('D1 READ BUDGET R5.4 PASSED — compact all-active handover lineage uses bounded indexed lookups while preserving physical-history and review truth')
