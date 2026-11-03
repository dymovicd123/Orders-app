import { json } from '../core/http.ts'
import type {AuthUser,InventoryItemInput} from '../core/types.ts'
import {applyInventoryMovement} from './inventory-movement.ts'
import {isHumanInventoryModelEnabled} from './catalog.ts'
import {watchSourceToLegacy,type WatchSource} from '../../shared/client3/watch-domain.ts'

const deny=(code:string,message:string,status=400)=>json({ok:false,code,message},{status})
type Input={watchVariantId?:unknown;quantity?:unknown;source?:unknown;expectedPhysical?:unknown;requestId?:unknown;comment?:unknown}
const activeReservationSql="SELECT COALESCE(SUM(quantity),0) AS reserved FROM inventory_reservations WHERE inventory_source=? AND variant_id=? AND status='active'"
const stockSql='SELECT COALESCE(SUM(quantity),0) AS physical,COALESCE(SUM(reserved_quantity),0) AS reserved FROM inventory_stock WHERE inventory_source=? AND variant_id=?'

export async function writeoffClient3WatchStock(
 db:D1Database,actor:AuthUser,brandId:number,input:Input,
 writer:typeof applyInventoryMovement=applyInventoryMovement,
) {
 if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад'))return deny('WATCH_STOCK_ADMIN_ONLY','Списание часов доступно только администратору.',403)
 const watchVariantId=Number(input.watchVariantId),quantity=Number(input.quantity),expected=Number(input.expectedPhysical)
 if(!Number.isSafeInteger(watchVariantId)||watchVariantId<=0||
    !Number.isSafeInteger(quantity)||quantity<1||quantity>1000||
    input.expectedPhysical==null||!Number.isSafeInteger(expected)||expected<0)
   return deny('WATCH_WRITEOFF_INPUT_INVALID','Выберите часы, количество и исходный остаток.')
 if(input.source!=='office'&&input.source!=='showcase')
   return deny('WATCH_WRITEOFF_SOURCE_INVALID','Разрешены только офис и витрина.')
 if(typeof input.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(input.requestId))
   return deny('WATCH_WRITEOFF_REQUEST_INVALID','Нужен уникальный идентификатор списания.')
 const reason=typeof input.comment==='string'?input.comment.trim():''
 if(!reason||reason.length>300)
   return deny('WATCH_WRITEOFF_REASON_REQUIRED','Укажите причину списания не длиннее 300 символов.')
 if(!await isHumanInventoryModelEnabled(db))
   return deny('WATCH_INVENTORY_NOT_READY','Складской учёт ещё не активирован.',503)

 const canonical=await db.prepare(
   'SELECT v.catalog_variant_id AS variantId,p.catalog_product_id AS productId,c.name AS productName,cv.category,cv.gender,cv.color,cv.material,cv.length,cv.size_label AS size,cv.is_active AS variantActive,sp.is_active AS executionActive FROM watch_variants v JOIN watch_products p ON p.id=v.watch_product_id AND p.is_active=1 JOIN catalog_products c ON c.id=p.catalog_product_id AND c.is_active=1 JOIN catalog_variants cv ON cv.id=v.catalog_variant_id AND cv.product_id=c.id JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id AND sp.product_id=c.id WHERE v.id=? AND p.brand_id=? AND v.is_active=1 LIMIT 1'
 ).bind(watchVariantId,brandId).first<Record<string,unknown>>()
 if(!canonical||Number(canonical.variantActive)!==1||Number(canonical.executionActive)!==1)
   return deny('WATCH_SKU_NOT_READY','Подготовьте складской SKU перед списанием.',409)
 const source=watchSourceToLegacy(input.source as WatchSource)
 try {
   const prior=await db.prepare(
     "SELECT operation_id FROM inventory_operations WHERE operation_id=? AND operation_type='writeoff' AND source_type=? LIMIT 1"
   ).bind(input.requestId,source).first<{operation_id:string}>()
   if(!prior){
     const stock=await db.prepare(stockSql).bind(source,canonical.variantId).first<{physical:number;reserved:number}>()
     const live=await db.prepare(activeReservationSql).bind(source,canonical.variantId).first<{reserved:number}>()
     const physical=Math.max(0,Number(stock?.physical||0))
     const reserved=Math.max(0,Number(stock?.reserved||0),Number(live?.reserved||0))
     if(physical!==expected)
       return deny('WATCH_WRITEOFF_STALE','Остатки изменились. Обновите данные.',409)
     if(physical-reserved<quantity)
       return deny('WATCH_WRITEOFF_RESERVED','Недостаточно свободных часов. Зарезервированные часы нельзя списывать.',409)
   }
   const item:InventoryItemInput={
     variantId:Number(canonical.variantId),productId:Number(canonical.productId),
     productName:String(canonical.productName),category:String(canonical.category||'adult'),
     gender:String(canonical.gender||''),color:String(canonical.color||''),
     material:String(canonical.material||''),length:String(canonical.length||''),
     size:String(canonical.size||''),quantity,expectedQuantity:expected,
   }
   const result=await writer(db,{
     requestId:input.requestId,inventorySource:source,movementType:'writeoff',comment:reason,
     items:[item],stockConfirmations:[],
   },false,'client3-watch:'+actor.id)
   if(result?.ok!==true)
     return deny('WATCH_WRITEOFF_NOT_APPLIED','Склад требует проверки наличия. Списание не выполнено.',409)
   let attention:string|undefined
   if(!result.duplicate) {
     try {
       const stock=await db.prepare(stockSql).bind(source,canonical.variantId).first<{physical:number;reserved:number}>()
       const live=await db.prepare(activeReservationSql).bind(source,canonical.variantId).first<{reserved:number}>()
       const reserved=Math.max(0,Number(stock?.reserved||0),Number(live?.reserved||0))
       if(Number(stock?.physical||0)<reserved)
         attention='После списания резерв превышает наличие. Проверьте связанные заказы.'
     }catch {
       attention='Списание сохранено, но не удалось проверить остаток повторно.'
     }
   }
   return json({...result,brandId,watchVariantId,source:input.source,...(attention?{attention}:{})})
 }catch(error){
   return deny('WATCH_WRITEOFF_FAILED',
     error instanceof Error?error.message:'Не удалось выполнить списание.',409)
 }
}
