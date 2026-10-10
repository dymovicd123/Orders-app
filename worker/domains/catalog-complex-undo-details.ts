// Cursor-paged READ-ONLY evidence for original SKU merge and later operations.
// Pagination is not a cross-request snapshot: always refresh the case preflight.
import { previewCatalogConsolidationUndo } from './catalog-consolidation-undo-preview.ts'
import { situation } from './catalog-complex-undo-case.ts'
import type { Reservation } from './catalog-complex-undo-case.ts'

export type CaseSection='reservations'|'orders'|'movements'|'checks'
type IdRow={id:number}
type Bind=string|number
const MAX_PAGE=50
const valid=(n:number,allowZero=false)=>Number.isSafeInteger(n)&&(allowZero?n>=0:n>0)
function guidance(kind:string){
 switch(kind){
  case 'active_unchanged': return 'Не менять ссылки автоматически. Проверить всю группу через безопасную проверку первоначальных резервов.'
  case 'edited_after_merge': return 'Урегулировать текущий заказ штатным редактированием, не переписывая историю.'
  case 'fulfilled_or_released': return 'Сохранить историю исполнения; при необходимости использовать обычный возврат или обмен.'
  case 'changed_link': return 'Проверить расхождение количества или связи с заказом и сверить склад.'
  default: return 'Недостающие данные требуют ручной сверки. Автоматическое восстановление запрещено.'
 }
}
export async function listComplexUndoEvidence(
 db:D1Database,consolidationId:number,section:CaseSection,afterId=0,limit=25
){
 if(!valid(consolidationId))throw new Error('Укажите корректный номер объединения.')
 if(!['reservations','orders','movements','checks'].includes(section))
   throw new Error('Неизвестный раздел истории объединения.')
 if(!valid(afterId,true))throw new Error('Некорректный курсор страницы.')
 if(!valid(limit)||limit>MAX_PAGE)throw new Error('Размер страницы должен быть от 1 до 50.')
 const original=await previewCatalogConsolidationUndo(db,consolidationId)
 let select='',from='',idColumn='',params:Bind[]=[]
 if(section==='reservations'){
  idColumn='a.reservation_id'
  from="FROM catalog_variant_consolidation_reservation_rows a "+
   "JOIN catalog_variant_consolidations c ON c.id=a.consolidation_id "+
   "LEFT JOIN inventory_reservations r ON r.id=a.reservation_id "+
   "LEFT JOIN order_items oi ON oi.id=a.order_item_id "+
   "LEFT JOIN orders o ON o.id=a.order_id WHERE a.consolidation_id=?"
  params=[consolidationId]
  select="SELECT a.reservation_id AS id,a.reservation_id,a.order_id,a.order_item_id,"+
   "a.inventory_source,a.original_variant_id,a.keeper_variant_id,a.quantity,"+
   "r.variant_id AS now_variant_id,r.status AS now_status,"+
   "r.quantity AS now_quantity,r.inventory_source AS now_location,"+
   "r.order_id AS now_order_id,r.order_item_id AS now_order_item_id,"+
   "r.updated_at AS now_updated_at,oi.variant_id AS item_variant_id,"+
   "oi.quantity AS item_quantity,oi.source_type AS item_source,oi.created_at AS item_created_at,"+
   "o.order_status,o.shipping_status,o.updated_at AS order_updated_at,"+
   "CASE WHEN julianday(r.updated_at) IS NULL THEN 'unknown' "+
   "WHEN julianday(r.updated_at)=julianday(c.created_at) THEN 'same_merge' ELSE 'changed' END AS reservation_age_state,"+
   "CASE WHEN julianday(oi.created_at) IS NULL OR julianday(o.updated_at) IS NULL THEN 'unknown' "+
   "WHEN julianday(oi.created_at)<julianday(c.created_at) AND julianday(o.updated_at)<julianday(c.created_at) "+
   "THEN 'pre_merge' ELSE 'changed' END AS order_age_state"
 }else if(section==='orders'){
  idColumn='oi.id'
  from="FROM order_items oi JOIN orders o ON o.id=oi.order_id "+
   "WHERE oi.variant_id IN (?,?) AND (julianday(oi.created_at) IS NULL "+
   "OR julianday(o.updated_at) IS NULL OR "+
   "MAX(julianday(oi.created_at),julianday(o.updated_at))>=julianday(?))"
  params=[original.sourceId,original.keeperId,original.mergedAt]
  select="SELECT oi.id,oi.order_id,oi.variant_id,oi.quantity,oi.source_type,oi.created_at,"+
   "o.order_status,o.shipping_status,o.updated_at AS order_updated_at,"+
   "CASE WHEN EXISTS(SELECT 1 FROM return_items ret WHERE ret.order_item_id=oi.id) "+
   "OR EXISTS(SELECT 1 FROM exchanges ex WHERE ex.old_order_item_id=oi.id OR ex.new_order_item_id=oi.id) "+
   "OR EXISTS(SELECT 1 FROM exchange_items ex WHERE ex.order_item_id=oi.id) "+
   "THEN 1 ELSE 0 END AS has_exchange_return,"+
   "CASE WHEN julianday(oi.created_at) IS NULL OR julianday(o.updated_at) IS NULL "+
   "THEN 'unknown' ELSE 'known' END AS time_state"
 }else if(section==='movements'){
  idColumn='m.id'
  from="FROM inventory_movements m WHERE m.variant_id IN (?,?) "+
   "AND (julianday(m.created_at) IS NULL OR julianday(m.created_at)>=julianday(?)) "+
   "AND NOT (m.reference_type='catalog_stock_finalization' AND m.reference_id=? "+
   "AND julianday(m.created_at)=julianday(?))"
  params=[original.sourceId,original.keeperId,original.mergedAt,String(consolidationId),original.mergedAt]
  select="SELECT m.id,m.variant_id,m.inventory_source,m.movement_type,m.quantity_delta,"+
   "m.quantity_after,m.reference_type,m.reference_id,m.created_at,"+
   "CASE WHEN julianday(m.created_at) IS NULL THEN 'unknown' ELSE 'known' END AS time_state"
 }else{
  idColumn='ch.id'
  from="FROM inventory_stock_checks ch WHERE ch.variant_id IN (?,?) "+
   "AND (julianday(ch.checked_at) IS NULL OR julianday(ch.checked_at)>=julianday(?))"
  params=[original.sourceId,original.keeperId,original.mergedAt]
  select="SELECT ch.id,ch.variant_id,ch.inventory_source,ch.counted_quantity,ch.checked_at,"+
   "ch.check_type,CASE WHEN julianday(ch.checked_at) IS NULL THEN 'unknown' "+
   "ELSE 'known' END AS time_state"
 }
 const [count,listed]=await Promise.all([
  db.prepare("SELECT COUNT(*) AS n "+from).bind(...params).first<{n:number}>(),
  db.prepare(select+" "+from+" AND "+idColumn+">? ORDER BY "+idColumn+" ASC LIMIT ?")
   .bind(...params,afterId,limit+1).all<IdRow & Partial<Reservation>>()
 ])
 const received=listed.results||[],current=received.slice(0,limit)
 const rows=current.map(x=>{
  if(section==='reservations'){
   const state=situation(x as unknown as Reservation)
   return {...x,situation:state,nextStep:guidance(state.kind)}
  }
  if(section==='orders')return {...x,
   nextStep:x.has_exchange_return
     ?'Сохранить историю возврата или обмена; не менять заказ задним числом.'
     :x.shipping_status==='sent'
       ?'Исполненный заказ оставить в истории. Новые операции — только через возврат или обмен.'
       :'Проверить открытый заказ обычным рабочим способом, не меняя историю объединения.'}
  if(section==='movements')return {...x,
   nextStep:'Проверить основание движения и актуальный остаток по этому месту; не отменять движение при изменении SKU.'}
  return {...x,
   nextStep:'Сверить последнюю ревизию с текущим физическим количеством по этому месту.'}
 })
 const hasMore=received.length>limit
 return {ok:true,consolidationId,sourceId:original.sourceId,keeperId:original.keeperId,
  section,afterId,pageSize:limit,totalCount:Number(count?.n??0),
  shownCount:rows.length,hasMore,nextCursor:hasMore?current[current.length-1]?.id??null:null,
  rows,canUndoFromThisPage:false,noChangesApplied:true,
  notice:'Просмотр не меняет данные. Между страницами сотрудники могут продолжать работу. После изучения всех страниц обновите проверку объединения; это не разрешение на автоматический откат.'}
}
