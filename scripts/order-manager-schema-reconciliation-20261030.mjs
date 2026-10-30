// P0 #648: ONLY derives a reconciliation plan. This module contains NO D1 write
// executor, credential handling, deploy hooks or hidden automatic migrations.
// Use only after a human has reviewed the exact target DB and Time Travel state.
export const ORDER_MANAGER_AUDIT_COLUMNS = Object.freeze([
  'id', 'order_id', 'external_id', 'previous_manager_id',
  'previous_manager_name', 'new_manager_id', 'new_manager_name',
  'action', 'source', 'actor_role', 'actor_label', 'details', 'created_at',
])

const COLUMN_SQL = 'ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT'
const AUDIT_SQL = `CREATE TABLE order_manager_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  external_id TEXT NOT NULL,
  previous_manager_id INTEGER,
  previous_manager_name TEXT,
  new_manager_id INTEGER,
  new_manager_name TEXT,
  action TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_role TEXT,
  actor_label TEXT,
  details TEXT,
  created_at TEXT NOT NULL
)`

const names = rows => new Set((rows || []).map(row => String(row.name || '')))

export function planOrderManagerSchemaReconciliation(observation) {
  const orders = observation?.ordersColumns || []
  const orderNames = names(orders)
  if (!orderNames.has('id') || !orderNames.has('manager_id')) {
    throw new Error('SCHEMA_REFUSED: required orders.id/manager_id missing. Inspect target before doing anything.')
  }
  const auditPresent = observation?.auditTableExists === true
  const audit = observation?.auditColumns || []
  const missingAuditColumns = auditPresent
    ? ORDER_MANAGER_AUDIT_COLUMNS.filter(name => !names(audit).has(name))
    : []
  if (missingAuditColumns.length) {
    throw new Error('SCHEMA_REFUSED: existing order_manager_audit is incompatible: ' +
      missingAuditColumns.join(', ') + '. Do not replace or rebuild historical audit rows.')
  }
  if (auditPresent) {
    const pk = audit.find(row => String(row.name) === 'id')
    if (Number(pk?.pk || 0) !== 1) {
      throw new Error('SCHEMA_REFUSED: existing order_manager_audit.id has no primary key.')
    }
  } else if (audit.length) {
    throw new Error('SCHEMA_REFUSED: audit columns exist but table was not detected.')
  }
  const steps = []
  if (!orderNames.has('manager_snapshot_name')) {
    steps.push(Object.freeze({
      id: 'orders-manager-snapshot-name',
      object: 'orders.manager_snapshot_name',
      sql: COLUMN_SQL,
    }))
  }
  if (!auditPresent) {
    steps.push(Object.freeze({
      id: 'order-manager-audit',
      object: 'order_manager_audit',
      sql: AUDIT_SQL,
    }))
  }
  return Object.freeze({
    compatible: true,
    needsReconciliation: steps.length > 0,
    steps: Object.freeze(steps),
    // No migration step may be silently marked applied merely because this
    // pure function saw a matching schema. Never auto-execute these steps.
    requiresExplicitApproval: steps.length > 0,
  })
}

export async function inspectOrderManagerSchema(db) {
  // D1.prepare(...).all() and a local SQLite adapter both expose {results}.
  const orderResult = await db.prepare('PRAGMA table_info(orders)').all()
  const auditResult = await db.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'order_manager_audit' LIMIT 1"
  ).all()
  const auditTableExists = (auditResult.results || []).some(row => row.name === 'order_manager_audit')
  const auditColumns = auditTableExists
    ? (await db.prepare('PRAGMA table_info(order_manager_audit)').all()).results || []
    : []
  return {
    ordersColumns: orderResult.results || [],
    auditTableExists,
    auditColumns,
  }
}
