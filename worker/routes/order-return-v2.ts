// Authenticated Return V2 HTTP adapter. Feature is OFF unless the deployment
// explicitly sets RETURN_V2_ENABLED=true and all additive migrations exist.
// Existing V1 Return endpoints are unchanged and remain V2-history protected.
import {json,publicApiError,readJson} from '../core/http.ts'
import {toInt} from '../core/text.ts'
import {previewUnifiedReturnV2LineEvidence} from '../domains/return-v2-unified-line-evidence.ts'
import {submitUnifiedReturnV2WithReceiptPrototype,
  completeUnifiedReturnV2ReceiptPrototype} from '../domains/return-v2-unified-immediate-intake-prototype.ts'
import {readVersionedReturnMoney} from '../domains/return-v2-financial-projection.ts'
import {cancelUnifiedReturnV2Prototype} from '../domains/return-v2-unified-cancel-prototype.ts'

const endpoint=/^\/api\/orders\/(\d+)\/returns\/v2(?:\/(preview|\d+\/(?:receipt|cancel)))?$/
// Required migration capabilities, not just names of the final journals.
// A partially applied D1 migration chain must fail before a preview or write.
export const RETURN_V2_REQUIRED_TABLES=[
  'return_v2_prepared_operations','return_v2_prepared_items',
  'return_v2_postings','return_v2_cancellations',
  'return_v2_unified_postings','return_v2_unified_lines',
  'return_v2_unified_cancellations','return_v2_metadata_edits',
  'return_v2_resumed_dispatches'
] as const
export const RETURN_V2_REQUIRED_COLUMNS=[
  ['return_items','contract_quantity_applied'],
  ['return_v2_prepared_operations','baseline_order_updated_at'],
  ['return_v2_prepared_items','baseline_order_item_quantity'],
  ['return_v2_unified_postings','intent_fingerprint'],
  ['return_v2_unified_lines','receipt_intent'],
  ['return_v2_unified_lines','reservation_release'],
  ['return_v2_unified_lines','stock_quantity_change'],
  ['return_v2_unified_cancellations','refund_recovered_at'],
  ['return_v2_metadata_edits','intent_json'],
  ['return_v2_resumed_dispatches','expected_order_version']
] as const

// Can be run verbatim by read-only Wrangler D1 execute during Branch2
// preflight. Only the fixed, in-repository schema identifiers enter this SQL.
export function returnV2SchemaReadinessSql(){
 const tables=RETURN_V2_REQUIRED_TABLES.map(name=>`'${name}'`).join(',')
 const columns=RETURN_V2_REQUIRED_COLUMNS.map(([table,column])=>
   `(SELECT COUNT(*) FROM pragma_table_info('${table}') WHERE name='${column}')`).join(' + ')
 return `SELECT
   (SELECT COUNT(*) FROM sqlite_master
     WHERE type='table' AND name IN (${tables})) AS table_count,
   (${columns}) AS column_count,
   (SELECT COUNT(*) FROM sqlite_master WHERE type='table'
      AND name='return_v2_unified_lines'
      AND instr(sql,'cancel_workshop_obligation')>0) AS workshop_action_count`
}
export async function returnV2SchemaReadiness(db:D1Database){
 const result=await db.prepare(returnV2SchemaReadinessSql())
   .first<{table_count:number;column_count:number;workshop_action_count:number}>()
 return {
   ready:toInt(result?.table_count,0)===RETURN_V2_REQUIRED_TABLES.length
     &&toInt(result?.column_count,0)===RETURN_V2_REQUIRED_COLUMNS.length
     &&toInt(result?.workshop_action_count,0)===1,
   foundTables:toInt(result?.table_count,0),
   expectedTables:RETURN_V2_REQUIRED_TABLES.length,
   foundColumns:toInt(result?.column_count,0),
   expectedColumns:RETURN_V2_REQUIRED_COLUMNS.length
 }
}
async function schemaReady(db:D1Database){
 return (await returnV2SchemaReadiness(db)).ready
}
function disabled(message:string,code='return_v2_unavailable',status=409){
 return json({ok:false,code,message},{status,headers:{'Cache-Control':'no-store'}})
}
function response(data:unknown,status=200){
 return json(data,{status,headers:{'Cache-Control':'no-store'}})
}
async function preview(db:D1Database,orderId:number){
 const [lineEvidence,financial,history]=await Promise.all([
   previewUnifiedReturnV2LineEvidence(db,orderId),
   readVersionedReturnMoney(db,orderId),
   db.prepare(`SELECT
     (SELECT COUNT(*) FROM returns r WHERE r.order_id=?) AS returns_count,
     (SELECT COUNT(*) FROM exchanges e WHERE e.order_id=?
       AND COALESCE(e.status,'completed')<>'cancelled') AS exchanges_count,
     (SELECT COUNT(*) FROM return_v2_unified_postings up WHERE up.order_id=?) AS unified_count,
     (SELECT COUNT(*) FROM return_v2_postings vp WHERE vp.order_id=?) AS old_v2_count,
     (SELECT COUNT(*) FROM return_v2_unified_cancellations c
       JOIN return_v2_unified_postings up ON up.id=c.posting_id
       WHERE up.order_id=?) AS cancel_count`)
     .bind(orderId,orderId,orderId,orderId,orderId).first<{
      returns_count:number;exchanges_count:number;unified_count:number;
      old_v2_count:number;cancel_count:number
     }>(),
 ])
 const recent=await db.prepare(`SELECT up.id AS posting_id,up.return_id,up.posted_at,
    up.cash_refund,ret.status AS return_status,
    (SELECT COUNT(*) FROM return_v2_unified_lines ul
      WHERE ul.posting_id=up.id AND ul.action='physical_return_pending') AS shipped_count,
    (SELECT COUNT(*) FROM return_v2_unified_lines ul
      WHERE ul.posting_id=up.id AND ul.action IN ('cancel_unshipped_reservation','cancel_unresolved_reservation')) AS reserved_count,
    (SELECT COUNT(*) FROM return_items ri WHERE ri.return_id=up.return_id
      AND (ri.physical_received_at IS NOT NULL OR ri.restocked<>0)) AS received_count,
    (SELECT COUNT(*) FROM inventory_lifecycle_events le
      WHERE le.operation_type='return' AND le.operation_id=up.return_id) AS lifecycle_count,
    (SELECT COUNT(*) FROM payments p WHERE p.order_id=up.order_id
      AND julianday(p.created_at)>julianday(up.posted_at)) AS later_payments
   FROM return_v2_unified_postings up
   JOIN returns ret ON ret.id=up.return_id
   WHERE up.order_id=? ORDER BY up.id DESC LIMIT 1`)
   .bind(orderId).first<{
     posting_id:number;return_id:number;posted_at:string;cash_refund:number;
     return_status:string;shipped_count:number;reserved_count:number;
     received_count:number;lifecycle_count:number;later_payments:number
   }>()
 const hasUnsupported=toInt(history?.old_v2_count,0)>0
   ||toInt(history?.exchanges_count,0)>0
   ||toInt(history?.cancel_count,0)>0
   ||toInt(history?.returns_count,0)!==toInt(history?.unified_count,0)
 const provenLines=lineEvidence.lines.filter(l=>!l.requiresReview&&l.availableQuantity>0)
 const eligible=!hasUnsupported&&provenLines.length>0
 const paidIn=financial.kind==='return_v2'
   ?financial.paidIn
   :financial.receivedAmount
 const paidOut=financial.kind==='return_v2'
   ?financial.paidOut
   :financial.returnAmount
 const netHeld=financial.kind==='return_v2'
   ?financial.netHeld
   :Math.max(0,paidIn-paidOut)
 const currentSale=financial.kind==='return_v2'
   ?financial.currentSale:financial.totalAmount
 const cancellationAvailable=Boolean(recent
   &&toInt(history?.unified_count,0)===1
   &&toInt(history?.returns_count,0)===1
   &&!hasUnsupported
   &&recent.return_status==='completed'
   &&recent.received_count===0&&recent.lifecycle_count===0
   &&recent.later_payments===0
   &&financial.kind==='return_v2'
   &&financial.orderVersion===recent.posted_at)
 return {ok:true,enabled:true,eligible,exclusive:financial.kind==='return_v2',
   cancellation:recent?{
     postingId:recent.posting_id,returnId:recent.return_id,
     refundAmount:recent.cash_refund,
     hasSent:recent.shipped_count>0,
     hasUnsent:recent.reserved_count>0,
     available:cancellationAvailable,
     reason:cancellationAvailable
       ?'Можно запросить отмену после фактического подтверждения; свободный резерв и деньги ещё проверит сервер.'
       :recent.received_count>0||recent.lifecycle_count>0
         ?'Товар уже физически принят или начат складской учёт. Простая отмена недоступна.'
         :'После возврата уже была другая операция или изменение. Отмена требует отдельной проверки.'
   }:null,
   reason:hasUnsupported
      ?'У заказа есть старая операция, обмен или отменённый Return V2. Сначала требуется проверка истории.'
      :provenLines.length===0
       ?'Нет позиций с подтверждённой отправкой или резервом. Проверьте их статусы.'
       :null,
   evidence:lineEvidence,
   finance:{currentSale,paidIn,paidOut,netHeld,
      customerDebt:Math.max(0,currentSale-netHeld),
      customerOverpay:Math.max(0,netHeld-currentSale),
      maxRefund:netHeld},
   defaultLineIds:provenLines.map(l=>l.orderItemId)}
}
export async function handleOrderReturnV2Route(
 db:D1Database,request:Request,pathname:string,enabled:boolean,actorRole:string
):Promise<Response|null>{
 const match=pathname.match(endpoint)
 if(!match)return null
 const orderId=toInt(match[1],0)
 if(!orderId)return disabled('Заказ не найден.','return_v2_bad_order',404)
 const suffix=match[2]||''
 if(!enabled){
  return request.method==='GET'&&suffix==='preview'
    ?response({ok:true,enabled:false,eligible:false})
    :disabled('Новая модель возвратов пока не включена для сотрудников.','return_v2_disabled')
 }
 if(!['admin','manager'].includes(actorRole))
  return disabled('Действие доступно только менеджеру или администратору.','return_v2_access_denied',403)
 try{
  if(!await schemaReady(db))
   return disabled('Для Return V2 ещё не применены миграции тестовой базы. Данные не изменены.','return_v2_schema_unavailable',503)
  if(request.method==='GET'&&suffix==='preview'){
   return response(await preview(db,orderId))
  }
  if(request.method==='POST'&&suffix===''){
   const input=await readJson<{
    requestId?:unknown;expectedOrderVersion?:unknown;
    items?:Array<{orderItemId:number;quantity:number;receiptIntent?:'pending'|'warehouse'|'boutique'|'no_stock'}>;
    refundAmount?:unknown;refundMethod?:unknown
   }>(request)
   // A completed request must be replayable even after the sale is fully
   // terminated and the fresh preview has no selectable items. The domain
   // replay verifies the exact immutable fingerprint and return status.
   const old=await db.prepare(
     'SELECT id FROM return_v2_unified_postings WHERE request_id=?'
   ).bind(String(input.requestId||'')).first<{id:number}>()
   if(!old){
     const check=await preview(db,orderId)
     if(!check.eligible)
       return disabled(check.reason||'Состав заказа требует проверки.','return_v2_not_eligible')
   }
   // Request always belongs to the URL order; never honor a body orderId.
   const saved=await submitUnifiedReturnV2WithReceiptPrototype(db,{
    requestId:String(input.requestId||''),orderId,
    expectedOrderVersion:String(input.expectedOrderVersion||''),
    items:Array.isArray(input.items)?input.items:[],
    refundAmount:input.refundAmount as number,
    refundMethod:String(input.refundMethod||'')
   })
   return response(saved,saved.replayed?200:201)
  }
  const receiptMatch=suffix.match(/^(\d+)\/receipt$/)
  if(request.method==='POST'&&receiptMatch){
   const postingId=toInt(receiptMatch[1],0)
   const belongs=await db.prepare(`SELECT 1 AS ok FROM return_v2_unified_postings
     WHERE id=? AND order_id=?`).bind(postingId,orderId).first<{ok:number}>()
   if(!belongs)return disabled('Возврат не найден в этом заказе.','return_v2_wrong_receipt',404)
   const body=await readJson<{freshnessDecisions?:Record<string,'already_counted'|'arrived_after_check'>}>(request)
   const decisions=body.freshnessDecisions||{}
   if(!decisions||typeof decisions!=='object'||Array.isArray(decisions)
     ||Object.values(decisions).some(v=>!['already_counted','arrived_after_check'].includes(v)))
     return disabled('Решение по проверке склада некорректно.','return_v2_bad_checkpoint',400)
   return response(await completeUnifiedReturnV2ReceiptPrototype(db,postingId,decisions))
  }
  const cancelMatch=suffix.match(/^(\d+)\/cancel$/)
  if(request.method==='POST'&&cancelMatch){
   const postingId=toInt(cancelMatch[1],0)
   const belongs=await db.prepare(`SELECT 1 AS ok FROM return_v2_unified_postings
     WHERE id=? AND order_id=?`).bind(postingId,orderId).first<{ok:number}>()
   if(!belongs)return disabled('Возврат не найден в этом заказе.','return_v2_wrong_cancel',404)
   const input=await readJson<{
     requestId?:unknown;reason?:unknown;
     shippedGoodsUnreceivedConfirmed?:unknown;
     reservationsRestoreConfirmed?:unknown;
     refundRecoveredConfirmed?:unknown;recoveryMethod?:unknown
   }>(request)
   if(typeof input.shippedGoodsUnreceivedConfirmed!=='boolean'
     ||typeof input.reservationsRestoreConfirmed!=='boolean'
     ||typeof input.refundRecoveredConfirmed!=='boolean')
    return disabled('Каждое подтверждение должно быть явно выбрано.','return_v2_cancel_bad_confirmations',400)
   const saved=await cancelUnifiedReturnV2Prototype(db,{
     postingId,requestId:String(input.requestId||''),
     reason:String(input.reason||''),
     shippedGoodsUnreceivedConfirmed:input.shippedGoodsUnreceivedConfirmed,
     reservationsRestoreConfirmed:input.reservationsRestoreConfirmed,
     refundRecoveredConfirmed:input.refundRecoveredConfirmed,
     recoveryMethod:String(input.recoveryMethod||'')
   })
   return response(saved)
  }
  return disabled('Неизвестный маршрут Return V2.','return_v2_method_not_allowed',405)
 }catch(error){
  const issue=publicApiError(error)
  return disabled(issue.message,issue.code||'return_v2_conflict',issue.status)
 }
}
