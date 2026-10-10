// Counted split of a historically physically-corrected SKU merger.
// ADMIN ONLY via the router. This operation cannot manufacture or write off stock.
import { previewCorrectedCatalogConsolidationUndo } from './catalog-corrected-undo-review.ts'

type Choice={location:string;sourceQuantity:number;keeperQuantity:number;physicallyVerified:boolean}
type Token={
 original:string;stock:Array<[number,number,string,number,number,string,string|null]>;
 corrections:Array<[number,string,number,number,number,string]>;
 generations:Array<{generation:number;event_kind:string}>;
 blockers:Array<{code:string;message:string}>
}
const safe=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0
const stockRef='catalog-counted-undo:'
const stockJson=`(SELECT COALESCE(json_group_array(json_array(
  id,variant_id,inventory_source,quantity,reserved_quantity,updated_at,last_source_ref
)),'[]') FROM (
  SELECT id,variant_id,inventory_source,quantity,reserved_quantity,updated_at,last_source_ref
  FROM inventory_stock WHERE variant_id IN (s.id,k.id) ORDER BY id
))`
const correctionsJson=`(SELECT COALESCE(json_group_array(json_array(
  id,inventory_source,variant_id,quantity_delta,quantity_after,created_at
)),'[]') FROM (
  SELECT id,inventory_source,variant_id,quantity_delta,quantity_after,created_at
  FROM inventory_movements
  WHERE reference_type='catalog_stock_finalization' AND reference_id=CAST(c.id AS TEXT)
  ORDER BY id
))`
// The live operation is never blocked while a manager is inspecting the preview.
// D1's serial atomic batch repeats the preflight and fails closed if a customer
// or workshop operation won the race.
const noLater=`
  julianday(c.created_at) IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE oi.variant_id IN (s.id,k.id) AND (
       julianday(oi.created_at) IS NULL OR julianday(o.updated_at) IS NULL
       OR MAX(julianday(oi.created_at),julianday(o.updated_at))>=julianday(c.created_at)
       OR (o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent'
           AND oi.quantity>0)))
  AND NOT EXISTS(SELECT 1 FROM inventory_reservations r
    WHERE r.variant_id IN (s.id,k.id)
      AND (r.status='active' OR julianday(r.updated_at) IS NULL
        OR julianday(r.updated_at)>=julianday(c.created_at)))
  AND NOT EXISTS(SELECT 1 FROM inventory_movements m
    WHERE m.variant_id IN (s.id,k.id) AND
       (julianday(m.created_at) IS NULL OR
         (julianday(m.created_at)>=julianday(c.created_at)
          AND NOT (m.reference_type='catalog_stock_finalization'
            AND m.reference_id=CAST(c.id AS TEXT)
            AND julianday(m.created_at)=julianday(c.created_at)))))
  AND NOT EXISTS(SELECT 1 FROM inventory_stock_checks ch
    WHERE ch.variant_id IN (s.id,k.id) AND
      (julianday(ch.checked_at) IS NULL OR julianday(ch.checked_at)>=julianday(c.created_at)))
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
      OR EXISTS(SELECT 1 FROM exchange_items x WHERE x.order_item_id=oi.id)))
  AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidations other
    WHERE other.id<>c.id AND
      (other.target_variant_id IN (s.id,k.id) OR other.source_variant_id=k.id))
`
const originalProof=`
  c.source_reserved_quantity=0
  AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_validations v
    WHERE v.consolidation_id=c.id AND v.passed=1)
  AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_validations v
    WHERE v.consolidation_id=c.id AND v.passed=1)
  AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_reservation_rows r
    WHERE r.consolidation_id=c.id)
  AND (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
    WHERE l.consolidation_id=c.id)>0
  AND (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
    WHERE l.consolidation_id=c.id)=
    (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_decisions d
      WHERE d.consolidation_id=c.id)
  AND EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_decisions d
    WHERE d.consolidation_id=c.id
      AND (d.decision_method<>'sum' OR d.adjustment_quantity<>0))
  AND (SELECT COUNT(*) FROM inventory_movements m
    WHERE m.reference_type='catalog_stock_finalization'
      AND m.reference_id=CAST(c.id AS TEXT))=
    (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_decisions d
      WHERE d.consolidation_id=c.id AND d.adjustment_quantity<>0)
  AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_decisions d
    WHERE d.consolidation_id=c.id AND d.adjustment_quantity<>0
      AND NOT EXISTS(SELECT 1 FROM inventory_movements m
        WHERE m.reference_type='catalog_stock_finalization'
          AND m.reference_id=CAST(c.id AS TEXT)
          AND m.inventory_source=d.inventory_source AND m.variant_id=k.id
          AND m.quantity_delta=d.adjustment_quantity AND m.quantity_after=d.final_quantity
          AND julianday(m.created_at)=julianday(c.created_at)))
  AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
    LEFT JOIN catalog_variant_consolidation_stock_decisions d
      ON d.consolidation_id=l.consolidation_id AND d.inventory_source=l.inventory_source
    LEFT JOIN inventory_stock ss ON ss.id=l.source_stock_id
    LEFT JOIN inventory_stock ks ON ks.id=l.target_stock_id_before
    WHERE l.consolidation_id=c.id AND (
      d.inventory_source IS NULL OR l.target_stock_id_before IS NULL
      OR d.final_quantity<>l.combined_quantity_after
      OR d.adjustment_quantity<>d.final_quantity-l.source_quantity_before-l.target_quantity_before
      OR l.source_reserved_before<>0 OR l.target_reserved_before<>0
      OR ss.id IS NULL OR ks.id IS NULL OR ss.variant_id<>s.id OR ks.variant_id<>k.id
      OR ss.inventory_source<>l.inventory_source OR ks.inventory_source<>l.inventory_source
      OR ss.quantity<>0 OR ss.reserved_quantity<>0
      OR ks.quantity<>l.combined_quantity_after OR ks.reserved_quantity<>0
      OR ss.last_source_ref IS NOT ('catalog-consolidation:'||s.id||'->'||k.id)
      OR (l.source_quantity_before>0 AND
          ks.last_source_ref IS NOT ('catalog-consolidation:'||s.id||'->'||k.id))
      OR julianday(ss.updated_at) IS NULL OR julianday(ks.updated_at) IS NULL
      OR julianday(ss.updated_at)>julianday(c.created_at)
      OR julianday(ks.updated_at)>julianday(c.created_at)
    ))
  AND NOT EXISTS(SELECT 1 FROM inventory_stock st
    WHERE st.variant_id IN (s.id,k.id)
      AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
        WHERE l.consolidation_id=c.id AND
          ((st.variant_id=s.id AND st.id=l.source_stock_id)
            OR (st.variant_id=k.id AND st.id=l.target_stock_id_before))))
`

export async function previewCountedCatalogUndo(db:D1Database,id:number,choices:Choice[]){
  const view=await previewCorrectedCatalogConsolidationUndo(db,id)
  if(!Array.isArray(choices))throw new Error('Введите количество отдельно для каждого места хранения.')
  const errors:string[]=[]
  if(!view.canPrepareCountedSplit)errors.push(...view.blockers.map(x=>x.message))
  if(choices.length!==view.locations.length)errors.push('Подтвердите все места хранения.')
  const locations=new Map(view.locations.map(x=>[x.location,x]))
  const chosen=new Set<string>()
  for(const choice of choices){
    const place=locations.get(choice?.location)
    if(!place||chosen.has(choice.location)||choice.physicallyVerified!==true
      ||!safe(choice.sourceQuantity)||!safe(choice.keeperQuantity)){
      errors.push('Для каждого места нужны два явно проверенных целых количества.')
      continue
    }
    chosen.add(choice.location)
    if(!safe(place.current.total)||
       choice.sourceQuantity+choice.keeperQuantity!==place.current.total){
      errors.push(place.label+': сумма количества двух вариантов должна совпадать с фактическим остатком.')
    }
  }
  return {...view,canUndoCounted:view.canPrepareCountedSplit&&errors.length===0,
    errors:[...new Set(errors)],confirmedAllocations:choices}
}

export async function undoCountedCatalogConsolidation(
  db:D1Database,id:number,actor:string,reason:string,token:string,choices:Choice[]
){
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Выберите корректное объединение.')
  const who=(actor||'').trim(),why=(reason||'').trim()
  if(!who||why.length<12||why.length>500)throw new Error('Требуется причина отмены длиной от 12 до 500 символов.')
  if(!token)throw new Error('Сначала выполните проверку склада.')
  const checked=await previewCountedCatalogUndo(db,id,choices)
  if(!checked.canUndoCounted)throw new Error('Нельзя отменить: '+checked.errors.join('; '))
  if(checked.stateToken!==token)throw new Error('Состояние изменилось. Повторите проверку остатков.')
  const snapshot=JSON.parse(token) as Token
  const root=JSON.parse(snapshot.original) as {receipt:[number,number,number,string];variants:[string,string]}
  if(root.receipt[0]!==id||root.receipt[1]!==checked.sourceId
     ||root.receipt[2]!==checked.keeperId)throw new Error('Данные объединения изменились.')
  const ts=new Date().toISOString(),ref=stockRef+id
  const choiceRows=JSON.stringify(choices.map(x=>({
    location:x.location,source:x.sourceQuantity,keeper:x.keeperQuantity
  })))
  const event=db.prepare(`INSERT INTO catalog_variant_merge_generation_events
   (root_consolidation_id,source_variant_id,target_variant_id,generation,event_kind,
     reason,created_by,created_at)
   SELECT c.id,s.id,k.id,2,'undo',?,?,?
   FROM catalog_variant_consolidations c
   JOIN catalog_variants s ON s.id=c.source_variant_id
   JOIN catalog_variants k ON k.id=c.target_variant_id
   WHERE c.id=? AND s.id=? AND k.id=? AND c.created_at=?
     AND s.is_active=0 AND k.is_active=1
     AND s.product_id=c.product_id AND k.product_id=c.product_id
     AND s.updated_at=? AND k.updated_at=?
     AND NOT EXISTS(SELECT 1 FROM catalog_variant_merge_generation_events e
       WHERE e.source_variant_id IN (s.id,k.id))
     AND ${noLater} AND ${originalProof}
     AND ${stockJson}=? AND ${correctionsJson}=?
  `).bind(why,who,ts,id,checked.sourceId,checked.keeperId,root.receipt[3],
    root.variants[0],root.variants[1],
    JSON.stringify(snapshot.stock),JSON.stringify(snapshot.corrections))
  const audit=db.prepare(`INSERT INTO catalog_variant_counted_undo_locations
   (generation_event_id,inventory_source,source_stock_id,keeper_stock_id,
     source_quantity_before,keeper_quantity_before,
     confirmed_source_quantity,confirmed_keeper_quantity,physical_count_confirmed)
   SELECT e.id,l.inventory_source,l.source_stock_id,l.target_stock_id_before,
     0,l.combined_quantity_after,
     CAST(json_extract(j.value,'$.source') AS INTEGER),
     CAST(json_extract(j.value,'$.keeper') AS INTEGER),1
   FROM catalog_variant_merge_generation_events e
   JOIN catalog_variant_consolidation_stock_rows l ON l.consolidation_id=e.root_consolidation_id
   JOIN json_each(?) j ON json_extract(j.value,'$.location')=l.inventory_source
   JOIN inventory_stock ss ON ss.id=l.source_stock_id
   JOIN inventory_stock ks ON ks.id=l.target_stock_id_before
   WHERE e.root_consolidation_id=? AND e.source_variant_id=? AND e.target_variant_id=?
     AND e.generation=2 AND e.event_kind='undo' AND e.created_at=?
     AND ss.quantity=0 AND ss.reserved_quantity=0
     AND ks.quantity=l.combined_quantity_after AND ks.reserved_quantity=0
  `).bind(choiceRows,id,checked.sourceId,checked.keeperId,ts)
  const activate=db.prepare(`UPDATE catalog_variants SET is_active=1,updated_at=?
    WHERE id=? AND is_active=0 AND updated_at=?
      AND EXISTS(SELECT 1 FROM catalog_variant_merge_generation_events e
        WHERE e.root_consolidation_id=? AND e.source_variant_id=?
          AND e.generation=2 AND e.event_kind='undo' AND e.created_at=?)
  `).bind(ts,checked.sourceId,root.variants[0],id,checked.sourceId,ts)
  const keeper=db.prepare(`UPDATE inventory_stock SET
     quantity=(SELECT a.confirmed_keeper_quantity FROM catalog_variant_counted_undo_locations a
       JOIN catalog_variant_merge_generation_events e ON e.id=a.generation_event_id
       WHERE a.keeper_stock_id=inventory_stock.id AND e.root_consolidation_id=?
         AND e.generation=2 AND e.created_at=?),
     updated_at=?,last_action='Подтверждённая отмена объединения',last_source_ref=?
    WHERE variant_id=? AND reserved_quantity=0
      AND EXISTS(SELECT 1 FROM catalog_variant_counted_undo_locations a
        JOIN catalog_variant_merge_generation_events e ON e.id=a.generation_event_id
        WHERE a.keeper_stock_id=inventory_stock.id AND e.root_consolidation_id=?
          AND e.generation=2 AND e.created_at=?
          AND inventory_stock.quantity=a.keeper_quantity_before)
  `).bind(id,ts,ts,ref,checked.keeperId,id,ts)
  const source=db.prepare(`UPDATE inventory_stock SET
    quantity=(SELECT a.confirmed_source_quantity FROM catalog_variant_counted_undo_locations a
      JOIN catalog_variant_merge_generation_events e ON e.id=a.generation_event_id
      WHERE a.source_stock_id=inventory_stock.id AND e.root_consolidation_id=?
        AND e.generation=2 AND e.created_at=?),
    updated_at=?,last_action='Подтверждённая отмена объединения',last_source_ref=?
    WHERE variant_id=? AND quantity=0 AND reserved_quantity=0
      AND EXISTS(SELECT 1 FROM catalog_variants s
        WHERE s.id=inventory_stock.variant_id AND s.is_active=1)
      AND EXISTS(SELECT 1 FROM catalog_variant_counted_undo_locations a
        JOIN catalog_variant_merge_generation_events e ON e.id=a.generation_event_id
        WHERE a.source_stock_id=inventory_stock.id AND e.root_consolidation_id=?
          AND e.generation=2 AND e.created_at=?)
  `).bind(id,ts,ts,ref,checked.sourceId,id,ts)
  // A final CHECK-backed proof forces rollback of ALL earlier D1 batch steps on
  // missing/changed stock rows, reservations, linked orders or incomplete audit.
  const proof=db.prepare(`INSERT INTO catalog_variant_counted_undo_validations
    (generation_event_id,root_consolidation_id,source_variant_id,keeper_variant_id,
      validated_locations,confirmed_total,passed,checked_by,checked_at)
    SELECT COALESCE((SELECT e.id FROM catalog_variant_merge_generation_events e
       WHERE e.root_consolidation_id=? AND e.source_variant_id=?
         AND e.generation=2 AND e.created_at=?),-1),
      c.id,c.source_variant_id,c.target_variant_id,
      (SELECT COUNT(*) FROM catalog_variant_consolidation_stock_rows l
       WHERE l.consolidation_id=c.id),
      (SELECT COALESCE(SUM(a.confirmed_source_quantity+a.confirmed_keeper_quantity),0)
       FROM catalog_variant_counted_undo_locations a
       JOIN catalog_variant_merge_generation_events e ON e.id=a.generation_event_id
       WHERE e.root_consolidation_id=c.id AND e.generation=2 AND e.created_at=?),
      CASE WHEN s.is_active=1 AND k.is_active=1 AND s.updated_at=?
         AND k.updated_at=? AND ${noLater}
         AND NOT EXISTS(SELECT 1 FROM catalog_variant_consolidation_stock_rows l
           LEFT JOIN inventory_stock ss ON ss.id=l.source_stock_id
           LEFT JOIN inventory_stock ks ON ks.id=l.target_stock_id_before
           WHERE l.consolidation_id=c.id AND (
             ss.updated_at IS NOT ? OR ks.updated_at IS NOT ?
             OR ss.last_source_ref IS NOT ? OR ks.last_source_ref IS NOT ?
             OR ss.reserved_quantity<>0 OR ks.reserved_quantity<>0))
       THEN 1 ELSE 0 END,?,?
    FROM catalog_variant_consolidations c
    JOIN catalog_variants s ON s.id=c.source_variant_id
    JOIN catalog_variants k ON k.id=c.target_variant_id
    WHERE c.id=?
  `).bind(id,checked.sourceId,ts,ts,ts,root.variants[1],
     ts,ts,ref,ref,who,ts,id)
  let results:D1Result[]
  try{results=await db.batch([event,audit,activate,keeper,source,proof])}
  catch{throw new Error('Отмена не проведена: состояние склада, заказов или журналов изменилось. Обновите проверку.')}
  const n=checked.locations.length
  if(results.length!==6||results[0].meta?.changes!==1
    ||results[1].meta?.changes!==n||results[2].meta?.changes!==1
    ||results[3].meta?.changes!==n||results[4].meta?.changes!==n
    ||results[5].meta?.changes!==1){
    throw new Error('Результат операции требует проверки администратора. Не повторяйте вслепую.')
  }
  return {ok:true,undone:true,consolidationId:id,generation:2,
    sourceId:checked.sourceId,keeperId:checked.keeperId,
    confirmedAllocations:choices,totalPhysicalDelta:0,
    message:'Количество распределено по вариантам без изменения общего физического остатка. История и заказы сохранены.'}
}
