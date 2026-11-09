import type { OrderRecord, ReturnDraft } from './types'
import { formatMoney, readJsonResponse } from './utils'
import type { useApiClient } from './controllers/useApiClient'

type ReturnCriticalClient = Pick<
  ReturnType<typeof useApiClient>,
  'apiFetch' | 'prepareCriticalRequest' | 'completeCriticalRequest'
>

// Validate before issuing any write. A zero-money return may carry physical items,
// while a money-only return may contain no item and must never create a fake intake.
export function prepareReturnCreation(order: OrderRecord, draft: ReturnDraft) {
  const amount = Math.max(0, Number(draft.amount || 0))
  const availableAmount = Math.max(
    0,
    Number(order.received_amount || 0) - Number(order.return_amount || 0),
  )

  const selectedUnissuedItem = draft.items.find((item) =>
    Number(item.orderItemId || 0) > 0 && Number(item.quantity || 0) > 0 && !item.issuedToClient
  )
  if (selectedUnissuedItem) {
    return {
      ok: false as const,
      error: `«${selectedUnissuedItem.productName}» не выдавали клиенту. Не оформляйте её как физический возврат: сначала измените состав заказа. Если нужно вернуть только деньги, оставьте количество товара 0.`,
    }
  }

  const selectedReturnItems = draft.items
    .filter((item) => Number(item.orderItemId || 0) > 0 && Number(item.quantity || 0) > 0)
    .map((item) => ({
      orderItemId: item.orderItemId,
      quantity: item.quantity,
      restock: item.physicalState === 'warehouse' || item.physicalState === 'boutique',
      physicalState: item.physicalState,
    }))

  if (amount <= 0 && selectedReturnItems.length === 0) {
    return { ok: false as const, error: 'Для возврата без денег выберите хотя бы один возвращаемый товар.' }
  }
  if (amount > availableAmount) {
    return {
      ok: false as const,
      error: `Сумма возврата ${formatMoney(amount)} больше доступной суммы ${formatMoney(availableAmount)}.`,
    }
  }
  if (amount > 0 && !draft.paymentMethod.trim()) {
    return {
      ok: false as const,
      error: 'Выберите способ возврата денег. Это нужно для правильного учёта наличных и финансов.',
    }
  }

  const extraReturnAmount = Number(draft.extraRefundAmount || 0)
  if (amount > 0 && draft.extraRefundEnabled && (
    !Number.isSafeInteger(extraReturnAmount)
    || extraReturnAmount <= 0 || extraReturnAmount >= amount
    || !draft.extraRefundMethod.trim()
    || draft.extraRefundMethod.trim().toUpperCase() === draft.paymentMethod.trim().toUpperCase()
  )) {
    return {
      ok: false as const,
      error: 'Для второго способа возврата выберите другой способ и сумму от 1 ₸ до суммы возврата без 1 ₸.',
    }
  }
  const returnPaymentParts = amount > 0
    ? draft.extraRefundEnabled
      ? [
          { method: draft.paymentMethod, amount: amount - extraReturnAmount },
          { method: draft.extraRefundMethod, amount: extraReturnAmount },
        ]
      : [{ method: draft.paymentMethod, amount }]
    : []

  return {
    ok: true as const,
    payload: {
      orderId: order.id,
      returnDate: draft.returnDate,
      amount,
      paymentMethod: draft.paymentMethod,
      paymentParts: returnPaymentParts,
      comment: draft.comment,
      restockSource: draft.restockSource,
      items: selectedReturnItems,
    },
  }
}

// Keep the original critical-operation ordering exactly: prepare, POST, read,
// verify the HTTP result, then complete before any secondary refresh.
export async function submitReturnCreation(
  client: ReturnCriticalClient,
  payload: Extract<ReturnType<typeof prepareReturnCreation>, { ok: true }>['payload'],
) {
  const criticalKey = `return-create:${payload.orderId}`
  const critical = client.prepareCriticalRequest(criticalKey, payload)
  const response = await client.apiFetch('/api/returns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
    body: JSON.stringify(critical.payload),
  })
  const result = await readJsonResponse<{
    ok?: boolean
    message?: string
    order?: OrderRecord
    pendingInventoryCount?: number
  }>(response, 'Возврат')
  if (!response.ok) {
    throw new Error(result.message || `Return failed: ${response.status}`)
  }
  client.completeCriticalRequest(criticalKey, critical.requestId)
  return result
}
