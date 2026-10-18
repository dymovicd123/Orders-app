// An administrator can correct falsely recorded delivery from the same
// deletion dialogue. This is a separate, fully revalidated and auditable
// physical correction, not a shortcut past stocktake safeguards.
import {cleanText,toInt} from '../core/text.ts'
import type {AuthUser} from '../core/types.ts'
import {CriticalOperationConflictError} from './critical.ts'
import {previewAdminOrderDeletion} from './order-delete-preview.ts'
import {correctMistakenOrderHandoverWithCurrentExchange} from './returns-exchanges.ts'

export async function correctPhysicalBeforeAdminDelete(
  db:D1Database,orderIdRaw:number,
  input:{expectedSnapshot?:unknown;physicalOutcome?:unknown},
  actor:AuthUser,
){
  if(actor.role!=='admin')
    throw new CriticalOperationConflictError('Подтверждение удаления доступно только администратору.')
  const orderId=toInt(orderIdRaw,0),snapshot=cleanText(input.expectedSnapshot)
  if(!orderId||!/^[a-f0-9]{64}$/.test(snapshot)
    ||cleanText(input.physicalOutcome)!=='not_issued')
    throw new CriticalOperationConflictError('Нужно явно подтвердить, что товар клиенту не передавался.')
  const preview=await previewAdminOrderDeletion(db,orderId)
  if(preview.chainPlan.snapshotFingerprint!==snapshot)
    throw new CriticalOperationConflictError('Заказ изменился. Откройте окно удаления заново и проверьте последствия.')
  if(!preview.requiresPhysicalFact)
    return {ok:true,alreadyCorrected:true,preview}
  // Only the physical-handover marker may block the chain. An unrelated
  // financial mismatch, ambiguous relationship or missing stock history
  // should never authorize a preliminary physical mutation.
  const otherReasons=preview.reasons.filter(x=>
    !x.startsWith('Для цепочки с зафиксированной выдачей товара'))
  if(otherReasons.length)
    throw new CriticalOperationConflictError(
      'Перед исправлением выдачи выявлены другие расхождения. '+
      otherReasons.join(' ')
    )
  const result=await correctMistakenOrderHandoverWithCurrentExchange(db,orderId,{
    physicalOutcome:'not_issued',actor:'Администратор · отмена ошибочного заказа',
  })
  // Fresh preview is mandatory; physical reconciliation changes snapshot.
  const updated=await previewAdminOrderDeletion(db,orderId)
  if(updated.requiresPhysicalFact)
    throw new CriticalOperationConflictError(
      'Отметка выдачи ещё присутствует после корректировки. Удаление не выполнялось.'
    )
  return {ok:true,physicalCorrected:true,correction:result,preview:updated}
}
