import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { recordWarehouseOperationAttempt, listWarehouseOperationAttempts } from '../worker/domains/inventory-attempts.ts'
import { buildStockVariantTimeline } from '../src/features/inventory/stockVariantTimelineModel.ts'

const sql = new DatabaseSync(':memory:')
sql.exec(readFileSync(new URL('../migrations/0118_v72_inventory_operation_attempts.sql', import.meta.url), 'utf8'))
sql.exec("CREATE TABLE inventory_stock (inventory_source TEXT,variant_id INTEGER,quantity INTEGER); INSERT INTO inventory_stock VALUES('warehouse',91,8);")
sql.exec("CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, inventory_source TEXT, variant_id INTEGER);")
class Statement {
  constructor(owner, text, args=[]) { this.owner=owner; this.text=text; this.args=args }
  bind(...args) { return new Statement(this.owner,this.text,args) }
  async all() { return {results:this.owner.prepare(this.text).all(...this.args)} }
  async run() { const r=this.owner.prepare(this.text).run(...this.args); return {success:true,meta:{changes:r.changes}} }
}
const db = { prepare: text=>new Statement(sql,text) }
const targets = [{source:'warehouse',variantId:91},{source:'boutique',variantId:91}]
await recordWarehouseOperationAttempt(db,{kind:'transfer',outcome:'rejected',requestId:'client-1',
  reasonCode:'warehouse_stock_stale',message:'Сверьте остаток перед действием.',actorId:8,actor:'Завсклад',
  targets:[...targets,...targets]})
const url=(source,beforeId=0)=>new URL('https://test.invalid/api/inventory/operation-attempts?source='+source+'&variantId=91'+(beforeId?'&beforeId='+beforeId:''))
let warehouse=await listWarehouseOperationAttempts(db,url('warehouse'))
let boutique=await listWarehouseOperationAttempts(db,url('boutique'))
assert.equal(warehouse.attempts.length,1,'Dedup same variant/source within one HTTP event')
assert.equal(boutique.attempts.length,1,'Transfer attempt is present in both site histories')
assert.equal(warehouse.attempts[0].reasonCode,'warehouse_stock_stale')
assert.equal(warehouse.attempts[0].actorUserId,8)
assert.equal(warehouse.attempts[0].outcome,'rejected')
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock').get().quantity,8,'Attempt never mutates physical')
assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM inventory_movements').get().count,0,'Rejected attempt cannot create movement')
await recordWarehouseOperationAttempt(db,{kind:'transfer',outcome:'uncertain',requestId:'client-2',
  reasonCode:'warehouse_write_failed',message:'Подтверждение не получено: проверьте историю.',
  targets:[{source:'warehouse',variantId:91}]})
await recordWarehouseOperationAttempt(db,{kind:'manual_set',outcome:'replayed',requestId:'client-3',
  reasonCode:'same_request',message:'Запрос повторился; нового движения нет.',
  targets:[{source:'warehouse',variantId:91}]})
warehouse=await listWarehouseOperationAttempts(db,url('warehouse'))
assert.deepEqual(warehouse.attempts.map(r=>r.outcome),['replayed','uncertain','rejected'])
assert.equal(boutique.attempts[0].outcome,'rejected','No crossover between sources')
assert.deepEqual(buildStockVariantTimeline([],[], 'warehouse',91,warehouse.attempts).events.map(e=>e.kind),
  ['attempt','attempt','attempt'],'Attempts are a separate nonphysical timeline event type')
const wrong=await listWarehouseOperationAttempts(db,new URL('https://test.invalid/api/inventory/operation-attempts?source=boutique&variantId=92'))
assert.equal(wrong.attempts.length,0,'No leakage across unrelated SKU')
const invalid=await listWarehouseOperationAttempts(db,new URL('https://test.invalid/api/inventory/operation-attempts?source=warehouse'))
assert.equal(invalid.ok,false,'Must supply one exact source and SKU')
for(let i=0;i<36;i++) {
  await recordWarehouseOperationAttempt(db,{kind:'arrival',outcome:'rejected',requestId:'page-'+i,
    reasonCode:'warehouse_variant_missing',message:'Старый вариант не найден.',
    targets:[{source:'warehouse',variantId:91}]})
}
warehouse=await listWarehouseOperationAttempts(db,url('warehouse'))
assert.equal(warehouse.attempts.length,30)
assert.equal(warehouse.hasMore,true)
const old=await listWarehouseOperationAttempts(db,url('warehouse',warehouse.nextBeforeId))
assert.equal(old.attempts.length,9,'Pagination contains every independent attempt')
assert.equal(old.hasMore,false)
assert.equal(new Set([...warehouse.attempts,...old.attempts].map(e=>e.id)).size,39)
const index=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8')
const section=readFileSync(new URL('../src/features/sections/InventorySection.tsx',import.meta.url),'utf8')
const timeline=readFileSync(new URL('../src/features/inventory/views/StockVariantTimeline.tsx',import.meta.url),'utf8')
assert.ok(index.includes("safelyRecordWarehouseAttempt(env.DB, {"))
assert.ok(index.includes("safe.status === 409 || safe.status === 400 ? 'rejected' : 'uncertain'"))
assert.ok(index.includes("result.duplicate) await attempt('replayed'"))
assert.ok(index.includes("listWarehouseOperationAttempts(env.DB, url)"))
assert.ok(section.includes('requestId !== historyRequestRef.current'))
assert.ok(section.includes('loadMoreHistoryAttempts'))
assert.ok(timeline.includes("event.kind === 'attempt'"))
assert.ok(timeline.includes('не складское движение'))
assert.ok(timeline.includes('Результат запроса не подтверждён'))
assert.ok(timeline.includes('loadMoreAttempts'))
console.log('STAGE4_ATTEMPT_JOURNAL_SQL_UI_PASS: source isolation, outcome, actor, nonphysical, paging, replay and unknown outcomes')
