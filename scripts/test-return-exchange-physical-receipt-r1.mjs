import fs from 'node:fs'

const domain = fs.readFileSync('worker/domains/returns-exchanges.ts', 'utf8')
const migration = fs.readFileSync('migrations/0069_v72_return_exchange_physical_receipt.sql', 'utf8')

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

expect(migration.includes('ALTER TABLE return_items ADD COLUMN physical_tracking'), 'return_items physical_tracking migration missing')
expect(migration.includes('ALTER TABLE return_items ADD COLUMN physical_received_at'), 'return_items physical_received_at migration missing')
expect(migration.includes('ALTER TABLE exchange_items ADD COLUMN physical_tracking'), 'exchange_items physical_tracking migration missing')
expect(migration.includes('ALTER TABLE exchange_items ADD COLUMN physical_received_at'), 'exchange_items physical_received_at migration missing')
expect(migration.includes('DEFAULT 0'), 'legacy rows must remain untracked by default')

expect(domain.includes("physicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock'"), 'return item physicalState contract missing')
expect(domain.includes("oldPhysicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock'"), 'exchange oldPhysicalState contract missing')
expect(domain.includes('physical_tracking, physical_received_at'), 'physical receipt columns are not written by create flows')
expect(domain.includes("physicalState !== 'pending' ? createdAt : null"), 'return received timestamp semantics missing')
expect(domain.includes("oldPhysicalState !== 'pending' ? timestamp : null"), 'exchange received timestamp semantics missing')
expect(domain.includes('physicalTracking ? 1 : 0'), 'return tracking flag is not written')
expect(domain.includes('oldPhysicalTracking ? 1 : 0'), 'exchange tracking flag is not written')
expect(domain.includes("physicalState === 'warehouse' || physicalState === 'boutique'"), 'return destination is not derived from physical state')
expect(domain.includes("oldPhysicalState === 'warehouse' || oldPhysicalState === 'boutique'"), 'exchange destination is not derived from physical state')

// Compatibility guard: legacy payloads must still use the existing restock source semantics.
expect(domain.includes("physicalTracking ? trackedInventorySource : (restockSource !== 'none' && itemRestockRequested ? restockSource : null)"), 'legacy return restock fallback missing')
expect(domain.includes("oldPhysicalTracking ? trackedOldReturnSource : normalizeExchangeReturnSource(input.oldReturnSource)"), 'legacy exchange restock fallback missing')

console.log('Return/exchange physical receipt R1 regression: OK')
