import type {AuthUser} from '../core/types.ts'
import {normalizeWatchVariant,WATCH_OPTIONS,type WatchVariantInput} from '../../shared/client3/watch-domain.ts'
import {registerWatchModel,registerWatchVariant} from './client3-watch-catalog.ts'
import {provisionClient3WatchSku} from './client3-watch-provision.ts'
import {normalizeCatalogProductIdentityKey} from './catalog.ts'

export type ManualWatchOrderItem=WatchVariantInput&{modelName:string}
type Result={ok:boolean;watchProductId?:number;watchVariantId?:number;canonicalVariantId?:number;message?:string}
const parse=async(response:Response):Promise<Result>=>{
 const result=await response.json() as Result
 if(!response.ok||result.ok!==true)throw new Error(result.message||'Не удалось подтвердить комплектацию часов.')
 return result
}
const clean=(x:unknown)=>typeof x==='string'?x.trim().replace(/\s+/g,' '):''
/** Reuse Main's product-identity rules for Cyrillic/Kazakh spelling, unicode
 * dashes, punctuation and whitespace. Never use edit distance/fuzzy guessing:
 * a collision is an explicit conflict, not an auto-selected SKU.
 */
export const watchIdentityKey=(x:unknown)=>normalizeCatalogProductIdentityKey(clean(x))

type ResolverKind='movements'|'bracelets'|'dials'|'leatherColors'
const WATCH_SYNONYMS:Record<Exclude<ResolverKind,'leatherColors'>,
  Readonly<Record<string,readonly string[]>>>={
 movements:{
   quartz:['quartz','кварц','кварцевый','кварцевые','кварцевый механизм'],
   mechanical:['mechanical','механика','механический','механические','механический механизм'],
 },
 bracelets:{
   steel:['steel','сталь','стальной','стальной браслет'],
   leather:['leather','кожа','кожаный','кожаный ремешок'],
   rubber:['rubber','каучук','каучуковый','каучуковый браслет'],
 },
 dials:{
   black:['black','черный','чёрный'],
   white:['white','белый'],
   silver:['silver','серебро','серебристый'],
   gold:['gold','золото','золотистый'],
   green:['green','зеленый','зелёный'],
   orange:['orange','оранжевый'],
   brown:['brown','коричневый'],
   multicolor:['multicolor','комбинированный','многоцветный'],
 },
}
const standard=(kind:Exclude<ResolverKind,'leatherColors'>,raw:unknown,
 options:readonly {value:string;label:string}[])=>{
 const key=watchIdentityKey(raw)
 const matches=options.filter(x=>watchIdentityKey(x.value)===key||
   watchIdentityKey(x.label)===key)
 if(matches.length===1)return matches[0].value
 const aliases=Object.entries(WATCH_SYNONYMS[kind]).filter(([,variants])=>
   variants.some(alias=>watchIdentityKey(alias)===key))
 return aliases.length===1?aliases[0][0]:clean(raw)
}
/** A known synonym only maps to a built-in canonical value; custom values
 * match via Main identity key. No synonym is inferred from an unrelated word. */
export const watchReferenceIdentityKey=(kind:ResolverKind,value:unknown)=>{
 const key=watchIdentityKey(value)
 if(kind==='leatherColors')return key
 for(const [canonical,aliases] of Object.entries(WATCH_SYNONYMS[kind])){
   if(aliases.some(alias=>watchIdentityKey(alias)===key))return watchIdentityKey(canonical)
 }
 return key
}

/** A reference may be exact or semantically equivalent. All collisions,
 * including retired spellings, must be resolved by a human. */
const matchReference=(kind:ResolverKind,needle:string,
  rows:readonly {value:string;is_active:number}[])=>{
 const key=watchReferenceIdentityKey(kind,needle)
 const matches=rows.filter(row=>watchReferenceIdentityKey(kind,row.value)===key)
 if(matches.length>1)
   throw Error('Характеристика «'+needle+'» неоднозначна: в справочнике несколько совпадающих значений.')
 if(matches.length===1&&Number(matches[0].is_active)!==1)
   throw Error('Характеристика «'+needle+'» удалена. Обратитесь к администратору.')
 return matches[0]?.value||null
}

/** Main-style known-SKU-first: exact brand and all characteristics, even when free stock is zero.
 * Only one semantic match is accepted. Ambiguous/retired identity requires admin review.
 * Unknown model/variant still follows the authorized free-entry creation path.
 */
export async function ensureManualWatchOrderSku(
 db:D1Database,actor:AuthUser,brandId:number,raw:ManualWatchOrderItem,
):Promise<{watchVariantId:number;catalogVariantId:number}>{
 if(!Number.isSafeInteger(brandId)||brandId<1)throw Error('Выберите бренд.')
 if(actor.role!=='admin'){
   if(!actor.managerId||actor.employeeRole==='Логист')
     throw Error('Менеджер не может создать часы в этом бренде.')
   const granted=await db.prepare(`SELECT 1 AS ok FROM watch_manager_brands mb
     JOIN managers m ON m.id=mb.manager_id AND m.is_active=1
     WHERE mb.manager_id=? AND mb.brand_id=? LIMIT 1`)
     .bind(actor.managerId,brandId).first<{ok:number}>()
   if(!granted?.ok)throw Error('Выбранный бренд недоступен этому менеджеру.')
 }
 const inputName=clean(raw?.modelName)
 if(!inputName||inputName.length>150)throw Error('Введите название модели (не более 150 символов).')
 const choice={
   gender:raw.gender,
   movement:standard('movements',raw.movement,WATCH_OPTIONS.movements),
   braceletMaterial:standard('bracelets',raw.braceletMaterial,WATCH_OPTIONS.braceletMaterials),
   dialColor:standard('dials',raw.dialColor,WATCH_OPTIONS.dialColors),
   braceletColor:raw.braceletColor,
 }
 const candidate=normalizeWatchVariant(choice)
 const fields=[
   {kind:'movements',value:candidate.movement,table:'watch_reference_values_v5'},
   {kind:'bracelets',value:candidate.braceletMaterial,table:'watch_reference_values_v5'},
   {kind:'dials',value:candidate.dialColor,table:'watch_reference_values_v5'},
   ...(candidate.braceletMaterial==='leather'
     ?[{kind:'leatherColors',value:candidate.braceletColor,table:'watch_reference_values'}]:[]),
 ]
 // Resolve existing registered reference spellings without Enter or re-confirming
 // unique values; fail closed on ambiguity and explicitly retired values.
 const refs:Record<string,string>={}
 const missing:Array<{kind:string;value:string;table:string}>=[]
 for(const field of fields){
   const existing=await db.prepare(`SELECT value,is_active FROM ${field.table} WHERE kind=?`)
     .bind(field.kind).all<{value:string;is_active:number}>()
   const existingValue=matchReference(field.kind as ResolverKind,field.value,existing.results||[])
   if(existingValue!==null){
     refs[field.kind]=existingValue
   }else{
     refs[field.kind]=field.value
     missing.push(field)
   }
 }
 const variant=normalizeWatchVariant({
   ...candidate,movement:refs.movements,braceletMaterial:refs.bracelets,
   dialColor:refs.dials,braceletColor:refs.leatherColors||'',
 })
 const models=await db.prepare(`SELECT id,model_name,is_active FROM watch_products WHERE brand_id=?`)
   .bind(brandId).all<{id:number;model_name:string;is_active:number}>()
 const known=(models.results||[]).filter(row=>
   watchIdentityKey(row.model_name)===watchIdentityKey(inputName))
 if(known.length>1)throw Error('Название модели неоднозначно. Уточните карточки каталога.')
 if(known.length===1&&known[0].is_active!==1)
   throw Error('Эта модель удалена из каталога. Для восстановления нужен администратор.')
 const modelName=known.length===1?known[0].model_name:inputName
 // Resolve whole existing watch variant (including leather strap colour), even
 // if the original catalogue canonicalized its case differently.
 if(known.length===1){
   const found=await db.prepare(`SELECT wv.id,wv.is_active,wv.catalog_variant_id,wv.gender,
       COALESCE(a.movement,wv.movement) AS movement,
       COALESCE(a.bracelet_material,wv.bracelet_material) AS bracelet_material,
       COALESCE(a.dial_color,wv.dial_color) AS dial_color,
       COALESCE(a.bracelet_color,wv.bracelet_color) AS bracelet_color
     FROM watch_variants wv LEFT JOIN watch_variant_attributes_v5 a ON a.watch_variant_id=wv.id
     WHERE wv.watch_product_id=?`)
     .bind(known[0].id).all<Record<string,unknown>>()
   const matched=(found.results||[]).filter(v=>
     v.gender===variant.gender &&
     watchReferenceIdentityKey('movements',v.movement)===watchReferenceIdentityKey('movements',variant.movement)&&
     watchReferenceIdentityKey('bracelets',v.bracelet_material)===watchReferenceIdentityKey('bracelets',variant.braceletMaterial)&&
     watchReferenceIdentityKey('dials',v.dial_color)===watchReferenceIdentityKey('dials',variant.dialColor)&&
     watchReferenceIdentityKey('leatherColors',v.bracelet_color)===watchReferenceIdentityKey('leatherColors',variant.braceletColor))
   if(matched.length>1)throw Error('Найдено несколько одинаковых комплектаций. Нужна проверка каталога.')
   if(matched.length===1){
     if(Number(matched[0].is_active)!==1)
       throw Error('Комплектация удалена из каталога. Восстановление должен подтвердить администратор.')
     const prepared=await parse(await provisionClient3WatchSku(
       db,actor,brandId,Number(matched[0].id),{fromVerifiedOrder:true}))
     if(!prepared.canonicalVariantId)throw Error('Складской SKU не удалось подтвердить.')
     return {watchVariantId:Number(matched[0].id),catalogVariantId:prepared.canonicalVariantId}
   }
 }
 // Unknown identity: create only the missing reference values; do NOT add stock.
 for(const field of missing){
   await db.prepare(`INSERT OR IGNORE INTO ${field.table}(kind,value) VALUES(?,?)`)
     .bind(field.kind,field.value).run()
 }
 const model=await parse(await registerWatchModel(db,actor,brandId,{modelName},{fromVerifiedOrder:true}))
 if(!model.watchProductId)throw Error('Не удалось подтвердить модель часов.')
 const sku=await parse(await registerWatchVariant(db,actor,brandId,{
   watchProductId:model.watchProductId,...variant,
 },{fromVerifiedOrder:true}))
 if(!sku.watchVariantId)throw Error('Не удалось подтвердить комплект часов.')
 const prepared=await parse(await provisionClient3WatchSku(
   db,actor,brandId,sku.watchVariantId,{fromVerifiedOrder:true}))
 if(!prepared.canonicalVariantId)throw Error('Не удалось подтвердить новую складскую идентичность.')
 return {watchVariantId:sku.watchVariantId,catalogVariantId:prepared.canonicalVariantId}
}
