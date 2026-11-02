import { json } from '../core/http.ts'
import type { AuthUser } from '../core/types.ts'

const bad=(message:string)=>json({ok:false,message},{status:400})
const validDate=(raw:string|null):string|null=>{
  if(!raw)return null
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(raw+'T00:00:00Z')))
    throw new Error('Некорректная дата. Используйте ГГГГ-ММ-ДД.')
  const parsed=new Date(raw+'T00:00:00Z').toISOString().slice(0,10)
  if(parsed!==raw)throw new Error('Некорректная дата.')
  return raw
}

/** Read-only order ledger preview. Brand enforcement is done before this call. */
export async function listClient3WatchOrders(
  db:D1Database,actor:AuthUser,brandId:number,url:URL,
) {
  if(!actor?.id)return json({ok:false,code:'WATCH_AUTH_REQUIRED'},{status:403})
  let from:string|null,through:string|null
  try{
    from=validDate(url.searchParams.get('from'))
    through=validDate(url.searchParams.get('to'))
  }catch(cause){return bad(cause instanceof Error?cause.message:'Некорректная дата.')}
  {
    if(from&&through&&from>through)return bad('Начало периода позже окончания.')
    const q=(url.searchParams.get('q')||'').trim()
    if(q.length>100)return bad('Слишком длинный поисковый запрос.')
    const rawLimit=Number(url.searchParams.get('limit')||50)
    const rawOffset=Number(url.searchParams.get('offset')||0)
    if(!Number.isSafeInteger(rawLimit)||rawLimit<1||rawLimit>100
      ||!Number.isSafeInteger(rawOffset)||rawOffset<0||rawOffset>100000)
      return bad('Некорректная страница заказов.')
    const qLike='%'+q.replace(/[\\%_]/g, s=>'\\'+s)+'%'
    const args=[brandId,from,from,through,through,q?1:0,qLike,qLike,qLike] as const
    const where=`wd.brand_id=? AND o.order_status NOT IN ('archived','deleted')
      AND (? IS NULL OR o.order_date>=?)
      AND (? IS NULL OR o.order_date<=?)
      AND (?=0 OR o.external_id LIKE ? ESCAPE '\\'
        OR wd.recipient_name LIKE ? ESCAPE '\\'
        OR wd.recipient_phone LIKE ? ESCAPE '\\')`
    const rows=await db.prepare(`
      SELECT o.id AS orderId,o.external_id AS externalId,o.order_date AS orderDate,
        o.manager_id AS managerId,o.manager_snapshot_name AS managerName,
        o.source_type AS legacySource,o.shipping_status AS shippingStatus,
        o.order_status AS orderStatus,
        o.total_amount AS totalAmount,o.received_amount AS receivedAmount,
        o.debt_amount AS debtAmount,o.return_amount AS returnAmount,
        wd.recipient_name AS recipientName,wd.recipient_phone AS recipientPhone,
        wd.city,wd.delivery_method AS deliveryMethod,wd.urgent,
        wd.shipping_deadline_at AS shippingDeadlineAt,
        lj.status AS engravingStatus,
        EXISTS (
          SELECT 1 FROM exchanges e JOIN order_items repl ON repl.id=e.new_order_item_id
          WHERE e.order_id=o.id AND COALESCE(e.status,'completed')<>'cancelled'
            AND repl.quantity>0 AND NOT EXISTS (
              SELECT 1 FROM order_dispatch_items di
              JOIN order_dispatches d ON d.id=di.dispatch_id
              WHERE di.order_item_id=repl.id AND di.quantity>di.cancelled_quantity
            )
        ) AS pendingReplacement,
        (SELECT oi.id FROM order_items oi WHERE oi.order_id=o.id AND oi.quantity>0 ORDER BY oi.id DESC LIMIT 1) AS firstItemId,
        (SELECT oi.quantity-COALESCE((SELECT SUM(ri.quantity) FROM return_items ri
          JOIN returns r ON r.id=ri.return_id
          WHERE ri.order_item_id=oi.id AND COALESCE(r.status,'completed')<>'cancelled'),0)
          FROM order_items oi WHERE oi.order_id=o.id AND oi.quantity>0 ORDER BY oi.id DESC LIMIT 1) AS returnableQuantity,
        (SELECT wp.model_name || ' · ' || CASE wv.gender WHEN 'male' THEN 'Мужские' ELSE 'Женские' END ||
          ' · ' || wv.movement || ' · ' || wv.bracelet_material || ' · ' || wv.dial_color ||
          CASE WHEN length(wv.bracelet_color)>0 THEN ' · ' || wv.bracelet_color ELSE '' END
          FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
          JOIN watch_variants wv ON wv.id=wi.watch_variant_id
          JOIN watch_products wp ON wp.id=wv.watch_product_id
          WHERE oi.order_id=o.id AND oi.quantity>0 ORDER BY oi.id DESC LIMIT 1) AS watchDescription,
        (SELECT COUNT(*) FROM watch_order_item_details wi JOIN order_items oi ON oi.id=wi.order_item_id WHERE oi.order_id=o.id AND oi.quantity>0 AND length(trim(wi.engraving_text))>0) AS engravedLines,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id AND oi.quantity>0) AS lineCount
      FROM watch_order_details wd
      JOIN orders o ON o.id=wd.order_id
      LEFT JOIN watch_logistics_jobs lj ON lj.order_id=o.id
      WHERE ${where}
      ORDER BY o.order_date DESC,o.id DESC LIMIT ? OFFSET ?
    `).bind(...args,rawLimit,rawOffset).all()
    const totals=await db.prepare(`
      SELECT COUNT(*) AS orderCount,COALESCE(SUM(o.total_amount),0) AS totalAmount,
        COALESCE(SUM(o.received_amount),0) AS receivedAmount,
        COALESCE(SUM(o.debt_amount),0) AS debtAmount,
        COALESCE(SUM(o.return_amount),0) AS returnAmount
      FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
      WHERE ${where}
    `).bind(...args).first<Record<string,number>>()
    return json({ok:true,brandId,rows:rows.results||[],totals:totals||{
      orderCount:0,totalAmount:0,receivedAmount:0,debtAmount:0,returnAmount:0,
    },hasMore:rawOffset+rawLimit<Number(totals?.orderCount||0)})
  }
}
