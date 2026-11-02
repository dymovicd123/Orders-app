import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {dispatchSelectedCompleteOrderLines} from './order-dispatch.ts'

const fail=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})

/** Shipping is a separate physical stock action. Engraving 'Готово' is not shipping. */
export async function dispatchClient3WatchOrder(
  db:D1Database,actor:AuthUser,brandId:number,orderId:number,
  input:{requestId?:unknown},
) {
  if(!actor||actor.employeeRole==='Логист'&&actor.role!=='admin')
    return fail('WATCH_SEND_FORBIDDEN','Логист не может отправлять товары со склада.',403)
  if(!Number.isSafeInteger(orderId)||orderId<=0)
    return fail('WATCH_ORDER_INVALID','Выберите заказ.',400)
  const requestId=input?.requestId
  if(typeof requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(requestId))
    return fail('WATCH_REQUEST_INVALID','Необходим идентификатор отправки.',400)
  const order=await db.prepare(
    `SELECT o.id,o.order_status,wd.brand_id,lj.status AS engraving_status
     FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
     JOIN watch_logistics_jobs lj ON lj.order_id=o.id
     WHERE o.id=? AND wd.brand_id=? LIMIT 1`,
  ).bind(orderId,brandId).first<Record<string,unknown>>()
  if(!order)return fail('WATCH_ORDER_NOT_FOUND','Заказ другого бренда или не найден.',404)
  const lines=await db.prepare(
    `SELECT oi.id,oi.quantity,oi.is_workshop,oi.source_type,wi.engraving_text,
       wv.catalog_variant_id,wp.brand_id AS sku_brand
     FROM order_items oi
     JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
     JOIN watch_variants wv ON wv.id=wi.watch_variant_id AND wv.catalog_variant_id=oi.variant_id
     JOIN watch_products wp ON wp.id=wv.watch_product_id
     WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id`,
  ).bind(orderId).all<Record<string,unknown>>()
  const items=lines.results||[]
  // Only one positive-quantity SKU can ship. An exchange retires the original
  // item at quantity=0 while retaining its audit/return history.
  // Don't enable partial dispatch or invisible split lines yet: watch engraving
  // metadata must stay on each exact physical item after a split.
  const allItems=await db.prepare('SELECT COUNT(*) AS total FROM order_items WHERE order_id=? AND quantity>0')
    .bind(orderId).first<{total:number}>()
  if(items.length!==1||Number(allItems?.total)!==1||items[0].sku_brand!==brandId||
    Number(items[0].is_workshop)!==0||!['warehouse','boutique'].includes(String(items[0].source_type))||
    !Number.isSafeInteger(Number(items[0].quantity))||Number(items[0].quantity)<1)
    return fail('WATCH_SHIPMENT_UNSUPPORTED','Для этого заказа нужна проверка состава позиций. Отправка остановлена.')
  if(String(items[0].engraving_text||'').trim()&&order.engraving_status!=='ready')
    return fail('WATCH_ENGRAVING_NOT_READY','Сначала завершите гравировку в логистике.')
  const localDate=new Date(Date.now()+5*3600*1000).toISOString().slice(0,10)
  try{
    const result=await dispatchSelectedCompleteOrderLines(db,orderId,{
      requestId,items:[{orderItemId:Number(items[0].id),quantity:Number(items[0].quantity)}],
      actor:'client3-watch:'+actor.id,dispatchDate:localDate,
    })
    if(!result?.ok)return fail('WATCH_DISPATCH_FAILED','Склад не подтвердил отправку.')
    return json({...result,orderId,brandId,stockDispatched:true,engravingUnchanged:true})
  }catch(cause){
    return fail('WATCH_DISPATCH_BLOCKED',
      cause instanceof Error?cause.message:'Не удалось отправить часы.')
  }
}
