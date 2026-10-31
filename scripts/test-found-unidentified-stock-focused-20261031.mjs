import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createInventoryStocktakeSession, saveInventoryStocktakeCount, completeInventoryStocktakeSession, reconcileFoundInventoryStock} from '../worker/domains/inventory-stocktake.ts'

class TestD1Statement {
  constructor(owner, sql, bindings = []) {
    this.owner = owner
    this.sql = sql
    this.bindings = bindings
  }

  bind(...bindings) {
    return new TestD1Statement(this.owner, this.sql, bindings)
  }

  async first() {
    return this.owner.sqlite.prepare(this.sql).get(...this.bindings) ?? null
  }

  async all() {
    return { results: this.owner.sqlite.prepare(this.sql).all(...this.bindings) }
  }

  async run() {
    return this.runSync()
  }

  runSync() {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.bindings)
    return {
      success: true,
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    }
  }
}

class TestD1Database {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:')
    this.beforeNextBatch = null
    this.sqlite.exec('PRAGMA foreign_keys = ON;')
  }

  prepare(sql) {
    return new TestD1Statement(this, sql)
  }

  async batch(statements) {
    const before = this.beforeNextBatch
    this.beforeNextBatch = null
    if (before) await before(this)

    this.sqlite.exec('BEGIN IMMEDIATE;')
    try {
      const results = statements.map((statement) => statement.runSync())
      this.sqlite.exec('COMMIT;')
      return results
    } catch (error) {
      try { this.sqlite.exec('ROLLBACK;') } catch {}
      throw error
    }
  }

  exec(sql) {
    this.sqlite.exec(sql)
  }

  run(sql, ...bindings) {
    return this.sqlite.prepare(sql).run(...bindings)
  }

  row(sql, ...bindings) {
    return this.sqlite.prepare(sql).get(...bindings) ?? null
  }

  rows(sql, ...bindings) {
    return this.sqlite.prepare(sql).all(...bindings)
  }
}

function installSchema(db) {
  db.exec(`
    CREATE TABLE catalog_products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'adult',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE catalog_variants (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES catalog_products(id),
      stock_position_id INTEGER,
      category TEXT NOT NULL DEFAULT 'adult',
      gender TEXT,
      color TEXT,
      material TEXT,
      length TEXT,
      size_label TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE inventory_lifecycle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,
      inventory_source TEXT NOT NULL,
      variant_id INTEGER REFERENCES catalog_variants(id),
      is_workshop INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      pending_reason TEXT,
      resolution_comment TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      cancelled_at TEXT
    );

    CREATE TABLE inventory_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse', 'boutique')),
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
      created_at TEXT,
      updated_at TEXT,
      UNIQUE (inventory_source, variant_id)
    );

    CREATE TABLE inventory_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_source TEXT NOT NULL,
      variant_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE inventory_model_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );

    INSERT INTO inventory_model_meta (key, value) VALUES ('human_inventory_v2', 'enabled');

    CREATE TABLE inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_source TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      product_id INTEGER,
      variant_id INTEGER,
      product_name_snapshot TEXT,
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

    CREATE TABLE inventory_stocktake_sessions (
      id TEXT PRIMARY KEY,
      inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse', 'boutique')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
      created_by TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      cancelled_at TEXT
    );

    CREATE UNIQUE INDEX uq_inventory_stocktake_active_source
      ON inventory_stocktake_sessions(inventory_source)
      WHERE status = 'active';

    CREATE TABLE inventory_stocktake_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES inventory_stocktake_sessions(id) ON DELETE CASCADE,
      inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse', 'boutique')),
      stock_id INTEGER REFERENCES inventory_stock(id),
      product_id INTEGER REFERENCES catalog_products(id),
      variant_id INTEGER REFERENCES catalog_variants(id),
      product_name_snapshot TEXT NOT NULL,
      category_snapshot TEXT,
      gender_snapshot TEXT,
      color_snapshot TEXT,
      material_snapshot TEXT,
      length_snapshot TEXT,
      size_snapshot TEXT,
      opening_quantity INTEGER NOT NULL DEFAULT 0,
      opening_reserved_quantity INTEGER NOT NULL DEFAULT 0,
      baseline_quantity INTEGER NOT NULL DEFAULT 0,
      counted_quantity INTEGER,
      counted_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'counted', 'recount_required', 'applied')),
      conflict_quantity INTEGER,
      applied_quantity INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX uq_inventory_stocktake_item_stock
      ON inventory_stocktake_items(session_id, stock_id)
      WHERE stock_id IS NOT NULL;
    CREATE UNIQUE INDEX uq_inventory_stocktake_item_variant
      ON inventory_stocktake_items(session_id, variant_id)
      WHERE variant_id IS NOT NULL;

    CREATE TABLE inventory_stock_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      check_key TEXT UNIQUE,
      inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse', 'boutique')),
      product_id INTEGER REFERENCES catalog_products(id),
      variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
      expected_quantity INTEGER NOT NULL,
      counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
      difference_quantity INTEGER NOT NULL,
      reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
      check_type TEXT NOT NULL,
      reference_type TEXT,
      reference_id TEXT,
      checked_by TEXT,
      checked_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
}



async function main() {
  const db=new TestD1Database()
  installSchema(db)
  db.run("INSERT INTO catalog_products(id,name,category,is_active) VALUES(999,'CI FOUND UNKNOWN','adult',1)")
  const started=await createInventoryStocktakeSession(db,{source:'warehouse'},'qa')
  const sessionId=started.session.id
  assert(sessionId)
  const now='2026-10-31T13:00:00Z'
  const stock=db.run("INSERT INTO inventory_stock(inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity,last_action,last_source_ref,created_at,updated_at) VALUES('warehouse',999,NULL,'CI FOUND UNKNOWN','ЖЕН','НЕИЗВЕСТНЫЙ','СТАНДАРТ','СТАНДАРТ','97',0,0,'Найдено при проверке',?,?,?)",'stocktake-unresolved:adult:'+sessionId,now,now)
  const stockId=Number(stock.lastInsertRowid)
  assert(stockId>0)
  const line=db.run("INSERT INTO inventory_stocktake_items(session_id,inventory_source,stock_id,product_id,variant_id,product_name_snapshot,category_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,opening_quantity,opening_reserved_quantity,baseline_quantity,status,created_at,updated_at) VALUES(?,'warehouse',?,999,NULL,'CI FOUND UNKNOWN','adult','ЖЕН','НЕИЗВЕСТНЫЙ','СТАНДАРТ','СТАНДАРТ','97',0,0,0,'pending',?,?)",sessionId,stockId,now,now)
  const itemId=Number(line.lastInsertRowid)
  const count=await saveInventoryStocktakeCount(db,sessionId,itemId,{countedQuantity:1})
  assert.equal(count.ok,true)
  const done=await completeInventoryStocktakeSession(db,sessionId)
  assert.equal(done.ok,true)
  assert.equal(done.unresolvedFoundCount,1)
  assert.equal(db.row('SELECT quantity FROM inventory_stock WHERE id=?',stockId)?.quantity,1)
  const noMatch=await reconcileFoundInventoryStock(db,stockId)
  assert.equal(noMatch.code,'identity_unresolved')
  assert.equal(db.row('SELECT variant_id FROM inventory_stock WHERE id=?',stockId)?.variant_id,null)
  assert.equal(db.row('SELECT COUNT(*) AS n FROM catalog_variants WHERE product_id=999')?.n,0)
  db.run("INSERT INTO catalog_variants(id,product_id,category,gender,color,material,length,size_label,is_active) VALUES(9991,999,'adult','ЖЕН','НЕИЗВЕСТНЫЙ','СТАНДАРТ','СТАНДАРТ','97',1)")
  const resolved=await reconcileFoundInventoryStock(db,stockId)
  assert.equal(resolved.ok,true)
  assert.equal(resolved.variantId,9991)
  assert.equal(db.row('SELECT quantity FROM inventory_stock WHERE id=?',stockId)?.quantity,1)
  assert.equal(db.row('SELECT variant_id FROM inventory_stock WHERE id=?',stockId)?.variant_id,9991)
  const retry=await reconcileFoundInventoryStock(db,stockId)
  assert.equal(retry.ok,true)
  assert.equal(retry.already,true)
  assert.equal(db.row('SELECT COUNT(*) AS n FROM inventory_movements WHERE variant_id=9991')?.n,0)
  db.run("INSERT INTO catalog_variants(id,product_id,category,gender,color,material,length,size_label,is_active) VALUES(9992,999,'adult','ЖЕН','НЕИЗВЕСТНЫЙ','СТАНДАРТ','СТАНДАРТ','97',1)")
  const newRow=db.run("INSERT INTO inventory_stock(inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity,last_action,last_source_ref,created_at,updated_at) VALUES('boutique',999,NULL,'CI FOUND UNKNOWN','ЖЕН','НЕИЗВЕСТНЫЙ','СТАНДАРТ','СТАНДАРТ','97',1,0,'Найдено при проверке','stocktake-unresolved:adult:qa',?,?)",now,now)
  const unknownId=Number(newRow.lastInsertRowid)
  const ambiguous=await reconcileFoundInventoryStock(db,unknownId)
  assert.equal(ambiguous.code,'identity_ambiguous')
  assert.equal(db.row('SELECT variant_id FROM inventory_stock WHERE id=?',unknownId)?.variant_id,null)
  db.run('UPDATE inventory_stock SET reserved_quantity=1 WHERE id=?',unknownId)
  const reserved=await reconcileFoundInventoryStock(db,unknownId)
  assert.equal(reserved.code,'identity_has_reservations')
  assert.equal(db.row('SELECT quantity FROM inventory_stock WHERE id=?',unknownId)?.quantity,1)
  console.log('FOCUSED_FOUND_STOCK_SQLITE_PASS: physical=1 unlinked, no invented SKU, exact single match safely linked, replay harmless, ambiguity blocked, active reservation blocks')
}
main().catch(error=>{console.error('FOCUSED_FOUND_STOCK_SQLITE_FAIL',error?.stack||error);process.exit(1)})
