import { isUnitBarcode } from '../../shared/barcode-unit.ts'

export type OutboundBarcodeMode = 'writeoff' | 'transfer'
export type OutboundBarcodeSource = 'warehouse' | 'boutique'

export function normalizeOutboundUnitBarcodes(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 60) {
    throw new Error('Для одной операции допускается не более 60 индивидуальных кодов.')
  }
  const tokens = value.map(item => {
    const token = typeof item === 'string' ? item.trim().toUpperCase() : ''
    if (!isUnitBarcode(token)) {
      throw new Error('Для операции со сканером нужны действующие индивидуальные штрихкоды вещей, а не общий SKU.')
    }
    return token
  })
  if (new Set(tokens).size !== tokens.length) {
    throw new Error('Одна вещь отсканирована дважды. Удалите повтор перед сохранением.')
  }
  return tokens.sort()
}

export async function prepareOutboundBarcodeStatements(
  db: D1Database,
  args: {
    tokens: string[]
    mode: OutboundBarcodeMode
    fromSource: OutboundBarcodeSource
    toSource: OutboundBarcodeSource | 'none'
    operationId: string
    maximumByVariant: Map<number, number>
    actor: string
    at: string
  },
): Promise<D1PreparedStatement[]> {
  const { tokens, mode, fromSource, toSource, operationId, maximumByVariant, actor, at } = args
  if (!tokens.length) return []
  const exists = await db.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name='trg_outbound_unit_scan_apply'"
  ).first<{ count: number }>()
  if (Number(exists?.count || 0) !== 1) {
    throw new Error('Учёт индивидуальных сканирований для складских операций ещё не включён. Используйте обычную ручную форму.')
  }
  const placeholders = tokens.map(() => '?').join(',')
  const rows = await db.prepare(
    `SELECT l.token,l.state AS label_state,u.unit_id,u.variant_id,u.inventory_source,
            u.unit_status,u.coverage_status,
            v.is_active AS variant_active,p.is_active AS product_active,
            sp.is_active AS execution_active
       FROM inventory_unit_labels l
       JOIN inventory_units u ON u.unit_id=l.unit_id
       LEFT JOIN catalog_variants v ON v.id=u.variant_id
       LEFT JOIN catalog_products p ON p.id=v.product_id
       LEFT JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id
      WHERE l.token IN (${placeholders})`
  ).bind(...tokens).all<{
    token: string
    label_state: string
    unit_id: string
    variant_id: number
    inventory_source: string
    unit_status: string
    coverage_status: string
    variant_active: number
    product_active: number
    execution_active: number
  }>()
  const indexed = new Map((rows.results || []).map(row => [row.token, row]))
  const usedByVariant = new Map<number, number>()
  const statements: D1PreparedStatement[] = []
  const seenUnits = new Set<string>()
  for (const token of tokens) {
    const row = indexed.get(token)
    if (!row || row.label_state !== 'active'
      || Number(row.variant_active) !== 1
      || Number(row.product_active) !== 1
      || Number(row.execution_active) !== 1) {
      throw new Error('Один из штрихкодов не найден, отозван или принадлежит удалённому варианту.')
    }
    if (seenUnits.has(row.unit_id)) throw new Error('Одна физическая вещь имеет два введённых кода. Оставьте один.')
    seenUnits.add(row.unit_id)
    if (row.inventory_source !== fromSource
      || !['unverified','on_hand'].includes(row.unit_status)
      || !['unlinked','linked'].includes(row.coverage_status)) {
      throw new Error('Сканируемая вещь не числится в исходной точке или уже выбыла. Проверьте её состояние.')
    }
    const variantId = Number(row.variant_id)
    const maximum = maximumByVariant.get(variantId) || 0
    const next = (usedByVariant.get(variantId) || 0) + 1
    if (next > maximum) {
      throw new Error('Число отсканированных вещей превышает подтверждённое количество этого варианта.')
    }
    usedByVariant.set(variantId, next)
    statements.push(db.prepare(
      `INSERT INTO inventory_outbound_unit_scans
        (operation_id,unit_id,token,variant_id,operation_type,from_source,to_source,
         from_status,from_coverage,actor,occurred_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(operationId,row.unit_id,token,variantId,mode,fromSource,toSource,
      row.unit_status,row.coverage_status,actor.slice(0,120),at))
  }
  return statements
}
