// Future schema-first Return V2 compatibility barrier.
// NOT called by current Worker handlers: tables 0126/0128 are not in remote D1.
// Every old writer must check BEFORE starting, and recheck the same exclusion
// IN ITS ATOMIC SQL write. Preflight alone does not prevent a concurrent V2 post.
export type LegacyMutationKind=
 'order_edit'|'order_delete'|'manual_payment'|'return_create'|'return_cancel'
 |'exchange_create'|'exchange_cancel'|'shipping'|'stock_handover'
 |'order_money_sync'
export class ReturnV2LegacyMutationBlocked extends Error{
 readonly status=409
 readonly code='return_v2_legacy_mutation_blocked'
}
type Row={id:number;physical_v2:number;unified_v2:number}
export type ReturnV2LegacyMutationGate={
  orderId:number;v2History:'none'|'physical'|'unified'|'conflict';
  legacyWritesAllowed:boolean;v2SchemaReady:boolean;reason:string
}
function reject(message:string):never{throw new ReturnV2LegacyMutationBlocked(message)}
export async function readReturnV2LegacyMutationGate(
 db:D1Database,orderId:number,
):Promise<ReturnV2LegacyMutationGate>{
 if(!Number.isSafeInteger(orderId)||orderId<1)
  reject('Некорректный заказ.')
 // Old remote Branch2 D1 has not yet received experimental V2 tables.
 // A fully old schema cannot contain any posted V2, and must preserve V1.
 // A PARTIAL schema is corruption: stop the write rather than guess.
 const schema=await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master
  WHERE type='table' AND name IN ('return_v2_postings','return_v2_unified_postings')`)
  .first<{n:number}>()
 if(schema?.n===0){
  const order=await db.prepare('SELECT id FROM orders WHERE id=? LIMIT 1')
   .bind(orderId).first<{id:number}>()
  if(!order)reject('Заказ не найден.')
  return {orderId,v2History:'none',legacyWritesAllowed:true,v2SchemaReady:false,
   reason:'Старая схема без Return V2; исходная обработка разрешена.'}
 }
 if(schema?.n!==2)reject('Схема Return V2 установлена не полностью. Запись запрещена.')
 const row=await db.prepare(`SELECT o.id,
  (SELECT COUNT(*) FROM return_v2_postings vp WHERE vp.order_id=o.id) AS physical_v2,
  (SELECT COUNT(*) FROM return_v2_unified_postings up WHERE up.order_id=o.id) AS unified_v2
  FROM orders o WHERE o.id=? LIMIT 1`).bind(orderId).first<Row>()
 if(!row)reject('Заказ не найден.')
 if(!Number.isSafeInteger(row.physical_v2)||!Number.isSafeInteger(row.unified_v2)||
    row.physical_v2<0||row.unified_v2<0)
  reject('История V2 не подтверждена.')
 const v2History=row.physical_v2>0&&row.unified_v2>0?'conflict'
   :row.physical_v2>0?'physical'
   :row.unified_v2>0?'unified':'none'
 const legacyWritesAllowed=v2History==='none'
 return {orderId,v2History,legacyWritesAllowed,v2SchemaReady:true,
   reason:legacyWritesAllowed?'Старый обработчик разрешён: истории Return V2 нет.'
     :'Заказ содержит историю Return V2. Старые операции могут нарушить деньги, позиции или склад.'}
}
export async function assertLegacyMutationAllowedAfterReturnV2(
 db:D1Database,orderId:number,kind:LegacyMutationKind,
){
 const kinds:LegacyMutationKind[]=[
  'order_edit','order_delete','manual_payment','return_create','return_cancel',
  'exchange_create','exchange_cancel','shipping','stock_handover','order_money_sync',
 ]
 if(!kinds.includes(kind))reject('Неизвестная операция: нужна проверка совместимости.')
 const gate=await readReturnV2LegacyMutationGate(db,orderId)
 if(!gate.legacyWritesAllowed)
  reject('После Return V2 действие «'+kind+'» через старую обработку запрещено. '+
   'Используйте совместимый механизм или обратитесь к администратору.')
 return gate
}
// Reuse this condition in future V1 write SQL, not merely an HTTP preflight.
// orderIdExpr MUST be a trusted SQL expression defined by the caller, not input.
export function legacyV1WriteExclusionSql(orderIdExpr:string){
 if(!/^[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)?$/.test(orderIdExpr))
  throw new Error('Unsafe orderId SQL reference')
 return `NOT EXISTS(SELECT 1 FROM return_v2_postings vp WHERE vp.order_id=${orderIdExpr})
   AND NOT EXISTS(SELECT 1 FROM return_v2_unified_postings up WHERE up.order_id=${orderIdExpr})`
}
