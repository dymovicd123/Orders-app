import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { normalizeOrderItems } from '../worker/domains/order-core.ts'
import { inventoryObligationLineageForRewrite } from '../worker/domains/orders-write.ts'

// Real SQL via the async D1 prepare/bind/all contract; entirely in-memory.
const sqlite=new DatabaseSync(':memory:')
sqlite.exec('CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL,product_id INTEGER,variant_id INTEGER,product_name_snapshot TEXT,audience_type TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity INTEGER,is_workshop INTEGER,source_type TEXT,created_at TEXT,inventory_obligation_key TEXT,inventory_obligation_origin_at TEXT)')
const insert=sqlite.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,audience_type,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,is_workshop,source_type,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES(?,21,?,?, 'АЛАУ ЖИЛЕТ','ВЗРОСЛЫЙ','ЖЕН','КРАСНЫЙ','СТАНДАРТ','СТАНДАРТ','46',1,?,?,?, ?, ?)")
const when=id=>'2026-10-31T08:00:00.'+String(id).padStart(3,'0')+'Z'
insert.run(101,10,111,0,'warehouse',when(101),'obligation-old-111',when(101))
insert.run(102,10,222,0,'warehouse',when(102),'obligation-old-222',when(102))
insert.run(103,10,333,0,'boutique',when(103),'obligation-old-boutique',when(103))
insert.run(104,20,null,1,'warehouse',when(104),'obligation-old-workshop',when(104))
insert.run(105,10,111,0,'warehouse',when(105),'obligation-old-111-second',when(105))
const db={prepare(sql){return {bind(...values){return {async all(){return {results:sqlite.prepare(sql).all(...values)}}}}}}}
const item=(sourceType,quantity=1)=>({
 productName:'АЛАУ ЖИЛЕТ',audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',
 color:'КРАСНЫЙ',material:'СТАНДАРТ',length:'СТАНДАРТ',
 size:'46',quantity,unitPrice:100,sourceType
})
const next=normalizeOrderItems([
 item('warehouse'),item('warehouse'),item('warehouse'),item('warehouse'),
 item('workshop'),item('boutique'),item('warehouse',2),
 item('warehouse'),item('warehouse')
], 'warehouse')
const canonical=[
 {productId:10,variantId:222},{productId:10,variantId:111},
 {productId:10,variantId:444},{productId:99,variantId:111},
 {productId:20,variantId:null},{productId:10,variantId:333},
 {productId:10,variantId:111},{productId:10,variantId:null},
 {productId:10,variantId:111},
]
const before=sqlite.prepare('SELECT id,variant_id,inventory_obligation_key,inventory_obligation_origin_at FROM order_items ORDER BY id').all()
const found=await inventoryObligationLineageForRewrite(db,21,next,canonical)
assert.deepEqual(found.map(x=>x?.key||null),[
 'obligation-old-222','obligation-old-111',null,null,
 'obligation-old-workshop','obligation-old-boutique',null,null,
 'obligation-old-111-second',
])
assert.equal(found[0]?.originAt,when(102),'SKU222 retains its own original time')
assert.equal(found[1]?.originAt,when(101),'SKU111 retains its own original time despite reorder')
assert.equal(found[8]?.originAt,when(105),'Second matching line retains independent evidence')
assert.deepEqual(sqlite.prepare('SELECT id,variant_id,inventory_obligation_key,inventory_obligation_origin_at FROM order_items ORDER BY id').all(),before,
 'Finding lineage must never mutate original historical order-item identities')
console.log('STAGE3_EXACT_SKU_OBLIGATION_LINEAGE_PASS',JSON.stringify({
 exactUnchanged:5,newObligations:4,
 noCrossSkuOrProductHistory:true,reorderedExactSkuIndependent:true,
 workshopProductOnlyExact:true,noInventoryMutation:true
}))
sqlite.close()
