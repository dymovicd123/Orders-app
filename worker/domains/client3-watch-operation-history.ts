import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

/** Read-only, brand-scoped business history. The canonical Main returns/exchange
 * ledgers remain authoritative: no parallel records or watcher-specific truth.
 */
export async function listClient3WatchOperationHistory(
 db:D1Database,actor:AuthUser,brandId:number,url:URL,
):Promise<Response>{
 if(!actor||actor.employeeRole==='Логист'&&actor.role!=='admin')
   return json({ok:false,message:'История доступна менеджеру и администратору.'},{status:403})
 const kind=url.searchParams.get('kind')||'return'
 if(kind!=='return'&&kind!=='exchange')
   return json({ok:false,message:'Выберите возвраты или обмены.'},{status:400})
 const status=url.searchParams.get('status')||'all'
 if(!['all','active','cancelled'].includes(status))
   return json({ok:false,message:'Некорректный фильтр.'},{status:400})
 const limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit'))||30))
 const offset=Math.max(0,Math.min(10000,Number(url.searchParams.get('offset'))||0))
 if(!Number.isSafeInteger(limit)||!Number.isSafeInteger(offset))
   return json({ok:false,message:'Некорректная страница.'},{status:400})
 const isReturn=kind==='return'
 const table=isReturn?'returns':'exchanges'
 const alias=isReturn?'r':'e'
 const dateCol=isReturn?'return_date':'exchange_date'
 const moneyCol=isReturn?'amount':'financial_amount'
 const selectItems=isReturn?`
   COALESCE((SELECT json_group_array(json_object(
    'id',ri.id,'orderItemId',ri.order_item_id,
    'productName',COALESCE(wp.model_name,ri.product_name_snapshot),
    'quantity',ri.quantity,'role','old',
    'gender',COALESCE(wv.gender,''),'movement',COALESCE(wa.movement,wv.movement,''),
    'braceletMaterial',COALESCE(wa.bracelet_material,wv.bracelet_material,''),
    'dialColor',COALESCE(wa.dial_color,wv.dial_color,''),
    'braceletColor',COALESCE(wa.bracelet_color,wv.bracelet_color,''),
    'source',COALESCE(ri.inventory_source,''),
    'physicalTracking',COALESCE(ri.physical_tracking,0),
    'physicalReceivedAt',ri.physical_received_at))
    FROM return_items ri
    LEFT JOIN watch_order_item_details wi ON wi.order_item_id=ri.order_item_id
    LEFT JOIN watch_variants wv ON wv.id=wi.watch_variant_id
    LEFT JOIN watch_variant_attributes_v5 wa ON wa.watch_variant_id=wv.id
    LEFT JOIN watch_products wp ON wp.id=wv.watch_product_id
    WHERE ri.return_id=r.id),'[]') AS itemsJson`
   :`
   COALESCE((SELECT json_group_array(json_object(
    'id',ei.id,'orderItemId',ei.order_item_id,
    'productName',COALESCE(wp.model_name,ei.product_name_snapshot),
    'quantity',ei.quantity,'role',ei.role,
    'gender',COALESCE(wv.gender,''),'movement',COALESCE(wa.movement,wv.movement,''),
    'braceletMaterial',COALESCE(wa.bracelet_material,wv.bracelet_material,''),
    'dialColor',COALESCE(wa.dial_color,wv.dial_color,''),
    'braceletColor',COALESCE(wa.bracelet_color,wv.bracelet_color,''),
    'source',COALESCE(ei.inventory_source,''),
    'physicalTracking',COALESCE(ei.physical_tracking,0),
    'physicalReceivedAt',ei.physical_received_at,
    'stockWriteoffStatus',COALESCE(oi.stock_writeoff_status,'')))
    FROM exchange_items ei
    LEFT JOIN order_items oi ON oi.id=ei.order_item_id
    LEFT JOIN watch_order_item_details wi ON wi.order_item_id=ei.order_item_id
    LEFT JOIN watch_variants wv ON wv.id=wi.watch_variant_id
    LEFT JOIN watch_variant_attributes_v5 wa ON wa.watch_variant_id=wv.id
    LEFT JOIN watch_products wp ON wp.id=wv.watch_product_id
    WHERE ei.exchange_id=e.id),'[]') AS itemsJson`
 const mode=`(?='all' OR (?='cancelled' AND COALESCE(${alias}.status,'completed')='cancelled')
   OR (?='active' AND COALESCE(${alias}.status,'completed')<>'cancelled'))`
 const [data,total]=await Promise.all([
   db.prepare(`SELECT ${alias}.id,${alias}.order_id AS orderId,
     o.external_id AS externalOrderId,o.order_date AS orderDate,
     ${alias}.${dateCol} AS operationDate,
     COALESCE(${alias}.status,'completed') AS status,
     COALESCE(${alias}.${moneyCol},0) AS amount,
     COALESCE(${alias}.payment_method,'') AS paymentMethod,
     COALESCE(${alias}.comment,'') AS comment,
     ${isReturn?"'refund'":"COALESCE(e.financial_action,'none')"} AS financialAction,
     COALESCE(m.name,o.manager_snapshot_name,'') AS manager,
     ${selectItems}
     FROM ${table} ${alias}
     JOIN watch_order_details wd ON wd.order_id=${alias}.order_id AND wd.brand_id=?
     JOIN orders o ON o.id=${alias}.order_id
     LEFT JOIN managers m ON m.id=${alias}.manager_id
     WHERE ${mode}
     ORDER BY ${alias}.${dateCol} DESC,${alias}.id DESC
     LIMIT ? OFFSET ?`)
     .bind(brandId,status,status,status,limit+1,offset).all<Record<string,unknown>>(),
   db.prepare(`SELECT COUNT(*) AS total,
     SUM(CASE WHEN COALESCE(${alias}.status,'completed')='cancelled' THEN 1 ELSE 0 END) AS cancelled,
     COALESCE(SUM(CASE WHEN COALESCE(${alias}.status,'completed')<>'cancelled'
       THEN ${alias}.${moneyCol} ELSE 0 END),0) AS money
     FROM ${table} ${alias}
     JOIN watch_order_details wd ON wd.order_id=${alias}.order_id AND wd.brand_id=?
     WHERE ${mode}`)
     .bind(brandId,status,status,status).first<{total:number;cancelled:number;money:number}>(),
 ])
 const rows=data.results||[]
 return json({ok:true,kind,brandId,rows:rows.slice(0,limit),
   total:Number(total?.total||0),cancelled:Number(total?.cancelled||0),
   money:Number(total?.money||0),hasMore:rows.length>limit})
}
