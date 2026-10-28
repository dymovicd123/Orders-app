import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const source=readFileSync('worker/domains/returns-exchanges.ts','utf8')
const view=readFileSync('src/features/sections/OrderExchangeSmartSection.tsx','utf8')
const css=readFileSync('src/styles/193-exchange-set-v2.css','utf8')
const client=readFileSync('src/App.tsx','utf8')
assert.match(source,/const returnItemClaim = /)
assert.match(source,/SELECT \$\{targetIdSql\},/)
assert.match(source,/AND oi\.quantity >= \?/)
assert.match(source,/CASE WHEN changes\(\) = 1 THEN last_insert_rowid\(\) ELSE NULL END/)
assert.match(source,/createStatements\.push\(returnItemClaim\(validated, null\), returnItemClaimMapping\(index\)\)/)
assert.match(source,/createStatements\.push\(refundMoneyEventStatement/)
assert(source.indexOf('createStatements.push(returnItemClaim(validated, null)') < source.indexOf('createStatements.push(refundMoneyEventStatement'))
assert.match(source,/await db\.batch\(\[returnItemClaim\(validated, returnId\), returnItemClaimMapping\(itemIndex\)\]\)/)
assert.match(source,/claimConflict\(error\)/)
const end=source.indexOf('  const returnItemClaimMapping')
const start=source.indexOf('const returnItemClaim = ')
assert(start>=0 && end>start)
const snippet=source.slice(start,end)
const rawSQL=snippet.match(/`(INSERT INTO return_items \([\s\S]*?)`\s*\)\.bind\(/)?.[1]
assert(rawSQL,'Return insert guard query must be extractable')
const exclusion=source.match(/export const noStandaloneReturnSql = `([\s\S]*?)`;/)?.[1]
assert(exclusion,'Standalone money-exchange exclusion must exist')
const sql=rawSQL.replace('${targetIdSql}','?').replace('${noStandaloneReturnSql}',exclusion)
assert(!sql.includes('${'),'No unresolved query interpolation in test')
assert.match(sql,/NOT EXISTS \(/)
assert.match(sql,/COALESCE\(r\.status, 'completed'\) <> 'cancelled'/)

const mappingSQL=`INSERT INTO critical_operation_entities(request_id,entity_type,entity_key,entity_id,created_at)
 VALUES (?, 'return_item', ?, CASE WHEN changes() = 1 THEN last_insert_rowid() ELSE NULL END, ?)`
const db=new DatabaseSync(':memory:')
db.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER);
CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER,status TEXT);
CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER,product_name_snapshot TEXT,quantity INTEGER,amount INTEGER,inventory_source TEXT,restocked INTEGER,physical_tracking INTEGER,physical_received_at TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,created_at TEXT);
CREATE TABLE exchanges(id INTEGER PRIMARY KEY,refund_return_id INTEGER,status TEXT);
CREATE TABLE critical_operations(request_id TEXT PRIMARY KEY,target_id INTEGER);
CREATE TABLE critical_operation_entities(request_id TEXT,entity_type TEXT,entity_key TEXT,entity_id INTEGER NOT NULL,created_at TEXT,PRIMARY KEY(request_id,entity_type,entity_key));
CREATE TABLE money_events(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER);
INSERT INTO order_items VALUES (1,42,3),(2,42,1);
`)
const param=(itemId,quantity,requestId,returnId)=>[
 returnId,itemId,'ШАРФ',quantity,0,'warehouse',1,null,'ЖЕН','КРАСНЫЙ','СТАНДАРТ','СТАНДАРТ','СТАНДАРТ','2026-10-28T00:00:00Z',
 itemId,42,quantity,42,itemId
]
function returnTransaction(requestId, lines, amount) {
 db.exec('BEGIN IMMEDIATE')
 try {
  db.prepare('INSERT INTO critical_operations (request_id) VALUES (?)').run(requestId)
  const result=db.prepare("INSERT INTO returns(order_id,amount,status) VALUES(42,?,'completed')").run(amount)
  const returnId=Number(result.lastInsertRowid)
  db.prepare('UPDATE critical_operations SET target_id=? WHERE request_id=?').run(returnId,requestId)
  for(let i=0;i<lines.length;i++){
   const [itemId,quantity]=lines[i]
   db.prepare(sql).run(...param(itemId,quantity,requestId,returnId))
   db.prepare(mappingSQL).run(requestId,`return:item:${i+1}`,'2026-10-28T00:00:00Z')
  }
  if(amount)db.prepare('INSERT INTO money_events(order_id,amount) VALUES(42,?)').run(amount)
  db.exec('COMMIT')
  return returnId
 }catch(error){
  db.exec('ROLLBACK')
  if(error.message.includes('NOT NULL constraint failed')) return null
  throw error
 }
}
const aRead=3,bRead=3
assert.equal(aRead,bRead,'Two requests can both pass the old optimistic preflight')
assert(returnTransaction('a',[[1,2]],500))
assert.equal(returnTransaction('b',[[1,2]],700),null,'Second preflight must roll back entire operation')
assert.deepEqual(db.prepare('SELECT SUM(quantity) AS q FROM return_items').get().q,2)
assert.equal(db.prepare('SELECT SUM(amount) AS q FROM money_events').get().q,500)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM returns').get().n,1)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM critical_operation_entities').get().n,1)
assert(returnTransaction('c',[[1,1]],0),'Remaining third unit may return normally')
assert.equal(returnTransaction('d',[[1,1]],0),null,'No fourth return')
assert.equal(db.prepare('SELECT SUM(quantity) AS q FROM return_items').get().q,3)
assert.equal(returnTransaction('e',[[2,1],[1,1]],250),null,'Second invalid row must roll back valid first row AND money')
assert.equal(db.prepare('SELECT SUM(quantity) AS q FROM return_items WHERE order_item_id=2').get().q,null)
assert.equal(db.prepare('SELECT SUM(amount) AS q FROM money_events').get().q,500)
db.close()

const position=view.indexOf('className="exchange-new-details"')
const ship=view.indexOf('className={`exchange-shipment-choice')
const prices=view.indexOf('className="exchange-new-price"')
assert(position>=0 && ship>position && ship<prices,'Shipment selector follows characteristics and precedes price')
assert.match(view,/exchangeFormRef\.current\?\.scrollIntoView/)
assert.match(view,/exchangeSelectedOrder\?\.id, exchangeFormRef/)
assert.match(view,/aria-pressed=\{item\.shipmentState === 'sent'\}/)
assert.match(view,/aria-pressed=\{item\.shipmentState === 'pending'\}/)
assert.match(css,/exchange-shipment-choice\.needs-choice/)
assert.match(css,/border:2px solid #93c5fd/)
assert.match(client,/setExchangeSelectedOrderId\(order\.id\)/)
console.log('BRANCH2_PARTIAL_RETURN_ATOMIC_AND_EXCHANGE_NAV_UI_PASS')
