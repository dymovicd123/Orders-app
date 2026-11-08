import type { Dispatch, SetStateAction, RefObject } from 'react'
import type { CatalogResponse, InventoryArrivalPosition, InventoryDraft, InventoryDraftItem, InventoryMatrixDraft, InventoryResponse, InventorySourceKey, InventoryStockRecord } from '../../app/types'
import { createEmptyInventoryItem, createEmptyInventoryMatrixDraft, normalizeSearchText, readJsonResponse, sourceLabel } from '../../app/utils'
import { createEmptyArrivalPosition } from './inventoryDraftFactories'
import type { ArrivalRecoveryPrompt } from './views/ArrivalRecoveryDialog'
import type { StockResolutionPrompt } from '../orders/StockResolutionConfirmModal'

type InventoryStocktakeApplyItem = {
  key: string
  productId: number
  variantId: number
  productName: string
  category: 'adult' | 'child'
  gender: string
  color: string
  material: string
  length: string
  size: string
  quantity: number
  expectedQuantity: number
}

type InventoryStocktakeApplyResult = {
  ok: boolean
  appliedKeys: string[]
  message: string
}

export type StockResolutionRequiredItemView = {
  source?: InventorySourceKey
  variantId?: number
  productName?: string
  trackedPhysicalQuantity?: number
  operationQuantity?: number
  unexplainedQuantity?: number
}

type InventoryMovementActionsArgs = {
  inventoryMovementBusy: boolean
  setInventoryMovementBusy: Dispatch<SetStateAction<boolean>>
  setInventoryMovementError: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  inventoryDraft: InventoryDraft
  setInventoryDraft: Dispatch<SetStateAction<InventoryDraft>>
  flattenInventoryArrivalPositions: () => InventoryDraftItem[]
  inventoryOperationSourceRows: InventoryStockRecord[]
  getInventoryRowCategory: (row: InventoryStockRecord) => 'adult' | 'child'
  inventoryTransferRequestId: string
  inventoryManualRequestId: string
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  loadInventoryData: (source: InventorySourceKey, force?: boolean, query?: string, includeMovements?: boolean) => Promise<InventoryResponse | null>
  loadCatalogData: (force?: boolean) => Promise<CatalogResponse | null>
  setInventoryTransferRequestId: Dispatch<SetStateAction<string>>
  setInventoryManualRequestId: Dispatch<SetStateAction<string>>
  makeCashRequestId: (prefix: string) => string
  setInventoryArrivalPositions: Dispatch<SetStateAction<InventoryArrivalPosition[]>>
  setInventoryArrivalVariantOpen: Dispatch<SetStateAction<Record<string, boolean>>>
  resetInventoryOperationSelection: () => void
  setInventoryMatrix: Dispatch<SetStateAction<InventoryMatrixDraft>>
  setInventoryMatrixColorToAdd: Dispatch<SetStateAction<string>>
  setInventoryMatrixSizeToAdd: Dispatch<SetStateAction<string>>
  setArrivalRecoveryPrompt: Dispatch<SetStateAction<ArrivalRecoveryPrompt | null>>
  setArrivalRecoveryError: Dispatch<SetStateAction<string>>
  arrivalRecoveryContinueRef: RefObject<(() => Promise<void>) | null>
  askStockResolution: (prompt: StockResolutionPrompt) => Promise<boolean>
}

// The original operator orchestration: prepare -> one idempotent submission -> optional
// possession/recovery confirmation -> best-effort read refresh. No server SQL or stock
// accounting moves here. Never reset a request ID after an indeterminate response.
export function createInventoryMovementActions({
  inventoryMovementBusy,
  setInventoryMovementBusy,
  setInventoryMovementError,
  setError,
  setMessage,
  inventoryDraft,
  setInventoryDraft,
  flattenInventoryArrivalPositions,
  inventoryOperationSourceRows,
  getInventoryRowCategory,
  inventoryTransferRequestId,
  inventoryManualRequestId,
  apiFetch,
  loadInventoryData,
  loadCatalogData,
  setInventoryTransferRequestId,
  setInventoryManualRequestId,
  makeCashRequestId,
  setInventoryArrivalPositions,
  setInventoryArrivalVariantOpen,
  resetInventoryOperationSelection,
  setInventoryMatrix,
  setInventoryMatrixColorToAdd,
  setInventoryMatrixSizeToAdd,
  setArrivalRecoveryPrompt,
  setArrivalRecoveryError,
  arrivalRecoveryContinueRef,
  askStockResolution,
}: InventoryMovementActionsArgs) {
  async function applyInventoryStocktakeChanges(
    source: InventorySourceKey,
    items: InventoryStocktakeApplyItem[],
    sessionId: string,
  ): Promise<InventoryStocktakeApplyResult> {
    const cleanItems = items.filter((item) => item.key && Number.isFinite(item.quantity) && Number.isFinite(item.expectedQuantity))
    if (!cleanItems.length) {
      return { ok: true, appliedKeys: [], message: 'Расхождений для применения нет.' }
    }

    setError(null)
    setMessage(null)
    const appliedKeys: string[] = []
    const chunkSize = 6
    const reference = `Ревизия ${sourceLabel(source)} · ${sessionId}`

    for (let index = 0; index < cleanItems.length; index += chunkSize) {
      const chunk = cleanItems.slice(index, index + chunkSize)
      try {
        const response = await apiFetch('/api/inventory/movements?returnInventory=0', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: makeCashRequestId(`stocktake-${sessionId}-${index}`),
            inventorySource: source,
            movementType: 'manual_set',
            comment: reference,
            items: chunk.map(({ key: _key, ...item }) => item),
          }),
        })
        const result = await readJsonResponse<{ message?: string }>(response, 'Применение ревизии')
        if (!response.ok) throw new Error(result.message || `Inventory stocktake save failed: ${response.status}`)
        appliedKeys.push(...chunk.map((item) => item.key))
      } catch (err) {
        await Promise.allSettled([
          loadInventoryData(source, true, '', false),
        ])
        const reason = err instanceof Error ? err.message : 'Не удалось применить результаты ревизии.'
        const message = appliedKeys.length
          ? `Часть ревизии сохранена (${appliedKeys.length} поз.). Дальше остановлено: ${reason}`
          : reason
        setError(message)
        return { ok: false, appliedKeys, message }
      }
    }

    await Promise.all([
      loadInventoryData(source, true, '', false),
    ])
    const message = `Ревизия ${sourceLabel(source)} применена: исправлено ${appliedKeys.length} поз.`
    setMessage(message)
    return { ok: true, appliedKeys, message }
  }


  async function saveInventoryMovement() {
    if (inventoryMovementBusy) return
    setInventoryMovementBusy(true)
    setInventoryMovementError('')
    setError(null)
    setMessage(null)
    try {
      const movementItems = inventoryDraft.movementType === 'arrival'
        // Existing catalog SKUs are selected by their IDs in the same grid as
        // correction/writeoff. Only genuinely new combinations use the legacy
        // creation subform. Both are saved in the same atomic movement request.
        ? [
            ...inventoryDraft.items.filter((item) => item.variantId && Number(item.quantity || 0) > 0),
            ...flattenInventoryArrivalPositions(),
          ]
        : inventoryDraft.items
      const cleanItems = movementItems
        .filter((item) => (item.variantId || item.productName) && (inventoryDraft.movementType === 'manual_set' ? item.touched : Number(item.quantity || 0) > 0))
        .map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          category: item.category,
          gender: item.gender,
          color: item.color,
          material: item.material,
          length: item.length,
          size: item.size,
          quantity: Number(item.quantity || 0),
          expectedQuantity: item.expectedQuantity,
          observedPhysicalQuantity: inventoryDraft.movementType === 'manual_set' ? item.observedPhysicalQuantity : undefined,
          ...(inventoryDraft.movementType === 'manual_set' && item.createMissingVariant ? {createMissingVariant:true} : {}),
        }))

      if (!cleanItems.length) {
        throw new Error('Выберите хотя бы один товар/вариант.')
      }

      if ((inventoryDraft.movementType === 'writeoff' || inventoryDraft.movementType === 'transfer') && cleanItems.some((item) => !item.variantId)) {
        throw new Error('Для списания и перемещения выберите существующий вариант из остатков выбранной точки.')
      }

      if (inventoryDraft.movementType === 'writeoff' || inventoryDraft.movementType === 'transfer' || inventoryDraft.movementType === 'manual_set') {
        const same = (left: unknown, right: unknown) => normalizeSearchText(left) === normalizeSearchText(right)
        const invalidItem = cleanItems.find((item) => {
          // Explicit +size/+color corrections are resolved by the server from
          // a validated active catalog product+execution, with no manual SKU matching.
          if (inventoryDraft.movementType === 'manual_set' && !item.variantId && item.createMissingVariant) return false
          if (inventoryDraft.movementType === 'manual_set' && !item.variantId) return false
          const row = inventoryOperationSourceRows.find((entry) => String(entry.variantId || '') === String(item.variantId || ''))
          return !row
            || getInventoryRowCategory(row) !== item.category
            || !same(row.productName, item.productName)
            || !same(row.gender, item.gender)
            || !same(row.color, item.color)
            || !same(row.material, item.material)
            || !same(row.length, item.length)
            || !same(row.size, item.size)
        })
        if (invalidItem) {
          throw new Error('Выбранная комбинация больше не соответствует остаткам источника. Выберите существующий вариант заново.')
        }
      }

      const isTransfer = inventoryDraft.movementType === 'transfer'
      const isWriteoff = inventoryDraft.movementType === 'writeoff'
      type InventoryMovementSaveResponse = {
        ok?: boolean
        message?: string
        operationId?: string
        arrivalReceipt?: {
          verified: boolean
          source: InventorySourceKey
          items: Array<{ variantId: number; productName: string; color: string | null; size: string | null; received: number; currentQuantity: number | null }>
        }
        externalId?: string
        warnings?: Array<{ shortageAfter?: number }>
        code?: string
        operationType?: string
        items?: StockResolutionRequiredItemView[]
        productId?: number | null
        productName?: string | null
        retirementId?: number | null
        variantId?: number | null
      }
      type MovementSubmitItem = (typeof cleanItems)[number]

      const submitMovement = async (
        stockConfirmations?: Array<{ source: InventorySourceKey; variantId: number; expectedQuantity: number; operationQuantity: number }>,
        itemsOverride: MovementSubmitItem[] = cleanItems,
      ) => {
        const response = await apiFetch(isTransfer ? '/api/inventory/transfer?returnInventory=0' : '/api/inventory/movements?returnInventory=0', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isTransfer ? {
            requestId: inventoryTransferRequestId,
            fromSource: inventoryDraft.source,
            toSource: inventoryDraft.targetSource,
            comment: inventoryDraft.comment,
            items: itemsOverride,
            stockConfirmations,
          } : {
            requestId: inventoryManualRequestId,
            inventorySource: inventoryDraft.source,
            movementType: inventoryDraft.movementType,
            comment: inventoryDraft.comment,
            items: itemsOverride,
            stockConfirmations,
          }),
        })
        const result = await readJsonResponse<InventoryMovementSaveResponse>(response, 'Сохранение движения склада', { allowHttpError: true })
        return { response, result }
      }

      const finishMovement = async (result: InventoryMovementSaveResponse) => {
        const refreshes: Array<Promise<unknown>> = isTransfer
          ? [
              loadInventoryData('warehouse', true, '', false),
              loadInventoryData('boutique', true, '', false),
            ]
          : inventoryDraft.movementType === 'arrival' || (inventoryDraft.movementType === 'manual_set' && cleanItems.some(item=>item.createMissingVariant))
            ? [
                loadInventoryData(inventoryDraft.source, true, '', false),
                loadCatalogData(true),
              ]
            : [
                loadInventoryData(inventoryDraft.source, true, '', false),
              ]
        // The mutation is already committed once the POST returned 2xx. Follow-up reads are
        // best-effort so a refresh failure cannot invite the employee to submit the operation again.
        const refreshResults = await Promise.allSettled(refreshes)
        const refreshedInventory = refreshResults[0]?.status === 'fulfilled'
          ? refreshResults[0].value as InventoryResponse | null
          : null
        const refreshedStock = Boolean(refreshedInventory?.ok)
        const arrivalReceipt = result.arrivalReceipt
        const verifiedInStockList = Boolean(arrivalReceipt?.verified && refreshedStock
          && arrivalReceipt.items.every((receiptItem) =>
            (refreshedInventory?.items || []).some((stockRow) =>
              Number(stockRow.variantId) === receiptItem.variantId
              && stockRow.inventorySource === arrivalReceipt.source
            )))
        const arrivalLabel = arrivalReceipt?.items?.length
          ? [...new Set(arrivalReceipt.items.map((item) => item.productName).filter(Boolean))].join(', ')
          : ''
        const arrivalVerificationWarning = inventoryDraft.movementType === 'arrival'
          && !verifiedInStockList
          ? ' Внимание: операция записана, но отображение актуального остатка не подтверждено. Не оформляйте приход повторно — проверьте историю операции и нажмите «Обновить».'
          : ''
        const transferShortage = isTransfer ? (result.warnings || []).reduce((sum, row) => sum + Math.max(0, Number(row.shortageAfter || 0)), 0) : 0
        setInventoryMovementError('')
        setMessage(isTransfer
          ? `Перемещение ${sourceLabel(inventoryDraft.source)} → ${sourceLabel(inventoryDraft.targetSource)} сохранено${result.externalId ? ` · ${result.externalId}` : ''}.${transferShortage > 0 ? ` В исходной точке после перемещения не хватает ${transferShortage} шт. для активных заказов — резервы сохранены.` : ''}`
          : inventoryDraft.movementType === 'arrival'
            ? `Приход на ${sourceLabel(inventoryDraft.source)} сохранён${result.operationId ? ` · операция ${result.operationId}` : ''}.${arrivalLabel ? ` Учтённый товар: ${arrivalLabel}.` : ''}${arrivalVerificationWarning}`
            : `${sourceLabel(inventoryDraft.source)} обновлён.`)
        if (isTransfer) setInventoryTransferRequestId(makeCashRequestId('inventory-transfer'))
        else setInventoryManualRequestId(makeCashRequestId('inventory-manual'))
        setInventoryDraft((current) => ({
          ...current,
          comment: '',
          items: [createEmptyInventoryItem()],
        }))
        if (inventoryDraft.movementType === 'arrival') {
          setInventoryArrivalPositions([createEmptyArrivalPosition()])
          setInventoryArrivalVariantOpen({})
        }
        resetInventoryOperationSelection()
        setInventoryMatrix(createEmptyInventoryMatrixDraft())
        setInventoryMatrixColorToAdd('')
        setInventoryMatrixSizeToAdd('')
      }

      const isArrivalRecoveryResult = (result: InventoryMovementSaveResponse) => (
        result.code === 'arrival_retired_product' || result.code === 'arrival_stale_variant'
      )

      const openArrivalRecovery = async (result: InventoryMovementSaveResponse, retryItems: MovementSubmitItem[]) => {
        const { openArrivalRecoveryFlow } = await import('./arrivalRecoveryFlow')
        await openArrivalRecoveryFlow({
          result,
          retryItems,
          apiFetch: (input, init) => apiFetch(input, init),
          readJsonResponse: (response, label, options) => readJsonResponse(response, label, options),
          makeRequestId: makeCashRequestId,
          normalizeText: normalizeSearchText,
          submitMovement: (items) => submitMovement(undefined, items as MovementSubmitItem[]),
          onPrompt: setArrivalRecoveryPrompt,
          onError: setArrivalRecoveryError,
          onBusy: setInventoryMovementBusy,
          onContinuation: (continuation) => { arrivalRecoveryContinueRef.current = continuation },
          onSuccess: async (recoveryResult) => { await finishMovement(recoveryResult as InventoryMovementSaveResponse) },
        })
      }

      let { response, result } = await submitMovement()
      const resolverOperation = isTransfer ? 'transfer' : isWriteoff ? 'writeoff' : ''
      if (
        !response.ok
        && resolverOperation
        && result.code === 'stock_resolution_required'
        && result.operationType === resolverOperation
        && Array.isArray(result.items)
        && result.items.length
      ) {
        const confirmed = await askStockResolution({
          title: isTransfer ? 'Для перемещения не хватает учтённого остатка' : 'Для списания не хватает учтённого остатка',
          intro: isTransfer ? 'Подтвердите, что эти вещи действительно сейчас переносятся между точками.' : 'Подтвердите, что эти вещи действительно сейчас физически списываются.',
          actionLabel: isTransfer ? 'Да, перемещаю' : 'Да, списываю',
          items: result.items.map((resolutionItem) => ({
            productName: resolutionItem.productName || 'Товар',
            tracked: Math.max(0, Number(resolutionItem.trackedPhysicalQuantity || 0)),
            needed: Math.max(1, Number(resolutionItem.operationQuantity || 1)),
          })),
          note: 'Подтверждение относится только к этой операции и не заменяет ревизию.',
        })
        if (!confirmed) {
          setMessage(isTransfer ? 'Перемещение остановлено. Остатки не изменялись.' : 'Списание остановлено. Остатки не изменялись.')
          return
        }
        const stockConfirmations = result.items.map((resolutionItem) => ({
          source: resolutionItem.source === 'boutique' ? 'boutique' as const : 'warehouse' as const,
          variantId: Number(resolutionItem.variantId || 0),
          expectedQuantity: Math.max(0, Number(resolutionItem.trackedPhysicalQuantity || 0)),
          operationQuantity: Math.max(1, Number(resolutionItem.operationQuantity || 1)),
        }))
        ;({ response, result } = await submitMovement(stockConfirmations))
      }

      if (!response.ok && isArrivalRecoveryResult(result)) {
        await openArrivalRecovery(result, cleanItems)
        return
      }
      if (!response.ok) throw new Error(result.message || `Inventory save failed: ${response.status}`)

      await finishMovement(result)
    } catch (err) {
      // Keep the original draft and review visible so users can inspect the same
      // variants instead of starting over. A failed response is not proof that
      // no movement committed; do not generate a fresh request ID here.
      setInventoryMovementError(err instanceof Error ? err.message : 'Не удалось сохранить складскую операцию. Проверьте историю.')
    } finally {
      setInventoryMovementBusy(false)
    }
  }


  return {
    applyInventoryStocktakeChanges,
    saveInventoryMovement,
  }
}
