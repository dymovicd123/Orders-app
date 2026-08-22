import { useEffect, useState } from 'react'

type AttentionCategory = 'count' | 'handover' | 'intake' | 'identify' | 'revision'

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
  setSimpleStockSource: (value: 'warehouse' | 'boutique') => void
  setSimpleStockReservations: (value: any[]) => void
  setSimpleStockReservationsBusy: (value: boolean) => void
  setCatalogAdminMode: (value: 'lifecycle' | 'review') => void
  setCatalogReviewTaskIndex: (value: number) => void
  setInventoryLifecycleTaskIndex: (value: number) => void
  setStocktakeSource: (value: 'warehouse' | 'boutique') => void
  loadWarehouseAttention: (details?: boolean) => Promise<any>
  loadInventoryLifecycle: (force?: boolean) => Promise<any>
  loadCatalogReview: (force?: boolean) => Promise<any>
  reconcileKnownInventoryLifecycle: (eventId: number) => Promise<any>
  quickInventoryStocktake: (input: any) => Promise<any>
  loadInventoryData: (...args: any[]) => Promise<any>
  loadInventoryReservations: (...args: any[]) => Promise<any>
  openInventoryPanel: (panel: any) => void
  openOrderStockHandoverById: (orderId: number, externalId?: string) => any
}

function attentionCategoryCount(data: any, category: AttentionCategory) {
  if (!data?.counts) return 0
  if (category === 'count') return Number(data.counts.shortage || 0)
  if (category === 'handover') return Number(data.counts.handover || 0)
  if (category === 'intake') return Number(data.counts.intake || 0)
  if (category === 'identify') return Number(data.counts.lifecycle || 0) + Number(data.counts.catalog || 0)
  return Number(data.counts.stocktake || 0)
}

function firstAttentionCategory(data: any): AttentionCategory {
  for (const category of ['count', 'handover', 'intake', 'identify', 'revision'] as AttentionCategory[]) {
    if (attentionCategoryCount(data, category) > 0) return category
  }
  return 'count'
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
    setQuickStocktakeOpen,
    setSimpleStockDetail,
    setSimpleStockSource,
    setSimpleStockReservations,
    setSimpleStockReservationsBusy,
    setCatalogAdminMode,
    setCatalogReviewTaskIndex,
    setInventoryLifecycleTaskIndex,
    setStocktakeSource,
    loadWarehouseAttention,
    loadInventoryLifecycle,
    loadCatalogReview,
    reconcileKnownInventoryLifecycle,
    quickInventoryStocktake,
    loadInventoryData,
    loadInventoryReservations,
    openInventoryPanel,
    openOrderStockHandoverById,
  } = input
  const [attentionLoading, setAttentionLoading] = useState(false)
  const [attentionError, setAttentionError] = useState('')
  const [attentionCategory, setAttentionCategory] = useState<AttentionCategory>('count')
  const [attentionIntakeBusyId, setAttentionIntakeBusyId] = useState<number | null>(null)

  async function applyQuickStocktake() {
    if (!simpleStockDetail?.variantId || simpleStockDetail.aggregate || quickStocktakeBusy) return
    const raw = quickStocktakeValues[String(simpleStockDetail.variantId)] ?? ''
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
      setSimpleStockDetail((detail: any) => detail ? { ...detail, physical, reserved, free: physical - reserved } : detail)
      setQuickStocktakeNotice(result.changed ? `Сохранено: ${result.previousQuantity} → ${physical}.` : `Проверено: на месте ${physical}. Всё совпало.`)
      setQuickStocktakeValues({})
      await Promise.all([
        loadInventoryData(simpleStockDetail.source, true, '', false),
        loadWarehouseAttention(true),
      ])
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
      setAttentionCategory((current) => attentionCategoryCount(data, current) > 0 ? current : firstAttentionCategory(data))
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

  async function openAttentionShortage(item: any) {
    const physical = Number(item.physical || 0)
    const reserved = Number(item.reserved || 0)
    setSimpleStockSource(item.source)
    setSimpleStockDetail({
      source: item.source,
      productId: Number(item.productId || 0),
      variantId: Number(item.variantId || 0),
      productName: item.productName || 'Товар',
      category: item.category || 'adult',
      gender: item.gender || '',
      material: item.material || 'СТАНДАРТ',
      length: item.length || 'СТАНДАРТ',
      size: item.size || '',
      color: item.color || '',
      physical,
      reserved,
      free: Number(item.free ?? (physical - reserved)),
      aggregate: false,
      label: [item.color, item.size].filter(Boolean).join(' · '),
      hasDataIssue: false,
    })
    setQuickStocktakeOpen(true)
    setQuickStocktakeValues({})
    setQuickStocktakeNotice('')
    setSimpleStockReservations([])
    openInventoryPanel('overview')
    if (reserved > 0) {
      setSimpleStockReservationsBusy(true)
      try {
        const data = await loadInventoryReservations(item.source, Number(item.variantId || 0), 0)
        setSimpleStockReservations(Array.isArray(data?.reservations) ? data.reservations : [])
      } catch {
        setSimpleStockReservations([])
      } finally {
        setSimpleStockReservationsBusy(false)
      }
    }
  }

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
      else {
        const data = await loadWarehouseAttention(true)
        setAttentionCategory((current) => attentionCategoryCount(data, current) > 0 ? current : firstAttentionCategory(data))
      }
    } catch (error) {
      setAttentionError(error instanceof Error ? error.message : 'Не удалось завершить приёмку.')
    } finally {
      setAttentionIntakeBusyId(null)
    }
  }

  function openAttentionHandover(item: any) {
    void openOrderStockHandoverById(Number(item.orderId || 0), String(item.externalId || ''))
  }
  function openAttentionStocktake(item: any) {
    setStocktakeSource(item.source === 'boutique' ? 'boutique' : 'warehouse')
    openInventoryPanel('stocktake')
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
    openAttentionShortage,
    openAttentionStocktake,
    refreshWarehouseAttention,
    setAttentionCategory,
  }
}
