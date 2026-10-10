// READ ONLY. Diagnose whether a prior exact-SKU consolidation could ever be
// compensated. A reversed stock total alone does not restore order commitments.
import { toInt } from '../core/text.ts'

type Receipt={
 id:number;source_variant_id:number;target_variant_id:number;product_id:number;
 created_at:string;created_by:string|null
}
type Sku={id:number;product_id:number;is_active:number;updated_at:string}
type Ledger={
 inventory_source:string;source_stock_id:number;target_stock_id_before:number|null;
 source_quantity_before:number;target_quantity_before:number;combined_quantity_after:number;
 source_reserved_before:number;target_reserved_before:number
}
type Choice={
 inventory_source:string;decision_method:string;final_quantity:number;
 adjustment_quantity:number;reason:string|null
}
type Stock={id:number;variant_id:number;inventory_source:string;quantity:number;reserved_quantity:number;last_source_ref:string|null;updated_at:string}
type Counts={
 activeOrders:number;activeReservations:number;postMergeOrders:number;postMergeReservations:number;
 postMergeMovements:number;postMergeStockChecks:number;activeWorkshop:number;
 pendingLifecycle:number;appliedLifecycle:number;activeStocktake:number;appliedTransfers:number;
 returnExchangeLinks:number;laterIntoKeeper:number;sourceAsKeeper:number;keeperMerged:number;
 originalReservations:number;stockValidation:number;reservationValidation:number;correctionMovements:number;
 invalidEventDates:number
}
const positiveId=(x:number)=>Number.isSafeInteger(x)&&x>0
const reason=(code:string,message:string)=>({code,message})
function numeric(value:unknown){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0}
const locationName=(s:string)=>s==='warehouse'?'Склад':s==='boutique'?'Бутик':s

export async function previewCatalogConsolidationUndo(db:D1Database,consolidationId:number){
  if(!positiveId(consolidationId))throw new Error('Укажите корректный номер объединения.')
  const receipt=await db.prepare(
    `SELECT id,source_variant_id,target_variant_id,product_id,created_at,created_by
       FROM catalog_variant_consolidations WHERE id=?`
  ).bind(consolidationId).first<Receipt>()
  if(!receipt)throw new Error('Объединение с таким номером не найдено.')
  const sourceId=receipt.source_variant_id,keeperId=receipt.target_variant_id
  const [skus,ledgerResult,choicesResult,stockResult,impact]=await Promise.all([
    db.prepare('SELECT id,product_id,is_active,updated_at FROM catalog_variants WHERE id IN (?,?)')
      .bind(sourceId,keeperId).all<Sku>(),
    db.prepare(`SELECT inventory_source,source_stock_id,target_stock_id_before,
          source_quantity_before,target_quantity_before,combined_quantity_after,
          source_reserved_before,target_reserved_before
        FROM catalog_variant_consolidation_stock_rows
        WHERE consolidation_id=? ORDER BY inventory_source`)
      .bind(consolidationId).all<Ledger>(),
    db.prepare(`SELECT inventory_source,decision_method,final_quantity,adjustment_quantity,reason
        FROM catalog_variant_consolidation_stock_decisions WHERE consolidation_id=?
        ORDER BY inventory_source`)
      .bind(consolidationId).all<Choice>(),
    db.prepare(`SELECT id,variant_id,inventory_source,quantity,reserved_quantity,last_source_ref,updated_at
        FROM inventory_stock WHERE variant_id IN (?,?) ORDER BY inventory_source,variant_id`)
      .bind(sourceId,keeperId).all<Stock>(),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE oi.variant_id IN (?,?) AND o.order_status='active'
          AND COALESCE(o.shipping_status,'not_sent')<>'sent' AND oi.quantity>0) AS activeOrders,
      (SELECT COUNT(*) FROM inventory_reservations r WHERE r.variant_id IN (?,?) AND r.status='active') AS activeReservations,
      (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE oi.variant_id IN (?,?)
          AND MAX(COALESCE(julianday(oi.created_at),0),COALESCE(julianday(o.updated_at),0))
            >=julianday(?)) AS postMergeOrders,
      (SELECT COUNT(*) FROM inventory_reservations r
        WHERE r.variant_id IN (?,?) AND julianday(r.updated_at)>=julianday(?)) AS postMergeReservations,
      (SELECT COUNT(*) FROM inventory_movements m WHERE m.variant_id IN (?,?)
        AND julianday(m.created_at)>=julianday(?) AND NOT (
          m.reference_type='catalog_stock_finalization' AND m.reference_id=CAST(? AS TEXT))) AS postMergeMovements,
      (SELECT COUNT(*) FROM inventory_stock_checks c
        WHERE c.variant_id IN (?,?) AND julianday(c.checked_at)>=julianday(?)) AS postMergeStockChecks,
      (SELECT COUNT(*) FROM workshop_tasks wt WHERE wt.variant_id IN (?,?) AND wt.status='active') AS activeWorkshop,
      (SELECT COUNT(*) FROM inventory_lifecycle_events e WHERE e.variant_id IN (?,?)
        AND e.status='pending') AS pendingLifecycle,
      (SELECT COUNT(*) FROM inventory_lifecycle_events e WHERE e.variant_id IN (?,?)
        AND e.status='applied') AS appliedLifecycle,
      (SELECT COUNT(*) FROM inventory_stocktake_items i
        JOIN inventory_stocktake_sessions sess ON sess.id=i.session_id
        WHERE i.variant_id IN (?,?) AND sess.status='active') AS activeStocktake,
      (SELECT COUNT(*) FROM inventory_transfer_items i
        JOIN inventory_transfer_documents d ON d.id=i.transfer_id
        WHERE i.variant_id IN (?,?) AND d.status='applied') AS appliedTransfers,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id IN (?,?) AND (
         EXISTS(SELECT 1 FROM return_items r WHERE r.order_item_id=oi.id)
         OR EXISTS(SELECT 1 FROM exchanges e WHERE e.old_order_item_id=oi.id OR e.new_order_item_id=oi.id)
         OR EXISTS(SELECT 1 FROM exchange_items e WHERE e.order_item_id=oi.id))) AS returnExchangeLinks,
      (SELECT COUNT(*) FROM catalog_variant_consolidations c
        WHERE c.target_variant_id=? AND c.id>?) AS laterIntoKeeper,
      (SELECT COUNT(*) FROM catalog_variant_consolidations c
        WHERE c.target_variant_id=?) AS sourceAsKeeper,
      (SELECT COUNT(*) FROM catalog_variant_consolidations c
        WHERE c.source_variant_id=?) AS keeperMerged,
      (SELECT COUNT(*) FROM catalog_variant_consolidation_reservation_rows r
        WHERE r.consolidation_id=?) AS originalReservations,
      (SELECT COUNT(*) FROM catalog_variant_consolidation_validations v
        WHERE v.consolidation_id=? AND v.passed=1) AS stockValidation,
      (SELECT COUNT(*) FROM catalog_variant_consolidation_reservation_validations v
        WHERE v.consolidation_id=? AND v.passed=1) AS reservationValidation,
      (SELECT COUNT(*) FROM inventory_movements m
        WHERE m.reference_type='catalog_stock_finalization' AND m.reference_id=CAST(? AS TEXT)) AS correctionMovements,
      (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE oi.variant_id IN (?,?) AND
          (julianday(oi.created_at) IS NULL OR julianday(o.updated_at) IS NULL))
       + (SELECT COUNT(*) FROM inventory_reservations r
          WHERE r.variant_id IN (?,?) AND julianday(r.updated_at) IS NULL)
       + (SELECT COUNT(*) FROM inventory_movements m
          WHERE m.variant_id IN (?,?) AND julianday(m.created_at) IS NULL)
       + (SELECT COUNT(*) FROM inventory_stock_checks c
          WHERE c.variant_id IN (?,?) AND julianday(c.checked_at) IS NULL)
        AS invalidEventDates
    `).bind(
       sourceId,keeperId,sourceId,keeperId,
       sourceId,keeperId,receipt.created_at,sourceId,keeperId,receipt.created_at,
       sourceId,keeperId,receipt.created_at,consolidationId,
       sourceId,keeperId,receipt.created_at,sourceId,keeperId,
       sourceId,keeperId,sourceId,keeperId,sourceId,keeperId,sourceId,keeperId,
       sourceId,keeperId,keeperId,consolidationId,sourceId,keeperId,
       consolidationId,consolidationId,consolidationId,consolidationId,
       sourceId,keeperId,sourceId,keeperId,sourceId,keeperId,sourceId,keeperId,
    ).first<Counts>()
  ])
  const variants=skus.results||[],ledger=ledgerResult.results||[],choices=choicesResult.results||[],
    stock=stockResult.results||[]
  const source=variants.find(v=>v.id===sourceId),keeper=variants.find(v=>v.id===keeperId)
  const n=(k:keyof Counts)=>toInt(impact?.[k],0)
  const blockers:Array<{code:string;message:string}>=[]
  if(!source||!keeper||source.product_id!==receipt.product_id||keeper.product_id!==receipt.product_id
    ||source.is_active!==0||keeper.is_active!==1){
    blockers.push(reason('identity_changed','Исходная или основная вариация изменила состояние либо принадлежность товару.'))
  }
  if(n('stockValidation')!==1||n('reservationValidation')!==1){
    blockers.push(reason('audit_incomplete','Отсутствует проверенный транзакционный журнал исходного объединения.'))
  }
  if(n('originalReservations')>0){
    blockers.push(reason('original_reservations','При объединении переносились действующие резервы и ссылки заказов: простое восстановление остатков недопустимо.'))
  }
  if(n('activeOrders')||n('activeReservations')){
    blockers.push(reason('active_customer_obligations','Есть открытые заказы или резервы на один из вариантов.'))
  }
  if(n('postMergeOrders')||n('postMergeReservations')){
    blockers.push(reason('later_order_activity','После объединения появились или изменялись заказы/резервы.'))
  }
  if(n('postMergeMovements')||n('postMergeStockChecks')){
    blockers.push(reason('later_inventory_activity','После объединения есть новые движения склада либо результаты сверок.'))
  }
  if(n('invalidEventDates')){
    blockers.push(reason('event_time_unknown',
      'Есть связанные заказы или складские записи с некорректной либо отсутствующей датой. Нельзя подтвердить, что они предшествовали объединению.'))
  }
  if(n('activeWorkshop')||n('pendingLifecycle')||n('appliedLifecycle')
    ||n('activeStocktake')||n('appliedTransfers')||n('returnExchangeLinks')){
    blockers.push(reason('reversible_dependencies','Есть связанные операции цеха, возврата, обмена, перемещения или ревизии.'))
  }
  if(n('laterIntoKeeper')||n('sourceAsKeeper')||n('keeperMerged')){
    blockers.push(reason('merge_chain','Один из вариантов участвует в последующих/вложенных объединениях.'))
  }
  const predictedCorrections=choices.filter(c=>c.adjustment_quantity!==0).length
  if(n('correctionMovements')!==predictedCorrections){
    blockers.push(reason('movement_audit_mismatch','Журнал физической корректировки не совпадает с сохранёнными решениями.'))
  }
  if(ledger.length!==choices.length||ledger.some(l=>!choices.some(c=>c.inventory_source===l.inventory_source))){
    blockers.push(reason('ledger_incomplete','Журнал решений по местам хранения не совпадает с исходной записью склада.'))
  }
  const locations=ledger.map(l=>{
    const choice=choices.find(c=>c.inventory_source===l.inventory_source)
    const sourceStock=stock.find(s=>s.id===l.source_stock_id)
    const keeperStock=stock.find(s=>s.variant_id===keeperId && s.inventory_source===l.inventory_source)
    const combined=l.source_quantity_before+l.target_quantity_before
    const issues:string[]=[]
    if(!['warehouse','boutique'].includes(l.inventory_source))issues.push('Неизвестное место хранения')
    if(!choice||choice.final_quantity!==l.combined_quantity_after
      ||!numeric(l.source_quantity_before)||!numeric(l.target_quantity_before)||!numeric(l.combined_quantity_after)){
      issues.push('Несовпадение исходного журнала')
    }
    if(l.target_stock_id_before===null){
      issues.push('Основной складской записи до объединения не было — восстановление требует отдельного сценария')
    }
    if(!sourceStock||sourceStock.variant_id!==sourceId||sourceStock.inventory_source!==l.inventory_source
      ||sourceStock.quantity!==0||sourceStock.reserved_quantity!==0
      ||sourceStock.last_source_ref!==`catalog-consolidation:${sourceId}->${keeperId}`){
      issues.push('Исходный остаток изменился либо отсутствует')
    }
    if(!keeperStock||keeperStock.id!==l.target_stock_id_before
      ||keeperStock.quantity!==l.combined_quantity_after
      ||keeperStock.reserved_quantity!==l.target_reserved_before+l.source_reserved_before
      ||(l.source_quantity_before>0&&keeperStock.last_source_ref!==`catalog-consolidation:${sourceId}->${keeperId}`)){
      issues.push('Основной остаток изменился либо отсутствует')
    }
    if(issues.length){
      blockers.push(reason('location_mismatch_'+l.inventory_source,
        `${locationName(l.inventory_source)}: ${issues.join('; ')}.`))
    }
    return {
      location:l.inventory_source,locationLabel:locationName(l.inventory_source),
      before:{source:l.source_quantity_before,keeper:l.target_quantity_before,
        sourceReserved:l.source_reserved_before,keeperReserved:l.target_reserved_before},
      after:{source:sourceStock?.quantity??null,keeper:keeperStock?.quantity??null,
        reserved:keeperStock?.reserved_quantity??null},
      decision:choice?.decision_method??null,
      accountingCorrection:choice?.adjustment_quantity??null,
      physicalReductionComparedToSum:combined-l.combined_quantity_after,
      issues,
    }
  })
  // Original audit does not snapshot keeper-only locations. Never assume a
  // second location is untouched merely because no source row existed there.
  if(stock.some(r=>r.variant_id===keeperId
      && !ledger.some(l=>l.inventory_source===r.inventory_source))){
    blockers.push(reason('keeper_only_location_unverified',
      'У основного варианта есть другое место хранения, состояние которого не зафиксировано в журнале этого объединения.'))
  }
  if(stock.some(r=>r.variant_id===sourceId&&!ledger.some(l=>l.source_stock_id===r.id))
    ||stock.some(r=>r.variant_id===keeperId
      && ledger.some(l=>l.inventory_source===r.inventory_source)
      && !ledger.some(l=>l.inventory_source===r.inventory_source&&l.target_stock_id_before===r.id))){
    blockers.push(reason('unexpected_stock_rows','Складские записи после объединения отличаются от исходной топологии.'))
  }
  const uniqueBlockers=[...new Map(blockers.map(b=>[b.code,b])).values()]
  return {
    ok:true,consolidationId,
    sourceId,keeperId,mergedAt:receipt.created_at,mergedBy:receipt.created_by,
    locations,
    impact:{
      activeOrders:n('activeOrders'),activeReservations:n('activeReservations'),
      postMergeOrders:n('postMergeOrders'),postMergeReservations:n('postMergeReservations'),
      postMergeMovements:n('postMergeMovements'),postMergeStockChecks:n('postMergeStockChecks'),
      invalidEventDates:n('invalidEventDates'),
      originalReservations:n('originalReservations'),
      nestedMerges:n('laterIntoKeeper')+n('sourceAsKeeper')+n('keeperMerged'),
      activeWorkshop:n('activeWorkshop'),activeStocktake:n('activeStocktake'),
      returnsOrExchanges:n('returnExchangeLinks'),
    },
    blockers:uniqueBlockers,
    potentialCompensationCandidate:uniqueBlockers.length===0,
    canUndoNow:false,
    explanation:uniqueBlockers.length
      ? 'Простая отмена небезопасна. Сначала разберите указанные обязательства и движения; система ничего не изменяла.'
      : 'После объединения не обнаружены дополнительные движения или обязательства. Возможность компенсирующего восстановления проверена предварительно; автоматическая отмена пока не включена.',
  }
}
