import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {quickInventoryStocktakeBatch} from './inventory-stocktake.ts'
import {isHumanInventoryModelEnabled} from './catalog.ts'
import {watchSourceToLegacy,type WatchSource} from '../../shared/client3/watch-domain.ts'

const bad=(code:string,message:string,status=400)=>json({ok:false,code,message},{status})
type Input={watchVariantId?:unknown;source?:unknown;expectedPhysical?:unknown;
 countedQuantity?:unknown;requestId?:unknown;confirmed?:unknown;allowShortage?:unknown}
export async function countClient3WatchStock(
 db:D1Database,actor:AuthUser,brandId:number,input:Input,
 writer:typeof quickInventoryStocktakeBatch=quickInventoryStocktakeBatch,
){
 if(actor.role!=='admin')return bad('WATCH_STOCKTAKE_ADMIN_ONLY','Пересчёт часов доступен только администратору.',403)
 const id=Number(input.watchVariantId),expected=Number(input.expectedPhysical),counted=Number(input.countedQuantity)
 if(!Number.isSafeInteger(id)||id<=0||input.expectedPhysical==null||
   !Number.isSafeInteger(expected)||expected<0||input.countedQuantity==null||
   !Number.isSafeInteger(counted)||counted<0||counted>1000000)
   return bad('WATCH_STOCKTAKE_INVALID','Выберите точные часы, текущий остаток и фактическое количество.')
 if(input.source!=='office'&&input.source!=='showcase')
   return bad('WATCH_STOCKTAKE_SOURCE_INVALID','Разрешены только офис и витрина.')
 if(input.confirmed!==true)
   return bad('WATCH_STOCKTAKE_CONFIRM_REQUIRED','Подтвердите, что часы были пересчитаны физически.')
 if(typeof input.requestId!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(input.requestId))
   return bad('WATCH_STOCKTAKE_REQUEST_INVALID','Нужен идентификатор пересчёта.')
 if(!await isHumanInventoryModelEnabled(db))
   return bad('WATCH_INVENTORY_NOT_READY','Складской учёт не готов.',503)
 const v=await db.prepare(
   'SELECT wv.catalog_variant_id AS variant_id FROM watch_variants wv JOIN watch_products wp ON wp.id=wv.watch_product_id JOIN catalog_variants cv ON cv.id=wv.catalog_variant_id AND cv.product_id=wp.catalog_product_id WHERE wv.id=? AND wp.brand_id=? AND wp.is_active=1 AND wv.is_active=1 AND cv.is_active=1 LIMIT 1'
 ).bind(id,brandId).first<{variant_id:number}>()
 if(!v?.variant_id)return bad('WATCH_STOCKTAKE_SKU_INVALID','Складской SKU не подготовлен.',409)
 const source=watchSourceToLegacy(input.source as WatchSource)
 try{
   const stock=await db.prepare(
     'SELECT COALESCE(SUM(quantity),0) AS physical,COALESCE(SUM(reserved_quantity),0) AS reserved FROM inventory_stock WHERE inventory_source=? AND variant_id=?'
   ).bind(source,v.variant_id).first<{physical:number;reserved:number}>()
   const reservations=await db.prepare(
     "SELECT COALESCE(SUM(quantity),0) AS reserved FROM inventory_reservations WHERE inventory_source=? AND variant_id=? AND status='active'"
   ).bind(source,v.variant_id).first<{reserved:number}>()
   const reserve=Math.max(0,Number(stock?.reserved||0),Number(reservations?.reserved||0))
   const replay=await db.prepare(
     "SELECT id FROM inventory_stock_checks WHERE reference_id=? AND inventory_source=? LIMIT 1"
   ).bind('stock-check:quick_stocktake:'+source+':'+input.requestId,source).first<{id:number}>()
   if(!replay && counted<reserve && input.allowShortage!==true)
     return bad('WATCH_STOCKTAKE_SHORTAGE_CONFIRM','Фактический пересчёт ниже активного резерва. Подтвердите недостачу в форме.',409)
   const result=await writer(db,{
     source,requestId:input.requestId,
     items:[{variantId:v.variant_id,expectedQuantity:expected,countedQuantity:counted}],
   },{actor:'client3-watch:'+actor.id,checkType:'quick_stocktake',referenceType:'quick_stocktake'})
   if(result?.ok!==true)return json({...result,brandId,watchVariantId:id},{status:409})
   return json({...result,brandId,watchVariantId:id,
     ...(counted<reserve?{attention:'Пересчёт сохранён. Резерв больше фактического наличия — проверьте заказы.'}:{})})
 }catch(cause){return bad('WATCH_STOCKTAKE_FAILED',cause instanceof Error?cause.message:'Сверка не сохранена.',409)}
}
