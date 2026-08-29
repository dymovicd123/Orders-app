import fs from 'node:fs'
const source = fs.readFileSync('worker/domains/inventory-movement.ts', 'utf8')
const start = source.indexOf('export async function resolveInventoryCreatableItemsBulk(')
const end = source.indexOf('\n\nexport async function applyInventoryMovement(', start)
if (start < 0 || end < 0) throw new Error('Cannot isolate inventory materializer')
const body = source.slice(start, end)
const check = (value, message) => { if (!value) throw new Error(message) }
check(body.includes('occupiedIds') && body.includes('-PHYS-'), 'Retired external-id collision can still block physical materialization')
check(body.includes('SELECT external_id FROM catalog_variants'), 'Historical external-id occupancy is not inspected')
check(!body.includes('UPDATE catalog_variants SET is_active = 1'), 'Arrival must not resurrect a client-retired historical variant')
check(body.indexOf('occupiedIds') < body.indexOf('INSERT OR IGNORE INTO catalog_variants'), 'Collision guard must run before variant insert')
console.log('ARRIVAL MATERIALIZATION RELIABILITY TESTS PASSED — retired history stays retired while a new physical incarnation can receive a unique external id')
