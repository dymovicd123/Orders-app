import {useEffect,useState} from 'react'
import type {Dispatch,SetStateAction} from 'react'
import type {EditorDraft,EditorItem} from '../../app/types'
import {pickerKey,type OrderPickerChoice,type SourceKey} from './MainOrderSourcePicker'
import {MainClothingSourcePicker} from './MainClothingSourcePicker'
import {MainWorkshopOrderModal,type ManualOrderPreset,type ManualSource,type WorkshopOrderFields} from './MainWorkshopOrderModal'
import {MainPickedOrderLine} from './MainPickedOrderLine'
import {findExactExistingManualVariant} from './manualOrderCatalogPreview'
import '../../styles/main-sale-picker.css'
import '../../styles/itemized-order-editor-workspace.css'

type Props={
 orderId:number
 draft:EditorDraft
 setDraft:Dispatch<SetStateAction<EditorDraft|null>>
 updateItem:(index:number,field:keyof EditorItem,value:any)=>void
 removeItem:(index:number)=>void
 saving:boolean
 formatMoney:(amount:number)=>string
 sourceLabel:(source:string)=>string
 suggestions:any
 onBlockedChange:(blocked:boolean)=>void
}

export function ItemizedOrderEditorWorkspace({orderId,draft,setDraft,updateItem,removeItem,saving,formatMoney,sourceLabel,suggestions,onBlockedChange}:Props){
 const [editingIndex,setEditingIndex]=useState<number|null>(null)
 const [pickerPending,setPickerPending]=useState(false)
 const [modalSource,setModalSource]=useState<ManualSource>('warehouse')
 const [modalPreset,setModalPreset]=useState<ManualOrderPreset|null>(null)
 const [manualEditingIndex,setManualEditingIndex]=useState<number|null>(null)
 const [modalOpen,setModalOpen]=useState(false)
 const [catalogChoices,setCatalogChoices]=useState<OrderPickerChoice[]>([])
 const [feedback,setFeedback]=useState('')
 const [pickerRevision,setPickerRevision]=useState(0)
 const editing=editingIndex===null?null:draft.items[editingIndex]||null

 useEffect(()=>{
  onBlockedChange(editingIndex!==null||pickerPending||modalOpen||saving)
 },[editingIndex,pickerPending,modalOpen,saving,onBlockedChange])
 useEffect(()=>()=>onBlockedChange(false),[onBlockedChange])

 const allocated=new Map<string,number>()
 for(const item of draft.items){
  if(!item.catalogVariantId||item.sourceType==='workshop')continue
  const source:SourceKey=item.sourceType==='boutique'?'boutique':'warehouse'
  const key=pickerKey(source,item.catalogVariantId)
  allocated.set(key,(allocated.get(key)||0)+Math.max(0,Number(item.quantity)||0))
 }
 const cancelEdit=()=>{setEditingIndex(null);setFeedback('');setPickerRevision(revision=>revision+1)}
 const beginEdit=(index:number)=>{
  if(saving)return
  const item=draft.items[index]
  if(!item)return
  setFeedback('')
  if(!item.catalogVariantId){
   setEditingIndex(index)
   setManualEditingIndex(index);setModalSource((item.sourceType||'warehouse') as ManualSource)
   setModalPreset(null);setModalOpen(true)
   return
  }
  setEditingIndex(index)
 }
 const beginManualEdit=(index:number)=>{
  if(saving)return
  setEditingIndex(index)
  setManualEditingIndex(index)
  setModalSource((draft.items[index].sourceType||'warehouse') as ManualSource)
  setModalPreset(null);setModalOpen(true)
 }
 const openManual=(source:ManualSource,preset?:ManualOrderPreset)=>{
  if(saving)return
  setModalSource(source);setModalPreset(preset||null)
  setManualEditingIndex(null);setModalOpen(true)
 }
 const closeManual=()=>{setModalOpen(false);setModalPreset(null);setManualEditingIndex(null)}
 const chooseVariant=(choice:OrderPickerChoice,source:ManualSource,fields:{
  quantity:number;unitPrice:number;comment:string;urgent:boolean;dueDate:string;dueTime:string
 },insufficient:boolean)=>{
  if(saving)return
  setDraft(current=>{
   if(!current)return current
   const previous=editingIndex!==null?current.items[editingIndex]:null
   if(editingIndex!==null&&!previous)return current
   const next:EditorItem={
    ...previous,
    productName:choice.productName,
    orderItemId:previous?.orderItemId,
    catalogVariantId:choice.variantId,
    manualCatalogEntry:false,
    audienceType:choice.category==='child'?'ДЕТСКИЙ':'ВЗРОСЛЫЙ',
    gender:choice.gender,color:choice.color,material:choice.material,
    length:choice.length,size:choice.size,
    sourceType:source,quantity:fields.quantity,unitPrice:fields.unitPrice,
    catalogPriceSnapshot:choice.salePrice,
    priceOrigin:choice.salePrice!==null&&choice.salePrice===fields.unitPrice?'catalog':'manual',
    priceNeedsConfirmation:false,
    availableAtPick:source==='workshop'?undefined:choice[source].free,
    physicalAtPick:source==='workshop'?undefined:choice[source].physical,
    reservedAtPick:source==='workshop'?undefined:choice[source].reserved,
    stockObservationEnabled:false,observedPhysicalQuantity:null,
    shortageAcknowledged:source!=='workshop'&&insufficient,
    serverShortage:undefined,
    workshopComment:source==='workshop'?fields.comment:'',
    workshopUrgent:source==='workshop'&&fields.urgent,
    workshopDueDate:source==='workshop'&&fields.urgent?fields.dueDate:'',
    workshopDueTime:source==='workshop'&&fields.urgent?fields.dueTime:'',
   }
   const items=editingIndex===null?[...current.items,next]:
    current.items.map((old,index)=>index===editingIndex?next:old)
   return {...current,items}
  })
  setFeedback(editingIndex===null?'Товар добавлен в изменения заказа.':'Товар в позиции заменён. Проверьте состав перед сохранением.')
  setEditingIndex(null)
 }
 const saveManual=(item:WorkshopOrderFields)=>{
  if(saving)return
  const target=editingIndex
  setDraft(current=>{
   if(!current)return current
   const previous=target!==null?current.items[target]:null
   if(target!==null&&!previous)return current
   const next:EditorItem={
    ...previous,...item,
    orderItemId:previous?.orderItemId,
    catalogVariantId:undefined,
    manualCatalogEntry:true,
    stockObservationEnabled:false,observedPhysicalQuantity:null,serverShortage:undefined,
   }
   return {...current,items:target===null?[...current.items,next]:
    current.items.map((old,index)=>index===target?next:old)}
  })
  setFeedback(target===null?'Товар добавлен. Наличие уточнится при сохранении.':'Позиция изменена. Наличие уточнится при сохранении.')
  setEditingIndex(null)
  closeManual()
  setPickerRevision(revision=>revision+1)
 }
 const cancelModal=()=>{
  closeManual()
  if(editingIndex!==null)cancelEdit()
 }
 const total=draft.items.reduce((sum,item)=>{
  const qty=Number(item.quantity),price=Number(item.unitPrice)
  return sum+(Number.isSafeInteger(qty)&&qty>0&&Number.isSafeInteger(price)&&price>=0?qty*price:0)
 },0)
 const blocking=editingIndex!==null||pickerPending||modalOpen
 return <div className="itemized-editor-workspace">
  <div className="order-step-head order-step-head-split">
   <div className="order-step-head-main">
    <div className="order-step-index">2</div>
    <div>
     <h3>Товары в заказе</h3>
     <p>Выбирайте товар так же, как при создании заказа. До нажатия «Сохранить изменения» состав не изменится в базе.</p>
    </div>
   </div>
  </div>
  {editingIndex!==null&&<div className="itemized-editor-focus" role="status">
   <span>Вы меняете позицию {editingIndex+1}: <strong>{editing?.productName||'товар'}</strong>. Остальные позиции не затронуты.</span>
   <button type="button" className="secondary compact" onClick={cancelEdit} disabled={saving}>Отменить замену</button>
  </div>}
  <div className="main-sale-workspace itemized-editor-layout">
   <div className="main-sale-picker-pane">
    <MainClothingSourcePicker
     key={orderId+'-'+pickerRevision}
     allocated={allocated}
     onCommit={chooseVariant}
     onManual={openManual}
     onVariantsLoaded={setCatalogChoices}
     onPendingChange={setPickerPending}
     editing={editingIndex===null||!editing?null:{index:editingIndex,item:editing}}
     onCancelEdit={cancelEdit}
    />
   </div>
   <aside className="main-sale-basket" aria-label="Состав редактируемого заказа">
    <div className="main-sale-basket-head">
     <h3>В заказе</h3><span>{draft.items.length} поз.</span>
    </div>
    {draft.items.map((item,index)=><div className={'main-sale-basket-entry'+(editingIndex===index?' is-editing':'')} key={item.orderItemId||'new-'+index}>
     <div className="main-basket-title">
      <strong>{item.productName||'Товар не выбран'}</strong>
      <span className={'main-basket-source source-'+(item.sourceType||'warehouse')}>{sourceLabel(item.sourceType||'warehouse')}</span>
     </div>
     <p className="main-basket-details">
      {[
       item.audienceType==='ДЕТСКИЙ'?'Детский':'',
       item.gender==='ЖЕН'?'Женский':item.gender==='МУЖ'?'Мужской':item.gender,
       item.color==='БЕЗ ЦВЕТА'?'Без цвета':item.color,
       item.material==='СТАНДАРТ'?'':item.material,
       item.length==='СТАНДАРТ'?'Обычная длина':item.length,
       ['БЕЗ РАЗМЕРА','БЕЗРАЗМЕРА','Б/Р'].includes(String(item.size||'').toUpperCase())?'Без размера':item.size
      ].filter(Boolean).join(' · ')}
     </p>
     {!item.catalogVariantId&&item.sourceType!=='workshop'&&<p className="main-basket-catalog-note">
      {catalogChoices.length===0?'Проверим вариант при сохранении.':
       findExactExistingManualVariant(item,catalogChoices)
       ?'Такой вариант уже есть в каталоге; наличие в выбранном месте нужно проверить.'
       :'Точный вариант пока не найден. Потребуется уточнение.'}
     </p>}
     <div className="main-basket-price">
      <span>{Number(item.quantity)||0} шт. × {item.unitPrice==null?'Цена не указана':formatMoney(Number(item.unitPrice))}</span>
      <strong>{item.unitPrice==null?'—':formatMoney(Number(item.quantity||0)*Number(item.unitPrice||0))}</strong>
     </div>
     {item.workshopComment&&item.sourceType==='workshop'&&<p className="main-basket-comment">Цеху: {item.workshopComment}</p>}
     <div className="main-basket-actions">
      <button type="button" className="secondary compact" onClick={()=>beginEdit(index)} disabled={saving}>
       {item.catalogVariantId?'Выбрать другой вариант':'Изменить товар'}
      </button>
      {item.catalogVariantId&&<button type="button" className="secondary compact" onClick={()=>beginManualEdit(index)} disabled={saving}>Указать вручную</button>}
      <button type="button" className="ghost danger compact" onClick={()=>{
       if(editingIndex!==null)cancelEdit()
       removeItem(index)
      }} disabled={saving||draft.items.length<=1}>Убрать</button>
     </div>
     <details className="main-basket-editor">
      <summary>Изменить количество и цену{item.sourceType==='workshop'?' / задание цеху':''}</summary>
      <MainPickedOrderLine item={item} index={index} update={updateItem} formatMoney={formatMoney}/>
     </details>
    </div>)}
    {feedback&&<p className="itemized-editor-feedback" role="status">{feedback}</p>}
    <div className="main-sale-basket-total"><span>Итого</span><strong>{formatMoney(total)}</strong></div>
    <p className="itemized-editor-save-hint">{blocking
     ?'Завершите выбор или отмените изменение товара перед сохранением заказа.'
     :'Проверьте все позиции и оплаты. Изменения будут сохранены общей кнопкой внизу.'}</p>
   </aside>
  </div>
  {modalOpen&&<MainWorkshopOrderModal
   key={orderId+'-'+modalSource+'-'+String(manualEditingIndex??'new')}
   source={modalSource}
   initial={manualEditingIndex!==null?draft.items[manualEditingIndex] as Partial<WorkshopOrderFields>:null}
   preset={manualEditingIndex===null?modalPreset:null}
   catalogVariants={catalogChoices}
   suggestions={suggestions}
   onSave={saveManual}
   onClose={cancelModal}
  />}
 </div>
}
