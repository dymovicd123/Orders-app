// Regression: the deletion preview reads immutable Exchange item snapshots
// for ALL lines, never substituted from current order_items / guessed prices.
// No remote D1 or production data.
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {previewAdminDeleteImpact} from '../worker/domains/admin-delete-impact.ts'

const sql=new DatabaseSync(':memory:')
sql.exec(`
CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER,payment_date TEXT,method TEXT,payment_kind TEXT);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,product_name_snapshot TEXT);
CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,return_date TEXT,amount INTEGER,payment_method TEXT);
CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,exchange_date TEXT,
  comment TEXT,financial_action TEXT,financial_amount INTEGER,payment_method TEXT);
CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,role TEXT,order_item_id INTEGER,
  product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,
  length_snapshot TEXT,size_snapshot TEXT,quantity INTEGER,inventory_source TEXT);
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,
  status TEXT,inventory_source TEXT,quantity INTEGER);
INSERT INTO payments VALUES(5,42,5000,'2026-10-07','ТЕРМИНАЛ','primary');
INSERT INTO order_items VALUES(10,42,'LATER CHANGED NAME');
INSERT INTO order_items VALUES(11,42,'NEW CHANGED NAME');
INSERT INTO exchanges VALUES(2,42,'completed','2026-10-08','Согласовано','extra_payment',1200,'ТЕРМИНАЛ');
INSERT INTO exchanges VALUES(3,42,'completed','2026-10-09','Составной обмен','none',0,NULL);
INSERT INTO exchanges VALUES(4,42,'cancelled','2026-10-10','Нельзя показывать','refund',500,'НАЛИЧНЫЕ');
INSERT INTO exchange_items VALUES(1,2,'old',10,'АБАЙ ШАПАН','men','Шоколад','Шерсть','','48',1,'not_issued');
INSERT INTO exchange_items VALUES(2,2,'new',11,'КЕУДЕШЕ','men','Айвори','Хлопок','','50',1,'warehouse');
INSERT INTO exchange_items VALUES(3,3,'old',12,'СТАРЫЙ ТОВАР А',NULL,'Хаки',NULL,NULL,'44',2,'boutique');
INSERT INTO exchange_items VALUES(4,3,'old',13,'СТАРЫЙ ТОВАР Б',NULL,'Синий',NULL,NULL,'46',1,'warehouse');
INSERT INTO exchange_items VALUES(5,3,'new',14,'НОВЫЙ ТОВАР А',NULL,'Зелёный',NULL,NULL,'48',1,'workshop');
INSERT INTO exchange_items VALUES(6,3,'new',15,'НОВЫЙ ТОВАР Б',NULL,'Чёрный',NULL,NULL,'50',2,'warehouse');
INSERT INTO exchange_items VALUES(7,4,'old',16,'CANCELLED OLD',NULL,NULL,NULL,NULL,NULL,1,NULL);
INSERT INTO exchange_items VALUES(8,4,'new',17,'CANCELLED NEW',NULL,NULL,NULL,NULL,NULL,1,NULL);
INSERT INTO inventory_reservations VALUES(1,42,11,'active','warehouse',1);
`)
let mutations=0,exchangeItemReads=0
const db={prepare(query){
  if(!/^SELECT\b/i.test(query.trim())){mutations++;throw Error('Read-only preview attempted write')}
  if(query.includes('FROM exchange_items'))exchangeItemReads++
  let params=[]
  return {
    bind(...args){params=args;return this},
    async all(){return {results:sql.prepare(query).all(...params)}},
    async first(){return sql.prepare(query).get(...params)||null},
    async run(){mutations++;throw Error('Preview must never mutate')},
  }
}}
const preview=await previewAdminDeleteImpact(db,42,10000,new Set())
assert.equal(preview.exchanges.length,2)
assert.deepEqual(preview.exchanges.map(e=>e.id),[2,3])
assert.equal(preview.paymentReversal,5000)
assert.equal(preview.debtAmount,5000)
assert.equal(preview.exchanges[0].date,'2026-10-08')
assert.equal(preview.exchanges[0].paymentMethod,'ТЕРМИНАЛ')
assert.equal(preview.exchanges[0].financialAmount,1200)
assert.equal(preview.exchanges[0].oldItems[0].name,'АБАЙ ШАПАН')
assert.equal(preview.exchanges[0].oldItems[0].size,'48')
assert.equal(preview.exchanges[0].oldItems[0].color,'Шоколад')
assert.equal(preview.exchanges[0].oldItems[0].source,'not_issued')
assert.equal(preview.exchanges[0].newItems[0].name,'КЕУДЕШЕ')
assert.deepEqual(preview.exchanges[1].oldItems.map(x=>[x.name,x.quantity]),[
  ['СТАРЫЙ ТОВАР А',2],['СТАРЫЙ ТОВАР Б',1]
])
assert.deepEqual(preview.exchanges[1].newItems.map(x=>[x.name,x.quantity]),[
  ['НОВЫЙ ТОВАР А',1],['НОВЫЙ ТОВАР Б',2]
])
assert(preview.exchanges.every(e=>!e.missingHistory))
assert(!JSON.stringify(preview.exchanges).includes('LATER CHANGED NAME'))
assert(!JSON.stringify(preview.exchanges).includes('CANCELLED OLD'))
assert.equal(exchangeItemReads,1)
assert.equal(mutations,0)
assert.equal(preview.truncated,false)

// For legacy partial history, disclose missing evidence rather than inventing items.
sql.exec("DELETE FROM exchange_items WHERE exchange_id=2 AND role='old'")
const incomplete=await previewAdminDeleteImpact(db,42,10000,new Set())
assert.equal(incomplete.exchanges[0].missingHistory,true)
assert.deepEqual(incomplete.exchanges[0].oldItems,[])
assert.equal(incomplete.exchanges[0].newItems[0].name,'КЕУДЕШЕ')

// A 501st item flags incomplete display, so the existing preview blocker
// prevents approval of a truncated list.
const insert=sql.prepare("INSERT INTO exchange_items(id,exchange_id,role,order_item_id,product_name_snapshot,quantity) VALUES (?,3,'new',99,'BIG SNAPSHOT',1)")
for(let i=100;i<600;i++)insert.run(i)
const capped=await previewAdminDeleteImpact(db,42,10000,new Set())
assert.equal(capped.truncated,true)
assert.equal(mutations,0)
const ui=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
for(const phrase of ['Заменяемые товары','Товары взамен','Будет аннулирована доплата','Будет аннулирован возврат разницы','В истории нет сохранённых позиций']){
  assert(ui.includes(phrase),'Missing user-facing exchange detail: '+phrase)
}
assert(ui.includes('step.type===\'exchange\''),'Must render only the right step detail')
sql.close()
console.log('ADMIN_DELETE_ITEMIZED_EXCHANGE_HISTORY_AND_MONEY_PREVIEW_PASSED')
