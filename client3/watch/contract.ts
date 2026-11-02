/**
 * Client3-only watch business contract.
 * This deliberately does not use the clothing resolver, or mutate legacy
 * catalog/stock/order schemas. Integration into the isolated Worker comes after
 * exact SKU uniqueness and brand-scoped database migrations are accepted.
 */
export const WATCH_BRANDS = ['TAUWACH', 'WACHIZEN'] as const
export type WatchBrand = typeof WATCH_BRANDS[number]

export const WATCH_SOURCES = ['office', 'showcase'] as const
export type WatchSource = typeof WATCH_SOURCES[number]
export type CanonicalStockSource = 'warehouse' | 'boutique'

export const WATCH_GENDERS = ['male', 'female'] as const
export type WatchGender = typeof WATCH_GENDERS[number]
export const WATCH_MECHANISMS = ['quartz', 'mechanical'] as const
export type WatchMechanism = typeof WATCH_MECHANISMS[number]
export const WATCH_BRACELET_MATERIALS = ['steel', 'leather', 'rubber'] as const
export type WatchBraceletMaterial = typeof WATCH_BRACELET_MATERIALS[number]
export const WATCH_DIAL_COLORS = [
  'black', 'white', 'silver', 'gold', 'green', 'orange', 'brown', 'combined',
] as const
export type WatchDialColor = typeof WATCH_DIAL_COLORS[number]
export const WATCH_PAYMENT_METHODS = ['KASPI RED', 'KASPI GOLD', 'Рассрочка'] as const

export interface WatchVariantInput {
  brand: WatchBrand
  modelName: string
  gender: WatchGender
  mechanism: WatchMechanism
  braceletMaterial: WatchBraceletMaterial
  dialColor: WatchDialColor
  /** Required for leather; not a separate SKU dimension for steel/rubber yet. */
  braceletColor?: string | null
}
export interface WatchVariantIdentity extends WatchVariantInput {
  modelName: string
  braceletColor: string | null
  skuKey: string
}

function inList<const T extends readonly string[]>(value: unknown, options: T, label: string): T[number] {
  if (typeof value !== 'string' || !options.includes(value)) {
    throw new Error(`Недопустимое значение «${label}».`)
  }
  return value as T[number]
}
function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}
function canonicalText(value: unknown): string {
  return cleanText(value).toLocaleUpperCase('ru-RU')
}

/**
 * Brand, model, gender, mechanism, material, DIAL color and leather BRACELET
 * color all participate in identity. Never hide mechanism/color in size/length.
 */
export function identifyWatchVariant(input: WatchVariantInput): WatchVariantIdentity {
  const brand = inList(input.brand, WATCH_BRANDS, 'Бренд')
  const modelName = cleanText(input.modelName)
  if (!modelName) throw new Error('Укажите название модели часов.')
  const gender = inList(input.gender, WATCH_GENDERS, 'Пол')
  const mechanism = inList(input.mechanism, WATCH_MECHANISMS, 'Механизм')
  const braceletMaterial = inList(input.braceletMaterial, WATCH_BRACELET_MATERIALS, 'Материал браслета')
  const dialColor = inList(input.dialColor, WATCH_DIAL_COLORS, 'Цвет циферблата')
  const rawBraceletColor = cleanText(input.braceletColor)
  if (braceletMaterial === 'leather' && !rawBraceletColor) {
    throw new Error('Для кожаного ремешка обязательно укажите цвет ремешка.')
  }
  if (braceletMaterial !== 'leather' && rawBraceletColor) {
    throw new Error('Пока отдельный цвет браслета учитывается только для кожаного ремешка. Остальное укажите логисту.')
  }
  const braceletColor = rawBraceletColor || null
  const skuKey = JSON.stringify([
    brand, canonicalText(modelName), gender, mechanism, braceletMaterial,
    dialColor, canonicalText(braceletColor),
  ])
  return { brand, modelName, gender, mechanism, braceletMaterial, dialColor, braceletColor, skuKey }
}

export function toCanonicalWatchStockSource(source: WatchSource): CanonicalStockSource {
  if (source === 'office') return 'warehouse'
  if (source === 'showcase') return 'boutique'
  throw new Error('Доступны только Офис и Витрина.')
}

export function toVisibleWatchSource(source: CanonicalStockSource): 'Офис' | 'Витрина' {
  if (source === 'warehouse') return 'Офис'
  if (source === 'boutique') return 'Витрина'
  throw new Error('Неизвестный источник учёта часов.')
}

export interface WatchDelivery {
  recipientFullName: string
  recipientPhone: string
  fullAddress: string
  postalIndex: string
  city: string
  deliveryType: string
}
export function validateWatchDelivery(input: WatchDelivery): WatchDelivery {
  const output = {
    recipientFullName: cleanText(input.recipientFullName),
    recipientPhone: cleanText(input.recipientPhone),
    fullAddress: cleanText(input.fullAddress),
    postalIndex: cleanText(input.postalIndex),
    city: cleanText(input.city),
    deliveryType: cleanText(input.deliveryType),
  }
  if (!output.recipientFullName || !output.recipientPhone || !output.city || !output.deliveryType) {
    throw new Error('Логисту нужны ФИО, номер, город и способ доставки.')
  }
  // Keep Main delivery types as maintained reference values; don't invent new ones.
  if (output.deliveryType.toLocaleUpperCase('ru-RU') !== 'САМОВЫВОЗ'
      && (!output.fullAddress || !output.postalIndex)) {
    throw new Error('Для доставки укажите полный адрес и почтовый индекс.')
  }
  return output
}

export interface WatchDispatchDeadline {
  urgent: boolean
  /** Local Kazakhstan business time, e.g. 2026-10-15T17:00. */
  dueLocal: string | null
  timeZone: 'Asia/Almaty'
}
export function validateWatchDeadline(urgent: boolean, dueLocal: unknown): WatchDispatchDeadline {
  const due = cleanText(dueLocal)
  if (urgent && !due) throw new Error('Для срочного заказа укажите дату и точное время отправки.')
  if (due) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(due)) {
      throw new Error('Укажите дату и время отправки в формате ГГГГ-ММ-ДД ЧЧ:ММ.')
    }
    const [year, month, day, hour, minute] = due.match(/\d+/g)!.map(Number)
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month
        || date.getUTCDate() !== day || date.getUTCHours() !== hour
        || date.getUTCMinutes() !== minute) {
      throw new Error('Укажите существующую дату и корректное время.')
    }
  }
  // Store local wall time with explicit IANA zone: conversion to absolute
  // timestamp is a separate Worker boundary, not Date.parse(local) on clients.
  return { urgent: Boolean(urgent), dueLocal: due || null, timeZone: 'Asia/Almaty' }
}

export interface WatchOrderLineDraft {
  variant: WatchVariantInput
  quantity: number
  engravingText: string
}
export function normalizeWatchOrderLine(input: WatchOrderLineDraft) {
  const variant = identifyWatchVariant(input.variant)
  const quantity = Number(input.quantity)
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Количество часов должно быть положительным целым числом.')
  const engravingText = cleanText(input.engravingText)
  if (engravingText.length > 1000) throw new Error('Комментарий логисту слишком длинный.')
  return { variant, quantity, engravingText }
}
