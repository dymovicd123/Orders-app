import type { WatchBrand, WatchSource, WatchPaymentMethod } from '../../shared/client3/watch-domain.ts'

/** Trusted server-only attachment passed by the isolated Client3 route. */
export type WatchOrderCommit = {
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

export async function persistWatchOrderCommit(
  db: D1Database, orderId: number, orderItemId: number, payload: WatchOrderCommit,
) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !Number.isSafeInteger(orderItemId) || orderItemId <= 0) {
    throw new Error('Не удалось связать часы с созданным заказом.')
  }
  const item = await db.prepare(
    'SELECT id FROM order_items WHERE id=? AND order_id=? AND product_id=? AND variant_id=? AND quantity>0 AND is_workshop=0 LIMIT 1',
  ).bind(orderItemId, orderId, payload.catalogProductId, payload.catalogVariantId).first<{id:number}>()
  if (!item?.id) throw new Error('Сохранённая позиция не совпадает с выбранным SKU часов.')
  const brandSku=await db.prepare(
    'SELECT 1 AS ok FROM watch_variants wv JOIN watch_products wp ON wp.id=wv.watch_product_id WHERE wv.id=? AND wv.catalog_variant_id=? AND wp.catalog_product_id=? AND wp.brand_id=? AND wv.is_active=1 AND wp.is_active=1 LIMIT 1',
  ).bind(payload.watchVariantId,payload.catalogVariantId,payload.catalogProductId,payload.brandId).first<{ok:number}>()
  if (!brandSku?.ok) throw new Error('SKU часов больше не принадлежит указанному бренду.')
  const expectedSource=payload.source==='office'?'warehouse':'boutique'
  const source=await db.prepare(
    'SELECT oi.source_type AS item_source,o.source_type AS order_source FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.id=? AND o.id=? LIMIT 1',
  ).bind(orderItemId,orderId).first<{item_source:string;order_source:string}>()
  if(source?.item_source!==expectedSource || source.order_source!==expectedSource)
    throw new Error('Источник резерва часов не совпадает с источником заказа.')
  const now = new Date().toISOString()
  // All three watch-owned records commit or roll back together. Main core
  // order/reservation/payment creation remains the existing resumable critical operation.
  await db.batch([
    db.prepare(
      "INSERT INTO watch_order_details (order_id,brand_id,recipient_name,recipient_phone,delivery_full_address,postal_code,city,delivery_method,urgent,shipping_deadline_at,deadline_timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'Asia/Almaty',?,?) ON CONFLICT(order_id) DO NOTHING",
    ).bind(orderId,payload.brandId,payload.recipientName,payload.recipientPhone,payload.address,
      payload.postalCode,payload.city,payload.deliveryMethod,payload.urgent?1:0,payload.shippingDeadlineAt,now,now),
    db.prepare(
      'INSERT INTO watch_order_item_details (order_item_id,watch_variant_id,engraving_text,created_at) VALUES (?,?,?,?) ON CONFLICT(order_item_id) DO NOTHING',
    ).bind(orderItemId,payload.watchVariantId,payload.engravingText,now),
    db.prepare(
      "INSERT INTO watch_logistics_jobs(order_id,status,updated_at) VALUES (?,'pending',?) ON CONFLICT(order_id) DO NOTHING",
    ).bind(orderId,now),
  ])
  // Resume must not silently attach a different brand, SKU or engraving.
  const recorded=await db.prepare(
    'SELECT d.brand_id,d.recipient_name,d.recipient_phone,d.delivery_full_address,d.postal_code,d.city,d.delivery_method,d.urgent,d.shipping_deadline_at,w.watch_variant_id,w.engraving_text,l.order_id AS logistics_order_id FROM watch_order_details d JOIN watch_order_item_details w ON w.order_item_id=? JOIN watch_logistics_jobs l ON l.order_id=d.order_id WHERE d.order_id=? LIMIT 1',
  ).bind(orderItemId,orderId).first<Record<string,unknown>>()
  const equals=(key:string,value:unknown)=>String(recorded?.[key]??'')===String(value)
  if(!recorded || !equals('brand_id',payload.brandId)
    || !equals('watch_variant_id',payload.watchVariantId)
    || !equals('recipient_name',payload.recipientName)
    || !equals('recipient_phone',payload.recipientPhone)
    || !equals('delivery_full_address',payload.address)
    || !equals('postal_code',payload.postalCode)
    || !equals('city',payload.city)
    || !equals('delivery_method',payload.deliveryMethod)
    || !equals('urgent',payload.urgent?1:0)
    || !equals('shipping_deadline_at',payload.shippingDeadlineAt)
    || !equals('engraving_text',payload.engravingText)
    || !equals('logistics_order_id',orderId)) {
    throw new Error('Сохранение брендовой части заказа не подтверждено. Повторите запрос с прежним requestId.')
  }
}
