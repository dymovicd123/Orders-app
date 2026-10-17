import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const write = readFileSync('worker/domains/orders-write.ts','utf8')
const worker = readFileSync('worker/index.ts','utf8')
const app = readFileSync('src/App.tsx','utf8')
const table = readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(write.includes('const recordedPriceOnlyRequest = rawItemPriceCorrections.length > 0'), 'Separate price-recording scope missing')
assert(write.includes("['requestId', 'itemPriceCorrections'].includes(field)"), 'Price-only API must refuse combined changes')
assert(write.includes("existingShippingStatus === 'sent' && !recordedPriceOnlyRequest"), 'Manager-only recorded-price correction must work after shipment')
assert(write.includes("existingPricingMode !== 'itemized_v1'"), 'Legacy price model must not be blindly rewritten')
assert(write.includes('expectedCatalogPriceSnapshot'), 'Historic catalog price snapshot is mandatory')
assert(write.includes("Цена или состав этой позиции уже изменились"), 'Stale row check missing')
assert(write.includes('activeTotal !== toInt(existingAny.total_amount, 0)'), 'Current itemized sum must be reconciled')
assert(write.includes("totals.receivedAmount > totals.totalAmount"), 'No silent negative finance correction')
assert(write.includes("stockReversals = (p.rewriteItems || p.deletingOrder)"), 'Stock must never reverse for price correction')
assert(write.includes("recordedPriceOnlyRequest && priceOnlyItemsEdit"), 'Dependent operations must be analyzed separately')
assert(write.includes('priceAudit:'), 'Old and new price must be audited')
assert(app.includes('async function correctRecordedOrderItemPrice('), 'Separate manager UI action absent')
assert(app.includes('itemPriceCorrections: [{'), 'Minimal request not constructed')
assert(!app.includes('function correctRecordedOrderItemPrice(') || app.includes('void loadDashboard()'), 'Corrected order should refresh')
assert(table.includes('Доп. действия') && table.includes('Исправить записанную цену'), 'Manager action menu missing')
assert(table.includes("{isAdmin && !retainedOnly && !archived ? ("), 'Delete UI must be admin only')
const route = worker.slice(worker.indexOf('const orderDeleteMatch ='),worker.indexOf('const orderMatch =',worker.indexOf('const orderDeleteMatch =')))
assert(route.includes('const denied = requireAdminUser(authUser)'), 'Delete API must check authenticated admin role')

// Extract and execute the exact downstream dependency guard SQL from runtime.
// An unrelated SKU correction is permitted even if the order has other returns/exchanges.
// Editing a SKU that has a return/exchange must be rejected.
const m=write.match(/const dependency = await db\.prepare\(\s*\`([\s\S]+?)\`\s*\)\.bind\(id, correction\.orderItemId, correction\.orderItemId, correction\.orderItemId,\s*id, correction\.orderItemId\)/)
assert(m, 'Live downstream dependency SQL not found')
const db=new DatabaseSync(':memory:')
db.exec([
'CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,old_order_item_id INTEGER,new_order_item_id INTEGER)',
'CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,role TEXT)',
'CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT)',
'CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER)',
].join(';')+';')
const check=(item)=>db.prepare(m[1]).get(42,item,item,item,42,item)
db.exec("INSERT INTO exchanges VALUES(100,42,'completed',10,11)")
db.exec("INSERT INTO exchange_items VALUES(200,100,12,'new')")
db.exec("INSERT INTO returns VALUES(300,42,'completed')")
db.exec("INSERT INTO return_items VALUES(400,300,13)")
assert.deepEqual(check(14), { exchange_link: 0, return_link: 0 }, 'Independent position must remain editable')
assert.equal(check(10).exchange_link,1,'Old exchange item must be protected')
assert.equal(check(11).exchange_link,1,'New exchange item must be protected')
assert.equal(check(12).exchange_link,1,'Set-exchange related position must be protected')
assert.equal(check(13).return_link,1,'Returned position must be protected')
db.exec("UPDATE exchanges SET status='cancelled' WHERE id=100")
db.exec("UPDATE returns SET status='cancelled' WHERE id=300")
assert.deepEqual(check(10),{exchange_link:0,return_link:0},'Cancelled operation must no longer block independent correction')
assert.deepEqual(check(13),{exchange_link:0,return_link:0},'Cancelled return must no longer block independent correction')
db.close()
console.log('RECORDED_PRICE_ONLY_MANAGER_SCOPE_AND_DEPENDENCIES_PASSED')
