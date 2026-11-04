import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {WatchOrderHandoverPanel} from './WatchOrderHandoverPanel'
import {watchItemFullyIssued,watchIssuedQuantity,watchItemReturnSummary,watchItemAwaitingReceipt}
 from './watchItemLifecycle'
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
  returnedQuantity: number
  pendingReturnQuantity: number
  pendingExchangeReceiptQuantity: number
  dispatchItemId: number | null
  itemSource: 'warehouse' | 'boutique' | null
  modelName: string | null
  engravingText: string | null
  engravingReady: number | boolean
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
  canCorrectDispatch?:boolean
  focusOrderId?:number|null
  onOpenReturns?:(brand:WatchBrand)=>void
}

type LogisticsResponse = { ok: boolean; rows?: WatchLogisticsRow[]; hasMore?:boolean; nextOffset?:number|null; message?: string }
type LogisticsGroup = { order: WatchLogisticsRow; items: WatchLogisticsRow[] }

async function readApi<T extends { ok: boolean; message?: string }>(
  path: string, options?: RequestInit,
): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...options })
  const data = await response.json() as T
  if (!response.ok || !data.ok) {
    const failure= new Error(data.message || 'Запрос не выполнен (' + response.status + ')') as Error&{code?:string}
    failure.code=(data as {code?:string}).code
    throw failure
  }
  return data
}

export const logisticsItemIssued=(item:WatchLogisticsRow)=>watchItemFullyIssued(item)
export const logisticsOrderComplete=(group:LogisticsGroup)=>{
  const items=group.items.filter(i=>i.orderItemId!=null&&Number(i.quantity||0)>0)
  return group.items.length>0&&(items.length===0||items.every(logisticsItemIssued))
}
/** Shared UI selection gate; the API repeats this check for every exact SKU. */
export const logisticsItemEligible=(item:WatchLogisticsRow)=>Boolean(
  item.orderItemId&&Number(item.quantity)>0&&item.reservationStatus==='active'&&
  item.stockWriteoffStatus==='reserved'&&Number(item.shippedQuantity||0)===0&&
  (!item.engravingText?.trim()||Boolean(item.engravingReady)))
/** A missing reservation can be activated only by Main's guarded physical-stock
 * recovery, after the operator explicitly verifies these exact watch SKU items. */
const logisticsAwaitingPhysicalConfirmation=(item:WatchLogisticsRow)=>Boolean(
  item.orderItemId&&Number(item.quantity)>0&&
  item.reservationStatus==='unresolved'&&
  item.stockWriteoffStatus==='pending_reservation'&&
  Number(item.shippedQuantity||0)===0&&
  (!item.engravingText?.trim()||Boolean(item.engravingReady)))

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
export function WatchLogisticsPanel({brand,allowedBrands=[],canCompleteEngraving,canDispatch=false,canCorrectDispatch=false,focusOrderId=null,onOpenReturns}:Props) {
  const [brandScope,setBrandScope]=useState<WatchBrand|'all'>(brand)
  const [focusedOrderId,setFocusedOrderId]=useState<number|null>(focusOrderId)
  const [focusExpanded,setFocusExpanded]=useState(false)
  const [rows, setRows] = useState<WatchLogisticsRow[]>([])
  const [nextOffset,setNextOffset]=useState<number|null>(null)
  const [loadingMore,setLoadingMore]=useState(false)
  const pageScope=useRef('')
  const [filter, setFilter] = useState<'pending'|'engraving'|'ready'|'unshipped'|'sent'|'all'|'urgent'|'overdue'>('unshipped')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<number | null>(null)
  const [dispatching,setDispatching]=useState<number|null>(null)
  const [dispatchConfirm,setDispatchConfirm]=useState<number|null>(null)
  const [readyConfirmOrderId,setReadyConfirmOrderId]=useState<number|null>(null)
  const [checkingHandover,setCheckingHandover]=useState<number|null>(null)
  const [handoverPromptOrderId,setHandoverPromptOrderId]=useState<number|null>(null)

  const [dispatchSelection,setDispatchSelection]=useState<Record<number,number[]>>({})
  const [dispatchQuantities,setDispatchQuantities]=useState<Record<number,Record<number,number>>>({})
  const [correctionTarget,setCorrectionTarget]=useState<{orderId:number;dispatchItemId:number}|null>(null)
  const [correctionReason,setCorrectionReason]=useState('')
  const [correcting,setCorrecting]=useState<number|null>(null)
  const correctionIds=useRef<Record<number,string>>({})
  const [expanded,setExpanded]=useState<number|null>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  useEffect(()=>{
    if(!feedback)return
    const timer=window.setTimeout(()=>setFeedback(''),4500)
    return ()=>window.clearTimeout(timer)
  },[feedback])
  const [refreshKey, setRefreshKey] = useState(0)
  // Retain the same idempotency key across a failed/ambiguous network retry.
  const requestIds = useRef<Record<number, string>>({})
  const dispatchIds=useRef<Record<number,string>>({})
  // Main workshop parity: all status queues reuse one fetched dataset and
  // switch instantly, with priority for urgent and overdue deadlines.
  const allGroups=useMemo(()=>groupWatchLogistics(rows),[rows])
  const groups=useMemo(()=>allGroups.filter(group=>{
    const {order,items}=group
    const sent=logisticsOrderComplete(group)
    const overdue=!sent&&Number.isFinite(Date.parse(order.shippingDeadlineAt))&&
      Date.parse(order.shippingDeadlineAt)<Date.now()
    if(filter==='unshipped')return !sent
    if(filter==='sent')return sent
    if(filter==='urgent')return !sent&&Boolean(order.urgent)
    if(filter==='overdue')return overdue
    if(filter==='all')return true
    if(filter==='ready')return !sent&&items.some(i=>i.orderItemId&&
      !logisticsItemIssued(i)&&(!i.engravingText?.trim()||Boolean(i.engravingReady)))
    return !sent&&order.engravingStatus===filter
  }).sort((a,b)=>{
    const aOverdue=Number(!logisticsOrderComplete(a)&&
      Date.parse(a.order.shippingDeadlineAt)<Date.now())
    const bOverdue=Number(!logisticsOrderComplete(b)&&
      Date.parse(b.order.shippingDeadlineAt)<Date.now())
    return bOverdue-aOverdue||Number(Boolean(b.order.urgent))-Number(Boolean(a.order.urgent))||
      Date.parse(a.order.shippingDeadlineAt)-Date.parse(b.order.shippingDeadlineAt)||
      a.order.orderId-b.order.orderId
  }),[allGroups,filter])

  useEffect(() => {
    const controller = new AbortController()
    setBusy(true)
    setRows([])
    setNextOffset(null)
    setError('')
    pageScope.current=brandScope+':'+refreshKey+':'+(focusedOrderId||0)
    const params=new URLSearchParams({status:'all',limit:'80',offset:'0'})
    if(brandScope!=='all')params.set('brand',brandScope)
    if(focusedOrderId)params.set('orderId',String(focusedOrderId))
    void readApi<LogisticsResponse>('/api/client3/watches/logistics?' + params.toString(), {
      signal: controller.signal,
    }).then(data => {
      if (!controller.signal.aborted) {
        setRows(data.rows || [])
        setNextOffset(data.hasMore?Number(data.nextOffset):null)
        if(focusedOrderId&&data.rows?.some(row=>row.orderId===focusedOrderId)){
          setExpanded(focusedOrderId)
          setFilter('all')
          // Show exact selected order immediately, retaining operator freedom
          // to deselect items before physically confirming the shipment.
          if(!focusExpanded){
            const ready=data.rows.filter(row=>row.orderId===focusedOrderId&&
              (logisticsItemEligible(row)||logisticsAwaitingPhysicalConfirmation(row)))
              .map(row=>row.orderItemId).filter((id):id is number=>id!==null)
            setDispatchSelection(previous=>({...previous,[focusedOrderId]:ready}))
            setFocusExpanded(true)
          }
        }
      }
    }).catch(reason => {
      if (!controller.signal.aborted) {
        setRows([])
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить логистику')
      }
    }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [brandScope, refreshKey,focusedOrderId])

  const loadMore=async()=>{
    if(nextOffset===null||busy||loadingMore)return
    const scope=pageScope.current
    const params=new URLSearchParams({status:'all',limit:'80',offset:String(nextOffset)})
    if(brandScope!=='all')params.set('brand',brandScope)
    if(focusedOrderId)params.set('orderId',String(focusedOrderId))
    setLoadingMore(true);setError('')
    try{
      const data=await readApi<LogisticsResponse>('/api/client3/watches/logistics?'+params)
      if(pageScope.current!==scope)return
      setRows(old=>[...old,...(data.rows||[])])
      setNextOffset(data.hasMore?Number(data.nextOffset):null)
    }catch(cause){
      if(pageScope.current===scope)setError(cause instanceof Error?cause.message:'Не удалось загрузить следующую страницу.')
    }finally{if(pageScope.current===scope)setLoadingMore(false)}
  }
  const complete = useCallback(async (orderId: number, orderItemId: number) => {
    if (!canCompleteEngraving || saving !== null) return
    setSaving(orderItemId)
    setError('')
    setFeedback('')
    const requestId = requestIds.current[orderItemId] ||= 'watch-' + crypto.randomUUID()
    try {
      await readApi<{ok: boolean; message?: string}>(
        '/api/client3/watches/logistics/' + orderId + '/ready', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId,orderItemId }),
        },
      )
      delete requestIds.current[orderItemId]
      setFeedback('Гравировка выбранных часов готова. Остальные позиции не изменены.')
      setRefreshKey(value => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отметить готовность')
    } finally {
      setSaving(null)
    }
  }, [canCompleteEngraving, saving])

  const correctDispatch=async(order:WatchLogisticsRow)=>{
    if(!canCorrectDispatch||!correctionTarget||correcting!==null||
       correctionTarget.orderId!==order.orderId||correctionReason.trim().length<8)return
    const id=correctionTarget.dispatchItemId
    setCorrecting(id);setError('');setFeedback('')
    const requestId=correctionIds.current[id]||='watch-correct-send-'+crypto.randomUUID()
    try{
      const data=await readApi<{
        ok:boolean;message?:string;physicalRestoredQuantity?:number;needsStockCheck?:boolean
      }>('/api/client3/watches/orders/'+order.orderId+'/dispatch-correction',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({brand:order.brand,dispatchItemId:id,
          reason:correctionReason.trim(),requestId}),
      })
      delete correctionIds.current[id]
      setCorrectionTarget(null);setCorrectionReason('')
      setDispatchSelection(prev=>({...prev,[order.orderId]:[]}))
      setFeedback(data.needsStockCheck
        ?'Запись об отправке исправлена, но физический остаток не увеличен: нужна проверка склада.'
        :'Ошибочная отправка исправлена через Main. Резерв и остаток пересчитаны.')
      setRefreshKey(value=>value+1)
    }catch(cause){setError(cause instanceof Error?cause.message:'Исправление отправки заблокировано')}
    finally{setCorrecting(null)}
  }
  const setSelected=(orderId:number,itemId:number,enabled:boolean,initial:number[])=>{
    setDispatchConfirm(null)
    delete dispatchIds.current[orderId]
    setDispatchSelection(prev=>{
      const old=prev[orderId]??initial
      return {...prev,[orderId]:enabled?[...new Set([...old,itemId])]:old.filter(id=>id!==itemId)}
    })
  }
  const setQuantity=(orderId:number,itemId:number,value:number)=>{
    setDispatchConfirm(null)
    delete dispatchIds.current[orderId]
    setDispatchQuantities(prev=>({...prev,[orderId]:{...prev[orderId],[itemId]:value}}))
  }
  const completeAllEngraving=async(orderId:number,items:WatchLogisticsRow[])=>{
    if(!canCompleteEngraving||saving!==null||readyConfirmOrderId!==orderId)return
    const pending=items.filter(x=>x.orderItemId&&x.engravingText?.trim()&&
      !Boolean(x.engravingReady)&&watchIssuedQuantity(x)===0)
    if(!pending.length)return
    setSaving(-1);setError('');setFeedback('');setReadyConfirmOrderId(null)
    let completed=0
    try{
      for(const item of pending){
        const id=Number(item.orderItemId)
        const requestId=requestIds.current[id]||='watch-'+crypto.randomUUID()
        await readApi<{ok:boolean;message?:string}>(
          '/api/client3/watches/logistics/'+orderId+'/ready',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({requestId,orderItemId:id}),
          })
        delete requestIds.current[id];completed++
      }
      setFeedback('Готовность подтверждена для '+completed+' позиций. Теперь выберите часы к отправке.')
    }catch(reason){
      setError('Готово '+completed+' из '+pending.length+'. '+
        (reason instanceof Error?reason.message:'Не удалось завершить подтверждение.'))
    }finally{setSaving(null);setRefreshKey(v=>v+1)}
  }
  const eligible=(_order:WatchLogisticsRow,item:WatchLogisticsRow)=>
    logisticsItemEligible(item)||logisticsAwaitingPhysicalConfirmation(item)
  const reviewSendHandover=async(order:WatchLogisticsRow,selected:WatchLogisticsRow[])=>{
    if(!canDispatch||checkingHandover!==null||dispatching!==null)return
    setCheckingHandover(order.orderId);setError('');setDispatchConfirm(null)
    try{
      const status=await readApi<{
        ok:boolean;state?:{items:Array<{orderItemId:number;reviewNeeded:boolean}>}
      }>('/api/client3/watches/orders/'+order.orderId+
        '/stock-handover?brand='+encodeURIComponent(order.brand))
      // Main's checkpoint review concerns the exact items being dispatched.
      // The server repeats this check at the final POST boundary.
      const selectedIds=new Set(selected.map(x=>Number(x.orderItemId)))
      const needsReview=status.state?.items.some(x=>
        selectedIds.has(x.orderItemId)&&x.reviewNeeded)
      if(needsReview){
        setHandoverPromptOrderId(order.orderId)
        setError('Для выбранных часов есть ревизия после заказа. Уточните выдачу до отправки.')
      }else{
        setHandoverPromptOrderId(null)
        setDispatchConfirm(order.orderId)
      }
    }catch(e){
      setError(e instanceof Error?e.message:'Не удалось проверить ревизию. Отправка остановлена.')
    }finally{setCheckingHandover(null)}
  }
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
            confirmPhysicalStock:true,
            items:selected.map(row=>({orderItemId:row.orderItemId,quantity:row.quantity}))}),
        })
      delete dispatchIds.current[order.orderId]
      setDispatchConfirm(null)
      setDispatchSelection(prev=>({...prev,[order.orderId]:[]}))
      setDispatchQuantities(prev=>({...prev,[order.orderId]:{}}))
      setFeedback('Отправлено выбранное количество. Оставшиеся часы и резервы сохранены.')
      setRefreshKey(value=>value+1)
    }catch(cause){
      if((cause as Error&{code?:string})?.code==='WATCH_HANDOVER_REQUIRED'){
        setDispatchConfirm(null)
        setHandoverPromptOrderId(order.orderId)
      }
      setError(cause instanceof Error?cause.message:'Не удалось подтвердить отправку')
    }
    finally{setDispatching(null)}
  },[canDispatch,dispatching,dispatchConfirm])
  return <section className="watch-logistics workshop-workspace">
    <div className="watch-logistics-heading">
      <div>
        <h2>Логистика</h2>
        <p>Готовность часов и фактическая отправка — два отдельных действия. Готовые позиции заранее выбраны; ненужные снимите с выбора.</p>
      </div>
      <div className="watch-logistics-controls">
        {focusedOrderId&&<button type="button" className="secondary compact"
          onClick={()=>{setFocusedOrderId(null);setFocusExpanded(false);
            setExpanded(null);setDispatchConfirm(null);setDispatchSelection({});setFilter('unshipped')}}>
          Все заказы логистики
        </button>}
        <label>Статус
          <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
            <option value="all">Все заказы</option>
            <option value="unshipped">К отправке</option>
            <option value="sent">Отправлены</option>
            <option value="pending">Ожидает</option>
            <option value="engraving">В работе</option>
            <option value="ready">Готово</option>
            <option value="urgent">Срочные</option>
            <option value="overdue">Просроченные</option>
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
    <div className="workshop-channel-tabs client3-logistics-queues" role="tablist" aria-label="Очереди логистики">
      {([
        ['unshipped','Активные','Ожидают отправки'],
        ['urgent','Срочные','Приоритет по срокам'],
        ['overdue','Просроченные','Требуют внимания'],
        ['ready','Гравировка готова','Можно отправлять'],
        ['sent','Отправленные','Завершённые отгрузки'],
        ['all','Все','Общая история'],
      ] as const).map(([value,label,hint])=>
        <button type="button" key={value}
          className={'workshop-channel-tab '+(filter===value?'is-active':'')}
          aria-pressed={filter===value} onClick={()=>{setFilter(value);setExpanded(null);setDispatchConfirm(null)}}>
          <span>{label}</span><small>{hint}</small>
        </button>)}
    </div>
    <div className="summary-grid compact-summary client3-logistics-overview">
      <div className="summary-card"><span>В работе</span><strong>{allGroups.filter(g=>!logisticsOrderComplete(g)).length}</strong></div>
      <div className="summary-card warning-card"><span>Срочные</span><strong>{allGroups.filter(g=>g.order.urgent&&!logisticsOrderComplete(g)).length}</strong></div>
      <div className="summary-card danger-card"><span>Срок прошёл</span><strong>{allGroups.filter(g=>!logisticsOrderComplete(g)&&Date.parse(g.order.shippingDeadlineAt)<Date.now()).length}</strong></div>
      <div className="summary-card"><span>Гравировка готова</span><strong>{allGroups.filter(g=>!logisticsOrderComplete(g)&&g.items.some(i=>!logisticsItemIssued(i)&&Boolean(i.engravingReady))).length}</strong></div>
    </div>
    {nextOffset!==null&&<p className="mini-panel-note" role="status">
      Показаны первые {allGroups.length} заказов. Очередь продолжается — загрузите следующую страницу.
      Итоги выше относятся только к загруженным заказам.</p>}
    {error && <p role="alert" className="watch-logistics-error">{error}</p>}
    {feedback && <p role="status" className="watch-logistics-feedback">{feedback}</p>}
    {busy && <p role="status">Загрузка логистики…</p>}
    {!busy && !error && groups.length === 0 && <p>В выбранной очереди заказов нет.</p>}
    <LinkedTableScroll className="watch-main-logistics-scroll" ariaLabel="Очередь логистики">
      <table className="data-table workshop-grid-table workshop-order-like-table watch-main-logistics-table">
        <thead><tr>
          <th>Заказ / бренд</th><th>Получатель</th><th>Отправить до</th>
          <th>Готовность</th><th>Отправка</th><th>Действия</th>
        </tr></thead>
        <tbody>{groups.map(({order,items})=>{
          const completed=logisticsOrderComplete({order,items})
          const dispatched=items.filter(x=>watchIssuedQuantity(x)>0).length
          const returnedCount=items.reduce((n,x)=>n+Math.max(0,Number(x.returnedQuantity||0)),0)
          const intakePending=items.reduce((n,x)=>n+watchItemAwaitingReceipt(x),0)
          const missingEngraving=items.filter(x=>x.orderItemId&&x.engravingText?.trim()&&
            !Boolean(x.engravingReady)&&watchIssuedQuantity(x)===0)
          const shipStatus=completed
            ?(order.shippingStatus==='sent'||order.shippingStatus==='Отправлено'?'Отправлен':'Ранее выдан · подтверждено')
            :dispatched>0?'Частично отправлен':'Не отправлен'
          const selectable=items.filter(item=>eligible(order,item))
          const selectedIds=dispatchSelection[order.orderId]??
            selectable.map(x=>x.orderItemId!).filter(Boolean)
          const selected=selectable.filter(item=>item.orderItemId&&(
            selectedIds.includes(item.orderItemId)))
            .map(item=>({...item,quantity:
              dispatchQuantities[order.orderId]?.[item.orderItemId!]??Number(item.quantity)}))
            .filter(item=>Number.isSafeInteger(item.quantity)&&item.quantity>0&&
              item.quantity<=Number(selectable.find(x=>x.orderItemId===item.orderItemId)?.quantity))
          const needsPhysicalConfirm=selected.some(logisticsAwaitingPhysicalConfirmation)
          const overdue=!completed&&Number.isFinite(Date.parse(order.shippingDeadlineAt))&&
            Date.parse(order.shippingDeadlineAt)<Date.now()
          return <Fragment key={order.orderId}>
            <tr className={'watch-main-logistics-row'+(expanded===order.orderId?' is-open':'')}>
              <td><strong>{order.externalId||'#'+order.orderId}</strong>
                <small>{order.brand} · {order.legacySource==='boutique'?'Витрина':'Офис'}</small>
                {Boolean(order.urgent)&&<small className="watch-logistics-urgent">Срочно</small>}</td>
              <td><strong>{order.recipientName}</strong><small>{order.recipientPhone}</small></td>
              <td>{formatWatchDeadline(order.shippingDeadlineAt)}
                {overdue&&<small className="watch-logistics-urgent">Срок прошёл</small>}</td>
              <td><span className={'watch-logistics-status '+(order.engravingStatus==='ready'?'is-ready':'')}>
                {statusText(order.engravingStatus)}</span>
                <small>Гравировка: {items.filter(x=>!x.engravingText?.trim()||Boolean(x.engravingReady)).length} / {items.length}</small>
              </td>
              <td><span className={'watch-main-logistics-send-status '+(completed?'is-sent':'is-awaiting')}>
                {shipStatus}</span>
                {returnedCount>0&&<small>Возвращено {returnedCount} шт.</small>}
                {intakePending>0&&<small className="watch-logistics-intake-warning">Ожидаем приём: {intakePending} шт.</small>}</td>
              <td><button type="button" className="primary compact watch-logistics-open-order"
                aria-expanded={expanded===order.orderId}
                onClick={()=>{setExpanded(v=>v===order.orderId?null:order.orderId);setDispatchConfirm(null)}}>
                {expanded===order.orderId?'Закрыть':completed?'История отправок':'Подготовить отправку'}
              </button></td>
            </tr>
            {expanded===order.orderId&&<tr className="watch-main-logistics-expanded"><td colSpan={6}>
              <section className="watch-main-logistics-detail">
                <div className="watch-main-logistics-detail-head">
                  <div><small>Получатель и адрес</small><strong>{order.recipientName} · {order.recipientPhone}</strong>
                    <span>{order.city}, {order.postalCode} · {order.address}</span></div>
                  <div><small>Доставка</small><strong>{order.deliveryMethod}</strong>
                    <span>{shipStatus}</span></div>
                </div>
                {canCompleteEngraving&&missingEngraving.length>0&&<div className="watch-logistics-ready-all">
                  <div><strong>Гравировка ожидает подтверждения: {missingEngraving.length} поз.</strong>
                    <small>Отметки относятся только к указанным часам и не отправляют заказ.</small></div>
                  {readyConfirmOrderId===order.orderId?
                    <div className="watch-logistics-ready-all-actions">
                      <button type="button" className="primary compact" disabled={saving!==null}
                        onClick={()=>void completeAllEngraving(order.orderId,items)}>
                        {saving===-1?'Подтверждаю…':'Подтвердить готовность всех '+missingEngraving.length}
                      </button>
                      <button type="button" className="secondary compact" disabled={saving!==null}
                        onClick={()=>setReadyConfirmOrderId(null)}>Отмена</button>
                    </div>:
                    <button type="button" className="secondary compact" disabled={saving!==null}
                      onClick={()=>setReadyConfirmOrderId(order.orderId)}>
                      Всё готово · отметить
                    </button>}
                </div>}
                <div className="watch-main-logistics-items">
                  {items.map(item=>{
                    const enabled=eligible(order,item)
                    const isSent=logisticsItemIssued(item)
                    return <div key={item.orderItemId} className={
                      'watch-main-logistics-item'+(isSent?' is-dispatched':'')+(!enabled&&!isSent?' is-blocked':'')}>
                      <label className="watch-logistics-select-line">
                        <input type="checkbox" disabled={!canDispatch||!enabled||dispatching!==null}
                          checked={Boolean(enabled&&item.orderItemId&&(
                            selectedIds.includes(item.orderItemId)))}
                          onChange={e=>{if(item.orderItemId)setSelected(order.orderId,item.orderItemId,e.target.checked,
                          selectable.map(x=>x.orderItemId!).filter(Boolean))}}/>
                        <span><strong>{item.modelName||'Модель не определена'}</strong> · {item.quantity||0} шт.
                          <small>{item.itemSource==='boutique'?'Витрина':'Офис'} ·
                            {[watchReferenceLabel('movements',item.movement||''),
                              watchReferenceLabel('bracelets',item.braceletMaterial||''),
                              watchReferenceLabel('dials',item.dialColor||''),
                              item.braceletColor?'Ремешок: '+watchReferenceLabel('leatherColors',item.braceletColor):''].filter(Boolean).join(' · ')}</small>
                        </span>
                      </label>
                      <div><small>Гравировка</small><strong>{item.engravingText||'Не требуется'}</strong>
                        {item.engravingText?.trim()&&<small>{item.engravingReady?'Готово':'Ожидает готовности'}</small>}
                        {canCompleteEngraving&&item.orderItemId&&item.engravingText?.trim()&&!item.engravingReady&&Number(item.shippedQuantity||0)===0&&
                          <button type="button" disabled={saving!==null} onClick={()=>void complete(order.orderId,item.orderItemId!)}>
                            {saving===item.orderItemId?'Сохраняю…':'Готово · эта позиция'}</button>}</div>
                      {enabled&&canDispatch&&item.orderItemId&&
                        <label className="watch-logistics-quantity">
                          <small>Отправить, шт. (из {item.quantity})</small>
                          <input type="number" min={1} max={Number(item.quantity)} step={1}
                            disabled={dispatching!==null}
                            value={dispatchQuantities[order.orderId]?.[item.orderItemId]??Number(item.quantity)}
                            onChange={e=>setQuantity(order.orderId,item.orderItemId!,e.target.value===''?0:Number(e.target.value))}/>
                        </label>}
                      <div><small>Состояние</small><strong>{
                        Number(item.quantity||0)===0?'Историческая позиция':
                        isSent?'Отправлен':
                        watchIssuedQuantity(item)>0?'Частично отправлен '+watchIssuedQuantity(item)+' из '+item.quantity:
                        item.reservationStatus!=='active'?'Можно отправить по факту наличия':
                        item.engravingText?.trim()&&!item.engravingReady?'Ожидает гравировки':'Готов к отправке'
                      }</strong>
                      {watchItemReturnSummary(item)&&<small className="watch-logistics-intake-warning">{watchItemReturnSummary(item)}</small>}</div>
                      {canCorrectDispatch&&isSent&&item.dispatchItemId&&
                        <button type="button" className="secondary compact watch-dispatch-correction-open"
                          disabled={correcting!==null||dispatching!==null}
                          onClick={()=>{
                            setCorrectionTarget({orderId:order.orderId,dispatchItemId:item.dispatchItemId!})
                            setCorrectionReason('')
                            setDispatchConfirm(null)
                          }}>Исправить ошибочную отправку</button>}
                    </div>
                  })}
                </div>
                {canCorrectDispatch&&correctionTarget?.orderId===order.orderId&&
                  <div className="watch-dispatch-correction-confirm">
                    <strong>Исправление ошибочно отмеченной отправки</strong>
                    <p>Используйте только если отправку отметили по ошибке. Если часы
                      действительно у клиента, оформляйте возврат, а не отмену отправки.
                      Main проверит историю ревизий и решит, можно ли восстановить физический остаток.</p>
                    <label>Причина исправления (от 8 символов)
                      <textarea required rows={2} maxLength={500} value={correctionReason}
                        onChange={e=>{
                          setCorrectionReason(e.target.value)
                          delete correctionIds.current[correctionTarget.dispatchItemId]
                        }}/>
                    </label>
                    <div className="watch-logistics-actions">
                      <button type="button" className="watch-dispatch-correction-commit"
                        disabled={correcting!==null||dispatching!==null||correctionReason.trim().length<8}
                        onClick={()=>void correctDispatch(order)}>
                        {correcting!==null?'Исправляю…':'Подтвердить исправление'}</button>
                      <button type="button" className="secondary compact" disabled={correcting!==null}
                        onClick={()=>setCorrectionTarget(null)}>Отмена</button>
                    </div>
                  </div>}
                {handoverPromptOrderId===order.orderId&&
                  <div className="watch-logistics-handover-required">
                    <strong>Уточнение выдачи обязательно перед отправкой</strong>
                    <p>Последняя ревизия проведена после создания заказа. По каждой затронутой позиции укажите, выдали ли часы до проверки или они оставались у вас.</p>
                    <WatchOrderHandoverPanel brand={order.brand} orderId={order.orderId}
                      lines={items.filter(i=>i.orderItemId).map(i=>({
                        id:Number(i.orderItemId),gender:i.gender||'',movement:i.movement||'',
                        braceletMaterial:i.braceletMaterial||'',dialColor:i.dialColor||'',
                        braceletColor:i.braceletColor||'',
                      }))}
                      onDone={()=>{setDispatchConfirm(null);setRefreshKey(v=>v+1)}}
                      onClose={()=>{setHandoverPromptOrderId(null);setDispatchConfirm(null)}}/>
                  </div>}
                <div className="watch-logistics-actions">
                  {intakePending>0&&<div className="watch-logistics-receipt-notice">
                    <strong>Возвращённые часы ожидают физическую приёмку: {intakePending} шт.</strong>
                    <small>Возврат денег сам по себе не увеличивает склад. История отправок остаётся сохранена.</small>
                    {onOpenReturns&&<button type="button" className="secondary compact"
                      onClick={()=>onOpenReturns(order.brand)}>Перейти к приёмке возвратов</button>}
                  </div>}
                  <span>{order.engravingStatus==='ready'?'Все гравировки готовы':
                    'Гравировка подтверждается отдельно у каждой позиции выше'}</span>
                  {canDispatch&&selected.length>0&&handoverPromptOrderId!==order.orderId&&
                    (dispatchConfirm===order.orderId?
                    <div className="client3-logistics-dispatch-confirm">
                      <strong>Отправляем {selected.length} поз. / {selected.reduce((n,x)=>n+Number(x.quantity),0)} шт.</strong>
                      <span>Отправится указанное количество. Неотправленные часы останутся отдельной строкой. Оплаты не изменятся.</span>
                      <p className="client3-physical-send-confirm">
                        {needsPhysicalConfirm
                          ?'Нажимая «Подтвердить отправку», вы подтверждаете, что выбранные часы действительно передаются клиенту. Даже при нулевом остатке отправка будет записана, а расхождение отмечено отдельно. Резервы других заказов не меняются.'
                          :'Подтвердите физическую передачу выбранных часов клиенту. Склад спишет только эту отправку.'}
                      </p>
                      <button type="button" disabled={dispatching!==null||saving!==null}
                        onClick={()=>void send(order,selected)}>
                        {dispatching===order.orderId?'Сохраняю…':'Подтвердить отправку'}</button>
                      <button type="button" className="secondary compact" disabled={dispatching!==null}
                        onClick={()=>setDispatchConfirm(null)}>Отмена</button>
                    </div>:
                    <button type="button" className="client3-logistics-dispatch-button"
                      disabled={saving!==null||dispatching!==null||checkingHandover!==null}
                      onClick={()=>void reviewSendHandover(order,selected)}>
                      {checkingHandover===order.orderId?'Проверяю ревизию…':
                        'Отправить выбранные · '+selected.reduce((n,x)=>n+Number(x.quantity),0)+' шт.'}
                    </button>)}
                  {!completed&&items.some(i=>i.engravingText?.trim()&&!logisticsItemIssued(i))&&
                    order.engravingStatus!=='ready'&&
                    <small>Часы с гравировкой отправляются после отметки «Готово». Остальные можно отправить отдельно.</small>}
                  {canDispatch&&items.length>1&&selectable.length>0&&
                    <button type="button" className="secondary compact"
                      disabled={dispatching!==null}
                      onClick={()=>{
                        setDispatchConfirm(null);delete dispatchIds.current[order.orderId]
                        setDispatchSelection(prev=>({...prev,[order.orderId]:selectable.map(x=>x.orderItemId!).filter(Boolean)}))
                      }}>Выбрать все готовые</button>}
                  {canDispatch&&selectable.length>0&&selectable.some(i=>i.orderItemId&&
                    dispatchQuantities[order.orderId]?.[i.orderItemId]===0)&&
                    <small>Для отправки укажите положительное количество.</small>}
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
    {nextOffset!==null&&<button type="button" className="secondary" disabled={busy||loadingMore}
      onClick={()=>void loadMore()}>{loadingMore?'Загружаю…':'Показать ещё заказы'}</button>}
  </section>
}