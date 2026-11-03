import { createClient3WatchOrder, type WatchCreateInput } from './client3-watch-create.ts'
import {dispatchClient3WatchOrder} from './client3-watch-dispatch.ts'
import {correctClient3WatchDispatch} from './client3-watch-dispatch-correction.ts'
import {readClient3WatchHandover,clarifyClient3WatchHandover} from './client3-watch-handover.ts'
import {addClient3WatchDebtPayment} from './client3-watch-payments.ts'
import {correctClient3WatchMetadata,correctClient3WatchItemPrices} from './client3-watch-order-corrections.ts'
import {correctClient3AdminWatchDetails} from './client3-watch-admin-details.ts'
import {previewClient3AdminOrderDelete,deleteClient3AdminOrder,reassignClient3AdminOrderManager} from './client3-watch-admin-order.ts'
import {correctClient3AdminPaymentMethod} from './client3-watch-admin-payment-method.ts'
import {rewriteClient3AdminWatchItems} from './client3-watch-admin-composition.ts'
import {exchangeClient3Watch} from './client3-watch-exchange.ts'
import {exchangeClient3WatchSet} from './client3-watch-exchange-set.ts'
import {getClient3WatchFinance} from './client3-watch-finance.ts'
import {getClient3WatchAnalytics} from './client3-watch-analytics.ts'
import {listClient3WatchReportCityOrders,getClient3WatchReportDayDetails} from './client3-watch-report-details.ts'
import {getWatchSharedCash,setupWatchSharedCash,writeWatchSharedCash,setWatchSharedCashAuto,reverseWatchSharedCash,resetWatchSharedCashCycle} from './client3-watch-shared-cash.ts'
import {listClient3WatchTeam,saveClient3WatchEmployee,setClient3WatchEmployeeActive,listClient3WatchTimesheet,saveClient3WatchTimesheet,listClient3WatchTeamSalary,listClient3WatchTeamActivity} from './client3-watch-team-main.ts'
import {listClient3WatchPlans,saveClient3WatchPlan,deleteClient3WatchPlan,listClient3WatchLeads,saveClient3WatchLead,deleteClient3WatchLead} from './client3-watch-plans-leads.ts'
import {updateClient3WatchCatalogPrice} from './client3-watch-pricing.ts'
import {listLegacyClient3Orders} from './client3-watch-legacy.ts'
import {countClient3WatchStock,countClient3WatchStockBatch} from './client3-watch-stocktake.ts'
import {getClient3WatchRevision,startClient3WatchRevision,changeClient3WatchRevision} from './client3-watch-revision-session.ts'
import {applyClient3WatchBulkOperation} from './client3-watch-bulk.ts'
import {listClient3WatchStockHistory} from './client3-watch-history.ts'
import {createClient3WatchReturn,receiveClient3WatchReturn,listPendingClient3WatchReturns} from './client3-watch-returns.ts'
import { provisionClient3WatchSku } from './client3-watch-provision.ts'
import { receiveClient3WatchArrival, transferClient3WatchStock } from './client3-watch-inventory.ts'
import { writeoffClient3WatchStock } from './client3-watch-writeoff.ts'
import { listClient3WatchOrders } from './client3-watch-orders-read.ts'
import { listWatchCatalogDrafts, registerWatchModel, registerWatchVariant } from './client3-watch-catalog.ts'
import {listWatchModelAliases,addWatchModelAlias,deleteWatchModelAlias} from './client3-watch-model-aliases.ts'
import {editClient3WatchModel,editClient3WatchVariant} from './client3-watch-catalog-edit.ts'
import {previewClient3WatchDelete,deleteClient3WatchCatalog} from './client3-watch-catalog-delete.ts'
import {listClient3WatchReferences,createClient3WatchReference,updateClient3WatchReference,deleteClient3WatchReference} from './client3-watch-references.ts'
import type { WatchVariantInput } from '../../shared/client3/watch-domain.ts'
import { json, readJson } from '../core/http.ts'
import type { AuthUser } from '../core/types.ts'
import { normalizeWatchBrand, type WatchBrand } from '../../shared/client3/watch-domain.ts'

/**
 * These routes are enabled ONLY in the isolated third Worker. There is no
 * external caller-provided role, manager ID or trusted brand header.
 * All brand access comes from the authenticated session and DB memberships.
 */
const staffCanSeeAllLogistics=(actor:AuthUser)=>
  actor.role==='admin'||actor.employeeRole==='Логист'||actor.employeeRole==='Упаковщик'
const FORBIDDEN=()=>json({ok:false,code:'WATCH_BRAND_FORBIDDEN',
  message:'Нет доступа к запрошенному бренду.'},{status:403})
const BAD=(message:string)=>json({ok:false,message},{status:400})

async function brandRow(db:D1Database,code:string) {
  return db.prepare('SELECT id, code FROM watch_brands WHERE code=? AND is_active=1')
    .bind(code).first<{id:number,code:WatchBrand}>()
}
async function canViewBrand(db:D1Database,actor:AuthUser,brandId:number,mode:'logistics'|'sales') {
  if(actor.role==='admin'||(mode==='logistics'&&staffCanSeeAllLogistics(actor)))return true
  if(mode==='sales'&&(actor.employeeRole==='Логист'||actor.employeeRole==='Упаковщик'))return false
  if(!actor.managerId)return false
  const row=await db.prepare('SELECT 1 AS ok FROM watch_manager_brands mb JOIN managers m ON m.id=mb.manager_id AND m.is_active=1 WHERE mb.manager_id=? AND mb.brand_id=? LIMIT 1')
    .bind(actor.managerId,brandId).first<{ok:number}>()
  return Boolean(row?.ok)
}
async function scopedBrand(db:D1Database,actor:AuthUser,input:unknown,mode:'sales'|'logistics') {
  let code:WatchBrand
  try{code=normalizeWatchBrand(input)}catch{return {error:BAD('Укажите бренд TAUWACH или WACHIZEN')} }
  const row=await brandRow(db,code)
  if(!row||!(await canViewBrand(db,actor,row.id,mode)))return {error:FORBIDDEN()}
  return {row}
}

export async function listWatchBrands(db:D1Database,actor:AuthUser) {
  const rows=await db.prepare(`
    SELECT b.code,b.name FROM watch_brands b
    WHERE b.is_active=1 AND (?=1 OR EXISTS (
      SELECT 1 FROM watch_manager_brands mb JOIN managers m ON m.id=mb.manager_id AND m.is_active=1 WHERE mb.brand_id=b.id AND mb.manager_id=?
    )) ORDER BY b.code
  `).bind(staffCanSeeAllLogistics(actor)?1:0,actor.managerId||0)
    .all<{code:WatchBrand,name:string}>()
  return json({ok:true,brands:rows.results||[]})
}

export async function listWatchManagers(db:D1Database,actor:AuthUser,url:URL) {
  const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
  if(scope.error)return scope.error
  const rows=await db.prepare(
    'SELECT m.id,m.name FROM watch_manager_brands mb JOIN managers m ON m.id=mb.manager_id AND m.is_active=1 WHERE mb.brand_id=? AND COALESCE(m.role,\'Менеджер\') NOT IN (\'Логист\',\'Упаковщик\') ORDER BY m.name COLLATE NOCASE,m.id',
  ).bind(scope.row!.id).all<{id:number;name:string}>()
  return json({ok:true,brand:scope.row!.code,managers:actor.role==='admin'?rows.results||[]:
    (rows.results||[]).filter(x=>x.id===actor.managerId)})
}

export async function listWatchStaff(db:D1Database,actor:AuthUser) {
  if(actor.role!=='admin')return FORBIDDEN()
  const rows=await db.prepare(
    'SELECT m.id,m.name,m.role,m.is_active,b.code AS brand FROM managers m LEFT JOIN watch_manager_brands mb ON mb.manager_id=m.id LEFT JOIN watch_brands b ON b.id=mb.brand_id WHERE m.is_active=1 ORDER BY m.name COLLATE NOCASE,m.id,b.code',
  ).all<{id:number;name:string;role:string;is_active:number;brand:WatchBrand|null}>()
  const grouped=new Map<number,{id:number;name:string;brands:WatchBrand[]}>()
  for(const row of rows.results||[]) {
    if(!grouped.has(row.id))grouped.set(row.id,{id:row.id,name:row.name,brands:[]})
    if(row.brand&&!['Логист','Упаковщик'].includes(row.role||''))grouped.get(row.id)!.brands.push(row.brand)
  }
  return json({ok:true,staff:Array.from(grouped.values())})
}

export async function assignWatchManagerBrands(
  db:D1Database,actor:AuthUser,managerId:number,
  raw:{brands?:unknown;expectedBrands?:unknown;requestId?:unknown},
) {
  if(actor.role!=='admin')return FORBIDDEN()
  if(!Number.isSafeInteger(managerId)||managerId<=0)return BAD('Укажите сотрудника')
  if(!Array.isArray(raw.brands)||!Array.isArray(raw.expectedBrands)||
    raw.brands.length>2||raw.expectedBrands.length>2)return BAD('Нужны новые и ожидаемые бренды')
  let next:WatchBrand[],expected:WatchBrand[]
  try{
    next=[...new Set(raw.brands.map(normalizeWatchBrand))].sort()
    expected=[...new Set(raw.expectedBrands.map(normalizeWatchBrand))].sort()
  }catch{return BAD('Укажите TAUWACH и/или WACHIZEN')}
  if(typeof raw.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(raw.requestId))
    return BAD('Нужен уникальный requestId')
  const done=await db.prepare(
    'SELECT manager_id,previous_brands,next_brands,actor_user_id FROM watch_manager_brand_events WHERE request_id=? LIMIT 1',
  ).bind(raw.requestId).first<{manager_id:number;previous_brands:string;next_brands:string;actor_user_id:number}>()
  if(done)return done.manager_id===managerId&&done.actor_user_id===actor.id&&
    done.previous_brands===JSON.stringify(expected)&&done.next_brands===JSON.stringify(next)
      ?json({ok:true,alreadyCommitted:true,managerId,brands:next})
      :json({ok:false,code:'WATCH_ASSIGNMENT_REPLAY_CONFLICT'},{status:409})
  const manager=await db.prepare('SELECT id,role FROM managers WHERE id=? AND is_active=1 LIMIT 1')
    .bind(managerId).first<{id:number;role:string}>()
  if(!manager)return json({ok:false,code:'WATCH_MANAGER_NOT_FOUND'},{status:404})
  if(['Логист','Упаковщик'].includes(manager.role||'')&&next.length)
    return BAD('Логист работает с обоими брендами без персональных назначений.')
  const rows=await db.prepare(
    'SELECT b.code FROM watch_manager_brands mb JOIN watch_brands b ON b.id=mb.brand_id WHERE mb.manager_id=? ORDER BY b.code',
  ).bind(managerId).all<{code:WatchBrand}>()
  const current=(rows.results||[]).map(x=>x.code)
  if(JSON.stringify(current)!==JSON.stringify(expected))
    return json({ok:false,code:'WATCH_ASSIGNMENT_STALE',message:'Назначения изменились. Обновите список.'},{status:409})
  if(JSON.stringify(current)===JSON.stringify(next))
    return json({ok:true,alreadySet:true,managerId,brands:next})
  const inserts=next.map(code=>db.prepare(
    'INSERT INTO watch_manager_brands(manager_id,brand_id) SELECT ?,id FROM watch_brands WHERE code=? AND is_active=1',
  ).bind(managerId,code))
  await db.batch([
    db.prepare('DELETE FROM watch_manager_brands WHERE manager_id=?').bind(managerId),
    ...inserts,
    db.prepare(
      'INSERT INTO watch_manager_brand_events(manager_id,actor_user_id,previous_brands,next_brands,request_id) VALUES(?,?,?,?,?)',
    ).bind(managerId,actor.id,JSON.stringify(current),JSON.stringify(next),raw.requestId),
  ])
  return json({ok:true,managerId,brands:next})
}

export async function listWatchModels(db:D1Database,actor:AuthUser,url:URL) {
  const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
  if(scope.error)return scope.error
  const rows=await db.prepare(`
    SELECT wp.id AS watchProductId,wp.model_name AS modelName,
      v.id AS watchVariantId,v.catalog_variant_id AS catalogVariantId,
      v.gender,COALESCE((SELECT a.movement FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=v.id),v.movement) AS movement,
      COALESCE((SELECT a.bracelet_material FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=v.id),v.bracelet_material) AS braceletMaterial,
      COALESCE((SELECT a.dial_color FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=v.id),v.dial_color) AS dialColor,
      COALESCE((SELECT a.bracelet_color FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=v.id),v.bracelet_color) AS braceletColor,
      MAX(ep.sale_price) AS catalogPriceSnapshot,
      COALESCE(SUM(CASE WHEN s.inventory_source='warehouse' THEN s.quantity ELSE 0 END),0) AS officePhysical,
      COALESCE(SUM(CASE WHEN s.inventory_source='warehouse' THEN s.reserved_quantity ELSE 0 END),0) AS officeReserved,
      COALESCE(SUM(CASE WHEN s.inventory_source='boutique' THEN s.quantity ELSE 0 END),0) AS showcasePhysical,
      COALESCE(SUM(CASE WHEN s.inventory_source='boutique' THEN s.reserved_quantity ELSE 0 END),0) AS showcaseReserved
    FROM watch_products wp
    JOIN watch_variants v ON v.watch_product_id=wp.id AND v.is_active=1
    JOIN catalog_variants cv ON cv.id=v.catalog_variant_id AND cv.is_active=1
    LEFT JOIN catalog_execution_prices ep ON ep.stock_position_id=cv.stock_position_id AND ep.category=COALESCE(cv.category,'adult')
    LEFT JOIN inventory_stock s ON s.variant_id=v.catalog_variant_id
    WHERE wp.brand_id=? AND wp.is_active=1
      AND wp.catalog_product_id IS NOT NULL AND v.catalog_variant_id IS NOT NULL
    GROUP BY wp.id,v.id
    ORDER BY wp.model_name COLLATE NOCASE,v.id
  `).bind(scope.row!.id).all()
  return json({ok:true,brand:scope.row!.code,models:rows.results||[]})
}

export async function listWatchLogistics(db:D1Database,actor:AuthUser,url:URL) {
  const code=url.searchParams.get('brand')
  let brandId=0
  if(code){const scope=await scopedBrand(db,actor,code,'logistics');if(scope.error)return scope.error;brandId=scope.row!.id}
  const status=url.searchParams.get('status')
  if(status&& !['pending','engraving','ready','all'].includes(status))return BAD('Некорректный статус логистики')
  const rows=await db.prepare(`
    SELECT o.id AS orderId,o.external_id AS externalId,wb.code AS brand,
      o.source_type AS legacySource,o.shipping_status AS shippingStatus,
      wd.recipient_name AS recipientName,wd.recipient_phone AS recipientPhone,
      wd.delivery_full_address AS address,wd.postal_code AS postalCode,wd.city,
      wd.delivery_method AS deliveryMethod,wd.urgent,
      wd.shipping_deadline_at AS shippingDeadlineAt,wd.deadline_timezone AS deadlineTimezone,
      lj.status AS engravingStatus,lj.ready_at AS readyAt,
      oi.id AS orderItemId,oi.quantity,oi.source_type AS itemSource,
      oi.stock_writeoff_status AS stockWriteoffStatus,
      ir.status AS reservationStatus,wp.model_name AS modelName,
      COALESCE((SELECT SUM(di.quantity-di.cancelled_quantity)
        FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
        WHERE di.order_item_id=oi.id AND d.order_id=oi.order_id),0) AS shippedQuantity,
      (SELECT di2.id FROM order_dispatch_items di2
        JOIN order_dispatches d2 ON d2.id=di2.dispatch_id
        WHERE di2.order_item_id=oi.id AND d2.order_id=o.id
          AND di2.quantity>COALESCE(di2.cancelled_quantity,0)
        ORDER BY di2.id DESC LIMIT 1) AS dispatchItemId,
      wditem.engraving_text AS engravingText,
      v.gender,COALESCE((SELECT a.movement FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=v.id),v.movement) AS movement,
      COALESCE((SELECT a.bracelet_material FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=v.id),v.bracelet_material) AS braceletMaterial,
      COALESCE((SELECT a.dial_color FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=v.id),v.dial_color) AS dialColor,
      COALESCE((SELECT a.bracelet_color FROM watch_variant_attributes_v5 a WHERE a.watch_variant_id=v.id),v.bracelet_color) AS braceletColor
    FROM watch_order_details wd
    JOIN watch_brands wb ON wb.id=wd.brand_id
    JOIN orders o ON o.id=wd.order_id AND o.order_status NOT IN ('deleted','archived')
    JOIN watch_logistics_jobs lj ON lj.order_id=wd.order_id
    LEFT JOIN order_items oi ON oi.order_id=wd.order_id AND oi.quantity>0
    LEFT JOIN inventory_reservations ir ON ir.order_item_id=oi.id
    LEFT JOIN watch_order_item_details wditem ON wditem.order_item_id=oi.id
    LEFT JOIN watch_variants v ON v.id=wditem.watch_variant_id
    LEFT JOIN watch_products wp ON wp.id=v.watch_product_id
    WHERE (?=0 OR wd.brand_id=?)
      AND (? IS NULL OR ?='all' OR lj.status=?)
      AND (?=1 OR EXISTS (
        SELECT 1 FROM watch_manager_brands mb JOIN managers m ON m.id=mb.manager_id AND m.is_active=1
        WHERE mb.manager_id=? AND mb.brand_id=wd.brand_id
      ))
    ORDER BY wd.urgent DESC,wd.shipping_deadline_at ASC,o.id ASC,oi.id ASC
    LIMIT 500
  `).bind(brandId,brandId,status,status,status,
    staffCanSeeAllLogistics(actor)?1:0,actor.managerId||0).all()
  return json({ok:true,rows:rows.results||[]})
}

/** Idempotent engraving completion. NEVER invokes shipping, reservations or money. */
export async function markWatchLogisticsReady(
  db:D1Database,actor:AuthUser,orderId:number,requestId:unknown,
) {
  if(!staffCanSeeAllLogistics(actor))return FORBIDDEN()
  if(!Number.isSafeInteger(orderId)||orderId<=0)return BAD('Некорректный заказ')
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(requestId))
    return BAD('Требуется уникальный requestId')
  const previous=await db.prepare('SELECT order_id FROM watch_logistics_events WHERE request_id=?')
    .bind(requestId).first<{order_id:number}>()
  if(previous){
    if(previous.order_id!==orderId)return json({ok:false,code:'REQUEST_ID_CONFLICT'},{status:409})
    return json({ok:true,alreadyCommitted:true,engravingStatus:'ready',shippingUnchanged:true})
  }
  const row=await db.prepare(`
    SELECT lj.status,wd.brand_id,o.order_status FROM watch_logistics_jobs lj
    JOIN watch_order_details wd ON wd.order_id=lj.order_id
    JOIN orders o ON o.id=wd.order_id
    WHERE lj.order_id=? LIMIT 1
  `).bind(orderId).first<{status:string,brand_id:number,order_status:string}>()
  if(!row||['archived','deleted'].includes(row.order_status))
    return json({ok:false,code:'ORDER_NOT_ACTIVE'},{status:409})
  if(row.status==='ready')
    return json({ok:true,alreadyReady:true,engravingStatus:'ready',shippingUnchanged:true})
  const timestamp=new Date().toISOString()
  // Batch executes atomically in D1. The per-order CAS lets exactly one worker
  // win. The audit SELECT is bound to the winning requestId, not the wall clock.
  const results=await db.batch([
    db.prepare(`
      UPDATE watch_logistics_jobs
      SET status='ready',ready_at=?,ready_by_user_id=?,ready_request_id=?,updated_at=?
      WHERE order_id=? AND status=? AND ready_request_id IS NULL
    `).bind(timestamp,actor.id,requestId,timestamp,orderId,row.status),
    db.prepare(`
      INSERT INTO watch_logistics_events(order_id,actor_user_id,previous_status,next_status,request_id,created_at)
      SELECT order_id,?,?,'ready',?,?
      FROM watch_logistics_jobs WHERE order_id=? AND ready_request_id=?
    `).bind(actor.id,row.status,requestId,timestamp,orderId,requestId),
  ])
  if(Number(results[0]?.meta?.changes||0)!==1)
    return json({ok:false,code:'LOGISTICS_STALE',message:'Статус изменился, обновите логистику.'},{status:409})
  return json({ok:true,engravingStatus:'ready',shippingUnchanged:true,stockUnchanged:true,moneyUnchanged:true})
}

export async function routeClient3Watches(
  db:D1Database,request:Request,url:URL,actor:AuthUser,
):Promise<Response|null> {
  if(url.pathname==='/api/client3/watches/references'&&request.method==='GET')
    return listClient3WatchReferences(db,actor)
  if(url.pathname==='/api/client3/watches/references'&&request.method==='POST'){
    const input=await readJson<{kind?:unknown;value?:unknown}>(request)
    return createClient3WatchReference(db,actor,input)
  }
  if(url.pathname==='/api/client3/watches/references'&&request.method==='PATCH'){
    const data=await readJson<{id?:unknown;kind?:unknown;value?:unknown}>(request)
    return updateClient3WatchReference(db,actor,data)
  }
  const refDelete=/^\/api\/client3\/watches\/references\/(\d+)$/.exec(url.pathname)
  if(refDelete&&request.method==='DELETE')
    return deleteClient3WatchReference(db,actor,Number(refDelete[1]))
  if(url.pathname==='/api/client3/watches/stock/revision'&&request.method==='GET'){
    const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return getClient3WatchRevision(db,actor,scope.row!.id,url)
  }
  if(url.pathname==='/api/client3/watches/stock/revision/start'&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;source?:unknown;full?:unknown;modelIds?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return startClient3WatchRevision(db,actor,scope.row!.id,input)
  }
  const watchRevisionAction=/^\/api\/client3\/watches\/stock\/revision\/(count|add|complete|cancel)$/.exec(url.pathname)
  if(watchRevisionAction&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;sessionId?:unknown;itemId?:unknown;
      countedQuantity?:unknown;watchVariantId?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return changeClient3WatchRevision(db,actor,scope.row!.id,
      watchRevisionAction[1] as 'count'|'add'|'complete'|'cancel',input)
  }
  if(url.pathname==='/api/client3/watches/stock/history'&&request.method==='GET'){
    const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return listClient3WatchStockHistory(db,actor,scope.row!.id,url)
  }
  if(url.pathname==='/api/client3/watches/stock/bulk'&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;source?:unknown;kind?:unknown;requestId?:unknown;
      comment?:unknown;items?:Array<{watchVariantId?:unknown;quantity?:unknown;expectedPhysical?:unknown}>}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return applyClient3WatchBulkOperation(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/stock/count-batch'&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;source?:unknown;requestId?:unknown;
      confirmed?:unknown;allowShortage?:unknown;items?:Array<{watchVariantId?:unknown;
      expectedPhysical?:unknown;countedQuantity?:unknown}>}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return countClient3WatchStockBatch(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/stock/count'&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;watchVariantId?:unknown;source?:unknown;expectedPhysical?:unknown;countedQuantity?:unknown;requestId?:unknown;confirmed?:unknown;allowShortage?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return countClient3WatchStock(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/stock/writeoff'&&request.method==='POST') {
    const input=await readJson<{brand?:unknown;watchVariantId?:unknown;quantity?:unknown;source?:unknown;expectedPhysical?:unknown;requestId?:unknown;comment?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return writeoffClient3WatchStock(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/stock/transfer'&&request.method==='POST') {
    const input=await readJson<{brand?:unknown;watchVariantId?:unknown;quantity?:unknown;source?:unknown;expectedPhysical?:unknown;requestId?:unknown;comment?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return transferClient3WatchStock(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/stock/arrival'&&request.method==='POST') {
    const input=await readJson<{brand?:unknown;watchVariantId?:unknown;quantity?:unknown;source?:unknown;requestId?:unknown;comment?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return receiveClient3WatchArrival(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/catalog/prices'&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;watchVariantId?:unknown;salePrice?:unknown;expectedPrice?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return updateClient3WatchCatalogPrice(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/catalog/provision'&&request.method==='POST') {
    const input=await readJson<{brand?:unknown;watchVariantId?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return provisionClient3WatchSku(db,actor,scope.row!.id,Number(input.watchVariantId))
  }
  if(url.pathname==='/api/client3/watches/catalog'&&request.method==='GET') {
    const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return listWatchCatalogDrafts(db,actor,scope.row!.id)
  }
  if((url.pathname==='/api/client3/watches/catalog/delete-preview'||
      url.pathname==='/api/client3/watches/catalog/delete')&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;kind?:unknown;watchProductId?:unknown;watchVariantId?:unknown;
      movement?:unknown;braceletMaterial?:unknown;expectedCount?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return url.pathname.endsWith('delete-preview')
      ? previewClient3WatchDelete(db,actor,scope.row!.id,input)
      : deleteClient3WatchCatalog(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/catalog/model-aliases'&&request.method==='GET'){
    const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return listWatchModelAliases(db,actor,scope.row!.id,
      Number(url.searchParams.get('watchProductId')))
  }
  if(url.pathname==='/api/client3/watches/catalog/model-aliases'&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;watchProductId?:unknown;alias?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return addWatchModelAlias(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/catalog/model-aliases'&&request.method==='DELETE'){
    const input=await readJson<{brand?:unknown;watchProductId?:unknown;aliasId?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return deleteWatchModelAlias(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/catalog/models'&&request.method==='PATCH') {
    const input=await readJson<{brand?:unknown;watchProductId?:unknown;expectedName?:unknown;modelName?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return editClient3WatchModel(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/catalog/variants'&&request.method==='PATCH') {
    const input=await readJson<WatchVariantInput&{brand?:unknown;watchProductId?:unknown;watchVariantId?:unknown;expected?:WatchVariantInput}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return editClient3WatchVariant(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/catalog/models'&&request.method==='POST') {
    const input=await readJson<{brand?:unknown;modelName?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return registerWatchModel(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/catalog/variants'&&request.method==='POST') {
    const input=await readJson<WatchVariantInput & {brand?:unknown;watchProductId?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    // One user action creates and prepares exactly one SKU. A failed provision
    // may leave a catalog draft, but retries reuse the same watchVariantId.
    const created=await registerWatchVariant(db,actor,scope.row!.id,input)
    if(!created.ok)return created
    const saved=await created.json() as {
      ok:boolean;watchVariantId?:number;created?:boolean;alreadyExists?:boolean;restored?:boolean
    }
    const variantId=Number(saved.watchVariantId||0)
    if(!Number.isSafeInteger(variantId)||variantId<1)
      return json({ok:false,code:'WATCH_VARIANT_NOT_CONFIRMED',
        message:'Не удалось подтвердить новую комплектацию. Обновите каталог.'},{status:409})
    let prepared:Response
    try{
      prepared=await provisionClient3WatchSku(db,actor,scope.row!.id,variantId)
    }catch(cause){
      // The watch identity is already written. Tell the UI to reload and
      // offer retrying the same SKU; never claim the whole create was rolled back.
      return json({ok:false,code:'WATCH_VARIANT_PROVISION_FAILED',
        message:'Комплектация сохранена, но не удалось подготовить складскую позицию: '+
          (cause instanceof Error?cause.message:'повторите подготовку SKU'),
        partial:true,watchVariantId:variantId},{status:409})
    }
    const result=await prepared.json() as {
      ok:boolean;code?:string;message?:string;canonicalVariantId?:number
    }
    if(!prepared.ok||!result.ok){
      return json({ok:false,code:result.code||'WATCH_VARIANT_PROVISION_FAILED',
        message:'Комплектация сохранена, но складская позиция не подготовлена: '+
          (result.message||'Обновите каталог и повторите подготовку SKU.'),
        partial:true,watchVariantId:variantId},{status:409})
    }
    return json({...saved,stockLinked:true,stockCreated:false,
      watchVariantId:variantId,catalogVariantId:result.canonicalVariantId},
      {status:saved.created?201:200})
  }
  if(url.pathname==='/api/client3/watches/returns/pending'&&request.method==='GET'){
    const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return listPendingClient3WatchReturns(db,actor,scope.row!.id)
  }
  const watchHandoverMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/stock-handover$/.exec(url.pathname)
  if(watchHandoverMatch&&(request.method==='GET'||request.method==='POST')){
    const input=request.method==='POST'?await readJson<{brand?:unknown;action?:unknown;
      orderItemId?:unknown;checkpointId?:unknown;checkpointAt?:unknown}>(request):null
    const scope=await scopedBrand(db,actor,
      input?.brand??url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    const id=Number(watchHandoverMatch[1])
    return request.method==='GET'
      ?readClient3WatchHandover(db,actor,scope.row!.id,id)
      :clarifyClient3WatchHandover(db,actor,scope.row!.id,id,input||{})
  }
  const exchangeSetMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/exchange-set$/.exec(url.pathname)
  if(exchangeSetMatch&&request.method==='POST'){
    const input=await readJson<Record<string,unknown>>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return exchangeClient3WatchSet(db,actor,scope.row!.id,
      Number(exchangeSetMatch[1]),input as Parameters<typeof exchangeClient3WatchSet>[4])
  }
  const exchangeMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/exchange$/.exec(url.pathname)
  if(exchangeMatch&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;requestId?:unknown;newWatchVariantId?:unknown;newSource?:unknown;engravingText?:unknown;reason?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return exchangeClient3Watch(db,actor,scope.row!.id,Number(exchangeMatch[1]),input)
  }
  const watchReturnMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/return$/.exec(url.pathname)
  if(watchReturnMatch&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;requestId?:unknown;kind?:unknown;quantity?:unknown;items?:unknown;amount?:unknown;paymentMethod?:unknown;refundParts?:unknown;reason?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return createClient3WatchReturn(db,actor,scope.row!.id,Number(watchReturnMatch[1]),input)
  }
  const watchReceiveMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/return\/receive$/.exec(url.pathname)
  if(watchReceiveMatch&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;requestId?:unknown;returnId?:unknown;returnItemId?:unknown;destination?:unknown;operationType?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return receiveClient3WatchReturn(db,actor,scope.row!.id,Number(watchReceiveMatch[1]),input)
  }
  const rewriteMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/items$/.exec(url.pathname)
  if(rewriteMatch&&request.method==='PATCH'){
    const input=await readJson<Record<string,unknown>>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return rewriteClient3AdminWatchItems(db,actor,scope.row!.id,Number(rewriteMatch[1]),
      input as Parameters<typeof rewriteClient3AdminWatchItems>[4])
  }
  const methodMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/payment-method$/.exec(url.pathname)
  if(methodMatch&&request.method==='PATCH'){
    const input=await readJson<Record<string,unknown>>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return correctClient3AdminPaymentMethod(db,actor,scope.row!.id,Number(methodMatch[1]),
      input as Parameters<typeof correctClient3AdminPaymentMethod>[4])
  }
  const adminDeleteMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/delete$/.exec(url.pathname)
  if(adminDeleteMatch&&(request.method==='GET'||request.method==='POST')){
    const input=request.method==='POST'?await readJson<Record<string,unknown>>(request):null
    const scope=await scopedBrand(db,actor,input?.brand??url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return request.method==='GET'
      ?previewClient3AdminOrderDelete(db,actor,scope.row!.id,Number(adminDeleteMatch[1]))
      :deleteClient3AdminOrder(db,actor,scope.row!.id,Number(adminDeleteMatch[1]),
        input as Parameters<typeof deleteClient3AdminOrder>[4])
  }
  const managerEditMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/manager$/.exec(url.pathname)
  if(managerEditMatch&&request.method==='PATCH'){
    const input=await readJson<Record<string,unknown>>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return reassignClient3AdminOrderManager(db,actor,scope.row!.id,Number(managerEditMatch[1]),
      input as Parameters<typeof reassignClient3AdminOrderManager>[4])
  }
  const detailsMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/watch-details$/.exec(url.pathname)
  if(detailsMatch&&request.method==='PATCH'){
    const input=await readJson<Record<string,unknown>>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return correctClient3AdminWatchDetails(db,actor,scope.row!.id,Number(detailsMatch[1]),
      input as Parameters<typeof correctClient3AdminWatchDetails>[4])
  }
  const metaMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/metadata$/.exec(url.pathname)
  if(metaMatch&&request.method==='PATCH'){
    const input=await readJson<Record<string,unknown>>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return correctClient3WatchMetadata(db,actor,scope.row!.id,Number(metaMatch[1]),input as Parameters<typeof correctClient3WatchMetadata>[4])
  }
  const pricesMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/prices$/.exec(url.pathname)
  if(pricesMatch&&request.method==='PATCH'){
    const input=await readJson<Record<string,unknown>>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return correctClient3WatchItemPrices(db,actor,scope.row!.id,Number(pricesMatch[1]),input as Parameters<typeof correctClient3WatchItemPrices>[4])
  }
  const paymentMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/payments$/.exec(url.pathname)
  if(paymentMatch&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;requestId?:unknown;method?:unknown;
      amount?:unknown;paymentDate?:unknown;comment?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return addClient3WatchDebtPayment(db,actor,scope.row!.id,Number(paymentMatch[1]),input)
  }
  const correctionMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/dispatch-correction$/.exec(url.pathname)
  if(correctionMatch&&request.method==='POST'){
    const input=await readJson<Record<string,unknown>>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return correctClient3WatchDispatch(db,actor,scope.row!.id,
      Number(correctionMatch[1]),input)
  }
  const sendMatch=/^\/api\/client3\/watches\/orders\/(\d+)\/send$/.exec(url.pathname)
  if(sendMatch&&request.method==='POST'){
    const input=await readJson<{brand?:unknown;requestId?:unknown}>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return dispatchClient3WatchOrder(db,actor,scope.row!.id,Number(sendMatch[1]),input)
  }
  if(url.pathname==='/api/client3/watches/legacy-orders'&&request.method==='GET')return listLegacyClient3Orders(db,actor)
  if(url.pathname==='/api/client3/watches/plans'&&request.method==='GET'){
    const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return listClient3WatchPlans(db,actor,scope.row!.id,url)
  }
  if(url.pathname==='/api/client3/watches/plans'&&request.method==='POST'){
    const input=await readJson<Record<string,unknown>>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return saveClient3WatchPlan(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/plans'&&request.method==='DELETE'){
    const input=await readJson<Record<string,unknown>>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return deleteClient3WatchPlan(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/leads'&&request.method==='GET'){
    const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return listClient3WatchLeads(db,actor,scope.row!.id,url)
  }
  if(url.pathname==='/api/client3/watches/leads'&&request.method==='POST'){
    const input=await readJson<Record<string,unknown>>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return saveClient3WatchLead(db,actor,scope.row!.id,input)
  }
  if(url.pathname==='/api/client3/watches/leads'&&request.method==='DELETE'){
    const input=await readJson<Record<string,unknown>>(request)
    const scope=await scopedBrand(db,actor,input.brand,'sales')
    if(scope.error)return scope.error
    return deleteClient3WatchLead(db,actor,scope.row!.id,input)
  }
  // Physically unified cash: neither selected brand nor manager affiliation
  // may change its balance. Authentication+admin authorization happen twice.
  if(url.pathname==='/api/client3/watches/cash'&&request.method==='GET')
    return getWatchSharedCash(db,actor)
  if(url.pathname==='/api/client3/watches/cash'&&request.method==='POST'){
    const input=await readJson<Record<string,unknown>>(request)
    if(actor.role!=='admin')return FORBIDDEN()
    if(input.action==='auto')return setWatchSharedCashAuto(db,actor,input.enabled)
    if(input.action==='reverse')return reverseWatchSharedCash(db,actor,input)
    if(input.action==='reset')return resetWatchSharedCashCycle(db,actor,input)
    if(input.action==='setup')return setupWatchSharedCash(db,actor,input)
    if(input.action==='manual'||input.action==='reconcile')
      return writeWatchSharedCash(db,actor,input.action,input)
    return BAD('Неизвестная операция общей кассы.')
  }
  if(url.pathname==='/api/client3/watches/analytics/city-orders'&&request.method==='GET'){
    const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return listClient3WatchReportCityOrders(db,actor,scope.row!.id,url)
  }
  if(url.pathname==='/api/client3/watches/analytics/day'&&request.method==='GET'){
    const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return getClient3WatchReportDayDetails(db,actor,scope.row!.id,url)
  }
  if(url.pathname==='/api/client3/watches/analytics'&&request.method==='GET'){
    const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return getClient3WatchAnalytics(db,actor,scope.row!.id,url)
  }
  if(url.pathname==='/api/client3/watches/finance'&&request.method==='GET'){
    const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return getClient3WatchFinance(db,actor,scope.row!.id,url)
  }
  if(url.pathname==='/api/client3/watches/orders'&&request.method==='GET') {
    const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
    if(scope.error)return scope.error
    return listClient3WatchOrders(db,actor,scope.row!.id,url)
  }
  if(url.pathname==='/api/client3/watches/orders'&&request.method==='POST') {
    const raw=await readJson<WatchCreateInput>(request)
    const scope=await scopedBrand(db,actor,raw?.brand,'sales')
    if(scope.error)return scope.error
    return createClient3WatchOrder(db,actor,scope.row!.id,raw)
  }
  // Main-style employees and workflows. Admin guard is enforced again in domain.
  if(url.pathname==='/api/client3/watches/team'&&request.method==='GET')
    return listClient3WatchTeam(db,actor)
  if(url.pathname==='/api/client3/watches/team/employees'&&request.method==='POST')
    return saveClient3WatchEmployee(db,actor,await readJson<Record<string,unknown>>(request))
  const teamStatus=new RegExp('^/api/client3/watches/team/employees/([0-9]+)/status$').exec(url.pathname)
  if(teamStatus&&request.method==='PATCH'){
    const input=await readJson<{isActive?:unknown}>(request)
    return setClient3WatchEmployeeActive(db,actor,Number(teamStatus[1]),input.isActive)
  }
  if(url.pathname==='/api/client3/watches/team/timesheet'&&request.method==='GET')
    return listClient3WatchTimesheet(db,actor,url)
  if(url.pathname==='/api/client3/watches/team/timesheet'&&request.method==='POST')
    return saveClient3WatchTimesheet(db,actor,await readJson<{dates?:unknown;managerIds?:unknown;
      workUntil?:unknown;comment?:unknown;clear?:unknown}>(request))
  if(url.pathname==='/api/client3/watches/team/salary'&&request.method==='GET')
    return listClient3WatchTeamSalary(db,actor,url)
  if(url.pathname==='/api/client3/watches/team/activity'&&request.method==='GET')
    return listClient3WatchTeamActivity(db,actor,url)
  if(url.pathname==='/api/client3/watches/staff'&&request.method==='GET')
    return listWatchStaff(db,actor)
  const staffMatch=/^\/api\/client3\/watches\/staff\/(\d+)\/brands$/.exec(url.pathname)
  if(staffMatch&&request.method==='POST'){
    const data=await readJson<{brands?:unknown;expectedBrands?:unknown;requestId?:unknown}>(request)
    return assignWatchManagerBrands(db,actor,Number(staffMatch[1]),data)
  }
  if(url.pathname==='/api/client3/watches/managers'&&request.method==='GET')
    return listWatchManagers(db,actor,url)
  if(url.pathname==='/api/client3/watches/brands'&&request.method==='GET')
    return listWatchBrands(db,actor)
  if(url.pathname==='/api/client3/watches/models'&&request.method==='GET')
    return listWatchModels(db,actor,url)
  if(url.pathname==='/api/client3/watches/logistics'&&request.method==='GET')
    return listWatchLogistics(db,actor,url)
  const match=/^\/api\/client3\/watches\/logistics\/(\d+)\/ready$/.exec(url.pathname)
  if(match&&request.method==='POST'){
    const data=await readJson<{requestId?:unknown}>(request)
    return markWatchLogisticsReady(db,actor,Number(match[1]),data.requestId)
  }
  if(url.pathname.startsWith('/api/client3/watches/'))
    return json({ok:false,code:'WATCH_ROUTE_NOT_FOUND'},{status:404})
  return null
}
