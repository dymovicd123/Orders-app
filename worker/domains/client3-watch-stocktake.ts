import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {quickInventoryStocktakeBatch} from './inventory-stocktake.ts'
import {isHumanInventoryModelEnabled} from './catalog.ts'
import {watchSourceToLegacy,type WatchSource} from '../../shared/client3/watch-domain.ts'

const bad=(code:string,message:string,status=400)=>json({ok:false,code,message},{status})
type CountLine={watchVariantId?:unknown;expectedPhysical?:unknown;countedQuantity?:unknown}
type BatchInput={source?:unknown;requestId?:unknown;confirmed?:unknown;allowShortage?:unknown;items?:CountLine[]}
type Input=CountLine&Omit<BatchInput,'items'>

/** Main's atomic multi-SKU selective recount, limited to exact watch identities of ONE brand and source. */
export async function countClient3WatchStockBatch(
 db:D1Database,actor:AuthUser,brandId:number,input:BatchInput,
 writer:typeof quickInventoryStocktakeBatch=quickInventoryStocktakeBatch,
){
 if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад'))
   return bad('WATCH_STOCKTAKE_ADMIN_ONLY','Пересчёт часов доступен только администратору.',403)
 if(input.source!=='office'&&input.source!=='showcase')
   return bad('WATCH_STOCKTAKE_SOURCE_INVALID','Разрешены только офис и витрина.')
 if(input.confirmed!==true)
   return bad('WATCH_STOCKTAKE_CONFIRM_REQUIRED','Подтвердите, что все выбранные часы пересчитаны физически.')
 if(typeof input.requestId!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(input.requestId))
   return bad('WATCH_STOCKTAKE_REQUEST_INVALID','Нужен уникальный идентификатор пересчёта.')
 const items=input.items
 if(!Array.isArray(items)||items.length<1||items.length>30)
   return bad('WATCH_STOCKTAKE_SIZE','Выберите от 1 до 30 комплектаций для одной выборочной сверки.')
 const normalized=items.map(row=>({
   watchVariantId:Number(row?.watchVariantId),
   expectedPhysical:Number(row?.expectedPhysical),
   countedQuantity:Number(row?.countedQuantity),
   hasExpected:row?.expectedPhysical!==null&&row?.expectedPhysical!==undefined&&row?.expectedPhysical!=='',
   hasCounted:row?.countedQuantity!==null&&row?.countedQuantity!==undefined&&row?.countedQuantity!=='',
 }))
 if(normalized.some(x=>!Number.isSafeInteger(x.watchVariantId)||x.watchVariantId<1||
   !x.hasExpected||!Number.isSafeInteger(x.expectedPhysical)||x.expectedPhysical<0||
   !x.hasCounted||!Number.isSafeInteger(x.countedQuantity)||
   x.countedQuantity<0||x.countedQuantity>1_000_000))
   return bad('WATCH_STOCKTAKE_INVALID','Укажите целые текущие и фактические количества для каждого SKU.')
 if(new Set(normalized.map(x=>x.watchVariantId)).size!==normalized.length)
   return bad('WATCH_STOCKTAKE_DUPLICATE','Одна комплектация выбрана дважды.',409)
 if(!await isHumanInventoryModelEnabled(db))
   return bad('WATCH_INVENTORY_NOT_READY','Складской учёт не готов.',503)
 const ids=normalized.map(x=>x.watchVariantId)
 const rows=await db.prepare(`
   SELECT wv.id AS watch_id,wv.catalog_variant_id AS variant_id
   FROM watch_variants wv
   JOIN watch_products wp ON wp.id=wv.watch_product_id
   JOIN catalog_variants cv ON cv.id=wv.catalog_variant_id
     AND cv.product_id=wp.catalog_product_id
   JOIN catalog_products cp ON cp.id=wp.catalog_product_id
   JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id
   WHERE wp.brand_id=? AND wp.is_active=1 AND wv.is_active=1
     AND cv.is_active=1 AND cp.is_active=1 AND sp.is_active=1
     AND wv.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
 `).bind(brandId,JSON.stringify(ids)).all<{watch_id:number;variant_id:number}>()
 const byId=new Map((rows.results||[]).map(row=>[Number(row.watch_id),Number(row.variant_id)]))
 if(byId.size!==normalized.length)
   return bad('WATCH_STOCKTAKE_SKU_INVALID',
     'Одна из комплектаций не принадлежит выбранному бренду или больше не активна.',409)
 const source=watchSourceToLegacy(input.source as WatchSource)
 const referenceId='stock-check:quick_stocktake:'+source+':'+input.requestId
 try{
   // Permit idempotent retries to reach Main's stored exact-line comparison.
   const replay=await db.prepare(`SELECT 1 AS present FROM inventory_stock_checks
     WHERE inventory_source=? AND reference_id=? LIMIT 1`)
     .bind(source,referenceId).first<{present:number}>()
   if(!replay&&input.allowShortage!==true){
     const live=await db.prepare(`SELECT ir.variant_id,COALESCE(SUM(ir.quantity),0) AS reserved
       FROM inventory_reservations ir WHERE ir.inventory_source=? AND ir.status='active'
       AND ir.variant_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
       GROUP BY ir.variant_id`).bind(source,JSON.stringify([...byId.values()]))
       .all<{variant_id:number;reserved:number}>()
     const reservations=new Map((live.results||[]).map(row=>[Number(row.variant_id),Number(row.reserved)]))
     const counters=await db.prepare(`SELECT variant_id,MAX(reserved_quantity) AS reserved
       FROM inventory_stock WHERE inventory_source=?
       AND variant_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
       GROUP BY variant_id`).bind(source,JSON.stringify([...byId.values()]))
       .all<{variant_id:number;reserved:number}>()
     const countersById=new Map((counters.results||[]).map(row=>[Number(row.variant_id),Number(row.reserved)]))
     if(normalized.some(x=>x.countedQuantity<Math.max(
       reservations.get(byId.get(x.watchVariantId)!)||0,
       countersById.get(byId.get(x.watchVariantId)!)||0)))
       return bad('WATCH_STOCKTAKE_SHORTAGE_CONFIRM',
         'Часть пересчёта ниже действующих резервов. Подтвердите физическую недостачу.',409)
   }
   const result=await writer(db,{
     source,requestId:input.requestId,
     items:normalized.map(x=>({
       variantId:byId.get(x.watchVariantId)!,
       expectedQuantity:x.expectedPhysical,
       countedQuantity:x.countedQuantity,
     })),
   },{actor:'client3-watch:'+actor.id,checkType:'quick_stocktake',referenceType:'quick_stocktake'})
   if(result?.ok!==true)return json({...result,brandId},{status:409})
   const hasShortage=(result.results||[]).some(row=>Number(row.physical)<Number(row.reserved))
   return json({...result,brandId,source:input.source,watchItemCount:normalized.length,
     ...(hasShortage?{attention:'Пересчёт сохранён. По некоторым SKU резерв выше фактического количества — проверьте соответствующие заказы.'}:{})})
 }catch(cause){
   return bad('WATCH_STOCKTAKE_FAILED',
     cause instanceof Error?cause.message:'Сверка не сохранена.',409)
 }
}

/** Backwards-compatible single-SKU count; same safety and Main batch engine. */
export async function countClient3WatchStock(
 db:D1Database,actor:AuthUser,brandId:number,input:Input,
 writer:typeof quickInventoryStocktakeBatch=quickInventoryStocktakeBatch,
){
 return countClient3WatchStockBatch(db,actor,brandId,{
   source:input.source,requestId:input.requestId,confirmed:input.confirmed,
   allowShortage:input.allowShortage,
   items:[{watchVariantId:input.watchVariantId,expectedPhysical:input.expectedPhysical,
     countedQuantity:input.countedQuantity}],
 },writer)
}
