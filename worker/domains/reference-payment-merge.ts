import { cleanText, toInt, upperText } from '../core/text.ts'

type RecordLine = {
  kind: 'orders'|'payments'|'financial_events'|'returns'|'exchanges'
  id:number;order_id:number;method:string;date:string;amount:number
}
type ReferenceChoice = {id:number;kind:string;value:string;is_active:number;updated_at:string|null}
const safeNoncash = new Set(['ТЕРМИНАЛ','KASPI PAY','ХАЛЫК ПЕРЕВОД'])
const limit = 5000
const query = `SELECT kind,id,order_id,method,date,amount
FROM (
 SELECT 'orders' AS kind,o.id AS id,o.id AS order_id,o.order_payment_method AS method,
  o.order_date AS date,0 AS amount
 FROM orders o WHERE o.order_date>=? AND o.order_date<? AND o.order_status<>'deleted'
  AND UPPER(TRIM(COALESCE(o.order_payment_method,'')))=UPPER(TRIM(?))
 UNION ALL
 SELECT 'payments',p.id,p.order_id,p.method,p.payment_date,COALESCE(p.amount,0)
 FROM payments p JOIN orders o ON o.id=p.order_id
 WHERE o.order_date>=? AND o.order_date<? AND o.order_status<>'deleted'
  AND UPPER(TRIM(COALESCE(p.method,'')))=UPPER(TRIM(?))
 UNION ALL
 SELECT 'financial_events',e.id,e.order_id,e.payment_method,e.event_date,COALESCE(e.amount_delta,0)
 FROM financial_events e JOIN orders o ON o.id=e.order_id
 WHERE o.order_date>=? AND o.order_date<? AND o.order_status<>'deleted'
  AND UPPER(TRIM(COALESCE(e.payment_method,'')))=UPPER(TRIM(?))
 UNION ALL
 SELECT 'returns',r.id,r.order_id,r.payment_method,r.return_date,COALESCE(r.amount,0)
 FROM returns r JOIN orders o ON o.id=r.order_id
 WHERE o.order_date>=? AND o.order_date<? AND o.order_status<>'deleted'
  AND UPPER(TRIM(COALESCE(r.payment_method,'')))=UPPER(TRIM(?))
 UNION ALL
 SELECT 'exchanges',e.id,e.order_id,e.payment_method,e.exchange_date,COALESCE(e.financial_amount,0)
 FROM exchanges e JOIN orders o ON o.id=e.order_id
 WHERE o.order_date>=? AND o.order_date<? AND o.order_status<>'deleted'
  AND UPPER(TRIM(COALESCE(e.payment_method,'')))=UPPER(TRIM(?))
) ORDER BY kind,id`
const params=(from:string,to:string,source:string)=>Array.from({length:5},()=>[from,to,source]).flat()
export async function paymentMethodMergeSourceRows(
  db:D1Database,source:string,from:string,to:string,
):Promise<RecordLine[]> {
  const fetched=await db.prepare(query+' LIMIT 5001').bind(...params(from,to,source)).all<RecordLine>()
  return fetched.results||[]
}
function serialize(rows:RecordLine[]) {
  return JSON.stringify(rows.map(r=>[r.kind,r.id,r.order_id,r.method,r.date,r.amount]))
}
async function digest(content:string) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content))
  return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('')
}
async function cashMethodRows(db:D1Database,source:string,from:string,to:string) {
  const r=await db.prepare(`SELECT COUNT(*) AS n FROM cash_register_entries c
     JOIN orders o ON o.id=c.order_id
     WHERE o.order_date>=? AND o.order_date<? AND o.order_status<>'deleted'
       AND UPPER(TRIM(COALESCE(c.payment_method,'')))=UPPER(TRIM(?))`
  ).bind(from,to,source).first<{n:number}>()
  return toInt(r?.n,0)
}
export async function previewPaymentMethodMerge(
  db:D1Database,source:ReferenceChoice,target:ReferenceChoice,month:{from:string;toExclusive:string},
) {
  if (source.kind!=='payment_method'||target.kind!=='payment_method'
    ||source.id===target.id||source.is_active!==1||target.is_active!==1) {
    throw new Error('Выберите два действующих разных способа оплаты.')
  }
  const blockers:string[]=[]
  if (!safeNoncash.has(upperText(source.value))||!safeNoncash.has(upperText(target.value))) {
    blockers.push('Этот способ оплаты требует отдельной проверки денежных операций. Автоматически можно объединять только обычные безналичные способы, не Kaspi магазин и не наличные.')
  }
  const rows=await paymentMethodMergeSourceRows(db,source.value,month.from,month.toExclusive)
  if(rows.length>limit) blockers.push('В текущем месяце слишком много связанных записей для одного объединения.')
  const cash=await cashMethodRows(db,source.value,month.from,month.toExclusive)
  if (cash>0) blockers.push('Есть кассовые операции с этим способом оплаты. Их нельзя переклассифицировать как обычный безналичный платёж.')
  const oldFinancial=rows.filter(r=>r.kind!=='orders' && (!r.date||r.date<month.from))
  if (oldFinancial.length) blockers.push('Есть денежные операции, проведённые до начала этого месяца. Их исторический период нужно сохранить.')
  const snapshot=serialize(rows)
  const fingerprint=await digest(JSON.stringify([
    source.id,source.value,source.updated_at,target.id,target.value,target.updated_at,
    month.from,month.toExclusive,snapshot,
  ]))
  const summary={orders:0,payments:0,financialEvents:0,returns:0,exchanges:0}
  for(const row of rows){
    if(row.kind==='orders')summary.orders++
    if(row.kind==='payments')summary.payments++
    if(row.kind==='financial_events')summary.financialEvents++
    if(row.kind==='returns')summary.returns++
    if(row.kind==='exchanges')summary.exchanges++
  }
  return {canApply:blockers.length===0,stateToken:blockers.length===0?fingerprint:'',
    affectedOrders:new Set(rows.map(x=>x.order_id)).size,
    affectedRecords:summary,blockers,cashRegisterRecords:cash,
    expectedRows:rows.length,snapshot}
}
function referenceGuard(dbKind:string){return dbKind==='payment_method'}
export async function applyPaymentMethodMerge(
  db:D1Database,sourceId:number,targetId:number,expectedToken:string,actor:string,
  month:{from:string;toExclusive:string},
) {
  const prior=await db.prepare('SELECT target_reference_id FROM reference_payment_method_merges WHERE source_reference_id=?')
    .bind(sourceId).first<{target_reference_id:number}>()
  if(prior){
    if(toInt(prior.target_reference_id,0)===targetId)return {ok:true,alreadyMerged:true}
    throw new Error('Значение уже объединено с другим способом оплаты.')
  }
  if(!Number.isSafeInteger(sourceId)||!Number.isSafeInteger(targetId)||sourceId<=0||targetId<=0||sourceId===targetId){
    throw new Error('Выберите два разных способа оплаты.')
  }
  const refs=await db.prepare('SELECT id,kind,value,is_active,updated_at FROM reference_values WHERE id IN (?,?)')
    .bind(sourceId,targetId).all<ReferenceChoice>()
  const source=(refs.results||[]).find(v=>v.id===sourceId)
  const target=(refs.results||[]).find(v=>v.id===targetId)
  if(!source||!target||!referenceGuard(source.kind)||source.kind!==target.kind){
    throw new Error('Выберите два способа оплаты из одного списка.')
  }
  const preview=await previewPaymentMethodMerge(db,source,target,month)
  if(!preview.canApply||!preview.stateToken||preview.stateToken!==expectedToken) {
    throw new Error(preview.blockers[0]||'Заказы или оплаты изменились после проверки. Проверьте объединение ещё раз.')
  }
  const now=new Date().toISOString()
  const vals=params(month.from,month.toExclusive,source.value)
  // The first INSERT locks the exact, originally reviewed financial facts inside
  // the D1 batch transaction. All further writes depend on that audit row.
  const snapshotSql=`SELECT COALESCE(json_group_array(json_array(z.kind,z.id,z.order_id,z.method,z.date,z.amount)),'[]')
    FROM (${query}) z`
  const hasMerge=`EXISTS(SELECT 1 FROM reference_payment_method_merges m
      WHERE m.source_reference_id=? AND m.target_reference_id=? AND m.created_at=?)`
  const statement=[
    db.prepare(`INSERT INTO reference_payment_method_merges
      (source_reference_id,target_reference_id,source_value,target_value,
        month_start,month_next,expected_rows,source_fingerprint,created_by,created_at)
      SELECT v.id,t.id,v.value,t.value,?,?,?,?,?,?
      FROM reference_values v JOIN reference_values t ON t.id=? AND t.kind='payment_method'
      WHERE v.id=? AND v.kind='payment_method' AND v.is_active=1 AND t.is_active=1
        AND v.value=? AND t.value=? AND v.updated_at IS ? AND t.updated_at IS ?
        AND NOT EXISTS (SELECT 1 FROM reference_payment_method_merges m WHERE m.source_reference_id=v.id)
        AND (${snapshotSql})=?
        AND NOT EXISTS (SELECT 1 FROM cash_register_entries c JOIN orders o ON o.id=c.order_id
          WHERE o.order_date>=? AND o.order_date<? AND o.order_status<>'deleted'
            AND UPPER(TRIM(COALESCE(c.payment_method,'')))=UPPER(TRIM(?)))`
    ).bind(month.from,month.toExclusive,preview.expectedRows,preview.stateToken,cleanText(actor)||null,now,
      targetId,sourceId,source.value,target.value,source.updated_at,target.updated_at,
      ...vals,preview.snapshot,month.from,month.toExclusive,source.value),
    db.prepare(`INSERT INTO reference_payment_merge_lines
      (merge_id,entity_type,entity_id,order_id,original_method,method_after,operation_date,original_amount)
      SELECT m.id,z.kind,z.id,z.order_id,z.method,m.target_value,z.date,z.amount
      FROM reference_payment_method_merges m
      JOIN (${query}) z ON 1=1
      WHERE m.source_reference_id=? AND m.target_reference_id=? AND m.created_at=?`
    ).bind(...vals,sourceId,targetId,now),
  ]
  const mapping=[
    {table:'orders',field:'order_payment_method'},
    {table:'payments',field:'method'},
    {table:'financial_events',field:'payment_method'},
    {table:'returns',field:'payment_method'},
    {table:'exchanges',field:'payment_method'},
  ] as const
  for(const entity of mapping) {
    statement.push(db.prepare(`UPDATE ${entity.table} SET ${entity.field}=?
      WHERE id IN (SELECT line.entity_id FROM reference_payment_merge_lines line
        JOIN reference_payment_method_merges m ON m.id=line.merge_id
        WHERE line.entity_type=? AND m.source_reference_id=? AND m.target_reference_id=? AND m.created_at=?)
        AND UPPER(TRIM(COALESCE(${entity.field},'')))=UPPER(TRIM(?))`
    ).bind(target.value,entity.table,sourceId,targetId,now,source.value))
  }
  statement.push(
    db.prepare(`UPDATE reference_values SET is_active=0,updated_at=?
      WHERE id=? AND is_active=1 AND ${hasMerge}`
    ).bind(now,sourceId,sourceId,targetId,now),
    db.prepare(`INSERT INTO reference_payment_merge_validations(merge_id,passed,checked_at)
      SELECT m.id,CASE WHEN
        v.is_active=0 AND t.is_active=1
        AND (SELECT COUNT(*) FROM reference_payment_merge_lines l WHERE l.merge_id=m.id)=m.expected_rows
        AND NOT EXISTS (
          SELECT 1 FROM reference_payment_merge_lines l
          WHERE l.merge_id=m.id AND (
             (l.entity_type='orders' AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.id=l.entity_id AND x.order_payment_method=m.target_value))
          OR (l.entity_type='payments' AND NOT EXISTS (SELECT 1 FROM payments x WHERE x.id=l.entity_id AND x.method=m.target_value))
          OR (l.entity_type='financial_events' AND NOT EXISTS (SELECT 1 FROM financial_events x WHERE x.id=l.entity_id AND x.payment_method=m.target_value))
          OR (l.entity_type='returns' AND NOT EXISTS (SELECT 1 FROM returns x WHERE x.id=l.entity_id AND x.payment_method=m.target_value))
          OR (l.entity_type='exchanges' AND NOT EXISTS (SELECT 1 FROM exchanges x WHERE x.id=l.entity_id AND x.payment_method=m.target_value))
        ))
        AND NOT EXISTS (SELECT 1 FROM (${query}) remaining)
        THEN 1 ELSE 0 END,?
      FROM reference_payment_method_merges m
      JOIN reference_values v ON v.id=m.source_reference_id
      JOIN reference_values t ON t.id=m.target_reference_id
      WHERE m.source_reference_id=? AND m.target_reference_id=? AND m.created_at=?`
    ).bind(...vals,now,sourceId,targetId,now),
  )
  const changes=await db.batch(statement)
  const expected=[1,preview.expectedRows,...mapping.map(m=>preview.affectedRecords[
    m.table==='financial_events'?'financialEvents':m.table==='orders'?'orders':
      m.table==='payments'?'payments':m.table==='returns'?'returns':'exchanges'
  ]),1,1]
  if(expected.some((n,i)=>toInt(changes[i]?.meta?.changes,0)!==n)){
    throw new Error('Платежи изменились во время объединения. Обновите проверку и повторите действие.')
  }
  return {ok:true,merged:true,sourceId,targetId,ordersUpdated:preview.affectedOrders,
    recordsUpdated:preview.expectedRows}
}
