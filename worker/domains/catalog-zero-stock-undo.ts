import { previewCatalogConsolidationUndo } from './catalog-consolidation-undo-preview.ts'

// Restricted undo: one immutable zero-source-stock merge, no later activity,
// no original reservations, no physical corrections. No inventory balances
// are touched. All potentially concurrent state is rechecked in the D1 batch.
export async function undoUnusedCatalogConsolidation(
  db:D1Database,
  consolidationId:number,
  actor:string,
  reason:string,
  expectedToken:string,
){
  if(!Number.isSafeInteger(consolidationId)||consolidationId<=0)throw new Error('Укажите номер объединения.')
  const why=(reason||'').trim()
  const who=(actor||'').trim()
  if(why.length<12||why.length>500||!who)throw new Error('Укажите ответственного администратора и причину исправления (12–500 символов).')
  if(!expectedToken)throw new Error('Перед отменой получите новый предпросмотр объединения.')
  const preview=await previewCatalogConsolidationUndo(db,consolidationId)
  if(!preview.canUndoZeroStockIdentity)throw new Error('Нельзя автоматически отменить это объединение: '+preview.blockers.map(b=>b.message).join('; '))
  if(expectedToken!==preview.undoStateToken)throw new Error('Данные изменились после предпросмотра. Обновите проверку объединения.')
  const snapshot=JSON.parse(preview.undoStateToken) as {variants:[string,string]}
  const now=new Date().toISOString()
  // No row is staged in a long-lived lock. This single D1 batch either records
  // the undo generation AND restores an inactive zero-stock source, or rolls
  // back completely via the CHECK-backed validation.
  const insert=db.prepare(`INSERT INTO catalog_variant_merge_generation_events
    (root_consolidation_id,source_variant_id,target_variant_id,generation,event_kind,reason,created_by,created_at)
    SELECT c.id,c.source_variant_id,c.target_variant_id,2,'undo',?,?,?
    FROM catalog_variant_consolidations c
    JOIN catalog_variants s ON s.id=c.source_variant_id
    JOIN catalog_variants k ON k.id=c.target_variant_id
    WHERE c.id=? AND c.source_variant_id=? AND c.target_variant_id=?
      AND s.is_active=0 AND k.is_active=1 AND s.product_id=c.product_id AND k.product_id=c.product_id
      AND s.updated_at=? AND k.updated_at=?
      AND c.source_physical_quantity=0 AND c.source_reserved_quantity=0
      AND julianday(c.created_at) IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM catalog_variant_merge_generation_events e
        WHERE e.source_variant_id=c.source_variant_id)
      AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
        WHERE l.consolidation_id=c.id)
      AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_validations v
        WHERE v.consolidation_id=c.id AND v.passed=1)
      AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_validations v
        WHERE v.consolidation_id=c.id AND v.passed=1)
      AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_rows r
        WHERE r.consolidation_id=c.id)
      AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
        LEFT JOIN catalog_variant_consolidation_stock_decisions d
          ON d.consolidation_id=l.consolidation_id AND d.inventory_source=l.inventory_source
        LEFT JOIN inventory_stock ss ON ss.id=l.source_stock_id
        LEFT JOIN inventory_stock ks ON ks.id=l.target_stock_id_before
        WHERE l.consolidation_id=c.id AND (
          l.inventory_source NOT IN ('warehouse','boutique')
          OR l.source_quantity_before<>0 OR l.source_reserved_before<>0 OR l.target_reserved_before<>0
          OR l.target_stock_id_before IS NULL
          OR d.inventory_source IS NULL OR d.adjustment_quantity<>0
          OR d.final_quantity<>l.combined_quantity_after
          OR ss.variant_id<>c.source_variant_id OR ss.inventory_source<>l.inventory_source
          OR ss.quantity<>0 OR ss.reserved_quantity<>0
          OR ss.last_source_ref<>('catalog-consolidation:'||c.source_variant_id||'->'||c.target_variant_id)
          OR ks.variant_id<>c.target_variant_id OR ks.inventory_source<>l.inventory_source
          OR ks.quantity<>l.combined_quantity_after OR ks.reserved_quantity<>0
          OR ss.id IS NULL OR ks.id IS NULL
        ))
      AND (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
           WHERE l.consolidation_id=c.id)
         =(SELECT COUNT(*) FROM catalog_variant_consolidation_stock_decisions d
           WHERE d.consolidation_id=c.id)
      AND NOT EXISTS(SELECT 1 FROM inventory_stock st
        WHERE st.variant_id=c.source_variant_id
          AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
            WHERE l.consolidation_id=c.id AND l.source_stock_id=st.id))
      AND NOT EXISTS(SELECT 1 FROM inventory_stock st
        WHERE st.variant_id=c.target_variant_id
          AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
            WHERE l.consolidation_id=c.id AND l.target_stock_id_before=st.id))
      AND NOT EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE oi.variant_id IN (c.source_variant_id,c.target_variant_id)
          AND (julianday(oi.created_at) IS NULL OR julianday(o.updated_at) IS NULL
            OR MAX(julianday(oi.created_at),julianday(o.updated_at))>=julianday(c.created_at)
            OR (o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent' AND oi.quantity>0)))
      AND NOT EXISTS(SELECT 1 FROM inventory_reservations r
        WHERE r.variant_id IN (c.source_variant_id,c.target_variant_id)
          AND (r.status='active' OR julianday(r.updated_at) IS NULL
            OR julianday(r.updated_at)>=julianday(c.created_at)))
      AND NOT EXISTS(SELECT 1 FROM inventory_movements m
        WHERE m.variant_id IN (c.source_variant_id,c.target_variant_id)
          AND (julianday(m.created_at) IS NULL OR julianday(m.created_at)>=julianday(c.created_at)))
      AND NOT EXISTS(SELECT 1 FROM inventory_stock_checks ch
        WHERE ch.variant_id IN (c.source_variant_id,c.target_variant_id)
          AND (julianday(ch.checked_at) IS NULL OR julianday(ch.checked_at)>=julianday(c.created_at)))
      AND NOT EXISTS(SELECT 1 FROM workshop_tasks wt
        WHERE wt.variant_id IN (c.source_variant_id,c.target_variant_id) AND wt.status='active')
      AND NOT EXISTS(SELECT 1 FROM inventory_lifecycle_events e
        WHERE e.variant_id IN (c.source_variant_id,c.target_variant_id)
          AND e.status IN ('pending','applied'))
      AND NOT EXISTS(SELECT 1 FROM inventory_stocktake_items i
        JOIN inventory_stocktake_sessions sess ON sess.id=i.session_id
        WHERE i.variant_id IN (c.source_variant_id,c.target_variant_id) AND sess.status='active')
      AND NOT EXISTS(SELECT 1 FROM inventory_transfer_items i
        JOIN inventory_transfer_documents t ON t.id=i.transfer_id
        WHERE i.variant_id IN (c.source_variant_id,c.target_variant_id) AND t.status='applied')
      AND NOT EXISTS(SELECT 1 FROM order_items oi
        WHERE oi.variant_id IN (c.source_variant_id,c.target_variant_id)
          AND (EXISTS(SELECT 1 FROM return_items ri WHERE ri.order_item_id=oi.id)
            OR EXISTS(SELECT 1 FROM exchanges ex
              WHERE ex.old_order_item_id=oi.id OR ex.new_order_item_id=oi.id)
            OR EXISTS(SELECT 1 FROM exchange_items ei WHERE ei.order_item_id=oi.id)))
      AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidations other
        WHERE (other.target_variant_id=c.source_variant_id
          OR other.target_variant_id=c.target_variant_id
          OR other.source_variant_id=c.target_variant_id)
          AND other.id<>c.id)
  `).bind(why,who,now,consolidationId,preview.sourceId,preview.keeperId,
    snapshot.variants[0],snapshot.variants[1])
  const sourceUpdate=db.prepare(`UPDATE catalog_variants
    SET is_active=1,updated_at=? WHERE id=? AND is_active=0 AND updated_at=?
      AND EXISTS(SELECT 1 FROM catalog_variant_merge_generation_events e
        WHERE e.root_consolidation_id=? AND e.source_variant_id=?
          AND e.generation=2 AND e.event_kind='undo' AND e.created_at=?)
      AND NOT EXISTS(SELECT 1 FROM inventory_stock st
        WHERE st.variant_id=? AND (st.quantity<>0 OR st.reserved_quantity<>0))
  `).bind(now,preview.sourceId,snapshot.variants[0],
    consolidationId,preview.sourceId,now,preview.sourceId)
  const proof=db.prepare(`INSERT INTO catalog_variant_zero_stock_undo_validations
    (generation_event_id,root_consolidation_id,source_variant_id,original_stock_rows,passed,created_by,checked_at)
    SELECT e.id,e.root_consolidation_id,e.source_variant_id,
      (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
       WHERE l.consolidation_id=e.root_consolidation_id),
      CASE WHEN s.is_active=1 AND s.updated_at=? AND k.is_active=1
        AND NOT EXISTS(SELECT 1 FROM inventory_stock st
          WHERE st.variant_id=s.id AND (st.quantity<>0 OR st.reserved_quantity<>0))
        AND (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
          WHERE l.consolidation_id=e.root_consolidation_id)>0
        THEN 1 ELSE 0 END,?,?
    FROM catalog_variant_merge_generation_events e
    JOIN catalog_variants s ON s.id=e.source_variant_id
    JOIN catalog_variants k ON k.id=e.target_variant_id
    WHERE e.root_consolidation_id=? AND e.generation=2
      AND e.event_kind='undo' AND e.created_at=?
  `).bind(now,who,now,consolidationId,now)
  let result:D1Result[]
  try{result=await db.batch([insert,sourceUpdate,proof])}
  catch{
    throw new Error('Отмена не применена: заказы, склад или история изменились. Обновите предпросмотр.')
  }
  if(result.length!==3 || result.some(item=>Number(item.meta?.changes)!==1)){
    throw new Error('Условия безопасной отмены устарели. Никакие остатки не изменены; обновите предпросмотр.')
  }
  return {
    ok:true,undone:true,consolidationId,sourceId:preview.sourceId,
    keeperId:preview.keeperId,generation:2,restoredPhysicalQuantity:0,
    message:'Историческое объединение сохранено; нулевой исходный SKU восстановлен без изменения остатков и заказов.',
  }
}
