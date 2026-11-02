import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WatchBrand } from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import '../../styles/client3-watch-logistics.css'

export type WatchLogisticsRow = {
  orderId: number
  externalId: string
  brand: WatchBrand
  legacySource: 'warehouse' | 'boutique'
  shippingStatus: string
  recipientName: string
  recipientPhone: string
  address: string
  postalCode: string
  city: string
  deliveryMethod: string
  urgent: number
  shippingDeadlineAt: string
  deadlineTimezone: string
  engravingStatus: 'pending' | 'engraving' | 'ready'
  readyAt: string | null
  orderItemId: number | null
  quantity: number | null
  reservationStatus: string | null
  modelName: string | null
  engravingText: string | null
  gender: string | null
  movement: string | null
  braceletMaterial: string | null
  dialColor: string | null
  braceletColor: string | null
}

type Props = {
  brand: WatchBrand | 'all'
  canCompleteEngraving: boolean
}

type LogisticsResponse = { ok: boolean; rows?: WatchLogisticsRow[]; message?: string }
type LogisticsGroup = { order: WatchLogisticsRow; items: WatchLogisticsRow[] }

async function readApi<T extends { ok: boolean; message?: string }>(
  path: string, options?: RequestInit,
): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...options })
  const data = await response.json() as T
  if (!response.ok || !data.ok) throw new Error(data.message || 'Запрос не выполнен (' + response.status + ')')
  return data
}

export function groupWatchLogistics(rows: readonly WatchLogisticsRow[]): LogisticsGroup[] {
  const map = new Map<number, LogisticsGroup>()
  for (const row of rows) {
    let group = map.get(row.orderId)
    if (!group) {
      group = { order: row, items: [] }
      map.set(row.orderId, group)
    }
    if (row.orderItemId != null) group.items.push(row)
  }
  return Array.from(map.values())
}

export function formatWatchDeadline(utc: string): string {
  const value = new Date(utc)
  if (!Number.isFinite(value.getTime())) return 'Некорректный срок'
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(value)
}

function statusText(status: WatchLogisticsRow['engravingStatus']) {
  if (status === 'ready') return 'Гравировка готова'
  if (status === 'engraving') return 'Гравировка в работе'
  return 'Ожидает гравировки'
}

/**
 * Logistics is engraving preparation only. The ready button NEVER calls the
 * shipping, reservation, cash or workshop salary routes.
 */
export function WatchLogisticsPanel({ brand, canCompleteEngraving }: Props) {
  const [rows, setRows] = useState<WatchLogisticsRow[]>([])
  const [filter, setFilter] = useState<'pending' | 'engraving' | 'ready' | 'all'>('all')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<number | null>(null)
  const [expanded,setExpanded]=useState<number|null>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  // Retain the same idempotency key across a failed/ambiguous network retry.
  const requestIds = useRef<Record<number, string>>({})
  const groups = useMemo(() => groupWatchLogistics(rows), [rows])

  useEffect(() => {
    const controller = new AbortController()
    setBusy(true)
    setRows([])
    setError('')
    const params = new URLSearchParams({ status: filter })
    if (brand !== 'all') params.set('brand', brand)
    void readApi<LogisticsResponse>('/api/client3/watches/logistics?' + params.toString(), {
      signal: controller.signal,
    }).then(data => {
      if (!controller.signal.aborted) setRows(data.rows || [])
    }).catch(reason => {
      if (!controller.signal.aborted) {
        setRows([])
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить логистику')
      }
    }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [brand, filter, refreshKey])

  const complete = useCallback(async (orderId: number) => {
    if (!canCompleteEngraving || saving !== null) return
    setSaving(orderId)
    setError('')
    setFeedback('')
    const requestId = requestIds.current[orderId] ||= 'watch-' + crypto.randomUUID()
    try {
      await readApi<{ok: boolean; message?: string}>(
        '/api/client3/watches/logistics/' + orderId + '/ready', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId }),
        },
      )
      delete requestIds.current[orderId]
      setFeedback('Гравировка по заказу завершена. Отправка и склад не изменены.')
      setRefreshKey(value => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отметить готовность')
    } finally {
      setSaving(null)
    }
  }, [canCompleteEngraving, saving])

  return <section className="watch-logistics">
    <div className="watch-logistics-heading">
      <div>
        <h2>Логистика</h2>
        <p>Гравировка и подготовка отправлений. «Готово» не отправляет товар и не изменяет кассу.</p>
      </div>
      <div className="watch-logistics-controls">
        <label>Статус
          <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
            <option value="all">Все</option>
            <option value="pending">Ожидает</option>
            <option value="engraving">В работе</option>
            <option value="ready">Готово</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => setRefreshKey(value => value + 1)}>Обновить</button>
      </div>
    </div>
    {error && <p role="alert" className="watch-logistics-error">{error}</p>}
    {feedback && <p role="status" className="watch-logistics-feedback">{feedback}</p>}
    {busy && <p role="status">Загрузка логистики…</p>}
    {!busy && !error && groups.length === 0 && <p>В выбранной очереди заказов нет.</p>}
    <LinkedTableScroll className="watch-main-logistics-scroll" ariaLabel="Очередь логистики">
      <table className="watch-main-logistics-table">
        <thead><tr>
          <th>Заказ</th><th>Бренд / источник</th><th>Получатель</th>
          <th>Отправить до</th><th>Гравировка</th><th>Товаров</th><th>Действие</th>
        </tr></thead>
        <tbody>{groups.map(({order,items})=>{
          const overdue=order.engravingStatus!=='ready'&&order.shippingStatus!=='sent'&&order.shippingStatus!=='Отправлено'&&
            Number.isFinite(Date.parse(order.shippingDeadlineAt))&&Date.parse(order.shippingDeadlineAt)<Date.now()
          return <Fragment key={order.orderId}>
            <tr className={'watch-main-logistics-row'+(expanded===order.orderId?' is-open':'')}>
              <td><strong>{order.externalId||'#'+order.orderId}</strong>
                {Boolean(order.urgent)&&<small className="watch-logistics-urgent">Срочно</small>}</td>
              <td>{order.brand}<small>{order.legacySource==='boutique'?'Витрина':'Офис'}</small></td>
              <td><strong>{order.recipientName}</strong><small>{order.recipientPhone}</small></td>
              <td>{formatWatchDeadline(order.shippingDeadlineAt)}
                {overdue&&<small className="watch-logistics-urgent">Срок прошёл</small>}</td>
              <td><span className={'watch-logistics-status '+(order.engravingStatus==='ready'?'is-ready':'')}>
                {statusText(order.engravingStatus)}</span></td>
              <td>{items.length}</td>
              <td><button type="button" className="secondary compact" aria-expanded={expanded===order.orderId}
                onClick={()=>setExpanded(v=>v===order.orderId?null:order.orderId)}>
                {expanded===order.orderId?'Скрыть':'Открыть'}</button></td>
            </tr>
            {expanded===order.orderId&&<tr className="watch-main-logistics-expanded"><td colSpan={7}>
              <section className="watch-main-logistics-detail">
                <div className="watch-main-logistics-detail-head">
                  <div><small>Получатель и адрес</small><strong>{order.recipientName} · {order.recipientPhone}</strong>
                    <span>{order.city}, {order.postalCode} · {order.address}</span></div>
                  <div><small>Доставка</small><strong>{order.deliveryMethod}</strong>
                    <span>{order.shippingStatus==='sent'||order.shippingStatus==='Отправлено'?'Уже отправлен':'Не отправлен'}</span></div>
                </div>
                <div className="watch-main-logistics-items">
                  {items.map(item=><div key={item.orderItemId} className="watch-main-logistics-item">
                    <div><strong>{item.modelName||'Модель не определена'} · {item.quantity||0} шт.</strong>
                      <small>{[item.movement,item.braceletMaterial,item.dialColor,item.braceletColor].filter(Boolean).join(' · ')}</small></div>
                    <div><small>Текст гравировки</small><strong>{item.engravingText||'Не указан'}</strong></div>
                    <div><small>Резерв</small><strong>{item.reservationStatus==='active'?'Подтверждён':item.reservationStatus==='fulfilled'?'Выдан':'Требует проверки'}</strong></div>
                  </div>)}
                </div>
                <div className="watch-logistics-actions">
                  {order.engravingStatus==='ready'?<span>Гравировка завершена</span>:
                    canCompleteEngraving?<button type="button" disabled={saving!==null}
                      onClick={()=>void complete(order.orderId)}>
                      {saving===order.orderId?'Сохраняю…':'Готово · гравировка'}
                    </button>:<span>Завершить может логист или администратор.</span>}
                </div>
              </section>
            </td></tr>}
          </Fragment>
        })}</tbody>
      </table>
    </LinkedTableScroll>
  </section>
}