// Read-only ordering of an Exchange Set cancellation. Never changes prices,
// payments, inventory movements, or exchange/return status.
// This PREVIEW is deliberately not a promise that the later cancellation will
// pass financial/stock preflight; each actual operation rechecks its own CAS.
import { toInt } from '../core/text.ts'
import { CriticalOperationConflictError } from './critical.ts'

type ExchangeNode = {
  type:'exchange'; id:number; isV2:boolean; generatedRefundId:number|null;
}
type ReturnNode = {type:'return';id:number}
export type ChainCancellationStep = {
  type:'exchange'|'return'; id:number; order:number;
  reason:string; requiresManualReview:boolean;
}
export type ChainCancellationPreview = {
  orderId:number; exchangeId:number; blockedByLaterOperations:boolean;
  canAttemptCancelNow:boolean; manualReviewRequired:boolean;
  steps:ChainCancellationStep[]; notice:string;
}

export async function previewExchangeCancellationChain(
  db:D1Database,orderIdRaw:number,exchangeIdRaw:number,
):Promise<ChainCancellationPreview>{
  const orderId=toInt(orderIdRaw,0), exchangeId=toInt(exchangeIdRaw,0)
  if(!orderId||!exchangeId)throw new CriticalOperationConflictError('Укажите заказ и обмен для проверки цепочки.')
  const exchangeRows=await db.prepare(
    \`SELECT e.id,e.refund_return_id,
      EXISTS(SELECT 1 FROM critical_operations op
        WHERE op.operation_type='exchange_set_create' AND op.target_type='exchange'
          AND op.target_id=e.id) AS is_v2
     FROM exchanges e WHERE e.order_id=?
       AND COALESCE(e.status,'completed')<>'cancelled'
     ORDER BY e.id ASC LIMIT 201\`
  ).bind(orderId).all<Record<string,unknown>>()
  const exchanges=exchangeRows.results||[]
  if(exchanges.length>200)throw new CriticalOperationConflictError('Цепочка обменов слишком большая. Требуется отдельная проверка.')
  const nodes=new Map<string,ExchangeNode|ReturnNode>()
  for(const x of exchanges){
    const id=toInt(x.id,0)
    if(!id||nodes.has('e'+id))throw new CriticalOperationConflictError('В цепочке обнаружены неоднозначные обмены.')
    nodes.set('e'+id,{type:'exchange',id,isV2:toInt(x.is_v2,0)===1,
      generatedRefundId:toInt(x.refund_return_id,0)||null})
  }
  const root='e'+exchangeId
  if(!nodes.has(root))throw new CriticalOperationConflictError('Обмен не найден в активных обменах этого заказа.')

  const itemRows=await db.prepare(
    \`SELECT ei.exchange_id,ei.order_item_id,ei.role
     FROM exchange_items ei JOIN exchanges e ON e.id=ei.exchange_id
     WHERE e.order_id=? AND COALESCE(e.status,'completed')<>'cancelled'
     ORDER BY e.id ASC,ei.id ASC\`
  ).bind(orderId).all<Record<string,unknown>>()
  const newItemOwners=new Map<number,Set<number>>()
  const oldItemConsumers=new Map<number,Set<number>>()
  for(const x of itemRows.results||[]){
    const ex=toInt(x.exchange_id,0),itemId=toInt(x.order_item_id,0)
    if(!ex||!itemId||!nodes.has('e'+ex))throw new CriticalOperationConflictError('Связь позиции обмена повреждена.')
    if(x.role!=='new'&&x.role!=='old')throw new CriticalOperationConflictError('Неизвестная роль позиции обмена.')
    const map=x.role==='new'?newItemOwners:oldItemConsumers
    if(!map.has(itemId))map.set(itemId,new Set())
    map.get(itemId)!.add(ex)
  }

  const returnRows=await db.prepare(
    \`SELECT r.id,e.id AS generated_by_exchange_id
     FROM returns r LEFT JOIN exchanges e
       ON e.refund_return_id=r.id AND e.order_id=r.order_id
       AND COALESCE(e.status,'completed')<>'cancelled'
     WHERE r.order_id=? AND COALESCE(r.status,'completed')<>'cancelled'
     ORDER BY r.id ASC LIMIT 201\`
  ).bind(orderId).all<Record<string,unknown>>()
  const returns=returnRows.results||[]
  if(returns.length>200)throw new CriticalOperationConflictError('У заказа слишком много возвратов для автоматической проверки.')
  const generatedBy=new Map<number,number|null>()
  for(const ret of returns){
    const id=toInt(ret.id,0)
    if(!id||generatedBy.has(id))throw new CriticalOperationConflictError('У возврата неоднозначная связь с обменом.')
    const generated=toInt(ret.generated_by_exchange_id,0)||null
    generatedBy.set(id,generated)
    // Generated refund belongs to its Exchange cancellation, not to a
    // standalone Return cancellation.
    if(!generated)nodes.set('r'+id,{type:'return',id})
  }
  const returnItems=await db.prepare(
    \`SELECT ri.return_id,ri.order_item_id
     FROM return_items ri JOIN returns r ON r.id=ri.return_id
     WHERE r.order_id=? AND COALESCE(r.status,'completed')<>'cancelled'
     ORDER BY ri.return_id ASC,ri.order_item_id ASC\`
  ).bind(orderId).all<Record<string,unknown>>()
  const returnsByItem=new Map<number,Set<number>>()
  for(const x of returnItems.results||[]){
    const rid=toInt(x.return_id,0),itemId=toInt(x.order_item_id,0)
    if(!rid||!itemId||!generatedBy.has(rid))
      throw new CriticalOperationConflictError('Связь возвращённого товара повреждена.')
    if(!returnsByItem.has(itemId))returnsByItem.set(itemId,new Set())
    returnsByItem.get(itemId)!.add(rid)
  }

  // Edges always point from an earlier Exchange to a later operation that
  // consumed/returned one of its NEW lines, not to unrelated order events.
  const outgoing=new Map<string,Set<string>>()
  const anomalies=new Set<string>()
  for(const [itemId,owners] of newItemOwners){
    for(const owner of owners){
      const key='e'+owner
      if(!outgoing.has(key))outgoing.set(key,new Set())
      for(const child of oldItemConsumers.get(itemId)||[]){
        if(child===owner){anomalies.add(key);continue}
        outgoing.get(key)!.add('e'+child)
      }
      for(const rid of returnsByItem.get(itemId)||[]){
        const generator=generatedBy.get(rid)
        if(generator===owner)continue // own refund is undone with own Exchange
        if(generator){
          // A refund owned by a different Exchange is not an ordinary Return.
          // It must not be hidden silently; chain may be corrupt/incomplete.
          anomalies.add(key)
          continue
        }
        outgoing.get(key)!.add('r'+rid)
      }
    }
  }

  const visited=new Set<string>(), visiting=new Set<string>()
  const sequence:string[]=[]
  const walk=(key:string,depth:number)=>{
    if(depth>100||visiting.has(key))
      throw new CriticalOperationConflictError('В цепочке обменов обнаружен цикл. Автоматический порядок отмены недоступен.')
    if(visited.has(key))return
    if(!nodes.has(key))throw new CriticalOperationConflictError('Часть связанных операций отсутствует.')
    visiting.add(key)
    for(const next of [...(outgoing.get(key)||[])].sort((a,b)=>Number(b.slice(1))-Number(a.slice(1))))
      walk(next,depth+1)
    visiting.delete(key)
    visited.add(key)
    sequence.push(key)
  }
  walk(root,0)
  if(sequence.length>100)throw new CriticalOperationConflictError('Слишком длинная цепочка для автоматического просмотра.')

  const steps:ChainCancellationStep[]=sequence.map((key,index)=>{
    const node=nodes.get(key)!
    return {type:node.type,id:node.id,order:index+1,
      reason:key===root?'Исходный обмен':node.type==='return'?'Возврат по товару из обмена':'Последующий обмен полученного товара',
      requiresManualReview:node.type==='exchange'&&!node.isV2}
  })
  const blockedByLaterOperations=sequence.length>1
  const manualReviewRequired=steps.some(s=>s.requiresManualReview)
    ||sequence.some(key=>anomalies.has(key))
  return {
    orderId,exchangeId,blockedByLaterOperations,
    canAttemptCancelNow:!blockedByLaterOperations&&!manualReviewRequired,
    manualReviewRequired,steps,
    notice:manualReviewRequired
      ? 'Обнаружена операция старого формата или неоднозначная связь. Требуется ручная проверка, автоматическая отмена не предлагается.'
      : blockedByLaterOperations
        ? 'Сначала отмените зависимые операции в указанном порядке. Каждая отмена отдельно проверит финансы и склад.'
        : 'Поздних зависимых операций не обнаружено. Отмена всё равно выполнит отдельные проверки финансов и склада.',
  }
}
