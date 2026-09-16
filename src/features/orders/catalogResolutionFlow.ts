import type { CatalogResolutionContext, CatalogResolutionInput, CatalogResolutionProduct } from '../../../shared/api-contracts'

export type Draft = CatalogResolutionInput & { productName: string; genderScope: 'female' | 'male' | 'unisex' | ''; createProduct: boolean }
export type Field = 'category' | 'gender' | 'material' | 'length' | 'color' | 'size'
export const fields: Field[] = ['category', 'gender', 'material', 'length', 'color', 'size']
export const labels: Record<Field, string> = { category: 'Тип', gender: 'Пол', material: 'Материал', length: 'Длина', color: 'Цвет', size: 'Размер / возраст' }
export const clean = (v: unknown) => String(v ?? '').trim()
export const normalize = (v: unknown) => clean(v).toUpperCase().replace(/\s+/g, ' ')
const identity = (v: unknown) => normalize(v).replace(/[^0-9A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]+/g, ' ').trim()
export function compoundRemainder(rawName: string, productName: string) {
  const rawTokens = identity(rawName).split(' ')
  const productTokens = identity(productName).split(' ')
  if (!identity(productName)) return ''
  for (let start = 0; start <= rawTokens.length - productTokens.length; start++) {
    if (productTokens.every((token, offset) => rawTokens[start + offset] === token)) {
      return [...rawTokens.slice(0, start), ...rawTokens.slice(start + productTokens.length)].join(' ')
    }
  }
  return ''
}
export function rankedProducts(products: CatalogResolutionProduct[], source: string) {
  const raw = identity(source)
  return products.map(product => {
    const name = identity(product.name)
    const embedded = (` ${raw} `).includes(` ${name} `)
    const overlap = name.split(' ').filter(token => token.length > 2 && raw.split(' ').includes(token)).length
    return { product, score: raw === name ? 10000 : embedded ? 5000 + name.length : overlap * 100 }
  }).sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'ru'))
}
export function initialDraft(source: Partial<Record<Field, string>> & { productName: string }, context: CatalogResolutionContext): Draft {
  const f = context.facts
  return {
    productId: context.product?.id || 0, productName: source.productName, createProduct: false,
    genderScope: context.product?.genderScope || '',
    category: f?.category || 'adult', gender: f?.gender || '',
    material: f?.material || '', length: f?.length || '',
    // Normalized placeholders are not evidence that the person supplied these facts.
    color: clean(source.color) ? f?.color || source.color! : '',
    size: clean(source.size) ? f?.size || source.size! : '',
  }
}
export function referenceValues(context: CatalogResolutionContext, draft: Draft, field: Field) {
  const refs = context.references
  if (field === 'material') return refs?.materials || []
  if (field === 'length') return refs?.lengths || []
  if (field === 'color') return refs?.colors || []
  if (field === 'size') return (draft.category === 'child' ? refs?.childAges : refs?.sizes) || []
  return []
}
export function needsReference(context: CatalogResolutionContext, draft: Draft, field: Field) {
  if (field === 'category' || field === 'gender' || !clean(draft[field])) return false
  if ((field === 'material' || field === 'length') && normalize(draft[field]) === 'СТАНДАРТ') return false
  if (field === 'size' && ['БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р'].includes(normalize(draft[field]))) return false
  return !referenceValues(context, draft, field).some(v => normalize(v) === normalize(draft[field]))
}
export type Question = { kind: 'product' | 'compound' | 'combined' | 'ready' | 'workshop' | 'legacy' } | { kind: 'field' | 'reference'; field: Field }
export function nextQuestion(context: CatalogResolutionContext, draft: Draft, options: {
  remainder: string; classified: boolean; confirmed: Partial<Record<Field, boolean>>; legacy: boolean; editing?: Field | null
}): Question {
  if (!draft.productId && !draft.createProduct) return { kind: 'product' }
  if (context.isWorkshop) return { kind: 'workshop' }
  if (options.remainder && !options.classified) return { kind: 'compound' }
  if (options.editing) return { kind: 'field', field: options.editing }
  // A just-classified value is the next decision, before switching to unrelated facts.
  for (const field of fields) {
    if (options.confirmed[field] && needsReference(context, draft, field) && !draft.createFields?.includes(field) && !context.exactVariant) return { kind: 'reference', field }
  }
  for (const field of fields) {
    if (field === 'gender' && options.legacy) continue
    const missing = field === 'gender' ? !['ЖЕН', 'МУЖ'].includes(normalize(draft.gender))
      : field === 'category' ? (context.unknownFields || []).includes(field) && !options.confirmed[field]
      : !clean(draft[field])
    if (missing) {
      if (field === 'color' && !draft.size && context.exactVariant
        && normalize(context.exactVariant.facts.color) === 'БЕЗ ЦВЕТА'
        && ['', 'БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р'].includes(normalize(context.exactVariant.facts.size))) return { kind: 'combined' }
      return { kind: 'field', field }
    }
    if (!context.exactVariant && needsReference(context, draft, field) && !draft.createFields?.includes(field)) return { kind: 'reference', field }
  }
  return { kind: options.legacy ? 'legacy' : 'ready' }
}

// One owner per modal session. Re-check failure can be retried without replaying the write.
export function createResolutionSession() {
  let locked = false, completed = false, changed = false
  return {
    get changed() { return changed },
    async run(write: (() => Promise<void>) | null, recheck: () => Promise<boolean>, complete: () => Promise<void>) {
      if (locked || completed) return
      locked = true
      try {
        if (write) { await write(); changed = true }
        if (await recheck() && changed && !completed) { completed = true; await complete() }
      } finally { locked = false }
    },
  }
}
