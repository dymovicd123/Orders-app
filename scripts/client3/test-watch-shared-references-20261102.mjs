import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createClient3WatchReference,listClient3WatchReferences} from '../../worker/domains/client3-watch-references.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
for(const file of fs.readdirSync('migrations').filter(x=>/^[0-9].*\.sql$/.test(x)).sort())
  sqlite.exec(fs.readFileSync('migrations/'+file,'utf8'))
for(const file of fs.readdirSync('migrations/client3-watch').filter(x=>/^[0-9].*\.sql$/.test(x)).sort())
  sqlite.exec(fs.readFileSync('migrations/client3-watch/'+file,'utf8'))
sqlite.exec("INSERT INTO watch_products(brand_id,model_name) VALUES(1,'TEST')")
sqlite.exec("INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(1,'male','quartz','leather','black','ЧЁРНЫЙ')")
sqlite.exec("INSERT INTO watch_reference_values(kind,value) VALUES('leatherColors','ЧЁРНЫЙ')")
const prepared=(sql,args=[])=>({
  bind(...values){return prepared(sql,values)},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async all(){return {results:sqlite.prepare(sql).all(...args)}},
  async run(){const result=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}}},
})
const db={prepare:prepared}
const admin={role:'admin',id:1,managerId:null}
const manager={role:'manager',id:2,managerId:7}
const parse=async promise=>{const r=await promise;return {status:r.status,...await r.json()}}
const before=await parse(listClient3WatchReferences(db,manager))
assert.equal(before.ok,true)
assert.equal(before.sharedAcrossBrands,true)
assert(before.rows.some(x=>x.kind==='leatherColors'&&x.value==='ЧЁРНЫЙ'))
assert(before.rows.some(x=>x.kind==='paymentMethods'&&x.value==='KASPI GOLD'))
const created=await parse(createClient3WatchReference(db,admin,{
  kind:'leatherColors',value:'  Тёмно-синий  ',
}))
assert.equal(created.status,201)
const same=await parse(createClient3WatchReference(db,admin,{
  kind:'leatherColors',value:'тёмно-синий',
}))
assert.equal(same.alreadyExists,true)
const addedPayment=await parse(createClient3WatchReference(db,admin,{
  kind:'paymentMethods',value:'Наличные',
}))
assert.equal(addedPayment.status,201)
const addedDelivery=await parse(createClient3WatchReference(db,admin,{
  kind:'deliveryMethods',value:'Доставка в офис',
}))
assert.equal(addedDelivery.status,201)
const after=await parse(listClient3WatchReferences(db,manager))
assert(after.rows.some(x=>x.kind==='leatherColors'&&x.value==='ТЁМНО-СИНИЙ'))
assert(after.rows.some(x=>x.kind==='paymentMethods'&&x.value==='НАЛИЧНЫЕ'))
assert(after.rows.some(x=>x.kind==='deliveryMethods'&&x.value==='ДОСТАВКА В ОФИС'))
const unauthorized=await parse(createClient3WatchReference(db,manager,{
  kind:'paymentMethods',value:'Fake',
}))
assert.equal(unauthorized.status,403)
const custom=await parse(createClient3WatchReference(db,admin,{
  kind:'movements',value:'Механизм с турбийоном',
}))
assert.equal(custom.status,201)
assert((await parse(listClient3WatchReferences(db,manager))).rows.some(x=>
  x.kind==='movements'&&x.value==='МЕХАНИЗМ С ТУРБИЙОНОМ'))
assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM watch_reference_values WHERE kind='leatherColors' AND value='ТЁМНО-СИНИЙ'").get().c,1)
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('CLIENT3_SHARED_REFERENCES_PASS: seed, global scope, additions, duplicate, admin protection')
