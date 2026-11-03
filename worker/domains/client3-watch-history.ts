import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {watchSourceToLegacy} from '../../shared/client3/watch-domain.ts'

const fail=(code:string,message:string,status=400)=>json({ok:false,code,message},{status})

/**
 * Read-only, brand- and SKU-owned movements from Main's physical movement log.
 * This intentionally never reads the legacy Problems/attention queue.
 * Cursor pagination happens AFTER SQL brand filtering, not client-side.
 */
export async function listClient3WatchStockHistory(
 db:D1Database,actor:AuthUser,brandId:number,url:URL,
){
 if((actor.role!=='admin'&&actor.employeeRole!=='Завсклад'))return fail('WATCH_HISTORY_ADMIN_ONLY',
   'Историю складских операций просматривает администратор.',403)
 const rawSource=url.searchParams.get('source')||'all'
 if(!['all','office','showcase'].includes(rawSource))
   return fail('WATCH_HISTORY_SOURCE','Выберите офис, витрину или обе точки.')
 const rawBefore=url.searchParams.get('beforeId')
 const beforeId=rawBefore===null?0:Number(rawBefore)
 if(!Number.isSafeInteger(beforeId)||beforeId<0)
   return fail('WATCH_HISTORY_CURSOR','Некорректная страница истории.')
 const limit=50
 const source=rawSource==='all'?'':watchSourceToLegacy(rawSource as 'office'|'showcase')
 const result=await db.prepare(`
  SELECT m.id,m.inventory_source,m.movement_type,m.quantity_delta,
    m.quantity_after,m.reference_type,m.reference_id,m.comment,m.created_at,
    wp.model_name,wv.id AS watch_variant_id,wv.gender,
    COALESCE(a.movement,wv.movement) AS mechanism,
    COALESCE(a.bracelet_material,wv.bracelet_material) AS bracelet_material,
    COALESCE(a.dial_color,wv.dial_color) AS dial_color,
    COALESCE(a.bracelet_color,wv.bracelet_color) AS bracelet_color
  FROM inventory_movements m
  JOIN watch_variants wv ON wv.catalog_variant_id=m.variant_id
  JOIN watch_products wp ON wp.id=wv.watch_product_id
  LEFT JOIN watch_variant_attributes_v5 a ON a.watch_variant_id=wv.id
  WHERE wp.brand_id=?
    AND (?='' OR m.inventory_source=?)
    AND (?=0 OR m.id<?)
  ORDER BY m.id DESC LIMIT ?
 `).bind(brandId,source,source,beforeId,beforeId,limit+1)
 .all<Record<string,unknown>>()
 const all=result.results||[],page=all.slice(0,limit)
 return json({ok:true,brandId,hasMore:all.length>limit,
   nextBeforeId:page.length?Number(page[page.length-1].id):null,
   rows:page.map(r=>({
     id:Number(r.id),source:r.inventory_source==='warehouse'?'office':'showcase',
     movementType:String(r.movement_type||''),
     quantityDelta:Number(r.quantity_delta||0),
     quantityAfter:Number(r.quantity_after||0),
     referenceType:String(r.reference_type||''),
     referenceId:String(r.reference_id||''),
     comment:String(r.comment||''),
     createdAt:String(r.created_at||''),
     modelName:String(r.model_name||''),
     watchVariantId:Number(r.watch_variant_id),
     gender:String(r.gender||''),
     movement:String(r.mechanism||''),
     braceletMaterial:String(r.bracelet_material||''),
     dialColor:String(r.dial_color||''),
     braceletColor:String(r.bracelet_color||''),
   }))})
}
