import { json } from '../core/http.ts'
import type { AuthUser } from '../core/types.ts'
import {WATCH_ITEM_SHIPPED_SQL,WATCH_ITEM_RETURNED_SQL,WATCH_ITEM_PENDING_RETURN_RECEIPT_SQL,
  WATCH_ITEM_PENDING_EXCHANGE_RECEIPT_SQL,WATCH_ITEM_RETURNABLE_SQL} from './client3-watch-item-projection.ts'
import {watchCommercialReturnCreditSql,watchNetSaleSql,watchNetDebtSql,
  watchNetPaidSql,watchCustomerOverpaymentSql} from './client3-watch-commercial.ts'

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
    const shipping=url.searchParams.get('shipping')||'all'
    const payment=url.searchParams.get('payment')||'all'
    if(!['all','sent','not_sent'].includes(shipping)||!['all','debt','paid'].includes(payment))
      return bad('Неизвестный фильтр заказов.')
    const q=(url.searchParams.get('q')||'').trim()
    if(q.length>100)return bad('Слишком длинный поисковый запрос.')
    const rawLimit=Number(url.searchParams.get('limit')||50)
    const rawOffset=Number(url.searchParams.get('offset')||0)
    if(!Number.isSafeInteger(rawLimit)||rawLimit<1||rawLimit>100
      ||!Number.isSafeInteger(rawOffset)||rawOffset<0||rawOffset>100000)
      return bad('Некорректная страница заказов.')
    const qLike='%'+q.replace(/[\\%_]/g, s=>'\\'+s)+'%'
    const args=[brandId,from,from,through,through,shipping,shipping,shipping,payment,payment,payment,q?1:0,
      qLike,qLike,qLike,qLike] as const
    // Physical truth outranks an old order-wide shipping marker. A fully
    // issued-before-stocktake order belongs with issued orders; a previously
    // sent order with an unshipped exchange replacement belongs with active ones.
    const noUnissuedItems=`NOT EXISTS (
      SELECT 1 FROM order_items pending
      WHERE pending.order_id=o.id AND pending.quantity>0
        AND COALESCE(pending.stock_writeoff_status,'')<>'fulfilled'
        AND COALESCE((SELECT SUM(MAX(0,di.quantity-COALESCE(di.cancelled_quantity,0)))
          FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
          WHERE di.order_item_id=pending.id AND d.order_id=pending.order_id),0)<pending.quantity
    )`
    const issuedOperationally=`(${noUnissuedItems} AND
      (o.shipping_status='sent' OR EXISTS (
        SELECT 1 FROM order_items issued WHERE issued.order_id=o.id AND issued.quantity>0
      )))`
    const where=`wd.brand_id=? AND o.order_status NOT IN ('archived','deleted')
      AND (? IS NULL OR o.order_date>=?)
      AND (? IS NULL OR o.order_date<=?)
      AND (?='all' OR (?='sent' AND ${issuedOperationally}) OR (?='not_sent' AND NOT ${issuedOperationally}))
      AND (?='all' OR (?='debt' AND ${watchNetDebtSql('o')}>0) OR (?='paid' AND ${watchNetDebtSql('o')}<=0))
      AND (?=0 OR o.external_id LIKE ? ESCAPE '\\'
        OR wd.recipient_name LIKE ? ESCAPE '\\'
        OR wd.recipient_phone LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM order_items oi2
          LEFT JOIN watch_order_item_details wi3 ON wi3.order_item_id=oi2.id
          LEFT JOIN watch_variants v3 ON v3.id=wi3.watch_variant_id
          LEFT JOIN watch_products p3 ON p3.id=v3.watch_product_id
          WHERE oi2.order_id=o.id AND p3.model_name LIKE ? ESCAPE '\\'))`
    const rows=await db.prepare(`
      SELECT o.id AS orderId,o.external_id AS externalId,o.order_date AS orderDate,
        o.manager_id AS managerId,
        COALESCE(NULLIF(TRIM(o.manager_snapshot_name),''),
          (SELECT m.name FROM managers m WHERE m.id=o.manager_id LIMIT 1)) AS managerName,
        o.source_type AS legacySource,o.shipping_status AS shippingStatus,
        o.order_status AS orderStatus,
        o.total_amount AS totalAmount,o.received_amount AS receivedAmount,
        o.debt_amount AS debtAmount,o.return_amount AS returnAmount,
        (SELECT COUNT(*) FROM returns r WHERE r.order_id=o.id
          AND COALESCE(r.status,'completed')<>'cancelled'
          AND NOT EXISTS (SELECT 1 FROM exchanges e
             WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled')
        ) AS committedReturnCount,
        (SELECT COUNT(*) FROM exchanges e WHERE e.order_id=o.id
          AND COALESCE(e.status,'completed')<>'cancelled'
        ) AS committedExchangeCount,
        (SELECT COALESCE(SUM(ri.quantity),0) FROM return_items ri
          JOIN returns r ON r.id=ri.return_id
          WHERE r.order_id=o.id AND COALESCE(r.status,'completed')<>'cancelled'
          AND NOT EXISTS (SELECT 1 FROM exchanges e
             WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled')
        ) AS committedItemReturnQuantity,
        (SELECT r.return_date FROM returns r WHERE r.order_id=o.id
          AND COALESCE(r.status,'completed')<>'cancelled'
          ORDER BY r.id DESC LIMIT 1) AS latestReturnDate,
        (SELECT e.exchange_date FROM exchanges e WHERE e.order_id=o.id
          AND COALESCE(e.status,'completed')<>'cancelled'
          ORDER BY e.id DESC LIMIT 1) AS latestExchangeDate,
        wd.recipient_name AS recipientName,wd.recipient_phone AS recipientPhone,
        wd.city,wd.delivery_method AS deliveryMethod,
        COALESCE(o.customer_name_override,c.display_name,'') AS canonicalCustomerName,
        COALESCE(c.phone_normalized,'') AS canonicalCustomerPhone,
        COALESCE(o.city,'') AS canonicalCity,COALESCE(o.delivery_type,'') AS canonicalDeliveryType,
        COALESCE(o.comment,'') AS orderComment,
        wd.delivery_full_address AS deliveryAddress,wd.postal_code AS postalCode,wd.urgent,
        wd.shipping_deadline_at AS shippingDeadlineAt,
        lj.status AS engravingStatus,
        (SELECT COUNT(DISTINCT oi3.id) FROM order_items oi3
          JOIN order_dispatch_items di3 ON di3.order_item_id=oi3.id
          JOIN order_dispatches d3 ON d3.id=di3.dispatch_id
          WHERE oi3.order_id=o.id AND oi3.quantity>0
            AND di3.quantity>COALESCE(di3.cancelled_quantity,0)) AS shippedLineCount,
        (SELECT COUNT(*) FROM inventory_reservations rr
          WHERE rr.order_id=o.id AND rr.status='unresolved') AS unresolvedReservations,
        -- Main-style expansions: show each real payment and each item, not only
        -- the first item plus an aggregate received amount.
        (SELECT COALESCE(json_group_array(json_object(
          'id',p.id,'method',p.method,'amount',p.amount,
          'date',p.payment_date,'kind',p.payment_kind,'comment',COALESCE(p.comment,'')
        )),'[]') FROM payments p WHERE p.order_id=o.id) AS paymentLines,
        (SELECT COALESCE(json_group_array(json_object(
          'id',oi.id,'watchVariantId',wi2.watch_variant_id,
          'productName',COALESCE(wp2.model_name,oi.product_name_snapshot),
          'quantity',oi.quantity,
          'returnedQuantity',COALESCE((
            SELECT SUM(ri.quantity) FROM return_items ri JOIN returns r ON r.id=ri.return_id
            WHERE ri.order_item_id=oi.id AND COALESCE(r.status,'completed')<>'cancelled'
              AND NOT EXISTS(SELECT 1 FROM exchanges e
                WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled')
          ),0),
          'returnableQuantity',MAX(0,oi.quantity-COALESCE((
             SELECT SUM(ri.quantity) FROM return_items ri JOIN returns r ON r.id=ri.return_id
             WHERE ri.order_item_id=oi.id AND COALESCE(r.status,'completed')<>'cancelled'
              AND NOT EXISTS(SELECT 1 FROM exchanges e
                WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled')
           ),0)),
          'unitPrice',oi.unit_price,
          'lineTotal',oi.line_total,'catalogPriceSnapshot',oi.catalog_price_snapshot,
          'source',oi.source_type,'stockWriteoffStatus',COALESCE(oi.stock_writeoff_status,''),
          'shipped',EXISTS(SELECT 1 FROM order_dispatch_items di2
            JOIN order_dispatches d2 ON d2.id=di2.dispatch_id
            WHERE di2.order_item_id=oi.id AND d2.order_id=o.id
              AND di2.quantity>COALESCE(di2.cancelled_quantity,0)),
          'engravingText',COALESCE(wi2.engraving_text,''),
          'gender',COALESCE(wv2.gender,''),'movement',COALESCE((SELECT a.movement FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=wv2.id),wv2.movement,''),
          'braceletMaterial',COALESCE((SELECT a.bracelet_material FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=wv2.id),wv2.bracelet_material,''),
          'dialColor',COALESCE((SELECT a.dial_color FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=wv2.id),wv2.dial_color,''),
          'braceletColor',COALESCE((SELECT a.bracelet_color FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=wv2.id),wv2.bracelet_color,'')
        )),'[]')
          FROM order_items oi
          LEFT JOIN watch_order_item_details wi2 ON wi2.order_item_id=oi.id
          LEFT JOIN watch_variants wv2 ON wv2.id=wi2.watch_variant_id
          LEFT JOIN watch_products wp2 ON wp2.id=wv2.watch_product_id
          WHERE oi.order_id=o.id AND (
            oi.quantity>0
            OR EXISTS (SELECT 1 FROM return_items ri JOIN returns r ON r.id=ri.return_id
              WHERE ri.order_item_id=oi.id AND COALESCE(r.status,'completed')<>'cancelled')
            OR EXISTS (SELECT 1 FROM exchange_items ei JOIN exchanges e ON e.id=ei.exchange_id
              WHERE ei.order_item_id=oi.id AND ei.role='old'
                AND COALESCE(e.status,'completed')<>'cancelled')
          )) AS itemLines,
        EXISTS (
          SELECT 1 FROM exchange_items ei
          JOIN exchanges e ON e.id=ei.exchange_id AND e.order_id=o.id
          JOIN order_items repl ON repl.id=ei.order_item_id
          WHERE ei.role='new' AND COALESCE(e.status,'completed')<>'cancelled'
            AND repl.quantity>0 AND
            COALESCE(repl.stock_writeoff_status,'')<>'fulfilled'
            AND COALESCE((
              SELECT SUM(MAX(0,di.quantity-COALESCE(di.cancelled_quantity,0)))
              FROM order_dispatch_items di
              JOIN order_dispatches d ON d.id=di.dispatch_id AND d.order_id=o.id
              WHERE di.order_item_id=repl.id
            ),0)<repl.quantity
        ) AS pendingReplacement,
        (SELECT oi.id FROM order_items oi WHERE oi.order_id=o.id AND oi.quantity>0 ORDER BY oi.id DESC LIMIT 1) AS firstItemId,
        (SELECT wi.watch_variant_id FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id WHERE oi.order_id=o.id AND oi.quantity>0 ORDER BY oi.id DESC LIMIT 1) AS activeWatchVariantId,
        (SELECT ${WATCH_ITEM_RETURNABLE_SQL} FROM order_items oi
          WHERE oi.order_id=o.id AND oi.quantity>0 ORDER BY oi.id DESC LIMIT 1) AS returnableQuantity,
        (SELECT wp.model_name || ' · ' || CASE wv.gender WHEN 'male' THEN 'Мужские' ELSE 'Женские' END ||
          ' · ' || COALESCE((SELECT a.movement FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=wv.id),wv.movement) || ' · ' || COALESCE((SELECT a.bracelet_material FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=wv.id),wv.bracelet_material) || ' · ' || COALESCE((SELECT a.dial_color FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=wv.id),wv.dial_color) ||
          CASE WHEN length(COALESCE((SELECT a.bracelet_color FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=wv.id),wv.bracelet_color))>0 THEN ' · ' || COALESCE((SELECT a.bracelet_color FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=wv.id),wv.bracelet_color) ELSE '' END
          FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
          JOIN watch_variants wv ON wv.id=wi.watch_variant_id
          JOIN watch_products wp ON wp.id=wv.watch_product_id
          WHERE oi.order_id=o.id AND oi.quantity>0 ORDER BY oi.id DESC LIMIT 1) AS watchDescription,
        (SELECT COUNT(*) FROM watch_order_item_details wi JOIN order_items oi ON oi.id=wi.order_item_id WHERE oi.order_id=o.id AND oi.quantity>0 AND length(trim(wi.engraving_text))>0) AS engravedLines,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id AND oi.quantity>0) AS lineCount
      FROM watch_order_details wd
      JOIN orders o ON o.id=wd.order_id
      LEFT JOIN customers c ON c.id=o.customer_id
      LEFT JOIN watch_logistics_jobs lj ON lj.order_id=o.id
      WHERE ${where}
      ORDER BY o.order_date DESC,o.id DESC LIMIT ? OFFSET ?
    `).bind(...args,rawLimit,rawOffset).all()
    const totals=await db.prepare(`
      SELECT COUNT(*) AS orderCount,
        COALESCE(SUM(${watchNetSaleSql('o')}),0) AS totalAmount,
        COALESCE(SUM(o.total_amount),0) AS grossTotalAmount,
        COALESCE(SUM(${watchCommercialReturnCreditSql('o')}),0) AS commercialReturnedValue,
        COALESCE(SUM(o.received_amount),0) AS receivedAmount,
        COALESCE(SUM(${watchNetDebtSql('o')}),0) AS debtAmount,
        COALESCE(SUM(o.return_amount),0) AS returnAmount
      FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
      WHERE ${where}
    `).bind(...args).first<Record<string,number>>()
    return json({ok:true,brandId,rows:rows.results||[],totals:totals||{
      orderCount:0,totalAmount:0,receivedAmount:0,debtAmount:0,returnAmount:0,
    },hasMore:rawOffset+rawLimit<Number(totals?.orderCount||0)})
  }
}
