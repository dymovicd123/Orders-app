// Isolated SQLite integration regression for order-scoped customer names.
// No production/branch2 database access. Mirrors the actual metadata CAS SQL.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'

const worker=readFileSync('worker/domains/orders-write.ts','utf8')
const reader=readFileSync('worker/domains/orders-read.ts','utf8')
const clientReader=readFileSync('worker/domains/clients.ts','utf8')
const table=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const app=readFileSync('src/App.tsx','utf8')
assert(worker.includes('nextCustomerId = isolatedMetadataRequest ? null'), 'Metadata may not upsert shared customer identity')
assert(worker.includes('COALESCE(o.customer_name_override,c.display_name) AS customer_name'), 'Single order API must show override')
assert((reader.match(/COALESCE\(o\.customer_name_override,c\.display_name\) AS customer_name/g)||[]).length>=2,
  'Order list and debt list must show override')
assert(clientReader.includes('COALESCE(o.customer_name_override,c.display_name) AS customer_name'),
  'Client order history should reflect saved name')
assert(app.includes('metadataCorrection:{expected,next,expectedState}'), 'Frontend must transmit separate metadata fields')
assert(table.includes("customerName:String(order.customer_name||'').trim()"), 'Form should initialize from current order name')
for(const key of ['customerName','customerPhone','city','deliveryType','orderDate','comment']){
  assert(table.includes(key), 'Metadata field not wired: '+key)
}
assert(table.includes('priceHasInvalid||priceChanges.length===0'), 'Price input validation must remain')
assert(worker.includes('rawItemPriceCorrections.length!==1'), 'Linked-price exchange guard must remain')
assert(worker.includes('ORDER_RECORDED_PRICE_STALE'), 'Price CAS must remain')

const match=(regex,description)=>{
  const found=worker.match(regex)
  assert(found,description)
  return found[1]
}
const guard=match(/db\.prepare\(\`(SELECT json\('ORDER_METADATA_STALE'\)[\s\S]*?)\`\)\.bind\(id,m\.orderDate/, 'Real metadata CAS missing')
const insert=match(/db\.prepare\(\`(INSERT INTO customers[\s\S]*?)\`\)\.bind\(/,'New identity insert missing')
const update=match(/db\.prepare\(\`(UPDATE orders SET order_date=\?[\s\S]*?)\`\)\.bind\(p\.nextOrderDate/,'Scoped order update missing')
assert(!/UPDATE customers/.test(worker.slice(worker.indexOf('else if(p.isolatedMetadataRequest && p.metadataBefore)'),worker.indexOf('} else {\n        await orderUpdateStatement.run();'))), 'Shared customer changed in metadata transaction')
const db=new DatabaseSync(':memory:')
db.exec(`
CREATE TABLE managers(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE customers(id INTEGER PRIMARY KEY,phone_normalized TEXT NOT NULL UNIQUE,display_name TEXT,city TEXT,
  orders_count INTEGER NOT NULL DEFAULT 0,created_at TEXT,updated_at TEXT);
CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_date TEXT,manager_id INTEGER,customer_id INTEGER,
 city TEXT,delivery_type TEXT,comment TEXT,updated_at TEXT,total_amount INTEGER,received_amount INTEGER,
 debt_amount INTEGER,return_amount INTEGER,shipping_status TEXT,order_status TEXT);
CREATE VIRTUAL TABLE order_search_orders_fts USING fts5(order_id UNINDEXED,search_text,tokenize='trigram case_sensitive 1');
`)
db.exec(readFileSync('migrations/0112_v72_order_client_name_override.sql','utf8'))
const get=(id)=>db.prepare(`SELECT o.*,c.phone_normalized AS customer_phone,
 COALESCE(o.customer_name_override,c.display_name) AS customer_name
 FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=?`).get(id)
const textFor=(id)=>db.prepare('SELECT search_text FROM order_search_orders_fts WHERE rowid=?').get(id)?.search_text||''
const counts=()=>db.prepare('SELECT COUNT(*) AS n FROM customers').get().n
const seed=(id,cust,city='Алматы')=>db.prepare(`INSERT INTO orders
 (id,external_id,order_date,customer_id,city,delivery_type,comment,total_amount,received_amount,debt_amount,return_amount,shipping_status,order_status,updated_at)
 VALUES (?,?,?, ?,?,?,?,?,?,?,?,?,?,?)`).run(id,'ORD-'+id,'2026-10-17',cust,city,'Самовывоз','Исходный',20000,5000,15000,0,'not_sent','active','2026-10-17')
db.prepare("INSERT INTO customers(id,phone_normalized,display_name,city,created_at,updated_at) VALUES(1,'77001234567','СТАРОЕ ИМЯ','Алматы','2026-10-17','2026-10-17')").run()
seed(41,1); seed(42,1); seed(43,null)
const snap=(id)=>{const o=get(id);return [
 id,o.order_date,o.customer_id||0,o.customer_name||'',o.customer_phone||'',
 o.city||'',o.delivery_type||'',o.comment||'',
 o.total_amount,o.received_amount,o.debt_amount,o.return_amount,o.shipping_status||'',o.order_status||''
]}
function apply(id,name,phone,city='Астана',delivery='Курьер',comment='Новый комментарий',date='2026-10-17',expected=snap(id)){
 db.exec('BEGIN')
 try{
  db.prepare(guard).all(...expected)
  db.prepare(insert).run(phone,name||null,city||null,'2026-10-17','2026-10-17',phone)
  db.prepare(update).run(date,phone,phone,name,city||null,delivery||null,comment||null,'2026-10-17',id)
  db.exec('COMMIT')
 }catch(e){db.exec('ROLLBACK');throw e}
}
assert.equal(get(43).customer_name,null)
// Regression: name was lost if no phone, while city appeared.
apply(43,'ИМЯ БЕЗ ТЕЛЕФОНА','')
assert.equal(get(43).customer_name,'ИМЯ БЕЗ ТЕЛЕФОНА')
assert.equal(get(43).customer_phone,null)
assert.equal(get(43).city,'Астана')
assert.equal(get(43).delivery_type,'Курьер')
assert.equal(get(43).comment,'Новый комментарий')
assert.match(textFor(43),/ИМЯ БЕЗ ТЕЛЕФОНА/)
// Editing name under a shared phone cannot rename any other order.
apply(41,'ИМЯ ТОЛЬКО ЭТОГО ЗАКАЗА','77001234567')
assert.equal(get(41).customer_name,'ИМЯ ТОЛЬКО ЭТОГО ЗАКАЗА')
assert.equal(get(42).customer_name,'СТАРОЕ ИМЯ')
assert.equal(db.prepare('SELECT display_name FROM customers WHERE id=1').get().display_name,'СТАРОЕ ИМЯ')
assert.match(textFor(41),/ИМЯ ТОЛЬКО ЭТОГО ЗАКАЗА/)
assert.match(textFor(42),/СТАРОЕ ИМЯ/)
// Clearing one name must not expose the shared name again.
apply(41,'','77001234567')
assert.equal(get(41).customer_name,'')
assert.equal(get(42).customer_name,'СТАРОЕ ИМЯ')
assert(!textFor(41).includes('СТАРОЕ ИМЯ'))
// Adding a new phone creates a record without overwriting existing customers.
const before=counts()
apply(43,'НОВЫЙ КЛИЕНТ','77005551122')
assert.equal(get(43).customer_phone,'77005551122')
assert.equal(get(43).customer_name,'НОВЫЙ КЛИЕНТ')
assert.equal(counts(),before+1)
assert.match(textFor(43),/НОВЫЙ КЛИЕНТ/)
// Clearing phone preserves the current per-order name.
apply(43,'НОВЫЙ КЛИЕНТ','')
assert.equal(get(43).customer_phone,null)
assert.equal(get(43).customer_name,'НОВЫЙ КЛИЕНТ')
// Stale finance/metadata/shipping must fail without changing order or customers.
const prev=snap(43)
db.exec('UPDATE orders SET received_amount=6000 WHERE id=43')
assert.throws(()=>apply(43,'НЕ ДОЛЖНО СОХРАНИТЬСЯ','77009998877','Атырау','Почта','Плохо','2026-10-17',prev),/malformed JSON|ORDER_METADATA_STALE/)
assert.equal(get(43).customer_name,'НОВЫЙ КЛИЕНТ')
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM customers WHERE phone_normalized='77009998877'").get().n,0)
// Shared profile update must not override the order-specific name or its search index.
db.exec("UPDATE customers SET display_name='ИНОЕ ИМЯ' WHERE id=1")
assert.equal(get(41).customer_name,'')
assert.equal(get(42).customer_name,'ИНОЕ ИМЯ')
assert(!textFor(41).includes('ИНОЕ ИМЯ'))
assert.match(textFor(42),/ИНОЕ ИМЯ/)
db.close()
console.log('SCOPED_CUSTOMER_NAME_OPTIONAL_FIELDS_SHARED_CLIENT_CAS_FTS_PRICE_GUARDS_PASSED')
