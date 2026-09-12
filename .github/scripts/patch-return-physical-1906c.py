from pathlib import Path

path = Path('scripts/test-step1906c-dead-code-cleanup.mjs')
text = path.read_text()

anchor = "  acceptedAdditiveMigrations.push('0068_v72_catalog_product_gender_scope.sql')\n"
insert = "  acceptedAdditiveMigrations.push('0069_v72_return_exchange_physical_receipt.sql')\n"
if text.count(anchor) != 1:
    raise SystemExit(f'accepted migration anchor count={text.count(anchor)}')
text = text.replace(anchor, anchor + insert, 1)

loop_anchor = "  for (const name of acceptedAdditiveMigrations) check(migrationFiles.includes(name), `Accepted additive migration missing: ${name}`)\n"
checks = r'''  const physicalReceiptMigration = read('migrations/0069_v72_return_exchange_physical_receipt.sql')
  const physicalReceiptStatements = physicalReceiptMigration
    .replace(/^\s*--.*$/gm, ' ')
    .split(';')
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const physicalReceiptAllow = [
    /^PRAGMA foreign_keys = ON$/i,
    /^ALTER TABLE return_items ADD COLUMN physical_tracking INTEGER NOT NULL DEFAULT 0 CHECK \(physical_tracking IN \(0, 1\)\)$/i,
    /^ALTER TABLE return_items ADD COLUMN physical_received_at TEXT$/i,
    /^ALTER TABLE exchange_items ADD COLUMN physical_tracking INTEGER NOT NULL DEFAULT 0 CHECK \(physical_tracking IN \(0, 1\)\)$/i,
    /^ALTER TABLE exchange_items ADD COLUMN physical_received_at TEXT$/i,
    /^CREATE INDEX IF NOT EXISTS idx_return_items_physical_receipt ON return_items\(physical_tracking, physical_received_at, return_id\)$/i,
    /^CREATE INDEX IF NOT EXISTS idx_exchange_items_physical_receipt ON exchange_items\(role, physical_tracking, physical_received_at, exchange_id\)$/i,
  ]
  check(physicalReceiptStatements.length === physicalReceiptAllow.length, `0069: expected ${physicalReceiptAllow.length} scoped statements, found ${physicalReceiptStatements.length}`)
  physicalReceiptStatements.forEach((statement, index) => check(physicalReceiptAllow[index].test(statement), `0069 statement ${index + 1} widened beyond physical receipt scope`))
  check(!/\barrival\b/i.test(physicalReceiptMigration), '0069 must not touch Arrival')
  check(!/\b(?:orders|payments|workshop_tasks|inventory_stock)\b/i.test(physicalReceiptMigration), '0069 widened into unrelated business tables')
'''
if text.count(loop_anchor) != 1:
    raise SystemExit(f'accepted migration loop anchor count={text.count(loop_anchor)}')
text = text.replace(loop_anchor, loop_anchor + checks, 1)
path.write_text(text)
print('1906C physical receipt migration allowance patched')
