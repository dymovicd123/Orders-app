import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createClient3WatchReference,listClient3WatchReferences} from '../../worker/domains/client3-watch-references.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE watch_variants (
    bracelet_material TEXT NOT NULL, bracelet_color TEXT NOT NULL DEFAULT ''
  );
  INSERT INTO watch_variants VALUES ('leather','ЧЁРНЫЙ'),('steel','');
`)
const migration=fs.readFileSync('migrations/client3-watch/0004_client3_shared_reference_values.sql','utf8')
sqlite.exec(migration)
sqlite.exec(migration)
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
assert(after.rows.some(x=>x.kind==='paymentMethods'&&x.value==='Наличные'))
assert(after.rows.some(x=>x.kind==='deliveryMethods'&&x.value==='Доставка в офис'))
const unauthorized=await parse(createClient3WatchReference(db,manager,{
  kind:'paymentMethods',value:'Fake',
}))
assert.equal(unauthorized.status,403)
const protectedKind=await parse(createClient3WatchReference(db,admin,{
  kind:'movements',value:'unsafe',
}))
assert.equal(protectedKind.status,400)
assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM watch_reference_values WHERE kind='leatherColors' AND value='ТЁМНО-СИНИЙ'").get().c,1)
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('CLIENT3_SHARED_REFERENCES_PASS: seed, global scope, additions, duplicate, admin protection')
