// NOT EXPOSED AS HTTP: resumable immediate intake for mixed Return V2.
// The contractual Return is committed FIRST; physical receipt is delegated to
// the existing idempotent, stocktake-aware returned-item intake workflow.
// If intake is blocked, the Return remains recorded with an honest pending item.
// Never claim that a financial Return and later physical receipt are one D1 txn.
import { postUnifiedReturnV2Prototype, type ReturnV2ReceiptIntent } from './return-v2-unified-posting-prototype.ts'
import { receiveReturnedItem } from './order-returned-item-receipt.ts'

type PostInput=Parameters<typeof postUnifiedReturnV2Prototype>[1]
type FreshnessDecision='already_counted'|'arrived_after_check'
type Line={
  posting_id:number;return_id:number;order_id:number;order_item_id:number;
  action:string;receipt_intent:string;return_item_id:number|null;
  physical_received_at:string|null;return_status:string
}
export class ReturnV2ImmediateIntakeConflict extends Error {
  readonly status=409
  readonly code='return_v2_immediate_intake_conflict'
}
function fail(message:string):never {throw new ReturnV2ImmediateIntakeConflict(message)}
async function readLines(db:D1Database,postingId:number){
  const rows=(await db.prepare(
    `SELECT up.id AS posting_id,up.return_id,up.order_id,ul.order_item_id,ul.action,
      ul.receipt_intent,ri.id AS return_item_id,ri.physical_received_at,
      r.status AS return_status
     FROM return_v2_unified_postings up
     JOIN returns r ON r.id=up.return_id AND r.order_id=up.order_id
     JOIN return_v2_unified_lines ul ON ul.posting_id=up.id
     LEFT JOIN return_items ri ON ri.return_id=up.return_id
       AND ri.order_item_id=ul.order_item_id
     WHERE up.id=? ORDER BY ul.id`
  ).bind(postingId).all<Line>()).results||[]
  if(!rows.length||rows.length>100||rows.some(row=>
    row.return_status!=='completed'||
    (row.action==='physical_return_pending' &&
      (!row.return_item_id||!['pending','warehouse','boutique','no_stock'].includes(row.receipt_intent)))||
    (row.action!=='physical_return_pending' &&
      (row.return_item_id!==null||row.receipt_intent!=='not_applicable'))))
    fail('Журнал состава возврата и физической приёмки не согласован.')
  return rows
}
export async function completeUnifiedReturnV2ReceiptPrototype(
  db:D1Database,
  postingId:number,
  freshnessDecisions:Record<string,FreshnessDecision>={},
){
  if(!Number.isSafeInteger(postingId)||postingId<1)fail('Некорректный идентификатор возврата.')
  const rows=await readLines(db,postingId)
  const results:Array<{
    orderItemId:number;intent:ReturnV2ReceiptIntent;
    state:'pending'|'received'|'confirmation_required'|'failed';
    stockApplied:boolean;stockAlreadyApplied:boolean;freshnessProtected:boolean;
    message?:string;detail?:unknown
  }>=[]
  for(const row of rows){
    if(row.action!=='physical_return_pending')continue
    const intent=row.receipt_intent as ReturnV2ReceiptIntent
    if(intent==='pending'){
      results.push({orderItemId:row.order_item_id,intent,state:'pending',
        stockApplied:false,stockAlreadyApplied:false,freshnessProtected:false})
      continue
    }
    const confirmation=freshnessDecisions[String(row.order_item_id)]
    if(confirmation&&confirmation!=='already_counted'&&confirmation!=='arrived_after_check')
      fail('Неизвестное решение по физической сверке.')
    let received:Awaited<ReturnType<typeof receiveReturnedItem>>
    try {
      received=await receiveReturnedItem(db,{
        requestId:'v2u-intake:'+row.posting_id+':'+row.return_item_id,
        operationType:'return',operationId:row.return_id,
        operationItemId:Number(row.return_item_id),
        destination:intent, ...(confirmation?{freshnessDecision:confirmation}:{})
      })
    }catch(error){
      results.push({orderItemId:row.order_item_id,intent,state:'failed',
        stockApplied:false,stockAlreadyApplied:false,freshnessProtected:false,
        message:error instanceof Error?error.message:String(error)})
      break
    }
    if(received.ok!==true){
      results.push({orderItemId:row.order_item_id,intent,state:'confirmation_required',
        stockApplied:false,stockAlreadyApplied:false,freshnessProtected:false,
        message:String(received.message||'Нужно уточнить результат инвентаризации.'),
        detail:received})
      break
    }
    results.push({orderItemId:row.order_item_id,intent,state:'received',
      stockApplied:Boolean(received.stockApplied),
      stockAlreadyApplied:Boolean(received.stockAlreadyApplied),
      freshnessProtected:Boolean(received.freshnessProtected),
      detail:received})
  }
  const intended=rows.filter(r=>r.action==='physical_return_pending'&&r.receipt_intent!=='pending').length
  const completed=results.filter(r=>r.state==='received').length
  const immediateIntakesComplete=completed===intended
  return {
    ok:immediateIntakesComplete,contractPosted:true,
    receiptPending:!immediateIntakesComplete,
    postingId,returnId:rows[0].return_id,orderId:rows[0].order_id,
    immediateIntakesComplete,
    physicalPendingQuantity:rows.filter(r=>r.action==='physical_return_pending'&&r.receipt_intent==='pending').length,
    receiptResults:results,
    message:immediateIntakesComplete
      ?'Состояние приёмки сохранено. Физический остаток изменён только там, где подтверждена реальная приёмка.'
      :'Возврат в договоре уже записан, но приёмка не завершена. Повторите приёмку после проверки; новую продажную операцию не создавайте.',
  }
}
export async function submitUnifiedReturnV2WithReceiptPrototype(
  db:D1Database, input:PostInput,
  freshnessDecisions:Record<string,FreshnessDecision>={},
){
  const posting=await postUnifiedReturnV2Prototype(db,input)
  const receipts=await completeUnifiedReturnV2ReceiptPrototype(db,posting.postingId,freshnessDecisions)
  return {...posting,receipt:receipts,ok:receipts.ok,contractPosted:true}
}
