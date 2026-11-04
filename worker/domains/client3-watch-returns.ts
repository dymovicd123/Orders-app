import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {createReturn,receiveReturnedItem} from './returns-exchanges.ts'

const fail=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
type ReturnInput={
  requestId?:unknown;kind?:unknown;quantity?:unknown;amount?:unknown;
  items?:unknown;paymentMethod?:unknown;refundParts?:unknown;reason?:unknown
}
const keyValid=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9._:-]{8,128}$/.test(value)
const dateAlmaty=()=>new Date(Date.now()+5*3600*1000).toISOString().slice(0,10)

/** Main multi-line exact watch returns. The Main financial engine accepts
  * paymentParts (not the client-facing refundParts). Never silently discard
  * split refund amounts and payment methods. */
export async function createClient3WatchReturn(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,input:ReturnInput,
) {
 if(!actor||actor.employeeRole==='Логист'&&actor.role!=='admin')
   return fail('WATCH_RETURN_FORBIDDEN','Возвраты оформляет менеджер или администратор.',403)
 if(!Number.isSafeInteger(orderId)||orderId<1||!keyValid(input.requestId))
   return fail('WATCH_RETURN_INVALID','Нужен заказ и уникальный идентификатор возврата.',400)
 if(!['money_only','items_only','both'].includes(String(input.kind)))
   return fail('WATCH_RETURN_KIND_REQUIRED','Выберите возврат денег, товара или обоих.',400)
 const kind=String(input.kind)
 const itemSelected=kind!=='money_only'
 const quantity=Number(input.quantity||0)
 const amount=Number(input.amount||0)
 const reason=typeof input.reason==='string'?input.reason.trim():''
 if(!reason||reason.length>300)return fail('WATCH_RETURN_REASON_REQUIRED','Укажите причину возврата.',400)
 if(!Number.isSafeInteger(amount)||amount<0||amount>1000000000 ||
   (itemSelected&&!Array.isArray(input.items)&&
     (!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)) ||
   (!itemSelected&&quantity!==0) || (kind==='items_only'&&amount!==0) ||
   (kind!=='items_only'&&amount<=0))
   return fail('WATCH_RETURN_QUANTITY_INVALID','Исправьте количество и сумму возврата.',400)
 const refunds=Array.isArray(input.refundParts)?input.refundParts as Array<{method?:unknown;amount?:unknown}>:[]
 if(refunds.length>3||refunds.some(p=>!p||typeof p.method!=='string'||
    !p.method.trim()||!Number.isSafeInteger(p.amount)||Number(p.amount)<1)||
   (refunds.length>0&&refunds.reduce((t,p)=>t+Number(p.amount),0)!==amount))
   return fail('WATCH_RETURN_SPLIT_INVALID','Суммы всех способов возврата должны точно совпадать с общей суммой.',400)
 const selectedMethods=amount>0?(refunds.length?refunds.map(p=>String(p.method).trim()):
   [String(input.paymentMethod||'').trim()]):[]
 if(selectedMethods.some(x=>!x))
   return fail('WATCH_RETURN_METHOD_INVALID','Выберите способ возврата денег.',400)
 if(selectedMethods.length){
   const available=await db.prepare(`SELECT value FROM watch_reference_values
     WHERE kind='paymentMethods' AND is_active=1`).all<{value:string}>()
   if(selectedMethods.some(method=>!(available.results||[]).some(v=>
     v.value.toLocaleUpperCase('ru-RU')===method.toLocaleUpperCase('ru-RU'))))
     return fail('WATCH_RETURN_METHOD_INVALID','Выберите действующий способ возврата из общего справочника.',400)
 }
 const row=await db.prepare(
   `SELECT o.id,o.order_status,o.shipping_status,wd.brand_id
    FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
    WHERE o.id=? AND wd.brand_id=? LIMIT 1`,
 ).bind(orderId,brandId).first<Record<string,unknown>>()
 if(!row)return fail('WATCH_RETURN_NOT_FOUND','Заказ отсутствует в выбранном бренде.',404)
 const watchRows=await db.prepare(`
   SELECT oi.id,oi.quantity,oi.variant_id,oi.is_workshop,wi.watch_variant_id,
     wp.brand_id AS sku_brand
   FROM order_items oi
   JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
   JOIN watch_variants wv ON wv.id=wi.watch_variant_id AND wv.catalog_variant_id=oi.variant_id
   JOIN watch_products wp ON wp.id=wv.watch_product_id
   WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id
 `).bind(orderId).all<Record<string,unknown>>()
 const byId=new Map((watchRows.results||[]).map(row=>[Number(row.id),row]))
 const all=await db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id=? AND quantity>0')
   .bind(orderId).first<{n:number}>()
 if(!byId.size||Number(all?.n)!==byId.size||
   [...byId.values()].some(row=>Number(row.sku_brand)!==brandId||Number(row.is_workshop)!==0))
   return fail('WATCH_RETURN_UNVERIFIED_SKU',
     'Не все активные позиции принадлежат часам выбранного бренда. Возврат остановлен.',409)
 const rawItems=Array.isArray(input.items)?input.items:null
 const selected:Array<{orderItemId:number;quantity:number;amount:number;restock:boolean;
   physicalState:'pending'|'warehouse'|'boutique'|'no_stock'}>=[]
 if(itemSelected){
   const supplied=rawItems||(byId.size===1?[{
     orderItemId:[...byId.keys()][0],quantity,
   }]:[])
   if(!supplied.length||supplied.length>20)
     return fail('WATCH_RETURN_SELECTION_REQUIRED','Выберите конкретные часы и количество для возврата.',400)
   const seen=new Set<number>()
   for(const candidate of supplied){
     const x=candidate as {orderItemId?:unknown;quantity?:unknown;physicalState?:unknown}
     const id=Number(x?.orderItemId),qty=Number(x?.quantity)
     const physicalState=String(x?.physicalState||'pending')
     if(!['pending','warehouse','boutique','no_stock'].includes(physicalState))
       return fail('WATCH_RETURN_PHYSICAL_INVALID',
         'Выберите, где физически находятся возвращаемые часы.',400)
     const row=byId.get(id)
     if(!Number.isSafeInteger(id)||!row||seen.has(id)||
       !Number.isSafeInteger(qty)||qty<1||qty>Number(row.quantity))
       return fail('WATCH_RETURN_SELECTION_INVALID',
         'Выбранной позиции нет в заказе либо количество превышает доступное.',409)
     seen.add(id)
     selected.push({orderItemId:id,quantity:qty,amount:0,
       restock:physicalState==='warehouse'||physicalState==='boutique',
       physicalState:physicalState as 'pending'|'warehouse'|'boutique'|'no_stock'})
   }
 }else if(rawItems?.length){
   return fail('WATCH_RETURN_MONEY_ONLY','Для возврата только денег нельзя выбирать товары.',400)
 }
 try {
   const response=await createReturn(db,{
     requestId:input.requestId as string,orderId,returnDate:dateAlmaty(),
     amount,paymentMethod:amount>0?selectedMethods[0]:undefined,
     ...(refunds.length?{paymentParts:refunds.map(p=>({method:String(p.method).trim(),amount:Number(p.amount)}))}:{}),
     comment:reason,restockSource:'none',
     items:selected,
   })
   if(!response||typeof response!=='object'||!('ok' in response)||response.ok!==true)
     return fail('WATCH_RETURN_NOT_APPLIED','Возврат не подтверждён финансовым ядром.')
   const physicalReceiptPending=selected.some(x=>x.physicalState==='pending')
   return json({...response,brandId,orderId,physicalReceiptPending,
     ...(itemSelected?{notice:physicalReceiptPending
       ?'Возврат оформлен. Часы в пути появятся в очереди приёмки; уже полученные отмечены отдельно.'
       :'Возврат и указанное фактическое получение часов оформлены.'}:{})})
 }catch(cause){
   return fail('WATCH_RETURN_FAILED',cause instanceof Error?cause.message:'Не удалось оформить возврат.')
 }
}

/** Records physical intake only after explicit warehouse confirmation. */
export async function receiveClient3WatchReturn(
 db:D1Database,actor:AuthUser,brandId:number,orderId:number,
 input:{requestId?:unknown;returnId?:unknown;returnItemId?:unknown;destination?:unknown;operationType?:unknown},
) {
 if(!actor||actor.employeeRole==='Логист'&&actor.role!=='admin')
   return fail('WATCH_RECEIPT_FORBIDDEN','Приём часов доступен менеджеру или администратору.',403)
 const returnId=Number(input.returnId),returnItemId=Number(input.returnItemId)
 if(!Number.isSafeInteger(orderId)||orderId<1||
   !Number.isSafeInteger(returnId)||returnId<1||!Number.isSafeInteger(returnItemId)||returnItemId<1||
   !keyValid(input.requestId))
   return fail('WATCH_RECEIPT_INVALID','Выберите возврат и уникальный запрос.',400)
 const destination=input.destination
 if(!['warehouse','boutique','no_stock'].includes(String(destination)))
   return fail('WATCH_RECEIPT_DEST_INVALID','Выберите офис, витрину или без возврата в остаток.',400)
 const operationType=input.operationType==='exchange'?'exchange':'return'
 const match=await db.prepare(
   operationType==='exchange'?`SELECT ei.id FROM exchange_items ei JOIN exchanges e ON e.id=ei.exchange_id
    JOIN watch_order_details wd ON wd.order_id=e.order_id
    JOIN order_items oi ON oi.id=ei.order_item_id AND oi.order_id=wd.order_id
    JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
    WHERE ei.id=? AND e.id=? AND e.order_id=? AND wd.brand_id=?
      AND ei.role='old' AND COALESCE(e.status,'completed')<>'cancelled' LIMIT 1`:
   `SELECT ri.id FROM return_items ri JOIN returns r ON r.id=ri.return_id
    JOIN watch_order_details wd ON wd.order_id=r.order_id
    JOIN order_items oi ON oi.id=ri.order_item_id AND oi.order_id=wd.order_id
    JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
    WHERE ri.id=? AND r.id=? AND r.order_id=? AND wd.brand_id=?
      AND COALESCE(r.status,'completed')<>'cancelled' LIMIT 1`,
 ).bind(returnItemId,returnId,orderId,brandId).first<{id:number}>()
 if(!match)return fail('WATCH_RECEIPT_NOT_FOUND','Часы не принадлежат возврату этого бренда.',404)
 try {
   const result=await receiveReturnedItem(db,{
     requestId:input.requestId as string,operationType,
     operationId:returnId,operationItemId:returnItemId,
     destination:destination as 'warehouse'|'boutique'|'no_stock',
   })
   return json({...result,brandId,orderId})
 }catch(cause){
   return fail('WATCH_RECEIPT_FAILED',cause instanceof Error?cause.message:'Не удалось принять возвращённые часы.')
 }
}

/** Brand-scoped pending physical intake; no stock is changed by this read. */
export async function listPendingClient3WatchReturns(db:D1Database,actor:AuthUser,brandId:number){
 if(!actor||actor.employeeRole==='Логист'&&actor.role!=='admin')
   return fail('WATCH_RECEIPT_FORBIDDEN','Приём товара доступен менеджеру и администратору.',403)
 const data=await db.prepare(`
   SELECT 'return' AS operationType,ri.id AS returnItemId,ri.return_id AS returnId,r.order_id AS orderId,
     o.external_id AS externalOrderId,ri.quantity,r.return_date AS returnDate,
     wp.model_name AS modelName,wv.gender,wv.bracelet_material AS braceletMaterial,
     wv.dial_color AS dialColor,wv.bracelet_color AS braceletColor
   FROM return_items ri
   JOIN returns r ON r.id=ri.return_id
   JOIN orders o ON o.id=r.order_id
   JOIN watch_order_details wd ON wd.order_id=r.order_id
   JOIN watch_order_item_details wi ON wi.order_item_id=ri.order_item_id
   JOIN watch_variants wv ON wv.id=wi.watch_variant_id
   JOIN watch_products wp ON wp.id=wv.watch_product_id
   WHERE wd.brand_id=? AND COALESCE(r.status,'completed')<>'cancelled'
     AND ri.physical_tracking=1 AND ri.physical_received_at IS NULL
   UNION ALL
   SELECT 'exchange' AS operationType,ei.id AS returnItemId,ei.exchange_id AS returnId,e.order_id AS orderId,
     o.external_id AS externalOrderId,ei.quantity,e.exchange_date AS returnDate,
     wp.model_name AS modelName,wv.gender,wv.bracelet_material AS braceletMaterial,
     wv.dial_color AS dialColor,wv.bracelet_color AS braceletColor
   FROM exchange_items ei
   JOIN exchanges e ON e.id=ei.exchange_id
   JOIN orders o ON o.id=e.order_id
   JOIN watch_order_details wd ON wd.order_id=e.order_id
   JOIN watch_order_item_details wi ON wi.order_item_id=ei.order_item_id
   JOIN watch_variants wv ON wv.id=wi.watch_variant_id
   JOIN watch_products wp ON wp.id=wv.watch_product_id
   WHERE wd.brand_id=? AND ei.role='old' AND COALESCE(e.status,'completed')<>'cancelled'
     AND ei.physical_tracking=1 AND ei.physical_received_at IS NULL
   ORDER BY returnDate DESC,returnItemId DESC LIMIT 100
 `).bind(brandId,brandId).all<Record<string,unknown>>()
 return json({ok:true,brandId,rows:data.results||[]})
}
