// Stage 1 of the unified Return/Cancel flow. Read-only, not routed to employee UI.
// A chosen line means "remove from the purchase", never "physically received".
import { priorIssueEvidenceSql } from './order-prior-issued-origin.ts'

export type ReturnV2LineAction =
  | 'physical_return_pending'
  | 'cancel_unshipped_reservation'
  | 'cancel_unresolved_reservation'
  | 'needs_review'

export type ReturnV2LineEvidence = {
  orderItemId: number
  productName: string
  sourceType: string
  status: string
  proposedAction: ReturnV2LineAction
  reasonCode: string
  message: string
  contractQuantity: number
  alreadyReturnedWithoutContractReduction: number
  availableQuantity: number
  selectedQuantity: number
  soldUnitPrice: number
  selectedSaleValue: number
  dispatchedQuantity: number
  activeReservedQuantity: number
  unresolvedReservedQuantity: number
  fulfilledQuantity: number
  plannedReserveRelease: number
  expectedPhysicalStockDelta: 0
  requiresReview: boolean
}

type OrderRow = {
  id:number;external_id:string;pricing_mode:string;total_amount:number
  order_status:string;shipping_status:string;created_at:string;updated_at:string
  archived_at:string|null
}
type ItemRow = {
  id:number;product_name_snapshot:string;quantity:number;unit_price:number
  line_total:number;stock_writeoff_status:string|null;source_type:string
  is_workshop:number;variant_id:number|null;prior_issued_evidence:number
  old_returned_quantity:number
}
type ReservationRow = {
  order_item_id:number;quantity:number;status:string
  inventory_source:string;variant_id:number|null
}
type DispatchRow = {
  order_item_id:number;quantity:number;cancelled_quantity:number
  source_type:string;variant_id:number|null;movement_id:number|null
  movement_valid:number
}

export class ReturnV2LineEvidenceConflict extends Error {
  readonly status=409
  readonly code='return_v2_line_evidence_conflict'
}

function amount(raw:unknown):number|null {
  const n=Number(raw)
  return raw!==null&&raw!==undefined&&raw!==''&&Number.isSafeInteger(n)&&n>=0?n:null
}
function labelFor(action:ReturnV2LineAction) {
  if(action==='physical_return_pending')return 'Отправлен — ожидаем физический возврат'
  if(action==='cancel_unshipped_reservation')return 'Не отправлен — отмена и снятие резерва'
  if(action==='cancel_unresolved_reservation')return 'Не отправлен — отмена неразрешённого резерва'
  return 'Требуется уточнение складской истории'
}

export async function previewUnifiedReturnV2LineEvidence(db:D1Database,rawOrderId:number) {
  if(!Number.isSafeInteger(rawOrderId)||rawOrderId<1)
    throw new ReturnV2LineEvidenceConflict('Некорректный номер заказа.')
  const order=await db.prepare(
    `SELECT id,external_id,pricing_mode,total_amount,order_status,shipping_status,
      created_at,updated_at,archived_at FROM orders WHERE id=? LIMIT 1`
  ).bind(rawOrderId).first<OrderRow>()
  if(!order)throw new ReturnV2LineEvidenceConflict('Заказ не найден.')
  const [itemResults,reservationResults,dispatchResults,history]=await Promise.all([
    db.prepare(`SELECT oi.id,oi.product_name_snapshot,oi.quantity,oi.unit_price,oi.line_total,
       oi.stock_writeoff_status,oi.source_type,oi.is_workshop,oi.variant_id,
       EXISTS(
        SELECT 1 FROM inventory_reservations r
        WHERE r.order_id=oi.order_id AND r.order_item_id=oi.id AND r.status='fulfilled'
          AND `+priorIssueEvidenceSql('oi','r')+`
       ) AS prior_issued_evidence,
       COALESCE((SELECT SUM(ri.quantity)
        FROM return_items ri JOIN returns ret ON ret.id=ri.return_id
        WHERE ri.order_item_id=oi.id AND ret.order_id=oi.order_id
          AND COALESCE(ret.status,'completed')<>'cancelled'
          AND COALESCE(ri.contract_quantity_applied,0)=0
          AND NOT EXISTS(SELECT 1 FROM exchanges e
            WHERE e.refund_return_id=ret.id AND COALESCE(e.status,'completed')<>'cancelled')
       ),0) AS old_returned_quantity
      FROM order_items oi WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id`
    ).bind(rawOrderId).all<ItemRow>(),
    db.prepare(`SELECT order_item_id,quantity,status,inventory_source,variant_id
      FROM inventory_reservations WHERE order_id=? ORDER BY order_item_id,id`
    ).bind(rawOrderId).all<ReservationRow>(),
    db.prepare(`SELECT di.order_item_id,di.quantity,di.cancelled_quantity,di.source_type,
       di.variant_id,di.movement_id,
       CASE WHEN di.movement_id IS NOT NULL AND EXISTS(
         SELECT 1 FROM inventory_movements m
         WHERE m.id=di.movement_id AND m.movement_type='sale'
           AND m.reference_type='order_dispatch'
           AND m.inventory_source=di.source_type
           AND m.variant_id=di.variant_id
       ) THEN 1 ELSE 0 END AS movement_valid
       FROM order_dispatch_items di
       JOIN order_dispatches d ON d.id=di.dispatch_id
       WHERE d.order_id=? ORDER BY di.order_item_id,di.id`
    ).bind(rawOrderId).all<DispatchRow>(),
    db.prepare(`SELECT
       (SELECT COUNT(*) FROM returns WHERE order_id=?) AS returns_count,
       (SELECT COUNT(*) FROM exchanges WHERE order_id=?) AS exchanges_count`
    ).bind(rawOrderId,rawOrderId).first<{returns_count:number;exchanges_count:number}>(),
  ])
  const items=itemResults.results||[]
  const reservations=new Map<number,ReservationRow[]>()
  const dispatches=new Map<number,DispatchRow[]>()
  for(const r of reservationResults.results||[]){
    const id=Number(r.order_item_id)
    if(!reservations.has(id))reservations.set(id,[])
    reservations.get(id)!.push(r)
  }
  for(const r of dispatchResults.results||[]){
    const id=Number(r.order_item_id)
    if(!dispatches.has(id))dispatches.set(id,[])
    dispatches.get(id)!.push(r)
  }
  const rootProblems:string[]=[]
  if(order.pricing_mode!=='itemized_v1')rootProblems.push('legacy_price_unverified')
  if(['archived','deleted'].includes(String(order.order_status||'').toLowerCase())||order.archived_at)
    rootProblems.push('order_closed')
  if(Number(history?.exchanges_count||0)>0)rootProblems.push('exchange_history_requires_migration')
  let lineTotal=0
  for(const item of items){
    const q=amount(item.quantity),unit=amount(item.unit_price),sum=amount(item.line_total)
    if(q===null||unit===null||sum===null||!Number.isSafeInteger(q*unit)||q*unit!==sum
      ||!Number.isSafeInteger(lineTotal+sum))rootProblems.push('invalid_line_price_or_quantity')
    else lineTotal+=sum
  }
  if(amount(order.total_amount)===null||lineTotal!==order.total_amount)
    rootProblems.push('contract_total_mismatch')
  const lines:ReturnV2LineEvidence[]=[]
  for(const item of items) {
    const id=Number(item.id)
    const contractQuantity=amount(item.quantity)??0
    const oldReturned=amount(item.old_returned_quantity)??0
    const qty=Math.max(0,contractQuantity-oldReturned)
    const soldUnitPrice=amount(item.unit_price)??0
    const rs=reservations.get(id)||[]
    const ds=dispatches.get(id)||[]
    const active=rs.filter(r=>r.status==='active')
    const unresolved=rs.filter(r=>r.status==='unresolved')
    const fulfilled=rs.filter(r=>r.status==='fulfilled')
    const nonCurrent=rs.filter(r=>!['active','unresolved','fulfilled'].includes(r.status))
    const activeQty=active.reduce((s,r)=>s+(amount(r.quantity)??0),0)
    const unresolvedQty=unresolved.reduce((s,r)=>s+(amount(r.quantity)??0),0)
    const fulfilledQty=fulfilled.reduce((s,r)=>s+(amount(r.quantity)??0),0)
    const dispatched=ds.reduce((s,r)=>s+Math.max(0,(amount(r.quantity)??0)-(amount(r.cancelled_quantity)??0)),0)
    const source=String(item.source_type||'')
    const isWorkshop=Number(item.is_workshop)===1
    const stockStatus=String(item.stock_writeoff_status||'')
    const priorIssued=Number(item.prior_issued_evidence)===1
    let action:ReturnV2LineAction='needs_review'
    let reasonCode='unknown_state'
    let message='Нет однозначного основания для складского действия. Не изменяйте остаток автоматически.'
    const badNumbers=oldReturned>contractQuantity||qty===0
      ||!Number.isSafeInteger(qty*soldUnitPrice)
      ||rs.some(r=>amount(r.quantity)===null||amount(r.quantity)===0)
      ||ds.some(r=>amount(r.quantity)===null||amount(r.cancelled_quantity)===null
        ||r.quantity<=0||r.cancelled_quantity>r.quantity)
    const badSource=rs.some(r=>r.inventory_source!==source
      ||(item.variant_id!==null&&r.variant_id!==null&&item.variant_id!==r.variant_id))
      ||ds.some(d=>d.source_type!==(isWorkshop?'workshop':source))
    if(rootProblems.length){
      reasonCode=rootProblems[0]
      message='Заказ или цены требуют проверки перед изменением продажи.'
    }else if(badNumbers||badSource||oldReturned>0){
      reasonCode='legacy_quantity_or_source_conflict'
      message='Состав, старые возвраты или складская идентичность требуют проверки.'
    }else if(ds.length && ds.some(d=>d.cancelled_quantity>0)){
      reasonCode='corrected_dispatch_requires_review'
      message='Есть отменённая отправка. Проверьте, где товар и что уже учтено.'
    }else if(dispatched>contractQuantity||dispatched>0&&dispatched<contractQuantity){
      reasonCode='partial_dispatch_not_split'
      message='Часть этой строки отправлена без безопасного разделения. Требуется сверка.'
    }else if(dispatched===contractQuantity&&qty>0){
      const validDispatch=ds.every(d=>Number(d.movement_valid)===1||isWorkshop||(
        d.movement_id===null&&priorIssued))
      const badReservation=activeQty>0||unresolvedQty>0
        ||(!isWorkshop&&(fulfilled.length!==1||fulfilledQty!==contractQuantity))
      if(validDispatch&&!badReservation){
        action='physical_return_pending'
        reasonCode='dispatch_confirmed'
        message='Клиенту отправлен; после оформления возврата ожидаем реальное получение. Приход сейчас: 0.'
      }else{
        reasonCode='dispatch_or_reservation_mismatch'
        message='Отправка есть, но складская выдача или резерв ей не соответствуют.'
      }
    }else if(dispatched===0&&ds.length===0&&!isWorkshop&&fulfilledQty>0){
      reasonCode='issued_before_shipping_unconfirmed'
      message='Склад уже списал товар, но отправка клиенту не подтверждена. Не начислять приход.'
    }else if(dispatched===0&&ds.length===0&&!isWorkshop
      &&String(order.shipping_status)==='sent'){
      reasonCode='legacy_order_sent_without_line_proof'
      message='Заказ отмечен отправленным, но нет подтверждения выдачи этой позиции.'
    }else if(dispatched===0&&ds.length===0&&!isWorkshop&&nonCurrent.length===0
      &&fulfilledQty===0&&active.length===1&&unresolvedQty===0
      &&activeQty===contractQuantity&&stockStatus==='reserved'){
      action='cancel_unshipped_reservation'
      reasonCode='active_reservation_not_dispatched'
      message='Товар остаётся в учтённом остатке. Снять резерв без прихода и без списания.'
    }else if(dispatched===0&&ds.length===0&&!isWorkshop&&nonCurrent.length===0
      &&fulfilledQty===0&&unresolved.length===1&&activeQty===0
      &&unresolvedQty===contractQuantity&&stockStatus==='pending_reservation'){
      action='cancel_unresolved_reservation'
      reasonCode='unresolved_reservation_not_dispatched'
      message='Физического списания нет. Закрыть неразрешённый резерв без изменения остатка.'
    }else if(isWorkshop&&dispatched===0) {
      reasonCode='workshop_unsent_needs_review'
      message='Не отправлен из Цеха. Нужно учесть реальное состояние работы/готовности.'
    }else if(priorIssued||['fulfilled','written_off','negative','retired_physically_issued'].includes(stockStatus)){
      reasonCode='issued_before_shipping_unconfirmed'
      message='Есть признаки складской выдачи без надёжного подтверждения отправки.'
    }else if(ds.length>0){
      reasonCode='dispatch_history_ambiguous'
      message='Запись отправки не соответствует текущему количеству.'
    }
    if(oldReturned>contractQuantity)reasonCode='overreturned_legacy_quantity'
    const requiresReview=action==='needs_review'
    lines.push({
      orderItemId:id,productName:String(item.product_name_snapshot||'Товар'),
      sourceType:isWorkshop?'workshop':source,status:labelFor(action),
      proposedAction:action,reasonCode,message,
      contractQuantity,alreadyReturnedWithoutContractReduction:oldReturned,
      availableQuantity:qty,selectedQuantity:qty,
      soldUnitPrice,selectedSaleValue:qty*soldUnitPrice,
      dispatchedQuantity:dispatched,
      activeReservedQuantity:activeQty,unresolvedReservedQuantity:unresolvedQty,
      fulfilledQuantity:fulfilledQty,
      plannedReserveRelease:action==='cancel_unshipped_reservation'?activeQty:0,
      expectedPhysicalStockDelta:0,
      requiresReview,
    })
  }
  const sum=(f:(x:ReturnV2LineEvidence)=>number)=>lines.reduce((n,x)=>n+f(x),0)
  const selectedQuantity=sum(x=>x.selectedQuantity)
  const pendingPhysicalQuantity=sum(x=>x.proposedAction==='physical_return_pending'?x.selectedQuantity:0)
  const reservedCancellationQuantity=sum(x=>x.proposedAction==='cancel_unshipped_reservation'?x.selectedQuantity:0)
  const unresolvedCancellationQuantity=sum(x=>x.proposedAction==='cancel_unresolved_reservation'?x.selectedQuantity:0)
  const requiresReviewQuantity=sum(x=>x.requiresReview?x.selectedQuantity:0)
  const selectedSaleValue=sum(x=>x.selectedSaleValue)
  const selectedActiveReserveRelease=sum(x=>x.plannedReserveRelease)
  return {
    ok:true,mode:'return_v2_unified_line_evidence',readOnly:true,commitAllowed:false,
    orderId:rawOrderId,externalId:order.external_id,orderVersion:order.updated_at,
    allActiveQuantitiesSelectedByDefault:true,
    lines,
    summary:{
      selectedQuantity,selectedSaleValue,
      pendingPhysicalQuantity,reservedCancellationQuantity,unresolvedCancellationQuantity,
      requiresReviewQuantity,selectedActiveReserveRelease,
      expectedImmediatePhysicalStockDelta:0,
      fullPurchaseTerminationCandidate:selectedQuantity>0&&
        requiresReviewQuantity===0&&
        sum(x=>x.availableQuantity)===selectedQuantity,
      readyForPosting:false,
    },
    warning:requiresReviewQuantity>0
      ?'Все доступные товары показаны и выделены; неоднозначные строки нельзя проводить до уточнения.'
      :'Все доступные товары выделены; это только расчёт, деньги, резерв и склад не менялись.',
  }
}
