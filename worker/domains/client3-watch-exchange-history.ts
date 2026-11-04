import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {listExchanges,cancelExchange,cancelExchangeSetV2,isExchangeSetV2} from './returns-exchanges.ts'

const error=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
const validKey=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(s)
const permitted=(actor:AuthUser)=>Boolean(actor?.id)&&
  (actor.role==='admin'||!['Логист','Упаковщик','Завсклад'].includes(actor.employeeRole||''))
async function ownedWatchOrder(db:D1Database,brandId:number,orderId:number){
 return db.prepare(`SELECT o.id FROM orders o
   JOIN watch_order_details wd ON wd.order_id=o.id
   WHERE o.id=? AND wd.brand_id=? AND o.order_status NOT IN ('archived','deleted')
   LIMIT 1`).bind(orderId,brandId).first<{id:number}>()
}

/** Main exchange history, scoped before invoking Main's read engine.
 * Watch details are added by canonical order_item_id, not by snapshots
 * of clothing-specific characteristics.
 */
export async function listClient3WatchExchangeHistory(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,
){
 if(!permitted(actor))return error('WATCH_EXCHANGE_HISTORY_FORBIDDEN','История обменов доступна менеджеру и администратору.',403)
 if(!Number.isSafeInteger(orderId)||orderId<1||!await ownedWatchOrder(db,brandId,orderId))
   return error('WATCH_EXCHANGE_HISTORY_NOT_FOUND','Заказ не найден в выбранном бренде.',404)
 const url=new URL('https://client3.local/api/exchanges')
 url.searchParams.set('orderId',String(orderId))
 url.searchParams.set('limit','100')
 const history=await listExchanges(db,url)
 const orderWatchItems=await db.prepare(`
   SELECT oi.id AS orderItemId,wi.watch_variant_id AS watchVariantId,
     wp.model_name AS modelName,wv.gender,
     COALESCE(a.movement,wv.movement,'') AS movement,
     COALESCE(a.bracelet_material,wv.bracelet_material,'') AS braceletMaterial,
     COALESCE(a.dial_color,wv.dial_color,'') AS dialColor,
     COALESCE(a.bracelet_color,wv.bracelet_color,'') AS braceletColor,
     COALESCE(wi.engraving_text,'') AS engravingText
   FROM order_items oi
   JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
   JOIN watch_variants wv ON wv.id=wi.watch_variant_id
   JOIN watch_products wp ON wp.id=wv.watch_product_id
   LEFT JOIN watch_variant_attributes_v5 a ON a.watch_variant_id=wv.id
   WHERE oi.order_id=? AND wp.brand_id=?
 `).bind(orderId,brandId).all<Record<string,unknown>>()
 const watchByItem=new Map((orderWatchItems.results||[]).map(x=>[Number(x.orderItemId),x]))
 const toWatchItem=(line:Record<string,unknown>)=>{
   const item=watchByItem.get(Number(line.orderItemId))
   return {...line,
     modelName:item?String(item.modelName||''):String(line.productName||''),
     gender:item?String(item.gender||''):'',
     movement:item?String(item.movement||''):'',
     braceletMaterial:item?String(item.braceletMaterial||''):'',
     dialColor:item?String(item.dialColor||''):'',
     braceletColor:item?String(item.braceletColor||''):'',
     engravingText:item?String(item.engravingText||''):'',
     watchVariantId:item?Number(item.watchVariantId):null,
   }
 }
 return json({...history,brandId,orderId,
   exchanges:history.exchanges.map((e)=>{
     const oldItems=(e.oldItems||[]).map((line:Record<string,unknown>)=>toWatchItem(line))
     const newItems=(e.newItems||[]).map((line:Record<string,unknown>)=>toWatchItem(line))
     return {...e,oldItems,newItems}
   }),
 })
}

/** Directly delegate to the original Main cancellation engines.
 * They enforce descendant exchange/return dependencies and reverse money
 * and physical movements. Never "delete" an exchange by local SQL.
 */
export async function cancelClient3WatchExchange(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,exchangeId:number,
 input:{requestId?:unknown;reason?:unknown},
){
 if(!permitted(actor))
   return error('WATCH_EXCHANGE_CANCEL_FORBIDDEN','Отмена обменов доступна менеджеру и администратору.',403)
 if(!Number.isSafeInteger(orderId)||orderId<1||!Number.isSafeInteger(exchangeId)||exchangeId<1||
   !validKey(input.requestId))
   return error('WATCH_EXCHANGE_CANCEL_INVALID','Выберите обмен и уникальный номер операции.',400)
 const reason=typeof input.reason==='string'?input.reason.trim():''
 if(reason.length<8||reason.length>500)
   return error('WATCH_EXCHANGE_CANCEL_REASON','Укажите причину отмены (8–500 символов).',400)
 if(!await ownedWatchOrder(db,brandId,orderId))
   return error('WATCH_EXCHANGE_CANCEL_NOT_FOUND','Заказ не найден в выбранном бренде.',404)
 const owned=await db.prepare(`
   SELECT e.id,e.order_id FROM exchanges e
   WHERE e.id=? AND e.order_id=? LIMIT 1
 `).bind(exchangeId,orderId).first<{id:number;order_id:number}>()
 if(!owned)return error('WATCH_EXCHANGE_CANCEL_NOT_FOUND','Обмен не принадлежит этому заказу.',404)
 try{
   const inputMain={requestId:input.requestId as string,comment:reason}
   const setExchange=await isExchangeSetV2(db,exchangeId)
   const result=setExchange
     ?await cancelExchangeSetV2(db,exchangeId,inputMain)
     :await cancelExchange(db,exchangeId,inputMain)
   return json({...result,brandId,orderId,exchangeId,setExchange})
 }catch(cause){
   return error('WATCH_EXCHANGE_CANCEL_BLOCKED',cause instanceof Error
     ?cause.message:'Отмена заблокирована зависимыми операциями.')
 }
}
