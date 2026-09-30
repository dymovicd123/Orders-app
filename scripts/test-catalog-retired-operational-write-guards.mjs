import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const catalog = read('worker/domains/catalog.ts')
const reservations = read('worker/domains/order-reservations.ts')
const lifecycle = read('worker/domains/lifecycle.ts')
const inventory = read('worker/domains/inventory-movement.ts')

check(catalog.includes('options: { activeOnly?: boolean } = {}'), 'canonical snapshot has no active-only operational mode')
check(catalog.includes("v.is_active = 1 AND p.is_active = 1"), 'active-only canonical snapshot does not require live SKU + product')
check(catalog.includes('Старая SKU не может получать новые остатки или резервы'), 'active-only canonical failure is not explicit')

check(reservations.includes('loadCanonicalVariantSnapshot(db, variantId, { activeOnly: true })'), 'new order reservation can still target retired SKU')
check(reservations.includes('loadCanonicalVariantSnapshot(db, existingVariantId, { activeOnly: true })'), 'existing active reservation is not revalidated against live Catalog')
check(reservations.includes('Старая SKU не будет снова получать остаток или резерв'), 'false-handover correction can still resurrect retired SKU')

check(lifecycle.includes('loadCanonicalVariantSnapshot(db, existingVariantId, { activeOnly: true })'), 'return/exchange candidate still trusts retired order-item SKU')
check(lifecycle.includes('loadCanonicalVariantSnapshot(db, variantId, { activeOnly: true })'), 'lifecycle apply can still write physical stock to retired SKU')
check(lifecycle.includes("reason: 'safe' | 'retired_identity'"), 'lifecycle cancellation has no retired-identity physical protection')
check(lifecycle.includes("reason: 'retired_identity'"), 'lifecycle cancellation does not detect retired Catalog identity')

check(inventory.includes("alias && toInt(alias.is_active, 0) === 1"), 'inventory product alias may still resolve to inactive product')
check(inventory.includes('if (retiredId) {') && inventory.includes('if (!options.allowRetiredRecreate)'), 'retired product guard is not fail-closed outside Arrival')
check(inventory.includes('retiredVariantExactKeys') && inventory.includes('retiredVariantSemanticKeys'), 'retired SKU identity set is missing from inventory materializer')
check(inventory.includes('retiredVariantExactKeys.has(exactKey)') && inventory.includes('!options.allowRetiredRecreate'), 'non-Arrival inventory path can still recreate a retired SKU')

console.log('CATALOG RETIRED OPERATIONAL WRITE GUARDS PASSED — retired SKU rows cannot silently regain operational stock/reservations through orders, lifecycle, handover correction, or generic inventory materialization')
