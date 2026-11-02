import { json } from '../core/http.ts'
import type { AuthUser, OrderInput } from '../core/types.ts'
import {
  validateWatchOrderInput, type WatchBrand, type WatchOrderInput,
} from '../../shared/client3/watch-domain.ts'
import { createOrder } from './orders-write.ts'
import { isHumanInventoryModelEnabled } from './catalog.ts'
import { OrderInputValidationError } from './order-core.ts'
import { OrderStockShortageError } from './order-reservations.ts'
import type { WatchOrderCommit } from './client3-watch-order-commit.ts'

export type WatchCreateInput = WatchOrderInput & {
  watchVariantId: number
  catalogVariantId?: number
  quantity: number
  unitPrice: number
  receivedAmount?: number
  engravingText: string
  requestId: string
  managerId?: number
}

const fail = (code: string, message: string, status=400) =>
  json({ ok:false, code, message }, {status})

function strictAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Сумма должна быть целым числом тенге от 0.')
  }
  return value
}

export async function createClient3WatchOrder(
  db: D1Database, actor: AuthUser, brandId: number, raw: WatchCreateInput,
): Promise<Response> {
  if (!actor || actor.employeeRole==='Логист' && actor.role!=='admin')
    return fail('WATCH_CREATE_FORBIDDEN','Создание заказов доступно менеджеру или администратору.',403)
  try {
    const input=validateWatchOrderInput(raw)
    if(!await isHumanInventoryModelEnabled(db))
      return fail('WATCH_INVENTORY_NOT_READY','Учёт резервов часов ещё не подготовлен. Создание заказа остановлено.',503)
    if (!Number.isSafeInteger(brandId)||brandId<=0) return fail('WATCH_BRAND_INVALID','Неизвестный бренд')
    if (!Number.isSafeInteger(raw.watchVariantId)||raw.watchVariantId<=0
      || !Number.isSafeInteger(raw.quantity)||raw.quantity<1||raw.quantity>1000)
      return fail('WATCH_ITEM_INVALID','Выберите часы и корректное количество.')
    if (typeof raw.engravingText!=='string'||raw.engravingText.length>500)
      return fail('WATCH_ENGRAVING_INVALID','Текст гравировки должен содержать не более 500 символов.')
    if (typeof raw.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(raw.requestId))
      return fail('WATCH_REQUEST_ID_INVALID','Сохранение требует уникальный requestId.')
    const price=strictAmount(raw.unitPrice)
    const total=raw.quantity*price
    if (!Number.isSafeInteger(total)) return fail('WATCH_TOTAL_INVALID','Сумма заказа слишком велика.')
    const received=strictAmount(raw.receivedAmount ?? 0)
    if (received>total) return fail('WATCH_OVERPAYMENT','Полученная сумма превышает цену заказа.')

    // Never trust client variant IDs, model names, stock figures or brand headers.
    const variant=await db.prepare(
      'SELECT wv.id AS watch_id,wv.catalog_variant_id,wp.catalog_product_id,cp.name AS canonical_name,cv.is_active AS catalog_active,wp.is_active AS product_active,wv.is_active AS variant_active,ep.sale_price AS catalog_price FROM watch_variants wv JOIN watch_products wp ON wp.id=wv.watch_product_id JOIN catalog_products cp ON cp.id=wp.catalog_product_id JOIN catalog_variants cv ON cv.id=wv.catalog_variant_id AND cv.product_id=wp.catalog_product_id LEFT JOIN catalog_execution_prices ep ON ep.stock_position_id=cv.stock_position_id AND ep.category=COALESCE(cv.category,'adult') WHERE wv.id=? AND wp.brand_id=? LIMIT 1',
    ).bind(raw.watchVariantId,brandId).first<Record<string,unknown>>()
    const productId=Number(variant?.catalog_product_id||0)
    const variantId=Number(variant?.catalog_variant_id||0)
    if (!productId||!variantId || Number(variant?.catalog_active)!==1
      || Number(variant?.product_active)!==1 || Number(variant?.variant_active)!==1)
      return fail('WATCH_SKU_UNAVAILABLE','Часы отсутствуют в активном каталоге.',409)
    if (raw.catalogVariantId!==undefined && raw.catalogVariantId!==variantId)
      return fail('WATCH_SKU_STALE','Комплектация часов изменилась. Обновите каталог.',409)
    const source=input.legacySource
    // An uncertain network retry must reach the existing critical operation even
    // if this order's first attempt already consumed the available stock.
    const inFlight=await db.prepare(
      "SELECT context_json FROM critical_operations WHERE request_id=? AND operation_type='order_create' LIMIT 1",
    ).bind(raw.requestId).first<{context_json:string}>()
    const stock=await db.prepare(
      'SELECT COALESCE(SUM(quantity),0) AS physical,COALESCE(SUM(reserved_quantity),0) AS reserved FROM inventory_stock WHERE variant_id=? AND inventory_source=?',
    ).bind(variantId,source).first<{physical:number;reserved:number}>()
    if (!inFlight && Number(stock?.physical||0)-Number(stock?.reserved||0)<raw.quantity)
      return fail('WATCH_STOCK_SHORTAGE','В выбранном источнике недостаточно свободных часов.',409)
    // Manager identity comes from the session (or an explicit admin selection).
    // Admin cannot attribute another manager's brand sales without entitlement.
    const managerId=actor.role==='admin'
      ? (Number(raw.managerId||actor.managerId||0))
      : Number(actor.managerId||0)
    if (!Number.isSafeInteger(managerId)||managerId<=0)
      return fail('WATCH_MANAGER_REQUIRED','Выберите менеджера, которому принадлежит продажа.')
    const assignment=await db.prepare(
      'SELECT 1 AS ok FROM watch_manager_brands mb JOIN managers m ON m.id=mb.manager_id AND m.is_active=1 WHERE mb.manager_id=? AND mb.brand_id=? LIMIT 1',
    ).bind(managerId,brandId).first<{ok:number}>()
    if (!assignment)
      return fail('WATCH_MANAGER_BRAND_FORBIDDEN','Выбранный менеджер не назначен этому бренду.',403)

    // The first accepted critical-operation plan owns the catalogue price
    // snapshot. A retry must never be repriced by a newer live catalogue.
    let priceSnapshot=variant!.catalog_price == null ? null : Number(variant!.catalog_price)
    if(inFlight?.context_json){
      try{
        const saved=JSON.parse(inFlight.context_json) as {
          plan?:{itemizedWritePlan?:{lines?:Array<{catalogPriceSnapshot?:number|null}>}}
        }
        const frozen=saved.plan?.itemizedWritePlan?.lines?.[0]?.catalogPriceSnapshot
        if(frozen===null || (typeof frozen==='number' && Number.isSafeInteger(frozen) && frozen>=0))
          priceSnapshot=frozen
      }catch{ /* Core critical operation will validate the original fingerprint. */ }
    }
    const watch:WatchOrderCommit={
      brand:input.brand as WatchBrand,brandId,watchVariantId:raw.watchVariantId,
      catalogProductId:productId,catalogVariantId:variantId,source:input.source,
      recipientName:input.recipientName,recipientPhone:input.recipientPhone,
      address:input.address,postalCode:input.postalCode,city:input.city,
      deliveryMethod:input.deliveryMethod,shippingDeadlineAt:input.shippingDeadlineAt,
      urgent:input.urgent,paymentMethod:input.paymentMethod,engravingText:raw.engravingText.trim(),
    }
    const order:OrderInput={
      requestId:raw.requestId,
      managerId,customerName:input.recipientName,customerPhone:input.recipientPhone,
      city:input.city,deliveryType:input.deliveryMethod,sourceType:source,
      orderPaymentMethod:input.paymentMethod,
      orderStatus:'active',shippingStatus:'not_sent',workshopStatus:'ready',
      pricingMode:'itemized_v1',
      items:[{
        productName:String(variant!.canonical_name),quantity:raw.quantity,unitPrice:price,
        catalogPriceSnapshot:priceSnapshot,sourceType:source,
        audienceType:'ВЗРОСЛЫЙ',shortageAcknowledged:true,
      }],
      payments:received>0
        ? [{method:input.paymentMethod,amount:received,paymentKind:'primary'}]
        : [],
    }
    // Existing Main critical operation writes money + canonical item + reservations.
    // Its completion is delayed until the brand-owned watch attachment is durable.
    const response=await createOrder(db,order,actor,watch)
    const pendingReservation=(response.stockWriteOff||[]).some(item=>(item as {reservationStatus?:string}).reservationStatus!=='active')
    return json({...response,brand:input.brand,engravingShippingIndependent:true,
      pendingReservation,
      ...(pendingReservation?{warning:'Заказ записан, но резерв товара ожидает проверки. Не отправляйте его до устранения нехватки.'}:{}),
    },{status:201})
  } catch (cause) {
    if (cause instanceof OrderStockShortageError)
      return fail(cause.code,cause.message,409)
    if (cause instanceof OrderInputValidationError)
      return fail(cause.code,cause.message,cause.status)
    // Fail closed, but keep recoverable request IDs for retry.
    const message=cause instanceof Error?cause.message:'Не удалось сохранить заказ часов.'
    if (/^Неверно|^Некорректн|^Заполните|^Укажите|^Срочность|^Сумма/.test(message))
      return fail('WATCH_INPUT_INVALID',message)
    return fail('WATCH_CREATE_RETRY',message,409)
  }
}
