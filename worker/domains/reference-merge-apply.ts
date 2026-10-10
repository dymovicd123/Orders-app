import { cleanText, toInt } from '../core/text.ts'
import {
  currentOrderSnapshot, previewUserSelectedReferenceMerge,
  readCurrentReferenceOrderRows, referenceMergeToken,
  type Reference,
} from './reference-merge-preview.ts'

export async function applyMonthBoundReferenceMerge(
  db:D1Database,sourceId:number,targetId:number,expectedToken:string,actor:string,
  now:Date=new Date(),
) {
  const prior=await db.prepare('SELECT target_reference_id FROM reference_value_merges WHERE source_reference_id=?')
    .bind(sourceId).first<{target_reference_id:number}>()
  if (prior) {
    if (toInt(prior.target_reference_id,0)===targetId) return {ok:true,alreadyMerged:true}
    throw new Error('Это значение уже объединено с другим. Обновите список.')
  }
  const impact=await previewUserSelectedReferenceMerge(db,sourceId,targetId,now)
  if (!impact.canApply || !impact.stateToken) {
    throw new Error('Для этих значений автоматическое объединение пока недоступно. Сохранение не выполнено.')
  }
  if (!expectedToken || expectedToken!==impact.stateToken) {
    throw new Error('Заказы или справочники изменились после проверки. Посмотрите последствия ещё раз.')
  }
  const kind=impact.kind
  if (kind!=='city'&&kind!=='delivery_type') throw new Error('Этот список ещё нельзя объединить автоматически.')
  const field=kind==='city'?'city':'delivery_type'
  const {from,toExclusive}=impact.month
  const rows=await readCurrentReferenceOrderRows(db,field,impact.source.value,from,toExclusive)
  const refs=await db.prepare('SELECT id,kind,value,is_active,updated_at FROM reference_values WHERE id IN (?,?)')
    .bind(sourceId,targetId).all<Reference>()
  const source=(refs.results||[]).find(x=>x.id===sourceId)
  const target=(refs.results||[]).find(x=>x.id===targetId)
  if (!source||!target||await referenceMergeToken(source,target,impact.month,rows)!==expectedToken) {
    throw new Error('Данные изменились после проверки. Посмотрите последствия ещё раз.')
  }
  const stamp=now.toISOString()
  const snapshot=currentOrderSnapshot(rows)
  const journalExists=`EXISTS (SELECT 1 FROM reference_value_merges m
    WHERE m.source_reference_id=? AND m.target_reference_id=? AND m.created_at=?)`
  const statements=[
    db.prepare(`INSERT INTO reference_value_merges
      (kind,source_reference_id,target_reference_id,source_value,target_value,
        month_start,month_next,expected_orders,created_by,created_at)
      SELECT v.kind,v.id,t.id,v.value,t.value,?,?,?, ?,?
      FROM reference_values v JOIN reference_values t
        ON t.id=? AND t.kind=v.kind AND t.is_active=1
      WHERE v.id=? AND v.kind=? AND v.is_active=1
        AND v.value=? AND t.value=? AND v.updated_at IS ? AND t.updated_at IS ?
        AND NOT EXISTS (SELECT 1 FROM reference_value_merges m WHERE m.source_reference_id=v.id)
        AND (SELECT COALESCE(json_group_array(json_array(x.id,x.updated_at)),'[]')
          FROM (SELECT id,COALESCE(updated_at,'') AS updated_at
            FROM orders WHERE order_date>=? AND order_date<? AND order_status<>'deleted'
              AND UPPER(TRIM(COALESCE(${field},'')))=UPPER(v.value)
            ORDER BY id) x)=?`
    ).bind(from,toExclusive,rows.length,cleanText(actor)||null,stamp,
      targetId,sourceId,kind,source.value,target.value,source.updated_at,target.updated_at,
      from,toExclusive,snapshot),
    db.prepare(`INSERT INTO reference_value_merge_orders
      (merge_id,order_id,original_value,target_value)
      SELECT m.id,o.id,o.${field},m.target_value
      FROM reference_value_merges m JOIN orders o
        ON o.order_date>=m.month_start AND o.order_date<m.month_next
        AND o.order_status<>'deleted'
        AND UPPER(TRIM(COALESCE(o.${field},'')))=UPPER(m.source_value)
      WHERE m.source_reference_id=? AND m.target_reference_id=? AND m.created_at=?`
    ).bind(sourceId,targetId,stamp),
    db.prepare(`UPDATE orders SET ${field}=?,updated_at=?
      WHERE id IN (SELECT a.order_id FROM reference_value_merge_orders a
        JOIN reference_value_merges m ON m.id=a.merge_id
        WHERE m.source_reference_id=? AND m.target_reference_id=? AND m.created_at=?)
      AND order_date>=? AND order_date<? AND order_status<>'deleted'
      AND UPPER(TRIM(COALESCE(${field},'')))=UPPER(?)`
    ).bind(target.value,stamp,sourceId,targetId,stamp,from,toExclusive,source.value),
    db.prepare(`UPDATE reference_values SET is_active=0,updated_at=?
      WHERE id=? AND is_active=1 AND ${journalExists}`
    ).bind(stamp,sourceId,sourceId,targetId,stamp),
    db.prepare(`INSERT INTO reference_value_merge_validations(merge_id,passed,checked_at)
      SELECT m.id,CASE WHEN
        v.is_active=0 AND t.is_active=1
        AND (SELECT COUNT(*) FROM reference_value_merge_orders a WHERE a.merge_id=m.id)=m.expected_orders
        AND NOT EXISTS (
          SELECT 1 FROM reference_value_merge_orders a
          LEFT JOIN orders o ON o.id=a.order_id
          WHERE a.merge_id=m.id AND (o.id IS NULL OR o.order_date<m.month_start
            OR o.order_date>=m.month_next OR o.order_status='deleted'
            OR o.${field} IS NOT m.target_value)
        )
        AND NOT EXISTS (
          SELECT 1 FROM orders o WHERE o.order_date>=m.month_start
            AND o.order_date<m.month_next AND o.order_status<>'deleted'
            AND UPPER(TRIM(COALESCE(o.${field},'')))=UPPER(m.source_value)
        ) THEN 1 ELSE 0 END,?
      FROM reference_value_merges m
      JOIN reference_values v ON v.id=m.source_reference_id
      JOIN reference_values t ON t.id=m.target_reference_id
      WHERE m.source_reference_id=? AND m.target_reference_id=? AND m.created_at=?`
    ).bind(stamp,sourceId,targetId,stamp),
  ]
  const result=await db.batch(statements)
  if (toInt(result[0]?.meta?.changes,0)!==1
    || toInt(result[1]?.meta?.changes,0)!==rows.length
    || toInt(result[2]?.meta?.changes,0)!==rows.length
    || toInt(result[3]?.meta?.changes,0)!==1
    || toInt(result[4]?.meta?.changes,0)!==1) {
    throw new Error('Заказы изменились во время объединения. Откройте проверку заново.')
  }
  return {ok:true,merged:true,sourceId,targetId,ordersUpdated:rows.length,month:impact.month.label}
}
