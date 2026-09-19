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
const typoDistance = (left: string, right: string, limit = 2) => {
  if (left === right) return 0
  if (!left || !right || Math.abs(left.length - right.length) > limit) return limit + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i++) {
    const current = [i]
    let rowMin = current[0]
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1))
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > limit) return limit + 1
    previous = current
  }
  return previous[right.length]
}
export function rankedProducts(products: CatalogResolutionProduct[], source: string) {
  const raw = identity(source)
  const rawTokens = raw.split(' ').filter(Boolean)
  return products.map(product => {
    const name = identity(product.name)
    const nameTokens = name.split(' ').filter(Boolean)
    const embedded = raw && (` ${raw} `).includes(` ${name} `)
    const startsWithQuery = Boolean(raw && name.startsWith(raw))
    const tokenPrefix = Boolean(raw && nameTokens.some(token => token.startsWith(raw)))
    const substring = Boolean(raw.length >= 2 && name.includes(raw))
    const overlap = nameTokens.filter(token => token.length > 2 && rawTokens.includes(token)).length
    const partialOverlap = rawTokens.filter(rawToken => rawToken.length >= 2 && nameTokens.some(token => token.startsWith(rawToken) || rawToken.startsWith(token))).length
    const fuzzyLimit = Math.max(raw.length, name.length) >= 8 ? 2 : 1
    const distance = raw
      ? Math.min(
          typoDistance(raw, name, fuzzyLimit),
          ...rawTokens.map(token => typoDistance(token, name, fuzzyLimit)),
          ...rawTokens.flatMap(rawToken => nameTokens.map(token => typoDistance(rawToken, token, fuzzyLimit))),
        )
      : fuzzyLimit + 1
    const fuzzy = raw.length >= 3 && name.length >= 3 && distance <= fuzzyLimit
    const score = raw === name ? 10000
      : embedded ? 8500 + name.length
        : startsWithQuery ? 7600 - Math.min(500, Math.max(0, name.length - raw.length))
          : tokenPrefix ? 7000 - Math.min(500, Math.max(0, name.length - raw.length))
            : substring ? 6200 - Math.min(500, Math.max(0, name.length - raw.length))
              : overlap ? 5000 + overlap * 250
                : partialOverlap ? 3500 + partialOverlap * 200
                  : fuzzy ? 2500 - distance * 250
                    : 0
    return { product, score }
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
    async run(write: (() => Promise<void>) | null, recheck: () => Promise<boolean>, complete: () => Promise<void | boolean>) {
      if (locked || completed) return
      locked = true
      try {
        if (write) { await write(); changed = true }
        if (await recheck() && changed && !completed) {
          const completion = await complete()
          if (completion !== false) completed = true
        }
      } finally { locked = false }
    },
  }
}
