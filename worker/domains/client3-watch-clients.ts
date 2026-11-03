import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

const bad=(message:string)=>json({ok:false,message},{status:400})
// Exact brand-scoped customer list. Unknown phones are never merged into one
// fictitious customer. Main customer normalization is preferred when available.
const phoneKey=`COALESCE(NULLIF(TRIM(c.phone_normalized),''),
  NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    COALESCE(wd.recipient_phone,''),' ',''),'-',''),'(',''),')',''),'+',''),''),
  'order:'||CAST(o.id AS TEXT))`
const scoped=`FROM watch_order_details wd
  JOIN orders o ON o.id=wd.order_id
  LEFT JOIN customers c ON c.id=o.customer_id
  WHERE wd.brand_id=? AND o.order_status NOT IN ('deleted','archived')`
const limits=(url:URL)=>{
 const limit=Number(url.searchParams.get('limit')||'50')
 const offset=Number(url.searchParams.get('offset')||'0')
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||
    !Number.isSafeInteger(offset)||offset<0||offset>100000)
   throw new Error('Некорректная страница клиентов.')
 return {limit,offset}
}
export async function listClient3WatchClients(
 db:D1Database,actor:AuthUser,brandId:number,url:URL,
){
 if(!actor?.id)return bad('Требуется вход в систему.')
 let limit:number,offset:number
 try{({limit,offset}=limits(url))}catch(e){return bad((e as Error).message)}
 const q=(url.searchParams.get('q')||'').trim()
 if(q.length>100)return bad('Слишком длинный поисковый запрос.')
 const mode=url.searchParams.get('mode')||'all'
 if(!['all','repeat','debt'].includes(mode))return bad('Некорректный фильтр клиентов.')
 const like='%'+q.replace(/[\\%_]/g,s=>'\\'+s)+'%'
 const base=`WITH scoped AS (
   SELECT ${phoneKey} AS phoneKey,o.id AS orderId,o.external_id AS externalId,
     o.order_date AS orderDate,wd.recipient_name AS recipientName,
     wd.recipient_phone AS recipientPhone,wd.city,
     o.total_amount AS totalAmount,o.received_amount AS receivedAmount,
     o.return_amount AS returnAmount,o.debt_amount AS debtAmount,
     o.shipping_status AS shippingStatus
   ${scoped}
 ), clients AS (
   SELECT phoneKey,MAX(recipientName) AS name,MAX(recipientPhone) AS phone,
     MAX(city) AS city,MAX(orderDate) AS lastDate,COUNT(*) AS orderCount,
     COALESCE(SUM(totalAmount),0) AS sales,
     COALESCE(SUM(receivedAmount),0) AS received,
     COALESCE(SUM(returnAmount),0) AS returned,
     COALESCE(SUM(debtAmount),0) AS debt
   FROM scoped GROUP BY phoneKey
 )`
 const where=`(?='' OR phoneKey LIKE ? ESCAPE '\\'
   OR name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')`
 const modeWhere=mode==='repeat'?' AND orderCount>=2':mode==='debt'?' AND debt>0':''
 const args=[brandId,q,like,like,like,like]
 const [rows,total,summary]=await Promise.all([
  db.prepare(`${base}
    SELECT * FROM clients WHERE ${where}${modeWhere}
    ORDER BY lastDate DESC,phoneKey LIMIT ? OFFSET ?`)
    .bind(...args,limit,offset).all<Record<string,unknown>>(),
  db.prepare(`${base}
    SELECT COUNT(*) AS count FROM clients WHERE ${where}${modeWhere}`)
    .bind(...args).first<{count:number}>(),
  db.prepare(`${base}
    SELECT COUNT(*) AS totalClients,
      COALESCE(SUM(CASE WHEN orderCount>=2 THEN 1 ELSE 0 END),0) AS repeatClients,
      COALESCE(SUM(CASE WHEN debt>0 THEN 1 ELSE 0 END),0) AS debtClients,
      COALESCE(SUM(debt),0) AS totalDebt
    FROM clients`).bind(brandId).first<Record<string,number>>(),
 ])
 return json({ok:true,brandId,rows:rows.results||[],total:Number(total?.count||0),
   summary:summary||{totalClients:0,repeatClients:0,debtClients:0,totalDebt:0},
   hasMore:offset+limit<Number(total?.count||0)})
}
export async function listClient3WatchCustomerOrders(
 db:D1Database,actor:AuthUser,brandId:number,url:URL,
){
 if(!actor?.id)return bad('Требуется вход в систему.')
 const phone=url.searchParams.get('phoneKey')||''
 if(!phone||phone.length>160)return bad('Выберите клиента.')
 let limit:number,offset:number
 try{({limit,offset}=limits(url))}catch(e){return bad((e as Error).message)}
 const base=`WITH scoped AS (
   SELECT ${phoneKey} AS phoneKey,o.id AS orderId,o.external_id AS externalId,
      o.order_date AS orderDate,wd.recipient_name AS recipientName,
      wd.recipient_phone AS recipientPhone,wd.city,
      o.total_amount AS totalAmount,o.received_amount AS receivedAmount,
      o.return_amount AS returnAmount,o.debt_amount AS debtAmount,
      o.shipping_status AS shippingStatus
   ${scoped}
 )`
 const [rows,total]=await Promise.all([
   db.prepare(`${base} SELECT * FROM scoped WHERE phoneKey=?
     ORDER BY orderDate DESC,orderId DESC LIMIT ? OFFSET ?`)
     .bind(brandId,phone,limit,offset).all<Record<string,unknown>>(),
   db.prepare(`${base} SELECT COUNT(*) AS count FROM scoped WHERE phoneKey=?`)
     .bind(brandId,phone).first<{count:number}>(),
 ])
 return json({ok:true,brandId,phoneKey:phone,rows:rows.results||[],
   total:Number(total?.count||0),hasMore:offset+limit<Number(total?.count||0)})
}
