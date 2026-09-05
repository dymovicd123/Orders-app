import { useEffect, useState } from 'react'

type AttentionCategory = 'handover' | 'intake' | 'identify'

type InventoryAttentionActionsInput = {
  activeSector: string
  inventoryPanel: string
  simpleStockDetail: any
  quickStocktakeBusy: boolean
  quickStocktakeValues: Record<string, string>
  setQuickStocktakeBusy: (value: boolean) => void
  setQuickStocktakeValues: (value: Record<string, string>) => void
  setQuickStocktakeNotice: (value: string) => void
  setQuickStocktakeOpen: (value: boolean) => void
  setSimpleStockDetail: (value: any) => void
  setCatalogAdminMode: (value: 'lifecycle' | 'review') => void
  setCatalogReviewTaskIndex: (value: number) => void
  setInventoryLifecycleTaskIndex: (value: number) => void
  loadWarehouseAttention: (details?: boolean) => Promise<any>
  loadInventoryLifecycle: (force?: boolean) => Promise<any>
  loadCatalogReview: (force?: boolean) => Promise<any>
  reconcileKnownInventoryLifecycle: (eventId: number) => Promise<any>
  quickInventoryStocktake: (input: any) => Promise<any>
  loadInventoryData: (...args: any[]) => Promise<any>
  openInventoryPanel: (panel: any) => void
  openOrderStockHandoverById: (orderId: number, externalId?: string) => any
}

export function useInventoryAttentionActions(input: InventoryAttentionActionsInput) {
  const {
    activeSector,
    inventoryPanel,
    simpleStockDetail,
    quickStocktakeBusy,
    quickStocktakeValues,
    setQuickStocktakeBusy,
    setQuickStocktakeValues,
    setQuickStocktakeNotice,
    setSimpleStockDetail,
    setCatalogAdminMode,
    setCatalogReviewTaskIndex,
    setInventoryLifecycleTaskIndex,
    loadWarehouseAttention,
    loadInventoryLifecycle,
    loadCatalogReview,
    reconcileKnownInventoryLifecycle,
    quickInventoryStocktake,
    loadInventoryData,
    openInventoryPanel,
    openOrderStockHandoverById,
  } = input
  const [attentionLoading, setAttentionLoading] = useState(false)
  const [attentionError, setAttentionError] = useState('')
  const [attentionCategory, setAttentionCategory] = useState<AttentionCategory>('handover')
  const [attentionIntakeBusyId, setAttentionIntakeBusyId] = useState<number | null>(null)

  async function applyQuickStocktake(countedOverride?: number) {
    if (!simpleStockDetail?.variantId || simpleStockDetail.aggregate || quickStocktakeBusy) return
    const raw = countedOverride === undefined ? (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') : String(countedOverride)
    if (raw === '') {
      setQuickStocktakeNotice('Введите фактическое количество этой позиции.')
      return
    }
    const countedQuantity = Number(raw)
    if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
      setQuickStocktakeNotice('Фактическое количество должно быть целым числом 0 или больше.')
      return
    }
    setQuickStocktakeBusy(true)
    setQuickStocktakeNotice('')
    try {
      const result = await quickInventoryStocktake({
        source: simpleStockDetail.source,
        variantId: simpleStockDetail.variantId,
        expectedQuantity: simpleStockDetail.physical,
        countedQuantity,
      })
      if (!result?.ok) {
        setQuickStocktakeNotice(result?.message || 'Сверку пока нельзя применить.')
        if (result?.code === 'changed') {
          const current = result?.conflicts?.find((row: any) => Number(row.variantId) === Number(simpleStockDetail.variantId))
          if (current) setSimpleStockDetail((detail: any) => detail ? { ...detail, physical: Number(current.currentQuantity || 0), free: Number(current.currentQuantity || 0) - Number(detail.reserved || 0) } : detail)
        }
        return
      }
      const physical = Number(result.physical || 0)
      const reserved = Number(result.reserved || 0)
      const successNotice = result.changed ? `Сохранено: ${result.previousQuantity} → ${physical}.` : `Проверено: на месте ${physical}. Всё совпало.`
      setSimpleStockDetail((detail: any) => detail ? { ...detail, physical, reserved, free: physical - reserved } : detail)
      setQuickStocktakeNotice(successNotice)
      setQuickStocktakeValues({})
      try {
        await loadInventoryData(simpleStockDetail.source, true, '', false)
      } catch {
        setQuickStocktakeNotice(`${successNotice} Остаток сохранён; список обновится при следующем обновлении.`)
      }
    } catch (error) {
      setQuickStocktakeNotice(error instanceof Error ? error.message : 'Не удалось сохранить сверку.')
    } finally {
      setQuickStocktakeBusy(false)
    }
  }

  async function refreshWarehouseAttention() {
    if (attentionLoading) return
    setAttentionLoading(true)
    setAttentionError('')
    try {
      const data = await loadWarehouseAttention(true)
      if (!data?.items) throw new Error('Не удалось загрузить список вопросов склада. Нажмите «Обновить» и попробуйте ещё раз.')
    } catch (error) {
      setAttentionError(error instanceof Error ? error.message : 'Не удалось обновить вопросы склада.')
    } finally {
      setAttentionLoading(false)
    }
  }

  useEffect(() => {
    if (activeSector !== 'inventory' || inventoryPanel !== 'attention') return
    void refreshWarehouseAttention()
  }, [activeSector, inventoryPanel])

  async function openAttentionLifecycle(item: any) {
    setCatalogAdminMode('lifecycle')
    openInventoryPanel('catalog')
    const data = await loadInventoryLifecycle(true)
    const index = Array.isArray(data?.items) ? data.items.findIndex((row: any) => Number(row.id) === Number(item.id)) : -1
    setInventoryLifecycleTaskIndex(index >= 0 ? index : 0)
  }

  async function openAttentionCatalog(item: any) {
    setCatalogAdminMode('review')
    openInventoryPanel('catalog')
    const data = await loadCatalogReview(true)
    const groups = Array.isArray(data?.groups) ? data.groups : Array.isArray(data?.items) ? data.items : []
    const index = groups.findIndex((row: any) => Number(row.orderItemId || row.order_item_id) === Number(item.orderItemId))
    setCatalogReviewTaskIndex(index >= 0 ? index : 0)
  }

  async function openAttentionIntake(item: any) {
    if (!item?.id || attentionIntakeBusyId !== null) return
    setAttentionIntakeBusyId(Number(item.id))
    setAttentionError('')
    try {
      const result = await reconcileKnownInventoryLifecycle(Number(item.id))
      if (!result?.ok) setAttentionError(result?.message || 'Не удалось завершить приёмку.')
      else if (!result?.warehouseAttention) await loadWarehouseAttention(true)
    } catch (error) {
      setAttentionError(error instanceof Error ? error.message : 'Не удалось завершить приёмку.')
    } finally {
      setAttentionIntakeBusyId(null)
    }
  }

  function openAttentionHandover(item: any) {
    void openOrderStockHandoverById(Number(item.orderId || 0), String(item.externalId || ''))
  }

  return {
    applyQuickStocktake,
    attentionCategory,
    attentionError,
    attentionIntakeBusyId,
    attentionLoading,
    openAttentionCatalog,
    openAttentionHandover,
    openAttentionIntake,
    openAttentionLifecycle,
    refreshWarehouseAttention,
    setAttentionCategory,
  }
}
