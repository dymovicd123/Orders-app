import { json } from '../core/http.ts'
import type { AuthUser } from '../core/types.ts'
import { assertCatalogVariantMayDeactivate } from './catalog.ts'
import {previewCatalogRetirement,retireCatalogEntity} from './catalog-retirement.ts'

const fail=(message:string,status=400)=>json({ok:false,message},{status})
type Scope='variant'|'execution'|'product'
type Input={kind?:unknown;watchProductId?:unknown;watchVariantId?:unknown;
  movement?:unknown;braceletMaterial?:unknown;expectedCount?:unknown;requestId?:unknown}
const positive=(v:unknown)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):0
type Item={id:number;catalog_variant_id:number|null;movement:string;bracelet_material:string}
async function target(db:D1Database,brandId:number,input:Input){
 const kind=input.kind as Scope,productId=positive(input.watchProductId)
 if(!['variant','execution','product'].includes(kind)||!productId)
   throw new Error('Выберите позицию, исполнение или товар.')
 const model=await db.prepare('SELECT id,model_name,catalog_product_id,is_active FROM watch_products WHERE id=? AND brand_id=?')
   .bind(productId,brandId).first<{id:number;model_name:string;catalog_product_id:number|null;is_active:number}>()
 if(!model)throw new Error('Товар не найден в выбранном бренде.')
 if(model.is_active!==1)throw new Error('Этот товар уже удалён из рабочего каталога.')
 const rows=await db.prepare(`SELECT v.id,v.catalog_variant_id,COALESCE(va.movement,v.movement) AS movement,
     COALESCE(va.bracelet_material,v.bracelet_material) AS bracelet_material FROM watch_variants v
   LEFT JOIN watch_variant_attributes_v5 va ON va.watch_variant_id=v.id
   WHERE v.watch_product_id=? AND v.is_active=1 ORDER BY v.id`).bind(productId).all<Item>()
 let items=rows.results||[]
 if(kind==='variant'){
   const id=positive(input.watchVariantId)
   items=items.filter(row=>row.id===id)
   if(!items.length)throw new Error('Позиция уже удалена либо не принадлежит этому товару.')
 }
 if(kind==='execution'){
   const movement=typeof input.movement==='string'?input.movement:''
   const material=typeof input.braceletMaterial==='string'?input.braceletMaterial:''
   if(!movement||!material)throw new Error('Выберите точное исполнение.')
   items=items.filter(row=>row.movement===movement&&row.bracelet_material===material)
   if(!items.length)throw new Error('Исполнение уже удалено либо не найдено.')
 }
 return {kind,model,items}
}
async function blockers(db:D1Database,items:Item[]){
 const errors:string[]=[]
 for(const row of items){
   if(!row.catalog_variant_id)continue // Pure unsold draft has no stock identity.
   try{await assertCatalogVariantMayDeactivate(db,row.catalog_variant_id)}
   catch(cause){errors.push(cause instanceof Error?cause.message:'Есть незавершённая операция.')}
 }
 return [...new Set(errors)]
}
/** Same preflight rules as Main's catalog variant deletion; no physical stock changes. */
export async function previewClient3WatchDelete(db:D1Database,actor:AuthUser,brandId:number,input:Input){
 if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад'))return fail('Удалять товары может только администратор.',403)
 let scope:Awaited<ReturnType<typeof target>>
 try{scope=await target(db,brandId,input)}catch(cause){
   return fail(cause instanceof Error?cause.message:'Не удалось определить товар.',404)
 }
 // Whole-product retirement follows Main's audited removal of working inventory,
 // while an exact SKU/group requires an empty physical and reservation balance.
 const main=scope.kind==='product'&&scope.model.catalog_product_id
   ?await previewCatalogRetirement(db,'product',scope.model.catalog_product_id):null
 const issues=scope.kind==='product'?
   (main?[
     ...(main.activeStocktake?['Идёт незавершённая ревизия.']:[]),
     ...(main.pendingLifecycle?['Есть незавершённая приёмка или возврат.']:[]),
     ...(main.activeWorkshopTaskCount?['Есть незавершённая задача.']:[]),
     ...(main.inactiveOperationalVariantCount?['У ранее удалённой позиции остался живой резерв/остаток.']:[])
   ]:[]):await blockers(db,scope.items)
 const historicalItems=scope.items.length?await db.prepare(`SELECT COUNT(*) AS qty
   FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
   WHERE wi.watch_variant_id IN (${scope.items.map(()=>'?').join(',')})`)
   .bind(...scope.items.map(v=>v.id)).first<{qty:number}>():null
 const physical=main?.physicalQuantity||0
 const reserved=main?.activeReservationQuantity||0
 return json({ok:true,kind:scope.kind,watchProductId:scope.model.id,
   modelName:scope.model.model_name,count:scope.items.length,
   canDelete:issues.length===0,blockers:issues,
   physicalQuantity:physical,activeReservations:reserved,
   openOrders:main?.openOrderItemCount||0,historicalOrderItems:Number(historicalItems?.qty||0),
   inventoryWillBeRemoved:scope.kind==='product'&&physical!==0,
   reservationsWillBeReleased:scope.kind==='product'&&reserved!==0,
   physicalAndReservationsPreserved:scope.kind!=='product',
   historyPreserved:true})
}
export async function deleteClient3WatchCatalog(db:D1Database,actor:AuthUser,brandId:number,input:Input){
 if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад'))return fail('Удалять товары может только администратор.',403)
 let scope:Awaited<ReturnType<typeof target>>
 try{scope=await target(db,brandId,input)}catch(cause){
   return fail(cause instanceof Error?cause.message:'Не удалось определить товар.',404)
 }
 const expected=Number(input.expectedCount)
 if(!Number.isSafeInteger(expected)||expected<0||expected!==scope.items.length)
   return fail('Состав исполнения изменился. Обновите каталог перед удалением.',409)
 if(scope.kind==='product'){
   // Main whole-product retirement carries a durable operation ID, snapshots all
   // variants, records stock-removal movements and releases active reservations.
   // Client3 never directly zeroes stock or loses old order/movement identities.
   const canonicalId=scope.model.catalog_product_id
   const requestId=String(input.requestId||'')
   if(!/^watch-retire-[A-Za-z0-9_.:-]{16,120}$/.test(requestId))
     return fail('Повторите подтверждение удаления товара с новым идентификатором.',400)
   if(canonicalId){
     const owner=await db.prepare(`SELECT cp.id
       FROM catalog_products cp JOIN watch_products wp ON wp.catalog_product_id=cp.id
       JOIN watch_brands b ON b.id=wp.brand_id
       WHERE wp.id=? AND wp.brand_id=? AND cp.id=?
         AND cp.name=('WATCH_'||b.code||'_MODEL_'||wp.id)`)
       .bind(scope.model.id,brandId,canonicalId).first<{id:number}>()
     if(!owner?.id)return fail('Внутренняя карточка товара не соответствует выбранному бренду.',409)
     try{
       await retireCatalogEntity(db,'product',canonicalId,{
         requestId,reason:'Удалён товар часов '+scope.model.model_name+' из Client3',
         actor:actor.displayName||actor.email||'Администратор',
       })
     }catch(cause){
       return fail(cause instanceof Error?cause.message:'Main не завершил безопасное удаление товара.',409)
     }
   }
   // Retrying after an interrupted UI request is repair-safe: this step only
   // archives watch catalog shells; canonical Main history is already durable.
   await db.batch([
     db.prepare('UPDATE watch_variants SET is_active=0 WHERE watch_product_id=? AND is_active=1')
       .bind(scope.model.id),
     db.prepare('UPDATE watch_products SET is_active=0 WHERE id=? AND brand_id=? AND is_active=1')
       .bind(scope.model.id,brandId),
   ])
   return json({ok:true,kind:'product',deletedCount:scope.items.length,
     productDeleted:true,historyPreserved:true,mainRetirement:Boolean(canonicalId)})
 }
 const issues=await blockers(db,scope.items)
 if(issues.length)return fail('Удаление заблокировано: '+issues.join('; '),409)
 // Granular Main-style retirement: exact SKU or watch execution group only.
 // No physical stock write-off here, and historical identities are retained.
 // Historical FK rows are never deleted or changed.
 const ids=scope.items.map(row=>row.id)
 const canonical=scope.items.map(row=>row.catalog_variant_id).filter((id):id is number=>!!id)
 const statements=[]
 for(const id of ids)statements.push(db.prepare(`UPDATE watch_variants SET is_active=0
   WHERE id=? AND is_active=1 AND watch_product_id=?
     AND NOT EXISTS (SELECT 1 FROM inventory_stock st JOIN watch_variants wv ON wv.catalog_variant_id=st.variant_id
       WHERE wv.id=? AND (COALESCE(st.quantity,0)<>0 OR COALESCE(st.reserved_quantity,0)<>0))
     AND NOT EXISTS (SELECT 1 FROM inventory_reservations r JOIN watch_variants wv ON wv.catalog_variant_id=r.variant_id
       WHERE wv.id=? AND r.status='active')
     AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
       JOIN watch_variants wv ON wv.catalog_variant_id=oi.variant_id
       WHERE wv.id=? AND o.order_status='active' AND o.shipping_status<>'sent' AND oi.quantity>0)`)
   .bind(id,scope.model.id,id,id,id))
 // Same Main retirement history table used by CatalogVariant PATCH.
 const now=new Date().toISOString()
 for(const id of canonical){
   statements.push(db.prepare(
     'UPDATE catalog_variants SET is_active=0,updated_at=? WHERE id=? AND is_active=1',
   ).bind(now,id))
   statements.push(db.prepare(`INSERT INTO catalog_retirement_history_events (
     event_type,product_id,product_name,stock_position_id,variant_id,
     material,length,category,gender,color,size_label,variant_count,created_at
   ) SELECT 'variant',cv.product_id,p.name,cv.stock_position_id,cv.id,
      cv.material,cv.length,cv.category,cv.gender,cv.color,cv.size_label,1,?
      FROM catalog_variants cv JOIN catalog_products p ON p.id=cv.product_id
      WHERE cv.id=? AND cv.is_active=0 AND cv.updated_at=?`).bind(now,id,now))
 }
 if(scope.kind==='product')statements.push(db.prepare(
   'UPDATE watch_products SET is_active=0 WHERE id=? AND brand_id=? AND is_active=1',
 ).bind(scope.model.id,brandId))
 if(!statements.length){
   return json({ok:true,alreadyDeleted:true,deletedCount:0})
 }
 // No forced warehouse writeoffs, no reservation release, no orphaning historical sales.
 const results=await db.batch(statements)
 const changed=results.slice(0,ids.length).reduce((n,r)=>n+Number(r.meta?.changes||0),0)
 if(changed!==ids.length)
   return fail('Состав товара изменился во время удаления. Обновите каталог и проверьте остатки.',409)
 return json({ok:true,deletedCount:changed,kind:scope.kind,
   productDeleted:scope.kind==='product',historyPreserved:true})
}
