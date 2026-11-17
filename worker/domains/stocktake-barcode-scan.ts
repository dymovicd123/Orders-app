import { isUnitBarcode } from '../../shared/barcode-unit.ts'
import { lookupIndividualUnitBarcode } from './barcode-unit-preparation.ts'

export class StocktakeBarcodeScanError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 409) {
    super(message)
    this.name = 'StocktakeBarcodeScanError'
    this.code = code
    this.status = status
  }
}

async function requireScanLedger(db: D1Database) {
  const ready = await db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name='trg_stocktake_unit_scan_apply'"
  ).first<{ n: number }>()
  if (Number(ready?.n || 0) !== 1) {
    throw new StocktakeBarcodeScanError('scan_schema_missing',
      'Сканирование для ревизии ещё не включено на этой базе. Ручной подсчёт доступен.', 503)
  }
}

async function requireActiveSession(db: D1Database, sessionId: string) {
  if (!sessionId || sessionId.length > 100) {
    throw new StocktakeBarcodeScanError('invalid_session', 'Неверный номер ревизии.', 400)
  }
  const session = await db.prepare(
    "SELECT id,inventory_source,status FROM inventory_stocktake_sessions WHERE id=? LIMIT 1"
  ).bind(sessionId).first<{ id: string; inventory_source: string; status: string }>()
  if (!session) throw new StocktakeBarcodeScanError('session_not_found', 'Ревизия не найдена.', 404)
  if (session.status !== 'active') {
    throw new StocktakeBarcodeScanError('session_closed', 'Эта ревизия уже завершена или отменена.')
  }
  return session
}

export async function listStocktakeUnitScans(db: D1Database, sessionId: string) {
  await requireScanLedger(db)
  const session = await requireActiveSession(db, sessionId)
  const rows = await db.prepare(
    "SELECT COUNT(*) AS total FROM inventory_stocktake_unit_scans WHERE session_id=?"
  ).bind(sessionId).first<{ total: number }>()
  return { ok: true, sessionId, source: session.inventory_source, total: Number(rows?.total || 0) }
}

export async function scanStocktakeUnit(
  db: D1Database, sessionId: string, value: unknown, actor = '',
) {
  const code = String(value || '').trim().toUpperCase()
  if (!isUnitBarcode(code)) {
    throw new StocktakeBarcodeScanError('individual_only',
      'Для подсчёта нужна индивидуальная метка вещи. Общий код SKU только определяет вариант.', 400)
  }
  await requireScanLedger(db)
  const session = await requireActiveSession(db, sessionId)
  const found = await lookupIndividualUnitBarcode(db, code)
  if (!found.ok || !found.active || !found.unitId || !found.variantId) {
    throw new StocktakeBarcodeScanError('invalid_unit',
      'Индивидуальная метка не найдена, отозвана или относится к удалённому варианту.')
  }
  if (found.source !== session.inventory_source) {
    throw new StocktakeBarcodeScanError('wrong_source',
      'Метка относится к другой точке. Проверьте, куда поступила вещь, прежде чем считать её.')
  }
  if (found.status !== 'prepared' && found.status !== 'on_hand') {
    throw new StocktakeBarcodeScanError('unit_not_countable',
      'Эта вещь уже выдана или недоступна для пересчёта.')
  }
  const item = await db.prepare(
    "SELECT id,status FROM inventory_stocktake_items WHERE session_id=? AND variant_id=? LIMIT 1"
  ).bind(sessionId, found.variantId).first<{ id: number; status: string }>()
  if (!item) {
    throw new StocktakeBarcodeScanError('sku_not_in_session',
      'Этого варианта нет в текущей проверке. Добавьте его через «Найденная позиция», затем повторите сканирование.')
  }
  const previously = await db.prepare(
    "SELECT item_id FROM inventory_stocktake_unit_scans WHERE session_id=? AND unit_id=? LIMIT 1"
  ).bind(sessionId, found.unitId).first<{ item_id: number }>()
  if (previously) return {
    ok: true, duplicate: true, sessionId, itemId: previously.item_id,
    variantId: found.variantId, productName: found.productName,
    message: 'Эта физическая вещь уже отсканирована в текущей ревизии. Количество не увеличено.',
  }
  if (item.status === 'recount_required') {
    throw new StocktakeBarcodeScanError('recount_required',
      'Остаток менялся во время проверки. Сначала выполните повторный подсчёт этой позиции вручную.')
  }
  const scannedAt = new Date().toISOString()
  try {
    await db.prepare(
      `INSERT INTO inventory_stocktake_unit_scans
        (session_id,unit_id,item_id,token,variant_id,inventory_source,scanned_at,scanned_by)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(sessionId, found.unitId, item.id, code, found.variantId,
      session.inventory_source, scannedAt, String(actor || '').slice(0,120)).run()
  } catch (error) {
    const conflict = await db.prepare(
      "SELECT item_id FROM inventory_stocktake_unit_scans WHERE session_id=? AND unit_id=? LIMIT 1"
    ).bind(sessionId, found.unitId).first<{ item_id: number }>()
    if (conflict) return {
      ok: true, duplicate: true, sessionId, itemId: conflict.item_id,
      variantId: found.variantId, productName: found.productName,
      message: 'Эта физическая вещь уже была учтена в текущей ревизии. Повторный скан не изменил количество.',
    }
    if (String(error).includes('STOCKTAKE_UNIT_SCAN_CONFLICT')) {
      throw new StocktakeBarcodeScanError('stocktake_changed',
        'Количество или состояние вещи изменилось. Скан не записан. Обновите ревизию и проверьте позицию.')
    }
    throw error
  }
  const updated = await db.prepare(
    "SELECT counted_quantity FROM inventory_stocktake_items WHERE id=? AND session_id=? LIMIT 1"
  ).bind(item.id, sessionId).first<{ counted_quantity: number }>()
  return {
    ok: true, duplicate: false, sessionId, itemId: item.id,
    variantId: found.variantId, productName: found.productName,
    countedQuantity: Number(updated?.counted_quantity || 0),
    message: 'Вещь учтена в ревизии. Физический остаток пока не изменён.',
  }
}
