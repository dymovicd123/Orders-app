// Narrow, audited finalization of two historical manual inventory operations.
// Does not reverse, delete, edit, or fabricate inventory movements or stock.
import { toInt } from '../core/text.ts'

const SOURCE=1532, KEEPER=1280
const MOVEMENTS=[4876,5400] as const
const PHYSICAL_CHECK=3250
type State={id:number;variant_id:number;inventory_source:string;quantity:number;reserved_quantity:number;updated_at:string}
type Move={id:number;variant_id:number;inventory_source:string;quantity_delta:number;quantity_after:number;reference_type:string;created_at:string}
function assert(condition:unknown,message:string): asserts condition {
 if(!condition)throw new Error(message)
}
export async function previewEthnoSize52HistoryFinalization(db:D1Database){
 const [variants,stock,movements,check,existing,sourceReserves,sourceOrders,activeStocktakes,sourceLifecycle,sourceTransfers,sourceWork,otherUnreversed,oldMerges]=await Promise.all([
  db.prepare('SELECT id,product_id,stock_position_id,color,material,length,gender,size_label,is_active FROM catalog_variants WHERE id IN (1280,1532) ORDER BY id').all<Record<string,unknown>>(),
  db.prepare('SELECT id,variant_id,inventory_source,quantity,reserved_quantity,updated_at FROM inventory_stock WHERE variant_id IN (1280,1532) ORDER BY variant_id,inventory_source').all<State>(),
  db.prepare('SELECT id,variant_id,inventory_source,quantity_delta,quantity_after,reference_type,created_at FROM inventory_movements WHERE id IN (4876,5400) ORDER BY id').all<Move>(),
  db.prepare('SELECT id,variant_id,inventory_source,expected_quantity,counted_quantity,difference_quantity,check_type FROM inventory_stock_checks WHERE id=?').bind(PHYSICAL_CHECK).first<Record<string,unknown>>(),
  db.prepare('SELECT movement_id FROM catalog_manual_movement_finalizations WHERE movement_id IN (4876,5400)').all<{movement_id:number}>(),
  db.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE variant_id IN (1280,1532) AND status='active'").first<{n:number}>(),
  db.prepare("SELECT COUNT(*) AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.variant_id=1532 AND o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent'").first<{n:number}>(),
  db.prepare("SELECT COUNT(*) AS n FROM inventory_stocktake_items i JOIN inventory_stocktake_sessions s ON s.id=i.session_id WHERE i.variant_id IN (1280,1532) AND s.status='active'").first<{n:number}>(),
  db.prepare("SELECT COUNT(*) AS n FROM inventory_lifecycle_events WHERE variant_id=1532 AND status IN ('pending','applied')").first<{n:number}>(),
  db.prepare("SELECT COUNT(*) AS n FROM inventory_transfer_items i JOIN inventory_transfer_documents d ON d.id=i.transfer_id WHERE i.variant_id=1532 AND d.status='applied'").first<{n:number}>(),
  db.prepare("SELECT COUNT(*) AS n FROM workshop_tasks WHERE variant_id=1532 AND status='active'").first<{n:number}>(),
  db.prepare(`SELECT m.id FROM inventory_movements m
    WHERE m.variant_id=1532 AND LOWER(TRIM(COALESCE(m.reference_type,''))) IN ('manual','transfer_in','transfer_out')
      AND NOT EXISTS(SELECT 1 FROM inventory_movement_reversals r WHERE r.original_movement_id=m.id)
    ORDER BY m.id`).all<{id:number}>(),
  db.prepare('SELECT COUNT(*) AS n FROM catalog_variant_consolidations WHERE source_variant_id=1532').first<{n:number}>()
 ])
 const v=variants.results||[],s=stock.results||[],m=movements.results||[]
 const blockers:string[]=[]
 if(v.length!==2||v.some(x=>x.product_id!==75||x.stock_position_id!==146||x.is_active!==1||x.gender!=='ЖЕН'||x.size_label!=='52'||x.material!=='ДРАП'||x.length!=='СТАНДАРТ'))blockers.push('SKU identity changed')
 if(v.find(x=>x.id===SOURCE)?.color!=='СВЕТЛО СЕРЫЙ'||v.find(x=>x.id===KEEPER)?.color!=='СВЕТЛО-СЕРЫЙ')blockers.push('Canonical color mapping changed')
 if(!s.some(x=>x.variant_id===SOURCE&&x.inventory_source==='warehouse'&&x.id===1411&&x.quantity===0&&x.reserved_quantity===0)
 ||s.some(x=>x.quantity!==0||x.reserved_quantity!==0))blockers.push('Physical stock or reserves changed')
 if(m.length!==2||m[0].id!==4876||m[0].variant_id!==SOURCE||m[0].inventory_source!=='warehouse'||m[0].reference_type!=='manual'||m[0].quantity_delta!==1
 ||m[1].id!==5400||m[1].variant_id!==SOURCE||m[1].inventory_source!=='warehouse'||m[1].reference_type!=='manual'||m[1].quantity_delta!==-1
 ||m[0].quantity_after!==1||m[1].quantity_after!==0)blockers.push('Original manual movement pair changed')
 if(!check||check.id!==PHYSICAL_CHECK||check.variant_id!==SOURCE||check.inventory_source!=='warehouse'
 ||check.expected_quantity!==1||check.counted_quantity!==0||check.difference_quantity!==-1||check.check_type!=='manual_set')blockers.push('Confirmed physical stock check is missing')
 if((existing.results||[]).length)blockers.push('Some movements already finalized')
 if((otherUnreversed.results||[]).map(x=>x.id).join(',')!=='4876,5400')blockers.push('Additional reversible source movements')
 if((sourceReserves?.n||0)||(sourceOrders?.n||0)||(activeStocktakes?.n||0)||(sourceLifecycle?.n||0)||(sourceTransfers?.n||0)||(sourceWork?.n||0))blockers.push('Active operational dependency')
 if((oldMerges?.n||0)!==0)blockers.push('Source already consolidated')
 const originalReversed=await db.prepare('SELECT original_movement_id FROM inventory_movement_reversals WHERE original_movement_id IN (4876,5400)').all()
 if(originalReversed.results.length)blockers.push('One of the original operations already reversed')
 const token=JSON.stringify({variants:v,stock:s,movements:m,check,sourceReserves:sourceReserves?.n,sourceOrders:sourceOrders?.n,activeStocktakes:activeStocktakes?.n,sourceLifecycle:sourceLifecycle?.n,sourceTransfers:sourceTransfers?.n,sourceWork:sourceWork?.n,other:otherUnreversed.results})
 return {ok:true,sourceId:SOURCE,keeperId:KEEPER,originalMovements:MOVEMENTS,physicalCheckId:PHYSICAL_CHECK,physicalTotal:s.reduce((sum,x)=>sum+x.quantity,0),blockers,canFinalize:blockers.length===0,stateToken:token}
}

export async function finalizeEthnoSize52History(
 db:D1Database, actor:string, reason:string, expectedToken:string,
){
 assert(actor.trim().length>0,'Admin identity required')
 assert(reason.trim().length>=12&&reason.trim().length<=500,'Specify why the individually reversible history is being closed')
 const preview=await previewEthnoSize52HistoryFinalization(db)
 assert(preview.canFinalize,'Finalization blocked: '+preview.blockers.join('; '))
 assert(expectedToken&&expectedToken===preview.stateToken,'The audited stock state changed; refresh preview')
 const time=new Date().toISOString()
 // Single D1 transaction. All predicates are re-checked at INSERT time.
 const rows=await db.batch([
   db.prepare(`INSERT INTO catalog_manual_movement_finalizations
     (movement_id,source_variant_id,keeper_variant_id,stock_check_id,movement_delta,reason,finalized_by,finalized_at)
     SELECT m.id,1532,1280,3250,m.quantity_delta,?,?,?
     FROM inventory_movements m
     WHERE m.id IN (4876,5400) AND m.variant_id=1532
       AND m.reference_type='manual' AND m.inventory_source='warehouse'
       AND ((m.id=4876 AND m.quantity_delta=1 AND m.quantity_after=1)
         OR (m.id=5400 AND m.quantity_delta=-1 AND m.quantity_after=0))
       AND EXISTS(SELECT 1 FROM inventory_stock_checks c WHERE c.id=3250
           AND c.variant_id=1532 AND c.inventory_source='warehouse'
           AND c.check_type='manual_set' AND c.expected_quantity=1
           AND c.counted_quantity=0 AND c.difference_quantity=-1)
       AND EXISTS(SELECT 1 FROM catalog_variants v JOIN catalog_variants k ON k.id=1280
         WHERE v.id=1532 AND v.is_active=1 AND k.is_active=1
          AND v.product_id=75 AND k.product_id=75
          AND v.stock_position_id=146 AND k.stock_position_id=146
          AND v.color='СВЕТЛО СЕРЫЙ' AND k.color='СВЕТЛО-СЕРЫЙ'
          AND v.size_label='52' AND k.size_label='52')
       AND EXISTS(SELECT 1 FROM inventory_stock s WHERE s.id=1411 AND s.variant_id=1532 AND s.inventory_source='warehouse' AND s.quantity=0 AND s.reserved_quantity=0)
       AND NOT EXISTS(SELECT 1 FROM inventory_stock s WHERE s.variant_id IN (1280,1532) AND (s.quantity<>0 OR s.reserved_quantity<>0))
       AND NOT EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.variant_id IN (1280,1532) AND r.status='active')
       AND NOT EXISTS(SELECT 1 FROM inventory_movements other
         WHERE other.variant_id=1532
          AND LOWER(TRIM(COALESCE(other.reference_type,''))) IN ('manual','transfer_in','transfer_out')
          AND other.id NOT IN (4876,5400)
          AND NOT EXISTS(SELECT 1 FROM inventory_movement_reversals rev WHERE rev.original_movement_id=other.id))
       AND NOT EXISTS(SELECT 1 FROM inventory_movement_reversals rev WHERE rev.original_movement_id IN (4876,5400))
       AND NOT EXISTS(SELECT 1 FROM inventory_lifecycle_events e WHERE e.variant_id=1532 AND e.status IN ('pending','applied'))
       AND NOT EXISTS(SELECT 1 FROM inventory_stocktake_items i JOIN inventory_stocktake_sessions s ON s.id=i.session_id WHERE i.variant_id IN (1280,1532) AND s.status='active')
       AND NOT EXISTS(SELECT 1 FROM inventory_transfer_items i JOIN inventory_transfer_documents d ON d.id=i.transfer_id WHERE i.variant_id=1532 AND d.status='applied')
       AND NOT EXISTS(SELECT 1 FROM workshop_tasks WHERE variant_id=1532 AND status='active')
       AND NOT EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
          WHERE oi.variant_id=1532 AND o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent')
       AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidations WHERE source_variant_id=1532)`).bind(reason.trim(),actor.trim(),time),
   db.prepare(`INSERT INTO catalog_manual_finalization_validations(source_variant_id,passed,checked_at)
     SELECT 1532,CASE WHEN
       (SELECT COUNT(*) FROM catalog_manual_movement_finalizations f WHERE f.source_variant_id=1532 AND f.keeper_variant_id=1280 AND f.stock_check_id=3250)=2
       AND (SELECT COALESCE(SUM(f.movement_delta),12345) FROM catalog_manual_movement_finalizations f WHERE f.source_variant_id=1532)=0
       AND NOT EXISTS(SELECT 1 FROM inventory_stock s WHERE s.variant_id IN (1280,1532) AND (s.quantity<>0 OR s.reserved_quantity<>0))
       THEN 1 ELSE 0 END,?`).bind(time)
 ])
 assert(toInt(rows[0]?.meta?.changes,0)===2&&toInt(rows[1]?.meta?.changes,0)===1,'Finalization did not save exactly the two approved movements')
 return {ok:true,finalized:true,sourceId:SOURCE,keeperId:KEEPER,manualMovements:MOVEMENTS,physicalCheckId:PHYSICAL_CHECK}
}
