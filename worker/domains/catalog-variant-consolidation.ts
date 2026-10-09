// Catalog Integrity R2 — retire an identical, unused SKU without rewriting operational history.
import { canonicalStockPositionValue, toInt } from '../core/text.ts'
import { catalogColorIdentity, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize } from './catalog.ts'

type Sku = {
  id: number; product_id: number; stock_position_id: number | null;
  category: string | null; gender: string | null; color: string | null;
  size_label: string | null; material: string | null; length: string | null;
  is_active: number; updated_at: string;
  product_name: string; product_active: number; position_active: number;
  execution_material: string | null; execution_length: string | null;
}
type SkuImpact = {
  id: number; physical: number; reserved: number; nonzeroStockRows: number;
  activeReservations: number; activeOrders: number; historicalOrders: number;
  activeWorkshop: number; pendingLifecycle: number; activeStocktake: number; appliedTransfers: number;
}
const safeId = (n: number) => Number.isSafeInteger(n) && n > 0
type StockRow = { id: number; inventory_source: string; variant_id: number; quantity: number; reserved_quantity: number }

async function readStocks(db: D1Database, sourceId: number, targetId: number) {
  const result = await db.prepare(
    `SELECT id, inventory_source, variant_id, quantity, reserved_quantity
     FROM inventory_stock WHERE variant_id IN (?, ?) ORDER BY id ASC`
  ).bind(sourceId, targetId).all<StockRow>()
  return result.results || []
}
function snapshotToken(source: Sku, target: Sku, stocks: StockRow[]) {
  return JSON.stringify({
    source: [source.id,source.updated_at,source.color,source.size_label],
    target: [target.id,target.updated_at,target.color,target.size_label],
    stocks: stocks.map(x=>[x.id,x.inventory_source,x.variant_id,x.quantity,x.reserved_quantity]),
  })
}
function stockSnapshotJson(stocks: StockRow[]) {
  return JSON.stringify(stocks.map(x=>[x.id,x.inventory_source,x.variant_id,x.quantity,x.reserved_quantity]))
}

async function readSku(db: D1Database, id: number) {
  return await db.prepare(
    `SELECT v.id, v.product_id, v.stock_position_id, v.category, v.gender, v.color,
       v.size_label, v.material, v.length, v.is_active, v.updated_at,
       p.name AS product_name, p.is_active AS product_active,
       sp.is_active AS position_active, sp.material AS execution_material,
       sp.length AS execution_length
     FROM catalog_variants v
     JOIN catalog_products p ON p.id = v.product_id
     LEFT JOIN catalog_stock_positions sp ON sp.id = v.stock_position_id
     WHERE v.id = ? LIMIT 1`
  ).bind(id).first<Sku>()
}

async function readImpact(db: D1Database, id: number): Promise<SkuImpact> {
  const row = await db.prepare(
    `SELECT
      COALESCE((SELECT SUM(COALESCE(s.quantity,0)) FROM inventory_stock s WHERE s.variant_id=?),0) AS physical,
      COALESCE((SELECT SUM(COALESCE(s.reserved_quantity,0)) FROM inventory_stock s WHERE s.variant_id=?),0) AS reserved,
      (SELECT COUNT(*) FROM inventory_stock s WHERE s.variant_id=? AND (COALESCE(s.quantity,0)<>0 OR COALESCE(s.reserved_quantity,0)<>0)) AS nonzeroStockRows,
      (SELECT COUNT(*) FROM inventory_reservations r WHERE r.variant_id=? AND r.status='active') AS activeReservations,
      (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE oi.variant_id=? AND COALESCE(o.order_status,'active')='active'
          AND COALESCE(o.shipping_status,'not_sent')<>'sent' AND COALESCE(oi.quantity,0)>0) AS activeOrders,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=?) AS historicalOrders,
      (SELECT COUNT(*) FROM workshop_tasks wt WHERE wt.variant_id=? AND wt.status='active') AS activeWorkshop,
      (SELECT COUNT(*) FROM inventory_lifecycle_events e WHERE e.variant_id=? AND e.status='pending') AS pendingLifecycle,
      (SELECT COUNT(*) FROM inventory_stocktake_items i JOIN inventory_stocktake_sessions s ON s.id=i.session_id
        WHERE i.variant_id=? AND s.status='active') AS activeStocktake,
      (SELECT COUNT(*) FROM inventory_transfer_items i JOIN inventory_transfer_documents d ON d.id=i.transfer_id
        WHERE i.variant_id=? AND d.status='applied') AS appliedTransfers`
  ).bind(id,id,id,id,id,id,id,id,id,id).first<Omit<SkuImpact,'id'>>()
  return {
    id, physical: toInt(row?.physical,0), reserved: toInt(row?.reserved,0), nonzeroStockRows: toInt(row?.nonzeroStockRows,0),
    activeReservations: toInt(row?.activeReservations,0),
    activeOrders: toInt(row?.activeOrders,0), historicalOrders: toInt(row?.historicalOrders,0),
    activeWorkshop: toInt(row?.activeWorkshop,0),
    pendingLifecycle: toInt(row?.pendingLifecycle,0), activeStocktake: toInt(row?.activeStocktake,0),
    appliedTransfers: toInt(row?.appliedTransfers,0),
  }
}

function sameBusinessIdentity(source: Sku, target: Sku) {
  return source.product_id === target.product_id
    && source.stock_position_id != null && source.stock_position_id === target.stock_position_id
    && (source.category || 'adult') === (target.category || 'adult')
    && normalizeCatalogCombinationGender(source.gender) === normalizeCatalogCombinationGender(target.gender)
    && catalogColorIdentity(source.color) === catalogColorIdentity(target.color)
    && normalizeCatalogCombinationSize(source.size_label) === normalizeCatalogCombinationSize(target.size_label)
    && canonicalStockPositionValue(source.material) === canonicalStockPositionValue(target.material)
    && canonicalStockPositionValue(source.length) === canonicalStockPositionValue(target.length)
    && canonicalStockPositionValue(source.material) === canonicalStockPositionValue(source.execution_material)
    && canonicalStockPositionValue(source.length) === canonicalStockPositionValue(source.execution_length)
}

export async function previewCatalogVariantConsolidation(db: D1Database, sourceId: number, targetId: number) {
  if (!safeId(sourceId) || !safeId(targetId) || sourceId === targetId) {
    throw new Error('Выберите два разных варианта одного товара.')
  }
  const [source, target] = await Promise.all([readSku(db, sourceId), readSku(db, targetId)])
  if (!source || !target) throw new Error('Вариант товара не найден. Обновите список.')
  if (!sameBusinessIdentity(source, target)) {
    throw new Error('Эти варианты отличаются по товару, исполнению, полу, цвету или размеру. Автоматически объединять их нельзя.')
  }
  if (!target.is_active || !source.product_active || !source.position_active) {
    throw new Error('Основной вариант, товар и исполнение должны оставаться активными.')
  }
  const [sourceImpact, targetImpact, stocks] = await Promise.all([
    readImpact(db, sourceId), readImpact(db, targetId), readStocks(db, sourceId, targetId),
  ])
  const stockBreakdown = ['warehouse', 'boutique'].map(location => {
    const sourceStock = stocks.find(s => s.variant_id === sourceId && s.inventory_source === location)
    const targetStock = stocks.find(s => s.variant_id === targetId && s.inventory_source === location)
    const sourcePhysical = Number(sourceStock?.quantity || 0)
    const targetPhysical = Number(targetStock?.quantity || 0)
    return { location, sourcePhysical, targetPhysical, combinedPhysical: sourcePhysical + targetPhysical,
      sourceReserved: Number(sourceStock?.reserved_quantity || 0),
      targetReserved: Number(targetStock?.reserved_quantity || 0) }
  })
  const blockers: string[] = []
  if (!source.is_active) blockers.push('Лишний вариант уже неактивен.')
  if (stocks.some(s => !['warehouse','boutique'].includes(s.inventory_source))) blockers.push('Обнаружено неизвестное место хранения')
  if (stocks.some(s => !Number.isSafeInteger(s.quantity) || s.quantity < 0 || !Number.isSafeInteger(s.reserved_quantity) || s.reserved_quantity < 0)) {
    blockers.push('Складские количества некорректны: требуется сверка')
  }
  if (stocks.some(s => stocks.filter(x => x.variant_id===s.variant_id && x.inventory_source===s.inventory_source).length>1)) {
    blockers.push('Есть несколько складских записей одной позиции: нужна проверка')
  }
  if (sourceImpact.reserved !== 0 || sourceImpact.activeReservations) blockers.push('у лишнего варианта есть действующие резервы')
  if (sourceImpact.activeOrders) blockers.push('есть активные неотправленные заказы')
  if (sourceImpact.activeWorkshop) blockers.push('есть незавершённые задачи Цеха')
  if (sourceImpact.pendingLifecycle) blockers.push('есть незавершённая приёмка или возврат')
  if (sourceImpact.activeStocktake || targetImpact.activeStocktake) blockers.push('один из вариантов участвует в действующей ревизии')
  if (sourceImpact.appliedTransfers) blockers.push('у лишнего варианта есть перемещение, которое ещё можно отменить')
  return {
    ok: true,
    source: { id: source.id, color: source.color, size: source.size_label, active: Boolean(source.is_active) },
    target: { id: target.id, color: target.color, size: target.size_label, active: Boolean(target.is_active) },
    productName: source.product_name, material: source.execution_material, length: source.execution_length,
    sourceImpact, targetImpact, stockBreakdown, stateToken: snapshotToken(source,target,stocks),
    transferQuantity: stockBreakdown.reduce((sum,r)=>sum + r.sourcePhysical,0),
    blockers, canConsolidate: blockers.length === 0,
    explanation: blockers.length
      ? 'Система не будет менять заказы, резервы и историю. Проверьте указанные связи; не списывайте товар ради очистки.'
      : 'Физические остатки будут перенесены на основной вариант отдельно по складу и бутику, без фиктивного списания. Старый вариант и все исторические документы сохранятся.',
  }
}

// Guard the final UPDATE against stale previews, concurrent stock changes and
// edits to *either* SKU. D1 batch is atomic with the matching audit INSERT.
export async function consolidateUnusedCatalogVariant(
  db: D1Database, sourceId: number, targetId: number, actor = '',
) {
  const preview = await previewCatalogVariantConsolidation(db, sourceId, targetId)
  if (!preview.source.active) {
    const prior = await db.prepare(
      'SELECT target_variant_id FROM catalog_variant_consolidations WHERE source_variant_id=?'
    ).bind(sourceId).first<{ target_variant_id: number }>()
    if (toInt(prior?.target_variant_id,0) === targetId) {
      return { ok: true, alreadyConsolidated: true, sourceId, targetId }
    }
    throw new Error('Этот вариант уже отключён. Обновите список.')
  }
  if (!preview.canConsolidate) throw new Error('Объединение пока невозможно: ' + preview.blockers.join('; '))

  const [source, target] = await Promise.all([readSku(db, sourceId), readSku(db, targetId)])
  if (!source || !target || !sameBusinessIdentity(source, target)) {
    throw new Error('Варианты изменились. Обновите проверку и повторите.')
  }
  const stamp = new Date().toISOString()
  const sourceFields = [
    source.product_id, source.stock_position_id, source.category, source.gender,
    source.color, source.size_label, source.material, source.length, source.updated_at,
  ]
  const targetFields = [
    target.product_id, target.stock_position_id, target.category, target.gender,
    target.color, target.size_label, target.material, target.length, target.updated_at,
  ]
  const identityPredicate = (alias: string) => [
    'product_id=?', 'stock_position_id=?', 'category IS ?', 'gender IS ?',
    'color IS ?', 'size_label IS ?', 'material IS ?', 'length IS ?', 'updated_at IS ?',
  ].map(x => alias + '.' + x).join(' AND ')

  const results = await db.batch([
    db.prepare(
      `UPDATE catalog_variants AS v SET is_active=0, updated_at=?
       WHERE v.id=? AND v.is_active=1 AND ${identityPredicate('v')}
         AND EXISTS (
           SELECT 1 FROM catalog_variants t
           JOIN catalog_products p ON p.id=t.product_id AND p.is_active=1
           JOIN catalog_stock_positions sp ON sp.id=t.stock_position_id AND sp.is_active=1
           WHERE t.id=? AND t.is_active=1
             AND t.product_id=v.product_id AND t.stock_position_id=v.stock_position_id
             AND ${identityPredicate('t')}
         )
         AND NOT EXISTS (
           SELECT 1 FROM inventory_stock s WHERE s.variant_id=v.id
             AND (COALESCE(s.quantity,0)<>0 OR COALESCE(s.reserved_quantity,0)<>0)
         )
         AND NOT EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active')
         AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
           WHERE oi.variant_id=v.id AND COALESCE(o.order_status,'active')='active'
             AND COALESCE(o.shipping_status,'not_sent')<>'sent' AND COALESCE(oi.quantity,0)>0)
         AND NOT EXISTS (SELECT 1 FROM workshop_tasks wt WHERE wt.variant_id=v.id AND wt.status='active')
         AND NOT EXISTS (SELECT 1 FROM inventory_lifecycle_events e WHERE e.variant_id=v.id AND e.status='pending')
         AND NOT EXISTS (SELECT 1 FROM inventory_stocktake_items i
           JOIN inventory_stocktake_sessions s ON s.id=i.session_id
           WHERE i.variant_id IN (v.id, ?) AND s.status='active')`
    ).bind(stamp, sourceId, ...sourceFields, targetId, ...targetFields, targetId),
    db.prepare(
      `INSERT INTO catalog_variant_consolidations
        (source_variant_id,target_variant_id,product_id,source_color,target_color,
         material,length,category,gender,size_label,source_physical_quantity,
         source_reserved_quantity,created_by,created_at)
       SELECT v.id,?,?,?,?,?,?,?,?,?,0,0,?,?
       FROM catalog_variants v WHERE v.id=? AND v.is_active=0 AND v.updated_at=?`
    ).bind(
      targetId,source.product_id,source.color,target.color,source.execution_material,
      source.execution_length,source.category,source.gender,source.size_label,
      actor,stamp,sourceId,stamp,
    ),
  ])
  if (toInt(results[0].meta?.changes,0) !== 1 || toInt(results[1].meta?.changes,0) !== 1) {
    throw new Error('Каталог или склад изменились во время проверки. Обновите список и повторите действие.')
  }
  return { ok: true, consolidated: true, sourceId, targetId, historicalOrdersPreserved: preview.sourceImpact.historicalOrders }
}


export async function listRecentCatalogVariantConsolidations(db: D1Database) {
  const res = await db.prepare(
    `SELECT h.id, h.source_variant_id AS sourceId, h.target_variant_id AS targetId,
       p.name AS productName, h.source_color AS sourceColor, h.target_color AS targetColor,
       h.material, h.length, h.size_label AS size, h.category, h.gender,
       h.created_by AS createdBy, h.created_at AS createdAt
     FROM catalog_variant_consolidations h
     JOIN catalog_products p ON p.id=h.product_id
     ORDER BY h.id DESC LIMIT 30`
  ).all<{
    id: number; sourceId: number; targetId: number; productName: string;
    sourceColor: string | null; targetColor: string | null;
    material: string | null; length: string | null; size: string | null;
    category: string | null; gender: string | null;
    createdBy: string | null; createdAt: string;
  }>()
  return { ok: true, items: res.results || [] }
}
