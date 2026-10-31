import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { listInventoryReservations } from '../worker/domains/inventory-reservations.ts'

class Statement{
  constructor(owner,sql,args=[]){this.owner=owner;this.sql=sql;this.args=args}
  bind(...args){return new Statement(this.owner,this.sql,args)}
  async all(){return {results:this.owner.sql.prepare(this.sql).all(...this.args)}}
  async first(){return this.owner.sql.prepare(this.sql).get(...this.args)||null}
}
const sql=new DatabaseSync(':memory:')
const db={sql,prepare:query=>new Statement({sql},query)}
sql.exec(
"CREATE TABLE managers(id INTEGER PRIMARY KEY,name TEXT);"+
"CREATE TABLE customers(id INTEGER PRIMARY KEY,display_name TEXT,phone_normalized TEXT);"+
"CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_date TEXT,shipping_status TEXT,manager_id INTEGER,customer_id INTEGER);"+
"CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT);"+
"CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,inventory_source TEXT,product_id INTEGER,variant_id INTEGER,quantity INTEGER,status TEXT);")
const order=sql.prepare("INSERT INTO orders(id,external_id,order_date,shipping_status) VALUES(?,?,?,'not_sent')")
const item=sql.prepare("INSERT INTO order_items(id,order_id,product_name_snapshot) VALUES(?,?,'Товар')")
const reserve=sql.prepare("INSERT INTO inventory_reservations(id,order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status) VALUES(?,?,?,'warehouse',50,601,?,'active')")
for(let i=1;i<=125;i++){
  order.run(i,'ORD-'+i,'2026-10-'+String(1+(i%28)).padStart(2,'0'))
  item.run(i,i)
  reserve.run(i,i,i,i===125?3:1)
}
sql.prepare("INSERT INTO inventory_reservations(id,order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status) VALUES(999,1,1,'warehouse',50,601,500,'released')").run()
sql.prepare("INSERT INTO inventory_reservations(id,order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status) VALUES(998,1,1,'boutique',50,601,300,'active')").run()
const url=new URL('https://test.invalid/api/inventory/reservations?source=warehouse&variantId=601')
const data=await listInventoryReservations(db,url)
assert.equal(data.reservations.length,120,'Only show manageable first page')
assert.equal(data.totalCount,125,'Count all real active reservations, not 120')
assert.equal(data.totalQuantity,127,'Sum all 125 rows including a quantity-3 oldest reservation')
assert.equal(data.hasMore,true,'Warn that first-page order list is incomplete')
assert.equal(data.reservations[0].orderDate,'2026-10-28', 'List still sorted newest first')
sql.prepare("UPDATE inventory_reservations SET status='released' WHERE id=125").run()
const after=await listInventoryReservations(db,url)
assert.equal(after.totalCount,124)
assert.equal(after.totalQuantity,124)
assert.equal(after.hasMore,true)
const other=await listInventoryReservations(db,new URL('https://test.invalid/api/inventory/reservations?source=boutique&variantId=601'))
assert.equal(other.totalCount,1)
assert.equal(other.totalQuantity,300)
assert.equal(other.hasMore,false)
const page=fs.readFileSync('src/features/inventory/views/StockVariantTimeline.tsx','utf8')
const section=fs.readFileSync('src/features/sections/InventorySection.tsx','utf8')
assert(page.includes('reservationsTotalQuantity') && page.includes('reservationsHasMore'))
assert(page.includes('Ниже показаны только первые'), 'Never imply visible 120 are all real active reservations')
assert(page.includes('Последний незакрытый по сверкам период расхождения'))
assert(page.includes('последняя сохранённая сверка совпала с учётом'))
assert(section.includes('setHistoryActiveOrdersTotalQuantity('))
assert(section.includes('setHistoryActiveOrdersHasMore('))
console.log('STAGE4_FULL_RESERVATION_TOTAL_AND_LAST_EPISODE_PASS: 125 active count, 127 exact pieces, source isolation and truthful display')
