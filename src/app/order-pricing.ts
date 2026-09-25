import type { CatalogResponse, OrderItem, Payment } from './types'
import { canonicalCatalogProductKey, canonicalStockPositionValue, normalizeSuggestion } from './utils'

export type CatalogOrderPriceResolution =
  | {
      status: 'matched'
      productId: number
      stockPositionId: number
      category: 'adult' | 'child'
      salePrice: number
      catalogPriceSnapshot: number
    }
  | {
      status: 'product_missing' | 'price_missing' | 'ambiguous'
      productId: number | null
      stockPositionId: number | null
      category: 'adult' | 'child'
      salePrice: null
      catalogPriceSnapshot: null
    }

function orderAudiencePriceCategory(item: Pick<OrderItem, 'audienceType'>): 'adult' | 'child' {
  return normalizeSuggestion(item.audienceType).includes('ДЕТ') ? 'child' : 'adult'
}

function resolveCatalogProductId(catalog: CatalogResponse, productName: unknown) {
  const key = canonicalCatalogProductKey(productName)
  if (!key) return null

  const direct = (catalog.products || []).find(product => product.isActive && canonicalCatalogProductKey(product.name) === key)
  if (direct?.id) return direct.id

  const alias = (catalog.productAliases || []).find(row => canonicalCatalogProductKey(row.rawValue) === key)
  if (!alias?.productId) return null
  return (catalog.products || []).some(product => product.id === alias.productId && product.isActive)
    ? alias.productId
    : null
}

export function resolveCatalogOrderSalePrice(
  catalog: CatalogResponse | null | undefined,
  item: Pick<OrderItem, 'productName' | 'audienceType' | 'material' | 'length'>,
): CatalogOrderPriceResolution {
  const category = orderAudiencePriceCategory(item)
  if (!catalog) {
    return { status: 'product_missing', productId: null, stockPositionId: null, category, salePrice: null, catalogPriceSnapshot: null }
  }

  const productId = resolveCatalogProductId(catalog, item.productName)
  if (!productId) {
    return { status: 'product_missing', productId: null, stockPositionId: null, category, salePrice: null, catalogPriceSnapshot: null }
  }

  const material = canonicalStockPositionValue(item.material)
  const length = canonicalStockPositionValue(item.length)
  const matches = (catalog.executionPrices || []).filter(price =>
    price.productId === productId
    && price.category === category
    && canonicalStockPositionValue(price.material) === material
    && canonicalStockPositionValue(price.length) === length
  )

  if (!matches.length || matches.every(price => price.salePrice == null)) {
    return { status: 'price_missing', productId, stockPositionId: matches[0]?.stockPositionId || null, category, salePrice: null, catalogPriceSnapshot: null }
  }

  const pricedMatches = matches.filter(price => price.salePrice != null)
  const distinct = new Set(pricedMatches.map(price => Number(price.salePrice)))
  if (distinct.size !== 1 || pricedMatches.some(price => !Number.isSafeInteger(Number(price.salePrice)) || Number(price.salePrice) < 0)) {
    return { status: 'ambiguous', productId, stockPositionId: null, category, salePrice: null, catalogPriceSnapshot: null }
  }

  const winner = pricedMatches[0]
  const salePrice = Number(winner.salePrice)
  return {
    status: 'matched',
    productId,
    stockPositionId: winner.stockPositionId,
    category,
    salePrice,
    catalogPriceSnapshot: salePrice,
  }
}


export type ItemizedCreatePricingBlocker = {
  code:
    | 'empty_items'
    | 'invalid_quantity'
    | 'price_confirmation_required'
    | 'missing_unit_price'
    | 'invalid_unit_price'
    | 'invalid_catalog_snapshot'
    | 'invalid_payment'
    | 'overpayment'
  itemIndex?: number
  paymentIndex?: number
}

export type ItemizedCreatePricingReadiness = {
  status: 'ready' | 'blocked'
  pricingMode: 'itemized_v1'
  lines: Array<{
    itemIndex: number
    quantity: number
    unitPrice: number
    lineTotal: number
    catalogPriceSnapshot: number | null
  }>
  totalAmount: number | null
  receivedAmount: number
  debtAmount: number | null
  overpaymentAmount: number | null
  blockers: ItemizedCreatePricingBlocker[]
}

export function evaluateItemizedCreatePricing(
  items: readonly OrderItem[],
  payments: readonly Pick<Payment, 'method' | 'amount'>[],
): ItemizedCreatePricingReadiness {
  const blockers: ItemizedCreatePricingBlocker[] = []
  const activeItems = items
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item }) => String(item?.productName || '').trim())

  if (!activeItems.length) blockers.push({ code: 'empty_items' })

  const lines: ItemizedCreatePricingReadiness['lines'] = []
  for (const { item, itemIndex } of activeItems) {
    const quantity = Number(item?.quantity ?? 1)
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      blockers.push({ code: 'invalid_quantity', itemIndex })
      continue
    }

    if (item?.priceNeedsConfirmation) {
      blockers.push({ code: 'price_confirmation_required', itemIndex })
      continue
    }

    const rawFinalPrice = item?.unitPrice
    if (rawFinalPrice === undefined || rawFinalPrice === null || String(rawFinalPrice).trim() === '') {
      blockers.push({ code: 'missing_unit_price', itemIndex })
      continue
    }
    const finalPrice = Number(rawFinalPrice)
    if (!Number.isSafeInteger(finalPrice) || finalPrice < 0) {
      blockers.push({ code: 'invalid_unit_price', itemIndex })
      continue
    }

    const rawSnapshot = item?.catalogPriceSnapshot
    const snapshot = rawSnapshot === undefined || rawSnapshot === null || String(rawSnapshot).trim() === ''
      ? null
      : Number(rawSnapshot)
    if (snapshot !== null && (!Number.isSafeInteger(snapshot) || snapshot < 0)) {
      blockers.push({ code: 'invalid_catalog_snapshot', itemIndex })
      continue
    }

    const lineTotal = quantity * finalPrice
    if (!Number.isSafeInteger(lineTotal) || lineTotal < 0) {
      blockers.push({ code: 'invalid_unit_price', itemIndex })
      continue
    }

    lines.push({
      itemIndex,
      quantity,
      unitPrice: finalPrice,
      lineTotal,
      catalogPriceSnapshot: snapshot,
    })
  }

  let receivedAmount = 0
  payments.forEach((payment, paymentIndex) => {
    const rawAmount = payment?.amount
    const amount = Number(rawAmount || 0)
    const method = String(payment?.method || '').trim()
    if (!Number.isFinite(amount) || !Number.isSafeInteger(amount) || amount < 0 || (amount > 0 && !method)) {
      blockers.push({ code: 'invalid_payment', paymentIndex })
      return
    }
    if (amount > 0 && method) {
      const nextReceived = receivedAmount + amount
      if (!Number.isSafeInteger(nextReceived)) {
        blockers.push({ code: 'invalid_payment', paymentIndex })
        return
      }
      receivedAmount = nextReceived
    }
  })

  const itemPricingBlocked = blockers.some(blocker => blocker.code !== 'invalid_payment' && blocker.code !== 'overpayment')
  let totalAmount: number | null = null
  let debtAmount: number | null = null
  let overpaymentAmount: number | null = null
  if (!itemPricingBlocked && lines.length === activeItems.length && activeItems.length > 0) {
    let sum = 0
    for (const line of lines) {
      sum += line.lineTotal
      if (!Number.isSafeInteger(sum)) {
        blockers.push({ code: 'invalid_unit_price', itemIndex: line.itemIndex })
        sum = -1
        break
      }
    }
    if (sum >= 0) {
      totalAmount = sum
      debtAmount = Math.max(0, totalAmount - receivedAmount)
      overpaymentAmount = Math.max(0, receivedAmount - totalAmount)
      if (overpaymentAmount > 0) blockers.push({ code: 'overpayment' })
    }
  }

  return {
    status: blockers.length ? 'blocked' : 'ready',
    pricingMode: 'itemized_v1',
    lines,
    totalAmount,
    receivedAmount,
    debtAmount,
    overpaymentAmount,
    blockers,
  }
}
