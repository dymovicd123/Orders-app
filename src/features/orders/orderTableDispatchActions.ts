import type { Dispatch, SetStateAction } from 'react'
import { dispatchSelectionError } from './shippingSelection'

export type OrderTableDispatchOrder = { id: number; external_id: string }

export type OrderTableDispatchLine = {
  orderItemId: number
  productName: string
  selectable: boolean
  readyQuantity: number
  selectedQuantity: number
  sourceType: string
  color?: string | null
  material?: string | null
  length?: string | null
  size?: string | null
  reason?: string
  needsStockConfirmation?: boolean
  dispatchPriorIssued?: boolean
}

export type OrderTableDispatchPlan = {
  ok: boolean
  message?: string
  lines: OrderTableDispatchLine[]
  selectedCount?: number
  canConfirmIssuedOnly?: boolean
}

export type OrderTableDispatchHistoryLine = {
  dispatchItemId: number
  orderItemId: number
  productName: string
  quantity: number
  cancelledQuantity: number
  color?: string | null
  material?: string | null
  length?: string | null
  size?: string | null
  dispatchedAt?: string | null
  dispatchDate?: string | null
  hasReturn?: boolean
  hasExchange?: boolean
}
type OrderTableDispatchHistoryResponse = {
  ok: boolean
  message?: string
  dispatches?: OrderTableDispatchHistoryLine[]
}
type OrderTableStockConfirmation = {
  productName?: string
  source?: string
  variantId: number
  expectedQuantity: number
  trackedPhysicalQuantity?: number
  operationQuantity: number
}
type OrderTableDispatchMutationResult = {
  ok: boolean
  message?: string
  code?: string
  items?: OrderTableStockConfirmation[]
  shippedQuantity?: number
  needsStockCheck?: boolean
}

export type OrderTableDispatchDraft = {
  order: OrderTableDispatchOrder
  plan: OrderTableDispatchPlan | null
  history: OrderTableDispatchHistoryLine[]
  loading: boolean
  submitting: boolean
  error: string
  selected: Record<number, number>
  requestId: string
  correctionKey: string
  correctionItemId: number
}

type StockResolutionQuestion = {
  title: string
  intro: string
  actionLabel: string
  items: Array<{productName: string; tracked: number; needed: number}>
  note: string
}

type OrderTableDispatchActionsArgs = {
  dispatchDraft: OrderTableDispatchDraft | null
  setDispatchDraft: Dispatch<SetStateAction<OrderTableDispatchDraft | null>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  askStockResolution: (question: StockResolutionQuestion) => Promise<boolean>
  askActionConfirmation: (question: string) => Promise<boolean>
  setMessage: Dispatch<SetStateAction<string | null>>
  onShipmentChange: () => Promise<unknown>
}

// This is the existing table-level dispatch workflow, not a new sending policy.
// Keep the same requestId across retries, never bypass the Worker stock/CAS checks,
// and do not treat prior stock issue as proof of shipment to the customer.
export function createOrderTableDispatchActions({
  dispatchDraft,
  setDispatchDraft,
  apiFetch,
  askStockResolution,
  askActionConfirmation,
  setMessage,
  onShipmentChange,
}: OrderTableDispatchActionsArgs) {
  const newDispatchRequestId=()=>`order-dispatch:${crypto.randomUUID()}`
  // A committed shipment is never a failed shipment merely because its readback fails.
  // Keep the modal busy until the latest order list read finishes, then show its result.
  const finishCommittedShipment=async(message:string)=>{
    let refreshed=true
    try{refreshed=(await onShipmentChange())!==false}catch{refreshed=false}
    setDispatchDraft(null)
    setMessage(refreshed?message:`${message} Список заказов не обновился — обновите его вручную.`)
  }
  const openDispatchDraft=(order:OrderTableDispatchOrder)=>{
    setDispatchDraft({order,plan:null,history:[],loading:true,submitting:false,
      error:'',selected:{},requestId:newDispatchRequestId(),correctionKey:'',correctionItemId:0})
    void (async()=>{
      try{
        const [planRes,historyRes]=await Promise.all([
          apiFetch(`/api/orders/${order.id}/shipping/plan`),
          apiFetch(`/api/orders/${order.id}/shipping/dispatches`),
        ])
        const [plan,history]=await Promise.all([
          planRes.json() as Promise<OrderTableDispatchPlan>,
          historyRes.json() as Promise<OrderTableDispatchHistoryResponse>,
        ])
        if(!planRes.ok||!plan.ok)throw new Error(plan.message||'Не удалось загрузить готовые товары.')
        if(!historyRes.ok||!history.ok)throw new Error(history.message||'Не удалось загрузить отправки.')
        const selected=Object.fromEntries((plan.lines||[]).filter((row:OrderTableDispatchLine)=>row.selectable)
          .map((row:OrderTableDispatchLine)=>[Number(row.orderItemId),Number(row.selectedQuantity)]))
        setDispatchDraft(d=>d?.order.id===order.id?{...d,loading:false,plan,
          history:history.dispatches||[],selected,error:''}:d)
      }catch(e){
        setDispatchDraft(d=>d?.order.id===order.id?{...d,loading:false,
          error:e instanceof Error?e.message:'Не удалось загрузить отправки.'}:d)
      }
    })()
  }
  const submitSelectedDispatch=()=>{
    const d=dispatchDraft
    if(!d||d.loading||d.submitting)return
    const items=(d.plan?.lines||[]).flatMap((row:OrderTableDispatchLine)=>{
      const quantity=Number(d.selected[Number(row.orderItemId)]||0)
      return row.selectable&&Number.isSafeInteger(quantity)&&quantity>0
        ? [{orderItemId:Number(row.orderItemId),quantity}] : []
    })
    const selectionError=dispatchSelectionError(d.plan?.lines||[],d.selected)
    if(selectionError){setDispatchDraft(v=>v?{...v,error:selectionError}:v);return}
    if(!items.length){setDispatchDraft(v=>v?{...v,error:'Выберите хотя бы одну готовую вещь.'}:v);return}
    setDispatchDraft(v=>v?{...v,submitting:true,error:''}:v)
    void (async()=>{
      try{
        const submit=async(stockConfirmations?:Array<{source:'warehouse'|'boutique';variantId:number;expectedQuantity:number;operationQuantity:number}>)=>{
          const res=await apiFetch(`/api/orders/${d.order.id}/shipping/dispatches`,{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({requestId:d.requestId,items,stockConfirmations}),
          })
          return {res,data:await res.json() as OrderTableDispatchMutationResult}
        }
        let {res,data}=await submit()
        if(!res.ok && data.code==='dispatch_stock_confirmation_required' && Array.isArray(data.items) && data.items.length){
          const confirmed=await askStockResolution({
            title:'Подтвердите наличие отправляемых вещей',
            intro:'По системе остатка или резерва недостаточно. Если эти конкретные вещи действительно у вас, подтвердите их передачу. Чужие резервы останутся на месте.',
            actionLabel:'Да, эти вещи отправляю',
            items:data.items.map((row:OrderTableStockConfirmation)=>({
              productName:String(row.productName||'Товар'),
              tracked:Math.max(0,Number(row.trackedPhysicalQuantity||0)),
              needed:Math.max(1,Number(row.operationQuantity||1)),
            })),
            note:'Подтверждается только эта отправка, а не весь остаток склада. Система запишет расхождение и не спишет одну вещь дважды.',
          })
          if(!confirmed){
            setDispatchDraft(v=>v?.order.id===d.order.id?{...v,submitting:false,error:'Отправка не проведена. Можно вернуться к ней после проверки.'}:v)
            return
          }
          ;({res,data}=await submit(data.items.map((row:OrderTableStockConfirmation)=>({
            source:row.source==='boutique'?'boutique' as const:'warehouse' as const,
            variantId:Number(row.variantId),
            expectedQuantity:Math.max(0,Number(row.expectedQuantity)),
            operationQuantity:Math.max(1,Number(row.operationQuantity)),
          }))))
        }
        if(!res.ok||!data.ok)throw new Error(data.message||'Не удалось отправить товары.')
        await finishCommittedShipment(`Заказ ${d.order.external_id}: отправлено ${data.shippedQuantity||items.reduce((n:number,x:{quantity:number})=>n+x.quantity,0)} шт.`)
      }catch(e){
        setDispatchDraft(v=>v?.order.id===d.order.id?{...v,submitting:false,
          error:e instanceof Error?e.message:'Ошибка отправки. Повторите без изменения выбора.'}:v)
      }
    })()
  }
  const confirmIssuedOnlyDispatch=()=>{
    const d=dispatchDraft
    if(!d || d.loading || d.submitting || !d.plan?.canConfirmIssuedOnly)return
    setDispatchDraft(v=>v?{...v,submitting:true,error:''}:v)
    void (async()=>{
      try{
        const today=new Date()
        const shippingDate=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
        const res=await apiFetch(`/api/orders/${d.order.id}/shipping`,{
          method:'PATCH',
          headers:{'Content-Type':'application/json','X-Idempotency-Key':d.requestId},
          body:JSON.stringify({shippingStatus:'sent',shippingDate,confirmAlreadyIssued:true}),
        })
        const data=await res.json() as OrderTableDispatchMutationResult as OrderTableDispatchMutationResult
        if(!res.ok||!data.ok)throw new Error(data.message||'Не удалось подтвердить отправку.')
        await finishCommittedShipment(`Заказ ${d.order.external_id}: отправка подтверждена без повторного списания склада.`)
      }catch(e){
        setDispatchDraft(v=>v?.order.id===d.order.id?{...v,submitting:false,
          error:e instanceof Error?e.message:'Не удалось подтвердить отправку.'}:v)
      }
    })()
  }
  const cancelDispatchedLine=(line:OrderTableDispatchHistoryLine)=>{
    const d=dispatchDraft
    if(!d||d.submitting)return
    void (async()=>{
      const yes=await askActionConfirmation(
        `Отменить отправку товара «${line.productName}», ${line.quantity} шт.? Подтверждайте только если клиенту эту вещь фактически не передавали. Если вещь уже у клиента, оформите возврат.`
      )
      if(!yes)return
      const key=d.correctionItemId===Number(line.dispatchItemId)&&d.correctionKey
        ? d.correctionKey : newDispatchRequestId()
      setDispatchDraft(v=>v?{...v,submitting:true,error:'',correctionKey:key,
        correctionItemId:Number(line.dispatchItemId)}:v)
      try{
        const res=await apiFetch(`/api/orders/${d.order.id}/shipping/dispatch-items/${line.dispatchItemId}/correct`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({requestId:key,reason:'Исправление ошибочной отправки'}),
        })
        const data=await res.json()
        if(!res.ok||!data.ok)throw new Error(data.message||'Не удалось исправить отправку.')
        await finishCommittedShipment(data.needsStockCheck
          ? 'Отправка исправлена. После недавнего пересчёта остаток автоматически не увеличен — уточните количество на складе.'
          : 'Отправка исправлена. Остальные товары заказа не изменились.')
      }catch(e){
        setDispatchDraft(v=>v?.order.id===d.order.id?{...v,submitting:false,
          error:e instanceof Error?e.message:'Не удалось исправить отправку.'}:v)
      }
    })()
  }

  return {
    openDispatchDraft,
    submitSelectedDispatch,
    confirmIssuedOnlyDispatch,
    cancelDispatchedLine,
  }
}
