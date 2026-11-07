import type {OrderPickerChoice} from './MainOrderSourcePicker'

export type ManualPreviewFields={
 productName:string
 audienceType:string
 gender:string
 color:string
 material:string
 length:string
 size:string
}

const normalized=(value:unknown)=>String(value??'').trim().replace(/\s+/g,' ').toLocaleUpperCase('ru-RU')
const defaultExecution=(value:unknown)=>normalized(value)||'СТАНДАРТ'
const sizeKey=(value:unknown)=>{
 const x=normalized(value)
 return x===''||['БЕЗ РАЗМЕРА','БЕЗРАЗМЕРА','Б/Р'].includes(x)?'@NO_SIZE':x
}

export function findExactExistingManualVariant(
 fields:ManualPreviewFields, choices:readonly OrderPickerChoice[],
):OrderPickerChoice|null{
 const name=normalized(fields.productName)
 const gender=normalized(fields.gender)
 const color=normalized(fields.color)
 const material=defaultExecution(fields.material)
 const length=defaultExecution(fields.length)
 const size=sizeKey(fields.size)
 const category=normalized(fields.audienceType)==='ДЕТСКИЙ'?'child':'adult'
 if(!name||!gender||!color||!normalized(fields.size)||!normalized(fields.material)||!normalized(fields.length))return null
 return choices.find(row=>
  normalized(row.productName)===name
  &&row.category===category
  &&normalized(row.gender)===gender
  &&normalized(row.color)===color
  &&defaultExecution(row.material)===material
  &&defaultExecution(row.length)===length
  &&sizeKey(row.size)===size
 )||null
}
