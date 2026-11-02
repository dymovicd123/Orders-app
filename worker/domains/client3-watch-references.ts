import { json } from '../core/http.ts'
import type { AuthUser } from '../core/types.ts'

export type WatchReferenceKind='leatherColors'|'paymentMethods'|'deliveryMethods'
const allowed:readonly WatchReferenceKind[]=['leatherColors','paymentMethods','deliveryMethods']
const fail=(message:string,status=400)=>json({ok:false,message},{status})

export async function listClient3WatchReferences(db:D1Database,actor:AuthUser) {
  if(actor.role!=='admin'&&!actor.managerId)
    return fail('Справочники доступны только сотрудникам.',403)
  const rows=await db.prepare(
    "SELECT kind,value FROM watch_reference_values WHERE is_active=1 ORDER BY kind,value COLLATE NOCASE",
  ).all<{kind:WatchReferenceKind;value:string}>()
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
  const value=raw.value.trim().replace(/\s+/g,' ')
  if(!value||value.length>80||/[\u0000-\u001f\u007f]/.test(value))
    return fail('Введите корректное значение длиной до 80 символов.')
  const normalized=raw.kind==='leatherColors'?value.toLocaleUpperCase('ru-RU'):value
  const existing=await db.prepare(
    'SELECT id,value FROM watch_reference_values WHERE kind=? AND value=? COLLATE NOCASE LIMIT 1',
  ).bind(raw.kind,normalized).first<{id:number;value:string}>()
  if(existing)return json({ok:true,value:existing.value,alreadyExists:true,sharedAcrossBrands:true})
  try{
    await db.prepare(
      'INSERT INTO watch_reference_values(kind,value) VALUES(?,?)',
    ).bind(raw.kind,normalized).run()
  }catch(cause){
    const concurrent=await db.prepare(
      'SELECT value FROM watch_reference_values WHERE kind=? AND value=? COLLATE NOCASE LIMIT 1',
    ).bind(raw.kind,normalized).first<{value:string}>()
    if(concurrent)return json({ok:true,value:concurrent.value,alreadyExists:true,sharedAcrossBrands:true})
    throw cause
  }
  return json({ok:true,value:normalized,created:true,sharedAcrossBrands:true},{status:201})
}
