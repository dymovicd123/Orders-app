import type {OrderItem} from '../../app/types'

type Props={
 item:OrderItem;index:number
 update:(index:number,field:keyof OrderItem,value:unknown)=>void
 formatMoney:(n:number)=>string
}
export function MainPickedOrderLine({item,index,update,formatMoney}:Props){
 const workshop=item.sourceType==='workshop'
 const numberField=(field:keyof OrderItem,v:unknown)=>update(index,field,v)
 const source=workshop?'Цех':item.sourceType==='boutique'?'Бутик':'Склад'
 return <div className="main-picked-order-line" data-exact-catalog-variant={item.catalogVariantId}>
  <div className="main-picked-order-identity">
    <strong>{item.productName}</strong>
    <small>{[item.audienceType,item.gender,item.color,item.material,item.length,item.size].filter(Boolean).join(' · ')}</small>
    <small>Источник: {source} · вариант каталога #{item.catalogVariantId}. Характеристики закреплены за выбранным товаром.</small>
    {workshop&&<small>Для цеха сохранён конкретный вариант. Физический остаток склада не резервируется.</small>}
    {!workshop&&Number.isFinite(item.physicalAtPick)&&<small>При выборе: {item.availableAtPick} из {item.physicalAtPick} свободно, {item.reservedAtPick} в резервах.</small>}
    {!workshop&&(item.shortageAcknowledged||Number(item.quantity||0)>Number(item.availableAtPick??Number.POSITIVE_INFINITY))&&<small>По показанным остаткам свободного количества недостаточно. Заказ сохранится с требованием уточнения склада; наличие не увеличивается автоматически.</small>}
  </div>
  <div className="main-picked-order-fields">
    <label>Количество
      <input type="number" min={1} max={1000} value={item.quantity??1}
       onChange={e=>numberField('quantity',Number(e.target.value))}/>
    </label>
    <label>Цена продажи, ₸
      <input type="number" min={0} value={item.unitPrice??''}
       onChange={e=>numberField('unitPrice',e.target.value)} placeholder="Цена продажи"/>
    </label>
    <div className="field-block">
      <span>Итого</span>
      <strong>{item.unitPrice===undefined||item.unitPrice===null||String(item.unitPrice).trim()===''?'—':formatMoney(Math.max(0,Number(item.unitPrice||0))*Math.max(0,Number(item.quantity||0)))}</strong>
      <small>По каталогу: {item.catalogPriceSnapshot==null?'цена не задана':formatMoney(item.catalogPriceSnapshot)}</small>
    </div>
    {workshop&&<>
      <label className="wide">Комментарий для цеха
        <textarea rows={3} value={item.workshopComment||''}
          onChange={e=>numberField('workshopComment',e.target.value)}
          placeholder="Уточнения изготовления именно этой позиции"/>
      </label>
      <label className="workshop-urgent-editor wide">
        <input type="checkbox" checked={Boolean(item.workshopUrgent)}
          onChange={e=>numberField('workshopUrgent',e.target.checked)}/>
        <span>Срочно для цеха</span>
      </label>
      {item.workshopUrgent&&<>
        <label>Нужно до
          <input type="date" value={item.workshopDueDate||''}
            onChange={e=>numberField('workshopDueDate',e.target.value)}/>
        </label>
        <label>Время
          <input type="time" value={item.workshopDueTime||''}
            onChange={e=>numberField('workshopDueTime',e.target.value)}/>
        </label>
      </>}
    </>}
  </div>
 </div>
}
