// Dormant, dependency-injected execution engine for an administrator's
// erroneous-order cancellation chain. Deliberately NOT routed from Worker:
// real D1/financial/stock handlers require a separate E2E integration gate.
import { cleanText, toInt } from '../core/text.ts'
import { CriticalOperationConflictError } from './critical.ts'
import { previewAdminOrderDeletion } from './order-delete-preview.ts'
import { previewAdminOrderDeleteChain, type DeleteChainPlanStep } from './order-delete-chain-plan.ts'

export type SagaCancelStep = {
  orderId:number; sagaRequestId:string; cancelRequestId:string;
  stepIndex:number; type:'exchange'|'return'; id:number;
}
export type SagaCancelDriver = {
  // Must reject new independent downstream operations, physical stocktake,
  // stale money ledgers, ambiguous reversal source and physical handovers.
  preflight:(step:SagaCancelStep)=>Promise<void>;
  // Existing critical operations must honor the exact same request ID on
  // every retry and never double-apply a stock/payment reversal.
  cancel:(step:SagaCancelStep)=>Promise<unknown>;
  // Only TRUE when BOTH business status and money/stock invariants are
  // independently verified after the underlying handler has completed.
  verifyReconciled:(step:SagaCancelStep)=>Promise<boolean>;
}
export type SagaProgress = {
  requestId:string;orderId:number;status:string;
  nextStep:number;totalSteps:number;lastError:string;
  remaining:Array<{type:'exchange'|'return';id:number;stepIndex:number}>;
}
const sagaId=(v:unknown)=>cleanText(v)
const validId=(v:string)=>v.length>=10&&v.length<=128&&/^[a-zA-Z0-9_:\-.]+$/.test(v)

async function readSaga(db:D1Database,requestId:string){
  return db.prepare(
    'SELECT * FROM admin_order_delete_sagas WHERE request_id=?'
  ).bind(requestId).first<Record<string,unknown>>()
}
async function readSagaSteps(db:D1Database,requestId:string){
  const rows=await db.prepare(
    'SELECT * FROM admin_order_delete_saga_steps WHERE saga_request_id=? ORDER BY step_index ASC'
  ).bind(requestId).all<Record<string,unknown>>()
  return rows.results||[]
}
export async function getAdminDeleteSagaProgress(
  db:D1Database,requestIdRaw:string,
):Promise<SagaProgress>{
  const requestId=sagaId(requestIdRaw),run=await readSaga(db,requestId)
  if(!run)throw new CriticalOperationConflictError('Журнал отмены этого заказа не найден.')
  const steps=await readSagaSteps(db,requestId)
  const next=toInt(run.next_step,0)
  return {requestId,orderId:toInt(run.order_id,0),status:cleanText(run.status),
    nextStep:next,totalSteps:steps.length,lastError:cleanText(run.last_error),
    remaining:steps.filter(x=>cleanText(x.status)!=='completed').map(x=>({
      type:cleanText(x.operation_type) as 'return'|'exchange',
      id:toInt(x.operation_id,0),stepIndex:toInt(x.step_index,0),
    })),
  }
}

export async function planAdminDeleteSaga(
  db:D1Database,orderIdRaw:number,requestIdRaw:string,expectedSnapshotRaw:string,
):Promise<SagaProgress>{
  const orderId=toInt(orderIdRaw,0),requestId=sagaId(requestIdRaw)
  const expected=cleanText(expectedSnapshotRaw)
  if(!orderId||!validId(requestId)||!/^[0-9a-f]{64}$/.test(expected))
    throw new CriticalOperationConflictError('Укажите заказ, уникальный ключ операции и актуальный отпечаток предпросмотра.')
  const existing=await readSaga(db,requestId)
  if(existing){
    if(toInt(existing.order_id,0)!==orderId
      ||cleanText(existing.preview_fingerprint)!==expected)
      throw new CriticalOperationConflictError('Этот ключ уже принадлежит другой цепочке отмен.')
    return getAdminDeleteSagaProgress(db,requestId)
  }
  const preview=await previewAdminOrderDeletion(db,orderId)
  const plan=await previewAdminOrderDeleteChain(db,orderId)
  if(plan.snapshotFingerprint!==expected||preview.chainPlan.snapshotFingerprint!==expected)
    throw new CriticalOperationConflictError('Заказ изменился после предварительного просмотра. Обновите и проверьте цепочку.')
  if(!plan.allOperationsAccountedFor||plan.manualReviewRequired||plan.blockers.length
    ||plan.steps.length===0||plan.steps.length>100||plan.steps.some(x=>x.requiresManualReview))
    throw new CriticalOperationConflictError('Не все обмены и возвраты имеют однозначные связи. Автоматическая отмена не разрешена.')
  // No financial reversal policy has been approved yet. Refuse to prepare an
  // executable saga with ANY registered or reconciled cash movement.
  if(preview.paymentCount!==0||preview.registeredPayments!==0
    ||preview.receivedAmount!==0||preview.returnAmount!==0||preview.recordedRefunds!==0)
    throw new CriticalOperationConflictError('По заказу есть финансовые операции. Для них ещё не готова безопасная политика отмены; автоматический запуск заблокирован.')
  const timestamp=new Date().toISOString()
  const steps=plan.steps as DeleteChainPlanStep[]
  const statements:D1PreparedStatement[]=[
    db.prepare(
      \`INSERT INTO admin_order_delete_sagas(
        request_id,order_id,status,preview_fingerprint,plan_json,next_step,
        created_at,updated_at
      ) VALUES (?,?,'planned',?,?,0,?,?)\`
    ).bind(requestId,orderId,expected,JSON.stringify(steps),timestamp,timestamp),
    ...steps.map((step,index)=>db.prepare(
      \`INSERT INTO admin_order_delete_saga_steps(
        saga_request_id,step_index,operation_type,operation_id,cancel_request_id
      ) VALUES(?,?,?,?,?)\`
    ).bind(requestId,index,step.type,step.id,
      \`\${requestId}:\${step.type}:\${step.id}\`)),
  ]
  try{await db.batch(statements)}catch(error){
    const current=await readSaga(db,requestId)
    if(current&&toInt(current.order_id,0)===orderId
      &&cleanText(current.preview_fingerprint)===expected)
      return getAdminDeleteSagaProgress(db,requestId)
    throw new CriticalOperationConflictError(
      'Другая операция удаления уже запущена, либо не удалось безопасно сохранить её план. Действующие заказы не изменены.')
  }
  return getAdminDeleteSagaProgress(db,requestId)
}

// Executes at most ONE step per call. An authenticated future integration may
// call repeatedly; this version must remain unreachable by the HTTP router.
// The final order DELETE is intentionally NOT performed here.
export async function advanceAdminDeleteSagaOneStep(
  db:D1Database,requestIdRaw:string,driver:SagaCancelDriver,
):Promise<SagaProgress>{
  const requestId=sagaId(requestIdRaw)
  if(!validId(requestId))throw new CriticalOperationConflictError('Неправильный ключ операции.')
  const before=await readSaga(db,requestId)
  if(!before)throw new CriticalOperationConflictError('Журнал отмены не найден.')
  if(cleanText(before.status)==='ready_for_final_delete'
    ||cleanText(before.status)==='cancelled')return getAdminDeleteSagaProgress(db,requestId)
  if(!['planned','running'].includes(cleanText(before.status)))
    throw new CriticalOperationConflictError('Цепочка ожидает проверки администратором.')
  const orderId=toInt(before.order_id,0),next=toInt(before.next_step,0)
  const steps=await readSagaSteps(db,requestId)
  if(next<0||next>steps.length||!steps.length)
    throw new CriticalOperationConflictError('Состояние цепочки повреждено; дальнейшая отмена остановлена.')
  const lease=crypto.randomUUID(),nowMs=Date.now(),now=new Date().toISOString()
  const claim=await db.prepare(
    \`UPDATE admin_order_delete_sagas
     SET lease_token=?,lease_until_ms=?,status='running',updated_at=?,last_error=NULL
     WHERE request_id=? AND next_step=? AND status IN ('planned','running')
       AND (lease_token IS NULL OR lease_until_ms<=?)\`
  ).bind(lease,nowMs+45000,now,requestId,next,nowMs).run()
  if(toInt(claim.meta?.changes,0)!==1)
    throw new CriticalOperationConflictError('Другая отмена этой цепочки уже выполняется. Повторите позже.')
  try {
    if(next===steps.length){
      await db.prepare(
        \`UPDATE admin_order_delete_sagas
         SET status='ready_for_final_delete',lease_token=NULL,lease_until_ms=0,
           updated_at=? WHERE request_id=? AND lease_token=? AND next_step=?\`
      ).bind(new Date().toISOString(),requestId,lease,next).run()
      return getAdminDeleteSagaProgress(db,requestId)
    }
    const row=steps[next]
    if(toInt(row.step_index,-1)!==next
      ||!['pending','started'].includes(cleanText(row.status))
      ||!['return','exchange'].includes(cleanText(row.operation_type))){
      throw new CriticalOperationConflictError('Неоднозначный этап отмены, требуется проверка журнала.')
    }
    const step:SagaCancelStep={
      orderId,sagaRequestId:requestId,cancelRequestId:cleanText(row.cancel_request_id),
      stepIndex:next,type:cleanText(row.operation_type) as 'exchange'|'return',
      id:toInt(row.operation_id,0),
    }
    if(!step.cancelRequestId||!step.id)
      throw new CriticalOperationConflictError('Отсутствует неизменяемый ключ отмены или операция.')
    await driver.preflight(step)
    // Mark intent BEFORE calling the existing handler. If the Worker fails
    // between cancel and checkpoint, the SAME cancelRequestId is reused.
    await db.prepare(
      \`UPDATE admin_order_delete_saga_steps
       SET status='started',started_at=COALESCE(started_at,?)
       WHERE saga_request_id=? AND step_index=? AND status IN ('pending','started')\`
    ).bind(new Date().toISOString(),requestId,next).run()
    const result=await driver.cancel(step)
    if(!await driver.verifyReconciled(step))
      throw new CriticalOperationConflictError('Операция ответила, но её статус, финансы или склад не прошли независимую сверку. Не продолжаем цепочку.')
    const doneAt=new Date().toISOString()
    // D1.batch runs atomically. Invalid JSON intentionally aborts on stale
    // cursor/lease, so there is no "marked completed but cursor not advanced".
    await db.batch([
      db.prepare(
        \`SELECT json('ADMIN_DELETE_SAGA_STALE')
         WHERE NOT EXISTS(
           SELECT 1 FROM admin_order_delete_sagas a
           JOIN admin_order_delete_saga_steps s ON s.saga_request_id=a.request_id
           WHERE a.request_id=? AND a.lease_token=? AND a.next_step=?
             AND a.status='running' AND s.step_index=?
             AND s.status='started' AND s.cancel_request_id=?
         )\`
      ).bind(requestId,lease,next,next,step.cancelRequestId),
      db.prepare(
        \`UPDATE admin_order_delete_saga_steps
         SET status='completed',completed_at=?,verified_result_json=?
         WHERE saga_request_id=? AND step_index=? AND status='started'\`
      ).bind(doneAt,JSON.stringify(result??null),requestId,next),
      db.prepare(
        \`UPDATE admin_order_delete_sagas
         SET next_step=?,status=?,lease_token=NULL,lease_until_ms=0,
           last_error=NULL,updated_at=?
         WHERE request_id=? AND lease_token=? AND next_step=?\`
      ).bind(next+1,next+1===steps.length?'ready_for_final_delete':'running',
        doneAt,requestId,lease,next),
    ])
    return getAdminDeleteSagaProgress(db,requestId)
  } catch(error) {
    await db.prepare(
      \`UPDATE admin_order_delete_sagas
       SET lease_token=NULL,lease_until_ms=0,last_error=?,updated_at=?
       WHERE request_id=? AND lease_token=?\`
    ).bind(cleanText(error instanceof Error?error.message:error).slice(0,900),
      new Date().toISOString(),requestId,lease).run().catch(()=>null)
    // NEVER advance the cursor when a handler failed or cannot be reconciled.
    throw error
  }
}
