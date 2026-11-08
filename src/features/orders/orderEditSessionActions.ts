import type { Dispatch, SetStateAction } from 'react'
import type { AppSector, CatalogResponse, EditorDraft, InventoryResponse, InventorySourceKey, OrderPanel, OrderRecord } from '../../app/types'
import type { OrderOperationalProjection } from '../../app/orderOperationalProjection'
import { createEditorDraft, readJsonResponse } from '../../app/utils'

type OrderEditSessionArgs = {
  isAdmin: boolean
  editorReturnSector: 'orders' | 'workshop'
  setEditorReturnSector: Dispatch<SetStateAction<'orders' | 'workshop'>>
  setEditorOpen: Dispatch<SetStateAction<boolean>>
  setEditorOrderOverride: Dispatch<SetStateAction<OrderRecord | null>>
  setSelectedOrderId: Dispatch<SetStateAction<number | null>>
  setActiveSector: Dispatch<SetStateAction<AppSector>>
  setOrderPanel: Dispatch<SetStateAction<OrderPanel>>
  setMessage: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setExpandedOrderItemCounts: Dispatch<SetStateAction<Record<number, number>>>
  setEditorDraft: Dispatch<SetStateAction<EditorDraft | null>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  getOrderOperationalProjection: (order: OrderRecord) => Promise<OrderOperationalProjection>
  upsertOrderInState: (order: OrderRecord) => void
  loadCatalogData: (force?: boolean) => Promise<CatalogResponse | null>
  loadInventoryData: (source: InventorySourceKey, force?: boolean, query?: string, includeMovements?: boolean) => Promise<InventoryResponse | null>
}

// Never open an itemized editor from a truncated overview or a stale cached order.
// The server and the operational projection remain authoritative.
export function createOrderEditSessionActions({
  isAdmin,
  editorReturnSector,
  setEditorReturnSector,
  setEditorOpen,
  setEditorOrderOverride,
  setSelectedOrderId,
  setActiveSector,
  setOrderPanel,
  setMessage,
  setError,
  setExpandedOrderItemCounts,
  setEditorDraft,
  apiFetch,
  getOrderOperationalProjection,
  upsertOrderInState,
  loadCatalogData,
  loadInventoryData,
}: OrderEditSessionArgs) {
  function closeOrderEditor() {
    setEditorOpen(false)
    setEditorOrderOverride(null)
    setSelectedOrderId(null)
    if (editorReturnSector === 'workshop') {
      setActiveSector('workshop')
      window.location.hash = '#workshop'
    } else {
      setActiveSector('orders')
      setOrderPanel('list')
      window.location.hash = '#orders'
    }
    setEditorReturnSector('orders')
  }


  async function fetchCompleteOrderForEditing(order: OrderRecord): Promise<OrderRecord> {
    // The list is an overview, never the source of truth for a complete itemized rewrite.
    const response = await apiFetch(`/api/orders/${order.id}`, { cache: 'no-store' })
    if (response.headers.get('X-Orders-App-Stale') === '1') {
      throw new Error('Не удалось получить свежий состав заказа. Повторите открытие.')
    }
    const result = await readJsonResponse<{ ok?: boolean; order?: OrderRecord; message?: string }>(response, 'Полный состав заказа')
    if (!response.ok || result.ok === false || !result.order || result.order.id !== order.id) {
      throw new Error(result.message || 'Не удалось загрузить полный заказ. Редактирование не открыто.')
    }
    const fullOrder = result.order
    const expectedCount = Math.max(order.items?.length || 0, Number(order.item_count || 0))
    if ((fullOrder.items?.length || 0) < expectedCount) {
      throw new Error('Получен неполный состав заказа. Редактирование остановлено, чтобы не потерять товары.')
    }
    return { ...fullOrder, item_count: fullOrder.items.length }
  }

  async function expandOrderItems(order: OrderRecord, visibleCount: number) {
    const total = Math.max(order.items.length, Number(order.item_count || 0))
    const wanted = Math.min(total, Math.max(3, visibleCount) + 5)
    if (order.items.length >= wanted) {
      setExpandedOrderItemCounts((current) => ({ ...current, [order.id]: wanted }))
      return
    }
    try {
      const fresh = await fetchCompleteOrderForEditing(order)
      upsertOrderInState(fresh)
      setExpandedOrderItemCounts((current) => ({ ...current, [order.id]: Math.min(fresh.items.length, wanted) }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось показать остальные товары.')
    }
  }

  async function handleEditOrder(order: OrderRecord, returnSector: 'orders' | 'workshop' = 'orders') {
    if (!isAdmin) { setMessage('Полное редактирование доступно только администратору. Для исправления цены или реквизитов откройте «Доп. действия».'); return }
    let completeOrder: OrderRecord
    try {
      completeOrder = await fetchCompleteOrderForEditing(order)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть полный заказ.')
      return
    }
    const projection = await getOrderOperationalProjection(completeOrder)
    if (!projection.canEdit) {
      setSelectedOrderId(order.id)
      setEditorOpen(false)
      setMessage(projection.hasCommittedDownstreamOperation
        ? 'Заказ нельзя переписывать: по нему уже проведён возврат или обмен. Сначала отмените или исправьте эту последующую операцию штатным действием.'
        : 'Этот заказ нельзя редактировать в рабочем режиме. Используйте его отдельное штатное действие или просмотр истории.')
      return
    }
    setEditorReturnSector(returnSector)
    upsertOrderInState(completeOrder)
    setEditorOrderOverride(completeOrder)
    setSelectedOrderId(completeOrder.id)
    setEditorDraft(createEditorDraft(completeOrder))
    setActiveSector('orders')
    setOrderPanel('edit')
    setEditorOpen(true)
    window.location.hash = '#editor'
    if (completeOrder.pricing_mode === 'itemized_v1') {
      void Promise.all([
        loadCatalogData(true),
        // R7.5: the edit panel effect owns freshness; reuse its bounded stock snapshot here
        // instead of issuing a second forced Warehouse + Boutique read for the same transition.
        loadInventoryData('warehouse', false, '', false),
        loadInventoryData('boutique', false, '', false),
      ]).catch((err) => {
        setError(err instanceof Error ? err.message : 'Не удалось обновить Каталог или остатки. Сервер всё равно перепроверит данные при сохранении.')
      })
    }
  }


  return {
    closeOrderEditor,
    expandOrderItems,
    handleEditOrder,
  }
}
