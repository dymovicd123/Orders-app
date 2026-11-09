// Arrival-only Catalog materialization, retired SKU recovery, and scoped pre-commit cleanup.
// Physical inventory movements, CAS and D1 batch statements remain in inventory-movement.ts.
import { mapSqlRows } from '../core/sql.ts'
import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, toInt, upperText } from '../core/text.ts'
import { assertCatalogGenderAllowedForScope, catalogColorIdentity, isCatalogIdentityV3Enabled, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, normalizeCatalogProductIdentityKey } from './catalog.ts'
import type { InventoryResolvedItem } from './order-core.ts'
import { normalizeInventoryItem, resolveInventoryItem } from './order-core.ts'

export type ArrivalRecoveryCode = 'arrival_retired_product' | 'arrival_stale_variant';

export class ArrivalRecoveryRequiredError extends Error {
  status = 409;
  code: ArrivalRecoveryCode;
  productId: number;
  productName: string;
  retirementId: number;
  variantId: number;

  constructor(input: {
    code: ArrivalRecoveryCode;
    message: string;
    productId?: number;
    productName?: string;
    retirementId?: number;
    variantId?: number;
  }) {
    super(input.message);
    this.name = 'ArrivalRecoveryRequiredError';
    this.code = input.code;
    this.productId = Math.max(0, toInt(input.productId, 0));
    this.productName = cleanText(input.productName);
    this.retirementId = Math.max(0, toInt(input.retirementId, 0));
    this.variantId = Math.max(0, toInt(input.variantId, 0));
  }
}

async function latestCompletedProductRetirementId(db: D1Database, productId: number) {
  if (!productId) return 0;
  const row = await db.prepare(
    `SELECT id
     FROM catalog_retirement_operations
     WHERE entity_type='product'
       AND product_id=?
       AND status='completed'
     ORDER BY id DESC
     LIMIT 1`
  ).bind(productId).first<{ id: number }>();
  return Math.max(0, toInt(row?.id, 0));
}





export type ArrivalMaterializationTrace = {
  createdAt: string;
  productExternalIds: string[];
  executionKeys: Array<{ productId: number; material: string; length: string }>;
  variantExternalIds: string[];
};

export async function cleanupArrivalMaterialization(db: D1Database, trace: ArrivalMaterializationTrace | null) {
  if (!trace?.createdAt) return;

  // Cleanup is intentionally narrow: only identities planned by this failed Arrival and stamped
  // with its exact creation time are eligible. Existing Catalog truth can never match this filter.
  for (const externalId of [...trace.variantExternalIds].reverse()) {
    try {
      await db.prepare(
        `DELETE FROM catalog_variants
         WHERE external_id = ? AND created_at = ? AND is_active = 1`
      ).bind(externalId, trace.createdAt).run();
    } catch (error) {
      console.error(JSON.stringify({ event: 'arrival_materialization_cleanup_variant_failed', externalId, message: cleanText(error instanceof Error ? error.message : error).slice(0, 500) }));
    }
  }

  for (const execution of [...trace.executionKeys].reverse()) {
    try {
      await db.prepare(
        `DELETE FROM catalog_stock_positions
         WHERE product_id = ? AND material = ? AND length = ? AND created_at = ? AND is_active = 1
           AND NOT EXISTS (
             SELECT 1 FROM catalog_variants v WHERE v.stock_position_id = catalog_stock_positions.id
           )`
      ).bind(execution.productId, execution.material, execution.length, trace.createdAt).run();
    } catch (error) {
      console.error(JSON.stringify({ event: 'arrival_materialization_cleanup_execution_failed', productId: execution.productId, message: cleanText(error instanceof Error ? error.message : error).slice(0, 500) }));
    }
  }

  for (const externalId of [...trace.productExternalIds].reverse()) {
    try {
      await db.prepare(
        `DELETE FROM catalog_products
         WHERE external_id = ? AND created_at = ? AND is_active = 1
           AND NOT EXISTS (
             SELECT 1 FROM catalog_stock_positions sp WHERE sp.product_id = catalog_products.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM catalog_variants v WHERE v.product_id = catalog_products.id
           )`
      ).bind(externalId, trace.createdAt).run();
    } catch (error) {
      console.error(JSON.stringify({ event: 'arrival_materialization_cleanup_product_failed', externalId, message: cleanText(error instanceof Error ? error.message : error).slice(0, 500) }));
    }
  }
}


export async function resolveInventoryCreatableItemsBulk(
  db: D1Database,
  rawItems: ReturnType<typeof normalizeInventoryItem>[],
  options: { allowRetiredRecreate?: boolean; arrivalTrace?: ArrivalMaterializationTrace } = {},
): Promise<InventoryResolvedItem[]> {
  if (!rawItems.length) return [];

  // Old pre-188D environments are not a supported production target of Step 190.2, but keep
  // the legacy resolver as a compatibility fallback instead of inventing a second old-schema path.
  if (!await isCatalogIdentityV3Enabled(db)) {
    const fallback: InventoryResolvedItem[] = [];
    for (const item of rawItems) fallback.push(await resolveInventoryItem(db, item));
    return fallback;
  }

  const now = new Date().toISOString();
  if (options.arrivalTrace) options.arrivalTrace.createdAt = now;
  type ProductRow = { id: number; name: string; category: string; external_id?: string | null; is_active?: number; gender_scope?: string | null };
  const loadProducts = async () => mapSqlRows(await db.prepare(
    `SELECT id, name, category, external_id, is_active, gender_scope FROM catalog_products ORDER BY id ASC`
  ).all<ProductRow>()) as ProductRow[];

  let products = await loadProducts();
  let aliasRows: Array<{ alias_key: string; product_id: number }> = [];
  try {
    aliasRows = mapSqlRows(await db.prepare(
      `SELECT a.alias_key, a.product_id
       FROM catalog_product_aliases a
       JOIN catalog_products p ON p.id = a.product_id
       WHERE p.is_active = 1`
    ).all<{ alias_key: string; product_id: number }>()) as Array<{ alias_key: string; product_id: number }>;
  } catch {
    aliasRows = [];
  }

  const buildProductLookup = (rows: ProductRow[]) => {
    const byId = new Map<number, ProductRow>();
    const byExact = new Map<string, ProductRow>();
    const byIdentity = new Map<string, ProductRow>();
    for (const row of rows) {
      const id = toInt(row.id, 0);
      if (!id) continue;
      byId.set(id, row);
      if (toInt(row.is_active, 0) !== 1) continue;
      const exact = upperText(row.name);
      if (exact && !byExact.has(exact)) byExact.set(exact, row);
      const identity = normalizeCatalogProductIdentityKey(row.name);
      if (identity && !byIdentity.has(identity)) byIdentity.set(identity, row);
    }
    const byInactiveExact = new Map<string, ProductRow>();
    const byInactiveIdentity = new Map<string, ProductRow>();
    for (const row of rows) {
      if (toInt(row.is_active, 0) === 1) continue;
      const exact = upperText(row.name);
      if (exact && !byInactiveExact.has(exact)) byInactiveExact.set(exact, row);
      const identity = normalizeCatalogProductIdentityKey(row.name);
      if (identity && !byInactiveIdentity.has(identity)) byInactiveIdentity.set(identity, row);
    }
    const byAlias = new Map<string, ProductRow>();
    for (const alias of aliasRows) {
      const key = cleanText(alias.alias_key);
      const target = byId.get(toInt(alias.product_id, 0));
      if (key && target && !byAlias.has(key)) byAlias.set(key, target);
    }
    return { byId, byExact, byIdentity, byInactiveExact, byInactiveIdentity, byAlias };
  };

  let lookup = buildProductLookup(products);
  const resolveProduct = (item: ReturnType<typeof normalizeInventoryItem>) => {
    const identityKey = normalizeCatalogProductIdentityKey(item.productName);
    if (!identityKey) return null;
    const explicit = item.productId > 0 ? lookup.byId.get(item.productId) : null;
    // Named identity and canonical aliases, not a stale picker ID, decide
    // where physical Arrival units are registered. ORDA may alias ORDA SHAPAN.
    const alias = lookup.byAlias.get(identityKey);
    if (alias && toInt(alias.is_active, 0) === 1) return alias;
    if (explicit && normalizeCatalogProductIdentityKey(explicit.name) === identityKey) {
      if (explicit && toInt(explicit.is_active, 0) === 1) return explicit;
    }
    const exact = lookup.byExact.get(upperText(item.productName));
    if (exact) return exact;
    return lookup.byIdentity.get(identityKey) || null;
  };

  const resolveGenderForProduct = (product: ProductRow | null | undefined, item: ReturnType<typeof normalizeInventoryItem>) => {
    const explicit = normalizeCatalogCombinationGender(item.gender);
    if (explicit === 'ЖЕН' || explicit === 'МУЖ') {
      return assertCatalogGenderAllowedForScope(product?.gender_scope, explicit, product?.name).gender;
    }
    const scope = cleanText(product?.gender_scope).toLowerCase();
    if (scope === 'female') return 'ЖЕН';
    if (scope === 'male') return 'МУЖ';
    if (normalizeAudienceCategory(item.category, item.size) === 'child') return '';
    throw new Error('Для товара «Унисекс» выберите пол конкретной вещи: ЖЕН или МУЖ.');
  };

  const assertKnownProductGender = (product: ProductRow | null | undefined, item: ReturnType<typeof normalizeInventoryItem>) => {
    if (!product?.id) return;
    const explicitGender = normalizeCatalogCombinationGender(item.gender);
    if (explicitGender !== 'ЖЕН' && explicitGender !== 'МУЖ') return;
    assertCatalogGenderAllowedForScope(product.gender_scope, explicitGender, product.name);
  };

  const missingProducts = new Map<string, { name: string; category: string; externalId: string }>();
  const retiredProductConflicts: Array<{ productId: number; productName: string }> = [];
  rawItems.forEach((item, index) => {
    if (!item.productName) throw new Error('Product is required for inventory operation.');
    const activeProduct = resolveProduct(item);
    if (activeProduct) {
      // Preserve the fixed-gender preflight contract, then validate missing adult-unisex gender
      // before any new Catalog entity is inserted for another row in the same Arrival batch.
      assertKnownProductGender(activeProduct, item);
      resolveGenderForProduct(activeProduct, item);
      return;
    }

    const explicit = item.productId > 0 ? lookup.byId.get(item.productId) : null;
    const identityKey = normalizeCatalogProductIdentityKey(item.productName);
    const aliasTarget = identityKey ? lookup.byAlias.get(identityKey) : null;
    const retired = explicit && toInt(explicit.is_active, 0) !== 1
      ? explicit
      : aliasTarget && toInt(aliasTarget.is_active, 0) !== 1
        ? aliasTarget
        : lookup.byInactiveExact.get(upperText(item.productName))
          || (identityKey ? lookup.byInactiveIdentity.get(identityKey) : null);
    const retiredId = toInt(retired?.id, 0);
    if (retiredId) {
      assertKnownProductGender(retired, item);
      if (!retiredProductConflicts.length) {
        retiredProductConflicts.push({
          productId: retiredId,
          productName: cleanText(retired?.name) || item.productName,
        });
      }
      return;
    }

    // Brand-new products default to unisex, so validate the concrete SKU before scheduling
    // any Catalog write. A rejected Arrival must not create a product shell.
    resolveGenderForProduct(undefined, item);

    const newIdentityKey = identityKey || `RAW:${item.productName}`;
    if (!missingProducts.has(newIdentityKey)) {
      missingProducts.set(newIdentityKey, {
        name: item.productName,
        category: normalizeAudienceCategory(item.category, item.size),
        externalId: `AUTO-PROD-${Date.now().toString(36).toUpperCase()}-${index + 1}-${item.productName.length}`,
      });
    }
  });

  const retiredProductConflict = retiredProductConflicts[0];
  if (retiredProductConflict) {
    const retirementId = await latestCompletedProductRetirementId(db, retiredProductConflict.productId);
    throw new ArrivalRecoveryRequiredError({
      code: 'arrival_retired_product',
      message: retirementId
        ? `Товар «${retiredProductConflict.productName}» раньше был удалён. Его можно безопасно восстановить и продолжить этот Приход без потери введённых данных.`
        : `Товар «${retiredProductConflict.productName}» выведен из активного каталога, но запись удаления не найдена для автоматического восстановления.`,
      productId: retiredProductConflict.productId,
      productName: retiredProductConflict.productName,
      retirementId,
    });
  }

  if (missingProducts.size) {
    const missingProductsJson = JSON.stringify(Array.from(missingProducts.values()));
    if (options.arrivalTrace) {
      options.arrivalTrace.productExternalIds.push(...Array.from(missingProducts.values()).map((row) => row.externalId));
    }
    await db.prepare(
      `INSERT OR IGNORE INTO catalog_products (name, category, is_active, created_at, updated_at, external_id)
       SELECT CAST(json_extract(j.value, '$.name') AS TEXT), CAST(json_extract(j.value, '$.category') AS TEXT),
              1, ?, ?, CAST(json_extract(j.value, '$.externalId') AS TEXT)
       FROM json_each(?) j`
    ).bind(now, now, missingProductsJson).run();
    products = await loadProducts();
    lookup = buildProductLookup(products);
  }

  const productForItem = rawItems.map(item => resolveProduct(item));
  if (productForItem.some(row => !row?.id)) throw new Error('Не удалось создать или найти товар для складской операции. Обновите каталог и повторите действие.');

  const resolvedGenderForItem = rawItems.map((item, index) => {
    const product = productForItem[index];
    const explicit = normalizeCatalogCombinationGender(item.gender);
    if (explicit === 'ЖЕН' || explicit === 'МУЖ') {
      return assertCatalogGenderAllowedForScope(product?.gender_scope, explicit, product?.name).gender;
    }
    const scope = cleanText(product?.gender_scope).toLowerCase();
    if (scope === 'female') return 'ЖЕН';
    if (scope === 'male') return 'МУЖ';

    // Child is an audience category, not a third gender. Historical Catalog data legitimately
    // contains child SKUs with a blank gender (for example СӘУЛЕТ · ХАКИ · age 1). The Arrival
    // form used to send "ДЕТСКИЙ" through the gender field, which forced a unisex-gender error
    // and could leave an earlier new product materialized without stock. Keep adult unisex
    // strict, but allow a neutral child identity.
    if (normalizeAudienceCategory(item.category, item.size) === 'child') return '';

    throw new Error('Для товара «Унисекс» выберите пол конкретной вещи: ЖЕН или МУЖ.');
  });

  const productIds = Array.from(new Set(productForItem.map(row => toInt(row?.id, 0)).filter(Boolean)));
  const productIdsJson = JSON.stringify(productIds);
  type ExecutionRow = { id: number; product_id: number; material: string; length: string; is_active: number };
  const loadExecutions = async () => mapSqlRows(await db.prepare(
    `SELECT id, product_id, material, length, is_active
     FROM catalog_stock_positions
     WHERE is_active = 1
       AND product_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
     ORDER BY id ASC`
  ).bind(productIdsJson).all<ExecutionRow>()) as ExecutionRow[];

  let executions = await loadExecutions();
  const executionKey = (productId: number, material: unknown, length: unknown) =>
    `${productId}¦${canonicalStockPositionValue(material)}¦${canonicalStockPositionValue(length)}`;
  let executionByKey = new Map(executions.map(row => [executionKey(toInt(row.product_id, 0), row.material, row.length), row]));

  // An inactive execution is an explicit administrator decision, not an unknown combination.
  // Physical workflows may create genuinely new executions, but they must never resurrect one
  // that was deliberately retired. Re-adding the same human execution is Catalog-admin only.
  const retiredExecutionRows = mapSqlRows(await db.prepare(
    `SELECT product_id, material, length
     FROM catalog_stock_positions
     WHERE is_active = 0
       AND product_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
  ).bind(productIdsJson).all<{ product_id: number; material: string; length: string }>()) as Array<{ product_id: number; material: string; length: string }>;
  const retiredExecutionKeys = new Set(retiredExecutionRows.map(row =>
    executionKey(toInt(row.product_id, 0), row.material, row.length)));

  const missingExecutions = new Map<string, { productId: number; material: string; length: string }>();
  rawItems.forEach((item, index) => {
    const productId = toInt(productForItem[index]?.id, 0);
    const key = executionKey(productId, item.material, item.length);
    if (!executionByKey.has(key) && retiredExecutionKeys.has(key) && !options.allowRetiredRecreate) {
      throw new Error(`Исполнение «${canonicalStockPositionValue(item.material)} · ${canonicalStockPositionValue(item.length)}» было удалено из рабочего каталога. Эту операцию нельзя использовать для его автоматического восстановления.`);
    }
    if (!executionByKey.has(key) && !missingExecutions.has(key)) {
      missingExecutions.set(key, {
        productId,
        material: canonicalStockPositionValue(item.material),
        length: canonicalStockPositionValue(item.length),
      });
    }
  });

  if (missingExecutions.size) {
    const executionJson = JSON.stringify(Array.from(missingExecutions.values()));
    if (options.arrivalTrace) {
      options.arrivalTrace.executionKeys.push(...Array.from(missingExecutions.values()).map((row) => ({ ...row })));
    }
    await db.prepare(
      `INSERT OR IGNORE INTO catalog_stock_positions (
         product_id, category, gender_scope, material, length, is_default, is_active, sort_order, created_at, updated_at
       )
       SELECT CAST(json_extract(j.value, '$.productId') AS INTEGER), 'adult', 'unisex',
              CAST(json_extract(j.value, '$.material') AS TEXT), CAST(json_extract(j.value, '$.length') AS TEXT),
              0, 1, 0, ?, ?
       FROM json_each(?) j`
    ).bind(now, now, executionJson).run();
    executions = await loadExecutions();
    executionByKey = new Map(executions.map(row => [executionKey(toInt(row.product_id, 0), row.material, row.length), row]));
  }

  const executionForItem = rawItems.map((item, index) => {
    const productId = toInt(productForItem[index]?.id, 0);
    return executionByKey.get(executionKey(productId, item.material, item.length)) || null;
  });
  if (executionForItem.some(row => !row?.id)) throw new Error('Не удалось создать исполнение товара. Обновите каталог и повторите действие.');

  const executionIds = Array.from(new Set(executionForItem.map(row => toInt(row?.id, 0)).filter(Boolean)));
  const executionIdsJson = JSON.stringify(executionIds);
  type VariantRow = {
    id: number; product_id: number; stock_position_id: number; category: string; gender: string | null;
    color: string | null; material: string | null; length: string | null; size_label: string | null; is_active: number;
  };
  const loadVariants = async () => mapSqlRows(await db.prepare(
    `SELECT id, product_id, stock_position_id, category, gender, color, material, length, size_label, is_active
     FROM catalog_variants
     WHERE is_active = 1
       AND stock_position_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
     ORDER BY id ASC`
  ).bind(executionIdsJson).all<VariantRow>()) as VariantRow[];

  const variantExactKey = (executionId: number, category: unknown, gender: unknown, color: unknown, size: unknown) => [
    executionId,
    normalizeAudienceCategory(category, size),
    normalizeCatalogCombinationGender(gender),
    normalizeCatalogCombinationColor(color),
    normalizeCatalogCombinationSize(size),
  ].join('¦');
  const variantSemanticKey = (executionId: number, category: unknown, gender: unknown, color: unknown, size: unknown) => [
    executionId,
    normalizeAudienceCategory(category, size),
    normalizeCatalogCombinationGender(gender),
    catalogColorIdentity(color),
    normalizeCatalogCombinationSize(size),
  ].join('¦');
  const buildVariantLookups = (rows: VariantRow[]) => {
    const exact = new Map<string, VariantRow>();
    const semantic = new Map<string, VariantRow>();
    for (const row of rows) {
      const exactKey = variantExactKey(toInt(row.stock_position_id, 0), row.category, row.gender, row.color, row.size_label);
      if (!exact.has(exactKey)) exact.set(exactKey, row);
      const semanticKey = variantSemanticKey(toInt(row.stock_position_id, 0), row.category, row.gender, row.color, row.size_label);
      if (!semantic.has(semanticKey)) semantic.set(semanticKey, row);
    }
    return { exact, semantic };
  };

  let variants = await loadVariants();
  let { exact: variantByExactKey, semantic: variantBySemanticKey } = buildVariantLookups(variants);

  const retiredVariantRows = mapSqlRows(await db.prepare(
    `SELECT id, product_id, stock_position_id, category, gender, color, material, length, size_label, is_active
     FROM catalog_variants
     WHERE is_active = 0
       AND stock_position_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
     ORDER BY id ASC`
  ).bind(executionIdsJson).all<VariantRow>()) as VariantRow[];
  const retiredVariantExactKeys = new Set(retiredVariantRows.map(row =>
    variantExactKey(toInt(row.stock_position_id, 0), row.category, row.gender, row.color, row.size_label)));
  const retiredVariantSemanticKeys = new Set(retiredVariantRows.map(row =>
    variantSemanticKey(toInt(row.stock_position_id, 0), row.category, row.gender, row.color, row.size_label)));

  const missingVariants = new Map<string, Record<string, unknown>>();
  rawItems.forEach((item, index) => {
    const product = productForItem[index]!;
    const execution = executionForItem[index]!;
    const gender = resolvedGenderForItem[index];
    const exactKey = variantExactKey(toInt(execution.id, 0), item.category, gender, item.color, item.size);
    const semanticKey = variantSemanticKey(toInt(execution.id, 0), item.category, gender, item.color, item.size);
    if (variantByExactKey.has(exactKey) || variantBySemanticKey.has(semanticKey) || missingVariants.has(semanticKey)) return;
    if ((retiredVariantExactKeys.has(exactKey) || retiredVariantSemanticKeys.has(semanticKey)) && !options.allowRetiredRecreate) {
      throw new Error(`Комбинация «${cleanText(product.name)} · ${normalizeCatalogCombinationColor(item.color)} · ${normalizeCatalogCombinationSize(item.size)}» была удалена из рабочего каталога. Эта операция не может автоматически создать её заново; используйте Приход или восстановление Каталога.`);
    }
    const category = normalizeAudienceCategory(item.category, item.size);
    const color = catalogColorIdentity(item.color);
    const size = normalizeCatalogCombinationSize(item.size);
    const material = canonicalStockPositionValue(execution.material);
    const length = canonicalStockPositionValue(execution.length);
    missingVariants.set(semanticKey, {
      externalId: makeVariantExternalId(cleanText(product.name), category, gender, color, material, length, size),
      productId: toInt(product.id, 0),
      executionId: toInt(execution.id, 0),
      category,
      gender,
      color,
      material,
      length,
      size,
    });
  });

  // A physical operation may rediscover a logical combination whose deterministic
  // external_id belongs to a retired historical row. external_id is globally unique, so an
  // INSERT OR IGNORE would otherwise silently skip the new active combination. Keep the retired
  // row retired and give the new physical incarnation a fresh external id.
  if (missingVariants.size) {
    const candidates = Array.from(missingVariants.values());
    const candidateIds = candidates.map((row) => cleanText(row.externalId)).filter(Boolean);
    if (candidateIds.length) {
      const occupiedRows = mapSqlRows(await db.prepare(
        `SELECT external_id FROM catalog_variants
         WHERE external_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`
      ).bind(JSON.stringify(candidateIds)).all<{ external_id: string }>()) as Array<{ external_id: string }>;
      const occupiedIds = new Set(occupiedRows.map((row) => cleanText(row.external_id)).filter(Boolean));
      let physicalIncarnation = 0;
      for (const row of candidates) {
        const deterministicId = cleanText(row.externalId);
        if (!deterministicId || !occupiedIds.has(deterministicId)) continue;
        physicalIncarnation += 1;
        row.externalId = `${deterministicId}-PHYS-${Date.now().toString(36).toUpperCase()}-${physicalIncarnation}`;
      }
    }
  }

  if (missingVariants.size) {
    const variantsJson = JSON.stringify(Array.from(missingVariants.values()));
    if (options.arrivalTrace) {
      options.arrivalTrace.variantExternalIds.push(...Array.from(missingVariants.values()).map((row) => cleanText(row.externalId)).filter(Boolean));
    }
    await db.prepare(
      `INSERT OR IGNORE INTO catalog_variants (
         external_id, product_id, stock_position_id, category, gender, color, material, length, size_label,
         is_active, sort_order, created_at, updated_at
       )
       SELECT CAST(json_extract(j.value, '$.externalId') AS TEXT),
              CAST(json_extract(j.value, '$.productId') AS INTEGER),
              CAST(json_extract(j.value, '$.executionId') AS INTEGER),
              CAST(json_extract(j.value, '$.category') AS TEXT),
              NULLIF(CAST(json_extract(j.value, '$.gender') AS TEXT), ''),
              NULLIF(CAST(json_extract(j.value, '$.color') AS TEXT), ''),
              CAST(json_extract(j.value, '$.material') AS TEXT),
              CAST(json_extract(j.value, '$.length') AS TEXT),
              NULLIF(CAST(json_extract(j.value, '$.size') AS TEXT), ''),
              1, 0, ?, ?
       FROM json_each(?) j`
    ).bind(now, now, variantsJson).run();
    variants = await loadVariants();
    ({ exact: variantByExactKey, semantic: variantBySemanticKey } = buildVariantLookups(variants));
  }

  return rawItems.map((item, index) => {
    const product = productForItem[index]!;
    const execution = executionForItem[index]!;
    const resolvedGender = resolvedGenderForItem[index];
    const exactKey = variantExactKey(toInt(execution.id, 0), item.category, resolvedGender, item.color, item.size);
    const semanticKey = variantSemanticKey(toInt(execution.id, 0), item.category, resolvedGender, item.color, item.size);
    const variant = variantByExactKey.get(exactKey) || variantBySemanticKey.get(semanticKey);
    if (!variant?.id) throw new Error('Не удалось создать складскую комбинацию товара. Повторите действие.');
    return {
      productId: toInt(product.id, 0) || null,
      variantId: toInt(variant.id, 0) || null,
      productName: upperText(product.name),
      category: normalizeAudienceCategory(item.category, item.size),
      gender: resolvedGender || null,
      color: normalizeCatalogCombinationColor(variant.color) || null,
      material: canonicalStockPositionValue(execution.material),
      length: canonicalStockPositionValue(execution.length),
      size: normalizeCatalogCombinationSize(item.size) || null,
      quantity: item.quantity,
      expectedQuantity: item.expectedQuantity,
    } satisfies InventoryResolvedItem;
  });
}




