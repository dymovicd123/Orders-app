// Admin-only READ-ONLY investigation for reversing a corrected SKU merge.
// This deliberately offers no POST endpoint and performs no stock mutation.
// A historical stock-count correction must not be "undone" by fabricating
// original quantity: actual source/keeper allocation needs a new count.
import { previewCatalogConsolidationUndo } from './catalog-consolidation-undo-preview.ts'

type CheckIssue={code:string;message:string}
type Stock={id:number;variant_id:number;inventory_source:string;quantity:number;reserved_quantity:number;updated_at:string|null;last_source_ref:string|null}
type CorrectionMovement={
  id:number;inventory_source:string;variant_id:number;quantity_delta:number;
  quantity_after:number;reference_type:string;reference_id:string;created_at:string
}
type Generation={generation:number;event_kind:string}
const validId=(value:number)=>Number.isSafeInteger(value)&&value>0
const positiveOrZero=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0
const knownLocation=(value:string)=>value==='warehouse'||value==='boutique'
const add=(blockers:CheckIssue[],code:string,message:string)=>{
  if(!blockers.some(x=>x.code===code))blockers.push({code,message})
}
export async function previewCorrectedCatalogConsolidationUndo(db:D1Database,consolidationId:number){
  if(!validId(consolidationId))throw new Error('Укажите корректный номер объединения.')
  const original=await previewCatalogConsolidationUndo(db,consolidationId)
  const [stockRows,movementRows,generationRows]=await Promise.all([
    db.prepare(`SELECT id,variant_id,inventory_source,quantity,reserved_quantity,updated_at,last_source_ref
      FROM inventory_stock WHERE variant_id IN (?,?) ORDER BY id`)
      .bind(original.sourceId,original.keeperId).all<Stock>(),
    db.prepare(`SELECT id,inventory_source,variant_id,quantity_delta,quantity_after,
        reference_type,reference_id,created_at FROM inventory_movements
      WHERE reference_type='catalog_stock_finalization' AND reference_id=?
      ORDER BY id`).bind(String(consolidationId)).all<CorrectionMovement>(),
    db.prepare(`SELECT generation,event_kind FROM catalog_variant_merge_generation_events
      WHERE source_variant_id IN (?,?) ORDER BY source_variant_id,generation`)
      .bind(original.sourceId,original.keeperId).all<Generation>(),
  ])
  const stocks=stockRows.results||[],movements=movementRows.results||[],generations=generationRows.results||[]
  // "Requires accounting" is expected for all non-additive merges; every
  // other original preflight blocker still applies without exception.
  const blockers:CheckIssue[]=original.blockers
    .filter(x=>x.code!=='physical_undo_requires_accounting').map(x=>({...x}))
  const corrected=original.locations.some(l=>l.decision!=='sum'||l.accountingCorrection!==0)
  if(!corrected){
    add(blockers,'not_corrected',
      'У этого объединения нет ручной корректировки количества. Используйте стандартную проверку отмены.')
  }
  if(generations.length){
    add(blockers,'prior_generations','У вариантов уже есть последующие события объединения или отмены.')
  }
  if(!Number.isFinite(Date.parse(original.mergedAt))){
    add(blockers,'invalid_merge_date','Дата исходного объединения повреждена. Проверка невозможна.')
  }
  if(original.impact.originalReservations>0){
    add(blockers,'original_customer_links',
      'При объединении переносились резервы или позиции заказов. Их нельзя автоматически возвращать.')
  }
  if(!original.locations.length){
    add(blockers,'missing_locations','В исходном журнале отсутствуют места хранения.')
  }
  if(stocks.some(s=>!knownLocation(s.inventory_source)
    || !positiveOrZero(s.quantity)||!positiveOrZero(s.reserved_quantity)
    || !Number.isFinite(Date.parse(s.updated_at||'')))){
    add(blockers,'stock_unknown','Складские записи содержат неизвестную дату, место или количество.')
  }
  if(stocks.some(s=>Date.parse(s.updated_at||'')>Date.parse(original.mergedAt))){
    add(blockers,'post_merge_stock_write',
      'После объединения менялись складские записи. Требуется отдельная разборка движений.')
  }
  // A stock-finalization movement is expected ONLY for a genuine nonzero
  // physical correction. Validate its exact delta, keeper identity and final
  // quantity, not only its row count.
  const expected=original.locations.filter(l=>l.accountingCorrection!==0)
  if(movements.length!==expected.length){
    add(blockers,'correction_audit_mismatch',
      'Число записей корректировки не соответствует исходным решениям.')
  }
  const used=new Set<string>()
  for(const movement of movements){
    const location=original.locations.find(l=>l.location===movement.inventory_source)
    if(!location||used.has(movement.inventory_source)
      ||location.accountingCorrection===0
      ||movement.variant_id!==original.keeperId
      ||movement.quantity_delta!==location.accountingCorrection
      ||movement.quantity_after!==location.after.keeper
      ||movement.reference_type!=='catalog_stock_finalization'
      ||movement.reference_id!==String(consolidationId)
      ||!Number.isFinite(Date.parse(movement.created_at))
      ||Date.parse(movement.created_at)!==Date.parse(original.mergedAt)){
      add(blockers,'correction_audit_mismatch',
        'Найдена корректировка с другой датой, количеством, местом или вариантом товара.')
    }
    used.add(movement.inventory_source)
  }
  const locations=original.locations.map(l=>{
    const source=stocks.find(s=>s.variant_id===original.sourceId&&s.inventory_source===l.location)
    const keeper=stocks.find(s=>s.variant_id===original.keeperId&&s.inventory_source===l.location)
    const currentTotal=(source?.quantity??0)+(keeper?.quantity??0)
    if(!source||!keeper||l.issues.length||source.quantity!==0||
      source.reserved_quantity!==0||keeper.reserved_quantity!==0||
      !knownLocation(l.location)||!positiveOrZero(currentTotal)){
      add(blockers,'location_inconsistent',
        'Не все складские записи сохранили проверенное состояние объединения.')
    }
    return {
      location:l.location,label:l.locationLabel,
      beforeMerge:{source:l.before.source,keeper:l.before.keeper,
        total:l.before.source+l.before.keeper},
      mergeDecision:{method:l.decision,correction:l.accountingCorrection,
        confirmedFinal:l.after.keeper},
      current:{source:source?.quantity??null,keeper:keeper?.quantity??null,
        total:source&&keeper?currentTotal:null},
      manualAllocation:{
        sourceQuantity:null,keeperQuantity:null,
        requiredTotal:source&&keeper?currentTotal:null,
      },
    }
  })
  const unique=[...new Map(blockers.map(x=>[x.code,x])).values()]
  return {
    ok:true,consolidationId,sourceId:original.sourceId,keeperId:original.keeperId,
    mergedAt:original.mergedAt,
    canPrepareCountedSplit:corrected&&unique.length===0,
    requiresPhysicalCount:corrected,
    blockers:unique,locations,
    stateToken:JSON.stringify({
      original:original.undoStateToken,
      stock:stocks.map(x=>[x.id,x.variant_id,x.inventory_source,x.quantity,
        x.reserved_quantity,x.updated_at,x.last_source_ref]),
      corrections:movements.map(x=>[x.id,x.inventory_source,x.variant_id,x.quantity_delta,
        x.quantity_after,x.created_at]),
      generations,
      blockers:unique,
    }),
    explanation:corrected&&unique.length===0
      ? 'Количество уже было скорректировано при объединении. Перед отменой администратор должен подтвердить новое распределение по каждому месту хранения. Общий остаток изменять нельзя.'
      : 'Автоматическая отмена невозможна. Система сохранила историю и показывает, какие операции требуют проверки.',
  }
}
