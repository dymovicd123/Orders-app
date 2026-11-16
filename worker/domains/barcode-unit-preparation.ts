import { generateUnitBarcode } from '../../shared/barcode-unit.ts'

type UnitSource = 'warehouse' | 'boutique'
type Stock = { id: number; quantity: number; inventory_source: string }
type PreparedBatch = { batch_id: string; purpose: string; created_at: string }
type UnitLabelRow = {
  token: string; unit_id: string; variant_id: number; inventory_source: UnitSource;
  unit_status: string; coverage_status: string; label_state: string
}

export class BarcodePreparationError extends Error {
  status: number
  code: string
  constructor(code: string, message: string, status = 409) {
    super(message)
    this.name = 'BarcodePreparationError'
    this.code = code
    this.status = status
  }
}

function positiveVariantId(value: unknown) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BarcodePreparationError('invalid_variant', 'Выберите конкретный размер и цвет.', 400)
  }
  return id
}

function selectedSource(value: unknown): UnitSource {
  if (value === 'warehouse' || value === 'boutique') return value
  throw new BarcodePreparationError('invalid_source', 'Выберите Склад или Бутик.', 400)
}

async function assertActiveVariant(db: D1Database, variantId: number) {
  const row = await db.prepare(
    `SELECT v.id FROM catalog_variants v
     JOIN catalog_products p ON p.id=v.product_id
     JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
     WHERE v.id=? AND v.is_active=1 AND p.is_active=1 AND sp.is_active=1 LIMIT 1`
  ).bind(variantId).first<{ id: number }>()
  if (!row) throw new BarcodePreparationError('sku_inactive', 'Этот вариант удалён или больше недоступен.')
}

async function assertCapacityGuard(db: D1Database) {
  const row = await db.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name='trg_barcode_prepared_unit_capacity'"
  ).first<{ count: number }>()
  if (Number(row?.count || 0) !== 1) {
    throw new BarcodePreparationError('preparation_not_ready', 'Индивидуальная маркировка ещё не включена на этой базе.', 503)
  }
}

async function readStocks(db: D1Database, variantId: number) {
  const result = await db.prepare(
    `SELECT id, inventory_source, quantity FROM inventory_stock
     WHERE variant_id=? AND inventory_source IN ('warehouse','boutique')`
  ).bind(variantId).all<Stock>()
  const rows = result.results || []
  for (const source of ['warehouse','boutique']) {
    if (rows.filter(row => row.inventory_source === source).length > 1) {
      throw new BarcodePreparationError('duplicate_stock_rows', 'Найдены дубли учётных остатков. Маркировка остановлена до исправления.')
    }
  }
  return rows
}

async function readCoveredCounts(db: D1Database, variantId: number) {
  const rows = await db.prepare(
    `SELECT inventory_source, COUNT(*) AS count FROM inventory_units
     WHERE variant_id=? AND inventory_source IN ('warehouse','boutique')
       AND coverage_status <> 'excluded'
       AND unit_status NOT IN ('issued','not_stock','retired')
     GROUP BY inventory_source`
  ).bind(variantId).all<{ inventory_source: string; count: number }>()
  return new Map((rows.results || []).map(row => [row.inventory_source, Number(row.count) || 0]))
}

export async function previewUnitBarcodePreparation(db: D1Database, variantInput: unknown) {
  const variantId = positiveVariantId(variantInput)
  await assertCapacityGuard(db)
  await assertActiveVariant(db, variantId)
  const [stocks, counts, recent] = await Promise.all([
    readStocks(db, variantId),
    readCoveredCounts(db, variantId),
    db.prepare(
      `SELECT b.batch_id, b.created_at, u.inventory_source, COUNT(*) AS quantity,
              SUM(CASE WHEN l.state='active' THEN 1 ELSE 0 END) AS printable
       FROM barcode_print_batches b
       JOIN barcode_print_batch_labels bl ON bl.batch_id=b.batch_id
       JOIN inventory_unit_labels l ON l.token=bl.label_token
       JOIN inventory_units u ON u.unit_id=l.unit_id
       WHERE b.purpose='existing_stock' AND u.variant_id=?
       GROUP BY b.batch_id, b.created_at, u.inventory_source
       ORDER BY b.created_at DESC LIMIT 8`
    ).bind(variantId).all<{
      batch_id: string; created_at: string; inventory_source: UnitSource;
      quantity: number; printable: number
    }>(),
  ])
  return {
    ok: true,
    variantId,
    maximumPerBatch: 20,
    locations: (['warehouse','boutique'] as const).map(source => {
      const row = stocks.find(s => s.inventory_source === source)
      const quantity = Math.max(0, Number(row?.quantity || 0))
      const prepared = counts.get(source) || 0
      return { source, physicalQuantity: quantity, prepared, available: Math.max(0, quantity - prepared),
        discrepancy: prepared > quantity }
    }),
    recentBatches: (recent.results || []).map(row => ({
      batchId: row.batch_id, createdAt: row.created_at, source: row.inventory_source,
      quantity: Number(row.quantity), canReprint: Number(row.printable) === Number(row.quantity),
    })),
  }
}

export async function readPreparedUnitLabelBatch(db: D1Database, batchId: string) {
  if (!/^UBL1-[0-9a-f-]{36}$/.test(batchId)) {
    throw new BarcodePreparationError('invalid_batch', 'Номер партии этикеток неверный.', 400)
  }
  const batch = await db.prepare(
    `SELECT batch_id, purpose, created_at FROM barcode_print_batches
     WHERE batch_id=? AND purpose='existing_stock' LIMIT 1`
  ).bind(batchId).first<PreparedBatch>()
  if (!batch) throw new BarcodePreparationError('batch_not_found', 'Партия этикеток не найдена.', 404)
  const result = await db.prepare(
    `SELECT l.token, u.unit_id, u.variant_id, u.inventory_source, u.unit_status,
            u.coverage_status, l.state AS label_state
     FROM barcode_print_batch_labels bl
     JOIN inventory_unit_labels l ON l.token=bl.label_token
     JOIN inventory_units u ON u.unit_id=l.unit_id
     WHERE bl.batch_id=? ORDER BY u.unit_id`
  ).bind(batchId).all<UnitLabelRow>()
  const rows = result.results || []
  if (!rows.length) throw new BarcodePreparationError('incomplete_batch', 'Партия этикеток ещё не готова.')
  if (rows.some(row => row.label_state !== 'active')) {
    throw new BarcodePreparationError('revoked_label', 'В этой партии есть отозванные коды. Повторная печать заблокирована.')
  }
  if (rows.some(row => row.unit_status === 'retired' || row.coverage_status === 'excluded')) {
    throw new BarcodePreparationError('inactive_unit', 'Эта партия содержит исключённые записи.')
  }
  return {
    ok: true, batchId, createdAt: batch.created_at,
    variantId: Number(rows[0].variant_id), source: rows[0].inventory_source,
    quantity: rows.length,
    labels: rows.map(row => ({ token: row.token, unitId: row.unit_id })),
    stockChanged: false, requiresVerification: true,
  }
}

export async function prepareUnitLabelBatch(
  db: D1Database,
  input: { variantId?: unknown; source?: unknown; quantity?: unknown; requestId?: unknown },
  actor: string,
) {
  const variantId = positiveVariantId(input.variantId)
  const source = selectedSource(input.source)
  const quantity = Number(input.quantity)
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new BarcodePreparationError('invalid_quantity', 'За один раз можно подготовить от 1 до 20 этикеток.', 400)
  }
  const requestId = String(input.requestId || '').trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
    throw new BarcodePreparationError('invalid_request', 'Обновите форму маркировки перед созданием этикеток.', 400)
  }
  const batchId = 'UBL1-' + requestId
  const existing = await db.prepare(
    "SELECT batch_id FROM barcode_print_batches WHERE batch_id=? LIMIT 1"
  ).bind(batchId).first<{ batch_id: string }>()
  if (existing) {
    const replay = await readPreparedUnitLabelBatch(db, batchId)
    if (replay.variantId !== variantId || replay.source !== source || replay.quantity !== quantity) {
      throw new BarcodePreparationError('request_reused', 'Этот запрос уже сохранён с другими параметрами.')
    }
    return { ...replay, duplicate: true }
  }
  const preview = await previewUnitBarcodePreparation(db, variantId)
  const location = preview.locations.find(item => item.source === source)
  if (!location || location.available < quantity || location.discrepancy) {
    throw new BarcodePreparationError('insufficient_stock',
      'Нельзя подготовить больше этикеток, чем числится вещей на выбранной точке. Обновите остатки.')
  }
  const now = new Date().toISOString()
  const statements = [
    db.prepare(
      "INSERT INTO barcode_print_batches(batch_id,purpose,state,created_by,created_at) VALUES (?,'existing_stock','prepared',?,?)"
    ).bind(batchId, actor.slice(0, 120), now),
  ]
  for (let index = 0; index < quantity; index++) {
    const unitId = crypto.randomUUID()
    const token = generateUnitBarcode()
    statements.push(
      db.prepare(
        `INSERT INTO inventory_units
          (unit_id,original_variant_id,variant_id,origin_kind,origin_ref,inventory_source,
           unit_status,coverage_status,created_at,updated_at)
         VALUES (?, ?, ?, 'existing_stock', ?, ?, 'unverified', 'unlinked', ?, ?)`
      ).bind(unitId, variantId, variantId, batchId, source, now, now),
      db.prepare(
        "INSERT INTO inventory_unit_labels(token,unit_id,label_version,state,created_at,created_by) VALUES (?,?,1,'active',?,?)"
      ).bind(token, unitId, now, actor.slice(0, 120)),
      db.prepare(
        'INSERT INTO barcode_print_batch_labels(batch_id,label_token) VALUES (?,?)'
      ).bind(batchId, token),
      db.prepare(
        `INSERT INTO inventory_unit_events
          (event_id,unit_id,operation_key,action_type,reference_type,reference_id,to_status,to_source,actor,created_at)
         VALUES (?,?,?,'label_prepared','barcode_print_batch',?,'unverified',?,?,?)`
      ).bind(crypto.randomUUID(), unitId, 'prepare:' + batchId + ':' + index, batchId, source, actor.slice(0,120), now),
    )
  }
  try {
    await db.batch(statements)
  } catch (error) {
    const after = await db.prepare(
      'SELECT batch_id FROM barcode_print_batches WHERE batch_id=? LIMIT 1'
    ).bind(batchId).first<{ batch_id: string }>()
    if (after) {
      const replay = await readPreparedUnitLabelBatch(db, batchId)
      if (replay.variantId !== variantId || replay.source !== source || replay.quantity !== quantity) {
        throw new BarcodePreparationError('request_reused', 'Этот запрос уже сохранён с другими параметрами.')
      }
      return { ...replay, duplicate: true }
    }
    const message = String(error instanceof Error ? error.message : error)
    if (message.includes('BARCODE_PREPARATION') || message.includes('UNIQUE') ||
        message.includes('FOREIGN KEY')) {
      throw new BarcodePreparationError('stock_changed',
        'Остаток или каталог изменился. Этикетки не созданы. Обновите форму и повторите.')
    }
    throw error
  }
  return { ...await readPreparedUnitLabelBatch(db, batchId), duplicate: false }
}
