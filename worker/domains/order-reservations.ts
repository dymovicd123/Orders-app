// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { chunksOf } from '../core/sql.ts'
import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, normalizeShippingStatus, normalizeSourceType, normalizeWorkshopStatus, toInt, upperText } from '../core/text.ts'
import type { SourceType } from '../core/types.ts'
import { writeActivityLog } from './activity.ts'
import type { CanonicalVariantSnapshot } from './catalog.ts'
import { catalogReferenceDbValueExists, catalogReferenceValueExists, createCatalogCombinationV3, ensureCatalogExecutionV3, findCatalogCombinationV3, findCatalogExecutionV3, findCatalogProductByIdentity, isCatalogIdentityV3Enabled, isHumanInventoryModelEnabled, loadCanonicalVariantSnapshot, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, resolveCatalogValueAlias } from './catalog.ts'
import { inventoryPhysicalCheckStatement } from './inventory-primitives.ts'
import { normalizeOrderItems } from './order-core.ts'

export async function resolveCatalogProductAndVariantLegacy(
  db: D1Database,
  item: ReturnType<typeof normalizeOrderItems>[number],
  timestamp: string,
) {
  let product = await findCatalogProductByIdentity(db, item.productName) as { id: number; name: string; category: string } | null;

  if (!product?.id) {
    const productResult = await db.prepare(
      `INSERT INTO catalog_products (name, category, is_active, external_id, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`
    ).bind(
      item.productName,
      item.category,
      `AUTO-PROD-${makeVariantExternalId(item.productName, item.category, '', '', '', '', '')}`,
      timestamp,
      timestamp,
    ).run();
    product = {
      id: Number(productResult.meta?.last_row_id || 0),
      name: item.productName,
      category: item.category,
    };
  }

  const productId = Number(product?.id || 0);
  if (!productId) {
    throw new Error(`Не удалось создать товар в каталоге: ${item.productName}`);
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
  ).bind(
    productId,
    item.category,
    item.gender || null,
    item.color || null,
    item.material || null,
    item.length || null,
    item.size || null,
  ).first<{ id: number }>();

  if (!variant?.id) {
    const externalId = makeVariantExternalId(item.productName, item.category, item.gender, item.color, item.material, item.length, item.size);
    try {
      const variantResult = await db.prepare(
        `INSERT INTO catalog_variants (
          external_id, product_id, category, gender, color, material, length, size_label,
          is_active, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
      ).bind(
        externalId,
        productId,
        item.category,
        item.gender || null,
        item.color || null,
        item.material || null,
        item.length || null,
        item.size || null,
        timestamp,
        timestamp,
      ).run();
      variant = { id: Number(variantResult.meta?.last_row_id || 0) };
    } catch (error) {
      // A concurrent request may have created the same exact variant. Re-read it first.
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
      ).bind(
        productId,
        item.category,
        item.gender || null,
        item.color || null,
        item.material || null,
        item.length || null,
        item.size || null,
      ).first<{ id: number }>();

      if (!variant?.id) {
        const legacyConflict = await db.prepare(
          `SELECT id, COALESCE(category, 'adult') AS category
           FROM catalog_variants
           WHERE product_id = ?
             AND COALESCE(gender, '') = COALESCE(?, '')
             AND COALESCE(color, '') = COALESCE(?, '')
             AND COALESCE(NULLIF(UPPER(TRIM(material)), ''), 'СТАНДАРТ') = COALESCE(NULLIF(UPPER(TRIM(?)), ''), 'СТАНДАРТ')
             AND COALESCE(NULLIF(UPPER(TRIM(length)), ''), 'СТАНДАРТ') = COALESCE(NULLIF(UPPER(TRIM(?)), ''), 'СТАНДАРТ')
             AND COALESCE(size_label, '') = COALESCE(?, '')
           LIMIT 1`
        ).bind(
          productId,
          item.gender || null,
          item.color || null,
          item.material || null,
          item.length || null,
          item.size || null,
        ).first<{ id: number; category: string }>();
        if (legacyConflict?.id && cleanText(legacyConflict.category) !== cleanText(item.category)) {
          throw new Error('Каталог использует старое правило уникальности вариантов. Обновите схему каталога и повторите сохранение заказа.');
        }
        throw error;
      }
    }
  }

  return {
    productId,
    variantId: Number(variant?.id || 0) || null,
  };
}



export type ResolvedOrderCatalogReference = {
  productId: number | null;
  variantId: number | null;
  matchStatus?: 'matched' | 'alias' | 'created_combination' | 'unresolved_product' | 'unresolved_execution' | 'unresolved_attribute' | 'unresolved_variant';
  inputKey?: string;
};


export function catalogOrderInputKey(item: ReturnType<typeof normalizeOrderItems>[number]) {
  return [
    upperText(item.productName),
    cleanText(item.category).toLowerCase(),
    upperText(item.gender),
    upperText(item.color),
    canonicalStockPositionValue(item.material) || '',
    canonicalStockPositionValue(item.length) || '',
    upperText(item.size),
  ].join('¦');
}


export async function resolveCatalogProductAndVariantV2Flat(
  db: D1Database,
  item: ReturnType<typeof normalizeOrderItems>[number],
): Promise<ResolvedOrderCatalogReference> {
  const inputKey = catalogOrderInputKey(item);
  try {
    const alias = await db.prepare(
      `SELECT v.id AS variant_id, v.product_id
       FROM catalog_input_aliases a
       JOIN catalog_variants v ON v.id = a.variant_id
       JOIN catalog_products p ON p.id = v.product_id
       WHERE a.input_key = ? AND v.is_active = 1 AND p.is_active = 1
       LIMIT 1`
    ).bind(inputKey).first<{ variant_id: number; product_id: number }>();
    if (alias?.variant_id && alias?.product_id) {
      return { productId: toInt(alias.product_id, 0) || null, variantId: toInt(alias.variant_id, 0) || null, matchStatus: 'alias', inputKey };
    }
  } catch {
    // Alias table is additive. During the pre-activation deploy it may not exist yet.
  }

  const product = await findCatalogProductByIdentity(db, item.productName, 0, { activeOnly: true }) as { id: number; name: string; category: string } | null;
  if (!product?.id) return { productId: null, variantId: null, matchStatus: 'unresolved_product', inputKey };
  const variant = await db.prepare(
    `SELECT id FROM catalog_variants
     WHERE product_id = ? AND is_active = 1
       AND COALESCE(category, 'adult') = COALESCE(?, 'adult')
       AND COALESCE(gender, '') = COALESCE(?, '')
       AND COALESCE(color, '') = COALESCE(?, '')
       AND COALESCE(NULLIF(UPPER(TRIM(material)), ''), 'СТАНДАРТ') = COALESCE(NULLIF(UPPER(TRIM(?)), ''), 'СТАНДАРТ')
       AND COALESCE(NULLIF(UPPER(TRIM(length)), ''), 'СТАНДАРТ') = COALESCE(NULLIF(UPPER(TRIM(?)), ''), 'СТАНДАРТ')
       AND COALESCE(size_label, '') = COALESCE(?, '')
     LIMIT 1`
  ).bind(product.id, item.category, item.gender || null, item.color || null, item.material || null, item.length || null, item.size || null).first<{ id: number }>();
  if (!variant?.id) return { productId: toInt(product.id, 0) || null, variantId: null, matchStatus: 'unresolved_variant', inputKey };
  return { productId: toInt(product.id, 0) || null, variantId: toInt(variant.id, 0) || null, matchStatus: 'matched', inputKey };
}


export async function resolveCatalogProductAndVariantV2(
  db: D1Database,
  item: ReturnType<typeof normalizeOrderItems>[number],
): Promise<ResolvedOrderCatalogReference> {
  if (!await isCatalogIdentityV3Enabled(db)) return await resolveCatalogProductAndVariantV2Flat(db, item);
  const inputKey = catalogOrderInputKey(item);
  const product = await findCatalogProductByIdentity(db, item.productName, 0, { activeOnly: true }) as { id: number; name: string; category: string } | null;
  if (!product?.id) return { productId: null, variantId: null, matchStatus: 'unresolved_product', inputKey };

  const category = normalizeAudienceCategory(item.category, item.size);
  const material = await resolveCatalogValueAlias(db, 'material', canonicalStockPositionValue(item.material));
  const length = await resolveCatalogValueAlias(db, 'length', canonicalStockPositionValue(item.length));
  const gender = normalizeCatalogCombinationGender(item.gender);
  const rawColor = upperText(item.color);
  const color = await resolveCatalogValueAlias(db, 'color', normalizeCatalogCombinationColor(item.color));
  const size = await resolveCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', normalizeCatalogCombinationSize(item.size));

  // Step 192A2: an omitted manager color must not silently select a legacy БЕЗ ЦВЕТА
  // placeholder when this exact execution also contains real colors. A truly colorless
  // product keeps working through its existing no-color identity; creating a new no-color
  // combination requires the explicit reference value БЕЗ ЦВЕТА instead of an empty field.
  const existingExecution = await findCatalogExecutionV3(db, product.id, material, length);
  if (existingExecution?.id) {
    const existing = await findCatalogCombinationV3(db, existingExecution.id, category, gender, color, size);
    if (existing?.id) {
      let omittedColorConflictsWithConcreteSibling = false;
      if (!rawColor) {
        const profile = await db.prepare(
          `SELECT MAX(CASE WHEN TRIM(COALESCE(color,'')) <> '' AND UPPER(TRIM(color)) <> 'БЕЗ ЦВЕТА' THEN 1 ELSE 0 END) AS has_color
           FROM catalog_variants
           WHERE product_id = ? AND stock_position_id = ? AND is_active = 1
             AND COALESCE(category,'adult') = ?`
        ).bind(product.id, existingExecution.id, category).first<{ has_color: number }>();
        omittedColorConflictsWithConcreteSibling = toInt(profile?.has_color, 0) > 0;
      }
      if (!omittedColorConflictsWithConcreteSibling) {
        return { productId: toInt(product.id, 0) || null, variantId: toInt(existing.id, 0) || null, matchStatus: 'matched', inputKey };
      }
      return { productId: toInt(product.id, 0) || null, variantId: null, matchStatus: 'unresolved_attribute', inputKey };
    }
  }

  // Never synthesize a new БЕЗ ЦВЕТА SKU merely because the manager left color empty.
  // One-size/unisex cases are intentionally not guessed here; their UI semantics are handled
  // separately so existing legitimate dimensionless variants are not broken by this cleanup.
  if (!rawColor) {
    return { productId: toInt(product.id, 0) || null, variantId: null, matchStatus: 'unresolved_attribute', inputKey };
  }

  // Validate every manager-entered fact before mutating master data. Unknown input must
  // never leave behind a newly-created execution/combination as a hidden side effect.
  const sizeKind = category === 'child' ? 'child_age' : 'size';
  if (
    !await catalogReferenceDbValueExists(db, 'material', material)
    || !await catalogReferenceDbValueExists(db, 'length', length)
    || (gender && gender !== 'ЖЕН' && gender !== 'МУЖ')
    || (upperText(item.color) && !await catalogReferenceValueExists(db, 'color', color))
    || (size && !await catalogReferenceValueExists(db, sizeKind, size))
  ) {
    return { productId: toInt(product.id, 0) || null, variantId: null, matchStatus: 'unresolved_attribute', inputKey };
  }

  // Only now may known facts create a previously unseen execution/combination.
  const execution = existingExecution?.id
    ? existingExecution
    : await ensureCatalogExecutionV3(db, product.id, material, length, new Date().toISOString());

  // Step 188D completion guard: legacy/manual aliases from the pre-v3 review UI are
  // accepted only when they point to the exact canonical identity we have independently
  // derived from the current input. This prevents an old 46 -> 42 or HAKI -> BLACK
  // mapping from overriding the v3 product/execution/color/size model.
  try {
    const alias = await db.prepare(
      `SELECT v.id AS variant_id, v.product_id, v.stock_position_id,
              COALESCE(v.category, 'adult') AS category, COALESCE(v.gender, '') AS gender,
              COALESCE(v.color, '') AS color, COALESCE(v.size_label, '') AS size_label
       FROM catalog_input_aliases a
       JOIN catalog_variants v ON v.id = a.variant_id
       JOIN catalog_products p ON p.id = v.product_id
       WHERE a.input_key = ? AND v.is_active = 1 AND p.is_active = 1
       LIMIT 1`
    ).bind(inputKey).first<{
      variant_id: number; product_id: number; stock_position_id: number | null;
      category: string; gender: string; color: string; size_label: string;
    }>();
    if (
      alias?.variant_id && alias?.product_id === product.id && alias.stock_position_id === execution.id
      && cleanText(alias.category) === category
      && normalizeCatalogCombinationGender(alias.gender) === gender
      && normalizeCatalogCombinationColor(alias.color) === color
      && normalizeCatalogCombinationSize(alias.size_label) === size
    ) {
      return { productId: product.id, variantId: toInt(alias.variant_id, 0) || null, matchStatus: 'alias', inputKey };
    }
  } catch {
    // Alias table is additive. Identity v3 continues through canonical lookup if unavailable.
  }

  const timestamp = new Date().toISOString();
  const created = await createCatalogCombinationV3(db, {
    productId: product.id,
    executionId: execution.id,
    category,
    gender,
    color,
    material: execution.material,
    length: execution.length,
    sizeLabel: size,
    externalId: makeVariantExternalId(product.name, category, gender, color, execution.material, execution.length, size),
  }, timestamp);
  return { productId: toInt(product.id, 0) || null, variantId: created.id || null, matchStatus: created.created ? 'created_combination' : 'matched', inputKey };
}


export async function resolveCatalogProductAndVariant(
  db: D1Database,
  item: ReturnType<typeof normalizeOrderItems>[number],
  timestamp: string,
): Promise<ResolvedOrderCatalogReference> {
  if (await isCatalogIdentityV3Enabled(db) || await isHumanInventoryModelEnabled(db)) {
    return await resolveCatalogProductAndVariantV2(db, item);
  }
  return await resolveCatalogProductAndVariantLegacy(db, item, timestamp);
}


export async function resolveWorkshopCatalogProductOnly(
  db: D1Database,
  item: ReturnType<typeof normalizeOrderItems>[number],
): Promise<ResolvedOrderCatalogReference> {
  const inputKey = catalogOrderInputKey(item);
  const product = await findCatalogProductByIdentity(db, item.productName, 0, { activeOnly: true }) as { id: number } | null;
  if (!product?.id) return { productId: null, variantId: null, matchStatus: 'unresolved_product', inputKey };
  return { productId: toInt(product.id, 0) || null, variantId: null, matchStatus: 'matched', inputKey };
}


export async function ensureHumanInventoryStockRow(
  db: D1Database,
  inventorySource: 'warehouse' | 'boutique',
  canonical: CanonicalVariantSnapshot,
  timestamp: string,
) {
  let row = await db.prepare(
    `SELECT id, quantity, reserved_quantity FROM inventory_stock
     WHERE inventory_source = ? AND variant_id = ?
     ORDER BY id ASC LIMIT 1`
  ).bind(inventorySource, canonical.variantId).first<{ id: number; quantity: number; reserved_quantity: number }>();
  if (row?.id) return row;

  await db.prepare(
    `INSERT OR IGNORE INTO inventory_stock (
      inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
      material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
      last_action, last_source_ref, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`
  ).bind(
    inventorySource,
    canonical.productId,
    canonical.variantId,
    canonical.productName,
    canonical.gender,
    canonical.color,
    canonical.material,
    canonical.length,
    canonical.size,
    'Создана позиция для резервов',
    'human-inventory-v2',
    timestamp,
    timestamp,
  ).run();

  // A simultaneous order may have created the unique source+variant row first. Re-read
  // the winner instead of failing the whole order after its master-data resolution.
  row = await db.prepare(
    `SELECT id, quantity, reserved_quantity FROM inventory_stock
     WHERE inventory_source = ? AND variant_id = ?
     ORDER BY id ASC LIMIT 1`
  ).bind(inventorySource, canonical.variantId).first<{ id: number; quantity: number; reserved_quantity: number }>();
  if (!row?.id) throw new Error('Не удалось подготовить позицию склада для резервирования.');
  return row;
}


export type OrderStockShortage = {
  inventorySource: 'warehouse' | 'boutique';
  variantId: number;
  inputIndexes: number[];
  productName: string;
  requestedQuantity: number;
  physicalQuantity: number;
  reservedQuantity: number;
  shortage: number;
};

export class OrderStockShortageError extends Error {
  readonly code = 'order_stock_shortage';
  readonly shortages: OrderStockShortage[];

  constructor(shortages: OrderStockShortage[]) {
    const first = shortages[0]
    const suffix = shortages.length > 1 ? ` Ещё проблемных позиций: ${shortages.length - 1}.` : ''
    super(first
      ? `По свежим данным для «${first.productName}» не хватает ${first.shortage} шт. Посчитайте фактическое количество или выберите «Сейчас проверить не могу».${suffix}`
      : 'Перед сохранением заказа нужно уточнить складской остаток.')
    this.name = 'OrderStockShortageError'
    this.shortages = shortages
  }
}

export async function assertCreateOrderShortageDecisions(
  db: D1Database,
  items: ReturnType<typeof normalizeOrderItems>,
  resolvedCatalog: Array<{ productId: number | null; variantId: number | null }>,
  options: { excludeOrderId?: number } = {},
) {
  const grouped = new Map<string, {
    inventorySource: 'warehouse' | 'boutique';
    variantId: number;
    inputIndexes: number[];
    requestedQuantity: number;
    productName: string;
    hasObservation: boolean;
    acknowledged: boolean;
  }>();

  for (const [index, item] of items.entries()) {
    if (item.isWorkshop) continue;
    const resolved = resolvedCatalog[index];
    const variantId = toInt(resolved?.variantId, 0);
    if (!variantId) continue;
    const inventorySource = item.inventorySource === 'boutique' ? 'boutique' : 'warehouse';
    const key = `${inventorySource}:${variantId}`;
    const current = grouped.get(key) || {
      inventorySource,
      variantId,
      inputIndexes: [],
      requestedQuantity: 0,
      productName: item.productName,
      hasObservation: false,
      acknowledged: true,
    };
    current.inputIndexes.push(Math.max(0, toInt(item.inputIndex, index)));
    current.requestedQuantity += Math.max(0, toInt(item.quantity, 0));
    current.hasObservation = current.hasObservation || item.observedPhysicalQuantity !== null;
    current.acknowledged = current.acknowledged && Boolean(item.shortageAcknowledged);
    grouped.set(key, current);
  }

  const unresolvedDecisionGroups = [...grouped.values()].filter(group => (
    group.requestedQuantity > 0 && !group.hasObservation && !group.acknowledged
  ));
  if (!unresolvedDecisionGroups.length) return;

  const shortages: OrderStockShortage[] = [];
  const excludedOrderId = Math.max(0, toInt(options.excludeOrderId, 0));
  for (const chunk of chunksOf(unresolvedDecisionGroups, 30)) {
    const valuesSql = chunk.map(() => '(?, ?, ?)').join(', ');
    const binds: Array<string | number> = [];
    for (const group of chunk) {
      binds.push(group.inventorySource, group.variantId, group.requestedQuantity);
    }
    const reservationExclusionSql = excludedOrderId > 0 ? ' AND r.order_id <> ?' : '';
    if (excludedOrderId > 0) binds.push(excludedOrderId);
    const result = await db.prepare(
      `WITH requested(inventory_source, variant_id, requested_quantity) AS (
         VALUES ${valuesSql}
       ), reservation_totals AS (
         SELECT r.inventory_source, r.variant_id, SUM(r.quantity) AS reserved_quantity
         FROM inventory_reservations r
         JOIN requested req
           ON req.inventory_source = r.inventory_source
          AND req.variant_id = r.variant_id
         WHERE r.status = 'active'${reservationExclusionSql}
         GROUP BY r.inventory_source, r.variant_id
       )
       SELECT req.inventory_source, req.variant_id, req.requested_quantity,
              COALESCE(s.quantity, 0) AS physical_quantity,
              COALESCE(rt.reserved_quantity, 0) AS reserved_quantity
       FROM requested req
       LEFT JOIN inventory_stock s
         ON s.inventory_source = req.inventory_source
        AND s.variant_id = req.variant_id
       LEFT JOIN reservation_totals rt
         ON rt.inventory_source = req.inventory_source
        AND rt.variant_id = req.variant_id`
    ).bind(...binds).all<{
      inventory_source: string;
      variant_id: number;
      requested_quantity: number;
      physical_quantity: number;
      reserved_quantity: number;
    }>();

    const rowByKey = new Map((result.results || []).map(row => [
      `${cleanText(row.inventory_source)}:${toInt(row.variant_id, 0)}`,
      row,
    ]));
    for (const group of chunk) {
      const row = rowByKey.get(`${group.inventorySource}:${group.variantId}`);
      const physical = toInt(row?.physical_quantity, 0);
      const reserved = Math.max(0, toInt(row?.reserved_quantity, 0));
      const freeAfterReservation = physical - reserved - group.requestedQuantity;
      if (freeAfterReservation < 0) {
        shortages.push({
          inventorySource: group.inventorySource,
          variantId: group.variantId,
          inputIndexes: [...new Set(group.inputIndexes)].sort((left, right) => left - right),
          productName: group.productName,
          requestedQuantity: group.requestedQuantity,
          physicalQuantity: physical,
          reservedQuantity: reserved,
          shortage: Math.abs(freeAfterReservation),
        });
      }
    }
  }
  if (shortages.length) throw new OrderStockShortageError(shortages);
}

export async function reserveOrderItemV2(
  db: D1Database,
  orderId: number,
  externalId: string,
  item: ReturnType<typeof normalizeOrderItems>[number],
  productId: number | null,
  variantId: number | null,
  timestamp: string,
  orderItemId?: number | null,
  referenceType = 'order',
  referenceId = externalId,
) {
  if (!orderItemId) throw new Error('Не удалось связать резерв с позицией заказа.');
  const existingReservation = await db.prepare(
    `SELECT id, status, quantity, inventory_source, variant_id FROM inventory_reservations WHERE order_item_id = ? LIMIT 1`
  ).bind(orderItemId).first<{ id: number; status: string; quantity: number; inventory_source: string; variant_id: number | null }>();
  if (existingReservation?.id) {
    const existingVariantId = toInt(existingReservation.variant_id, toInt(variantId, 0));
    const existingSource = normalizeSourceType(existingReservation.inventory_source || item.inventorySource);
    const committedStock = cleanText(existingReservation.status) === 'active' && existingVariantId > 0
      ? await db.prepare(
        `SELECT quantity, reserved_quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? ORDER BY id ASC LIMIT 1`
      ).bind(existingSource, existingVariantId).first<{ quantity: number; reserved_quantity: number }>()
      : null;
    const committedPhysical = toInt(committedStock?.quantity, 0);
    const committedReserved = Math.max(0, toInt(committedStock?.reserved_quantity, 0));
    const committedAvailable = committedPhysical - committedReserved;
    return {
      source: existingSource,
      productName: item.productName,
      variantId: existingVariantId || variantId,
      quantityBefore: 0,
      quantityAfter: committedAvailable,
      referenceType,
      referenceId: cleanText(referenceId) || externalId,
      reservationStatus: cleanText(existingReservation.status),
      concurrentShortage: !item.shortageAcknowledged && cleanText(existingReservation.status) === 'active' && committedAvailable < 0,
      shortageAfter: cleanText(existingReservation.status) === 'active' ? Math.max(0, -committedAvailable) : 0,
      physicalAfter: committedPhysical,
      reservedAfter: committedReserved,
      alreadyApplied: true,
    };
  }

  const safeReferenceId = cleanText(referenceId) || externalId;
  if (!productId || !variantId) {
    await db.batch([
      db.prepare(
        `INSERT INTO inventory_reservations (
          order_id, order_item_id, inventory_source, product_id, variant_id, quantity, status,
          reference_type, reference_id, unresolved_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'unresolved', ?, ?, ?, ?, ?)`
      ).bind(
        orderId, orderItemId, item.inventorySource, productId, variantId, item.quantity,
        referenceType, safeReferenceId, !productId ? 'product' : 'variant', timestamp, timestamp,
      ),
      db.prepare(
        `UPDATE order_items SET stock_writeoff_status = 'catalog_unresolved', stock_quantity_before = NULL, stock_quantity_after = NULL WHERE id = ?`
      ).bind(orderItemId),
    ]);
    return {
      source: item.inventorySource,
      productName: item.productName,
      variantId,
      quantityBefore: 0,
      quantityAfter: 0,
      referenceType,
      referenceId: safeReferenceId,
      reservationStatus: 'unresolved',
    };
  }

  const canonical = await loadCanonicalVariantSnapshot(db, variantId);
  const canonicalProductId = canonical.productId;
  const stock = await ensureHumanInventoryStockRow(db, item.inventorySource, canonical, timestamp);
  const physicalBefore = toInt(stock.quantity, 0);
  const reservedBefore = Math.max(0, toInt(stock.reserved_quantity, 0));
  const observedPhysical = item.observedPhysicalQuantity;
  const physicalForReservation = observedPhysical === null ? physicalBefore : observedPhysical;
  const stockAction = observedPhysical === null ? 'Резерв заказа' : 'Сверено менеджером при заказе';
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE inventory_stock
       SET quantity = CASE WHEN ? IS NULL THEN quantity ELSE ? END,
           reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) + ?),
           product_id = ?, variant_id = ?, product_name_snapshot = ?, gender_snapshot = ?, color_snapshot = ?,
           material_snapshot = ?, length_snapshot = ?, size_snapshot = ?,
           last_action = ?, last_source_ref = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      observedPhysical,
      observedPhysical,
      item.quantity,
      canonicalProductId,
      variantId,
      canonical.productName,
      canonical.gender,
      canonical.color,
      canonical.material,
      canonical.length,
      canonical.size,
      stockAction,
      `${referenceType}:${safeReferenceId}`,
      timestamp,
      stock.id,
    ),
  ];

  if (observedPhysical !== null) {
    statements.push(db.prepare(
      `INSERT INTO inventory_movements (
        inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
        color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
        reference_type, reference_id, comment, created_at
      ) VALUES (?, 'revision', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'order_observation', ?, ?, ?)`
    ).bind(
      item.inventorySource,
      canonicalProductId,
      variantId,
      canonical.productName,
      canonical.gender,
      canonical.color,
      canonical.material,
      canonical.length,
      canonical.size,
      observedPhysical - physicalBefore,
      observedPhysical,
      safeReferenceId,
      `Менеджер подтвердил фактическое количество при заказе ${externalId}: ${observedPhysical} шт. По учёту до сверки: ${physicalBefore} шт. Резервы не изменялись этой сверкой.`,
      timestamp,
    ));

    statements.push(inventoryPhysicalCheckStatement(db, {
      source: item.inventorySource,
      productId: canonicalProductId,
      variantId,
      expectedQuantity: physicalBefore,
      countedQuantity: observedPhysical,
      reservedQuantity: reservedBefore,
      checkType: referenceType === 'exchange_new' ? 'exchange_observation' : 'order_observation',
      referenceType: 'order_observation',
      referenceId: safeReferenceId,
      checkedAt: timestamp,
    }));
  }

  statements.push(
    db.prepare(
      `INSERT INTO inventory_reservations (
        order_id, order_item_id, inventory_source, product_id, variant_id, quantity, status,
        reference_type, reference_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
    ).bind(orderId, orderItemId, item.inventorySource, canonicalProductId, variantId, item.quantity, referenceType, safeReferenceId, timestamp, timestamp),
    db.prepare(
      `UPDATE order_items SET stock_writeoff_status = 'reserved', stock_quantity_before = NULL, stock_quantity_after = NULL WHERE id = ?`
    ).bind(orderItemId),
  );
  await db.batch(statements);

  const committedStock = await db.prepare(
    `SELECT quantity, reserved_quantity FROM inventory_stock WHERE id = ? LIMIT 1`
  ).bind(stock.id).first<{ quantity: number; reserved_quantity: number }>();
  const committedPhysical = toInt(committedStock?.quantity, physicalForReservation);
  const committedReserved = Math.max(0, toInt(committedStock?.reserved_quantity, reservedBefore + item.quantity));
  const committedAvailable = committedPhysical - committedReserved;
  const concurrentShortage = !item.shortageAcknowledged && committedAvailable < 0;

  return {
    source: item.inventorySource,
    productName: item.productName,
    variantId,
    quantityBefore: physicalForReservation - reservedBefore,
    quantityAfter: committedAvailable,
    referenceType,
    referenceId: safeReferenceId,
    reservationStatus: 'active',
    observedPhysicalQuantity: observedPhysical,
    concurrentShortage,
    shortageAfter: Math.max(0, -committedAvailable),
    physicalAfter: committedPhysical,
    reservedAfter: committedReserved,
  };
}


export async function releaseOrderReservationV2(db: D1Database, orderItemId: number, timestamp: string, reason = 'Заказ изменён') {
  const reservation = await db.prepare(
    `SELECT id, inventory_source, variant_id, quantity, status
     FROM inventory_reservations WHERE order_item_id = ? LIMIT 1`
  ).bind(orderItemId).first<Record<string, unknown>>();
  if (!reservation?.id) return false;
  const status = cleanText(reservation.status);
  if (status === 'released' || status === 'fulfilled') return false;

  const statements: D1PreparedStatement[] = [];
  if (status === 'active' && toInt(reservation.variant_id, 0)) {
    statements.push(db.prepare(
      `UPDATE inventory_stock
       SET reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) - ?),
           last_action = ?, last_source_ref = ?, updated_at = ?
       WHERE id = (
         SELECT id FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? ORDER BY id ASC LIMIT 1
       )`
    ).bind(
      Math.max(1, toInt(reservation.quantity, 1)),
      'Резерв снят',
      `order-item:${orderItemId}`,
      timestamp,
      normalizeSourceType(reservation.inventory_source),
      toInt(reservation.variant_id, 0),
    ));
  }
  statements.push(
    db.prepare(`UPDATE inventory_reservations SET status = 'released', released_at = ?, updated_at = ? WHERE id = ?`).bind(timestamp, timestamp, toInt(reservation.id, 0)),
    db.prepare(`UPDATE order_items SET stock_writeoff_status = 'reservation_released', stock_quantity_before = NULL, stock_quantity_after = NULL WHERE id = ?`).bind(orderItemId),
  );
  await db.batch(statements);
  void reason;
  return true;
}


export async function releaseOrderReservationsV2(db: D1Database, orderId: number, timestamp: string, reason = 'Заказ изменён') {
  const rows = await db.prepare(
    `SELECT id, order_item_id, inventory_source, variant_id, quantity, status
     FROM inventory_reservations
     WHERE order_id = ? AND status IN ('active', 'unresolved')
     ORDER BY id ASC`
  ).bind(orderId).all<Record<string, unknown>>();
  const reservations = rows.results || [];
  if (!reservations.length) return 0;

  // Step 191E: release the whole order set-wise instead of calling the single-item helper in a
  // query loop. This preserves the same status semantics but keeps D1 query count bounded for
  // large edits/deletes and commits stock cache + reservation/item states atomically.
  const stockGroups = new Map<string, { source: SourceType; variantId: number; quantity: number; sourceRef: string }>();
  for (const row of reservations) {
    if (cleanText(row.status) !== 'active') continue;
    const variantId = toInt(row.variant_id, 0);
    if (!variantId) continue;
    const source = normalizeSourceType(row.inventory_source);
    const key = `${source}:${variantId}`;
    const existing = stockGroups.get(key);
    stockGroups.set(key, {
      source,
      variantId,
      quantity: (existing?.quantity || 0) + Math.max(1, toInt(row.quantity, 1)),
      sourceRef: `order-item:${toInt(row.order_item_id, 0)}`,
    });
  }

  const statements: D1PreparedStatement[] = [];
  const stockPayloads = Array.from(stockGroups.values()).map(row => JSON.stringify(row));
  for (const payloadChunk of chunksOf(stockPayloads, 70)) {
    const valuesSql = payloadChunk.map(() => '(?)').join(', ');
    const cte = `input(payload) AS (VALUES ${valuesSql}),
      x AS (
        SELECT CAST(json_extract(payload, '$.source') AS TEXT) AS source,
               CAST(json_extract(payload, '$.variantId') AS INTEGER) AS variant_id,
               CAST(json_extract(payload, '$.quantity') AS INTEGER) AS quantity,
               CAST(json_extract(payload, '$.sourceRef') AS TEXT) AS source_ref
        FROM input
      )`;
    statements.push(db.prepare(
      `WITH ${cte}
       UPDATE inventory_stock
       SET reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) - (
             SELECT x.quantity FROM x
             WHERE x.source = inventory_stock.inventory_source AND x.variant_id = inventory_stock.variant_id
           )),
           last_action = 'Резерв снят',
           last_source_ref = (
             SELECT x.source_ref FROM x
             WHERE x.source = inventory_stock.inventory_source AND x.variant_id = inventory_stock.variant_id
           ),
           updated_at = ?
       WHERE EXISTS (
         SELECT 1 FROM x
         WHERE x.source = inventory_stock.inventory_source AND x.variant_id = inventory_stock.variant_id
       )`
    ).bind(...payloadChunk, timestamp));
  }

  const reservationPayloads = reservations.map(row => JSON.stringify({
    reservationId: toInt(row.id, 0),
    orderItemId: toInt(row.order_item_id, 0),
  }));
  for (const payloadChunk of chunksOf(reservationPayloads, 70)) {
    const valuesSql = payloadChunk.map(() => '(?)').join(', ');
    const cte = `input(payload) AS (VALUES ${valuesSql}),
      x AS (
        SELECT CAST(json_extract(payload, '$.reservationId') AS INTEGER) AS reservation_id,
               CAST(json_extract(payload, '$.orderItemId') AS INTEGER) AS order_item_id
        FROM input
      )`;
    statements.push(
      db.prepare(
        `WITH ${cte}
         UPDATE inventory_reservations
         SET status = 'released', released_at = ?, updated_at = ?
         WHERE status IN ('active', 'unresolved')
           AND EXISTS (SELECT 1 FROM x WHERE x.reservation_id = inventory_reservations.id)`
      ).bind(...payloadChunk, timestamp, timestamp),
      db.prepare(
        `WITH ${cte}
         UPDATE order_items
         SET stock_writeoff_status = 'reservation_released', stock_quantity_before = NULL, stock_quantity_after = NULL
         WHERE EXISTS (SELECT 1 FROM x WHERE x.order_item_id = order_items.id)`
      ).bind(...payloadChunk),
    );
  }

  if (statements.length) await db.batch(statements);
  void reason;
  return reservations.length;
}



export type OrderStockHandoverItem = {
  orderItemId: number;
  productName: string;
  itemDetails: string;
  source: SourceType;
  quantity: number;
  reservationId: number | null;
  reservationStatus: string;
  physicalQuantity: number;
  totalReservedQuantity: number;
  checkpointId: number | null;
  checkpointAt: string | null;
  checkpointType: string | null;
  checkpointKind: 'revision' | 'check' | null;
  reviewNeeded: boolean;
  reviewReason: 'late_entry' | 'mixed_order_after_check' | null;
  reviewDecision: string | null;
  reviewedCheckpointId: number | null;
  reviewedCheckpointAt: string | null;
  itemCreatedAt: string | null;
  state: 'already_issued' | 'handover_review' | 'ready_to_issue' | 'needs_attention';
};


export type OrderStockHandoverState = {
  ok: true;
  orderId: number;
  externalId: string;
  orderDate: string;
  orderCreatedAt: string;
  customerName: string;
  shippingStatus: string;
  workshopPending: boolean;
  workshopItemCount: number;
  activeWorkshopTaskCount: number;
  items: OrderStockHandoverItem[];
};


export function normalizedUtcMillis(value: unknown) {
  const text = cleanText(value);
  if (!text) return 0;
  const normalized = text.includes('T') ? text : text.replace(' ', 'T') + 'Z';
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}


export function handoverCheckpointKind(checkType: unknown): 'revision' | 'check' | null {
  const type = cleanText(checkType).toLowerCase();
  if (!type) return null;
  return type.includes('stocktake') ? 'revision' : 'check';
}


export async function orderWorkshopPendingForShipping(db: D1Database, orderId: number) {
  const row = await db.prepare(
    `SELECT
       COALESCE(o.workshop_status, '') AS workshop_status,
       COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND COALESCE(oi.is_workshop, 0) = 1 AND oi.quantity > 0), 0) AS workshop_item_count,
       COALESCE((SELECT COUNT(*) FROM workshop_tasks wt WHERE wt.order_id = o.id AND wt.quantity > 0 AND wt.status = 'active'), 0) AS active_workshop_task_count
     FROM orders o
     WHERE o.id = ?`
  ).bind(orderId).first<Record<string, unknown>>();
  const workshopItemCount = Math.max(0, toInt(row?.workshop_item_count, 0));
  const activeWorkshopTaskCount = Math.max(0, toInt(row?.active_workshop_task_count, 0));
  const pending = activeWorkshopTaskCount > 0 || (workshopItemCount > 0 && normalizeWorkshopStatus(row?.workshop_status) === 'in_workshop');
  return { pending, workshopItemCount, activeWorkshopTaskCount };
}


export async function activeStocktakeSessionForHandover(db: D1Database, source: SourceType) {
  const row = await db.prepare(
    `SELECT id, inventory_source, started_at, updated_at
     FROM inventory_stocktake_sessions
     WHERE inventory_source = ? AND status = 'active'
     LIMIT 1`
  ).bind(source).first<Record<string, unknown>>();
  if (!row?.id) return null;
  return {
    id: cleanText(row.id),
    source: normalizeSourceType(row.inventory_source),
    startedAt: cleanText(row.started_at),
    updatedAt: cleanText(row.updated_at),
  };
}


export async function fetchOrderStockHandoverRows(
  db: D1Database,
  orderIds: number[],
  options: { allActive?: boolean; listFlagsOnly?: boolean } = {},
) {
  const allActive = options.allActive === true;
  const listFlagsOnly = options.listFlagsOnly === true;
  const ids = Array.from(new Set(orderIds.map((value) => toInt(value, 0)).filter((value) => value > 0)));
  if (!allActive && !ids.length) return [] as Record<string, unknown>[];
  const scopes: Array<number[] | null> = allActive ? [null] : chunksOf(ids, 80);
  const rows: Record<string, unknown>[] = [];
  for (const chunk of scopes) {
    if (listFlagsOnly) {
      if (!allActive && !chunk?.length) throw new Error('Compact handover flags require an explicit order scope.');
      const placeholders = chunk?.map(() => '?').join(',') || '';
      const reservationScope = allActive
        ? `r.status = 'active' AND r.variant_id IS NOT NULL
           AND scoped_order.order_status NOT IN ('deleted', 'archived')
           AND COALESCE(scoped_order.shipping_status, 'not_sent') <> 'sent'`
        : `r.order_id IN (${placeholders}) AND r.status = 'active' AND r.variant_id IS NOT NULL`;
      // D1 read-budget R2: list/attention summaries need lineage flags and stock totals, not the
      // full customer/catalog payload. The detailed handover screen still uses the full branch below.
      const compact = await db.prepare(
        `WITH active_reservations AS (
           SELECT r.id AS reservation_id, r.order_id, r.order_item_id, r.inventory_source, r.variant_id,
                  r.quantity AS reservation_quantity
           FROM inventory_reservations r
           JOIN orders scoped_order ON scoped_order.id = r.order_id
           WHERE ${reservationScope}
         ),
         workshop_orders AS (
           SELECT oi.order_id
           FROM order_items oi
           JOIN (SELECT DISTINCT order_id FROM active_reservations) active_order ON active_order.order_id = oi.order_id
           WHERE COALESCE(oi.is_workshop, 0) = 1 AND oi.quantity > 0
           GROUP BY oi.order_id
         ),
         scoped_items AS (
           SELECT
             oi.order_id,
             oi.id AS order_item_id,
             COALESCE(NULLIF(oi.inventory_obligation_key, ''), 'legacy-order-item:' || oi.id) AS obligation_key,
             COALESCE(NULLIF(oi.inventory_obligation_origin_at, ''), oi.created_at) AS origin_at,
             o.order_date,
             ar.inventory_source,
             ar.variant_id,
             CASE WHEN wo.order_id IS NULL THEN 0 ELSE 1 END AS has_workshop
           FROM active_reservations ar
           JOIN order_items oi ON oi.id = ar.order_item_id
           JOIN orders o ON o.id = oi.order_id
           LEFT JOIN workshop_orders wo ON wo.order_id = oi.order_id
           WHERE COALESCE(oi.is_workshop, 0) = 0 AND oi.quantity > 0
         ),
         lineage AS MATERIALIZED (
           SELECT si.*,
                  (SELECT json_array(c.id, c.checked_at)
                   FROM inventory_stock_checks c
                   WHERE c.inventory_source = si.inventory_source
                     AND c.variant_id = si.variant_id
                     AND (
                       (datetime(c.checked_at) < datetime(si.origin_at) AND date(c.checked_at, '+5 hours') >= date(si.order_date))
                       OR (si.has_workshop = 1 AND datetime(c.checked_at) > datetime(si.origin_at))
                     )
                   ORDER BY datetime(c.checked_at) DESC, c.id DESC
                   LIMIT 1) AS check_point,
                  (SELECT json_array(-s.rowid, s.completed_at)
                   FROM inventory_stocktake_sessions s
                   WHERE s.inventory_source = si.inventory_source
                     AND s.status = 'completed'
                     AND s.completed_at IS NOT NULL
                     AND s.id NOT LIKE 'REV-%-P-%'
                     AND datetime(s.started_at) <= datetime(si.origin_at)
                     AND date(s.completed_at, '+5 hours') >= date(si.order_date)
                     AND NOT EXISTS (
                       SELECT 1 FROM inventory_stock_checks exact_sku
                       WHERE exact_sku.inventory_source = si.inventory_source
                         AND exact_sku.variant_id = si.variant_id
                         AND exact_sku.reference_type = 'stocktake'
                         AND exact_sku.reference_id = s.id
                     )
                   ORDER BY datetime(s.completed_at) DESC, s.rowid DESC
                   LIMIT 1) AS full_point,
                  (SELECT json_array(hr.checkpoint_id, hr.checkpoint_at)
                   FROM inventory_handover_reviews hr
                   JOIN order_items reviewed_item ON reviewed_item.id = hr.order_item_id
                   WHERE hr.order_id = si.order_id
                     AND COALESCE(NULLIF(reviewed_item.inventory_obligation_key, ''), 'legacy-order-item:' || reviewed_item.id) = si.obligation_key
                   ORDER BY datetime(hr.checkpoint_at) DESC, hr.checkpoint_id DESC, hr.id DESC
                   LIMIT 1) AS review_point
           FROM scoped_items si
         ),
         resolved AS MATERIALIZED (
           SELECT l.*,
                  CASE
                    WHEN l.check_point IS NULL THEN CAST(json_extract(l.full_point, '$[0]') AS INTEGER)
                    WHEN l.full_point IS NULL THEN CAST(json_extract(l.check_point, '$[0]') AS INTEGER)
                    WHEN datetime(json_extract(l.full_point, '$[1]')) > datetime(json_extract(l.check_point, '$[1]'))
                      THEN CAST(json_extract(l.full_point, '$[0]') AS INTEGER)
                    WHEN datetime(json_extract(l.full_point, '$[1]')) = datetime(json_extract(l.check_point, '$[1]'))
                      AND CAST(json_extract(l.full_point, '$[0]') AS INTEGER) > CAST(json_extract(l.check_point, '$[0]') AS INTEGER)
                      THEN CAST(json_extract(l.full_point, '$[0]') AS INTEGER)
                    ELSE CAST(json_extract(l.check_point, '$[0]') AS INTEGER)
                  END AS checkpoint_id,
                  CASE
                    WHEN l.check_point IS NULL THEN json_extract(l.full_point, '$[1]')
                    WHEN l.full_point IS NULL THEN json_extract(l.check_point, '$[1]')
                    WHEN datetime(json_extract(l.full_point, '$[1]')) > datetime(json_extract(l.check_point, '$[1]'))
                      THEN json_extract(l.full_point, '$[1]')
                    WHEN datetime(json_extract(l.full_point, '$[1]')) = datetime(json_extract(l.check_point, '$[1]'))
                      AND CAST(json_extract(l.full_point, '$[0]') AS INTEGER) > CAST(json_extract(l.check_point, '$[0]') AS INTEGER)
                      THEN json_extract(l.full_point, '$[1]')
                    ELSE json_extract(l.check_point, '$[1]')
                  END AS checkpoint_at,
                  CAST(json_extract(l.review_point, '$[0]') AS INTEGER) AS reviewed_checkpoint_id,
                  json_extract(l.review_point, '$[1]') AS reviewed_checkpoint_at
           FROM lineage l
         ),
         SELECT
           ar.order_id, ar.order_item_id, ar.reservation_id, ar.inventory_source, ar.variant_id,
           ar.reservation_quantity,
           COALESCE(stock.quantity, 0) AS physical_quantity,
           COALESCE(stock.reserved_quantity, 0) AS total_reserved_quantity,
           lineage_row.order_date, lineage_row.origin_at AS item_created_at,
           CASE WHEN
             julianday(lineage_row.checkpoint_at) > 0
             AND (
               COALESCE(julianday(lineage_row.reviewed_checkpoint_at), 0) < julianday(lineage_row.checkpoint_at)
               OR (julianday(lineage_row.reviewed_checkpoint_at) = julianday(lineage_row.checkpoint_at)
                   AND COALESCE(lineage_row.reviewed_checkpoint_id, 0) <> lineage_row.checkpoint_id)
             )
           THEN 1 ELSE 0 END AS review_needed
         FROM active_reservations ar
         JOIN resolved lineage_row ON lineage_row.order_item_id = ar.order_item_id
         LEFT JOIN inventory_stock stock ON stock.inventory_source = ar.inventory_source AND stock.variant_id = ar.variant_id
         ORDER BY ar.order_id, ar.order_item_id`
      ).bind(...(chunk || [])).all<Record<string, unknown>>();
      rows.push(...(compact.results || []));
      continue;
    }

    const orderScope = chunk
      ? `oi.order_id IN (${chunk.map(() => '?').join(',')})`
      : `r.status = 'active' AND r.variant_id IS NOT NULL
         AND o.order_status NOT IN ('deleted', 'archived')
         AND COALESCE(o.shipping_status, 'not_sent') <> 'sent'`;
    const result = await db.prepare(
      `SELECT
         oi.order_id,
         o.external_id,
         o.order_date,
         o.created_at AS order_created_at,
         customer.display_name AS customer_name,
         oi.id AS order_item_id,
         oi.product_name_snapshot,
         oi.gender_snapshot,
         oi.color_snapshot,
         oi.material_snapshot,
         oi.length_snapshot,
         oi.size_snapshot,
         oi.source_type AS item_source_type,
         oi.quantity AS item_quantity,
         oi.stock_writeoff_status,
         oi.created_at AS item_created_at,
         COALESCE(NULLIF(oi.inventory_obligation_key, ''), 'legacy-order-item:' || oi.id) AS inventory_obligation_key,
         COALESCE(NULLIF(oi.inventory_obligation_origin_at, ''), oi.created_at) AS inventory_obligation_origin_at,
         r.id AS reservation_id,
         r.status AS reservation_status,
         r.inventory_source,
         r.variant_id,
         r.quantity AS reservation_quantity,
         r.created_at AS reservation_created_at,
         stock.quantity AS physical_quantity,
         stock.reserved_quantity AS total_reserved_quantity,
         review.decision AS review_decision,
         review.checkpoint_id AS reviewed_checkpoint_id,
         review.checkpoint_at AS reviewed_checkpoint_at,
         c.id AS checkpoint_id,
         c.checked_at AS checkpoint_at,
         c.check_type AS checkpoint_type,
         fs.rowid AS full_stocktake_rowid,
         fs.id AS full_stocktake_session_id,
         fs.completed_at AS full_stocktake_completed_at,
         CASE
           WHEN c.id IS NULL THEN NULL
           WHEN datetime(c.checked_at) < datetime(COALESCE(NULLIF(oi.inventory_obligation_origin_at, ''), oi.created_at))
                AND date(c.checked_at, '+5 hours') >= date(o.order_date) THEN 'late_entry'
           ELSE 'mixed_order_after_check'
         END AS checkpoint_reason
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN customers customer ON customer.id = o.customer_id
       LEFT JOIN inventory_reservations r ON r.order_item_id = oi.id
       LEFT JOIN inventory_stock stock ON stock.inventory_source = r.inventory_source AND stock.variant_id = r.variant_id
       LEFT JOIN inventory_handover_reviews review ON review.id = (
         SELECT hr.id
         FROM inventory_handover_reviews hr
         JOIN order_items reviewed_item ON reviewed_item.id = hr.order_item_id
         WHERE hr.order_id = oi.order_id
           AND COALESCE(NULLIF(reviewed_item.inventory_obligation_key, ''), 'legacy-order-item:' || reviewed_item.id)
               = COALESCE(NULLIF(oi.inventory_obligation_key, ''), 'legacy-order-item:' || oi.id)
         ORDER BY datetime(hr.checkpoint_at) DESC, hr.checkpoint_id DESC, hr.id DESC
         LIMIT 1
       )
       LEFT JOIN inventory_stock_checks c ON c.id = (
         SELECT c2.id
         FROM inventory_stock_checks c2
         WHERE c2.inventory_source = r.inventory_source
           AND c2.variant_id = r.variant_id
           AND (
             (datetime(c2.checked_at) < datetime(COALESCE(NULLIF(oi.inventory_obligation_origin_at, ''), oi.created_at))
              AND date(c2.checked_at, '+5 hours') >= date(o.order_date))
             OR
             (EXISTS (
                SELECT 1 FROM order_items wi
                WHERE wi.order_id = oi.order_id AND COALESCE(wi.is_workshop, 0) = 1 AND wi.quantity > 0
              )
              AND datetime(c2.checked_at) > datetime(COALESCE(NULLIF(oi.inventory_obligation_origin_at, ''), oi.created_at)))
           )
         ORDER BY datetime(c2.checked_at) DESC, c2.id DESC
         LIMIT 1
       )
       LEFT JOIN inventory_stocktake_sessions fs ON fs.rowid = (
         SELECT s2.rowid
         FROM inventory_stocktake_sessions s2
         WHERE s2.inventory_source = r.inventory_source
           AND s2.status = 'completed'
           AND s2.completed_at IS NOT NULL
           AND s2.id NOT LIKE 'REV-%-P-%'
           AND datetime(s2.started_at) <= datetime(COALESCE(NULLIF(oi.inventory_obligation_origin_at, ''), oi.created_at))
           AND date(s2.completed_at, '+5 hours') >= date(o.order_date)
           AND NOT EXISTS (
             SELECT 1 FROM inventory_stock_checks exact_sku
             WHERE exact_sku.inventory_source = r.inventory_source
               AND exact_sku.variant_id = r.variant_id
               AND exact_sku.reference_type = 'stocktake'
               AND exact_sku.reference_id = s2.id
           )
         ORDER BY datetime(s2.completed_at) DESC, s2.rowid DESC
         LIMIT 1
       )
       WHERE ${orderScope}
         AND COALESCE(oi.is_workshop, 0) = 0
         AND oi.quantity > 0
       ORDER BY oi.order_id ASC, oi.id ASC`
    ).bind(...(chunk || [])).all<Record<string, unknown>>();
    rows.push(...(result.results || []));
  }
  return rows;
}


export function stockHandoverItemFromRow(row: Record<string, unknown>): OrderStockHandoverItem {
  const orderItemId = toInt(row.order_item_id, 0);
  const reservationId = toInt(row.reservation_id, 0) || null;
  const reservationStatus = cleanText(row.reservation_status);
  const stockStatus = cleanText(row.stock_writeoff_status);
  const skuCheckpointId = toInt(row.checkpoint_id, 0) || null;
  const skuCheckpointAt = cleanText(row.checkpoint_at) || null;
  const fullStocktakeRowId = Math.max(0, toInt(row.full_stocktake_rowid, 0));
  const fullStocktakeAt = cleanText(row.full_stocktake_completed_at) || null;
  const skuCheckpointMillis = normalizedUtcMillis(skuCheckpointAt);
  const fullStocktakeMillis = normalizedUtcMillis(fullStocktakeAt);
  const useFullStocktakeCheckpoint = Boolean(fullStocktakeRowId && fullStocktakeMillis > 0 && fullStocktakeMillis > skuCheckpointMillis);
  const checkpointId = useFullStocktakeCheckpoint ? -fullStocktakeRowId : skuCheckpointId;
  const checkpointAt = useFullStocktakeCheckpoint ? fullStocktakeAt : skuCheckpointAt;
  const checkpointType = useFullStocktakeCheckpoint
    ? `full_stocktake_session:${cleanText(row.full_stocktake_session_id)}`
    : (cleanText(row.checkpoint_type) || null);
  const reviewedCheckpointId = toInt(row.reviewed_checkpoint_id, 0) || null;
  const reviewedCheckpointAt = cleanText(row.reviewed_checkpoint_at) || null;
  const checkpointMillis = normalizedUtcMillis(checkpointAt);
  const reviewedMillis = normalizedUtcMillis(reviewedCheckpointAt);
  const reviewNeeded = Boolean(
    reservationStatus === 'active'
    && reservationId
    && checkpointId
    && checkpointMillis > 0
    && (checkpointMillis > reviewedMillis || (checkpointMillis === reviewedMillis && checkpointId !== reviewedCheckpointId))
  );
  const alreadyIssued = reservationStatus === 'fulfilled' || ['fulfilled', 'written_off', 'negative'].includes(stockStatus);
  const state: OrderStockHandoverItem['state'] = alreadyIssued
    ? 'already_issued'
    : reviewNeeded ? 'handover_review'
      : reservationStatus === 'active' && reservationId ? 'ready_to_issue' : 'needs_attention';
  const rawReason = useFullStocktakeCheckpoint ? 'late_entry' : cleanText(row.checkpoint_reason);
  const details = [row.gender_snapshot, row.color_snapshot, row.material_snapshot, row.length_snapshot, row.size_snapshot]
    .map((value) => cleanText(value)).filter(Boolean).join(' · ');
  return {
    orderItemId,
    productName: cleanText(row.product_name_snapshot) || `Позиция #${orderItemId}`,
    itemDetails: details,
    source: normalizeSourceType(row.inventory_source || row.item_source_type),
    quantity: Math.max(1, toInt(row.item_quantity, toInt(row.reservation_quantity, 1))),
    reservationId,
    reservationStatus,
    physicalQuantity: toInt(row.physical_quantity, 0),
    totalReservedQuantity: Math.max(0, toInt(row.total_reserved_quantity, 0)),
    checkpointId,
    checkpointAt,
    checkpointType,
    checkpointKind: handoverCheckpointKind(checkpointType),
    reviewNeeded,
    reviewReason: rawReason === 'late_entry' ? 'late_entry' : (rawReason === 'mixed_order_after_check' ? 'mixed_order_after_check' : null),
    reviewDecision: cleanText(row.review_decision) || null,
    reviewedCheckpointId,
    reviewedCheckpointAt,
    itemCreatedAt: cleanText(row.inventory_obligation_origin_at || row.item_created_at) || null,
    state,
  };
}


export async function countOrderStockHandoverReviewCandidates(db: D1Database) {
  const rows = await fetchOrderStockHandoverRows(db, [], { allActive: true });
  return rows.map(stockHandoverItemFromRow).filter((item) => item.reviewNeeded).length;
}


export async function getOrderStockHandoverState(db: D1Database, orderId: number): Promise<OrderStockHandoverState | null> {
  const order = await db.prepare(
    `SELECT o.id, o.external_id, o.order_date, o.created_at, o.order_status, o.archived_at, o.shipping_status,
            c.display_name AS customer_name
     FROM orders o
     LEFT JOIN customers c ON c.id = o.customer_id
     WHERE o.id = ?`
  ).bind(orderId).first<Record<string, unknown>>();
  if (!order?.id) return null;

  const workshop = await orderWorkshopPendingForShipping(db, orderId);
  const rows = await fetchOrderStockHandoverRows(db, [orderId]);
  const items = rows.map(stockHandoverItemFromRow);

  return {
    ok: true,
    orderId,
    externalId: cleanText(order.external_id),
    orderDate: cleanText(order.order_date),
    orderCreatedAt: cleanText(order.created_at),
    customerName: cleanText(order.customer_name),
    shippingStatus: normalizeShippingStatus(order.shipping_status),
    workshopPending: workshop.pending,
    workshopItemCount: workshop.workshopItemCount,
    activeWorkshopTaskCount: workshop.activeWorkshopTaskCount,
    items,
  };
}


export async function upsertInventoryHandoverReview(
  db: D1Database,
  input: {
    orderId: number;
    orderItemId: number;
    reservationId: number;
    decision: 'still_here' | 'issued_before_checkpoint';
    checkpointId: number;
    checkpointType: string;
    checkpointAt: string;
    reviewedBy: string;
    reviewedAt: string;
  },
) {
  return db.prepare(
    `INSERT INTO inventory_handover_reviews (
       order_id, order_item_id, reservation_id, decision, checkpoint_id, checkpoint_type, checkpoint_at, reviewed_by, reviewed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(order_item_id, checkpoint_id) DO UPDATE SET
       reservation_id = excluded.reservation_id,
       decision = excluded.decision,
       checkpoint_type = excluded.checkpoint_type,
       checkpoint_at = excluded.checkpoint_at,
       reviewed_by = excluded.reviewed_by,
       reviewed_at = excluded.reviewed_at`
  ).bind(
    input.orderId,
    input.orderItemId,
    input.reservationId,
    input.decision,
    input.checkpointId,
    input.checkpointType,
    input.checkpointAt,
    input.reviewedBy || null,
    input.reviewedAt,
  );
}


export function handoverReviewCasGuardStatement(
  db: D1Database,
  input: { orderId: number; orderItemId: number; reservationId: number; checkpointId: number; checkpointAt: string; now: string },
) {
  if (input.checkpointId > 0) {
    return db.prepare(
      `INSERT INTO inventory_model_meta (key, value, updated_at)
       SELECT 'safe_early_handover_v1_guard', '__early_handover_conflict__', ?
       WHERE
         NOT EXISTS (
           SELECT 1 FROM inventory_reservations r
           WHERE r.id = ? AND r.order_id = ? AND r.order_item_id = ? AND r.status = 'active'
         )
         OR NOT EXISTS (
           SELECT 1
           FROM inventory_stock_checks c
           JOIN inventory_reservations r ON r.id = ?
           JOIN order_items oi ON oi.id = r.order_item_id
           JOIN orders o ON o.id = r.order_id
           WHERE c.id = ? AND c.checked_at = ?
             AND c.inventory_source = r.inventory_source AND c.variant_id = r.variant_id
             AND (
               (datetime(c.checked_at) < datetime(oi.created_at) AND date(c.checked_at, '+5 hours') >= date(o.order_date))
               OR (
                 EXISTS (SELECT 1 FROM order_items wi WHERE wi.order_id = r.order_id AND COALESCE(wi.is_workshop, 0) = 1 AND wi.quantity > 0)
                 AND datetime(c.checked_at) > datetime(r.created_at)
               )
             )
         )
         OR EXISTS (
           SELECT 1
           FROM inventory_stock_checks c
           JOIN inventory_reservations r ON r.id = ?
           JOIN order_items oi ON oi.id = r.order_item_id
           JOIN orders o ON o.id = r.order_id
           WHERE c.inventory_source = r.inventory_source AND c.variant_id = r.variant_id
             AND (
               datetime(c.checked_at) > datetime(?)
               OR (datetime(c.checked_at) = datetime(?) AND c.id > ?)
             )
             AND (
               (datetime(c.checked_at) < datetime(oi.created_at) AND date(c.checked_at, '+5 hours') >= date(o.order_date))
               OR (
                 EXISTS (SELECT 1 FROM order_items wi WHERE wi.order_id = r.order_id AND COALESCE(wi.is_workshop, 0) = 1 AND wi.quantity > 0)
                 AND datetime(c.checked_at) > datetime(r.created_at)
               )
             )
         )
         OR EXISTS (
           SELECT 1
           FROM inventory_stocktake_sessions s
           JOIN inventory_reservations r ON r.id = ?
           JOIN order_items oi ON oi.id = r.order_item_id
           JOIN orders o ON o.id = r.order_id
           WHERE s.inventory_source = r.inventory_source
             AND s.status = 'completed'
             AND s.completed_at IS NOT NULL
             AND s.id NOT LIKE 'REV-%-P-%'
             AND datetime(s.completed_at) > datetime(?)
             AND datetime(s.started_at) <= datetime(oi.created_at)
             AND date(s.completed_at, '+5 hours') >= date(o.order_date)
             AND NOT EXISTS (
               SELECT 1 FROM inventory_stock_checks selected_check
               WHERE selected_check.id = ?
                 AND selected_check.reference_type = 'stocktake'
                 AND selected_check.reference_id = s.id
             )
         )`
    ).bind(
      input.now,
      input.reservationId, input.orderId, input.orderItemId,
      input.reservationId, input.checkpointId, input.checkpointAt,
      input.reservationId, input.checkpointAt, input.checkpointAt, input.checkpointId,
      input.reservationId, input.checkpointAt, input.checkpointId,
    );
  }

  const fullStocktakeRowId = Math.abs(input.checkpointId);
  return db.prepare(
    `INSERT INTO inventory_model_meta (key, value, updated_at)
     SELECT 'safe_early_handover_v1_guard', '__early_handover_conflict__', ?
     WHERE
       NOT EXISTS (
         SELECT 1 FROM inventory_reservations r
         WHERE r.id = ? AND r.order_id = ? AND r.order_item_id = ? AND r.status = 'active'
       )
       OR NOT EXISTS (
         SELECT 1
         FROM inventory_stocktake_sessions s
         JOIN inventory_reservations r ON r.id = ?
         JOIN order_items oi ON oi.id = r.order_item_id
         JOIN orders o ON o.id = r.order_id
         WHERE s.rowid = ?
           AND s.inventory_source = r.inventory_source
           AND s.status = 'completed'
           AND s.completed_at = ?
           AND s.completed_at IS NOT NULL
           AND s.id NOT LIKE 'REV-%-P-%'
           AND datetime(s.started_at) <= datetime(oi.created_at)
           AND date(s.completed_at, '+5 hours') >= date(o.order_date)
           AND NOT EXISTS (
             SELECT 1 FROM inventory_stock_checks exact_sku
             WHERE exact_sku.inventory_source = r.inventory_source
               AND exact_sku.variant_id = r.variant_id
               AND exact_sku.reference_type = 'stocktake'
               AND exact_sku.reference_id = s.id
           )
       )
       OR EXISTS (
         SELECT 1
         FROM inventory_stock_checks c
         JOIN inventory_reservations r ON r.id = ?
         JOIN order_items oi ON oi.id = r.order_item_id
         JOIN orders o ON o.id = r.order_id
         WHERE c.inventory_source = r.inventory_source AND c.variant_id = r.variant_id
           AND datetime(c.checked_at) >= datetime(?)
           AND (
             (datetime(c.checked_at) < datetime(oi.created_at) AND date(c.checked_at, '+5 hours') >= date(o.order_date))
             OR (
               EXISTS (SELECT 1 FROM order_items wi WHERE wi.order_id = r.order_id AND COALESCE(wi.is_workshop, 0) = 1 AND wi.quantity > 0)
               AND datetime(c.checked_at) > datetime(r.created_at)
             )
           )
       )
       OR EXISTS (
         SELECT 1
         FROM inventory_stocktake_sessions s
         JOIN inventory_reservations r ON r.id = ?
         JOIN order_items oi ON oi.id = r.order_item_id
         JOIN orders o ON o.id = r.order_id
         WHERE s.inventory_source = r.inventory_source
           AND s.status = 'completed'
           AND s.completed_at IS NOT NULL
           AND s.id NOT LIKE 'REV-%-P-%'
           AND (
             datetime(s.completed_at) > datetime(?)
             OR (datetime(s.completed_at) = datetime(?) AND s.rowid > ?)
           )
           AND datetime(s.started_at) <= datetime(oi.created_at)
           AND date(s.completed_at, '+5 hours') >= date(o.order_date)
           AND NOT EXISTS (
             SELECT 1 FROM inventory_stock_checks exact_sku
             WHERE exact_sku.inventory_source = r.inventory_source
               AND exact_sku.variant_id = r.variant_id
               AND exact_sku.reference_type = 'stocktake'
               AND exact_sku.reference_id = s.id
           )
       )`
  ).bind(
    input.now,
    input.reservationId, input.orderId, input.orderItemId,
    input.reservationId, fullStocktakeRowId, input.checkpointAt,
    input.reservationId, input.checkpointAt,
    input.reservationId, input.checkpointAt, input.checkpointAt, fullStocktakeRowId,
  );
}


export async function reconcileIssuedBeforeCheckpoint(
  db: D1Database,
  orderId: number,
  externalId: string,
  item: OrderStockHandoverItem,
  expectedCheckpointId: number,
  expectedCheckpointAt: string,
  actor: string,
) {
  if (!item.reservationId || item.reservationStatus !== 'active' || !item.reviewNeeded || !item.checkpointId || !item.checkpointAt) {
    throw new Error('Эта позиция уже изменилась. Обновите заказ и проверьте её ещё раз.');
  }
  if (toInt(expectedCheckpointId, 0) !== item.checkpointId || cleanText(expectedCheckpointAt) !== cleanText(item.checkpointAt)) {
    throw new Error('После открытия окна появилась более новая физическая проверка. Обновите данные и выберите действие ещё раз.');
  }
  const now = new Date().toISOString();
  const source = item.source;
  const reservationId = item.reservationId;
  const orderItemId = item.orderItemId;
  const review = await upsertInventoryHandoverReview(db, {
    orderId,
    orderItemId,
    reservationId,
    decision: 'issued_before_checkpoint',
    checkpointId: item.checkpointId,
    checkpointType: item.checkpointType || 'stock_check',
    checkpointAt: item.checkpointAt,
    reviewedBy: actor,
    reviewedAt: now,
  });

  await db.batch([
    // CAS guard: the answer is applied only to the exact physical checkpoint the user saw.
    // A concurrent reservation change or a newer physical check aborts the whole D1 batch.
    handoverReviewCasGuardStatement(db, {
      orderId, orderItemId, reservationId,
      checkpointId: item.checkpointId,
      checkpointAt: item.checkpointAt,
      now,
    }),
    review,
    db.prepare(
      `UPDATE inventory_reservations
       SET status = 'fulfilled', fulfilled_at = ?, released_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'active'`
    ).bind(now, now, reservationId),
    db.prepare(
      `UPDATE order_items
       SET stock_writeoff_status = 'fulfilled',
           stock_quantity_before = (SELECT quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = (SELECT variant_id FROM inventory_reservations WHERE id = ?) LIMIT 1),
           stock_quantity_after = (SELECT quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = (SELECT variant_id FROM inventory_reservations WHERE id = ?) LIMIT 1)
       WHERE id = ?`
    ).bind(source, reservationId, source, reservationId, orderItemId),
    db.prepare(
      `UPDATE inventory_stock
       SET reserved_quantity = COALESCE((
             SELECT SUM(r.quantity)
             FROM inventory_reservations r
             WHERE r.status = 'active'
               AND r.inventory_source = inventory_stock.inventory_source
               AND r.variant_id = inventory_stock.variant_id
           ), 0),
           last_action = 'Подтверждена ранее выданная вещь',
           last_source_ref = ?,
           updated_at = ?
       WHERE inventory_source = ?
         AND variant_id = (SELECT variant_id FROM inventory_reservations WHERE id = ?)`
    ).bind(`order:${externalId}`, now, source, reservationId),
  ]);
  try {
    await writeActivityLog(db, {
      eventType: 'order_stock_handover_reconciled',
      entityType: 'order_item',
      entityId: orderItemId,
      orderId,
      externalOrderId: externalId,
      title: `Подтверждена ранее выданная вещь по заказу ${externalId}`,
      details: `${item.productName}; физический остаток не менялся, потому что последующая ${item.checkpointKind === 'revision' ? 'ревизия' : 'сверка'} уже зафиксировала фактическое количество на ${item.checkpointAt}.`,
      createdAt: now,
    });
  } catch (error) {
    console.warn('Order stock handover activity log after committed reconciliation failed', error);
  }
}


export async function confirmItemStillHere(
  db: D1Database,
  orderId: number,
  externalId: string,
  item: OrderStockHandoverItem,
  expectedCheckpointId: number,
  expectedCheckpointAt: string,
  actor: string,
) {
  if (!item.reservationId || item.reservationStatus !== 'active' || !item.reviewNeeded || !item.checkpointId || !item.checkpointAt) {
    throw new Error('Эта позиция уже изменилась. Обновите заказ и проверьте её ещё раз.');
  }
  if (toInt(expectedCheckpointId, 0) !== item.checkpointId || cleanText(expectedCheckpointAt) !== cleanText(item.checkpointAt)) {
    throw new Error('После открытия окна появилась более новая физическая проверка. Обновите данные и выберите действие ещё раз.');
  }
  const now = new Date().toISOString();
  const review = await upsertInventoryHandoverReview(db, {
    orderId,
    orderItemId: item.orderItemId,
    reservationId: item.reservationId,
    decision: 'still_here',
    checkpointId: item.checkpointId,
    checkpointType: item.checkpointType || 'stock_check',
    checkpointAt: item.checkpointAt,
    reviewedBy: actor,
    reviewedAt: now,
  });
  await db.batch([
    handoverReviewCasGuardStatement(db, {
      orderId,
      orderItemId: item.orderItemId,
      reservationId: item.reservationId,
      checkpointId: item.checkpointId,
      checkpointAt: item.checkpointAt,
      now,
    }),
    review,
  ]);
  try {
    await writeActivityLog(db, {
      eventType: 'order_stock_handover_checked_still_here',
      entityType: 'order_item',
      entityId: item.orderItemId,
      orderId,
      externalOrderId: externalId,
      title: `Уточнено местонахождение товара по заказу ${externalId}`,
      details: `${item.productName}; подтверждено, что во время ${item.checkpointKind === 'revision' ? 'ревизии' : 'сверки'} ${item.checkpointAt} товар ещё находился у компании.`,
      createdAt: now,
    });
  } catch (error) {
    console.warn('Order stock handover activity log after committed location check failed', error);
  }
}


export async function orderHandoverReviewBlockers(db: D1Database, orderId: number) {
  const state = await getOrderStockHandoverState(db, orderId);
  return state ? state.items.filter((item) => item.reviewNeeded) : [];
}


export type ShipmentInventoryObservation = {
  source: SourceType;
  variantId: number;
  expectedQuantity: number;
  countedQuantity: number;
};


export type ShipmentFulfillmentOptions = {
  observations?: ShipmentInventoryObservation[];
  shippingDate?: string | null;
  checkedBy?: string | null;
  orderItemIds?: number[];
};


export function normalizeShipmentObservations(input: unknown): ShipmentInventoryObservation[] {
  if (!Array.isArray(input)) return [];
  const map = new Map<string, ShipmentInventoryObservation>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const source = normalizeSourceType(row.source);
    const variantId = toInt(row.variantId, 0);
    const expectedQuantity = toInt(row.expectedQuantity, 0);
    const countedQuantity = toInt(row.countedQuantity, -1);
    if (!variantId || countedQuantity < 0) throw new Error('Некорректные данные фактической сверки перед отправкой. Обновите заказ и повторите.');
    const key = `${source}:${variantId}`;
    const next = { source, variantId, expectedQuantity, countedQuantity };
    const existing = map.get(key);
    if (existing && (existing.expectedQuantity !== next.expectedQuantity || existing.countedQuantity !== next.countedQuantity)) {
      throw new Error('Для одной позиции переданы разные фактические количества. Обновите заказ и повторите отправку.');
    }
    map.set(key, next);
  }
  return Array.from(map.values());
}


export async function fulfillOrderReservationsV2(
  db: D1Database,
  orderId: number,
  externalId: string,
  timestamp: string,
  options: ShipmentFulfillmentOptions = {},
) {
  const scopedOrderItemIds = Array.from(new Set((options.orderItemIds || []).map((value) => toInt(value, 0)).filter((value) => value > 0)));
  const scopeSql = scopedOrderItemIds.length
    ? ` AND r.order_item_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
    : '';
  const reservationBindings: Array<string | number> = [orderId];
  if (scopedOrderItemIds.length) reservationBindings.push(JSON.stringify(scopedOrderItemIds));
  const rows = await db.prepare(
    `SELECT r.*, oi.product_name_snapshot
     FROM inventory_reservations r
     JOIN order_items oi ON oi.id = r.order_item_id
     WHERE r.order_id = ? AND r.status IN ('active', 'unresolved')${scopeSql}
     ORDER BY r.id ASC`
  ).bind(...reservationBindings).all<Record<string, unknown>>();
  const reservations = rows.results || [];
  const unresolved = reservations.filter((row) => cleanText(row.status) === 'unresolved' || !toInt(row.variant_id, 0));
  if (unresolved.length) {
    // Shipping remains all-or-nothing. Never issue the known siblings of an unresolved line.
    return { fulfilled: 0, unresolved: unresolved.length };
  }

  const observations = normalizeShipmentObservations(options.observations);
  const observationsByKey = new Map(observations.map((row) => [`${row.source}:${row.variantId}`, row]));
  if (!reservations.length) {
    // Workshop-only orders may legitimately have no warehouse reservation. Status still belongs in
    // the same commit API so a retry cannot create a split brain between the order and inventory.
    if (options.shippingDate) {
      await db.prepare(
        `UPDATE orders SET shipping_status = 'sent', shipping_date = ?, updated_at = ? WHERE id = ? AND COALESCE(shipping_status, 'not_sent') <> 'sent'`
      ).bind(options.shippingDate, timestamp, orderId).run();
    }
    return { fulfilled: 0, unresolved: 0, observationsApplied: 0 };
  }

  const physicalRequirements = new Map<string, {
    source: SourceType;
    variantId: number;
    required: number;
    productName: string;
  }>();
  for (const reservation of reservations) {
    if (cleanText(reservation.status) !== 'active') continue;
    const source = normalizeSourceType(reservation.inventory_source);
    const variantId = toInt(reservation.variant_id, 0);
    const key = `${source}:${variantId}`;
    const current = physicalRequirements.get(key);
    physicalRequirements.set(key, {
      source,
      variantId,
      required: (current?.required || 0) + Math.max(1, toInt(reservation.quantity, 1)),
      productName: current?.productName || cleanText(reservation.product_name_snapshot) || `variant #${variantId}`,
    });
  }

  type ShipmentStockState = {
    id: number;
    source: SourceType;
    variantId: number;
    quantity: number;
    reservedQuantity: number;
    effectiveQuantity: number;
    required: number;
    canonical: {
      productId: number;
      variantId: number;
      productName: string;
      gender: string | null;
      color: string | null;
      material: string | null;
      length: string | null;
      size: string | null;
    };
    observation: ShipmentInventoryObservation | null;
  };
  const stockByKey = new Map<string, ShipmentStockState>();

  // Step 191E: load all stock/canonical shipment states in one D1 read. The old loop performed a
  // stock lookup and canonical lookup for every distinct reservation SKU and could exhaust the
  // Free-plan D1 query budget before the atomic fulfillment batch even started.
  const requirementPayload = JSON.stringify(Array.from(physicalRequirements.values()).map(row => ({
    source: row.source,
    variantId: row.variantId,
  })));
  const stockRows = await db.prepare(
    `WITH wanted AS (
       SELECT CAST(json_extract(j.value, '$.source') AS TEXT) AS source,
              CAST(json_extract(j.value, '$.variantId') AS INTEGER) AS variant_id
       FROM json_each(?) j
     )
     SELECT w.source, w.variant_id,
            s.id AS stock_id, s.quantity, s.reserved_quantity,
            v.product_id, p.name AS product_name, v.gender, v.color, v.material, v.length, v.size_label
     FROM wanted w
     LEFT JOIN inventory_stock s ON s.inventory_source = w.source AND s.variant_id = w.variant_id
     LEFT JOIN catalog_variants v ON v.id = w.variant_id
     LEFT JOIN catalog_products p ON p.id = v.product_id`
  ).bind(requirementPayload).all<Record<string, unknown>>();
  const loadedByKey = new Map((stockRows.results || []).map(row => [`${cleanText(row.source)}:${toInt(row.variant_id, 0)}`, row]));

  for (const requirement of physicalRequirements.values()) {
    const key = `${requirement.source}:${requirement.variantId}`;
    const loaded = loadedByKey.get(key);
    if (!loaded?.stock_id) {
      throw new Error(`Не найдена каноническая позиция остатка для отправки «${requirement.productName}». Отправка остановлена.`);
    }
    if (!toInt(loaded.product_id, 0) || !cleanText(loaded.product_name)) {
      throw new Error(`Не удалось загрузить каталог для отправки «${requirement.productName}». Обновите заказ.`);
    }
    const quantity = toInt(loaded.quantity, 0);
    const observation = observationsByKey.get(key) || null;
    if (observation && observation.expectedQuantity !== quantity) {
      throw new Error(`Остаток «${requirement.productName}» изменился после открытия формы: было ${observation.expectedQuantity}, сейчас ${quantity}. Обновите заказ и пересчитайте товар.`);
    }
    const effectiveQuantity = observation ? observation.countedQuantity : quantity;
    // A physical shortage is an inventory discrepancy, not a reason to block customer handover.
    // Shipping consumes only the stock that is actually present and never drives physical quantity below zero.
    stockByKey.set(key, {
      id: toInt(loaded.stock_id, 0),
      source: requirement.source,
      variantId: requirement.variantId,
      quantity,
      reservedQuantity: Math.max(0, toInt(loaded.reserved_quantity, 0)),
      effectiveQuantity,
      required: requirement.required,
      canonical: {
        productId: toInt(loaded.product_id, 0),
        variantId: requirement.variantId,
        productName: cleanText(loaded.product_name),
        gender: cleanText(loaded.gender) || null,
        color: cleanText(loaded.color) || null,
        material: canonicalStockPositionValue(loaded.material) || null,
        length: canonicalStockPositionValue(loaded.length) || null,
        size: cleanText(loaded.size_label) || null,
      },
      observation,
    });
  }

  // Reject observations for SKU that are not part of this shipment. A stale/forged UI must never
  // be able to use the shipping endpoint as a generic stock editor.
  for (const observation of observations) {
    if (!physicalRequirements.has(`${observation.source}:${observation.variantId}`)) {
      throw new Error('Фактическая сверка относится к позиции, которой нет в текущей отправке. Обновите заказ.');
    }
  }

  const stockPayloads = Array.from(stockByKey.values()).map(state => JSON.stringify({
    stockId: state.id,
    source: state.source,
    variantId: state.variantId,
    currentQuantity: state.quantity,
    effectiveQuantity: state.effectiveQuantity,
    required: state.required,
    reservedQuantity: state.reservedQuantity,
    productId: state.canonical.productId,
    productName: state.canonical.productName,
    gender: state.canonical.gender,
    color: state.canonical.color,
    material: state.canonical.material,
    length: state.canonical.length,
    size: state.canonical.size,
    observed: state.observation ? state.observation.countedQuantity : null,
  }));

  const activeReservationPayloads: string[] = [];
  const remainingByKey = new Map(Array.from(stockByKey.entries()).map(([key, state]) => [key, state.effectiveQuantity]));
  for (const reservation of reservations) {
    if (cleanText(reservation.status) !== 'active') continue;
    const source = normalizeSourceType(reservation.inventory_source);
    const variantId = toInt(reservation.variant_id, 0);
    const key = `${source}:${variantId}`;
    const state = stockByKey.get(key);
    if (!state) throw new Error('Не удалось подготовить складскую позицию для отправки. Обновите заказ.');
    const quantity = Math.max(1, toInt(reservation.quantity, 1));
    const quantityBefore = remainingByKey.get(key) ?? state.effectiveQuantity;
    const quantityAfter = Math.max(0, quantityBefore - quantity);
    remainingByKey.set(key, quantityAfter);
    activeReservationPayloads.push(JSON.stringify({
      reservationId: toInt(reservation.id, 0),
      orderItemId: toInt(reservation.order_item_id, 0),
      stockId: state.id,
      source,
      productId: state.canonical.productId,
      variantId,
      productName: state.canonical.productName,
      gender: state.canonical.gender,
      color: state.canonical.color,
      material: state.canonical.material,
      length: state.canonical.length,
      size: state.canonical.size,
      quantity,
      quantityBefore,
      quantityAfter,
      referenceType: cleanText(reservation.reference_type) || 'order',
      referenceId: cleanText(reservation.reference_id) || externalId,
    }));
  }

  const statements: D1PreparedStatement[] = [];
  for (const payloadChunk of chunksOf(stockPayloads, 70)) {
    const valuesSql = payloadChunk.map(() => '(?)').join(', ');
    const cte = `input(payload) AS (VALUES ${valuesSql}),
      x AS (
        SELECT CAST(json_extract(payload, '$.stockId') AS INTEGER) AS stock_id,
               CAST(json_extract(payload, '$.source') AS TEXT) AS source,
               CAST(json_extract(payload, '$.variantId') AS INTEGER) AS variant_id,
               CAST(json_extract(payload, '$.currentQuantity') AS INTEGER) AS current_quantity,
               CAST(json_extract(payload, '$.effectiveQuantity') AS INTEGER) AS effective_quantity,
               CAST(json_extract(payload, '$.required') AS INTEGER) AS required,
               CAST(json_extract(payload, '$.reservedQuantity') AS INTEGER) AS reserved_quantity,
               CAST(json_extract(payload, '$.productId') AS INTEGER) AS product_id,
               CAST(json_extract(payload, '$.productName') AS TEXT) AS product_name,
               json_extract(payload, '$.gender') AS gender,
               json_extract(payload, '$.color') AS color,
               json_extract(payload, '$.material') AS material,
               json_extract(payload, '$.length') AS length,
               json_extract(payload, '$.size') AS size,
               CASE WHEN json_type(payload, '$.observed') = 'null' THEN NULL
                    ELSE CAST(json_extract(payload, '$.observed') AS INTEGER) END AS observed
        FROM input
      )`;
    statements.push(db.prepare(
      `WITH ${cte}
       INSERT INTO inventory_model_meta (key, value, updated_at)
       SELECT 'human_inventory_v2', '__shipping_conflict__', ?
       WHERE EXISTS (
         SELECT 1 FROM x
         LEFT JOIN inventory_stock s ON s.id = x.stock_id
         WHERE s.id IS NULL OR COALESCE(s.quantity, 0) <> x.current_quantity
       )`
    ).bind(...payloadChunk, timestamp));

    if (payloadChunk.some(payload => JSON.parse(payload).observed !== null)) {
      statements.push(
        db.prepare(
          `WITH ${cte}
           UPDATE inventory_stock
           SET quantity = (SELECT x.effective_quantity FROM x WHERE x.stock_id = inventory_stock.id),
               product_id = (SELECT x.product_id FROM x WHERE x.stock_id = inventory_stock.id),
               variant_id = (SELECT x.variant_id FROM x WHERE x.stock_id = inventory_stock.id),
               product_name_snapshot = (SELECT x.product_name FROM x WHERE x.stock_id = inventory_stock.id),
               gender_snapshot = (SELECT x.gender FROM x WHERE x.stock_id = inventory_stock.id),
               color_snapshot = (SELECT x.color FROM x WHERE x.stock_id = inventory_stock.id),
               material_snapshot = (SELECT x.material FROM x WHERE x.stock_id = inventory_stock.id),
               length_snapshot = (SELECT x.length FROM x WHERE x.stock_id = inventory_stock.id),
               size_snapshot = (SELECT x.size FROM x WHERE x.stock_id = inventory_stock.id),
               last_action = 'Сверено перед отправкой', last_source_ref = ?, updated_at = ?
           WHERE EXISTS (SELECT 1 FROM x WHERE x.stock_id = inventory_stock.id AND x.observed IS NOT NULL)`
        ).bind(...payloadChunk, `order:${externalId}`, timestamp),
        db.prepare(
          `WITH ${cte}
           INSERT INTO inventory_movements (
             inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
             color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
             reference_type, reference_id, comment, created_at
           )
           SELECT x.source, 'revision', x.product_id, x.variant_id, x.product_name, x.gender,
                  x.color, x.material, x.length, x.size, x.effective_quantity - x.current_quantity, x.effective_quantity,
                  'shipping_observation', ?,
                  'Фактическая сверка перед отправкой заказа ' || ? || ': ' || x.effective_quantity || ' шт. По учёту до сверки: ' || x.current_quantity || ' шт. Резервы сохранены.', ?
           FROM x WHERE x.observed IS NOT NULL`
        ).bind(...payloadChunk, externalId, externalId, timestamp),
        db.prepare(
          `WITH ${cte}
           INSERT OR IGNORE INTO inventory_stock_checks (
             check_key, inventory_source, product_id, variant_id,
             expected_quantity, counted_quantity, difference_quantity, reserved_quantity,
             check_type, reference_type, reference_id, checked_by, checked_at, created_at
           )
           SELECT 'shipping:' || ? || ':' || x.source || ':' || x.variant_id,
                  x.source, x.product_id, x.variant_id, x.current_quantity, x.effective_quantity,
                  x.effective_quantity - x.current_quantity, x.reserved_quantity,
                  'shipping_observation', 'order', ?, ?, ?, ?
           FROM x WHERE x.observed IS NOT NULL`
        ).bind(...payloadChunk, orderId, externalId, cleanText(options.checkedBy) || null, timestamp, timestamp),
      );
    }

    statements.push(db.prepare(
      `WITH ${cte}
       UPDATE inventory_stock
       SET quantity = MAX(0, (SELECT x.effective_quantity - x.required FROM x WHERE x.stock_id = inventory_stock.id)),
           reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) - (SELECT x.required FROM x WHERE x.stock_id = inventory_stock.id)),
           last_action = 'Выдано / отправлено', last_source_ref = ?, updated_at = ?
       WHERE EXISTS (SELECT 1 FROM x WHERE x.stock_id = inventory_stock.id)`
    ).bind(...payloadChunk, `order:${externalId}`, timestamp));
  }

  for (const payloadChunk of chunksOf(activeReservationPayloads, 70)) {
    const valuesSql = payloadChunk.map(() => '(?)').join(', ');
    const cte = `input(payload) AS (VALUES ${valuesSql}),
      x AS (
        SELECT CAST(json_extract(payload, '$.reservationId') AS INTEGER) AS reservation_id,
               CAST(json_extract(payload, '$.orderItemId') AS INTEGER) AS order_item_id,
               CAST(json_extract(payload, '$.stockId') AS INTEGER) AS stock_id,
               CAST(json_extract(payload, '$.source') AS TEXT) AS source,
               CAST(json_extract(payload, '$.productId') AS INTEGER) AS product_id,
               CAST(json_extract(payload, '$.variantId') AS INTEGER) AS variant_id,
               CAST(json_extract(payload, '$.productName') AS TEXT) AS product_name,
               json_extract(payload, '$.gender') AS gender,
               json_extract(payload, '$.color') AS color,
               json_extract(payload, '$.material') AS material,
               json_extract(payload, '$.length') AS length,
               json_extract(payload, '$.size') AS size,
               CAST(json_extract(payload, '$.quantity') AS INTEGER) AS quantity,
               CAST(json_extract(payload, '$.quantityBefore') AS INTEGER) AS quantity_before,
               CAST(json_extract(payload, '$.quantityAfter') AS INTEGER) AS quantity_after,
               CAST(json_extract(payload, '$.referenceType') AS TEXT) AS reference_type,
               CAST(json_extract(payload, '$.referenceId') AS TEXT) AS reference_id
        FROM input
      )`;
    statements.push(
      db.prepare(
        `WITH ${cte}
         INSERT INTO inventory_movements (
           inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
           color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
           reference_type, reference_id, comment, created_at
         )
         SELECT x.source, 'sale', x.product_id, x.variant_id, x.product_name, x.gender,
                x.color, x.material, x.length, x.size, x.quantity_after - x.quantity_before, x.quantity_after,
                x.reference_type, x.reference_id, ?, ?
         FROM x`
      ).bind(...payloadChunk, `Физическое списание при выдаче / отправке заказа ${externalId}`, timestamp),
      db.prepare(
        `WITH ${cte}
         UPDATE order_items
         SET stock_writeoff_status = 'fulfilled',
             stock_quantity_before = (SELECT x.quantity_before FROM x WHERE x.order_item_id = order_items.id),
             stock_quantity_after = (SELECT x.quantity_after FROM x WHERE x.order_item_id = order_items.id)
         WHERE EXISTS (SELECT 1 FROM x WHERE x.order_item_id = order_items.id)`
      ).bind(...payloadChunk),
      db.prepare(
        `WITH ${cte}
         UPDATE inventory_reservations
         SET status = 'fulfilled', fulfilled_at = ?, updated_at = ?
         WHERE status = 'active' AND EXISTS (SELECT 1 FROM x WHERE x.reservation_id = inventory_reservations.id)`
      ).bind(...payloadChunk, timestamp, timestamp),
    );
  }

  if (options.shippingDate) {
    statements.push(db.prepare(
      `UPDATE orders
       SET shipping_status = 'sent', shipping_date = ?, updated_at = ?
       WHERE id = ? AND COALESCE(shipping_status, 'not_sent') <> 'sent'`
    ).bind(options.shippingDate, timestamp, orderId));
  }

  if (statements.length) await db.batch(statements);
  return { fulfilled: activeReservationPayloads.length, unresolved: 0, observationsApplied: observations.length };
}


export async function getOrderShipmentInventoryBlockers(db: D1Database, orderId: number) {
  const unresolvedResult = await db.prepare(
    `SELECT oi.id, oi.product_name_snapshot, oi.stock_writeoff_status,
            r.status AS reservation_status, r.variant_id AS reservation_variant_id,
            stock.id AS inventory_stock_id,
            'unresolved' AS blocker_reason,
            NULL AS required_quantity,
            NULL AS physical_quantity
     FROM order_items oi
     LEFT JOIN inventory_reservations r ON r.order_item_id = oi.id
     LEFT JOIN inventory_stock stock
       ON stock.inventory_source = r.inventory_source AND stock.variant_id = r.variant_id
     WHERE oi.order_id = ?
       AND COALESCE(oi.is_workshop, 0) = 0
       AND oi.quantity > 0
       AND COALESCE(oi.stock_writeoff_status, '') NOT IN ('fulfilled', 'written_off', 'negative', 'catalog_excluded', 'catalog_excluded_history', 'workshop_no_catalog')
       AND (r.id IS NULL OR r.status <> 'active' OR r.variant_id IS NULL OR stock.id IS NULL)
     ORDER BY oi.id ASC
     LIMIT 20`
  ).bind(orderId).all<Record<string, unknown>>();

  const shortageResult = await db.prepare(
    `SELECT MIN(oi.id) AS id,
            MIN(oi.product_name_snapshot) AS product_name_snapshot,
            'insufficient_physical' AS blocker_reason,
            SUM(r.quantity) AS required_quantity,
            COALESCE(stock.quantity, 0) AS physical_quantity,
            r.inventory_source,
            r.variant_id AS reservation_variant_id
     FROM inventory_reservations r
     JOIN order_items oi ON oi.id = r.order_item_id
     LEFT JOIN inventory_stock stock
       ON stock.inventory_source = r.inventory_source AND stock.variant_id = r.variant_id
     WHERE r.order_id = ?
       AND r.status = 'active'
       AND r.variant_id IS NOT NULL
       AND oi.quantity > 0
       AND COALESCE(oi.is_workshop, 0) = 0
       AND COALESCE(oi.stock_writeoff_status, '') NOT IN ('fulfilled', 'written_off', 'negative', 'catalog_excluded', 'catalog_excluded_history', 'workshop_no_catalog')
     GROUP BY r.inventory_source, r.variant_id, stock.quantity
     HAVING COALESCE(stock.quantity, 0) < SUM(r.quantity)
     ORDER BY MIN(oi.id) ASC
     LIMIT 20`
  ).bind(orderId).all<Record<string, unknown>>();

  // Keep computing shortages for diagnostics/attention, but they no longer hard-block shipping.
  void shortageResult;
  return [...(unresolvedResult.results || [])];
}


export function orderShipmentInventoryBlockerMessage(blockers: Record<string, unknown>[]) {
  const shortage = blockers.find((row) => cleanText(row.blocker_reason) === 'insufficient_physical');
  if (shortage) {
    const name = cleanText(shortage.product_name_snapshot) || `позиция #${toInt(shortage.id, 0)}`;
    const physical = Math.max(0, toInt(shortage.physical_quantity, 0));
    const required = Math.max(1, toInt(shortage.required_quantity, 1));
    return `Нельзя отправить заказ целиком: «${name}» — на месте ${physical} шт., требуется ${required}. Если товар физически есть, сначала уточните фактический остаток.`;
  }
  const names = blockers.slice(0, 3).map((row) => cleanText(row.product_name_snapshot) || `позиция #${toInt(row.id, 0)}`).join(', ');
  return `Нельзя отметить заказ отправленным: ${blockers.length} складск${blockers.length === 1 ? 'ая позиция ещё не распознана' : 'их позиции ещё не распознаны'} (${names}). Сначала разберите их в «Склад → Товары → Требуют разбора», чтобы физическое списание не потерялось.`;
}
