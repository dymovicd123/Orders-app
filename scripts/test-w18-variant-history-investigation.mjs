import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { listInventoryCheckHistory } from '../worker/domains/inventory-stocktake.ts'
class Statement{
  constructor(owner,sql,args=[]){this.owner=owner;this.sql=sql;this.args=args}
  bind(...args){return new Statement(this.owner,this.sql,args)}
  async all(){return {results:this.owner.db.prepare(this.sql).all(...this.args)}}
  async first(){return this.owner.db.prepare(this.sql).get(...this.args)??null}
}
class TestD1{
  constructor(){this.db=new DatabaseSync(':memory:')}
  prepare(sql){return new Statement(this,sql)}
}
const d1=new TestD1()
d1.db.exec(`CREATE TABLE inventory_stock_checks(
 id INTEGER PRIMARY KEY AUTOINCREMENT,variant_id INTEGER,inventory_source TEXT,
 check_type TEXT,reference_type TEXT,reference_id TEXT,expected_quantity INTEGER,
 counted_quantity INTEGER,difference_quantity INTEGER,checked_by TEXT,checked_at TEXT
)`)
const insert=d1.db.prepare(`INSERT INTO inventory_stock_checks
 (variant_id,inventory_source,check_type,reference_type,reference_id,expected_quantity,
 counted_quantity,difference_quantity,checked_by,checked_at)
 VALUES(?,?,?,?,?,?,?,?,?,?)`)
for(let i=1;i<=70;i++){
  const count=(i===8)?3:(i===63)?6:5
  insert.run(55,'warehouse','selective_stocktake','stocktake','REV-'+i,5,count,count-5,'Менеджер',
    '2026-10-'+String(Math.ceil(i/4)).padStart(2,'0')+'T'+String(i%24).padStart(2,'0')+':00:00')
}
insert.run(55,'boutique','selective_stocktake','stocktake','B1',8,4,-4,'Менеджер','2026-10-01T00:00:00')
insert.run(56,'warehouse','selective_stocktake','stocktake','V56',10,0,-10,'Менеджер','2026-10-01T00:00:00')
const url=(extra='')=>new URL('https://test.invalid/api/inventory/check-history?source=warehouse&variantId=55&limit=50'+extra)
const first=await listInventoryCheckHistory(d1,url())
assert.equal(first.ok,true)
assert.equal(first.rows.length,50)
assert.equal(first.hasMore,true)
assert.equal(first.totalChecks,70)
assert.equal(first.differenceCount,2)
assert.equal(first.firstConfirmedDifference?.id,'8',
  'Earliest discrepancy is from ALL checks, not the initial 50 most recent')
assert.equal(first.firstConfirmedDifference?.expectedQuantity,5)
assert.equal(first.firstConfirmedDifference?.countedQuantity,3)
assert.equal(first.lastMatchingBeforeDifference?.id,'7')
assert.equal(first.rows[0].id,'70')
assert.equal(first.rows[49].id,'21')
const older=await listInventoryCheckHistory(d1,url('&beforeId='+first.nextBeforeId))
assert.deepEqual(older.rows.map(r=>Number(r.id)),Array.from({length:20},(_,i)=>20-i))
assert.equal(older.hasMore,false)
assert.equal(older.totalChecks,70)
assert.equal(older.firstConfirmedDifference?.id,'8')
const noDifference=await listInventoryCheckHistory(d1,
  new URL('https://test.invalid/api/inventory/check-history?source=boutique&variantId=56'))
assert.equal(noDifference.firstConfirmedDifference,null)
assert.equal(noDifference.totalChecks,0)
const otherLocation=await listInventoryCheckHistory(d1,
  new URL('https://test.invalid/api/inventory/check-history?source=boutique&variantId=55'))
assert.equal(otherLocation.firstConfirmedDifference?.referenceId,'B1')
assert.equal(otherLocation.totalChecks,1)

const section=fs.readFileSync('src/features/sections/InventorySection.tsx','utf8')
const view=fs.readFileSync('src/features/inventory/views/StockVariantTimeline.tsx','utf8')
const frontend=fs.readFileSync('src/App.tsx','utf8')
assert.match(frontend,/input\.beforeId\) params\.set\('beforeId'/)
assert.match(section,/loadMoreHistoryChecks\(\)/)
assert.match(section,/setHistoryCheckHasMore\(Boolean\(older\?\.hasMore\)\)/)
assert.match(section,/setHistoryCheckEvidence\(checks\)/)
assert.match(view,/firstConfirmedDifference/)
assert.match(view,/lastMatchingBeforeDifference/)
assert.match(view,/Показать более ранние сверки/)
assert.match(view,/Это день <b>обнаружения<\/b>/)
assert.match(view,/проведённые/)
assert.match(view,/отклонённые попытки/i)
console.log('W18 HISTORY PASSED: real SQL paging, global first mismatch, prior confirmed matching count, branch/source isolation and frontend controls')
