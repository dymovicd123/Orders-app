import { useState } from 'react'
import { UnitBarcodePreparation } from './UnitBarcodePreparation'
import type { ExchangeHistoryEntry, ReturnHistoryEntry } from '../../../app/types'
import { pendingReturnPhysicalItems, pendingExchangePhysicalItems, type PendingPhysicalItem, type ReceivingInbox, type ReceivingKind, type ReceivingDestination, type ReceivePhysicalItem } from './warehouseReceivingModel'
import './warehouseReceiving.css'

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
  const [receivedForLabels, setReceivedForLabels] = useState<{
    key: string; variantId: number; productName: string; variantLabel: string;
    source: 'warehouse' | 'boutique'; quantity: number
  } | null>(null)

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
    setReceivedForLabels(null)
    setReceivingKey(item.key)
    try {
      const accepted = await receiveItem({
        operationType: item.kind,
        operationId: item.operationId,
        operationItemId: item.operationItemId,
        destination: destinations[item.key] || item.defaultDestination,
        productName: item.productName,
        externalId: item.externalId,
        onBarcodePreparationReady: details => setReceivedForLabels({
          key: item.key, productName: item.productName,
          variantLabel: item.characteristics, ...details,
        }),
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
          className={mode === 'return' ? 'is-active' : ''} onClick={() => { setFeedback(''); setReceivedForLabels(null); onModeChange('return') }}>
          Возвраты {returnInbox.pendingQuantity > 0 ? <b>{returnInbox.pendingQuantity}</b> : null}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'exchange'} aria-controls="warehouse-receiving-list"
          className={mode === 'exchange' ? 'is-active' : ''} onClick={() => { setFeedback(''); setReceivedForLabels(null); onModeChange('exchange') }}>
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
        {receivedForLabels ? <div className="warehouse-receiving-label-next" role="region" aria-label="Маркировка после приёмки">
          <div><strong>Товар принят в остаток</strong>
            <p>Теперь можно подготовить индивидуальные этикетки для «{receivedForLabels.productName}».
              Это не новый приход: количество в остатке повторно не увеличится.
              Для цеховых вещей маркировка здесь не предлагается.</p>
          </div>
          <UnitBarcodePreparation key={receivedForLabels.key + ':' + receivedForLabels.variantId}
            variantId={receivedForLabels.variantId} productName={receivedForLabels.productName}
            variantLabel={receivedForLabels.variantLabel}
            initialSource={receivedForLabels.source} initialQuantity={receivedForLabels.quantity}
            buttonLabel="Подготовить этикетки" />
        </div> : null}
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
