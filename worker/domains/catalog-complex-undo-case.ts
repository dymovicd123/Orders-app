// Read-only, admin-gated (router) case assessment for difficult SKU merger undo.
// Never change already shipped orders, customer reservations, inventory or money.
// This is an investigation tool, NOT a compensating writer or a stock permission.
import { previewCatalogConsolidationUndo } from './catalog-consolidation-undo-preview.ts'

const MAX_ROWS=50
type Param=string|number
async function page<T>(db:D1Database,select:string,where:string,sort:string,values:Param[]){
  const [count,listed]=await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n ${where}`).bind(...values).first<{n:number}>(),
    db.prepare(`${select} ${where} ${sort} LIMIT ?`).bind(...values,MAX_ROWS+1).all<T>(),
  ])
  const rows=listed.results??[],totalCount=Number(count?.n??0)
  return {totalCount,shownCount:Math.min(rows.length,MAX_ROWS),truncated:totalCount>MAX_ROWS,
    rows:rows.slice(0,MAX_ROWS)}
}
type Reservation={
 reservation_id:number;order_id:number;order_item_id:number;inventory_source:string;
 original_variant_id:number;keeper_variant_id:number;quantity:number;
 now_variant_id:number|null;now_status:string|null;now_quantity:number|null;
 now_location:string|null;now_order_id:number|null;now_order_item_id:number|null;
 now_updated_at:string|null;item_variant_id:number|null;item_quantity:number|null;
 item_source:string|null;item_created_at:string|null;order_status:string|null;
 shipping_status:string|null;order_updated_at:string|null;
 reservation_age_state:string;order_age_state:string
}
type Order={
 id:number;order_id:number;variant_id:number|null;quantity:number|null;
 source_type:string|null;created_at:string|null;order_status:string|null;
 shipping_status:string|null;order_updated_at:string|null;
 has_exchange_return:number;time_state:string
}
type Movement={
 id:number;variant_id:number|null;inventory_source:string|null;
 movement_type:string|null;quantity_delta:number|null;quantity_after:number|null;
 reference_type:string|null;reference_id:string|null;created_at:string|null;
 time_state:string
}
type CountRow={
 id:number;variant_id:number|null;inventory_source:string|null;
 counted_quantity:number|null;checked_at:string|null;check_type:string|null;time_state:string
}
function situation(r:Reservation){
  if(r.now_variant_id===null || r.item_variant_id===null || r.order_status===null){
    return {kind:'missing_link',label:'Связанный резерв или заказ отсутствует',risk:'critical'}
  }
  if(r.now_variant_id!==r.keeper_variant_id || r.item_variant_id!==r.keeper_variant_id
    || r.now_quantity!==r.quantity || r.now_location!==r.inventory_source
    || r.now_order_id!==r.order_id || r.now_order_item_id!==r.order_item_id
    || r.item_source!==r.inventory_source || r.item_quantity===null
    || r.item_quantity<r.quantity){
    return {kind:'changed_link',label:'Изменились резерв, количество или позиция заказа',risk:'critical'}
  }
  if(r.now_status!=='active'||r.shipping_status==='sent'||r.order_status!=='active'){
    return {kind:'fulfilled_or_released',label:'Заказ или резерв уже закрыт, отправлен или освобождён',risk:'high'}
  }
  if(r.reservation_age_state!=='same_merge'||r.order_age_state!=='pre_merge'){
    return {kind:'edited_after_merge',label:'После объединения изменялся заказ или резерв либо дата неизвестна',risk:'high'}
  }
  return {kind:'active_unchanged',label:'Открытый резерв сохранил исходную связь',risk:'medium'}
}
const advice={
  original_reservations:{
    code:'customer_reservations',title:'Проверить обязательства по заказам',
    description:'Просмотрите каждую перенесённую позицию. Отправленные и изменённые заказы не переписываются ради отмены объединения.',
  },
  later_orders:{
    code:'later_orders',title:'Разобрать заказы после объединения',
    description:'Сохранить историю продаж, возвратов и обменов. Для незавершённых заказов сначала урегулировать обязательства обычными рабочими операциями.',
  },
  later_movements:{
    code:'later_movements',title:'Сверить складские движения',
    description:'Установить причину каждого движения. Не восстанавливать исходные числа поверх последующих приходов, продаж или списаний.',
  },
  later_stock_checks:{
    code:'later_counts',title:'Учитывать новые результаты ревизии',
    description:'Новая фактическая сверка важнее старых чисел до объединения. Проверить склад и бутик отдельно.',
  },
  other_dependencies:{
    code:'other_dependencies',title:'Разобрать связанные операции',
    description:'Проверить активные задачи цеха, перемещения, возвраты, обмены и последующие объединения до нового решения по SKU.',
  },
  unknown:{
    code:'missing_evidence',title:'Восстановить недостающие сведения',
    description:'Нельзя автоматически отменять объединение при неполной истории, отсутствующем резерве или неоднозначных датах.',
  },
}
export async function previewComplexCatalogUndoCase(db:D1Database,consolidationId:number){
  if(!Number.isSafeInteger(consolidationId)||consolidationId<=0)throw new Error('Укажите корректный номер объединения.')
  const previous=await previewCatalogConsolidationUndo(db,consolidationId)
  const ids:[number,number]=[previous.sourceId,previous.keeperId]
  const reservationWhere=`FROM catalog_variant_consolidation_reservation_rows a
    JOIN catalog_variant_consolidations c ON c.id=a.consolidation_id
    LEFT JOIN inventory_reservations r ON r.id=a.reservation_id
    LEFT JOIN order_items oi ON oi.id=a.order_item_id
    LEFT JOIN orders o ON o.id=a.order_id WHERE a.consolidation_id=?`
  const reservationsQuery=`SELECT a.reservation_id,a.order_id,a.order_item_id,a.inventory_source,
    a.original_variant_id,a.keeper_variant_id,a.quantity,
    r.variant_id AS now_variant_id,r.status AS now_status,r.quantity AS now_quantity,
    r.inventory_source AS now_location,r.order_id AS now_order_id,
    r.order_item_id AS now_order_item_id,r.updated_at AS now_updated_at,
    oi.variant_id AS item_variant_id,oi.quantity AS item_quantity,
    oi.source_type AS item_source,oi.created_at AS item_created_at,
    o.order_status,o.shipping_status,o.updated_at AS order_updated_at,
    CASE WHEN julianday(r.updated_at) IS NULL THEN 'unknown'
      WHEN julianday(r.updated_at)=julianday(c.created_at) THEN 'same_merge'
      ELSE 'changed' END AS reservation_age_state,
    CASE WHEN julianday(oi.created_at) IS NULL OR julianday(o.updated_at) IS NULL
      THEN 'unknown'
      WHEN julianday(oi.created_at)<julianday(c.created_at)
       AND julianday(o.updated_at)<julianday(c.created_at) THEN 'pre_merge'
      ELSE 'changed' END AS order_age_state`
  const ordersWhere=`FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE oi.variant_id IN (?,?) AND (
      julianday(oi.created_at) IS NULL OR julianday(o.updated_at) IS NULL
      OR MAX(julianday(oi.created_at),julianday(o.updated_at))>=julianday(?))`
  const ordersQuery=`SELECT oi.id,oi.order_id,oi.variant_id,oi.quantity,oi.source_type,
    oi.created_at,o.order_status,o.shipping_status,o.updated_at AS order_updated_at,
    CASE WHEN EXISTS(SELECT 1 FROM return_items ri WHERE ri.order_item_id=oi.id)
      OR EXISTS(SELECT 1 FROM exchanges ex
        WHERE ex.old_order_item_id=oi.id OR ex.new_order_item_id=oi.id)
      OR EXISTS(SELECT 1 FROM exchange_items ei WHERE ei.order_item_id=oi.id)
      THEN 1 ELSE 0 END AS has_exchange_return,
    CASE WHEN julianday(oi.created_at) IS NULL OR julianday(o.updated_at) IS NULL
      THEN 'unknown' ELSE 'known' END AS time_state`
  const movementsWhere=`FROM inventory_movements m
    WHERE m.variant_id IN (?,?) AND
      (julianday(m.created_at) IS NULL OR julianday(m.created_at)>=julianday(?))
      AND NOT (
        m.reference_type='catalog_stock_finalization'
        AND m.reference_id=?
        AND julianday(m.created_at)=julianday(?))`
  const movementsQuery=`SELECT m.id,m.variant_id,m.inventory_source,m.movement_type,
    m.quantity_delta,m.quantity_after,m.reference_type,m.reference_id,m.created_at,
    CASE WHEN julianday(m.created_at) IS NULL THEN 'unknown' ELSE 'known' END AS time_state`
  const checksWhere=`FROM inventory_stock_checks ch WHERE ch.variant_id IN (?,?)
    AND (julianday(ch.checked_at) IS NULL OR julianday(ch.checked_at)>=julianday(?))`
  const checksQuery=`SELECT ch.id,ch.variant_id,ch.inventory_source,
    ch.counted_quantity,ch.checked_at,ch.check_type,
    CASE WHEN julianday(ch.checked_at) IS NULL THEN 'unknown' ELSE 'known' END AS time_state`
  const [reservationPage,orders,movements,counts]=await Promise.all([
    page<Reservation>(db,reservationsQuery,reservationWhere,'ORDER BY a.reservation_id',
      [consolidationId]),
    page<Order>(db,ordersQuery,ordersWhere,'ORDER BY oi.id',[...ids,previous.mergedAt]),
    page<Movement>(db,movementsQuery,movementsWhere,'ORDER BY m.id',
      [...ids,previous.mergedAt,String(consolidationId),previous.mergedAt]),
    page<CountRow>(db,checksQuery,checksWhere,'ORDER BY ch.id',[...ids,previous.mergedAt]),
  ])
  const reservations={
    ...reservationPage,
    rows:reservationPage.rows.map(r=>({
      reservationId:r.reservation_id,orderId:r.order_id,orderItemId:r.order_item_id,
      sourceLocation:r.inventory_source,quantityAtMerge:r.quantity,
      originalSkuId:r.original_variant_id,keeperSkuId:r.keeper_variant_id,
      current:{status:r.now_status,skuId:r.now_variant_id,quantity:r.now_quantity,
        location:r.now_location,orderId:r.now_order_id,orderItemId:r.now_order_item_id},
      order:{status:r.order_status,shippingStatus:r.shipping_status,
        itemSkuId:r.item_variant_id,itemQuantity:r.item_quantity,
        lastChanged:r.order_updated_at},
      situation:situation(r),
    })),
  }
  const unknownReservations=reservations.rows.some(r=>r.situation.kind==='missing_link'
    ||r.situation.kind==='changed_link')
  const unknownDates=reservationPage.rows.some(r=>r.reservation_age_state==='unknown'
    ||r.order_age_state==='unknown')
    ||orders.rows.some(r=>r.time_state==='unknown')
    ||movements.rows.some(r=>r.time_state==='unknown')
    ||counts.rows.some(r=>r.time_state==='unknown')
    ||previous.blockers.some(x=>x.code==='event_time_unknown')
  const tasks=[]
  if(reservations.totalCount)tasks.push(advice.original_reservations)
  if(orders.totalCount)tasks.push(advice.later_orders)
  if(movements.totalCount)tasks.push(advice.later_movements)
  if(counts.totalCount)tasks.push(advice.later_stock_checks)
  if(previous.blockers.some(x=>['reversible_dependencies','merge_chain','keeper_only_location_unverified'].includes(x.code))){
    tasks.push(advice.other_dependencies)
  }
  const truncated=[reservations,orders,movements,counts].some(r=>r.truncated)
  if(unknownReservations||unknownDates||truncated||previous.blockers.some(x=>['audit_incomplete',
    'ledger_incomplete','unexpected_stock_rows','identity_changed'].includes(x.code))){
    tasks.push(advice.unknown)
  }
  const unresolved=tasks.length>0
  return {
    ok:true,consolidationId,sourceId:previous.sourceId,keeperId:previous.keeperId,
    mergedAt:previous.mergedAt,
    canUndoNow:false,automaticCompensationAllowed:false,noChangesApplied:true,
    caseKind:unknownReservations||unknownDates?'requires_data_review'
      :truncated?'requires_pagination'
      :reservesOrRelated(reservations,orders,movements,counts)
        ?'requires_operation_reconciliation'
        :previous.blockers.length?'requires_manual_review':'standard_undo_may_be_available',
    originalBlockers:previous.blockers,
    summary:{
      originalReservationLinks:reservationPage.totalCount,
      changedOrMissingReservationLinks:reservations.rows.filter(r=>
        ['changed_link','missing_link'].includes(r.situation.kind)).length,
      originalLinksInspected:reservations.shownCount,
      postMergeOrderItems:orders.totalCount,postMergeMovements:movements.totalCount,
      postMergeStockChecks:counts.totalCount,
      otherDependencyBlockers:previous.blockers.filter(x=>
        ['reversible_dependencies','merge_chain'].includes(x.code)).length,
      incompleteEvidence:unknownReservations||unknownDates||truncated,
    },
    reservationLinks:reservations,
    subsequentOrders:orders,subsequentMovements:movements,subsequentCounts:counts,
    actions:tasks,
    explanation:unresolved
      ?'Найдены обязательства или последующие операции. Их нужно урегулировать, прежде чем менять идентичность SKU. Склад и историю заказов этот просмотр не меняет.'
      :'Дополнительные операции не выявлены. Используйте существующую проверку обычной отмены, а не этот диагностический просмотр.',
  }
}
function reservesOrRelated(...groups:Array<{totalCount:number}>){
  return groups.some(g=>g.totalCount>0)
}
