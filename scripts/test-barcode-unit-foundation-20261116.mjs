import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { generateUnitBarcode, isUnitBarcode, unitBarcodeFromEntropy } from '../shared/barcode-unit.ts'
import { encodeCode128B } from '../shared/barcode-code128.ts'

const known=unitBarcodeFromEntropy(new Uint8Array(8))
assert.equal(isUnitBarcode(known),true)
assert.equal(isUnitBarcode(' ' + known.toLowerCase() + ' '),true)
assert.equal(isUnitBarcode(known.slice(0,-1)+(known.endsWith('A')?'B':'A')),false)
assert.equal(isUnitBarcode('OCS1-'+known.slice(5)),false)
assert.throws(()=>unitBarcodeFromEntropy(new Uint8Array(7)))
assert.throws(()=>unitBarcodeFromEntropy(new Uint8Array(9)))
const sample=new Set()
for(let i=0;i<500;i++) {
  const token=generateUnitBarcode()
  assert(isUnitBarcode(token))
  assert(!sample.has(token),'Unexpected duplicate random unit barcode')
  sample.add(token)
  assert(encodeCode128B(token).bars.length>15)
}
assert.equal(sample.size,500)

const db=new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON')
db.exec('CREATE TABLE catalog_variants (id INTEGER PRIMARY KEY,is_active INTEGER NOT NULL);')
db.exec('INSERT INTO catalog_variants VALUES (1,1),(2,0);')
db.exec('CREATE TABLE inventory_stock (variant_id INTEGER,inventory_source TEXT,quantity INTEGER NOT NULL);')
db.exec("INSERT INTO inventory_stock VALUES (1,'warehouse',7);")
const migration=readFileSync('migrations/0136_barcode_physical_units_foundation.sql','utf8')
assert(!/UPDATE\s+inventory_stock|DELETE\s+FROM\s+inventory_stock|INSERT\s+INTO\s+inventory_stock/i.test(migration))
assert(!/UPDATE\s+inventory_reservations|UPDATE\s+order_items/i.test(migration))
db.exec(migration)
db.exec(migration)
const date='2026-11-16T16:00:00Z'
db.prepare('INSERT INTO inventory_units (unit_id,original_variant_id,variant_id,origin_kind,origin_ref,inventory_source,unit_status,coverage_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
 .run('unit-1',1,1,'existing_stock','test-unit','warehouse','on_hand','linked',date,date)
assert.equal(db.prepare('SELECT quantity FROM inventory_stock').get().quantity,7)
assert.throws(()=>db.prepare("INSERT INTO inventory_units (unit_id,variant_id,origin_kind,inventory_source,unit_status,coverage_status,created_at,updated_at) VALUES ('wrong-source',1,'arrival','customer','on_hand','linked',?,?)").run(date,date))
assert.throws(()=>db.prepare("INSERT INTO inventory_units (unit_id,variant_id,origin_kind,inventory_source,unit_status,coverage_status,created_at,updated_at) VALUES ('unknown-sku',99,'arrival','warehouse','on_hand','linked',?,?)").run(date,date))
const a=generateUnitBarcode(),b=generateUnitBarcode()
db.prepare('INSERT INTO inventory_unit_labels (token,unit_id,label_version,created_at) VALUES (?,?,?,?)').run(a,'unit-1',1,date)
assert.throws(()=>db.prepare('INSERT INTO inventory_unit_labels (token,unit_id,label_version,created_at) VALUES (?,?,?,?)').run(b,'unit-1',2,date))
db.prepare("UPDATE inventory_unit_labels SET state='revoked',revoked_at=? WHERE token=? AND state='active'").run(date,a)
db.prepare('INSERT INTO inventory_unit_labels (token,unit_id,label_version,created_at) VALUES (?,?,?,?)').run(b,'unit-1',2,date)
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_unit_labels WHERE unit_id='unit-1' AND state='active'").get().n,1)
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_unit_labels WHERE unit_id='unit-1' AND state='revoked'").get().n,1)
db.prepare("INSERT INTO inventory_unit_events(event_id,unit_id,operation_key,action_type,created_at) VALUES('event-1','unit-1','origin:unit-1','verified',?)").run(date)
assert.throws(()=>db.prepare("INSERT INTO inventory_unit_events(event_id,unit_id,operation_key,action_type,created_at) VALUES('event-2','unit-1','origin:unit-1','verified',?)").run(date))
db.prepare("UPDATE catalog_variants SET is_active=0 WHERE id=1").run()
assert.equal(db.prepare('SELECT variant_id FROM inventory_units WHERE unit_id=?').get('unit-1').variant_id,1)
assert.equal(db.prepare('SELECT quantity FROM inventory_stock').get().quantity,7)
db.close()
console.log('BARCODE UNIT FOUNDATION PASS: 64-bit random labels, one active token, idempotent events, retired provenance, zero stock mutations')
