import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

const bad=(code:string,message:string)=>json({ok:false,code,message},{status:400})
/** Money is sourced from immutable financial_events, never recomputed as fictitious cash. */
export async function getClient3WatchFinance(db:D1Database,actor:AuthUser,brandId:number,url:URL) {
  if(!actor?.id)return json({ok:false,code:'WATCH_FINANCE_FORBIDDEN'},{status:403})
  const month=url.searchParams.get('month')||''
  if(month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return bad('WATCH_FINANCE_MONTH_INVALID','Укажите месяц в формате ГГГГ-ММ.')
  const rawLimit=url.searchParams.get('limit')||'80'
  const rawOffset=url.searchParams.get('offset')||'0'
  const limit=Number(rawLimit),offset=Number(rawOffset)
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>100000)
    return bad('WATCH_FINANCE_PAGE_INVALID','Некорректная страница финансов.')
  const dateStart=month?month+'-01':null
  const dateEnd=month?new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10):null
  const filters='wd.brand_id=? AND (? IS NULL OR f.event_date>=?) AND (? IS NULL OR f.event_date<=?)'
  const bind=[brandId,dateStart,dateStart,dateEnd,dateEnd]
  const rows=await db.prepare(`
    SELECT f.id,f.event_date AS eventDate,f.event_type AS eventType,
      f.amount_delta AS amountDelta,f.payment_method AS paymentMethod,
      f.external_order_id AS externalOrderId,f.order_id AS orderId,
      f.reason,f.comment
    FROM financial_events f
    JOIN watch_order_details wd ON wd.order_id=f.order_id
    WHERE ${filters}
    ORDER BY f.event_date DESC,f.id DESC LIMIT ? OFFSET ?
  `).bind(...bind,limit,offset).all<Record<string,unknown>>()
  const totals=await db.prepare(`
    SELECT COUNT(*) AS eventCount,
      COALESCE(SUM(CASE WHEN f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS incoming,
      COALESCE(SUM(CASE WHEN f.amount_delta<0 THEN -f.amount_delta ELSE 0 END),0) AS outgoing,
      COALESCE(SUM(f.amount_delta),0) AS net
    FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
    WHERE ${filters}
  `).bind(...bind).first<Record<string,number>>()
  const methods=await db.prepare(`
    SELECT COALESCE(NULLIF(trim(f.payment_method),''),'НЕ УКАЗАН') AS method,
      COALESCE(SUM(CASE WHEN f.amount_delta>0 THEN f.amount_delta ELSE 0 END),0) AS incoming,
      COALESCE(SUM(CASE WHEN f.amount_delta<0 THEN -f.amount_delta ELSE 0 END),0) AS outgoing,
      COALESCE(SUM(f.amount_delta),0) AS net
    FROM financial_events f JOIN watch_order_details wd ON wd.order_id=f.order_id
    WHERE ${filters}
    GROUP BY COALESCE(NULLIF(trim(f.payment_method),''),'НЕ УКАЗАН')
    ORDER BY incoming DESC,method
  `).bind(...bind).all<Record<string,unknown>>()
  return json({ok:true,brandId,month:month||null,rows:rows.results||[],totals:totals||{
    eventCount:0,incoming:0,outgoing:0,net:0,
  },methods:methods.results||[],hasMore:offset+limit<Number(totals?.eventCount||0),
    accountingBasis:'financial_events',unassignedEventsExcluded:true})
}
