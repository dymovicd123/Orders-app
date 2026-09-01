from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str):
    file = ROOT / path
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


# 1) Canonical handover resolver: permit compact all-active mode and return only the fields
# warehouse Attention summary needs for review/shortage accounting.
replace_once(
    'worker/domains/order-reservations.ts',
    """    if (listFlagsOnly) {\n      if (!chunk?.length) throw new Error('Compact handover flags require an explicit order scope.');\n      const placeholders = chunk.map(() => '?').join(',');\n      // Step 193A: the orders table needs only active-reservation + review-needed flags.\n      // Keep the full forensic payload for explicit handover/attention screens, while this\n      // canonical compact path avoids stock/customer hydration and correlated payload reads.\n      const compact = await db.prepare(\n        `WITH active_reservations AS (\n           SELECT order_id, order_item_id, inventory_source, variant_id\n           FROM inventory_reservations\n           WHERE order_id IN (${placeholders})\n             AND status = 'active'\n             AND variant_id IS NOT NULL\n         ),\n         workshop_orders AS (\n           SELECT oi.order_id\n           FROM order_items oi\n           WHERE oi.order_id IN (${placeholders})\n             AND COALESCE(oi.is_workshop, 0) = 1\n             AND oi.quantity > 0\n           GROUP BY oi.order_id\n         ),\n""",
    """    if (listFlagsOnly) {\n      const placeholders = chunk?.length ? chunk.map(() => '?').join(',') : '';\n      const compactOrderScope = chunk?.length\n        ? `r.order_id IN (${placeholders})`\n        : `o.order_status NOT IN ('deleted', 'archived') AND COALESCE(o.shipping_status, 'not_sent') <> 'sent'`;\n      // Step 193B: both the orders table and the background Warehouse Attention badge use the\n      // same compact canonical resolver. The explicit Attention screen still uses the full path.\n      const compact = await db.prepare(\n        `WITH active_reservations AS (\n           SELECT r.order_id, r.order_item_id, r.inventory_source, r.variant_id, r.quantity\n           FROM inventory_reservations r\n           JOIN orders o ON o.id = r.order_id\n           WHERE r.status = 'active'\n             AND r.variant_id IS NOT NULL\n             AND ${compactOrderScope}\n         ),\n         workshop_orders AS (\n           SELECT oi.order_id\n           FROM order_items oi\n           JOIN (SELECT DISTINCT order_id FROM active_reservations) ar0 ON ar0.order_id = oi.order_id\n           WHERE COALESCE(oi.is_workshop, 0) = 1\n             AND oi.quantity > 0\n           GROUP BY oi.order_id\n         ),\n""",
)

replace_once(
    'worker/domains/order-reservations.ts',
    """         SELECT\n           ar.order_id,\n           ar.order_item_id,\n           CASE WHEN\n""",
    """         SELECT\n           ar.order_id,\n           ar.order_item_id,\n           ar.inventory_source,\n           ar.variant_id,\n           ar.quantity AS reservation_quantity,\n           stock.quantity AS physical_quantity,\n           stock.reserved_quantity AS total_reserved_quantity,\n           CASE WHEN\n""",
)

replace_once(
    'worker/domains/order-reservations.ts',
    """         FROM active_reservations ar\n         LEFT JOIN selected_checkpoint cp ON cp.order_item_id = ar.order_item_id AND cp.rn = 1\n         LEFT JOIN latest_review lr ON lr.order_item_id = ar.order_item_id AND lr.rn = 1\n         ORDER BY ar.order_id, ar.order_item_id`\n      ).bind(...chunk, ...chunk).all<Record<string, unknown>>();\n""",
    """         FROM active_reservations ar\n         LEFT JOIN inventory_stock stock ON stock.inventory_source = ar.inventory_source AND stock.variant_id = ar.variant_id\n         LEFT JOIN selected_checkpoint cp ON cp.order_item_id = ar.order_item_id AND cp.rn = 1\n         LEFT JOIN latest_review lr ON lr.order_item_id = ar.order_item_id AND lr.rn = 1\n         ORDER BY ar.order_id, ar.order_item_id`\n      ).bind(...(chunk || [])).all<Record<string, unknown>>();\n""",
)

replace_once(
    'worker/domains/order-reservations.ts',
    """  const reviewNeeded = Boolean(\n    reservationStatus === 'active'\n    && reservationId\n    && checkpointId\n    && checkpointMillis > 0\n    && (checkpointMillis > reviewedMillis || (checkpointMillis === reviewedMillis && checkpointId !== reviewedCheckpointId))\n  );\n""",
    """  const precomputedReviewNeeded = Object.prototype.hasOwnProperty.call(row, 'review_needed')\n    ? toInt(row.review_needed, 0) === 1\n    : null;\n  const reviewNeeded = precomputedReviewNeeded ?? Boolean(\n    reservationStatus === 'active'\n    && reservationId\n    && checkpointId\n    && checkpointMillis > 0\n    && (checkpointMillis > reviewedMillis || (checkpointMillis === reviewedMillis && checkpointId !== reviewedCheckpointId))\n  );\n""",
)

# 2) Warehouse Attention: summary/badge uses compact mode; details remain full forensic.
replace_once(
    'worker/domains/warehouse-attention.ts',
    "fetchOrderStockHandoverRows(db, [], { allActive: true }),",
    "fetchOrderStockHandoverRows(db, [], { allActive: true, listFlagsOnly: !details }),",
)

# 3) Frontend: do not re-run the badge query merely because user entered Inventory.
# Writes/explicit refreshes already invalidate/reload it, and opening Attention requests details.
replace_once(
    'src/App.tsx',
    "if (activeSector === 'inventory' || warehouseAttention === null) void loadWarehouseAttention()",
    "if (warehouseAttention === null) void loadWarehouseAttention()",
)

# Update the existing cross-cutting warehouse invariant to describe the new behavior.
replace_once(
    'scripts/test-step192b1-warehouse-truth-attention.mjs',
    "check(app.includes(\"activeSector === 'inventory' || warehouseAttention === null\"), 'Warehouse attention should not re-query on every unrelated order-panel change')",
    "check(app.includes(\"if (warehouseAttention === null) void loadWarehouseAttention()\"), 'Warehouse attention summary must load once on demand instead of re-querying whenever Inventory opens')",
)

# Structural preservation: chain R2 after R1 for 192B1-added worker declarations.
replace_once(
    'scripts/test-step1906a-worker-modularization.mjs',
    "const d1ReadBudgetPath = path.join(root, 'scripts/d1-read-budget-r1-worker-manifest.json')",
    "const d1ReadBudgetPath = path.join(root, 'scripts/d1-read-budget-r1-worker-manifest.json')\nconst d1ReadBudgetR2Path = path.join(root, 'scripts/d1-read-budget-r2-worker-manifest.json')",
)
replace_once(
    'scripts/test-step1906a-worker-modularization.mjs',
    """  const d1ReadBudgetChanges = d1ReadBudget.changes || {}\n""",
    """  const d1ReadBudgetChanges = d1ReadBudget.changes || {}\n  check(fs.existsSync(d1ReadBudgetR2Path), 'D1 read-budget R2 Worker manifest missing')\n  const d1ReadBudgetR2 = JSON.parse(fs.readFileSync(d1ReadBudgetR2Path, 'utf8'))\n  check(d1ReadBudgetR2?.version === 1 && d1ReadBudgetR2?.revision === 'd1-read-budget-r2', 'D1 read-budget R2 Worker manifest invalid')\n  const d1ReadBudgetR2Changes = d1ReadBudgetR2.changes || {}\n""",
)
replace_once(
    'scripts/test-step1906a-worker-modularization.mjs',
    """    const d1ReadBudgetChanged = d1ReadBudgetChanges[name]\n    if (d1ReadBudgetChanged) {\n      check(d1ReadBudgetChanged.before === acceptedPostOrderCreateHash, `D1 read-budget R1 changed 192B1-added declaration baseline hash mismatch: ${name}`)\n      check(sha(declarations.get(name)) === d1ReadBudgetChanged.after, `192B1-added declaration changed beyond exact D1 read-budget R1 allow-list: ${name}`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostOrderCreateHash, `192B1 added Worker declaration changed beyond accepted deltas: ${name}`)\n    }\n""",
    """    const d1ReadBudgetChanged = d1ReadBudgetChanges[name]\n    let acceptedPostD1ReadBudgetHash = acceptedPostOrderCreateHash\n    if (d1ReadBudgetChanged) {\n      check(d1ReadBudgetChanged.before === acceptedPostOrderCreateHash, `D1 read-budget R1 changed 192B1-added declaration baseline hash mismatch: ${name}`)\n      acceptedPostD1ReadBudgetHash = d1ReadBudgetChanged.after\n    }\n    const d1ReadBudgetR2Changed = d1ReadBudgetR2Changes[name]\n    if (d1ReadBudgetR2Changed) {\n      check(d1ReadBudgetR2Changed.before === acceptedPostD1ReadBudgetHash, `D1 read-budget R2 changed 192B1-added declaration baseline hash mismatch: ${name}`)\n      check(sha(declarations.get(name)) === d1ReadBudgetR2Changed.after, `192B1-added declaration changed beyond exact D1 read-budget R2 allow-list: ${name}`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetHash, `192B1 added Worker declaration changed beyond accepted deltas: ${name}`)\n    }\n""",
)

# Chain the new regression into the cumulative release command.
package = ROOT / 'package.json'
text = package.read_text(encoding='utf-8')
needle = 'node scripts/test-d1-read-budget-r1.mjs'
if needle not in text:
    raise SystemExit('package.json: R1 regression command missing')
if 'test-d1-read-budget-r2.mjs' not in text:
    text = text.replace(needle, needle + ' && node scripts/test-d1-read-budget-r2.mjs', 1)
package.write_text(text, encoding='utf-8')

print('D1 read-budget R2 source patch applied')
