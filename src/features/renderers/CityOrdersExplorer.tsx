
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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

export function CityOrdersExplorer({ rows, apiFetch, startDate, endDate, formatDateShort, formatMoney }: {
  rows: CitySummary[]
  apiFetch: (url: string) => Promise<Response>
  startDate: string
  endDate: string
  formatDateShort: (value: string) => string
  formatMoney: (value: number) => string
}) {
  const [selected, setSelected] = useState<CitySummary | null>(null)
  const [orders, setOrders] = useState<CityOrder[]>([])
  const [busy, setBusy] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)

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
      setOrders((previous) => offset ? [...previous, ...(data.orders || [])] : (data.orders || []))
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

  return <>
    <section className="report-table-card">
      <div className="strict-section-head"><h3>Все города</h3><span className="soft-badge">итог за период</span></div>
      <div className="table-shell"><table className="data-table strict-report-table">
        <thead><tr><th>Город</th><th className="num">Заказов</th><th className="num">Сумма</th><th className="num">Получено</th><th className="num">Долг</th><th className="num">Клиентов</th><th className="num">Менеджеров</th><th className="num">Средний чек</th></tr></thead>
        <tbody>
          {rows.map((row) => <tr key={`city-total-${row.city}`}>
            <td><span>{row.city}</span> <button className="secondary compact" type="button" aria-label={`Посмотреть заказы: ${row.city}`} onClick={() => open(row)}>Заказы</button></td>
            <td className="num">{row.order_count}</td><td className="num">{formatMoney(row.total_sales)}</td><td className="num">{formatMoney(row.total_received)}</td><td className="num">{formatMoney(row.total_debt)}</td><td className="num">{row.clients}</td><td className="num">{row.managers}</td>
            <td className="num">{formatMoney(row.order_count ? Number(row.total_sales || 0) / Number(row.order_count || 1) : 0)}</td>
          </tr>)}
          {!rows.length ? <tr><td colSpan={8} className="empty-state">Нет городов за период.</td></tr> : null}
        </tbody>
      </table></div>
    </section>
    {selected && createPortal(
      <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }} style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'grid', placeItems: 'center', padding: 12, background: 'rgba(15,23,42,.54)' }}>
        <section role="dialog" aria-modal="true" aria-label={`Заказы: ${selected.city}`} style={{ borderRadius: 12, padding: 18, background: '#fff', color: '#0f172a', width: 'min(1050px,100%)', maxHeight: '92vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div><h3 style={{ margin: 0 }}>Заказы: {selected.city}</h3><p style={{ margin: '4px 0 12px' }}>{formatDateShort(startDate)} — {formatDateShort(endDate)} · в отчёте {selected.order_count} · загружено {orders.length}</p></div>
            <button className="secondary compact" type="button" onClick={close}>Закрыть</button>
          </div>
          <p className="strict-report-note">Продажи считаются по дате заказа. В отчёте «Получено» относится к фактической дате оплаты и может отличаться от сумм этих заказов.</p>
          {error ? <p role="alert">{error} <button className="secondary compact" type="button" onClick={() => void fetchOrders(selected.city, orders.length)}>Повторить</button></p> : null}
          <div className="table-shell"><table className="data-table strict-report-table">
            <thead><tr><th>Заказ</th><th>Дата</th><th>Клиент</th><th>Менеджер</th><th className="num">Сумма</th><th className="num">Получено по заказу</th><th className="num">Долг</th><th>Статус</th></tr></thead>
            <tbody>
              {orders.map((order) => <tr key={order.id}><td>{order.externalId || `#${order.id}`}</td><td>{formatDateShort(order.orderDate)}</td><td>{order.customer}</td><td>{order.manager}</td><td className="num">{formatMoney(order.totalAmount)}</td><td className="num">{formatMoney(order.receivedAmount)}</td><td className="num">{formatMoney(order.debtAmount)}</td><td>{order.shippingStatus || order.orderStatus || '—'}</td></tr>)}
              {!orders.length && !busy && !error ? <tr><td colSpan={8} className="empty-state">Заказов нет.</td></tr> : null}
            </tbody>
          </table></div>
          {busy ? <p role="status">Загружаем заказы…</p> : null}
          {hasMore && !busy ? <div className="button-row"><button className="secondary" type="button" onClick={() => void fetchOrders(selected.city, orders.length)}>Показать ещё 25</button></div> : null}
        </section>
      </div>, document.body
    )}
  </>
}
