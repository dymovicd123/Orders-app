import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { previewAdminOrderDeletion } from '../worker/domains/order-delete-preview.ts'

const dbsqlite=new DatabaseSync(':memory:')
dbsqlite.exec([
 "CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_status TEXT,shipping_status TEXT,received_amount INTEGER,return_amount INTEGER)",
 "CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,refund_return_id INTEGER,old_order_item_id INTEGER,new_order_item_id INTEGER)",
 "CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,amount INTEGER)",
 "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,unit_price INTEGER)",
 "CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,role TEXT)",
 "CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER)",
 "CREATE TABLE critical_operations(id INTEGER PRIMARY KEY,operation_type TEXT,target_type TEXT,target_id INTEGER)",
 "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER)",
 "CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,quantity INTEGER)",
].join(';')+';')
let writes=0
const db={prepare(query) {
 if(!query.trim().toUpperCase().startsWith('SELECT'))throw Error('Read-only preview attempted a write')
 let params=[]
 return {
  bind(...a){params=a;return this},
  async first(){return dbsqlite.prepare(query).get(...params)??null},
  async all(){return {results:dbsqlite.prepare(query).all(...params)}},
  async run(){writes++;throw Error('Preview must never run a mutating statement')},
 }
}}
dbsqlite.exec("INSERT INTO orders VALUES(42,'ORD-42','active','not_sent',0,0)")
let preview=await previewAdminOrderDeletion(db,42)
assert.equal(preview.canAttemptDelete,true)
assert.equal(preview.requiresPhysicalFact,false)
assert.deepEqual(preview.activeExchanges,[])
assert.deepEqual(preview.activeReturns,[])
assert.equal(writes,0)

dbsqlite.exec("INSERT INTO payments VALUES(1,42,65000)")
dbsqlite.exec("UPDATE orders SET received_amount=65000 WHERE id=42")
preview=await previewAdminOrderDeletion(db,42)
assert.equal(preview.registeredPayments,65000)
assert.equal(preview.paymentCount,1)
assert(preview.explanations.some(s=>s.includes('65'+'000')),'Payment disclosure must be explicit')
dbsqlite.exec("INSERT INTO exchanges VALUES(100,42,'completed',NULL,1,2)")
dbsqlite.exec("INSERT INTO exchanges VALUES(101,42,'cancelled',NULL,1,2)")
dbsqlite.exec("INSERT INTO returns VALUES(200,42,'completed',5000)")
dbsqlite.exec("INSERT INTO returns VALUES(201,42,'cancelled',1000)")
preview=await previewAdminOrderDeletion(db,42)
assert.equal(preview.canAttemptDelete,false,'Cannot execute partial chain cancellation')
assert.deepEqual(preview.activeExchanges,[100])
assert.deepEqual(preview.activeReturns,[200])
assert.equal(preview.recordedRefunds,5000)
assert(preview.reasons.some(s=>s.includes('действующие обмены')||s.includes('действующие')),'Must explain blocked dependency')
dbsqlite.exec("UPDATE exchanges SET status='cancelled' WHERE id=100")
dbsqlite.exec("UPDATE returns SET status='cancelled' WHERE id=200")
preview=await previewAdminOrderDeletion(db,42)
assert.equal(preview.canAttemptDelete,true,'Simple unlinked order should remain removable')
assert.equal(preview.recordedRefunds,0)
dbsqlite.exec("INSERT INTO inventory_reservations VALUES(10,42,'fulfilled',1)")
preview=await previewAdminOrderDeletion(db,42)
assert.equal(preview.requiresPhysicalFact,true,'Item-level physical handover must be disclosed')
assert.equal(preview.issuedQuantity,1)
dbsqlite.exec("UPDATE orders SET shipping_status='sent' WHERE id=42")
assert.equal((await previewAdminOrderDeletion(db,42)).requiresPhysicalFact,true)
dbsqlite.exec("UPDATE orders SET order_status='archived' WHERE id=42")
assert.equal((await previewAdminOrderDeletion(db,42)).canAttemptDelete,false)
await assert.rejects(()=>previewAdminOrderDeletion(db,0),/Укажите/)
await assert.rejects(()=>previewAdminOrderDeletion(db,999),/не найден/)
assert.equal(writes,0)
assert.equal(dbsqlite.prepare("SELECT COUNT(*) AS n FROM exchanges WHERE status='completed'").get().n,0)

// Static gate for real POST: dependencies before any refund, physical,
// archived restore or destructive update. Old non-atomic auto-cancel paths gone.
const deletion=readFileSync('worker/domains/order-delete.ts','utf8')
const init=deletion.indexOf('const deletionPreview=await previewAdminOrderDeletion(db,orderId)')
assert(init>0)
assert(init<deletion.indexOf('const humanInventoryModelEnabled ='),'Dependency blocker runs before physical mutation')
assert(deletion.includes('if(!deletionPreview.canAttemptDelete)'))
assert(!deletion.includes('await cancelExchange(db, exchangeId'))
assert(!deletion.includes('await cancelReturn(db, returnId'))
assert(deletion.includes("orderStatus: 'deleted'"),'Standalone safe delete still works')
const worker=readFileSync('worker/index.ts','utf8')
const route=worker.slice(worker.indexOf('const orderDeletePreviewMatch ='),worker.indexOf('const orderDeleteMatch ='))
assert(route.includes("request.method === 'GET'"))
assert(route.includes('requireAdminUser(authUser)'))
assert(worker.slice(worker.indexOf('const orderDeleteMatch =')).includes('requireAdminUser(authUser)'))
const app=readFileSync('src/App.tsx','utf8')
assert(app.includes('previewAcknowledged = false'))
assert(app.includes('if (!previewAcknowledged || !/^[0-9a-f]{64}$/.test(expectedSnapshot)) return false'))
assert(app.includes('/delete-preview'))
const table=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(table.includes('adminDeleteDraft.preview?.canAttemptDelete'))
assert(table.includes('loadAdminOrderDeletePreview(order)'))
assert(table.includes('deleteOrderAsAdmin(adminDeleteDraft.order,true,adminDeleteDraft.preview.chainPlan.snapshotFingerprint)'))
assert(table.includes('{isAdmin && !retainedOnly && !archived ? ('))
console.log('ADMIN_ORDER_DELETE_READ_ONLY_PREVIEW_AND_NO_PARTIAL_LINKED_OPERATIONS_PASSED')
