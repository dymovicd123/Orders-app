// Catalog Integrity R2 — retire an identical, unused SKU without rewriting operational history.
import { canonicalStockPositionValue, toInt } from '../core/text.ts'
import { catalogColorIdentity, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize } from './catalog.ts'
import { businessMonthRange } from './reference-merge-preview.ts'
import { buildStockReconciliationPlan } from './catalog-stock-reconciliation.ts'
import type { StockCheckEvidence } from './catalog-stock-reconciliation.ts'

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
  activeWorkshop: number; pendingLifecycle: number; appliedLifecycle: number; activeStocktake: number; appliedTransfers: number; reversibleMovements: number; returnExchangeLinks: number;
}
const safeId = (n: number) => Number.isSafeInteger(n) && n > 0
type StockRow = { id: number; inventory_source: string; variant_id: number; quantity: number; reserved_quantity: number }
type ReservationRow = {
  id: number; order_id: number; order_item_id: number; inventory_source: string;
  product_id: number | null; variant_id: number; quantity: number; updated_at: string;
  order_variant_id: number | null; order_product_id: number | null; order_quantity: number;
  order_source: string; stock_status: string; is_workshop: number;
  order_status: string; shipping_status: string;
}
async function readActiveReservations(db: D1Database, sourceId: number, targetId: number) {
  const result = await db.prepare(
    `SELECT r.id,r.order_id,r.order_item_id,r.inventory_source,r.product_id,r.variant_id,
       r.quantity,r.updated_at,oi.variant_id AS order_variant_id,
       oi.product_id AS order_product_id,oi.quantity AS order_quantity,oi.source_type AS order_source,
       oi.stock_writeoff_status AS stock_status,COALESCE(oi.is_workshop,0) AS is_workshop,
       o.order_status,o.shipping_status
     FROM inventory_reservations r
     LEFT JOIN order_items oi ON oi.id=r.order_item_id
     LEFT JOIN orders o ON o.id=r.order_id
     WHERE r.variant_id IN (?,?) AND r.status='active'
     ORDER BY r.id ASC`
  ).bind(sourceId,targetId).all<ReservationRow>()
  return result.results || []
}
function reservationSnapshotJson(rows: ReservationRow[]) {
  return JSON.stringify(rows.map(r=>[r.id,r.order_id,r.order_item_id,r.inventory_source,
    r.variant_id,r.quantity,r.updated_at]))
}

async function readStocks(db: D1Database, sourceId: number, targetId: number) {
  const result = await db.prepare(
    `SELECT id, inventory_source, variant_id, quantity, reserved_quantity
     FROM inventory_stock WHERE variant_id IN (?, ?) ORDER BY id ASC`
  ).bind(sourceId, targetId).all<StockRow>()
  return result.results || []
}
function snapshotToken(source: Sku, target: Sku, stocks: StockRow[], reservations: ReservationRow[], month: {from:string;toExclusive:string}) {
  return JSON.stringify({
    source: [source.id,source.updated_at,source.color,source.size_label],
    target: [target.id,target.updated_at,target.color,target.size_label],
    stocks: stocks.map(x=>[x.id,x.inventory_source,x.variant_id,x.quantity,x.reserved_quantity]),
    reservations: reservationSnapshotJson(reservations),
    month: [month.from,month.toExclusive],
  })
}
async function readLatestPhysicalChecks(db: D1Database, sourceId: number, keeperId: number): Promise<StockCheckEvidence[]> {
  const result = await db.prepare(
    `WITH ranked AS (
      SELECT variant_id, inventory_source, counted_quantity, checked_at, check_type, checked_by,
        ROW_NUMBER() OVER (
          PARTITION BY variant_id, inventory_source ORDER BY datetime(checked_at) DESC, id DESC
        ) AS rank
      FROM inventory_stock_checks
      WHERE variant_id IN (?,?)
        AND check_type IN ('quick_stocktake','selective_stocktake','full_stocktake','cycle_count','physical_count')
    )
    SELECT variant_id, inventory_source, counted_quantity, checked_at, check_type, checked_by
    FROM ranked WHERE rank=1`
  ).bind(sourceId,keeperId).all<{
    variant_id:number;inventory_source:string;counted_quantity:number;checked_at:string;
    check_type:string;checked_by:string|null
  }>()
  return (result.results||[]).map(row=>({
    variantId:Number(row.variant_id),location:row.inventory_source,
    countedQuantity:Number(row.counted_quantity),checkedAt:row.checked_at,
    checkType:row.check_type,checkedBy:row.checked_by,
  }))
}
function stockSnapshotJson(stocks: StockRow[]) {
  return JSON.stringify(stocks.map(x=>[x.id,x.inventory_source,x.variant_id,x.quantity,x.reserved_quantity]))
}

type HistoricalLineage = {
  original_target: number; latest_target: number | null;
  latest_kind: 'merge' | 'undo' | null; source_active: number;
}
async function readHistoricalLineage(db: D1Database, sourceId: number) {
  return db.prepare(`
    SELECT c.target_variant_id AS original_target,
      e.target_variant_id AS latest_target, e.event_kind AS latest_kind,
      s.is_active AS source_active
    FROM catalog_variant_consolidations c
    JOIN catalog_variants s ON s.id=c.source_variant_id
    LEFT JOIN catalog_variant_merge_generation_events e ON e.id=(
      SELECT last.id FROM catalog_variant_merge_generation_events last
      WHERE last.source_variant_id=c.source_variant_id
      ORDER BY last.generation DESC LIMIT 1
    )
    WHERE c.source_variant_id=? LIMIT 1
  `).bind(sourceId).first<HistoricalLineage>()
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
      (SELECT COUNT(*) FROM inventory_lifecycle_events e WHERE e.variant_id=? AND e.status='applied') AS appliedLifecycle,
      (SELECT COUNT(*) FROM inventory_stocktake_items i JOIN inventory_stocktake_sessions s ON s.id=i.session_id
        WHERE i.variant_id=? AND s.status='active') AS activeStocktake,
      (SELECT COUNT(*) FROM inventory_transfer_items i JOIN inventory_transfer_documents d ON d.id=i.transfer_id
        WHERE i.variant_id=? AND d.status='applied') AS appliedTransfers,
      (SELECT COUNT(*) FROM inventory_movements m
        WHERE m.variant_id=? AND LOWER(TRIM(COALESCE(m.reference_type,''))) IN ('manual','transfer_in','transfer_out')
          AND NOT EXISTS (SELECT 1 FROM inventory_movement_reversals rev WHERE rev.original_movement_id=m.id)
      ) AS reversibleMovements,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=? AND (
         EXISTS(SELECT 1 FROM return_items ri WHERE ri.order_item_id=oi.id)
         OR EXISTS(SELECT 1 FROM exchanges e WHERE e.old_order_item_id=oi.id OR e.new_order_item_id=oi.id)
         OR EXISTS(SELECT 1 FROM exchange_items ei WHERE ei.order_item_id=oi.id)
       )) AS returnExchangeLinks`
  ).bind(id,id,id,id,id,id,id,id,id,id,id,id,id).first<Omit<SkuImpact,'id'>>()
  return {
    id, physical: toInt(row?.physical,0), reserved: toInt(row?.reserved,0), nonzeroStockRows: toInt(row?.nonzeroStockRows,0),
    activeReservations: toInt(row?.activeReservations,0),
    activeOrders: toInt(row?.activeOrders,0), historicalOrders: toInt(row?.historicalOrders,0),
    activeWorkshop: toInt(row?.activeWorkshop,0),
    pendingLifecycle: toInt(row?.pendingLifecycle,0), appliedLifecycle: toInt(row?.appliedLifecycle,0), activeStocktake: toInt(row?.activeStocktake,0),
    appliedTransfers: toInt(row?.appliedTransfers,0), reversibleMovements: toInt(row?.reversibleMovements,0),
    returnExchangeLinks: toInt(row?.returnExchangeLinks,0),
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
  const previousMerge=await readHistoricalLineage(db,sourceId)
  const [sourceImpact, targetImpact, stocks, reservations] = await Promise.all([
    readImpact(db, sourceId), readImpact(db, targetId), readStocks(db, sourceId, targetId),
    readActiveReservations(db, sourceId, targetId),
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
  const recentPhysicalChecks=await readLatestPhysicalChecks(db,sourceId,targetId)
  const stockReconciliation=buildStockReconciliationPlan(stockBreakdown,recentPhysicalChecks,sourceId,targetId)
  const month=businessMonthRange()
  // A still-open past/future order must keep its historical SKU. It cannot be
  // silently re-pointed as part of current-month catalog cleanup.
  const outOfMonth = await db.prepare(
    `SELECT COUNT(*) AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id
       WHERE oi.variant_id=? AND oi.quantity>0 AND o.order_status='active'
         AND COALESCE(o.shipping_status,'not_sent')<>'sent'
         AND (COALESCE(o.order_date,'')<? OR o.order_date>=?)`
  ).bind(sourceId,month.from,month.toExclusive).first<{n:number}>()
  const blockers: string[] = []
  if (toInt(outOfMonth?.n,0)>0) {
    blockers.push('Есть незавершённые заказы других месяцев. Их SKU нельзя менять задним числом.')
  }
  if (!source.is_active) blockers.push('Лишний вариант уже неактивен.')
  if (previousMerge) {
    blockers.push(previousMerge.latest_kind==='undo' && source.is_active===1
      ? 'Этот вариант уже объединяли и затем восстановили. Повторное объединение требует отдельной защищённой операции; обычная кнопка пока недоступна.'
      : 'У этого варианта уже есть история объединений. Повторная запись первоначального объединения запрещена.')
  }
  if (stocks.some(s => !['warehouse','boutique'].includes(s.inventory_source))) blockers.push('Обнаружено неизвестное место хранения')
  if (stocks.some(s => !Number.isSafeInteger(s.quantity) || s.quantity < 0 || !Number.isSafeInteger(s.reserved_quantity) || s.reserved_quantity < 0)) {
    blockers.push('Складские количества некорректны: требуется сверка')
  }
  if (stocks.some(s => stocks.filter(x => x.variant_id===s.variant_id && x.inventory_source===s.inventory_source).length>1)) {
    blockers.push('Есть несколько складских записей одной позиции: нужна проверка')
  }
  const sourceReservations = reservations.filter(r=>r.variant_id===sourceId)
  const activeReservationQuantity = sourceReservations.reduce((n,r)=>n+r.quantity,0)
  if (sourceImpact.activeOrders !== sourceReservations.length) {
    blockers.push('не все открытые позиции заказов связаны с корректными резервами')
  }
  if (sourceReservations.some(r=>r.order_variant_id!==sourceId
    || r.order_product_id!==source.product_id || r.product_id!==source.product_id
    || r.order_quantity!==r.quantity || r.quantity<=0 || r.is_workshop!==0
    || r.order_source!==r.inventory_source
    || r.stock_status!=='reserved'
    || r.order_status!=='active' || r.shipping_status==='sent'
    || !['warehouse','boutique'].includes(r.inventory_source))) {
    blockers.push('часть резервов не совпадает с действующими строками заказов или уже отправлена')
  }
  if (sourceImpact.activeReservations!==sourceReservations.length) blockers.push('неполные данные о действующих резервах')
  for (const place of stockBreakdown) {
    const totalSource = sourceReservations.filter(r=>r.inventory_source===place.location).reduce((n,r)=>n+r.quantity,0)
    const totalKeeper = reservations.filter(r=>r.variant_id===targetId && r.inventory_source===place.location).reduce((n,r)=>n+r.quantity,0)
    if (totalSource!==place.sourceReserved || totalKeeper!==place.targetReserved) {
      blockers.push('резервы склада/бутика не совпадают с действующими заказами — нужна сверка')
      break
    }
  }
  if (sourceImpact.reserved!==activeReservationQuantity) blockers.push('резерв исходного варианта требует сверки')
  if (sourceImpact.activeWorkshop) blockers.push('есть незавершённые задачи Цеха')
  if (sourceImpact.pendingLifecycle) blockers.push('есть незавершённая приёмка или возврат')
  if (sourceImpact.appliedLifecycle) blockers.push('есть операция возврата или обмена, которую ещё могут отменить')
  if (sourceImpact.activeStocktake || targetImpact.activeStocktake) blockers.push('один из вариантов участвует в действующей ревизии')
  if (sourceImpact.appliedTransfers) blockers.push('у лишнего варианта есть перемещение, которое ещё можно отменить')
  if (sourceImpact.reversibleMovements) blockers.push('есть складское движение, отмена которого вернёт количество на старый вариант')
  if (sourceImpact.returnExchangeLinks) blockers.push('есть возвраты или обмены, при отмене которых может восстановиться исходный вариант')
  return {
    ok: true,
    source: { id: source.id, color: source.color, size: source.size_label, active: Boolean(source.is_active) },
    target: { id: target.id, color: target.color, size: target.size_label, active: Boolean(target.is_active) },
    productName: source.product_name, material: source.execution_material, length: source.execution_length,
    sourceImpact, targetImpact, stockBreakdown, stockReconciliation, month, reservationCount: sourceReservations.length,
    stateToken: snapshotToken(source,target,stocks,reservations,month),
    requiresGenerationAwareReMerge: Boolean(previousMerge?.latest_kind==='undo' && source.is_active===1),
    transferQuantity: stockBreakdown.reduce((sum,r)=>sum + r.sourcePhysical,0),
    blockers,
    // The currently shipped UI cannot attest independent physical inventory.
    // Do not offer a one-click additive merge for positive source stock.
    canConsolidate: blockers.length === 0 && !stockReconciliation.requiresHumanStockDecision,
    canConsolidateAfterVerifiedSum: blockers.length === 0,
    explanation: stockReconciliation.requiresHumanStockDecision
      ? 'Есть физические остатки. Их нельзя автоматически складывать: требуется отдельное подтверждённое решение для каждого места хранения.'
      : blockers.length
      ? 'Система не будет менять заказы, резервы и историю. Проверьте указанные связи; не списывайте товар ради очистки.'
      : 'Остатки и действующие резервы будут объединены по месту хранения. Открытые позиции заказов перейдут на основной SKU; названия, цены и другие снимки истории останутся прежними. Фиктивного списания нет.',
  }
}

// The D1 batch is atomic. A guarded audit INSERT permits every stock write;
// a failing CHECK(passed=1) validation INSERT rolls back the entire batch.
export async function consolidateUnusedCatalogVariant(
  db: D1Database, sourceId: number, targetId: number, actor = '', expectedToken = '',
  verifiedStockDecisions: Array<{
    location:string; method:string; physicallyVerified:boolean; countedQuantity?:number; reason?:string
  }> = [],
) {
  const prior = await readHistoricalLineage(db,sourceId)
  if (prior) {
    const effectiveKeeper=prior.latest_kind==='undo' ? null
      :prior.latest_kind==='merge' ? prior.latest_target : prior.original_target
    if (prior.source_active===0 && effectiveKeeper===targetId) {
      return { ok:true, alreadyConsolidated:true, sourceId,targetId }
    }
    if (prior.source_active===1 && prior.latest_kind==='undo') {
      throw new Error('Этот вариант был восстановлен после объединения. Обычная операция не может повторно использовать старый журнал: требуется отдельное защищённое повторное объединение.')
    }
    throw new Error('История объединений изменилась: этот вариант уже связан с другим основным SKU либо находится в некорректном состоянии. Обновите список.')
  }
  const preview = await previewCatalogVariantConsolidation(db,sourceId,targetId)
  // Even a zero-stock SKU can have live order, lifecycle or identity references.
  // No write is allowed without an explicit preview token for this exact pair.
  if (!expectedToken) {
    throw new Error('Объединение требует подтверждённого предпросмотра. Проверьте связанные заказы и склад заново.')
  }
  if (expectedToken !== preview.stateToken) {
    throw new Error('Данные склада или заказов изменились после проверки. Обновите предпросмотр объединения.')
  }
  if (preview.blockers.length) throw new Error('Объединение пока невозможно: '+preview.blockers.join('; '))
  // Preview is advisory, but approval is per actual location and validated
  // again against authoritative state in the same atomic D1 batch.
  type LocalChoice={location:string;method:string;final:number;reason:string}
  if(!Array.isArray(verifiedStockDecisions)){
    throw new Error('Укажите решение отдельно для каждого места хранения.')
  }
  const positive=preview.stockReconciliation.locations.filter(place=>place.requiresDecision)
  const requiredLocations=new Set<string>(positive.map(place=>place.location))
  const chosen=new Map<string,LocalChoice>()
  for(const decision of verifiedStockDecisions){
    if(!decision || !requiredLocations.has(decision.location) || chosen.has(decision.location)
      || decision.physicallyVerified!==true
      || !['sum','keep_source','keep_keeper','physical_count'].includes(decision.method)){
      throw new Error('Недопустимое решение по остаткам. Для каждой точки требуется отдельная проверка.')
    }
    const place=positive.find(p=>p.location===decision.location)!
    const total=place.sourcePhysical+place.keeperPhysical
    const final=decision.method==='sum'?total
      :decision.method==='keep_source'?place.sourcePhysical
      :decision.method==='keep_keeper'?place.keeperPhysical
      :decision.countedQuantity
    if(typeof final!=='number'||!Number.isSafeInteger(final)||final<0
      || (decision.method==='physical_count' && !Number.isSafeInteger(decision.countedQuantity))
      || (decision.method!=='physical_count' && decision.countedQuantity!==undefined)){
      throw new Error('Фактическое количество неверно: используйте целое неотрицательное число.')
    }
    const reason=(decision.reason||'').trim()
    if(decision.method!=='sum' && (reason.length<12 || reason.length>500)){
      throw new Error('Для изменения физического количества укажите причину не менее 12 символов.')
    }
    if(final < place.reservedTotal){
      throw new Error('Итоговый остаток меньше действующих резервов. Сначала урегулируйте заказы.')
    }
    chosen.set(decision.location,{location:decision.location,method:decision.method,final,reason})
  }
  if(chosen.size!==requiredLocations.size){
    throw new Error('Нельзя автоматически складывать остатки. Подтвердите их физическую независимость отдельно для склада и бутика.')
  }
  const hasPhysicalCorrection=[...chosen.values()].some(c=>c.method!=='sum')
  if(hasPhysicalCorrection){
    const impacts=[preview.sourceImpact,preview.targetImpact]
    if(impacts.some(i=>i.activeOrders||i.activeReservations||i.reserved
      ||i.activeWorkshop||i.pendingLifecycle||i.appliedLifecycle||i.activeStocktake
      ||i.appliedTransfers||i.reversibleMovements||i.returnExchangeLinks)){
      throw new Error('Корректировка физического остатка при активных заказах, резервах или обратимых операциях запрещена.')
    }
  }

  const [source,target,stocks,reservations] = await Promise.all([readSku(db,sourceId),readSku(db,targetId),readStocks(db,sourceId,targetId),readActiveReservations(db,sourceId,targetId)])
  if (!source || !target || !sameBusinessIdentity(source,target) || snapshotToken(source,target,stocks,reservations,businessMonthRange())!==preview.stateToken) {
    throw new Error('Каталог изменился после проверки. Обновите предпросмотр.')
  }
  const decisions=stocks.filter(st=>st.variant_id===sourceId).map(st=>{
    const keeper=stocks.find(k=>k.variant_id===targetId && k.inventory_source===st.inventory_source)
    const c=chosen.get(st.inventory_source)
    const final=c?.final ?? st.quantity+(keeper?.quantity??0)
    if(!Number.isSafeInteger(final)||final<0){
      throw new Error('Количество выходит за безопасные пределы.')
    }
    return {location:st.inventory_source,method:c?.method??'sum',
      final,reason:c?.reason??''}
  })
  const decisionJson=JSON.stringify(decisions)
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
  const beforeReservations = reservationSnapshotJson(reservations)
  const statements = [
    db.prepare(
      `INSERT INTO catalog_variant_consolidations (
        source_variant_id,target_variant_id,product_id,source_color,target_color,
        material,length,category,gender,size_label,source_physical_quantity,
        source_reserved_quantity,created_by,created_at)
      SELECT v.id,t.id,v.product_id,v.color,t.color,sp.material,sp.length,v.category,v.gender,v.size_label,
        COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s WHERE s.variant_id=v.id),0),
        COALESCE((SELECT SUM(s.reserved_quantity) FROM inventory_stock s WHERE s.variant_id=v.id),0),?,?
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
        AND (SELECT COUNT(*) FROM inventory_reservations r WHERE r.variant_id IN (v.id,t.id) AND r.status='active')=json_array_length(?)
        AND NOT EXISTS (
          SELECT 1 FROM inventory_reservations r
          WHERE r.variant_id IN (v.id,t.id) AND r.status='active'
            AND NOT EXISTS (SELECT 1 FROM json_each(?) j
              WHERE CAST(json_extract(j.value,'$[0]') AS INTEGER)=r.id
                AND CAST(json_extract(j.value,'$[1]') AS INTEGER)=r.order_id
                AND CAST(json_extract(j.value,'$[2]') AS INTEGER)=r.order_item_id
                AND json_extract(j.value,'$[3]')=r.inventory_source
                AND CAST(json_extract(j.value,'$[4]') AS INTEGER)=r.variant_id
                AND CAST(json_extract(j.value,'$[5]') AS INTEGER)=r.quantity
                AND json_extract(j.value,'$[6]')=r.updated_at)
        )
        AND NOT EXISTS (SELECT 1 FROM inventory_reservations r
          LEFT JOIN order_items oi ON oi.id=r.order_item_id
          LEFT JOIN orders o ON o.id=r.order_id
          WHERE r.variant_id=v.id AND r.status='active'
            AND (oi.id IS NULL OR o.id IS NULL OR oi.order_id<>r.order_id
              OR oi.variant_id<>v.id OR oi.product_id<>v.product_id OR r.product_id<>v.product_id
              OR oi.quantity<>r.quantity OR oi.quantity<=0 OR COALESCE(oi.is_workshop,0)<>0
              OR oi.source_type<>r.inventory_source OR oi.stock_writeoff_status<>'reserved'
              OR o.order_status<>'active' OR o.shipping_status='sent'
              OR r.inventory_source NOT IN ('warehouse','boutique')))
        AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
          WHERE oi.variant_id=v.id AND COALESCE(o.order_status,'active')='active'
            AND COALESCE(o.shipping_status,'not_sent')<>'sent' AND oi.quantity>0
            AND NOT EXISTS (SELECT 1 FROM inventory_reservations r
              WHERE r.order_item_id=oi.id AND r.variant_id=v.id AND r.status='active'
                AND r.quantity=oi.quantity))
        AND NOT EXISTS (SELECT 1 FROM inventory_stock st WHERE st.variant_id IN (v.id,t.id)
          AND st.reserved_quantity<>COALESCE((SELECT SUM(r.quantity)
            FROM inventory_reservations r WHERE r.variant_id=st.variant_id
              AND r.inventory_source=st.inventory_source AND r.status='active'),0))
        AND NOT EXISTS (SELECT 1 FROM inventory_reservations r
          WHERE r.variant_id IN (v.id,t.id) AND r.status='active'
            AND NOT EXISTS (SELECT 1 FROM inventory_stock st
              WHERE st.variant_id=r.variant_id AND st.inventory_source=r.inventory_source))
        AND (?=0 OR (
          NOT EXISTS (SELECT 1 FROM inventory_reservations r
            WHERE r.variant_id IN (v.id,t.id) AND r.status='active')
          AND NOT EXISTS (SELECT 1 FROM inventory_stock st
            WHERE st.variant_id IN (v.id,t.id) AND st.reserved_quantity<>0)
          AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
            WHERE oi.variant_id IN (v.id,t.id) AND oi.quantity>0
              AND o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent')
          AND NOT EXISTS (SELECT 1 FROM workshop_tasks wt
            WHERE wt.variant_id IN (v.id,t.id) AND wt.status='active')
          AND NOT EXISTS (SELECT 1 FROM inventory_lifecycle_events e
            WHERE e.variant_id IN (v.id,t.id) AND e.status IN ('pending','applied'))
          AND NOT EXISTS (SELECT 1 FROM inventory_transfer_items i
            JOIN inventory_transfer_documents d ON d.id=i.transfer_id
            WHERE i.variant_id IN (v.id,t.id) AND d.status='applied')
          AND NOT EXISTS (SELECT 1 FROM inventory_movements m
            WHERE m.variant_id IN (v.id,t.id)
              AND LOWER(TRIM(COALESCE(m.reference_type,''))) IN ('manual','transfer_in','transfer_out')
              AND NOT EXISTS(SELECT 1 FROM inventory_movement_reversals r WHERE r.original_movement_id=m.id))
          AND NOT EXISTS (SELECT 1 FROM order_items oi
            WHERE oi.variant_id IN (v.id,t.id) AND (
              EXISTS (SELECT 1 FROM return_items ri WHERE ri.order_item_id=oi.id)
              OR EXISTS (SELECT 1 FROM exchanges e WHERE e.old_order_item_id=oi.id OR e.new_order_item_id=oi.id)
              OR EXISTS (SELECT 1 FROM exchange_items ei WHERE ei.order_item_id=oi.id)))
        ))
        AND NOT EXISTS (SELECT 1 FROM workshop_tasks wt WHERE wt.variant_id=v.id AND wt.status='active')
        AND NOT EXISTS (SELECT 1 FROM inventory_lifecycle_events e WHERE e.variant_id=v.id AND e.status IN ('pending','applied'))
        AND NOT EXISTS (SELECT 1 FROM inventory_stocktake_items i
          JOIN inventory_stocktake_sessions sess ON sess.id=i.session_id
          WHERE i.variant_id IN (v.id,t.id) AND sess.status='active')
        AND NOT EXISTS (SELECT 1 FROM inventory_transfer_items i
          JOIN inventory_transfer_documents d ON d.id=i.transfer_id
          WHERE i.variant_id=v.id AND d.status='applied')
        AND NOT EXISTS (SELECT 1 FROM inventory_movements m
          WHERE m.variant_id=v.id
            AND LOWER(TRIM(COALESCE(m.reference_type,''))) IN ('manual','transfer_in','transfer_out')
            AND NOT EXISTS (SELECT 1 FROM inventory_movement_reversals rev WHERE rev.original_movement_id=m.id))
        AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id=v.id AND (
          EXISTS(SELECT 1 FROM return_items ri WHERE ri.order_item_id=oi.id)
          OR EXISTS(SELECT 1 FROM exchanges e WHERE e.old_order_item_id=oi.id OR e.new_order_item_id=oi.id)
         OR EXISTS(SELECT 1 FROM exchange_items ei WHERE ei.order_item_id=oi.id)))
        AND NOT EXISTS (
          SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
          WHERE oi.variant_id=v.id AND oi.quantity>0 AND o.order_status='active'
            AND COALESCE(o.shipping_status,'not_sent')<>'sent'
            AND (COALESCE(o.order_date,'')<? OR o.order_date>=?)
        )`
    ).bind(actor||null,stamp,targetId,sourceId,...sourceFields,...targetFields,beforeStock,beforeStock,beforeReservations,beforeReservations,hasPhysicalCorrection?1:0,preview.month.from,preview.month.toExclusive),
    db.prepare(
      `INSERT INTO catalog_variant_consolidation_stock_decisions(
        consolidation_id,inventory_source,source_stock_id,keeper_stock_id_before,
        decision_method,source_quantity_before,keeper_quantity_before,final_quantity,
        adjustment_quantity,reason,created_by,created_at)
      SELECT c.id,s.inventory_source,s.id,t.id,
        json_extract(j.value,'$.method'),s.quantity,COALESCE(t.quantity,0),
        CAST(json_extract(j.value,'$.final') AS INTEGER),
        CAST(json_extract(j.value,'$.final') AS INTEGER)-s.quantity-COALESCE(t.quantity,0),
        json_extract(j.value,'$.reason'),?,?
      FROM catalog_variant_consolidations c
      JOIN inventory_stock s ON s.variant_id=c.source_variant_id
      LEFT JOIN inventory_stock t ON t.variant_id=c.target_variant_id AND t.inventory_source=s.inventory_source
      JOIN json_each(?) j ON json_extract(j.value,'$.location')=s.inventory_source
      WHERE c.source_variant_id=? AND c.target_variant_id=? AND c.created_at=?`
    ).bind(actor,stamp,decisionJson,sourceId,targetId,stamp),
    db.prepare(
      `INSERT INTO catalog_variant_consolidation_stock_rows (
        consolidation_id,inventory_source,source_stock_id,target_stock_id_before,
        source_quantity_before,target_quantity_before,target_reserved_before,combined_quantity_after,source_reserved_before)
      SELECT c.id,s.inventory_source,s.id,t.id,s.quantity,COALESCE(t.quantity,0),
        COALESCE(t.reserved_quantity,0),d.final_quantity,s.reserved_quantity
      FROM catalog_variant_consolidations c
      JOIN inventory_stock s ON s.variant_id=c.source_variant_id
      LEFT JOIN inventory_stock t ON t.variant_id=c.target_variant_id AND t.inventory_source=s.inventory_source
      JOIN catalog_variant_consolidation_stock_decisions d
        ON d.consolidation_id=c.id AND d.inventory_source=s.inventory_source
      WHERE c.source_variant_id=? AND c.target_variant_id=? AND c.created_at=?`
    ).bind(sourceId,targetId,stamp),
    db.prepare(
      `INSERT INTO catalog_variant_consolidation_reservation_rows (
        consolidation_id,reservation_id,order_id,order_item_id,inventory_source,
        original_variant_id,keeper_variant_id,quantity)
      SELECT c.id,r.id,r.order_id,r.order_item_id,r.inventory_source,
        c.source_variant_id,c.target_variant_id,r.quantity
      FROM catalog_variant_consolidations c
      JOIN inventory_reservations r ON r.variant_id=c.source_variant_id AND r.status='active'
      WHERE c.source_variant_id=? AND c.target_variant_id=? AND c.created_at=?`
    ).bind(sourceId,targetId,stamp),
        db.prepare(
      `INSERT INTO inventory_stock (
        inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,
        material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity,
        last_action,last_source_ref,created_at,updated_at,external_product_id,external_variant_id)
      SELECT s.inventory_source,v.product_id,v.id,p.name,NULLIF(v.gender,''),NULLIF(v.color,''),
        COALESCE(NULLIF(v.material,''),'СТАНДАРТ'),COALESCE(NULLIF(v.length,''),'СТАНДАРТ'),
        NULLIF(v.size_label,''),d.final_quantity,s.reserved_quantity,'Объединение вариаций',?,?,?,p.external_id,v.external_id
      FROM inventory_stock s JOIN catalog_variants v ON v.id=?
      JOIN catalog_products p ON p.id=v.product_id
      JOIN catalog_variant_consolidations c ON c.source_variant_id=s.variant_id
      JOIN catalog_variant_consolidation_stock_decisions d
        ON d.consolidation_id=c.id AND d.inventory_source=s.inventory_source
      WHERE s.variant_id=? AND (s.quantity>0 OR s.reserved_quantity>0) AND ${journalExists}
      ON CONFLICT(inventory_source,variant_id) WHERE variant_id IS NOT NULL
      DO UPDATE SET quantity=excluded.quantity,
        reserved_quantity=inventory_stock.reserved_quantity+excluded.reserved_quantity,
        last_action='Объединение вариаций',last_source_ref=excluded.last_source_ref,
        updated_at=excluded.updated_at`
    ).bind(ref,stamp,stamp,targetId,sourceId,sourceId,targetId,stamp),
    db.prepare(
      `INSERT INTO inventory_movements (
        inventory_source,movement_type,product_id,variant_id,product_name_snapshot,
        gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,
        quantity_delta,quantity_after,reference_type,reference_id,comment,created_at)
      SELECT d.inventory_source,'revision',v.product_id,v.id,p.name,
        v.gender,v.color,v.material,v.length,v.size_label,d.adjustment_quantity,d.final_quantity,
        'catalog_stock_finalization',CAST(c.id AS TEXT),
        'Корректировка при объединении SKU: '||d.decision_method||'. '||COALESCE(d.reason,''),?
      FROM catalog_variant_consolidations c
      JOIN catalog_variant_consolidation_stock_decisions d ON d.consolidation_id=c.id
      JOIN catalog_variants v ON v.id=c.target_variant_id
      JOIN catalog_products p ON p.id=v.product_id
      WHERE c.source_variant_id=? AND c.target_variant_id=? AND c.created_at=?
        AND d.adjustment_quantity<>0`
    ).bind(stamp,sourceId,targetId,stamp),
    db.prepare(
      `UPDATE inventory_stock SET quantity=0,reserved_quantity=0,
        last_action='Объединение вариаций',last_source_ref=?,updated_at=?
      WHERE variant_id=? AND ${journalExists}`
    ).bind(ref,stamp,sourceId,sourceId,targetId,stamp),
    db.prepare(
      `UPDATE inventory_reservations SET variant_id=?, updated_at=?
      WHERE variant_id=? AND status='active'
        AND EXISTS (SELECT 1 FROM catalog_variant_consolidation_reservation_rows a
          JOIN catalog_variant_consolidations c ON c.id=a.consolidation_id
          WHERE a.reservation_id=inventory_reservations.id AND c.source_variant_id=?
            AND c.target_variant_id=? AND c.created_at=?)`
    ).bind(targetId,stamp,sourceId,sourceId,targetId,stamp),
    db.prepare(
      `UPDATE order_items SET variant_id=?
      WHERE variant_id=? AND EXISTS (
        SELECT 1 FROM catalog_variant_consolidation_reservation_rows a
        JOIN catalog_variant_consolidations c ON c.id=a.consolidation_id
        WHERE a.order_item_id=order_items.id
          AND c.source_variant_id=? AND c.target_variant_id=? AND c.created_at=?)`
    ).bind(targetId,sourceId,sourceId,targetId,stamp),
        db.prepare(
      `UPDATE catalog_variants SET is_active=0,updated_at=?
      WHERE id=? AND is_active=1 AND ${journalExists}`
    ).bind(stamp,sourceId,sourceId,targetId,stamp),
    // CHECK constraint failure aborts all writes in this D1 batch.
    db.prepare(
      `INSERT INTO catalog_variant_consolidation_validations(consolidation_id,passed,checked_at)
      SELECT c.id,CASE WHEN v.is_active=0 AND t.is_active=1
        AND (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_decisions d WHERE d.consolidation_id=c.id)
          =(SELECT COUNT(*) FROM inventory_stock s WHERE s.variant_id=c.source_variant_id)
        AND (SELECT COUNT(*) FROM inventory_movements m
            WHERE m.reference_type='catalog_stock_finalization' AND m.reference_id=CAST(c.id AS TEXT))
          =(SELECT COUNT(*) FROM catalog_variant_consolidation_stock_decisions d
            WHERE d.consolidation_id=c.id AND d.adjustment_quantity<>0)
        AND NOT EXISTS (
        SELECT 1 FROM catalog_variant_consolidation_stock_rows l
        LEFT JOIN inventory_stock s ON s.id=l.source_stock_id
        LEFT JOIN inventory_stock dest ON dest.inventory_source=l.inventory_source AND dest.variant_id=c.target_variant_id
        WHERE l.consolidation_id=c.id AND (
          s.id IS NULL OR s.quantity<>0 OR s.reserved_quantity<>0
          OR COALESCE(dest.quantity,0)<>l.combined_quantity_after
          OR COALESCE(dest.reserved_quantity,0)<>l.target_reserved_before+l.source_reserved_before
          OR (l.source_quantity_before>0 AND dest.id IS NULL)
        )
      ) THEN 1 ELSE 0 END,?
      FROM catalog_variant_consolidations c
      JOIN catalog_variants v ON v.id=c.source_variant_id
      JOIN catalog_variants t ON t.id=c.target_variant_id
      WHERE c.source_variant_id=? AND c.target_variant_id=? AND c.created_at=?`
    ).bind(stamp,sourceId,targetId,stamp),
    db.prepare(
      `INSERT INTO catalog_variant_consolidation_reservation_validations (consolidation_id,passed,checked_at)
      SELECT c.id,CASE WHEN
        (SELECT COUNT(*) FROM catalog_variant_consolidation_reservation_rows a WHERE a.consolidation_id=c.id)
          = (SELECT COUNT(*) FROM inventory_reservations r
               JOIN catalog_variant_consolidation_reservation_rows a ON a.reservation_id=r.id
               WHERE a.consolidation_id=c.id)
        AND NOT EXISTS (
          SELECT 1 FROM catalog_variant_consolidation_reservation_rows a
          LEFT JOIN inventory_reservations r ON r.id=a.reservation_id
          LEFT JOIN order_items oi ON oi.id=a.order_item_id
          WHERE a.consolidation_id=c.id AND (
            r.id IS NULL OR oi.id IS NULL OR r.variant_id<>c.target_variant_id
            OR oi.variant_id<>c.target_variant_id OR r.status<>'active'
            OR r.order_item_id<>a.order_item_id OR r.order_id<>a.order_id
            OR r.inventory_source<>a.inventory_source OR r.quantity<>a.quantity
          )
        )
        AND NOT EXISTS (SELECT 1 FROM inventory_reservations r
          WHERE r.variant_id=c.source_variant_id AND r.status='active')
        AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
          WHERE oi.variant_id=c.source_variant_id AND o.order_status='active'
            AND o.shipping_status<>'sent' AND oi.quantity>0)
        AND NOT EXISTS (SELECT 1 FROM inventory_stock st WHERE st.variant_id IN (c.source_variant_id,c.target_variant_id)
          AND st.reserved_quantity<>COALESCE((SELECT SUM(r.quantity)
            FROM inventory_reservations r WHERE r.variant_id=st.variant_id
              AND r.inventory_source=st.inventory_source AND r.status='active'),0))
        THEN 1 ELSE 0 END,?
      FROM catalog_variant_consolidations c
      WHERE c.source_variant_id=? AND c.target_variant_id=? AND c.created_at=?`
    ).bind(stamp,sourceId,targetId,stamp),
  ]
  const results = await db.batch(statements)
  if (toInt(results[0].meta?.changes,0)!==1
    || toInt(results[9].meta?.changes,0)!==1
    || toInt(results[10].meta?.changes,0)!==1
    || toInt(results[11].meta?.changes,0)!==1) {
    throw new Error('Склад или Каталог изменились во время проверки. Обновите данные и повторите.')
  }
  return {
    ok:true, consolidated:true, sourceId,targetId,
    transferredQuantity:preview.transferQuantity, transferredReservations:preview.reservationCount, stockBreakdown:preview.stockBreakdown,
    stockDecisions:decisions,
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
