import type { Dispatch, SetStateAction } from 'react'
import type { OrderRecord } from '../../app/types'
import { readJsonResponse } from '../../app/utils'
import { composeOrderExchangeCancellationPlan, type OrderExchangeCancelPlan } from '../../app/orderExchangeCancellationPlan'

export type ReturnCancelChoice={
  id:number;date:string;amount:number;method:string;itemQuantity:number;
  parentExchangeId:number|null;
}

type OrderDependentCancellationArgs = {
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  prepareCriticalRequest: <T extends Record<string, unknown>>(key: string, basePayload: T) => { requestId: string; payload: T & { requestId: string } }
  completeCriticalRequest: (key: string, requestId: string) => void
  setSavingOrder: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  upsertOrderInState: (order: OrderRecord) => void
  invalidateInventoryStockCaches: (includeCatalogReview?: boolean) => void
  invalidateFinanceReadCaches: () => void
  loadExchangeHistory: () => Promise<unknown>
  loadReturnHistory: () => Promise<unknown>
  loadDashboard: (force?: boolean) => Promise<unknown>
  loadWorkshopData: () => Promise<unknown>
  refreshFinanceReportsIfVisible: () => unknown
  loadInventoryLifecycle: (force?: boolean) => Promise<unknown>
}

// Every dependency chain is re-read before mutation, then each Return/Exchange
// step is a separate original CAS/idempotent Worker cancellation. Never cancel
// a separate Return merely because it belongs to the same order.
export function createOrderDependentCancellationActions({
  apiFetch,
  prepareCriticalRequest,
  completeCriticalRequest,
  setSavingOrder,
  setError,
  setMessage,
  upsertOrderInState,
  invalidateInventoryStockCaches,
  invalidateFinanceReadCaches,
  loadExchangeHistory,
  loadReturnHistory,
  loadDashboard,
  loadWorkshopData,
  refreshFinanceReportsIfVisible,
  loadInventoryLifecycle,
}: OrderDependentCancellationArgs) {
  async function loadExchangeCancellationPreview(order:OrderRecord, exchangeId?:number):Promise<{
    availableExchangeIds:number[];
    preview:null|{
      exchangeId:number;blockedByLaterOperations:boolean;canAttemptCancelNow:boolean;
      manualReviewRequired:boolean;notice:string;
      steps:Array<{type:'exchange'|'return';id:number;order:number;reason:string;requiresManualReview:boolean}>;
    };
  }> {
    const url=`/api/orders/${order.id}/exchange-cancel-chain`
      + (exchangeId ? `?exchangeId=${encodeURIComponent(exchangeId)}` : '')
    const response=await apiFetch(url)
    const data=await readJsonResponse<{
      ok?:boolean;message?:string;availableExchangeIds?:number[];
      preview?:{
        exchangeId:number;blockedByLaterOperations:boolean;canAttemptCancelNow:boolean;
        manualReviewRequired:boolean;notice:string;
        steps:Array<{type:'exchange'|'return';id:number;order:number;reason:string;requiresManualReview:boolean}>;
      } | null;
    }>(response,'Зависимости обменов')
    if(!response.ok || data.ok===false)throw new Error(data.message||'Не удалось проверить цепочку обменов.')
    return {availableExchangeIds:Array.isArray(data.availableExchangeIds)?data.availableExchangeIds:[],
      preview:data.preview??null}
  }


  // Preview only. Compose the existing, server-proven per-exchange dependency
  // graphs. Never include an independent Return that is not actually downstream
  // of an exchange. Each real cancellation revalidates its own money/stock CAS.
  async function loadOrderExchangeCancellationPlan(
    order:OrderRecord,mode:'last'|'all',
  ):Promise<OrderExchangeCancelPlan>{
    const discovery=await loadExchangeCancellationPreview(order)
    const available=discovery.availableExchangeIds
    const selected=mode==='last' ? available.slice(-1) : [...available]
    if(!selected.length)return {mode,availableExchangeIds:[],selectedExchangeIds:[],
      steps:[],signature:'',canExecute:false,manualReviewRequired:false,
      notice:'У заказа нет активных обменов.'}
    // A bounded bulk action is easier to inspect and safer to resume.
    if(selected.length>20)throw new Error('Более 20 обменов. Массовую отмену нужно проверить отдельно.')
    const previews=await Promise.all(selected.map(async(id)=>{
      const result=await loadExchangeCancellationPreview(order,id)
      if(result.availableExchangeIds.join(',')!==available.join(',')
        ||!result.preview||result.preview.exchangeId!==id)
        throw new Error('История обменов изменилась. Откройте проверку заново.')
      return result.preview
    }))
    return composeOrderExchangeCancellationPlan(mode,available,selected,previews)
  }

  async function cancelOrderExchangeChain(
    order:OrderRecord,expected:OrderExchangeCancelPlan,
    onProgress?:(done:number,total:number)=>void,
  ):Promise<void>{
    // Never use a stale preview as authorization. Reconstruct the dependency
    // graph immediately before writes; the existing endpoints enforce CAS again.
    const current=await loadOrderExchangeCancellationPlan(order,expected.mode)
    if(!current.canExecute||!current.steps.length||current.signature!==expected.signature)
      throw new Error('История обменов изменилась или есть небезопасная операция. Обновите предпросмотр.')
    let completed=0
    setSavingOrder(true)
    setError(null)
    try{
      for(const step of current.steps){
        const key='exchange-chain-cancel:'+order.id+':'+step.type+':'+step.id
        const payload={comment:'Аннулирование '+(expected.mode==='all'?'всех обменов':'последнего обмена')
          +' из заказа '+order.external_id}
        const critical=prepareCriticalRequest(key,payload)
        const url=step.type==='exchange'
          ? '/api/exchanges/'+step.id+'/cancel'
          : '/api/returns/'+step.id+'/cancel'
        const response=await apiFetch(url,{
          method:'PATCH',headers:{'Content-Type':'application/json',
            'X-Idempotency-Key':critical.requestId},
          body:JSON.stringify(critical.payload),
        })
        const result=await readJsonResponse<{ok?:boolean;message?:string;order?:OrderRecord}>(
          response,'Отмена '+(step.type==='exchange'?'обмена':'возврата')+' #'+step.id)
        if(!response.ok||result.ok===false)
          throw new Error('Шаг '+(completed+1)+'/'+current.steps.length+': '
            +(result.message||'Не удалось отменить операцию #'+step.id)
            +'. Уже завершённые шаги сохраняются. Повторите оставшуюся цепочку.')
        completeCriticalRequest(key,critical.requestId)
        if(result.order)upsertOrderInState(result.order)
        completed++
        onProgress?.(completed,current.steps.length)
      }
      setMessage('Обмены по заказу '+order.external_id
        +' отменены. Исходные записи сохранились в истории.')
    }finally{
      setSavingOrder(false)
      invalidateInventoryStockCaches(true)
      invalidateFinanceReadCaches()
      await Promise.allSettled([
        loadExchangeHistory(),loadReturnHistory(),loadDashboard(false),
        loadWorkshopData(),refreshFinanceReportsIfVisible(),
        loadInventoryLifecycle(true),
      ])
    }
  }


  async function loadOrderReturnCancellationChoices(order:OrderRecord):Promise<ReturnCancelChoice[]>{
    const response=await apiFetch('/api/orders/'+order.id+'/return-cancel-choices')
    const data=await readJsonResponse<{ok?:boolean;message?:string;choices?:ReturnCancelChoice[]}>(
      response,'Возвраты по заказу')
    if(!response.ok||data.ok===false)throw new Error(data.message||'Не удалось загрузить возвраты.')
    return Array.isArray(data.choices)?data.choices:[]
  }

  async function cancelOrderReturnChoice(
    order:OrderRecord,selected:ReturnCancelChoice,
  ):Promise<void>{
    // No stale selection can be used as authority. A separate Exchange-owned
    // refund must NEVER be cancelled independently.
    const current=await loadOrderReturnCancellationChoices(order)
    const actual=current.find(x=>x.id===selected.id)
    if(!actual||actual.parentExchangeId
      ||actual.amount!==selected.amount
      ||actual.itemQuantity!==selected.itemQuantity
      ||actual.date!==selected.date)
      throw new Error('Возврат изменился или связан с обменом. Откройте его заново.')
    const payload={comment:'Аннулирование самостоятельного возврата по заказу '+order.external_id}
    const criticalKey='order-return-cancel:'+order.id+':'+selected.id
    const critical=prepareCriticalRequest(criticalKey,payload)
    setSavingOrder(true)
    setError(null)
    try{
      const response=await apiFetch('/api/returns/'+selected.id+'/cancel',{
        method:'PATCH',headers:{'Content-Type':'application/json',
          'X-Idempotency-Key':critical.requestId},
        body:JSON.stringify(critical.payload),
      })
      const result=await readJsonResponse<{ok?:boolean;message?:string;order?:OrderRecord}>(
        response,'Отмена возврата #'+selected.id)
      if(!response.ok||result.ok===false)
        throw new Error(result.message||'Не удалось отменить возврат #'+selected.id)
      completeCriticalRequest(criticalKey,critical.requestId)
      if(result.order)upsertOrderInState(result.order)
      setMessage('Возврат #'+selected.id+' по заказу '+order.external_id+
        ' аннулирован. Складская и финансовая история сохранена.')
    }finally{
      setSavingOrder(false)
      invalidateInventoryStockCaches(true)
      invalidateFinanceReadCaches()
      await Promise.allSettled([
        loadReturnHistory(),loadDashboard(false),loadWorkshopData(),
        refreshFinanceReportsIfVisible(),loadInventoryLifecycle(true),
      ])
    }
  }


  return {
    loadExchangeCancellationPreview,
    loadOrderExchangeCancellationPlan,
    cancelOrderExchangeChain,
    loadOrderReturnCancellationChoices,
    cancelOrderReturnChoice,
  }
}
