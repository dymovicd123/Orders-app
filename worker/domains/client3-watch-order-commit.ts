import type { WatchBrand, WatchSource, WatchPaymentMethod } from '../../shared/client3/watch-domain.ts'

/** Trusted server-only attachment passed by the isolated Client3 route. */
export type WatchCommitLine={watchVariantId:number;catalogProductId:number;catalogVariantId:number;source:WatchSource;engravingText:string}
export type WatchOrderCommit = {
  items?:WatchCommitLine[]
  brand: WatchBrand
  brandId: number
  watchVariantId: number
  catalogProductId: number
  catalogVariantId: number
  source: WatchSource
  recipientName: string
  recipientPhone: string
  address: string
  postalCode: string
  city: string
  deliveryMethod: string
  shippingDeadlineAt: string
  urgent: boolean
  paymentMethod: WatchPaymentMethod
  engravingText: string
}


/** Main creates the canonical positions and all reserves/payment entries first.
 * This adapter binds each order_item to its exact brand SKU id and engraving,
 * atomically and retry-safely, without replacing Main stock logic.
 */
export async function persistWatchOrderCommit(
 db:D1Database,orderId:number,orderItemIds:number|number[],payload:WatchOrderCommit,
){
 const ids=Array.isArray(orderItemIds)?orderItemIds:[orderItemIds]
 const lines=payload.items?.length?payload.items:[{
   watchVariantId:payload.watchVariantId,catalogProductId:payload.catalogProductId,
   catalogVariantId:payload.catalogVariantId,source:payload.source,engravingText:payload.engravingText,
 }]
 if(!Number.isSafeInteger(orderId)||orderId<1||ids.length!==lines.length||!ids.length||
   ids.some(id=>!Number.isSafeInteger(id)||id<1))
   throw new Error('Не удалось связать все позиции часов с заказом.')
 for(let i=0;i<lines.length;i++){
   const row=lines[i],itemId=ids[i]
   const item=await db.prepare(`SELECT id,source_type FROM order_items
     WHERE id=? AND order_id=? AND product_id=? AND variant_id=? AND quantity>0 AND is_workshop=0 LIMIT 1`)
     .bind(itemId,orderId,row.catalogProductId,row.catalogVariantId)
     .first<{id:number;source_type:string}>()
   if(!item?.id||item.source_type!==(row.source==='office'?'warehouse':'boutique'))
     throw new Error('Сохранённая позиция или её источник не совпадают с выбранными часами.')
   const brandSku=await db.prepare(`SELECT 1 AS ok FROM watch_variants wv
     JOIN watch_products wp ON wp.id=wv.watch_product_id
     WHERE wv.id=? AND wv.catalog_variant_id=? AND wp.catalog_product_id=?
       AND wp.brand_id=? AND wv.is_active=1 AND wp.is_active=1 LIMIT 1`)
     .bind(row.watchVariantId,row.catalogVariantId,row.catalogProductId,payload.brandId)
     .first<{ok:number}>()
   if(!brandSku?.ok)throw new Error('Часы больше не принадлежат выбранному бренду.')
 }
 const now=new Date().toISOString()
 const batch=[
   db.prepare(`INSERT INTO watch_order_details(
     order_id,brand_id,recipient_name,recipient_phone,delivery_full_address,postal_code,
     city,delivery_method,urgent,shipping_deadline_at,deadline_timezone,created_at,updated_at
   ) VALUES(?,?,?,?,?,?,?,?,?,?,'Asia/Almaty',?,?)
     ON CONFLICT(order_id) DO NOTHING`)
     .bind(orderId,payload.brandId,payload.recipientName,payload.recipientPhone,
       payload.address,payload.postalCode,payload.city,payload.deliveryMethod,
       payload.urgent?1:0,payload.shippingDeadlineAt,now,now),
   ...lines.map((line,index)=>db.prepare(`INSERT INTO watch_order_item_details(
     order_item_id,watch_variant_id,engraving_text,created_at
   ) VALUES(?,?,?,?) ON CONFLICT(order_item_id) DO NOTHING`)
     .bind(ids[index],line.watchVariantId,line.engravingText,now)),
   db.prepare(`INSERT INTO watch_logistics_jobs(order_id,status,updated_at)
     VALUES(?,'pending',?) ON CONFLICT(order_id) DO NOTHING`).bind(orderId,now),
 ]
 await db.batch(batch)
 const recorded=await db.prepare(`SELECT brand_id,recipient_name,recipient_phone,
   delivery_full_address,postal_code,city,delivery_method,urgent,shipping_deadline_at
   FROM watch_order_details WHERE order_id=?`).bind(orderId).first<Record<string,unknown>>()
 const eq=(key:string,value:unknown)=>String(recorded?.[key]??'')===String(value)
 if(!recorded||!eq('brand_id',payload.brandId)||!eq('recipient_name',payload.recipientName)||
   !eq('recipient_phone',payload.recipientPhone)||!eq('delivery_full_address',payload.address)||
   !eq('postal_code',payload.postalCode)||!eq('city',payload.city)||
   !eq('delivery_method',payload.deliveryMethod)||!eq('urgent',payload.urgent?1:0)||
   !eq('shipping_deadline_at',payload.shippingDeadlineAt))
   throw new Error('Брендовая часть заказа не совпадает с сохранённой. Повторите тот же requestId.')
 for(let i=0;i<lines.length;i++){
   const existing=await db.prepare(`SELECT watch_variant_id,engraving_text
     FROM watch_order_item_details WHERE order_item_id=?`).bind(ids[i])
     .first<{watch_variant_id:number;engraving_text:string}>()
   if(!existing||existing.watch_variant_id!==lines[i].watchVariantId||
     existing.engraving_text!==lines[i].engravingText)
     throw new Error('Состав часов или текст гравировки изменился. Повторите запрос с прежним requestId.')
 }
 const logistic=await db.prepare('SELECT order_id FROM watch_logistics_jobs WHERE order_id=?')
   .bind(orderId).first<{order_id:number}>()
 if(!logistic?.order_id)throw new Error('Не удалось подтвердить очередь логистики.')
}
