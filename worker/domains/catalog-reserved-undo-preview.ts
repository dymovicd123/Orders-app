// Only untouched reservations originally transferred by an exact-SKU merger.
// READ ONLY: no order, reserve, money, movement or stock writes in this module.
import { previewComplexCatalogUndoCase } from './catalog-complex-undo-case.ts'

type Stock={id:number;variant_id:number;inventory_source:string;quantity:number;reserved_quantity:number;last_source_ref:string|null;updated_at:string|null}
type Reserved={id:number;variant_id:number;inventory_source:string;quantity:number;status:string;updated_at:string|null;order_id:number;order_item_id:number}
type Link={reservation_id:number;order_id:number;order_item_id:number;inventory_source:string;quantity:number;original_variant_id:number;keeper_variant_id:number;now_variant:number|null;now_status:string|null;now_qty:number|null;now_product:number|null;item_product:number|null;now_location:string|null;now_order:number|null;now_item:number|null;now_date:string|null;item_variant:number|null;item_quantity:number|null;item_source:string|null;item_status:string|null;is_workshop:number|null;item_created_at:string|null;order_status:string|null;shipping_status:string|null;order_updated_at:string|null}
type Ledger={inventory_source:string;source_stock_id:number;target_stock_id_before:number|null;source_quantity_before:number;target_quantity_before:number;source_reserved_before:number;target_reserved_before:number;combined_quantity_after:number;decision_method:string;adjustment_quantity:number}

export async function previewUntouchedReservationUndo(db:D1Database,id:number){
 const review=await previewComplexCatalogUndoCase(db,id)
 const [stocksResult,resResult,linkResult,ledgerResult,variantsResult,rootResult]=await Promise.all([
  db.prepare("SELECT id,variant_id,inventory_source,quantity,reserved_quantity,last_source_ref,updated_at FROM inventory_stock WHERE variant_id IN (?,?) ORDER BY id").bind(review.sourceId,review.keeperId).all<Stock>(),
  db.prepare("SELECT id,variant_id,inventory_source,quantity,status,updated_at,order_id,order_item_id FROM inventory_reservations WHERE variant_id IN (?,?) ORDER BY id").bind(review.sourceId,review.keeperId).all<Reserved>(),
  db.prepare("SELECT a.reservation_id,a.order_id,a.order_item_id,a.inventory_source,a.quantity,a.original_variant_id,a.keeper_variant_id,r.variant_id AS now_variant,r.status AS now_status,r.quantity AS now_qty,r.inventory_source AS now_location,r.order_id AS now_order,r.order_item_id AS now_item,r.product_id AS now_product,r.updated_at AS now_date,oi.product_id AS item_product,oi.variant_id AS item_variant,oi.quantity AS item_quantity,oi.source_type AS item_source,oi.stock_writeoff_status AS item_status,oi.is_workshop,oi.created_at AS item_created_at,o.order_status,o.shipping_status,o.updated_at AS order_updated_at FROM catalog_variant_consolidation_reservation_rows a LEFT JOIN inventory_reservations r ON r.id=a.reservation_id LEFT JOIN order_items oi ON oi.id=a.order_item_id LEFT JOIN orders o ON o.id=a.order_id WHERE a.consolidation_id=? ORDER BY a.reservation_id").bind(id).all<Link>(),
  db.prepare("SELECT l.inventory_source,l.source_stock_id,l.target_stock_id_before,l.source_quantity_before,l.target_quantity_before,l.source_reserved_before,l.target_reserved_before,l.combined_quantity_after,d.decision_method,d.adjustment_quantity FROM catalog_variant_consolidation_stock_rows l LEFT JOIN catalog_variant_consolidation_stock_decisions d ON d.consolidation_id=l.consolidation_id AND d.inventory_source=l.inventory_source WHERE l.consolidation_id=? ORDER BY l.inventory_source").bind(id).all<Ledger>(),
  db.prepare("SELECT id,updated_at FROM catalog_variants WHERE id IN (?,?) ORDER BY id").bind(review.sourceId,review.keeperId).all<{id:number;updated_at:string}>(),
  db.prepare("SELECT product_id FROM catalog_variant_consolidations WHERE id=?").bind(id).first<{product_id:number}>(),
 ])
 const stocks=stocksResult.results||[],reserves=resResult.results||[],links=linkResult.results||[],
  ledger=ledgerResult.results||[],variants=variantsResult.results||[]
 const blockers:Array<{code:string;message:string}>=[]
 const fail=(code:string,message:string)=>{if(!blockers.some(x=>x.code===code))blockers.push({code,message})}
 const expected=new Set(['original_reservations','active_customer_obligations','later_order_activity','physical_undo_requires_accounting'])
 for(const b of review.originalBlockers)if(!expected.has(b.code))fail(b.code,b.message)
 if(links.length===0||links.length>50||review.reservationLinks.truncated||review.reservationLinks.totalCount!==links.length)
  fail('reservation_ledger_incomplete','Для этой отмены нужен полный проверенный журнал не более 50 первоначально перенесённых резервов.')
 if(review.subsequentOrders.totalCount||review.subsequentMovements.totalCount||review.subsequentCounts.totalCount)
  fail('later_business_activity','После объединения уже изменялись заказы либо происходили складские движения или ревизии.')
 if(review.reservationLinks.rows.some(x=>x.situation.kind!=='active_unchanged'))
  fail('original_links_changed','Не все первоначальные резервирования остались неизменными.')
 const mergeTime=Date.parse(review.mergedAt)
 if(!Number.isFinite(mergeTime))fail('invalid_date','Дата объединения недостоверна.')
 const byItem=new Map<number,number>(),byLocation=new Map<string,number>()
 for(const r of links){
  byItem.set(r.order_item_id,(byItem.get(r.order_item_id)||0)+r.quantity)
  byLocation.set(r.inventory_source,(byLocation.get(r.inventory_source)||0)+r.quantity)
  if(r.original_variant_id!==review.sourceId||r.keeper_variant_id!==review.keeperId
     ||r.now_variant!==review.keeperId||r.item_variant!==review.keeperId
     ||r.now_status!=='active'||r.now_qty!==r.quantity||r.now_location!==r.inventory_source
     ||r.now_order!==r.order_id||r.now_item!==r.order_item_id
     ||r.item_source!==r.inventory_source||r.item_status!=='reserved'||r.is_workshop!==0
     ||r.now_product!==rootResult?.product_id||r.item_product!==rootResult?.product_id
     ||r.order_status!=='active'||(r.shipping_status??'not_sent')!=='not_sent'
     ||Date.parse(r.now_date||'')!==mergeTime
     ||!(Date.parse(r.item_created_at||'')<mergeTime)
     ||!(Date.parse(r.order_updated_at||'')<mergeTime))
    fail('customer_link_changed','Обнаружен изменённый, отправленный или неоднозначный клиентский заказ.')
 }
 for(const r of links)if(r.item_quantity!==byItem.get(r.order_item_id))
  fail('partial_order_reservation','Количество позиции заказа отличается от полного перенесённого резерва.')
 for(const r of reserves){
  const t=Date.parse(r.updated_at||'')
  if(!Number.isFinite(t)||t>mergeTime||
    (t===mergeTime&&(r.variant_id!==review.keeperId||r.status!=='active'
       ||!links.some(x=>x.reservation_id===r.id))))
    fail('other_reservations_changed','Есть незафиксированное изменение резерва после объединения.')
 }
 if(reserves.some(r=>r.variant_id===review.sourceId&&r.status==='active'))
  fail('new_source_reserve','У исходного SKU уже есть отдельные активные резервы.')
 const locations=ledger.map(l=>{
  const s=stocks.find(x=>x.id===l.source_stock_id&&x.variant_id===review.sourceId)
  const k=stocks.find(x=>x.id===l.target_stock_id_before&&x.variant_id===review.keeperId)
  const activeKeeper=reserves.filter(r=>r.variant_id===review.keeperId&&r.status==='active'
    &&r.inventory_source===l.inventory_source).reduce((n,r)=>n+r.quantity,0)
  const good=!!s&&!!k&&l.decision_method==='sum'&&l.adjustment_quantity===0
    &&l.target_stock_id_before!==null
    &&l.combined_quantity_after===l.source_quantity_before+l.target_quantity_before
    &&l.source_reserved_before===(byLocation.get(l.inventory_source)||0)
    &&l.source_reserved_before<=l.source_quantity_before
    &&l.target_reserved_before<=l.target_quantity_before
    &&s.inventory_source===l.inventory_source&&k.inventory_source===l.inventory_source
    &&s.quantity===0&&s.reserved_quantity===0
    &&k.quantity===l.combined_quantity_after
    &&k.reserved_quantity===l.source_reserved_before+l.target_reserved_before
    &&activeKeeper===k.reserved_quantity
    &&s.last_source_ref==='catalog-consolidation:'+review.sourceId+'->'+review.keeperId
    &&k.last_source_ref==='catalog-consolidation:'+review.sourceId+'->'+review.keeperId
    &&Number.isFinite(Date.parse(s.updated_at||''))
    &&Number.isFinite(Date.parse(k.updated_at||''))
    &&Date.parse(s.updated_at||'')<=mergeTime&&Date.parse(k.updated_at||'')<=mergeTime
  if(!good)fail('stock_or_reserve_mismatch','Остатки или резервы склада/бутика не совпадают с исходным объединением.')
  return {location:l.inventory_source,sourceQuantity:l.source_quantity_before,
    keeperQuantity:l.target_quantity_before,sourceReserved:l.source_reserved_before,
    keeperReserved:l.target_reserved_before,currentPhysical:k?.quantity??null,
    currentReserved:k?.reserved_quantity??null,verified:good}
 })
 if(ledger.length===0||stocks.filter(x=>x.variant_id===review.sourceId).length!==ledger.length
   ||stocks.filter(x=>x.variant_id===review.keeperId).length!==ledger.length)
  fail('unverified_stock_rows','Есть дополнительные места хранения или отсутствуют исходные строки.')
 if(variants.length!==2)fail('unknown_sku','SKU больше не совпадают с исходными.')
 const stateToken=JSON.stringify({
  id,sourceId:review.sourceId,keeperId:review.keeperId,mergedAt:review.mergedAt,
  sourceUpdated:variants.find(x=>x.id===review.sourceId)?.updated_at,
  keeperUpdated:variants.find(x=>x.id===review.keeperId)?.updated_at,
  stocks:stocks.map(x=>[x.id,x.variant_id,x.inventory_source,x.quantity,x.reserved_quantity,x.updated_at,x.last_source_ref]),
  reservations:reserves.map(x=>[x.id,x.variant_id,x.inventory_source,x.quantity,x.status,x.updated_at,x.order_id,x.order_item_id]),
  links:links.map(x=>[x.reservation_id,x.order_id,x.order_item_id,x.item_quantity,x.order_updated_at,x.now_date,x.item_variant,x.item_status,x.order_status,x.shipping_status])
 })
 return {ok:true,consolidationId:id,sourceId:review.sourceId,keeperId:review.keeperId,
  canRestoreUntouchedReservations:blockers.length===0,blockers,locations,
  reservationCount:links.length,stateToken,
  physicalTotal:locations.reduce((n,l)=>n+(l.currentPhysical??0),0),
  reserveTotal:locations.reduce((n,l)=>n+(l.currentReserved??0),0),
  explanation:blockers.length?'Автоматически возвращать резервы небезопасно. Просмотрите зависимости.':'Все первоначальные резервы открыты и неизменны. Доступна защищённая компенсация.'}
}
