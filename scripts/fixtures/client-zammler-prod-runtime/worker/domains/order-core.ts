// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, normalizeCatalogCategory, normalizeDate, normalizeOrderItemSourceType, toInt, upperText } from '../core/text.ts'
import type { InventoryItemInput, OrderInput, PaymentKind, SourceType } from '../core/types.ts'
import { createCatalogCombinationV3, ensureCatalogExecutionV3, findCatalogProductByIdentity, isCatalogIdentityV3Enabled, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize } from './catalog.ts'
import { normalizePaymentKind } from './money.ts'

export function calculateTotals(items: OrderInput['items'], payments: OrderInput['payments'], totalOverride?: number | string) {
  const itemsTotal = (items || []).reduce((sum, item) => {
    const quantity = Math.max(0, toInt(item?.quantity, 1));
    const unitPrice = Math.max(0, toInt(item?.unitPrice, 0));
    return sum + quantity * unitPrice;
  }, 0);

  const totalReceived = (payments || []).reduce((sum, payment) => sum + Math.max(0, toInt(payment?.amount, 0)), 0);
  const manualTotal = totalOverride === undefined || totalOverride === null || totalOverride === ''
    ? null
    : Math.max(0, toInt(totalOverride, 0));
  const totalAmount = manualTotal !== null && Number.isFinite(manualTotal) && manualTotal > 0
    ? manualTotal
    : itemsTotal;

  return {
    totalAmount,
    receivedAmount: totalReceived,
    debtAmount: Math.max(0, totalAmount - totalReceived),
  };
}


export async function completedOrderOperationCounts(db: D1Database, orderId: number) {
  const row = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM returns r WHERE r.order_id = ? AND COALESCE(r.status, 'completed') <> 'cancelled') AS return_count,
       (SELECT COUNT(*) FROM exchanges e WHERE e.order_id = ? AND COALESCE(e.status, 'completed') <> 'cancelled') AS exchange_count`
  ).bind(orderId, orderId).first<Record<string, unknown>>();
  return {
    returns: Math.max(0, toInt(row?.return_count, 0)),
    exchanges: Math.max(0, toInt(row?.exchange_count, 0)),
  };
}


export class OrderInputValidationError extends Error {
  readonly status = 400
  readonly code = 'order_input_invalid'

  constructor(message: string) {
    super(message)
    this.name = 'OrderInputValidationError'
  }
}


export function assertOrderItemInputs(items: OrderInput['items']) {
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    if (!upperText(item?.productName)) continue
    const quantity = Number(item?.quantity ?? 1)
    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1) {
      throw new OrderInputValidationError(`Количество в позиции ${index + 1} должно быть целым числом от 1.`)
    }
  }
}

export function assertOrderTotalInput(value: unknown) {
  if (value === undefined || value === null || cleanText(value) === '') return
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) {
    throw new OrderInputValidationError('Цена заказа должна быть числом от 0.')
  }
}


export function normalizeOrderItems(items: OrderInput['items'], fallbackSource: SourceType) {
  return (Array.isArray(items) ? items : [])
    .map((item, inputIndex) => {
      const quantity = Math.max(1, toInt(item?.quantity, 1));
      const unitPrice = Math.max(0, toInt(item?.unitPrice, 0));
      const lineTotal = quantity * unitPrice;
      const itemSource = normalizeOrderItemSourceType(item?.sourceType || fallbackSource, fallbackSource);
      const category = normalizeAudienceCategory(item?.audienceType, item?.size);
      return {
        productName: upperText(item?.productName),
        category,
        audienceType: category === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ',
        gender: upperText(item?.gender),
        color: upperText(item?.color),
        material: canonicalStockPositionValue(item?.material),
        length: canonicalStockPositionValue(item?.length),
        size: cleanText(item?.size),
        quantity,
        unitPrice,
        lineTotal,
        sourceType: itemSource,
        inventorySource: itemSource === 'boutique' ? 'boutique' : 'warehouse' as SourceType,
        isWorkshop: itemSource === 'workshop',
        workshopComment: cleanText(item?.workshopComment),
        workshopUrgent: Boolean(item?.workshopUrgent),
        workshopDueDate: cleanText(item?.workshopDueDate) ? normalizeDate(item?.workshopDueDate) : '',
        observedPhysicalQuantity: item?.observedPhysicalQuantity === null || item?.observedPhysicalQuantity === undefined || cleanText(item?.observedPhysicalQuantity) === ''
          ? null
          : Number(item?.observedPhysicalQuantity),
        shortageAcknowledged: Boolean(item?.shortageAcknowledged),
        inputIndex,
      };
    })
    .filter(item => item.productName);
}


export function assertOrderPaymentInputs(payments: OrderInput['payments']) {
  for (const [index, payment] of (Array.isArray(payments) ? payments : []).entries()) {
    const rawAmount = payment?.amount
    const hasRawAmount = rawAmount !== undefined && rawAmount !== null && cleanText(rawAmount) !== ''
    const amount = hasRawAmount ? Number(rawAmount) : 0
    const method = cleanText(payment?.method)
    if (hasRawAmount && !Number.isFinite(amount)) {
      throw new OrderInputValidationError(`В оплате ${index + 1} указана некорректная сумма.`)
    }
    if (amount < 0) {
      throw new OrderInputValidationError(`Сумма в оплате ${index + 1} не может быть отрицательной.`)
    }
    if (amount > 0 && !method) {
      throw new OrderInputValidationError(`В оплате ${index + 1} указана сумма ${Math.trunc(amount)}, но не выбран способ оплаты.`)
    }
    if (method && amount <= 0) {
      throw new OrderInputValidationError(`Для оплаты ${index + 1} выберите сумму больше нуля или очистите способ оплаты.`)
    }
  }
}


export function normalizeOrderPayments(payments: OrderInput['payments'], fallbackDate: string) {
  return (Array.isArray(payments) ? payments : [])
    .map(payment => ({
      paymentDate: normalizeDate(payment?.paymentDate || fallbackDate),
      method: upperText(payment?.method),
      amount: Math.max(0, toInt(payment?.amount, 0)),
      paymentKind: normalizePaymentKind(payment?.paymentKind) as PaymentKind,
      comment: cleanText(payment?.comment),
    }))
    .filter(payment => payment.method && payment.amount > 0);
}


export function sameOrderItemForEdit(
  left: ReturnType<typeof normalizeOrderItems>[number],
  right: ReturnType<typeof normalizeOrderItems>[number],
) {
  return left.productName === right.productName
    && left.audienceType === right.audienceType
    && left.gender === right.gender
    && left.color === right.color
    && left.material === right.material
    && left.length === right.length
    && left.size === right.size
    && left.quantity === right.quantity
    && left.unitPrice === right.unitPrice
    && left.sourceType === right.sourceType
    && left.isWorkshop === right.isWorkshop
    && left.workshopComment === right.workshopComment
    && Boolean(left.workshopUrgent) === Boolean(right.workshopUrgent)
    && (left.workshopDueDate || '') === (right.workshopDueDate || '');
}


export function sameOrderPaymentForEdit(
  left: ReturnType<typeof normalizeOrderPayments>[number],
  right: ReturnType<typeof normalizeOrderPayments>[number],
) {
  return left.paymentDate === right.paymentDate
    && left.method === right.method
    && left.amount === right.amount
    && left.paymentKind === right.paymentKind
    && left.comment === right.comment;
}


export function sameNormalizedOrderItemsForEdit(
  left: ReturnType<typeof normalizeOrderItems>,
  right: ReturnType<typeof normalizeOrderItems>,
) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => sameOrderItemForEdit(item, right[index]));
}


export function sameNormalizedOrderPaymentsForEdit(
  left: ReturnType<typeof normalizeOrderPayments>,
  right: ReturnType<typeof normalizeOrderPayments>,
) {
  if (left.length !== right.length) return false;
  return left.every((payment, index) => sameOrderPaymentForEdit(payment, right[index]));
}


export function normalizeInventoryItem(item: InventoryItemInput) {
  const gender = upperText(item?.gender);
  const size = cleanText(item?.size);
  const category = normalizeAudienceCategory(item?.category || gender, size);
  return {
    productId: toInt(item?.productId, 0),
    variantId: toInt(item?.variantId, 0),
    productName: upperText(item?.productName),
    category,
    gender,
    color: upperText(item?.color),
    material: canonicalStockPositionValue(item?.material),
    length: canonicalStockPositionValue(item?.length),
    size,
    quantity: Math.max(0, toInt(item?.quantity, 0)),
    expectedQuantity: item?.expectedQuantity === undefined || item?.expectedQuantity === null || item?.expectedQuantity === ''
      ? null
      : toInt(item.expectedQuantity, 0),
    observedPhysicalQuantity: item?.observedPhysicalQuantity === undefined || item?.observedPhysicalQuantity === null || item?.observedPhysicalQuantity === ''
      ? null
      : toInt(item.observedPhysicalQuantity, 0),
  };
}


export function inventoryMergeKey(item: ReturnType<typeof normalizeInventoryItem>) {
  return [
    item.productId || 0,
    item.variantId || 0,
    item.productName,
    item.category,
    item.gender,
    item.color,
    item.material,
    item.length,
    item.size,
  ].join('¦');
}


export function mergeInventoryItems(items: ReturnType<typeof normalizeInventoryItem>[]) {
  const map = new Map<string, ReturnType<typeof normalizeInventoryItem>>();
  for (const item of items) {
    if (!item.quantity) continue;
    const key = inventoryMergeKey(item);
    const existing = map.get(key);
    if (existing) {
      if (existing.observedPhysicalQuantity !== item.observedPhysicalQuantity || existing.expectedQuantity !== item.expectedQuantity) {
        throw new Error(`Для «${item.productName || 'позиции'}» переданы противоречивые данные фактической сверки. Оставьте одну строку комбинации.`);
      }
      existing.quantity += item.quantity;
    } else {
      map.set(key, { ...item });
    }
  }
  return Array.from(map.values());
}


export function inventoryWhereKey(item: ReturnType<typeof normalizeInventoryItem>) {
  return {
    productName: item.productName,
    gender: item.gender || null,
    color: item.color || null,
    material: item.material || null,
    length: item.length || null,
    size: item.size || null,
  };
}


export type InventoryResolvedItem = {
  productId: number | null;
  variantId: number | null;
  productName: string;
  category: 'adult' | 'child';
  gender: string | null;
  color: string | null;
  material: string | null;
  length: string | null;
  size: string | null;
  quantity: number;
  expectedQuantity: number | null;
};


export async function resolveInventoryItem(db: D1Database, item: ReturnType<typeof normalizeInventoryItem>): Promise<InventoryResolvedItem> {
  if (item.variantId > 0) {
    const row = await db.prepare(
      `SELECT
        v.id AS variant_id, v.product_id, p.name AS product_name,
        COALESCE(v.category, p.category, 'adult') AS category,
        v.gender, v.color, v.material, v.length, v.size_label
       FROM catalog_variants v
       JOIN catalog_products p ON p.id = v.product_id
       WHERE v.id = ?
       LIMIT 1`
    ).bind(item.variantId).first<Record<string, unknown>>();

    if (row) {
      return {
        productId: toInt(row.product_id, 0) || null,
        variantId: toInt(row.variant_id, 0) || null,
        productName: upperText(row.product_name),
        category: normalizeCatalogCategory(row.category) as 'adult' | 'child',
        gender: upperText(row.gender) || null,
        color: upperText(row.color) || null,
        material: canonicalStockPositionValue(row.material),
        length: canonicalStockPositionValue(row.length),
        size: cleanText(row.size_label) || null,
        quantity: item.quantity,
        expectedQuantity: item.expectedQuantity,
      };
    }
  }

  const key = inventoryWhereKey(item);
  if (!key.productName) {
    throw new Error('Product is required for inventory operation.');
  }

  const category = normalizeAudienceCategory(item.category, key.size) as 'adult' | 'child';
  let product = item.productId > 0
    ? await db.prepare('SELECT id, name, category FROM catalog_products WHERE id = ? LIMIT 1')
      .bind(item.productId)
      .first<{ id: number; name: string; category: string }>()
    : null;

  if (!product) {
    product = await findCatalogProductByIdentity(db, key.productName) as { id: number; name: string; category: string } | null;
  }

  const now = new Date().toISOString();
  let productId = toInt(product?.id, 0);
  let productName = product?.name ? upperText(product.name) : key.productName;

  if (!productId) {
    const productExternalId = `AUTO-PROD-${Date.now().toString(36).toUpperCase()}-${Math.abs(key.productName.length)}`;
    const created = await db.prepare(
      `INSERT INTO catalog_products (name, category, is_active, created_at, updated_at, external_id)
       VALUES (?, ?, 1, ?, ?, ?)`
    ).bind(key.productName, category, now, now, productExternalId).run();
    productId = Number(created.meta?.last_row_id || 0);
    productName = key.productName;
  }

  if (await isCatalogIdentityV3Enabled(db)) {
    const execution = await ensureCatalogExecutionV3(db, productId, key.material, key.length, now);
    const combination = await createCatalogCombinationV3(db, {
      productId,
      executionId: execution.id,
      category,
      gender: key.gender,
      color: key.color,
      material: execution.material,
      length: execution.length,
      sizeLabel: key.size,
      externalId: makeVariantExternalId(productName, category, key.gender || '', key.color || '', execution.material, execution.length, key.size || ''),
    }, now);
    return {
      productId,
      variantId: combination.id || null,
      productName,
      category,
      gender: normalizeCatalogCombinationGender(key.gender) || null,
      color: normalizeCatalogCombinationColor(key.color) || null,
      material: execution.material,
      length: execution.length,
      size: normalizeCatalogCombinationSize(key.size) || null,
      quantity: item.quantity,
      expectedQuantity: item.expectedQuantity,
    };
  }

  let variant = await db.prepare(
    `SELECT id FROM catalog_variants
     WHERE product_id = ?
       AND COALESCE(category, 'adult') = COALESCE(?, 'adult')
       AND COALESCE(gender, '') = COALESCE(?, '')
       AND COALESCE(color, '') = COALESCE(?, '')
       AND COALESCE(NULLIF(UPPER(TRIM(material)), ''), 'СТАНДАРТ') = COALESCE(NULLIF(UPPER(TRIM(?)), ''), 'СТАНДАРТ')
       AND COALESCE(NULLIF(UPPER(TRIM(length)), ''), 'СТАНДАРТ') = COALESCE(NULLIF(UPPER(TRIM(?)), ''), 'СТАНДАРТ')
       AND COALESCE(size_label, '') = COALESCE(?, '')
     LIMIT 1`
  ).bind(productId, category, key.gender, key.color, key.material, key.length, key.size).first<{ id: number }>();

  if (!variant?.id) {
    const externalId = makeVariantExternalId(productName, category, key.gender || '', key.color || '', key.material || '', key.length || '', key.size || '');
    try {
      const createdVariant = await db.prepare(
        `INSERT INTO catalog_variants (
          product_id, external_id, category, gender, color, material, length, size_label, is_active, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
      ).bind(productId, externalId, category, key.gender, key.color, key.material, key.length, key.size, now, now).run();
      variant = { id: Number(createdVariant.meta?.last_row_id || 0) };
    } catch (error) {
      // Если такой вариант успел появиться параллельно или есть старый уникальный индекс,
      // перечитываем его и продолжаем операцию, а не валим приход/списание.
      variant = await db.prepare(
        `SELECT id FROM catalog_variants
         WHERE product_id = ?
           AND COALESCE(category, 'adult') = COALESCE(?, 'adult')
           AND COALESCE(gender, '') = COALESCE(?, '')
           AND COALESCE(color, '') = COALESCE(?, '')
           AND COALESCE(NULLIF(UPPER(TRIM(material)), ''), 'СТАНДАРТ') = COALESCE(NULLIF(UPPER(TRIM(?)), ''), 'СТАНДАРТ')
           AND COALESCE(NULLIF(UPPER(TRIM(length)), ''), 'СТАНДАРТ') = COALESCE(NULLIF(UPPER(TRIM(?)), ''), 'СТАНДАРТ')
           AND COALESCE(size_label, '') = COALESCE(?, '')
         LIMIT 1`
      ).bind(productId, category, key.gender, key.color, key.material, key.length, key.size).first<{ id: number }>();
      if (!variant?.id) throw error;
    }
  }

  return {
    productId,
    variantId: variant?.id || null,
    productName,
    category,
    gender: key.gender,
    color: key.color,
    material: key.material,
    length: key.length,
    size: key.size,
    quantity: item.quantity,
    expectedQuantity: item.expectedQuantity,
  };
}
