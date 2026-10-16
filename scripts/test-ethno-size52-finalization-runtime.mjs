import fs from 'node:fs'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {previewEthnoSize52HistoryFinalization,finalizeEthnoSize52History} from '../worker/domains/catalog-manual-history-finalization.ts'

function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,color TEXT,material TEXT,length TEXT,gender TEXT,size_label TEXT,is_active INTEGER);
 CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity_delta INTEGER,quantity_after INTEGER,reference_type TEXT,created_at TEXT);
 CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,expected_quantity INTEGER,counted_quantity INTEGER,difference_quantity INTEGER,check_type TEXT);
 CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity INTEGER,reserved_quantity INTEGER,updated_at TEXT);
 CREATE TABLE inventory_reservations(id INTEGER,variant_id INTEGER,status TEXT);
 CREATE TABLE orders(id INTEGER,order_status TEXT,shipping_status TEXT);
 CREATE TABLE order_items(id INTEGER,order_id INTEGER,variant_id INTEGER);
 CREATE TABLE inventory_stocktake_items(variant_id INTEGER,session_id TEXT);
 CREATE TABLE inventory_stocktake_sessions(id TEXT,status TEXT);
 CREATE TABLE inventory_lifecycle_events(variant_id INTEGER,status TEXT);
 CREATE TABLE inventory_transfer_items(variant_id INTEGER,transfer_id INTEGER);
 CREATE TABLE inventory_transfer_documents(id INTEGER,status TEXT);
 CREATE TABLE workshop_tasks(variant_id INTEGER,status TEXT);
 CREATE TABLE catalog_variant_consolidations(source_variant_id INTEGER);
 CREATE TABLE inventory_movement_reversals(original_movement_id INTEGER UNIQUE,reversal_movement_id INTEGER);
 INSERT INTO catalog_variants VALUES
 (1280,75,146,'СВЕТЛО-СЕРЫЙ','ДРАП','СТАНДАРТ','ЖЕН','52',1),
 (1532,75,146,'СВЕТЛО СЕРЫЙ','ДРАП','СТАНДАРТ','ЖЕН','52',1);
 INSERT INTO inventory_stock VALUES
 (1071,1280,'warehouse',0,0,'2026-10-16T14:00:00Z'),
 (1090,1280,'boutique',0,0,'2026-10-16T14:00:00Z'),
 (1411,1532,'warehouse',0,0,'2026-10-16T15:12:54Z');
 INSERT INTO inventory_movements VALUES
 (4876,1532,'warehouse',1,1,'manual','2026-10-13T10:34:52Z'),
 (5400,1532,'warehouse',-1,0,'manual','2026-10-16T15:12:54Z');
 INSERT INTO inventory_stock_checks VALUES(3250,1532,'warehouse',1,0,-1,'manual_set');
 `)
 sql.exec(fs.readFileSync('migrations/0109_v72_catalog_manual_movement_finalization.sql','utf8'))
 const wrapper={
   prepare(query){
    let params=[]
    return {
      bind(...x){params=x;return this},
      first(){return sql.prepare(query).get(...params)||null},
      all(){return {results:sql.prepare(query).all(...params)}},
      run(){return sql.prepare(query).run(...params)},
      get _sql(){return query},
      get _params(){return params},
    }
   },
   async batch(items){
    sql.exec('BEGIN')
    try{
     const out=items.map(st=>({meta:{changes:Number(sql.prepare(st._sql).run(...st._params).changes)}}))
     sql.exec('COMMIT')
     return out
    }catch(e){sql.exec('ROLLBACK');throw e}
   }
 }
 return {sql,db:wrapper}
}
const reason='Фактический остаток 0 подтверждён сверкой #3250. Причина расхождения неизвестна.'
{
 const {db,sql}=fixture()
 const p=await previewEthnoSize52HistoryFinalization(db)
 assert.equal(p.canFinalize,true,'Expected exact production-like case to be finalizable: '+p.blockers.join(', '))
 assert.deepEqual(p.originalMovements,[4876,5400])
 await assert.rejects(()=>finalizeEthnoSize52History(db,'admin',reason,'bad-token'),/refresh preview/)
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM catalog_manual_movement_finalizations').get().n,0)
 const ok=await finalizeEthnoSize52History(db,'admin',reason,p.stateToken)
 assert.equal(ok.finalized,true)
 assert.deepEqual(sql.prepare('SELECT movement_id FROM catalog_manual_movement_finalizations ORDER BY movement_id').all().map(x=>x.movement_id),[4876,5400])
 assert.equal(sql.prepare('SELECT passed FROM catalog_manual_finalization_validations WHERE source_variant_id=1532').get().passed,1)
 assert.equal(sql.prepare('SELECT SUM(quantity) n FROM inventory_stock').get().n,0)
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,2,'Original historical events must remain')
 for(const id of [4876,5400])assert.throws(()=>sql.prepare('INSERT INTO inventory_movement_reversals(original_movement_id,reversal_movement_id) VALUES (?,?)').run(id,123),/finalized by a physical stock check/)
 const after=await previewEthnoSize52HistoryFinalization(db)
 assert.equal(after.canFinalize,false,'Finalization may not repeat')
 await assert.rejects(()=>finalizeEthnoSize52History(db,'admin',reason,p.stateToken),/Finalization blocked/)
 sql.close()
}
for(const [label,mutate] of [
 ['stock drift',sql=>sql.exec('UPDATE inventory_stock SET quantity=1 WHERE id=1411')],
 ['reversed source',sql=>sql.exec('INSERT INTO inventory_movement_reversals VALUES(4876,9912)')],
 ['physical check 1 not 0',sql=>sql.exec('UPDATE inventory_stock_checks SET counted_quantity=1 WHERE id=3250')],
 ['extra source movement',sql=>sql.exec("INSERT INTO inventory_movements VALUES(6000,1532,'warehouse',0,0,'manual','2026-10-16T15:15:00Z')")],
 ['source active order',sql=>sql.exec("INSERT INTO orders VALUES(1,'active','not_sent'); INSERT INTO order_items VALUES(99,1,1532)")],
 ['active stocktake',sql=>sql.exec("INSERT INTO inventory_stocktake_sessions VALUES('active','active');INSERT INTO inventory_stocktake_items VALUES(1532,'active')")],
 ['keeper stock nonzero',sql=>sql.exec('UPDATE inventory_stock SET quantity=1 WHERE id=1071')],
]){
 const {db,sql}=fixture()
 mutate(sql)
 const p=await previewEthnoSize52HistoryFinalization(db)
 assert.equal(p.canFinalize,false,'Must fail closed for '+label)
 assert.ok(p.blockers.length>0)
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM catalog_manual_movement_finalizations').get().n,0)
 sql.close()
}
console.log('ETHNO_SIZE52_EXACT_D1_PROXY_PREVIEW_FINALIZE_NEGATIVE_TESTS_PASSED')
