import { skuBarcodeForVariantId, variantIdFromSkuBarcode } from '../../shared/barcode-sku.ts'

type SkuBarcodeRow = {
  id: number
  product_id: number
  product_name: string
  category: string | null
  gender: string | null
  color: string | null
  material: string | null
  length: string | null
  size_label: string | null
  variant_active: number
  product_active: number
  execution_active: number | null
}

export async function readCatalogSkuBarcode(db: D1Database, variantId: number) {
  if (!Number.isSafeInteger(variantId) || variantId <= 0) {
    return { ok: false, code: 'invalid_sku', message: 'Неверный идентификатор SKU.' }
  }
  const row = await db.prepare(
    'SELECT v.id, v.product_id, p.name AS product_name, v.category, v.gender, v.color, ' +
    'v.material, v.length, v.size_label, v.is_active AS variant_active, ' +
    'p.is_active AS product_active, sp.is_active AS execution_active ' +
    'FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id ' +
    'LEFT JOIN catalog_stock_positions sp ON sp.id=v.stock_position_id ' +
    'WHERE v.id=? LIMIT 1'
  ).bind(variantId).first<SkuBarcodeRow>()
  if (!row) return { ok: false, code: 'sku_not_found', message: 'SKU не найден.' }
  const active = Number(row.variant_active) === 1 && Number(row.product_active) === 1 &&
    (row.execution_active === null || Number(row.execution_active) === 1)
  return {
    ok: true,
    barcodeType: 'sku' as const,
    barcode: skuBarcodeForVariantId(variantId),
    variantId,
    productId: Number(row.product_id),
    productName: row.product_name,
    category: row.category || '',
    gender: row.gender || '',
    color: row.color || '',
    material: row.material || '',
    length: row.length || '',
    size: row.size_label || '',
    active,
    status: active ? 'active' : 'retired',
    physicalUnit: false,
  }
}

export async function lookupCatalogSkuBarcode(db: D1Database, value: string) {
  const variantId = variantIdFromSkuBarcode(value)
  if (!variantId) return { ok: false, code: 'invalid_barcode', message: 'Штрихкод SKU не распознан или повреждён.' }
  return readCatalogSkuBarcode(db, variantId)
}
