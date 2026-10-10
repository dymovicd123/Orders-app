// An admin-only READ-ONLY plan for genuinely different reference characteristics.
// Never treats a chosen label as authorization to combine distinct physical SKUs.
import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, toInt } from '../core/text.ts'
import { catalogColorIdentity, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize } from './catalog.ts'

type Kind='color'|'material'|'length'|'size'|'child_age'
type Ref={id:number;kind:string;value:string;is_active:number}
type Variant={
 id:number;product_id:number;stock_position_id:number|null;category:string|null;
 gender:string|null;color:string|null;material:string|null;length:string|null;
 size_label:string|null;is_active:number;product_name:string;
 execution_material:string|null;execution_length:string|null
}
type Stock={variant_id:number;inventory_source:string;physical:number;reserved:number}
type Obligation={variant_id:number;active_reservations:number;active_order_lines:number}
const supported:Kind[]=['color','material','length','size','child_age']
const safe=(n:number,zero=false)=>Number.isSafeInteger(n)&&(zero?n>=0:n>0)
const chooseColumn=(kind:Kind)=>kind==='child_age'||kind==='size'?'size_label':kind
const dbValue=(v:unknown)=>cleanText(v).toUpperCase()
function matchingSql(kind:Kind){
 const col=chooseColumn(kind)
 const v="UPPER(TRIM(COALESCE(v."+col+",'')))"
 if(kind==='material'||kind==='length')
  return "("+v+"=? OR UPPER(TRIM(COALESCE(sp."+col+",'')))=?)"
 return v+"=?"
}
const aud=(kind:Kind)=>kind==='size'?" AND COALESCE(v.category,'adult')<>'child'"
 :kind==='child_age'?" AND COALESCE(v.category,'adult')='child'":""
const bindValue=(kind:Kind,value:string)=>kind==='material'||kind==='length'?[value,value]:[value]
const selectVariant="SELECT v.id,v.product_id,v.stock_position_id,v.category,v.gender,v.color,v.material,v.length,v.size_label,v.is_active,p.name AS product_name,sp.material AS execution_material,sp.length AS execution_length FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id LEFT JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id"
function badExecution(row:Variant){
 return row.stock_position_id===null||row.execution_material===null||row.execution_length===null
  ||canonicalStockPositionValue(row.material)!==canonicalStockPositionValue(row.execution_material)
  ||canonicalStockPositionValue(row.length)!==canonicalStockPositionValue(row.execution_length)
}
function otherKey(row:Variant,kind:Kind){
 return [
  row.product_id,
  kind==='color'||kind==='size'||kind==='child_age'?(row.stock_position_id??'missing-position'):'any-position',
  normalizeAudienceCategory(row.category,row.size_label),
  normalizeCatalogCombinationGender(row.gender),
  kind==='color'?'changed-color':catalogColorIdentity(row.color),
  kind==='size'||kind==='child_age'?'changed-size':normalizeCatalogCombinationSize(row.size_label),
  kind==='material'?'changed-material':canonicalStockPositionValue(row.execution_material),
  kind==='length'?'changed-length':canonicalStockPositionValue(row.execution_length),
 ].join('\u001f')
}
function site(stocks:Map<string,Stock>,sourceId:number,keeperId:number|null,location:string){
 const source=stocks.get(sourceId+':'+location),keeper=keeperId?stocks.get(keeperId+':'+location):undefined
 const sourcePhysical=toInt(source?.physical,0),sourceReserved=toInt(source?.reserved,0)
 const keeperPhysical=keeperId?toInt(keeper?.physical,0):null
 const keeperReserved=keeperId?toInt(keeper?.reserved,0):null
 return {
  location,sourcePhysical,sourceReserved,keeperPhysical,keeperReserved,
  // Shortages are informational, never a license to reduce customer reserves.
  sourceShortage:Math.max(0,sourceReserved-sourcePhysical),
  keeperShortage:keeperPhysical===null||keeperReserved===null?null
   :Math.max(0,keeperReserved-keeperPhysical),
 }
}
export async function previewCharacteristicSkuMapping(
 db:D1Database,sourceId:number,targetId:number,afterVariantId=0,limit=20
){
 if(!safe(sourceId)||!safe(targetId)||sourceId===targetId)
  throw new Error('Выберите два разных значения характеристик.')
 if(!safe(afterVariantId,true)||!safe(limit)||limit>50)
  throw new Error('Проверьте номер страницы и количество строк (от 1 до 50).')
 const refRows=await db.prepare(
  "SELECT id,kind,value,is_active FROM reference_values WHERE id IN (?,?) ORDER BY id"
 ).bind(sourceId,targetId).all<Ref>()
 const source=(refRows.results||[]).find(x=>x.id===sourceId)
 const target=(refRows.results||[]).find(x=>x.id===targetId)
 if(!source||!target||source.kind!==target.kind||!supported.includes(source.kind as Kind))
  throw new Error('Выберите две характеристики одного списка: цвет, материал, длина, размер или возраст.')
 if(target.is_active!==1)throw new Error('Основное значение должно быть активным.')
 const kind=source.kind as Kind,from=dbValue(source.value),to=dbValue(target.value)
 // Characteristics are stored as display text on SKUs, not by reference_values.id.
 // Identical labels cannot distinguish source from keeper: otherwise the source
 // variant itself may be incorrectly proposed as its own keeper.
 if(from===to)throw Object.assign(new Error(
  'У выбранных значений одинаковое название. По тексту товара нельзя отличить исходный вариант от основного. Не объединяйте SKU по такой карте.'
 ),{status:400,code:'characteristic_mapping_indistinguishable'})
 const matcher=matchingSql(kind),scope=aud(kind),bindings=bindValue(kind,from)
 const fromWhere=" WHERE "+matcher+scope
 const fromQuery=selectVariant+fromWhere
 const [total,sourcePage]=await Promise.all([
  db.prepare("SELECT COUNT(*) AS n FROM catalog_variants v LEFT JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id"+fromWhere)
   .bind(...bindings).first<{n:number}>(),
  db.prepare(fromQuery+" AND v.id>? ORDER BY v.id ASC LIMIT ?")
   .bind(...bindings,afterVariantId,limit+1).all<Variant>(),
 ])
 const fetched=sourcePage.results||[],rows=fetched.slice(0,limit)
 const productIds=[...new Set(rows.map(x=>x.product_id))]
 const targetsByKey=new Map<string,{count:number;keepers:Variant[];brokenCount:number}>()
 if(productIds.length){
  const products=productIds.map(()=>'?').join(',')
  const toMatcher=matchingSql(kind)
  const query=selectVariant+" WHERE v.is_active=1 AND v.product_id IN ("+products+") AND "+toMatcher+scope
    +" AND v.id>? ORDER BY v.id ASC LIMIT 200"
  let cursor=0
  for(;;){
   const result=await db.prepare(query).bind(...productIds,...bindValue(kind,to),cursor).all<Variant>()
   const batch=result.results||[]
   for(const v of batch){
    const key=otherKey(v,kind)
    const entry=targetsByKey.get(key)||{count:0,keepers:[],brokenCount:0}
    entry.count++
    if(badExecution(v))entry.brokenCount++
    if(entry.keepers.length<2)entry.keepers.push(v)
    targetsByKey.set(key,entry)
   }
   if(batch.length<200)break
   const next=batch[batch.length-1].id
   if(next<=cursor)throw new Error('Нельзя завершить проверку соответствий вариантов. Повторите попытку.')
   cursor=next
  }
 }
 const chosen=rows.map(row=>{
  const counterpart=targetsByKey.get(otherKey(row,kind))
  const sourceBad=badExecution(row)
  const status= row.is_active!==1?'historical'
   :sourceBad||Boolean(counterpart?.brokenCount)?'needs_execution_review'
   :!counterpart?'no_keeper'
   :counterpart.count===1?'unique_keeper':'ambiguous_keepers'
  return {row,status,candidateCount:counterpart?.count||0,
   keeperId:status==='unique_keeper'?counterpart?.keepers[0].id??null:null,
   keeperChoices:counterpart?.keepers.map(x=>x.id)||[]}
 })
 const allIds=[...new Set(chosen.flatMap(x=>[x.row.id,...x.keeperChoices]))]
 const stockMap=new Map<string,Stock>()
 const obligations=new Map<number,Obligation>()
 if(allIds.length){
  const inList=allIds.map(()=>'?').join(',')
  const [stocks,active,orders]=await Promise.all([
   db.prepare("SELECT variant_id,inventory_source,SUM(quantity) AS physical,SUM(reserved_quantity) AS reserved FROM inventory_stock WHERE variant_id IN ("+inList+") GROUP BY variant_id,inventory_source")
    .bind(...allIds).all<Stock>(),
   db.prepare("SELECT variant_id,COUNT(*) AS active_reservations FROM inventory_reservations WHERE variant_id IN ("+inList+") AND status='active' GROUP BY variant_id")
    .bind(...allIds).all<{variant_id:number;active_reservations:number}>(),
   db.prepare("SELECT oi.variant_id,COUNT(*) AS active_order_lines FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.variant_id IN ("+inList+") AND o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent' GROUP BY oi.variant_id")
    .bind(...allIds).all<{variant_id:number;active_order_lines:number}>()
  ])
  for(const s of stocks.results||[])stockMap.set(s.variant_id+':'+s.inventory_source,s)
  for(const x of active.results||[])obligations.set(x.variant_id,{
   variant_id:x.variant_id,active_reservations:x.active_reservations,active_order_lines:0})
  for(const x of orders.results||[]){
   const old=obligations.get(x.variant_id)||{variant_id:x.variant_id,active_reservations:0,active_order_lines:0}
   old.active_order_lines=x.active_order_lines;obligations.set(x.variant_id,old)
  }
 }
 const mapped=chosen.map(x=>{
  const v=x.row,keeper=x.keeperId
  const o=obligations.get(v.id),keeperObligations=keeper?obligations.get(keeper):undefined
  const places=['warehouse','boutique'].map(loc=>site(stockMap,v.id,keeper,loc))
  const reviewReasons:string[]=[]
  if(x.status==='unique_keeper'){
   if((o?.active_reservations||0)>0||(o?.active_order_lines||0)>0)
    reviewReasons.push('У исходного варианта есть действующие клиентские обязательства.')
   if((keeperObligations?.active_reservations||0)>0||(keeperObligations?.active_order_lines||0)>0)
    reviewReasons.push('У возможного основного варианта тоже есть действующие клиентские обязательства.')
   if(places.some(p=>p.sourceShortage>0||((p.keeperShortage??0)>0)))
    reviewReasons.push('По одному из мест хранения резерв превышает физический остаток: требуется отдельное урегулирование дефицита.')
  }
  const guidance=x.status==='unique_keeper'
   ?'Есть возможный основной вариант. Цвет, размер, материал или длина отличаются: проверьте реальные вещи, резервы и цену, не объединяйте автоматически.'
   :x.status==='no_keeper'
    ?'Готового основного варианта нет. Решите, следует ли менять характеристику или создать отдельную комбинацию.'
    :x.status==='ambiguous_keepers'
     ?'Найдено несколько подходящих основных вариантов. Выберите правильный после сверки, автоматически выбирать нельзя.'
     :x.status==='historical'
      ?'Этот вариант архивный. Исторические заказы должны сохранить прежнюю характеристику.'
      :'Данные исполнения и варианта расходятся. Сначала исправьте этот конфликт безопасным отдельным процессом.'
  return {sourceVariantId:v.id,productId:v.product_id,productName:v.product_name,
   category:v.category,gender:v.gender,color:v.color,material:v.material,length:v.length,
   size:v.size_label,active:v.is_active===1,status:x.status,
   candidateCount:x.candidateCount,proposedKeeperId:keeper,
   possibleKeeperIds:x.keeperChoices,places,
   activeReservations:o?.active_reservations||0,activeOrderLines:o?.active_order_lines||0,
   keeperActiveReservations:keeper===null?null:keeperObligations?.active_reservations||0,
   keeperActiveOrderLines:keeper===null?null:keeperObligations?.active_order_lines||0,
   reviewReasons,
   guidance,canAutomaticallyMerge:false}
 })
 const hasMore=fetched.length>limit
 return {ok:true,kind,source:{id:source.id,value:source.value},target:{id:target.id,value:target.value},
  totalSourceVariants:toInt(total?.n,0),pageSize:limit,afterVariantId,
  shownCount:mapped.length,hasMore,nextCursor:hasMore?rows[rows.length-1]?.id??null:null,
  rows:mapped,canApply:false,noChangesApplied:true,
  explanation:'Это предварительное сопоставление, а не перенос товара. Разные характеристики не дают права складывать склад и бутик или переписывать историю заказов.'}
}
