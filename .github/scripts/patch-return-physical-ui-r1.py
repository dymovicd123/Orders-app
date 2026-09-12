from pathlib import Path

files = {
    'activity': Path('worker/domains/activity.ts'),
    'domain': Path('worker/domains/returns-exchanges.ts'),
    'router': Path('worker/index.ts'),
    'types': Path('src/app/types.ts'),
    'utils': Path('src/app/utils.ts'),
    'app': Path('src/App.tsx'),
    'returns': Path('src/features/sections/OrderReturnsSection.tsx'),
    'exchange': Path('src/features/sections/OrderExchangeSection.tsx'),
}
texts = {k: p.read_text() for k, p in files.items()}

def rep(key: str, old: str, new: str, label: str):
    text = texts[key]
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 anchor, found {count}')
    texts[key] = text.replace(old, new, 1)

# History must expose whether the returned line originated in Workshop so the UI never offers Boutique there.
rep('activity',
"""            ri.physical_received_at AS return_item_physical_received_at,
            lifecycle.status AS return_item_lifecycle_status,
""",
"""            ri.physical_received_at AS return_item_physical_received_at,
            COALESCE((SELECT oi.is_workshop FROM order_items oi WHERE oi.id = ri.order_item_id), 0) AS return_item_is_workshop,
            lifecycle.status AS return_item_lifecycle_status,
""", 'return history workshop select')
rep('activity',
"""      physicalReceivedAt: cleanText(row.return_item_physical_received_at) || null,
      lifecycleStatus: cleanText(row.return_item_lifecycle_status) || null, pendingReason: cleanText(row.return_item_pending_reason) || null,
""",
"""      physicalReceivedAt: cleanText(row.return_item_physical_received_at) || null,
      isWorkshop: Boolean(toInt(row.return_item_is_workshop, 0)),
      lifecycleStatus: cleanText(row.return_item_lifecycle_status) || null, pendingReason: cleanText(row.return_item_pending_reason) || null,
""", 'return history workshop map')

rep('domain',
"""       old_snapshot.physical_tracking AS old_physical_tracking,
       old_snapshot.physical_received_at AS old_physical_received_at,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.product_name_snapshot ELSE new_item.product_name_snapshot END AS new_product_name,
""",
"""       old_snapshot.id AS old_operation_item_id,
       old_snapshot.physical_tracking AS old_physical_tracking,
       old_snapshot.physical_received_at AS old_physical_received_at,
       COALESCE(old_item.is_workshop, 0) AS old_is_workshop,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.product_name_snapshot ELSE new_item.product_name_snapshot END AS new_product_name,
""", 'exchange history physical identity select')
rep('domain',
"""      oldPhysicalTracking: Boolean(toInt(row.old_physical_tracking, 0)), oldPhysicalReceivedAt: cleanText(row.old_physical_received_at) || null,
      newItemId: row.new_order_item_id, newProductName: row.new_product_name || '—', newQuantity: row.new_item_quantity || 0,
""",
"""      oldOperationItemId: row.old_operation_item_id == null ? null : toInt(row.old_operation_item_id, 0) || null,
      oldPhysicalTracking: Boolean(toInt(row.old_physical_tracking, 0)), oldPhysicalReceivedAt: cleanText(row.old_physical_received_at) || null,
      oldIsWorkshop: Boolean(toInt(row.old_is_workshop, 0)),
      newItemId: row.new_order_item_id, newProductName: row.new_product_name || '—', newQuantity: row.new_item_quantity || 0,
""", 'exchange history physical identity map')

# Route request types mirror the new payloads (runtime behavior already lives in the domain).
rep('router',
"""const input = await readJson<{ requestId?: string; orderId?: number; returnDate?: string; amount?: number; paymentMethod?: string; comment?: string; restockSource?: unknown; items?: Array<{ orderItemId?: number; quantity?: number; amount?: number; restock?: boolean }> }>(request);""",
"""const input = await readJson<{ requestId?: string; orderId?: number; returnDate?: string; amount?: number; paymentMethod?: string; comment?: string; restockSource?: unknown; items?: Array<{ orderItemId?: number; quantity?: number; amount?: number; restock?: boolean; physicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock' }> }>(request);""", 'return route physical type')
rep('router',
"""const input = await readJson<{ requestId?: string; orderId?: number; exchangeDate?: string; oldItemId?: number; oldQuantity?: number; oldReturnSource?: unknown; newItem?: NonNullable<OrderInput['items']>[number]; newSourceWasManuallyChanged?: boolean; financialAction?: unknown; financialAmount?: number; paymentMethod?: string; comment?: string }>(request);""",
"""const input = await readJson<{ requestId?: string; orderId?: number; exchangeDate?: string; oldItemId?: number; oldQuantity?: number; oldReturnSource?: unknown; oldPhysicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock'; newItem?: NonNullable<OrderInput['items']>[number]; newSourceWasManuallyChanged?: boolean; financialAction?: unknown; financialAmount?: number; paymentMethod?: string; comment?: string }>(request);""", 'exchange route physical type')

# Frontend types.
rep('types',
"""  inventorySource?: 'warehouse' | 'boutique' | null | string
  restocked?: boolean
  lifecycleStatus?: 'pending' | 'applied' | 'cancelled' | null | string
""",
"""  inventorySource?: 'warehouse' | 'boutique' | null | string
  restocked?: boolean
  physicalTracking?: boolean
  physicalReceivedAt?: string | null
  isWorkshop?: boolean
  lifecycleStatus?: 'pending' | 'applied' | 'cancelled' | null | string
""", 'return history types')
rep('types',
"""  sourceType: 'warehouse' | 'boutique' | 'workshop'
  restock: boolean
}""",
"""  sourceType: 'warehouse' | 'boutique' | 'workshop'
  restock: boolean
  physicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock'
}""", 'return draft type')
rep('types',
"""  oldQuantity: number
  oldReturnSource: 'none' | 'warehouse' | 'boutique'
  newItem: EditorItem
""",
"""  oldQuantity: number
  oldReturnSource: 'none' | 'warehouse' | 'boutique'
  oldPhysicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock'
  newItem: EditorItem
""", 'exchange draft type')
rep('types',
"""  oldLifecycleStatus?: 'pending' | 'applied' | 'cancelled' | null | string
  newLifecycleStatus?: 'pending' | 'applied' | 'cancelled' | null | string
""",
"""  oldOperationItemId?: number | null
  oldPhysicalTracking?: boolean
  oldPhysicalReceivedAt?: string | null
  oldIsWorkshop?: boolean
  oldLifecycleStatus?: 'pending' | 'applied' | 'cancelled' | null | string
  newLifecycleStatus?: 'pending' | 'applied' | 'cancelled' | null | string
""", 'exchange history types')

# New operations default to waiting for the physical item. This is the safe default: no phantom stock.
rep('utils',
"""      sourceType: (item.sourceType === 'workshop' ? 'workshop' : item.sourceType === 'boutique' ? 'boutique' : 'warehouse') as 'warehouse' | 'boutique' | 'workshop',
      restock: item.sourceType !== 'workshop',
""",
"""      sourceType: (item.sourceType === 'workshop' ? 'workshop' : item.sourceType === 'boutique' ? 'boutique' : 'warehouse') as 'warehouse' | 'boutique' | 'workshop',
      restock: false,
      physicalState: 'pending',
""", 'return draft default physical state')
rep('utils',
"""    oldQuantity: 1,
    oldReturnSource: 'none',
    newItem: {
""",
"""    oldQuantity: 1,
    oldReturnSource: 'none',
    oldPhysicalState: 'pending',
    newItem: {
""", 'exchange draft default physical state')

# Save payloads carry the explicit physical state.
rep('app',
"""            quantity: item.quantity,
            restock: item.restock,
""",
"""            quantity: item.quantity,
            restock: item.physicalState === 'warehouse' || item.physicalState === 'boutique',
            physicalState: item.physicalState,
""", 'return save physical payload')
rep('app',
"""        oldQuantity: exchangeDraft.oldQuantity,
        oldReturnSource: exchangeDraft.oldReturnSource,
        newItem: effectiveNewItem,
""",
"""        oldQuantity: exchangeDraft.oldQuantity,
        oldReturnSource: exchangeDraft.oldPhysicalState === 'warehouse' || exchangeDraft.oldPhysicalState === 'boutique' ? exchangeDraft.oldPhysicalState : 'none',
        oldPhysicalState: exchangeDraft.oldPhysicalState,
        newItem: effectiveNewItem,
""", 'exchange save physical payload')

# Shared compact delayed-receipt action. No extra person/date fields: timestamp is server-side.
app_receive_anchor = "\n  async function cancelReturnEntry(entry: ReturnHistoryEntry) {\n"
if texts['app'].count(app_receive_anchor) != 1:
    raise SystemExit(f'app receive insert anchor count={texts["app"].count(app_receive_anchor)}')
receive_function = r'''

  async function receiveReturnedItemAction(input: {
    operationType: 'return' | 'exchange'
    operationId: number
    operationItemId: number
    destination: 'warehouse' | 'boutique' | 'no_stock'
    productName: string
    externalId: string
  }) {
    const destinationLabel = input.destination === 'warehouse' ? 'Склад' : input.destination === 'boutique' ? 'Бутик' : 'без добавления в остаток'
    if (!window.confirm(`Подтвердить получение «${input.productName}» по ${input.externalId}? Решение: ${destinationLabel}.`)) return false
    const setBusy = input.operationType === 'return' ? setReturnBusy : setExchangeBusy
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const payload = {
        operationType: input.operationType,
        operationId: input.operationId,
        operationItemId: input.operationItemId,
        destination: input.destination,
      }
      const criticalKey = `returned-item-receive:${input.operationType}:${input.operationId}:${input.operationItemId}:${input.destination}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch('/api/returned-items/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })
      const result = await readJsonResponse<{
        ok?: boolean
        message?: string
        pendingInventoryCount?: number
        stockApplied?: boolean
        stockAlreadyApplied?: boolean
      }>(response, 'Получение возвращённого товара')
      if (!response.ok) throw new Error(result.message || `Receive returned item failed: ${response.status}`)
      completeCriticalRequest(criticalKey, critical.requestId)
      invalidateInventoryStockCaches(true)
      await Promise.allSettled([
        input.operationType === 'return' ? loadReturnHistory() : loadExchangeHistory(),
        refreshActivityLogIfVisible(),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        isAdmin ? loadInventoryLifecycle(true) : Promise.resolve(null),
      ])
      if (input.destination === 'no_stock') {
        setMessage(`«${input.productName}» отмечен как полученный. В остаток товар не добавлялся.`)
      } else if (Number(result.pendingInventoryCount || 0) > 0) {
        setMessage(`«${input.productName}» физически получен. Для остатка требуется уточнение товара — система ничего не прибавляла наугад.`)
      } else {
        setMessage(`«${input.productName}» получен и учтён: ${destinationLabel}.`)
      }
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отметить товар полученным.')
      return false
    } finally {
      setBusy(false)
    }
  }
'''
texts['app'] = texts['app'].replace(app_receive_anchor, receive_function + app_receive_anchor, 1)

rep('app',
"""<OrderReturnsSection ctx={{ cancelReturnEntry, closeReturnForm, createReturnDraft, formatMoney, FriendlyNumberInput, isAdmin, loadReturnHistory, ManagerBadge, managerColorFor, orderPanelStyle, returnBusy, returnDraft, returnFormRef, returnHistory, returnHistoryBusy, returnHistoryError, returnHistoryFilters, returnHistoryHasMore, returnHistorySummary, returnSelectedOrder, saveReturn, sectorStyle, setOrderPanel, setReturnDraft, setReturnHistoryFilters, SmartPickerInput, suggestionValues }} />""",
"""<OrderReturnsSection ctx={{ cancelReturnEntry, closeReturnForm, createReturnDraft, formatMoney, FriendlyNumberInput, isAdmin, loadReturnHistory, ManagerBadge, managerColorFor, orderPanelStyle, receiveReturnedItemAction, returnBusy, returnDraft, returnFormRef, returnHistory, returnHistoryBusy, returnHistoryError, returnHistoryFilters, returnHistoryHasMore, returnHistorySummary, returnSelectedOrder, saveReturn, sectorStyle, setOrderPanel, setReturnDraft, setReturnHistoryFilters, SmartPickerInput, suggestionValues }} />""", 'return section receive callback')
rep('app',
"""<OrderExchangeSection ctx={{ applyExchangeProductPick, cancelExchangeEntry, closeExchangeForm, correctExchangeFinancialEntry, createExchangeDraft, exchangeBusy, exchangeDraft, exchangeFormRef, exchangeHistory, exchangeHistoryBusy, exchangeHistoryError, exchangeHistoryFilters, exchangeHistoryHasMore, exchangeHistorySummary, exchangeSelectedOrder, formatMoney, FriendlyNumberInput, getOrderSourceAvailability, isAdmin, loadExchangeHistory, ManagerBadge, managerColorFor, orderPanelStyle, saveExchange, sectorStyle, setExchangeDraft, setExchangeHistoryFilters, setOrderPanel, SmartPickerInput, sourceLabel, suggestionValues }} />""",
"""<OrderExchangeSection ctx={{ applyExchangeProductPick, cancelExchangeEntry, closeExchangeForm, correctExchangeFinancialEntry, createExchangeDraft, exchangeBusy, exchangeDraft, exchangeFormRef, exchangeHistory, exchangeHistoryBusy, exchangeHistoryError, exchangeHistoryFilters, exchangeHistoryHasMore, exchangeHistorySummary, exchangeSelectedOrder, formatMoney, FriendlyNumberInput, getOrderSourceAvailability, isAdmin, loadExchangeHistory, ManagerBadge, managerColorFor, orderPanelStyle, receiveReturnedItemAction, saveExchange, sectorStyle, setExchangeDraft, setExchangeHistoryFilters, setOrderPanel, SmartPickerInput, sourceLabel, suggestionValues }} />""", 'exchange section receive callback')

# Return section: local receipt destination only for currently waiting history rows.
rep('returns',
"""import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'
""",
"""import { useState } from 'react'
import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'
""", 'return section useState import')
rep('returns',
"""    returnSelectedOrder,
    saveReturn,
""",
"""    returnSelectedOrder,
    receiveReturnedItemAction,
    saveReturn,
""", 'return section callback destructure')
rep('returns',
"""  const inventorySourceLabel = (source: string) => source === 'warehouse'
    ? 'Склад'
    : source === 'boutique'
      ? 'Бутик'
      : 'Без возврата в остатки'

  return (
""",
"""  const inventorySourceLabel = (source: string) => source === 'warehouse'
    ? 'Склад'
    : source === 'boutique'
      ? 'Бутик'
      : 'Без возврата в остатки'

  const [receiptDestinations, setReceiptDestinations] = useState<Record<string, 'warehouse' | 'boutique' | 'no_stock'>>({})
  const returnPhysicalStatus = (item: any) => {
    if (!item.physicalTracking) return 'Старая запись — физическое получение не отслеживалось'
    if (!item.physicalReceivedAt) return 'Ещё не пришёл'
    if (!item.inventorySource) return 'Получен, в остаток не добавляли'
    const destination = inventorySourceLabel(item.inventorySource)
    if (item.lifecycleStatus === 'pending') return `Получен → ${destination}; остаток требует уточнения`
    if (item.lifecycleStatus === 'cancelled') return `Получен; проведение в ${destination} отменено`
    return `Получен → ${destination}`
  }

  return (
""", 'return section receipt helpers')

# Remove ambiguous global destination field completely.
old_global = r'''                          <label>
                            <span>Куда вернуть товар</span>
                            <select
                              value={returnDraft.restockSource}
                              onChange={(event) => {
                                const restockSource = event.target.value as ReturnDraft['restockSource']
                                setReturnDraft((current) => ({
                                  ...current,
                                  restockSource,
                                  items: restockSource === 'boutique'
                                    ? current.items.map((item) => item.sourceType === 'workshop' ? { ...item, restock: false } : item)
                                    : current.items,
                                }))
                              }}
                            >
                              <option value="none">Не возвращать в остатки</option>
                              <option value="warehouse">Склад</option>
                              <option value="boutique">Бутик</option>
                            </select>
                          </label>
'''
if texts['returns'].count(old_global) != 1:
    raise SystemExit(f'return global destination anchor count={texts["returns"].count(old_global)}')
texts['returns'] = texts['returns'].replace(old_global, '', 1)
rep('returns',
"""                          <span className="muted-small">Выберите количество. Для обычной складской/бутиковой позиции возврат в выбранное место включён по умолчанию. Товар из Цеха по умолчанию не попадает в остатки: если клиентскую вещь действительно решили оставить на Складе, включите это прямо у нужной строки. Цех → Бутик не используется.</span>
""",
"""                          <span className="muted-small">Для каждой возвращаемой позиции укажите только фактическую ситуацию: товар ещё едет или уже физически пришёл. Если он придёт позже, отметьте это одной кнопкой в истории возвратов.</span>
""", 'return form helper copy')
rep('returns',
"""                                <th>Позиция</th>
                                <th>Кол-во в заказе</th>
                                <th>Вернуть</th>
""",
"""                                <th>Позиция</th>
                                <th>Кол-во в заказе</th>
                                <th>Вернуть</th>
                                <th>Товар физически</th>
""", 'return table physical header')

# Simplify product cell and add one explicit physical select after quantity.
old_product_cell = r'''                                  <td>
                                    <div>{item.productName}</div>
                                    <label className="muted-small">
                                      <input
                                        type="checkbox"
                                        checked={returnDraft.restockSource !== 'none' && Boolean(item.restock)}
                                        disabled={returnDraft.restockSource === 'none' || (item.sourceType === 'workshop' && returnDraft.restockSource === 'boutique')}
                                        onChange={(event) => setReturnDraft((current) => ({
                                          ...current,
                                          items: current.items.map((entry, itemIndex) => itemIndex === index
                                            ? { ...entry, restock: event.target.checked }
                                            : entry),
                                        }))}
                                      />
                                      <span>
                                        {returnDraft.restockSource === 'none'
                                          ? 'Без возврата в остатки'
                                          : item.sourceType === 'workshop' && returnDraft.restockSource === 'boutique'
                                            ? 'Цех → Бутик нельзя'
                                            : item.restock
                                              ? item.sourceType === 'workshop' ? 'Принять на Склад' : 'Вернуть в остаток'
                                              : 'Не возвращать в остаток'}
                                      </span>
                                    </label>
                                  </td>
'''
new_product_cell = r'''                                  <td>
                                    <div>{item.productName}</div>
                                    <span className="muted-small">{item.sourceType === 'workshop' ? 'Позиция из Цеха' : item.sourceType === 'boutique' ? 'Была из Бутика' : 'Была со Склада'}</span>
                                  </td>
'''
if texts['returns'].count(old_product_cell) != 1:
    raise SystemExit(f'return product cell anchor count={texts["returns"].count(old_product_cell)}')
texts['returns'] = texts['returns'].replace(old_product_cell, new_product_cell, 1)
quantity_cell = r'''                                  <td>
                                    <FriendlyNumberInput
                                      type="number"
                                      min="0"
                                      max={item.maxQuantity}
                                      value={item.quantity}
                                      onChange={(event) => setReturnDraft((current) => {
                                        const nextItems = current.items.map((entry, itemIndex) => itemIndex === index
                                          ? { ...entry, quantity: Math.min(entry.maxQuantity, Math.max(0, Number(event.target.value || 0))) }
                                          : entry)
                                        return { ...current, items: nextItems }
                                      })}
                                    />
                                  </td>
'''
physical_cell = quantity_cell + r'''                                  <td>
                                    <select
                                      value={item.physicalState}
                                      disabled={Number(item.quantity || 0) <= 0}
                                      onChange={(event) => {
                                        const physicalState = event.target.value as 'pending' | 'warehouse' | 'boutique' | 'no_stock'
                                        setReturnDraft((current) => ({
                                          ...current,
                                          items: current.items.map((entry, itemIndex) => itemIndex === index
                                            ? { ...entry, physicalState, restock: physicalState === 'warehouse' || physicalState === 'boutique' }
                                            : entry),
                                        }))
                                      }}
                                    >
                                      <option value="pending">Ещё не пришёл</option>
                                      <option value="warehouse">Пришёл → Склад</option>
                                      {item.sourceType !== 'workshop' ? <option value="boutique">Пришёл → Бутик</option> : null}
                                      <option value="no_stock">Пришёл, в остаток не добавлять</option>
                                    </select>
                                  </td>
'''
if texts['returns'].count(quantity_cell) != 1:
    raise SystemExit(f'return quantity cell anchor count={texts["returns"].count(quantity_cell)}')
texts['returns'] = texts['returns'].replace(quantity_cell, physical_cell, 1)
texts['returns'] = texts['returns'].replace('<tr><td colSpan={3} className="empty-state">У заказа нет позиций для возврата.</td></tr>', '<tr><td colSpan={4} className="empty-state">У заказа нет позиций для возврата.</td></tr>', 1)

# Return history: explicit physical status + compact receive action.
old_return_history_status = r'''                                {entry.operationType === 'order_return' ? <em>{item.lifecycleStatus === 'pending' ? `Ожидает приёма: ${inventorySourceLabel(item.inventorySource)}` : item.lifecycleStatus === 'cancelled' ? 'Приём в остаток отменён' : item.restocked ? `Возвращён: ${inventorySourceLabel(item.inventorySource)}` : 'Не возвращён в остатки'}</em> : null}
'''
new_return_history_status = r'''                                {entry.operationType === 'order_return' ? <em>{returnPhysicalStatus(item)}</em> : null}
                                {entry.operationType === 'order_return' && entry.status !== 'cancelled' && item.physicalTracking && !item.physicalReceivedAt ? (
                                  <div className="mini-panel-actions">
                                    <select
                                      value={receiptDestinations[`return:${entry.id}:${item.id}`] || 'warehouse'}
                                      onChange={(event) => setReceiptDestinations((current) => ({ ...current, [`return:${entry.id}:${item.id}`]: event.target.value as 'warehouse' | 'boutique' | 'no_stock' }))}
                                      disabled={returnBusy}
                                    >
                                      <option value="warehouse">Склад</option>
                                      {!item.isWorkshop ? <option value="boutique">Бутик</option> : null}
                                      <option value="no_stock">Без добавления в остаток</option>
                                    </select>
                                    <button
                                      className="primary compact"
                                      type="button"
                                      disabled={returnBusy}
                                      onClick={() => void receiveReturnedItemAction({
                                        operationType: 'return',
                                        operationId: entry.id,
                                        operationItemId: item.id,
                                        destination: receiptDestinations[`return:${entry.id}:${item.id}`] || 'warehouse',
                                        productName: item.productName,
                                        externalId: entry.externalId,
                                      })}
                                    >
                                      Товар пришёл
                                    </button>
                                  </div>
                                ) : null}
'''
if texts['returns'].count(old_return_history_status) != 1:
    raise SystemExit(f'return history status anchor count={texts["returns"].count(old_return_history_status)}')
texts['returns'] = texts['returns'].replace(old_return_history_status, new_return_history_status, 1)

# Exchange section: one explicit state for the old physical item.
rep('exchange',
"""    orderPanelStyle,
    saveExchange,
""",
"""    orderPanelStyle,
    receiveReturnedItemAction,
    saveExchange,
""", 'exchange callback destructure')
rep('exchange',
"""  const [financialCorrection, setFinancialCorrection] = useState<any>(null)
""",
"""  const [financialCorrection, setFinancialCorrection] = useState<any>(null)
  const [receiptDestinations, setReceiptDestinations] = useState<Record<string, 'warehouse' | 'boutique' | 'no_stock'>>({})
""", 'exchange receipt state')
rep('exchange',
"""  const oldReturnLabel = (source: string, lifecycleStatus?: string | null) => {
    if (source !== 'warehouse' && source !== 'boutique') return 'Не возвращён в остатки'
    const destination = source === 'warehouse' ? 'склад' : 'бутик'
    if (lifecycleStatus === 'pending') return `Ожидает приёма: ${destination}`
    if (lifecycleStatus === 'cancelled') return 'Приём старой вещи отменён'
    return `Возвращён: ${destination}`
  }
""",
"""  const oldReturnLabel = (entry: any) => {
    if (!entry.oldPhysicalTracking) return 'Старая запись — физическое получение не отслеживалось'
    if (!entry.oldPhysicalReceivedAt) return 'Ещё не пришла'
    if (entry.oldReturnSource !== 'warehouse' && entry.oldReturnSource !== 'boutique') return 'Получена, в остаток не добавляли'
    const destination = entry.oldReturnSource === 'warehouse' ? 'Склад' : 'Бутик'
    if (entry.oldLifecycleStatus === 'pending') return `Получена → ${destination}; остаток требует уточнения`
    if (entry.oldLifecycleStatus === 'cancelled') return `Получена; проведение в ${destination} отменено`
    return `Получена → ${destination}`
  }
""", 'exchange physical status helper')
rep('exchange',
"""              <div className="card-meta">Обмен открывается из главной таблицы заказов или из активного цеха. По умолчанию старая вещь не возвращается на склад — менеджер выбирает это вручную.</div>
""",
"""              <div className="card-meta">Обмен открывается из главной таблицы заказов или из активного цеха. Для старой вещи отдельно укажите: она ещё едет или уже физически пришла.</div>
""", 'exchange card copy')
rep('exchange',
"""                                  oldQuantity: 1,
                                  oldReturnSource: selectedItem?.sourceType === 'workshop' && current.oldReturnSource === 'boutique' ? 'none' : current.oldReturnSource,
                                  newSourceWasManuallyChanged: false,
""",
"""                                  oldQuantity: 1,
                                  oldReturnSource: 'none',
                                  oldPhysicalState: selectedItem?.sourceType === 'workshop' && current.oldPhysicalState === 'boutique' ? 'pending' : current.oldPhysicalState,
                                  newSourceWasManuallyChanged: false,
""", 'exchange old item change physical reset')
old_exchange_destination = r'''                          <label>
                            <span>Куда вернуть старую вещь</span>
                            <select
                              value={exchangeDraft.oldReturnSource}
                              onChange={(event) => setExchangeDraft((current) => ({ ...current, oldReturnSource: event.target.value as ExchangeDraft['oldReturnSource'] }))}
                            >
                              <option value="warehouse">Склад</option>
                              {!effectiveOldItemIsWorkshop ? <option value="boutique">Бутик</option> : null}
                              <option value="none">Не возвращать в остатки</option>
                            </select>
                            {effectiveOldItemIsWorkshop ? <small className="field-hint">Вещь из Цеха не попадает в остатки автоматически. Выберите Склад только если возвращённую клиентом вещь действительно решили оставить на Складе.</small> : null}
                          </label>
'''
new_exchange_destination = r'''                          <label>
                            <span>Старая вещь сейчас</span>
                            <select
                              value={exchangeDraft.oldPhysicalState}
                              onChange={(event) => {
                                const oldPhysicalState = event.target.value as 'pending' | 'warehouse' | 'boutique' | 'no_stock'
                                setExchangeDraft((current) => ({
                                  ...current,
                                  oldPhysicalState,
                                  oldReturnSource: oldPhysicalState === 'warehouse' || oldPhysicalState === 'boutique' ? oldPhysicalState : 'none',
                                }))
                              }}
                            >
                              <option value="pending">Ещё не пришла</option>
                              <option value="warehouse">Пришла → Склад</option>
                              {!effectiveOldItemIsWorkshop ? <option value="boutique">Пришла → Бутик</option> : null}
                              <option value="no_stock">Пришла, в остаток не добавлять</option>
                            </select>
                            {effectiveOldItemIsWorkshop ? <small className="field-hint">Для вещи из Цеха Бутик недоступен. Если вещь ещё едет, оставьте «Ещё не пришла».</small> : null}
                          </label>
'''
if texts['exchange'].count(old_exchange_destination) != 1:
    raise SystemExit(f'exchange destination anchor count={texts["exchange"].count(old_exchange_destination)}')
texts['exchange'] = texts['exchange'].replace(old_exchange_destination, new_exchange_destination, 1)

old_exchange_history_card = r'''                            <div className="history-product-card"><span>Вернули</span><strong>{entry.oldProductName} × {entry.oldQuantity}</strong><em>{formatHistoryCharacteristics(entry, 'old')}</em><b>{oldReturnLabel(entry.oldReturnSource, entry.oldLifecycleStatus)}</b></div>
'''
new_exchange_history_card = r'''                            <div className="history-product-card">
                              <span>Вернули</span><strong>{entry.oldProductName} × {entry.oldQuantity}</strong><em>{formatHistoryCharacteristics(entry, 'old')}</em><b>{oldReturnLabel(entry)}</b>
                              {entry.status !== 'cancelled' && entry.oldPhysicalTracking && !entry.oldPhysicalReceivedAt && entry.oldOperationItemId ? (
                                <div className="mini-panel-actions">
                                  <select
                                    value={receiptDestinations[`exchange:${entry.id}:${entry.oldOperationItemId}`] || 'warehouse'}
                                    onChange={(event) => setReceiptDestinations((current) => ({ ...current, [`exchange:${entry.id}:${entry.oldOperationItemId}`]: event.target.value as 'warehouse' | 'boutique' | 'no_stock' }))}
                                    disabled={exchangeBusy}
                                  >
                                    <option value="warehouse">Склад</option>
                                    {!entry.oldIsWorkshop ? <option value="boutique">Бутик</option> : null}
                                    <option value="no_stock">Без добавления в остаток</option>
                                  </select>
                                  <button
                                    className="primary compact"
                                    type="button"
                                    disabled={exchangeBusy}
                                    onClick={() => void receiveReturnedItemAction({
                                      operationType: 'exchange',
                                      operationId: entry.id,
                                      operationItemId: entry.oldOperationItemId,
                                      destination: receiptDestinations[`exchange:${entry.id}:${entry.oldOperationItemId}`] || 'warehouse',
                                      productName: entry.oldProductName,
                                      externalId: entry.externalId,
                                    })}
                                  >
                                    Товар пришёл
                                  </button>
                                </div>
                              ) : null}
                            </div>
'''
if texts['exchange'].count(old_exchange_history_card) != 1:
    raise SystemExit(f'exchange history old card anchor count={texts["exchange"].count(old_exchange_history_card)}')
texts['exchange'] = texts['exchange'].replace(old_exchange_history_card, new_exchange_history_card, 1)

for key, path in files.items():
    path.write_text(texts[key])
print('physical receipt UI workflow patched')
