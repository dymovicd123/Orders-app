import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {registerWatchModel,registerWatchVariant,listWatchCatalogDrafts} from '../../worker/domains/client3-watch-catalog.ts'
import {provisionClient3WatchSku} from '../../worker/domains/client3-watch-provision.ts'
import {previewClient3WatchDelete,deleteClient3WatchCatalog} from '../../worker/domains/client3-watch-catalog-delete.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
for(const name of fs.readdirSync('migrations').filter(x=>/^\d+.*\.sql$/.test(x)).sort())
  sqlite.exec(fs.readFileSync('migrations/'+name,'utf8'))
if(!sqlite.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
  sqlite.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
for(const name of fs.readdirSync('migrations/client3-watch').filter(x=>/^\d+.*\.sql$/.test(x)).sort())
  sqlite.exec(fs.readFileSync('migrations/client3-watch/'+name,'utf8'))
sqlite.prepare("INSERT OR IGNORE INTO managers(id,name) VALUES(1,'Release Admin')").run()
sqlite.prepare("INSERT OR IGNORE INTO app_users(id,email,password_hash,role,manager_id,display_name,is_active) VALUES(1,'c3-release@example.test','fixture-only','admin',1,'Release Admin',1)").run()
sqlite.prepare("INSERT OR IGNORE INTO watch_reference_values(kind,value) VALUES('leatherColors','ЧЕРНЫЙ')").run()
sqlite.prepare("INSERT OR REPLACE INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active','2026-11-04')").run()
const stmt=(sql,args=[])=>({
  bind(...x){return stmt(sql,x)},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async all(){return {results:sqlite.prepare(sql).all(...args)}},
  async run(){const r=sqlite.prepare(sql).run(...args)
    return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}},
})
const db={prepare:stmt,async batch(statements){
  sqlite.exec('SAVEPOINT c3_release')
  try{const output=[]
    for(const s of statements) output.push(await s.run())
    sqlite.exec('RELEASE c3_release')
    return output
  }catch(e){sqlite.exec('ROLLBACK TO c3_release');sqlite.exec('RELEASE c3_release');throw e}
}}
const admin={id:1,role:'admin',managerId:1,employeeRole:'Администратор',displayName:'Release Admin'}
const parse=async p=>{const r=await p;return {status:r.status,...await r.json()}}
const scenarios=[
  {brandId:1,label:'TAUWACH male steel black',attrs:{gender:'male',movement:'quartz',braceletMaterial:'steel',dialColor:'black',braceletColor:''}},
  {brandId:2,label:'WACHIZEN female rubber white',attrs:{gender:'female',movement:'quartz',braceletMaterial:'rubber',dialColor:'white',braceletColor:''}},
  {brandId:2,label:'WACHIZEN female leather white',attrs:{gender:'female',movement:'quartz',braceletMaterial:'leather',dialColor:'white',braceletColor:'ЧЕРНЫЙ'}},
]
for(const s of scenarios){
  const model=await parse(registerWatchModel(db,admin,s.brandId,{modelName:'RELEASE P1-02 '+s.label}))
  assert.equal(model.status,201,JSON.stringify(model))
  const watchIds=[],canonicalIds=[]
  for(let n=0;n<5;n++){
    const added=await parse(registerWatchVariant(db,admin,s.brandId,{watchProductId:model.watchProductId,...s.attrs}))
    assert.equal(added.status,201,JSON.stringify({scenario:s.label,generation:n+1,added}))
    assert(!watchIds.includes(added.watchVariantId))
    const linked=await parse(provisionClient3WatchSku(db,admin,s.brandId,added.watchVariantId))
    assert.equal(linked.status,200,JSON.stringify(linked))
    assert(!canonicalIds.includes(linked.canonicalVariantId))
    watchIds.push(added.watchVariantId);canonicalIds.push(linked.canonicalVariantId)
    const reused=await parse(registerWatchVariant(db,admin,s.brandId,{watchProductId:model.watchProductId,...s.attrs}))
    assert.equal(reused.status,200,JSON.stringify(reused))
    assert.equal(reused.watchVariantId,added.watchVariantId)
    assert.equal(reused.alreadyExists,true)
    const listed=await parse(listWatchCatalogDrafts(db,admin,s.brandId))
    const records=listed.rows.filter(r=>r.watchProductId===model.watchProductId)
    assert.equal(records.length,n+1)
    assert.equal(records.filter(r=>r.variantActive===1).length,1)
    for(const rec of records){
      assert.equal(rec.movement,s.attrs.movement)
      assert.equal(rec.braceletMaterial,s.attrs.braceletMaterial)
      assert.equal(rec.dialColor,s.attrs.dialColor)
      assert.equal(rec.braceletColor,s.attrs.braceletColor)
    }
    if(n<4){
      const preview=await parse(previewClient3WatchDelete(db,admin,s.brandId,
        {kind:'variant',watchProductId:model.watchProductId,watchVariantId:added.watchVariantId}))
      assert.equal(preview.status,200,JSON.stringify(preview))
      assert.equal(preview.canDelete,true,JSON.stringify(preview))
      const deleted=await parse(deleteClient3WatchCatalog(db,admin,s.brandId,
        {kind:'variant',watchProductId:model.watchProductId,watchVariantId:added.watchVariantId,expectedCount:preview.count}))
      assert.equal(deleted.status,200,JSON.stringify(deleted))
      assert.equal(sqlite.prepare('SELECT is_active FROM watch_variants WHERE id=?').get(added.watchVariantId).is_active,0)
      assert.equal(sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?').get(linked.canonicalVariantId).is_active,0)
    }
  }
  assert.equal(new Set(watchIds).size,5)
  assert.equal(new Set(canonicalIds).size,5)
  assert.deepEqual(sqlite.prepare('SELECT is_active FROM watch_variants WHERE watch_product_id=? ORDER BY id')
    .all(model.watchProductId).map(r=>r.is_active),[0,0,0,0,1])
  console.log('PASS',s.label,'watch IDs',watchIds.join(','),'catalog IDs',canonicalIds.join(','))
}
assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
sqlite.close()
console.log('CLIENT3_RELEASE_V6_GENERATIONS_PASS')
