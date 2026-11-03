import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

const fail=(message:string)=>json({ok:false,message},{status:400})
const validDate=(x:string)=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  !Number.isNaN(Date.parse(x+'T00:00:00Z'))

/**
 * Main report boundaries with a watch-only server-side brand adapter.
 * Sales follow the order business date; payments/refunds follow the actual
 * financial event date. They are NEVER blended into fictional cash balances.
 * The calling route verifies the actor's brand membership before passing id.
 */
export async function getClient3WatchAnalytics(
 db:D1Database,actor:AuthUser,brandId:number,url:URL,
){
 if(!actor?.id)return json({ok:false,message:'Требуется авторизация.'},{status:403})
 const from=url.searchParams.get('from')||''
 const to=url.searchParams.get('to')||''
 if(!validDate(from)||!validDate(to)||from>to||
   (Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))>86400000*730)
   return fail('Выберите корректный период не более двух лет.')
 const salesFilter=`wd.brand_id=? AND o.order_date>=? AND o.order_date<=?
   AND o.order_status NOT IN ('deleted','archived')`
 const eventFilter='wd.brand_id=? AND f.event_date>=? AND f.event_date<=?'
 const base=[brandId,from,to]
 const [
   overview,daySales,managers,products,cities,methods,eventDays,events,
   sources,debts,customers,logistics,cityMoney,reconciliation,
 ]=await Promise.all([
   db.prepare(`SELECT COUNT(*) AS orderCount,
     COALESCE(SUM(o.total_amount),0) AS totalSales,
     COALESCE(SUM(o.received_amount),0) AS receivedFromOrders,
     COALESCE(SUM(o.debt_amount),0) AS periodDebt,
     COALESCE(SUM(o.return_amount),0) AS returnedOnOrders,
     COALESCE(AVG(o.total_amount),0) AS avgCheck
     FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
     WHERE ${salesFilter}`).bind(...base).first<Record<string,number>>(),
   db.prepare(`SELECT o.order_date AS date,COUNT(*) AS orderCount,
     COALESCE(SUM(o.total_amount),0) AS totalSales,
     COALESCE(SUM(o.received_amount),0) AS receivedFromOrders
     FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
     WHERE ${salesFilter}
     GROUP BY o.order_date ORDER BY o.order_date DESC LIMIT 730`
   ).bind(...base).all(),
   db.prepare(`SELECT COALESCE(NULLIF(TRIM(o.manager_snapshot_name),''),'НЕ УКАЗАН') AS manager,
     COUNT(*) AS orderCount,COALESCE(SUM(o.total_amount),0) AS totalSales,
     COALESCE(SUM(o.received_amount),0) AS receivedFromOrders,
     COALESCE(SUM(o.return_amount),0) AS returnedOnOrders,
     COALESCE(SUM(o.debt_amount),0) AS debt,
     COALESCE(AVG(o.total_amount),0) AS avgCheck
     FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
     WHERE ${salesFilter}
     GROUP BY o.manager_id,o.manager_snapshot_name ORDER BY totalSales DESC LIMIT 250`
   ).bind(...base).all(),
   db.prepare(`SELECT COALESCE(NULLIF(TRIM(p.model_name),''),oi.product_name_snapshot,'НЕ УКАЗАН') AS product,
     COALESCE(SUM(oi.quantity),0) AS quantity,
     COUNT(DISTINCT oi.order_id) AS orderCount,
     COALESCE(SUM(oi.line_total),0) AS revenue,
     CASE WHEN SUM(oi.quantity)>0 THEN
       ROUND(SUM(oi.line_total)*1.0/SUM(oi.quantity),2) ELSE 0 END AS avgUnitPrice
     FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
     JOIN order_items oi ON oi.order_id=o.id AND oi.quantity>0
     LEFT JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
     LEFT JOIN watch_variants v ON v.id=wi.watch_variant_id
     LEFT JOIN watch_products p ON p.id=v.watch_product_id
     WHERE ${salesFilter}
     GROUP BY COALESCE(NULLIF(TRIM(p.model_name),''),oi.product_name_snapshot,'НЕ УКАЗАН')
     ORDER BY quantity DESC,product LIMIT 250`
   ).bind(...base).all(),
   db.prepare(`SELECT COALESCE(NULLIF(TRIM(wd.city),''),'НЕ УКАЗАН') AS city,
     COUNT(*) AS orderCount,COALESCE(SUM(o.total_amount),0) AS totalSales,
     COALESCE(SUM(o.received_amount),0) AS receivedFromOrders,
     COALESCE(SUM(o.debt_amount),0) AS debt,
     COUNT(DISTINCT COALESCE(NULLIF(TRIM(wd.recipient_phone),''),NULLIF(TRIM(wd.recipient_name),''))) AS clients,
     COUNT(DISTINCT o.manager_id) AS managers
     FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
     WHERE ${salesFilter}
     GROUP BY COALESCE(NULLIF(TRIM(wd.city),''),'НЕ УКАЗАН')
     ORDER BY orderCount DESC,city LIMIT 250`
   ).bind(...base).all(),
   db.prepare(`SELECT COALESCE(NULLIF(TRIM(f.payment_method),''),'НЕ УКАЗАН') AS method,
     COALESCE(SUM(CASE WHEN f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS incoming,
     COALESCE(-SUM(CASE WHEN f.amount_delta<0 THEN f.amount_delta ELSE 0 END),0) AS outgoing,
     COALESCE(SUM(f.amount_delta),0) AS net,COUNT(*) AS eventCount
     FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
     WHERE ${eventFilter}
     GROUP BY COALESCE(NULLIF(TRIM(f.payment_method),''),'НЕ УКАЗАН')
     ORDER BY incoming DESC,method LIMIT 100`
   ).bind(...base).all(),
   db.prepare(`SELECT f.event_date AS date,
     COALESCE(SUM(CASE WHEN f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS incoming,
     COALESCE(-SUM(CASE WHEN f.amount_delta<0 THEN f.amount_delta ELSE 0 END),0) AS outgoing,
     COALESCE(SUM(f.amount_delta),0) AS net,COUNT(*) AS eventCount
     FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
     WHERE ${eventFilter} GROUP BY f.event_date ORDER BY date DESC LIMIT 730`
   ).bind(...base).all(),
   db.prepare(`SELECT f.id,f.event_date AS eventDate,f.event_type AS eventType,
     f.amount_delta AS amountDelta,f.payment_method AS paymentMethod,
     f.external_order_id AS externalOrderId,o.manager_snapshot_name AS manager,
     o.order_date AS orderDate,o.created_at AS orderCreatedAt,wd.recipient_name AS customer,
     wd.city,f.comment
     FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
     JOIN orders o ON o.id=wd.order_id
     WHERE ${eventFilter} ORDER BY f.event_date DESC,f.id DESC LIMIT 300`
   ).bind(...base).all(),
   db.prepare(`SELECT o.source_type AS source,COUNT(*) AS orderCount,
     COALESCE(SUM(o.total_amount),0) AS totalSales
     FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
     WHERE ${salesFilter} GROUP BY o.source_type`
   ).bind(...base).all(),
   db.prepare(`SELECT COUNT(*) AS orderCount,COALESCE(SUM(o.debt_amount),0) AS currentDebt
     FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
     WHERE wd.brand_id=? AND o.order_status NOT IN ('deleted','archived')
     AND o.debt_amount>0`).bind(brandId).first<Record<string,number>>(),
   db.prepare(`SELECT COUNT(DISTINCT COALESCE(NULLIF(TRIM(wd.recipient_phone),''),wd.recipient_name)) AS customerCount
     FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
     WHERE ${salesFilter}`).bind(...base).first<Record<string,number>>(),
   db.prepare(`SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN lj.status='ready' THEN 1 ELSE 0 END) AS ready,
       SUM(CASE WHEN lj.status<>'ready' THEN 1 ELSE 0 END) AS engraving,
       SUM(CASE WHEN o.shipping_status<>'sent' AND wd.shipping_deadline_at<datetime('now') THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN o.shipping_status<>'sent' AND wd.urgent=1 THEN 1 ELSE 0 END) AS urgent
     FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
     JOIN watch_logistics_jobs lj ON lj.order_id=o.id
     WHERE wd.brand_id=? AND o.order_status NOT IN ('deleted','archived')
     AND o.shipping_status<>'sent'`).bind(brandId).first<Record<string,number>>(),
   db.prepare(`SELECT COALESCE(NULLIF(TRIM(wd.city),''),'НЕ УКАЗАН') AS city,
     COALESCE(SUM(CASE WHEN f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS incoming
     FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
     WHERE ${eventFilter}
     GROUP BY COALESCE(NULLIF(TRIM(wd.city),''),'НЕ УКАЗАН')`
   ).bind(...base).all(),
   db.prepare(`SELECT COALESCE(NULLIF(TRIM(f.payment_method),''),'НЕ УКАЗАН') AS method,
     COALESCE(SUM(CASE WHEN f.amount_delta>0 AND f.event_type='order_payment'
       THEN f.amount_delta ELSE 0 END),0) AS orderPayments,
     COALESCE(SUM(CASE WHEN f.amount_delta>0 AND f.event_type IN ('debt_close','order_extra')
       THEN f.amount_delta ELSE 0 END),0) AS debtClosures,
     COALESCE(SUM(CASE WHEN f.amount_delta>0 AND f.event_type='exchange_extra'
       THEN f.amount_delta ELSE 0 END),0) AS exchangeExtras,
     COALESCE(SUM(CASE WHEN f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS grossInflow,
     COALESCE(-SUM(CASE WHEN f.amount_delta<0 AND f.event_type IN ('order_refund','exchange_refund')
       THEN f.amount_delta ELSE 0 END),0) AS refunds,
     COALESCE(-SUM(CASE WHEN f.amount_delta<0 AND f.event_type NOT IN ('order_refund','exchange_refund')
       THEN f.amount_delta ELSE 0 END),0) AS otherOutflow,
     COALESCE(SUM(f.amount_delta),0) AS netMovement
     FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
     WHERE ${eventFilter}
     GROUP BY COALESCE(NULLIF(TRIM(f.payment_method),''),'НЕ УКАЗАН')
     ORDER BY grossInflow DESC,method LIMIT 100`
   ).bind(...base).all(),
 ])
 const debtorOrders=await db.prepare(`SELECT o.id,o.external_id AS externalId,
   o.order_date AS orderDate,wd.recipient_name AS customer,wd.city,
   o.manager_snapshot_name AS manager,o.total_amount AS totalSales,
   o.received_amount AS received,o.debt_amount AS debt
   FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
   WHERE wd.brand_id=? AND o.order_status NOT IN ('deleted','archived')
     AND o.debt_amount>0
   ORDER BY o.debt_amount DESC,o.order_date DESC LIMIT 300`
 ).bind(brandId).all()
 const income=await db.prepare(`SELECT
   COALESCE(SUM(CASE WHEN f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS incoming,
   COALESCE(-SUM(CASE WHEN f.amount_delta<0 THEN f.amount_delta ELSE 0 END),0) AS outgoing,
   COALESCE(SUM(f.amount_delta),0) AS net
   FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
   WHERE ${eventFilter}`).bind(...base).first<Record<string,number>>()
 const incomingByCity=new Map((cityMoney.results||[]).map(row=>[
   String(row.city||'НЕ УКАЗАН'),Number(row.incoming||0),
 ]))
 const cityReports=(cities.results||[]).map(row=>({
   ...row,eventReceived:incomingByCity.get(String(row.city||'НЕ УКАЗАН'))||0,
 }))
 return json({ok:true,brandId,from,to,overview:overview||{},
   income:income||{},currentDebt:debts||{},customers:customers||{},
   logistics:logistics||{},
   days:daySales.results||[],managers:managers.results||[],
   products:products.results||[],cities:cityReports,reconciliation:reconciliation.results||[],
   methods:methods.results||[],eventDays:eventDays.results||[],
   events:events.results||[],sources:sources.results||[],
   debtorOrders:debtorOrders.results||[],
   moneyEventCount:(eventDays.results||[]).reduce((n,row)=>n+Number(row.eventCount||0),0),
   accountingBasis:'Main order_date for sales, financial_events.event_date for money',
   cashBalanceIncluded:false})
}
