import type {WatchBrand} from '../../shared/client3/watch-domain.ts'
/** Trusted (never client-owned) metadata for an exact SKU exchange replacement. */
export type WatchExchangeCommit={
  brand:WatchBrand
  brandId:number
  oldOrderItemId:number
  watchVariantId:number
  catalogProductId:number
  catalogVariantId:number
  source:'warehouse'|'boutique'
  engravingText:string
}
export async function persistWatchExchangeItem(
 db:D1Database,orderId:number,newItemId:number,exchangeId:number,details:WatchExchangeCommit,
){
 if(!Number.isSafeInteger(newItemId)||newItemId<=0||!Number.isSafeInteger(exchangeId)||exchangeId<=0)
   throw new Error('Новая позиция обмена не была надёжно сохранена.')
 const exact=await db.prepare(`
   SELECT oi.id FROM order_items oi
   JOIN orders o ON o.id=oi.order_id
   JOIN watch_order_details wd ON wd.order_id=o.id AND wd.brand_id=?
   JOIN watch_variants v ON v.id=? AND v.catalog_variant_id=oi.variant_id
   JOIN watch_products wp ON wp.id=v.watch_product_id AND wp.brand_id=wd.brand_id
      AND wp.catalog_product_id=oi.product_id
   JOIN exchanges ex ON ex.id=? AND ex.order_id=o.id AND ex.new_order_item_id=oi.id
   WHERE oi.id=? AND oi.order_id=? AND oi.quantity=1
     AND oi.is_workshop=0 AND oi.source_type=?
     AND v.id=? AND wp.catalog_product_id=? AND v.catalog_variant_id=?
     AND ex.old_order_item_id=? LIMIT 1`
 ).bind(details.brandId,details.watchVariantId,exchangeId,newItemId,orderId,
   details.source,details.watchVariantId,details.catalogProductId,
   details.catalogVariantId,details.oldOrderItemId).first<{id:number}>()
 if(!exact)throw new Error('Новая позиция обмена не соответствует бренду, источнику или выбранным часам.')
 const saved=await db.prepare('SELECT watch_variant_id,engraving_text FROM watch_order_item_details WHERE order_item_id=?')
   .bind(newItemId).first<{watch_variant_id:number;engraving_text:string}>()
 if(saved&&(saved.watch_variant_id!==details.watchVariantId||saved.engraving_text!==details.engravingText))
   throw new Error('Для новой позиции уже сохранена другая комплектация или гравировка.')
 const inserted=!saved
 const now=new Date().toISOString()
 const key='watch-exchange:'+exchangeId+':engraving-queued'
 await db.batch([
   db.prepare('INSERT INTO watch_order_item_details(order_item_id,watch_variant_id,engraving_text,created_at) VALUES(?,?,?,?) ON CONFLICT(order_item_id) DO NOTHING')
     .bind(newItemId,details.watchVariantId,details.engravingText,now),
   // A queue reset is permanent audit history and must be idempotent across critical retries.
   // If old engraving was ready, new text MUST NOT inherit that ready state.
   db.prepare(`UPDATE watch_logistics_jobs SET status='pending',ready_at=NULL,
       ready_by_user_id=NULL,ready_request_id=NULL,updated_at=?
     WHERE order_id=? AND ?<>'' AND status='ready'
       AND NOT EXISTS(SELECT 1 FROM watch_logistics_events WHERE request_id=?)`)
     .bind(now,orderId,details.engravingText,key),
   db.prepare(`INSERT INTO watch_logistics_events(order_id,previous_status,next_status,note,request_id,created_at)
     SELECT ?, 'ready','pending','Новая гравировка после обмена',?,?
     WHERE ?<>'' AND NOT EXISTS(SELECT 1 FROM watch_logistics_events WHERE request_id=?)
       AND EXISTS(SELECT 1 FROM watch_logistics_jobs
         WHERE order_id=? AND status='pending' AND ready_at IS NULL)`)
     .bind(orderId,key,now,details.engravingText,key,orderId),
 ])
 const confirmed=await db.prepare('SELECT watch_variant_id,engraving_text FROM watch_order_item_details WHERE order_item_id=?')
   .bind(newItemId).first<{watch_variant_id:number;engraving_text:string}>()
 if(!confirmed||confirmed.watch_variant_id!==details.watchVariantId||confirmed.engraving_text!==details.engravingText)
   throw new Error('Гравировка новой позиции обмена не подтверждена. Повторите прежний requestId.')
 if(details.engravingText){
   const job=await db.prepare('SELECT status FROM watch_logistics_jobs WHERE order_id=?')
     .bind(orderId).first<{status:string}>()
   if(job?.status!=='pending'&&inserted)
     throw new Error('Не удалось поставить новую гравировку в очередь логистики.')
 }
}
