// Reconcile historical Return V1 item quantities into the current purchase
// *without* changing previously received goods, reservations, production or
// cash. This returns a read-only, exact plan for an atomic Return V2 posting.
type ReturnRow={id:number;amount:number;linked_exchange:number}
type ItemRow={id:number;return_id:number;order_item_id:number|null;
  quantity:number;contract_quantity_applied:number;unit_price:number|null;
  current_quantity:number|null;line_total:number|null;order_id:number|null}
type ExistingRow={complete_count:number;total_refunded:number;unified_count:number;ever_unified_count:number;
  baselined_count:number;missing_baselined:number;total_paid:number}
export type OldReturnBaselineLine={returnItemId:number;returnId:number;
  orderItemId:number;quantity:number;unitPrice:number;reduction:number}
export type OldReturnBaseline={orderId:number;returns:ReturnRow[];
  lines:OldReturnBaselineLine[];byItem:Array<{itemId:number;quantity:number;unitPrice:number;originalQuantity:number}>;
  reduction:number;previousRefund:number;activeReturnCount:number;
  alreadyBaselined:number;needsBaseline:boolean}
export class ReturnV2HistoricalBaselineConflict extends Error {
  readonly status=409
  readonly code='return_v2_historical_baseline_conflict'
}
const fail=(msg:string):never=>{throw new ReturnV2HistoricalBaselineConflict(msg)}
function n(x:unknown,label:string,min=0):number{
 if(!Number.isSafeInteger(x)||Number(x)<min)fail(label+' не подтверждён.')
 return Number(x)
}
export async function readOldReturnBaseline(db:D1Database,orderId:number):Promise<OldReturnBaseline>{
 n(orderId,'Номер заказа',1)
 const state=await db.prepare(`SELECT
    (SELECT COUNT(*) FROM returns r WHERE r.order_id=? AND COALESCE(r.status,'completed')='completed') AS complete_count,
    (SELECT COALESCE(SUM(CASE WHEN r.amount>0 THEN r.amount ELSE 0 END),0)
       FROM returns r WHERE r.order_id=? AND COALESCE(r.status,'completed')='completed') AS total_refunded,
    (SELECT COUNT(*) FROM return_v2_unified_postings up JOIN returns r ON r.id=up.return_id
      WHERE up.order_id=? AND r.status='completed') AS unified_count,
    (SELECT COUNT(*) FROM return_v2_unified_postings up WHERE up.order_id=?) AS ever_unified_count,
    (SELECT COUNT(*) FROM return_v2_legacy_baseline_returns lb WHERE lb.order_id=?) AS baselined_count,
    (SELECT COUNT(*) FROM return_v2_legacy_baseline_returns lb
      LEFT JOIN returns r ON r.id=lb.return_id
      WHERE lb.order_id=? AND (r.id IS NULL OR r.order_id<>lb.order_id
        OR COALESCE(r.status,'completed')<>'completed'
        OR r.amount<>lb.original_cash_refund)) AS missing_baselined,
    (SELECT COALESCE(SUM(CASE WHEN p.amount>0 THEN p.amount ELSE 0 END),0)
      FROM payments p WHERE p.order_id=?) AS total_paid`)
    .bind(orderId,orderId,orderId,orderId,orderId,orderId,orderId).first<ExistingRow>()
 if(!state)fail('История прежних возвратов не найдена.')
 const activeReturnCount=n(state.complete_count,'Число возвратов')
 const previousRefund=n(state.total_refunded,'Прежние выплаты')
 const existing=n(state.unified_count,'Проведённые Return V2')
 const alreadyBaselined=n(state.baselined_count,'Учтённые старые возвраты')
 if(n(state.missing_baselined,'Несогласованные старые возвраты')!==0)
   fail('Прежний возврат был изменён после переноса. Заказ требует проверки.')
 if(previousRefund>n(state.total_paid,'Исторические оплаты'))
   fail('Выплаты больше полученных денег. Автоматический расчёт невозможен.')
 const returns=(await db.prepare(`SELECT r.id,r.amount,
      EXISTS(SELECT 1 FROM exchanges e WHERE e.refund_return_id=r.id
        AND COALESCE(e.status,'completed')<>'cancelled') AS linked_exchange
    FROM returns r WHERE r.order_id=?
      AND COALESCE(r.status,'completed')='completed'
      AND NOT EXISTS(SELECT 1 FROM return_v2_unified_postings up WHERE up.return_id=r.id)
      AND NOT EXISTS(SELECT 1 FROM return_v2_legacy_baseline_returns lb WHERE lb.return_id=r.id)
    ORDER BY r.id`).bind(orderId).all<ReturnRow>()).results||[]
 if(returns.length>100||n(state.ever_unified_count,'История нового возврата')>0&&returns.length>0)
   fail('После нового возврата обнаружена несовместимая старая операция.')
 if(returns.some(r=>n(r.id,'Возврат',1)<=0||n(r.amount,'Выплата')<0||r.linked_exchange!==0))
   fail('Старый возврат относится к денежному обмену или не подтверждён.')
 if(returns.length+alreadyBaselined+existing!==activeReturnCount)
   fail('История возвратов содержит несовместимые операции.')
 if(returns.length===0)return {orderId,returns:[],lines:[],byItem:[],reduction:0,
   previousRefund,activeReturnCount,alreadyBaselined,needsBaseline:false}
 const ids=returns.map(r=>r.id)
 const placeholders=ids.map(()=>'?').join(',')
 const rows=(await db.prepare(`SELECT ri.id,ri.return_id,ri.order_item_id,ri.quantity,
    COALESCE(ri.contract_quantity_applied,0) AS contract_quantity_applied,
    oi.unit_price,oi.quantity AS current_quantity,oi.line_total,oi.order_id
    FROM return_items ri LEFT JOIN order_items oi ON oi.id=ri.order_item_id
    WHERE ri.return_id IN (${placeholders}) ORDER BY ri.order_item_id,ri.id`)
   .bind(...ids).all<ItemRow>()).results||[]
 if(rows.length>500)fail('Слишком много старых позиций для автоматического переноса.')
 const lines:OldReturnBaselineLine[]=[]
 const grouped=new Map<number,{itemId:number;quantity:number;unitPrice:number;originalQuantity:number}>()
 let reduction=0
 for(const r of rows){
   const qty=n(r.quantity,'Старое количество')
   if(qty===0)continue
   if(!r.order_item_id||r.order_id!==orderId)fail('Старый возврат с неопознанной товарной позицией.')
   if(r.contract_quantity_applied!==0&&r.contract_quantity_applied!==1)
      fail('Неизвестная отметка прежнего возврата.')
   if(r.contract_quantity_applied===1)continue
   const price=n(r.unit_price,'Историческая цена')
   const original=n(r.current_quantity,'Исходное количество')
   const lineTotal=n(r.line_total,'Исходная стоимость')
   if(original<=0||lineTotal!==original*price||!Number.isSafeInteger(qty*price))
      fail('Цена и количество ранее возвращённой позиции противоречат покупке.')
   const itemId=n(r.order_item_id,'Позиция возврата',1)
   if(!grouped.has(itemId))grouped.set(itemId,{
     itemId,quantity:0,unitPrice:price,originalQuantity:original})
   const g=grouped.get(itemId)!
   if(g.originalQuantity!==original||g.unitPrice!==price)fail('Цена товара менялась между возвратами.')
   g.quantity+=qty
   if(!Number.isSafeInteger(g.quantity)||g.quantity>g.originalQuantity)
     fail('Ранее возвращено больше, чем было продано.')
   const value=qty*price
   reduction+=value
   if(!Number.isSafeInteger(reduction))fail('Слишком большая сумма старых возвратов.')
   lines.push({returnItemId:n(r.id,'Строка возврата',1),returnId:n(r.return_id,'Возврат',1),
     orderItemId:itemId,quantity:qty,unitPrice:price,reduction:value})
 }
 return {orderId,returns,lines,byItem:[...grouped.values()],
   reduction,previousRefund,activeReturnCount,alreadyBaselined,needsBaseline:true}
}
