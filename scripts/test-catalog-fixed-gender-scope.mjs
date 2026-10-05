import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const catalog = read('worker/domains/catalog.ts')
const orders = read('worker/domains/order-reservations.ts')
const inventory = read('worker/domains/inventory-movement.ts')
const review = read('worker/domains/catalog-review.ts')
const retirement = read('worker/domains/catalog-retirement.ts')

check(catalog.includes('export function assertCatalogGenderAllowedForScope'), 'fixed-scope gender guard helper missing')
check(catalog.includes("if (fixed && (gender === 'ЖЕН' || gender === 'МУЖ') && gender !== fixed)"), 'fixed-scope guard does not reject opposite concrete gender')
check(catalog.includes('Если товар действительно подходит обоим полам, сначала измените назначение товара на «Унисекс».'),
  'fixed-scope guard does not explain the intentional unisex escape hatch')

const resolveStart = catalog.indexOf('export async function resolveCatalogGenderForProduct')
const createCombinationStart = catalog.indexOf('export async function createCatalogCombinationV3')
check(resolveStart >= 0 && createCombinationStart > resolveStart, 'Catalog gender/create functions missing')
const resolveBody = catalog.slice(resolveStart, catalog.indexOf('export function normalizeCatalogCombinationGender', resolveStart))
const combinationBody = catalog.slice(createCombinationStart, catalog.indexOf('export async function isHumanInventoryModelEnabled', createCombinationStart))
check(resolveBody.includes('const scope = await getCatalogProductGenderScope(db, productId)'), 'Catalog admin gender resolver does not read fixed product scope')
check(resolveBody.includes('assertCatalogGenderAllowedForScope(scope, explicitGender)'), 'Catalog admin still lets explicit opposite gender override fixed product scope')
check(combinationBody.includes('await assertCatalogGenderAllowedForProduct(db, input.productId, gender)'), 'central SKU creator lacks fixed-scope backstop')
check(combinationBody.indexOf('await assertCatalogGenderAllowedForProduct') < combinationBody.indexOf('const duplicate = await findCatalogCombinationV3'),
  'central SKU creator can reuse an already-wrong active SKU before checking fixed scope')

const orderStart = orders.indexOf('export async function resolveCatalogProductAndVariantV2(')
const orderEnd = orders.indexOf('\n\nexport async function resolveCatalogItemsForOrderV2', orderStart)
const orderBody = orders.slice(orderStart, orderEnd)
check(orderBody.includes('const fixedProductGender = catalogGenderForProductScope(productGenderScope)'), 'order resolver does not derive fixed product gender')
check(orderBody.includes('if (enteredGender && fixedProductGender && enteredGender !== fixedProductGender)'), 'order resolver accepts opposite gender for fixed product')
check(orderBody.indexOf('enteredGender !== fixedProductGender') < orderBody.indexOf('const existingExecution = await findCatalogExecutionV3'),
  'order resolver can match/reserve an existing wrong-gender SKU before fixed-scope validation')
check(orderBody.includes("matchStatus: 'unresolved_attribute'"), 'order mismatch does not fail closed into human correction flow')

const invStart = inventory.indexOf('export async function resolveInventoryCreatableItemsBulk(')
const invEnd = inventory.indexOf('\n\nexport async function applyInventoryMovement(', invStart)
const invBody = inventory.slice(invStart, invEnd)
check(invBody.includes('const assertKnownProductGender ='), 'inventory materializer lacks pre-mutation fixed-gender preflight')
check(invBody.includes('assertKnownProductGender(activeProduct, item)'), 'active fixed product is not checked before inventory materialization')
check(invBody.includes('assertKnownProductGender(retired, item)'), 'retired fixed product is not checked before Arrival rejects the retired shell')
check(invBody.indexOf('assertKnownProductGender(retired, item)') < invBody.indexOf('retiredProductConflict ='),
  'Arrival captures a retired product recovery only after fixed-gender validation')
check(!invBody.includes('retiredProductIdsToReactivate'), 'Arrival can still schedule a retired product reactivation')
check(invBody.includes('return assertCatalogGenderAllowedForScope(product?.gender_scope, explicit, product?.name).gender'),
  'bulk SKU insertion can still use explicit opposite gender')
check(invBody.indexOf('const assertKnownProductGender =') < invBody.indexOf('INSERT OR IGNORE INTO catalog_products'),
  'inventory fixed-gender preflight occurs only after a product mutation')

const reviewStart = review.indexOf('export async function resolveCatalogReview')
const reviewBody = review.slice(reviewStart >= 0 ? reviewStart : 0)
check(reviewBody.includes("assertCatalogGenderAllowedForScope(requestedGenderScope || 'unisex', gender, product?.name || requestedProductName)"),
  'Catalog review can materialize opposite gender for a fixed product')
check(reviewBody.indexOf("assertCatalogGenderAllowedForScope(requestedGenderScope || 'unisex'") < reviewBody.indexOf('const referencePlan'),
  'Catalog review validates fixed gender only after master-data mutation planning')

const restoreStart = retirement.indexOf('export async function restoreCatalogRetirement(')
const restoreBody = retirement.slice(restoreStart)
check(restoreBody.includes('const productGenderScope = await getCatalogProductGenderScope(db, productId)'), 'restore does not inspect current product gender scope')
check(restoreBody.includes('assertCatalogGenderAllowedForScope(productGenderScope, row.gender'), 'restore can recreate historical opposite-gender SKU')
check(restoreBody.indexOf('assertCatalogGenderAllowedForScope(productGenderScope, row.gender') < restoreBody.indexOf('INSERT OR IGNORE INTO catalog_retirement_restores'),
  'restore writes started/audit state before rejecting an invalid historical gender snapshot')
check(restoreBody.indexOf('assertCatalogGenderAllowedForScope(productGenderScope, row.gender') < restoreBody.indexOf('UPDATE catalog_products SET is_active=1'),
  'restore can reactivate product shell before rejecting invalid historical gender snapshot')

console.log('CATALOG FIXED GENDER SCOPE PASSED — fixed male/female products reject opposite-gender working SKUs across Catalog, orders, Arrival/inventory, Resolver review and restore; unisex remains explicit-gender capable')
