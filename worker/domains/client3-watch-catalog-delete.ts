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
 const historicalItems=scope.kind==='product'
   ?await db.prepare(`SELECT COUNT(*) AS qty FROM order_items oi
     JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
     JOIN watch_variants v ON v.id=wi.watch_variant_id
     WHERE v.watch_product_id=?`).bind(scope.model.id).first<{qty:number}>()
   :scope.items.length?await db.prepare(`SELECT COUNT(*) AS qty
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
       const outcome=await retireCatalogEntity(db,'product',canonicalId,{
         requestId,reason:'Удалён товар часов '+scope.model.model_name+' из Client3',
         actor:actor.displayName||actor.email||'Администратор',
       })
       if(outcome.status&&outcome.status!=='completed')
         return fail('Удаление Main не завершено. Прервана проверка журнала — рабочая модель не скрыта.',409)
       const fresh=await previewCatalogRetirement(db,'product',canonicalId)
       if(fresh.active||fresh.activeVariantCount>0||fresh.physicalQuantity!==0||
          fresh.stockReservedQuantity!==0||fresh.activeReservationQuantity!==0||
          fresh.inactiveOperationalVariantCount>0)
         return fail('Main не подтвердил полный вывод остатков, резервов и складских SKU. Обновите каталог перед повтором.',409)
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
 const statements:D1PreparedStatement[]=[]
 if(!ids.length)return fail('В выбранной группе нет действующих позиций.',409)
 const placeholders=ids.map(()=>'?').join(',')
 // Exactly as in Main's granular group removal: a single conditional UPDATE
 // applies to the *whole* selected set, not one SKU at a time. MATERIALIZED
 // preflight is evaluated before mutation, so a stale concurrent reservation,
 // open order, stocktake or lifecycle blocks every SKU in the group.
 statements.push(db.prepare(`
   WITH checked AS MATERIALIZED (
     SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN
         EXISTS(SELECT 1 FROM inventory_stock st
           WHERE st.variant_id=v.catalog_variant_id
             AND (COALESCE(st.quantity,0)<>0 OR COALESCE(st.reserved_quantity,0)<>0))
         OR EXISTS(SELECT 1 FROM inventory_reservations r
           WHERE r.variant_id=v.catalog_variant_id AND r.status='active')
         OR EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
           WHERE oi.variant_id=v.catalog_variant_id
             AND COALESCE(o.order_status,'active')='active'
             AND COALESCE(o.shipping_status,'not_sent')<>'sent' AND oi.quantity>0)
         OR EXISTS(SELECT 1 FROM inventory_stocktake_items i
           JOIN inventory_stocktake_sessions ss ON ss.id=i.session_id
           WHERE i.variant_id=v.catalog_variant_id AND ss.status='active')
         OR EXISTS(SELECT 1 FROM inventory_lifecycle_events e
           WHERE e.variant_id=v.catalog_variant_id AND e.status='pending')
         OR EXISTS(SELECT 1 FROM workshop_tasks t
           WHERE t.variant_id=v.catalog_variant_id AND t.status='active')
       THEN 1 ELSE 0 END),0) AS unsafe
     FROM watch_variants v WHERE v.id IN (${placeholders})
       AND v.watch_product_id=? AND v.is_active=1
   )
   UPDATE watch_variants SET is_active=0
   WHERE id IN (${placeholders}) AND watch_product_id=? AND is_active=1
     AND (SELECT total=? AND unsafe=0 FROM checked)`
 ).bind(...ids,scope.model.id,...ids,scope.model.id,ids.length))
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
 if(!statements.length){
   return json({ok:true,alreadyDeleted:true,deletedCount:0})
 }
 // No forced warehouse writeoffs, no reservation release, no orphaning historical sales.
 const results=await db.batch(statements)
 const changed=Number(results[0]?.meta?.changes||0)
 if(changed!==ids.length)
   return fail('Состав товара изменился во время удаления. Обновите каталог и проверьте остатки.',409)
 return json({ok:true,deletedCount:changed,kind:scope.kind,
   productDeleted:false,historyPreserved:true})
}


/** Read-only archive. All records remain in the original watch and canonical
 * identity tables, so order lines, exchange history and stock movements keep
 * their original IDs. No migration and no physical inventory mutation. */
export async function listClient3WatchRetiredCatalog(
 db:D1Database,actor:AuthUser,brandId:number,url:URL,
){
 if(actor.role!=='admin'&&actor.employeeRole!=='Завсклад')
   return fail('Просмотр архива каталога доступен администратору и заведующему складом.',403)
 const offset=Number(url.searchParams.get('offset')||0)
 if(!Number.isSafeInteger(offset)||offset<0||offset>100000)
   return fail('Неправильная страница архива.',400)
 const rows=await db.prepare(`SELECT wp.id AS watchProductId,
   wp.model_name AS modelName,
   CASE WHEN wp.is_active=1 AND (wp.catalog_product_id IS NULL OR cp.is_active=1)
     THEN 1 ELSE 0 END AS productActive,
   v.id AS watchVariantId,
   CASE WHEN v.id IS NULL THEN NULL
     WHEN v.is_active=1 AND (v.catalog_variant_id IS NULL OR
       (cv.is_active=1 AND cp.is_active=1 AND sp.is_active=1))
     THEN 1 ELSE 0 END AS variantActive,
   v.catalog_variant_id AS catalogVariantId,
   v.gender,COALESCE(va.movement,v.movement) AS movement,
   COALESCE(va.bracelet_material,v.bracelet_material) AS braceletMaterial,
   COALESCE(va.dial_color,v.dial_color) AS dialColor,
   COALESCE(va.bracelet_color,v.bracelet_color) AS braceletColor,
   COALESCE((
     SELECT MAX(e.created_at) FROM catalog_retirement_history_events e
     WHERE e.variant_id=v.catalog_variant_id
   ),'') AS variantRetiredAt,
   COALESCE((
     SELECT MAX(op.completed_at) FROM catalog_retirement_operations op
     WHERE op.entity_type='product' AND op.entity_id=wp.catalog_product_id
       AND op.status='completed'
   ),'') AS modelRetiredAt,
   COALESCE((SELECT COUNT(*) FROM order_items oi
     JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
     WHERE wi.watch_variant_id=v.id),0) AS historicItemCount
 FROM watch_products wp
 LEFT JOIN watch_variants v ON v.watch_product_id=wp.id
 LEFT JOIN watch_variant_attributes_v5 va ON va.watch_variant_id=v.id
 LEFT JOIN catalog_products cp ON cp.id=wp.catalog_product_id
 LEFT JOIN catalog_variants cv ON cv.id=v.catalog_variant_id
 LEFT JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id
 WHERE wp.brand_id=? AND (wp.is_active=0 OR v.is_active=0 OR
   (wp.catalog_product_id IS NOT NULL AND COALESCE(cp.is_active,0)=0) OR
   (v.catalog_variant_id IS NOT NULL AND
     (COALESCE(cv.is_active,0)=0 OR COALESCE(sp.is_active,0)=0)))
 ORDER BY COALESCE(NULLIF(modelRetiredAt,''),NULLIF(variantRetiredAt,''),'') DESC,
   wp.id DESC, v.id DESC LIMIT 101 OFFSET ?`)
  .bind(brandId,offset).all<Record<string,unknown>>()
 const records=rows.results||[]
 return json({ok:true,brandId,rows:records.slice(0,100),
   hasMore:records.length>100,nextOffset:offset+Math.min(100,records.length)})
}
