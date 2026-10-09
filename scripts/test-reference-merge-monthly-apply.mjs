import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { previewUserSelectedReferenceMerge } from '../worker/domains/reference-merge-preview.ts'
import { applyMonthBoundReferenceMerge } from '../worker/domains/reference-merge-apply.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec(`
 PRAGMA foreign_keys=ON;
 CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER,updated_at TEXT DEFAULT 'seed');
 CREATE TABLE orders(id INTEGER PRIMARY KEY,order_date TEXT,order_status TEXT,
   order_payment_method TEXT,city TEXT,delivery_type TEXT,updated_at TEXT DEFAULT 'seed');
 CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,method TEXT);
 CREATE TABLE financial_events(id INTEGER PRIMARY KEY,order_id INTEGER,payment_method TEXT);
 CREATE TABLE cash_register_entries(id INTEGER PRIMARY KEY,order_id INTEGER,payment_method TEXT);
 CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,payment_method TEXT);
 CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,payment_method TEXT);
 CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,is_active INTEGER,color TEXT,material TEXT,length TEXT,category TEXT,size_label TEXT);
 INSERT INTO reference_values(id,kind,value,is_active) VALUES
  (1,'city','АЛМАТЫ',1),(2,'city','АСТАНА',1),
  (3,'delivery_type','ЗАММЛЕР',1),(4,'delivery_type','КУРЬЕР',1),
  (5,'payment_method','ТЕРМИНАЛ',1),(6,'payment_method','KASPI PAY',1);
 INSERT INTO orders(id,order_date,order_status,order_payment_method,city,delivery_type) VALUES
  (10,'2026-10-09','active','ТЕРМИНАЛ','АЛМАТЫ','ЗАММЛЕР'),
  (11,'2026-09-15','closed','ТЕРМИНАЛ','АЛМАТЫ','ЗАММЛЕР'),
  (12,'2026-10-09','active','KASPI PAY','АСТАНА','КУРЬЕР'),
  (13,'2026-10-15','active','ТЕРМИНАЛ','АЛМАТЫ','КУРЬЕР'),
  (14,'2026-10-16','deleted','ТЕРМИНАЛ','АЛМАТЫ','ЗАММЛЕР');
`)
sqlite.exec(fs.readFileSync('migrations/0093_v72_reference_value_choice_merges.sql','utf8'))

sqlite.exec("ALTER TABLE payments ADD COLUMN payment_date TEXT DEFAULT '2026-10-09'")
sqlite.exec("ALTER TABLE payments ADD COLUMN amount INTEGER DEFAULT 0")
sqlite.exec("ALTER TABLE financial_events ADD COLUMN event_date TEXT DEFAULT '2026-10-09'")
sqlite.exec("ALTER TABLE financial_events ADD COLUMN amount_delta INTEGER DEFAULT 0")
sqlite.exec("ALTER TABLE returns ADD COLUMN return_date TEXT DEFAULT '2026-10-09'")
sqlite.exec("ALTER TABLE returns ADD COLUMN amount INTEGER DEFAULT 0")
sqlite.exec("ALTER TABLE exchanges ADD COLUMN exchange_date TEXT DEFAULT '2026-10-09'")
sqlite.exec("ALTER TABLE exchanges ADD COLUMN financial_amount INTEGER DEFAULT 0")

let beforeValidation=()=>{}
const db={
  prepare(query){
    return {bind(...values){return {
      async first(){return sqlite.prepare(query).get(...values)||null},
      async all(){return {results:sqlite.prepare(query).all(...values)}},
      async run(){
        if(query.startsWith('INSERT INTO reference_value_merge_validations'))beforeValidation()
        return {meta:{changes:Number(sqlite.prepare(query).run(...values).changes)}}
      },
    }}}
  },
  async batch(statements){
    sqlite.exec('BEGIN IMMEDIATE')
    try{
      const result=[]
      for(const step of statements)result.push(await step.run())
      sqlite.exec('COMMIT')
      return result
    }catch(error){
      sqlite.exec('ROLLBACK')
      throw error
    }
  },
}
const now=new Date('2026-10-09T15:00:00Z')
const field=(id,key)=>sqlite.prepare(`SELECT ${key} FROM orders WHERE id=?`).get(id)[key]
const active=id=>sqlite.prepare('SELECT is_active FROM reference_values WHERE id=?').get(id).is_active
let preview=await previewUserSelectedReferenceMerge(db,1,2,now)
assert.equal(preview.orders.current,2)
assert.equal(preview.orders.older,1)
assert.equal(preview.canApply,true)
await assert.rejects(()=>applyMonthBoundReferenceMerge(db,1,2,'fake','admin',now),/Посмотрите последствия/)

// A failing final conservation assertion must roll back ALL order edits AND retirement.
beforeValidation=()=>{
  beforeValidation=()=>{}
  sqlite.exec("UPDATE orders SET city='НЕИЗВЕСТНЫЙ' WHERE id=10")
}
await assert.rejects(()=>applyMonthBoundReferenceMerge(db,1,2,preview.stateToken,'admin',now),/CHECK constraint/)
assert.equal(active(1),1,'Failed merge never retires the selected source')
assert.equal(field(10,'city'),'АЛМАТЫ','No partial current-month data mutation')
assert.equal(field(11,'city'),'АЛМАТЫ','Historical order remains unchanged')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM reference_value_merges').get().n,0)

preview=await previewUserSelectedReferenceMerge(db,1,2,now)
const result=await applyMonthBoundReferenceMerge(db,1,2,preview.stateToken,'administrator',now)
assert.equal(result.ordersUpdated,2)
assert.equal(active(1),0)
assert.equal(active(2),1)
assert.equal(field(10,'city'),'АСТАНА')
assert.equal(field(13,'city'),'АСТАНА')
assert.equal(field(11,'city'),'АЛМАТЫ','Previous calendar months retain original value')
assert.equal(field(14,'city'),'АЛМАТЫ','Deleted orders retain their original history')
assert.equal((await applyMonthBoundReferenceMerge(db,1,2,preview.stateToken,'administrator',now)).alreadyMerged,true)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM reference_value_merge_orders').get().n,2)
assert.equal(sqlite.prepare('SELECT passed FROM reference_value_merge_validations').get().passed,1)
assert.equal(sqlite.prepare('SELECT created_by FROM reference_value_merges').get().created_by,'administrator')

// Stale preview cannot update a concurrently edited current-month order.
let delivery=await previewUserSelectedReferenceMerge(db,3,4,now)
assert.equal(delivery.orders.current,1)
sqlite.exec("UPDATE orders SET updated_at='edited-other-operator' WHERE id=10")
await assert.rejects(()=>applyMonthBoundReferenceMerge(db,3,4,delivery.stateToken,'admin',now),/изменились/)
assert.equal(active(3),1)
sqlite.exec("UPDATE orders SET updated_at='seed' WHERE id=10")
delivery=await previewUserSelectedReferenceMerge(db,3,4,now)
assert.equal((await applyMonthBoundReferenceMerge(db,3,4,delivery.stateToken,'admin',now)).ordersUpdated,1)
assert.equal(field(10,'delivery_type'),'КУРЬЕР')
assert.equal(field(11,'delivery_type'),'ЗАММЛЕР')

// Payment methods are handled separately, never via generic city/delivery merge.
let pay=await previewUserSelectedReferenceMerge(db,5,6,now)
assert.equal(pay.canApply,true)
await assert.rejects(()=>applyMonthBoundReferenceMerge(db,5,6,'token','admin',now),/пока недоступно|не доступны|проверку|автоматическое|последствия/i)
assert.equal(active(5),1)
assert.equal(field(10,'order_payment_method'),'ТЕРМИНАЛ')
const worker=fs.readFileSync('worker/index.ts','utf8')
const ui=fs.readFileSync('src/features/sections/ReferenceMergeWorkspace.tsx','utf8')
assert.match(worker,/\/api\/reference-values\/merge' && request.method === 'POST'/)
assert.match(ui,/window.confirm/)
assert.match(ui,/expectedToken:impact.stateToken/)
console.log('REFERENCE MERGE MONTHLY APPLY PASSED — keeper chosen by user, old orders untouched, audit, stale guard, rollback, money safety')
