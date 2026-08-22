import type { AccessRole, AppSector, CatalogVariantRecord, EditorDraft, EditorItem, EditorPayment, ExchangeDraft, InventoryDraftItem, InventoryMatrixDraft, OrderItem, OrderPeriodPreset, OrderRecord, Payment, ReturnDraft, SmartPickerRank, WorkshopTaskRecord } from './types'

export function normalizeAccessRole(value: unknown): AccessRole {
  const text = String(value || '').trim().toLowerCase()
  return text === 'admin' || text === 'админ' ? 'admin' : 'manager'
}



export const money = new Intl.NumberFormat('ru-RU')


export const shortDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})




export function escapeHtmlText(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}



export function formatMoney(value: number) {
  return money.format(Number(value || 0))
}



export function formatPercent(value: number) {
  const numeric = Number(value || 0)
  return `${Math.round(numeric * 1000) / 10}%`
}



export function formatDateShort(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return '—'
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) {
    return text
  }
  return shortDateFormatter.format(parsed)
}



export function formatLocalDateInput(value = new Date()) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}



export function shiftLocalDate(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return formatLocalDateInput(date)
}



export function getPeriodRange(preset: OrderPeriodPreset) {
  const today = formatLocalDateInput()
  const now = new Date()
  if (preset === 'today') return { dateFrom: today, dateTo: today }
  if (preset === 'yesterday') {
    const yesterday = shiftLocalDate(-1)
    return { dateFrom: yesterday, dateTo: yesterday }
  }
  if (preset === 'year') {
    return {
      dateFrom: `${now.getFullYear()}-01-01`,
      dateTo: `${now.getFullYear()}-12-31`,
    }
  }
  if (preset === 'month') {
    return {
      dateFrom: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
      dateTo: today,
    }
  }
  return {
    dateFrom: '',
    dateTo: '',
  }
}



export function getClosedArchiveMonth() {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  const value = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`
  return {
    value,
    dateFrom: `${value}-01`,
    dateTo: formatLocalDateInput(monthEnd),
    label: monthStart.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
  }
}



export function monthEndFromInput(value: string) {
  const [yearText, monthText] = String(value || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (!year || !month) return getClosedArchiveMonth().dateTo
  return formatLocalDateInput(new Date(year, month, 0))
}



export function monthStartFromInput(value: string) {
  const [yearText, monthText] = String(value || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (!year || !month) return getClosedArchiveMonth().dateFrom
  return `${year}-${String(month).padStart(2, '0')}-01`
}



export function monthLabelFromInput(value: string) {
  const [yearText, monthText] = String(value || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (!year || !month) return getClosedArchiveMonth().label
  return new Date(year, month - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}



export function sourceLabel(source: string) {
  if (source === 'workshop') return 'Цех'
  return source === 'boutique' ? 'Бутик' : 'Склад'
}



export function normalizeSuggestion(value: unknown) {
  return String(value ?? '').trim().toUpperCase()
}



export function canonicalCatalogProductKey(value: unknown) {
  return normalizeSearchText(value)
    .replace(/[^A-ZА-ЯЁ0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}



export function canonicalStockPositionValue(value: unknown) {
  return normalizeSuggestion(value) || 'СТАНДАРТ'
}



export function stockPositionDisplayName(productName: unknown, material: unknown, length: unknown) {
  const title = String(productName ?? '').trim() || 'Без названия'
  const canonicalMaterial = canonicalStockPositionValue(material)
  const canonicalLength = canonicalStockPositionValue(length)
  return [
    title,
    canonicalMaterial === 'СТАНДАРТ' ? '' : canonicalMaterial,
    canonicalLength === 'СТАНДАРТ' ? '' : canonicalLength,
  ].filter(Boolean).join(' ')
}



export function htmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;')
}



export function normalizeSearchText(value: unknown) {
  const text = String(value ?? '').trim()
  const map: Record<string, string> = {
    қ: 'к',
    Қ: 'К',
    ғ: 'г',
    Ғ: 'Г',
    ң: 'н',
    Ң: 'Н',
    ә: 'а',
    Ә: 'А',
    ё: 'е',
    Ё: 'Е',
    ы: 'и',
    Ы: 'И',
    і: 'и',
    І: 'И',
    ү: 'у',
    Ү: 'У',
    ұ: 'у',
    Ұ: 'У',
    у: 'у',
    У: 'У',
    о: 'о',
    О: 'О',
    ө: 'о',
    Ө: 'О',
    һ: 'х',
    Һ: 'Х',
  }
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split('')
    .map((char) => map[char] ?? char)
    .join('')
    .toUpperCase()
}



export function rankSmartPickerOption(option: string, search: string, searchTokens: string[]): SmartPickerRank {
  const normalized = normalizeSearchText(option)
  const words = normalized.split(/\s+/).filter(Boolean)

  if (!search) return { matched: true, score: 100, position: 0 }
  if (!normalized) return { matched: false, score: 999, position: Number.MAX_SAFE_INTEGER }

  if (normalized === search) return { matched: true, score: 0, position: 0 }
  if (normalized.startsWith(search)) return { matched: true, score: 1, position: 0 }

  const wordStartIndex = words.findIndex((word) => word.startsWith(search))
  if (wordStartIndex >= 0) return { matched: true, score: 2, position: wordStartIndex }

  const position = normalized.indexOf(search)
  if (position >= 0) return { matched: true, score: 3, position }

  if (searchTokens.length && searchTokens.every((token) => normalized.includes(token))) {
    return { matched: true, score: 4, position: Math.min(...searchTokens.map((token) => normalized.indexOf(token)).filter((value) => value >= 0)) }
  }

  if (searchTokens.length && searchTokens.some((token) => token.length >= 2 && normalized.includes(token))) {
    return { matched: true, score: 5, position: Math.min(...searchTokens.map((token) => normalized.indexOf(token)).filter((value) => value >= 0)) }
  }

  return { matched: false, score: 999, position: Number.MAX_SAFE_INTEGER }
}




export function extractFirstNumber(value: unknown) {
  const match = String(value ?? '').match(/\d+/)
  return match ? Number(match[0]) : NaN
}



export function isLikelyChildAgeValue(value: unknown) {
  const text = normalizeSuggestion(value)
  if (!text) return false
  const number = extractFirstNumber(text)
  if (!Number.isFinite(number)) return /ЛЕТ|ГОД|МЕС|AGE/.test(text)
  if (/^\d{1,2}\s*[-–—/]\s*\d{1,2}$/.test(text)) return number > 0 && number <= 18
  return number > 0 && number <= 18
}



export function isLikelyAdultSizeValue(value: unknown) {
  const text = normalizeSuggestion(value)
  if (!text) return false
  const number = extractFirstNumber(text)
  if (!Number.isFinite(number)) return true
  return number >= 30
}



export function sortSizeLikeValues(values: string[]) {
  return [...values].sort((a, b) => {
    const aNum = extractFirstNumber(a)
    const bNum = extractFirstNumber(b)
    if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return aNum - bNum
    return String(a).localeCompare(String(b), 'ru', { numeric: true })
  })
}



export function normalizeAudienceTypeValue(value: unknown): 'ВЗРОСЛЫЙ' | 'ДЕТСКИЙ' {
  const text = normalizeSuggestion(value)
  if (text === 'CHILD' || text === 'ДЕТСКИЙ' || text.includes('ДЕТ')) return 'ДЕТСКИЙ'
  if (text === 'ADULT' || text === 'ВЗРОСЛЫЙ' || text.includes('ВЗРОС')) return 'ВЗРОСЛЫЙ'
  return 'ВЗРОСЛЫЙ'
}



export function inferProductCategoryFromVariants(
  explicitCategory: unknown,
  variants: Array<{ sizeLabel?: unknown; size?: unknown }> = [],
): 'adult' | 'child' {
  const normalizedCategory = normalizeSuggestion(explicitCategory)
  if (normalizedCategory === 'CHILD' || normalizedCategory === 'ДЕТСКИЙ' || normalizedCategory.includes('ДЕТ')) return 'child'
  const meaningfulSizes = variants.map((variant) => variant.sizeLabel ?? variant.size).filter((value) => normalizeSuggestion(value))
  const childSized = meaningfulSizes.filter(isLikelyChildAgeValue).length
  const adultSized = meaningfulSizes.filter(isLikelyAdultSizeValue).length
  if (childSized > 0 && adultSized === 0) return 'child'
  return 'adult'
}



export function productCategoryLabel(category: 'adult' | 'child') {
  return category === 'child' ? 'Детский' : 'Взрослый'
}



export function getVariantCategoryFromFields(category: unknown, gender: unknown, size: unknown): 'adult' | 'child' {
  const normalizedCategory = normalizeSuggestion(category)
  const normalizedGender = normalizeSuggestion(gender)
  if (normalizedCategory === 'CHILD' || normalizedCategory === 'ДЕТСКИЙ' || normalizedCategory.includes('ДЕТ')) return 'child'
  if (normalizedGender.includes('ДЕТ')) return 'child'
  if (isLikelyChildAgeValue(size) && !isLikelyAdultSizeValue(size)) return 'child'
  return 'adult'
}



export function getCatalogVariantCategory(variant: Pick<CatalogVariantRecord, 'productCategory' | 'gender' | 'sizeLabel'>): 'adult' | 'child' {
  return getVariantCategoryFromFields(variant.productCategory, variant.gender, variant.sizeLabel)
}



export function calculateTotals(
  _items: Array<Pick<OrderItem, 'quantity' | 'unitPrice'>>,
  payments: Array<Pick<Payment, 'amount' | 'method'>>,
  totalOverride?: number | string,
) {
  // Step 08: цена живёт на уровне заказа, а не в каждой товарной строке.
  // Позиции нужны для склада/цеха, но не участвуют в расчёте суммы заказа.
  const manualTotal = totalOverride === undefined || totalOverride === null || totalOverride === ''
    ? null
    : Math.max(0, Number(totalOverride))

  const receivedAmount = (payments || []).reduce((sum, payment) => String(payment.method || '').trim() ? sum + Math.max(0, Number(payment.amount || 0)) : sum, 0)
  const calculatedTotal = manualTotal !== null && Number.isFinite(manualTotal) && manualTotal > 0
    ? manualTotal
    : 0

  return {
    totalAmount: calculatedTotal,
    receivedAmount,
    debtAmount: Math.max(0, calculatedTotal - receivedAmount),
  }
}



export class ApiResponseError extends Error {
  readonly status: number
  readonly transient: boolean

  constructor(message: string, options: { status?: number; transient?: boolean } = {}) {
    super(message)
    this.name = 'ApiResponseError'
    this.status = Number(options.status || 0)
    this.transient = Boolean(options.transient)
  }
}

export function isTransientApiError(error: unknown) {
  if (error instanceof ApiResponseError) return error.transient
  if (error instanceof TypeError) return true
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase()
  return message.includes('временно')
    || message.includes('сеть')
    || message.includes('network')
    || message.includes('html вместо json')
    || message.includes('пустой ответ')
    || message.includes('недоступ')
}

export async function readJsonResponse<T extends object = Record<string, unknown>>(response: Response, context: string): Promise<T> {
  const bodyText = await response.text()
  const trimmed = bodyText.replace(/^\uFEFF/, '').trim()
  const transientStatus = response.status === 408
    || response.status === 425
    || response.status === 429
    || response.status >= 500

  if (!trimmed) {
    throw new ApiResponseError(`${context}: сервер временно вернул пустой ответ.`, {
      status: response.status,
      transient: transientStatus || response.ok,
    })
  }

  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    const preview = trimmed.slice(0, 160).replace(/\s+/g, ' ')
    const lowerPreview = preview.toLowerCase()
    const looksLikeHtml = lowerPreview.startsWith('<!doctype')
      || lowerPreview.startsWith('<html')
      || lowerPreview.includes('<body')
    throw new ApiResponseError(
      looksLikeHtml
        ? `${context}: сервер временно вернул служебную HTML-страницу вместо данных.`
        : `${context}: сервер вернул повреждённый ответ.`,
      { status: response.status, transient: looksLikeHtml || transientStatus },
    )
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiResponseError(`${context}: сервер вернул ответ неожиданного формата.`, {
      status: response.status,
      transient: transientStatus,
    })
  }

  if (!response.ok) {
    const message = typeof data === 'object' && data && 'message' in data
      ? String((data as { message?: unknown }).message || '')
      : ''
    throw new ApiResponseError(message || `${context}: сервер вернул ошибку ${response.status}.`, {
      status: response.status,
      transient: transientStatus,
    })
  }

  return data as T
}




export function workshopAudienceLabel(task: Pick<WorkshopTaskRecord, 'audienceType' | 'gender' | 'size'>) {
  const audience = normalizeSuggestion(task.audienceType)
  const gender = normalizeSuggestion(task.gender)
  if (audience === 'CHILD' || audience === 'ДЕТСКИЙ' || audience.includes('ДЕТ') || gender.includes('ДЕТ')) return 'Детский'
  if (isLikelyChildAgeValue(task.size) && !isLikelyAdultSizeValue(task.size)) return 'Детский'
  return 'Взрослый'
}



export function workshopCustomerIdentity(task: Pick<WorkshopTaskRecord, 'customerName' | 'customerPhone'>) {
  const name = String(task.customerName || '').trim()
  const phone = String(task.customerPhone || '').trim()
  const sameValue = name && phone && normalizeSuggestion(name) === normalizeSuggestion(phone)
  return {
    primary: name || phone || '—',
    secondary: name && phone && !sameValue ? phone : '',
  }
}



export function workshopDetailRows(task: WorkshopTaskRecord) {
  return [
    { label: 'Тип', value: workshopAudienceLabel(task) },
    { label: 'Пол', value: task.gender || 'Не указано' },
    { label: 'Цвет', value: task.color || 'Не указано' },
    { label: 'Материал', value: task.material || 'Не указано' },
    { label: 'Длина', value: task.length || 'Не указано' },
    { label: workshopAudienceLabel(task) === 'Детский' ? 'Возраст' : 'Размер', value: task.size || 'Не указано' },
  ]
}



export function workshopInvoiceProductTitle(task: WorkshopTaskRecord) {
  const values = [
    task.productName,
    task.gender,
    task.material,
    task.length,
    workshopAudienceLabel(task),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  const seen = new Set<string>()
  return values.filter((value) => {
    const normalized = normalizeSuggestion(value)
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  }).join(' · ')
}



export function workshopInvoiceCharacteristics(task: WorkshopTaskRecord) {
  return [
    { label: 'Цвет', value: task.color || 'Не указано' },
    { label: workshopAudienceLabel(task) === 'Детский' ? 'Возраст' : 'Размер', value: task.size || 'Не указано' },
  ]
    .map((detail) => `${detail.label}: ${detail.value}`)
    .join(' · ')
}



export function formatOrderItemDetails(item: Pick<OrderItem, 'audienceType' | 'gender' | 'color' | 'material' | 'length' | 'size'> | Pick<OrderRecord['items'][number], 'audienceType' | 'gender' | 'color' | 'material' | 'length' | 'size'>) {
  const audienceType = 'audienceType' in item ? normalizeSuggestion(item.audienceType) : ''
  const gender = normalizeSuggestion(item.gender)
  const normalizedGender = gender === 'МУЖ' || gender === 'ЖЕН' ? gender : ''
  const normalizedType = audienceType === 'ДЕТСКИЙ' || gender === 'ДЕТСКИЙ' ? 'ДЕТСКИЙ' : ''

  return [normalizedType, normalizedGender, item.color, item.material, item.length, item.size]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' · ')
}



export function formatOrderItemTitle(item: Pick<OrderItem, 'productName' | 'audienceType' | 'gender' | 'color' | 'material' | 'length' | 'size'> | Pick<OrderRecord['items'][number], 'productName' | 'audienceType' | 'gender' | 'color' | 'material' | 'length' | 'size'>) {
  const title = String(item.productName || '').trim()
  const details = formatOrderItemDetails(item)
  return details ? `${title} · ${details}` : title
}



export function paymentKindLabel(kind: string) {
  if (kind === 'debt_close') return 'Долг'
  if (kind === 'extra') return 'Доплата'
  return 'Первичная'
}



export function resolvePaymentKind(payment: EditorPayment, _index: number): EditorPayment['paymentKind'] {
  if (payment.paymentKind === 'primary' || payment.paymentKind === 'debt_close' || payment.paymentKind === 'extra') {
    return payment.paymentKind
  }
  return 'primary'
}



export function workshopItemIsReady(status: unknown, fallbackOrderStatus?: unknown) {
  const itemStatus = String(status || '').trim().toLowerCase()
  if (itemStatus === 'ready' || itemStatus === 'done' || itemStatus === 'shipped') return true
  if (itemStatus) return false

  const orderStatus = String(fallbackOrderStatus || '').trim().toLowerCase()
  return orderStatus === 'ready' || orderStatus === 'done' || orderStatus === 'shipped'
}



export function summarizeOrderItemLines(items: OrderRecord['items'], maxVisible = 3, fallbackWorkshopStatus?: string) {
  const lines = items.slice(0, maxVisible).map((item) => {
    const isWorkshop = Boolean(item.isWorkshop || normalizeSuggestion(item.sourceType) === 'WORKSHOP')
    const productName = String(item.productName || '').trim() || 'Без названия'
    const details = formatOrderItemDetails(item)
    return {
      productName,
      details,
      title: details ? `${productName} · ${details}` : productName,
      source: sourceLabel(isWorkshop ? 'workshop' : item.sourceType),
      quantity: Math.max(0, Number(item.quantity || 0)),
      isWorkshop,
      workshopReady: isWorkshop ? workshopItemIsReady(item.workshopTaskStatus, fallbackWorkshopStatus) : false,
    }
  })
  const rest = Math.max(0, items.length - lines.length)
  return { lines, rest }
}



export function summarizeOrderPaymentLines(payments: OrderRecord['payments'], maxVisible = 2) {
  const lines = payments.slice(0, maxVisible).map((payment) => ({
    title: `${payment.paymentDate || '—'} · ${payment.method || '—'}`,
    meta: `${paymentKindLabel(payment.paymentKind)} · ${formatMoney(payment.amount)}`,
  }))
  const rest = Math.max(0, payments.length - lines.length)
  return { lines, rest }
}




export function isArchivedOrderRecord(order?: OrderRecord | null) {
  return (order?.order_status || '').toLowerCase() === 'archived'
}



export function isReturnedOrderRecord(order?: Pick<OrderRecord, 'return_amount'> | null) {
  return Number(order?.return_amount || 0) > 0
}



export function statusLabelByState(orderStatus: string, workshopStatus: string, debtAmount: number, receivedAmount: number, returnAmount: number) {
  if (orderStatus === 'archived') return 'Архив'
  if (orderStatus === 'deleted') return 'Удалён'
  if (returnAmount > 0) return 'Возврат'
  if (workshopStatus === 'ready') return 'Готово'
  if (workshopStatus === 'shipped') return 'Отгружен'
  if (debtAmount <= 0) return 'Оплачено'
  if (receivedAmount > 0) return 'Частично'
  return 'Долг'
}



export function paymentStatusLabel(order: Pick<OrderRecord, 'debt_amount' | 'received_amount' | 'total_amount'>) {
  const debt = Number(order.debt_amount || 0)
  const received = Number(order.received_amount || 0)
  if (debt <= 0 && received > 0) return 'Оплачено'
  if (received > 0) return 'Частично оплачено'
  return 'Не оплачено'
}



export function paymentStatusClass(order: Pick<OrderRecord, 'debt_amount' | 'received_amount'>) {
  const debt = Number(order.debt_amount || 0)
  const received = Number(order.received_amount || 0)
  if (debt <= 0 && received > 0) return 'status-online'
  if (received > 0) return 'status-warning'
  return 'status-offline'
}



export function shippingStatusLabel(order: Pick<OrderRecord, 'shipping_status'>) {
  return order.shipping_status === 'sent' ? 'Отправлен' : 'Не отправлен'
}



export function waitingDaysLabel(order: Pick<OrderRecord, 'order_date' | 'shipping_status' | 'shipping_date'>) {
  if (order.shipping_status === 'sent') {
    return order.shipping_date ? `отправлен ${formatDateShort(order.shipping_date)}` : 'отправлен'
  }
  const parsed = new Date(String(order.order_date || ''))
  if (Number.isNaN(parsed.getTime())) return 'ожидает отправки'
  const today = new Date(formatLocalDateInput())
  const days = Math.max(0, Math.floor((today.getTime() - parsed.getTime()) / 86400000))
  if (days === 0) return 'ждёт 0 дней'
  if (days === 1) return 'ждёт 1 день'
  if (days >= 2 && days <= 4) return `ждёт ${days} дня`
  return `ждёт ${days} дней`
}



export function orderLifecycleLabel(order: Pick<OrderRecord, 'order_status' | 'return_amount'>) {
  if (order.order_status === 'archived') return 'Архив'
  if (order.order_status === 'deleted') return 'Удалён'
  if (Number(order.return_amount || 0) > 0) return 'Возвращён'
  if (order.order_status === 'closed') return 'Закрыт'
  return 'Активен'
}



export function createEmptyEditorItem(): EditorItem {
  return {
    productName: '',
    audienceType: 'ВЗРОСЛЫЙ',
    gender: '',
    color: '',
    material: 'СТАНДАРТ',
    length: 'СТАНДАРТ',
    size: '',
    quantity: 1,
    unitPrice: 0,
    sourceType: 'warehouse',
    workshopComment: '',
    workshopUrgent: false,
    workshopDueDate: '',
  }
}



export function createEmptyEditorPayment(orderDate = formatLocalDateInput()): EditorPayment {
  return {
    paymentDate: orderDate,
    method: '',
    amount: 0,
    paymentKind: 'primary',
    comment: '',
  }
}



export function createDebtClosePayment(orderDate = formatLocalDateInput(), amount = 0): EditorPayment {
  return {
    paymentDate: orderDate,
    method: '',
    amount,
    paymentKind: 'debt_close',
    comment: '',
  }
}



export function createReturnDraft(order?: OrderRecord | null): ReturnDraft {
  const refundableAmount = Math.max(
    0,
    Number(order?.received_amount || 0) - Number(order?.return_amount || 0),
  )
  return {
    returnDate: formatLocalDateInput(),
    amount: refundableAmount,
    paymentMethod: '',
    comment: '',
    restockSource: 'none',
    items: (order?.items || []).map((item) => ({
      orderItemId: Number(item.id || 0),
      productName: item.productName || 'Позиция',
      quantity: 0,
      maxQuantity: Math.max(1, Number(item.quantity || 1)),
      restock: item.sourceType !== 'workshop',
    })).filter((item) => item.orderItemId > 0),
  }
}



export function createExchangeDraft(order?: OrderRecord | null): ExchangeDraft {
  const firstItem = (order?.items || []).find((item) => Number(item.id || 0) > 0 && Number(item.quantity || 0) > 0)
  const inheritedSource = firstItem?.sourceType === 'workshop'
    ? 'workshop'
    : firstItem?.sourceType === 'boutique'
      ? 'boutique'
      : 'warehouse'
  return {
    orderId: order?.id || null,
    exchangeDate: formatLocalDateInput(),
    oldItemId: Number(firstItem?.id || 0),
    oldQuantity: 1,
    oldReturnSource: 'none',
    newItem: {
      ...createEmptyEditorItem(),
      sourceType: inheritedSource,
    },
    financialAction: 'none',
    financialAmount: 0,
    paymentMethod: '',
    comment: '',
    newSourceWasManuallyChanged: false,
  }
}



export function createEmptyOrderDraft(): EditorDraft {
  const today = formatLocalDateInput()
  return {
    orderDate: today,
    managerId: 0,
    managerName: '',
    customerPhone: '',
    customerName: '',
    city: '',
    deliveryType: '',
    sourceType: 'warehouse',
    orderTotal: '',
    workshopStatus: 'in_workshop',
    orderStatus: 'active',
    comment: '',
    items: [createEmptyEditorItem()],
    payments: [createEmptyEditorPayment(today)],
  }
}



export function deriveOrderSourceType(items: EditorItem[]): 'warehouse' | 'boutique' {
  const firstStockSource = (items || []).find((item) => item.sourceType === 'warehouse' || item.sourceType === 'boutique')?.sourceType
  return firstStockSource === 'boutique' ? 'boutique' : 'warehouse'
}



// Final release: no local demo orders. If API loading fails, the UI shows an error instead of fake rows.
export function sectorFromHash(hash: string): AppSector {
  switch (hash.replace('#', '')) {
    case 'references':
      return 'references'
    case 'finance':
    case 'finances':
      return 'finance'
    case 'clients':
    case 'customers':
      return 'clients'
    case 'inventory':
    case 'catalog':
      return 'inventory'
    case 'workshop':
      return 'workshop'
    case 'reports':
      return 'reports'
    case 'leads':
      return 'leads'
    case 'plan':
    case 'plans':
      return 'plan'
    case 'team':
    case 'timesheet':
      return 'team'
    case 'more':
    case 'tools':
    case 'technical':
      return 'inventory'
    case 'import':
    case 'transfer':
      return 'overview'
    case 'dashboard':
    case 'modules':
    case 'workspace-nav':
      return 'overview'
    case 'create':
    case 'editor':
    case 'details':
    case 'filters':
    case 'orders':
    default:
      return 'orders'
  }
}



export function createEmptyInventoryItem(): InventoryDraftItem {
  return {
    productId: '',
    variantId: '',
    productName: '',
    category: 'adult',
    gender: '',
    color: '',
    material: 'СТАНДАРТ',
    length: 'СТАНДАРТ',
    size: '',
    quantity: 1,
    touched: false,
  }
}



export function createEmptyInventoryMatrixDraft(): InventoryMatrixDraft {
  return {
    productId: '',
    productName: '',
    category: 'adult',
    gender: '',
    material: 'СТАНДАРТ',
    length: 'СТАНДАРТ',
    extraColors: [],
    extraSizes: [],
    ready: false,
  }
}



export function inventoryMatrixAxisLabel(value: string, kind: 'color' | 'size') {
  const clean = String(value || '').trim()
  if (clean) return clean
  return kind === 'color' ? 'БЕЗ ЦВЕТА' : 'БЕЗ РАЗМЕРА'
}



export function inventoryMatrixCellKey(size: string, color: string) {
  return `${normalizeSuggestion(size)}¦${normalizeSuggestion(color)}`
}



export function createEditorDraft(order: OrderRecord): EditorDraft {
  return {
    orderDate: order.order_date,
    managerId: Number(order.manager_id || 0),
    managerName: order.manager_name || '',
    customerPhone: order.customer_phone || '',
    customerName: order.customer_name || '',
    city: order.city || '',
    deliveryType: order.delivery_type || '',
    sourceType: order.source_type,
    workshopStatus: order.workshop_status as EditorDraft['workshopStatus'],
    orderStatus: order.order_status as EditorDraft['orderStatus'],
    comment: order.comment || '',
    items: order.items.length
        ? order.items.map((item) => ({
          productName: item.productName,
          audienceType: item.audienceType
            ? (normalizeSuggestion(item.audienceType).includes('ДЕТ') ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ')
            : (item.gender && normalizeSuggestion(item.gender).includes('ДЕТ') ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ'),
          gender: item.gender && normalizeSuggestion(item.gender).includes('ДЕТ') ? '' : (item.gender || ''),
          color: item.color || '',
          material: canonicalStockPositionValue(item.material),
          length: canonicalStockPositionValue(item.length),
          size: item.size || '',
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice || 0),
          sourceType: item.isWorkshop ? 'workshop' : (item.sourceType === 'boutique' ? 'boutique' : 'warehouse'),
          workshopComment: item.workshopComment || '',
          workshopUrgent: Boolean(item.workshopUrgent),
          workshopDueDate: item.workshopDueDate || '',
        }))
      : [createEmptyEditorItem()],
    payments: order.payments.length
      ? order.payments.map((payment) => ({
          paymentDate: payment.paymentDate,
          method: payment.method,
          amount: payment.amount,
          paymentKind: payment.paymentKind as EditorPayment['paymentKind'],
          comment: payment.comment || '',
        }))
      : [createEmptyEditorPayment(order.order_date)],
    orderTotal: String(order.total_amount || ''),
  }
}
