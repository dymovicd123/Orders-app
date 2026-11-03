import { json } from '../core/http.ts'
import type { AuthUser } from '../core/types.ts'
import { normalizeWatchVariant, type WatchVariantInput } from '../../shared/client3/watch-domain.ts'
import {findWatchModelByIdentity} from './client3-watch-model-aliases.ts'

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
      wv.gender,COALESCE(va.movement,wv.movement) AS movement,
      COALESCE(va.bracelet_material,wv.bracelet_material) AS braceletMaterial,
      COALESCE(va.dial_color,wv.dial_color) AS dialColor,
      COALESCE(va.bracelet_color,wv.bracelet_color) AS braceletColor,
      wv.is_active AS variantActive,
      (SELECT ep.sale_price FROM catalog_variants cv JOIN catalog_execution_prices ep ON ep.stock_position_id=cv.stock_position_id AND ep.category=COALESCE(cv.category,'adult') WHERE cv.id=wv.catalog_variant_id LIMIT 1) AS catalogPriceSnapshot,
      COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s WHERE s.variant_id=wv.catalog_variant_id AND s.inventory_source='warehouse'),0) AS officePhysical,
      MAX(COALESCE((SELECT SUM(s.reserved_quantity) FROM inventory_stock s WHERE s.variant_id=wv.catalog_variant_id AND s.inventory_source='warehouse'),0), COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=wv.catalog_variant_id AND r.inventory_source='warehouse' AND r.status='active'),0)) AS officeReserved,
      COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s WHERE s.variant_id=wv.catalog_variant_id AND s.inventory_source='boutique'),0) AS showcasePhysical,
      MAX(COALESCE((SELECT SUM(s.reserved_quantity) FROM inventory_stock s WHERE s.variant_id=wv.catalog_variant_id AND s.inventory_source='boutique'),0), COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=wv.catalog_variant_id AND r.inventory_source='boutique' AND r.status='active'),0)) AS showcaseReserved
    FROM watch_products wp
    LEFT JOIN watch_variants wv ON wv.watch_product_id=wp.id
    LEFT JOIN watch_variant_attributes_v5 va ON va.watch_variant_id=wv.id
    WHERE wp.brand_id=?
    ORDER BY wp.model_name COLLATE NOCASE,wp.id,wv.id
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
  db:D1Database,actor:AuthUser,brandId:number,input:{modelName?:unknown},options:{fromVerifiedOrder?:boolean}={},
) {
  if(actor.role!=='admin'&&!options.fromVerifiedOrder)return error('WATCH_CATALOG_ADMIN_ONLY','Добавлять модели может только администратор.',403)
  let name:string
  try{name=validName(input?.modelName)}catch(cause){
    return error('WATCH_MODEL_INVALID',cause instanceof Error?cause.message:'Некорректное название модели.')
  }
  // Main identity equality and explicit aliases must be checked *before*
  // inserting. Case/Kazakh-equivalent names never create competing model IDs.
  let existing: {id:number;is_active:number}|null
  try{existing=await findWatchModelByIdentity(db,brandId,name)}
  catch(cause){return error('WATCH_MODEL_AMBIGUOUS',
    cause instanceof Error?cause.message:'Модель неоднозначна.',409)}
  if(existing){
    if(existing.is_active===0){
      if(options.fromVerifiedOrder)return error('WATCH_MODEL_RETIRED','Эта модель была удалена из каталога. Администратор должен отдельно решить вопрос восстановления.',409)
      // Main restores the historical product shell without creating stock.
      await db.prepare('UPDATE watch_products SET is_active=1 WHERE id=? AND brand_id=? AND is_active=0')
        .bind(existing.id,brandId).run()
      return json({ok:true,watchProductId:existing.id,restored:true,active:true,stockCreated:false})
    }
    return json({ok:true,watchProductId:existing.id,alreadyExists:true,active:true})
  }
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
  options:{fromVerifiedOrder?:boolean}={},
) {
  if(actor.role!=='admin'&&!options.fromVerifiedOrder)return error('WATCH_CATALOG_ADMIN_ONLY','Добавлять комплектации может только администратор.',403)
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
    const name=['movements','bracelets','dials'].includes(kind)
      ?'watch_reference_values_v5':'watch_reference_values'
    const listed=await db.prepare(
      `SELECT value FROM ${name} WHERE kind=? AND is_active=1`,
    ).bind(kind).all<{value:string}>()
    if(!(listed.results||[]).some(row=>row.value.toLocaleUpperCase('ru-RU')===value.toLocaleUpperCase('ru-RU')))
      return error('WATCH_REFERENCE_NOT_FOUND','Характеристика «'+value+'» отсутствует в справочнике '+kind+'.',409)
  }
  const product=await db.prepare(
    'SELECT id FROM watch_products WHERE id=? AND brand_id=? AND is_active=1 LIMIT 1',
  ).bind(productId,brandId).first<{id:number}>()
  if(!product)return error('WATCH_MODEL_FORBIDDEN','Модель не существует в выбранном бренде.',404)
  const values=[productId,v.gender,v.movement,v.braceletMaterial,v.dialColor,v.braceletColor]
  const find=`SELECT v.id,v.is_active,v.catalog_variant_id FROM watch_variants v
    LEFT JOIN watch_variant_attributes_v5 va ON va.watch_variant_id=v.id
    WHERE v.watch_product_id=? AND v.gender=? AND
      COALESCE(va.movement,v.movement)=? AND
      COALESCE(va.bracelet_material,v.bracelet_material)=? AND
      COALESCE(va.dial_color,v.dial_color)=? AND
      COALESCE(va.bracelet_color,v.bracelet_color)=? LIMIT 1`
  const old=await db.prepare(find).bind(...values).first<{id:number;is_active:number;catalog_variant_id:number|null}>()
  if(old){
    if(old.is_active===0) {
      if(options.fromVerifiedOrder)return error('WATCH_VARIANT_RETIRED','Комплектация удалена. Не восстанавливайте её автоматически через создание заказа.',409)
      // Main restoration: revive the exact historical identity, but never invent
      // stock or repair any unrelated retired execution. No duplicate SKU is made.
      if(old.catalog_variant_id){
        const owner=await db.prepare(`SELECT cv.id,cp.is_active AS product_active,
          sp.is_active AS execution_active
          FROM catalog_variants cv JOIN catalog_products cp ON cp.id=cv.product_id
          JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id
          WHERE cv.id=?`).bind(old.catalog_variant_id)
          .first<{id:number;product_active:number;execution_active:number}>()
        if(!owner||owner.product_active!==1||owner.execution_active!==1)
          return error('WATCH_RESTORE_BLOCKED','Историческое исполнение удалено отдельно. Сначала проверьте его восстановление.',409)
        await db.batch([
          db.prepare('UPDATE catalog_variants SET is_active=1 WHERE id=? AND is_active=0').bind(old.catalog_variant_id),
          db.prepare('UPDATE watch_variants SET is_active=1 WHERE id=? AND watch_product_id=? AND is_active=0').bind(old.id,productId),
        ])
      }else{
        await db.prepare('UPDATE watch_variants SET is_active=1 WHERE id=? AND watch_product_id=? AND is_active=0')
          .bind(old.id,productId).run()
      }
      return json({ok:true,watchVariantId:old.id,restored:true,active:true,
        stockLinked:old.catalog_variant_id!=null,stockCreated:false})
    }
    return json({ok:true,watchVariantId:old.id,alreadyExists:true,active:true,stockLinked:old.catalog_variant_id!=null})
  }
  try{
    const legacy=['quartz','mechanical'].includes(v.movement) &&
      ['steel','leather','rubber'].includes(v.braceletMaterial) &&
      ['black','white','silver','gold','green','orange','brown','multicolor'].includes(v.dialColor) &&
      // New reference colours must not be forced into the original constrained
      // watch_variants columns. Store the actual custom value in v5 attributes.
      (v.braceletMaterial!=='leather'||!v.braceletColor||
        ['ЧЁРНЫЙ','КОРИЧНЕВЫЙ'].includes(v.braceletColor))
    // Old constrained columns remain as FK-safe compatibility anchors.
    // Custom values live in additive columns, while the randomized leather
    // sentinel guarantees the old UNIQUE key never merges separate SKU IDs.
    const anchor=legacy?[v.movement,v.braceletMaterial,v.dialColor,v.braceletColor]:
      ['quartz','leather','black','__WATCH_V5__'+crypto.randomUUID().replaceAll('-','')]
    const insert=db.prepare(
      'INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(?,?,?,?,?,?)'
    ).bind(productId,v.gender,...anchor)
    const result=legacy?await insert.run():(await db.batch([
      insert,
      db.prepare(`INSERT INTO watch_variant_attributes_v5(
        watch_variant_id,watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color
      ) SELECT id,watch_product_id,gender,?,?,?,? FROM watch_variants
        WHERE watch_product_id=? AND gender=? AND bracelet_color=?`)
        .bind(v.movement,v.braceletMaterial,v.dialColor,v.braceletColor,productId,v.gender,anchor[3]),
    ]))[0]
    const id=Number(result.meta?.last_row_id||0)
    if(!Number.isSafeInteger(id)||id<=0)throw new Error('Не удалось подтвердить комплектацию часов.')
    return json({ok:true,watchVariantId:id,created:true,stockLinked:false},{status:201})
  }catch(cause){
    const other=await db.prepare(find).bind(...values).first<{id:number;is_active:number;catalog_variant_id:number|null}>()
    if(other)return json({ok:true,watchVariantId:other.id,alreadyExists:true,active:other.is_active===1,stockLinked:other.catalog_variant_id!=null})
    throw cause
  }
}
