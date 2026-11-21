import { isUnitBarcode } from '../../shared/barcode-unit.ts'
import { variantIdFromSkuBarcode } from '../../shared/barcode-sku.ts'
import { readCatalogSkuBarcode } from './barcode-sku.ts'
import { lookupIndividualUnitBarcode } from './barcode-unit-preparation.ts'
import { serializeInventoryStocktakeSession } from './inventory-stocktake.ts'

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

async function requireScanLedger(db: D1Database, type: 'sku' | 'unit' | 'both' = 'both') {
  const triggers = type === 'both'
    ? ['trg_stocktake_unit_scan_apply','trg_stocktake_sku_scan_apply']
    : [type === 'sku' ? 'trg_stocktake_sku_scan_apply' : 'trg_stocktake_unit_scan_apply']
  for (const name of triggers) {
    const ready = await db.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name=?"
    ).bind(name).first<{ n: number }>()
    if (Number(ready?.n || 0) !== 1) {
      throw new StocktakeBarcodeScanError('scan_schema_missing',
        'Быстрый подсчёт ещё не включён на этой базе. Ручной подсчёт доступен.', 503)
    }
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

/**
 * Atomically include a newly found active catalog SKU in an existing full or
 * selective review. This only creates an uncounted review row, never inventory
 * stock. The accompanying scan insert must be in the same D1 batch.
 */
function prepareNewStocktakeVariant(
  db: D1Database, sessionId: string, source: string, variantId: number, now: string,
) {
  return db.prepare(
    `INSERT OR IGNORE INTO inventory_stocktake_items (
       session_id,inventory_source,stock_id,product_id,variant_id,
       product_name_snapshot,category_snapshot,gender_snapshot,color_snapshot,
       material_snapshot,length_snapshot,size_snapshot,
       opening_quantity,opening_reserved_quantity,baseline_quantity,
       status,created_at,updated_at
     )
     SELECT ?,?,s.id,v.product_id,v.id,
       p.name,
       CASE WHEN v.category='child' THEN 'child' ELSE 'adult' END,
       COALESCE(v.gender,''),COALESCE(v.color,''),
       COALESCE(NULLIF(v.material,''),'СТАНДАРТ'),
       COALESCE(NULLIF(v.length,''),'СТАНДАРТ'),
       COALESCE(v.size_label,''),
       COALESCE(s.quantity,0),MAX(0,COALESCE(s.reserved_quantity,0)),
       COALESCE(s.quantity,0),
       'pending',?,?
     FROM catalog_variants v
     JOIN catalog_products p ON p.id=v.product_id
     LEFT JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
     LEFT JOIN inventory_stock s ON s.variant_id=v.id AND s.inventory_source=?
     WHERE v.id=? AND v.is_active=1 AND p.is_active=1
       AND (sp.id IS NULL OR sp.is_active=1)
       AND NOT EXISTS (
         SELECT 1 FROM inventory_stocktake_items i
         WHERE i.session_id=? AND i.variant_id=v.id
       )`
  ).bind(sessionId,source,now,now,source,variantId,sessionId)
}

async function newlyFoundStocktakeItem(db:D1Database,sessionId:string,variantId:number){
  const session=await serializeInventoryStocktakeSession(db,sessionId)
  const added=session.items.find(item=>item.variantId===variantId)
  if(!added)throw new StocktakeBarcodeScanError('scan_sync_missing',
    'Скан принят, но найденная позиция не отображается. Обновите ревизию.')
  return added
}

export async function listStocktakeUnitScans(db: D1Database, sessionId: string) {
  await requireScanLedger(db)
  const session = await requireActiveSession(db, sessionId)
  const unit = await db.prepare(
    "SELECT COUNT(*) AS total FROM inventory_stocktake_unit_scans WHERE session_id=?"
  ).bind(sessionId).first<{ total: number }>()
  const sku = await db.prepare(
    "SELECT COUNT(*) AS total FROM inventory_stocktake_sku_scans WHERE session_id=?"
  ).bind(sessionId).first<{ total: number }>()
  return { ok: true, sessionId, source: session.inventory_source,
    total: Number(unit?.total || 0) + Number(sku?.total || 0),
    skuTotal: Number(sku?.total || 0), unitTotal: Number(unit?.total || 0) }
}

export async function scanStocktakeUnit(
  db: D1Database, sessionId: string, value: unknown, actor = '',
) {
  const code = String(value || '').trim().toUpperCase()
  if (!isUnitBarcode(code)) {
    throw new StocktakeBarcodeScanError('individual_only',
      'Для индивидуального подсчёта нужна метка OCU1. Для общего SKU используйте быстрый режим OCS1.', 400)
  }
  await requireScanLedger(db, 'unit')
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
  const previously = await db.prepare(
    "SELECT item_id FROM inventory_stocktake_unit_scans WHERE session_id=? AND unit_id=? LIMIT 1"
  ).bind(sessionId, found.unitId).first<{ item_id: number }>()
  if (previously) return {
    ok: true, duplicate: true, sessionId, itemId: previously.item_id,
    variantId: found.variantId, productName: found.productName,
    addedItem:await newlyFoundStocktakeItem(db,sessionId,found.variantId),
    message: 'Эта физическая вещь уже отсканирована в текущей ревизии. Количество не увеличено.',
  }
  if (item?.status === 'recount_required') {
    throw new StocktakeBarcodeScanError('recount_required',
      'Остаток менялся во время проверки. Сначала выполните повторный подсчёт этой позиции вручную.')
  }
  const scannedAt = new Date().toISOString()
  try {
    if (item) {
      await db.prepare(
        `INSERT INTO inventory_stocktake_unit_scans
          (session_id,unit_id,item_id,token,variant_id,inventory_source,scanned_at,scanned_by)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(sessionId, found.unitId, item.id, code, found.variantId,
        session.inventory_source, scannedAt, String(actor || '').slice(0,120)).run()
    } else {
      await db.batch([
        prepareNewStocktakeVariant(db,sessionId,session.inventory_source,found.variantId,scannedAt),
        db.prepare(
          `INSERT INTO inventory_stocktake_unit_scans
            (session_id,unit_id,item_id,token,variant_id,inventory_source,scanned_at,scanned_by)
           SELECT ?,?,i.id,?,?,?,?,? FROM inventory_stocktake_items i
           WHERE i.session_id=? AND i.variant_id=? LIMIT 1`
        ).bind(sessionId,found.unitId,code,found.variantId,session.inventory_source,
          scannedAt,String(actor||'').slice(0,120),sessionId,found.variantId),
      ])
    }
  } catch (error) {
    const conflict = await db.prepare(
      "SELECT item_id FROM inventory_stocktake_unit_scans WHERE session_id=? AND unit_id=? LIMIT 1"
    ).bind(sessionId, found.unitId).first<{ item_id: number }>()
    if (conflict) return {
      ok: true, duplicate: true, sessionId, itemId: conflict.item_id,
      variantId: found.variantId, productName: found.productName,
      addedItem:await newlyFoundStocktakeItem(db,sessionId,found.variantId),
      message: 'Эта физическая вещь уже была учтена в текущей ревизии. Повторный скан не изменил количество.',
    }
    if (String(error).includes('STOCKTAKE_UNIT_SCAN_CONFLICT')) {
      throw new StocktakeBarcodeScanError('stocktake_changed',
        'Количество или состояние вещи изменилось. Скан не записан. Обновите ревизию и проверьте позицию.')
    }
    throw error
  }
  const updated = await db.prepare(
    "SELECT id,counted_quantity FROM inventory_stocktake_items WHERE session_id=? AND variant_id=? LIMIT 1"
  ).bind(sessionId,found.variantId).first<{ id:number; counted_quantity: number }>()
  const logged = await db.prepare(
    "SELECT item_id FROM inventory_stocktake_unit_scans WHERE session_id=? AND unit_id=? LIMIT 1"
  ).bind(sessionId,found.unitId).first<{item_id:number}>()
  if(!updated || Number(logged?.item_id)!==Number(updated.id)){
    throw new StocktakeBarcodeScanError('scan_not_recorded',
      'Эта физическая вещь не записана. Обновите ревизию и проверьте позицию.')
  }
  return {
    ok: true, duplicate: false, sessionId, itemId: Number(updated.id),
    variantId: found.variantId, productName: found.productName,
    countedQuantity: Number(updated.counted_quantity || 0),
    addedItem:item ? undefined : await newlyFoundStocktakeItem(db,sessionId,found.variantId),
    message: 'Вещь учтена в ревизии. Физический остаток пока не изменён.',
  }
}

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function scanStocktakeSku(
  db: D1Database, sessionId: string, value: unknown, requestId: unknown, actor = '',
) {
  const code = String(value || '').trim().toUpperCase()
  const variantId = variantIdFromSkuBarcode(code)
  if (!variantId) throw new StocktakeBarcodeScanError('invalid_sku',
    'Общий штрихкод SKU повреждён или не распознан.', 400)
  const id = String(requestId || '').trim()
  if (!REQUEST_ID_PATTERN.test(id)) throw new StocktakeBarcodeScanError('invalid_scan_id',
    'Не удалось распознать отдельное событие сканирования. Попробуйте ещё раз.', 400)
  await requireScanLedger(db,'sku')
  const session = await requireActiveSession(db,sessionId)
  const original = await db.prepare(
    'SELECT item_id,variant_id FROM inventory_stocktake_sku_scans WHERE session_id=? AND request_id=? LIMIT 1'
  ).bind(sessionId,id).first<{ item_id: number; variant_id: number }>()
  const found = await readCatalogSkuBarcode(db,variantId)
  if (!found.ok || !found.active) throw new StocktakeBarcodeScanError('inactive_sku',
    'Товар удалён или неактивен. Уточните вариант перед подсчётом.')
  if (original) {
    if (Number(original.variant_id) !== variantId) throw new StocktakeBarcodeScanError('scan_id_reused',
      'Идентификатор скана уже использован для другого товара.')
    const current = await db.prepare(
      'SELECT counted_quantity FROM inventory_stocktake_items WHERE session_id=? AND id=?'
    ).bind(sessionId,original.item_id).first<{counted_quantity:number}>()
    return {
      ok:true,duplicate:true,scanType:'sku' as const,sessionId,variantId,
      itemId:Number(original.item_id),productName:found.productName,
      countedQuantity:Number(current?.counted_quantity || 0),
      addedItem:await newlyFoundStocktakeItem(db,sessionId,variantId),
      message:'Повтор сетевого запроса. Количество не увеличено.',
    }
  }
  const item = await db.prepare(
    'SELECT id,status FROM inventory_stocktake_items WHERE session_id=? AND variant_id=? LIMIT 1'
  ).bind(sessionId,variantId).first<{id:number;status:string}>()

  if (item?.status === 'recount_required') throw new StocktakeBarcodeScanError('recount_required',
    'Складской остаток изменился во время проверки. Сначала пересчитайте позицию вручную.')
  const now = new Date().toISOString()
  try {
    if (item) {
      await db.prepare(
        `INSERT INTO inventory_stocktake_sku_scans
        (session_id,request_id,item_id,variant_id,inventory_source,scanned_at,scanned_by)
        VALUES (?,?,?,?,?,?,?)`
      ).bind(sessionId,id,item.id,variantId,session.inventory_source,now,String(actor||'').slice(0,120)).run()
    } else {
      // The row addition and physical scan are one transaction. A conflict
      // rolls both back, so the scan cannot leave an unverified phantom row.
      await db.batch([
        prepareNewStocktakeVariant(db,sessionId,session.inventory_source,variantId,now),
        db.prepare(
          `INSERT INTO inventory_stocktake_sku_scans
          (session_id,request_id,item_id,variant_id,inventory_source,scanned_at,scanned_by)
          SELECT ?,?,i.id,?,?,?,? FROM inventory_stocktake_items i
          WHERE i.session_id=? AND i.variant_id=? LIMIT 1`
        ).bind(sessionId,id,variantId,session.inventory_source,now,
          String(actor||'').slice(0,120),sessionId,variantId),
      ])
    }
  } catch(error) {
    const replay = await db.prepare(
      'SELECT item_id,variant_id FROM inventory_stocktake_sku_scans WHERE session_id=? AND request_id=? LIMIT 1'
    ).bind(sessionId,id).first<{item_id:number;variant_id:number}>()
    if (replay) {
      if (Number(replay.variant_id) !== variantId) throw new StocktakeBarcodeScanError('scan_id_reused',
        'Идентификатор скана уже использован для другого товара.')
      const current = await db.prepare(
        'SELECT counted_quantity FROM inventory_stocktake_items WHERE session_id=? AND id=?'
      ).bind(sessionId,replay.item_id).first<{counted_quantity:number}>()
      return { ok:true,duplicate:true,scanType:'sku' as const,sessionId,
        variantId,itemId:Number(replay.item_id),productName:found.productName,
        countedQuantity:Number(current?.counted_quantity || 0),
        addedItem:await newlyFoundStocktakeItem(db,sessionId,variantId),
        message:'Скан уже сохранён. Повторное начисление отменено.' }
    }
    if (String(error).includes('STOCKTAKE_SKU_SCAN_CONFLICT')) {
      throw new StocktakeBarcodeScanError('stocktake_changed',
        'Складской остаток или состояние позиции изменились. Скан не сохранён; перепроверьте эту позицию.')
    }
    throw error
  }
  const updated = await db.prepare(
    'SELECT id,counted_quantity FROM inventory_stocktake_items WHERE session_id=? AND variant_id=? LIMIT 1'
  ).bind(sessionId,variantId).first<{id:number;counted_quantity:number}>()
  const logged = await db.prepare(
    'SELECT item_id FROM inventory_stocktake_sku_scans WHERE session_id=? AND request_id=? LIMIT 1'
  ).bind(sessionId,id).first<{item_id:number}>()
  if (!updated || Number(logged?.item_id)!==Number(updated.id)) {
    throw new StocktakeBarcodeScanError('scan_not_recorded',
      'Этот штрихкод не записан: ревизия или состояние товара изменились. Проверьте позицию.')
  }
  return {ok:true,duplicate:false,scanType:'sku' as const,sessionId,
    itemId:Number(updated.id),variantId,productName:found.productName,
    countedQuantity:Number(updated.counted_quantity || 0),
    addedItem:item ? undefined : await newlyFoundStocktakeItem(db,sessionId,variantId),
    message:'Добавлена 1 штука в фактический подсчёт. Остаток склада пока не изменён.'}
}

export async function scanStocktakeBarcode(
  db:D1Database,sessionId:string,value:unknown,requestId:unknown,actor='',
) {
  const code=String(value||'').trim().toUpperCase()
  if (code.startsWith('OCS1-')) return scanStocktakeSku(db,sessionId,code,requestId,actor)
  if (isUnitBarcode(code)) {
    const result=await scanStocktakeUnit(db,sessionId,code,actor)
    return {...result,scanType:'unit' as const}
  }
  throw new StocktakeBarcodeScanError('invalid_barcode','Штрихкод не распознан. Нужен OCS1 или OCU1.',400)
}
