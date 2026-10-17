// Branch2-only reviewed entry point. One HTTP call performs at most one
// dependency cancellation (or the final order void), not an unsafe bulk loop.
// The persistent saga journal and handler request IDs make retries recoverable.
import { cleanText, toInt } from '../core/text.ts'
import type { AuthUser } from '../core/types.ts'
import { CriticalOperationConflictError } from './critical.ts'
import { planAdminDeleteSaga, advanceAdminDeleteSagaOneStep, getAdminDeleteSagaProgress } from './admin-delete-saga.ts'
import { createRealAdminDeleteCancellationDriver } from './admin-delete-real-driver.ts'
import { finalizeAdminDeleteSaga } from './admin-delete-finalize.ts'
import { createRealAdminOrderDeleteFinalAction } from './admin-delete-final-driver.ts'

const validRequest=(value:string)=>/^[A-Za-z0-9_:\-.]{10,128}$/.test(value)

async function activeSaga(db:D1Database,orderId:number){
  return db.prepare(
    "SELECT request_id,order_id,status FROM admin_order_delete_sagas WHERE order_id=? AND status IN ('planned','running','review_required','ready_for_final_delete') ORDER BY created_at DESC LIMIT 1"
  ).bind(orderId).first<{request_id:string;order_id:number;status:string}>()
}
export async function readActiveAdminDeleteChain(db:D1Database,orderId:number){
  const existing=await activeSaga(db,orderId)
  return existing?await getAdminDeleteSagaProgress(db,existing.request_id):null
}
export async function executeAdminDeleteChainStep(
  db:D1Database,orderIdRaw:number,
  input:{requestId?:unknown;expectedSnapshot?:unknown},actor:AuthUser,
){
  if(actor.role!=='admin')throw new CriticalOperationConflictError('Удаление заказа доступно только администратору.')
  const orderId=toInt(orderIdRaw,0)
  const requestId=cleanText(input.requestId),expected=cleanText(input.expectedSnapshot)
  if(!orderId||!validRequest(requestId))
    throw new CriticalOperationConflictError('Укажите заказ и постоянный ключ удаления.')
  const other=await activeSaga(db,orderId)
  if(other&&other.request_id!==requestId)
    throw new CriticalOperationConflictError('У этого заказа уже идёт удаление. Вернитесь к начатой операции, не создавайте новую.')
  const original=await db.prepare(
    'SELECT order_id,status FROM admin_order_delete_sagas WHERE request_id=?'
  ).bind(requestId).first<{order_id:number;status:string}>()
  if(original&&toInt(original.order_id,0)!==orderId)
    throw new CriticalOperationConflictError('Ключ удаления уже принадлежит другому заказу.')
  let progress=original
    ?await getAdminDeleteSagaProgress(db,requestId)
    :await planAdminDeleteSaga(db,orderId,requestId,expected)
  if(progress.status==='completed')return {ok:true,progress,refreshRequired:true}
  if(progress.status==='planned'||progress.status==='running'){
    progress=await advanceAdminDeleteSagaOneStep(db,requestId,
      createRealAdminDeleteCancellationDriver(db))
  }else if(progress.status==='ready_for_final_delete'){
    progress=await finalizeAdminDeleteSaga(db,requestId,
      createRealAdminOrderDeleteFinalAction(actor))
  }else{
    throw new CriticalOperationConflictError('Операция остановлена для проверки. Нельзя продолжить автоматически.')
  }
  return {
    ok:true,progress,refreshRequired:progress.status==='completed',
    message:progress.status==='completed'
      ?'Ошибка заказа и её связанные учётные операции аннулированы.'
      : 'Проверено и отменено операций: '+progress.nextStep+' из '+progress.totalSteps,
  }
}
