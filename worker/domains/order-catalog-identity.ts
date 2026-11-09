// Catalog product/variant identity resolution for orders; preserved from order-reservations.ts.
// No inventory reservation, physical stock, or shipment mutations live in this module.
import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, toInt, upperText } from '../core/text.ts'
import { catalogGenderForProductScope, createCatalogCombinationV3, ensureCatalogExecutionV3, findCatalogCombinationV3, findCatalogExecutionV3, findCatalogProductByIdentity, findRetiredCatalogCombinationV3, findRetiredCatalogExecutionV3, getCatalogProductGenderScope, isCatalogIdentityV3Enabled, isHumanInventoryModelEnabled, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, resolveCatalogValueAlias } from './catalog.ts'
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
  matchStatus?: 'matched' | 'alias' | 'created_combination' | 'unresolved_product' | 'unresolved_execution' | 'unresolved_attribute' | 'unresolved_variant' | 'retired_historical';
  inputKey?: string;
};

export type OrderRetiredCatalogConfirmationItem = {
  inputIndex: number;
  confirmationKey: string;
  entityType: 'product' | 'execution' | 'variant';
  productName: string;
  category: string;
  gender: string;
  color: string;
  material: string;
  length: string;
  size: string;
};

export class OrderRetiredCatalogConfirmationError extends Error {
  readonly code = 'order_retired_catalog_confirmation_required';
  readonly status = 409;
  readonly items: OrderRetiredCatalogConfirmationItem[];

  constructor(items: OrderRetiredCatalogConfirmationItem[]) {
    const first = items[0];
    const label = first?.productName ? ` «${first.productName}»` : '';
    const suffix = items.length > 1 ? ` Ещё удалённых позиций: ${items.length - 1}.` : '';
    super(`Позиция${label} раньше была удалена из рабочего каталога. Подтвердите, что хотите вернуть её как новую рабочую позицию без старых остатков и резервов.${suffix}`);
    this.name = 'OrderRetiredCatalogConfirmationError';
    this.items = items;
  }
}


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


export function catalogKnownFactIdentity(value: unknown) {
  return upperText(value)
    .replace(/[‐‑‒–—-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}


export async function loadCatalogKnownFacts(db: D1Database) {
  const rows = await db.prepare(
    `SELECT kind, value FROM reference_values
     WHERE is_active = 1 AND kind IN ('material','length','color','size','child_age')
     UNION
     SELECT 'material' AS kind, material AS value FROM catalog_stock_positions
     WHERE is_active = 1 AND TRIM(COALESCE(material, '')) <> ''
     UNION
     SELECT 'length' AS kind, length AS value FROM catalog_stock_positions
     WHERE is_active = 1 AND TRIM(COALESCE(length, '')) <> ''
     UNION
     SELECT 'color' AS kind, color AS value FROM catalog_variants
     WHERE is_active = 1 AND TRIM(COALESCE(color, '')) <> ''
     UNION
     SELECT CASE WHEN COALESCE(category, 'adult') = 'child' THEN 'child_age' ELSE 'size' END AS kind, size_label AS value
     FROM catalog_variants
     WHERE is_active = 1 AND TRIM(COALESCE(size_label, '')) <> ''`
  ).all<{ kind: string; value: string }>()

  const byKind = new Map<string, Map<string, string>>()
  for (const row of rows.results || []) {
    const identity = catalogKnownFactIdentity(row.value)
    if (!identity) continue
    const kindMap = byKind.get(row.kind) || new Map<string, string>()
    if (!kindMap.has(identity)) kindMap.set(identity, upperText(row.value))
    byKind.set(row.kind, kindMap)
  }
  return {
    resolve(kind: 'material' | 'length' | 'color' | 'size' | 'child_age', value: unknown) {
      const identity = catalogKnownFactIdentity(value)
      return identity ? (byKind.get(kind)?.get(identity) || '') : ''
    },
  }
}


export async function inspectOrderRetiredCatalogIdentityV2(
  db: D1Database,
  item: ReturnType<typeof normalizeOrderItems>[number],
): Promise<Omit<OrderRetiredCatalogConfirmationItem, 'inputIndex'> | null> {
  if (!await isCatalogIdentityV3Enabled(db)) return null;
  const confirmationKey = catalogOrderInputKey(item);

  let product = await findCatalogProductByIdentity(db, item.productName, 0, { activeOnly: true }) as { id: number; name: string; category: string } | null;
  if (!product?.id) {
    const historical = await findCatalogProductByIdentity(db, item.productName, 0, { allowAlias: false }) as { id: number; name: string; category: string } | null;
    if (!historical?.id) return null;
    const inactive = await db.prepare(
      `SELECT id, name, category
       FROM catalog_products
       WHERE id = ? AND is_active = 0
       LIMIT 1`
    ).bind(historical.id).first<{ id: number; name: string; category: string }>();
    if (!inactive?.id) return null;
    return {
      confirmationKey,
      entityType: 'product',
      productName: cleanText(inactive.name) || item.productName,
      category: normalizeAudienceCategory(item.category, item.size),
      gender: normalizeCatalogCombinationGender(item.gender),
      color: normalizeCatalogCombinationColor(item.color),
      material: canonicalStockPositionValue(item.material),
      length: canonicalStockPositionValue(item.length),
      size: normalizeCatalogCombinationSize(item.size),
    };
  }

  const category = normalizeAudienceCategory(item.category, item.size);
  const material = canonicalStockPositionValue(await resolveCatalogValueAlias(db, 'material', canonicalStockPositionValue(item.material)));
  const length = canonicalStockPositionValue(await resolveCatalogValueAlias(db, 'length', canonicalStockPositionValue(item.length)));
  let gender = normalizeCatalogCombinationGender(item.gender);
  if (!gender) {
    gender = catalogGenderForProductScope(await getCatalogProductGenderScope(db, product.id));
  }
  const color = normalizeCatalogCombinationColor(await resolveCatalogValueAlias(db, 'color', normalizeCatalogCombinationColor(item.color)));
  const sizeKind = category === 'child' ? 'child_age' : 'size';
  const size = normalizeCatalogCombinationSize(await resolveCatalogValueAlias(db, sizeKind, normalizeCatalogCombinationSize(item.size)));

  // If the input is incomplete, the normal resolver will ask for clarification and cannot
  // silently recreate an exact retired SKU. Do not manufacture a retirement confirmation
  // from incomplete evidence.
  if (!material || !length || !gender || !color || !size) return null;

  const activeExecution = await findCatalogExecutionV3(db, product.id, material, length);
  if (!activeExecution?.id) {
    const retiredExecution = await findRetiredCatalogExecutionV3(db, product.id, material, length);
    if (!retiredExecution?.id) return null;
    return {
      confirmationKey,
      entityType: 'execution',
      productName: cleanText(product.name) || item.productName,
      category,
      gender,
      color,
      material,
      length,
      size,
    };
  }

  const activeVariant = await findCatalogCombinationV3(db, activeExecution.id, category, gender, color, size);
  if (activeVariant?.id) return null;

  const retiredVariant = await findRetiredCatalogCombinationV3(db, activeExecution.id, category, gender, color, size);
  if (!retiredVariant?.id) return null;
  return {
    confirmationKey,
    entityType: 'variant',
    productName: cleanText(product.name) || item.productName,
    category,
    gender,
    color,
    material,
    length,
    size,
  };
}


export async function resolveCatalogProductAndVariantV2(
  db: D1Database,
  item: ReturnType<typeof normalizeOrderItems>[number],
  options: { allowRetiredRecreate?: boolean; timestamp?: string; createMissing?: boolean } = {},
): Promise<ResolvedOrderCatalogReference> {
  if (!await isCatalogIdentityV3Enabled(db)) return await resolveCatalogProductAndVariantV2Flat(db, item);
  const inputKey = catalogOrderInputKey(item);
  const allowRetiredRecreate = Boolean(options.allowRetiredRecreate);
  const timestamp = cleanText(options.timestamp) || new Date().toISOString();

  let product = await findCatalogProductByIdentity(db, item.productName, 0, { activeOnly: true }) as { id: number; name: string; category: string } | null;
  let retiredProductShell = false;
  if (!product?.id && allowRetiredRecreate) {
    const retiredIdentity = await findCatalogProductByIdentity(db, item.productName, 0, { allowAlias: false }) as { id: number; name: string; category: string } | null;
    if (retiredIdentity?.id) {
      const inactive = await db.prepare(
        `SELECT id, name, category, is_active
         FROM catalog_products
         WHERE id = ? AND is_active = 0
         LIMIT 1`
      ).bind(retiredIdentity.id).first<{ id: number; name: string; category: string; is_active: number }>();
      if (inactive?.id) {
        product = { id: toInt(inactive.id, 0), name: cleanText(inactive.name), category: cleanText(inactive.category) };
        retiredProductShell = true;
      }
    }
  }
  if (!product?.id) return { productId: null, variantId: null, matchStatus: 'unresolved_product', inputKey };

  const category = normalizeAudienceCategory(item.category, item.size);
  const knownFacts = await loadCatalogKnownFacts(db);
  const aliasedMaterial = await resolveCatalogValueAlias(db, 'material', canonicalStockPositionValue(item.material));
  const aliasedLength = await resolveCatalogValueAlias(db, 'length', canonicalStockPositionValue(item.length));
  const material = knownFacts.resolve('material', aliasedMaterial);
  const length = knownFacts.resolve('length', aliasedLength);
  const enteredGender = normalizeCatalogCombinationGender(item.gender);
  let gender = enteredGender;
  const productGenderScope = await getCatalogProductGenderScope(db, product.id);
  const fixedProductGender = catalogGenderForProductScope(productGenderScope);
  // Explicitly identified male/female SKU may differ from product default.
  if (!gender) {
    gender = fixedProductGender;
    if (!gender) {
      return { productId: toInt(product.id, 0) || null, variantId: null, matchStatus: 'unresolved_attribute', inputKey };
    }
  }
  const rawColor = upperText(item.color);
  const rawSize = upperText(item.size);
  const aliasedColor = await resolveCatalogValueAlias(db, 'color', normalizeCatalogCombinationColor(item.color));
  const sizeKind = category === 'child' ? 'child_age' : 'size';
  const aliasedSize = await resolveCatalogValueAlias(db, sizeKind, normalizeCatalogCombinationSize(item.size));
  const color = knownFacts.resolve('color', aliasedColor);
  const size = knownFacts.resolve(sizeKind, aliasedSize);

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
      let omittedSizeConflictsWithConcreteSibling = false;
      if (!rawSize) {
        const sizeProfile = await db.prepare(
          `SELECT MAX(CASE WHEN TRIM(COALESCE(size_label,'')) <> '' AND UPPER(TRIM(size_label)) NOT IN ('БЕЗ РАЗМЕРА','БЕЗРАЗМЕРА','Б/Р','НЕ УКАЗАН') THEN 1 ELSE 0 END) AS has_size
           FROM catalog_variants
           WHERE product_id = ? AND stock_position_id = ? AND is_active = 1
             AND COALESCE(category,'adult') = ?
             AND COALESCE(gender,'') = COALESCE(?, '')
             AND COALESCE(color,'') = COALESCE(?, '')`
        ).bind(product.id, existingExecution.id, category, gender || null, color || null).first<{ has_size: number }>();
        omittedSizeConflictsWithConcreteSibling = toInt(sizeProfile?.has_size, 0) > 0;
      }
      if (!omittedColorConflictsWithConcreteSibling && !omittedSizeConflictsWithConcreteSibling) {
        return { productId: toInt(product.id, 0) || null, variantId: toInt(existing.id, 0) || null, matchStatus: 'matched', inputKey };
      }
      return { productId: toInt(product.id, 0) || null, variantId: null, matchStatus: 'unresolved_attribute', inputKey };
    }
  }

  // Never synthesize a new БЕЗ ЦВЕТА SKU merely because the manager left color empty.
  // One-size/unisex cases are intentionally not guessed here; their UI semantics are handled
  // separately so existing legitimate dimensionless variants are not broken by this cleanup.
  if (!rawColor || !rawSize) {
    return { productId: toInt(product.id, 0) || null, variantId: null, matchStatus: 'unresolved_attribute', inputKey };
  }

  // Unknown input still stops before any master-data mutation. Recognized human facts
  // are accepted independently of whether this exact SKU combination existed before.
  if (
    !material
    || !length
    || (gender && gender !== 'ЖЕН' && gender !== 'МУЖ')
    || (rawColor && !color)
    || (rawSize && !size)
  ) {
    return { productId: toInt(product.id, 0) || null, variantId: null, matchStatus: 'unresolved_attribute', inputKey };
  }

  // Runtime orders/exchanges/reconciliation may recognize existing catalog SKUs
  // but must not create a new execution or variant implicitly. Explicit catalog
  // and stocktake creation continue through their dedicated controlled endpoints.
  if (options.createMissing === false) {
    return {
      productId: toInt(product.id, 0) || null,
      variantId: null,
      matchStatus: existingExecution?.id ? 'unresolved_variant' : 'unresolved_execution',
      inputKey,
    };
  }

  // Only now may known facts create a previously unseen execution/combination.
  // Retired identity is fail-closed for background/runtime resolution. A deliberate NEW order
  // save may start a fresh working generation, but never reactivates the retired execution/SKU rows.
  let retiredExecution: Awaited<ReturnType<typeof findRetiredCatalogExecutionV3>> = null;
  if (!existingExecution?.id) {
    retiredExecution = await findRetiredCatalogExecutionV3(db, product.id, material, length);
    if (retiredExecution?.id && !allowRetiredRecreate) {
      return { productId: toInt(product.id, 0) || null, variantId: null, matchStatus: 'unresolved_execution', inputKey };
    }
  }

  if (retiredProductShell) {
    await db.prepare(
      `UPDATE catalog_products
       SET is_active = 1, updated_at = ?
       WHERE id = ? AND is_active = 0`
    ).bind(timestamp, product.id).run();
    const activeProduct = await db.prepare(
      'SELECT id FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1'
    ).bind(product.id).first<{ id: number }>();
    if (!activeProduct?.id) {
      return { productId: null, variantId: null, matchStatus: 'unresolved_product', inputKey };
    }
  }

  const execution = existingExecution?.id
    ? existingExecution
    : await ensureCatalogExecutionV3(
      db,
      product.id,
      material,
      length,
      timestamp,
      allowRetiredRecreate ? { allowRetiredRecreate: true } : {},
    );

  const retiredCombination = await findRetiredCatalogCombinationV3(db, execution.id, category, gender, color, size);
  if (retiredCombination?.id && !allowRetiredRecreate) {
    return { productId: toInt(product.id, 0) || null, variantId: null, matchStatus: 'unresolved_variant', inputKey };
  }

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

  const deterministicExternalId = makeVariantExternalId(product.name, category, gender, color, execution.material, execution.length, size);
  let externalId = deterministicExternalId;
  if (allowRetiredRecreate && (retiredProductShell || retiredExecution?.id || retiredCombination?.id)) {
    const occupied = await db.prepare(
      'SELECT id FROM catalog_variants WHERE external_id = ? LIMIT 1'
    ).bind(deterministicExternalId).first<{ id: number }>();
    if (occupied?.id) {
      const parsed = Date.parse(timestamp);
      const incarnation = Number.isFinite(parsed)
        ? Math.max(0, parsed).toString(36).toUpperCase()
        : Date.now().toString(36).toUpperCase();
      externalId = `${deterministicExternalId}-ORD-${incarnation}`;
    }
  }

  const created = await createCatalogCombinationV3(db, {
    productId: product.id,
    executionId: execution.id,
    category,
    gender,
    color,
    material: execution.material,
    length: execution.length,
    sizeLabel: size,
    externalId,
  }, timestamp);
  return { productId: toInt(product.id, 0) || null, variantId: created.id || null, matchStatus: created.created ? 'created_combination' : 'matched', inputKey };
}


export async function resolveCatalogProductAndVariant(
  db: D1Database,
  item: ReturnType<typeof normalizeOrderItems>[number],
  timestamp: string,
  options: { allowRetiredRecreate?: boolean; createMissing?: boolean } = {},
): Promise<ResolvedOrderCatalogReference> {
  if (await isCatalogIdentityV3Enabled(db) || await isHumanInventoryModelEnabled(db)) {
    return await resolveCatalogProductAndVariantV2(db, item, { ...options, timestamp });
  }
  if (options.createMissing === false) return await resolveCatalogProductAndVariantV2Flat(db, item);
  return await resolveCatalogProductAndVariantLegacy(db, item, timestamp);
}


export async function resolveWorkshopCatalogProductOnly(
  db: D1Database,
  item: ReturnType<typeof normalizeOrderItems>[number],
): Promise<ResolvedOrderCatalogReference> {
  const inputKey = catalogOrderInputKey(item);
  const product = await findCatalogProductByIdentity(db, item.productName, 0, { activeOnly: true }) as { id: number } | null;
  if (!product?.id) return { productId: null, variantId: null, matchStatus: 'unresolved_product', inputKey };
  const productId = toInt(product.id, 0);
  const productOnly = { productId, variantId: null, matchStatus: 'unresolved_variant' as const, inputKey };

  // Workshop must NEVER manufacture a catalog variant just because a manager
  // described an item. Link a pre-existing exact SKU only when every distinctive
  // attribute is supplied and the match is unique. Otherwise keep the product
  // link and the manager's untouched description for Workshop.
  if (![item.gender, item.color, item.material, item.length, item.size].every(value => cleanText(value))) {
    return productOnly;
  }
  const category = normalizeAudienceCategory(item.category, item.size);
  const noGender = upperText(item.gender) === 'БЕЗ ПОЛА';
  const wantedGender = noGender ? '' : normalizeCatalogCombinationGender(item.gender);
  // Aliases are admin-managed. They are used only to find an existing active
  // SKU across ALL sources; this path never inserts master catalog records.
  const wantedColor = normalizeCatalogCombinationColor(
    await resolveCatalogValueAlias(db,'color',normalizeCatalogCombinationColor(item.color))
  );
  const wantedMaterial = canonicalStockPositionValue(
    await resolveCatalogValueAlias(db,'material',canonicalStockPositionValue(item.material))
  );
  const wantedLength = canonicalStockPositionValue(
    await resolveCatalogValueAlias(db,'length',canonicalStockPositionValue(item.length))
  );
  const wantedSize = normalizeCatalogCombinationSize(
    await resolveCatalogValueAlias(db,category==='child'?'child_age':'size',normalizeCatalogCombinationSize(item.size))
  );
  // A literal 0 and a literal СТАНДАРТ are not no-size. No-size must be chosen.
  const intentionallyNoSize = ['БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р'].includes(upperText(item.size));
  if ((!wantedGender && !noGender) || !wantedColor || (!wantedSize && !intentionallyNoSize)) return productOnly;

  const candidates = await db.prepare(
    `SELECT v.id, v.gender, v.color, v.material, v.length, v.size_label
       FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id
       WHERE v.product_id=? AND v.is_active=1 AND p.is_active=1
         AND COALESCE(v.category,p.category,'adult')=?
       ORDER BY v.id ASC`
  ).bind(productId, category).all<{
    id: number; gender: string; color: string; material: string; length: string; size_label: string;
  }>();
  const matching = (candidates.results || []).filter(row =>
    normalizeCatalogCombinationGender(row.gender) === wantedGender
    && normalizeCatalogCombinationColor(row.color) === wantedColor
    && canonicalStockPositionValue(row.material) === wantedMaterial
    && canonicalStockPositionValue(row.length) === wantedLength
    && normalizeCatalogCombinationSize(row.size_label) === wantedSize
  );
  if (matching.length !== 1) return productOnly;
  return { productId, variantId: toInt(matching[0].id, 0) || null, matchStatus: 'matched', inputKey };
}
