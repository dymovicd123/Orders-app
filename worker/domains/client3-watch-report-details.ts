import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

const bad=(message:string)=>json({ok:false,message},{status:400})
const validDate=(value:string)=>{
 if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(value))return false
 const time=Date.parse(value+'T00:00:00Z')
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value
}
const salesBase=`wd.brand_id=? AND o.order_status NOT IN ('deleted','archived')`
const cityExpr="COALESCE(NULLIF(TRIM(wd.city),''),'НЕ УКАЗАН')"
const modelExpr="COALESCE(NULLIF(TRIM(wp.model_name),''),NULLIF(TRIM(oi.product_name_snapshot),''),'НЕ УКАЗАН')"

/** Client3 Main CityOrdersExplorer read adapter. Brand is authorized BEFORE
 * calling this function; city, dates and pagination do not override scope. */
export async function listClient3WatchReportCityOrders(
 db:D1Database,actor:AuthUser,brandId:number,url:URL,
){
 if(!actor?.id)return json({ok:false,message:'Необходима авторизация.'},{status:403})
 const city=(url.searchParams.get('city')||'').trim()
 const startDate=url.searchParams.get('startDate')||''
 const endDate=url.searchParams.get('endDate')||''
 const limit=Number(url.searchParams.get('limit')||25)
 const offset=Number(url.searchParams.get('offset')||0)
 if(!city||city.length>100||!validDate(startDate)||!validDate(endDate)||
    startDate>endDate||!Number.isSafeInteger(limit)||limit<1||limit>50||
    !Number.isSafeInteger(offset)||offset<0||offset>100000)
   return bad('Некорректный запрос детализации по городу.')
 const args=[brandId,startDate,endDate,city]
 const where=`${salesBase} AND o.order_date>=? AND o.order_date<=?
   AND ${cityExpr}=?`
 const [result,count]=await Promise.all([
  db.prepare(`SELECT o.id AS id,o.external_id AS externalId,
     o.order_date AS orderDate,wd.recipient_name AS customer,
     COALESCE(NULLIF(TRIM(o.manager_snapshot_name),''),'НЕ УКАЗАН') AS manager,
     o.total_amount AS totalAmount,o.received_amount AS receivedAmount,
     o.debt_amount AS debtAmount,o.shipping_status AS shippingStatus,
     o.order_status AS orderStatus
     FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
     WHERE ${where} ORDER BY o.order_date DESC,o.id DESC LIMIT ? OFFSET ?`)
     .bind(...args,limit,offset).all(),
  db.prepare(`SELECT COUNT(*) AS count FROM watch_order_details wd
      JOIN orders o ON o.id=wd.order_id WHERE ${where}`)
      .bind(...args).first<{count:number}>(),
 ])
 return json({ok:true,city,orders:result.results||[],
   hasMore:offset+(result.results?.length||0)<Number(count?.count||0),
   total:Number(count?.count||0)})
}

/** Drilldowns: one selected day → manager, city, model. This avoids incomplete
 * 300-row client-side grouping and keeps the exact Main business-date semantics. */
export async function getClient3WatchReportDayDetails(
 db:D1Database,actor:AuthUser,brandId:number,url:URL,
){
 if(!actor?.id)return json({ok:false,message:'Необходима авторизация.'},{status:403})
 const date=url.searchParams.get('date')||''
 if(!validDate(date))return bad('Укажите корректную дату.')
 const base=[brandId,date]
 const where=`${salesBase} AND o.order_date=?`
 const [managers,cities,products,summary]=await Promise.all([
  db.prepare(`SELECT COALESCE(NULLIF(TRIM(o.manager_snapshot_name),''),'НЕ УКАЗАН') AS manager,
    COUNT(*) AS orderCount,COALESCE(SUM(o.total_amount),0) AS totalSales,
    COALESCE(SUM(o.received_amount),0) AS receivedOnOrders,
    COALESCE(SUM(o.debt_amount),0) AS debt
    FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
    WHERE ${where}
    GROUP BY o.manager_id,o.manager_snapshot_name ORDER BY totalSales DESC,manager LIMIT 400`)
    .bind(...base).all(),
  db.prepare(`SELECT ${cityExpr} AS city,
    COUNT(*) AS orderCount,COALESCE(SUM(o.total_amount),0) AS totalSales,
    COALESCE(SUM(o.debt_amount),0) AS debt
    FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
    WHERE ${where}
    GROUP BY ${cityExpr} ORDER BY orderCount DESC,city LIMIT 400`)
    .bind(...base).all(),
  db.prepare(`SELECT ${modelExpr} AS product,COALESCE(SUM(oi.quantity),0) AS quantity,
    COUNT(DISTINCT o.id) AS orderCount,COALESCE(SUM(oi.line_total),0) AS revenue
    FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
    JOIN order_items oi ON oi.order_id=o.id AND oi.quantity>0
    LEFT JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
    LEFT JOIN watch_variants v ON v.id=wi.watch_variant_id
    LEFT JOIN watch_products wp ON wp.id=v.watch_product_id
    WHERE ${where}
    GROUP BY ${modelExpr} ORDER BY quantity DESC,product LIMIT 400`)
    .bind(...base).all(),
  db.prepare(`SELECT COUNT(*) AS orderCount,
    COALESCE(SUM(o.total_amount),0) AS totalSales,
    COALESCE(SUM(o.received_amount),0) AS receivedOnOrders
    FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
    WHERE ${where}`).bind(...base).first<Record<string,number>>(),
 ])
 return json({ok:true,date,managers:managers.results||[],cities:cities.results||[],
   products:products.results||[],summary:summary||{}})
}
