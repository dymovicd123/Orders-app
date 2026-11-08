import type { useApiClient } from './useApiClient'
import type { OrderRecord } from '../types'
import { readJsonResponse } from '../utils'

type CriticalClient = Pick<ReturnType<typeof useApiClient>,
  'apiFetch' | 'prepareCriticalRequest' | 'completeCriticalRequest'>

type CriticalOperationReply = {
  ok?: boolean
  message?: string
  order?: OrderRecord
}

type ExchangeFinancialCorrectionReply = CriticalOperationReply & {
  unchanged?: boolean
}

export type ExchangeFinancialCorrectionPayload = {
  exchangeDate: string
  financialAmount: number
  paymentMethod: string
  comment: string
  expectedExchangeDate: string
  expectedFinancialAmount: number
  expectedPaymentMethod: string
  expectedComment: string
}

// Preserve the exact request fingerprint, idempotency header, and completion
// order used by the existing Return/Exchange UI. Never complete on an
// uncertain response: the next click must safely retry with the same requestId.
async function sendCriticalPatch<T extends CriticalOperationReply>(
  client: CriticalClient,
  input: {
    path: string
    key: string
    payload: Record<string, unknown>
    context: string
    errorPrefix: string
  },
): Promise<T> {
  const critical = client.prepareCriticalRequest(input.key, input.payload)
  const response = await client.apiFetch(input.path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
    body: JSON.stringify(critical.payload),
  })
  const result = await readJsonResponse<T>(response, input.context)
  if (!response.ok) throw new Error(result.message || `${input.errorPrefix}: ${response.status}`)
  client.completeCriticalRequest(input.key, critical.requestId)
  return result
}

export function cancelReturnCriticalRequest(client: CriticalClient, returnId: number) {
  return sendCriticalPatch<CriticalOperationReply>(client, {
    path: `/api/returns/${returnId}/cancel`,
    key: `return-cancel:${returnId}`,
    payload: { comment: 'Отменено из интерфейса Cloudflare' },
    context: 'Отмена возврата',
    errorPrefix: 'Cancel return failed',
  })
}

export function cancelExchangeCriticalRequest(client: CriticalClient, exchangeId: number) {
  return sendCriticalPatch<CriticalOperationReply>(client, {
    path: `/api/exchanges/${exchangeId}/cancel`,
    key: `exchange-cancel:${exchangeId}`,
    payload: { comment: 'Отменено из интерфейса Cloudflare' },
    context: 'Отмена обмена',
    errorPrefix: 'Cancel exchange failed',
  })
}

export function correctExchangeFinancialCriticalRequest(
  client: CriticalClient,
  exchangeId: number,
  payload: ExchangeFinancialCorrectionPayload,
) {
  return sendCriticalPatch<ExchangeFinancialCorrectionReply>(client, {
    path: `/api/exchanges/${exchangeId}/financials`,
    key: `exchange-financial-correct:${exchangeId}`,
    payload,
    context: 'Исправление денег обмена',
    errorPrefix: 'Exchange correction failed',
  })
}
