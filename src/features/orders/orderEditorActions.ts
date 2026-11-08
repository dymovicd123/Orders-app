import type { Dispatch, SetStateAction } from 'react'
import type { CatalogResponse, EditorDraft, EditorItem, EditorPayment, OrderRecord } from '../../app/types'
import { createEmptyEditorItem, createEmptyEditorPayment, formatLocalDateInput, normalizeAudienceTypeValue, normalizeSuggestion, readJsonResponse } from '../../app/utils'
import { resolveCatalogOrderSalePrice } from '../../app/order-pricing'

type OrderEditorActionsArgs = {
  editorDraft: EditorDraft | null
  selectedOrder: OrderRecord | null
  savingOrder: boolean
  catalogData: CatalogResponse | null
  getSizeOptions: (productName?: string, audienceType?: string) => string[]
  isAdmin: boolean
  setEditorDraft: Dispatch<SetStateAction<EditorDraft | null>>
  setSavingOrder: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  prepareCriticalRequest: <T extends Record<string, unknown>>(key: string, basePayload: T) => { requestId: string; payload: T & { requestId: string } }
  completeCriticalRequest: (key: string, requestId: string) => void
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  upsertOrderInState: (order: OrderRecord) => void
  setSelectedOrderId: Dispatch<SetStateAction<number | null>>
  setEditorOrderOverride: Dispatch<SetStateAction<OrderRecord | null>>
  invalidateFinanceReadCaches: () => void
  refreshDashboard: () => void
  refreshFinanceReports: () => void | Promise<unknown>
}

// Maintains the editor's local draft and independent payment write boundaries.
export function createOrderEditorActions({
  editorDraft,
  selectedOrder,
  savingOrder,
  catalogData,
  getSizeOptions,
  isAdmin,
  setEditorDraft,
  setSavingOrder,
  setError,
  setMessage,
  prepareCriticalRequest,
  completeCriticalRequest,
  apiFetch,
  upsertOrderInState,
  setSelectedOrderId,
  setEditorOrderOverride,
  invalidateFinanceReadCaches,
  refreshDashboard,
  refreshFinanceReports,
}: OrderEditorActionsArgs) {
  function updateEditorDraft<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) {
    setEditorDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  function updateEditorItem(index: number, field: keyof EditorItem, value: string | number | boolean | null) {
    setEditorDraft((current) => {
      if (!current) return current
      const nextItems = current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        const nextItem = { ...item, [field]: field === 'audienceType' ? normalizeAudienceTypeValue(value) : value }
        if (field === 'unitPrice') {
          const rawPrice = value === null || value === undefined ? '' : String(value).trim()
          nextItem.unitPrice = rawPrice === '' ? undefined : Number(rawPrice)
          if (selectedOrder?.pricing_mode === 'itemized_v1') {
            nextItem.priceOrigin = rawPrice === '' ? 'missing' : 'manual'
            nextItem.priceNeedsConfirmation = false
          }
          return nextItem
        }
        if (field === 'priceNeedsConfirmation') {
          nextItem.priceNeedsConfirmation = Boolean(value)
          return nextItem
        }
        if (['productName', 'audienceType', 'gender', 'color', 'material', 'length', 'size', 'sourceType'].includes(String(field))) {
          nextItem.stockObservationEnabled = false
          nextItem.observedPhysicalQuantity = null
          nextItem.shortageAcknowledged = false
          nextItem.serverShortage = undefined
        }
        if (field === 'quantity') {
          nextItem.shortageAcknowledged = false
          nextItem.serverShortage = undefined
        }
        if (field === 'audienceType') {
          nextItem.audienceType = normalizeAudienceTypeValue(value)
        }
        if (field === 'audienceType') {
          const nextOptions = getSizeOptions(nextItem.productName, nextItem.audienceType)
          if (nextItem.size && !nextOptions.some((option) => normalizeSuggestion(option) === normalizeSuggestion(nextItem.size))) {
            nextItem.size = ''
          }
        }
        if (selectedOrder?.pricing_mode === 'itemized_v1' && ['productName', 'audienceType', 'material', 'length'].includes(String(field))) {
          const pricing = resolveCatalogOrderSalePrice(catalogData, nextItem)
          const keepManualPrice = item.priceOrigin === 'manual' && item.unitPrice !== undefined && item.unitPrice !== null
          nextItem.catalogPriceSnapshot = pricing.status === 'matched' ? pricing.catalogPriceSnapshot : null
          if (keepManualPrice) {
            nextItem.unitPrice = item.unitPrice
            nextItem.priceOrigin = 'manual'
            nextItem.priceNeedsConfirmation = false
          } else {
            nextItem.unitPrice = pricing.status === 'matched' ? pricing.salePrice : undefined
            nextItem.priceOrigin = pricing.status === 'matched' ? 'catalog' : 'missing'
            nextItem.priceNeedsConfirmation = false
          }
        }
        return nextItem
      })
      return { ...current, items: nextItems }
    })
  }

  function updateEditorPayment(index: number, field: keyof EditorPayment, value: string | number) {
    setEditorDraft((current) => {
      if (!current) return current
      const nextPayments = current.payments.map((payment, paymentIndex) => {
        if (paymentIndex !== index) return payment
        if (payment.id && payment.paymentKind === 'extra' && field !== 'method') return payment
        if (!payment.id && field === 'paymentDate' && payment.paymentKind === 'primary') return payment
        if (field === 'paymentKind') {
          const nextKind: EditorPayment['paymentKind'] = value === 'debt_close' ? 'debt_close' : 'primary'
          return {
            ...payment,
            paymentKind: nextKind,
            paymentDate: !payment.id && nextKind === 'primary'
              ? (current.orderDate || payment.paymentDate)
              : (payment.paymentDate || formatLocalDateInput()),
          }
        }
        return { ...payment, [field]: value }
      })
      return { ...current, payments: nextPayments }
    })
  }

  function addEditorPayment(paymentKind: 'primary' | 'debt_close') {
    const draftKey = `editor-payment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    setEditorDraft((current) => {
      if (!current) return current
      const paymentDate = paymentKind === 'primary'
        ? (current.orderDate || formatLocalDateInput())
        : formatLocalDateInput()
      return {
        ...current,
        payments: [...current.payments, { ...createEmptyEditorPayment(paymentDate), paymentKind, draftKey }],
      }
    })
  }

  function removeEditorPayment(index: number) {
    setEditorDraft((current) => {
      if (!current || current.payments[index]?.id) return current
      return { ...current, payments: current.payments.filter((_, paymentIndex) => paymentIndex !== index) }
    })
  }

  async function saveEditorPayment(index: number) {
    if (!editorDraft || !selectedOrder || savingOrder) return
    const payment = editorDraft.payments[index]
    if (!payment || payment.id) return
    const paymentKind = payment.paymentKind === 'primary' || payment.paymentKind === 'debt_close'
      ? payment.paymentKind
      : null
    if (!paymentKind) {
      setError('Для обычного заказа доступны только первичная оплата и закрытие долга. Доплата оформляется только внутри обмена.')
      return
    }

    const amount = Number(payment.amount || 0)
    if (!payment.paymentDate) {
      setError('Укажите фактическую дату оплаты.')
      return
    }
    if (!String(payment.method || '').trim()) {
      setError('Выберите способ оплаты.')
      return
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      setError('Сумма оплаты должна быть целым числом больше нуля.')
      return
    }

    setSavingOrder(true)
    setError(null)
    setMessage(null)
    try {
      const payload = {
        orderId: selectedOrder.id,
        paymentDate: payment.paymentDate,
        method: payment.method,
        amount,
        paymentKind,
        comment: payment.comment || '',
      }
      const criticalKey = `order-editor-payment:${selectedOrder.id}:${payment.draftKey || index}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })
      const result = await readJsonResponse<{
        ok?: boolean
        message?: string
        paymentId?: number | null
        order?: OrderRecord
        refreshRequired?: boolean
      }>(response, 'Добавление оплаты')
      if (!response.ok || !result.ok) throw new Error(result.message || `Payment save failed: ${response.status}`)
      const paymentId = Number(result.paymentId || 0)
      if (!paymentId) {
        throw new Error('Оплата могла сохраниться, но сервер не вернул её идентификатор. Повторите сохранение этой строки — повтор безопасен.')
      }
      completeCriticalRequest(criticalKey, critical.requestId)
      setEditorDraft((current) => current ? ({
        ...current,
        payments: current.payments.map((entry, paymentIndex) => (
          paymentIndex === index ? { ...entry, id: paymentId, draftKey: undefined } : entry
        )),
      }) : current)
      if (result.order) {
        upsertOrderInState(result.order)
        setSelectedOrderId(result.order.id)
        setEditorOrderOverride(result.order)
      } else if (result.refreshRequired) {
        void loadDashboard(false)
      }
      invalidateFinanceReadCaches()
      setMessage(`Оплата по заказу ${selectedOrder.external_id} проведена отдельно и не переписывает предыдущие оплаты.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить оплату.')
    } finally {
      setSavingOrder(false)
    }
  }

  function addEditorItem() {
  setEditorDraft((current) => {
    if (!current) return current
    const nextItem = selectedOrder?.pricing_mode === 'itemized_v1'
      ? { ...createEmptyEditorItem(), unitPrice: undefined, catalogPriceSnapshot: null, priceOrigin: 'missing' as const, priceNeedsConfirmation: false }
      : createEmptyEditorItem()
    return { ...current, items: [...current.items, nextItem] }
  })
}

function removeEditorItem(index: number) {
  setEditorDraft((current) => {
    if (!current) return current
    if (selectedOrder?.pricing_mode === 'itemized_v1' && current.items.length <= 1) return current
    const nextItems = current.items.filter((_, itemIndex) => itemIndex !== index)
    return { ...current, items: nextItems.length ? nextItems : [createEmptyEditorItem()] }
  })
}


  async function correctRecordedPaymentMethod(
    order:OrderRecord,payment:OrderRecord['payments'][number],nextMethod:string,
  ):Promise<{ok:boolean;message:string}>{
    if(!isAdmin)return {ok:false,message:'Способ проведённой оплаты исправляет только администратор.'}
    const method=String(nextMethod||'').trim()
    if(!method)return {ok:false,message:'Выберите способ оплаты.'}
    if(!Number.isSafeInteger(Number(payment.id))||Number(payment.id)<=0)
      return {ok:false,message:'Не удалось определить запись оплаты. Обновите заказ.'}
    if(method.toUpperCase()===String(payment.method||'').trim().toUpperCase())
      return {ok:true,message:'Способ оплаты не изменился.'}
    const payload={paymentCorrections:[{
      paymentId:Number(payment.id),method,
      expectedPaymentDate:String(payment.paymentDate||''),
      expectedMethod:String(payment.method||''),
      expectedAmount:Number(payment.amount||0),
      expectedPaymentKind:String(payment.paymentKind||'primary'),
      expectedComment:String(payment.comment||''),
    }]}
    const key='order-admin-payment-method:'+order.id+':'+payment.id
    setSavingOrder(true);setError(null);setMessage(null)
    try{
      const critical=prepareCriticalRequest(key,payload)
      const response=await apiFetch('/api/orders/'+order.id,{
        method:'PATCH',headers:{'Content-Type':'application/json','X-Idempotency-Key':critical.requestId},
        body:JSON.stringify(critical.payload),
      })
      const result=await readJsonResponse<{ok?:boolean;message?:string;order?:OrderRecord;refreshRequired?:boolean}>(
        response,'Исправление способа оплаты')
      if(!response.ok||result.ok===false)throw new Error(result.message||'Не удалось исправить способ оплаты.')
      completeCriticalRequest(key,critical.requestId)
      if(result.order)upsertOrderInState(result.order)
      else if(result.refreshRequired)refreshDashboard()
      invalidateFinanceReadCaches()
      void Promise.allSettled([refreshFinanceReports(),loadDashboard(false)])
      const message='Способ оплаты #'+payment.id+' исправлен. Сумма, заказ, товары и склад не менялись.'
      setMessage(message)
      return {ok:true,message}
    }catch(error){
      const message=error instanceof Error?error.message:'Не удалось изменить способ оплаты.'
      setError(message)
      return {ok:false,message}
    }finally{setSavingOrder(false)}
  }


  return {
    updateEditorDraft,
    updateEditorItem,
    updateEditorPayment,
    addEditorPayment,
    removeEditorPayment,
    saveEditorPayment,
    addEditorItem,
    removeEditorItem,
    correctRecordedPaymentMethod,
  }
}
