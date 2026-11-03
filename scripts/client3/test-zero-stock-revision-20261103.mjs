import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {provisionClient3WatchSku} from '../../worker/domains/client3-watch-provision.ts'
import {startClient3WatchRevision,changeClient3WatchRevision} from '../../worker/domains/client3-watch-revision-session.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
for(const filename of fs.readdirSync('migrations').filter(s=>/^\d+.*\.sql$/.test(s)).sort())
 sqlite.exec(fs.readFileSync('migrations/'+filename,'utf8'))
if(!sqlite.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
 sqlite.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
for(const filename of fs.readdirSync('migrations/client3-watch').filter(s=>/^\d+.*\.sql$/.test(s)).sort())
 sqlite.exec(fs.readFileSync('migrations/client3-watch/'+filename,'utf8'))
const stmt=(query,args=[])=>({
 bind(...values){return stmt(query,values)},
 async first(){return sqlite.prepare(query).get(...args)||null},
 async all(){return {results:sqlite.prepare(query).all(...args)}},
 async run(){const r=sqlite.prepare(query).run(...args);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}},
})
const db={prepare:stmt,async batch(statements){
 sqlite.exec('SAVEPOINT watch_revision_test')
 try{
  const result=[]
  for(const row of statements)result.push(await row.run())
  sqlite.exec('RELEASE watch_revision_test')
  return result
 }catch(e){sqlite.exec('ROLLBACK TO SAVEPOINT watch_revision_test');sqlite.exec('RELEASE watch_revision_test');throw e}
}}
const parse=async promise=>{const response=await promise;return {status:response.status,...await response.json()}}
const admin={id:1,role:'admin',managerId:null,employeeRole:'Администратор'}
sqlite.prepare("INSERT OR IGNORE INTO managers(id,name) VALUES(1,'Revision tester')").run()
sqlite.prepare("INSERT INTO watch_products(id,brand_id,model_name,is_active) VALUES(900,1,'NEW EMPTY WATCH',1)").run()
sqlite.prepare("INSERT INTO watch_variants(id,watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color,is_active) VALUES(901,900,'male','quartz','steel','black','',1)").run()
const linked=await parse(provisionClient3WatchSku(db,admin,1,901))
assert.equal(linked.status,200,JSON.stringify(linked))
const cv=linked.canonicalVariantId
assert(cv>0)
const before=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_stock WHERE variant_id=?').get(cv)
assert.equal(before.n,0,'New watch SKU must have no physical stock entry')
const full=await parse(startClient3WatchRevision(db,admin,1,{source:'office',full:true}))
assert.equal(full.ok,true,JSON.stringify(full))
assert.equal(full.session.scope,'full')
assert.equal(full.session.totalItems,1,'Full revision must include stockless watches')
assert.equal(full.session.items[0].baselineQuantity,0)
assert.equal(full.session.items[0].stockId,null)
assert.equal(full.session.items[0].currentQuantity,0)
const item=full.session.items[0]
const counted=await parse(changeClient3WatchRevision(db,admin,1,'count',{
 sessionId:full.session.id,itemId:item.id,countedQuantity:7,
}))
assert.equal(counted.ok,true,JSON.stringify(counted))
assert.equal(counted.session.items[0].countedQuantity,7)
const finished=await parse(changeClient3WatchRevision(db,admin,1,'complete',{sessionId:full.session.id}))
assert.equal(finished.ok,true,JSON.stringify(finished))
assert.equal(finished.session.status,'completed')
const physical=sqlite.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=? AND inventory_source=?').get(cv,'warehouse')
assert.equal(physical.quantity,7,'Stocktake should create the missing physical record ONLY after confirmation')
assert.equal(physical.reserved_quantity,0)
const selective=await parse(startClient3WatchRevision(db,admin,1,{
 source:'showcase',full:false,modelIds:[900],
}))
assert.equal(selective.ok,true,JSON.stringify(selective))
assert.equal(selective.session.totalItems,1,'Selective check must include zero baseline at other point')
assert.equal(selective.session.items[0].baselineQuantity,0)
assert.equal(selective.session.items[0].stockId,null)
const countedZero=await parse(changeClient3WatchRevision(db,admin,1,'count',{
 sessionId:selective.session.id,itemId:selective.session.items[0].id,countedQuantity:0,
}))
assert.equal(countedZero.ok,true)
const finishZero=await parse(changeClient3WatchRevision(db,admin,1,'complete',{sessionId:selective.session.id}))
assert.equal(finishZero.ok,true,JSON.stringify(finishZero))
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_stock WHERE variant_id=? AND inventory_source=?').get(cv,'boutique').n,0,
 'Counting zero does not create physical stock unnecessarily')
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('Client3 zero-stock full/selective revision, persisted counts and completed stock adjustments PASS')
