import { cleanText, toInt } from '../core/text.ts'

// Read-only analysis for a user-selected source and keeper. No catalog writes.
// Material/length may be stored on either the variant or its execution.
const characteristics = new Set(['color', 'material', 'length', 'size', 'child_age'])
type CharacteristicSide = 'source' | 'target'
type ReferenceChoice = { kind: string; value: string }
type CountSummary = {
  side: CharacteristicSide
  variants: number
  activeVariants: number
  physical: number
  reserved: number
  currentOrderLines: number
  olderOrderLines: number
  activeUnsentLines: number
  activeReservations: number
  reservedUnits: number
  activeWorkshopTasks: number
}
type SampleVariant = {
  id: number; side: CharacteristicSide; productName: string; category: string
  material: string; length: string; color: string; size: string
  active: boolean; physical: number; reserved: number
}
const empty = (side: CharacteristicSide): CountSummary => ({
  side, variants: 0, activeVariants: 0, physical: 0, reserved: 0,
  currentOrderLines: 0, olderOrderLines: 0, activeUnsentLines: 0,
  activeReservations: 0, reservedUnits: 0, activeWorkshopTasks: 0,
})

export async function previewCharacteristicImpact(
  db: D1Database, source: ReferenceChoice, target: ReferenceChoice,
  month: { from: string; toExclusive: string },
) {
  if (source.kind !== target.kind || !characteristics.has(source.kind)) {
    throw new Error('Для этого списка требуется другая проверка объединения.')
  }
  const kind = source.kind
  const field = kind === 'color' ? 'color'
    : kind === 'material' ? 'material'
    : kind === 'length' ? 'length' : 'size_label'
  const primary = `UPPER(TRIM(COALESCE(v.${field},'')))`
  const execution = kind === 'material' || kind === 'length'
    ? `UPPER(TRIM(COALESCE(sp.${field},'')))` : ''
  const bindValue = (value: string) => execution ? [value, value] : [value]
  const sourceValue = cleanText(source.value).toUpperCase()
  const targetValue = cleanText(target.value).toUpperCase()
  const match = (side: string) => execution
    ? `(${primary}=? OR ${execution}=?)`
    : `${primary}=?`
  const sourceMatch = match('source')
  const targetMatch = match('target')
  const audience = kind === 'size'
    ? "AND COALESCE(v.category,'adult')<>'child'"
    : kind === 'child_age'
      ? "AND COALESCE(v.category,'adult')='child'" : ''
  const cte = `WITH affected AS (
    SELECT v.id,v.product_id,v.stock_position_id,v.category,v.gender,
      v.color,v.material,v.length,v.size_label,v.is_active,p.name AS product_name,
      CASE WHEN ${sourceMatch} THEN 'source' ELSE 'target' END AS side
    FROM catalog_variants v
    JOIN catalog_products p ON p.id=v.product_id
    LEFT JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
    WHERE (${sourceMatch} OR ${targetMatch}) ${audience}
  )`
  const commonBindings = [
    ...bindValue(sourceValue), ...bindValue(sourceValue), ...bindValue(targetValue),
  ]
  async function grouped<T>(query: string, extra: unknown[] = []) {
    const rows = await db.prepare(`${cte} ${query}`).bind(...commonBindings, ...extra).all<T>()
    return rows.results || []
  }
  const summary: Record<CharacteristicSide, CountSummary> = {
    source: empty('source'), target: empty('target'),
  }
  const countRows = await grouped<{side: CharacteristicSide; variants: number; active: number}>(
    `SELECT side,COUNT(*) AS variants,SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) AS active
     FROM affected GROUP BY side`,
  )
  for (const item of countRows) {
    const side = item.side === 'source' ? 'source' : 'target'
    summary[side].variants = toInt(item.variants, 0)
    summary[side].activeVariants = toInt(item.active, 0)
  }
  const locationRows = await grouped<{
    side: CharacteristicSide; location: string; physical: number; reserved: number
  }>(`SELECT a.side,s.inventory_source AS location,
         COALESCE(SUM(s.quantity),0) AS physical,
         COALESCE(SUM(s.reserved_quantity),0) AS reserved
       FROM affected a JOIN inventory_stock s ON s.variant_id=a.id
       GROUP BY a.side,s.inventory_source`)
  const byLocation = locationRows.map(row => ({
    side: row.side, location: row.location,
    physical: toInt(row.physical, 0), reserved: toInt(row.reserved, 0),
  }))
  for (const item of byLocation) {
    summary[item.side].physical += item.physical
    summary[item.side].reserved += item.reserved
  }
  const orderRows = await grouped<{
    side: CharacteristicSide; current_lines: number; older_lines: number; active_unsent: number
  }>(`SELECT a.side,
      SUM(CASE WHEN o.order_date>=? AND o.order_date<? AND o.order_status<>'deleted'
          THEN 1 ELSE 0 END) AS current_lines,
      SUM(CASE WHEN o.order_date<? AND o.order_status<>'deleted'
          THEN 1 ELSE 0 END) AS older_lines,
      SUM(CASE WHEN o.order_status='active'
        AND COALESCE(o.shipping_status,'not_sent')<>'sent'
        AND oi.quantity>0 THEN 1 ELSE 0 END) AS active_unsent
      FROM affected a JOIN order_items oi ON oi.variant_id=a.id
      JOIN orders o ON o.id=oi.order_id
      GROUP BY a.side`, [month.from, month.toExclusive, month.from])
  for (const item of orderRows) {
    const side = item.side
    summary[side].currentOrderLines = toInt(item.current_lines, 0)
    summary[side].olderOrderLines = toInt(item.older_lines, 0)
    summary[side].activeUnsentLines = toInt(item.active_unsent, 0)
  }
  const reservationRows = await grouped<{
    side: CharacteristicSide; count: number; units: number
  }>(`SELECT a.side,COUNT(*) AS count,COALESCE(SUM(r.quantity),0) AS units
      FROM affected a JOIN inventory_reservations r ON r.variant_id=a.id
      WHERE r.status='active' GROUP BY a.side`)
  for (const item of reservationRows) {
    summary[item.side].activeReservations = toInt(item.count, 0)
    summary[item.side].reservedUnits = toInt(item.units, 0)
  }
  const workshopRows = await grouped<{ side: CharacteristicSide; count: number }>(
    `SELECT a.side,COUNT(*) AS count
       FROM affected a JOIN workshop_tasks wt ON wt.variant_id=a.id
       WHERE wt.status='active' GROUP BY a.side`,
  )
  for (const item of workshopRows) summary[item.side].activeWorkshopTasks = toInt(item.count, 0)
  const samples = await grouped<{
    id:number;side:CharacteristicSide;product_name:string;category:string;
    color:string;material:string;length:string;size_label:string;is_active:number;
    physical:number;reserved:number;
  }>(`SELECT a.id,a.side,a.product_name,a.category,a.color,a.material,a.length,a.size_label,a.is_active,
      COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s WHERE s.variant_id=a.id),0) AS physical,
      COALESCE((SELECT SUM(s.reserved_quantity) FROM inventory_stock s WHERE s.variant_id=a.id),0) AS reserved
      FROM affected a ORDER BY a.side DESC,a.is_active DESC,a.product_name,a.id LIMIT 13`)
  const sampleVariants: SampleVariant[] = samples.slice(0,12).map(v => ({
    id:v.id,side:v.side,productName:v.product_name,category:v.category || 'adult',
    color:v.color||'',material:v.material||'',length:v.length||'',size:v.size_label||'',
    active:v.is_active===1,physical:toInt(v.physical,0),reserved:toInt(v.reserved,0),
  }))
  let sourceExecutions = 0
  if (execution) {
    const r = await db.prepare(
      `SELECT COUNT(*) AS n FROM catalog_stock_positions
        WHERE is_active=1 AND UPPER(TRIM(COALESCE(${field},'')))=?`,
    ).bind(sourceValue).first<{n:number}>()
    sourceExecutions = toInt(r?.n,0)
  }
  const mixedMetadata = execution
    ? await db.prepare(`SELECT COUNT(*) AS n
        FROM catalog_variants v LEFT JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
        WHERE ${sourceMatch} AND ${targetMatch} ${audience}`)
      .bind(...bindValue(sourceValue),...bindValue(targetValue)).first<{n:number}>()
    : null
  const indistinguishable = sourceValue === targetValue
  const sourceUsed = summary.source.activeVariants>0 || summary.source.physical!==0
    || summary.source.reserved!==0 || summary.source.activeReservations>0
    || summary.source.activeWorkshopTasks>0 || sourceExecutions>0
  const warnings: string[] = []
  if (indistinguishable) warnings.push(
    'У двух значений одинаковое написание. Варианты товара хранят текст, а не ID справочника: разделить их автоматически невозможно.',
  )
  if (toInt(mixedMetadata?.n,0)>0) warnings.push(
    'В отдельных вариантах значения характеристик отличаются от значений исполнения. Такие связи требуют дополнительной проверки.',
  )
  if (summary.source.activeVariants>0) warnings.push(
    'Есть действующие варианты с этим значением. Нужно проверять совпадающие SKU, заказы и резервы перед переносом.',
  )
  if (sourceExecutions>0) warnings.push(
    'Значение используется в исполнениях товаров. Переименование без согласования исполнения опасно.',
  )
  if (summary.source.physical || summary.source.reserved || summary.source.activeReservations) warnings.push(
    'Есть физические остатки или резервы: они не должны пропасть или попасть в неправильный вариант.',
  )
  if (summary.source.activeWorkshopTasks) warnings.push(
    'По выбранным вариантам есть действующие задачи цеха.',
  )
  return {
    kind, source: summary.source, target: summary.target,
    sourceExecutions, byLocation, sampleVariants,
    sampleTruncated: samples.length>12,
    indistinguishable, warnings,
    canAutomaticallyConsolidate: false,
    // Until a SKU-aware transactional writer exists, this endpoint is ONLY a preview.
    status: sourceUsed || indistinguishable ? 'requires_catalog_review' : 'unused_or_historical',
  }
}
