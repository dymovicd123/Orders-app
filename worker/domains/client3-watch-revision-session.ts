import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {watchSourceToLegacy,type WatchSource} from '../../shared/client3/watch-domain.ts'
import {
  addInventoryStocktakeVariant,cancelInventoryStocktakeSession,
  completeInventoryStocktakeSession,inventoryStocktakeSessionId,
  saveInventoryStocktakeCount,serializeInventoryStocktakeSession,
} from './inventory-stocktake.ts'

const error=(message:string,status=409,code='WATCH_REVISION_ERROR')=>
  json({ok:false,code,message},{status})
const owner=(brandId:number)=>'client3-watch-brand:'+brandId+':'
const validSource=(v:unknown):v is WatchSource=>v==='office'||v==='showcase'
const response=(out:Record<string,unknown>)=>json(out,{status:out.ok===false?409:200})
const administrator=(actor:AuthUser)=>actor.role==='admin'
type StartInput={source?:unknown;full?:unknown;modelIds?:unknown}
type ChangeInput={sessionId?:unknown;itemId?:unknown;countedQuantity?:unknown;watchVariantId?:unknown}
const sourceLabel=(source:WatchSource)=>source==='office'?'офиса':'витрины'

async function ownedSession(db:D1Database,brandId:number,id:unknown,includeClosed=false){
 if(typeof id!=='string'||!/^REV-[SB]-[PF]-\d{14}-[\dA-F]{8}$/i.test(id))
   throw new Error('Некорректный идентификатор ревизии.')
 const r=await db.prepare(`SELECT id,inventory_source,status,created_by FROM inventory_stocktake_sessions
   WHERE id=? LIMIT 1`).bind(id).first<{id:string;inventory_source:string;status:string;created_by:string}>()
 if(!r||!r.created_by.startsWith(owner(brandId)))
   throw new Error('Ревизия не найдена для выбранного бренда.')
 if(!includeClosed&&r.status!=='active')throw new Error('Эта ревизия уже завершена или отменена.')
 const foreign=await db.prepare(`
  SELECT COUNT(*) AS n FROM inventory_stocktake_items i
  LEFT JOIN watch_variants wv ON wv.catalog_variant_id=i.variant_id
  LEFT JOIN watch_products wp ON wp.id=wv.watch_product_id
  WHERE i.session_id=? AND (wp.brand_id IS NULL OR wp.brand_id<>?)
 `).bind(id,brandId).first<{n:number}>()
 if(Number(foreign?.n||0)>0)throw new Error('В ревизии найдена комплектация вне выбранного бренда.')
 return r
}

async function summary(db:D1Database,brandId:number,id:string){
 await ownedSession(db,brandId,id,true)
 const original=await serializeInventoryStocktakeSession(db,id)
 const variants=await db.prepare(`
  SELECT wv.catalog_variant_id, wv.id AS watch_variant_id,
    wp.model_name, wv.gender,
    COALESCE(a.movement,wv.movement) AS movement,
    COALESCE(a.bracelet_material,wv.bracelet_material) AS bracelet_material,
    COALESCE(a.dial_color,wv.dial_color) AS dial_color,
    COALESCE(a.bracelet_color,wv.bracelet_color) AS bracelet_color
  FROM watch_variants wv
  JOIN watch_products wp ON wp.id=wv.watch_product_id
  LEFT JOIN watch_variant_attributes_v5 a ON a.watch_variant_id=wv.id
  WHERE wp.brand_id=? AND wv.catalog_variant_id IS NOT NULL
 `).bind(brandId).all<Record<string,unknown>>()
 const byVariant=new Map((variants.results||[]).map(x=>[Number(x.catalog_variant_id),x]))
 const items=original.items.map(x=>{
   const watch=byVariant.get(Number(x.variantId))
   return {
     ...x,watchVariantId:Number(watch?.watch_variant_id||0),
     productName:String(watch?.model_name||x.productName),
     gender:String(watch?.gender||''),
     movement:String(watch?.movement||''),
     braceletMaterial:String(watch?.bracelet_material||''),
     dialColor:String(watch?.dial_color||''),
     braceletColor:String(watch?.bracelet_color||''),
   }
 })
 return {...original,items,brandId}
}

export async function getClient3WatchRevision(
 db:D1Database,actor:AuthUser,brandId:number,url:URL,
){
 if(!administrator(actor))return error('Ревизия доступна только администратору.',403)
 const raw=url.searchParams.get('source')
 if(!validSource(raw))return error('Выберите офис или витрину.',400)
 const source=watchSourceToLegacy(raw)
 const active=await db.prepare(`SELECT id,created_by FROM inventory_stocktake_sessions
    WHERE inventory_source=? AND status='active' ORDER BY updated_at DESC LIMIT 1`)
    .bind(source).first<{id:string;created_by:string}>()
 if(!active)return json({ok:true,session:null})
 if(!active.created_by?.startsWith(owner(brandId)))
   return json({ok:true,session:null,blocked:true,
     message:'В этой точке уже идёт ревизия другого бренда. Чтобы не смешать остатки, завершите её перед началом новой.'})
 try{return json({ok:true,session:await summary(db,brandId,active.id)})}
 catch(e){return error(e instanceof Error?e.message:'Ревизия не загружена.')}
}

export async function startClient3WatchRevision(
 db:D1Database,actor:AuthUser,brandId:number,input:StartInput,
){
 if(!administrator(actor))return error('Ревизия доступна только администратору.',403)
 if(!validSource(input.source))return error('Выберите офис или витрину.',400)
 const source=watchSourceToLegacy(input.source)
 const full=input.full===true
 if(!full&&!Array.isArray(input.modelIds))return error('Выберите модели для проверки.',400)
 const ids=full?[]:(input.modelIds as unknown[]).map(Number)
 if(!full&&(!ids.length||ids.length>80||
   ids.some(x=>!Number.isSafeInteger(x)||x<1)||new Set(ids).size!==ids.length))
   return error('Выберите от 1 до 80 разных моделей.',400)
 const ongoing=await db.prepare(`SELECT id,created_by FROM inventory_stocktake_sessions
   WHERE inventory_source=? AND status='active' LIMIT 1`)
   .bind(source).first<{id:string;created_by:string}>()
 if(ongoing){
   if(ongoing.created_by?.startsWith(owner(brandId)))
     return json({ok:true,resumed:true,session:await summary(db,brandId,ongoing.id)})
   return error('В точке уже начата ревизия другого бренда. Сначала завершите её.')
 }
 const models=await db.prepare(`SELECT id FROM watch_products
   WHERE brand_id=? AND is_active=1
   AND (?=1 OR id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)))`)
   .bind(brandId,full?1:0,JSON.stringify(ids)).all<{id:number}>()
 if(!full&&models.results.length!==ids.length)
   return error('В списке есть удалённая модель или модель другого бренда.')
 if(!models.results.length)return error('Нет активных моделей часов для проверки.')
 const now=new Date().toISOString()
 const id=inventoryStocktakeSessionId(source,full?'full':'selective')
 const createdBy=owner(brandId)+'admin:'+actor.id
 const modelFilter=full?'':` AND wp.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
 const stockQuery=`
   SELECT s.id AS stock_id,s.quantity,s.reserved_quantity,
     wp.catalog_product_id AS product_id,wv.catalog_variant_id AS variant_id,
     wp.model_name,cv.category,cv.gender,cv.color,cv.material,cv.length,cv.size_label
   FROM inventory_stock s
   JOIN watch_variants wv ON wv.catalog_variant_id=s.variant_id AND wv.is_active=1
   JOIN watch_products wp ON wp.id=wv.watch_product_id AND wp.is_active=1
   JOIN catalog_variants cv ON cv.id=wv.catalog_variant_id AND cv.is_active=1
   WHERE wp.brand_id=? AND s.inventory_source=?
     AND (COALESCE(s.quantity,0)<>0 OR COALESCE(s.reserved_quantity,0)<>0)
     ${modelFilter}
 `
 const arg=[brandId,source,...(full?[]:[JSON.stringify(ids)])]
 const found=await db.prepare(`SELECT COUNT(*) AS qty FROM (${stockQuery})`)
   .bind(...arg).first<{qty:number}>()
 if(!Number(found?.qty||0))
   return error('У выбранных часов нет остатков или резервов. Сначала оформите приход либо добавьте их в действующую ревизию.')
 // Main's D1 session/item schema and Main's completion/count functions remain
 // authoritative. Both inserts share one atomic D1 batch, exactly like Main.
 const batch=await db.batch([
   db.prepare(`INSERT INTO inventory_stocktake_sessions
       (id,inventory_source,status,created_by,started_at,updated_at)
       VALUES (?,?,'active',?,?,?)`).bind(id,source,createdBy,now,now),
   db.prepare(`
     INSERT INTO inventory_stocktake_items(
       session_id,inventory_source,stock_id,product_id,variant_id,
       product_name_snapshot,category_snapshot,gender_snapshot,color_snapshot,
       material_snapshot,length_snapshot,size_snapshot,
       opening_quantity,opening_reserved_quantity,baseline_quantity,
       status,created_at,updated_at
     )
     SELECT ?, ?,r.stock_id,r.product_id,r.variant_id,r.model_name,
       COALESCE(r.category,'adult'),COALESCE(r.gender,''),COALESCE(r.color,''),
       COALESCE(NULLIF(r.material,''),'СТАНДАРТ'),
       COALESCE(NULLIF(r.length,''),'СТАНДАРТ'),COALESCE(r.size_label,''),
       r.quantity,MAX(0,COALESCE(r.reserved_quantity,0)),r.quantity,
       'pending',?,?
     FROM (${stockQuery}) r
   `).bind(id,source,now,now,...arg),
 ])
 if(!batch[0]?.success||!batch[1]?.success)return error('Не удалось начать ревизию.')
 return json({ok:true,resumed:false,session:await summary(db,brandId,id)})
}

export async function changeClient3WatchRevision(
 db:D1Database,actor:AuthUser,brandId:number,
 action:'count'|'add'|'complete'|'cancel',input:ChangeInput,
){
 if(!administrator(actor))return error('Ревизия доступна только администратору.',403)
 try{
   const row=await ownedSession(db,brandId,input.sessionId,
     action==='complete'||action==='cancel')
   const id=row.id
   if(action==='count'){
     const itemId=Number(input.itemId)
     if(!Number.isSafeInteger(itemId)||itemId<1)return error('Выберите позицию.',400)
     const item=await db.prepare(`SELECT i.id FROM inventory_stocktake_items i
       JOIN watch_variants wv ON wv.catalog_variant_id=i.variant_id
       JOIN watch_products wp ON wp.id=wv.watch_product_id
       WHERE i.id=? AND i.session_id=? AND wp.brand_id=?`)
       .bind(itemId,id,brandId).first<{id:number}>()
     if(!item)return error('Позиция не принадлежит выбранному бренду.',404)
     if(input.countedQuantity!==null&&
       (!Number.isSafeInteger(Number(input.countedQuantity))||
        input.countedQuantity===''||Number(input.countedQuantity)<0||
        Number(input.countedQuantity)>1_000_000))
       return error('Укажите целое количество от 0 до 1000000.',400)
     const result=await saveInventoryStocktakeCount(db,id,itemId,
       {countedQuantity:input.countedQuantity})
     return response({...result,session:await summary(db,brandId,id)})
   }
   if(action==='add'){
     const watchId=Number(input.watchVariantId)
     if(!Number.isSafeInteger(watchId)||watchId<1)return error('Укажите комплектацию.',400)
     const variant=await db.prepare(`SELECT wv.catalog_variant_id AS id FROM watch_variants wv
       JOIN watch_products wp ON wp.id=wv.watch_product_id
       JOIN catalog_variants cv ON cv.id=wv.catalog_variant_id AND cv.is_active=1
       WHERE wv.id=? AND wp.brand_id=? AND wv.is_active=1 AND wp.is_active=1`)
       .bind(watchId,brandId).first<{id:number}>()
     if(!variant?.id)return error('Комплектация не принадлежит бренду или не активна.')
     const result=await addInventoryStocktakeVariant(db,id,{variantId:variant.id})
     return response({...result,session:await summary(db,brandId,id)})
   }
   if(action==='complete'){
     const result=await completeInventoryStocktakeSession(db,id)
     return response({...result,session:await summary(db,brandId,id)})
   }
   const result=await cancelInventoryStocktakeSession(db,id)
   return response({...result,session:await summary(db,brandId,id)})
 }catch(e){
   return error(e instanceof Error?e.message:'Не удалось выполнить действие с ревизией.')
 }
}
