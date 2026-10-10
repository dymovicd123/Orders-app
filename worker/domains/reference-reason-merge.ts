// Administrator canonicalizes reasons for FUTURE forms only. Historical
// return/writeoff comments, stock, payments and order documents stay unchanged.
import { cleanText, toInt } from '../core/text.ts'
type ReasonRef={id:number;kind:string;value:string;is_active:number;updated_at:string|null}
const supported=new Set(['return_reason','writeoff_reason'])
const invalid=(message:string,code='reason_merge_stale')=>Object.assign(new Error(message),{status:409,code})
const safe=(n:number)=>Number.isSafeInteger(n)&&n>0

async function select(db:D1Database,sourceId:number,targetId:number){
 if(!safe(sourceId)||!safe(targetId)||sourceId===targetId)
  throw Object.assign(new Error('Выберите две разные причины.'),{status:400,code:'reason_choice_invalid'})
 const response=await db.prepare('SELECT id,kind,value,is_active,updated_at FROM reference_values WHERE id IN (?,?)')
  .bind(sourceId,targetId).all<ReasonRef>()
 const source=(response.results||[]).find(x=>x.id===sourceId)
 const target=(response.results||[]).find(x=>x.id===targetId)
 if(!source||!target||source.kind!==target.kind||!supported.has(source.kind))
  throw Object.assign(new Error('Выберите две причины одного справочника.'),{status:400,code:'reason_choice_kind'})
 if(source.is_active!==1||target.is_active!==1)throw invalid('Одна из причин уже скрыта. Обновите справочник.')
 if(!cleanText(source.value)||!cleanText(target.value))throw invalid('Название причины отсутствует. Обновите справочник.')
 return {source,target}
}
async function token(source:ReasonRef,target:ReasonRef){
 const raw=JSON.stringify(['reason_choice_v1',source.id,source.kind,source.value,source.updated_at,source.is_active,
  target.id,target.kind,target.value,target.updated_at,target.is_active])
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))
 return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')
}
export async function previewReasonChoiceMerge(db:D1Database,sourceId:number,targetId:number){
 const {source,target}=await select(db,sourceId,targetId)
 const past=await db.prepare('SELECT target_reference_id FROM reference_reason_choice_merges WHERE source_reference_id=?')
  .bind(sourceId).first<{target_reference_id:number}>()
 if(past)throw invalid('Эта причина уже объединена. Обновите справочник.','reason_merge_already_exists')
 return {canApply:true,stateToken:await token(source,target),source,target,
  affectsFutureSelectionsOnly:true,historicalRecordsPreserved:true,
  explanation:'Новые операции будут использовать выбранную основную причину. Лишняя причина исчезнет из списков выбора. Старые возвраты, списания, комментарии, заказы, остатки и суммы останутся без изменений.'}
}
export async function applyReasonChoiceMerge(
 db:D1Database,sourceId:number,targetId:number,expectedToken:string,actor:string,now=new Date()
){
 if(!safe(sourceId)||!safe(targetId)||sourceId===targetId)
  throw Object.assign(new Error('Выберите две разные причины.'),{status:400})
 const existing=await db.prepare(
  'SELECT m.target_reference_id,v.is_active,p.passed FROM reference_reason_choice_merges m JOIN reference_values v ON v.id=m.source_reference_id LEFT JOIN reference_reason_choice_validations p ON p.merge_id=m.id WHERE m.source_reference_id=?'
 ).bind(sourceId).first<{target_reference_id:number;is_active:number;passed:number|null}>()
 if(existing){
  if(existing.target_reference_id===targetId&&existing.is_active===0&&existing.passed===1)
   return {ok:true,alreadyMerged:true,sourceId,targetId,ordersUpdated:0}
  throw invalid('Эта причина уже объединена или изменилась. Обновите справочник.','reason_merge_conflict')
 }
 const preview=await previewReasonChoiceMerge(db,sourceId,targetId)
 if(!expectedToken||expectedToken!==preview.stateToken)
  throw invalid('Значения изменились после проверки. Посмотрите последствия ещё раз.')
 const name=cleanText(actor)
 if(!name)throw Object.assign(new Error('Требуется администратор для объединения причин.'),{status:403})
 const source=preview.source,target=preview.target,stamp=now.toISOString()
 const insertSql="INSERT INTO reference_reason_choice_merges (kind,source_reference_id,target_reference_id,source_value,target_value,source_updated_at,target_updated_at,created_by,created_at) "+
  "SELECT v.kind,v.id,t.id,v.value,t.value,v.updated_at,t.updated_at,?,? FROM reference_values v JOIN reference_values t ON t.id=? AND t.kind=v.kind "+
  "WHERE v.id=? AND v.kind IN ('return_reason','writeoff_reason') AND v.is_active=1 AND t.is_active=1 "+
  "AND v.value=? AND t.value=? AND v.updated_at IS ? AND t.updated_at IS ? "+
  "AND NOT EXISTS(SELECT 1 FROM reference_reason_choice_merges m WHERE m.source_reference_id=v.id)"
 const updateSql="UPDATE reference_values SET is_active=0,updated_at=? "+
  "WHERE id=? AND kind=? AND value=? AND is_active=1 AND updated_at IS ? "+
  "AND EXISTS(SELECT 1 FROM reference_reason_choice_merges m WHERE m.source_reference_id=? AND m.target_reference_id=? AND m.created_at=?)"
 const validationSql="INSERT INTO reference_reason_choice_validations(merge_id,passed,checked_at) "+
  "SELECT m.id,CASE WHEN v.is_active=0 AND v.updated_at=m.created_at "+
  "AND t.is_active=1 AND t.value=m.target_value AND v.value=m.source_value "+
  "AND v.kind=m.kind AND t.kind=m.kind AND t.updated_at IS m.target_updated_at THEN 1 ELSE 0 END,? "+
  "FROM reference_reason_choice_merges m JOIN reference_values v ON v.id=m.source_reference_id "+
  "JOIN reference_values t ON t.id=m.target_reference_id "+
  "WHERE m.source_reference_id=? AND m.target_reference_id=? AND m.created_at=?"
 const statements=[
  db.prepare(insertSql).bind(name,stamp,targetId,sourceId,source.value,target.value,source.updated_at,target.updated_at),
  db.prepare(updateSql).bind(stamp,sourceId,source.kind,source.value,source.updated_at,sourceId,targetId,stamp),
  db.prepare(validationSql).bind(stamp,sourceId,targetId,stamp),
 ]
 const changes=await db.batch(statements)
 if(changes.length!==3||changes.some(x=>toInt(x?.meta?.changes,0)!==1))
  throw invalid('Причины изменились во время объединения. Обновите проверку.','reason_merge_race')
 return {ok:true,merged:true,sourceId,targetId,ordersUpdated:0,affectsFutureSelectionsOnly:true,historicalRecordsPreserved:true}
}
