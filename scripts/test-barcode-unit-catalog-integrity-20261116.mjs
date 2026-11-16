import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = ON')
db.exec(`
  CREATE TABLE catalog_products (id INTEGER PRIMARY KEY, is_active INTEGER NOT NULL);
  CREATE TABLE catalog_stock_positions (id INTEGER PRIMARY KEY, product_id INTEGER, is_active INTEGER NOT NULL);
  CREATE TABLE catalog_variants (
    id INTEGER PRIMARY KEY, product_id INTEGER, stock_position_id INTEGER,
    category TEXT, gender TEXT, color TEXT, material TEXT, length TEXT, size_label TEXT,
    is_active INTEGER NOT NULL
  );
  CREATE TABLE inventory_stock (variant_id INTEGER, source TEXT, quantity INTEGER);
  INSERT INTO catalog_products VALUES (1,1), (2,1);
  INSERT INTO catalog_stock_positions VALUES (10,1,1), (20,2,1);
  INSERT INTO catalog_variants VALUES
    (101,1,10,'adult','МУЖ','БЕЛЫЙ','СТАНДАРТ','СТАНДАРТ','44',1),
    (102,1,10,'adult','МУЖ','БЕЛЫЙ','СТАНДАРТ','СТАНДАРТ','44',1),
    (103,2,20,'adult','МУЖ','ХАКИ','СТАНДАРТ','СТАНДАРТ','46',1);
  INSERT INTO inventory_stock VALUES (101,'warehouse',7);
`)
db.exec(readFileSync('migrations/0136_barcode_physical_units_foundation.sql', 'utf8'))
const integrity = readFileSync('migrations/0137_barcode_unit_catalog_integrity.sql', 'utf8')
db.exec(integrity)
db.exec(integrity)

const stamp = '2026-11-16T12:00:00Z'
const createUnit = db.prepare(`
  INSERT INTO inventory_units
    (unit_id, original_variant_id, variant_id, origin_kind, inventory_source,
     unit_status, coverage_status, created_at, updated_at)
  VALUES (?, ?, ?, 'arrival', 'warehouse', 'on_hand', 'linked', ?, ?)
`)
createUnit.run('unit-1', 101, 101, stamp, stamp)
const before = db.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=101').get().quantity

assert.throws(() => db.exec('UPDATE catalog_variants SET is_active=0 WHERE id=101'), /BARCODE_UNIT_VARIANT_IN_USE/)
assert.throws(() => db.exec('UPDATE catalog_products SET is_active=0 WHERE id=1'), /BARCODE_UNIT_PRODUCT_IN_USE/)
assert.throws(() => db.exec('UPDATE catalog_stock_positions SET is_active=0 WHERE id=10'), /BARCODE_UNIT_EXECUTION_IN_USE/)
assert.throws(() => db.exec("UPDATE catalog_variants SET color='ХАКИ' WHERE id=101"), /BARCODE_UNIT_VARIANT_IDENTITY_LOCKED/)
assert.throws(() => db.exec('DELETE FROM catalog_variants WHERE id=101'), /BARCODE_UNIT_VARIANT_HISTORY/)
assert.throws(() => db.exec('UPDATE inventory_units SET original_variant_id=102 WHERE unit_id=\'unit-1\''), /BARCODE_UNIT_ORIGIN_IMMUTABLE/)

db.exec("INSERT INTO inventory_unit_labels (token,unit_id,label_version,state,created_at) VALUES ('OCU1-TEST-1','unit-1',1,'active','2026-11-16')")
assert.throws(() => db.exec("UPDATE inventory_unit_labels SET unit_id='other' WHERE token='OCU1-TEST-1'"), /BARCODE_UNIT_LABEL_IDENTITY/)
db.exec("UPDATE inventory_unit_labels SET state='revoked',revoked_at='2026-11-16',revoke_reason='lost' WHERE token='OCU1-TEST-1'")
assert.throws(() => db.exec("UPDATE inventory_unit_labels SET state='active' WHERE token='OCU1-TEST-1'"), /BARCODE_UNIT_LABEL_REVOKED/)
db.exec("INSERT INTO inventory_unit_labels (token,unit_id,label_version,state,created_at) VALUES ('OCU1-TEST-2','unit-1',2,'active','2026-11-16')")
assert.throws(() => db.exec("INSERT INTO inventory_unit_labels (token,unit_id,label_version,state,created_at) VALUES ('OCU1-TEST-3','unit-1',3,'active','2026-11-16')"), /UNIQUE/)

db.exec("INSERT INTO inventory_unit_events (event_id,unit_id,operation_key,action_type,created_at) VALUES ('evt-1','unit-1','op-1','label_registered','2026-11-16')")
assert.throws(() => db.exec("UPDATE inventory_unit_events SET action_type='changed' WHERE event_id='evt-1'"), /BARCODE_UNIT_EVENT_IMMUTABLE/)
assert.throws(() => db.exec("DELETE FROM inventory_unit_events WHERE event_id='evt-1'"), /BARCODE_UNIT_EVENT_IMMUTABLE/)
assert.throws(() => db.exec("INSERT INTO inventory_unit_events (event_id,unit_id,operation_key,action_type,created_at) VALUES ('evt-2','unit-1','op-1','repeat','2026-11-16')"), /UNIQUE/)

db.exec("UPDATE inventory_units SET variant_id=102,version=version+1 WHERE unit_id='unit-1'")
db.exec('UPDATE catalog_variants SET is_active=0 WHERE id=101')
assert.throws(() => createUnit.run('unit-2', 101, 101, stamp, stamp), /BARCODE_UNIT_ON_HAND_SKU_INACTIVE/)
assert.throws(() => db.exec("UPDATE catalog_variants SET size_label='45' WHERE id=101"), /BARCODE_UNIT_VARIANT_IDENTITY_LOCKED/)
assert.equal(db.prepare("SELECT original_variant_id FROM inventory_units WHERE unit_id='unit-1'").get().original_variant_id, 101)
assert.equal(db.prepare("SELECT variant_id FROM inventory_units WHERE unit_id='unit-1'").get().variant_id, 102)

db.exec('UPDATE catalog_variants SET is_active=1 WHERE id=101')
assert.equal(db.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=101').get().quantity, before)
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM inventory_unit_events').get().count, 1)
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
db.close()

console.log('BARCODE UNIT INTEGRITY PASS: no orphaned active variants, durable original SKU, immutable events and labels, untouched stock')
