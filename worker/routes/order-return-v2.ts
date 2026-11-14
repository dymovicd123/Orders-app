// Authenticated Return V2 HTTP adapter. Feature is OFF unless the deployment
// explicitly sets RETURN_V2_ENABLED=true and all additive migrations exist.
// Existing V1 Return endpoints are unchanged and remain V2-history protected.
import {json,publicApiError,readJson} from '../core/http.ts'
import {toInt} from '../core/text.ts'
import {previewUnifiedReturnV2LineEvidence} from '../domains/return-v2-unified-line-evidence.ts'
import {submitUnifiedReturnV2WithReceiptPrototype,
  completeUnifiedReturnV2ReceiptPrototype} from '../domains/return-v2-unified-immediate-intake-prototype.ts'
import {readVersionedReturnMoney} from '../domains/return-v2-financial-projection.ts'

const endpoint=/^\/api\/orders\/(\d+)\/returns\/v2(?:\/(preview|\d+\/receipt))?$/
const requiredTables=[
  'return_v2_postings','return_v2_unified_postings','return_v2_unified_lines',
  'return_v2_unified_cancellations','return_v2_metadata_edits','return_v2_resumed_dispatches'
]
async function schemaReady(db:D1Database){
 const names=requiredTables.map(()=>'?').join(',')
 const result=await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master
    WHERE type='table' AND name IN (${names})`)
   .bind(...requiredTables).first<{n:number}>()
 if(toInt(result?.n,0)!==requiredTables.length)return false
 const receipt=await db.prepare(`SELECT 1 AS ok FROM pragma_table_info('return_v2_unified_lines')
  WHERE name='receipt_intent' LIMIT 1`).first<{ok:number}>()
 return Boolean(receipt?.ok)
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
 return {ok:true,enabled:true,eligible,exclusive:financial.kind==='return_v2',
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
  return disabled('Неизвестный маршрут Return V2.','return_v2_method_not_allowed',405)
 }catch(error){
  const issue=publicApiError(error)
  return disabled(issue.message,issue.code||'return_v2_conflict',issue.status)
 }
}
