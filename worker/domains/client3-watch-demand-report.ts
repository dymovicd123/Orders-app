import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {watchReturnedUnitsForItemSql,watchReturnedValueForItemSql} from './client3-watch-commercial.ts'

const error=(message:string,status=400)=>json({ok:false,message},{status})
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&
 Number.isFinite(Date.parse(value+'T00:00:00Z'))&&
 new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value

/** Main's warehouse demand report, adapted to Client3 watches.
 * "orders" dates are order dates; "shipped" counts only actual
 * non-cancelled dispatch quantities on dispatch dates, not order status.
 * Never aggregate across brand IDs or count merchandise returned by Exchange
 * as an independent sale return. Money is a price-of-items valuation, not cash.
 * This endpoint is strictly read-only and does not require migrations.
 */
export async function listClient3WatchDemandReport(
 db:D1Database,actor:AuthUser,brandId:number,url:URL,
):Promise<Response>{
 if(!actor?.id)return error('Войдите в систему.',401)
 if(!Number.isSafeInteger(brandId)||brandId<1)return error('Укажите бренд.')
 const today=new Date(Date.now()+5*3600*1000).toISOString().slice(0,10)
 const from=url.searchParams.get('start')||today.slice(0,7)+'-01'
 const to=url.searchParams.get('end')||today
 const scope=url.searchParams.get('scope')||'orders'
 const mode=url.searchParams.get('mode')||'ranking'
 if(!validDate(from)||!validDate(to)||from>to)
   return error('Проверьте даты статистики.')
 if(!['orders','shipped'].includes(scope)||!['ranking','orders'].includes(mode))
   return error('Выберите способ расчёта статистики.')
 const offset=Number(url.searchParams.get('offset')||0)
 const variantId=Number(url.searchParams.get('variantId')||0)
 if(mode==='orders'&&(!Number.isSafeInteger(variantId)||variantId<1||
   !Number.isSafeInteger(offset)||offset<0||offset>100000))
   return error('Неверная комплектация или страница детализации.')

 // A real dispatch is a specific stock movement against a specific order
 // item. A fully cancelled dispatch contributes zero, including old dates.
 const dispatchedWithinPeriod=`COALESCE((
   SELECT SUM(MAX(0,di.quantity-COALESCE(di.cancelled_quantity,0)))
   FROM order_dispatch_items di
   JOIN order_dispatches d ON d.id=di.dispatch_id AND d.order_id=o.id
   WHERE di.order_item_id=oi.id AND d.dispatch_date>=? AND d.dispatch_date<=?
 ),0)`
 const dispatchedAll=`COALESCE((
   SELECT SUM(MAX(0,di.quantity-COALESCE(di.cancelled_quantity,0)))
   FROM order_dispatch_items di
   JOIN order_dispatches d ON d.id=di.dispatch_id AND d.order_id=o.id
   WHERE di.order_item_id=oi.id
 ),0)`
 const lastDispatch=`(SELECT MAX(d.dispatch_date)
   FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
   WHERE di.order_item_id=oi.id AND d.order_id=o.id
     AND di.quantity>COALESCE(di.cancelled_quantity,0))`
 const isShipped=scope==='shipped'
 const args=isShipped?[from,to,brandId]:[brandId,from,to]
 const query=`WITH raw AS (
   SELECT oi.id AS itemId,o.id AS orderId,o.external_id AS externalId,
     o.order_date AS orderDate,o.total_amount AS orderTotal,
     wv.id AS variantId,wp.model_name AS model,
     wv.gender AS gender,
     COALESCE(va.movement,wv.movement) AS movement,
     COALESCE(va.bracelet_material,wv.bracelet_material) AS bracelet,
     COALESCE(va.dial_color,wv.dial_color) AS dialColor,
     COALESCE(va.bracelet_color,wv.bracelet_color,'') AS braceletColor,
     oi.quantity AS orderedQuantity,
     COALESCE(oi.unit_price,0) AS unitPrice,
     ${watchReturnedUnitsForItemSql('oi')} AS returnedAll,
     ${watchReturnedValueForItemSql('oi')} AS returnedValue,
     ${dispatchedAll} AS sentAll,
     ${lastDispatch} AS shippedAt,
     ${isShipped?dispatchedWithinPeriod:'oi.quantity'} AS selectedQty
   FROM watch_order_details wd
   JOIN orders o ON o.id=wd.order_id
       AND o.order_status NOT IN ('deleted','archived')
   JOIN order_items oi ON oi.order_id=o.id AND oi.quantity>0
   JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
   JOIN watch_variants wv ON wv.id=wi.watch_variant_id
   JOIN watch_products wp ON wp.id=wv.watch_product_id
       AND wp.brand_id=wd.brand_id
   LEFT JOIN watch_variant_attributes_v5 va ON va.watch_variant_id=wv.id
   WHERE wd.brand_id=? ${isShipped?'':'AND o.order_date>=? AND o.order_date<=?'}
 ), selected AS (
   SELECT *,
     MIN(orderedQuantity,MAX(0,selectedQty)) AS sold,
     MIN(MIN(orderedQuantity,MAX(0,selectedQty)),MAX(0,returnedAll)) AS returned
   FROM raw
 ), normalized AS (
   SELECT *,MAX(0,sold-returned) AS net,
     MAX(0,sold*unitPrice-MIN(sold*unitPrice,MAX(0,returnedValue))) AS amount
   FROM selected WHERE sold>0
 )`
 try{
   if(mode==='orders'){
     const details=await db.prepare(`${query}
       SELECT itemId,orderId,externalId,orderDate,shippedAt,orderTotal,
         sold,returned,net,unitPrice,amount,sentAll
       FROM normalized WHERE variantId=?
       ORDER BY CASE WHEN ?='shipped' THEN shippedAt ELSE orderDate END DESC,itemId DESC
       LIMIT 51 OFFSET ?`).bind(...args,variantId,scope,offset)
       .all<Record<string,unknown>>()
     const raw=details.results||[]
     return json({ok:true,brandId,scope,from,to,orders:raw.slice(0,50),
       hasMore:raw.length>50,nextOffset:offset+Math.min(50,raw.length)})
   }
   const [grouped,totals]=await Promise.all([
     db.prepare(`${query}
       SELECT variantId,model,gender,movement,bracelet,dialColor,braceletColor,
         COUNT(DISTINCT orderId) AS orderCount,
         SUM(sold) AS sold,SUM(returned) AS returned,SUM(net) AS net,
         SUM(amount) AS amount,SUM(net) AS pricedQuantity,
         MIN(unitPrice) AS minPrice,MAX(unitPrice) AS maxPrice
       FROM normalized GROUP BY variantId
       ORDER BY net DESC,sold DESC,model COLLATE NOCASE,variantId
       LIMIT 2001`).bind(...args).all<Record<string,unknown>>(),
     db.prepare(`${query} SELECT COUNT(DISTINCT orderId) AS orderCount,
       COALESCE(SUM(sold),0) AS sold,COALESCE(SUM(returned),0) AS returned,
       COALESCE(SUM(net),0) AS net,COALESCE(SUM(amount),0) AS amount,
       COUNT(DISTINCT variantId) AS variants
       FROM normalized`).bind(...args).first<Record<string,number>>(),
   ])
   const result=grouped.results||[]
   return json({ok:true,brandId,scope,from,to,
     rows:result.slice(0,2000),truncated:result.length>2000,
     totals:totals||{orderCount:0,sold:0,returned:0,net:0,amount:0,variants:0},
     basis:isShipped?'actual_non_cancelled_dispatch_by_date':'active_order_items_by_order_date',
     moneyBasis:'net_item_sale_value_after_non_exchange_physical_returns'})
 }catch(cause){
   return error(cause instanceof Error?cause.message:
     'Не удалось рассчитать подробную статистику часов.',409)
 }
}
