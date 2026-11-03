import { json } from '../core/http.ts'
import type { AuthUser } from '../core/types.ts'
import { createCatalogCombinationV3, ensureCatalogExecutionV3 } from './catalog.ts'
import type { WatchBrand } from '../../shared/client3/watch-domain.ts'

const bad = (code:string,message:string,status=400) => json({ok:false,code,message},{status})
const codeForProduct = (brand:WatchBrand,id:number) => 'WATCH_' + brand + '_MODEL_' + id
export const materialFor = (row:{movement:string;bracelet_material:string;bracelet_color:string}) =>
  ['WATCH',row.movement,row.bracelet_material,...(row.bracelet_material==='leather'?[row.bracelet_color]:[])].join('_').toUpperCase()
export const genderFor=(gender:string)=>gender==='male'?'МУЖ':'ЖЕН'
export const dialFor=(dial:string)=>'WATCH_DIAL_'+dial.toUpperCase()
export const WATCH_LENGTH='СТАНДАРТ'

/**
 * Administrator-owned, retry-safe identity provisioning.
 *
 * This only registers catalog_products/stock_positions/variants and links
 * them to their watch identities. It NEVER creates inventory_stock or movements.
 * The stable canonical name is internal: manager UI always displays model_name.
 *
 * W1c migration compatibility and successful isolated QA are prerequisites to
 * enabling this on a real Client3 database.
 */
export async function provisionClient3WatchSku(
  db:D1Database,actor:AuthUser,brandId:number,watchVariantId:number,
 options:{fromVerifiedOrder?:boolean}={},
) {
  if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад')&&!options.fromVerifiedOrder)return bad('WATCH_SKU_ADMIN_ONLY','Подготовить складскую идентичность может только администратор.',403)
  if(!Number.isSafeInteger(brandId)||brandId<=0||!Number.isSafeInteger(watchVariantId)||watchVariantId<=0)
    return bad('WATCH_SKU_INVALID','Выберите комплектацию часов.')

  const row=await db.prepare(`
    SELECT v.id,v.watch_product_id,v.catalog_variant_id,v.gender,
      COALESCE(va.movement,v.movement) AS movement,
      COALESCE(va.bracelet_material,v.bracelet_material) AS bracelet_material,
      COALESCE(va.dial_color,v.dial_color) AS dial_color,
      COALESCE(va.bracelet_color,v.bracelet_color) AS bracelet_color,
      wp.brand_id,wp.catalog_product_id,wp.model_name,b.code AS brand
    FROM watch_variants v
    JOIN watch_products wp ON wp.id=v.watch_product_id AND wp.is_active=1
    LEFT JOIN watch_variant_attributes_v5 va ON va.watch_variant_id=v.id
    JOIN watch_brands b ON b.id=wp.brand_id AND b.is_active=1
    WHERE v.id=? AND wp.brand_id=? AND v.is_active=1 LIMIT 1
  `).bind(watchVariantId,brandId).first<{
    id:number;watch_product_id:number;catalog_variant_id:number|null;
    gender:string;movement:string;bracelet_material:string;dial_color:string;
    bracelet_color:string;brand_id:number;catalog_product_id:number|null;
    model_name:string;brand:WatchBrand
  }>()
  if(!row)return bad('WATCH_SKU_NOT_FOUND','Часы не существуют в выбранном бренде.',404)

  const canonicalName=codeForProduct(row.brand,row.watch_product_id)
  const existingProduct=await db.prepare(
    'SELECT id,name,category,gender_scope,is_active FROM catalog_products WHERE name=? LIMIT 1',
  ).bind(canonicalName).first<{id:number;name:string;category:string;gender_scope:string;is_active:number}>()
  if(existingProduct && (existingProduct.is_active!==1 ||
      existingProduct.category!=='adult' || existingProduct.gender_scope!=='unisex'))
    return bad('WATCH_CANONICAL_NAME_CONFLICT','Внутреннее имя часов занято несовместимой записью.',409)
  const alreadyLinked=Number(row.catalog_product_id||0)
  if(alreadyLinked&&existingProduct?.id!==alreadyLinked)
    return bad('WATCH_CANONICAL_PRODUCT_CONFLICT','Модель ранее связана с другой складской карточкой.',409)

  let productId=alreadyLinked
  if(!productId){
    if(existingProduct?.id) productId=existingProduct.id
    else{
      try{
        const now=new Date().toISOString()
        const created=await db.prepare(
          "INSERT INTO catalog_products (name,category,gender_scope,is_active,created_at,updated_at) VALUES (?,'adult','unisex',1,?,?)",
        ).bind(canonicalName,now,now).run()
        productId=Number(created.meta?.last_row_id||0)
      }catch{
        // A simultaneous registration may have created the same canonical name.
        const concurrent=await db.prepare(
          "SELECT id FROM catalog_products WHERE name=? AND is_active=1 AND category='adult' AND gender_scope='unisex'",
        ).bind(canonicalName).first<{id:number}>()
        if(!concurrent?.id)return bad('WATCH_CANONICAL_PRODUCT_CONFLICT','Не удалось создать отдельную карточку часов.',409)
        productId=concurrent.id
      }
    }
    if(!productId)return bad('WATCH_CANONICAL_PRODUCT_CONFLICT','Не удалось подтвердить товар часов.',409)
    const set=await db.prepare(
      'UPDATE watch_products SET catalog_product_id=? WHERE id=? AND brand_id=? AND catalog_product_id IS NULL',
    ).bind(productId,row.watch_product_id,brandId).run()
    const pinned=await db.prepare('SELECT catalog_product_id FROM watch_products WHERE id=?')
      .bind(row.watch_product_id).first<{catalog_product_id:number|null}>()
    if(pinned?.catalog_product_id!==productId)
      return bad('WATCH_CANONICAL_PRODUCT_CONFLICT','Модель одновременно связали с другой складской карточкой.',409)
    void set
  }
  // A catalog product can never be used by a different watch model or brand.
  const ownership=await db.prepare(
    'SELECT brand_id,id FROM watch_products WHERE catalog_product_id=? LIMIT 1',
  ).bind(productId).first<{brand_id:number;id:number}>()
  if(ownership?.id!==row.watch_product_id||ownership.brand_id!==brandId)
    return bad('WATCH_CANONICAL_PRODUCT_CONFLICT','Обнаружена конфликтующая идентичность бренда.',409)

  const canonicalMaterial=materialFor(row)
  const now=new Date().toISOString()
  const execution=await ensureCatalogExecutionV3(db,productId,canonicalMaterial,WATCH_LENGTH,now)
  const canonicalVariant=await createCatalogCombinationV3(db,{
    productId,executionId:execution.id,category:'adult',gender:genderFor(row.gender),
    color:dialFor(row.dial_color),material:canonicalMaterial,length:WATCH_LENGTH,
    sizeLabel:'',sortOrder:0,
  },now)
  const variantId=Number(canonicalVariant.id)
  if(!variantId)return bad('WATCH_CANONICAL_VARIANT_CONFLICT','Не удалось связать комплектацию.',409)
  if(row.catalog_variant_id&&row.catalog_variant_id!==variantId)
    return bad('WATCH_CANONICAL_VARIANT_CONFLICT','Комплектация уже связана с другим складским SKU.',409)

  // Link only after canonical product/stock execution/variant exist.
  if(!row.catalog_variant_id){
    await db.prepare(
      'UPDATE watch_variants SET catalog_variant_id=? WHERE id=? AND watch_product_id=? AND catalog_variant_id IS NULL',
    ).bind(variantId,watchVariantId,row.watch_product_id).run()
  }
  const linked=await db.prepare(`
    SELECT wp.catalog_product_id AS product_id,v.catalog_variant_id AS variant_id,
      cv.product_id AS canonical_product_id,cv.stock_position_id AS execution_id,
      cv.is_active AS variant_active
    FROM watch_variants v JOIN watch_products wp ON wp.id=v.watch_product_id
    LEFT JOIN catalog_variants cv ON cv.id=v.catalog_variant_id
    WHERE v.id=? AND wp.brand_id=? LIMIT 1
  `).bind(watchVariantId,brandId).first<Record<string,unknown>>()
  if(Number(linked?.product_id)!==productId||Number(linked?.variant_id)!==variantId ||
     Number(linked?.canonical_product_id)!==productId ||
     Number(linked?.execution_id)!==Number(execution.id)||Number(linked?.variant_active)!==1)
    return bad('WATCH_CANONICAL_VARIANT_CONFLICT','Подтверждение складского SKU не удалось. Повторите действие.',409)

  return json({ok:true,brand:row.brand,watchProductId:row.watch_product_id,
    watchVariantId,canonicalProductId:productId,canonicalVariantId:variantId,
    stockCreated:false,physicalQuantityUnchanged:true})
}
