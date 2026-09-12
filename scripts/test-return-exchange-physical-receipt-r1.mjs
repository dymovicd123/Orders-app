import fs from 'node:fs'

const domain = fs.readFileSync('worker/domains/returns-exchanges.ts', 'utf8')
const router = fs.readFileSync('worker/index.ts', 'utf8')
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

// Delayed physical receipt must be a dedicated idempotent operation, not a generic arrival.
expect(domain.includes('export async function receiveReturnedItem'), 'receiveReturnedItem domain operation missing')
expect(domain.includes("beginCriticalOperation(db, 'returned_item_receive'"), 'physical receipt critical operation missing')
expect(domain.includes("physical_tracking = 1 AND physical_received_at IS NULL"), 'receipt update is not guarded against double receive')
expect(domain.includes("eventKey: `return:${operationId}:item:${operationItemId}`"), 'return delayed receipt must reuse canonical lifecycle event key')
expect(domain.includes("eventKey: `exchange:${operationId}:old`"), 'exchange delayed receipt must reuse canonical lifecycle event key')
expect(domain.includes("destination === 'no_stock'"), 'received-without-restock path missing')
expect(domain.includes('completeCriticalOperation(db, criticalOperation, completedResponse)'), 'physical receipt completion cache missing')
expect(domain.includes("eventType: 'returned_item_received'"), 'physical receipt audit event missing')

expect(router.includes("receiveReturnedItem"), 'receiveReturnedItem is not wired into Worker')
expect(router.includes("url.pathname === '/api/returned-items/receive'"), 'physical receipt API route missing')
expect(router.includes("destination?: 'warehouse' | 'boutique' | 'no_stock'"), 'physical receipt route destination contract missing')
expect(router.includes("X-Idempotency-Key"), 'physical receipt route must accept idempotency key')

console.log('Return/exchange physical receipt R1 regression: OK')
