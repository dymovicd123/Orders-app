import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {normalizeCatalogProductIdentityKey} from './catalog.ts'

type Model={id:number;model_name:string;is_active:number}
type Alias={id:number;watch_product_id:number;alias_text:string;alias_key:string}
const fail=(message:string,status=409,code='WATCH_ALIAS_CONFLICT')=>
  json({ok:false,message,code},{status})
const clean=(x:unknown)=>typeof x==='string'?x.trim().replace(/\s+/g,' '):''
export const watchModelAliasKey=(x:unknown)=>
  normalizeCatalogProductIdentityKey(clean(x))

/**
 * Main's exact identity normalization, but with Client3-specific brand scope.
 * Active and retired canonical names are checked BEFORE aliases; conflicts fail
 * closed, never silently relabel another brand's watches or canonical SKU.
 */
export async function findWatchModelByIdentity(
 db:D1Database,brandId:number,raw:unknown,
):Promise<Model|null>{
 const key=watchModelAliasKey(raw)
 if(!key)return null
 const models=await db.prepare(
   'SELECT id,model_name,is_active FROM watch_products WHERE brand_id=?',
 ).bind(brandId).all<Model>()
 const exact=(models.results||[]).filter(m=>watchModelAliasKey(m.model_name)===key)
 if(exact.length>1)throw new Error('В каталоге несколько моделей с одинаковым названием после нормализации. Требуется исправление администратором.')
 const alias=await db.prepare(`SELECT a.id,a.watch_product_id,a.alias_text,a.alias_key
   FROM watch_model_aliases a
   WHERE a.brand_id=? AND a.alias_key=? LIMIT 1`
 ).bind(brandId,key).first<Alias>()
 if(exact.length&&alias&&exact[0].id!==alias.watch_product_id)
   throw new Error('Название модели связано с другой моделью через псевдоним. Требуется исправление каталога.')
 if(exact.length)return exact[0]
 if(!alias)return null
 const target=(models.results||[]).find(m=>m.id===alias.watch_product_id)
 if(!target)throw new Error('Псевдоним указывает на несуществующую модель. Требуется исправление каталога.')
 return target
}

export async function listWatchModelAliases(
 db:D1Database,actor:AuthUser,brandId:number,watchProductId:number,
){
 if(actor.role!=='admin')return fail('Псевдонимы моделей настраивает администратор.',403)
 if(!Number.isSafeInteger(watchProductId)||watchProductId<1)
   return fail('Выберите модель часов.',400)
 const model=await db.prepare(
   'SELECT id FROM watch_products WHERE id=? AND brand_id=? AND is_active=1 LIMIT 1'
 ).bind(watchProductId,brandId).first<{id:number}>()
 if(!model)return fail('Модель не найдена в выбранном бренде.',404)
 const data=await db.prepare(`SELECT id,alias_text AS aliasText,alias_key AS aliasKey
   FROM watch_model_aliases
   WHERE brand_id=? AND watch_product_id=? ORDER BY alias_text COLLATE NOCASE,id LIMIT 60`
 ).bind(brandId,watchProductId).all<{id:number;aliasText:string;aliasKey:string}>()
 return json({ok:true,rows:data.results||[],watchProductId})
}

export async function addWatchModelAlias(
 db:D1Database,actor:AuthUser,brandId:number,
 input:{watchProductId?:unknown;alias?:unknown},
){
 if(actor.role!=='admin')return fail('Псевдонимы моделей настраивает администратор.',403)
 const id=Number(input.watchProductId),alias=clean(input.alias),key=watchModelAliasKey(alias)
 if(!Number.isSafeInteger(id)||id<1||!alias||alias.length>150||!key||key.length>160)
   return fail('Выберите модель и введите псевдоним длиной до 150 символов.',400)
 const model=await db.prepare(
   'SELECT id,model_name,is_active FROM watch_products WHERE id=? AND brand_id=?'
 ).bind(id,brandId).first<Model>()
 if(!model||model.is_active!==1)return fail('Модель удалена или принадлежит другому бренду.',404)
 const canonical=await db.prepare(
   'SELECT id,model_name,is_active FROM watch_products WHERE brand_id=?'
 ).bind(brandId).all<Model>()
 const equivalent=(canonical.results||[]).filter(m=>watchModelAliasKey(m.model_name)===key)
 if(equivalent.length>1||equivalent.some(m=>m.id!==id))
   return fail('Написание уже совпадает с названием другой модели, включая удалённую. Сначала разберите конфликт.')
 if(equivalent.length===1)return fail('Это уже основное название модели. Псевдоним не нужен.',400)
 const current=await db.prepare(`SELECT id,watch_product_id
   FROM watch_model_aliases WHERE brand_id=? AND alias_key=? LIMIT 1`
 ).bind(brandId,key).first<{id:number;watch_product_id:number}>()
 if(current){
   if(current.watch_product_id!==id)return fail('Это написание уже связано с другой моделью этого бренда.')
   return json({ok:true,id:current.id,alreadyExists:true})
 }
 const existingCount=await db.prepare(`SELECT COUNT(*) AS n FROM watch_model_aliases
   WHERE brand_id=? AND watch_product_id=?`
 ).bind(brandId,id).first<{n:number}>()
 if(Number(existingCount?.n||0)>=20)return fail('Для одной модели допускается не более 20 псевдонимов.')
 try{
   const saved=await db.prepare(`INSERT OR IGNORE INTO watch_model_aliases
     (brand_id,watch_product_id,alias_key,alias_text) VALUES (?,?,?,?)`
   ).bind(brandId,id,key,alias).run()
   const winner=await db.prepare(`SELECT id,watch_product_id FROM watch_model_aliases
     WHERE brand_id=? AND alias_key=?`).bind(brandId,key)
     .first<{id:number;watch_product_id:number}>()
   if(!winner||winner.watch_product_id!==id)
     return fail('Псевдоним одновременно назначили другой модели. Обновите каталог.')
   return json({ok:true,id:winner.id,created:Number(saved.meta?.changes||0)===1,
     alreadyExists:Number(saved.meta?.changes||0)!==1})
 }catch{
   return fail('Не удалось сохранить псевдоним. Обновите каталог.')
 }
}

export async function deleteWatchModelAlias(
 db:D1Database,actor:AuthUser,brandId:number,
 input:{watchProductId?:unknown;aliasId?:unknown},
){
 if(actor.role!=='admin')return fail('Псевдонимы моделей настраивает администратор.',403)
 const id=Number(input.watchProductId),aliasId=Number(input.aliasId)
 if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(aliasId)||aliasId<1)
   return fail('Выберите псевдоним.',400)
 const row=await db.prepare(`SELECT a.id FROM watch_model_aliases a
   JOIN watch_products p ON p.id=a.watch_product_id AND p.brand_id=a.brand_id
   WHERE a.id=? AND a.watch_product_id=? AND a.brand_id=? AND p.is_active=1`
 ).bind(aliasId,id,brandId).first<{id:number}>()
 if(!row)return fail('Псевдоним не принадлежит этой модели или бренду.',404)
 const removed=await db.prepare(`DELETE FROM watch_model_aliases
   WHERE id=? AND brand_id=? AND watch_product_id=?`
 ).bind(aliasId,brandId,id).run()
 if(Number(removed.meta?.changes||0)!==1)return fail('Псевдоним уже изменён. Обновите список.')
 return json({ok:true,deleted:true})
}
