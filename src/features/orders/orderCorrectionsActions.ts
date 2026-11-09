import type { Dispatch, SetStateAction } from 'react'
import type { OrderRecord } from '../../app/types'
import { readJsonResponse } from '../../app/utils'

export type RetiredExchangePriceOption = {
  exchangeId:number;orderItemId:number;productName:string;size:string;color:string;
  originalUnitPrice:number;currentRecordedUnitPrice:number;
}

type OrderCorrectionsArgs = {
  setSavingOrder: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  prepareCriticalRequest: <T extends Record<string, unknown>>(key: string, basePayload: T) => { requestId: string; payload: T & { requestId: string } }
  completeCriticalRequest: (key: string, requestId: string) => void
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  upsertOrderInState: (order: OrderRecord) => void
  refreshDashboard: () => void
}

// Narrow corrections preserve original CAS evidence and never create refunds,
// new payments or inventory movements.
export function createOrderCorrectionsActions({
  setSavingOrder,
  setError,
  setMessage,
  prepareCriticalRequest,
  completeCriticalRequest,
  apiFetch,
  upsertOrderInState,
  refreshDashboard,
}: OrderCorrectionsArgs) {
  // Narrow metadata correction: only six order details, never items, payments,
  // prices, shipping state or manager ownership. The Worker performs the
  // original-value + lifecycle/finance CAS before the actual update.
  async function correctOrderMetadata(order: OrderRecord, next: {
    orderDate:string;customerPhone:string;customerName:string;
    city:string;deliveryType:string;comment:string;
  }): Promise<boolean> {
    const expected={
      orderDate:String(order.order_date||'').trim(),
      customerPhone:String(order.customer_phone||'').trim(),
      customerName:String(order.customer_name||'').trim(),
      city:String(order.city||'').trim(),
      deliveryType:String(order.delivery_type||'').trim(),
      comment:String(order.comment||'').trim(),
    }
    if(Object.keys(expected).every(key=>
      expected[key as keyof typeof expected]===next[key as keyof typeof next]))return true
    setSavingOrder(true)
    setError(null)
    setMessage(null)
    try {
      const expectedState={
        totalAmount:Number(order.total_amount||0),
        receivedAmount:Number(order.received_amount||0),
        debtAmount:Number(order.debt_amount||0),
        returnAmount:Number(order.return_amount||0),
        shippingStatus:String(order.shipping_status||'').trim(),
        orderStatus:String(order.order_status||'').trim(),
      }
      const payload={metadataCorrection:{expected,next,expectedState}}
      const criticalKey=`order-metadata-correction:${order.id}`
      const critical=prepareCriticalRequest(criticalKey,payload)
      const response=await apiFetch(`/api/orders/${order.id}`,{
        method:'PATCH',headers:{'Content-Type':'application/json','X-Idempotency-Key':critical.requestId},
        body:JSON.stringify(critical.payload),
      })
      const data=await readJsonResponse<{ok?:boolean;message?:string;order?:OrderRecord}>(
        response,'Исправление реквизитов заказа')
      if(!response.ok||data.ok===false)throw new Error(data.message||'Не удалось сохранить реквизиты.')
      completeCriticalRequest(criticalKey,critical.requestId)
      if(data.order)upsertOrderInState(data.order)
      setMessage('Реквизиты заказа обновлены. Оплаты, товары и склад не менялись.')
      refreshDashboard()
      return true
    }catch(error){
      setError(error instanceof Error?error.message:'Не удалось обновить реквизиты.')
      return false
    }finally{
      setSavingOrder(false)
    }
  }

  // A recorded-price typo is NOT a new sale, cash refund, stock edit, or exchange cancellation.
  // Send the minimal correction payload, never the whole editor draft.
  async function correctRecordedOrderItemPrice(order: OrderRecord, item: OrderRecord['items'][number], nextUnitPrice: number): Promise<boolean> {
    if (!Number.isSafeInteger(nextUnitPrice) || nextUnitPrice < 0 || !item.id) {
      setError('Укажите корректную цену и выберите существующую позицию заказа.')
      return false
    }
    if (nextUnitPrice === Number(item.unitPrice || 0)) return true
    setSavingOrder(true)
    setError(null)
    setMessage(null)
    try {
      const payload = {
        itemPriceCorrections: [{
          orderItemId: Number(item.id),
          unitPrice: nextUnitPrice,
          expectedUnitPrice: Number(item.unitPrice || 0),
          expectedQuantity: Number(item.quantity || 0),
          expectedLineTotal: Number(item.lineTotal || 0),
          expectedCatalogPriceSnapshot: item.catalogPriceSnapshot ?? null,
        }],
      }
      const criticalKey = `recorded-price-correction:${order.id}:${item.id}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string; order?: OrderRecord; refreshRequired?: boolean }>(
        response, 'Исправление записанной цены',
      )
      if (!response.ok || data.ok === false) throw new Error(data.message || 'Не удалось исправить цену.')
      completeCriticalRequest(criticalKey, critical.requestId)
      if (data.order) upsertOrderInState(data.order)
      setMessage(`Цена позиции в заказе ${order.external_id} исправлена. Склад, обмены, возвраты и оплаты не затронуты.`)
      refreshDashboard()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось исправить записанную цену.')
      return false
    } finally {
      setSavingOrder(false)
    }
  }


  // An order with several independent price typos can be corrected in one
  // atomic server request. Every line carries its original CAS facts; cash,
  // inventory and linked exchange/return records are never included.
  async function correctRecordedOrderItemPrices(
    order: OrderRecord,
    changes: Array<{item: OrderRecord['items'][number]; unitPrice: number}>,
  ): Promise<boolean> {
    if (!changes.length) return true
    const ids = new Set<number>()
    if (changes.some(({item, unitPrice}) => {
      const id = Number(item?.id)
      if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)
        || !Number.isSafeInteger(unitPrice) || unitPrice < 0) return true
      ids.add(id)
      return false
    })) {
      setError('Выберите существующие позиции и укажите целые цены от 0 ₸ без повторов.')
      return false
    }
    const payload = {
      itemPriceCorrections: changes.map(({item,unitPrice}) => ({
        orderItemId: Number(item.id),
        unitPrice,
        expectedUnitPrice: Number(item.unitPrice || 0),
        expectedQuantity: Number(item.quantity || 0),
        expectedLineTotal: Number(item.lineTotal || 0),
        expectedCatalogPriceSnapshot: item.catalogPriceSnapshot ?? null,
      })),
    }
    setSavingOrder(true)
    setError(null)
    setMessage(null)
    const sortedIds = [...ids].sort((a,b)=>a-b)
    const criticalKey = `recorded-price-correction-batch:${order.id}:${sortedIds.join('-')}`
    try {
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string; order?: OrderRecord }>(
        response, 'Исправление записанных цен',
      )
      if (!response.ok || data.ok === false) throw new Error(data.message || 'Не удалось сохранить исправления цен.')
      completeCriticalRequest(criticalKey, critical.requestId)
      if (data.order) upsertOrderInState(data.order)
      setMessage(`Исправлено позиций: ${changes.length}. Склад, оплаты и обмены не изменены.`)
      refreshDashboard()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось исправить записанные цены.')
      return false
    } finally {
      setSavingOrder(false)
    }
  }



  async function loadRetiredExchangePriceOptions(order:OrderRecord):Promise<RetiredExchangePriceOption[]> {
    const response=await apiFetch(`/api/orders/${order.id}/exchange-old-price-candidates`)
    const data=await readJsonResponse<{ok?:boolean;message?:string;items?:RetiredExchangePriceOption[]}>(
      response,'Исторические цены обмена')
    if(!response.ok || data.ok===false) throw new Error(data.message||'Не удалось загрузить старые позиции обмена.')
    return Array.isArray(data.items)?data.items:[]
  }

  async function correctRetiredExchangePrice(order:OrderRecord, entry:RetiredExchangePriceOption, next:number):Promise<boolean> {
    if(!Number.isSafeInteger(next)||next<0) {
      setError('Укажите целую правильную цену.')
      return false
    }
    if(next===entry.currentRecordedUnitPrice) return true
    setSavingOrder(true)
    setError(null)
    setMessage(null)
    try {
      const payload={orderItemId:entry.orderItemId,expectedUnitPrice:entry.currentRecordedUnitPrice,newUnitPrice:next}
      const key=`old-exchange-price:${entry.exchangeId}:${entry.orderItemId}`
      const critical=prepareCriticalRequest(key,payload)
      const response=await apiFetch(`/api/exchanges/${entry.exchangeId}/old-recorded-price`,{
        method:'PATCH',
        headers:{'Content-Type':'application/json','X-Idempotency-Key':critical.requestId},
        body:JSON.stringify(critical.payload),
      })
      const result=await readJsonResponse<{ok?:boolean;message?:string}>(
        response,'Исправление исторической цены обмена')
      if(!response.ok||result.ok===false) throw new Error(result.message||'Не удалось исправить историческую цену.')
      completeCriticalRequest(key,critical.requestId)
      setMessage(`Исправленная цена позиции до обмена сохранена в истории заказа ${order.external_id}. Фактические оплаты и остатки не менялись.`)
      refreshDashboard()
      return true
    } catch(error) {
      setError(error instanceof Error?error.message:'Не удалось сохранить историческую цену.')
      return false
    } finally {
      setSavingOrder(false)
    }
  }



  return {
    correctOrderMetadata,
    correctRecordedOrderItemPrice,
    correctRecordedOrderItemPrices,
    loadRetiredExchangePriceOptions,
    correctRetiredExchangePrice,
  }
}
