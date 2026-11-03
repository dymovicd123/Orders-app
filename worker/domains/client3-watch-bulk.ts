import {json} from '../core/http.ts'
import type {AuthUser,InventoryItemInput} from '../core/types.ts'
import {applyInventoryMovement,applyInventoryTransfer} from './inventory-movement.ts'
import {isHumanInventoryModelEnabled} from './catalog.ts'
import {watchSourceToLegacy,type WatchSource} from '../../shared/client3/watch-domain.ts'

type BulkOperation='arrival'|'writeoff'|'transfer'
type BulkLine={watchVariantId?:unknown;quantity?:unknown;expectedPhysical?:unknown}
export type WatchBulkInput={
 source?:unknown;requestId?:unknown;kind?:unknown;items?:BulkLine[];comment?:unknown
}
const error=(code:string,message:string,status=409)=>json({ok:false,code,message},{status})
const keyPattern=/^[A-Za-z0-9._:-]{8,128}$/

/**
 * Main's atomic multi-item warehouse engine behind a watch-only, single-brand,
 * exact-SKU contract. Never independently executes per-line writes. An unsafe
 * line prevents the entire operation, including stock, money and history.
 */
export async function applyClient3WatchBulkOperation(
 db:D1Database,actor:AuthUser,brandId:number,input:WatchBulkInput,
 dependencies:{movement?:typeof applyInventoryMovement;transfer?:typeof applyInventoryTransfer}={},
){
 if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад'))
   return error('WATCH_BULK_ADMIN_ONLY','Массовые операции доступны только администратору.',403)
 if(input.kind!=='arrival'&&input.kind!=='writeoff'&&input.kind!=='transfer')
   return error('WATCH_BULK_KIND','Выберите приход, списание или перемещение.',400)
 const kind=input.kind as BulkOperation
 if(input.source!=='office'&&input.source!=='showcase')
   return error('WATCH_BULK_SOURCE','Выберите офис или витрину.',400)
 if(typeof input.requestId!=='string'||!keyPattern.test(input.requestId))
   return error('WATCH_BULK_REQUEST','Некорректный идентификатор операции.',400)
 const comment=typeof input.comment==='string'?input.comment.trim():''
 if(comment.length>300||(kind==='writeoff'&&!comment))
   return error('WATCH_BULK_REASON','Укажите причину списания или исправьте комментарий (до 300 символов).',400)
 const maxItems=kind==='arrival'?100:kind==='transfer'?60:30
 if(!Array.isArray(input.items)||input.items.length<1||input.items.length>maxItems)
   return error('WATCH_BULK_LINES','Выберите от 1 до '+maxItems+' разных комплектаций.',400)
 const lines=input.items.map(row=>({
   watchVariantId:Number(row?.watchVariantId),quantity:Number(row?.quantity),
   expectedPhysical:row?.expectedPhysical==null?NaN:Number(row?.expectedPhysical),
 }))
 if(lines.some(line=>!Number.isSafeInteger(line.watchVariantId)||line.watchVariantId<1||
     !Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>1000||
     (kind!=='arrival'&&(!Number.isSafeInteger(line.expectedPhysical)||line.expectedPhysical<0))))
   return error('WATCH_BULK_QUANTITY','Для каждой позиции укажите количество 1–1000 и текущий остаток.',400)
 if(new Set(lines.map(x=>x.watchVariantId)).size!==lines.length)
   return error('WATCH_BULK_DUPLICATE','Одна комплектация добавлена в операцию дважды.',409)
 if(!await isHumanInventoryModelEnabled(db))
   return error('WATCH_INVENTORY_NOT_READY','Складской учёт ещё не активирован.',503)
 const ids=lines.map(x=>x.watchVariantId)
 const result=await db.prepare(`
   SELECT wv.id AS watchId,wv.catalog_variant_id AS variantId,
     wp.catalog_product_id AS productId,c.name AS productName,
     cv.category,cv.gender,cv.color,cv.material,cv.length,cv.size_label AS size
   FROM watch_variants wv
   JOIN watch_products wp ON wp.id=wv.watch_product_id AND wp.is_active=1
   JOIN catalog_products c ON c.id=wp.catalog_product_id AND c.is_active=1
   JOIN catalog_variants cv ON cv.id=wv.catalog_variant_id AND cv.product_id=c.id AND cv.is_active=1
   JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id AND sp.is_active=1
   WHERE wp.brand_id=? AND wv.is_active=1
     AND wv.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
 `).bind(brandId,JSON.stringify(ids)).all<Record<string,unknown>>()
 const byId=new Map((result.results||[]).map(row=>[Number(row.watchId),row]))
 if(byId.size!==lines.length)
   return error('WATCH_BULK_BRAND_SKU','В операции есть неактивные или чужие комплектации. Склад не изменён.',409)
 const fromSource=watchSourceToLegacy(input.source as WatchSource)
 const toSource=fromSource==='warehouse'?'boutique':'warehouse'
 const canonical:InventoryItemInput[]=lines.map(line=>{
   const row=byId.get(line.watchVariantId)!
   return {
     variantId:Number(row.variantId),productId:Number(row.productId),
     productName:String(row.productName),category:String(row.category||'adult'),
     gender:String(row.gender||''),color:String(row.color||''),
     material:String(row.material||''),length:String(row.length||''),
     size:String(row.size||''),quantity:line.quantity,
     ...(kind==='arrival'?{}:{expectedQuantity:line.expectedPhysical}),
   }
 })
 try{
   // A committed idempotent request may be retried after quantities have moved.
   // The Main writer compares the immutable complete fingerprint on replay.
   const previous=kind==='transfer'?
     await db.prepare('SELECT id FROM inventory_transfer_documents WHERE request_id=? LIMIT 1')
       .bind(input.requestId).first<{id:number}>():
     await db.prepare('SELECT operation_id FROM inventory_operations WHERE operation_id=? LIMIT 1')
       .bind(input.requestId).first<{operation_id:string}>()
   if(!previous&&kind!=='arrival'){
     const canonicalIds=canonical.map(x=>Number(x.variantId))
     const previousRows=await db.prepare(`
       SELECT v.id AS variantId,COALESCE(s.quantity,0) AS physical,
         MAX(COALESCE(s.reserved_quantity,0),COALESCE(r.reserved,0)) AS reserved
       FROM catalog_variants v
       LEFT JOIN inventory_stock s ON s.variant_id=v.id AND s.inventory_source=?
       LEFT JOIN (
         SELECT variant_id,SUM(quantity) AS reserved FROM inventory_reservations
         WHERE inventory_source=? AND status='active' GROUP BY variant_id
       ) r ON r.variant_id=v.id
       WHERE v.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
     `).bind(fromSource,fromSource,JSON.stringify(canonicalIds))
       .all<{variantId:number;physical:number;reserved:number}>()
     const stock=new Map((previousRows.results||[]).map(x=>[Number(x.variantId),x]))
     for(const [i,line] of lines.entries()){
       const snapshot=stock.get(canonicalIds[i])
       const physical=Math.max(0,Number(snapshot?.physical||0))
       const reserved=Math.max(0,Number(snapshot?.reserved||0))
       if(physical!==line.expectedPhysical)
         return error('WATCH_BULK_STALE','Остаток изменился. Обновите склад: вся операция остановлена.',409)
       if(physical-reserved<line.quantity)
         return error('WATCH_BULK_RESERVED','Недостаточно свободных часов. Зарезервированные позиции нельзя списать или переместить.',409)
     }
   }
   const out=kind==='transfer'?
     await (dependencies.transfer||applyInventoryTransfer)(db,{
       requestId:input.requestId,fromSource,toSource,comment:comment||'Массовое перемещение часов',
       items:canonical,stockConfirmations:[],
     },'client3-watch:'+actor.id,false):
     await (dependencies.movement||applyInventoryMovement)(db,{
       requestId:input.requestId,inventorySource:fromSource,movementType:kind,
       comment:comment||(kind==='arrival'?'Массовый приход часов':'Массовое списание часов'),
       items:canonical,stockConfirmations:[],
     },false,'client3-watch:'+actor.id)
   if(out?.ok!==true)
     return error('WATCH_BULK_NOT_APPLIED','Складское ядро не подтвердило операцию.',409)
   return json({...out,brandId,kind,source:input.source,itemCount:lines.length})
 }catch(cause){
   return error('WATCH_BULK_FAILED',cause instanceof Error?cause.message:'Не удалось выполнить операцию.',409)
 }
}
