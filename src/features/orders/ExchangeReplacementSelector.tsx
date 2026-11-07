import {useState} from 'react'
import type {EditorItem} from '../../app/types'
import {pickerKey,type OrderPickerChoice,type SourceKey} from './MainOrderSourcePicker'
import {MainClothingSourcePicker} from './MainClothingSourcePicker'
import {MainWorkshopOrderModal,type ManualOrderPreset,type ManualSource,type WorkshopOrderFields} from './MainWorkshopOrderModal'
import '../../styles/exchange-replacement-picker.css'

type ReplacementPatch=Partial<EditorItem>&{shipmentState?:'sent'|'pending'}
type Props={
 item:EditorItem
 allocated:ReadonlyMap<string,number>
 onApply:(patch:ReplacementPatch)=>void
 onClose:()=>void
 suggestions:any
}
const selectedSource=(item:EditorItem):SourceKey=>item.sourceType==='boutique'?'boutique':'warehouse'

export function ExchangeReplacementSelector({item,allocated,onApply,onClose,suggestions}:Props){
 const [modal,setModal]=useState<{source:ManualSource;preset:ManualOrderPreset|null;initial:boolean}|null>(null)
 const [choices,setChoices]=useState<OrderPickerChoice[]>([])
 const [pending,setPending]=useState(false)
 const [pickerRevision,setPickerRevision]=useState(0)
 const onSelect=(choice:OrderPickerChoice,source:ManualSource,fields:{
  quantity:number;unitPrice:number;comment:string;urgent:boolean;dueDate:string;dueTime:string
 },insufficient:boolean)=>{
  onApply({
   productName:choice.productName,
   catalogVariantId:choice.variantId,
   manualCatalogEntry:false,
   audienceType:choice.category==='child'?'ДЕТСКИЙ':'ВЗРОСЛЫЙ',
   gender:choice.gender,color:choice.color,material:choice.material,length:choice.length,size:choice.size,
   sourceType:source,
   quantity:fields.quantity,unitPrice:fields.unitPrice,
   catalogPriceSnapshot:choice.salePrice,
   priceOrigin:choice.salePrice!==null&&fields.unitPrice===choice.salePrice?'catalog':'manual',
   priceNeedsConfirmation:false,
   availableAtPick:source==='workshop'?undefined:choice[source].free,
   physicalAtPick:source==='workshop'?undefined:choice[source].physical,
   reservedAtPick:source==='workshop'?undefined:choice[source].reserved,
   shortageAcknowledged:source!=='workshop'&&insufficient,
   shipmentState:undefined,
   stockObservationEnabled:false,observedPhysicalQuantity:null,serverShortage:undefined,
   workshopComment:source==='workshop'?fields.comment:'',
   workshopUrgent:source==='workshop'&&fields.urgent,
   workshopDueDate:source==='workshop'&&fields.urgent?fields.dueDate:'',
   workshopDueTime:source==='workshop'&&fields.urgent?fields.dueTime:'',
  })
 }
 const openManual=(source:ManualSource,preset?:ManualOrderPreset)=>{
  setModal({source,preset:preset||null,initial:false})
 }
 const saveManual=(value:WorkshopOrderFields)=>{
  onApply({...value,
   catalogVariantId:undefined,manualCatalogEntry:true,
   shipmentState:undefined,stockObservationEnabled:false,
   observedPhysicalQuantity:null,serverShortage:undefined})
  setModal(null)
 }
 return <section className="exchange-replacement-selector" aria-label="Подобрать новую вещь для обмена">
  <div className="exchange-replacement-selector-head">
   <div>
    <strong>Выберите точный вариант, который получит клиент</strong>
    <small>Такие же модели, цвета и размеры, как при создании заказа. Возврат старого товара и деньги не изменятся до проведения обмена.</small>
   </div>
   <button type="button" className="secondary compact" onClick={onClose}>Отменить выбор</button>
  </div>
  {item.productName&&<div className="exchange-replacement-current">
   <span>Сейчас выбран: <strong>{item.productName}</strong> · {[item.gender,item.color,item.material,item.length,item.size].filter(Boolean).join(' · ')}</span>
   <button type="button" className="secondary compact" onClick={()=>setModal({
    source:(item.sourceType||'warehouse') as ManualSource,preset:null,initial:true
   })}>Изменить вручную</button>
  </div>}
  <MainClothingSourcePicker key={pickerRevision}
   allocated={allocated}
   onCommit={onSelect}
   onManual={openManual}
   onVariantsLoaded={setChoices}
   onPendingChange={setPending}
   editing={item.catalogVariantId?{index:0,item}:null}
   allowManualWhileEditing
   onCancelEdit={()=>{setPickerRevision(n=>n+1);setPending(false)}}
  />
  {pending&&<p className="exchange-replacement-pending">Подтвердите выбранную вещь либо отмените выбор. Отправку клиенту укажете на следующем шаге.</p>}
  {modal&&<MainWorkshopOrderModal
   source={modal.source}
   initial={modal.initial?item as Partial<WorkshopOrderFields>:null}
   preset={modal.initial?null:modal.preset}
   catalogVariants={choices}
   suggestions={suggestions}
   onSave={saveManual}
   onClose={()=>{setModal(null);setPickerRevision(n=>n+1);setPending(false)}}
  />}
 </section>
}
