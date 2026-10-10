import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { businessMonthRange,previewUserSelectedReferenceMerge } from '../worker/domains/reference-merge-preview.ts'
import { applyPaymentMethodMerge } from '../worker/domains/reference-payment-merge.ts'

const db0 = new DatabaseSync(':memory:')
db0.exec(`
 PRAGMA foreign_keys=ON;
 CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER,updated_at TEXT DEFAULT 'seed');
 CREATE TABLE orders(id INTEGER PRIMARY KEY,order_date TEXT,order_status TEXT,order_payment_method TEXT);
 CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,payment_date TEXT,method TEXT,amount INTEGER);
 CREATE TABLE financial_events(id INTEGER PRIMARY KEY,order_id INTEGER,event_date TEXT,payment_method TEXT,amount_delta INTEGER);
 CREATE TABLE cash_register_entries(id INTEGER PRIMARY KEY,order_id INTEGER,payment_method TEXT,amount INTEGER DEFAULT 0);
 CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,return_date TEXT,payment_method TEXT,amount INTEGER);
 CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,exchange_date TEXT,payment_method TEXT,financial_amount INTEGER);
 CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,is_active INTEGER,color TEXT,material TEXT,length TEXT,category TEXT,size_label TEXT);
 INSERT INTO reference_values(id,kind,value,is_active) VALUES
  (1,'payment_method','ТЕРМИНАЛ',1),(2,'payment_method','KASPI PAY',1),
  (3,'payment_method','НАЛИЧНЫЕ',1),(4,'payment_method','КАСПИ МАГАЗИН',1),
  (5,'payment_method','ХАЛЫК ПЕРЕВОД',1);
 INSERT INTO orders VALUES(10,'2026-10-09','active','ТЕРМИНАЛ'),
  (11,'2026-09-09','closed','ТЕРМИНАЛ'),
  (12,'2026-10-11','active',NULL),
  (13,'2026-10-10','active','KASPI PAY'),
  (14,'2026-10-12','deleted','ТЕРМИНАЛ');
 INSERT INTO payments VALUES
  (20,10,'2026-10-09','ТЕРМИНАЛ',100),
  (21,11,'2026-09-09','ТЕРМИНАЛ',210),
  (22,12,'2026-10-11','ТЕРМИНАЛ',300),
  (23,13,'2026-10-10','KASPI PAY',400),
  (24,14,'2026-10-12','ТЕРМИНАЛ',500);
 INSERT INTO financial_events VALUES
  (30,10,'2026-10-09','ТЕРМИНАЛ',100),
  (31,11,'2026-09-09','ТЕРМИНАЛ',210),
  (32,12,'2026-10-11','ТЕРМИНАЛ',300);
 INSERT INTO returns VALUES (40,10,'2026-10-09','ТЕРМИНАЛ',50);
 INSERT INTO exchanges VALUES (50,10,'2026-10-09','ТЕРМИНАЛ',50);
 INSERT INTO cash_register_entries VALUES (60,10,'НАЛИЧНЫЕ',25);
`)
db0.exec(fs.readFileSync('migrations/0094_v72_reference_payment_method_merges.sql','utf8'))
let beforeValidation=()=>{}
let beforeSnapshot=()=>{}
const db={
 prepare(sql){
  return {
   bind(...args){
    return {
     async all(){return {results:db0.prepare(sql).all(...args)}},
     async first(){return db0.prepare(sql).get(...args)||null},
     async run(){
      if(sql.startsWith('INSERT INTO reference_payment_method_merges'))beforeSnapshot()
      if(sql.startsWith('INSERT INTO reference_payment_merge_validations'))beforeValidation()
      return {meta:{changes:Number(db0.prepare(sql).run(...args).changes)}}
     },
    }
   },
  }
 },
 async batch(statements){
  db0.exec('BEGIN IMMEDIATE')
  try{
   const result=[]
   for(const stmt of statements)result.push(await stmt.run())
   db0.exec('COMMIT')
   return result
  }catch(err){db0.exec('ROLLBACK');throw err}
 },
}
const local=businessMonthRange(new Date('2026-10-09T11:00:00Z'))
const ref=id=>db0.prepare('SELECT is_active FROM reference_values WHERE id=?').get(id).is_active
const method=(table,id,col)=>db0.prepare(`SELECT ${col} AS value FROM ${table} WHERE id=?`).get(id).value
const sum=(table,field)=>db0.prepare(`SELECT SUM(${field}) AS value FROM ${table}`).get().value
const beforeMoney={payments:sum('payments','amount'),events:sum('financial_events','amount_delta'),
 refunds:sum('returns','amount'),exchanges:sum('exchanges','financial_amount'),cash:sum('cash_register_entries','amount')}
let preview=await previewUserSelectedReferenceMerge(db,1,2,new Date('2026-10-09T11:00:00Z'))
assert.equal(preview.canApply,true,JSON.stringify(preview.paymentSafety?.blockers))
assert.equal(preview.paymentSafety.affectedOrders,2)
assert.deepEqual(preview.paymentSafety.affectedRecords,{
 orders:1,payments:2,financialEvents:2,returns:1,exchanges:1
})
assert.equal(preview.orders.current,2)
assert.match(preview.stateToken,/^[0-9a-f]{64}$/)
assert.equal(ref(1),1,'Preview must never hide source')
await assert.rejects(()=>applyPaymentMethodMerge(db,1,2,'wrong','admin',local),/изменились|проверку/i)
assert.equal(method('payments',20,'method'),'ТЕРМИНАЛ')

// A newly inserted payment after preview changes the guarded fingerprint.
db0.exec("INSERT INTO payments VALUES (25,10,'2026-10-09','ТЕРМИНАЛ',20)")
await assert.rejects(()=>applyPaymentMethodMerge(db,1,2,preview.stateToken,'admin',local),/изменились|проверку/i)
db0.exec('DELETE FROM payments WHERE id=25')
assert.equal(ref(1),1)

preview=await previewUserSelectedReferenceMerge(db,1,2,new Date('2026-10-09T11:00:00Z'))
beforeValidation=()=>{
 beforeValidation=()=>{}
 db0.exec("UPDATE payments SET method='UNKNOWN' WHERE id=20")
}
await assert.rejects(()=>applyPaymentMethodMerge(db,1,2,preview.stateToken,'admin',local),/CHECK constraint/)
assert.equal(ref(1),1,'Transaction must restore active source if validation fails')
assert.equal(method('payments',20,'method'),'ТЕРМИНАЛ','No partial change to payments')
assert.equal(method('financial_events',30,'payment_method'),'ТЕРМИНАЛ','No partial change to ledger')
assert.equal(db0.prepare('SELECT COUNT(*) AS n FROM reference_payment_method_merges').get().n,0)

preview=await previewUserSelectedReferenceMerge(db,1,2,new Date('2026-10-09T11:00:00Z'))
const done=await applyPaymentMethodMerge(db,1,2,preview.stateToken,'admin',local)
assert.equal(done.recordsUpdated,7)
assert.equal(done.ordersUpdated,2)
assert.equal(ref(1),0)
assert.equal(ref(2),1)
assert.equal(method('orders',10,'order_payment_method'),'KASPI PAY')
assert.equal(method('orders',12,'order_payment_method'),null,'Never assume order-level method if only payment row was marked')
assert.equal(method('payments',20,'method'),'KASPI PAY')
assert.equal(method('payments',22,'method'),'KASPI PAY')
assert.equal(method('payments',21,'method'),'ТЕРМИНАЛ','Historical payment remains')
assert.equal(method('payments',24,'method'),'ТЕРМИНАЛ','Deleted order remains')
assert.equal(method('financial_events',30,'payment_method'),'KASPI PAY')
assert.equal(method('financial_events',31,'payment_method'),'ТЕРМИНАЛ','Historical event preserved')
assert.equal(method('returns',40,'payment_method'),'KASPI PAY')
assert.equal(method('exchanges',50,'payment_method'),'KASPI PAY')
assert.equal(method('cash_register_entries',60,'payment_method'),'НАЛИЧНЫЕ','Cash register must remain untouched')
assert.deepEqual({payments:sum('payments','amount'),events:sum('financial_events','amount_delta'),
 refunds:sum('returns','amount'),exchanges:sum('exchanges','financial_amount'),cash:sum('cash_register_entries','amount')},beforeMoney)
const lines=db0.prepare('SELECT entity_type,entity_id,original_method FROM reference_payment_merge_lines ORDER BY entity_type,entity_id').all()
assert.equal(lines.length,7)
assert.ok(lines.every(row=>row.original_method==='ТЕРМИНАЛ'))
assert.equal(db0.prepare('SELECT passed FROM reference_payment_merge_validations').get().passed,1)
assert.equal((await applyPaymentMethodMerge(db,1,2,preview.stateToken,'admin',local)).alreadyMerged,true)

// Explicitly reject crossing payment classifications and noncash cash-entry anomalies.
for(const [a,b] of [[3,2],[4,2],[5,4]]){
 const next=await previewUserSelectedReferenceMerge(db,a,b,new Date('2026-10-09T11:00:00Z'))
 assert.equal(next.canApply,false)
 assert.ok(next.paymentSafety.blockers.length)
}
db0.exec("INSERT INTO orders VALUES(15,'2026-10-18','active','ХАЛЫК ПЕРЕВОД')")
db0.exec("INSERT INTO cash_register_entries VALUES(70,15,'ХАЛЫК ПЕРЕВОД',50)")
let unsafe=await previewUserSelectedReferenceMerge(db,5,2,new Date('2026-10-09T11:00:00Z'))
assert.equal(unsafe.canApply,false)
assert.ok(unsafe.paymentSafety.blockers.some(x=>/кассовые/i.test(x)))
db0.exec('DELETE FROM cash_register_entries WHERE id=70')
db0.exec("INSERT INTO financial_events VALUES(71,15,'2026-09-30','ХАЛЫК ПЕРЕВОД',20)")
unsafe=await previewUserSelectedReferenceMerge(db,5,2,new Date('2026-10-09T11:00:00Z'))
assert.equal(unsafe.canApply,false,'Do not move event in earlier financial period')
assert.ok(unsafe.paymentSafety.blockers.some(x=>/до начала/i.test(x)))
assert.equal(ref(5),1)
const code=fs.readFileSync('worker/domains/reference-payment-merge.ts','utf8')
assert.ok(!/UPDATE cash_register_entries/i.test(code))
assert.match(code,/reference_payment_merge_lines/)
assert.match(code,/source_fingerprint/)
console.log('REFERENCE PAYMENT METHOD MERGE PASSED — Terminal -> Kaspi Pay, month/history, full financial audit, cash guard, rollback and idempotency')
