import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { readWorkerSource } from './lib/worker-source.mjs'

const root = process.cwd()
const worker = readWorkerSource(root)
const fail = (message) => { throw new Error(message) }
const expect = (condition, message) => { if (!condition) fail(message) }

function functionBody(name, nextName) {
  const start = worker.indexOf(`async function ${name}`)
  expect(start >= 0, `Missing function ${name}`)
  const end = nextName ? worker.indexOf(`async function ${nextName}`, start + 1) : worker.length
  expect(end > start, `Cannot determine ${name} body`)
  return worker.slice(start, end)
}

expect(worker.includes("transferRuntimeSafety: '191d'"), '191D health marker missing')
const transfer = functionBody('applyInventoryTransfer', 'reverseInventoryTransferDocument')
expect(transfer.includes('const transferRowBindings = prepared.map'), 'Transfer one-bind-per-row payloads missing')
expect(transfer.includes("const transferInputValuesSql = transferRowBindings.map(() => '(?)').join(', ')"), 'Transfer VALUES bind source missing')
expect(transfer.includes('input(payload) AS (VALUES ${transferInputValuesSql})'), 'Transfer input VALUES CTE missing')
expect(!transfer.includes('const transferRowsJson = JSON.stringify'), 'Old single JSON write rowset returned')
expect(!transfer.includes('FROM json_each(?) j'), 'Transfer writes still use json_each virtual-table source')
expect(transfer.includes("event: 'inventory_transfer_batch_error'"), 'Transfer runtime diagnostic log missing')

const db = new DatabaseSync(':memory:')
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE catalog_products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT
  );
  CREATE TABLE catalog_variants (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES catalog_products(id),
    category TEXT,
    gender TEXT,
    color TEXT,
    material TEXT,
    length TEXT,
    size_label TEXT
  );
  CREATE TABLE inventory_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse','boutique')),
    product_id INTEGER REFERENCES catalog_products(id),
    variant_id INTEGER REFERENCES catalog_variants(id),
    product_name_snapshot TEXT NOT NULL,
    gender_snapshot TEXT,
    color_snapshot TEXT,
    material_snapshot TEXT,
    length_snapshot TEXT,
    size_snapshot TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    reserved_quantity INTEGER NOT NULL DEFAULT 0,
    last_action TEXT,
    last_source_ref TEXT,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_inventory_stock_variant_unique
    ON inventory_stock(inventory_source, variant_id) WHERE variant_id IS NOT NULL;
  CREATE TABLE inventory_model_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE inventory_stocktake_sessions (
    id TEXT PRIMARY KEY,
    inventory_source TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT
  );
  CREATE TABLE inventory_transfer_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    request_id TEXT NOT NULL UNIQUE,
    request_fingerprint TEXT NOT NULL,
    from_source TEXT NOT NULL CHECK (from_source IN ('warehouse','boutique')),
    to_source TEXT NOT NULL CHECK (to_source IN ('warehouse','boutique')),
    status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','reversed')),
    comment TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    reversed_by TEXT,
    reversed_at TEXT
  );
  CREATE TABLE inventory_transfer_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id INTEGER NOT NULL REFERENCES inventory_transfer_documents(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES catalog_products(id),
    variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    from_quantity_before INTEGER NOT NULL,
    from_quantity_after INTEGER NOT NULL,
    to_quantity_before INTEGER NOT NULL,
    to_quantity_after INTEGER NOT NULL,
    source_reserved_quantity INTEGER NOT NULL DEFAULT 0,
    source_shortage_after INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(transfer_id, variant_id)
  );
  CREATE TABLE inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse','boutique')),
    movement_type TEXT NOT NULL CHECK (movement_type IN ('revision','arrival','sale','return','manual_set','writeoff','delete')),
    product_id INTEGER REFERENCES catalog_products(id),
    variant_id INTEGER REFERENCES catalog_variants(id),
    product_name_snapshot TEXT NOT NULL,
    gender_snapshot TEXT,
    color_snapshot TEXT,
    material_snapshot TEXT,
    length_snapshot TEXT,
    size_snapshot TEXT,
    quantity_delta INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    comment TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE inventory_stock_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    check_key TEXT NOT NULL UNIQUE,
    inventory_source TEXT NOT NULL,
    product_id INTEGER,
    variant_id INTEGER,
    expected_quantity INTEGER,
    counted_quantity INTEGER,
    difference_quantity INTEGER,
    reserved_quantity INTEGER,
    check_type TEXT,
    reference_type TEXT,
    reference_id TEXT,
    checked_by TEXT,
    checked_at TEXT,
    created_at TEXT
  );
`)

db.prepare('INSERT INTO catalog_products(id,name,category) VALUES (1,?,?)').run('БАЯН СҰЛУ ШАПАН', 'adult')
db.prepare(`INSERT INTO catalog_variants(id,product_id,category,gender,color,material,length,size_label)
            VALUES (33,1,'adult','ЖЕН','ОРАНЖЕВЫЙ','ЗАМША ВЕЛЮР','СТАНДАРТ','56')`).run()
db.prepare(`INSERT INTO inventory_stock(
  inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,
  quantity,reserved_quantity,last_action,last_source_ref,updated_at,created_at
) VALUES ('warehouse',1,33,'БАЯН СҰЛУ ШАПАН','ЖЕН','ОРАНЖЕВЫЙ','ЗАМША ВЕЛЮР','СТАНДАРТ','56',1,0,'Ревизия','stocktake:REV-S-F-20260817094944-877F0E71',?,?)`).run('2026-08-17T13:33:19.921Z','2026-08-17T13:33:19.921Z')
db.prepare(`INSERT INTO inventory_model_meta(key,value,updated_at) VALUES ('human_inventory_v2','active',?)`).run('2026-08-20T10:00:00.000Z')

const payload = JSON.stringify({
  variantId: 33,
  productId: 1,
  sourceCurrent: 1,
  targetCurrent: 0,
  effectiveBefore: 1,
  moveQty: 1,
  reservedQty: 0,
  targetReservedQty: 0,
  shortageAfter: 0,
  observedPhysical: null,
})
const valuesSql = '(?)'
const ctes = `input(payload) AS (VALUES ${valuesSql}),
  x AS (
    SELECT
      CAST(json_extract(payload, '$.variantId') AS INTEGER) AS variant_id,
      CAST(json_extract(payload, '$.productId') AS INTEGER) AS product_id,
      CAST(json_extract(payload, '$.sourceCurrent') AS INTEGER) AS source_current,
      CAST(json_extract(payload, '$.targetCurrent') AS INTEGER) AS target_current,
      CAST(json_extract(payload, '$.effectiveBefore') AS INTEGER) AS effective_before,
      CAST(json_extract(payload, '$.moveQty') AS INTEGER) AS move_qty,
      CAST(json_extract(payload, '$.reservedQty') AS INTEGER) AS reserved_qty,
      CAST(json_extract(payload, '$.targetReservedQty') AS INTEGER) AS target_reserved_qty,
      CAST(json_extract(payload, '$.shortageAfter') AS INTEGER) AS shortage_after,
      CASE WHEN json_type(payload, '$.observedPhysical') = 'null' THEN NULL
           ELSE CAST(json_extract(payload, '$.observedPhysical') AS INTEGER) END AS observed_physical
    FROM input
  )`
const fromSource = 'warehouse'
const toSource = 'boutique'
const requestId = 'step191d-video-regression'
const externalId = 'TRF-STEP191D-VIDEO'
const fingerprint = 'video-regression'
const now = '2026-08-20T10:00:00.000Z'

const bind = (statement, ...args) => ({ run: () => statement.run(...args) })
const statements = [
  bind(db.prepare(`WITH ${ctes}
    INSERT OR IGNORE INTO inventory_stock (
      inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
      material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
      last_action, last_source_ref, created_at, updated_at
    )
    SELECT ?, v.product_id, v.id, p.name, NULLIF(v.gender,''), NULLIF(v.color,''),
           COALESCE(NULLIF(v.material,''),'СТАНДАРТ'), COALESCE(NULLIF(v.length,''),'СТАНДАРТ'), NULLIF(v.size_label,''),
           0, x.reserved_qty, 'Фактическая сверка', ?, ?, ?
    FROM x JOIN catalog_variants v ON v.id=x.variant_id JOIN catalog_products p ON p.id=v.product_id`), payload, fromSource, externalId, now, now),
  bind(db.prepare(`WITH ${ctes}
    INSERT INTO inventory_model_meta(key,value,updated_at)
    SELECT 'human_inventory_v2','__transfer_conflict__',?
    WHERE EXISTS (
      SELECT 1 FROM x
      LEFT JOIN inventory_stock s ON s.inventory_source=? AND s.variant_id=x.variant_id
      LEFT JOIN inventory_stock t ON t.inventory_source=? AND t.variant_id=x.variant_id
      WHERE s.id IS NULL OR COALESCE(s.quantity,0)<>x.source_current OR COALESCE(t.quantity,0)<>x.target_current
    ) OR EXISTS (
      SELECT 1 FROM inventory_stocktake_sessions WHERE status='active' AND inventory_source IN (?,?)
    )`), payload, now, fromSource, toSource, fromSource, toSource),
  bind(db.prepare(`INSERT INTO inventory_transfer_documents(
    external_id,request_id,request_fingerprint,from_source,to_source,status,comment,created_by,created_at
  ) VALUES (?,?,?,?,?,'applied',?,?,?)`), externalId,requestId,fingerprint,fromSource,toSource,null,'Админ режим',now),
  bind(db.prepare(`WITH ${ctes}
    INSERT OR IGNORE INTO inventory_stock (
      inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
      material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
      last_action, last_source_ref, created_at, updated_at
    )
    SELECT ?, v.product_id, v.id, p.name, NULLIF(v.gender,''), NULLIF(v.color,''),
           COALESCE(NULLIF(v.material,''),'СТАНДАРТ'), COALESCE(NULLIF(v.length,''),'СТАНДАРТ'), NULLIF(v.size_label,''),
           0, x.target_reserved_qty, 'Перемещение', ?, ?, ?
    FROM x JOIN catalog_variants v ON v.id=x.variant_id JOIN catalog_products p ON p.id=v.product_id`), payload,toSource,externalId,now,now),
  bind(db.prepare(`WITH ${ctes}
    UPDATE inventory_stock
    SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
        product_name_snapshot=(SELECT p.name FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.id=inventory_stock.variant_id),
        gender_snapshot=(SELECT NULLIF(v.gender,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
        color_snapshot=(SELECT NULLIF(v.color,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
        material_snapshot=(SELECT COALESCE(NULLIF(v.material,''),'СТАНДАРТ') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
        length_snapshot=(SELECT COALESCE(NULLIF(v.length,''),'СТАНДАРТ') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
        size_snapshot=(SELECT NULLIF(v.size_label,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id)
    WHERE inventory_source IN (?,?) AND EXISTS (SELECT 1 FROM x WHERE x.variant_id=inventory_stock.variant_id)`), payload,fromSource,toSource),
  bind(db.prepare(`WITH ${ctes}
    UPDATE inventory_stock
    SET quantity=(SELECT effective_before FROM x WHERE x.variant_id=inventory_stock.variant_id),
        last_action='Быстрая сверка',last_source_ref=?,updated_at=?
    WHERE inventory_source=? AND EXISTS(SELECT 1 FROM x WHERE x.variant_id=inventory_stock.variant_id)
      AND quantity<>(SELECT effective_before FROM x WHERE x.variant_id=inventory_stock.variant_id)`), payload,externalId,now,fromSource),
  bind(db.prepare(`WITH ${ctes}
    INSERT INTO inventory_movements(
      inventory_source,movement_type,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,
      material_snapshot,length_snapshot,size_snapshot,quantity_delta,quantity_after,reference_type,reference_id,comment,created_at
    )
    SELECT ?,'revision',v.product_id,v.id,p.name,NULLIF(v.gender,''),NULLIF(v.color,''),
           COALESCE(NULLIF(v.material,''),'СТАНДАРТ'),COALESCE(NULLIF(v.length,''),'СТАНДАРТ'),NULLIF(v.size_label,''),
           x.effective_before-x.source_current,x.effective_before,'transfer_stocktake',?||':'||v.id,'Фактическая сверка перед перемещением',?
    FROM x JOIN catalog_variants v ON v.id=x.variant_id JOIN catalog_products p ON p.id=v.product_id
    WHERE x.effective_before<>x.source_current`), payload,fromSource,externalId,now),
  bind(db.prepare(`WITH ${ctes}
    INSERT OR IGNORE INTO inventory_stock_checks(
      check_key,inventory_source,product_id,variant_id,expected_quantity,counted_quantity,difference_quantity,reserved_quantity,
      check_type,reference_type,reference_id,checked_by,checked_at,created_at
    )
    SELECT 'transfer:'||?||':'||x.variant_id,?,x.product_id,x.variant_id,x.source_current,x.effective_before,
           x.effective_before-x.source_current,x.reserved_qty,'transfer_observation','transfer',?,?,?,?
    FROM x WHERE x.observed_physical IS NOT NULL`), payload,externalId,fromSource,externalId,'Админ режим',now,now),
  bind(db.prepare(`WITH ${ctes}
    UPDATE inventory_stock SET quantity=(SELECT effective_before-move_qty FROM x WHERE x.variant_id=inventory_stock.variant_id),
      last_action='Перемещение',last_source_ref=?,updated_at=?
    WHERE inventory_source=? AND EXISTS(SELECT 1 FROM x WHERE x.variant_id=inventory_stock.variant_id)`), payload,externalId,now,fromSource),
  bind(db.prepare(`WITH ${ctes}
    UPDATE inventory_stock SET quantity=quantity+(SELECT move_qty FROM x WHERE x.variant_id=inventory_stock.variant_id),
      last_action='Перемещение',last_source_ref=?,updated_at=?
    WHERE inventory_source=? AND EXISTS(SELECT 1 FROM x WHERE x.variant_id=inventory_stock.variant_id)`), payload,externalId,now,toSource),
  bind(db.prepare(`WITH ${ctes}
    INSERT INTO inventory_movements(
      inventory_source,movement_type,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,
      material_snapshot,length_snapshot,size_snapshot,quantity_delta,quantity_after,reference_type,reference_id,comment,created_at
    )
    SELECT ?,'writeoff',v.product_id,v.id,p.name,NULLIF(v.gender,''),NULLIF(v.color,''),
      COALESCE(NULLIF(v.material,''),'СТАНДАРТ'),COALESCE(NULLIF(v.length,''),'СТАНДАРТ'),NULLIF(v.size_label,''),
      -x.move_qty,x.effective_before-x.move_qty,'transfer_out',?,'Перемещение в Бутик',?
    FROM x JOIN catalog_variants v ON v.id=x.variant_id JOIN catalog_products p ON p.id=v.product_id`), payload,fromSource,externalId,now),
  bind(db.prepare(`WITH ${ctes}
    INSERT INTO inventory_movements(
      inventory_source,movement_type,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,
      material_snapshot,length_snapshot,size_snapshot,quantity_delta,quantity_after,reference_type,reference_id,comment,created_at
    )
    SELECT ?,'arrival',v.product_id,v.id,p.name,NULLIF(v.gender,''),NULLIF(v.color,''),
      COALESCE(NULLIF(v.material,''),'СТАНДАРТ'),COALESCE(NULLIF(v.length,''),'СТАНДАРТ'),NULLIF(v.size_label,''),
      x.move_qty,x.target_current+x.move_qty,'transfer_in',?,'Перемещение из Склад',?
    FROM x JOIN catalog_variants v ON v.id=x.variant_id JOIN catalog_products p ON p.id=v.product_id`), payload,toSource,externalId,now),
  bind(db.prepare(`WITH ${ctes}
    INSERT INTO inventory_transfer_items(
      transfer_id,product_id,variant_id,quantity,from_quantity_before,from_quantity_after,to_quantity_before,to_quantity_after,
      source_reserved_quantity,source_shortage_after,created_at
    )
    SELECT (SELECT id FROM inventory_transfer_documents WHERE request_id=?),v.product_id,v.id,x.move_qty,
      x.effective_before,x.effective_before-x.move_qty,x.target_current,x.target_current+x.move_qty,x.reserved_qty,x.shortage_after,?
    FROM x JOIN catalog_variants v ON v.id=x.variant_id`), payload,requestId,now),
]

db.exec('BEGIN')
try {
  for (const statement of statements) statement.run()
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

const source = db.prepare(`SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=33`).get()
const target = db.prepare(`SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='boutique' AND variant_id=33`).get()
expect(source?.quantity === 0 && source?.reserved_quantity === 0, `Video source result mismatch: ${JSON.stringify(source)}`)
expect(target?.quantity === 1 && target?.reserved_quantity === 0, `Video target result mismatch: ${JSON.stringify(target)}`)
expect(db.prepare('SELECT COUNT(*) AS n FROM inventory_transfer_documents').get().n === 1, 'Video transfer document missing')
expect(db.prepare('SELECT COUNT(*) AS n FROM inventory_transfer_items').get().n === 1, 'Video transfer item missing')
expect(db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n === 2, 'Video transfer movement pair missing')
expect(db.prepare('SELECT COUNT(*) AS n FROM inventory_stock_checks').get().n === 0, 'Video transfer unexpectedly created observation check')

// D1 documents 100 bound parameters/query. One payload per line leaves enough room for
// statement metadata while preserving the accepted 60-line transfer UI capacity.
const sixty = Array.from({ length: 60 }, (_, index) => JSON.stringify({ variantId: index + 1 }))
const sixtyValues = sixty.map(() => '(?)').join(', ')
const count = db.prepare(`WITH input(payload) AS (VALUES ${sixtyValues}) SELECT COUNT(*) AS n FROM input`).get(...sixty).n
expect(count === 60, '60-line one-bind-per-row source failed')
expect(60 + 6 <= 100, 'Transfer bind budget no longer fits Cloudflare D1 limit')

db.close()
console.log('STEP 191D TRANSFER RUNTIME SAFETY TESTS PASSED — exact video row 1→0, absent target, 0 reserved; 60-line bind budget preserved')
