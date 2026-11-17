import { useState } from 'react'
import type { ExchangeHistoryEntry, ExchangeHistoryItem, ReturnHistoryEntry, ReturnHistoryItem } from '../../../app/types'
import './warehouseReceiving.css'

export type ReceivingKind = 'return' | 'exchange'
export type ReceivingDestination = 'warehouse' | 'boutique' | 'no_stock'
export type ReceivingInbox<T> = {
  rows: T[]
  pendingQuantity: number
  hasMore: boolean
  busy: boolean
  error: string
}
export type ReceivePhysicalItem = (input: {
  operationType: ReceivingKind
  operationId: number
  operationItemId: number
  destination: ReceivingDestination
  productName: string
  externalId: string
}) => Promise<boolean>

type PendingPhysicalItem = {
  key: string
  kind: ReceivingKind
  operationId: number
  operationItemId: number
  productName: string
  quantity: number
  externalId: string
  customer: string
  manager: string
  date: string
  city: string
  characteristics: string
  defaultDestination: ReceivingDestination
}

const characteristics = (values: {
  gender?: string | null
  color?: string | null
  material?: string | null
  length?: string | null
  size?: string | null
}) => [
  ['Пол', values.gender], ['Цвет', values.color], ['Материал', values.material],
  ['Длина', values.length], ['Размер', values.size],
].filter(([, v]) => String(v || '').trim())
  .map(([label, value]) => `${label}: ${String(value).trim()}`).join(' · ') || 'Характеристики не указаны'

function defaultDestination(sourceType?: string | null, isWorkshop?: boolean): ReceivingDestination {
  if (sourceType === 'workshop' || isWorkshop) return 'no_stock'
  if (sourceType === 'boutique') return 'boutique'
  return 'warehouse'
}

export function pendingReturnPhysicalItems(entries: ReturnHistoryEntry[]): PendingPhysicalItem[] {
  return entries.flatMap(entry => entry.operationType === 'order_return' && entry.status !== 'cancelled'
    ? (entry.items || []).filter(item => item.physicalTracking && !item.physicalReceivedAt && Number(item.id) > 0)
        .map((item: ReturnHistoryItem) => ({
          key: `return:${entry.id}:${item.id}`,
          kind: 'return' as const,
          operationId: entry.id,
          operationItemId: item.id,
          productName: item.productName,
          quantity: Number(item.quantity || 0),
          externalId: entry.externalId,
          customer: entry.customer || '',
          manager: entry.manager || '',
          date: entry.returnDate,
          city: entry.city || '',
          characteristics: characteristics(item),
          defaultDestination: defaultDestination(item.sourceType, item.isWorkshop),
        }))
    : [])
}

export function pendingExchangePhysicalItems(entries: ExchangeHistoryEntry[]): PendingPhysicalItem[] {
  return entries.flatMap(entry => {
    if (entry.status === 'cancelled') return []
    const oldItems = entry.oldItems || []
    // A set exchange can return multiple old pieces; never collapse it to one.
    const pending: Array<ExchangeHistoryItem | null> = oldItems.length
      ? oldItems.filter(item => item.physicalTracking && !item.physicalReceivedAt && Number(item.id) > 0)
      : entry.oldPhysicalTracking && !entry.oldPhysicalReceivedAt && Number(entry.oldOperationItemId) > 0
        ? [null] : []
    return pending.map(item => {
      const operationItemId = Number(item?.id || entry.oldOperationItemId)
      const oldItem = item || {
        productName: entry.oldProductName,
        quantity: entry.oldQuantity,
        gender: entry.oldGender,
        color: entry.oldColor,
        material: entry.oldMaterial,
        length: entry.oldLength,
        size: entry.oldSize,
        sourceType: entry.oldSourceType,
        isWorkshop: entry.oldIsWorkshop,
      }
      return {
        key: `exchange:${entry.id}:${operationItemId}`,
        kind: 'exchange' as const,
        operationId: entry.id,
        operationItemId,
        productName: oldItem.productName,
        quantity: Number(oldItem.quantity || 0),
        externalId: entry.externalId,
        customer: entry.customer || '',
        manager: entry.manager || '',
        date: entry.exchangeDate,
        city: '',
        characteristics: characteristics(oldItem),
        defaultDestination: defaultDestination(oldItem.sourceType, oldItem.isWorkshop),
      }
    })
  })
}

type Props = {
  mode: ReceivingKind
  onModeChange: (next: ReceivingKind) => void
  returnInbox: ReceivingInbox<ReturnHistoryEntry>
  exchangeInbox: ReceivingInbox<ExchangeHistoryEntry>
  loadReturns: (append?: boolean) => Promise<void>
  loadExchanges: (append?: boolean) => Promise<void>
  receiveItem: ReceivePhysicalItem
}

export function WarehouseReceivingWorkspace({
  mode, onModeChange, returnInbox, exchangeInbox, loadReturns, loadExchanges, receiveItem,
}: Props) {
  const [destinations, setDestinations] = useState<Record<string, ReceivingDestination>>({})
  const [receivingKey, setReceivingKey] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')

  const inbox = mode === 'return' ? returnInbox : exchangeInbox
  const items = mode === 'return'
    ? pendingReturnPhysicalItems(returnInbox.rows)
    : pendingExchangePhysicalItems(exchangeInbox.rows)
  const loadedQuantity = items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0)
  const total = Math.max(0, Number(returnInbox.pendingQuantity || 0))
    + Math.max(0, Number(exchangeInbox.pendingQuantity || 0))
  const isRefreshing = returnInbox.busy || exchangeInbox.busy

  const refreshAll = async () => {
    await Promise.allSettled([loadReturns(false), loadExchanges(false)])
  }
  const receive = async (item: PendingPhysicalItem) => {
    if (receivingKey || !item.operationItemId || item.quantity <= 0) return
    setFeedback('')
    setReceivingKey(item.key)
    try {
      const accepted = await receiveItem({
        operationType: item.kind,
        operationId: item.operationId,
        operationItemId: item.operationItemId,
        destination: destinations[item.key] || item.defaultDestination,
        productName: item.productName,
        externalId: item.externalId,
      })
      if (accepted) {
        setFeedback(`Приёмка «${item.productName}» зарегистрирована. Очередь обновлена.`)
        await refreshAll()
      } else {
        setFeedback('Приёмка не подтверждена. Проверьте сообщение об ошибке и повторите после уточнения.')
      }
    } finally {
      setReceivingKey(null)
    }
  }

  return (
    <div className="warehouse-receiving" id="warehouse-receiving">
      <div className="warehouse-receiving-header">
        <div>
          <span className="card-label">Физическое получение</span>
          <h2>Приёмка товаров</h2>
          <p>Здесь только вещи, ожидающие поступления от клиента после возврата или обмена.
            Оформление и финансовые операции остаются в разделе «Заказы».</p>
        </div>
        <div className="warehouse-receiving-summary">
          <span>Всего ожидают</span>
          <strong>{total} шт.</strong>
        </div>
      </div>
      <div className="warehouse-receiving-tabs" role="tablist" aria-label="Вид приёмки">
        <button type="button" role="tab" aria-selected={mode === 'return'} aria-controls="warehouse-receiving-list"
          className={mode === 'return' ? 'is-active' : ''} onClick={() => { setFeedback(''); onModeChange('return') }}>
          Возвраты {returnInbox.pendingQuantity > 0 ? <b>{returnInbox.pendingQuantity}</b> : null}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'exchange'} aria-controls="warehouse-receiving-list"
          className={mode === 'exchange' ? 'is-active' : ''} onClick={() => { setFeedback(''); onModeChange('exchange') }}>
          Обмены {exchangeInbox.pendingQuantity > 0 ? <b>{exchangeInbox.pendingQuantity}</b> : null}
        </button>
        <button type="button" className="warehouse-receiving-refresh secondary compact" onClick={() => void refreshAll()}
          disabled={isRefreshing || receivingKey !== null}>
          {isRefreshing ? 'Обновляю…' : 'Обновить очередь'}
        </button>
      </div>
      <div id="warehouse-receiving-list" role="tabpanel" className="warehouse-receiving-panel">
        <div className="warehouse-receiving-intro">
          <strong>{mode === 'return' ? 'Приёмка возвратов' : 'Приёмка вещей по обменам'}</strong>
          <p>Подтверждайте получение только после фактического поступления. До подтверждения остаток не увеличивается.
            Для каждой вещи укажите, куда она поступила.</p>
        </div>
        {feedback ? <p className="warehouse-receiving-feedback" role="status">{feedback}</p> : null}
        {inbox.error ? <div className="warehouse-receiving-error" role="alert">
          {inbox.error}
          <button type="button" className="secondary compact" onClick={() => void (mode === 'return' ? loadReturns(false) : loadExchanges(false))}>
            Повторить загрузку
          </button>
        </div> : null}
        {inbox.busy && !inbox.rows.length ? <div className="warehouse-receiving-loading" role="status">Загружаю ожидающие товары…</div> : null}
        {items.length ? <div className="warehouse-receiving-list">
          {items.map(item => {
            const destination = destinations[item.key] || item.defaultDestination
            const busy = receivingKey !== null || returnInbox.busy || exchangeInbox.busy
            return <article key={item.key} className="warehouse-receiving-card">
              <div className="warehouse-receiving-card-main">
                <div className="warehouse-receiving-product-line">
                  <strong>{item.productName} × {item.quantity}</strong>
                  <span className={`warehouse-receiving-operation is-${item.kind}`}>
                    {item.kind === 'return' ? `Возврат №${item.operationId}` : `Обмен №${item.operationId}`}
                  </span>
                </div>
                <div className="warehouse-receiving-context">
                  <div><small>Заказ</small><strong>{item.externalId}</strong></div>
                  <div><small>Клиент</small><strong>{item.customer || 'Не указан'}</strong></div>
                  <div><small>Менеджер</small><strong>{item.manager || 'Не указан'}</strong></div>
                  <div><small>Дата {item.kind === 'return' ? 'возврата' : 'обмена'}</small><strong>{item.date || '—'}</strong></div>
                  {item.city ? <div><small>Город</small><strong>{item.city}</strong></div> : null}
                </div>
                <p className="warehouse-receiving-characteristics">{item.characteristics}</p>
              </div>
              <div className="warehouse-receiving-actions">
                <label>
                  <span>Куда принять</span>
                  <select value={destination} disabled={busy}
                    onChange={event => setDestinations(current => ({ ...current,
                      [item.key]: event.target.value as ReceivingDestination }))}>
                    <option value="warehouse">Склад</option>
                    <option value="boutique">Бутик</option>
                    <option value="no_stock">Не добавлять в остаток</option>
                  </select>
                </label>
                <button type="button" className="primary" disabled={busy || item.quantity <= 0}
                  onClick={() => void receive(item)}>
                  {receivingKey === item.key ? 'Принимаю…' : 'Принять товар'}
                </button>
              </div>
            </article>
          })}
        </div> : !inbox.busy && !inbox.error && inbox.pendingQuantity === 0
          ? <div className="warehouse-receiving-empty">Сейчас нет вещей, ожидающих приёмки по {mode === 'return' ? 'возвратам' : 'обменам'}.</div>
          : null}
        {!items.length && !inbox.busy && !inbox.error && inbox.pendingQuantity > 0
          ? <div className="warehouse-receiving-empty">Позиции есть в очереди. Загрузите следующую страницу.</div> : null}
        {inbox.hasMore && loadedQuantity < Number(inbox.pendingQuantity || 0)
          ? <button type="button" className="secondary warehouse-receiving-more"
              disabled={inbox.busy || receivingKey !== null}
              onClick={() => void (mode === 'return' ? loadReturns(true) : loadExchanges(true))}>
              {inbox.busy ? 'Загружаю…' : 'Загрузить ещё ожидающие'}
            </button> : null}
      </div>
    </div>
  )
}
