import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

export type WatchReferenceKind='movements'|'bracelets'|'dials'|'leatherColors'|'paymentMethods'|'deliveryMethods'|'cities'
const allKinds:readonly WatchReferenceKind[]=['movements','bracelets','dials','leatherColors','paymentMethods','deliveryMethods','cities']
const extraKinds:readonly string[]=['movements','bracelets','dials']
const OFFSET=1000000000
const CITY_OFFSET=2000000000
const warehouseKind=(kind:unknown)=>typeof kind==='string'&&['movements','bracelets','dials','leatherColors','cities'].includes(kind)
const validKind=(x:unknown):x is WatchReferenceKind=>typeof x==='string'&&allKinds.includes(x as WatchReferenceKind)
const newTable=(kind:string)=>extraKinds.includes(kind)
const table=(kind:string)=>kind==='cities'?'watch_city_values':newTable(kind)?'watch_reference_values_v5':'watch_reference_values'
const publicId=(kind:string,id:number)=>id+(kind==='cities'?CITY_OFFSET:newTable(kind)?OFFSET:0)
const normalized=(raw:string)=>raw.trim().replace(/\s+/g,' ')
const identity=(value:string)=>normalized(value).toLocaleUpperCase('ru-RU')
const fail=(message:string,status=400)=>json({ok:false,message},{status})
const validValue=(raw:unknown)=>{
 if(typeof raw!=='string')throw new Error('Введите значение.')
 const value=normalized(raw)
 if(!value||value.length>80||/[\u0000-\u001f\u007f]/.test(value))
   throw new Error('Введите корректное значение длиной до 80 символов.')
 return value.toLocaleUpperCase('ru-RU')
}
const decode=(id:number)=>id>=CITY_OFFSET?{extra:false,city:true,id:id-CITY_OFFSET}:
  id>=OFFSET?{extra:true,city:false,id:id-OFFSET}:{extra:false,city:false,id}
const referenceColumns:Record<string,string>={
 movements:'movement',bracelets:'bracelet_material',dials:'dial_color',leatherColors:'bracelet_color',
}
async function usedByActiveSku(db:D1Database,kind:string,value:string){
 const col=referenceColumns[kind]
 if(!col)return false
 // Fixed column names, bound user values; preserve Main's live-SKU reference guard.
 const row=await db.prepare(`SELECT COUNT(*) AS n FROM watch_variants v
   LEFT JOIN watch_variant_attributes_v5 a ON a.watch_variant_id=v.id
   JOIN watch_products wp ON wp.id=v.watch_product_id
   WHERE v.is_active=1 AND wp.is_active=1 AND
     COALESCE(a.${col},v.${col})=?`)
   .bind(value).first<{n:number}>()
 return Number(row?.n)>0
}
export async function listClient3WatchReferences(db:D1Database,actor:AuthUser){
 if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад')&&!actor.managerId)
   return fail('Справочники доступны только сотрудникам.',403)
 const [legacy,extra,cities]=await Promise.all([
   db.prepare('SELECT id,kind,value FROM watch_reference_values WHERE is_active=1').all<{id:number;kind:WatchReferenceKind;value:string}>(),
   db.prepare('SELECT id,kind,value FROM watch_reference_values_v5 WHERE is_active=1').all<{id:number;kind:WatchReferenceKind;value:string}>(),
   db.prepare('SELECT id,kind,value FROM watch_city_values WHERE is_active=1').all<{id:number;kind:WatchReferenceKind;value:string}>(),
 ])
 const rows=[...(legacy.results||[]),...(extra.results||[]).map(r=>({...r,id:r.id+OFFSET})),
   ...(cities.results||[]).map(r=>({...r,id:r.id+CITY_OFFSET}))]
 rows.sort((a,b)=>a.kind.localeCompare(b.kind)||a.value.localeCompare(b.value,'ru'))
 return json({ok:true,rows,sharedAcrossBrands:true})
}
export async function createClient3WatchReference(db:D1Database,actor:AuthUser,raw:{kind?:unknown;value?:unknown}){
 if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад'))return fail('Добавлять значения справочников может администратор.',403)
 if(!validKind(raw?.kind))return fail('Недоступный справочник.')
 if(actor.role!=='admin'&&!warehouseKind(raw.kind))
   return fail('Настройки оплаты и доставки изменяет только администратор.',403)
 let value:string
 try{value=validValue(raw?.value)}catch(e){return fail(e instanceof Error?e.message:'Неверное значение.')}
 value=identity(value)
 const name=table(raw.kind)
 const list=await db.prepare(`SELECT id,value,is_active FROM ${name} WHERE kind=?`)
   .bind(raw.kind).all<{id:number;value:string;is_active:number}>()
 const existing=(list.results||[]).find(x=>identity(x.value)===identity(value))
 if(existing){
   const id=publicId(raw.kind,existing.id)
   if(existing.is_active===0){
     await db.prepare(`UPDATE ${name} SET is_active=1 WHERE id=? AND kind=? AND is_active=0`)
       .bind(existing.id,raw.kind).run()
     return json({ok:true,id,value:existing.value,restored:true,sharedAcrossBrands:true})
   }
   return json({ok:true,id,value:existing.value,alreadyExists:true,sharedAcrossBrands:true})
 }
 try{
   const saved=await db.prepare(`INSERT INTO ${name}(kind,value) VALUES(?,?)`)
     .bind(raw.kind,value).run()
   return json({ok:true,id:publicId(raw.kind,Number(saved.meta?.last_row_id||0)),
     value,created:true,sharedAcrossBrands:true},{status:201})
 }catch(e){
   const other=await db.prepare(`SELECT id,value FROM ${name} WHERE kind=? AND value=? COLLATE NOCASE`)
     .bind(raw.kind,value).first<{id:number;value:string}>()
   if(other)return json({ok:true,id:publicId(raw.kind,other.id),value:other.value,alreadyExists:true})
   throw e
 }
}
export async function updateClient3WatchReference(db:D1Database,actor:AuthUser,
 raw:{id?:unknown;kind?:unknown;value?:unknown}){
 if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад'))return fail('Редактировать справочники может администратор.',403)
 const publicId=Number(raw.id)
 if(!Number.isSafeInteger(publicId)||publicId<1||!validKind(raw.kind))
   return fail('Выберите существующее значение и справочник.')
 if(actor.role!=='admin'&&!warehouseKind(raw.kind))
   return fail('Настройки оплаты и доставки изменяет только администратор.',403)
 let value:string
 try{value=validValue(raw.value)}catch(e){return fail(e instanceof Error?e.message:'Неверное значение.')}
 const key=decode(publicId),extra=newTable(raw.kind)
 if(key.extra!==extra||key.city!==(raw.kind==='cities'))return fail('Значение не принадлежит выбранному справочнику.',400)
 const name=table(raw.kind)
 const old=await db.prepare(`SELECT id,kind,value FROM ${name} WHERE id=? AND is_active=1`)
   .bind(key.id).first<{id:number;kind:string;value:string}>()
 if(!old||old.kind!==raw.kind)return fail('Значение не найдено.',404)
 value=identity(value)
 if(identity(old.value)===identity(value))return json({ok:true,id:publicId,value:old.value,unchanged:true})
 const duplicates=await db.prepare(`SELECT id,value FROM ${name} WHERE kind=?`)
   .bind(raw.kind).all<{id:number;value:string}>()
 if((duplicates.results||[]).some(x=>x.id!==key.id&&identity(x.value)===identity(value)))
   return fail('Такое значение уже существует.',409)
 if(await usedByActiveSku(db,raw.kind,old.value))
   return fail('Характеристика используется в рабочем товаре. Сначала удалите соответствующую позицию.',409)
 const saved=await db.prepare(`UPDATE ${name} SET value=? WHERE id=? AND kind=? AND value=? AND is_active=1`)
   .bind(value,key.id,raw.kind,old.value).run()
 if(Number(saved.meta?.changes||0)!==1)return fail('Справочник изменился. Обновите список.',409)
 return json({ok:true,id:publicId,value,updated:true})
}
export async function deleteClient3WatchReference(db:D1Database,actor:AuthUser,publicId:number){
 if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад'))return fail('Удалять значения может только администратор.',403)
 if(!Number.isSafeInteger(publicId)||publicId<1)return fail('Выберите значение.')
 const key=decode(publicId),name=key.city?'watch_city_values':key.extra?'watch_reference_values_v5':'watch_reference_values'
 const old=await db.prepare(`SELECT id,kind,value,is_active FROM ${name} WHERE id=?`)
   .bind(key.id).first<{id:number;kind:WatchReferenceKind;value:string;is_active:number}>()
 if(!old||!validKind(old.kind)||key.extra!==newTable(old.kind)||key.city!==(old.kind==='cities'))return fail('Значение не найдено.',404)
 if(actor.role!=='admin'&&!warehouseKind(old.kind))
   return fail('Настройки оплаты и доставки изменяет только администратор.',403)
 if(old.is_active!==1)return json({ok:true,alreadyDeleted:true})
 if(await usedByActiveSku(db,old.kind,old.value))
   return fail('Значение используется в рабочей позиции часов. Сначала удалите позицию; историю сохраняем.',409)
 await db.prepare(`UPDATE ${name} SET is_active=0 WHERE id=? AND kind=? AND is_active=1`)
   .bind(key.id,old.kind).run()
 return json({ok:true,deleted:true})
}
