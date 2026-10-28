// Resolve only a unique, full catalog-model name. A substring is a suggestion,
// never permission to silently create a KPI for a different model.
export function normalizeKpiProductName(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('ru-RU')
}

export function findUniqueExactKpiProduct<T extends { name: string }>(
  products: readonly T[],
  entered: string,
): T | undefined {
  const name = normalizeKpiProductName(entered)
  if (!name) return undefined
  let match: T | undefined
  for (const product of products) {
    if (normalizeKpiProductName(product.name) !== name) continue
    if (match) return undefined // Duplicates are ambiguous; require an explicit choice.
    match = product
  }
  return match
}
