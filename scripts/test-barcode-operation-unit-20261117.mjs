import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { normalizeOutboundUnitBarcodes, prepareOutboundBarcodeStatements } from '../worker/domains/inventory-outbound-barcode.ts'
import { prepareUnitLabelBatch } from '../worker/domains/barcode-unit-preparation.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
sqlite.exec(`
CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER NOT NULL);
CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER NOT NULL);
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,
 category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER NOT NULL);
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,
 quantity INTEGER NOT NULL,reserved_quantity INTEGER NOT NULL DEFAULT 0);
INSERT INTO catalog_products VALUES(1,'ШАПАН',1);
INSERT INTO catalog_stock_positions VALUES(1,1,1);
INSERT INTO catalog_variants VALUES(101,1,1,'adult','МУЖ','ХАКИ','СТАНДАРТ','СТАНДАРТ','48',1);
INSERT INTO inventory_stock VALUES(1,101,'warehouse',3,1),(2,101,'boutique',1,0);
CREATE TABLE inventory_operations(operation_id TEXT PRIMARY KEY,operation_type TEXT,
 source_type TEXT,status TEXT);
CREATE TABLE inventory_movements(reference_id TEXT,reference_type TEXT,inventory_source TEXT,
 movement_type TEXT,variant_id INTEGER,quantity_delta INTEGER);
CREATE TABLE inventory_transfer_documents(id INTEGER PRIMARY KEY,request_id TEXT UNIQUE,
 from_source TEXT,to_source TEXT);
CREATE TABLE inventory_transfer_items(id INTEGER PRIMARY KEY,transfer_id INTEGER,
 variant_id INTEGER,quantity INTEGER);
`)
for(const path of [
 'migrations/0049_v72_inventory_stocktake_sessions.sql',
 'migrations/0136_barcode_physical_units_foundation.sql',
 'migrations/0137_barcode_unit_catalog_integrity.sql',
 'migrations/0138_barcode_unit_preparation_capacity.sql',
 'migrations/0140_barcode_stocktake_unit_scans.sql',
 'migrations/0141_barcode_outbound_unit_operations.sql',
]) sqlite.exec(readFileSync(path,'utf8'))
const prepared=(sql,params)=>({
 async first(){return sqlite.prepare(sql).get(...params)||null},
 async all(){return {results:sqlite.prepare(sql).all(...params)}},
 async run(){return {meta:{changes:sqlite.prepare(sql).run(...params).changes}}},
})
const db={
 prepare(sql){return {...prepared(sql,[]),bind(...args){return prepared(sql,args)}}},
 async batch(actions){
   sqlite.exec('BEGIN IMMEDIATE')
   try{
     const result=[]
     for(const action of actions)result.push(await action.run())
     sqlite.exec('COMMIT')
     return result
   }catch(error){sqlite.exec('ROLLBACK');throw error}
 },
}
const serial=n=>'44444444-4444-4444-8444-'+String(n).padStart(12,'0')
const sourceCount=point=>sqlite.prepare('SELECT quantity FROM inventory_stock WHERE inventory_source=?').get(point).quantity
const unit=uid=>sqlite.prepare('SELECT inventory_source,unit_status,coverage_status FROM inventory_units WHERE unit_id=?').get(uid)
const n=table=>sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n
const labels=await prepareUnitLabelBatch(db,{variantId:101,source:'warehouse',quantity:2,requestId:serial(1)},'admin')
const [first,second]=labels.labels
const boutiqueLabel=await prepareUnitLabelBatch(db,{variantId:101,source:'boutique',quantity:1,requestId:serial(2)},'admin')
assert.equal(normalizeOutboundUnitBarcodes([first.token.toLowerCase()])[0],first.token)
assert.deepEqual(normalizeOutboundUnitBarcodes(undefined),[])
assert.throws(()=>normalizeOutboundUnitBarcodes(['WRONG']),/индивидуальные/)
assert.throws(()=>normalizeOutboundUnitBarcodes([first.token,first.token]),/дважды/)
const normal=(mode,fromSource,toSource,operationId,tokens,maximum)=>prepareOutboundBarcodeStatements(db,{
 mode,fromSource,toSource,operationId,tokens:normalizeOutboundUnitBarcodes(tokens),
 maximumByVariant:new Map([[101,maximum]]),actor:'Завсклад',at:'2026-11-17T00:00:00Z',
})
await assert.rejects(normal('transfer','boutique','warehouse','bad-source',[first.token],1),/исходной точке/)
await assert.rejects(normal('writeoff','warehouse','none','bad-quantity',[first.token,second.token],1),/превышает/)
const before={w:sourceCount('warehouse'),b:sourceCount('boutique'),reserved:sqlite.prepare("SELECT reserved_quantity FROM inventory_stock WHERE id=1").get().reserved_quantity}
const move=await normal('transfer','warehouse','boutique','transfer-101',[first.token],1)
assert.equal(move.length,1)
await db.batch([
 db.prepare("INSERT INTO inventory_transfer_documents VALUES(1,'transfer-101','warehouse','boutique')"),
 db.prepare("INSERT INTO inventory_transfer_items VALUES(1,1,101,1)"),
 db.prepare("UPDATE inventory_stock SET quantity=quantity-1 WHERE inventory_source='warehouse'"),
 db.prepare("UPDATE inventory_stock SET quantity=quantity+1 WHERE inventory_source='boutique'"),
 ...move,
])
assert.equal(sourceCount('warehouse'),before.w-1)
assert.equal(sourceCount('boutique'),before.b+1)
assert.deepEqual(unit(first.unitId),{inventory_source:'boutique',unit_status:'on_hand',coverage_status:'linked'})
assert.deepEqual(unit(second.unitId),{inventory_source:'warehouse',unit_status:'unverified',coverage_status:'unlinked'})
assert.equal(n('inventory_outbound_unit_scans'),1)
assert.equal(n('inventory_unit_events'),3)
await assert.rejects(normal('transfer','warehouse','boutique','transfer-other',[first.token],1),/исходной точке/)
assert.throws(()=>sqlite.prepare("UPDATE inventory_outbound_unit_scans SET actor='edited' WHERE operation_id='transfer-101'").run(),/BARCODE_OUTBOUND_IMMUTABLE/)

const fail=await normal('writeoff','warehouse','none','writeoff-no-record',[second.token],1)
await assert.rejects(db.batch([
 db.prepare("UPDATE inventory_stock SET quantity=quantity-1 WHERE inventory_source='warehouse'"),
 ...fail,
]),/BARCODE_OUTBOUND_DOCUMENT_NOT_FOUND/)
assert.equal(sourceCount('warehouse'),before.w-1,'failed scan must roll back stock mutation')
assert.equal(n('inventory_outbound_unit_scans'),1)

const written=await normal('writeoff','warehouse','none','writeoff-one',[second.token],1)
await db.batch([
 db.prepare("INSERT INTO inventory_operations VALUES('writeoff-one','writeoff','warehouse','completed')"),
 db.prepare("UPDATE inventory_stock SET quantity=quantity-1 WHERE inventory_source='warehouse'"),
 db.prepare("INSERT INTO inventory_movements VALUES('writeoff-one','manual','warehouse','writeoff',101,-1)"),
 ...written,
])
assert.deepEqual(unit(second.unitId),{inventory_source:'none',unit_status:'not_stock',coverage_status:'excluded'})
assert.equal(sourceCount('warehouse'),before.w-2)
assert.equal(n('inventory_outbound_unit_scans'),2)
assert.equal(n('inventory_unit_events'),4)
await assert.rejects(normal('writeoff','warehouse','none','again',[second.token],1),/уже выбыла/)
const writtenAfterTransfer=await normal('writeoff','boutique','none','writeoff-boutique',[first.token],1)
await db.batch([
 db.prepare("INSERT INTO inventory_operations VALUES('writeoff-boutique','writeoff','boutique','completed')"),
 db.prepare("UPDATE inventory_stock SET quantity=quantity-1 WHERE inventory_source='boutique'"),
 db.prepare("INSERT INTO inventory_movements VALUES('writeoff-boutique','manual','boutique','writeoff',101,-1)"),
 ...writtenAfterTransfer,
])
assert.equal(unit(first.unitId).unit_status,'not_stock')
assert.equal(sourceCount('boutique'),before.b)
assert.equal(n('inventory_outbound_unit_scans'),3)
assert.equal(n('inventory_unit_events'),5)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_stock WHERE reserved_quantity<0').get().n,0)
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])

const worker=readFileSync('worker/domains/inventory-movement.ts','utf8')
const forms=readFileSync('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx','utf8')
const actions=readFileSync('src/features/inventory/inventoryMovementActions.ts','utf8')
assert(worker.includes('...transferBarcodeStatements')&&worker.includes('statements.push(...scans)'))
assert(worker.includes('|barcode:')&&actions.includes('unitBarcodes,'))
assert(forms.includes('scanOperationUnit()')&&forms.includes('p.onSave(scannedUnits.map(unit=>unit.code))'))
sqlite.close()
console.log('BARCODE TRANSFER + WRITEOFF PASS: atomic unit tracking, source/status guards, rollback, counted once, no double stock write')
