import { useMemo, useRef, useState, type FormEvent } from 'react'
import '../../styles/client3-watch-order.css'
import {
  WATCH_OPTIONS, WATCH_PAYMENTS, validateWatchOrderInput,
  type WatchBrand, type WatchSource, type WatchPaymentMethod,
} from '../../../shared/client3/watch-domain'

export type WatchOrderChoice = {
  brand: WatchBrand
  watchProductId: number
  watchVariantId: number
  catalogVariantId: number
  modelName: string
  gender: 'male' | 'female'
  movement: 'quartz' | 'mechanical'
  braceletMaterial: 'steel' | 'leather' | 'rubber'
  dialColor: 'black' | 'white' | 'silver' | 'gold' | 'green' | 'orange' | 'brown' | 'multicolor'
  braceletColor: string
  officePhysical: number
  officeReserved: number
  showcasePhysical: number
  showcaseReserved: number
  catalogPriceSnapshot?: number | null
}
export type WatchOrderDraftPayload = ReturnType<typeof validateWatchOrderInput> & {
  shippingDeadlineLocal: string
  requestId: string
  receivedAmount: number
  managerId?: number
  watchVariantId: number
  catalogVariantId: number
  quantity: number
  catalogPriceSnapshot: number | null
  unitPrice: number
  engravingText: string
}
type Props = {
  allowedBrands: readonly WatchBrand[]
  catalog: readonly WatchOrderChoice[]
  managers?: readonly {brand:WatchBrand;id:number;name:string}[]
  isAdmin?: boolean
  deliveryMethods: readonly string[]
  onSave: (draft: WatchOrderDraftPayload) => Promise<void> | void
}
const genderLabel=(v:string)=>v==='male'?'Мужские':'Женские'
const fromOptions=(rows:readonly {value:string,label:string}[],v:string)=>
  rows.find(x=>x.value===v)?.label||v
function available(row:WatchOrderChoice,source:WatchSource):number {
  return Math.max(0,Number(source==='office'?row.officePhysical-row.officeReserved:
    row.showcasePhysical-row.showcaseReserved)||0)
}
function descriptor(row:WatchOrderChoice):string {
  const movement=fromOptions(WATCH_OPTIONS.movements,row.movement)
  const bracelet=fromOptions(WATCH_OPTIONS.braceletMaterials,row.braceletMaterial)
  const dial=fromOptions(WATCH_OPTIONS.dialColors,row.dialColor)
  return [row.modelName,genderLabel(row.gender),movement,bracelet,'циферблат: '+dial,
    ...(row.braceletMaterial==='leather'?['ремешок: '+row.braceletColor]:[])].join(' · ')
}

/** Tenant-specific draft. Caller must POST only through authorized Client3 API. */
export function WatchOrderForm({allowedBrands,catalog,managers=[],isAdmin=false,deliveryMethods,onSave}:Props) {
  const [brand,setBrand]=useState<WatchBrand|''>('')
  const [source,setSource]=useState<WatchSource|''>('')
  const [variantId,setVariantId]=useState(0)
  const [quantity,setQuantity]=useState(1)
  const [unitPrice,setUnitPrice]=useState('')
  const [receivedAmount,setReceivedAmount]=useState('0')
  const [managerId,setManagerId]=useState(0)
  const requestRef=useRef<{fingerprint:string;requestId:string}|null>(null)
  const [engravingText,setEngravingText]=useState('')
  const [recipientName,setRecipientName]=useState('')
  const [recipientPhone,setRecipientPhone]=useState('')
  const [address,setAddress]=useState('')
  const [postalCode,setPostalCode]=useState('')
  const [city,setCity]=useState('')
  const [deliveryMethod,setDeliveryMethod]=useState(deliveryMethods[0]||'')
  const [shippingDeadlineLocal,setShippingDeadlineLocal]=useState('')
  const [urgent,setUrgent]=useState(false)
  const [paymentMethod,setPaymentMethod]=useState<WatchPaymentMethod>('KASPI GOLD')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const rows=useMemo(()=>catalog.filter(x=>x.brand===brand),[catalog,brand])
  const staff=managers.filter(x=>x.brand===brand)
  const chosen=rows.find(x=>x.watchVariantId===variantId)
  const free=chosen&&source?available(chosen,source):0
  const price=Number(unitPrice)
  const canSave=Boolean(
    brand!==''&&source!==''&&allowedBrands.includes(brand as WatchBrand)&&chosen&&chosen.catalogVariantId>0&&
    Number.isSafeInteger(quantity)&&quantity>0&&quantity<=free&&
    unitPrice.trim()!==''&&Number.isSafeInteger(price)&&price>=0&&Number.isSafeInteger(price*quantity)&&
    receivedAmount.trim()!==''&&Number.isSafeInteger(Number(receivedAmount))&&
    Number(receivedAmount)>=0&&Number(receivedAmount)<=price*quantity&&
    (!isAdmin||staff.some(x=>x.id===managerId))&&!busy
  )
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    setError('')
    if(!canSave||!chosen||!brand||!source){setError('Укажите бренд, источник, точную комплектацию, количество и цену.');return}
    try{
      const base=validateWatchOrderInput({
        brand,source,recipientName,recipientPhone,address,postalCode,city,deliveryMethod,
        shippingDeadlineLocal,urgent,paymentMethod,
      })
      const payload={...base,shippingDeadlineLocal,
        watchVariantId:chosen.watchVariantId,catalogVariantId:chosen.catalogVariantId,
        quantity,catalogPriceSnapshot:chosen.catalogPriceSnapshot??null,unitPrice:price,
        receivedAmount:Number(receivedAmount),engravingText:engravingText.trim(),
        ...(isAdmin?{managerId}:{})}
      const fingerprint=JSON.stringify(payload)
      if(requestRef.current?.fingerprint!==fingerprint)
        requestRef.current={fingerprint,requestId:'watch-'+crypto.randomUUID()}
      setBusy(true)
      await onSave({
        ...payload,requestId:requestRef.current!.requestId,
      })
    }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить заказ.')}finally{setBusy(false)}
  }
  const total=unitPrice.trim()!==''&&Number.isSafeInteger(price*quantity)?price*quantity:0
  const received=Number(receivedAmount)||0
  const debt=Math.max(0,total-received)
  return <form className="main-watch-create card wide sector-orders" id="create"
    onSubmit={event=>void submit(event)}>
    <div className="create-hero">
      <div><div className="card-label">Новый заказ</div>
        <div className="card-meta">Выберите бренд и точку, затем заполните данные, часы и оплату.</div></div>
      <div className="orders-workspace-kpis create-kpis">
        <div><span>Товаров</span><strong>{chosen?quantity:0}</strong></div>
        <div><span>Оплат</span><strong>{received>0?1:0}</strong></div>
        <div><span>Долг</span><strong>{chosen&&unitPrice.trim()!==''?debt.toLocaleString('ru-RU')+' ₸':'—'}</strong></div>
      </div>
    </div>
    <section className="order-step-card">
      <div className="order-step-head"><div className="order-step-index">1</div>
        <div><h3>Клиент и условия заказа</h3>
          <p>Бренд и источник выбираются до товара. Данные получателя и условия отправки.</p></div>
      </div>
      <div className="main-watch-create-grid">
        <label>Бренд *
          <select required value={brand} onChange={e=>{
            setBrand(e.target.value as WatchBrand);setSource('');setVariantId(0);
            setManagerId(0);setQuantity(1);setUnitPrice('');setError('')
          }}>
            <option value="">Выберите бренд</option>
            {allowedBrands.map(value=><option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>Источник *
          <select required value={source} disabled={!brand} onChange={e=>{
            setSource(e.target.value as WatchSource);setVariantId(0);
            setQuantity(1);setUnitPrice('');setError('')
          }}>
            <option value="">Выберите источник</option>
            {WATCH_OPTIONS.sources.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
          <small>{!brand?'Сначала выберите бренд':'Часы предлагаются только из выбранной точки'}</small>
        </label>
        <div className="main-watch-create-spacer" aria-hidden="true"/>
        <label>ФИО получателя *
          <input required value={recipientName} onChange={e=>setRecipientName(e.target.value)}
            autoComplete="name"/>
        </label>
        <label>Телефон клиента *
          <input type="tel" required value={recipientPhone}
            onChange={e=>setRecipientPhone(e.target.value)} autoComplete="tel"/>
        </label>
        <label>Город *
          <input required value={city} onChange={e=>setCity(e.target.value)}/>
        </label>
        <label>Доставка *
          <select required value={deliveryMethod} onChange={e=>setDeliveryMethod(e.target.value)}>
            {deliveryMethods.map(x=><option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label>Почтовый индекс *
          <input required value={postalCode} onChange={e=>setPostalCode(e.target.value)}/>
        </label>
        <label>Отправить до · Алматы *
          <input type="datetime-local" required value={shippingDeadlineLocal}
            onChange={e=>setShippingDeadlineLocal(e.target.value)}/>
        </label>
        <label className="main-watch-create-wide">Полный адрес доставки *
          <textarea required rows={2} value={address} onChange={e=>setAddress(e.target.value)}/>
        </label>
        <label className="main-watch-create-urgent"><input type="checkbox" checked={urgent}
          onChange={e=>setUrgent(e.target.checked)}/>Срочный заказ</label>
      </div>
    </section>
    <section className="order-step-card">
      <div className="order-step-head order-step-head-split">
        <div className="order-step-head-main"><div className="order-step-index">2</div>
          <div><h3>Товары в заказе</h3>
            <p>Показываются только часы выбранного бренда и источника. Цена и наличие проверяются перед сохранением.</p></div>
        </div>
      </div>
      {!brand||!source?<div className="main-watch-create-placeholder">
        Сначала выберите бренд и источник в первом блоке.
      </div>:<div className="main-watch-create-item">
        <div className="main-watch-create-item-head"><strong>Позиция 1</strong>
          <span>{brand} · {source==='office'?'Офис':'Витрина'}</span></div>
        <div className="main-watch-create-grid">
          <label className="main-watch-create-wide">Модель и комплектация *
            <select required value={variantId} onChange={e=>{
              const x=rows.find(row=>row.watchVariantId===Number(e.target.value))
              setVariantId(Number(e.target.value));setQuantity(1)
              setUnitPrice(x?.catalogPriceSnapshot==null?'':String(x.catalogPriceSnapshot))
            }}>
              <option value={0}>Выберите часы из {source==='office'?'офиса':'витрины'}</option>
              {rows.filter(x=>x.catalogVariantId&&available(x,source)>0).map(row=>
                <option key={row.watchVariantId} value={row.watchVariantId}>
                  {descriptor(row)} · доступно {available(row,source)}
                </option>)}
            </select>
            <small>{!rows.some(x=>x.catalogVariantId&&available(x,source)>0)?
              'Свободных часов на этой точке нет. Переключите источник или оформите приход.':
              'В списке только подготовленные и доступные комплектации.'}</small>
          </label>
          <label>Количество *
            <input type="number" required min={1} step={1} max={Math.max(1,free)}
              value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/>
          </label>
          <label>Цена по каталогу
            <output>{chosen?.catalogPriceSnapshot==null?'Нет цены':
              chosen.catalogPriceSnapshot.toLocaleString('ru-RU')+' ₸'}</output>
          </label>
          <label>Цена продажи, ₸ *
            <input type="number" required min={0} step={1} value={unitPrice}
              onChange={e=>setUnitPrice(e.target.value)}/>
          </label>
          <label className="main-watch-create-wide">Комментарий логисту / текст гравировки
            <textarea rows={2} value={engravingText} onChange={e=>setEngravingText(e.target.value)}
              placeholder="Надпись для гравировки и уточнения для логиста"/>
          </label>
        </div>
        {chosen&&free<quantity&&<p className="main-watch-create-validation" role="alert">
          Доступно {free} шт. в этой точке. Уменьшите количество или смените источник.
        </p>}
      </div>}
    </section>
    <section className="order-step-card">
      <div className="order-step-head"><div className="order-step-index">3</div>
        <div><h3>Оплаты</h3>
          <p>Укажите способ оплаты и фактически полученную сумму. Остальное останется долгом.</p></div>
      </div>
      <div className="main-watch-create-item">
        <div className="main-watch-create-item-head"><strong>Оплата 1</strong>
          <span>{total.toLocaleString('ru-RU')} ₸ по заказу</span></div>
        <div className="main-watch-create-grid">
          {isAdmin&&<label>Менеджер *
            <select required value={managerId} onChange={e=>setManagerId(Number(e.target.value))}>
              <option value={0}>Выберите менеджера бренда</option>
              {staff.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}
            </select>
          </label>}
          <label>Способ оплаты
            <select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value as WatchPaymentMethod)}>
              {WATCH_PAYMENTS.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>Получено от клиента, ₸ *
            <input type="number" min={0} step={1} max={Math.max(0,total)} required
              value={receivedAmount} onChange={e=>setReceivedAmount(e.target.value)}/>
          </label>
        </div>
      </div>
    </section>
    <section className="order-step-card">
      <div className="order-step-head"><div className="order-step-index">4</div>
        <div><h3>Проверка заказа</h3>
          <p>Перед сохранением сверьте выбранные часы, источник, оплату и долг.</p></div>
      </div>
      <div className="main-watch-create-review">
        <div className="order-create-item-summary-head"><strong>Итог по заказу</strong>
          <span>{canSave?'Готов к сохранению':'Нужно проверить'}</span></div>
        <div className="main-watch-create-totals">
          <div><span>ИТОГО ПО ПОЗИЦИЯМ</span><strong>{chosen&&unitPrice!==''?total.toLocaleString('ru-RU')+' ₸':'—'}</strong></div>
          <div><span>ПОЛУЧЕНО</span><strong>{received.toLocaleString('ru-RU')} ₸</strong></div>
          <div><span>ДОЛГ</span><strong>{chosen&&unitPrice!==''?debt.toLocaleString('ru-RU')+' ₸':'—'}</strong></div>
          <div><span>ПОЗИЦИИ</span><strong>{chosen?'1':'0'}</strong></div>
        </div>
        <div className="main-watch-create-summary">
          <strong>Состав заказа</strong>
          <div><span>{chosen?descriptor(chosen):'Товар не выбран'}</span>
            {chosen&&<b>{source==='office'?'Офис':'Витрина'} · × {quantity}</b>}</div>
        </div>
        {!brand||!source?<p className="main-watch-create-validation">Выберите бренд и источник.</p>:null}
        {!chosen&&<p className="main-watch-create-validation">Выберите часы из доступных остатков.</p>}
        {chosen&&unitPrice.trim()===''&&<p className="main-watch-create-validation">Укажите цену продажи.</p>}
        {isAdmin&&managerId===0&&<p className="main-watch-create-validation">Выберите менеджера бренда.</p>}
        {error&&<p role="alert" className="main-watch-create-validation">{error}</p>}
        <div className="actions order-create-actions form-bottom-actions">
          <button className="primary" type="submit" disabled={!canSave}>
            {busy?'Сохраняю…':'Сохранить заказ'}</button>
          <button className="secondary" type="reset" disabled={busy}
            onClick={e=>{e.preventDefault()
              if(!window.confirm('Очистить введённые данные?'))return
              setBrand('');setSource('');setVariantId(0);setQuantity(1);setUnitPrice('')
              setReceivedAmount('0');setManagerId(0);setEngravingText('');setRecipientName('')
              setRecipientPhone('');setAddress('');setPostalCode('');setCity('')
              setShippingDeadlineLocal('');setUrgent(false);setError('');requestRef.current=null}}>
            Очистить форму</button>
        </div>
      </div>
    </section>
  </form>
}
