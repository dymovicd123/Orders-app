// Administrator history of manual dictionary consolidation decisions.
import { cleanText, toInt } from '../core/text.ts'

type HistoryRow={
  id:number;kind:string;source_value:string;target_value:string;
  record_count:number;created_by:string|null;created_at:string;source_id:number;target_id:number;
}
export async function listRecentReferenceValueMerges(db:D1Database) {
  const rows=await db.prepare(`
    SELECT id,kind,source_value,target_value,expected_orders AS record_count,
      created_by,created_at,source_reference_id AS source_id,target_reference_id AS target_id
    FROM reference_value_merges
    UNION ALL
    SELECT id,'payment_method' AS kind,source_value,target_value,expected_rows AS record_count,
      created_by,created_at,source_reference_id AS source_id,target_reference_id AS target_id
    FROM reference_payment_method_merges
    ORDER BY created_at DESC,kind,id DESC LIMIT 30
  `).all<HistoryRow>()
  return {ok:true,items:(rows.results||[]).map(x=>({
    id:toInt(x.id,0),kind:cleanText(x.kind),
    source:cleanText(x.source_value),target:cleanText(x.target_value),
    affected:toInt(x.record_count,0),actor:cleanText(x.created_by)||'Администратор',
    createdAt:cleanText(x.created_at),sourceId:toInt(x.source_id,0),targetId:toInt(x.target_id,0),
  }))}
}
