import type { Dispatch, SetStateAction } from 'react'
import type { AppSector, EditorDraft, OrderPanel, OrderRecord } from '../../app/types'
import type { OrderOperationalProjection } from '../../app/orderOperationalProjection'
import { createEditorDraft, deriveOrderSourceType, normalizeAudienceTypeValue, normalizeSuggestion, readJsonResponse } from '../../app/utils'
import { evaluateItemizedCreatePricing } from '../../app/order-pricing'
import { historicalCatalogSnapshotForEdit } from '../../app/itemizedEditCatalogSnapshot'

type OrderEditPersistenceArgs = {
  isAdmin: boolean
  selectedOrder: OrderRecord | null
  activeSector: AppSector
  orderPanel: OrderPanel
  setSavingOrder: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  getOrderOperationalProjection: (order: OrderRecord) => Promise<OrderOperationalProjection>
  prepareCriticalRequest: <T extends Record<string, unknown>>(key: string, basePayload: T) => { requestId: string; payload: T & { requestId: string } }
  completeCriticalRequest: (key: string, requestId: string) => void
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  setEditorDraft: Dispatch<SetStateAction<EditorDraft | null>>
  setEditorOrderOverride: Dispatch<SetStateAction<OrderRecord | null>>
  setSelectedOrderId: Dispatch<SetStateAction<number | null>>
  setEditorOpen: Dispatch<SetStateAction<boolean>>
  invalidateFinanceReadCaches: () => void
  invalidateInventoryStockCaches: (includeCatalogReview?: boolean) => void
  upsertOrderInState: (order: OrderRecord) => void
  closeOrderEditor: () => void
  refreshDashboard: () => void
  refreshWorkshop: () => void
  refreshOrderFinance: () => void
}


// The original admin-only order edit transaction remains a single critical operation:
// CAS item/prices/payments, downstream lifecycle guard, no silent payment submission.
export function createOrderEditPersistenceActions({
  isAdmin,
  selectedOrder,
  activeSector,
  orderPanel,
  setSavingOrder,
  setError,
  setMessage,
  getOrderOperationalProjection,
  prepareCriticalRequest,
  completeCriticalRequest,
  apiFetch,
  setEditorDraft,
  setEditorOrderOverride,
  setSelectedOrderId,
  setEditorOpen,
  invalidateFinanceReadCaches,
  invalidateInventoryStockCaches,
  upsertOrderInState,
  closeOrderEditor,
  refreshDashboard,
  refreshWorkshop,
  refreshOrderFinance,
}: OrderEditPersistenceArgs) {
  async function persistOrder(nextDraft: EditorDraft, targetOrder?: OrderRecord | null) {
    if (!isAdmin) {
      setError('Полный редактор доступен только администратору. Используйте отдельные исправления цены и реквизитов.')
      return null
    }
    const order = targetOrder || selectedOrder
    if (!order) return
    const isItemizedEdit = order.pricing_mode === 'itemized_v1'
    const normalizedEditorText = (value: unknown) => normalizeSuggestion(String(value ?? ''))
    const originalItemsById = new Map(order.items.map((item) => [Number(item.id || 0), item]))
    const isItemizedContentRewrite = isItemizedEdit && (
      nextDraft.items.length !== order.items.length
      || nextDraft.items.some((item) => {
        const original = originalItemsById.get(Number(item.orderItemId || 0))
        if (!original) return true
        const originalSource = original.isWorkshop ? 'workshop' : (original.sourceType === 'boutique' ? 'boutique' : 'warehouse')
        const nextSource = item.sourceType === 'workshop' ? 'workshop' : (item.sourceType === 'boutique' ? 'boutique' : 'warehouse')
        return normalizedEditorText(item.productName) !== normalizedEditorText(original.productName)
          || normalizeAudienceTypeValue(item.audienceType) !== normalizeAudienceTypeValue(original.audienceType)
          || normalizedEditorText(item.gender) !== normalizedEditorText(original.gender)
          || normalizedEditorText(item.color) !== normalizedEditorText(original.color)
          || normalizedEditorText(item.material || 'СТАНДАРТ') !== normalizedEditorText(original.material || 'СТАНДАРТ')
          || normalizedEditorText(item.length || 'СТАНДАРТ') !== normalizedEditorText(original.length || 'СТАНДАРТ')
          || normalizedEditorText(item.size) !== normalizedEditorText(original.size)
          || Number(item.quantity || 0) !== Number(original.quantity || 0)
          || nextSource !== originalSource
          || String(item.workshopComment || '').trim() !== String(original.workshopComment || '').trim()
          || Boolean(item.workshopUrgent) !== Boolean(original.workshopUrgent)
          || String(item.workshopUrgent ? (item.workshopDueDate || '') : '') !== String(original.workshopUrgent ? (original.workshopDueDate || '') : '')
          || String(item.workshopUrgent ? (item.workshopDueTime || '') : '') !== String(original.workshopUrgent ? (original.workshopDueTime || '') : '')
      })
    )
    const projection = await getOrderOperationalProjection(order)
    if (!projection.canEdit) {
      setMessage(projection.hasCommittedDownstreamOperation
        ? 'Заказ нельзя переписывать: по нему уже проведён возврат или обмен. Сначала отмените или исправьте эту последующую операцию штатным действием.'
        : 'Этот заказ нельзя редактировать в рабочем режиме. Используйте его отдельное штатное действие или просмотр истории.')
      return
    }

    setSavingOrder(true)
    setError(null)
    setMessage(null)

    try {
      const itemPriceCorrections: Array<{
        orderItemId: number
        unitPrice: number
        expectedUnitPrice: number
        expectedQuantity: number
        expectedLineTotal: number
        expectedCatalogPriceSnapshot: number | null
      }> = []
      if (isItemizedEdit && !isItemizedContentRewrite) {
        for (const item of nextDraft.items) {
          const orderItemId = Number(item.orderItemId || 0)
          if (!orderItemId) throw new Error('Не удалось определить позицию заказа для исправления цены. Обновите заказ и повторите.')
          const original = order.items.find((entry) => Number(entry.id || 0) === orderItemId)
          if (!original) throw new Error('Одна из позиций заказа уже изменилась. Обновите заказ и повторите исправление.')
          const nextUnitPrice = Number(item.unitPrice)
          if (!Number.isSafeInteger(nextUnitPrice) || nextUnitPrice < 0) {
            throw new Error(`Укажите целую цену от 0 для «${item.productName || 'позиции'}».`)
          }
          const originalUnitPrice = Number(original.unitPrice || 0)
          if (nextUnitPrice === originalUnitPrice) continue
          itemPriceCorrections.push({
            orderItemId,
            unitPrice: nextUnitPrice,
            expectedUnitPrice: originalUnitPrice,
            expectedQuantity: Number(original.quantity || 0),
            expectedLineTotal: Number(original.lineTotal || 0),
            expectedCatalogPriceSnapshot: original.catalogPriceSnapshot ?? null,
          })
        }
      }

      const paymentCorrections: Array<{
        paymentId: number
        paymentDate: string
        method: string
        amount: number
        paymentKind: string
        comment: string
        expectedPaymentDate: string
        expectedMethod: string
        expectedAmount: number
        expectedPaymentKind: string
        expectedComment: string
      }> = []
      for (const payment of nextDraft.payments) {
        const paymentId = Number(payment.id || 0)
        if (!paymentId) continue
        const original = order.payments.find((entry) => Number(entry.id || 0) === paymentId)
        if (!original) throw new Error('Одна из оплат уже изменилась. Обновите заказ и повторите исправление.')
        const nextPaymentDate = String(payment.paymentDate || '').trim()
        const nextMethod = String(payment.method || '').trim()
        const nextAmount = Number(payment.amount || 0)
        const nextPaymentKind = String(payment.paymentKind || 'primary').trim()
        const nextComment = String(payment.comment || '').trim()
        const oldPaymentDate = String(original.paymentDate || '').trim()
        const oldMethod = String(original.method || '').trim()
        const oldAmount = Number(original.amount || 0)
        const oldPaymentKind = String(original.paymentKind || 'primary').trim()
        const oldComment = String(original.comment || '').trim()
        const changed = nextPaymentDate !== oldPaymentDate
          || nextMethod.toUpperCase() !== oldMethod.toUpperCase()
          || nextAmount !== oldAmount
          || nextPaymentKind !== oldPaymentKind
          || nextComment !== oldComment
        if (!changed) continue
        paymentCorrections.push({
          paymentId,
          paymentDate: nextPaymentDate,
          method: nextMethod,
          amount: nextAmount,
          paymentKind: nextPaymentKind,
          comment: nextComment,
          expectedPaymentDate: oldPaymentDate,
          expectedMethod: oldMethod,
          expectedAmount: oldAmount,
          expectedPaymentKind: oldPaymentKind,
          expectedComment: oldComment,
        })
      }

      let itemContentReplacement: {
        expectedItems: Array<Record<string, unknown>>
        items: Array<Record<string, unknown>>
      } | null = null
      if (isItemizedContentRewrite) {
        const pricingReadiness = evaluateItemizedCreatePricing(nextDraft.items, nextDraft.payments.filter((payment) => Boolean(payment.id)))
        if (pricingReadiness.status !== 'ready') {
          const blocker = pricingReadiness.blockers[0]
          const position = blocker?.itemIndex !== undefined ? blocker.itemIndex + 1 : 0
          if (blocker?.code === 'empty_items') throw new Error('В заказе должна остаться хотя бы одна позиция.')
          if (blocker?.code === 'invalid_quantity') throw new Error(`Проверьте количество в позиции ${position}.`)
          if (blocker?.code === 'missing_unit_price') throw new Error(`Укажите цену продажи для позиции ${position}. Если цены в Каталоге нет, введите её вручную.`)
          if (blocker?.code === 'invalid_unit_price') throw new Error(`Цена продажи в позиции ${position} должна быть целым числом от 0.`)
          if (blocker?.code === 'invalid_catalog_snapshot') throw new Error(`Не удалось безопасно зафиксировать цену Каталога для позиции ${position}. Обновите выбор товара.`)
          if (blocker?.code === 'overpayment') throw new Error(`После изменения состава итог заказа (${pricingReadiness.totalAmount ?? 0}) меньше уже проведённых оплат (${pricingReadiness.receivedAmount}). Исправьте состав или цены.`)
          throw new Error('Проверьте состав и цены позиций перед сохранением.')
        }

        itemContentReplacement = {
          expectedItems: order.items.map((item) => ({
            orderItemId: Number(item.id || 0),
            productName: item.productName,
            audienceType: item.audienceType && normalizeSuggestion(item.audienceType).includes('ДЕТ') ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ',
            gender: item.gender || null,
            color: item.color || null,
            material: item.material || 'СТАНДАРТ',
            length: item.length || 'СТАНДАРТ',
            size: item.size || null,
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || 0),
            lineTotal: Number(item.lineTotal || 0),
            catalogPriceSnapshot: item.catalogPriceSnapshot ?? null,
            sourceType: item.isWorkshop ? 'workshop' : (item.sourceType === 'boutique' ? 'boutique' : 'warehouse'),
            workshopComment: item.workshopComment || null,
            workshopUrgent: Boolean(item.workshopUrgent),
            workshopDueDate: item.workshopDueDate || null,
            workshopDueTime: item.workshopDueTime || null,
          })),
          items: nextDraft.items.map((item) => ({
            orderItemId: Number(item.orderItemId || 0) || undefined,
            productName: item.productName,
            audienceType: item.audienceType || 'ВЗРОСЛЫЙ',
            gender: item.gender || null,
            color: item.color || null,
            material: item.material || 'СТАНДАРТ',
            length: item.length || 'СТАНДАРТ',
            size: item.size || null,
            quantity: Number(item.quantity || 0),
            unitPrice: item.unitPrice,
            catalogPriceSnapshot: historicalCatalogSnapshotForEdit(
              originalItemsById.get(Number(item.orderItemId || 0)), item,
            ),
            sourceType: item.sourceType || 'warehouse',
            workshopComment: item.workshopComment || null,
            workshopUrgent: Boolean(item.workshopUrgent),
            workshopDueDate: item.workshopUrgent ? (item.workshopDueDate || '') : '',
            workshopDueTime: item.workshopUrgent ? (item.workshopDueTime || '') : '',
            shortageAcknowledged: item.sourceType !== 'workshop' ? Boolean(item.shortageAcknowledged) : undefined,
          })),
        }
      }

      const payload = isItemizedContentRewrite ? {
        orderDate: nextDraft.orderDate,
        managerId: nextDraft.managerId || undefined,
        managerName: nextDraft.managerName,
        customerPhone: nextDraft.customerPhone,
        customerName: nextDraft.customerName,
        city: nextDraft.city,
        deliveryType: nextDraft.deliveryType,
        orderPaymentMethod: nextDraft.orderPaymentMethod,
        comment: nextDraft.comment,
        paymentCorrections,
        itemContentReplacement,
      } : isItemizedEdit ? {
        orderDate: nextDraft.orderDate,
        managerId: nextDraft.managerId || undefined,
        managerName: nextDraft.managerName,
        customerPhone: nextDraft.customerPhone,
        customerName: nextDraft.customerName,
        city: nextDraft.city,
        deliveryType: nextDraft.deliveryType,
        orderPaymentMethod: nextDraft.orderPaymentMethod,
        comment: nextDraft.comment,
        paymentCorrections,
        itemPriceCorrections,
      } : {
        orderDate: nextDraft.orderDate,
        managerId: nextDraft.managerId || undefined,
        managerName: nextDraft.managerName,
        customerPhone: nextDraft.customerPhone,
        customerName: nextDraft.customerName,
        city: nextDraft.city,
        deliveryType: nextDraft.deliveryType,
        orderPaymentMethod: nextDraft.orderPaymentMethod,
        sourceType: deriveOrderSourceType(nextDraft.items),
        orderTotal: nextDraft.orderTotal ? Number(nextDraft.orderTotal) : undefined,
        workshopStatus: nextDraft.workshopStatus,
        orderStatus: nextDraft.orderStatus,
        comment: nextDraft.comment,
        items: nextDraft.items.map((item) => ({
          productName: item.productName,
          audienceType: item.audienceType || 'ВЗРОСЛЫЙ',
          gender: item.gender,
          color: item.color,
          material: item.material,
          length: item.length,
          size: item.size,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice || 0),
          sourceType: item.sourceType,
          workshopComment: item.workshopComment,
          workshopUrgent: Boolean(item.workshopUrgent),
          workshopDueDate: item.workshopUrgent ? item.workshopDueDate : '',
          workshopDueTime: item.workshopUrgent ? item.workshopDueTime : '',
          shortageAcknowledged: item.sourceType !== 'workshop' ? Boolean(item.shortageAcknowledged) : undefined,
        })),
        paymentCorrections,
      }

      const criticalKey = `order-edit:${order.id}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })

      type EditOrderShortage = {
        inputIndexes?: number[]
        physicalQuantity?: number
        reservedQuantity?: number
        requestedQuantity?: number
        shortage?: number
      }
      type OrderStockWriteResult = {
        productName?: string
        concurrentShortage?: boolean
        shortageAfter?: number
      }
      const result = await readJsonResponse<{
        message?: string
        order?: OrderRecord
        refreshRequired?: boolean
        code?: string
        shortages?: EditOrderShortage[]
        stockWriteOff?: OrderStockWriteResult[]
      }>(response, 'Сохранение заказа')
      if (!response.ok && result.code === 'order_stock_shortage' && Array.isArray(result.shortages) && result.shortages.length) {
        const shortageByInputIndex = new Map<number, EditOrderShortage>()
        for (const shortage of result.shortages) {
          for (const inputIndex of shortage.inputIndexes || []) {
            if (Number.isInteger(Number(inputIndex)) && Number(inputIndex) >= 0) shortageByInputIndex.set(Number(inputIndex), shortage)
          }
        }
        setEditorDraft((current) => current ? ({
          ...current,
          items: current.items.map((item, inputIndex) => {
            const shortage = shortageByInputIndex.get(inputIndex)
            if (!shortage || item.sourceType === 'workshop') return item
            return {
              ...item,
              stockObservationEnabled: false,
              observedPhysicalQuantity: null,
              shortageAcknowledged: false,
              serverShortage: {
                physicalQuantity: Number(shortage.physicalQuantity || 0),
                reservedQuantity: Math.max(0, Number(shortage.reservedQuantity || 0)),
                requestedQuantity: Math.max(0, Number(shortage.requestedQuantity || 0)),
                shortage: Math.max(1, Number(shortage.shortage || 1)),
              },
            }
          }),
        }) : current)
        setError(result.message || 'Перед сохранением уточните отмеченные складские позиции.')
        return null
      }
      if (!response.ok) {
        throw new Error(result.message || `Save failed: ${response.status}`)
      }
      // A 2xx response means the server-side critical operation is durably complete. Clear the
      // browser retry token before readback-driven UI work, including the common result.order path.
      completeCriticalRequest(criticalKey, critical.requestId)

      const pendingEditorPayments = nextDraft.payments.filter((payment) => !payment.id)
      const postSaveShortages = (result.stockWriteOff || []).filter((entry) => Number(entry.shortageAfter || 0) > 0)
      const concurrentShortages = postSaveShortages.filter((entry) => entry.concurrentShortage)
      invalidateFinanceReadCaches()
      // Metadata/payment/price-only itemized correction leaves inventory intact; H8E content rewrite does not.
      if (!isItemizedEdit || isItemizedContentRewrite) invalidateInventoryStockCaches(true)
      if (concurrentShortages.length) {
        setMessage(`Заказ ${order.external_id} обновлён. Пока он сохранялся, доступный остаток изменился; проверьте «Склад → Остатки».`)
      } else if (postSaveShortages.length) {
        setMessage(`Заказ ${order.external_id} обновлён, но по ${postSaveShortages.length} поз. резерв превысил свободный остаток. Физический остаток не менялся; проверьте «Склад → Остатки».`)
      } else {
        setMessage(isItemizedEdit
          ? `Заказ ${order.external_id} обновлён.`
          : `Заказ ${order.external_id} обновлён.`)
      }
      if (result?.order) {
        const savedOrder = result.order as OrderRecord
        upsertOrderInState(savedOrder)
        refreshWorkshop()
        setSelectedOrderId(savedOrder.id)
        setEditorOrderOverride(savedOrder)
        const savedDraft = createEditorDraft(savedOrder)
        setEditorDraft(pendingEditorPayments.length ? { ...savedDraft, payments: [...savedDraft.payments, ...pendingEditorPayments] } : savedDraft)
        if (pendingEditorPayments.length) {
          setEditorOpen(true)
          setMessage(`Заказ ${order.external_id} обновлён. Новые оплаты ещё не проведены — сохраните каждую новой кнопкой «Провести оплату».`)
        } else {
          closeOrderEditor()
        }
        if (activeSector === 'orders' && orderPanel === 'list') refreshOrderFinance()
        return savedOrder
      }
      if (pendingEditorPayments.length) {
        setEditorOpen(true)
        setMessage(`Заказ ${order.external_id} сохранён. Новые оплаты ещё не проведены — сохраните каждую отдельно.`)
      } else {
        closeOrderEditor()
      }
      if (result.refreshRequired || !result.order) {
        refreshDashboard()
        refreshWorkshop()
      }
      return null
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      return null
    } finally {
      setSavingOrder(false)
    }
  }



  return { persistOrder }
}
