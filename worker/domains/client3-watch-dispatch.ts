import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {dispatchSelectedCompleteOrderLines} from './order-dispatch.ts'
import {getOrderStockHandoverState} from './order-reservations.ts'

const fail=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
type WatchDispatchSelection={orderItemId:number;quantity:number}
type DispatchInput={requestId?:unknown;items?:unknown;confirmPhysicalStock?:unknown}

/** Main's selective shipment engine owns physical movement, split rows,
 * reservation fulfilment and financial consistency. Client3 verifies brand,
 * watch SKU and engraving for each requested quantity. A split must copy
 * watch-specific SKU/engraving to the new held row in the SAME D1 transaction.
 */
export async function dispatchClient3WatchOrder(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,input:DispatchInput,
){
 if(!actor||(actor.employeeRole==='Завсклад'&&actor.role!=='admin'))
   return fail('WATCH_SEND_FORBIDDEN','Отправку подтверждает менеджер, логист или администратор.',403)
 if(!Number.isSafeInteger(brandId)||brandId<=0||!Number.isSafeInteger(orderId)||orderId<=0)
   return fail('WATCH_ORDER_INVALID','Выберите заказ и бренд.',400)
 const requestId=input?.requestId
 if(typeof requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(requestId))
   return fail('WATCH_REQUEST_INVALID','Необходим уникальный идентификатор отправки.',400)
 const order=await db.prepare(`SELECT o.id,o.order_status,wd.brand_id,lj.status AS engraving_status
   FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
   JOIN watch_logistics_jobs lj ON lj.order_id=o.id
   WHERE o.id=? AND wd.brand_id=? LIMIT 1`)
   .bind(orderId,brandId).first<Record<string,unknown>>()
 if(!order)return fail('WATCH_ORDER_NOT_FOUND','Заказ не найден в выбранном бренде.',404)
 if(['archived','deleted'].includes(String(order.order_status)))
   return fail('WATCH_ORDER_CLOSED','Заказ закрыт.',409)
 const all=await db.prepare(`SELECT oi.id,oi.quantity,oi.is_workshop,oi.source_type,
   oi.stock_writeoff_status,wi.engraving_text,wv.catalog_variant_id,
   CASE WHEN TRIM(COALESCE(wi.engraving_text,''))='' THEN 1
     WHEN ready.engraving_text=wi.engraving_text THEN 1 ELSE 0 END AS engraving_ready,
   wp.brand_id AS sku_brand,ir.status AS reservation_status,
   COALESCE((SELECT SUM(di.quantity-di.cancelled_quantity)
     FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
     WHERE di.order_item_id=oi.id AND d.order_id=oi.order_id),0) AS shipped_quantity
   FROM order_items oi
   LEFT JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
   LEFT JOIN watch_engraving_item_readiness ready ON ready.order_item_id=oi.id
   LEFT JOIN watch_variants wv ON wv.id=wi.watch_variant_id
     AND wv.catalog_variant_id=oi.variant_id
   LEFT JOIN watch_products wp ON wp.id=wv.watch_product_id
   LEFT JOIN inventory_reservations ir ON ir.order_item_id=oi.id
   WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id`)
   .bind(orderId).all<Record<string,unknown>>()
 const rows=all.results||[]
 if(!rows.length)return fail('WATCH_ORDER_EMPTY','В заказе нет позиций для отправки.')
 if(rows.some(row=>row.sku_brand!==brandId||
   Number(row.is_workshop)!==0||!['warehouse','boutique'].includes(String(row.source_type))||
   !Number.isSafeInteger(Number(row.quantity))||Number(row.quantity)<1))
   return fail('WATCH_SHIPMENT_UNSUPPORTED','Состав заказа требует уточнения SKU. Отправка остановлена.')
 const explicit=input?.items
 if(explicit!==undefined&&(!Array.isArray(explicit)||explicit.length===0||explicit.length>40))
   return fail('WATCH_DISPATCH_SELECTION_INVALID','Выберите от одной до 40 позиций.',400)
 if(explicit===undefined&&rows.length!==1)
   return fail('WATCH_DISPATCH_SELECTION_REQUIRED','Выберите конкретные часы для отправки.',400)
 const chosen:WatchDispatchSelection[]=explicit===undefined
   ?[{orderItemId:Number(rows[0].id),quantity:Number(rows[0].quantity)}]
   :(explicit as unknown[]).map(x=>({
     orderItemId:Number((x as Record<string,unknown>)?.orderItemId),
     quantity:Number((x as Record<string,unknown>)?.quantity),
   }))
 if(chosen.some(x=>!Number.isSafeInteger(x.orderItemId)||x.orderItemId<1||
   !Number.isSafeInteger(x.quantity)||x.quantity<1)||
   new Set(chosen.map(x=>x.orderItemId)).size!==chosen.length)
   return fail('WATCH_DISPATCH_SELECTION_INVALID','Неверный состав отправки: повторяющиеся или пустые позиции.',400)
 const byId=new Map(rows.map(x=>[Number(x.id),x]))
 if(chosen.some(x=>!byId.has(x.orderItemId)||
   x.quantity>Number(byId.get(x.orderItemId)!.quantity)))
   return fail('WATCH_DISPATCH_QUANTITY_INVALID',
     'Количество отправки не может превышать остаток выбранной позиции.',409)

 // An ambiguous network retry after a successful dispatch must be handled by
 // Main's idempotent operation BEFORE checking the now-fulfilled reservation.
 const prior=await db.prepare('SELECT id,order_id FROM order_dispatches WHERE request_id=?')
   .bind(requestId).first<{id:number;order_id:number}>()
 if(prior&&prior.order_id!==orderId)
   return fail('WATCH_DISPATCH_REQUEST_CONFLICT','Номер операции использован другим заказом.',409)

 const selected=chosen.map(x=>byId.get(x.orderItemId)!)
 if(!prior){
   // Main's SKU-specific stocktake/stock-check checkpoint is mandatory
   // BEFORE any real watch shipment. confirmPhysicalStock is NOT a bypass.
   // A replay of an already committed dispatch is handled by Main above.
   let handover
   try{
     handover=await getOrderStockHandoverState(db,orderId)
   }catch{
     return fail('WATCH_HANDOVER_CHECK_FAILED',
       'Не удалось проверить ревизию для выбранных часов. Отправка остановлена.',409)
   }
   if(!handover)return fail('WATCH_HANDOVER_CHECK_FAILED',
     'История ревизий заказа недоступна. Нельзя подтвердить отправку.',409)
   const picked=new Set(chosen.map(x=>x.orderItemId))
   const requiresReview=handover.items.filter(item=>
     picked.has(item.orderItemId)&&item.reviewNeeded)
   if(requiresReview.length){
     return json({ok:false,code:'WATCH_HANDOVER_REQUIRED',
       message:'После создания заказа проведена ревизия. Сначала уточните фактическую выдачу выбранных часов до проверки.',
       orderId,brandId,reviewCount:requiresReview.length,
       reviewItemIds:requiresReview.map(x=>x.orderItemId)}, {status:409})
   }
   if(selected.some(x=>Number(x.shipped_quantity)>0))
     return fail('WATCH_ALREADY_SHIPPED','Эти часы уже отправлены. Обновите логистику.',409)
   if(selected.some(x=>String(x.engraving_text||'').trim()&&Number(x.engraving_ready)!==1))
     return fail('WATCH_ENGRAVING_NOT_READY',
       'Для отправки сначала подтвердите готовность гравировки выбранных часов.',409)
   const needsPhysicalCheck=selected.some(x=>x.reservation_status!=='active'||
     x.stock_writeoff_status!=='reserved')
   // The user explicitly confirms physical handover in the send review.
   // Unlike the earlier Client3-only recovery gate, do NOT demand a free
   // accounting reserve: Main supports a bounded shipment with verified fact.
   // The shared dispatch engine records the shortage, never invents units.
   if(needsPhysicalCheck&&input.confirmPhysicalStock!==true)
     return fail('WATCH_PHYSICAL_CONFIRM_REQUIRED',
       'Подтвердите, что выбранные часы физически передаются клиенту.',409)
 }

 const localDate=new Date(Date.now()+5*3600*1000).toISOString().slice(0,10)
 try{
   const result=await dispatchSelectedCompleteOrderLines(db,orderId,{
     requestId,items:chosen,actor:'client3-watch:'+actor.id,dispatchDate:localDate,
     watchSplitBrandId:brandId,watchPhysicalConfirmed:input.confirmPhysicalStock===true,
   })
   if(!result?.ok)return fail('WATCH_DISPATCH_FAILED','Склад не подтвердил отправку.')
   return json({...result,orderId,brandId,stockDispatched:true,
     engravingUnchanged:true,selectedItems:chosen.length})
 }catch(cause){
   return fail('WATCH_DISPATCH_BLOCKED',
     cause instanceof Error?cause.message:'Не удалось отправить выбранные часы.')
 }
}
