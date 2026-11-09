import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const ui=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const start=ui.indexOf('async function openFoundInventoryCatalog(item: any)')
const end=ui.indexOf('async function openStocktakeOrders(',start)
assert(start>=0 && end>start,'Found-item catalog action disappeared')
const route=ui.slice(start,end)
for(const fact of [
 'Number(item?.productId || 0)',
 'await loadCatalogData(true)',
 'Number(candidate.id) === productId',
 "setCatalogCategoryFilter('all')",
 'setCatalogOnlyWithoutVariants(false)',
 "setInventoryQuery('')",
 'setExpandedCatalogProducts({ [String(productId)]: true, __w6_variant_editor: true })',
 'setCatalogVariantDraft({',
 "openInventoryPanel('catalog')",
]) assert(route.includes(fact),'Found-item exact-product selection broke: '+fact)
assert(route.indexOf('setExpandedCatalogProducts(')<route.indexOf("openInventoryPanel('catalog')"))
assert(route.includes("if (!product) {")&&route.includes("if (!Number.isSafeInteger(productId) || productId <= 0)"),'Invalid product must fail closed')
assert(!route.includes("await saveCatalogVariant")&&!route.includes("await saveInventoryMovement"),'Navigation must not mutate SKU or stock')
console.log('MAIN_STAGE24_FOUND_PRODUCT_NAVIGATION_CONTRACT_PASS')
