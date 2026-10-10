// Narrow generation-3 re-merge of a *verified zero-stock* source following
// the separately validated generation-2 undo. No inventory, payment, order,
// reservation or movement row is ever written by this operation.
import { previewCatalogVariantConsolidation } from './catalog-variant-consolidation.ts'

type Root = {
  root_id:number; undo_event_id:number; undo_at:string;
  source_id:number; original_keeper:number; original_physical:number;
  original_reserved:number; undo_proven:number; root_stock_rows:number;
  stock_proven:number; reservation_proven:number; original_reservation_rows:number;
}
type PairSnapshot={ source_identity:string; target_identity:string; stock_fingerprint:string }
const validId=(value:number)=>Number.isSafeInteger(value)&&value>0
const humanReason=(value:string)=>typeof value==='string' && value.trim().length>=12 && value.trim().length<=500

// The same predicates are executed during preview and AGAIN by the database
// when inserting the generation-3 event in the atomic write batch.
const sourceDependenciesSafe=`
  NOT EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.variant_id=s.id)
  AND NOT EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE oi.variant_id=s.id AND (
      julianday(oi.created_at) IS NULL OR julianday(o.updated_at) IS NULL
      OR MAX(julianday(oi.created_at),julianday(o.updated_at))>=julianday(undo.created_at)
      OR (o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent' AND oi.quantity>0)
    ))
  AND NOT EXISTS(SELECT 1 FROM inventory_movements m WHERE m.variant_id=s.id
    AND (julianday(m.created_at) IS NULL OR julianday(m.created_at)>=julianday(undo.created_at)))
  AND NOT EXISTS(SELECT 1 FROM inventory_stock_checks ch WHERE ch.variant_id=s.id
    AND (julianday(ch.checked_at) IS NULL OR julianday(ch.checked_at)>=julianday(undo.created_at)))
  AND NOT EXISTS(SELECT 1 FROM workshop_tasks w WHERE w.variant_id=s.id AND w.status='active')
  AND NOT EXISTS(SELECT 1 FROM inventory_lifecycle_events l WHERE l.variant_id=s.id
    AND l.status IN ('pending','applied'))
  AND NOT EXISTS(SELECT 1 FROM inventory_stocktake_items i
    JOIN inventory_stocktake_sessions sess ON sess.id=i.session_id
    WHERE i.variant_id=s.id AND sess.status='active')
  AND NOT EXISTS(SELECT 1 FROM inventory_transfer_items i
    JOIN inventory_transfer_documents d ON d.id=i.transfer_id
    WHERE i.variant_id=s.id AND d.status='applied')
  AND NOT EXISTS(SELECT 1 FROM order_items oi WHERE oi.variant_id=s.id AND (
    EXISTS(SELECT 1 FROM return_items ri WHERE ri.order_item_id=oi.id)
    OR EXISTS(SELECT 1 FROM exchanges ex
      WHERE ex.old_order_item_id=oi.id OR ex.new_order_item_id=oi.id)
    OR EXISTS(SELECT 1 FROM exchange_items ei WHERE ei.order_item_id=oi.id)
  ))
  AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidations other
    WHERE other.source_variant_id=k.id OR other.target_variant_id=s.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_stock st WHERE st.variant_id=s.id
    AND (st.quantity IS NULL OR st.quantity<>0
      OR st.reserved_quantity IS NULL OR st.reserved_quantity<>0
      OR st.inventory_source NOT IN ('warehouse','boutique')))
  AND (SELECT COUNT(*) FROM inventory_stock st WHERE st.variant_id=s.id)>0
  AND (SELECT COUNT(*) FROM inventory_stock st WHERE st.variant_id=s.id)
      =(SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
        WHERE l.consolidation_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_stock st
    LEFT JOIN catalog_variant_consolidation_stock_rows l
      ON l.source_stock_id=st.id AND l.consolidation_id=c.id
    WHERE st.variant_id=s.id AND (
      l.source_stock_id IS NULL OR l.inventory_source<>st.inventory_source
      OR l.source_quantity_before<>0 OR l.source_reserved_before<>0
    ))
`

const pairSnapshotSql=`SELECT
 json_array(s.id,s.product_id,s.stock_position_id,s.category,s.gender,s.color,s.size_label,
   s.material,s.length,s.is_active,s.updated_at) AS source_identity,
 json_array(k.id,k.product_id,k.stock_position_id,k.category,k.gender,k.color,k.size_label,
   k.material,k.length,k.is_active,k.updated_at) AS target_identity,
 (SELECT COALESCE(json_group_array(json_array(
    id,inventory_source,variant_id,quantity,reserved_quantity,updated_at,last_source_ref
  )),'[]') FROM (
    SELECT id,inventory_source,variant_id,quantity,reserved_quantity,updated_at,last_source_ref
    FROM inventory_stock WHERE variant_id IN (s.id,k.id) ORDER BY id
  )) AS stock_fingerprint
 FROM catalog_variants s JOIN catalog_variants k ON k.id=?
 WHERE s.id=?`

async function readRoot(db:D1Database,sourceId:number):Promise<Root|null>{
  return db.prepare(`SELECT c.id AS root_id,undo.id AS undo_event_id,undo.created_at AS undo_at,
    c.source_variant_id AS source_id,c.target_variant_id AS original_keeper,
    c.source_physical_quantity AS original_physical,
    c.source_reserved_quantity AS original_reserved,
    COALESCE(uv.passed,0) AS undo_proven,
    (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
      WHERE l.consolidation_id=c.id) AS root_stock_rows,
    (SELECT COUNT(*) FROM catalog_variant_consolidation_validations v
      WHERE v.consolidation_id=c.id AND v.passed=1) AS stock_proven,
    (SELECT COUNT(*) FROM catalog_variant_consolidation_reservation_validations v
      WHERE v.consolidation_id=c.id AND v.passed=1) AS reservation_proven,
    (SELECT COUNT(*) FROM catalog_variant_consolidation_reservation_rows r
      WHERE r.consolidation_id=c.id) AS original_reservation_rows
   FROM catalog_variant_consolidations c
   JOIN catalog_variant_merge_generation_events undo ON undo.id=(
     SELECT e.id FROM catalog_variant_merge_generation_events e
     WHERE e.source_variant_id=c.source_variant_id ORDER BY e.generation DESC LIMIT 1
   ) AND undo.generation=2 AND undo.event_kind='undo'
   LEFT JOIN catalog_variant_zero_stock_undo_validations uv
     ON uv.generation_event_id=undo.id AND uv.root_consolidation_id=c.id
   WHERE c.source_variant_id=?`).bind(sourceId).first<Root>()
}
async function readDependenciesSafe(db:D1Database,sourceId:number,keeperId:number,rootId:number,undoId:number) {
  const row=await db.prepare(`SELECT CASE WHEN ${sourceDependenciesSafe} THEN 1 ELSE 0 END AS passed
    FROM catalog_variant_consolidations c
    JOIN catalog_variants s ON s.id=c.source_variant_id
    JOIN catalog_variants k ON k.id=?
    JOIN catalog_variant_merge_generation_events undo ON undo.id=?
    WHERE c.id=? AND s.id=?`).bind(keeperId,undoId,rootId,sourceId).first<{passed:number}>()
  return row?.passed===1
}

export async function previewZeroStockReMerge(db:D1Database,sourceId:number,keeperId:number){
  if(!validId(sourceId)||!validId(keeperId)||sourceId===keeperId){
    throw new Error('Выберите разные варианты одного товара.')
  }
  // Existing canonical identity checks also protect material, length, size,
  // gender, color, position and product boundaries.
  const base=await previewCatalogVariantConsolidation(db,sourceId,keeperId)
  const [root,snapshot]=await Promise.all([
    readRoot(db,sourceId),
    db.prepare(pairSnapshotSql).bind(keeperId,sourceId).first<PairSnapshot>(),
  ])
  const blockers:string[]=[]
  if(!base.requiresGenerationAwareReMerge) blockers.push('Вариант не имеет подтверждённой отмены первого объединения.')
  if(!root || root.undo_proven!==1 || root.original_physical!==0
    || root.original_reserved!==0 || root.root_stock_rows<1 || root.stock_proven!==1
    || root.reservation_proven!==1 || root.original_reservation_rows!==0){
    blockers.push('Нет полного проверенного журнала объединения с нулевыми остатками и последующей отмены.')
  }
  // Preserve the original standard SKU checks except the expected
  // "this SKU was merged before" blocker.
  blockers.push(...base.blockers.filter(message=>!message.includes('уже объединяли и затем восстановили')))
  if(base.stockBreakdown.some(p=>p.sourcePhysical!==0||p.sourceReserved!==0)){
    blockers.push('Исходный вариант содержит складской остаток или резерв. Нужна отдельная физическая сверка.')
  }
  if(root && !(await readDependenciesSafe(db,sourceId,keeperId,root.root_id,root.undo_event_id))){
    blockers.push('После отмены изменились заказы, склад, проверки или зависимые операции исходного варианта.')
  }
  if(!snapshot) blockers.push('Не удалось проверить оба варианта и их складские записи.')
  const token=JSON.stringify({
    rootId:root?.root_id??null,undoEventId:root?.undo_event_id??null,
    sourceIdentity:snapshot?.source_identity??null,targetIdentity:snapshot?.target_identity??null,
    stockFingerprint:snapshot?.stock_fingerprint??null,
    originalPreviewToken:base.stateToken,
    blockers,
  })
  return {
    ok:true,sourceId,keeperId,rootId:root?.root_id??null,
    generation:3,blockers,canReMerge:blockers.length===0,
    stateToken:token,
    explanation:blockers.length
      ? 'Повторное объединение не выполнено. Проверьте указанные обязательства; физические остатки менять автоматически нельзя.'
      : 'Исходный вариант имеет нулевой остаток и не участвовал в новых операциях. Будет сохранена новая запись истории, а старый вариант скрыт без изменения остатков или заказов.',
  }
}

export async function reMergeZeroStockCatalogVariant(
  db:D1Database,sourceId:number,keeperId:number,actor:string,reason:string,expectedToken:string,
) {
  if(!humanReason(reason)||!actor?.trim()) throw new Error('Администратор должен указать причину повторного объединения (12–500 символов).')
  if(!expectedToken) throw new Error('Сначала выполните проверку повторного объединения.')
  const preview=await previewZeroStockReMerge(db,sourceId,keeperId)
  if(!preview.canReMerge)throw new Error('Повторное объединение пока недоступно: '+preview.blockers.join('; '))
  if(expectedToken!==preview.stateToken) throw new Error('Данные изменились. Обновите проверку объединения.')
  const state=JSON.parse(expectedToken) as {
    rootId:number;undoEventId:number;sourceIdentity:string;targetIdentity:string;stockFingerprint:string
  }
  const stamp=new Date().toISOString()
  const insert=db.prepare(`INSERT INTO catalog_variant_merge_generation_events
   (root_consolidation_id,source_variant_id,target_variant_id,generation,event_kind,reason,created_by,created_at)
   SELECT c.id,s.id,k.id,3,'merge',?,?,?
   FROM catalog_variant_consolidations c
   JOIN catalog_variants s ON s.id=c.source_variant_id
   JOIN catalog_variants k ON k.id=?
   JOIN catalog_variant_merge_generation_events undo
     ON undo.id=? AND undo.root_consolidation_id=c.id
       AND undo.source_variant_id=s.id AND undo.generation=2 AND undo.event_kind='undo'
   JOIN catalog_variant_zero_stock_undo_validations uv
     ON uv.generation_event_id=undo.id AND uv.root_consolidation_id=c.id AND uv.passed=1
   WHERE c.id=? AND s.id=? AND s.is_active=1 AND k.is_active=1
     AND s.product_id=c.product_id AND k.product_id=c.product_id
     AND c.source_physical_quantity=0 AND c.source_reserved_quantity=0
     AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_validations v
       WHERE v.consolidation_id=c.id AND v.passed=1)
     AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_validations v
       WHERE v.consolidation_id=c.id AND v.passed=1)
     AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_rows r
       WHERE r.consolidation_id=c.id)
     AND undo.id=(SELECT e.id FROM catalog_variant_merge_generation_events e
       WHERE e.source_variant_id=s.id ORDER BY e.generation DESC LIMIT 1)
     AND ${sourceDependenciesSafe}
     AND (SELECT json_array(s.id,s.product_id,s.stock_position_id,s.category,s.gender,s.color,s.size_label,
       s.material,s.length,s.is_active,s.updated_at))=?
     AND (SELECT json_array(k.id,k.product_id,k.stock_position_id,k.category,k.gender,k.color,k.size_label,
       k.material,k.length,k.is_active,k.updated_at))=?
     AND (SELECT COALESCE(json_group_array(json_array(
       id,inventory_source,variant_id,quantity,reserved_quantity,updated_at,last_source_ref
     )),'[]') FROM (
       SELECT id,inventory_source,variant_id,quantity,reserved_quantity,updated_at,last_source_ref
       FROM inventory_stock WHERE variant_id IN (s.id,k.id) ORDER BY id
     ))=?
  `).bind(reason.trim(),actor.trim(),stamp,keeperId,state.undoEventId,state.rootId,sourceId,
    state.sourceIdentity,state.targetIdentity,state.stockFingerprint)
  const retire=db.prepare(`UPDATE catalog_variants SET is_active=0,updated_at=?
    WHERE id=? AND is_active=1
      AND json_array(id,product_id,stock_position_id,category,gender,color,size_label,
        material,length,is_active,updated_at)=?
      AND EXISTS(SELECT 1 FROM catalog_variant_merge_generation_events e
        WHERE e.root_consolidation_id=? AND e.source_variant_id=? AND e.target_variant_id=?
          AND e.generation=3 AND e.event_kind='merge' AND e.created_at=?)
      AND NOT EXISTS(SELECT 1 FROM inventory_stock st
        WHERE st.variant_id=? AND (st.quantity<>0 OR st.reserved_quantity<>0))
  `).bind(stamp,sourceId,state.sourceIdentity,state.rootId,sourceId,keeperId,stamp,sourceId)
  const proof=db.prepare(`INSERT INTO catalog_variant_zero_stock_remerge_validations
    (generation_event_id,root_consolidation_id,source_variant_id,target_variant_id,
      source_stock_rows,stock_fingerprint,passed,created_by,checked_at)
    SELECT e.id,e.root_consolidation_id,e.source_variant_id,e.target_variant_id,
       (SELECT COUNT(*) FROM inventory_stock st WHERE st.variant_id=e.source_variant_id),
       (SELECT COALESCE(json_group_array(json_array(
         id,inventory_source,variant_id,quantity,reserved_quantity,updated_at,last_source_ref
       )),'[]') FROM (
         SELECT id,inventory_source,variant_id,quantity,reserved_quantity,updated_at,last_source_ref
         FROM inventory_stock
         WHERE variant_id IN (e.source_variant_id,e.target_variant_id) ORDER BY id
       )),
       CASE WHEN s.is_active=0 AND k.is_active=1
          AND s.updated_at=? AND ${sourceDependenciesSafe}
          AND (SELECT COALESCE(json_group_array(json_array(
            id,inventory_source,variant_id,quantity,reserved_quantity,updated_at,last_source_ref
          )),'[]') FROM (
            SELECT id,inventory_source,variant_id,quantity,reserved_quantity,updated_at,last_source_ref
            FROM inventory_stock WHERE variant_id IN (s.id,k.id) ORDER BY id
          ))=? THEN 1 ELSE 0 END,?,?
    FROM catalog_variant_merge_generation_events e
    JOIN catalog_variant_consolidations c ON c.id=e.root_consolidation_id
    JOIN catalog_variant_merge_generation_events undo ON undo.id=?
    JOIN catalog_variants s ON s.id=e.source_variant_id
    JOIN catalog_variants k ON k.id=e.target_variant_id
    WHERE e.root_consolidation_id=? AND e.source_variant_id=? AND e.target_variant_id=?
      AND e.generation=3 AND e.event_kind='merge' AND e.created_at=?
  `).bind(stamp,state.stockFingerprint,actor.trim(),stamp,
    state.undoEventId,state.rootId,sourceId,keeperId,stamp)
  let results:D1Result[]
  try{results=await db.batch([insert,retire,proof])}
  catch{throw new Error('Повторное объединение не применено: данные или обязательства изменились. Обновите проверку.')}
  if(results.length!==3 || results.some(item=>Number(item.meta?.changes)!==1)){
    throw new Error('Данные изменились. Повторное объединение не применено; обновите проверку.')
  }
  return {
    ok:true,reMerged:true,sourceId,keeperId,rootId:state.rootId,generation:3,
    physicalDelta:0,reservationDelta:0,
    message:'Вариант объединён повторно. Остатки, финансы и история заказов не изменены.',
  }
}
