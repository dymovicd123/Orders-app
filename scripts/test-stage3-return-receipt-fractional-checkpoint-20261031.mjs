import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { receiveReturnedItem } from '../worker/domains/returns-exchanges.ts'

// Real return/exchange received-item preflight through disposable SQLite D1.
// A later checkpoint needs confirmation; an earlier checkpoint must NOT
// be used to mark an unreceived item as already counted.
const sql=new DatabaseSync(':memory:')
sql.exec([
 "CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT)",
 "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,product_id INTEGER,variant_id INTEGER,audience_type TEXT,is_workshop INTEGER,source_type TEXT)",
 "CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT)",
 "CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity INTEGER,inventory_source TEXT,physical_tracking INTEGER,physical_received_at TEXT,created_at TEXT)",
 "CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT)",
 "CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,role TEXT,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity INTEGER,inventory_source TEXT,physical_tracking INTEGER,physical_received_at TEXT,created_at TEXT)",
 "CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,is_active INTEGER,name TEXT,category TEXT)",
 "CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT)",
 "CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,checked_at TEXT,expected_quantity INTEGER,counted_quantity INTEGER)",
 "INSERT INTO orders VALUES(21,'STAGE3-FRACTIONAL')",
 "INSERT INTO order_items VALUES(31,21,41,51,'ВЗРОСЛЫЙ',0,'warehouse')",
 "INSERT INTO returns VALUES(61,21,'completed')",
 "INSERT INTO return_items VALUES(71,61,31,'АЛАУ ЖИЛЕТ','ЖЕН','КРАСНЫЙ','СТАНДАРТ','СТАНДАРТ','46',1,NULL,1,NULL,'2026-10-31T09:00:00.100Z')",
 "INSERT INTO exchanges VALUES(62,21,'completed')",
 "INSERT INTO exchange_items VALUES(72,62,31,'old','АЛАУ ЖИЛЕТ','ЖЕН','КРАСНЫЙ','СТАНДАРТ','СТАНДАРТ','46',1,NULL,1,NULL,'2026-10-31T09:00:00.100Z')",
 "INSERT INTO catalog_products VALUES(41,1,'АЛАУ ЖИЛЕТ','adult')",
 "INSERT INTO catalog_variants VALUES(51,41,1,'adult','ЖЕН','КРАСНЫЙ','СТАНДАРТ','СТАНДАРТ','46')",
].join(';\n')+';')
let mutationCount=0
const db={prepare(statement){
  return {bind(...params){return {
    async first(){return sql.prepare(statement).get(...params)??null},
    async all(){return {results:sql.prepare(statement).all(...params)}},
    async run(){mutationCount++;throw Error('Premature mutation during physical freshness preflight')},
  }}}
}}
const check=sql.prepare('INSERT INTO inventory_stock_checks VALUES(?,?,?,?,?,?)')
const decision=(type,choice)=>receiveReturnedItem(db,{
 operationType:type,operationId:type==='return'?61:62,
 operationItemId:type==='return'?71:72,
 destination:'warehouse',...(choice?{freshnessDecision:choice}:{})
})
for(const type of ['return','exchange']){
 sql.exec('DELETE FROM inventory_stock_checks')
 check.run(81,'warehouse',51,'2026-10-31T09:00:00.450Z',4,5)
 const next=await decision(type)
 assert.equal(next.ok,false,type+': later same-second count needs operator disposition')
 assert.equal(next.code,'intake_freshness_confirmation_required')
 assert.equal(next.latestCheck.id,81)
 assert.equal(next.latestCheck.checkedAt,'2026-10-31T09:00:00.450Z')
 sql.exec("UPDATE inventory_stock_checks SET checked_at='2026-10-31T09:00:00.050Z' WHERE id=81")
 await assert.rejects(()=>decision(type,'already_counted'),/Свежая сверка больше не подтверждается/)
 sql.exec("UPDATE inventory_stock_checks SET checked_at='2026-10-31T09:00:00.100Z' WHERE id=81")
 const equal=await decision(type)
 assert.equal(equal.latestCheck.id,81,'Equal checkpoint intentionally uses >=: ask operator')
 sql.exec("UPDATE inventory_stock_checks SET checked_at='2026-10-31T09:00:00.350Z' WHERE id=81")
 check.run(82,'warehouse',51,'2026-10-31T09:00:00.650Z',5,6)
 const latest=await decision(type)
 assert.equal(latest.latestCheck.id,82,'Two same-second checkpoints must rank by milliseconds')
 assert.equal(latest.latestCheck.countedQuantity,6)
}
assert.equal(mutationCount,0,'All scenarios are read-only: no stock movement, phantom intake or money')
assert.equal(sql.prepare('SELECT physical_received_at FROM return_items WHERE id=71').get().physical_received_at,null)
assert.equal(sql.prepare('SELECT physical_received_at FROM exchange_items WHERE id=72').get().physical_received_at,null)
sql.close()
console.log('STAGE3_RETURN_EXCHANGE_FRACTIONAL_CHECKPOINT_PASS: millisecond later/earlier/equal/latest, no premature write')
