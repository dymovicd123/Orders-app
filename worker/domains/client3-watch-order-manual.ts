import type {AuthUser} from '../core/types.ts'
import {normalizeWatchVariant,type WatchVariantInput} from '../../shared/client3/watch-domain.ts'
import {registerWatchModel,registerWatchVariant} from './client3-watch-catalog.ts'
import {provisionClient3WatchSku} from './client3-watch-provision.ts'

export type ManualWatchOrderItem=WatchVariantInput&{modelName:string}
type Result={ok:boolean;watchProductId?:number;watchVariantId?:number;canonicalVariantId?:number;message?:string}
const parse=async(response:Response):Promise<Result>=>{
 const result=await response.json() as Result
 if(!response.ok||result.ok!==true)throw new Error(result.message||'Не удалось зарегистрировать комплектацию часов.')
 return result
}
/** Main-style free-entry for an authorized brand manager. No physical stock is
 * ever created: only shared reference values, SKU identity and pending order.
 * This helper is not a public HTTP route.
 */
export async function ensureManualWatchOrderSku(
 db:D1Database,actor:AuthUser,brandId:number,raw:ManualWatchOrderItem,
):Promise<{watchVariantId:number;catalogVariantId:number}>{
 if(!Number.isSafeInteger(brandId)||brandId<1)throw new Error('Выберите бренд.')
 if(actor.role!=='admin'){
   if(!actor.managerId||actor.employeeRole==='Логист')
     throw new Error('Менеджер не может создать часы в этом бренде.')
   const granted=await db.prepare(`SELECT 1 AS ok FROM watch_manager_brands mb
     JOIN managers m ON m.id=mb.manager_id AND m.is_active=1
     WHERE mb.manager_id=? AND mb.brand_id=? LIMIT 1`)
     .bind(actor.managerId,brandId).first<{ok:number}>()
   if(!granted?.ok)throw new Error('Выбранный бренд недоступен этому менеджеру.')
 }
 const modelName=typeof raw?.modelName==='string'?raw.modelName.trim().replace(/\s+/g,' '):''
 if(!modelName||modelName.length>150)
   throw new Error('Введите название модели (не более 150 символов).')
 const variant=normalizeWatchVariant(raw)
 for(const [kind,value] of [
   ['movements',variant.movement],
   ['bracelets',variant.braceletMaterial],
   ['dials',variant.dialColor],
   ...(variant.braceletMaterial==='leather'?[['leatherColors',variant.braceletColor]]:[]),
 ]){
   const table=kind==='leatherColors'?'watch_reference_values':'watch_reference_values_v5'
   const existing=await db.prepare(`SELECT id,value,is_active FROM ${table} WHERE kind=? AND value=? COLLATE NOCASE`)
     .bind(kind,value).first<{id:number;value:string;is_active:number}>()
   if(existing?.is_active===0)
     throw new Error('Характеристика «'+value+'» удалена из справочника. Обратитесь к администратору.')
   if(!existing){
     await db.prepare(`INSERT OR IGNORE INTO ${table}(kind,value) VALUES(?,?)`)
       .bind(kind,value).run()
   }
 }
 const model=await parse(await registerWatchModel(db,actor,brandId,{modelName},{fromVerifiedOrder:true}))
 if(!model.watchProductId)throw new Error('Не удалось подтвердить модель часов.')
 const sku=await parse(await registerWatchVariant(db,actor,brandId,{
   watchProductId:model.watchProductId,...variant,
 },{fromVerifiedOrder:true}))
 if(!sku.watchVariantId)throw new Error('Не удалось подтвердить комплект часов.')
 const prepared=await parse(await provisionClient3WatchSku(
   db,actor,brandId,sku.watchVariantId,{fromVerifiedOrder:true},
 ))
 if(!prepared.canonicalVariantId)
   throw new Error('Не удалось подтвердить новую складскую идентичность.')
 return {watchVariantId:sku.watchVariantId,catalogVariantId:prepared.canonicalVariantId}
}
