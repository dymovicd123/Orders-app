import { json } from '../core/http.ts'
import type { AuthUser } from '../core/types.ts'

export type WatchReferenceKind='movements'|'bracelets'|'dials'|'leatherColors'|'paymentMethods'|'deliveryMethods'
const allowed:readonly WatchReferenceKind[]=['movements','bracelets','dials','leatherColors','paymentMethods','deliveryMethods']
const normalized=(raw:string)=>raw.trim().replace(/\s+/g,' ')
const identity=(value:string)=>normalized(value).toLocaleUpperCase('ru-RU')
const fail=(message:string,status=400)=>json({ok:false,message},{status})

export async function listClient3WatchReferences(db:D1Database,actor:AuthUser) {
  if(actor.role!=='admin'&&!actor.managerId)
    return fail('Справочники доступны только сотрудникам.',403)
  const rows=await db.prepare(
    "SELECT id,kind,value FROM watch_reference_values WHERE is_active=1 ORDER BY kind,value COLLATE NOCASE",
  ).all<{id:number;kind:WatchReferenceKind;value:string}>()
  return json({ok:true,rows:rows.results||[],sharedAcrossBrands:true})
}

/** An administrator extends one shared list. It does NOT mutate stored SKU identities. */
export async function createClient3WatchReference(
  db:D1Database,actor:AuthUser,raw:{kind?:unknown;value?:unknown},
) {
  if(actor.role!=='admin')return fail('Добавлять значения справочников может администратор.',403)
  if(typeof raw?.kind!=='string'||!allowed.includes(raw.kind as WatchReferenceKind))
    return fail('Этот справочник содержит защищённые системные значения.')
  if(typeof raw.value!=='string')return fail('Введите значение.')
  const value=normalized(raw.value)
  if(!value||value.length>80||/[\u0000-\u001f\u007f]/.test(value))
    return fail('Введите корректное значение длиной до 80 символов.')
  const canonical=raw.kind==='leatherColors'?identity(value):value
  const all=await db.prepare('SELECT id,value,is_active FROM watch_reference_values WHERE kind=?')
    .bind(raw.kind).all<{id:number;value:string;is_active:number}>()
  const existing=(all.results||[]).find(row=>identity(row.value)===identity(canonical))
  if(existing){
    if(existing.is_active===0){
      await db.prepare('UPDATE watch_reference_values SET is_active=1 WHERE id=? AND kind=? AND is_active=0')
        .bind(existing.id,raw.kind).run()
      return json({ok:true,id:existing.id,value:existing.value,restored:true,sharedAcrossBrands:true})
    }
    return json({ok:true,id:existing.id,value:existing.value,alreadyExists:true,sharedAcrossBrands:true})
  }
  try{
    await db.prepare(
      'INSERT INTO watch_reference_values(kind,value) VALUES(?,?)',
    ).bind(raw.kind,canonical).run()
  }catch(cause){
    const concurrent=await db.prepare(
      'SELECT value FROM watch_reference_values WHERE kind=? AND value=? COLLATE NOCASE LIMIT 1',
    ).bind(raw.kind,canonical).first<{value:string}>()
    if(concurrent)return json({ok:true,value:concurrent.value,alreadyExists:true,sharedAcrossBrands:true})
    throw cause
  }
  return json({ok:true,value:canonical,created:true,sharedAcrossBrands:true},{status:201})
}

/** Main-like deletion from active choices; historical facts and SKU IDs survive. */
export async function deleteClient3WatchReference(db:D1Database,actor:AuthUser,id:number){
  if(actor.role!=='admin')return fail('Удаление доступно только администратору.',403)
  if(!Number.isSafeInteger(id)||id<1)return fail('Выберите значение.')
  const row=await db.prepare('SELECT id,kind,value,is_active FROM watch_reference_values WHERE id=?')
    .bind(id).first<{id:number;kind:WatchReferenceKind;value:string;is_active:number}>()
  if(!row)return fail('Значение не найдено.',404)
  if(!allowed.includes(row.kind))return fail('Неизвестный справочник.')
  if(row.is_active!==1)return json({ok:true,alreadyDeleted:true})
  // A selected attribute of a live SKU cannot disappear from the list.
  // Inactive historical SKUs, historic payments and shipping are kept intact.
  const column:Record<string,string>={movements:'movement',bracelets:'bracelet_material',
    dials:'dial_color',leatherColors:'bracelet_color'}
  if(column[row.kind]){
    const sql=`SELECT COUNT(*) AS n FROM watch_variants v
      JOIN watch_products wp ON wp.id=v.watch_product_id
      WHERE v.is_active=1 AND wp.is_active=1 AND v.${column[row.kind]}=?`
    const used=await db.prepare(sql).bind(row.value).first<{n:number}>()
    if(Number(used?.n)>0)
      return fail('Сначала удалите использующие это значение позиции часов. Исторические заказы сохраняются.',409)
  }
  const changed=await db.prepare('UPDATE watch_reference_values SET is_active=0 WHERE id=? AND is_active=1')
    .bind(id).run()
  return json({ok:true,deleted:true,changed:Number(changed.meta?.changes||0)})
}

/** Main references editor: rename an unused characteristic, preserving historical IDs. */
export async function updateClient3WatchReference(
 db:D1Database,actor:AuthUser,raw:{id?:unknown;kind?:unknown;value?:unknown},
){
 if(actor.role!=='admin')return fail('Редактировать справочники может администратор.',403)
 const id=Number(raw.id)
 if(!Number.isSafeInteger(id)||id<1||typeof raw.kind!=='string'||
   !allowed.includes(raw.kind as WatchReferenceKind)||typeof raw.value!=='string')
   return fail('Укажите существующее значение и справочник.')
 const value=normalized(raw.value)
 if(!value||value.length>80||/[\u0000-\u001f\u007f]/.test(value))
   return fail('Введите значение от 1 до 80 символов.')
 const row=await db.prepare('SELECT id,kind,value FROM watch_reference_values WHERE id=? AND is_active=1')
   .bind(id).first<{id:number;kind:WatchReferenceKind;value:string}>()
 if(!row||row.kind!==raw.kind)return fail('Значение не найдено. Обновите страницу.',404)
 const canonical=row.kind==='leatherColors'?identity(value):value
 if(identity(row.value)===identity(canonical))return json({ok:true,id,value:row.value,unchanged:true})
 const duplicate=await db.prepare('SELECT id,value FROM watch_reference_values WHERE kind=?')
   .bind(row.kind).all<{id:number;value:string}>()
 if((duplicate.results||[]).some(x=>x.id!==id&&identity(x.value)===identity(canonical)))
   return fail('Такое значение уже существует. Используйте существующее.',409)
 const columns:Record<string,string>={movements:'movement',bracelets:'bracelet_material',
   dials:'dial_color',leatherColors:'bracelet_color'}
 if(columns[row.kind]){
   const count=await db.prepare(`SELECT COUNT(*) AS n FROM watch_variants v
     JOIN watch_products wp ON wp.id=v.watch_product_id
     WHERE v.is_active=1 AND wp.is_active=1 AND v.${columns[row.kind]}=?`)
     .bind(row.value).first<{n:number}>()
   if(Number(count?.n)>0)return fail('Характеристика используется в товаре. Сначала измените или удалите соответствующую позицию; историю трогать нельзя.',409)
 }
 const saved=await db.prepare('UPDATE watch_reference_values SET value=? WHERE id=? AND kind=? AND value=? AND is_active=1')
   .bind(canonical,id,row.kind,row.value).run()
 if(Number(saved.meta?.changes||0)!==1)return fail('Справочник изменился одновременно. Обновите список.',409)
 return json({ok:true,id,value:canonical,updated:true})
}
