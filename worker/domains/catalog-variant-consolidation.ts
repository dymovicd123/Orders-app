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

// The D1 batch is atomic. A guarded audit INSERT permits every stock write;
// a failing CHECK(passed=1) validation INSERT rolls back the entire batch.
export async function consolidateUnusedCatalogVariant(
  db: D1Database, sourceId: number, targetId: number, actor = '', expectedToken = '',
) {
  const prior = await db.prepare(
    'SELECT target_variant_id FROM catalog_variant_consolidations WHERE source_variant_id=?'
  ).bind(sourceId).first<{ target_variant_id: number }>()
  if (prior) {
    if (toInt(prior.target_variant_id,0) === targetId) return { ok:true, alreadyConsolidated:true, sourceId,targetId }
    throw new Error('Эта вариация уже объединена с другой. Обновите список.')
  }
  const preview = await previewCatalogVariantConsolidation(db,sourceId,targetId)
  if (!preview.canConsolidate) throw new Error('Объединение пока невозможно: '+preview.blockers.join('; '))
  if (preview.transferQuantity > 0 && (!expectedToken || expectedToken !== preview.stateToken)) {
    throw new Error('Остатки изменились или не подтверждены. Обновите предпросмотр объединения.')
  }
  if (expectedToken && expectedToken !== preview.stateToken) throw new Error('Данные изменились после проверки. Проверьте остатки заново.')

  const [source,target,stocks] = await Promise.all([readSku(db,sourceId),readSku(db,targetId),readStocks(db,sourceId,targetId)])
  if (!source || !target || !sameBusinessIdentity(source,target) || snapshotToken(source,target,stocks)!==preview.stateToken) {
    throw new Error('Каталог изменился после проверки. Обновите предпросмотр.')
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
  ].map(x=>alias+'.'+x).join(' AND ')
  const ref = 'catalog-consolidation:'+sourceId+'->'+targetId
  const journalExists = `EXISTS (SELECT 1 FROM catalog_variant_consolidations c
    WHERE c.source_variant_id=? AND c.target_variant_id=? AND c.created_at=?)`
  const beforeStock = stockSnapshotJson(stocks)
  const statements = [
    db.prepare(
      `INSERT INTO catalog_variant_consolidations (
        source_variant_id,target_variant_id,product_id,source_color,target_color,
        material,length,category,gender,size_label,source_physical_quantity,
        source_reserved_quantity,created_by,created_at)
      SELECT v.id,t.id,v.product_id,v.color,t.color,sp.material,sp.length,v.category,v.gender,v.size_label,
        COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s WHERE s.variant_id=v.id),0),
        0,?,?
      FROM catalog_variants v
      JOIN catalog_variants t ON t.id=? AND t.is_active=1 AND t.product_id=v.product_id AND t.stock_position_id=v.stock_position_id
      JOIN catalog_products p ON p.id=v.product_id AND p.is_active=1
      JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id AND sp.is_active=1
      WHERE v.id=? AND v.is_active=1 AND ${identityPredicate('v')} AND ${identityPredicate('t')}
        AND NOT EXISTS (SELECT 1 FROM catalog_variant_consolidations c WHERE c.source_variant_id=v.id)
        AND (SELECT COUNT(*) FROM inventory_stock z WHERE z.variant_id IN (v.id,t.id))=json_array_length(?)
        AND NOT EXISTS (
          SELECT 1 FROM inventory_stock z
          WHERE z.variant_id IN (v.id,t.id)
            AND NOT EXISTS (
              SELECT 1 FROM json_each(?) j
              WHERE CAST(json_extract(j.value,'$[0]') AS INTEGER)=z.id
                AND json_extract(j.value,'$[1]')=z.inventory_source
                AND CAST(json_extract(j.value,'$[2]') AS INTEGER)=z.variant_id
                AND CAST(json_extract(j.value,'$[3]') AS INTEGER)=z.quantity
                AND CAST(json_extract(j.value,'$[4]') AS INTEGER)=z.reserved_quantity
            )
        )
        AND NOT EXISTS (SELECT 1 FROM inventory_stock s WHERE s.variant_id IN (v.id,t.id)
          AND (s.quantity<0 OR s.reserved_quantity<0 OR s.quantity IS NULL OR s.reserved_quantity IS NULL
            OR s.inventory_source NOT IN ('warehouse','boutique')))
        AND NOT EXISTS (SELECT 1 FROM inventory_stock s WHERE s.variant_id=v.id AND s.reserved_quantity<>0)
        AND NOT EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active')
        AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
          WHERE oi.variant_id=v.id AND COALESCE(o.order_status,'active')='active'
            AND COALESCE(o.shipping_status,'not_sent')<>'sent' AND oi.quantity>0)
        AND NOT EXISTS (SELECT 1 FROM workshop_tasks wt WHERE wt.variant_id=v.id AND wt.status='active')
        AND NOT EXISTS (SELECT 1 FROM inventory_lifecycle_events e WHERE e.variant_id=v.id AND e.status='pending')
        AND NOT EXISTS (SELECT 1 FROM inventory_stocktake_items i
          JOIN inventory_stocktake_sessions sess ON sess.id=i.session_id
          WHERE i.variant_id IN (v.id,t.id) AND sess.status='active')
        AND NOT EXISTS (SELECT 1 FROM inventory_transfer_items i
          JOIN inventory_transfer_documents d ON d.id=i.transfer_id
          WHERE i.variant_id=v.id AND d.status='applied')`
    ).bind(actor||null,stamp,targetId,sourceId,...sourceFields,...targetFields,beforeStock,beforeStock),
    db.prepare(
      `INSERT INTO catalog_variant_consolidation_stock_rows (
        consolidation_id,inventory_source,source_stock_id,target_stock_id_before,
        source_quantity_before,target_quantity_before,target_reserved_before,combined_quantity_after)
      SELECT c.id,s.inventory_source,s.id,t.id,s.quantity,COALESCE(t.quantity,0),
        COALESCE(t.reserved_quantity,0),s.quantity+COALESCE(t.quantity,0)
      FROM catalog_variant_consolidations c
      JOIN inventory_stock s ON s.variant_id=c.source_variant_id
      LEFT JOIN inventory_stock t ON t.variant_id=c.target_variant_id AND t.inventory_source=s.inventory_source
      WHERE c.source_variant_id=? AND c.target_variant_id=? AND c.created_at=?`
    ).bind(sourceId,targetId,stamp),
    db.prepare(
      `INSERT INTO inventory_stock (
        inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,
        material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity,
        last_action,last_source_ref,created_at,updated_at,external_product_id,external_variant_id)
      SELECT s.inventory_source,v.product_id,v.id,p.name,NULLIF(v.gender,''),NULLIF(v.color,''),
        COALESCE(NULLIF(v.material,''),'СТАНДАРТ'),COALESCE(NULLIF(v.length,''),'СТАНДАРТ'),
        NULLIF(v.size_label,''),s.quantity,0,'Объединение вариаций',?,?,?,p.external_id,v.external_id
      FROM inventory_stock s JOIN catalog_variants v ON v.id=?
      JOIN catalog_products p ON p.id=v.product_id
      WHERE s.variant_id=? AND s.quantity>0 AND ${journalExists}
      ON CONFLICT(inventory_source,variant_id) WHERE variant_id IS NOT NULL
      DO UPDATE SET quantity=inventory_stock.quantity+excluded.quantity,
        last_action='Объединение вариаций',last_source_ref=excluded.last_source_ref,
        updated_at=excluded.updated_at`
    ).bind(ref,stamp,stamp,targetId,sourceId,sourceId,targetId,stamp),
    db.prepare(
      `UPDATE inventory_stock SET quantity=0,reserved_quantity=0,
        last_action='Объединение вариаций',last_source_ref=?,updated_at=?
      WHERE variant_id=? AND ${journalExists}`
    ).bind(ref,stamp,sourceId,sourceId,targetId,stamp),
    db.prepare(
      `UPDATE catalog_variants SET is_active=0,updated_at=?
      WHERE id=? AND is_active=1 AND ${journalExists}`
    ).bind(stamp,sourceId,sourceId,targetId,stamp),
    // CHECK constraint failure aborts all writes in this D1 batch.
    db.prepare(
      `INSERT INTO catalog_variant_consolidation_validations(consolidation_id,passed,checked_at)
      SELECT c.id,CASE WHEN v.is_active=0 AND t.is_active=1 AND NOT EXISTS (
        SELECT 1 FROM catalog_variant_consolidation_stock_rows l
        LEFT JOIN inventory_stock s ON s.id=l.source_stock_id
        LEFT JOIN inventory_stock dest ON dest.inventory_source=l.inventory_source AND dest.variant_id=c.target_variant_id
        WHERE l.consolidation_id=c.id AND (
          s.id IS NULL OR s.quantity<>0 OR s.reserved_quantity<>0
          OR COALESCE(dest.quantity,0)<>l.combined_quantity_after
          OR COALESCE(dest.reserved_quantity,0)<>l.target_reserved_before
          OR (l.source_quantity_before>0 AND dest.id IS NULL)
        )
      ) THEN 1 ELSE 0 END,?
      FROM catalog_variant_consolidations c
      JOIN catalog_variants v ON v.id=c.source_variant_id
      JOIN catalog_variants t ON t.id=c.target_variant_id
      WHERE c.source_variant_id=? AND c.target_variant_id=? AND c.created_at=?`
    ).bind(stamp,sourceId,targetId,stamp),
  ]
  const results = await db.batch(statements)
  if (toInt(results[0].meta?.changes,0)!==1
    || toInt(results[4].meta?.changes,0)!==1
    || toInt(results[5].meta?.changes,0)!==1) {
    throw new Error('Склад или Каталог изменились во время проверки. Обновите данные и повторите.')
  }
  return {
    ok:true, consolidated:true, sourceId,targetId,
    transferredQuantity:preview.transferQuantity, stockBreakdown:preview.stockBreakdown,
    historicalOrdersPreserved:preview.sourceImpact.historicalOrders,
  }
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
