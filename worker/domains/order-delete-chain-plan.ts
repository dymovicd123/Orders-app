// Holistic read-only plan for safely inspecting an admin's requested deletion.
// No operation here has side effects. This is NOT the cancellation executor.
// Future executor must revalidate every preflight, use a persistent saga record
// and never interpret an informational hash as authorization to mutate stock.
import { toInt } from '../core/text.ts'
import { CriticalOperationConflictError } from './critical.ts'
import { previewExchangeCancellationChain } from './exchange-cancel-chain.ts'

type OperationType='exchange'|'return'
export type DeleteChainPlanStep = {
  type:OperationType;id:number;order:number;
  reason:string;requiresManualReview:boolean;
}
export type AdminDeleteChainPlan = {
  orderId:number;
  steps:DeleteChainPlanStep[];
  activeExchangeIds:number[];
  activeReturnIds:number[];
  generatedExchangeRefundIds:number[];
  manualReviewRequired:boolean;
  allOperationsAccountedFor:boolean;
  canExecuteAutomatically:boolean;
  blockers:string[];
  // Hash of the operational facts returned by D1. Informational only: never
  // reuse it instead of per-operation CAS and inventory/financial preflights.
  snapshotFingerprint:string;
}

async function snapshotFingerprint(db:D1Database,orderId:number):Promise<string>{
  // Pin exact event rows, payment and handover facts, not just aggregate counts.
  // This snapshot MUST be freshly recomputed before any future execution.
  const sources=[
    ['orders',`SELECT * FROM orders WHERE id=?`],
    ['order_items',`SELECT * FROM order_items WHERE order_id=? ORDER BY id`],
    ['exchanges',`SELECT * FROM exchanges WHERE order_id=? ORDER BY id`],
    ['exchange_items',`SELECT ei.* FROM exchange_items ei JOIN exchanges e ON e.id=ei.exchange_id WHERE e.order_id=? ORDER BY ei.id`],
    ['returns',`SELECT * FROM returns WHERE order_id=? ORDER BY id`],
    ['return_items',`SELECT ri.* FROM return_items ri JOIN returns r ON r.id=ri.return_id WHERE r.order_id=? ORDER BY ri.id`],
    ['payments',`SELECT * FROM payments WHERE order_id=? ORDER BY id`],
    ['inventory_reservations',`SELECT * FROM inventory_reservations WHERE order_id=? ORDER BY id`],
  ] as const
  // Also freeze any audit entries that can change the consequences after
  // admin reviews the preview: warehouse lifecycle, finance journal and cash.
  // Synthetic pre-migration SQLite fixtures may not contain all of these
  // tables; production migrations do. Table identifiers are fixed literals.
  const existingTables=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('inventory_lifecycle_events','financial_events','cash_register_entries')"
  ).all<{name:string}>()
  const known=new Set((existingTables.results||[]).map(x=>x.name))
  const related:ReadonlyArray<readonly [string,string]>=[
    ['inventory_lifecycle_events','SELECT * FROM inventory_lifecycle_events WHERE order_id=? ORDER BY id'],
    ['financial_events','SELECT * FROM financial_events WHERE order_id=? ORDER BY id'],
    ['cash_register_entries','SELECT * FROM cash_register_entries WHERE order_id=? ORDER BY id'],
  ]
  const parts=[]
  for(const [name,sql] of [...sources,...related.filter(([table])=>known.has(table))]) {
    const rows=await db.prepare(sql).bind(orderId).all<Record<string,unknown>>()
    if(!rows.success && rows.success!==undefined)
      throw new CriticalOperationConflictError('Не удалось проверить снимок '+name+' перед удалением.')
    if((rows.results||[]).length>2000)
      throw new CriticalOperationConflictError('История заказа слишком большая для безопасного предпросмотра.')
    parts.push([name,rows.results||[]])
  }
  const payload=JSON.stringify(parts)
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('')
}

export async function previewAdminOrderDeleteChain(
  db:D1Database,orderIdRaw:number,
):Promise<AdminDeleteChainPlan>{
  const orderId=toInt(orderIdRaw,0)
  if(!orderId)throw new CriticalOperationConflictError('Не указан заказ для проверки зависимостей.')
  const [activeEx,activeRet]=await Promise.all([
    db.prepare(`SELECT id,refund_return_id FROM exchanges
      WHERE order_id=? AND COALESCE(status,'completed')<>'cancelled'
      ORDER BY id DESC LIMIT 201`).bind(orderId).all<{id:number;refund_return_id:number|null}>(),
    db.prepare(`SELECT id FROM returns
      WHERE order_id=? AND COALESCE(status,'completed')<>'cancelled'
      ORDER BY id DESC LIMIT 201`).bind(orderId).all<{id:number}>(),
  ])
  const exRows=activeEx.results||[],retRows=activeRet.results||[]
  if(exRows.length>200||retRows.length>200)
    throw new CriticalOperationConflictError('История обменов или возвратов слишком большая для автоматического плана.')
  const activeExchangeIds=exRows.map(x=>toInt(x.id,0))
  const activeReturnIds=retRows.map(x=>toInt(x.id,0))
  const activeReturnSet=new Set(activeReturnIds)
  if(activeExchangeIds.some(x=>x<=0)||activeReturnIds.some(x=>x<=0))
    throw new CriticalOperationConflictError('Некорректный идентификатор связанной операции.')

  const ownerOfRefund=new Map<number,number>()
  const blockers:string[]=[]
  for(const e of exRows){
    const refundId=toInt(e.refund_return_id,0)
    if(!refundId)continue
    if(!activeReturnSet.has(refundId)){
      blockers.push(`Обмен #${e.id} ссылается на отсутствующий или уже отменённый связанный возврат #${refundId}.`)
      continue
    }
    const prev=ownerOfRefund.get(refundId)
    if(prev)blockers.push(`Возврат #${refundId} связан сразу с обменами #${prev} и #${e.id}.`)
    ownerOfRefund.set(refundId,toInt(e.id,0))
  }
  const generatedExchangeRefundIds=[...ownerOfRefund.keys()].sort((a,b)=>a-b)
  const nodes=new Map<string,DeleteChainPlanStep>()
  const links=new Map<string,Set<string>>()
  const ensure=(type:OperationType,id:number,reason:string,manual=false)=>{
    const key=type[0]+id
    const old=nodes.get(key)
    if(old) {
      old.requiresManualReview ||=manual
    } else {
      nodes.set(key,{type,id,order:0,reason,requiresManualReview:manual})
    }
    if(!links.has(key))links.set(key,new Set())
    return key
  }
  for(const id of activeExchangeIds)ensure('exchange',id,'Обмен, связанный с удаляемым заказом')
  for(const id of activeReturnIds) {
    if(!ownerOfRefund.has(id))ensure('return',id,'Самостоятельный возврат по заказу')
  }

  // Keep the causal relationships found by the per-exchange graph. Every
  // adjacent pair of an already-safe leaf-first plan is an execution barrier.
  for(const id of activeExchangeIds){
    const plan=await previewExchangeCancellationChain(db,orderId,id)
    const seq=plan.steps
    for(let i=0;i<seq.length;i++){
      const item=seq[i]
      const key=ensure(item.type,item.id,item.reason,item.requiresManualReview)
      if(i>0){
        const prev=seq[i-1]
        const prevKey=ensure(prev.type,prev.id,prev.reason,prev.requiresManualReview)
        links.get(prevKey)!.add(key)
      }
    }
    if(plan.manualReviewRequired)
      blockers.push(`Для отмены обмена #${id} требуется отдельная проверка исторических данных или старого формата.`)
  }
  // Do not count an Exchange's automatically created refund as an unrelated
  // standalone Return; the exchange's own handler owns its reversal.
  const expected=new Set<string>([
    ...activeExchangeIds.map(id=>'e'+id),
    ...activeReturnIds.filter(id=>!ownerOfRefund.has(id)).map(id=>'r'+id),
  ])
  const unexpected=[...nodes.keys()].filter(x=>!expected.has(x))
  if(unexpected.length)
    blockers.push('План ссылается на операцию за пределами активной истории заказа: '+unexpected.join(', '))
  const unplanned=[...expected].filter(x=>!nodes.has(x))
  if(unplanned.length)
    blockers.push('Не удалось учесть операции: '+unplanned.join(', '))

  // A stable topological sort preserves the reverse dependency sequence and
  // puts independent Returns ahead of Exchanges as a conservative convention.
  const indegree=new Map<string,number>([...nodes.keys()].map(key=>[key,0]))
  for(const descendants of links.values())
    for(const target of descendants)indegree.set(target,(indegree.get(target)||0)+1)
  const compare=(a:string,b:string)=>{
    const aReturn=a.startsWith('r'),bReturn=b.startsWith('r')
    if(aReturn!==bReturn)return aReturn?-1:1
    return Number(b.slice(1))-Number(a.slice(1))
  }
  const pending=[...indegree].filter(([,n])=>n===0).map(([key])=>key).sort(compare)
  const sorted:string[]=[]
  while(pending.length){
    const key=pending.shift()!
    sorted.push(key)
    for(const child of links.get(key)||[]){
      const next=(indegree.get(child)||0)-1
      indegree.set(child,next)
      if(next===0)pending.push(child)
    }
    pending.sort(compare)
  }
  if(sorted.length!==nodes.size)
    blockers.push('Цепочка содержит цикл или несовместимые зависимости: автоматическая отмена недопустима.')
  const steps=sorted.map((key,index)=>({...nodes.get(key)!,order:index+1}))
  const manualReviewRequired=steps.some(x=>x.requiresManualReview)||blockers.length>0
  const allOperationsAccountedFor=sorted.length===expected.size
    &&unexpected.length===0&&unplanned.length===0
  const snapshot=await snapshotFingerprint(db,orderId)
  return {
    orderId,steps,activeExchangeIds,activeReturnIds,generatedExchangeRefundIds,
    manualReviewRequired,allOperationsAccountedFor,
    // No one-click execution until per-step financial+stock preflight and
    // resumable failure injection tests prove the whole chain.
    canExecuteAutomatically:false,
    blockers,
    snapshotFingerprint:snapshot,
  }
}
