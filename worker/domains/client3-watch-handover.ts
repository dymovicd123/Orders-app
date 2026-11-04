import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {
  activeStocktakeSessionForHandover,
  confirmItemStillHere,
  getOrderStockHandoverState,
  reconcileIssuedBeforeCheckpoint,
} from './order-reservations.ts'

type Clarification={
  action?:unknown;orderItemId?:unknown;checkpointId?:unknown;checkpointAt?:unknown
}
const fail=(message:string,status=409,code='WATCH_HANDOVER_INVALID')=>
  json({ok:false,code,message},{status})

/** The Main predicate intentionally limits reviewNeeded to active reservations.
 * A watch may have unresolved stock while still being dated before a later
 * revision. That must NEVER become a way to ship without checking its origin.
 * Use the same extended predicate in both the GET form and shipment POST. */
export const watchCheckpointNeedsClarification=(item:{
 checkpointId:number|null;checkpointAt:string|null;
 reviewedCheckpointId:number|null;reviewedCheckpointAt:string|null;
 reviewNeeded:boolean;state:string
})=>Boolean(
 item.reviewNeeded || (
   item.state!=='already_issued' && item.checkpointId &&
   item.checkpointAt && (
     item.reviewedCheckpointId!==item.checkpointId ||
     item.reviewedCheckpointAt!==item.checkpointAt
   )
 )
)

/** Client3 adaptation of Main stock-handover review, never a second shipment.
 * Order, line, SKU and brand must ALL agree before Main's checkpoint CAS runs.
 */
async function snapshot(db:D1Database,brandId:number,orderId:number){
  if(!Number.isSafeInteger(orderId)||orderId<1)return null
  const own=await db.prepare(`SELECT o.id,o.order_status,o.shipping_status
    FROM orders o JOIN watch_order_details wd ON wd.order_id=o.id
    WHERE o.id=? AND wd.brand_id=? LIMIT 1`)
    .bind(orderId,brandId).first<{id:number;order_status:string;shipping_status:string}>()
  if(!own)return null
  const original=await getOrderStockHandoverState(db,orderId)
  if(!original)return null
  const state={...original,items:original.items.map(item=>({
    ...item,reviewNeeded:watchCheckpointNeedsClarification(item),
  }))}
  const lines=await db.prepare(`SELECT oi.id AS orderItemId
    FROM order_items oi
    JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
    JOIN watch_variants wv ON wv.id=wi.watch_variant_id AND wv.catalog_variant_id=oi.variant_id
    JOIN watch_products wp ON wp.id=wv.watch_product_id AND wp.brand_id=?
    WHERE oi.order_id=? AND oi.quantity>0 AND oi.is_workshop=0`)
    .bind(brandId,orderId).all<{orderItemId:number}>()
  const valid=new Set((lines.results||[]).map(x=>Number(x.orderItemId)))
  if(state.items.some(x=>!valid.has(x.orderItemId)))
    throw Error('Состав заказа не совпадает с активными комплектациями выбранного бренда. Нужна проверка администратора.')
  return {own,state}
}
export async function readClient3WatchHandover(
  db:D1Database,actor:AuthUser,brandId:number,orderId:number,
){
  if(!actor?.id)return fail('Сначала войдите в систему.',403)
  try{
    const row=await snapshot(db,brandId,orderId)
    if(!row)return fail('Заказ не найден в выбранном бренде.',404)
    return json({ok:true,state:row.state,
      reviewCount:row.state.items.filter(x=>x.reviewNeeded).length})
  }catch(e){return fail(e instanceof Error?e.message:'Не удалось загрузить уточнение выдачи.')}
}
export async function clarifyClient3WatchHandover(
  db:D1Database,actor:AuthUser,brandId:number,orderId:number,input:Clarification,
){
  if(!actor?.id||actor.employeeRole==='Завсклад'&&actor.role!=='admin')
    return fail('Уточнять фактическую выдачу вправе сотрудник, отвечающий за заказ или отправку.',403)
  const action=input.action
  if(action!=='issued_before_checkpoint'&&action!=='still_here')
    return fail('Укажите, выдали ли часы до ревизии или они оставались на месте.',400)
  const itemId=Number(input.orderItemId),checkpointId=Number(input.checkpointId)
  if(!Number.isSafeInteger(itemId)||itemId<1||!Number.isSafeInteger(checkpointId)||!checkpointId||
    typeof input.checkpointAt!=='string'||!input.checkpointAt.trim())
    return fail('Выберите позицию и дату последней ревизии.',400)
  try{
    const row=await snapshot(db,brandId,orderId)
    if(!row)return fail('Заказ не найден в выбранном бренде.',404)
    if(row.own.order_status==='archived'||row.own.order_status==='deleted')
      return fail('Архивный или удалённый заказ менять нельзя.')
    if(row.own.shipping_status==='sent'||row.own.shipping_status==='Отправлено')
      return fail('Этот заказ уже отмечен отправленным. Повторная выдача запрещена.')
    const item=row.state.items.find(x=>x.orderItemId===itemId)
    if(!item||!item.reviewNeeded||!item.reservationId)
      return fail('Позиция не требует уточнения или её резерв уже изменился. Обновите данные.')
    if(item.reservationStatus!=='active')
      return fail('Сейчас резерв этих часов не подтверждён. До решения о выдаче сначала восстановите резерв по фактическому остатку на складе. Отправка заблокирована.',409,'WATCH_HANDOVER_RESERVATION_REQUIRED')
    if(item.checkpointId!==checkpointId||item.checkpointAt!==input.checkpointAt)
      return fail('Ревизия обновилась. Повторите уточнение по актуальной проверке.')
    const existingDispatch=await db.prepare(`SELECT 1 AS shipped FROM order_dispatch_items di
      JOIN order_dispatches d ON d.id=di.dispatch_id
      WHERE di.order_item_id=? AND d.order_id=?
        AND di.quantity>COALESCE(di.cancelled_quantity,0) LIMIT 1`)
      .bind(itemId,orderId).first<{shipped:number}>()
    if(existingDispatch)return fail('Эти часы уже отправлены. Уточнение не должно повторять отправку.')
    if(await activeStocktakeSessionForHandover(db,item.source))
      return fail('В этой точке продолжается ревизия. Уточнение возможно после завершения проверки.')
    const actorTag='client3-watch:'+actor.id+':'+actor.login
    if(action==='issued_before_checkpoint')
      await reconcileIssuedBeforeCheckpoint(
        db,orderId,row.state.externalId,item,checkpointId,input.checkpointAt,actorTag)
    else
      await confirmItemStillHere(
        db,orderId,row.state.externalId,item,checkpointId,input.checkpointAt,actorTag)
    const fresh=await getOrderStockHandoverState(db,orderId)
    const updated=fresh?{...fresh,items:fresh.items.map(x=>({
      ...x,reviewNeeded:watchCheckpointNeedsClarification(x),
    }))}:null
    return json({ok:true,decision:action,state:updated,
      message:action==='issued_before_checkpoint'
        ?'Подтверждена выдача до ревизии. Резерв закрыт; физический остаток повторно не списан.'
        :'Подтверждено, что часы были на месте при ревизии. Резерв и физический остаток не изменены.'})
  }catch(e){
    return fail(e instanceof Error?e.message:'Уточнение не сохранено. Обновите заказ.')
  }
}
