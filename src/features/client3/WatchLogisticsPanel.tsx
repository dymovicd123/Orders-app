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
  stockWriteoffStatus: string | null
  shippedQuantity: number
  itemSource: 'warehouse' | 'boutique' | null
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
  allowedBrands?: readonly WatchBrand[]
  canCompleteEngraving: boolean
  canDispatch?: boolean
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

/** Main's operational workflow: engraving readiness and actual dispatch remain
 * separate confirmed actions; both use isolated brand-scoped Client3 routes. */
export function WatchLogisticsPanel({brand,allowedBrands=[],canCompleteEngraving,canDispatch=false}:Props) {
  const [brandScope,setBrandScope]=useState<WatchBrand|'all'>(brand)
  const [rows, setRows] = useState<WatchLogisticsRow[]>([])
  const [filter, setFilter] = useState<'pending'|'engraving'|'ready'|'unshipped'|'sent'|'all'>('unshipped')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<number | null>(null)
  const [dispatching,setDispatching]=useState<number|null>(null)
  const [dispatchConfirm,setDispatchConfirm]=useState<number|null>(null)
  const [dispatchSelection,setDispatchSelection]=useState<Record<number,number[]>>({})
  const [expanded,setExpanded]=useState<number|null>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  // Retain the same idempotency key across a failed/ambiguous network retry.
  const requestIds = useRef<Record<number, string>>({})
  const dispatchIds=useRef<Record<number,string>>({})
  const groups=useMemo(()=>groupWatchLogistics(rows).filter(({order})=>
    filter==='unshipped'?order.shippingStatus!=='sent'&&order.shippingStatus!=='Отправлено':
    filter==='sent'?order.shippingStatus==='sent'||order.shippingStatus==='Отправлено':true),[rows,filter])

  useEffect(() => {
    const controller = new AbortController()
    setBusy(true)
    setRows([])
    setError('')
    const params=new URLSearchParams({status:filter==='sent'||filter==='unshipped'?'all':filter})
    if(brandScope!=='all')params.set('brand',brandScope)
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
  }, [brandScope, filter, refreshKey])

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

  const setSelected=(orderId:number,itemId:number,enabled:boolean)=>{
    setDispatchConfirm(null)
    delete dispatchIds.current[orderId]
    setDispatchSelection(prev=>{
      const old=prev[orderId]||[]
      return {...prev,[orderId]:enabled?[...new Set([...old,itemId])]:old.filter(id=>id!==itemId)}
    })
  }
  const eligible=(order:WatchLogisticsRow,item:WatchLogisticsRow)=>Boolean(
    item.orderItemId&&Number(item.quantity)>0&&item.reservationStatus==='active'&&
    item.stockWriteoffStatus==='reserved'&&Number(item.shippedQuantity||0)===0&&
    (!item.engravingText?.trim()||order.engravingStatus==='ready'))
  const send=useCallback(async(order:WatchLogisticsRow,selected:WatchLogisticsRow[])=>{
    if(!canDispatch||dispatching!==null||dispatchConfirm!==order.orderId)return
    setDispatching(order.orderId);setError('');setFeedback('')
    const requestId=dispatchIds.current[order.orderId]||=
      'watch-send-'+crypto.randomUUID()
    try{
      await readApi<{ok:boolean;message?:string}>(
        '/api/client3/watches/orders/'+order.orderId+'/send',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({brand:order.brand,requestId,
            items:selected.map(row=>({orderItemId:row.orderItemId,quantity:row.quantity}))}),
        })
      delete dispatchIds.current[order.orderId]
      setDispatchConfirm(null)
      setDispatchSelection(prev=>({...prev,[order.orderId]:[]}))
      setFeedback('Выбранные часы отправлены. Остальные позиции и их резервы не затронуты.')
      setRefreshKey(value=>value+1)
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось подтвердить отправку')}
    finally{setDispatching(null)}
  },[canDispatch,dispatching,dispatchConfirm])
  return <section className="watch-logistics workshop-workspace">
    <div className="watch-logistics-heading">
      <div>
        <h2>Логистика</h2>
        <p>Выберите готовые позиции заказа. «Готово» завершает гравировку, а отправка списывает только выбранные часы.</p>
      </div>
      <div className="watch-logistics-controls">
        <label>Статус
          <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
            <option value="all">Все заказы</option>
            <option value="unshipped">К отправке</option>
            <option value="sent">Отправлены</option>
            <option value="pending">Ожидает</option>
            <option value="engraving">В работе</option>
            <option value="ready">Готово</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => setRefreshKey(value => value + 1)}>Обновить</button>
      </div>
    </div>
    {allowedBrands.length>1&&<div className="workshop-channel-tabs client3-logistics-brands"
        role="group" aria-label="Бренды логистики">
      {(['all',...allowedBrands] as const).map(code=><button key={code} type="button"
        className={'workshop-channel-tab '+(brandScope===code?'is-active':'')}
        aria-pressed={brandScope===code}
        onClick={()=>{setBrandScope(code);setExpanded(null);setDispatchConfirm(null)}}>
        <span>{code==='all'?'Все бренды':code}</span>
        <small>{code==='all'?'Общая очередь':'Отдельные заказы бренда'}</small>
      </button>)}
    </div>}
    {error && <p role="alert" className="watch-logistics-error">{error}</p>}
    {feedback && <p role="status" className="watch-logistics-feedback">{feedback}</p>}
    {busy && <p role="status">Загрузка логистики…</p>}
    {!busy && !error && groups.length === 0 && <p>В выбранной очереди заказов нет.</p>}
    <LinkedTableScroll className="watch-main-logistics-scroll" ariaLabel="Очередь логистики">
      <table className="data-table workshop-grid-table workshop-order-like-table watch-main-logistics-table">
        <thead><tr>
          <th>Заказ</th><th>Бренд / источник</th><th>Получатель</th>
          <th>Отправить до</th><th>Гравировка</th><th>Отправка</th><th>Поз.</th><th>Действие</th>
        </tr></thead>
        <tbody>{groups.map(({order,items})=>{
          const dispatched=items.filter(i=>Number(i.shippedQuantity||0)>0).length
          const shipStatus=order.shippingStatus==='sent'||order.shippingStatus==='Отправлено'
            ?'Отправлен':dispatched>0?'Частично отправлен':'Не отправлен'
          const selectable=items.filter(item=>eligible(order,item))
          const selectedIds=dispatchSelection[order.orderId]||[]
          const selected=selectable.filter(item=>item.orderItemId&&(
            selectedIds.includes(item.orderItemId)||
            (items.length===1&&dispatchSelection[order.orderId]===undefined)))
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
              <td><span className={'watch-main-logistics-send-status '+(order.shippingStatus==='sent'||order.shippingStatus==='Отправлено'?'is-sent':'is-awaiting')}>
                {shipStatus}</span></td>
              <td>{items.length}</td>
              <td><button type="button" className="secondary compact" aria-expanded={expanded===order.orderId}
                onClick={()=>setExpanded(v=>v===order.orderId?null:order.orderId)}>
                {expanded===order.orderId?'Скрыть':'Открыть'}</button></td>
            </tr>
            {expanded===order.orderId&&<tr className="watch-main-logistics-expanded"><td colSpan={8}>
              <section className="watch-main-logistics-detail">
                <div className="watch-main-logistics-detail-head">
                  <div><small>Получатель и адрес</small><strong>{order.recipientName} · {order.recipientPhone}</strong>
                    <span>{order.city}, {order.postalCode} · {order.address}</span></div>
                  <div><small>Доставка</small><strong>{order.deliveryMethod}</strong>
                    <span>{shipStatus}</span></div>
                </div>
                <div className="watch-main-logistics-items">
                  {items.map(item=>{
                    const enabled=eligible(order,item)
                    const isSent=Number(item.shippedQuantity||0)>0||
                      item.stockWriteoffStatus==='fulfilled'
                    return <div key={item.orderItemId} className={
                      'watch-main-logistics-item'+(isSent?' is-dispatched':'')+(!enabled&&!isSent?' is-blocked':'')}>
                      <label className="watch-logistics-select-line">
                        <input type="checkbox" disabled={!canDispatch||!enabled||dispatching!==null}
                          checked={Boolean(enabled&&item.orderItemId&&(
                            (items.length===1&&dispatchSelection[order.orderId]===undefined)||
                            selectedIds.includes(item.orderItemId)))}
                          onChange={e=>{if(item.orderItemId)setSelected(order.orderId,item.orderItemId,e.target.checked)}}/>
                        <span>{item.modelName||'Модель не определена'} · {item.quantity||0} шт.
                          <small>{item.itemSource==='boutique'?'Витрина':'Офис'} ·
                            {[item.movement,item.braceletMaterial,item.dialColor,item.braceletColor].filter(Boolean).join(' · ')}</small>
                        </span>
                      </label>
                      <div><small>Гравировка</small><strong>{item.engravingText||'Не требуется'}</strong></div>
                      <div><small>Состояние</small><strong>{isSent?'Отправлен':
                        item.reservationStatus!=='active'?'Ожидает товар / резерв':
                        item.engravingText?.trim()&&order.engravingStatus!=='ready'?'Ожидает гравировки':
                        'Готов к отправке'}</strong></div>
                    </div>
                  })}
                </div>
                <div className="watch-logistics-actions">
                  {order.engravingStatus==='ready'?<span>Гравировка завершена</span>:
                    canCompleteEngraving?<button type="button" disabled={saving!==null}
                      onClick={()=>void complete(order.orderId)}>
                      {saving===order.orderId?'Сохраняю…':'Готово · гравировка'}
                    </button>:<span>Завершить может логист или администратор.</span>}
                  {order.shippingStatus!=='sent'&&order.shippingStatus!=='Отправлено'&&
                    canDispatch&&selected.length>0&&
                    (dispatchConfirm===order.orderId?
                    <div className="client3-logistics-dispatch-confirm">
                      <strong>Подтвердить отправку {selected.length} поз. / {selected.reduce((n,x)=>n+Number(x.quantity),0)} шт.?</strong>
                      <span>Будут отправлены только выбранные строки. Остальные сохранятся в заказе и резерве. Деньги не изменятся.</span>
                      <button type="button" disabled={dispatching!==null||saving!==null}
                        onClick={()=>void send(order,selected)}>
                        {dispatching===order.orderId?'Сохраняю…':'Подтвердить отправку'}</button>
                      <button type="button" className="secondary compact" disabled={dispatching!==null}
                        onClick={()=>setDispatchConfirm(null)}>Отмена</button>
                    </div>:
                    <button type="button" className="client3-logistics-dispatch-button"
                      disabled={saving!==null||dispatching!==null}
                      onClick={()=>setDispatchConfirm(order.orderId)}>Отправить выбранное</button>)}
                  {order.shippingStatus!=='sent'&&order.shippingStatus!=='Отправлено'&&
                    items.some(i=>i.engravingText?.trim()&&Number(i.shippedQuantity||0)===0)&&
                    order.engravingStatus!=='ready'&&
                    <small>Часы с гравировкой отправляются после отметки «Готово». Остальные можно отправить отдельно.</small>}
                  {canDispatch&&items.length>1&&selectable.length>0&&
                    <button type="button" className="secondary compact"
                      disabled={dispatching!==null}
                      onClick={()=>{
                        setDispatchConfirm(null);delete dispatchIds.current[order.orderId]
                        setDispatchSelection(prev=>({...prev,[order.orderId]:selectable.map(x=>x.orderItemId!).filter(Boolean)}))
                      }}>Выбрать все готовые</button>}
                  {canDispatch&&selectable.length===0&&items.some(i=>Number(i.shippedQuantity||0)===0)&&
                    <small>Нет позиций, готовых к отправке: проверьте гравировку, остатки или резервы.</small>}
                  {order.shippingStatus!=='sent'&&order.shippingStatus!=='Отправлено'&&
                    !canDispatch&&<small>Отправку подтверждает администратор или менеджер.</small>}
                </div>
              </section>
            </td></tr>}
          </Fragment>
        })}</tbody>
      </table>
    </LinkedTableScroll>
  </section>
}