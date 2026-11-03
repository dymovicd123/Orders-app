/** Browser-tab scoped drafts for Client3 warehouse operations.
 * sessionStorage survives reload and navigation, and isolates two open tabs.
 * Never confuses an uncommitted arrival with a physical inventory movement.
 */
export type WarehouseDraftSource='office'|'showcase'
export type WarehouseDraftMode='arrival'|'writeoff'|'count'|'transfer'
export type WarehouseDraftStage='select'|'quantities'|'review'
export type WarehouseOperationDraft={
  version:1; brand:string; mode:WarehouseDraftMode;source:WarehouseDraftSource;
  stage:WarehouseDraftStage;selectedModel:number|null;
  selectedModelIdsBySource:Record<WarehouseDraftSource,number[]>;
  draftBySource:Record<WarehouseDraftSource,Record<number,string>>;
  reason:string;request:{fingerprint:string;id:string}|null;
}
type DraftStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>
const prefix='client3:watch-warehouse-draft:v1:'
const storage=():DraftStorage|null=>{
  try{return typeof sessionStorage==='undefined'?null:sessionStorage}catch{return null}
}
const record=(input:unknown):Record<string,unknown>=>{
  if(!input||typeof input!=='object'||Array.isArray(input))return {}
  return input as Record<string,unknown>
}
const ids=(v:unknown):number[]=>{
  if(!Array.isArray(v))return []
  return Array.from(new Set(v.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0))).slice(0,500)
}
const quantities=(v:unknown):Record<number,string>=>{
  const result:Record<number,string>={}
  for(const [key,value] of Object.entries(record(v))){
    const id=Number(key)
    if(Number.isSafeInteger(id)&&id>0&&typeof value==='string'&&/^\d{1,7}$/.test(value))
      result[id]=value
  }
  return result
}
export function readWarehouseOperationDraft(brand:string,store:DraftStorage|null=storage()):WarehouseOperationDraft|null{
  if(!store)return null
  try{
    const serialized=store.getItem(prefix+brand)
    if(!serialized)return null
    const obj=record(JSON.parse(serialized))
    if(obj.version!==1||obj.brand!==brand||!['arrival','writeoff','count','transfer'].includes(String(obj.mode)) ||
      !['office','showcase'].includes(String(obj.source)) ||
      !['select','quantities','review'].includes(String(obj.stage)))return null
    const selected=record(obj.selectedModelIdsBySource)
    const raw=record(obj.draftBySource)
    const rawRequest=record(obj.request)
    const request=typeof rawRequest.fingerprint==='string'&&typeof rawRequest.id==='string'&&
      /^[a-zA-Z0-9._:-]{8,128}$/.test(rawRequest.id)?
      {fingerprint:rawRequest.fingerprint,id:rawRequest.id}:null
    return {
      version:1,brand,mode:obj.mode as WarehouseDraftMode,
      source:obj.source as WarehouseDraftSource,stage:obj.stage as WarehouseDraftStage,
      selectedModel:Number.isSafeInteger(Number(obj.selectedModel))&&Number(obj.selectedModel)>0?
        Number(obj.selectedModel):null,
      selectedModelIdsBySource:{office:ids(selected.office),showcase:ids(selected.showcase)},
      draftBySource:{office:quantities(raw.office),showcase:quantities(raw.showcase)},
      reason:typeof obj.reason==='string'?obj.reason.slice(0,300):'',request,
    }
  }catch{return null}
}
export function hasWarehouseDraftContent(draft:WarehouseOperationDraft):boolean{
  return draft.selectedModelIdsBySource.office.length>0||draft.selectedModelIdsBySource.showcase.length>0||
    Object.keys(draft.draftBySource.office).length>0||Object.keys(draft.draftBySource.showcase).length>0||
    Boolean(draft.reason.trim())||Boolean(draft.request)
}
export function saveWarehouseOperationDraft(
  draft:WarehouseOperationDraft,store:DraftStorage|null=storage(),
):boolean{
  if(!store)return false
  try{
    if(hasWarehouseDraftContent(draft))store.setItem(prefix+draft.brand,JSON.stringify(draft))
    else store.removeItem(prefix+draft.brand)
    return true
  }catch{return false}
}
