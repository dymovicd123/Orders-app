import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = ON;')
for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
  db.exec(readFileSync(`migrations/${file}`, 'utf8'))
}
const orderColumns = new Set(db.prepare(`PRAGMA table_info('orders')`).all().map((row) => String(row.name)))
if (!orderColumns.has('manager_snapshot_name')) db.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT;')
const all = (sql, ...params) => db.prepare(sql).all(...params)

try {
  all(`SELECT m.id, m.inventory_source, m.movement_type, m.product_id, m.variant_id,
      m.product_name_snapshot, m.gender_snapshot, m.color_snapshot, m.material_snapshot,
      m.length_snapshot, m.size_snapshot, m.quantity_delta, m.quantity_after,
      m.reference_type, m.reference_id, m.comment, m.created_at,
      r.reversed_at, r.reversal_movement_id,
      CASE WHEN rr.original_movement_id IS NOT NULL THEN 1 ELSE 0 END AS is_reversal,
      td.from_source AS transfer_from_source, td.to_source AS transfer_to_source,
      td.status AS transfer_status, td.comment AS transfer_comment,
      (SELECT COUNT(*) FROM inventory_transfer_items ti WHERE ti.transfer_id = td.id) AS transfer_item_count,
      (SELECT COALESCE(SUM(ti.quantity), 0) FROM inventory_transfer_items ti WHERE ti.transfer_id = td.id) AS transfer_total_quantity
    FROM inventory_movements m
    LEFT JOIN inventory_movement_reversals r ON r.original_movement_id = m.id
    LEFT JOIN inventory_movement_reversals rr ON rr.reversal_movement_id = m.id
    LEFT JOIN inventory_transfer_documents td ON td.external_id = m.reference_id AND m.reference_type IN ('transfer_in', 'transfer_out')
    WHERE m.inventory_source = ? AND m.variant_id = ? ORDER BY m.id DESC LIMIT ?`, 'warehouse', 1, 51)

  all(`SELECT c.id, c.inventory_source, c.check_type, c.reference_type, c.reference_id,
      c.expected_quantity, c.counted_quantity, c.difference_quantity, c.checked_by, c.checked_at
    FROM inventory_stock_checks c WHERE c.variant_id = ? AND c.inventory_source = ?
    ORDER BY c.checked_at DESC, c.id DESC LIMIT ?`, 1, 'warehouse', 40)

  all(`SELECT s.id, s.inventory_source, s.created_by, s.started_at, s.completed_at,
      COUNT(i.id) AS item_count,
      SUM(CASE WHEN i.counted_quantity IS NOT NULL AND i.counted_quantity <> i.baseline_quantity THEN 1 ELSE 0 END) AS difference_count,
      COALESCE(SUM(CASE WHEN i.counted_quantity IS NOT NULL THEN i.counted_quantity - i.baseline_quantity ELSE 0 END), 0) AS net_delta
    FROM inventory_stocktake_sessions s LEFT JOIN inventory_stocktake_items i ON i.session_id = s.id
    WHERE s.status = 'completed' AND s.inventory_source = ?
    GROUP BY s.id, s.inventory_source, s.created_by, s.started_at, s.completed_at
    ORDER BY s.completed_at DESC, s.id DESC LIMIT ?`, 'warehouse', 40)

  all(`SELECT MIN(c.id) AS id, c.inventory_source, c.check_type, c.reference_type, c.reference_id,
      MAX(c.checked_at) AS checked_at, MAX(COALESCE(c.checked_by, '')) AS checked_by,
      COUNT(*) AS item_count,
      SUM(CASE WHEN c.difference_quantity <> 0 THEN 1 ELSE 0 END) AS difference_count,
      COALESCE(SUM(c.difference_quantity), 0) AS net_delta
    FROM inventory_stock_checks c
    WHERE COALESCE(c.reference_type, '') <> 'stocktake' AND c.inventory_source = ?
    GROUP BY c.inventory_source, c.check_type, c.reference_type, c.reference_id
    ORDER BY checked_at DESC, id DESC LIMIT ?`, 'warehouse', 40)

  all(`WITH selected_returns AS (
      SELECT r.id FROM returns r JOIN orders o ON o.id = r.order_id
      LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
      LEFT JOIN customers c ON c.id = o.customer_id
      ORDER BY r.return_date DESC, r.id DESC LIMIT ? OFFSET ?
    )
    SELECT r.id, r.order_id, o.external_id, o.order_date, r.return_date, r.amount, r.payment_method, r.status,
      COALESCE(r.comment, '') AS comment, r.cancelled_at, COALESCE(r.cancellation_comment, '') AS cancellation_comment,
      COALESCE(r.manager_id, o.manager_id) AS manager_id, COALESCE(m.name, o.manager_snapshot_name, 'Не указан') AS manager,
      COALESCE(m.color_key, '#475569') AS manager_color, COALESCE(c.display_name, c.phone_normalized, '—') AS customer,
      COALESCE(o.city, '') AS city, linked_exchange.id AS exchange_id,
      ri.id AS return_item_id, ri.order_item_id AS return_item_order_item_id,
      ri.product_name_snapshot AS return_item_product_name, ri.quantity AS return_item_quantity,
      ri.gender_snapshot AS return_item_gender, ri.color_snapshot AS return_item_color,
      ri.material_snapshot AS return_item_material, ri.length_snapshot AS return_item_length,
      ri.size_snapshot AS return_item_size, ri.inventory_source AS return_item_inventory_source,
      ri.restocked AS return_item_restocked, lifecycle.status AS return_item_lifecycle_status,
      lifecycle.pending_reason AS return_item_pending_reason
    FROM selected_returns selected JOIN returns r ON r.id = selected.id JOIN orders o ON o.id = r.order_id
    LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN exchanges linked_exchange ON linked_exchange.id = (SELECT e.id FROM exchanges e WHERE e.refund_return_id = r.id ORDER BY e.id DESC LIMIT 1)
    LEFT JOIN return_items ri ON ri.return_id = r.id
    LEFT JOIN inventory_lifecycle_events lifecycle ON lifecycle.id = (
      SELECT e.id FROM inventory_lifecycle_events e WHERE e.operation_type = 'return' AND e.operation_id = r.id AND e.operation_item_id = ri.id ORDER BY e.id DESC LIMIT 1
    )
    ORDER BY r.return_date DESC, r.id DESC, ri.id ASC`, 50, 0)

  all(`SELECT e.*, o.external_id, o.order_date, m.name AS manager_name,
      c.phone_normalized AS customer_phone, c.display_name AS customer_name,
      CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.product_name_snapshot ELSE old_item.product_name_snapshot END AS old_product_name,
      CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.quantity ELSE e.old_quantity END AS old_item_quantity,
      CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.gender_snapshot ELSE old_item.gender_snapshot END AS old_gender_snapshot,
      CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.color_snapshot ELSE old_item.color_snapshot END AS old_color_snapshot,
      CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.material_snapshot ELSE old_item.material_snapshot END AS old_material_snapshot,
      CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.length_snapshot ELSE old_item.length_snapshot END AS old_length_snapshot,
      CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.size_snapshot ELSE old_item.size_snapshot END AS old_size_snapshot,
      CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.inventory_source ELSE e.old_return_source END AS old_inventory_source,
      CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.product_name_snapshot ELSE new_item.product_name_snapshot END AS new_product_name,
      CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.quantity ELSE new_item.quantity END AS new_item_quantity,
      CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.gender_snapshot ELSE new_item.gender_snapshot END AS new_gender_snapshot,
      CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.color_snapshot ELSE new_item.color_snapshot END AS new_color_snapshot,
      CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.material_snapshot ELSE new_item.material_snapshot END AS new_material_snapshot,
      CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.length_snapshot ELSE new_item.length_snapshot END AS new_length_snapshot,
      CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.size_snapshot ELSE new_item.size_snapshot END AS new_size_snapshot,
      CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.inventory_source ELSE e.new_source_type END AS new_inventory_source,
      old_lifecycle.status AS old_lifecycle_status, new_lifecycle.status AS new_lifecycle_status
    FROM exchanges e JOIN orders o ON o.id = e.order_id
    LEFT JOIN managers m ON m.id = e.manager_id LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN exchange_items old_snapshot ON old_snapshot.id = (SELECT ei.id FROM exchange_items ei WHERE ei.exchange_id = e.id AND ei.role = 'old' ORDER BY ei.id ASC LIMIT 1)
    LEFT JOIN exchange_items new_snapshot ON new_snapshot.id = (SELECT ei.id FROM exchange_items ei WHERE ei.exchange_id = e.id AND ei.role = 'new' ORDER BY ei.id ASC LIMIT 1)
    LEFT JOIN order_items old_item ON old_item.id = e.old_order_item_id LEFT JOIN order_items new_item ON new_item.id = e.new_order_item_id
    LEFT JOIN inventory_lifecycle_events old_lifecycle ON old_lifecycle.id = (SELECT le.id FROM inventory_lifecycle_events le WHERE le.operation_type = 'exchange' AND le.operation_id = e.id AND le.event_type = 'exchange_old_in' ORDER BY le.id DESC LIMIT 1)
    LEFT JOIN inventory_lifecycle_events new_lifecycle ON new_lifecycle.id = (SELECT le.id FROM inventory_lifecycle_events le WHERE le.operation_type = 'exchange' AND le.operation_id = e.id AND le.event_type = 'exchange_new_out' ORDER BY le.id DESC LIMIT 1)
    ORDER BY e.exchange_date DESC, e.id DESC LIMIT ? OFFSET ?`, 50, 0)

  all(`SELECT r.id, r.occurred_at, r.business_date, r.comment, r.created_by,
      COALESCE((SELECT MAX(p.id) FROM cash_register_entries p WHERE p.entry_type = 'ledger_reset' AND p.id < r.id), 0) AS previous_reset_id
    FROM cash_register_entries r WHERE r.entry_type = 'ledger_reset' ORDER BY r.id DESC LIMIT ? OFFSET ?`, 13, 0)

  console.log('Step 189B SQL shape tests: OK')
} catch (error) {
  console.error(`Step 189B SQL shape tests FAILED: ${error?.message || error}`)
  process.exit(1)
}
