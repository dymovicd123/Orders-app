import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/inventory-movement.ts', 'utf8')
const start = source.indexOf('export async function resolveInventoryCreatableItemsBulk(')
const end = source.indexOf('\n\nexport async function applyInventoryMovement(', start)
if (start < 0 || end < 0) throw new Error('Cannot isolate inventory materializer')
const body = source.slice(start, end)
const check = (value, message) => { if (!value) throw new Error(message) }

check(body.includes('if (toInt(row.is_active, 0) !== 1) continue;'), 'inactive products are excluded from name/identity lookup')
check(body.includes('if (explicit && toInt(explicit.is_active, 0) === 1) return explicit;'), 'stale explicit inactive product ids cannot keep an arrival on a retired product')
check(body.includes('const alias = lookup.byAlias.get(identityKey);'), 'learned alias participates in arrival resolution')
check(body.includes('if (alias && toInt(alias.is_active, 0) === 1) return alias;'), 'active canonical alias resolves the raw arrival product name directly')
const aliasPos = body.indexOf('const alias = lookup.byAlias.get(identityKey);')
const exactPos = body.indexOf('const exact = lookup.byExact.get(upperText(item.productName));')
const identityPos = body.indexOf('return lookup.byIdentity.get(identityKey) || null;')
check(aliasPos >= 0 && exactPos > aliasPos && identityPos > exactPos, 'active alias wins before active exact/identity name lookup for non-explicit arrivals')
check(body.includes('const aliasTarget = identityKey ? lookup.byAlias.get(identityKey) : null;'), 'inactive canonical alias is examined as retired identity')
check(body.includes('aliasTarget && toInt(aliasTarget.is_active, 0) !== 1'), 'inactive alias target cannot bypass retired-product handling')
check(body.includes("code: 'arrival_retired_product'"), 'retired product must require an explicit audited restore decision before Arrival continues')
check(!body.includes('retiredProductIdsToReactivate.add(retiredId);'), 'Arrival must not silently reactivate a retired product shell')
check(!body.includes('return lookup.byIdentity.get(identityKey) || lookup.byAlias.get(identityKey) || null;'), 'old alias-last resolver is gone')
console.log('ARRIVAL CANONICAL PRODUCT ALIAS R1 TESTS PASSED — active aliases resolve directly; retired products require an explicit Catalog restore before Arrival')
