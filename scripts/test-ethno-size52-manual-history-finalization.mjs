import fs from 'node:fs'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'

const movement=fs.readFileSync('worker/domains/inventory-movement.ts','utf8')
const merge=fs.readFileSync('worker/domains/catalog-variant-consolidation.ts','utf8')
const finalizer=fs.readFileSync('worker/domains/catalog-manual-history-finalization.ts','utf8')
const routes=fs.readFileSync('worker/index.ts','utf8')
const ui=fs.readFileSync('src/features/sections/ReferenceMergeWorkspace.tsx','utf8')
const migration=fs.readFileSync('migrations/0109_v72_catalog_manual_movement_finalization.sql','utf8')
const check=(x,msg)=>assert.ok(x,msg)

check(movement.includes("catalog_manual_movement_finalizations WHERE movement_id=?"),'Reversal must explicitly reject finalized movement')
check(movement.includes("reverseInventoryMovementOperation"),'Existing reversal writer must stay intact')
check(merge.includes("catalog_manual_movement_finalizations fin WHERE fin.movement_id=m.id"),'Preview must exempt finalized source movements')
check((merge.match(/catalog_manual_movement_finalizations/g)||[]).length===3,'Guarded SQL must exempt ONLY finalized source manual movements in both writer guards')
check(merge.includes("AND NOT EXISTS (SELECT 1 FROM inventory_movement_reversals"),'Historical reversal proof must remain required')
check(routes.includes("requireAdminUser(authUser,'Закрытие исторических операций доступно только администратору.")&&routes.includes('/manual-history-finalize'),'Only authenticated admin may finalize')
check(ui.includes('Подтвердить финализацию двух движений')&&ui.includes('expectedToken:historicalFinalization.stateToken'),'Explicit UI consent and token required')
check(finalizer.includes('MOVEMENTS=[4876,5400]')&&finalizer.includes('const PHYSICAL_CHECK=3250'),'Exact movement IDs and physical check only')
check(finalizer.includes("NOT EXISTS(SELECT 1 FROM inventory_movements other")&&finalizer.includes("NOT EXISTS(SELECT 1 FROM inventory_movement_reversals rev WHERE rev.original_movement_id IN (4876,5400))"),'Fresh extra manual moves or original reversals must abort finalization')
check(finalizer.includes('db.batch([')&&finalizer.includes('catalog_manual_finalization_validations'),'History close must be transactional and validated')
check(!finalizer.includes('UPDATE inventory_stock')&&!finalizer.includes('DELETE FROM inventory_movements'),'Finalization must never change the stock or delete history')

const db=new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON')
db.exec(`
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY);
CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,variant_id INTEGER NOT NULL,quantity_delta INTEGER NOT NULL);
CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY);
CREATE TABLE inventory_movement_reversals(original_movement_id INTEGER UNIQUE, reversal_movement_id INTEGER);
INSERT INTO catalog_variants VALUES(1280),(1532);
INSERT INTO inventory_movements VALUES(4876,1532,1),(5400,1532,-1),(7000,1280,0);
INSERT INTO inventory_stock_checks VALUES(3250);
`)
db.exec(migration)
const insert=db.prepare('INSERT INTO catalog_manual_movement_finalizations(movement_id,source_variant_id,keeper_variant_id,stock_check_id,movement_delta,reason,finalized_by,finalized_at) VALUES (?,?,?,?,?,?,?,?)')
db.exec('BEGIN')
try{
 insert.run(4876,1532,1280,3250,1,'Сверка ноль. Причина неизвестна.','admin','2026-10-16T00:00:00Z')
 insert.run(5400,1532,1280,3250,-1,'Сверка ноль. Причина неизвестна.','admin','2026-10-16T00:00:00Z')
 db.prepare("INSERT INTO catalog_manual_finalization_validations VALUES(1532,1,'2026-10-16T00:00:00Z')").run()
 db.exec('COMMIT')
}catch(e){db.exec('ROLLBACK');throw e}
assert.equal(db.prepare('SELECT COUNT(*) n FROM catalog_manual_movement_finalizations').get().n,2)
assert.equal(db.prepare('SELECT SUM(movement_delta) n FROM catalog_manual_movement_finalizations').get().n,0)
for(const id of [4876,5400]) assert.throws(
 ()=>db.prepare('INSERT INTO inventory_movement_reversals VALUES(?,7000)').run(id),
 /finalized by a physical stock check/,'Historical movement '+id+' must not be reversible')
db.prepare('INSERT INTO inventory_movement_reversals VALUES(7000,4876)').run()
assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_movement_reversals').get().n,1,'Unrelated reversals must remain functional')
assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,3,'Movement history changed')
assert.throws(()=>insert.run(4876,1532,1280,3250,1,'Повторная операция запрещена','admin','now'),/UNIQUE/,'Repeated finalization must fail')
assert.throws(()=>db.prepare('INSERT INTO catalog_manual_finalization_validations VALUES(1280,0,?)').run('now'),/CHECK/,'Failed validation must block transaction')
db.close()
console.log('ETHNO_SIZE52_HISTORY_FINALIZATION_LOCAL_GUARDS_PASSED')
