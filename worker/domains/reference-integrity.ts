// Catalog Integrity R2 — bounded, read-only admin inspection before any merge.
import { cleanText, toInt } from '../core/text.ts'
import { referenceValueIdentityKey } from './references.ts'
import { catalogColorIdentity, normalizeCatalogCombinationSize } from './catalog.ts'

type ReferenceRow = { id: number; kind: string; value: string; is_active: number }
type VariantRow = {
  id: number; product_id: number; stock_position_id: number | null; is_active: number
  category: string; gender: string | null; color: string | null; size_label: string | null
  material: string | null; length: string | null; product_name: string
  physical: number; reserved: number
}

export function groupEquivalentReferenceValues(rows: ReferenceRow[]) {
  const groups = new Map<string, ReferenceRow[]>()
  for (const row of rows) {
    const key = referenceValueIdentityKey(row.value)
    if (!key) continue
    const groupKey = row.kind + '\u001f' + key
    const group = groups.get(groupKey) || []
    group.push(row)
    groups.set(groupKey, group)
  }
  return [...groups].filter(([, rows]) => rows.length > 1).map(([key, values]) => {
    const sorted = [...values].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.id - b.id)
    const canonical = sorted[0]
    return {
      kind: canonical.kind, identity: key.split('\u001f')[1],
      suggestedTargetId: canonical.id,
      items: sorted.map(row => ({ id: row.id, value: row.value, isActive: Boolean(row.is_active) })),
    }
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.identity.localeCompare(b.identity))
}

export type CatalogCollisionRow = {
  id: number; product_id: number; stock_position_id: number | null;
  category: string; gender: string | null; color: string | null; size_label: string | null;
  material: string | null; length: string | null; product_name: string;
  physical: number; reserved: number;
}

export function groupEquivalentCatalogVariants(rows: CatalogCollisionRow[]) {
  const groups = new Map<string, CatalogCollisionRow[]>()
  for (const row of rows) {
    // SKU identity includes execution (material+length), category, gender and size.
    // Distinct physical executions such as ДРАП and ШЕРСТЬ never merge.
    const execution = row.stock_position_id != null
      ? 'position:' + row.stock_position_id
      : 'legacy:' + cleanText(row.material).toUpperCase() + '/' + cleanText(row.length).toUpperCase()
    const key = [row.product_id, execution, row.category || 'adult', row.gender || '',
      catalogColorIdentity(row.color), normalizeCatalogCombinationSize(row.size_label)].join('\u001f')
    const list = groups.get(key) || []
    list.push(row)
    groups.set(key, list)
  }
  return [...groups.values()].filter(rows => rows.length > 1)
    .map(rows => ({
      productId: rows[0].product_id, productName: rows[0].product_name,
      category: rows[0].category, gender: rows[0].gender,
      color: catalogColorIdentity(rows[0].color), size: normalizeCatalogCombinationSize(rows[0].size_label),
      material: rows[0].material, length: rows[0].length, stockPositionId: rows[0].stock_position_id,
      variants: rows.map(x => ({
        id: x.id, color: x.color, size: x.size_label,
        material: x.material, length: x.length, physical: toInt(x.physical,0), reserved: toInt(x.reserved,0),
      })),
    }))
    .sort((a,b) => a.productName.localeCompare(b.productName) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size))
}

export async function listReferenceDuplicateGroups(db: D1Database) {
  const result = await db.prepare(
    'SELECT id, kind, value, is_active FROM reference_values ORDER BY kind, is_active DESC, id ASC LIMIT 1500'
  ).all<ReferenceRow>()
  const groups = groupEquivalentReferenceValues(result.results || [])
  const catalog = await db.prepare(
    `SELECT v.id, v.product_id, v.stock_position_id, v.category, v.gender,
       v.color, v.size_label, v.material, v.length, p.name AS product_name,
       COALESCE(SUM(s.quantity),0) AS physical, COALESCE(SUM(s.reserved_quantity),0) AS reserved
     FROM catalog_variants v
     JOIN catalog_products p ON p.id=v.product_id
     LEFT JOIN inventory_stock s ON s.variant_id=v.id
     WHERE v.is_active=1
     GROUP BY v.id
     ORDER BY v.product_id,v.stock_position_id,v.id
     LIMIT 2000`
  ).all<CatalogCollisionRow>()
  const skuGroups = groupEquivalentCatalogVariants(catalog.results || [])
  return {
    ok: true, groups, skuGroups,
    limited: (result.results || []).length >= 1500,
    skuLimited: (catalog.results || []).length >= 2000,
  }
}

function supportedCatalogKind(dbKind: string) {
  return ['color', 'material', 'length', 'size', 'child_age'].includes(dbKind)
}

export async function previewReferenceConsolidation(db: D1Database, sourceId: number, targetId: number) {
  if (!Number.isSafeInteger(sourceId) || !Number.isSafeInteger(targetId) || sourceId <= 0 || targetId <= 0 || sourceId === targetId) {
    throw new Error('Выберите два разных значения для предварительной проверки.')
  }
  const res = await db.prepare(
    'SELECT id, kind, value, is_active FROM reference_values WHERE id IN (?, ?) ORDER BY id'
  ).bind(sourceId, targetId).all<ReferenceRow>()
  const rows = res.results || []
  const source = rows.find(x => x.id === sourceId), target = rows.find(x => x.id === targetId)
  if (!source || !target) throw new Error('Одно из значений справочника не найдено.')
  if (source.kind !== target.kind || referenceValueIdentityKey(source.value) !== referenceValueIdentityKey(target.value)) {
    throw new Error('Автоматически можно рассматривать только одинаковые по смыслу значения одного справочника.')
  }
  if (!target.is_active) throw new Error('Основное значение должно быть активным.')
  const dbKind = source.kind
  let linked: VariantRow[] = []
  let activeExecutions = 0
  if (supportedCatalogKind(dbKind)) {
    const column = dbKind === 'color' ? 'v.color'
      : dbKind === 'material' ? 'v.material'
      : dbKind === 'length' ? 'v.length' : 'v.size_label'
    const audience = dbKind === 'size' ? " AND COALESCE(v.category,'adult') <> 'child'"
      : dbKind === 'child_age' ? " AND COALESCE(v.category,'adult') = 'child'" : ''
    const fetched = await db.prepare(
      `SELECT v.id,v.product_id,v.stock_position_id,v.is_active,v.category,v.gender,v.color,
        v.size_label,v.material,v.length,p.name AS product_name,
        COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s WHERE s.variant_id=v.id),0) AS physical,
        COALESCE((SELECT SUM(s.reserved_quantity) FROM inventory_stock s WHERE s.variant_id=v.id),0) AS reserved
       FROM catalog_variants v
       JOIN catalog_products p ON p.id=v.product_id
       WHERE UPPER(TRIM(COALESCE(${column},''))) IN (?, ?)${audience}
       ORDER BY v.is_active DESC, p.name, v.id
       LIMIT 400`
    ).bind(cleanText(source.value).toUpperCase(), cleanText(target.value).toUpperCase()).all<VariantRow>()
    linked = fetched.results || []
    if (dbKind === 'material' || dbKind === 'length') {
      const key = dbKind === 'material' ? 'material' : 'length'
      const positions = await db.prepare(
        `SELECT COUNT(*) AS n FROM catalog_stock_positions
         WHERE is_active=1 AND UPPER(TRIM(COALESCE(${key},''))) = ?`
      ).bind(cleanText(source.value).toUpperCase()).first<{ n: number }>()
      activeExecutions = toInt(positions?.n, 0)
    }
  }
  const variants = linked.map(v => ({
    id: v.id, productName: v.product_name, category: v.category, gender: v.gender,
    color: v.color, size: v.size_label, material: v.material, length: v.length,
    active: Boolean(v.is_active), stockPositionId: v.stock_position_id,
    physical: toInt(v.physical, 0), reserved: toInt(v.reserved, 0),
    belongsTo: cleanText(dbKind === 'color' ? v.color : dbKind === 'material' ? v.material :
      dbKind === 'length' ? v.length : v.size_label).toUpperCase() === cleanText(source.value).toUpperCase()
      ? 'source' : 'target',
  }))
  const sourceActiveVariants = variants.filter(v => v.belongsTo === 'source' && v.active).length
  const sourcePhysical = variants.filter(v => v.belongsTo === 'source').reduce((n, v) => n + v.physical, 0)
  const sourceReserved = variants.filter(v => v.belongsTo === 'source').reduce((n, v) => n + v.reserved, 0)
  const physical = variants.reduce((n, v) => n + v.physical, 0)
  const reserved = variants.reduce((n, v) => n + v.reserved, 0)
  const requiresCatalogReview = sourceActiveVariants > 0 || activeExecutions > 0 || sourcePhysical !== 0 || sourceReserved !== 0
  return {
    ok: true,
    source: { id: source.id, kind: dbKind, value: source.value, isActive: Boolean(source.is_active) },
    target: { id: target.id, kind: dbKind, value: target.value, isActive: Boolean(target.is_active) },
    summary: {
      matchedVariantCount: variants.length, sourceActiveVariants, activeExecutions, sourcePhysical, sourceReserved,
      physical, reserved, variantLimitReached: linked.length >= 400,
      requiresCatalogReview,
    },
    sampleVariants: variants.slice(0, 30),
    safeToHideSource: !requiresCatalogReview && linked.length < 400,
    explanation: requiresCatalogReview
      ? 'Это значение участвует в Каталоге. Сначала нужно безопасно объединить связанные варианты и проверить остатки; здесь ничего не изменено.'
      : 'Активных связей и остатков у лишнего значения не найдено. После окончательной проверки его можно будет убрать из выбора, сохранив историю.',
  }
}
