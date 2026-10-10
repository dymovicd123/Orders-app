// Resolve stale order/arrival drafts using the CURRENT audited generation of each exact-SKU consolidation.
// No catalog resurrection, new variant creation or physical stock mutation.
type VariantIdentity = { id: number; product_id: number; is_active: number }
type ConsolidationIdentity = { source_variant_id: number; target_variant_id: number; product_id: number }

export async function resolveConsolidatedOrderWriteVariant(
  db: D1Database,
  productId: number | null,
  variantId: number | null,
) {
  if (!variantId) return { productId, variantId, redirected: false }
  if (!Number.isSafeInteger(variantId) || variantId <= 0
    || !productId || !Number.isSafeInteger(productId) || productId <= 0) {
    throw new Error('Позиция заказа содержит неверную ссылку на каталог. Обновите выбор товара.')
  }
  const originalId = variantId
  let current = variantId
  const visited = new Set<number>()
  // Capped to fail closed if an old catalog had an unexpected alias loop.
  for (let hop = 0; hop < 12; hop++) {
    if (visited.has(current)) {
      throw new Error('Обнаружена циклическая история объединений. Обратитесь к администратору.')
    }
    visited.add(current)
    const variant = await db.prepare(
      'SELECT id,product_id,is_active FROM catalog_variants WHERE id=?'
    ).bind(current).first<VariantIdentity>()
    if (!variant || variant.product_id !== productId) {
      throw new Error('Старая позиция заказа не совпадает с товаром каталога. Обновите выбор.')
    }
    if (variant.is_active === 1) {
      if (hop > 0) {
        return {productId,variantId:current,redirected:true,originalVariantId:originalId}
      }
      return {productId,variantId:current,redirected:false}
    }
    const merge = await db.prepare(
      'SELECT source_variant_id,target_variant_id,product_id FROM catalog_variant_effective_merge_lineage WHERE source_variant_id=?'
    ).bind(current).first<ConsolidationIdentity>()
    if (!merge || merge.source_variant_id !== current || merge.product_id !== productId
      || !Number.isSafeInteger(merge.target_variant_id) || merge.target_variant_id <= 0) {
      throw new Error('Вариант был отключён, но безопасного объединения нет. Выберите действующий вариант заново.')
    }
    current = merge.target_variant_id
  }
  throw new Error('История объединений слишком длинная. Нужна проверка каталога администратором.')
}
