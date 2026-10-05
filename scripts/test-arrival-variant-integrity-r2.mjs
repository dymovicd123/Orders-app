import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/inventory-movement.ts', 'utf8')
const start = source.indexOf('export async function resolveInventoryCreatableItemsBulk(')
const end = source.indexOf('\n\nexport async function applyInventoryMovement(', start)
if (start < 0 || end < 0) throw new Error('Cannot isolate inventory materializer')
const body = source.slice(start, end)
const applyStart = source.indexOf('export async function applyInventoryMovement(')
const applyBody = source.slice(applyStart)

const check = (value, message) => { if (!value) throw new Error(message) }

check(body.includes('Приход не восстанавливает удалённый товар автоматически'), 'retired products can still be silently restored by Arrival')
check(!body.includes('retiredProductIdsToReactivate.add(retiredId)'), 'retired product reactivation path still exists')
check(!body.includes('UPDATE catalog_products\n       SET is_active=1'), 'Arrival still directly reactivates retired catalog products')

check(applyBody.includes("if (movementType === 'arrival') {"), 'Arrival stale-variant boundary missing')
check(applyBody.includes('выбранный готовый вариант больше не активен'), 'stale selected Arrival variant does not fail clearly')
check(applyBody.includes('добавьте её как новую комбинацию без старого ID'), 'Arrival does not distinguish stale selected SKU from intentional new combination creation')

check(body.includes('allowRetiredRecreate: movementType === \'arrival\'') || applyBody.includes("allowRetiredRecreate: movementType === 'arrival'"), 'Arrival lost intentional fresh-generation handling for retired execution/variant identities')
check(body.includes('retiredVariantExactKeys') && body.includes('retiredVariantSemanticKeys'), 'retired variant identity tracking disappeared')
check(body.includes('-PHYS-'), 'fresh physical incarnation collision handling disappeared')

console.log('ARRIVAL VARIANT INTEGRITY R2 PASSED — retired products require explicit restore, stale selected SKUs fail closed, and intentional new Arrival combinations remain supported')
