import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {normalizeWatchVariant,type WatchVariantInput} from '../../shared/client3/watch-domain.ts'
import {catalogVariantHasOperationalUsage,ensureCatalogExecutionV3,findCatalogCombinationV3} from './catalog.ts'
import {materialFor,genderFor,dialFor,WATCH_LENGTH} from './client3-watch-provision.ts'
import {findWatchModelByIdentity} from './client3-watch-model-aliases.ts'

const error=(message:string,status=400)=>json({ok:false,message},{status})
const clean=(x:unknown)=>typeof x==='string'?x.trim().replace(/\s+/g,' '):''
const id=(x:unknown)=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0

/** Main-style model rename: only the display name, never the canonical product ID. */
export async function editClient3WatchModel(db:D1Database,actor:AuthUser,brandId:number,
 input:{watchProductId?:unknown;expectedName?:unknown;modelName?:unknown}){
 if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад'))return error('Изменять товары может только администратор.',403)
 const productId=id(input.watchProductId),name=clean(input.modelName),expected=clean(input.expectedName)
 if(!productId||!expected||!name||name.length>150)return error('Выберите модель и укажите корректное название (до 150 символов).')
 const current=await db.prepare('SELECT id,model_name,is_active FROM watch_products WHERE id=? AND brand_id=?')
   .bind(productId,brandId).first<{id:number;model_name:string;is_active:number}>()
 if(!current||current.is_active!==1)return error('Товар удалён или недоступен в этом бренде.',404)
 if(current.model_name!==expected)return error('Название уже изменилось. Обновите каталог перед сохранением.',409)
 if(current.model_name===name)return json({ok:true,unchanged:true,watchProductId:productId,modelName:name})
 const duplicate=await db.prepare('SELECT id FROM watch_products WHERE brand_id=? AND model_name=? COLLATE NOCASE AND id<>? LIMIT 1')
   .bind(brandId,name,productId).first<{id:number}>()
 if(duplicate)return error('В этом бренде уже есть модель с таким названием.',409)
 try{
   const identity=await findWatchModelByIdentity(db,brandId,name)
   if(identity&&identity.id!==productId)
     return error('Название совпадает с другой моделью или её псевдонимом. Сначала разберите конфликт.',409)
 }catch(e){
   return error(e instanceof Error?e.message:'Название модели неоднозначно.',409)
 }
 try{
   const saved=await db.prepare('UPDATE watch_products SET model_name=? WHERE id=? AND brand_id=? AND is_active=1 AND model_name=?')
     .bind(name,productId,brandId,expected).run()
   if(Number(saved.meta?.changes||0)!==1)return error('Товар изменился одновременно. Обновите каталог.',409)
   return json({ok:true,watchProductId:productId,modelName:name})
 }catch{return error('Название занято другой моделью. Обновите каталог.',409)}
}

const cols=[
 ['movements','movement'],
 ['bracelets','braceletMaterial'],
 ['dials','dialColor'],
 ['leatherColors','braceletColor'],
] as const
type EditInput=WatchVariantInput&{watchVariantId?:unknown;watchProductId?:unknown;
 expected?:WatchVariantInput}

/** Exact Main rule: an SKU with operational history is immutable. Linked but
 * never-used SKUs can be edited in place, preserving their canonical ID.
 */
export async function editClient3WatchVariant(db:D1Database,actor:AuthUser,brandId:number,input:EditInput){
 if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад'))return error('Редактирование позиций доступно только администратору.',403)
 const variantId=id(input.watchVariantId),productId=id(input.watchProductId)
 if(!variantId||!productId||!input.expected)return error('Выберите позицию и обновите её карточку.',400)
 let next:ReturnType<typeof normalizeWatchVariant>,expected:ReturnType<typeof normalizeWatchVariant>
 try{
   next=normalizeWatchVariant(input)
   expected=normalizeWatchVariant(input.expected)
 }catch(e){return error(e instanceof Error?e.message:'Некорректные характеристики.')}
 const row=await db.prepare(`SELECT v.id,v.gender,v.catalog_variant_id,wp.is_active AS product_active,
   COALESCE(a6.movement,a.movement,v.movement) AS movement,
   COALESCE(a6.bracelet_material,a.bracelet_material,v.bracelet_material) AS bracelet_material,
   COALESCE(a6.dial_color,a.dial_color,v.dial_color) AS dial_color,
   COALESCE(a6.bracelet_color,a.bracelet_color,v.bracelet_color) AS bracelet_color
   FROM watch_variants v
   JOIN watch_products wp ON wp.id=v.watch_product_id AND wp.brand_id=?
   LEFT JOIN watch_variant_attributes_v5 a ON a.watch_variant_id=v.id
   LEFT JOIN watch_variant_attributes_v6 a6 ON a6.watch_variant_id=v.id
   WHERE v.id=? AND v.watch_product_id=? AND v.is_active=1`)
   .bind(brandId,variantId,productId).first<{id:number;gender:string;catalog_variant_id:number|null;
     movement:string;bracelet_material:string;dial_color:string;bracelet_color:string;product_active:number}>()
 if(!row||row.product_active!==1)return error('Позиция уже удалена или не принадлежит выбранному бренду.',404)
 const actual=[row.gender,row.movement,row.bracelet_material,row.dial_color,row.bracelet_color]
 const prev=[expected.gender,expected.movement,expected.braceletMaterial,expected.dialColor,expected.braceletColor]
 if(JSON.stringify(actual)!==JSON.stringify(prev))
   return error('Характеристики уже изменились. Обновите каталог и повторите исправление.',409)
 const after=[next.gender,next.movement,next.braceletMaterial,next.dialColor,next.braceletColor]
 if(JSON.stringify(prev)===JSON.stringify(after))return json({ok:true,unchanged:true,watchVariantId:variantId})
 for(const [kind,key] of cols){
   if(kind==='leatherColors'&&next.braceletMaterial!=='leather')continue
   const table=kind==='leatherColors'?'watch_reference_values':'watch_reference_values_v5'
   const values=await db.prepare(`SELECT value FROM ${table} WHERE kind=? AND is_active=1`)
     .bind(kind).all<{value:string}>()
   if(!(values.results||[]).some(x=>x.value.toLocaleUpperCase('ru-RU')===next[key].toLocaleUpperCase('ru-RU')))
     return error('Значение «'+next[key]+'» отсутствует в общем справочнике. Сначала добавьте его.',409)
 }
 const collision=await db.prepare(`SELECT v.id FROM watch_variants v
   LEFT JOIN watch_variant_attributes_v5 a ON a.watch_variant_id=v.id
   LEFT JOIN watch_variant_attributes_v6 a6 ON a6.watch_variant_id=v.id
   WHERE v.watch_product_id=? AND v.is_active=1 AND v.id<>?
   AND v.gender=?
   AND COALESCE(a6.movement,a.movement,v.movement)=?
   AND COALESCE(a6.bracelet_material,a.bracelet_material,v.bracelet_material)=?
   AND COALESCE(a6.dial_color,a.dial_color,v.dial_color)=?
   AND COALESCE(a6.bracelet_color,a.bracelet_color,v.bracelet_color)=? LIMIT 1`)
   .bind(productId,variantId,...after).first<{id:number}>()
 if(collision)return error('Такая комплектация уже существует. Выберите её вместо создания дубля.',409)
 if(row.catalog_variant_id){
   const canonicalId=row.catalog_variant_id
   const owned=await db.prepare(`SELECT cv.id,cv.product_id,cv.stock_position_id,
       cv.is_active,cp.is_active AS product_active,sp.is_active AS execution_active
       FROM catalog_variants cv
       JOIN catalog_products cp ON cp.id=cv.product_id
       JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id
       JOIN watch_products wp ON wp.catalog_product_id=cv.product_id
       WHERE cv.id=? AND wp.id=? AND wp.brand_id=?`)
     .bind(canonicalId,productId,brandId).first<{
       id:number;product_id:number;stock_position_id:number;is_active:number;
       product_active:number;execution_active:number
     }>()
   if(!owned||owned.is_active!==1||owned.product_active!==1||owned.execution_active!==1)
     return error('Складской SKU или исполнение уже удалены. Обновите каталог.',409)
   if(await catalogVariantHasOperationalUsage(db,canonicalId))
     return error('Эта позиция уже участвовала в заказах, приходе, пересчётах, резервах или других движениях. Как в Main, её идентичность менять нельзя. Создайте правильную комплектацию отдельно, затем удалите старую после разбора остатков.',409)
   const material=materialFor({movement:next.movement,bracelet_material:next.braceletMaterial,
     bracelet_color:next.braceletColor})
   const gender=genderFor(next.gender),color=dialFor(next.dialColor)
   const now=new Date().toISOString()
   let execution:{id:number}
   try{
     execution=await ensureCatalogExecutionV3(db,owned.product_id,material,WATCH_LENGTH,now)
     const same=await findCatalogCombinationV3(db,execution.id,'adult',gender,color,'',canonicalId)
     if(same?.id)return error('В складском каталоге уже есть такая комбинация. Выберите её вместо создания дубля.',409)
   }catch(e){return error(e instanceof Error?e.message:'Не удалось проверить исполнение часов.',409)}
   const sentinel='__WATCH_V5__'+crypto.randomUUID().replaceAll('-','')
   try{
     const result=await db.batch([
       // Guard the Main operational ledger again at commit time.
       db.prepare(`UPDATE catalog_variants
         SET stock_position_id=?,gender=?,color=?,material=?,length=?,updated_at=?
         WHERE id=? AND product_id=? AND is_active=1 AND stock_position_id=?
           AND NOT EXISTS(SELECT 1 FROM order_items oi WHERE oi.variant_id=catalog_variants.id)
           AND NOT EXISTS(SELECT 1 FROM inventory_stock st WHERE st.variant_id=catalog_variants.id)
           AND NOT EXISTS(SELECT 1 FROM inventory_movements im WHERE im.variant_id=catalog_variants.id)
           AND NOT EXISTS(SELECT 1 FROM inventory_reservations ir WHERE ir.variant_id=catalog_variants.id)
           AND NOT EXISTS(SELECT 1 FROM inventory_lifecycle_events le WHERE le.variant_id=catalog_variants.id)
           AND NOT EXISTS(SELECT 1 FROM inventory_transfer_items ti WHERE ti.variant_id=catalog_variants.id)
           AND NOT EXISTS(SELECT 1 FROM inventory_stocktake_items si WHERE si.variant_id=catalog_variants.id)
           AND NOT EXISTS(SELECT 1 FROM inventory_stock_checks sc WHERE sc.variant_id=catalog_variants.id)
           AND NOT EXISTS(SELECT 1 FROM workshop_tasks wt WHERE wt.variant_id=catalog_variants.id)`)
         .bind(execution.id,gender,color,material,WATCH_LENGTH,now,canonicalId,owned.product_id,owned.stock_position_id),
       db.prepare(`UPDATE watch_variants SET gender=?,movement='quartz',
         bracelet_material='leather',dial_color='black',bracelet_color=?
         WHERE id=? AND watch_product_id=? AND is_active=1 AND catalog_variant_id=?
           AND EXISTS (SELECT 1 FROM catalog_variants cv
             WHERE cv.id=? AND cv.stock_position_id=? AND cv.updated_at=? AND cv.is_active=1)`)
         .bind(next.gender,sentinel,variantId,productId,canonicalId,canonicalId,execution.id,now),
       db.prepare(`INSERT INTO watch_variant_attributes_v6(
         watch_variant_id,watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color
       ) SELECT v.id,v.watch_product_id,v.gender,?,?,?,?
         FROM watch_variants v
         WHERE v.id=? AND v.catalog_variant_id=? AND v.bracelet_color=?
         ON CONFLICT(watch_variant_id) DO UPDATE SET gender=excluded.gender,
           movement=excluded.movement,bracelet_material=excluded.bracelet_material,
           dial_color=excluded.dial_color,bracelet_color=excluded.bracelet_color`)
         .bind(next.movement,next.braceletMaterial,next.dialColor,next.braceletColor,variantId,canonicalId,sentinel),
       // Keep the catalogue sale/cost snapshot when a new execution has no price yet.
       db.prepare(`INSERT OR IGNORE INTO catalog_execution_prices(
         stock_position_id,category,cost_price,sale_price,created_at,updated_at)
         SELECT ?,ep.category,ep.cost_price,ep.sale_price,?,?
         FROM catalog_execution_prices ep
         WHERE ep.stock_position_id=? AND ep.category='adult'
           AND EXISTS(SELECT 1 FROM catalog_variants cv
             WHERE cv.id=? AND cv.updated_at=? AND cv.stock_position_id=?)`)
         .bind(execution.id,now,now,owned.stock_position_id,canonicalId,now,execution.id),
     ])
     if(result.slice(0,3).some(x=>Number(x.meta?.changes||0)!==1))
       return error('Складской SKU изменился одновременно. Обновите каталог и проверьте результат перед повтором.',409)
     return json({ok:true,watchVariantId:variantId,canonicalVariantId:canonicalId,
       edited:true,historyPreserved:true,stockCreated:false})
   }catch{
     return error('Изменение SKU не удалось. Обновите каталог и проверьте связанные операции; историю не переписываем.',409)
   }
 }
 try{
   // Move the old constrained identity to an opaque unique sentinel. Otherwise
   // editing a draft leaves its previous LEGACY UNIQUE key occupied, preventing a
   // correct new watch from using that former combination. Preserve the watch ID.
   const sentinel='__WATCH_V5__'+crypto.randomUUID().replaceAll('-','')
   const result=await db.batch([
     db.prepare(`UPDATE watch_variants AS v
       SET gender=?,movement='quartz',bracelet_material='leather',
         dial_color='black',bracelet_color=?
       WHERE id=? AND watch_product_id=? AND is_active=1
         AND catalog_variant_id IS NULL AND gender=?
         AND COALESCE(COALESCE((SELECT a6.movement FROM watch_variant_attributes_v6 a6 WHERE a6.watch_variant_id=v.id),(SELECT a.movement FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=v.id)),v.movement)=?
         AND COALESCE(COALESCE((SELECT a6.bracelet_material FROM watch_variant_attributes_v6 a6 WHERE a6.watch_variant_id=v.id),(SELECT a.bracelet_material FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=v.id)),v.bracelet_material)=?
         AND COALESCE(COALESCE((SELECT a6.dial_color FROM watch_variant_attributes_v6 a6 WHERE a6.watch_variant_id=v.id),(SELECT a.dial_color FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=v.id)),v.dial_color)=?
         AND COALESCE(COALESCE((SELECT a6.bracelet_color FROM watch_variant_attributes_v6 a6 WHERE a6.watch_variant_id=v.id),(SELECT a.bracelet_color FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=v.id)),v.bracelet_color)=?`)
       .bind(next.gender,sentinel,variantId,productId,...prev),
     db.prepare(`INSERT INTO watch_variant_attributes_v6(
       watch_variant_id,watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color
     ) SELECT v.id,v.watch_product_id,v.gender,?,?,?,?
       FROM watch_variants v
       WHERE v.id=? AND v.watch_product_id=? AND v.is_active=1
         AND v.catalog_variant_id IS NULL AND v.bracelet_color=?
       ON CONFLICT(watch_variant_id) DO UPDATE SET
         gender=excluded.gender,movement=excluded.movement,
         bracelet_material=excluded.bracelet_material,dial_color=excluded.dial_color,
         bracelet_color=excluded.bracelet_color`)
       .bind(next.movement,next.braceletMaterial,next.dialColor,next.braceletColor,variantId,productId,sentinel),
   ])
   if(Number(result[0].meta?.changes||0)!==1||Number(result[1].meta?.changes||0)!==1)
     return error('Позиция изменилась во время сохранения. Обновите каталог.',409)
   return json({ok:true,watchVariantId:variantId,edited:true,stockCreated:false,historyPreserved:true})
 }catch{
   return error('Не удалось обновить: позиция могла измениться одновременно или стать дубликатом. Обновите список.',409)
 }
}
