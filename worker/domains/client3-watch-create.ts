import {json} from '../core/http.ts'
import type {AuthUser,OrderInput} from '../core/types.ts'
import {
 validateWatchOrderInput,type WatchBrand,type WatchOrderInput,type WatchSource,
 type WatchPaymentMethod,
} from '../../shared/client3/watch-domain.ts'
import {createOrder} from './orders-write.ts'
import {isHumanInventoryModelEnabled} from './catalog.ts'
import {OrderInputValidationError} from './order-core.ts'
import {OrderStockShortageError} from './order-reservations.ts'
import type {WatchCommitLine,WatchOrderCommit} from './client3-watch-order-commit.ts'
import {ensureManualWatchOrderSku,type ManualWatchOrderItem} from './client3-watch-order-manual.ts'
import {findUnavailableWatchStockSelections} from './client3-watch-order-availability.ts'

export type WatchCreateItem={
 watchVariantId:number;catalogVariantId?:number;orderMode?:'stock'|'preorder'|'manual';quantity:number;unitPrice:number;
 source:WatchSource;engravingText:string;manual?:ManualWatchOrderItem
}
export type WatchCreateInput=WatchOrderInput&{
 items?:WatchCreateItem[]
 watchVariantId?:number;catalogVariantId?:number;quantity?:number;unitPrice?:number;
 receivedAmount?:number;payments?:Array<{method:WatchPaymentMethod;amount:number;paymentDate?:string}>
 engravingText?:string;requestId:string;managerId?:number;orderDate?:string
}
const fail=(code:string,message:string,status=400)=>json({ok:false,code,message},{status})
const amount=(v:unknown,label:string):number=>{
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>1_000_000_000)
   throw new Error(label+' должна быть целым числом от 0.')
 return v
}
export async function createClient3WatchOrder(
 db:D1Database,actor:AuthUser,brandId:number,raw:WatchCreateInput,
):Promise<Response>{
 if(!actor || actor.employeeRole==='Логист'&&actor.role!=='admin')
   return fail('WATCH_CREATE_FORBIDDEN','Создание заказов доступно менеджеру или администратору.',403)
 try{
   const input=validateWatchOrderInput(raw)
   // Main accepts a distinct order_date for later-entered historical sales.
   // Validate it strictly here, rather than permitting arbitrary JS Date parsing.
   const today=new Date(Date.now()+5*3600*1000).toISOString().slice(0,10)
   let orderDate=today
   if(raw.orderDate!==undefined){
     if(typeof raw.orderDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw.orderDate)||
       raw.orderDate<'2020-01-01'||raw.orderDate>today||
       !Number.isFinite(Date.parse(raw.orderDate+'T00:00:00Z'))||
       new Date(raw.orderDate+'T00:00:00Z').toISOString().slice(0,10)!==raw.orderDate)
       return fail('WATCH_ORDER_DATE_INVALID','Укажите фактическую дату заказа не позже сегодняшнего дня.')
     orderDate=raw.orderDate
   }
   if(!await isHumanInventoryModelEnabled(db))
     return fail('WATCH_INVENTORY_NOT_READY','Складской учёт ещё не подготовлен.',503)
   if(!Number.isSafeInteger(brandId)||brandId<1)
     return fail('WATCH_BRAND_INVALID','Выберите бренд.')
   if(typeof raw.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(raw.requestId))
     return fail('WATCH_REQUEST_ID_INVALID','Некорректный идентификатор сохранения.')

   // Verify employee-brand entitlement BEFORE registering any free-entry reference
   // or SKU. Main's initial order path uses the same active manager ownership.
   const managerId=actor.role==='admin'?Number(raw.managerId||actor.managerId||0):Number(actor.managerId||0)
   if(!Number.isSafeInteger(managerId)||managerId<1)
     return fail('WATCH_MANAGER_REQUIRED','Выберите менеджера.')
   const assignment=await db.prepare(`SELECT 1 AS ok FROM watch_manager_brands mb
     JOIN managers m ON m.id=mb.manager_id AND m.is_active=1
     WHERE mb.manager_id=? AND mb.brand_id=? LIMIT 1`)
     .bind(managerId,brandId).first<{ok:number}>()
   if(!assignment)return fail('WATCH_MANAGER_BRAND_FORBIDDEN',
     'Менеджер не назначен выбранному бренду.',403)

   const requested:WatchCreateItem[]=raw.items===undefined?[{
     watchVariantId:raw.watchVariantId??0,catalogVariantId:raw.catalogVariantId,
     quantity:raw.quantity??0,unitPrice:raw.unitPrice??NaN,source:raw.source,
     engravingText:raw.engravingText??'',
   }]:raw.items
   if(!Array.isArray(requested)||!requested.length||requested.length>20)
     return fail('WATCH_ITEMS_INVALID','Укажите от 1 до 20 позиций часов.')
   const allowedSources=new Set(['office','showcase'])
   const checked:{line:WatchCommitLine;quantity:number;price:number;catalogPriceSnapshot:number|null;canonicalName:string;orderMode:'stock'|'preorder'|'manual'}[]=[]
   const inFlight=await db.prepare(
     "SELECT context_json FROM critical_operations WHERE request_id=? AND operation_type='order_create' LIMIT 1",
   ).bind(raw.requestId).first<{context_json:string}>()
   let frozenPrices:Array<number|null|undefined>=[]
   if(inFlight?.context_json)try{
     const context=JSON.parse(inFlight.context_json) as {
       plan?:{itemizedWritePlan?:{lines?:Array<{catalogPriceSnapshot?:number|null}>}}
     }
     frozenPrices=context.plan?.itemizedWritePlan?.lines?.map(x=>x.catalogPriceSnapshot)||[]
   }catch{ /* Core validates the original request fingerprint. */ }

   for(const [index,item] of requested.entries()){
     if(!item||(!item.manual&&(!Number.isSafeInteger(item.watchVariantId)||item.watchVariantId<1))||
       !Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>1000||
       !allowedSources.has(item.source))
       return fail('WATCH_ITEM_INVALID','Позиция '+(index+1)+': выберите комплектацию, источник и количество.')
     if(item.orderMode!==undefined&&!['stock','preorder','manual'].includes(item.orderMode))
       return fail('WATCH_ORDER_MODE_INVALID','Неизвестный способ выбора товара.')
     if(item.orderMode==='stock'&&item.manual)
       return fail('WATCH_ORDER_MODE_INVALID','Часы из наличия должны ссылаться на конкретную комплектацию.',400)
     if(item.orderMode==='manual'&&!item.manual)
       return fail('WATCH_ORDER_MODE_INVALID','Для ручного ввода укажите характеристики.',400)
     if(typeof item.engravingText!=='string'||item.engravingText.length>500)
       return fail('WATCH_ENGRAVING_INVALID','Позиция '+(index+1)+': текст гравировки не более 500 символов.')
     const price=amount(item.unitPrice,'Цена позиции '+(index+1))
     const selected=item.manual
       ?await ensureManualWatchOrderSku(db,actor,brandId,item.manual)
       :{watchVariantId:item.watchVariantId,catalogVariantId:item.catalogVariantId}
     const row=await db.prepare(`SELECT wv.id AS watch_id,wv.catalog_variant_id,
       wp.catalog_product_id,cp.name AS canonical_name,
       cv.is_active AS catalog_active,wp.is_active AS product_active,
       wv.is_active AS variant_active,ep.sale_price AS catalog_price
       FROM watch_variants wv
       JOIN watch_products wp ON wp.id=wv.watch_product_id
       JOIN catalog_products cp ON cp.id=wp.catalog_product_id
       JOIN catalog_variants cv ON cv.id=wv.catalog_variant_id AND cv.product_id=wp.catalog_product_id
       LEFT JOIN catalog_execution_prices ep ON ep.stock_position_id=cv.stock_position_id
         AND ep.category=COALESCE(cv.category,'adult')
       WHERE wv.id=? AND wp.brand_id=? LIMIT 1`)
       .bind(selected.watchVariantId,brandId).first<Record<string,unknown>>()
     const productId=Number(row?.catalog_product_id||0),variantId=Number(row?.catalog_variant_id||0)
     if(!productId||!variantId||Number(row?.catalog_active)!==1||
       Number(row?.product_active)!==1||Number(row?.variant_active)!==1)
       return fail('WATCH_SKU_UNAVAILABLE','Позиция '+(index+1)+': комплектация отсутствует в активном каталоге.',409)
     if(selected.catalogVariantId!==undefined&&selected.catalogVariantId!==variantId)
       return fail('WATCH_SKU_STALE','Позиция '+(index+1)+': SKU изменился. Обновите каталог.',409)
     const frozen=frozenPrices[index]
     const priceSnapshot=frozen===null||(typeof frozen==='number'&&Number.isSafeInteger(frozen)&&frozen>=0)
       ?frozen:row!.catalog_price==null?null:Number(row!.catalog_price)
     checked.push({
       line:{watchVariantId:selected.watchVariantId,catalogProductId:productId,
         catalogVariantId:variantId,source:item.source,engravingText:item.engravingText.trim()},
       quantity:item.quantity,price,catalogPriceSnapshot:priceSnapshot,
       canonicalName:String(row!.canonical_name),orderMode:item.orderMode||'manual',
     })
   }
   // A known in-stock SKU is not silently converted to an unreserved order.
   // This read-only check is deliberately before the Main critical write.
   // Idempotent retries may already have reserved stock: let Main replay them.
   if(!inFlight){
     const shortages=await findUnavailableWatchStockSelections(db,checked
       .filter(x=>x.orderMode==='stock')
       .map(x=>({source:x.line.source,variantId:x.line.catalogVariantId,quantity:x.quantity})))
     if(shortages.length){
       const first=shortages[0]
       return fail('WATCH_STOCK_CHANGED',
         'Доступное количество изменилось: '+(first.source==='office'?'офис':'витрина')+
         ', осталось '+first.available+' шт., запрошено '+first.requested+
         '. Обновите выбор или явно оформите позицию под заказ.',409)
     }
   }
   const total=checked.reduce((sum,item)=>sum+item.quantity*item.price,0)
   if(!Number.isSafeInteger(total)||total>1_000_000_000_000)
     return fail('WATCH_TOTAL_INVALID','Сумма заказа слишком велика.')
   const entries=raw.payments===undefined
     ?(amount(raw.receivedAmount??0,'Оплата')>0
       ?[{method:input.paymentMethod,amount:amount(raw.receivedAmount,'Оплата')}]:[])
     :raw.payments
   if(!Array.isArray(entries)||entries.length>8)
     return fail('WATCH_PAYMENTS_INVALID','Можно указать до восьми оплат.')
   const configured=await db.prepare(
     "SELECT value FROM watch_reference_values WHERE kind='paymentMethods' AND is_active=1",
   ).all<{value:string}>()
   const methods=new Set((configured.results||[]).map(x=>x.value))
   if(!methods.has(input.paymentMethod))
     return fail('WATCH_PAYMENT_METHOD_INVALID','Способ оплаты отсутствует в справочнике.')
   let received=0
   for(const [index,row] of entries.entries()){
     if(!row||!methods.has(row.method)||typeof row.amount!=='number'||
       !Number.isSafeInteger(row.amount)||row.amount<=0)
       return fail('WATCH_PAYMENT_INVALID','Укажите способ и положительную сумму каждой оплаты.')
     const date=row.paymentDate===undefined?orderDate:row.paymentDate
     if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
       date<'2020-01-01'||date>today||
       !Number.isFinite(Date.parse(date+'T00:00:00Z'))||
       new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)
       return fail('WATCH_PAYMENT_DATE_INVALID','Проверьте дату оплаты.')
     if(index===0&&date!==orderDate)
       return fail('WATCH_PRIMARY_PAYMENT_DATE_MISMATCH',
         'Первая оплата должна иметь дату заказа. Обновите дату оплаты.',400)
     received+=row.amount
     if(!Number.isSafeInteger(received))return fail('WATCH_PAYMENT_INVALID','Сумма оплат слишком велика.')
   }
   if(raw.receivedAmount!==undefined&&amount(raw.receivedAmount,'Оплаты')!==received)
     return fail('WATCH_PAYMENT_TOTAL_MISMATCH','Полученная сумма не совпадает с оплатами.')
   if(entries.length&&input.paymentMethod!==entries[0].method)
     return fail('WATCH_PAYMENT_METHOD_MISMATCH','Основной способ оплаты должен совпадать с первой оплатой.')
   if(received>total)return fail('WATCH_OVERPAYMENT','Получено больше суммы заказа.')

   const first=checked[0].line
   const watch:WatchOrderCommit={
     brand:input.brand as WatchBrand,brandId,watchVariantId:first.watchVariantId,
     catalogProductId:first.catalogProductId,catalogVariantId:first.catalogVariantId,
     source:first.source,items:checked.map(x=>x.line),
     recipientName:input.recipientName,recipientPhone:input.recipientPhone,
     address:input.address,postalCode:input.postalCode,city:input.city,
     deliveryMethod:input.deliveryMethod,shippingDeadlineAt:input.shippingDeadlineAt,
     urgent:input.urgent,paymentMethod:input.paymentMethod,engravingText:first.engravingText,
   }
   const sourceType=first.source==='office'?'warehouse':'boutique'
   const order:OrderInput={
     requestId:raw.requestId,managerId,orderDate,
     customerName:input.recipientName,customerPhone:input.recipientPhone,
     city:input.city,deliveryType:input.deliveryMethod,sourceType,
     orderPaymentMethod:input.paymentMethod,orderStatus:'active',
     shippingStatus:'not_sent',workshopStatus:'ready',pricingMode:'itemized_v1',
     items:checked.map(x=>({
       productName:x.canonicalName,quantity:x.quantity,unitPrice:x.price,
       catalogPriceSnapshot:x.catalogPriceSnapshot,
       sourceType:x.line.source==='office'?'warehouse':'boutique',
       audienceType:'ВЗРОСЛЫЙ',shortageAcknowledged:true,
     })),
     payments:entries.map((row,index)=>({method:row.method,amount:row.amount,
       paymentDate:row.paymentDate===undefined?orderDate:row.paymentDate,
       paymentKind:index===0?'primary' as const:'extra' as const})),
   }
   // Main's critical operation owns all reserves, money and canonical order items.
   const result=await createOrder(db,order,actor,watch)
   if(!result||typeof result!=='object'||!('ok' in result)||result.ok!==true)
     throw new Error('Нет подтверждения сохранения. Повторите тот же запрос.')
   const response=result as {ok:true;stockWriteOff?:Array<{reservationStatus?:string}>;[key:string]:unknown}
   const pending=(response.stockWriteOff||[]).some(x=>x.reservationStatus!=='active')
   return json({...response,brand:input.brand,engravingShippingIndependent:true,
     pendingReservation:pending,
     ...(pending?{warning:'Заказ принят. Часть товаров отсутствует или ожидает резервирования; логистике необходимо проверить наличие перед отправкой.'}:{}),
   },{status:201})
 }catch(cause){
   if(cause instanceof OrderStockShortageError)return fail(cause.code,cause.message,409)
   if(cause instanceof OrderInputValidationError)return fail(cause.code,cause.message,cause.status)
   const message=cause instanceof Error?cause.message:'Не удалось сохранить заказ.'
   if(/^(Неверно|Некорректн|Заполните|Укажите|Срочность|Сумма|Цена)/.test(message))
     return fail('WATCH_INPUT_INVALID',message)
   return fail('WATCH_CREATE_RETRY',message,409)
 }
}
