import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const read=p=>readFileSync('migrations/'+p,'utf8')
const m110=read('0110_v72_exchange_order_item_price_correction_audit.sql')
const m111=read('0111_v72_admin_order_delete_saga_journal.sql')
const m112=read('0112_v72_order_client_name_override.sql')
assert(m110.includes('CREATE TABLE IF NOT EXISTS exchange_order_item_price_corrections'))
assert(m111.includes('CREATE TABLE IF NOT EXISTS admin_order_delete_sagas'))
assert(m111.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_delete_active_saga_order'))
assert(m112.includes('ALTER TABLE orders ADD COLUMN customer_name_override TEXT'))
assert(m112.includes('COALESCE(NEW.customer_name_override'))
assert(!/\b(UPDATE|DELETE)\s+(orders|payments|inventory_stock)\b/i.test(m110+'\n'+m111))
const db=new DatabaseSync(':memory:')
db.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_date TEXT,manager_id INTEGER,
 customer_id INTEGER,city TEXT,delivery_type TEXT,comment TEXT,total_amount INTEGER,received_amount INTEGER,debt_amount INTEGER);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER);
CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER);
CREATE TABLE managers(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE customers(id INTEGER PRIMARY KEY,phone_normalized TEXT,display_name TEXT);
CREATE VIRTUAL TABLE order_search_orders_fts USING fts5(order_id UNINDEXED,search_text);
INSERT INTO managers VALUES(1,'Manager');
INSERT INTO customers VALUES(2,'77001234567','Original Customer');
INSERT INTO orders VALUES(10,'ORD-10','2026-10-18',1,2,'Almaty','Courier','note',25000,25000,0);
`)
db.exec(m110);db.exec(m111);db.exec(m112)
assert.equal(db.prepare("SELECT COUNT(*) n FROM pragma_table_info('orders') WHERE name='customer_name_override'").get().n,1)
// This is a derived search index only. Editing one order's display name must
// not mutate shared customer details nor its commercial ledger.
assert.match(db.prepare('SELECT search_text FROM order_search_orders_fts WHERE rowid=10').get().search_text,/Original Customer/)
db.exec("UPDATE orders SET customer_name_override='Specific Customer' WHERE id=10")
assert.match(db.prepare('SELECT search_text FROM order_search_orders_fts WHERE rowid=10').get().search_text,/Specific Customer/)
assert.equal(db.prepare('SELECT display_name FROM customers WHERE id=2').get().display_name,'Original Customer')
assert.equal(db.prepare('SELECT total_amount FROM orders WHERE id=10').get().total_amount,25000)
assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name IN ('exchange_order_price_history_immutable_update','exchange_order_price_history_immutable_delete')").get().n,2)
db.exec(m110);db.exec(m111)
assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('admin_order_delete_sagas','admin_order_delete_saga_steps')").get().n,2)
console.log('MAIN_ORDER_EDITOR_DELETE_0110_0111_0112_SCHEMA_AND_FTS_FK_SAFETY_PASSED')
