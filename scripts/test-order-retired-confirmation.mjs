import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const reservations = read('worker/domains/order-reservations.ts')
const ordersWrite = read('worker/domains/orders-write.ts')
const types = read('worker/core/types.ts')
const worker = read('worker/index.ts')
const app = read('src/App.tsx')

const inspectStart = reservations.indexOf('export async function inspectOrderRetiredCatalogIdentityV2')
const inspectEnd = reservations.indexOf('export async function resolveCatalogProductAndVariantV2(', inspectStart + 1)
check(inspectStart >= 0 && inspectEnd > inspectStart, 'retired-order preflight inspector is missing')
const inspectBody = reservations.slice(inspectStart, inspectEnd)
check(!/\b(?:UPDATE|INSERT|DELETE)\b/i.test(inspectBody), 'retired-order preflight inspector must stay read-only')
check(inspectBody.includes("findRetiredCatalogExecutionV3"), 'retired execution is not detected before order recreation')
check(inspectBody.includes("findRetiredCatalogCombinationV3"), 'retired SKU is not detected before order recreation')
check(inspectBody.includes("WHERE id = ? AND is_active = 0"), 'retired product shell is not detected before order recreation')
check(inspectBody.includes('confirmationKey = catalogOrderInputKey(item)'), 'confirmation is not bound to exact normalized item identity')

check(types.includes('retiredCatalogRecreateKeys?: string[]'), 'OrderInput has no exact retired recreation confirmation keys')
check(ordersWrite.includes('await inspectOrderRetiredCatalogIdentityV2(db, item)'), 'Create does not preflight retired identity before mutation')
check(ordersWrite.includes('throw new OrderRetiredCatalogConfirmationError(retiredConfirmationItems)'), 'Create does not stop for explicit retired identity confirmation')
check(ordersWrite.includes('confirmedRetiredKeys.has(catalogOrderInputKey(item))'), 'retired recreation permission is not scoped to exact item identity')
check(!ordersWrite.includes("resolveCatalogProductAndVariant(db, item, createdAt, { allowRetiredRecreate: true })"), 'Create still has blanket retired recreation permission')

const confirmationThrow = ordersWrite.indexOf('throw new OrderRetiredCatalogConfirmationError(retiredConfirmationItems)')
const resolverMutation = ordersWrite.indexOf('await resolveCatalogProductAndVariant(db, item, createdAt, { allowRetiredRecreate })')
check(confirmationThrow >= 0 && resolverMutation > confirmationThrow, 'retired confirmation does not happen before Catalog materialization')
const freshShortageThrow = ordersWrite.indexOf('throw new OrderStockShortageError(retiredFreshShortages)')
check(freshShortageThrow > confirmationThrow && resolverMutation > freshShortageThrow, 'confirmed fresh-generation stock decision can still fail after Catalog mutation')

check(worker.includes('error instanceof OrderRetiredCatalogConfirmationError'), 'order API does not expose retired confirmation as a structured conflict')
check(worker.includes('retiredItems: error.items'), 'order API does not return exact retired confirmation items')

check(app.includes("result.code === 'order_retired_catalog_confirmation_required'"), 'Create UI does not handle retired confirmation response')
check(app.includes('retiredCatalogRecreateKeys: string[] = []'), 'Create retry does not carry exact retired confirmation keys')
check(app.includes('await createOrderFromDraft(confirmationKeys)'), 'Create UI does not retry only after explicit confirmation')
check(app.includes('Старые заказы и история не изменятся'), 'retired confirmation copy does not explain history isolation')
check(app.includes('Старые остатки и резервы не вернутся'), 'retired confirmation copy does not explain clean stock generation')

console.log('ORDER RETIRED CATALOG CONFIRMATION PASSED — retired product/execution/SKU identity is detected read-only, requires explicit exact-item confirmation, and shortage decisions stop before fresh-generation mutation')
