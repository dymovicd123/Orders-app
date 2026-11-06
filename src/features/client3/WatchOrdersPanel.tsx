import { Fragment, useEffect, useState } from 'react'
import {projectWatchOrderLikeMain} from './watchMainOrderProjection'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import {WatchReturnForm} from './WatchReturnForm'
import {WatchDebtPaymentForm} from './WatchDebtPaymentForm'
import {WatchReturnHistoryPanel} from './WatchReturnHistoryPanel'
import {watchItemFullyIssued,watchIssuedQuantity} from './watchItemLifecycle'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {WatchOrderCorrections} from './WatchOrderCorrections'
import {WatchAdminDeleteChainPanel} from './WatchAdminDeleteChainPanel'
import {WatchOrderHandoverPanel} from './WatchOrderHandoverPanel'
import '../../styles/client3-watch-orders.css'
import '../../styles/client3-main-orders-copied.css'
import '../../styles/client3-qa-main-parity-20261104.css'
import '../../styles/client3-watch-edit-buttons-20261104.css'

type WatchOrder={
  orderId:number;externalId:string;orderDate:string;managerName:string|null;managerId:number
  recipientName:string;recipientPhone:string;city:string;deliveryMethod:string;
  canonicalCustomerName:string;canonicalCustomerPhone:string;canonicalCity:string;
  canonicalDeliveryType:string;orderComment:string;orderStatus:string;
  deliveryAddress:string;postalCode:string;unresolvedReservations:number
  legacySource:'warehouse'|'boutique';shippingStatus:string;engravingStatus:string
  totalAmount:number;netSaleAmount:number;commercialReturnedValue:number;netPaidAmount:number;
  overpaymentAmount:number;legacyDebtAmount:number;
  receivedAmount:number;debtAmount:number;returnAmount:number
  committedReturnCount:number;committedItemReturnQuantity:number
  latestReturnDate:string|null
  lineCount:number;shippedLineCount:number;engravedLines:number;urgent:number;shippingDeadlineAt:string
  firstItemId:number|null;returnableQuantity:number;watchDescription:string|null
  stockHandoverReviewNeeded:boolean
  activeWatchVariantId:number|null
  paymentLines:string;itemLines:string
}
type Totals={orderCount:number;totalAmount:number;receivedAmount:number;debtAmount:number;returnAmount:number}
type OrdersResponse={ok:boolean;rows:WatchOrder[];totals:Totals;hasMore:boolean;message?:string}
const sum=(value:number)=>Number(value||0).toLocaleString('ru-RU')+' ₸'
const shipLabel=(order:WatchOrder)=>{
 const active=parsedRows<ItemLine>(order.itemLines).filter(x=>Number(x.quantity)>0)
 return active.length>0&&active.every(watchItemFullyIssued)?'Отправлено':
   active.some(x=>watchIssuedQuantity(x)>0)?'Частично отправлено':
   'Не отправлено'
}
type PaymentLine={id:number;method:string;amount:number;date:string;kind:string}
type ItemLine={id:number;productName:string;quantity:number;returnableQuantity:number;
  returnedQuantity:number;shippedQuantity:number;pendingReturnQuantity:number;unitPrice:number;
  lineTotal:number;catalogPriceSnapshot:number|null;source:string;shipped:number;
  stockWriteoffStatus:string;
  engravingText:string;engravingReady:number|boolean;gender:string;movement:string;braceletMaterial:string;
  dialColor:string;braceletColor:string}
function parsedRows<T>(raw:string|undefined):T[]{
  try{const rows=JSON.parse(raw||'[]') as unknown;return Array.isArray(rows)?rows as T[]:[]}catch{return []}
}
const initialMonth=()=>{
  const date=new Date(Date.now()+5*60*60*1000).toISOString()
  return date.slice(0,7)
}
export function WatchOrdersPanel({allowedBrands,initialBrand,initialFocusedOrder,onOpenLogistics,onOpenWorkflow,onOpenOrders,onOpenDebt,isAdmin=false,workflow='orders'}:{
  allowedBrands:readonly WatchBrand[];initialBrand?:WatchBrand;
  initialFocusedOrder?:{orderId:number;externalId:string;orderDate:string};
  onOpenLogistics?:(brand:WatchBrand,orderId:number)=>void;
  onOpenOrders?:()=>void;
  onOpenDebt?:(brand:WatchBrand,orderId:number,externalId:string)=>void;
  onOpenWorkflow?:(kind:'returns',order:{
    brand:WatchBrand;orderId:number;externalId:string;orderDate:string
  })=>void;
  isAdmin?:boolean
  workflow?:'orders'|'returns'
}) {
  const [brand,setBrand]=useState<WatchBrand>(initialBrand&&allowedBrands.includes(initialBrand)?initialBrand:allowedBrands[0]||'TAUWACH')
  const [month,setMonth]=useState(initialFocusedOrder?.orderDate.slice(0,7)||initialMonth)
  const [search,setSearch]=useState(initialFocusedOrder?.externalId||'')
  const [shipping,setShipping]=useState<'all'|'sent'|'not_sent'>('all')
  const [payment,setPayment]=useState<'all'|'debt'|'paid'>('all')
  const [query,setQuery]=useState(initialFocusedOrder?.externalId||'')
  const [page,setPage]=useState(0)
  const [refresh,setRefresh]=useState(0)
  const [data,setData]=useState<OrdersResponse|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [returnOrderId,setReturnOrderId]=useState<number|null>(
    workflow==='returns'?initialFocusedOrder?.orderId||null:null)
  const [debtOrderId,setDebtOrderId]=useState<number|null>(null)
  const [returnHistoryOrderId,setReturnHistoryOrderId]=useState<number|null>(null)
  const [editOrderId,setEditOrderId]=useState<number|null>(null)
  const [deleteOrderId,setDeleteOrderId]=useState<number|null>(null)
  const [handoverOrderId,setHandoverOrderId]=useState<number|null>(null)
  // Keep Main's dense orders table collapsed by default; detail opens only on request.
  const [,setExpanded]=useState<number|null>(null)
  const [,setExtraActionsOrderId]=useState<number|null>(null)
  const [expandedItemCounts,setExpandedItemCounts]=useState<Record<number,number>>({})
  const [expandedPaymentCounts,setExpandedPaymentCounts]=useState<Record<number,number>>({})
  useEffect(()=>{
    const controller=new AbortController()
    setBusy(true);setError('');setData(null)
    const params=new URLSearchParams({brand,limit:'50',offset:String(page*50),shipping,payment})
    if(month) {
      const [year,m]=month.split('-').map(Number)
      if(year>2000&&m>=1&&m<=12){
        params.set('from',month+'-01')
        const lastDay=new Date(Date.UTC(year,m,0)).getUTCDate()
        params.set('to',month+'-'+String(lastDay).padStart(2,'0'))
      }
    }
    if(query)params.set('q',query)
    void fetch('/api/client3/watches/orders?'+params,{
      credentials:'include',cache:'no-store',signal:controller.signal,
    }).then(async response=>{
      const result=await response.json() as OrdersResponse
      if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось загрузить заказы')
      if(!controller.signal.aborted)setData(result)
    }).catch(cause=>{
      if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Ошибка загрузки')
    }).finally(()=>{if(!controller.signal.aborted)setBusy(false)})
    return ()=>controller.abort()
  },[brand,month,query,page,refresh,shipping,payment])
  const editingOrder=workflow==='orders'&&editOrderId!==null
    ?data?.rows.find(row=>row.orderId===editOrderId):null
  const deletingOrder=workflow==='orders'&&isAdmin&&deleteOrderId!==null
    ?data?.rows.find(row=>row.orderId===deleteOrderId):null
  return <section className="watch-orders">
    <header className="watch-orders-header">
      <div><h2>{workflow==='returns'?'Оформление возвратов':'Список заказов'}</h2>
        <p>{workflow==='orders'?'Состав, оплаты и все операционные действия в исходной таблице Main.':
          'Возвраты открываются из строки нужного заказа в разделе «Все заказы».'}</p></div>
      <button type="button" disabled={busy} onClick={()=>setRefresh(x=>x+1)}>Обновить</button>
    </header>
    {workflow==='returns'&&data&&returnOrderId!==null&&
      <section className="watch-main-flow-workspace" aria-label="Оформить возврат">
        <div className="watch-main-flow-head"><h3>Возврат товара</h3>
          <button className="secondary compact" type="button"
            onClick={()=>setReturnOrderId(null)}>Закрыть форму</button></div>
        {data.rows.filter(o=>o.orderId===returnOrderId).map(o=>
          <WatchReturnForm key={o.orderId} brand={brand} order={o}
            onCancel={()=>setReturnOrderId(null)}
            onDone={()=>{setReturnOrderId(null);setRefresh(v=>v+1)}}/>)}
      </section>}
    {workflow==='returns'&&returnOrderId===null&&
      <section className="mini-panel debt-table-panel watch-main-select-from-orders">
        <div className="mini-panel-head">
          <div>
            <h3>Откройте возврат из таблицы заказов</h3>
            <p>Выберите заказ в разделе «Все заказы» и нажмите «Возврат» в его строке.</p>
          </div>
          {onOpenOrders&&<button type="button" className="secondary compact back-action"
            onClick={onOpenOrders}>К заказам</button>}
        </div>
      </section>}
    {workflow==='orders'&&<div className="watch-orders-filters">
      {isAdmin&&allowedBrands.length>1?<label>Бренд<select value={brand} onChange={e=>{setBrand(e.target.value as WatchBrand);setPage(0)}}>
        {allowedBrands.map(code=><option key={code} value={code}>{code}</option>)}
      </select></label>:<span className="watch-orders-fixed-brand">Бренд: <strong>{brand}</strong></span>}
      <label>Месяц<input type="month" value={month} onChange={e=>{setMonth(e.target.value);setPage(0)}}/></label>
      <label>Отправка
        <select value={shipping} onChange={e=>{setShipping(e.target.value as typeof shipping);setPage(0)}}>
          <option value="all">Все</option><option value="not_sent">Не отправлены</option>
          <option value="sent">Отправлены</option>
        </select>
      </label>
      <label>Оплата
        <select value={payment} onChange={e=>{setPayment(e.target.value as typeof payment);setPage(0)}}>
          <option value="all">Все</option><option value="debt">С долгом</option>
          <option value="paid">Без долга</option>
        </select>
      </label>
      <form onSubmit={e=>{e.preventDefault();setPage(0);setQuery(search.trim())}}>
        <label>Поиск по заказу, ФИО или телефону
          <input value={search} maxLength={100} onChange={e=>setSearch(e.target.value)} placeholder="Номер заказа или клиент"/>
        </label>
        <button type="submit">Найти</button>
      </form>
    </div>}
    {error&&<p role="alert" className="watch-orders-error">{error}</p>}
    {busy&&<p role="status">Загрузка заказов…</p>}
    {workflow==='orders'&&data&&(deletingOrder?<section className="watch-main-edit-workspace" aria-label={'Удаление заказа '+deletingOrder.externalId}>
      <header className="watch-main-edit-workspace-head">
        <div><h3>Удаление заказа {deletingOrder.externalId}</h3>
          <p>Администратор · проверка возвратов, финансов и фактической отправки. Перед выполнением будут показаны последствия.</p></div>
        <button type="button" className="secondary back-action" onClick={()=>setDeleteOrderId(null)}>Назад к заказам</button>
      </header>
      <WatchAdminDeleteChainPanel key={'delete-'+deletingOrder.orderId} brand={brand}
        orderId={deletingOrder.orderId} externalId={deletingOrder.externalId}
        onClose={()=>setDeleteOrderId(null)}
        onDone={()=>{setDeleteOrderId(null);setRefresh(v=>v+1)}}/>
    </section>:editingOrder?<section className="watch-main-edit-workspace" aria-label={'Редактирование заказа '+editingOrder.externalId}>
      <WatchOrderCorrections key={'edit-'+editingOrder.orderId} brand={brand} order={editingOrder} isAdmin={isAdmin}
        onCancel={()=>setEditOrderId(null)} onDone={()=>{setEditOrderId(null);setRefresh(v=>v+1)}}/>
    </section>:<>
      <div className="watch-orders-summary">
        <div><small>Заказов</small><strong>{data.totals.orderCount}</strong></div>
        <div><small>Сумма заказов</small><strong>{sum(data.totals.totalAmount)}</strong></div>
        <div><small>Получено</small><strong>{sum(data.totals.receivedAmount)}</strong></div>
        <div><small>Остаток долга</small><strong>{sum(data.totals.debtAmount)}</strong></div>
        <div><small>Учтено возвратов</small><strong>{sum(data.totals.returnAmount)}</strong></div>
      </div>
      <p className="watch-orders-note">Отправка отдельно проверяет ревизию, резерв, готовность гравировки и факт передачи. Возвраты не блокируют прочие операции. Для закрытия долга используйте отдельную вкладку «Закрытие долга».</p>

      {data.rows.length===0?<p>Заказов за выбранный период нет.</p>:
        <LinkedTableScroll className="watch-main-orders-scroll" ariaLabel="Горизонтальная прокрутка таблицы заказов">
          <table className="data-table orders-table watch-main-orders-table">
            <thead><tr>
              <th>Заказ</th><th>Клиент</th><th>Товары</th>
              <th>Доставка</th><th>Оплата</th><th>Действия</th>
            </tr></thead>
            <tbody>{data.rows.map(order=>{
              const {operational,shipment}=projectWatchOrderLikeMain(order,isAdmin)
              const lines=parsedRows<ItemLine>(order.itemLines)
              const payments=parsedRows<PaymentLine>(order.paymentLines)
              const visibleItems=Math.max(3,expandedItemCounts[order.orderId]||3)
              const visiblePayments=Math.max(2,expandedPaymentCounts[order.orderId]||2)
              const rowActionOpen=handoverOrderId===order.orderId||
                returnHistoryOrderId===order.orderId||
                returnOrderId===order.orderId||debtOrderId===order.orderId
              const openReturn=()=>{
                if(onOpenWorkflow){onOpenWorkflow('returns',{
                  brand,orderId:order.orderId,externalId:order.externalId,orderDate:order.orderDate
                });return}
                setExpanded(order.orderId)
                setReturnOrderId(order.orderId)
              }
              const showDetailAction=(type:'edit'|'handover')=>{
                setExpanded(order.orderId);setExtraActionsOrderId(null)
                if(type==='edit'){setEditOrderId(order.orderId);setHandoverOrderId(null)}
                if(type==='handover'){setHandoverOrderId(order.orderId);setEditOrderId(null)}
              }
              return <Fragment key={order.orderId}>
              <tr data-order-id={order.orderId} className={'watch-main-order-row'+
                (rowActionOpen?' is-open':'')+
                (operational.hasCommittedDownstreamOperation?' row-returned':'')}>
                <td className="watch-main-ref-col"><div className="order-cell-stack">
                  <strong>{order.orderDate}</strong>
                  <span>{order.externalId||'#'+order.orderId}</span>
                  <small>Менеджер: {order.managerName||'—'}</small>
                  {order.urgent===1&&<small className="watch-main-urgent">Срочно</small>}
                </div></td>
                <td className="watch-main-client-col"><div className="order-cell-stack">
                  <strong>{order.recipientName||'—'}</strong>
                  <small>{order.recipientPhone}</small>
                  <small>{order.city||'—'}</small>
                </div></td>
                <td className="watch-main-order-sku">
                  <div className="order-items-inline">
                    {lines.slice(0,visibleItems).map((line,index)=>
                      <div className="order-item-chip order-item-card" key={line.id}>
                        <div className="order-item-card-head">
                          <strong>{line.productName}</strong>
                          <span className="order-item-quantity-badge">× {line.quantity}</span>
                        </div>
                        <span className="order-item-card-details">{[
                          line.gender==='male'?'Мужские':line.gender==='female'?'Женские':'',
                          watchReferenceLabel('movements',line.movement),
                          watchReferenceLabel('bracelets',line.braceletMaterial),
                          watchReferenceLabel('dials',line.dialColor),
                          line.braceletColor?'Ремешок: '+watchReferenceLabel('leatherColors',line.braceletColor):'',
                        ].filter(Boolean).join(' · ')}</span>
                        <small className={'order-item-shipment-status is-'+(shipment.lines[index]?.state||'not_sent')}>
                          {shipment.lines[index]?.label||'Отправка не уточнена'}
                        </small>
                        {Number(line.returnedQuantity||0)>0&&
                          <span className="soft-badge watch-item-returned">
                            Возвращено {line.returnedQuantity} шт.
                          </span>}
                        {line.engravingText&&<div className="watch-engraving-order-state">
                          <small>Гравировка: {line.engravingText}</small>
                          <span className={'watch-engraving-ready-pill '+(line.engravingReady?'is-ready':'is-pending')}>
                            {line.engravingReady?'Гравировка готова':'Ожидает подтверждения'}
                          </span>
                        </div>}
                        <div className="order-item-chip-meta">
                          <span className={'order-item-source-badge source-'+
                            (line.source==='boutique'?'boutique':'warehouse')}>
                            {line.source==='boutique'?'Витрина':'Офис'}
                          </span>
                        </div>
                      </div>)}
                    {lines.length>visibleItems&&
                      <button className="order-item-chip order-item-chip-more is-clickable" type="button"
                        onClick={()=>setExpandedItemCounts(current=>({...current,
                          [order.orderId]:Math.min(lines.length,visibleItems+5)}))}>
                        + ещё {lines.length-visibleItems}
                      </button>}
                    {visibleItems>3&&lines.length>3&&
                      <button className="order-item-chip order-item-chip-collapse is-clickable" type="button"
                        onClick={()=>setExpandedItemCounts(current=>{
                          const next={...current};delete next[order.orderId];return next
                        })}>Скрыть</button>}
                  </div>
                </td>
                <td className="watch-main-order-delivery">
                  <strong>{order.deliveryMethod||'—'}</strong>
                  <small>{order.shippingDeadlineAt?'До '+new Date(order.shippingDeadlineAt).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'}):'Без срока'}</small>
                  <span className={'status-pill '+(shipment.state==='sent'?'status-online':shipment.state==='partial'?'status-warning':'status-neutral')}>
                    {shipLabel(order)}
                  </span>
                  {order.urgent===1&&<small className="watch-main-urgent">Срочно</small>}
                  {parsedRows<ItemLine>(order.itemLines).some(x=>x.engravingText)&&
                    <small>Есть текст гравировки</small>}
                </td>
                <td className="watch-main-finance-col">
                  <div className="watch-main-finance-head">
                    <strong>{sum(order.netSaleAmount)}</strong>
                    <span className={'watch-main-finance-balance'+(order.debtAmount>0?' is-debt':'')}>
                      {order.debtAmount>0?'Долг '+sum(order.debtAmount):
                        order.overpaymentAmount>0?'Переплата '+sum(order.overpaymentAmount):'Оплачено'}
                    </span>
                  </div>
                  <small>Получено {sum(order.receivedAmount)}</small>
                  {order.returnAmount>0&&<small>Возвращено денег {sum(order.returnAmount)}</small>}
                  {order.commercialReturnedValue>0&&<small>Зачёт товаров {sum(order.commercialReturnedValue)}</small>}
                  <div className="watch-main-finance-methods">
                    {payments.slice(0,visiblePayments).map(line=>
                      <span className="watch-main-method-chip" key={line.id}>
                        {line.method}: {sum(line.amount)}</span>)}
                    {payments.length>visiblePayments&&<button type="button" className="secondary compact"
                      onClick={()=>setExpandedPaymentCounts(v=>({...v,[order.orderId]:payments.length}))}>
                      + ещё {payments.length-visiblePayments} оплат</button>}
                  </div>
                </td>
                <td className="watch-main-actions-col">
                  <div className="order-table-actions watch-main-row-actions">
                    {workflow==='orders'&&onOpenLogistics&&
                      <button type="button" className="primary compact"
                        onClick={()=>onOpenLogistics(brand,order.orderId)}>
                        {shipLabel(order)==='Отправлено'?'Отправки':'Отправить'}
                      </button>}
                    {workflow==='orders'&&onOpenLogistics&&
                      lines.some(line=>line.engravingText?.trim()&&!line.engravingReady)&&
                      <button type="button" className="secondary compact watch-engraving-nav"
                        onClick={()=>onOpenLogistics(brand,order.orderId)}>
                        Готовность гравировки
                      </button>}
                    {(workflow==='orders'||workflow==='returns')&&operational.canOpenReturn&&
                      <button type="button" className="secondary compact"
                        onClick={openReturn}>Возврат</button>}
                    {workflow==='orders'&&<button type="button" className="secondary compact"
                      onClick={()=>showDetailAction('edit')}>{isAdmin?'Полное редактирование':'Исправить · доп. действия'}</button>}
                    {workflow==='orders'&&isAdmin&&<button type="button"
                      className="secondary compact watch-order-delete-direct"
                      onClick={()=>{setEditOrderId(null);setDeleteOrderId(order.orderId)}}>Удалить заказ</button>}
                    {workflow==='orders'&&order.debtAmount>0&&
                      <button type="button" className="secondary compact debt-action-button"
                        onClick={()=>onOpenDebt?onOpenDebt(brand,order.orderId,order.externalId):
                          setDebtOrderId(v=>v===order.orderId?null:order.orderId)}>
                        Закрыть долг
                      </button>}
                    {workflow==='orders'&&Boolean(order.stockHandoverReviewNeeded)&&
                      <button type="button" className="secondary compact order-stock-handover-trigger"
                        onClick={()=>showDetailAction('handover')}>Проверить выдачу</button>}
                    {workflow==='orders'&&order.committedReturnCount>0&&
                      <button type="button" className="secondary compact" onClick={()=>{
                        setExpanded(order.orderId);setReturnHistoryOrderId(order.orderId)
                      }}>История возвратов</button>}
                  </div>
                </td>
              </tr>
              {workflow==='orders'&&rowActionOpen&&<tr className="watch-main-order-expanded"><td colSpan={6}>
                <section className="watch-main-order-detail" aria-label={'Действия по заказу '+order.externalId}>
                  <header className="watch-order-action-head">
                    <strong>Заказ {order.externalId}</strong>
                    <button type="button" className="secondary compact" onClick={()=>{
                      setEditOrderId(null);setHandoverOrderId(null);
                      setReturnHistoryOrderId(null);
                      setReturnOrderId(null);setDebtOrderId(null);setExpanded(null)
                    }}>Закрыть действие</button>
                  </header>
                  {Boolean(order.stockHandoverReviewNeeded)&&handoverOrderId===order.orderId&&<WatchOrderHandoverPanel
                    brand={brand} orderId={order.orderId}
                    lines={parsedRows<ItemLine>(order.itemLines)}
                    onDone={()=>setRefresh(v=>v+1)}
                    onClose={()=>setHandoverOrderId(null)}/>}
                  {debtOrderId===order.orderId&&<WatchDebtPaymentForm
                    brand={brand} orderId={order.orderId} externalId={order.externalId||'#'+order.orderId}
                    debt={order.debtAmount} onCancel={()=>setDebtOrderId(null)}
                    onDone={()=>{setDebtOrderId(null);setRefresh(v=>v+1)}}/>}
                  {returnOrderId===order.orderId&&<WatchReturnForm brand={brand} order={order}
                    onCancel={()=>setReturnOrderId(null)}
                    onDone={()=>{setReturnOrderId(null);setRefresh(v=>v+1)}}/>}
                  {returnHistoryOrderId===order.orderId&&<WatchReturnHistoryPanel
                    brand={brand} orderId={order.orderId}
                    onClose={()=>setReturnHistoryOrderId(null)}
                    onDone={()=>setRefresh(v=>v+1)}/>}
                </section>
              </td></tr>}
              </Fragment>})}</tbody>
          </table>
        </LinkedTableScroll>}
      <div className="watch-orders-pages">
        <button type="button" disabled={busy||page===0} onClick={()=>setPage(x=>x-1)}>Назад</button>
        <span>Страница {page+1}</span>
        <button type="button" disabled={busy||!data.hasMore} onClick={()=>setPage(x=>x+1)}>Дальше</button>
      </div>
    </>)}
  </section>
}
