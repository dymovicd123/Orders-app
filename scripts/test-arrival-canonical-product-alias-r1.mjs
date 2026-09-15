import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/inventory-movement.ts', 'utf8')
const start = source.indexOf('export async function resolveInventoryCreatableItemsBulk(')
const end = source.indexOf('\n\nexport async function applyInventoryMovement(', start)
if (start < 0 || end < 0) throw new Error('Cannot isolate inventory materializer')
const body = source.slice(start, end)
const check = (value, message) => { if (!value) throw new Error(message) }

check(body.includes('if (toInt(row.is_active, 0) !== 1) continue;'), 'inactive products are excluded from name/identity lookup')
check(body.includes('if (explicit && toInt(explicit.is_active, 0) === 1) return explicit;'), 'stale explicit inactive product ids cannot keep an arrival on a retired product')
check(body.includes('const alias = lookup.byAlias.get(identityKey);'), 'active learned alias participates in arrival resolution')
check(body.includes('if (alias) return alias;'), 'canonical alias can resolve the raw arrival product name')
const aliasPos = body.indexOf('const alias = lookup.byAlias.get(identityKey);')
const exactPos = body.indexOf('const exact = lookup.byExact.get(upperText(item.productName));')
const identityPos = body.indexOf('return lookup.byIdentity.get(identityKey) || null;')
check(aliasPos >= 0 && exactPos > aliasPos && identityPos > exactPos, 'alias wins before active exact/identity name lookup for non-explicit arrivals')
check(!body.includes('return lookup.byIdentity.get(identityKey) || lookup.byAlias.get(identityKey) || null;'), 'old alias-last resolver is gone')
console.log('ARRIVAL CANONICAL PRODUCT ALIAS R1 TESTS PASSED')
