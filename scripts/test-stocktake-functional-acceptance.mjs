import { DatabaseSync } from 'node:sqlite'
import {
  cancelInventoryStocktakeSession,
  completeInventoryStocktakeSession,
  createInventoryStocktakeSession,
  listInventoryCheckHistory,
  listInventoryStocktakeSessions,
  quickInventoryStocktakeBatch,
  saveInventoryStocktakeCount,
} from '../worker/domains/inventory-stocktake.ts'
import { prepareManagedInventoryWrite } from '../src/app/controllers/inventoryWriteRetry.ts'

const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

function seedVariant(db, { productId, variantId, source, quantity, reserved = 0, name, color = 'ТЕСТ', size = '46' }) {
  const now = '2026-08-25T00:00:00.000Z'
  db.run(
    `INSERT OR IGNORE INTO catalog_products (id, name, category, is_active) VALUES (?, ?, 'adult', 1)`,
    productId,
    name,
  )
  db.run(
    `INSERT INTO catalog_variants (id, product_id, category, gender, color, material, length, size_label, is_active)
     VALUES (?, ?, 'adult', 'ЖЕН', ?, 'СТАНДАРТ', 'СТАНДАРТ', ?, 1)`,
    variantId,
    productId,
    color,
    size,
  )
  db.run(
    `INSERT INTO inventory_stock (
       inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
       material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
       last_action, last_source_ref, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'ЖЕН', ?, 'СТАНДАРТ', 'СТАНДАРТ', ?, ?, ?, 'seed', 'qa', ?, ?)`,
    source,
    productId,
    variantId,
    name,
    color,
    size,
    quantity,
    reserved,
    now,
    now,
  )
}

function testManagedBrowserTransport() {
  const prepare = (requestId) => (key, payload) => ({ requestId, payload: { ...payload, requestId } })

  const createHeaders = new Headers()
  const created = prepareManagedInventoryWrite(
    'POST',
    '/api/inventory/stocktakes',
    JSON.stringify({ source: 'warehouse' }),
    createHeaders,
    prepare('QA-CREATE-1'),
  )
  check(createHeaders.get('X-Idempotency-Key') === 'QA-CREATE-1', 'Stocktake create lost its idempotency header')
  check(JSON.parse(created.body).requestId === 'QA-CREATE-1', 'Stocktake create lost its durable request id')
  check(created.requestKey === 'inventory-write:POST:/api/inventory/stocktakes', 'Stocktake create request key is unstable')

  const saveHeaders = new Headers()
  const saved = prepareManagedInventoryWrite(
    'PATCH',
    '/api/inventory/stocktakes/REV-QA/items/17',
    JSON.stringify({ countedQuantity: 4 }),
    saveHeaders,
    prepare('QA-SAVE-1'),
  )
  check(JSON.parse(saved.body).requestId === 'QA-SAVE-1', 'Stocktake count save lost its durable request id')

  const completeHeaders = new Headers()
  const completed = prepareManagedInventoryWrite(
    'POST',
    '/api/inventory/stocktakes/REV-QA/complete',
    undefined,
    completeHeaders,
    prepare('QA-COMPLETE-1'),
  )
  check(completeHeaders.get('X-Idempotency-Key') === 'QA-COMPLETE-1', 'Stocktake completion lost its idempotency header')
  check(completed.requestId === 'QA-COMPLETE-1', 'Stocktake completion is not managed as a retryable write')
}

async function main() {
  testManagedBrowserTransport()

  const db = new TestD1Database()
  installSchema(db)

  seedVariant(db, {
    productId: 1,
    variantId: 101,
    source: 'warehouse',
    quantity: 5,
    reserved: 2,
    name: 'QA РЕВИЗИЯ СКЛАД',
  })

  const started = await createInventoryStocktakeSession(db, { source: 'warehouse' }, 'qa-manager')
  check(started.ok && started.resumed === false, 'First stocktake start must create a new session')
  const warehouseSessionId = started.session?.id
  check(Boolean(warehouseSessionId), 'Created stocktake session id is missing')
  check(started.session?.items?.length === 1, 'Created stocktake did not snapshot the seeded position')
  check(started.session.items[0].baselineQuantity === 5, 'Stocktake baseline is not the physical opening quantity')

  const resumed = await createInventoryStocktakeSession(db, { source: 'warehouse' }, 'qa-manager')
  check(resumed.ok && resumed.resumed === true, 'Repeated start must resume the active stocktake')
  check(resumed.sessionId === warehouseSessionId && resumed.session?.id === warehouseSessionId, 'Repeated start created or returned a different session')
  check(Number(db.row(`SELECT COUNT(*) AS qty FROM inventory_stocktake_sessions WHERE inventory_source = 'warehouse' AND status = 'active'`)?.qty) === 1, 'More than one active warehouse stocktake exists')

  const warehouseItemId = Number(started.session.items[0].id)
  const firstCount = await saveInventoryStocktakeCount(db, warehouseSessionId, warehouseItemId, { countedQuantity: 4 })
  check(firstCount.ok && firstCount.item?.countedQuantity === 4 && firstCount.item?.status === 'counted', 'First stocktake fact was not saved')
  const evidenceTime = firstCount.item.countedAt
  check(Boolean(evidenceTime), 'Saved stocktake fact has no counted_at evidence time')

  await delay(20)
  const repeatedCount = await saveInventoryStocktakeCount(db, warehouseSessionId, warehouseItemId, { countedQuantity: 4 })
  check(repeatedCount.ok, 'Identical stocktake fact replay failed')
  check(repeatedCount.item?.countedAt === evidenceTime, 'Identical replay rewrote counted_at evidence time')
  check(db.row(`SELECT counted_at FROM inventory_stocktake_items WHERE id = ?`, warehouseItemId)?.counted_at === evidenceTime, 'Database evidence time changed on identical replay')

  db.run(`UPDATE inventory_stock SET quantity = 6 WHERE inventory_source = 'warehouse' AND variant_id = 101`)
  const staleSave = await saveInventoryStocktakeCount(db, warehouseSessionId, warehouseItemId, { countedQuantity: 4 })
  check(staleSave.ok === false && staleSave.code === 'recount_required', 'Stock change after a saved fact did not force a recount')
  const staleItem = db.row(`SELECT baseline_quantity, counted_quantity, counted_at, status FROM inventory_stocktake_items WHERE id = ?`, warehouseItemId)
  check(Number(staleItem?.baseline_quantity) === 6 && staleItem?.counted_quantity === null && staleItem?.counted_at === null && staleItem?.status === 'recount_required', 'Recount reset did not preserve the new physical baseline cleanly')

  const recounted = await saveInventoryStocktakeCount(db, warehouseSessionId, warehouseItemId, { countedQuantity: 3 })
  check(recounted.ok && recounted.item?.baselineQuantity === 6 && recounted.item?.countedQuantity === 3, 'Recount after a conflict was not accepted against the new baseline')
  const recountEvidenceTime = recounted.item.countedAt

  const completed = await completeInventoryStocktakeSession(db, warehouseSessionId)
  check(completed.ok && completed.session?.status === 'completed', 'Stocktake did not complete')
  check(Number(db.row(`SELECT quantity FROM inventory_stock WHERE inventory_source = 'warehouse' AND variant_id = 101`)?.quantity) === 3, 'Completed stocktake did not apply the counted physical quantity')
  const movement = db.row(`SELECT quantity_delta, quantity_after FROM inventory_movements WHERE reference_type = 'stocktake' AND reference_id = ?`, warehouseSessionId)
  check(Number(movement?.quantity_delta) === -3 && Number(movement?.quantity_after) === 3, 'Completed stocktake movement does not match baseline -> counted delta')
  const stockCheck = db.row(`SELECT expected_quantity, counted_quantity, difference_quantity, checked_at FROM inventory_stock_checks WHERE check_key = ?`, `stocktake:${warehouseSessionId}:101`)
  check(Number(stockCheck?.expected_quantity) === 6 && Number(stockCheck?.counted_quantity) === 3 && Number(stockCheck?.difference_quantity) === -3, 'Completed stocktake physical-check evidence is incorrect')
  check(stockCheck?.checked_at === recountEvidenceTime, 'Completed stocktake history lost the actual counted_at evidence time')

  const replayedCompletion = await completeInventoryStocktakeSession(db, warehouseSessionId)
  check(replayedCompletion.ok && replayedCompletion.session?.status === 'completed', 'Lost-response completion replay did not return completed success')
  check(Number(db.row(`SELECT COUNT(*) AS qty FROM inventory_movements WHERE reference_type = 'stocktake' AND reference_id = ?`, warehouseSessionId)?.qty) === 1, 'Completion replay duplicated the physical movement')
  check(Number(db.row(`SELECT COUNT(*) AS qty FROM inventory_stock_checks WHERE reference_type = 'stocktake' AND reference_id = ?`, warehouseSessionId)?.qty) === 1, 'Completion replay duplicated stock-check evidence')
  check(Number(db.row(`SELECT quantity FROM inventory_stock WHERE inventory_source = 'warehouse' AND variant_id = 101`)?.quantity) === 3, 'Completion replay changed physical stock a second time')

  const exactHistory = await listInventoryCheckHistory(db, new URL('https://qa.local/api/inventory/check-history?source=warehouse&variantId=101'))
  check(exactHistory.ok && exactHistory.rows?.[0]?.kind === 'check', 'Exact SKU history did not return physical-check evidence')
  check(exactHistory.rows[0].expectedQuantity === 6 && exactHistory.rows[0].countedQuantity === 3, 'Exact SKU history does not expose the accepted stocktake fact')
  check(exactHistory.rows[0].checkedAt === recountEvidenceTime, 'Exact SKU history reports a different evidence time')

  const activeAfterCompletion = await listInventoryStocktakeSessions(db, new URL('https://qa.local/api/inventory/stocktakes?source=warehouse'))
  check(activeAfterCompletion.sessions.length === 0, 'Completed stocktake remains visible as active')

  seedVariant(db, {
    productId: 2,
    variantId: 201,
    source: 'boutique',
    quantity: 7,
    reserved: 1,
    name: 'QA РЕВИЗИЯ БУТИК',
    color: 'СИНИЙ',
    size: '48',
  })

  const boutiqueStarted = await createInventoryStocktakeSession(db, { source: 'boutique' }, 'qa-manager')
  const boutiqueSessionId = boutiqueStarted.session?.id
  const boutiqueItemId = Number(boutiqueStarted.session?.items?.[0]?.id)
  check(Boolean(boutiqueSessionId) && boutiqueItemId > 0, 'Boutique stocktake fixture did not start')

  const unfilled = await completeInventoryStocktakeSession(db, boutiqueSessionId)
  check(unfilled.ok === false && unfilled.code === 'unfilled', 'Completion with unfilled rows must stay blocked')
  check(db.row(`SELECT status FROM inventory_stocktake_sessions WHERE id = ?`, boutiqueSessionId)?.status === 'active', 'Unfilled completion changed the session state')
  check(Number(db.row(`SELECT quantity FROM inventory_stock WHERE inventory_source = 'boutique' AND variant_id = 201`)?.quantity) === 7, 'Unfilled completion changed physical stock')

  const boutiqueCount = await saveInventoryStocktakeCount(db, boutiqueSessionId, boutiqueItemId, { countedQuantity: 6 })
  check(boutiqueCount.ok, 'Boutique count fixture was not saved')

  db.beforeNextBatch = (owner) => {
    owner.run(`UPDATE inventory_stock SET quantity = 8 WHERE inventory_source = 'boutique' AND variant_id = 201`)
  }
  const completionRace = await completeInventoryStocktakeSession(db, boutiqueSessionId)
  check(completionRace.ok === false && completionRace.code === 'recount_required', 'In-transaction stocktake race did not fail closed')
  check(Number(db.row(`SELECT quantity FROM inventory_stock WHERE inventory_source = 'boutique' AND variant_id = 201`)?.quantity) === 8, 'Stocktake race overwrote the newer physical truth')
  check(Number(db.row(`SELECT COUNT(*) AS qty FROM inventory_movements WHERE reference_type = 'stocktake' AND reference_id = ?`, boutiqueSessionId)?.qty) === 0, 'Failed completion applied a partial stocktake movement')
  const racedItem = db.row(`SELECT baseline_quantity, counted_quantity, status FROM inventory_stocktake_items WHERE id = ?`, boutiqueItemId)
  check(Number(racedItem?.baseline_quantity) === 8 && racedItem?.counted_quantity === null && racedItem?.status === 'recount_required', 'Completion race did not move only the conflicted row to a fresh recount baseline')

  const boutiqueRecount = await saveInventoryStocktakeCount(db, boutiqueSessionId, boutiqueItemId, { countedQuantity: 8 })
  check(boutiqueRecount.ok, 'Recount after completion race was not accepted')
  const boutiqueCompleted = await completeInventoryStocktakeSession(db, boutiqueSessionId)
  check(boutiqueCompleted.ok && boutiqueCompleted.changed === 0, 'Unchanged recount did not complete cleanly')
  check(Number(db.row(`SELECT COUNT(*) AS qty FROM inventory_movements WHERE reference_type = 'stocktake' AND reference_id = ?`, boutiqueSessionId)?.qty) === 0, 'Unchanged completed stocktake invented a movement')
  check(Number(db.row(`SELECT COUNT(*) AS qty FROM inventory_stock_checks WHERE reference_type = 'stocktake' AND reference_id = ?`, boutiqueSessionId)?.qty) === 1, 'Unchanged completed stocktake did not retain physical-check evidence')

  seedVariant(db, {
    productId: 1,
    variantId: 102,
    source: 'warehouse',
    quantity: 10,
    reserved: 3,
    name: 'QA РЕВИЗИЯ СКЛАД',
    color: 'КРАСНЫЙ',
    size: '50',
  })

  const quick = await quickInventoryStocktakeBatch(db, {
    source: 'warehouse',
    requestId: 'qa-replay-1',
    items: [{ variantId: 102, expectedQuantity: 10, countedQuantity: 8 }],
  }, { actor: 'qa-manager' })
  check(quick.ok && quick.changedCount === 1, 'Quick physical check did not apply')
  check(Number(db.row(`SELECT quantity FROM inventory_stock WHERE inventory_source = 'warehouse' AND variant_id = 102`)?.quantity) === 8, 'Quick physical check did not set physical stock')
  check(Number(db.row(`SELECT COUNT(*) AS qty FROM inventory_movements WHERE reference_type = 'quick_stocktake' AND variant_id = 102`)?.qty) === 1, 'Quick physical check did not write exactly one movement')
  check(Number(db.row(`SELECT COUNT(*) AS qty FROM inventory_stock_checks WHERE reference_id = 'stock-check:quick_stocktake:warehouse:qa-replay-1'`)?.qty) === 1, 'Quick physical check did not write durable replay evidence')

  const quickReplay = await quickInventoryStocktakeBatch(db, {
    source: 'warehouse',
    requestId: 'qa-replay-1',
    items: [{ variantId: 102, expectedQuantity: 10, countedQuantity: 8 }],
  }, { actor: 'qa-manager' })
  check(quickReplay.ok && quickReplay.changedCount === 1, 'Lost-response quick-check replay did not return the original result')
  check(Number(db.row(`SELECT COUNT(*) AS qty FROM inventory_movements WHERE reference_type = 'quick_stocktake' AND variant_id = 102`)?.qty) === 1, 'Quick-check replay duplicated the movement')
  check(Number(db.row(`SELECT COUNT(*) AS qty FROM inventory_stock_checks WHERE reference_id = 'stock-check:quick_stocktake:warehouse:qa-replay-1'`)?.qty) === 1, 'Quick-check replay duplicated evidence')

  let mismatchedReplayError = ''
  try {
    await quickInventoryStocktakeBatch(db, {
      source: 'warehouse',
      requestId: 'qa-replay-1',
      items: [{ variantId: 102, expectedQuantity: 10, countedQuantity: 7 }],
    }, { actor: 'qa-manager' })
  } catch (error) {
    mismatchedReplayError = String(error?.message || error)
  }
  check(mismatchedReplayError.includes('Ключ повтора уже использован'), 'Changed payload reused a quick-check replay key without being rejected')

  seedVariant(db, {
    productId: 1,
    variantId: 103,
    source: 'warehouse',
    quantity: 12,
    reserved: 0,
    name: 'QA РЕВИЗИЯ СКЛАД',
    color: 'ЗЕЛЁНЫЙ',
    size: '52',
  })

  db.beforeNextBatch = (owner) => {
    owner.run(`UPDATE inventory_stock SET quantity = 13 WHERE inventory_source = 'warehouse' AND variant_id = 103`)
  }
  const quickRace = await quickInventoryStocktakeBatch(db, {
    source: 'warehouse',
    requestId: 'qa-race-1',
    items: [{ variantId: 103, expectedQuantity: 12, countedQuantity: 11 }],
  }, { actor: 'qa-manager' })
  check(quickRace.ok === false && quickRace.code === 'changed', 'Quick-check transaction race did not fail closed')
  check(Number(db.row(`SELECT quantity FROM inventory_stock WHERE inventory_source = 'warehouse' AND variant_id = 103`)?.quantity) === 13, 'Quick-check race overwrote the newer physical truth')
  check(Number(db.row(`SELECT COUNT(*) AS qty FROM inventory_movements WHERE reference_type = 'quick_stocktake' AND variant_id = 103`)?.qty) === 0, 'Failed quick-check race left a partial movement')
  check(Number(db.row(`SELECT COUNT(*) AS qty FROM inventory_stock_checks WHERE reference_id = 'stock-check:quick_stocktake:warehouse:qa-race-1'`)?.qty) === 0, 'Failed quick-check race left replay evidence for an unapplied mutation')

  const guardSession = await createInventoryStocktakeSession(db, { source: 'warehouse' }, 'qa-manager')
  const blockedQuick = await quickInventoryStocktakeBatch(db, {
    source: 'warehouse',
    requestId: 'qa-active-guard-1',
    items: [{ variantId: 102, expectedQuantity: 8, countedQuantity: 8 }],
  }, { actor: 'qa-manager' })
  check(blockedQuick.ok === false && blockedQuick.code === 'stocktake_active' && blockedQuick.sessionId === guardSession.session?.id, 'Quick check ignored the active stocktake guard')

  const cancelled = await cancelInventoryStocktakeSession(db, guardSession.session.id)
  check(cancelled.ok && cancelled.session?.status === 'cancelled', 'Stocktake cancellation failed')
  const cancelledReplay = await cancelInventoryStocktakeSession(db, guardSession.session.id)
  check(cancelledReplay.ok && cancelledReplay.session?.status === 'cancelled', 'Cancellation replay did not remain idempotent')

  console.log('STOCKTAKE FUNCTIONAL ACCEPTANCE PASSED — start/resume, evidence replay, CAS recount, atomic completion, completion replay, exact history, quick-check replay/race, active-session guard and cancellation are verified on real SQLite semantics')
}

main().catch((error) => {
  console.error(`STOCKTAKE FUNCTIONAL ACCEPTANCE FAILED: ${error?.stack || error?.message || error}`)
  process.exit(1)
})
