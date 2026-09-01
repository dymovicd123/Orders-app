from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one replacement, found {count}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')


# 1) Order-list hot path: stop running the full handover forensic query for every page chunk.
replace_once(
    'worker/domains/orders-relations.ts',
    "import { fetchOrderStockHandoverRows, stockHandoverItemFromRow } from './order-reservations.ts'\n",
    '',
)

replace_once(
    'worker/domains/orders-relations.ts',
    "  const chunkSize = 80;\n  for (let index = 0; index < orderIds.length; index += chunkSize) {\n",
    "  const chunkSize = 80;\n  for (let index = 0; index < orderIds.length; index += chunkSize) {\n",
)

replace_once(
    'worker/domains/orders-relations.ts',
    "    const [itemsResult, paymentsResult, returnsResult, workshopTasksResult, handoverReviewResult, activeStockHandoverResult] = await Promise.all([\n",
    "    const [itemsResult, paymentsResult, returnsResult, workshopTasksResult, handoverStateResult] = await Promise.all([\n",
)

old_handover_tasks = """      fetchOrderStockHandoverRows(db, chunk),
      db.prepare(
        `SELECT order_id, order_item_id
         FROM inventory_reservations
         WHERE order_id IN (${placeholders})
           AND status = 'active'
           AND variant_id IS NOT NULL
         ORDER BY id ASC`
      ).bind(...chunk).all(),
"""

new_handover_tasks = """      // Step 193A: the orders table needs only two booleans: whether an active stock
      // reservation exists and whether a later physical checkpoint needs one human answer.
      // The old path loaded the full handover forensic payload (stock rows, customer data,
      // correlated check/session lookups) twice for a 100-order page. Keep the full payload
      // for the explicit handover dialog; use this set-based projection for list badges/actions.
      db.prepare(
        `WITH active_reservations AS (
           SELECT order_id, order_item_id, inventory_source, variant_id
           FROM inventory_reservations
           WHERE order_id IN (${placeholders})
             AND status = 'active'
             AND variant_id IS NOT NULL
         ),
         workshop_orders AS (
           SELECT oi.order_id
           FROM order_items oi
           WHERE oi.order_id IN (${placeholders})
             AND COALESCE(oi.is_workshop, 0) = 1
             AND oi.quantity > 0
           GROUP BY oi.order_id
         ),
         scoped_items AS (
           SELECT
             oi.order_id,
             oi.id AS order_item_id,
             COALESCE(NULLIF(oi.inventory_obligation_key, ''), 'legacy-order-item:' || oi.id) AS obligation_key,
             COALESCE(NULLIF(oi.inventory_obligation_origin_at, ''), oi.created_at) AS origin_at,
             o.order_date,
             ar.inventory_source,
             ar.variant_id,
             CASE WHEN wo.order_id IS NULL THEN 0 ELSE 1 END AS has_workshop
           FROM active_reservations ar
           JOIN order_items oi ON oi.id = ar.order_item_id
           JOIN orders o ON o.id = oi.order_id
           LEFT JOIN workshop_orders wo ON wo.order_id = oi.order_id
           WHERE COALESCE(oi.is_workshop, 0) = 0
             AND oi.quantity > 0
         ),
         latest_check AS (
           SELECT
             si.order_item_id,
             c.id AS checkpoint_id,
             c.checked_at AS checkpoint_at,
             ROW_NUMBER() OVER (
               PARTITION BY si.order_item_id
               ORDER BY datetime(c.checked_at) DESC, c.id DESC
             ) AS rn
           FROM scoped_items si
           JOIN inventory_stock_checks c
             ON c.inventory_source = si.inventory_source
            AND c.variant_id = si.variant_id
           WHERE (
             (datetime(c.checked_at) < datetime(si.origin_at)
               AND date(c.checked_at, '+5 hours') >= date(si.order_date))
             OR
             (si.has_workshop = 1
               AND datetime(c.checked_at) > datetime(si.origin_at))
           )
         ),
         latest_full_stocktake AS (
           SELECT
             si.order_item_id,
             -s.rowid AS checkpoint_id,
             s.completed_at AS checkpoint_at,
             ROW_NUMBER() OVER (
               PARTITION BY si.order_item_id
               ORDER BY datetime(s.completed_at) DESC, s.rowid DESC
             ) AS rn
           FROM scoped_items si
           JOIN inventory_stocktake_sessions s
             ON s.inventory_source = si.inventory_source
           WHERE s.status = 'completed'
             AND s.completed_at IS NOT NULL
             AND s.id NOT LIKE 'REV-%-P-%'
             AND datetime(s.started_at) <= datetime(si.origin_at)
             AND date(s.completed_at, '+5 hours') >= date(si.order_date)
             AND NOT EXISTS (
               SELECT 1 FROM inventory_stock_checks exact_sku
               WHERE exact_sku.inventory_source = si.inventory_source
                 AND exact_sku.variant_id = si.variant_id
                 AND exact_sku.reference_type = 'stocktake'
                 AND exact_sku.reference_id = s.id
             )
         ),
         checkpoint_candidates AS (
           SELECT order_item_id, checkpoint_id, checkpoint_at
           FROM latest_check
           WHERE rn = 1
           UNION ALL
           SELECT order_item_id, checkpoint_id, checkpoint_at
           FROM latest_full_stocktake
           WHERE rn = 1
         ),
         selected_checkpoint AS (
           SELECT
             order_item_id,
             checkpoint_id,
             checkpoint_at,
             ROW_NUMBER() OVER (
               PARTITION BY order_item_id
               ORDER BY datetime(checkpoint_at) DESC, checkpoint_id DESC
             ) AS rn
           FROM checkpoint_candidates
         ),
         latest_review AS (
           SELECT
             si.order_item_id,
             hr.checkpoint_id AS reviewed_checkpoint_id,
             hr.checkpoint_at AS reviewed_checkpoint_at,
             ROW_NUMBER() OVER (
               PARTITION BY si.order_item_id
               ORDER BY datetime(hr.checkpoint_at) DESC, hr.checkpoint_id DESC, hr.id DESC
             ) AS rn
           FROM scoped_items si
           JOIN inventory_handover_reviews hr ON hr.order_id = si.order_id
           JOIN order_items reviewed_item ON reviewed_item.id = hr.order_item_id
           WHERE COALESCE(NULLIF(reviewed_item.inventory_obligation_key, ''), 'legacy-order-item:' || reviewed_item.id)
               = si.obligation_key
         )
         SELECT
           ar.order_id,
           ar.order_item_id,
           CASE WHEN
             julianday(cp.checkpoint_at) > 0
             AND (
               COALESCE(julianday(lr.reviewed_checkpoint_at), 0) < julianday(cp.checkpoint_at)
               OR (
                 julianday(lr.reviewed_checkpoint_at) = julianday(cp.checkpoint_at)
                 AND COALESCE(lr.reviewed_checkpoint_id, 0) <> cp.checkpoint_id
               )
             )
           THEN 1 ELSE 0 END AS review_needed
         FROM active_reservations ar
         LEFT JOIN selected_checkpoint cp
           ON cp.order_item_id = ar.order_item_id AND cp.rn = 1
         LEFT JOIN latest_review lr
           ON lr.order_item_id = ar.order_item_id AND lr.rn = 1
         ORDER BY ar.order_id, ar.order_item_id`
      ).bind(...chunk, ...chunk).all(),
"""
replace_once('worker/domains/orders-relations.ts', old_handover_tasks, new_handover_tasks)

replace_once(
    'worker/domains/orders-relations.ts',
    "    appendRows(handoverReviewByOrderId, (handoverReviewResult || []).map((row) => ({ order_id: row.order_id, order_item_id: row.order_item_id, review_needed: stockHandoverItemFromRow(row).reviewNeeded })).filter((row) => row.review_needed));\n    appendRows(activeStockHandoverByOrderId, activeStockHandoverResult.results || []);\n",
    "    appendRows(activeStockHandoverByOrderId, handoverStateResult.results || []);\n    appendRows(handoverReviewByOrderId, (handoverStateResult.results || []).filter((row) => toInt((row as Record<string, unknown>).review_needed, 0) === 1));\n",
)

# 2) Exact external order IDs are already indexed. Do not run the generic INSTR/EXISTS
# search over orders, items and payments when the user entered a complete ORD identifier.
old_q = """  if (q) {
    const searchOrderText = `COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||
      COALESCE(m.name, o.manager_snapshot_name, '') || ' ' || COALESCE(c.phone_normalized, '') || ' ' ||
      COALESCE(c.display_name, '') || ' ' || COALESCE(o.city, '') || ' ' || COALESCE(o.delivery_type, '') || ' ' || COALESCE(o.comment, '')`;
    const searchItemText = `COALESCE(oi.product_name_snapshot, '') || ' ' || COALESCE(oi.gender_snapshot, '') || ' ' ||
      COALESCE(oi.color_snapshot, '') || ' ' || COALESCE(oi.material_snapshot, '') || ' ' ||
      COALESCE(oi.length_snapshot, '') || ' ' || COALESCE(oi.size_snapshot, '')`;
    const searchPaymentText = `COALESCE(search_payment.method, '') || ' ' || COALESCE(search_payment.comment, '')`;
    const qVariants = [q, q.toUpperCase(), q.toLowerCase()];
    baseWhereParts.push(`(
      INSTR(${searchOrderText}, ?) > 0 OR INSTR(${searchOrderText}, ?) > 0 OR INSTR(${searchOrderText}, ?) > 0
      OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND (
        INSTR(${searchItemText}, ?) > 0 OR INSTR(${searchItemText}, ?) > 0 OR INSTR(${searchItemText}, ?) > 0
      ))
      OR EXISTS (SELECT 1 FROM payments search_payment WHERE search_payment.order_id = o.id AND (
        INSTR(${searchPaymentText}, ?) > 0 OR INSTR(${searchPaymentText}, ?) > 0 OR INSTR(${searchPaymentText}, ?) > 0
      ))
    )`);
    baseBindings.push(...qVariants, ...qVariants, ...qVariants);
  }
"""
new_q = """  if (q) {
    const exactExternalId = /^ORD-\\d{8,14}-[A-Z0-9]{4,16}$/i.test(q) ? q.toUpperCase() : '';
    if (exactExternalId) {
      // external_id is UNIQUE/indexed. A complete order number must never fall through to the
      // expensive free-text scan across orders + order_items + payments.
      baseWhereParts.push('o.external_id = ?');
      baseBindings.push(exactExternalId);
    } else {
      const searchOrderText = `COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||
        COALESCE(m.name, o.manager_snapshot_name, '') || ' ' || COALESCE(c.phone_normalized, '') || ' ' ||
        COALESCE(c.display_name, '') || ' ' || COALESCE(o.city, '') || ' ' || COALESCE(o.delivery_type, '') || ' ' || COALESCE(o.comment, '')`;
      const searchItemText = `COALESCE(oi.product_name_snapshot, '') || ' ' || COALESCE(oi.gender_snapshot, '') || ' ' ||
        COALESCE(oi.color_snapshot, '') || ' ' || COALESCE(oi.material_snapshot, '') || ' ' ||
        COALESCE(oi.length_snapshot, '') || ' ' || COALESCE(oi.size_snapshot, '')`;
      const searchPaymentText = `COALESCE(search_payment.method, '') || ' ' || COALESCE(search_payment.comment, '')`;
      const qVariants = [q, q.toUpperCase(), q.toLowerCase()];
      baseWhereParts.push(`(
        INSTR(${searchOrderText}, ?) > 0 OR INSTR(${searchOrderText}, ?) > 0 OR INSTR(${searchOrderText}, ?) > 0
        OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND (
          INSTR(${searchItemText}, ?) > 0 OR INSTR(${searchItemText}, ?) > 0 OR INSTR(${searchItemText}, ?) > 0
        ))
        OR EXISTS (SELECT 1 FROM payments search_payment WHERE search_payment.order_id = o.id AND (
          INSTR(${searchPaymentText}, ?) > 0 OR INSTR(${searchPaymentText}, ?) > 0 OR INSTR(${searchPaymentText}, ?) > 0
        ))
      )`);
      baseBindings.push(...qVariants, ...qVariants, ...qVariants);
    }
  }
"""
replace_once('worker/domains/orders-read.ts', old_q, new_q)

# 3) Permanent regression gate.
regression = ROOT / 'scripts/test-d1-read-budget-r1.mjs'
regression.write_text("""import fs from 'node:fs'\n\nconst relations = fs.readFileSync('worker/domains/orders-relations.ts', 'utf8')\nconst ordersRead = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')\nconst reservations = fs.readFileSync('worker/domains/order-reservations.ts', 'utf8')\nconst fail = (message) => { throw new Error(message) }\nconst check = (condition, message) => { if (!condition) fail(message) }\n\ncheck(!relations.includes('fetchOrderStockHandoverRows(db, chunk)'), 'Orders list must not load the full handover forensic payload per chunk')\ncheck(relations.includes('WITH active_reservations AS'), 'Orders list must use the compact reservation/handover projection')\ncheck(relations.includes('workshop_orders AS'), 'Mixed-order handover semantics must remain explicit')\ncheck(relations.includes('latest_full_stocktake AS'), 'Full-stocktake fallback must remain in the compact projection')\ncheck(relations.includes('latest_review AS'), 'Existing handover answers must still suppress already-reviewed checkpoints')\ncheck(relations.includes('ROW_NUMBER() OVER'), 'Compact handover projection must choose one deterministic latest checkpoint/review')\ncheck(relations.includes('review_needed'), 'Compact handover projection must preserve the list review flag')\ncheck(relations.includes('appendRows(activeStockHandoverByOrderId, handoverStateResult.results || [])'), 'Active reservation flag must come from the same compact query')\ncheck(reservations.includes('export async function fetchOrderStockHandoverRows('), 'Full handover payload must remain available for explicit order/warehouse review')\ncheck(reservations.includes('const rows = await fetchOrderStockHandoverRows(db, [orderId])'), 'Opening one order must still use full handover truth')\n\ncheck(ordersRead.includes('const exactExternalId = /^ORD-\\\\d{8,14}-[A-Z0-9]{4,16}$/i.test(q)'), 'Complete ORD identifiers must have an indexed fast path')\ncheck(ordersRead.includes("baseWhereParts.push('o.external_id = ?')"), 'Exact order search must use external_id equality')\ncheck(ordersRead.includes('const searchOrderText = `COALESCE(o.external_id'), 'General free-text search fallback must remain available')\ncheck(ordersRead.includes('EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id'), 'General item search fallback must remain available')\ncheck(ordersRead.includes('EXISTS (SELECT 1 FROM payments search_payment WHERE search_payment.order_id = o.id'), 'General payment search fallback must remain available')\n\nconsole.log('D1 read-budget R1 regression: OK')\n""", encoding='utf-8')

replace_once(
    'package.json',
    ' && node scripts/test-d1-capacity-autonomy.mjs\"',
    ' && node scripts/test-d1-capacity-autonomy.mjs && node scripts/test-d1-read-budget-r1.mjs\"',
)

# 4) Register the exact Worker declaration delta with the existing 190.6A preservation chain.
replace_once(
    'scripts/test-step1906a-worker-modularization.mjs',
    "const d1CapacityAutonomyPath = path.join(root, 'scripts/d1-capacity-autonomy-worker-manifest.json')\n",
    "const d1CapacityAutonomyPath = path.join(root, 'scripts/d1-capacity-autonomy-worker-manifest.json')\nconst d1ReadBudgetPath = path.join(root, 'scripts/d1-read-budget-r1-worker-manifest.json')\n",
)
replace_once(
    'scripts/test-step1906a-worker-modularization.mjs',
    "  const d1CapacityAutonomyChanges = d1CapacityAutonomy.changes || {}\n",
    "  const d1CapacityAutonomyChanges = d1CapacityAutonomy.changes || {}\n  check(fs.existsSync(d1ReadBudgetPath), 'D1 read-budget R1 Worker manifest missing')\n  const d1ReadBudget = JSON.parse(fs.readFileSync(d1ReadBudgetPath, 'utf8'))\n  check(d1ReadBudget?.version === 1 && d1ReadBudget?.revision === 'd1-read-budget-r1', 'D1 read-budget R1 Worker manifest invalid')\n  const d1ReadBudgetChanges = d1ReadBudget.changes || {}\n",
)
old_chain = """    const d1CapacityAutonomyChanged = d1CapacityAutonomyChanges[name]
    if (d1CapacityAutonomyChanged) {
      check(d1CapacityAutonomyChanged.before === acceptedPostOrderEditAutonomyHash, `D1 capacity autonomy baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1CapacityAutonomyChanged.after, `Worker declaration changed beyond exact D1 capacity autonomy allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostOrderEditAutonomyHash, `Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability / Shipping shortage / Exchange stale-handover / payment-method / cancellation-autonomy / order-edit-autonomy / D1-capacity deltas: ${name}`)
    }
"""
new_chain = """    const d1CapacityAutonomyChanged = d1CapacityAutonomyChanges[name]
    let acceptedPostD1CapacityHash = acceptedPostOrderEditAutonomyHash
    if (d1CapacityAutonomyChanged) {
      check(d1CapacityAutonomyChanged.before === acceptedPostOrderEditAutonomyHash, `D1 capacity autonomy baseline hash mismatch: ${name}`)
      acceptedPostD1CapacityHash = d1CapacityAutonomyChanged.after
    }
    const d1ReadBudgetChanged = d1ReadBudgetChanges[name]
    if (d1ReadBudgetChanged) {
      check(d1ReadBudgetChanged.before === acceptedPostD1CapacityHash, `D1 read-budget R1 baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1ReadBudgetChanged.after, `Worker declaration changed beyond exact D1 read-budget R1 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1CapacityHash, `Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability / Shipping shortage / Exchange stale-handover / payment-method / cancellation-autonomy / order-edit-autonomy / D1-capacity / D1-read-budget deltas: ${name}`)
    }
"""
replace_once('scripts/test-step1906a-worker-modularization.mjs', old_chain, new_chain)

print('D1 read-budget R1 source patch applied')
