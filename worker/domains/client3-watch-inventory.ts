import { json } from '../core/http.ts'
import type { AuthUser, InventoryItemInput } from '../core/types.ts'
import { applyInventoryMovement } from './inventory-movement.ts'
import { isHumanInventoryModelEnabled } from './catalog.ts'
import { watchSourceToLegacy, type WatchSource } from '../../shared/client3/watch-domain.ts'

const fail=(code:string,message:string,status=400)=>json({ok:false,code,message},{status})
type WatchArrivalInput = {
  watchVariantId?: unknown; quantity?: unknown; source?: unknown;
  requestId?: unknown; comment?: unknown;
}

/**
 * A physical arrival is the ONLY path here that increases physical stock.
 * Brand and canonical identity are checked on the server; price, engraving
 * and order status never participate in warehouse movements.
 */
export async function receiveClient3WatchArrival(
  db:D1Database,actor:AuthUser,brandId:number,input:WatchArrivalInput,
  movementWriter:typeof applyInventoryMovement=applyInventoryMovement,
) {
  if(actor.role!=='admin')
    return fail('WATCH_STOCK_ADMIN_ONLY','Приход часов доступен администратору.',403)
  const watchVariantId=Number(input.watchVariantId)
  const quantity=Number(input.quantity)
  if(!Number.isSafeInteger(watchVariantId)||watchVariantId<=0||
    !Number.isSafeInteger(quantity)||quantity<=0||quantity>1000)
    return fail('WATCH_STOCK_INPUT_INVALID','Укажите комплектацию и количество от 1 до 1000.')
  const source=input.source
  if(source!=='office'&&source!=='showcase')return fail('WATCH_SOURCE_INVALID','Выберите офис или витрину.')
  const requestId=input.requestId
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(requestId))
    return fail('WATCH_REQUEST_INVALID','Нужен уникальный идентификатор операции.')
  const comment=typeof input.comment==='string'?input.comment.trim():''
  if(comment.length>300)return fail('WATCH_COMMENT_INVALID','Комментарий слишком длинный.')
  if(!await isHumanInventoryModelEnabled(db))
    return fail('WATCH_INVENTORY_NOT_READY','Складской учёт ещё не активирован.',503)
  const row=await db.prepare(`
    SELECT v.catalog_variant_id AS variantId,p.catalog_product_id AS productId,
      c.name AS productName,cv.category,cv.gender,cv.color,cv.material,cv.length,
      cv.size_label AS size,cv.is_active AS variantActive,sp.is_active AS executionActive
    FROM watch_variants v
    JOIN watch_products p ON p.id=v.watch_product_id AND p.is_active=1
    JOIN catalog_products c ON c.id=p.catalog_product_id AND c.is_active=1
    JOIN catalog_variants cv ON cv.id=v.catalog_variant_id AND cv.product_id=c.id
    JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id AND sp.product_id=c.id
    WHERE v.id=? AND p.brand_id=? AND v.is_active=1 LIMIT 1
  `).bind(watchVariantId,brandId).first<Record<string,unknown>>()
  if(!row || Number(row.variantActive)!==1 || Number(row.executionActive)!==1)
    return fail('WATCH_SKU_NOT_READY','Для этой комплектации складской SKU не подготовлен.',409)

  const item:InventoryItemInput={
    variantId:Number(row.variantId),productId:Number(row.productId),
    productName:String(row.productName),category:String(row.category||'adult'),
    gender:String(row.gender||''),color:String(row.color||''),
    material:String(row.material||''),length:String(row.length||''),
    size:String(row.size||''),quantity,
  }
  try{
    const result=await movementWriter(db,{
      requestId,inventorySource:watchSourceToLegacy(source as WatchSource),
      movementType:'arrival',comment:comment||'Приход часов',
      items:[item],
    },false,'client3-watch:'+actor.id)
    return json({...result,brandId,watchVariantId,source,physicalStockRecorded:true})
  }catch(cause){
    return fail('WATCH_ARRIVAL_FAILED',
      cause instanceof Error?cause.message:'Не удалось сохранить приход.',409)
  }
}
