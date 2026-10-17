// Regression for lightweight batch-price and clear admin delete preview UX.
// This does not replace live D1 backend money/stock/CAS tests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const app=readFileSync('src/App.tsx','utf8')
const table=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const write=readFileSync('worker/domains/orders-write.ts','utf8')
const deletePreview=readFileSync('worker/domains/order-delete-preview.ts','utf8')

assert(app.includes('async function correctRecordedOrderItemPrices('))
const start=app.indexOf('async function correctRecordedOrderItemPrices(')
const end=app.indexOf('type RetiredExchangePriceOption',start)
const handler=app.slice(start,end)
assert(handler.includes('itemPriceCorrections: changes.map'), 'All edited lines must be submitted in ONE request')
assert(handler.includes('expectedCatalogPriceSnapshot: item.catalogPriceSnapshot ?? null'), 'Historical snapshot CAS is mandatory')
assert(handler.includes('expectedUnitPrice: Number(item.unitPrice || 0)'), 'Old unit price must be carried')
assert(handler.includes('expectedQuantity: Number(item.quantity || 0)'), 'Old quantity must be carried')
assert(handler.includes('expectedLineTotal: Number(item.lineTotal || 0)'), 'Old line total must be carried')
assert(handler.includes("method: 'PATCH'")&&handler.includes('prepareCriticalRequest(criticalKey, payload)'), 'Atomic batch idempotency must remain')
assert(!handler.includes('inventoryStock')&&!handler.includes('stockCorrection')&&!handler.includes('payments:'), 'Batch request must not change money or stock')
assert((app.match(/correctRecordedOrderItemPrices, loadRetiredExchangePriceOptions/g)||[]).length===2,
  'Batch action must be supplied in both regular and Kaspi order list contexts')

assert(table.includes('priceChanges.length===1'), 'Single linked line must use the existing safe legacy action')
assert(table.includes('await correctRecordedOrderItemPrices(priceDraft.order,priceChanges)'), 'Batch must use one server request')
assert(table.includes('priceItems.map((item:any)=>'), 'Every active order line must have an input')
assert(table.includes('Разница по заказу:'), 'Price delta must be shown before submission')
assert(table.includes('priceHasInvalid||priceChanges.length===0'), 'No invalid or empty edits')
assert(table.includes('Если цена позиции связана с обменом, исправьте её отдельно.'), 'Communicate active exchange restriction')
assert(table.includes('Обмены и возвраты товаров'), 'The complete dependent operation list must be visible')
assert(table.includes('Нужно уточнение перед удалением'))
const modal=table.slice(table.indexOf('{adminDeleteDraft ? ('),table.indexOf('{exchangeChainDraft ? ('))
assert(modal.includes('adminDeleteDraft.preview?.canStartChain') && modal.includes('adminDeleteDraft.preview?.canAttemptDelete'), 'Only safe previews can expose direct or chained delete')
assert(modal.includes('deleteOrderAsAdmin('), 'Permitted delete still calls real admin-only flow')
assert(deletePreview.includes('canAttemptDelete:!hasChain&&reasons.length===0'), 'Direct delete blockers must remain server-derived')

// Extract and execute actual live linked-line dependency SQL. Independent items
// remain available as an atomic batch, linked exchange lines cannot be bundled.
const match=write.match(/const dependency = await db\.prepare\(\s*`([\s\S]+?)`\s*\)\.bind\(id, correction\.orderItemId, correction\.orderItemId, correction\.orderItemId,\s*id, correction\.orderItemId,\s*id, correction\.orderItemId\)/)
assert(match,'Production linked-line guard missing')
assert(write.includes('rawItemPriceCorrections.length!==1'), 'Linked exchange pricing must remain single-line only')
const db=new DatabaseSync(':memory:')
db.exec("CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,old_order_item_id INTEGER,new_order_item_id INTEGER,refund_return_id INTEGER);CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,role TEXT);CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT);CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER);")
db.exec("INSERT INTO exchanges VALUES(50,42,'completed',11,12,NULL);INSERT INTO exchange_items VALUES(1,50,12,'new');")
const dependent=(id)=>db.prepare(match[1]).get(42,id,id,id,42,id,42,id)
assert.equal(dependent(101).exchange_link,0)
assert.equal(dependent(102).exchange_link,0)
assert.equal(dependent(11).exchange_link,1)
assert.equal(dependent(12).exchange_link,1)
db.close()
console.log('ADMIN_PRICE_BATCH_AND_READ_ONLY_DELETE_PREVIEW_UX_GUARDS_PASSED')
