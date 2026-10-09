import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { businessMonthRange,previewUserSelectedReferenceMerge } from '../worker/domains/reference-merge-preview.ts'

assert.deepEqual(businessMonthRange(new Date('2026-09-30T20:00:00Z')),
 {from:'2026-10-01',toExclusive:'2026-11-01',label:'октябрь 2026 г.'})
assert.deepEqual(businessMonthRange(new Date('2026-10-31T18:30:00Z')),
 {from:'2026-10-01',toExclusive:'2026-11-01',label:'октябрь 2026 г.'})
const sql=new DatabaseSync(':memory:')
sql.exec(`
 CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER);
 CREATE TABLE orders(id INTEGER PRIMARY KEY,order_date TEXT,order_status TEXT,order_payment_method TEXT,delivery_type TEXT,city TEXT);
 CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,method TEXT);
 CREATE TABLE financial_events(id INTEGER PRIMARY KEY,order_id INTEGER,payment_method TEXT);
 CREATE TABLE cash_register_entries(id INTEGER PRIMARY KEY,order_id INTEGER,payment_method TEXT);
 CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,payment_method TEXT);
 CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,payment_method TEXT);
 CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,is_active INTEGER,color TEXT,material TEXT,length TEXT,category TEXT,size_label TEXT);
 INSERT INTO reference_values VALUES
  (1,'payment_method','ТЕРМИНАЛ',1),
  (2,'payment_method','KASPI PAY',1),
  (3,'payment_method','НАЛИЧНЫЕ',1),
  (4,'delivery_type','САМОВЫВОЗ',1),
  (5,'delivery_type','ДОСТАВКА',1),
  (6,'city','АЛМАТЫ',1),
  (7,'city','АСТАНА',1),
  (8,'color','СВЕТЛЫЙ',1),
  (9,'color','ТЁМНЫЙ',1),
  (10,'payment_method','СТАРОЕ',0);
 INSERT INTO orders VALUES
  (10,'2026-10-08','active','ТЕРМИНАЛ','САМОВЫВОЗ','АЛМАТЫ'),
  (11,'2026-09-09','archived','ТЕРМИНАЛ','САМОВЫВОЗ','АЛМАТЫ'),
  (12,'2026-10-08','active','KASPI PAY','ДОСТАВКА','АСТАНА'),
  (13,'2026-10-09','active',NULL,'ДОСТАВКА','АЛМАТЫ'),
  (14,'2026-10-10','deleted','ТЕРМИНАЛ','САМОВЫВОЗ','АЛМАТЫ');
 INSERT INTO payments VALUES (1,10,'ТЕРМИНАЛ'),(2,11,'ТЕРМИНАЛ'),(3,13,'ТЕРМИНАЛ');
 INSERT INTO financial_events VALUES (1,10,'ТЕРМИНАЛ'),(2,11,'ТЕРМИНАЛ');
 INSERT INTO cash_register_entries VALUES (1,10,'ТЕРМИНАЛ');
 INSERT INTO returns VALUES (1,10,'ТЕРМИНАЛ');
 INSERT INTO exchanges VALUES (1,10,'ТЕРМИНАЛ');
 INSERT INTO catalog_variants VALUES(1,1,'СВЕТЛЫЙ','','','adult','52');
`)
const db={prepare(q){return {bind(...args){return {
 async first(){return sql.prepare(q).get(...args)||null},
 async all(){return {results:sql.prepare(q).all(...args)}},
}}}}}
const before=sql.prepare('SELECT * FROM orders ORDER BY id').all()
const impact=await previewUserSelectedReferenceMerge(db,1,2,new Date('2026-10-09T11:00:00Z'))
assert.equal(impact.source.value,'ТЕРМИНАЛ')
assert.equal(impact.target.value,'KASPI PAY')
assert.equal(impact.orders.current,1)
assert.equal(impact.orders.older,1)
assert.equal(impact.finance.payments.current,2)
assert.equal(impact.finance.payments.older,1)
assert.equal(impact.finance.financialEvents.current,1)
assert.equal(impact.finance.cashEntries.current,1)
assert.equal(impact.finance.returns.current,1)
assert.equal(impact.finance.exchanges.current,1)
assert.equal(impact.canApply,false)
assert.deepEqual(sql.prepare('SELECT * FROM orders ORDER BY id').all(),before,
 'Read-only impact preview must not change any current or historical order')
const deliveries=await previewUserSelectedReferenceMerge(db,4,5,new Date('2026-10-09T11:00:00Z'))
assert.equal(deliveries.orders.current,1)
assert.equal(deliveries.orders.older,1)
assert.equal(deliveries.finance.payments.current,0)
const colors=await previewUserSelectedReferenceMerge(db,8,9,new Date('2026-10-09T11:00:00Z'))
assert.equal(colors.activeCatalogVariants,1)
await assert.rejects(()=>previewUserSelectedReferenceMerge(db,1,4),/одного справочника/)
await assert.rejects(()=>previewUserSelectedReferenceMerge(db,1,1),/два разных/)
await assert.rejects(()=>previewUserSelectedReferenceMerge(db,1,10),/действующим/)
const page=fs.readFileSync('src/features/sections/ReferenceMergeWorkspace.tsx','utf8')
const section=fs.readFileSync('src/features/sections/ReferencesSection.tsx','utf8')
const api=fs.readFileSync('worker/index.ts','utf8')
assert.match(page,/Убираем лишнее название/)
assert.match(page,/Оставляем правильное название/)
assert.match(page,/Посмотреть, что изменится/)
assert.match(page,/paymentMethods/)
assert.match(section,/<ReferenceMergeWorkspace apiFetch=\{apiFetch\} isAdmin=\{isAdmin\} \/>/)
assert.match(api,/api\/reference-values\/merge-preview/)
assert.match(api,/requireAdminUser\(authUser, 'Наведение порядка/)
const worker=fs.readFileSync('worker/domains/reference-merge-preview.ts','utf8')
assert.match(worker,/Пока ничего не изменено\./)
assert.doesNotMatch(worker,/\b(?:UPDATE|DELETE FROM|INSERT INTO)\s+(?:orders|payments|financial_events|reference_values|catalog_variants)\b/i)
console.log('REFERENCE MERGE CHOICE / PREVIEW PASSED — calendar-month bounds, user-owned source/keeper, finance impact, unchanged history')
