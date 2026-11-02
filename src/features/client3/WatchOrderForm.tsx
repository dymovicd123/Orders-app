import { useMemo, useState, type FormEvent } from 'react'
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
export function WatchOrderForm({allowedBrands,catalog,deliveryMethods,onSave}:Props) {
  const [brand,setBrand]=useState<WatchBrand>(allowedBrands[0]||'TAUWACH')
  const [source,setSource]=useState<WatchSource>('office')
  const [variantId,setVariantId]=useState(0)
  const [quantity,setQuantity]=useState(1)
  const [unitPrice,setUnitPrice]=useState('')
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
  const chosen=rows.find(x=>x.watchVariantId===variantId)
  const free=chosen?available(chosen,source):0
  const price=Number(unitPrice)
  const canSave=Boolean(
    allowedBrands.includes(brand)&&chosen&&chosen.catalogVariantId>0&&
    Number.isSafeInteger(quantity)&&quantity>0&&quantity<=free&&
    Number.isSafeInteger(price)&&price>=0&&!busy
  )
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    setError('')
    if(!canSave||!chosen){setError('Выберите доступные часы и укажите количество и цену.');return}
    try{
      const base=validateWatchOrderInput({
        brand,source,recipientName,recipientPhone,address,postalCode,city,deliveryMethod,
        shippingDeadlineLocal,urgent,paymentMethod,
      })
      setBusy(true)
      await onSave({
        ...base,watchVariantId:chosen.watchVariantId,catalogVariantId:chosen.catalogVariantId,
        quantity,catalogPriceSnapshot:chosen.catalogPriceSnapshot??null,unitPrice:price,
        engravingText:engravingText.trim(),
      })
    }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить заказ.')}finally{setBusy(false)}
  }
  return <form className="watch-order-form" onSubmit={event=>void submit(event)}>
    <header className="watch-order-form-header">
      <h2>Новый заказ часов</h2>
      <p>Бренд → место хранения → часы → гравировка и доставка</p>
    </header>
    <fieldset>
      <legend>Часы и наличие</legend>
      <div className="watch-order-form-grid">
        <label>Бренд
          <select value={brand} onChange={e=>{setBrand(e.target.value as WatchBrand);setVariantId(0)}}>
            {allowedBrands.map(b=><option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label>Откуда заберут часы
          <select value={source} onChange={e=>setSource(e.target.value as WatchSource)}>
            {WATCH_OPTIONS.sources.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </label>
        <label className="watch-order-form-wide">Модель и комплектация
          <select value={variantId} onChange={e=>{setVariantId(Number(e.target.value));setQuantity(1);setUnitPrice('')}} required>
            <option value={0}>Выберите часы из {source==='office'?'офиса':'витрины'}</option>
            {rows.map(row=><option key={row.watchVariantId} value={row.watchVariantId}
              disabled={!row.catalogVariantId||available(row,source)<=0}>
              {descriptor(row)} · доступно {available(row,source)}
            </option>)}
          </select>
        </label>
        <label>Количество
          <input type="number" min={1} max={Math.max(1,free)} step={1} value={quantity}
            onChange={e=>setQuantity(Number(e.target.value))} required/>
        </label>
        <label>Цена по каталогу
          <output>{chosen?.catalogPriceSnapshot==null?'Не задана':chosen.catalogPriceSnapshot.toLocaleString('ru-RU')+' ₸'}</output>
        </label>
        <label>Цена продажи, ₸
          <input type="number" min={0} step={1} value={unitPrice} onChange={e=>setUnitPrice(e.target.value)} required/>
        </label>
        <label>Способ оплаты
          <select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value as WatchPaymentMethod)}>
            {WATCH_PAYMENTS.map(p=><option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="watch-order-form-wide">Комментарий логисту · текст гравировки
          <textarea value={engravingText} onChange={e=>setEngravingText(e.target.value)}
            placeholder="Что выгравировать на этих часах" rows={2}/>
        </label>
      </div>
    </fieldset>
    <fieldset>
      <legend>Доставка · Казпочта и другие способы</legend>
      <div className="watch-order-form-grid">
        <label>ФИО получателя
          <input value={recipientName} onChange={e=>setRecipientName(e.target.value)} required/>
        </label>
        <label>Номер телефона
          <input type="tel" value={recipientPhone} onChange={e=>setRecipientPhone(e.target.value)} required/>
        </label>
        <label className="watch-order-form-wide">Полный адрес доставки
          <textarea rows={2} value={address} onChange={e=>setAddress(e.target.value)} required/>
        </label>
        <label>Индекс
          <input value={postalCode} onChange={e=>setPostalCode(e.target.value)} required/>
        </label>
        <label>Город
          <input value={city} onChange={e=>setCity(e.target.value)} required/>
        </label>
        <label>Способ доставки
          <select value={deliveryMethod} onChange={e=>setDeliveryMethod(e.target.value)} required>
            {deliveryMethods.map(x=><option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label>Отправить до · Алматы
          <input type="datetime-local" value={shippingDeadlineLocal}
            onChange={e=>setShippingDeadlineLocal(e.target.value)} required/>
        </label>
        <label className="watch-order-form-urgent">
          <input type="checkbox" checked={urgent} onChange={e=>setUrgent(e.target.checked)}/>
          Срочный заказ
        </label>
      </div>
    </fieldset>
    {chosen&&free<quantity?<p className="watch-order-form-error" role="alert">
      Доступно только {free} шт. в выбранном источнике. Переключите источник или количество.
    </p>:null}
    {error?<p className="watch-order-form-error" role="alert">{error}</p>:null}
    <button type="submit" className="primary" disabled={!canSave}>
      {busy?'Сохраняю…':'Сохранить заказ часов'}
    </button>
  </form>
}
