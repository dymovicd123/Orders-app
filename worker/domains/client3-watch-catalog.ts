import { json } from '../core/http.ts'
import type { AuthUser } from '../core/types.ts'
import { normalizeWatchVariant, type WatchVariantInput } from '../../shared/client3/watch-domain.ts'

const error=(code:string,message:string,status=400)=>
  json({ok:false,code,message},{status})

/**
 * Watch catalog drafts are real catalog identities, but they are deliberately NOT
 * stock-bearing/sellable until linked to an exact canonical Main product/variant.
 * These writes must never synthesize a physical arrival or a zero-count stock row.
 */
export async function listWatchCatalogDrafts(db:D1Database,actor:AuthUser,brandId:number) {
  if(actor.role!=='admin')return error('WATCH_CATALOG_ADMIN_ONLY','Справочник часов изменяет администратор.',403)
  const records=await db.prepare(`
    SELECT wp.id AS watchProductId,wp.model_name AS modelName,
      wp.catalog_product_id AS catalogProductId,wp.is_active AS productActive,
      wv.id AS watchVariantId,wv.catalog_variant_id AS catalogVariantId,
      wv.gender,wv.movement,wv.bracelet_material AS braceletMaterial,
      wv.dial_color AS dialColor,wv.bracelet_color AS braceletColor,
      wv.is_active AS variantActive,
      (SELECT ep.sale_price FROM catalog_variants cv JOIN catalog_execution_prices ep ON ep.stock_position_id=cv.stock_position_id AND ep.category=COALESCE(cv.category,'adult') WHERE cv.id=wv.catalog_variant_id LIMIT 1) AS catalogPriceSnapshot,
      COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s WHERE s.variant_id=wv.catalog_variant_id AND s.inventory_source='warehouse'),0) AS officePhysical,
      MAX(COALESCE((SELECT SUM(s.reserved_quantity) FROM inventory_stock s WHERE s.variant_id=wv.catalog_variant_id AND s.inventory_source='warehouse'),0), COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=wv.catalog_variant_id AND r.inventory_source='warehouse' AND r.status='active'),0)) AS officeReserved,
      COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s WHERE s.variant_id=wv.catalog_variant_id AND s.inventory_source='boutique'),0) AS showcasePhysical,
      MAX(COALESCE((SELECT SUM(s.reserved_quantity) FROM inventory_stock s WHERE s.variant_id=wv.catalog_variant_id AND s.inventory_source='boutique'),0), COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=wv.catalog_variant_id AND r.inventory_source='boutique' AND r.status='active'),0)) AS showcaseReserved
    FROM watch_products wp
    LEFT JOIN watch_variants wv ON wv.watch_product_id=wp.id
    WHERE wp.brand_id=?
    ORDER BY wp.model_name COLLATE NOCASE,wp.id,wv.id
    LIMIT 500
  `).bind(brandId).all<Record<string,unknown>>()
  return json({ok:true,rows:records.results||[]})
}

const validName=(x:unknown):string=>{
  if(typeof x!=='string')throw new Error('Введите название модели.')
  const name=x.trim().replace(/\s+/g,' ')
  if(!name||name.length>150)throw new Error('Название модели должно содержать от 1 до 150 символов.')
  return name
}
export async function registerWatchModel(
  db:D1Database,actor:AuthUser,brandId:number,input:{modelName?:unknown},
) {
  if(actor.role!=='admin')return error('WATCH_CATALOG_ADMIN_ONLY','Добавлять модели может только администратор.',403)
  let name:string
  try{name=validName(input?.modelName)}catch(cause){
    return error('WATCH_MODEL_INVALID',cause instanceof Error?cause.message:'Некорректное название модели.')
  }
  // A unique (brand_id, model_name COLLATE NOCASE) constraint handles competing
  // requests. Only a created or already-identical name may succeed.
  const existing=await db.prepare(
    'SELECT id,is_active FROM watch_products WHERE brand_id=? AND model_name=? COLLATE NOCASE LIMIT 1',
  ).bind(brandId,name).first<{id:number;is_active:number}>()
  if(existing)return json({ok:true,watchProductId:existing.id,alreadyExists:true,active:existing.is_active===1})
  try {
    const inserted=await db.prepare(
      'INSERT INTO watch_products(brand_id,model_name) VALUES(?,?)',
    ).bind(brandId,name).run()
    const id=Number(inserted.meta?.last_row_id||0)
    if(!Number.isSafeInteger(id)||id<=0)throw new Error('Не удалось подтвердить создание модели.')
    return json({ok:true,watchProductId:id,created:true},{status:201})
  }catch(cause){
    const concurrentlyCreated=await db.prepare(
      'SELECT id,is_active FROM watch_products WHERE brand_id=? AND model_name=? COLLATE NOCASE LIMIT 1',
    ).bind(brandId,name).first<{id:number;is_active:number}>()
    if(concurrentlyCreated)return json({ok:true,watchProductId:concurrentlyCreated.id,alreadyExists:true,active:concurrentlyCreated.is_active===1})
    throw cause
  }
}

export async function registerWatchVariant(
  db:D1Database,actor:AuthUser,brandId:number,
  input:WatchVariantInput & {watchProductId?:unknown},
) {
  if(actor.role!=='admin')return error('WATCH_CATALOG_ADMIN_ONLY','Добавлять комплектации может только администратор.',403)
  const productId=Number(input?.watchProductId)
  if(!Number.isSafeInteger(productId)||productId<=0)return error('WATCH_MODEL_INVALID','Выберите модель часов.')
  let v:ReturnType<typeof normalizeWatchVariant>
  try{v=normalizeWatchVariant(input)}catch(cause){
    return error('WATCH_VARIANT_INVALID',cause instanceof Error?cause.message:'Некорректные характеристики часов.')
  }
  // Exactly Main's reference-driven characteristics, without brand partitioning.
  // A server-side membership check is necessary: no hand-typed unlisted SKU.
  for(const [kind,value] of [
    ['movements',v.movement],['bracelets',v.braceletMaterial],['dials',v.dialColor],
    ...(v.braceletMaterial==='leather'?[['leatherColors',v.braceletColor]]:[]),
  ]){
    const listed=await db.prepare(
      'SELECT value FROM watch_reference_values WHERE kind=? AND is_active=1',
    ).bind(kind).all<{value:string}>()
    if(!(listed.results||[]).some(row=>row.value.toLocaleUpperCase('ru-RU')===value.toLocaleUpperCase('ru-RU')))
      return error('WATCH_REFERENCE_NOT_FOUND','Характеристика «'+value+'» отсутствует в справочнике '+kind+'.',409)
  }
  const product=await db.prepare(
    'SELECT id FROM watch_products WHERE id=? AND brand_id=? AND is_active=1 LIMIT 1',
  ).bind(productId,brandId).first<{id:number}>()
  if(!product)return error('WATCH_MODEL_FORBIDDEN','Модель не существует в выбранном бренде.',404)
  const values=[productId,v.gender,v.movement,v.braceletMaterial,v.dialColor,v.braceletColor]
  const find='SELECT id,is_active,catalog_variant_id FROM watch_variants WHERE watch_product_id=? AND gender=? AND movement=? AND bracelet_material=? AND dial_color=? AND bracelet_color=? LIMIT 1'
  const old=await db.prepare(find).bind(...values).first<{id:number;is_active:number;catalog_variant_id:number|null}>()
  if(old){
    if(old.is_active===0) {
      // Existing identities remain historical; deliberate recreation reuses the
      // exact same SKU id only when no canonical conflicting retirement exists.
      return error('WATCH_VARIANT_RETIRED','Позиция ранее удалена. Создайте другую комплектацию либо обратитесь к администратору.',409)
    }
    return json({ok:true,watchVariantId:old.id,alreadyExists:true,active:true,stockLinked:old.catalog_variant_id!=null})
  }
  try{
    const result=await db.prepare(
      'INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(?,?,?,?,?,?)',
    ).bind(...values).run()
    const id=Number(result.meta?.last_row_id||0)
    if(!Number.isSafeInteger(id)||id<=0)throw new Error('Не удалось подтвердить комплектацию часов.')
    return json({ok:true,watchVariantId:id,created:true,stockLinked:false},{status:201})
  }catch(cause){
    const other=await db.prepare(find).bind(...values).first<{id:number;is_active:number;catalog_variant_id:number|null}>()
    if(other)return json({ok:true,watchVariantId:other.id,alreadyExists:true,active:other.is_active===1,stockLinked:other.catalog_variant_id!=null})
    throw cause
  }
}
