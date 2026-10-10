// Read-only guided case resolution for genuinely complex SKU consolidations.
// Never guesses a stock split or rewrites shipped/exchanged customer history.
import { previewComplexCatalogUndoCase } from './catalog-complex-undo-case.ts'

type Stock={
 id:number;variant_id:number;inventory_source:string;quantity:number;
 reserved_quantity:number;updated_at:string|null;last_source_ref:string|null
}
type Ledger={
 inventory_source:string;source_quantity_before:number;target_quantity_before:number;
 source_reserved_before:number;target_reserved_before:number;
 combined_quantity_after:number
}
type MovementCount={inventory_source:string;movement_count:number}
type CheckCount={inventory_source:string;counted_count:number}
type Task={
 id:string;title:string;why:string;action:string;
 scope:string;records:number;needsFullHistory:boolean;automatedWriteAllowed:false
}
const locationName=(s:string)=>s==='warehouse'?'Склад':s==='boutique'?'Бутик':s

export async function getComplexUndoWorkplan(db:D1Database,id:number){
 const caseView=await previewComplexCatalogUndoCase(db,id)
 const [stockRows,ledgerRows,movementRows,checkRows]=await Promise.all([
  db.prepare("SELECT id,variant_id,inventory_source,quantity,reserved_quantity,updated_at,last_source_ref FROM inventory_stock WHERE variant_id IN (?,?) ORDER BY inventory_source,variant_id").bind(caseView.sourceId,caseView.keeperId).all<Stock>(),
  db.prepare("SELECT inventory_source,source_quantity_before,target_quantity_before,source_reserved_before,target_reserved_before,combined_quantity_after FROM catalog_variant_consolidation_stock_rows WHERE consolidation_id=? ORDER BY inventory_source").bind(id).all<Ledger>(),
  db.prepare("SELECT inventory_source,COUNT(*) AS movement_count FROM inventory_movements WHERE variant_id IN (?,?) AND (julianday(created_at) IS NULL OR julianday(created_at)>=julianday(?)) AND NOT (reference_type='catalog_stock_finalization' AND reference_id=? AND julianday(created_at)=julianday(?)) GROUP BY inventory_source").bind(caseView.sourceId,caseView.keeperId,caseView.mergedAt,String(id),caseView.mergedAt).all<MovementCount>(),
  db.prepare("SELECT inventory_source,COUNT(*) AS counted_count FROM inventory_stock_checks WHERE variant_id IN (?,?) AND (julianday(checked_at) IS NULL OR julianday(checked_at)>=julianday(?)) GROUP BY inventory_source").bind(caseView.sourceId,caseView.keeperId,caseView.mergedAt).all<CheckCount>()
 ])
 const stocks=stockRows.results??[],ledger=ledgerRows.results??[]
 const movements=movementRows.results??[],checks=checkRows.results??[]
 const allPlaces=new Set([
  ...stocks.map(x=>x.inventory_source),...ledger.map(x=>x.inventory_source),
  ...movements.map(x=>x.inventory_source),...checks.map(x=>x.inventory_source)
 ])
 const places=[...allPlaces].sort().map(location=>{
  const source=stocks.find(s=>s.inventory_source===location&&s.variant_id===caseView.sourceId)
  const keeper=stocks.find(s=>s.inventory_source===location&&s.variant_id===caseView.keeperId)
  const history=ledger.find(l=>l.inventory_source===location)
  const movementsHere=movements.find(m=>m.inventory_source===location)?.movement_count??0
  const checksHere=checks.find(c=>c.inventory_source===location)?.counted_count??0
  const badNumbers=[source?.quantity,source?.reserved_quantity,keeper?.quantity,keeper?.reserved_quantity]
   .some(n=>n!==undefined&&(!Number.isSafeInteger(n)||n<0))
  const unknownDate=[source?.updated_at,keeper?.updated_at].some(date=>
   date!==undefined&&!Number.isFinite(Date.parse(date||'')))
  const requiresCount=movementsHere>0||checksHere>0||!history||!source||!keeper
   ||unknownDate||badNumbers
   ||(source&&Date.parse(source.updated_at||'')>Date.parse(caseView.mergedAt))
   ||(keeper&&Date.parse(keeper.updated_at||'')>Date.parse(caseView.mergedAt))
  return {
   location,locationLabel:locationName(location),
   physical:{
    source:source?.quantity??null,keeper:keeper?.quantity??null,
    combined:source&&keeper?source.quantity+keeper.quantity:null
   },
   reserved:{
    source:source?.reserved_quantity??null,keeper:keeper?.reserved_quantity??null,
    combined:source&&keeper?source.reserved_quantity+keeper.reserved_quantity:null
   },
   originallyMerged:history?{
    physical:history.combined_quantity_after,
    reserved:history.source_reserved_before+history.target_reserved_before
   }:null,
   newerMovements:movementsHere,newerStockChecks:checksHere,
   requiresFreshPhysicalCheck:Boolean(requiresCount),
   warning:requiresCount
    ?'Эта точка требует отдельной сверки фактического количества. Старый журнал не является текущим остатком.'
    :'Текущие числа показаны для проверки; не используйте их как разрешение на автоматическую отмену.'
  }
 })
 const tasks:Task[]=[]
 const add=(id:string,title:string,why:string,action:string,scope:string,records:number,needsFullHistory=false)=>
  tasks.push({id,title,why,action,scope,records,needsFullHistory,automatedWriteAllowed:false})
 const original=caseView.reservationLinks
 const problematic=original.rows.filter(x=>x.situation.kind!=='active_unchanged')
 if(original.totalCount){
  add('customer_commitments','Разобрать обязательства по клиентам',
   'Изначально объединение перенесло резервы и ссылки заказов.',
   'Откройте все первоначальные резервы. Оставьте исполненные заказы историей, а открытые разбирайте штатными операциями. Возврат ссылок возможен только через отдельную проверку полностью неизменённых резервов.',
   'orders',original.totalCount,original.truncated)
 }
 if(problematic.length){
  add('changed_original_links','Не восстанавливать изменённые резервы автоматически',
   'Среди просмотренных резервов есть освобождённые, отправленные или изменённые.',
   'Проверьте конкретные заказы и их историю. Не меняйте вариант в уже исполненных позициях.',
   'orders',problematic.length,original.truncated)
 }
 if(caseView.subsequentOrders.totalCount){
  add('later_orders','Проверить новые или изменённые заказы',
   'Заказы после объединения могли использовать новые складские остатки.',
   'Сверьте отправку, возврат и обмен через штатные вкладки. Не отменяйте исходное складское движение.',
   'orders',caseView.subsequentOrders.totalCount,caseView.subsequentOrders.truncated)
 }
 if(caseView.subsequentMovements.totalCount||caseView.subsequentCounts.totalCount
    ||places.some(p=>p.requiresFreshPhysicalCheck)){
  add('physical_stock','Сверить фактическое количество отдельно для склада и бутика',
   'Последующие складские движения или ревизии могут сделать первоначальный раздел остатков недействительным.',
   'Проведите фактическую сверку в соответствующей точке. Не переписывайте старые приходы, отгрузки или списания. Новые корректировки — только через штатный учёт.',
   'inventory',caseView.subsequentMovements.totalCount+caseView.subsequentCounts.totalCount,
   caseView.subsequentMovements.truncated||caseView.subsequentCounts.truncated)
 }
 if(caseView.originalBlockers.some(b=>['reversible_dependencies','merge_chain'].includes(b.code))){
  add('other_operations','Разобрать цех, перемещения и связанные объединения',
   'Есть дополнительные зависимости, которые нельзя исправить переименованием SKU.',
   'Завершите или проверьте соответствующие операции в их рабочих вкладках, не удаляя исторические записи.',
   'operations',caseView.summary.otherDependencyBlockers)
 }
 if(caseView.summary.incompleteEvidence||
   caseView.originalBlockers.some(x=>['audit_incomplete','ledger_incomplete','event_time_unknown',
      'identity_changed','unexpected_stock_rows'].includes(x.code))){
  add('incomplete_evidence','Получить полную историю и проверить исходные данные',
   'Есть обрезанные списки, некорректные даты или несогласованная история.',
   'Откройте полный постраничный журнал, перепроверьте источник данных. Не подтверждайте исправление, пока все связи не объяснены.',
   'audit',1,true)
 }
 const historyChanged=caseView.reservationLinks.rows.some(x=>
  x.situation.kind==='fulfilled_or_released'||x.situation.kind==='edited_after_merge')
  ||caseView.subsequentOrders.rows.some(x=>x.shipping_status==='sent'||x.has_exchange_return)
 const recommendedPath=historyChanged?'preserve_history_and_resolve_operations'
  :caseView.summary.incompleteEvidence?'recover_evidence_first'
  :caseView.subsequentMovements.totalCount||caseView.subsequentCounts.totalCount
   ?'recount_then_resolve':'verify_original_unchanged_reservations_or_keep_merge'
 return {
  ok:true,consolidationId:id,sourceId:caseView.sourceId,keeperId:caseView.keeperId,
  recommendedPath,places,tasks,
  caseHasUninspectedRows:caseView.summary.incompleteEvidence,
  canAutomaticallyUndo:false,canMarkResolvedFromPreview:false,
  noChangesApplied:true,
  explanation:'Это план разбора, а не команда отмены. Исторические заказы, движения склада и деньги не меняются. Администратор выбирает действия после проверки текущих обязательств и фактических остатков.'
 }
}
