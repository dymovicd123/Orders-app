// A catalog execution's price snapshot belongs to the original order line.
// A size, color or stock-source change within that execution must not rewrite it.
type CatalogExecutionLine = {
 productName?: unknown
 audienceType?: unknown
 material?: unknown
 length?: unknown
 catalogPriceSnapshot?: number | null
}

const normalized=(value:unknown)=>String(value??'').trim().toLocaleUpperCase('ru-RU')
const execution=(value:unknown)=>normalized(value)||'СТАНДАРТ'
const audience=(value:unknown)=>{
 const key=normalized(value)
 return key==='ДЕТСКИЙ'||key==='CHILD'||key==='CHILDREN'?'ДЕТСКИЙ':'ВЗРОСЛЫЙ'
}

export function historicalCatalogSnapshotForEdit(
 previous:CatalogExecutionLine|null|undefined,
 next:CatalogExecutionLine,
):number|null{
 const suggested=next.catalogPriceSnapshot??null
 if(!previous)return suggested
 const sameExecution=normalized(previous.productName)===normalized(next.productName)
  && audience(previous.audienceType)===audience(next.audienceType)
  && execution(previous.material)===execution(next.material)
  && execution(previous.length)===execution(next.length)
 return sameExecution?previous.catalogPriceSnapshot??null:suggested
}
