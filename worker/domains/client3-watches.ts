import { json, readJson } from '../core/http.ts'
import type { AuthUser } from '../core/types.ts'
import { normalizeWatchBrand, type WatchBrand } from '../../shared/client3/watch-domain.ts'

/**
 * These routes are enabled ONLY in the isolated third Worker. There is no
 * external caller-provided role, manager ID or trusted brand header.
 * All brand access comes from the authenticated session and DB memberships.
 */
const staffCanSeeAllLogistics=(actor:AuthUser)=>
  actor.role==='admin'||actor.employeeRole==='Логист'
const FORBIDDEN=()=>json({ok:false,code:'WATCH_BRAND_FORBIDDEN',
  message:'Нет доступа к запрошенному бренду.'},{status:403})
const BAD=(message:string)=>json({ok:false,message},{status:400})

async function brandRow(db:D1Database,code:string) {
  return db.prepare('SELECT id, code FROM watch_brands WHERE code=? AND is_active=1')
    .bind(code).first<{id:number,code:WatchBrand}>()
}
async function canViewBrand(db:D1Database,actor:AuthUser,brandId:number,mode:'logistics'|'sales') {
  if(actor.role==='admin'||(mode==='logistics'&&staffCanSeeAllLogistics(actor)))return true
  if(!actor.managerId)return false
  const row=await db.prepare('SELECT 1 AS ok FROM watch_manager_brands WHERE manager_id=? AND brand_id=? LIMIT 1')
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
      SELECT 1 FROM watch_manager_brands mb WHERE mb.brand_id=b.id AND mb.manager_id=?
    )) ORDER BY b.code
  `).bind(staffCanSeeAllLogistics(actor)?1:0,actor.managerId||0)
    .all<{code:WatchBrand,name:string}>()
  return json({ok:true,brands:rows.results||[]})
}

export async function listWatchModels(db:D1Database,actor:AuthUser,url:URL) {
  const scope=await scopedBrand(db,actor,url.searchParams.get('brand'),'sales')
  if(scope.error)return scope.error
  const rows=await db.prepare(`
    SELECT wp.id AS watchProductId,wp.model_name AS modelName,
      v.id AS watchVariantId,v.catalog_variant_id AS catalogVariantId,
      v.gender,v.movement,v.bracelet_material AS braceletMaterial,
      v.dial_color AS dialColor,v.bracelet_color AS braceletColor,
      COALESCE(SUM(CASE WHEN s.inventory_source='warehouse' THEN s.quantity ELSE 0 END),0) AS officePhysical,
      COALESCE(SUM(CASE WHEN s.inventory_source='warehouse' THEN s.reserved_quantity ELSE 0 END),0) AS officeReserved,
      COALESCE(SUM(CASE WHEN s.inventory_source='boutique' THEN s.quantity ELSE 0 END),0) AS showcasePhysical,
      COALESCE(SUM(CASE WHEN s.inventory_source='boutique' THEN s.reserved_quantity ELSE 0 END),0) AS showcaseReserved
    FROM watch_products wp
    JOIN watch_variants v ON v.watch_product_id=wp.id AND v.is_active=1
    LEFT JOIN inventory_stock s ON s.variant_id=v.catalog_variant_id
    WHERE wp.brand_id=? AND wp.is_active=1
      AND wp.catalog_product_id IS NOT NULL AND v.catalog_variant_id IS NOT NULL
    GROUP BY wp.id,v.id
    ORDER BY wp.model_name COLLATE NOCASE,v.id LIMIT 500
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
      wd.recipient_name AS recipientName,wd.recipient_phone AS recipientPhone,
      wd.delivery_full_address AS address,wd.postal_code AS postalCode,wd.city,
      wd.delivery_method AS deliveryMethod,wd.urgent,
      wd.shipping_deadline_at AS shippingDeadlineAt,wd.deadline_timezone AS deadlineTimezone,
      lj.status AS engravingStatus,lj.ready_at AS readyAt,
      oi.id AS orderItemId,oi.quantity,wp.model_name AS modelName,
      wditem.engraving_text AS engravingText,
      v.gender,v.movement,v.bracelet_material AS braceletMaterial,
      v.dial_color AS dialColor,v.bracelet_color AS braceletColor
    FROM watch_order_details wd
    JOIN watch_brands wb ON wb.id=wd.brand_id
    JOIN orders o ON o.id=wd.order_id AND o.order_status NOT IN ('deleted','archived')
    JOIN watch_logistics_jobs lj ON lj.order_id=wd.order_id
    LEFT JOIN order_items oi ON oi.order_id=wd.order_id
    LEFT JOIN watch_order_item_details wditem ON wditem.order_item_id=oi.id
    LEFT JOIN watch_variants v ON v.id=wditem.watch_variant_id
    LEFT JOIN watch_products wp ON wp.id=v.watch_product_id
    WHERE (?=0 OR wd.brand_id=?)
      AND (? IS NULL OR ?='all' OR lj.status=?)
      AND (?=1 OR EXISTS (
        SELECT 1 FROM watch_manager_brands mb
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
