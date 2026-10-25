import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../../styles/city-orders-explorer.css'

type CitySummary = {
  city: string
  order_count: number
  total_sales: number
  total_received: number
  total_debt: number
  clients: number
  managers: number
}

type CityOrder = {
  id: number
  externalId: string
  orderDate: string
  customer: string
  manager: string
  totalAmount: number
  receivedAmount: number
  debtAmount: number
  shippingStatus: string
  orderStatus: string
}

function orderStatus(order: CityOrder) {
  if (order.orderStatus === 'archived') return 'В архиве'
  if (order.shippingStatus === 'sent') return 'Отправлен'
  if (order.shippingStatus === 'not_sent') return 'Не отправлен'
  return 'Без статуса'
}

export function CityOrdersExplorer({ rows, apiFetch, onOpenOrder, startDate, endDate, formatDateShort, formatMoney }: {
  rows: CitySummary[]
  apiFetch: (url: string) => Promise<Response>
  onOpenOrder: (order: { orderId: number; externalId: string; orderDate: string }) => Promise<unknown> | void
  startDate: string
  endDate: string
  formatDateShort: (date: string) => string
  formatMoney: (amount: number) => string
}) {
  const [selected, setSelected] = useState<CitySummary | null>(null)
  const [orders, setOrders] = useState<CityOrder[]>([])
  const [busy, setBusy] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  function close() {
    sequence.current += 1
    setSelected(null)
    setOrders([])
    setHasMore(false)
    setError('')
    setBusy(false)
  }

  useEffect(() => { close() }, [startDate, endDate])
  useEffect(() => {
    if (!selected) return
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected])

  async function fetchOrders(city: string, offset: number) {
    const current = ++sequence.current
    setBusy(true)
    setError('')
    try {
      const params = new URLSearchParams({ city, startDate, endDate, offset: String(offset), limit: '25' })
      const response = await apiFetch(`/api/reports/city-orders?${params.toString()}`)
      const data = await response.json() as { ok?: boolean; message?: string; orders?: CityOrder[]; hasMore?: boolean }
      if (!response.ok || !data.ok) throw new Error(data.message || 'Не удалось загрузить заказы.')
      if (current !== sequence.current) return
      setOrders(previous => offset ? [...previous, ...(data.orders || [])] : (data.orders || []))
      setHasMore(Boolean(data.hasMore))
    } catch (reason) {
      if (current === sequence.current) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить заказы.')
    } finally {
      if (current === sequence.current) setBusy(false)
    }
  }

  function open(row: CitySummary) {
    setSelected(row)
    setOrders([])
    setHasMore(false)
    void fetchOrders(row.city, 0)
  }

  function openOrder(order: CityOrder) {
    close()
    void onOpenOrder({ orderId: order.id, externalId: order.externalId, orderDate: order.orderDate })
  }

  return <>
    <section className="report-table-card">
      <div className="strict-section-head"><h3>Все города</h3><span className="soft-badge">итог за период</span></div>
      <div className="table-shell"><table className="data-table strict-report-table">
        <thead><tr><th>Город</th><th className="num">Заказов</th><th className="num">Сумма</th><th className="num">Получено</th><th className="num">Долг</th><th className="num">Клиентов</th><th className="num">Менеджеров</th><th className="num">Средний чек</th></tr></thead>
        <tbody>
          {rows.map(row => <tr key={`city-total-${row.city}`}>
            <td><span className="city-report-export-label">{row.city}</span><button className="city-report-city-link" type="button" aria-label={`Заказы города: ${row.city}`} title="Посмотреть заказы" onClick={() => open(row)}>{row.city}</button></td>
            <td className="num">{row.order_count}</td><td className="num">{formatMoney(row.total_sales)}</td><td className="num">{formatMoney(row.total_received)}</td><td className="num">{formatMoney(row.total_debt)}</td><td className="num">{row.clients}</td><td className="num">{row.managers}</td>
            <td className="num">{formatMoney(row.order_count ? Number(row.total_sales || 0) / Number(row.order_count || 1) : 0)}</td>
          </tr>)}
          {!rows.length ? <tr><td colSpan={8} className="empty-state">Нет городов за период.</td></tr> : null}
        </tbody>
      </table></div>
    </section>
    {selected && createPortal(
      <div className="city-orders-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
        <section className="city-orders-dialog" role="dialog" aria-modal="true" aria-label={`Заказы: ${selected.city}`}>
          <header className="city-orders-dialog-header">
            <div className="city-orders-dialog-title">
              <h2>{selected.city === 'Не указан' ? 'Заказы без города' : `Заказы · ${selected.city}`}</h2>
              <p>{formatDateShort(startDate)} — {formatDateShort(endDate)}</p>
            </div>
            <button ref={closeRef} type="button" className="city-orders-close" aria-label="Закрыть список заказов" onClick={close}>×</button>
          </header>
          <div className="city-orders-summary">
            <strong>{selected.order_count} заказов</strong>
            <span>Показано {orders.length}{hasMore ? ` из ${selected.order_count}` : ''}</span>
          </div>
          <p className="city-orders-hint">Поступления в отчёте считаются по дате оплаты, а не заказа.</p>
          {error ? <div role="alert" className="city-orders-error">{error}<button type="button" onClick={() => void fetchOrders(selected.city, orders.length)}>Повторить</button></div> : null}
          <div className="city-orders-list">
            {orders.map(order => <article className="city-order-card" key={order.id}>
              <div className="city-order-heading">
                <div className="city-order-number"><strong>Заказ №{order.id}</strong><span title={order.externalId}>{order.externalId ? `…${order.externalId.slice(-8)}` : '—'}</span></div>
                <span className="city-order-date">{formatDateShort(order.orderDate)}</span>
                <span className={`city-order-status ${order.shippingStatus === 'sent' ? 'is-sent' : ''}`}>{orderStatus(order)}</span>
              </div>
              <div className="city-order-main">
                <div className="city-order-person"><strong>{order.customer || 'Клиент не указан'}</strong><span>Менеджер: {order.manager || '—'}</span></div>
                <div className="city-order-money"><div><span>Сумма</span><strong>{formatMoney(order.totalAmount)}</strong></div><div><span>Получено</span><strong>{formatMoney(order.receivedAmount)}</strong></div><div><span>Долг</span><strong>{formatMoney(order.debtAmount)}</strong></div></div>
                <button type="button" className="city-order-open" onClick={() => openOrder(order)}>Открыть заказ</button>
              </div>
            </article>)}
            {!orders.length && !busy && !error ? <p className="city-orders-empty">Заказов за этот период нет.</p> : null}
          </div>
          {busy ? <p className="city-orders-loading" role="status">Загружаем заказы…</p> : null}
          {hasMore && !busy ? <div className="city-orders-footer"><button type="button" onClick={() => void fetchOrders(selected.city, orders.length)}>Показать ещё 25</button></div> : null}
        </section>
      </div>, document.body
    )}
  </>
}
