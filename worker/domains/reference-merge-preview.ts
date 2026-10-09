import { cleanText, toInt } from '../core/text.ts'
import { previewPaymentMethodMerge } from './reference-payment-merge.ts'

export type Reference = { id: number; kind: string; value: string; is_active: number; updated_at:string }
const supported = new Set([
  'city', 'delivery_type', 'payment_method', 'return_reason', 'writeoff_reason',
  'color', 'material', 'length', 'size', 'child_age',
])
export const orderFields: Record<string,string> = {
  city: 'city', delivery_type: 'delivery_type', payment_method: 'order_payment_method',
}

export function businessMonthRange(date: Date = new Date()) {
  // The app uses Kazakhstan business time (UTC+05:00) for financial dates.
  const local = new Date(date.getTime() + 5 * 60 * 60 * 1000)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  const from = `${year}-${String(month+1).padStart(2,'0')}-01`
  const next = new Date(Date.UTC(year,month+1,1))
  const toExclusive = next.toISOString().slice(0,10)
  return { from, toExclusive, label: new Intl.DateTimeFormat('ru-RU', {
    year:'numeric',month:'long',timeZone:'UTC',
  }).format(new Date(Date.UTC(year,month,1))) }
}

type Summary = { current: number; older: number }
export type MergeOrderRow={ id:number; original_value:string; updated_at:string }
export async function readCurrentReferenceOrderRows(
  db:D1Database,field:'city'|'delivery_type',source:string,from:string,to:string,
) {
  const allowed=['city','delivery_type']
  if (!allowed.includes(field)) throw new Error('Неизвестное поле для объединения.')
  const response=await db.prepare(`SELECT id, ${field} AS original_value, COALESCE(updated_at,'') AS updated_at
    FROM orders WHERE order_date>=? AND order_date<? AND order_status<>'deleted'
      AND UPPER(TRIM(COALESCE(${field},'')))=UPPER(?)
    ORDER BY id LIMIT 5001`
  ).bind(from,to,source).all<MergeOrderRow>()
  return response.results||[]
}
export function currentOrderSnapshot(rows:MergeOrderRow[]) {
  return JSON.stringify(rows.map(row=>[row.id,row.updated_at]))
}
async function sha256(text:string) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('')
}
export async function referenceMergeToken(
  source:Reference,target:Reference,month:{from:string;toExclusive:string},rows:MergeOrderRow[],
) {
  return sha256(JSON.stringify([source.id,source.kind,source.value,source.updated_at,
    target.id,target.value,target.updated_at,month.from,month.toExclusive,currentOrderSnapshot(rows)]))
}

async function countAffectedPaymentOrders(db:D1Database, source:string, from:string,to:string):Promise<Summary>{
  // An order can store the payment method either on the order itself or only in
  // one of its payment/financial relations. Count distinct affected orders.
  const result=await db.prepare(`SELECT
    COUNT(CASE WHEN o.order_date>=? AND o.order_date<? THEN 1 END) AS current,
    COUNT(CASE WHEN o.order_date<? THEN 1 END) AS older
    FROM orders o
    WHERE o.order_status <> 'deleted'
      AND (
        UPPER(TRIM(COALESCE(o.order_payment_method,'')))=UPPER(?)
        OR EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND UPPER(TRIM(p.method))=UPPER(?))
        OR EXISTS(SELECT 1 FROM financial_events fe WHERE fe.order_id=o.id AND UPPER(TRIM(COALESCE(fe.payment_method,'')))=UPPER(?))
        OR EXISTS(SELECT 1 FROM cash_register_entries ce WHERE ce.order_id=o.id AND UPPER(TRIM(COALESCE(ce.payment_method,'')))=UPPER(?))
        OR EXISTS(SELECT 1 FROM returns r WHERE r.order_id=o.id AND UPPER(TRIM(COALESCE(r.payment_method,'')))=UPPER(?))
        OR EXISTS(SELECT 1 FROM exchanges e WHERE e.order_id=o.id AND UPPER(TRIM(COALESCE(e.payment_method,'')))=UPPER(?))
      )`
  ).bind(from,to,from,source,source,source,source,source,source).first<Summary>()
  return {current:toInt(result?.current,0),older:toInt(result?.older,0)}
}
async function countOrderColumn(db: D1Database, field: string, source: string, from: string, to: string): Promise<Summary> {
  if (!Object.values(orderFields).includes(field)) throw new Error('Unsupported order column')
  const x = await db.prepare(`SELECT
    COUNT(CASE WHEN order_date>=? AND order_date<? THEN 1 END) AS current,
    COUNT(CASE WHEN order_date<? THEN 1 END) AS older
    FROM orders WHERE UPPER(TRIM(COALESCE(${field},'')))=UPPER(?) AND order_status <> 'deleted'`
  ).bind(from,to,from,source).first<Summary>()
  return {current:toInt(x?.current,0),older:toInt(x?.older,0)}
}
async function countRelatedPaymentRows(db: D1Database, table: 'payments'|'financial_events'|'cash_register_entries'|'returns'|'exchanges',
  methodField: 'method'|'payment_method', source: string, from: string, to: string) {
  // Explicit whitelists: never interpolate a client-supplied table/column.
  const valid: Record<string,string> = {
    payments:'method',financial_events:'payment_method',
    cash_register_entries:'payment_method',returns:'payment_method',exchanges:'payment_method',
  }
  if (valid[table]!==methodField) throw new Error('Unsupported payment source')
  const x=await db.prepare(`SELECT
    COUNT(CASE WHEN o.order_date>=? AND o.order_date<? THEN 1 END) AS current,
    COUNT(CASE WHEN o.order_date<? THEN 1 END) AS older
    FROM ${table} r JOIN orders o ON o.id=r.order_id
    WHERE UPPER(TRIM(COALESCE(r.${methodField},'')))=UPPER(?)
      AND o.order_status<>'deleted'`
  ).bind(from,to,from,source).first<Summary>()
  return {current:toInt(x?.current,0),older:toInt(x?.older,0)}
}
async function countCatalogReferences(db: D1Database, kind: string, source: string) {
  const columns: Record<string,string> = { color:'color',material:'material',length:'length',size:'size_label',child_age:'size_label' }
  const col=columns[kind]
  if (!col) return 0
  const audience = kind==='size' ? " AND COALESCE(category,'adult')<>'child'"
    : kind==='child_age' ? " AND COALESCE(category,'adult')='child'" : ''
  const result=await db.prepare(
    `SELECT COUNT(*) AS total FROM catalog_variants
     WHERE is_active=1 AND UPPER(TRIM(COALESCE(${col},'')))=UPPER(?)${audience}`
  ).bind(source).first<{total:number}>()
  return toInt(result?.total,0)
}

export async function previewUserSelectedReferenceMerge(
  db: D1Database, sourceId: number, targetId: number, now: Date = new Date(),
) {
  if (!Number.isSafeInteger(sourceId)||!Number.isSafeInteger(targetId) || sourceId<1 || targetId<1 || sourceId===targetId) {
    throw new Error('Выберите два разных значения: какое убрать и какое оставить.')
  }
  const values=await db.prepare(
    'SELECT id,kind,value,is_active,updated_at FROM reference_values WHERE id IN (?,?)'
  ).bind(sourceId,targetId).all<Reference>()
  const rows=values.results||[]
  const source=rows.find(v=>v.id===sourceId), target=rows.find(v=>v.id===targetId)
  if (!source || !target) throw new Error('Одно из выбранных значений уже удалено. Обновите список.')
  if (source.kind!==target.kind || !supported.has(source.kind)) {
    throw new Error('Объединять можно только значения одного справочника.')
  }
  if (!source.is_active) throw new Error('Значение, которое нужно убрать, уже скрыто из выбора.')
  if (!target.is_active) throw new Error('Значение, которое нужно оставить, должно быть действующим.')
  if (!cleanText(source.value)||!cleanText(target.value)) throw new Error('У выбранных значений отсутствуют названия.')
  const month=businessMonthRange(now)
  const summary={current:0,older:0}
  const field=orderFields[source.kind]
  if (source.kind==='payment_method'){
    Object.assign(summary,await countAffectedPaymentOrders(db,source.value,month.from,month.toExclusive))
  } else if (field) {
    Object.assign(summary,await countOrderColumn(db,field,source.value,month.from,month.toExclusive))
  }
  const finance = {
    payments:{current:0,older:0},financialEvents:{current:0,older:0},
    cashEntries:{current:0,older:0},returns:{current:0,older:0},exchanges:{current:0,older:0},
  }
  if (source.kind==='payment_method') {
    const [payments,events,cash,returns,exchanges]=await Promise.all([
      countRelatedPaymentRows(db,'payments','method',source.value,month.from,month.toExclusive),
      countRelatedPaymentRows(db,'financial_events','payment_method',source.value,month.from,month.toExclusive),
      countRelatedPaymentRows(db,'cash_register_entries','payment_method',source.value,month.from,month.toExclusive),
      countRelatedPaymentRows(db,'returns','payment_method',source.value,month.from,month.toExclusive),
      countRelatedPaymentRows(db,'exchanges','payment_method',source.value,month.from,month.toExclusive),
    ])
    Object.assign(finance,{payments,financialEvents:events,cashEntries:cash,returns,exchanges})
  }
  const activeCatalogVariants=await countCatalogReferences(db,source.kind,source.value)
  const isMoney=source.kind==='payment_method'
  const mergeableKind=source.kind==='city'||source.kind==='delivery_type'
  const currentRows=mergeableKind
    ? await readCurrentReferenceOrderRows(db,source.kind as 'city'|'delivery_type',source.value,month.from,month.toExclusive)
    : []
  const paymentSafety=isMoney ? await previewPaymentMethodMerge(db,source,target,month) : null
  const canApply=paymentSafety
    ? paymentSafety.canApply
    : mergeableKind && currentRows.length<=5000 && currentRows.length===summary.current
  const stateToken=paymentSafety?.stateToken ||
    (canApply ? await referenceMergeToken(source,target,month,currentRows) : '')
  return {
    ok:true,
    kind:source.kind,
    source:{id:source.id,value:source.value},
    target:{id:target.id,value:target.value},
    month,
    orders:summary,
    ordersCovered: Boolean(field),
    finance,
    activeCatalogVariants,
    canApply,
    stateToken,
    matchedCurrentOrders:currentRows.length,
    paymentSafety,
    explanation: isMoney
      ? paymentSafety?.canApply
        ? 'Способ оплаты будет заменён только в заказах этого месяца и связанных безналичных операциях. Суммы и даты останутся прежними, исходные названия будут сохранены в истории объединения.'
        : paymentSafety?.blockers[0] || 'Способ оплаты требует дополнительной проверки денежных операций.'
      : activeCatalogVariants>0
        ? 'Это значение используется в товарах. При объединении нужно также проверить их варианты и остатки. Пока ничего не изменено.'
        : canApply
          ? 'Обновятся только заказы текущего месяца. Ранее оформленные заказы останутся без изменений. Название, которое вы убираете, исчезнет из дальнейшего выбора.'
          : mergeableKind
            ? 'Слишком много записей либо данные изменились во время проверки. Повторите проверку позже.'
            : 'Эта категория используется в рабочих документах. Проверка всех связанных записей ещё не завершена — сейчас сохранять изменения нельзя.',
  }
}
