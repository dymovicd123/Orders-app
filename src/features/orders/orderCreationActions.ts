import type { Dispatch, SetStateAction } from 'react'
import type { AppSector, AuthUser, CatalogResponse, EditorDraft, EditorItem, EditorPayment, OrderPanel, OrderRecord, ReferenceData } from '../../app/types'
import {
  createEditorDraft, createEmptyEditorItem, createEmptyEditorPayment, createEmptyOrderDraft,
  deriveOrderSourceType, formatMoney, normalizeAudienceTypeValue, normalizeSuggestion,
  readJsonResponse, resolvePaymentKind,
} from '../../app/utils'
import { evaluateItemizedCreatePricing, resolveCatalogOrderSalePrice } from '../../app/order-pricing'

type OrderCreationActionsArgs = {
  askActionConfirmation: (text: string) => Promise<boolean>
  createDraft: EditorDraft
  setCreateDraft: Dispatch<SetStateAction<EditorDraft>>
  catalogData: CatalogResponse | null
  orderPanel: OrderPanel
  authUser: AuthUser | null
  references: ReferenceData | null
  activeSector: AppSector
  getSizeOptions: (productName?: string, audienceType?: string) => string[]
  setOrderBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  setOrderPanel: Dispatch<SetStateAction<OrderPanel>>
  setSelectedOrderId: Dispatch<SetStateAction<number | null>>
  setEditorDraft: Dispatch<SetStateAction<EditorDraft | null>>
  setEditorOpen: Dispatch<SetStateAction<boolean>>
  prepareCriticalRequest: <T extends Record<string, unknown>>(key: string, basePayload: T) => { requestId: string; payload: T & { requestId: string } }
  completeCriticalRequest: (key: string, requestId: string) => void
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  invalidateFinanceReadCaches: () => void
  invalidateInventoryStockCaches: (includeCatalogReview?: boolean) => void
  upsertOrderInState: (order: OrderRecord) => void
  refreshOrderList: () => void
  refreshWorkshop: () => void
  refreshOrderFinance: () => void
}

// One behavior-preserving create-order boundary: exact SKU, historical catalog price,
// multi-payment draft dates, one critical write and its explicit post-commit state.
export function createOrderCreationActions({
  askActionConfirmation,
  createDraft,
  setCreateDraft,
  catalogData,
  orderPanel,
  authUser,
  references,
  activeSector,
  getSizeOptions,
  setOrderBusy,
  setError,
  setMessage,
  setOrderPanel,
  setSelectedOrderId,
  setEditorDraft,
  setEditorOpen,
  prepareCriticalRequest,
  completeCriticalRequest,
  apiFetch,
  invalidateFinanceReadCaches,
  invalidateInventoryStockCaches,
  upsertOrderInState,
  refreshOrderList,
  refreshWorkshop,
  refreshOrderFinance,
}: OrderCreationActionsArgs) {
  function updateCreateDraft<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) {
    setCreateDraft((current) => {
      if (key === 'orderDate') {
        const orderDate = String(value || '').trim()
        return {
          ...current,
          [key]: value,
          payments: current.payments.map((payment) => (
            payment.paymentKind === 'primary'
              ? { ...payment, paymentDate: orderDate || payment.paymentDate }
              : payment
          )),
        }
      }
      if (key === 'orderPaymentMethod') {
        const method = String(value || '').trim()
        const previousMethod = String(current.orderPaymentMethod || '').trim()
        // A payment method is an ordinary payment method, including КАСПИ МАГАЗИН.
        // Do not erase an amount that a manager already entered.
        const payments = current.payments.map((payment, index) => {
          if (index !== 0) return payment
          const currentMethod = String(payment.method || '').trim()
          const followsOrderMethod = !currentMethod ||
            (previousMethod && normalizeSuggestion(currentMethod) === normalizeSuggestion(previousMethod))
          return followsOrderMethod ? { ...payment, method } : payment
        })
        return { ...current, orderPaymentMethod: method, payments }
      }
      return { ...current, [key]: value }
    })
  }

  function updateCreateItem(index: number, field: keyof EditorItem, value: string | number | boolean | null) {
    setCreateDraft((current) => {
      const nextItems = current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        const normalizedValue = field === 'audienceType' ? normalizeAudienceTypeValue(value) : value
        const nextItem = { ...item, [field]: normalizedValue } as EditorItem

        if (field === 'unitPrice') {
          const rawPrice = value === null || value === undefined ? '' : String(value).trim()
          nextItem.unitPrice = rawPrice === '' ? undefined : Number(rawPrice)
          nextItem.priceOrigin = rawPrice === '' ? 'missing' : 'manual'
          nextItem.priceNeedsConfirmation = false
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
        if (orderPanel === 'zammler' && field === 'sourceType' && value === 'workshop') {
          nextItem.workshopUrgent = true
          nextItem.workshopDueDate = nextItem.workshopDueDate || current.orderDate
          nextItem.workshopDueTime = nextItem.workshopDueTime || '20:00'
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
        if (['productName', 'audienceType', 'material', 'length'].includes(String(field))) {
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

  function addCreateItem() {
    setCreateDraft((current) => ({
      ...current,
      items: [...current.items, { ...createEmptyEditorItem(), unitPrice: undefined, catalogPriceSnapshot: null, priceOrigin: 'missing', priceNeedsConfirmation: false }],
    }))
  }

  function removeCreateItem(index: number) {
    setCreateDraft((current) => {
      const nextItems = current.items.filter((_, itemIndex) => itemIndex !== index)
      return { ...current, items: nextItems.length ? nextItems : [createEmptyEditorItem()] }
    })
  }

  function updateCreatePayment(index: number, field: keyof EditorPayment, value: string | number) {
    setCreateDraft((current) => {
      const nextPayments = current.payments.map((payment, paymentIndex) => (
        paymentIndex === index ? { ...payment, [field]: value } : payment
      ))
      if (field === 'method') {
        const method = String(value || '').trim()
        const shouldSeedOrderMethod = index === 0 && !String(current.orderPaymentMethod || '').trim()
        return {
          ...current,
          orderPaymentMethod: shouldSeedOrderMethod ? method : current.orderPaymentMethod,
          payments: nextPayments,
        }
      }
      return { ...current, payments: nextPayments }
    })
  }

  function addCreatePayment() {
    setCreateDraft((current) => ({ ...current, payments: [...current.payments, createEmptyEditorPayment(current.orderDate)] }))
  }

  function removeCreatePayment(index: number) {
    setCreateDraft((current) => {
      const nextPayments = current.payments.filter((_, paymentIndex) => paymentIndex !== index)
      const fallback = createEmptyEditorPayment(current.orderDate)
      const payments = nextPayments.length ? nextPayments : [fallback]
      return { ...current, payments }
    })
  }


  function createOrderDraftWithDefaultManager() {
    const draft = createEmptyOrderDraft()
    if (authUser?.role === 'manager' && Number(authUser.managerId || 0) > 0) {
      return {
        ...draft,
        managerId: Number(authUser.managerId || 0),
        managerName: authUser.managerName || '',
      }
    }
    return draft
  }

  function resetCreateOrderDraft() {
    setCreateDraft(createOrderDraftWithDefaultManager())
  }


  async function createOrderFromDraft(retiredCatalogRecreateKeys: string[] = []) {
    setOrderBusy(true)
    setError(null)
    setMessage(null)

    try {
      if (!Number(createDraft.managerId || 0)) {
        throw new Error('Выберите менеджера перед сохранением заказа.')
      }
      const orderPaymentMethod = String(createDraft.orderPaymentMethod || '').trim()
        || String(createDraft.payments.find((payment) => String(payment.method || '').trim())?.method || '').trim()
      const pricingReadiness = evaluateItemizedCreatePricing(createDraft.items, createDraft.payments)
      if (pricingReadiness.status !== 'ready') {
        const blocker = pricingReadiness.blockers[0]
        const position = blocker?.itemIndex !== undefined ? blocker.itemIndex + 1 : 0
        const payment = blocker?.paymentIndex !== undefined ? blocker.paymentIndex + 1 : 0
        if (blocker?.code === 'empty_items') throw new Error('Добавьте хотя бы один товар в заказ.')
        if (blocker?.code === 'invalid_quantity') throw new Error(`Проверьте количество в позиции ${position}.`)
        if (blocker?.code === 'missing_unit_price') throw new Error(`Укажите цену продажи для позиции ${position}. Если цены в Каталоге нет, введите её вручную.`)
        if (blocker?.code === 'invalid_unit_price') throw new Error(`Цена продажи в позиции ${position} должна быть целым числом от 0.`)
        if (blocker?.code === 'invalid_catalog_snapshot') throw new Error(`Не удалось безопасно зафиксировать цену Каталога для позиции ${position}. Обновите выбор товара.`)
        if (blocker?.code === 'invalid_payment') throw new Error(`Проверьте оплату ${payment}: положительная сумма требует способ оплаты, сумма должна быть целым числом от 0.`)
        if (blocker?.code === 'overpayment') throw new Error(`Сумма оплат (${pricingReadiness.receivedAmount}) больше итога заказа (${pricingReadiness.totalAmount ?? 0}). Исправьте оплаты или цены позиций.`)
        throw new Error('Проверьте цены позиций и оплаты перед сохранением заказа.')
      }
      const pricedLineByInputIndex = new Map(pricingReadiness.lines.map((line) => [line.itemIndex, line]))

      const payload = {
        orderDate: createDraft.orderDate,
        managerId: createDraft.managerId || undefined,
        managerName: createDraft.managerName,
        customerPhone: createDraft.customerPhone,
        customerName: createDraft.customerName,
        city: createDraft.city,
        deliveryType: createDraft.deliveryType,
        orderPaymentMethod,
        sourceType: deriveOrderSourceType(createDraft.items),
        pricingMode: 'itemized_v1' as const,
        ...(retiredCatalogRecreateKeys.length ? { retiredCatalogRecreateKeys } : {}),
        workshopStatus: createDraft.workshopStatus,
        orderStatus: createDraft.orderStatus,
        comment: createDraft.comment,
        items: createDraft.items.map((item) => ({
          productName: item.productName,
          catalogVariantId: item.catalogVariantId || undefined,
          manualCatalogEntry: Boolean(item.manualCatalogEntry),
          audienceType: item.audienceType || 'ВЗРОСЛЫЙ',
          gender: item.gender || null,
          color: item.color,
          material: item.material,
          length: item.length,
          size: item.size,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          catalogPriceSnapshot: item.catalogPriceSnapshot ?? null,
          sourceType: item.sourceType,
          workshopComment: item.workshopComment,
          workshopUrgent: Boolean(item.workshopUrgent),
          workshopDueDate: item.workshopUrgent ? item.workshopDueDate : '',
          workshopDueTime: item.workshopUrgent ? item.workshopDueTime : '',
          shortageAcknowledged: item.sourceType !== 'workshop' ? Boolean(item.shortageAcknowledged) : undefined,
        })),
        payments: createDraft.payments.map((payment, index) => ({
          paymentDate: payment.paymentDate,
          method: payment.method,
          amount: payment.amount,
          paymentKind: resolvePaymentKind(payment, index),
          comment: payment.comment,
        })),
      }

      const criticalKey = 'order-create'
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })

      type CreateOrderShortage = {
        inputIndexes?: number[]
        physicalQuantity?: number
        reservedQuantity?: number
        requestedQuantity?: number
        shortage?: number
      }
      type CreateOrderRetiredCatalogItem = {
        inputIndex?: number
        confirmationKey?: string
        productName?: string
        material?: string
        length?: string
        color?: string
        size?: string
      }
      const result = await readJsonResponse<{
        orderId?: number
        externalId?: string
        totalAmount?: number
        receivedAmount?: number
        debtAmount?: number
        pricingMode?: 'legacy_manual_total' | 'itemized_v1'
        code?: string
        shortages?: CreateOrderShortage[]
        retiredItems?: CreateOrderRetiredCatalogItem[]
        stockWriteOff?: Array<{ productName?: string; concurrentShortage?: boolean; shortageAfter?: number }>
        message?: string
      }>(response, 'Создание заказа')
      if (!response.ok && result.code === 'order_retired_catalog_confirmation_required' && Array.isArray(result.retiredItems) && result.retiredItems.length) {
        completeCriticalRequest(criticalKey, critical.requestId)
        if (retiredCatalogRecreateKeys.length) {
          throw new Error('Каталог изменился во время подтверждения. Обновите форму заказа и повторите сохранение.')
        }
        const confirmationKeys = [...new Set(result.retiredItems.map((item) => String(item.confirmationKey || '').trim()).filter(Boolean))]
        if (!confirmationKeys.length) {
          throw new Error(result.message || 'Не удалось безопасно подтвердить восстановление удалённой позиции.')
        }
        const names = [...new Set(result.retiredItems.map((item) => String(item.productName || '').trim()).filter(Boolean))]
        const label = names.length ? names.map((name) => `«${name}»`).join(', ') : 'выбранная позиция'
        const confirmed = await askActionConfirmation(
          `${label} раньше была удалена из рабочего каталога. Вернуть её как новую рабочую позицию?\n\nСтарые заказы и история не изменятся. Старые остатки и резервы не вернутся; новая рабочая позиция начнёт с нуля.`,
        )
        if (!confirmed) {
          setMessage('Заказ не сохранён. Удалённая позиция осталась вне рабочего каталога.')
          return
        }
        await createOrderFromDraft(confirmationKeys)
        return
      }
      if (!response.ok && result.code === 'order_stock_shortage' && Array.isArray(result.shortages) && result.shortages.length) {
        const shortageByInputIndex = new Map<number, CreateOrderShortage>()
        for (const shortage of result.shortages) {
          for (const inputIndex of shortage.inputIndexes || []) {
            if (Number.isInteger(Number(inputIndex)) && Number(inputIndex) >= 0) shortageByInputIndex.set(Number(inputIndex), shortage)
          }
        }
        setCreateDraft((current) => ({
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
        }))
        setError(result.message || 'Перед сохранением уточните отмеченные складские позиции.')
        return
      }
      if (!response.ok) {
        throw new Error(result.message || `Create failed: ${response.status}`)
      }
      // The server has durably completed the idempotent operation. Clear the browser retry token
      // before any non-critical UI/state work so a render/state error cannot keep a successful Save pending.
      completeCriticalRequest(criticalKey, critical.requestId)

      const postSaveShortages = (result.stockWriteOff || []).filter((entry) => Number(entry.shortageAfter || 0) > 0)
      const concurrentShortages = postSaveShortages.filter((entry) => entry.concurrentShortage)
      const createdOrderId = Number(result.orderId || 0)
      const createdExternalId = String(result.externalId || '').trim()
      if (!Number.isInteger(createdOrderId) || createdOrderId <= 0 || !createdExternalId) {
        invalidateFinanceReadCaches()
        invalidateInventoryStockCaches(true)
        if (concurrentShortages.length) {
          setMessage('Заказ сохранён. Пока он сохранялся, доступный остаток изменился; проверьте «Склад → Остатки». Обновляю список заказов.')
        } else if (postSaveShortages.length) {
          setMessage('Заказ сохранён с нехваткой свободного остатка. Физический учёт не изменён; проверьте «Склад → Остатки». Обновляю список заказов.')
        } else {
          setMessage('Заказ сохранён. Обновляю список заказов.')
        }
        setOrderPanel('list')
        resetCreateOrderDraft()
        refreshOrderList()
        refreshWorkshop()
        return
      }

      const createdOrder: OrderRecord = {
        id: createdOrderId,
        external_id: createdExternalId,
        order_date: createDraft.orderDate,
        manager_id: createDraft.managerId || null,
        manager_name: createDraft.managerName || null,
        manager_color: (references?.managerOptions || []).find((manager) => manager.id === createDraft.managerId)?.colorKey || null,
        customer_phone: createDraft.customerPhone || null,
        customer_name: createDraft.customerName || null,
        city: createDraft.city || null,
        delivery_type: createDraft.deliveryType || null,
        order_payment_method: orderPaymentMethod || null,
        source_type: deriveOrderSourceType(createDraft.items),
        pricing_mode: 'itemized_v1',
        workshop_status: createDraft.workshopStatus,
        order_status: createDraft.orderStatus,
        total_amount: Number(result.totalAmount || 0),
        received_amount: Number(result.receivedAmount || 0),
        debt_amount: Number(result.debtAmount || 0),
        return_amount: 0,
        comment: createDraft.comment || null,
        items: createDraft.items
          .map((item, inputIndex) => ({ item, inputIndex }))
          .filter(({ item }) => String(item.productName || '').trim())
          .map(({ item, inputIndex }) => {
            const pricedLine = pricedLineByInputIndex.get(inputIndex)
            return {
              productName: item.productName,
              audienceType: item.audienceType || 'ВЗРОСЛЫЙ',
              gender: item.gender || null,
              color: item.color || null,
              material: item.material || null,
              length: item.length || null,
              size: item.size || null,
              quantity: pricedLine?.quantity ?? item.quantity ?? 1,
              unitPrice: pricedLine?.unitPrice ?? Number(item.unitPrice || 0),
              catalogPriceSnapshot: pricedLine?.catalogPriceSnapshot ?? item.catalogPriceSnapshot ?? null,
              lineTotal: pricedLine?.lineTotal ?? 0,
              sourceType: item.sourceType || 'warehouse',
              workshopComment: item.workshopComment || null,
              workshopUrgent: Boolean(item.workshopUrgent),
              workshopDueDate: item.workshopUrgent ? item.workshopDueDate || null : null,
              workshopDueTime: item.workshopUrgent ? item.workshopDueTime || null : null,
              isWorkshop: item.sourceType === 'workshop',
            }
          }),
        payments: createDraft.payments
          .map((payment, index) => ({
            paymentDate: payment.paymentDate,
            method: payment.method,
            amount: payment.amount,
            paymentKind: resolvePaymentKind(payment, index),
            comment: payment.comment || null,
          }))
          .filter((payment) => String(payment.method || '').trim() && Number(payment.amount || 0) > 0),
        returns: [],
      }

      invalidateFinanceReadCaches()
      // Step 188A: order creation changes reservations. Do not keep a stale stock cache
      // that would later make Warehouse or the next availability hint show the pre-order number.
      invalidateInventoryStockCaches(true)
      if (concurrentShortages.length) {
        setMessage(`Заказ ${createdOrder.external_id} создан. Пока он сохранялся, доступный остаток изменился; проверьте «Склад → Остатки».`)
      } else if (postSaveShortages.length) {
        setMessage(`Заказ ${createdOrder.external_id} создан, но по ${postSaveShortages.length} поз. резерв превысил свободный остаток. Физический остаток не менялся; проверьте «Склад → Остатки».`)
      } else {
        setMessage(`Заказ ${createdOrder.external_id} создан, сумма ${formatMoney(createdOrder.total_amount)} тенге.`)
      }
      upsertOrderInState(createdOrder)
      if (createdOrder.items.some((item) => item.isWorkshop || item.sourceType === 'workshop')) {
        refreshWorkshop()
      }
      setSelectedOrderId(createdOrder.id)
      setEditorDraft(createEditorDraft(createdOrder))
      setEditorOpen(false)
      setOrderPanel('list')
      resetCreateOrderDraft()
      if (activeSector === 'orders') refreshOrderFinance()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setOrderBusy(false)
    }
  }


  return {
    updateCreateDraft,
    updateCreateItem,
    addCreateItem,
    removeCreateItem,
    updateCreatePayment,
    addCreatePayment,
    removeCreatePayment,
    createOrderDraftWithDefaultManager,
    resetCreateOrderDraft,
    createOrderFromDraft,
  }
}
