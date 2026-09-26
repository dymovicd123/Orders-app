import type { CatalogResolutionContext, CatalogResolutionInput, CatalogResolutionProduct } from '../../../shared/api-contracts'

export type Draft = CatalogResolutionInput & { productName: string; genderScope: 'female' | 'male' | 'unisex' | ''; createProduct: boolean }
export type Field = 'category' | 'gender' | 'material' | 'length' | 'color' | 'size'
export const fields: Field[] = ['category', 'gender', 'material', 'length', 'color', 'size']
export const labels: Record<Field, string> = { category: 'Тип', gender: 'Пол', material: 'Материал', length: 'Длина', color: 'Цвет', size: 'Размер / возраст' }
export function fieldLabel(field: Field, category?: string) {
  if (field !== 'size') return labels[field]
  if (category === 'child') return 'Возраст'
  if (category === 'adult') return 'Размер'
  return labels[field]
}
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
  const compactRaw = raw.replace(/\s+/g, '')
  return products.map(product => {
    const name = identity(product.name)
    const nameTokens = name.split(' ').filter(Boolean)
    const compactName = name.replace(/\s+/g, '')
    const exact = raw === name
    const nameStarts = Boolean(raw) && name.startsWith(raw)
    const tokenStarts = Boolean(raw) && nameTokens.some(token => token.startsWith(raw))
    const compactContains = compactRaw.length >= 2 && compactName.includes(compactRaw)
    const embedded = Boolean(name) && (` ${raw} `).includes(` ${name} `)
    const exactTokenOverlap = nameTokens.filter(token => token.length > 1 && rawTokens.includes(token)).length
    const prefixTokenOverlap = rawTokens.filter(query => query.length > 0 && nameTokens.some(token => token.startsWith(query))).length
    const allQueryTokensMatch = rawTokens.length > 0 && prefixTokenOverlap === rawTokens.length
    const fuzzyLimit = Math.max(raw.length, name.length) >= 8 ? 2 : 1
    const distances = [
      typoDistance(raw, name, fuzzyLimit),
      ...rawTokens.map(query => Math.min(...nameTokens.map(token => typoDistance(query, token, fuzzyLimit)))),
    ].filter(Number.isFinite)
    const distance = distances.length ? Math.min(...distances) : fuzzyLimit + 1
    const fuzzy = raw.length >= 4 && name.length >= 4 && distance <= fuzzyLimit
    const score = exact ? 10000
      : nameStarts ? 9000 + Math.min(raw.length, 500)
        : tokenStarts ? 8200 + Math.min(raw.length, 500)
          : allQueryTokensMatch ? 7600 + prefixTokenOverlap * 100
            : compactContains ? 6800 + Math.min(compactRaw.length, 500)
              : embedded ? 5600 + name.length
                : exactTokenOverlap ? 3000 + exactTokenOverlap * 200
                  : prefixTokenOverlap ? 2200 + prefixTokenOverlap * 120
                    : fuzzy ? 1200 - distance * 100
                      : 0
    return { product, score }
  }).sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'ru'))
}

export type RankedReferenceValue = { value: string; score: number; distance: number | null; fuzzy: boolean }
export function rankedReferenceValues(values: string[], source: string, field: Field): RankedReferenceValue[] {
  const raw = identity(source)
  const compactRaw = raw.replace(/\s+/g, '')
  const fuzzyAllowed = field === 'material' || field === 'color' || field === 'length'
  return values.map(value => {
    const candidate = identity(value)
    const compactCandidate = candidate.replace(/\s+/g, '')
    const exact = Boolean(raw) && raw === candidate
    const starts = Boolean(raw) && candidate.startsWith(raw)
    const contains = compactRaw.length >= 2 && compactCandidate.includes(compactRaw)
    const reverseContains = compactCandidate.length >= 2 && compactRaw.includes(compactCandidate)
    const fuzzyLimit = Math.max(raw.length, candidate.length) >= 9 ? 2 : 1
    const distance = fuzzyAllowed && raw.length >= 4 && candidate.length >= 4 ? typoDistance(raw, candidate, fuzzyLimit) : fuzzyLimit + 1
    const fuzzy = fuzzyAllowed && distance <= fuzzyLimit
    const score = exact ? 10000
      : starts ? 8200 + Math.min(raw.length, 500)
        : contains ? 7200 + Math.min(compactRaw.length, 500)
          : reverseContains ? 6500 + Math.min(compactCandidate.length, 500)
            : fuzzy ? 5600 - distance * 300
              : 0
    return { value, score, distance: fuzzyAllowed ? distance : null, fuzzy }
  }).sort((a, b) => b.score - a.score || a.value.localeCompare(b.value, 'ru'))
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

export type CompoundSegment = { field: Exclude<Field, 'category' | 'gender'>; value: string; start: number; end: number }
export function segmentCompoundRemainder(remainder: string, context: CatalogResolutionContext, draft: Draft) {
  const tokens = identity(remainder).split(' ').filter(Boolean)
  if (!tokens.length) return { segments: [] as CompoundSegment[], unknown: '', complete: false }
  const candidates: CompoundSegment[] = []
  const segmentFields: Array<Exclude<Field, 'category' | 'gender'>> = ['material', 'color', 'length', 'size']
  for (const field of segmentFields) {
    for (const value of referenceValues(context, draft, field)) {
      const normalized = identity(value)
      if (!normalized || normalized === 'СТАНДАРТ' || normalized === 'БЕЗ ЦВЕТА' || normalized === 'БЕЗ РАЗМЕРА') continue
      const valueTokens = normalized.split(' ').filter(Boolean)
      if (!valueTokens.length) continue
      for (let start = 0; start <= tokens.length - valueTokens.length; start++) {
        if (valueTokens.every((token, offset) => tokens[start + offset] === token)) {
          candidates.push({ field, value, start, end: start + valueTokens.length })
        }
      }
    }
  }
  candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start || segmentFields.indexOf(a.field) - segmentFields.indexOf(b.field))
  const used = new Set<number>()
  const segments: CompoundSegment[] = []
  for (const candidate of candidates) {
    let overlaps = false
    for (let index = candidate.start; index < candidate.end; index++) if (used.has(index)) overlaps = true
    if (overlaps) continue
    segments.push(candidate)
    for (let index = candidate.start; index < candidate.end; index++) used.add(index)
  }
  segments.sort((a, b) => a.start - b.start)
  const unknown = tokens.filter((_, index) => !used.has(index)).join(' ')
  return { segments, unknown, complete: segments.length > 0 && !unknown }
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
    const needsCorrection = (context.unknownFields || []).includes(field) && !options.confirmed[field]
    const missing = field === 'gender' ? !['ЖЕН', 'МУЖ'].includes(normalize(draft.gender))
      : field === 'category' ? needsCorrection
      : !clean(draft[field])
    if (needsCorrection || missing) {
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
