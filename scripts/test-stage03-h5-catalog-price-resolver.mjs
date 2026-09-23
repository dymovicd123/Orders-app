import fs from 'node:fs'
import ts from 'typescript'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const resolverSource = read('src/app/order-pricing.ts')
const typesSource = read('src/app/types.ts')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const app = read('src/App.tsx')

check(typesSource.includes('export type CatalogExecutionPriceRecord'), 'Catalog execution-price response type missing')
check(typesSource.includes('stockPositionId: number'), 'Catalog variant stockPositionId response type missing')
check(typesSource.includes('executionPrices?: CatalogExecutionPriceRecord[]'), 'CatalogResponse executionPrices type missing')
check(resolverSource.includes('export function resolveCatalogOrderSalePrice'), 'Pure order price resolver missing')
check(!resolverSource.includes('fetch(') && !resolverSource.includes('apiFetch('), 'H5 resolver must stay pure and make no network calls')
check(!resolverSource.includes('unitPrice =') && !resolverSource.includes('catalogPriceSnapshot ='), 'H5 resolver must not mutate order items')
const createStart = app.indexOf('async function createOrderFromDraft')
const createEnd = app.indexOf('\n  function ', createStart + 40)
const createFlow = app.slice(createStart, createEnd > createStart ? createEnd : app.length)
check(!createUi.includes('resolveCatalogOrderSalePrice'), 'H5 resolver must not be rendered/called by CreateOrderSection')
check(!createFlow.includes('pricingMode:') && createFlow.includes('unitPrice: 0,'), 'H5/H6B may prepare shadow pricing, but itemized Create request must remain inactive')

const utilsSource = read('src/app/utils.ts')
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const modules = new Map()
function loadVirtual(name, source) {
  const module = { exports: {} }
  modules.set(name, module)
  new Function('require', 'module', 'exports', transpile(source))((specifier) => {
    if (specifier === './utils') return loadVirtual('utils', utilsSource)
    if (specifier === './types') return {}
    if (specifier === './order-pricing') return loadVirtual('resolver', resolverSource)
    if (modules.has(specifier.replace('./',''))) return modules.get(specifier.replace('./','')).exports
    throw new Error('Unexpected import: ' + specifier)
  }, module, module.exports)
  return module.exports
}
const mod = loadVirtual('resolver', resolverSource)

const catalog = {
  ok: true,
  products: [
    { id: 1, name: 'Платье', category: 'adult', genderScope: 'female', isActive: true, variantsCount: 1, createdAt: '', updatedAt: '' },
    { id: 2, name: 'Детский костюм', category: 'child', genderScope: 'unisex', isActive: true, variantsCount: 1, createdAt: '', updatedAt: '' },
  ],
  productAliases: [{ rawValue: 'Платье вечернее', productId: 1, productName: 'Платье' }],
  variants: [],
  executionPrices: [
    { stockPositionId: 11, productId: 1, productName: 'Платье', material: 'ШЕЛК', length: 'МИДИ', category: 'adult', costPrice: 20000, salePrice: 40000, createdAt: '', updatedAt: '' },
    { stockPositionId: 12, productId: 1, productName: 'Платье', material: 'СТАНДАРТ', length: 'СТАНДАРТ', category: 'adult', costPrice: null, salePrice: 25000, createdAt: '', updatedAt: '' },
    { stockPositionId: 21, productId: 2, productName: 'Детский костюм', material: 'ХЛОПОК', length: 'СТАНДАРТ', category: 'child', costPrice: 12000, salePrice: 22000, createdAt: '', updatedAt: '' },
  ],
}

let result = mod.resolveCatalogOrderSalePrice(catalog, { productName: 'Платье', audienceType: 'ВЗРОСЛЫЙ', material: 'шелк', length: 'миди' })
check(result.status === 'matched' && result.salePrice === 40000 && result.catalogPriceSnapshot === 40000 && result.stockPositionId === 11, 'Exact adult execution price must resolve')

result = mod.resolveCatalogOrderSalePrice(catalog, { productName: 'Платье вечернее', audienceType: 'ВЗРОСЛЫЙ', material: 'шелк', length: 'миди' })
check(result.status === 'matched' && result.productId === 1 && result.salePrice === 40000, 'Known product alias must resolve to canonical price')

result = mod.resolveCatalogOrderSalePrice(catalog, { productName: 'Платье', audienceType: 'ВЗРОСЛЫЙ', material: '', length: '' })
check(result.status === 'matched' && result.salePrice === 25000, 'Empty material/length must use the existing СТАНДАРТ execution identity')

result = mod.resolveCatalogOrderSalePrice(catalog, { productName: 'Детский костюм', audienceType: 'ДЕТСКИЙ', material: 'ХЛОПОК', length: '' })
check(result.status === 'matched' && result.category === 'child' && result.salePrice === 22000, 'Child audience must use child execution price')

result = mod.resolveCatalogOrderSalePrice(catalog, { productName: 'Неизвестный', audienceType: 'ВЗРОСЛЫЙ', material: '', length: '' })
check(result.status === 'product_missing' && result.catalogPriceSnapshot === null, 'Unknown product must not invent a price')

result = mod.resolveCatalogOrderSalePrice(catalog, { productName: 'Платье', audienceType: 'ВЗРОСЛЫЙ', material: 'ЛЕН', length: 'МАКСИ' })
check(result.status === 'price_missing' && result.catalogPriceSnapshot === null, 'Missing execution price must stay NULL rather than zero')

const ambiguous = { ...catalog, executionPrices: [...catalog.executionPrices,
  { stockPositionId: 13, productId: 1, productName: 'Платье', material: 'ШЕЛК', length: 'МИДИ', category: 'adult', costPrice: null, salePrice: 41000, createdAt: '', updatedAt: '' },
] }
result = mod.resolveCatalogOrderSalePrice(ambiguous, { productName: 'Платье', audienceType: 'ВЗРОСЛЫЙ', material: 'ШЕЛК', length: 'МИДИ' })
check(result.status === 'ambiguous' && result.salePrice === null, 'Conflicting recommendations must fail closed')

console.log('STAGE03-H5 CATALOG PRICE RESOLVER PASSED — Catalog response types match the backend, product/execution/audience lookup is deterministic, missing/conflicting prices fail closed, and Create UI remains inactive')
