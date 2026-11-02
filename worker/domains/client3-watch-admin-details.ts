import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

type Line={orderItemId:number;engravingText:string}
type WatchFields={deliveryAddress:string;postalCode:string;urgent:boolean;
 shippingDeadlineAt:string;items:Line[]}
type Raw={requestId?:unknown;expected?:WatchFields;next?:WatchFields}
const bad=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
const same=(x:unknown,y:unknown)=>JSON.stringify(x)===JSON.stringify(y)
const valid=(x:unknown):x is WatchFields=>{
 if(!x||typeof x!=='object'||Array.isArray(x))return false
 const z=x as Record<string,unknown>
 if(Object.keys(z).some(k=>!['deliveryAddress','postalCode','urgent','shippingDeadlineAt','items'].includes(k)))return false
 if(typeof z.deliveryAddress!=='string'||!z.deliveryAddress.trim()||z.deliveryAddress.length>500||
  typeof z.postalCode!=='string'||!z.postalCode.trim()||z.postalCode.length>20||
  typeof z.urgent!=='boolean'||typeof z.shippingDeadlineAt!=='string'||
  z.shippingDeadlineAt.length>35||!Array.isArray(z.items)||z.items.length<1||z.items.length>50)return false
 const date=Date.parse(z.shippingDeadlineAt)
 if(!Number.isFinite(date)||new Date(date).toISOString()!==z.shippingDeadlineAt)return false
 const seen=new Set<number>()
 for(const entry of z.items as Line[]){
   if(!entry||!Number.isSafeInteger(entry.orderItemId)||entry.orderItemId<1||
     seen.has(entry.orderItemId)||typeof entry.engravingText!=='string'||
     entry.engravingText.length>500)return false
   seen.add(entry.orderItemId)
 }
 return true
}
/** Order composition/stock is not edited here. The third watch worker owns
 * these watch-only fields; Main still owns order records, funds, and inventory.
 * All matching old-value checks and final verification share one D1 transaction.
 */
export async function correctClient3AdminWatchDetails(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,raw:Raw,
):Promise<Response>{
 if(actor?.role!=='admin')return bad('WATCH_DETAILS_ADMIN_ONLY','Только администратор может исправлять логистику и гравировку.',403)
 if(!Number.isSafeInteger(orderId)||orderId<1||!Number.isSafeInteger(brandId)||brandId<1)
   return bad('WATCH_DETAILS_BAD_SCOPE','Выберите заказ и бренд.',400)
 if(typeof raw?.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(raw.requestId))
   return bad('WATCH_DETAILS_BAD_REQUEST','Некорректный идентификатор исправления.',400)
 if(!valid(raw?.expected)||!valid(raw?.next))
   return bad('WATCH_DETAILS_BAD_INPUT','Обновите заказ и проверьте адрес, индекс, срок и все строки гравировки.',400)
 const previous=raw.expected, next=raw.next
 const metadata=await db.prepare(`SELECT wd.delivery_full_address AS deliveryAddress,
   wd.postal_code AS postalCode,wd.urgent,
   wd.shipping_deadline_at AS shippingDeadlineAt,o.order_status AS orderStatus,
   o.shipping_status AS shippingStatus,
   lj.status AS engravingStatus,
   (SELECT COUNT(*) FROM order_dispatch_items di
     JOIN order_dispatches d ON d.id=di.dispatch_id
     WHERE d.order_id=o.id AND di.quantity>COALESCE(di.cancelled_quantity,0)) AS dispatched
   FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
   JOIN watch_logistics_jobs lj ON lj.order_id=o.id
   WHERE wd.order_id=? AND wd.brand_id=?`).bind(orderId,brandId)
   .first<Record<string,unknown>>()
 if(!metadata)return bad('WATCH_DETAILS_NOT_FOUND','Заказ не найден в выбранном бренде.',404)
 const currentLines=await db.prepare(`SELECT oi.id AS orderItemId,wi.engraving_text AS engravingText
   FROM order_items oi
   JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
   WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id`)
   .bind(orderId).all<Line>()
 const actual:WatchFields={
   deliveryAddress:String(metadata.deliveryAddress),
   postalCode:String(metadata.postalCode),
   urgent:Number(metadata.urgent)===1,
   shippingDeadlineAt:String(metadata.shippingDeadlineAt),
   items:currentLines.results||[],
 }
 const sort=(x:WatchFields):WatchFields=>({...x,items:[...x.items].sort((a,b)=>a.orderItemId-b.orderItemId)})
 const prior=sort(previous),after=sort(next),live=sort(actual)
 if(!same(prior.items.map(x=>x.orderItemId),live.items.map(x=>x.orderItemId))||
   !same(after.items.map(x=>x.orderItemId),live.items.map(x=>x.orderItemId)))
   return bad('WATCH_DETAILS_LINES_CHANGED','Состав заказа изменился. Обновите карточку.',409)
 if(same(live,after))
   return json({ok:true,orderId,alreadyApplied:true})
 if(!same(live,prior))
   return bad('WATCH_DETAILS_STALE','Адрес, срок или гравировка уже изменены. Обновите заказ.',409)
 if(['archived','deleted'].includes(String(metadata.orderStatus)))
   return bad('WATCH_DETAILS_CLOSED','Закрытый заказ редактировать нельзя.',409)
 if(String(metadata.shippingStatus)==='sent'||Number(metadata.dispatched)>0)
   return bad('WATCH_DETAILS_ALREADY_SENT','Часы уже отправлялись. Не переписывайте сведения о фактической отправке.',409)
 const changingEngraving=prior.items.some((line,i)=>line.engravingText!==after.items[i].engravingText)
 if(changingEngraving&&String(metadata.engravingStatus)==='ready')
   return bad('WATCH_DETAILS_ENGRAVING_READY','Гравировка уже отмечена готовой. Сначала оформите корректировку в логистике.',409)
 const now=new Date().toISOString()
 try{
   await db.batch([
     db.prepare(`UPDATE watch_order_details SET
       delivery_full_address=?,postal_code=?,urgent=?,shipping_deadline_at=?,updated_at=?
       WHERE order_id=? AND brand_id=?
         AND delivery_full_address=? AND postal_code=? AND urgent=? AND shipping_deadline_at=?
         AND NOT EXISTS(SELECT 1 FROM order_dispatches d
           JOIN order_dispatch_items di ON di.dispatch_id=d.id
           WHERE d.order_id=? AND di.quantity>COALESCE(di.cancelled_quantity,0))
         AND EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.order_status NOT IN ('archived','deleted')
           AND o.shipping_status<>'sent')`)
       .bind(after.deliveryAddress.trim(),after.postalCode.trim(),after.urgent?1:0,
         after.shippingDeadlineAt,now,orderId,brandId,
         prior.deliveryAddress,prior.postalCode,prior.urgent?1:0,prior.shippingDeadlineAt,
         orderId,orderId),
     ...after.items.map((line,i)=>db.prepare(`UPDATE watch_order_item_details
       SET engraving_text=? WHERE order_item_id=? AND engraving_text=?
         AND EXISTS(SELECT 1 FROM order_items oi WHERE oi.id=watch_order_item_details.order_item_id
           AND oi.order_id=? AND oi.quantity>0)
         AND NOT EXISTS(SELECT 1 FROM order_dispatch_items di
           JOIN order_dispatches d ON d.id=di.dispatch_id
           WHERE di.order_item_id=watch_order_item_details.order_item_id
             AND d.order_id=? AND di.quantity>COALESCE(di.cancelled_quantity,0))
         AND (engraving_text=? OR EXISTS(SELECT 1 FROM watch_logistics_jobs lj
           WHERE lj.order_id=? AND lj.status<>'ready'))`)
       .bind(line.engravingText.trim(),line.orderItemId,prior.items[i].engravingText,
         orderId,orderId,line.engravingText,orderId)),
     db.prepare(`SELECT json('WATCH_DETAILS_STALE') WHERE NOT EXISTS(
       SELECT 1 FROM watch_order_details
       WHERE order_id=? AND brand_id=? AND delivery_full_address=? AND postal_code=?
         AND urgent=? AND shipping_deadline_at=?)`)
       .bind(orderId,brandId,after.deliveryAddress.trim(),after.postalCode.trim(),
         after.urgent?1:0,after.shippingDeadlineAt),
     ...after.items.map(line=>db.prepare(`SELECT json('WATCH_ENGRAVING_STALE')
       WHERE NOT EXISTS(SELECT 1 FROM watch_order_item_details wi
       JOIN order_items oi ON oi.id=wi.order_item_id
       WHERE oi.order_id=? AND wi.order_item_id=? AND wi.engraving_text=?)`)
       .bind(orderId,line.orderItemId,line.engravingText.trim())),
   ])
   return json({ok:true,orderId,adminWatchDetailsEdited:true,
     changedEngravings:changingEngraving})
 }catch{
   return bad('WATCH_DETAILS_CONFLICT','Заказ изменился во время сохранения. Обновите список и повторите.',409)
 }
}
