import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const panel = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const groups = read('src/features/inventory/views/catalogPolishExecutionGroups.tsx')
const css = read('src/styles/w9-warehouse-catalog-cleanup.css')
const wrangler = read('wrangler.jsonc')

const isBranch2Environment =
  wrangler.includes('"name": "orders-app-branch2"') &&
  wrangler.includes('"database_name": "orders_db_branch2"') &&
  wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"') &&
  !wrangler.includes('orders_db_prod') &&
  !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4')
const isProductionEnvironment =
  wrangler.includes('"name": "orders-app"') &&
  wrangler.includes('"database_name": "orders_db_prod"') &&
  wrangler.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"') &&
  !wrangler.includes('orders_db_branch2') &&
  !wrangler.includes('40065052-854e-44b8-bcd5-251bdd488301')
check(isBranch2Environment || isProductionEnvironment, 'Stage03-C requires one coherent known environment; Branch2 and Production bindings must never mix')

check(panel.includes('executionPrices={(catalogData as any)?.executionPrices || []}'), 'Catalog price rows must flow into the execution UI')

check(groups.includes("{isAdmin ? (() => {"), 'Commercial price editor must remain admin-only')
check(groups.includes("(['adult', 'child'] as const).filter"), 'Price editor must derive only existing adult/child scopes')
check(groups.includes('variant.stockPositionId'), 'Price editor must target canonical execution identity')
check(!groups.includes("variant.gender ||") || !groups.includes("priceKey(stockPositionId, variant.gender"), 'Gender must not become a price key')
check(!groups.includes("priceKey(stockPositionId, color"), 'Color must not become a price key')
check(!groups.includes("priceKey(stockPositionId, size"), 'Size/age must not become a price key')

check(groups.includes("fetch('/api/catalog/execution-prices'"), 'Price editor must use the bounded Stage03 backend route')
check(groups.includes("method: 'PUT'"), 'Price save must use full-pair PUT semantics')
check(groups.includes('JSON.stringify({ stockPositionId, category, costPrice, salePrice })'), 'Price save must submit the complete pair')
check(groups.includes("credentials: 'include'"), 'Price save must preserve authenticated admin session')
check(groups.includes('type="number"') && groups.includes('min="0"') && groups.includes('step="1"'), 'Price inputs must constrain whole non-negative KZT')
check(groups.includes('placeholder="Не указана"'), 'Unset price must stay visibly distinct from zero')
check(groups.includes('Нажмите «Обновить» и проверьте цены перед повторным сохранением'), 'Ambiguous network results must not invite blind repeat writes')

check(!groups.includes('/api/orders') && !groups.includes('unitPrice'), 'Stage03-C must not add order-price autofill yet')
check(!groups.includes('discount') && !groups.includes('скидк'), 'Stage03-C must not invent discount behavior')

check(css.includes('.catalog-execution-prices') && css.includes('.catalog-execution-price-row'), 'Stage03-C price editor styling missing')
check(css.includes('@media (max-width: 760px)') && css.includes('@media (max-width: 440px)'), 'Stage03-C price editor must remain phone-safe')

console.log('STAGE03-C CATALOG PRICE UI PASSED — admin-only execution+audience prices, safe full-pair save, nullable values, responsive UI, no order autofill')
