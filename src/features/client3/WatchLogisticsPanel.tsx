import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {StockResolutionConfirmModal} from '../orders/StockResolutionConfirmModal'
import {WatchLogisticsTaskTable} from './WatchLogisticsTaskTable'
import {WatchOrderHandoverPanel} from './WatchOrderHandoverPanel'
import {watchItemFullyIssued} from './watchItemLifecycle'
import '../../styles/client3-watch-logistics.css'
import '../../styles/client3-qa-logistics-20261104.css'

export type WatchLogisticsRow = {
  orderId: number
  externalId: string
  brand: WatchBrand
  legacySource: 'warehouse' | 'boutique'
  shippingStatus: string
  orderDate:string
  managerName:string|null
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
  physicalQuantity:number
  systemReservedQuantity:number
  shippedQuantity: number
  returnedQuantity: number
  pendingReturnQuantity: number
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
  onOpenStock?:(brand:WatchBrand)=>void
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

/** Main's operational workflow: engraving readiness and actual dispatch remain
 * separate confirmed actions; both use isolated brand-scoped Client3 routes. */
export function WatchLogisticsPanel({brand,allowedBrands=[],canCompleteEngraving,canDispatch=false,canCorrectDispatch=false,focusOrderId=null,onOpenReturns,onOpenStock}:Props) {
  const [brandScope,setBrandScope]=useState<WatchBrand|'all'>(brand)
  const [focusedOrderId,setFocusedOrderId]=useState<number|null>(focusOrderId)
  const [rows, setRows] = useState<WatchLogisticsRow[]>([])
  const [nextOffset,setNextOffset]=useState<number|null>(null)
  const [loadingMore,setLoadingMore]=useState(false)
  const pageScope=useRef('')
  const [filter, setFilter] = useState<'pending'|'engraving'|'ready'|'unshipped'|'sent'|'all'|'urgent'|'overdue'>('unshipped')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<number | null>(null)
  const [dispatching,setDispatching]=useState<number|null>(null)
  const [checkingHandover,setCheckingHandover]=useState<number|null>(null)
  const [handoverPromptOrderId,setHandoverPromptOrderId]=useState<number|null>(null)
  const [stockPrompt,setStockPrompt]=useState<{order:WatchLogisticsRow;items:WatchLogisticsRow[]}|null>(null)
  const [correcting,setCorrecting]=useState<number|null>(null)
  const correctionIds=useRef<Record<number,string>>({})
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
  const dispatchIds=useRef<Record<string,string>>({})
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
    if(filter==='engraving')return !sent&&items.some(i=>i.orderItemId&&
      Number(i.quantity)>0&&!logisticsItemIssued(i)&&
      Boolean(i.engravingText?.trim())&&!Boolean(i.engravingReady))
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
        if(focusedOrderId&&data.rows?.some(row=>row.orderId===focusedOrderId))
          setFilter('all')
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

  const correctDispatch=async(order:WatchLogisticsRow,dispatchItemId:number,reason:string)=>{
    if(!canCorrectDispatch||correcting!==null||reason.trim().length<8)return
    setCorrecting(dispatchItemId);setError('');setFeedback('')
    const requestId=correctionIds.current[dispatchItemId]||='watch-correct-send-'+crypto.randomUUID()
    try{
      const data=await readApi<{
        ok:boolean;message?:string;physicalRestoredQuantity?:number;needsStockCheck?:boolean
      }>('/api/client3/watches/orders/'+order.orderId+'/dispatch-correction',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({brand:order.brand,dispatchItemId,
          reason:reason.trim(),requestId}),
      })
      delete correctionIds.current[dispatchItemId]
      setFeedback(data.needsStockCheck
        ?'Исправлено. Физический остаток не восстановлен автоматически; проверьте склад.'
        :'Ошибочная отправка исправлена. Остаток и резерв пересчитаны через Main.')
      setRefreshKey(value=>value+1)
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Исправление отправки заблокировано')
      throw cause
    }finally{setCorrecting(null)}
  }

  const send=useCallback(async(order:WatchLogisticsRow,selected:WatchLogisticsRow[],confirmedPhysical=false)=>{
    if(!canDispatch||dispatching!==null)return
    setDispatching(order.orderId);setError('');setFeedback('')
    const fingerprint=order.orderId+':'+selected.map(row=>row.orderItemId+':'+row.quantity).join(',')
    const requestId=dispatchIds.current[fingerprint]||='watch-send-'+crypto.randomUUID()
    try{
      await readApi<{ok:boolean;message?:string}>(
        '/api/client3/watches/orders/'+order.orderId+'/send',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({brand:order.brand,requestId,
            confirmPhysicalStock:confirmedPhysical,
            items:selected.map(row=>({orderItemId:row.orderItemId,quantity:row.quantity}))}),
        })
      delete dispatchIds.current[fingerprint]
      setFeedback('Отправлены выбранные часы. Остальные позиции и резервы не изменены.')
      setRefreshKey(value=>value+1)
    }catch(cause){
      const code=(cause as Error&{code?:string})?.code
      if(code==='WATCH_HANDOVER_REQUIRED')setHandoverPromptOrderId(order.orderId)
      if(code==='WATCH_PHYSICAL_CONFIRM_REQUIRED')setStockPrompt({order,items:selected})
      setError(cause instanceof Error?cause.message:'Отправка не выполнена')
    }finally{setDispatching(null)}
  },[canDispatch,dispatching])

  const reviewSendHandover=async(order:WatchLogisticsRow,selected:WatchLogisticsRow[])=>{
    if(!canDispatch||checkingHandover!==null||dispatching!==null||!selected.length)return
    setCheckingHandover(order.orderId);setError('')
    try{
      const status=await readApi<{
        ok:boolean;state?:{items:Array<{orderItemId:number;reviewNeeded:boolean;state:string}>}
      }>('/api/client3/watches/orders/'+order.orderId+
        '/stock-handover?brand='+encodeURIComponent(order.brand))
      const selectedIds=new Set(selected.map(x=>Number(x.orderItemId)))
      if(!status.state||selected.some(x=>!status.state?.items.some(line=>line.orderItemId===x.orderItemId)))
        throw Error('Не удалось проверить ревизию выбранных часов. Отправка остановлена.')
      if(status.state.items.some(x=>selectedIds.has(x.orderItemId)&&x.reviewNeeded&&
        !selected.some(row=>row.orderItemId===x.orderItemId&&row.stockWriteoffStatus==='catalog_retired'))){
        setHandoverPromptOrderId(order.orderId)
        return
      }
      if(status.state.items.some(x=>selectedIds.has(x.orderItemId)&&x.state==='already_issued'))
        throw Error('Эти часы уже выданы до ревизии. Повторная отправка запрещена.')
      const shortage=selected.some(x=>x.reservationStatus!=='active'||
        x.stockWriteoffStatus!=='reserved')
      if(shortage){
        setStockPrompt({order,items:selected})
        return
      }
      // A single deliberate item-level Send click is the whole operation.
      // The server still enforces stocktake, actual SKU and engraving readiness.
      await send(order,selected,false)
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Не удалось проверить ревизию. Отправка остановлена.')
    }finally{setCheckingHandover(null)}
  }
  return <section className="watch-logistics workshop-workspace">
    <div className="watch-logistics-heading">
      <div>
        <h2>Логистика</h2>
        <p>Готовность часов и фактическая отправка — два отдельных действия. Готовые позиции заранее выбраны; ненужные снимите с выбора.</p>
      </div>
      <div className="watch-logistics-controls">
        {focusedOrderId&&<button type="button" className="secondary compact"
          onClick={()=>{setFocusedOrderId(null);setFilter('unshipped')}}>
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
        onClick={()=>setBrandScope(code)}>
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
          aria-pressed={filter===value} onClick={()=>setFilter(value)}>
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
    <WatchLogisticsTaskTable groups={groups} filter={filter}
      canCompleteEngraving={canCompleteEngraving} canDispatch={canDispatch}
      canCorrectDispatch={canCorrectDispatch} workingReady={saving}
      workingSend={dispatching} checkingOrder={checkingHandover}
      workingCorrection={correcting}
      onReady={(orderId,itemId)=>{void complete(orderId,itemId)}}
      onSend={(order,item,quantity)=>{void reviewSendHandover(order,[{...item,quantity}])}}
      onCorrect={correctDispatch} onOpenReturns={onOpenReturns}
      onOpenStock={onOpenStock}
    />
    {handoverPromptOrderId!==null&&(()=>{
      const group=allGroups.find(x=>x.order.orderId===handoverPromptOrderId)
      if(!group)return null
      return <WatchOrderHandoverPanel brand={group.order.brand} orderId={group.order.orderId}
        lines={group.items.filter(x=>x.orderItemId).map(x=>({
          id:Number(x.orderItemId),gender:x.gender||'',movement:x.movement||'',
          braceletMaterial:x.braceletMaterial||'',dialColor:x.dialColor||'',
          braceletColor:x.braceletColor||'',
        }))}
        onDone={()=>setRefreshKey(x=>x+1)}
        onClose={()=>setHandoverPromptOrderId(null)}
        onOpenStock={onOpenStock?()=>{
          setHandoverPromptOrderId(null)
          onOpenStock(group.order.brand)
        }:undefined}
      />
    })()}
    <StockResolutionConfirmModal prompt={stockPrompt?{
      title:stockPrompt.items.every(item=>item.stockWriteoffStatus==='catalog_retired')?
        'Подтверждение передачи архивных часов':'Уточнение остатка перед отправкой',
      intro:stockPrompt.items.every(item=>item.stockWriteoffStatus==='catalog_retired')?
        'Этот товар удалён из рабочего каталога. Остатки и резервы были выведены при удалении. Если часы физически передаются клиенту, логистика запишет отправку без повторного списания и без восстановления архивного SKU.':
        'По системе товара недостаточно. Сверьте количество выбранных часов перед отправкой. Остатки склада этим действием не изменяются.',
      items:stockPrompt.items.map(item=>({
        productName:item.modelName||'Часы',
        tracked:Math.max(0,Number(item.physicalQuantity||0)),
        needed:Math.max(1,Number(item.quantity||1)),
      })),
      trackedLabel:'По системе',
       neededLabel:'К отправке',
       question:'Эти часы физически есть для отправки?',
       actionLabel:stockPrompt.items.every(item=>item.stockWriteoffStatus==='catalog_retired')?
         'Да, часы переданы — записать отправку':'Да, часы в наличии — отправить',
      cancelLabel:'Остановить отправку',
      note:stockPrompt.items.every(item=>item.stockWriteoffStatus==='catalog_retired')?
        'Только для этих часов. Физический склад остаётся неизменным; готовность гравировки, историю выдач и факт удаления сервер проверяет отдельно.':
        'Подтверждение относится только к этой передаче. Сервер по-прежнему проверяет ревизию и статус резерва.',
    }:null}
      onDecision={confirmed=>{
        const pending=stockPrompt
        setStockPrompt(null)
        if(confirmed&&pending)void send(pending.order,pending.items,true)
      }}
    />
    {nextOffset!==null&&<button type="button" className="secondary" disabled={busy||loadingMore}
      onClick={()=>void loadMore()}>{loadingMore?'Загружаю…':'Показать ещё заказы'}</button>}
  </section>
}