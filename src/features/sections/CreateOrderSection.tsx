// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import {useEffect,useState} from 'react'
import {pickerKey,type OrderPickerChoice,type SourceKey} from '../orders/MainOrderSourcePicker'
import {MainClothingSourcePicker} from '../orders/MainClothingSourcePicker'
import {MainPickedOrderLine} from '../orders/MainPickedOrderLine'
import {MainWorkshopOrderModal,type WorkshopOrderFields,type ManualSource,type ManualOrderPreset} from '../orders/MainWorkshopOrderModal'
import '../../styles/188f-stock-trust.css'
type SectionContext = Record<string, any>

export function CreateOrderSection({ ctx }: { ctx: SectionContext }) {
  const {
    addCreateItem,
    addCreatePayment,
    applyCreateProductPick,
    ChoicePills,
    createDraft,
    createOrderFromDraft,
    createPricing,
    createTotals,
    resetCreateOrderDraft,
    formatMoney,
    formatOrderItemDetails,
    formatOrderItemTitle,
    FriendlyNumberInput,
    ManagerPicker,
    normalizeAudienceTypeValue,
    normalizeSuggestion,
    orderBusy,
    orderPanelStyle,
    references,
    removeCreateItem,
    removeCreatePayment,
    renderOrderSizeSelect,
    renderOrderSourceAvailability,
    sectorStyle,
    setCreateDraft,
    setOrderPanel,
    SmartPickerInput,
    sourceLabel,
    suggestionValues,
    updateCreateDraft,
    updateCreateItem,
    updateCreatePayment,
  } = ctx

  const [workshopOpen,setWorkshopOpen]=useState(false)
  const [manualSource,setManualSource]=useState<ManualSource>('workshop')
  const [manualPreset,setManualPreset]=useState<ManualOrderPreset|null>(null)
  const [workshopEditing,setWorkshopEditing]=useState<number|null>(null)
  const [notice,setNotice]=useState<{message:string;id:number}|null>(null)
  useEffect(()=>{
    if(!notice)return
    const timer=setTimeout(()=>setNotice(null),2200)
    return ()=>clearTimeout(timer)
  },[notice])
  const notify=(message:string)=>setNotice({message,id:Date.now()})
  const actualItems=createDraft.items.filter((item:any)=>item.catalogVariantId||String(item.productName||'').trim())
  const [editingIndex,setEditingIndex]=useState<number|null>(null)
  const [pickerPending,setPickerPending]=useState(false)
  const [pickerRevision,setPickerRevision]=useState(0)
  const allocated=new Map<string,number>()
  for(const item of createDraft.items){
    if(!item.catalogVariantId||item.sourceType==='workshop')continue
    const source=item.sourceType==='boutique'?'boutique':'warehouse'
    const key=pickerKey(source,item.catalogVariantId)
    allocated.set(key,(allocated.get(key)||0)+Math.max(0,Number(item.quantity)||0))
  }
  const startManual=(origin:ManualSource='workshop',preset?:ManualOrderPreset)=>{
    setEditingIndex(null);setManualSource(origin);setManualPreset(preset||null)
    setWorkshopEditing(null);setWorkshopOpen(true)
  }
  const editManual=(index:number)=>{setEditingIndex(null);setManualPreset(null);setManualSource(createDraft.items[index]?.sourceType||'workshop');setWorkshopEditing(index);setWorkshopOpen(true)}
  const saveWorkshop=(item:WorkshopOrderFields)=>{
    setCreateDraft((current:any)=>({
      ...current,
      items:workshopEditing!==null&&current.items[workshopEditing]
        ?current.items.map((old:any,index:number)=>index===workshopEditing?{...old,...item}:old)
        :[...current.items.filter((old:any)=>old.catalogVariantId||String(old.productName||'').trim()),item],
    }))
    notify(workshopEditing===null
      ?item.sourceType==='workshop'?'Товар в цех добавлен в заказ':'Товар добавлен в заказ'
      :'Позиция обновлена')
    setWorkshopOpen(false);setWorkshopEditing(null);setManualPreset(null)
  }
  const chooseVariant=(choice:OrderPickerChoice,source:SourceKey|'workshop',fields:any,insufficient:boolean)=>{
    const previous=editingIndex===null?null:createDraft.items[editingIndex]
    const own=previous&&Number(previous.catalogVariantId)===choice.variantId&&previous.sourceType===source
      ?Math.max(0,Number(previous.quantity)||0):0
    const already=source==='workshop'?0:allocated.get(pickerKey(source,choice.variantId))||0
    const available=source==='workshop'?0:Math.max(0,choice[source].free-already+own)
    const item={
      ...(previous||{}),
      productName:choice.productName,catalogVariantId:choice.variantId,manualCatalogEntry:false,
      audienceType:choice.category==='child'?'ДЕТСКИЙ':'ВЗРОСЛЫЙ',
      gender:choice.gender,color:choice.color,material:choice.material,
      length:choice.length,size:choice.size,
      sourceType:source,quantity:fields.quantity,
      availableAtPick:source==='workshop'?undefined:available,
      physicalAtPick:source==='workshop'?undefined:choice[source].physical,
      reservedAtPick:source==='workshop'?undefined:choice[source].reserved,
      unitPrice:fields.unitPrice,
      catalogPriceSnapshot:choice.salePrice,
      priceOrigin:choice.salePrice===null?'manual':fields.unitPrice===choice.salePrice?'catalog':'manual',
      priceNeedsConfirmation:false,
      shortageAcknowledged:source!=='workshop'&&(insufficient||fields.quantity>available),
      workshopComment:fields.comment||'',workshopUrgent:fields.urgent||false,
      workshopDueDate:fields.dueDate||'',workshopDueTime:fields.dueTime||'',
    }
    setCreateDraft((current:any)=>({
      ...current,
      items:editingIndex!==null&&current.items[editingIndex]
        ?current.items.map((existing:any,index:number)=>index===editingIndex?item:existing)
        :[...current.items.filter((existing:any)=>existing.catalogVariantId||String(existing.productName||'').trim()),item],
    }))
    notify(editingIndex===null?'Товар добавлен в заказ':'Позиция обновлена')
    setEditingIndex(null)
  }

  return (
    <article className="card wide sector-orders" id="create" style={{ ...sectorStyle('orders'), ...orderPanelStyle('create') }}>
              <div className="create-hero">
                <div>
                  <div className="card-label">Новый заказ</div>
                  <div className="card-meta">Сначала заполните детали заказа, затем добавьте товары и оплаты.</div>
                </div>
                <div className="orders-workspace-kpis create-kpis">
                  <div>
                    <span>Товаров</span>
                    <strong>{actualItems.length}</strong>
                  </div>
                  <div>
                    <span>Оплат</span>
                    <strong>{createDraft.payments.filter((payment) => String(payment.method || '').trim() && Number(payment.amount || 0) > 0).length}</strong>
                  </div>
                  <div>
                    <span>Долг</span>
                    <strong>{formatMoney(createTotals.debtAmount)}</strong>
                  </div>
                </div>
              </div>
    
              <section className="order-step-card" id="sale-client-details">
                <div className="order-step-head">
                  <div className="order-step-index">1</div>
                  <div>
                    <h3>Клиент и условия заказа</h3>
                    <p>Основные данные заказа. Итоговая цена теперь складывается из цен товарных позиций.</p>
                  </div>
                </div>
                <div className="form-grid edit-grid">
                  <label>
                    <span>Дата</span>
                    <input
                      type="date"
                      value={createDraft.orderDate}
                      onChange={(event) => updateCreateDraft('orderDate', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Менеджер <b className="required-mark">*</b></span>
                    <ManagerPicker
                      valueId={createDraft.managerId}
                      valueName={createDraft.managerName}
                      options={references?.managerOptions || []}
                      onChange={(manager) => setCreateDraft((draft) => ({ ...draft, managerId: manager?.id || 0, managerName: manager?.name || '' }))}
                    />
                  </label>
                  <label>
                    <span>Телефон клиента</span>
                    <input
                      value={createDraft.customerPhone}
                      onChange={(event) => updateCreateDraft('customerPhone', event.target.value)}
                      placeholder="Например: +7 777 123 45 67"
                    />
                  </label>
                  <label>
                    <span>Город</span>
                    <SmartPickerInput
                      value={createDraft.city}
                      onChange={(value) => updateCreateDraft('city', value)}
                      placeholder="Город или населённый пункт"
                      options={suggestionValues.cities}
                    />
                  </label>
                  <label>
                    <span>Доставка</span>
                    <SmartPickerInput
                      value={createDraft.deliveryType}
                      onChange={(value) => updateCreateDraft('deliveryType', value)}
                      placeholder="Выберите доставку"
                      options={suggestionValues.deliveryTypes}
                    />
                  </label>
                  <label>
                    <span>Способ оплаты заказа</span>
                    <SmartPickerInput
                      value={createDraft.orderPaymentMethod}
                      onChange={(value) => updateCreateDraft('orderPaymentMethod', value)}
                      placeholder="Как клиент будет оплачивать заказ"
                      options={suggestionValues.paymentMethods}
                    />
                    <small>Выберите способ, которым клиент будет оплачивать заказ.</small>
                  </label>
                  <label className="wide-field">
                    <span>Комментарий</span>
                    <input
                      value={createDraft.comment}
                      onChange={(event) => updateCreateDraft('comment', event.target.value)}
                      placeholder="Необязательно: адрес, пожелание, уточнение"
                    />
                  </label>
                </div>
              </section>
    
              <section className="order-step-card">
                <div className="order-step-head order-step-head-split">
                  <div className="order-step-head-main">
                    <div className="order-step-index">2</div>
                    <div>
                      <h3>Товары в заказе</h3>
                      <p>Укажите количество и цену, по которой клиент купил товар. Предложенную цену можно изменить.</p>
                    </div>
                  </div>
                  
                </div>
                <div className="main-sale-workspace">
                  <div className="main-sale-picker-pane">
                    <MainClothingSourcePicker key={pickerRevision} allocated={allocated} onCommit={chooseVariant} onManual={startManual}
                      onPendingChange={setPickerPending}
                      editing={editingIndex===null||!createDraft.items[editingIndex]?null:{index:editingIndex,item:createDraft.items[editingIndex]}}
                      onCancelEdit={()=>setEditingIndex(null)}/>
                  </div>
                  <aside className="main-sale-basket" aria-label="Состав заказа">
                    <div className="main-sale-basket-head">
                      <h3>В заказе</h3>
                      <span>{actualItems.length} поз.</span>
                    </div>
                    {actualItems.length===0&&
                      <p className="main-sale-basket-empty">Пока нет товаров. Выбранные позиции появятся здесь.</p>}
                  {createDraft.items.map((item:any,index:number)=>(
                    !item.catalogVariantId&&!String(item.productName||'').trim()?null:
                    <div className="main-sale-basket-entry" key={`basket-item-${index}`}>
                      <div className="main-basket-title">
                        <strong>{String(item.productName||'').trim()}</strong>
                        <span className={`main-basket-source source-${item.sourceType||'workshop'}`}>{sourceLabel(item.sourceType||'workshop')}</span>
                      </div>
                      <p className="main-basket-details">
                        {[
                          item.gender==='ЖЕН'?'Женский':item.gender==='МУЖ'?'Мужской':item.gender||'',
                          item.material||'',item.color||'',
                          item.length?(String(item.length).toUpperCase()==='СТАНДАРТ'?'Обычная длина':item.length):'',
                          (String(item.audienceType).toUpperCase()==='ДЕТСКИЙ'?'Возраст ':'Размер ')+(item.size||'не указан'),
                        ].filter(Boolean).join(' · ')}
                      </p>
                      {!item.catalogVariantId&&item.sourceType!=='workshop'&&
                        <p className="main-basket-catalog-note">Указано вручную. При сохранении проверим, есть ли такой товар в системе. Если нет, понадобится уточнить наличие.</p>}
                      {item.workshopUrgent&&<span className="main-basket-urgent">Срочно · {item.workshopDueDate||'срок не указан'}</span>}
                      <div className="main-basket-price">
                        <span>{Number(item.quantity)||1} шт. × {item.unitPrice==null?'Цена не указана':formatMoney(Number(item.unitPrice))}</span>
                        <strong>{item.unitPrice==null?'—':formatMoney(Number(item.unitPrice||0)*Number(item.quantity||0))}</strong>
                      </div>
                      {item.workshopComment&&item.sourceType==='workshop'&&<p className="main-basket-comment">Цеху: {item.workshopComment}</p>}
                      <div className="main-basket-actions">
                        <button type="button" className="secondary compact" onClick={()=>{
                          if(item.catalogVariantId)setEditingIndex(index)
                          else editManual(index)
                        }}>Изменить товар</button>
                        <button type="button" className="ghost danger compact" onClick={()=>{removeCreateItem(index);setEditingIndex(null)}}>Убрать</button>
                      </div>
                      {item.catalogVariantId&&<details className="main-basket-editor">
                        <summary>Изменить количество и цену</summary>
                        <MainPickedOrderLine item={item} index={index} update={updateCreateItem} formatMoney={formatMoney}/>
                      </details>}
                    </div>
                  ))}
                  <div className="main-sale-basket-total"><span>Итого</span>
                    <strong>{formatMoney(Number(createTotals.totalAmount)||0)}</strong>
                  </div>
                  <button type="button" className="primary" style={{width:'100%'}}
                    disabled={editingIndex!==null||pickerPending}
                    onClick={()=>document.getElementById('sale-payments')?.scrollIntoView({behavior:'smooth',block:'start'})}>
                    Перейти к оплатам
                  </button>
                  </aside>
                </div>
                
              </section>
    
              <section className="order-step-card" id="sale-payments">
                <div className="order-step-head order-step-head-split">
                  <div className="order-step-head-main">
                    <div className="order-step-index">3</div>
                    <div>
                      <h3>Оплаты</h3>
                      <p>Можно добавить несколько способов оплаты, включая КАСПИ МАГАЗИН. Неоплаченная часть останется в долге.</p>
                    </div>
                  </div>
                  <button className="secondary compact" type="button" onClick={addCreatePayment}>+ Добавить оплату</button>
                </div>
                <div className="stack">
                    {createDraft.payments.map((payment, index) => (
                      <div className="mini-item order-payment-card" key={`create-payment-${index}`}>
                        <div className="mini-item-head"><strong>Оплата {index + 1}</strong><button className="ghost danger compact" type="button" onClick={() => removeCreatePayment(index)}>Удалить</button></div>
                        <div className="subgrid order-payment-grid">
                          <label><span>Дата</span><input type="date" value={payment.paymentDate} onChange={(event) => updateCreatePayment(index, 'paymentDate', event.target.value)} /></label>
                          <label><span>Способ оплаты</span><SmartPickerInput value={payment.method} onChange={(value) => updateCreatePayment(index, 'method', value)} placeholder="Выберите способ" options={suggestionValues.paymentMethods} /></label>
                          <label><span>Сумма</span><FriendlyNumberInput type="number" min="0" value={payment.amount ?? 0} onChange={(event) => updateCreatePayment(index, 'amount', Number(event.target.value))} /></label>
                        </div>
                      </div>
                    ))}
                  </div>
              </section>    
              <section className="order-step-card">
                <div className="order-step-head">
                  <div className="order-step-index">4</div>
                  <div>
                    <h3>Проверка заказа</h3>
                    <p>Перед сохранением сверьте цены позиций и оплаты. Итог заказа и долг рассчитываются автоматически.</p>
                  </div>
                </div>
                <div className="editor-summary order-check-panel">
                  <div className="editor-summary-head">
                    <div>
                      <strong>Итог по заказу</strong>
                      <span>Первичная оплата и долг определяются автоматически, вручную выбирать ничего не нужно.</span>
                    </div>
                    <span className={`status-pill ${createPricing?.status !== 'ready' || createTotals.debtAmount > 0 ? 'status-warning' : 'status-online'}`}>
                      {createPricing?.status !== 'ready' ? 'Нужно проверить' : createTotals.debtAmount <= 0 ? 'Оплата совпала' : 'Есть долг'}
                    </span>
                  </div>
                  <div className="editor-summary-grid">
                    <div>
                      <span>Итого по позициям</span>
                      <strong>{createPricing?.totalAmount === null ? '—' : formatMoney(createTotals.totalAmount)}</strong>
                    </div>
                    <div>
                      <span>Получено</span>
                      <strong>{formatMoney(createTotals.receivedAmount)}</strong>
                    </div>
                    <div>
                      <span>Долг</span>
                      <strong>{createPricing?.debtAmount === null ? '—' : formatMoney(createTotals.debtAmount)}</strong>
                    </div>
                    <div>
                      <span>Позиции</span>
                      <strong>{actualItems.length}</strong>
                    </div>
                  </div>
                </div>
    
                <div className="order-create-item-summary">
                  <div className="order-create-item-summary-head">
                    <strong>Состав заказа</strong>
                    <span>{actualItems.length} поз. · {actualItems.reduce((sum:any,item:any) => sum + Math.max(0, Number(item.quantity || 0)), 0)} шт.</span>
                  </div>
                  <div className="order-create-item-summary-list">
                    {actualItems.map((item:any, index:number) => (
                      <div className="order-create-item-summary-row order-summary-card" key={`create-summary-${index}`}>
                        <span className="order-create-item-summary-index">{index + 1}</span>
                        <div className="order-summary-card-body">
                          <strong>{String(item.productName || '').trim() || 'Товар не указан'}</strong>
                          {formatOrderItemDetails(item) ? <span>{formatOrderItemDetails(item)}</span> : <small>Характеристики пока не заполнены</small>}
                        </div>
                        <div className="order-summary-card-side">
                          <span className={`order-create-item-summary-source source-${item.sourceType || 'warehouse'}`}>{sourceLabel(item.sourceType || 'warehouse')}</span>
                          <strong>× {Math.max(0, Number(item.quantity || 0))}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
    
                {createPricing?.status === 'blocked' ? (
                  <div className="order-manager-required" role="alert">
                    Перед сохранением проверьте отмеченные цены позиций и оплаты. Цена продажи обязательна для каждой заполненной позиции.
                  </div>
                ) : null}

                {!Number(createDraft.managerId || 0) ? (
                  <div className="order-manager-required" role="alert">
                    Выберите менеджера. Без менеджера заказ сохранить нельзя.
                  </div>
                ) : null}

                <div className="actions order-create-actions form-bottom-actions">
                  <button
                    className="primary"
                    onClick={createOrderFromDraft}
                    disabled={orderBusy || !Number(createDraft.managerId || 0) || editingIndex!==null || pickerPending || workshopOpen}
                    title={!Number(createDraft.managerId || 0) ? 'Сначала выберите менеджера' : undefined}
                  >
                    {orderBusy ? 'Создаю...' : 'Сохранить заказ'}
                  </button>
                  <button className="secondary" type="button" onClick={()=>{setEditingIndex(null);setPickerPending(false);setPickerRevision(x=>x+1);setWorkshopOpen(false);setWorkshopEditing(null);setManualPreset(null);setNotice(null);resetCreateOrderDraft()}}>
                    Очистить форму
                  </button>
                  <button className="secondary back-action" type="button" onClick={() => setOrderPanel('list')} disabled={orderBusy}>
                    Назад к таблице
                  </button>
                </div>
              </section>
              {workshopOpen&&<MainWorkshopOrderModal
                initial={workshopEditing===null?null:createDraft.items[workshopEditing]}
                source={manualSource}
                preset={workshopEditing===null?manualPreset:null}
                suggestions={suggestionValues}
                onClose={()=>{setWorkshopOpen(false);setWorkshopEditing(null);setManualPreset(null)}}
                onSave={saveWorkshop}/>}
              {notice&&<div className="main-sale-toast" role="status" aria-live="polite" key={notice.id}>
                <span aria-hidden="true">✓</span>{notice.message}
              </div>}
            </article>
  )
}
