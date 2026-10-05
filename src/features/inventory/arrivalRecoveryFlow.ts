import type { ArrivalRecoveryPrompt } from './views/ArrivalRecoveryDialog'

export type ArrivalRecoveryResponse = {
  ok?: boolean
  message?: string
  code?: string
  productId?: number | null
  productName?: string | null
  retirementId?: number | null
  variantId?: number | null
}

export type ArrivalRecoveryItem = {
  productId?: string | number | null
  variantId?: string | number | null
  productName: string
  [key: string]: unknown
}

type SubmitResult = {
  response: Response
  result: ArrivalRecoveryResponse
}

type OpenArrivalRecoveryInput = {
  result: ArrivalRecoveryResponse
  retryItems: ArrivalRecoveryItem[]
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>
  readJsonResponse: <T>(response: Response, label: string, options?: { allowHttpError?: boolean }) => Promise<T>
  makeRequestId: (prefix: string) => string
  normalizeText: (value: unknown) => string
  submitMovement: (items: ArrivalRecoveryItem[]) => Promise<SubmitResult>
  onPrompt: (prompt: ArrivalRecoveryPrompt) => void
  onError: (message: string) => void
  onBusy: (busy: boolean) => void
  onContinuation: (continuation: (() => Promise<void>) | null) => void
  onSuccess: (result: ArrivalRecoveryResponse) => Promise<void>
}

export const isArrivalRecoveryResponse = (result: ArrivalRecoveryResponse) => (
  result.code === 'arrival_retired_product' || result.code === 'arrival_stale_variant'
)

export async function openArrivalRecoveryFlow(input: OpenArrivalRecoveryInput) {
  if (!isArrivalRecoveryResponse(input.result)) return

  const prompt: ArrivalRecoveryPrompt = {
    code: input.result.code as ArrivalRecoveryPrompt['code'],
    message: input.result.message || 'Приход требует подтверждения перед продолжением.',
    productId: Math.max(0, Number(input.result.productId || 0)),
    productName: String(
      input.result.productName
      || input.retryItems.find((item) => Number(item.productId || 0) === Number(input.result.productId || 0))?.productName
      || 'Выбранный товар'
    ),
    retirementId: Math.max(0, Number(input.result.retirementId || 0)),
    variantId: Math.max(0, Number(input.result.variantId || 0)),
  }
  const restoreRequestId = input.makeRequestId(`arrival-restore-${prompt.productId || 'product'}`)
  input.onError('')
  input.onPrompt(prompt)

  input.onContinuation(async () => {
    input.onBusy(true)
    input.onError('')
    try {
      let nextItems = input.retryItems.map((item) => ({ ...item }))

      if (prompt.code === 'arrival_retired_product') {
        if (!prompt.retirementId) {
          throw new Error('Не удалось подготовить безопасное автоматическое восстановление. Форма Прихода сохранена — обновите данные и попробуйте ещё раз.')
        }
        const restoreResponse = await input.apiFetch(`/api/catalog/retirements/${prompt.retirementId}/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: restoreRequestId }),
        })
        const restoreResult = await input.readJsonResponse<{ ok?: boolean; message?: string }>(
          restoreResponse,
          'Восстановление товара',
          { allowHttpError: true },
        )
        if (!restoreResponse.ok || restoreResult.ok === false) {
          throw new Error(restoreResult.message || 'Не удалось безопасно восстановить товар. Введённый Приход не потерян.')
        }
        nextItems = nextItems.map((item) => {
          const sameProduct = prompt.productId > 0
            ? Number(item.productId || 0) === prompt.productId
            : input.normalizeText(item.productName) === input.normalizeText(prompt.productName)
          return sameProduct ? { ...item, variantId: '' } : item
        })
      } else {
        nextItems = nextItems.map((item) => (
          prompt.variantId > 0 && Number(item.variantId || 0) === prompt.variantId
            ? { ...item, variantId: '' }
            : item
        ))
      }

      const retried = await input.submitMovement(nextItems)
      if (!retried.response.ok && isArrivalRecoveryResponse(retried.result)) {
        await openArrivalRecoveryFlow({ ...input, result: retried.result, retryItems: nextItems })
        return
      }
      if (!retried.response.ok) {
        throw new Error(retried.result.message || `Inventory save failed: ${retried.response.status}`)
      }

      input.onPrompt(null as unknown as ArrivalRecoveryPrompt)
      input.onError('')
      input.onContinuation(null)
      await input.onSuccess(retried.result)
    } catch (error) {
      input.onError(error instanceof Error ? error.message : 'Не удалось продолжить Приход. Введённые данные сохранены в форме.')
    } finally {
      input.onBusy(false)
    }
  })
}
