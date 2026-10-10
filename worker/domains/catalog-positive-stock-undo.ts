// An audited compensation for one original positive-stock, strictly-additive
// SKU merge. Never rewrites order items, payments, reservations or movements.
import { previewCatalogConsolidationUndo } from './catalog-consolidation-undo-preview.ts'

type StockSnapshot={stock_token:string}
const safeId=(value:number)=>Number.isSafeInteger(value)&&value>0
const snapshotSql=`SELECT (SELECT COALESCE(json_group_array(json_array(
 id,variant_id,inventory_source,quantity,reserved_quantity,updated_at,last_source_ref
)),'[]') FROM (
 SELECT id,variant_id,inventory_source,quantity,reserved_quantity,updated_at,last_source_ref
 FROM inventory_stock WHERE variant_id IN (?,?) ORDER BY id
)) AS stock_token`
const stockFingerprint=`(SELECT COALESCE(json_group_array(json_array(
 id,variant_id,inventory_source,quantity,reserved_quantity,updated_at,last_source_ref
)),'[]') FROM (
 SELECT id,variant_id,inventory_source,quantity,reserved_quantity,updated_at,last_source_ref
 FROM inventory_stock WHERE variant_id IN (s.id,k.id) ORDER BY id
))`

// The employee-facing operations are NEVER held in a long-lived lock. The
// administrator's insertion fails if those operations succeeded first.
const noLaterActivity=`
  NOT EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE oi.variant_id IN (s.id,k.id) AND (
      julianday(oi.created_at) IS NULL OR julianday(o.updated_at) IS NULL
      OR MAX(julianday(oi.created_at),julianday(o.updated_at))>=julianday(c.created_at)
      OR (o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent'
          AND oi.quantity>0)
    ))
  AND NOT EXISTS(SELECT 1 FROM inventory_reservations r
    WHERE r.variant_id IN (s.id,k.id) AND (
      r.status='active' OR julianday(r.updated_at) IS NULL
      OR julianday(r.updated_at)>=julianday(c.created_at)
    ))
  AND NOT EXISTS(SELECT 1 FROM inventory_movements m
    WHERE m.variant_id IN (s.id,k.id) AND (
      julianday(m.created_at) IS NULL OR julianday(m.created_at)>=julianday(c.created_at)
    ))
  AND NOT EXISTS(SELECT 1 FROM inventory_stock_checks ch
    WHERE ch.variant_id IN (s.id,k.id) AND (
      julianday(ch.checked_at) IS NULL OR julianday(ch.checked_at)>=julianday(c.created_at)
    ))
  AND NOT EXISTS(SELECT 1 FROM workshop_tasks w
    WHERE w.variant_id IN (s.id,k.id) AND w.status='active')
  AND NOT EXISTS(SELECT 1 FROM inventory_lifecycle_events i
    WHERE i.variant_id IN (s.id,k.id) AND i.status IN ('pending','applied'))
  AND NOT EXISTS(SELECT 1 FROM inventory_stocktake_items i
    JOIN inventory_stocktake_sessions sess ON sess.id=i.session_id
    WHERE i.variant_id IN (s.id,k.id) AND sess.status='active')
  AND NOT EXISTS(SELECT 1 FROM inventory_transfer_items i
    JOIN inventory_transfer_documents t ON t.id=i.transfer_id
    WHERE i.variant_id IN (s.id,k.id) AND t.status='applied')
  AND NOT EXISTS(SELECT 1 FROM order_items oi WHERE oi.variant_id IN (s.id,k.id)
    AND (EXISTS(SELECT 1 FROM return_items r WHERE r.order_item_id=oi.id)
      OR EXISTS(SELECT 1 FROM exchanges ex
        WHERE ex.old_order_item_id=oi.id OR ex.new_order_item_id=oi.id)
      OR EXISTS(SELECT 1 FROM exchange_items ei WHERE ei.order_item_id=oi.id)))
  AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidations other
    WHERE other.id<>c.id
      AND (other.target_variant_id IN (s.id,k.id)
        OR other.source_variant_id=k.id))
`
const beforeStockValid=`
  c.source_physical_quantity>0 AND c.source_reserved_quantity=0
  AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_validations v
    WHERE v.consolidation_id=c.id AND v.passed=1)
  AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_validations v
    WHERE v.consolidation_id=c.id AND v.passed=1)
  AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_rows r
    WHERE r.consolidation_id=c.id)
  AND (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
    WHERE l.consolidation_id=c.id)>0
  AND (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
    WHERE l.consolidation_id=c.id)
    =(SELECT COUNT(*) FROM catalog_variant_consolidation_stock_decisions d
      WHERE d.consolidation_id=c.id)
  AND (SELECT COALESCE(SUM(l.source_quantity_before),-1)
    FROM catalog_variant_consolidation_stock_rows l WHERE l.consolidation_id=c.id)
    =c.source_physical_quantity
  AND NOT EXISTS(
    SELECT 1 FROM catalog_variant_consolidation_stock_rows l
    LEFT JOIN catalog_variant_consolidation_stock_decisions d
      ON d.consolidation_id=l.consolidation_id
      AND d.inventory_source=l.inventory_source
    LEFT JOIN inventory_stock ss ON ss.id=l.source_stock_id
    LEFT JOIN inventory_stock ks ON ks.id=l.target_stock_id_before
    WHERE l.consolidation_id=c.id AND (
      d.inventory_source IS NULL OR d.decision_method<>'sum' OR d.adjustment_quantity<>0
      OR d.final_quantity<>l.source_quantity_before+l.target_quantity_before
      OR l.combined_quantity_after<>d.final_quantity OR l.target_stock_id_before IS NULL
      OR l.source_reserved_before<>0 OR l.target_reserved_before<>0
      OR ss.id IS NULL OR ks.id IS NULL OR ss.variant_id<>s.id OR ks.variant_id<>k.id
      OR ss.inventory_source<>l.inventory_source OR ks.inventory_source<>l.inventory_source
      OR ss.quantity<>0 OR ss.reserved_quantity<>0 OR ks.quantity<>l.combined_quantity_after
      OR ks.reserved_quantity<>0
      OR ss.last_source_ref IS NOT ('catalog-consolidation:'||s.id||'->'||k.id)
      OR (l.source_quantity_before>0 AND
        ks.last_source_ref IS NOT ('catalog-consolidation:'||s.id||'->'||k.id))
      OR julianday(ss.updated_at) IS NULL OR julianday(ks.updated_at) IS NULL
      OR julianday(ss.updated_at)>julianday(c.created_at)
      OR julianday(ks.updated_at)>julianday(c.created_at)
    )
  )
  AND NOT EXISTS(SELECT 1 FROM inventory_stock st WHERE st.variant_id IN (s.id,k.id)
    AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
      WHERE l.consolidation_id=c.id AND (
        (st.variant_id=s.id AND st.id=l.source_stock_id)
        OR (st.variant_id=k.id AND st.id=l.target_stock_id_before)
      )))
`
export async function previewPositiveStockConsolidationUndo(db:D1Database,consolidationId:number){
  const original=await previewCatalogConsolidationUndo(db,consolidationId)
  const [stocks,events]=await Promise.all([
    db.prepare(snapshotSql).bind(original.sourceId,original.keeperId).first<StockSnapshot>(),
    db.prepare(`SELECT COUNT(*) AS count FROM catalog_variant_merge_generation_events
      WHERE source_variant_id IN (?,?)`).bind(original.sourceId,original.keeperId).first<{count:number}>()
  ])
  const blockers=original.blockers.filter(x=>x.code!=='physical_undo_requires_accounting')
  if(events?.count!==0)blockers.push({code:'previous_generation',message:'Вариант уже отменяли или объединяли повторно. Для следующего поколения нужен отдельный сценарий.'})
  if(!original.locations.length||!original.locations.some(l=>l.before.source>0)
    ||original.locations.some(l=>l.before.sourceReserved!==0||l.before.keeperReserved!==0
      ||l.decision!=='sum'||l.accountingCorrection!==0
      ||l.before.source<0||l.before.keeper<0
      ||l.after.source!==0||l.after.keeper!==l.before.source+l.before.keeper)){
    blockers.push({code:'not_pure_additive',
      message:'Автоматически можно восстановить только исходное суммирование остатков без резервов и исправлений количества.'})
  }
  if(original.impact.originalReservations>0){
    blockers.push({code:'reservations_at_merge',message:'Первоначальное объединение переносило резервы или позиции заказов.'})
  }
  if(!stocks?.stock_token)blockers.push({code:'missing_snapshot',message:'Не удалось проверить текущие складские записи.'})
  const unique=[...new Map(blockers.map(x=>[x.code,x])).values()]
  const stateToken=JSON.stringify({
    original:original.undoStateToken,stockFingerprint:stocks?.stock_token??null,
    generationCount:events?.count??-1,blockers:unique
  })
  return {
    ok:true,consolidationId,sourceId:original.sourceId,keeperId:original.keeperId,
    generation:2,canUndoPositiveStock:unique.length===0,
    locations:original.locations.map(l=>({
      location:l.location,label:l.locationLabel,sourceRestore:l.before.source,
      keeperBeforeUndo:l.after.keeper,keeperRestore:l.before.keeper,
      combinedPreserved:l.before.source+l.before.keeper,
    })),blockers:unique,stateToken,
    explanation:unique.length
      ? 'Автоматическая отмена невозможна: данные склада или связанные операции требуют отдельной проверки.'
      : 'Будут восстановлены два исходных количества по каждому месту хранения. Общий физический остаток не изменится.',
  }
}
export async function undoPositiveStockCatalogConsolidation(
  db:D1Database,consolidationId:number,actor:string,reason:string,expectedToken:string
){
  if(!safeId(consolidationId))throw new Error('Укажите действительное объединение.')
  const who=(actor||'').trim(),why=(reason||'').trim()
  if(!who||why.length<12||why.length>500){
    throw new Error('Требуется администратор и причина исправления (12–500 символов).')
  }
  if(!expectedToken)throw new Error('Перед отменой выполните проверку склада и заказов.')
  const view=await previewPositiveStockConsolidationUndo(db,consolidationId)
  if(!view.canUndoPositiveStock){
    throw new Error('Сейчас нельзя отменить объединение: '+view.blockers.map(x=>x.message).join('; '))
  }
  if(view.stateToken!==expectedToken)throw new Error('Данные обновились. Проверьте отмену заново.')
  const token=JSON.parse(expectedToken) as {
    original:string;stockFingerprint:string;generationCount:number
  }
  const original=JSON.parse(token.original) as {variants:[string,string]}
  const stamp=new Date().toISOString()
  const ref='catalog-positive-undo:'+consolidationId
  const generation=db.prepare(`INSERT INTO catalog_variant_merge_generation_events
    (root_consolidation_id,source_variant_id,target_variant_id,generation,event_kind,
      reason,created_by,created_at)
    SELECT c.id,s.id,k.id,2,'undo',?,?,?
    FROM catalog_variant_consolidations c
    JOIN catalog_variants s ON s.id=c.source_variant_id
    JOIN catalog_variants k ON k.id=c.target_variant_id
    WHERE c.id=? AND s.id=? AND k.id=?
      AND s.product_id=c.product_id AND k.product_id=c.product_id
      AND s.is_active=0 AND k.is_active=1 AND s.updated_at=? AND k.updated_at=?
      AND NOT EXISTS(SELECT 1 FROM catalog_variant_merge_generation_events e
        WHERE e.source_variant_id IN (s.id,k.id))
      AND ${noLaterActivity}
      AND ${beforeStockValid}
      AND ${stockFingerprint}=?
  `).bind(why,who,stamp,consolidationId,view.sourceId,view.keeperId,
    original.variants[0],original.variants[1],token.stockFingerprint)
  const audit=db.prepare(`INSERT INTO catalog_variant_positive_undo_stock_rows
    (generation_event_id,inventory_source,source_stock_id,keeper_stock_id,
      source_quantity_before,keeper_quantity_before,source_quantity_restored,
      keeper_quantity_restored)
    SELECT e.id,l.inventory_source,l.source_stock_id,l.target_stock_id_before,
      0,l.combined_quantity_after,l.source_quantity_before,l.target_quantity_before
    FROM catalog_variant_merge_generation_events e
    JOIN catalog_variant_consolidation_stock_rows l ON l.consolidation_id=e.root_consolidation_id
    JOIN catalog_variant_consolidation_stock_decisions d
      ON d.consolidation_id=l.consolidation_id AND d.inventory_source=l.inventory_source
    JOIN inventory_stock ss ON ss.id=l.source_stock_id
    JOIN inventory_stock ks ON ks.id=l.target_stock_id_before
    WHERE e.root_consolidation_id=? AND e.source_variant_id=? AND e.target_variant_id=?
      AND e.generation=2 AND e.event_kind='undo' AND e.created_at=?
      AND d.decision_method='sum' AND d.adjustment_quantity=0
      AND ss.quantity=0 AND ss.reserved_quantity=0
      AND ks.quantity=l.combined_quantity_after AND ks.reserved_quantity=0
  `).bind(consolidationId,view.sourceId,view.keeperId,stamp)
  const activate=db.prepare(`UPDATE catalog_variants SET is_active=1,updated_at=?
    WHERE id=? AND is_active=0 AND updated_at=?
      AND EXISTS(SELECT 1 FROM catalog_variant_merge_generation_events e
        WHERE e.root_consolidation_id=? AND e.source_variant_id=?
          AND e.generation=2 AND e.event_kind='undo' AND e.created_at=?)
  `).bind(stamp,view.sourceId,original.variants[0],consolidationId,view.sourceId,stamp)
  const keeperUpdate=db.prepare(`UPDATE inventory_stock
    SET quantity=(SELECT a.keeper_quantity_restored FROM catalog_variant_positive_undo_stock_rows a
      JOIN catalog_variant_merge_generation_events e ON e.id=a.generation_event_id
      WHERE a.keeper_stock_id=inventory_stock.id AND e.root_consolidation_id=?
        AND e.generation=2 AND e.created_at=?),
      updated_at=?,last_action='Отмена объединения вариантов',last_source_ref=?
    WHERE variant_id=? AND reserved_quantity=0
      AND EXISTS(SELECT 1 FROM catalog_variant_positive_undo_stock_rows a
        JOIN catalog_variant_merge_generation_events e ON e.id=a.generation_event_id
        WHERE a.keeper_stock_id=inventory_stock.id AND e.root_consolidation_id=?
          AND e.generation=2 AND e.created_at=?
          AND inventory_stock.quantity=a.keeper_quantity_before)
  `).bind(consolidationId,stamp,stamp,ref,view.keeperId,consolidationId,stamp)
  const sourceUpdate=db.prepare(`UPDATE inventory_stock
    SET quantity=(SELECT a.source_quantity_restored FROM catalog_variant_positive_undo_stock_rows a
      JOIN catalog_variant_merge_generation_events e ON e.id=a.generation_event_id
      WHERE a.source_stock_id=inventory_stock.id AND e.root_consolidation_id=?
        AND e.generation=2 AND e.created_at=?),
      updated_at=?,last_action='Отмена объединения вариантов',last_source_ref=?
    WHERE variant_id=? AND quantity=0 AND reserved_quantity=0
      AND EXISTS(SELECT 1 FROM catalog_variants s WHERE s.id=inventory_stock.variant_id AND s.is_active=1)
      AND EXISTS(SELECT 1 FROM catalog_variant_positive_undo_stock_rows a
        JOIN catalog_variant_merge_generation_events e ON e.id=a.generation_event_id
        WHERE a.source_stock_id=inventory_stock.id AND e.root_consolidation_id=?
          AND e.generation=2 AND e.created_at=?)
  `).bind(consolidationId,stamp,stamp,ref,view.sourceId,consolidationId,stamp)
  // Missing an event is a FK failure, a partial stock restore is CHECK/trigger
  // failure. The D1 batch commits only when all rows and proof agree.
  const proof=db.prepare(`INSERT INTO catalog_variant_positive_undo_validations
    (generation_event_id,root_consolidation_id,source_variant_id,keeper_variant_id,
      restored_source_quantity,validated_locations,passed,created_by,checked_at)
    SELECT COALESCE(e.id,-1),c.id,c.source_variant_id,c.target_variant_id,
      c.source_physical_quantity,
      (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l WHERE l.consolidation_id=c.id),
      CASE WHEN s.is_active=1 AND k.is_active=1 AND s.updated_at=?
        AND ${noLaterActivity}
        AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
          LEFT JOIN inventory_stock ss ON ss.id=l.source_stock_id
          LEFT JOIN inventory_stock ks ON ks.id=l.target_stock_id_before
          WHERE l.consolidation_id=c.id AND (
            ss.updated_at<>? OR ks.updated_at<>?
            OR ss.last_source_ref<>? OR ks.last_source_ref<>?
            OR ss.reserved_quantity<>0 OR ks.reserved_quantity<>0))
       THEN 1 ELSE 0 END,?,?
    FROM catalog_variant_consolidations c
    JOIN catalog_variants s ON s.id=c.source_variant_id
    JOIN catalog_variants k ON k.id=c.target_variant_id
    LEFT JOIN catalog_variant_merge_generation_events e
      ON e.root_consolidation_id=c.id AND e.generation=2 AND e.event_kind='undo'
        AND e.created_at=?
    WHERE c.id=?
  `).bind(stamp,stamp,stamp,ref,ref,who,stamp,stamp,consolidationId)
  let outcome:D1Result[]
  try{outcome=await db.batch([generation,audit,activate,keeperUpdate,sourceUpdate,proof])}
  catch{throw new Error('Отмена не выполнена: склад, заказы или история изменились. Обновите проверку.') }
  const locations=view.locations.length
  if(outcome.length!==6 ||
    outcome[0].meta?.changes!==1||outcome[1].meta?.changes!==locations
    ||outcome[2].meta?.changes!==1||outcome[3].meta?.changes!==locations
    ||outcome[4].meta?.changes!==locations||outcome[5].meta?.changes!==1){
    throw new Error('Результат проверки не совпал с журналом. Не повторяйте операцию без проверки базы.')
  }
  return {
    ok:true,undone:true,generation:2,consolidationId,
    sourceId:view.sourceId,keeperId:view.keeperId,locations:view.locations,
    totalStockDelta:0,
    message:'Объединение отменено, исходные остатки восстановлены по местам хранения. Количество товаров не изменилось.',
  }
}
