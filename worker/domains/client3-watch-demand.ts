import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

const bad=(message:string)=>json({ok:false,message},{status:400})
const valid=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&
  Number.isFinite(Date.parse(date+'T00:00:00Z'))&&
  new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date

/** Demand is based on sold ITEM prices, not catalog prices or shipped count.
 * Item returns reduce net units; monetary refunds are reported separately.
 * The exact watch variant is the grouping key, not its formatted name.
 */
export async function listClient3WatchDemand(
 db:D1Database,actor:AuthUser,brandId:number,url:URL,
){
 if(!actor?.id)return bad('Войдите в систему.')
 const today=new Date(Date.now()+5*3600*1000).toISOString().slice(0,10)
 const from=url.searchParams.get('from')||today.slice(0,7)+'-01'
 const to=url.searchParams.get('to')||today
 const limit=Number(url.searchParams.get('limit')||100)
 const offset=Number(url.searchParams.get('offset')||0)
 if(!valid(from)||!valid(to)||from>to||!Number.isSafeInteger(limit)||
    limit<1||limit>150||!Number.isSafeInteger(offset)||offset<0||offset>100000)
   return bad('Укажите корректный период и страницу статистики.')
 const ledger=`WITH lines AS (
   SELECT oi.id AS orderItemId,o.id AS orderId,wv.id AS watchVariantId,
     wp.model_name AS modelName,wv.gender,
     COALESCE(va.movement,wv.movement) AS movement,
     COALESCE(va.bracelet_material,wv.bracelet_material) AS braceletMaterial,
     COALESCE(va.dial_color,wv.dial_color) AS dialColor,
     COALESCE(va.bracelet_color,wv.bracelet_color) AS braceletColor,
     oi.quantity AS soldQuantity,oi.unit_price AS unitPrice,
     oi.line_total AS lineRevenue,
     MIN(oi.quantity,COALESCE((
       SELECT SUM(ri.quantity) FROM return_items ri
       JOIN returns r ON r.id=ri.return_id AND COALESCE(r.status,'completed')<>'cancelled'
       WHERE ri.order_item_id=oi.id
     ),0)) AS returnedQuantity
   FROM watch_order_details wd
   JOIN orders o ON o.id=wd.order_id AND o.order_status NOT IN ('deleted','archived')
   JOIN order_items oi ON oi.order_id=o.id AND oi.quantity>0
   JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
   JOIN watch_variants wv ON wv.id=wi.watch_variant_id
   JOIN watch_products wp ON wp.id=wv.watch_product_id AND wp.brand_id=wd.brand_id
   LEFT JOIN watch_variant_attributes_v5 va ON va.watch_variant_id=wv.id
   WHERE wd.brand_id=? AND o.order_date>=? AND o.order_date<=?
 ), grouped AS (
   SELECT watchVariantId,modelName,gender,movement,braceletMaterial,dialColor,braceletColor,
     COUNT(DISTINCT orderId) AS orderCount,
     SUM(soldQuantity) AS soldQuantity,
     SUM(returnedQuantity) AS returnedQuantity,
     SUM(soldQuantity-returnedQuantity) AS netQuantity,
     SUM(lineRevenue) AS revenue,
     ROUND(SUM(lineRevenue)*1.0/NULLIF(SUM(soldQuantity),0),2) AS averagePrice,
     MIN(unitPrice) AS minSalePrice,MAX(unitPrice) AS maxSalePrice
   FROM lines GROUP BY watchVariantId
 )`
 const args=[brandId,from,to]
 const [rows,summary]=await Promise.all([
   db.prepare(`${ledger}
     SELECT * FROM grouped ORDER BY netQuantity DESC,revenue DESC,modelName LIMIT ? OFFSET ?`)
     .bind(...args,limit+1,offset).all<Record<string,unknown>>(),
   db.prepare(`${ledger} SELECT COUNT(*) AS variants,
       COALESCE(SUM(soldQuantity),0) AS soldQuantity,
       COALESCE(SUM(returnedQuantity),0) AS returnedQuantity,
       COALESCE(SUM(netQuantity),0) AS netQuantity,
       COALESCE(SUM(revenue),0) AS revenue
     FROM grouped`).bind(...args).first<Record<string,number>>(),
 ])
 const page=(rows.results||[]).slice(0,limit)
 return json({ok:true,brandId,from,to,rows:page,summary:summary||{},
   hasMore:(rows.results||[]).length>limit,nextOffset:offset+page.length,
   basis:'order_date; itemized actual sale prices; return quantities; no shipping gate'})
}
