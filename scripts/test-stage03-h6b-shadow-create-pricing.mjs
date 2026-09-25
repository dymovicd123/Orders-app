import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const workspace = read('src/app/controllers/useWorkspaceViewModel.tsx')
const resolver = read('src/app/order-pricing.ts')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const cleanup = read('scripts/test-step1906c-dead-code-cleanup.mjs')
const manifest = JSON.parse(read('scripts/stage03-h6b-shadow-create-pricing-frontend-manifest.json'))

check(manifest?.version === 1 && manifest?.revision === 'stage03-h6b-shadow-create-pricing', 'H6B frontend manifest missing')
check(Object.keys(manifest.files || {}).sort().join(',') === ['src/App.tsx','src/app/controllers/useWorkspaceViewModel.tsx'].sort().join(','), 'H6B frontend allow-list widened')
check(app.includes('resolveCatalogOrderSalePrice') && app.includes('evaluateItemizedCreatePricing'), 'App must make pricing resolver/readiness runtime reachable')
check(workspace.includes("import { resolveCatalogOrderSalePrice } from '../order-pricing'"), 'Catalog product-pick path must use H5 resolver')
check(workspace.includes('const pickedItem = buildOrderItemFromCatalogPick(item, productName)') && workspace.includes('const pricing = resolveCatalogOrderSalePrice(catalogData, pickedItem)'), 'Catalog pick must seed hidden price from resolved execution')
check(app.includes("['productName', 'audienceType', 'material', 'length'].includes(String(field))"), 'Accepted base price-driving fields must refresh shadow price')
check(app.includes("nextItem.unitPrice = pricing.status === 'matched' ? pricing.salePrice : undefined"), 'Missing/ambiguous recommendation must clear hidden final price instead of inventing zero')
check(app.includes("nextItem.catalogPriceSnapshot = pricing.status === 'matched' ? pricing.catalogPriceSnapshot : null"), 'Missing/ambiguous recommendation must clear Catalog snapshot')
check(resolver.includes("status: 'matched'") && resolver.includes("status: 'product_missing' | 'price_missing' | 'ambiguous'"), 'H5 resolver contract drifted')
check(!cleanup.includes('h5InactiveFrontendContracts'), 'H6B must stop treating the now-reachable resolver as dormant')

const createStart = app.indexOf('async function createOrderFromDraft')
const createEnd = app.indexOf('\n  function ', createStart + 40)
const createFlow = app.slice(createStart, createEnd > createStart ? createEnd : app.length)
check(createFlow.includes("pricingMode: 'itemized_v1'"), 'H6B/H7 transition lost explicit itemized Create request')
check(createFlow.includes('unitPrice: item.unitPrice') && createFlow.includes('catalogPriceSnapshot: item.catalogPriceSnapshot ?? null'), 'H6B/H7 transition lost final price or Catalog snapshot payload')
check(createUi.includes('Цена продажи') && createUi.includes('Цена по каталогу'), 'H6B/H7 transition lost visible line pricing UI')

console.log('STAGE03-H6B/H7 PRICING TRANSITION PASSED — Catalog resolver state remains safe after Branch2 itemized Create activation, including explicit final price and historical recommendation snapshot')
