// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { setAppSetting } from '../core/settings.ts'
import { chunksOf, mapSqlRows } from '../core/sql.ts'
import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, normalizeCatalogCategory, normalizeSourceType, toInt, upperText } from '../core/text.ts'
import type { InventoryItemInput, InventoryMovementKind, SourceType } from '../core/types.ts'
import type { CanonicalVariantSnapshot } from './catalog.ts'
import { isCatalogIdentityV3Enabled, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize, normalizeCatalogProductIdentityKey } from './catalog.ts'
import { findInventoryMovementMatch, listInventory } from './inventory-read.ts'
import { isReversibleInventoryMovementReference } from './inventory-reservations.ts'
import type { InventoryResolvedItem } from './order-core.ts'
import { inventoryMergeKey, inventoryWhereKey, mergeInventoryItems, normalizeInventoryItem, normalizeOrderItems, resolveInventoryItem } from './order-core.ts'
import { applyOrderStockWriteOff } from './orders-write.ts'
import { getPendingInventoryWriteoffCount } from './references.ts'
import { isInventoryAutoWriteoffEnabled } from './storage.ts'

export function inventoryManualRequestFingerprint(
  inventorySource: SourceType,
  movementType: InventoryMovementKind,
  comment: string,
  items: ReturnType<typeof normalizeInventoryItem>[],
) {
  const rows = items.map((item) => ({
    productId: item.productId || 0,
    variantId: item.variantId || 0,
    productName: item.productName,
    category: item.category,
    gender: item.gender,
    color: item.color,
    material: item.material,
    length: item.length,
    size: item.size,
    quantity: item.quantity,
    expectedQuantity: item.expectedQuantity,
    observedPhysicalQuantity: item.observedPhysicalQuantity,
  })).sort((a, b) => (
    a.variantId - b.variantId
    || a.productId - b.productId
    || a.productName.localeCompare(b.productName)
    || JSON.stringify(a).localeCompare(JSON.stringify(b))
  ));
  return JSON.stringify({ inventorySource, movementType, comment, items: rows });
}


export async function resolveInventoryCreatableItemsBulk(
  db: D1Database,
  rawItems: ReturnType<typeof normalizeInventoryItem>[],
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
  type ProductRow = { id: number; name: string; category: string; external_id?: string | null; is_active?: number };
  const loadProducts = async () => mapSqlRows(await db.prepare(
    `SELECT id, name, category, external_id, is_active FROM catalog_products ORDER BY id ASC`
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
      const exact = upperText(row.name);
      if (exact && !byExact.has(exact)) byExact.set(exact, row);
      const identity = normalizeCatalogProductIdentityKey(row.name);
      if (identity && !byIdentity.has(identity)) byIdentity.set(identity, row);
    }
    const byAlias = new Map<string, ProductRow>();
    for (const alias of aliasRows) {
      const key = cleanText(alias.alias_key);
      const target = byId.get(toInt(alias.product_id, 0));
      if (key && target && !byAlias.has(key)) byAlias.set(key, target);
    }
    return { byId, byExact, byIdentity, byAlias };
  };

  let lookup = buildProductLookup(products);
  const resolveProduct = (item: ReturnType<typeof normalizeInventoryItem>) => {
    const explicit = item.productId > 0 ? lookup.byId.get(item.productId) : null;
    if (explicit) return explicit;
    const exact = lookup.byExact.get(item.productName);
    if (exact) return exact;
    const identityKey = normalizeCatalogProductIdentityKey(item.productName);
    if (!identityKey) return null;
    return lookup.byIdentity.get(identityKey) || lookup.byAlias.get(identityKey) || null;
  };

  const missingProducts = new Map<string, { name: string; category: string; externalId: string }>();
  rawItems.forEach((item, index) => {
    if (!item.productName) throw new Error('Product is required for inventory operation.');
    if (resolveProduct(item)) return;
    const identityKey = normalizeCatalogProductIdentityKey(item.productName) || `RAW:${item.productName}`;
    if (!missingProducts.has(identityKey)) {
      missingProducts.set(identityKey, {
        name: item.productName,
        category: normalizeAudienceCategory(item.category, item.size),
        externalId: `AUTO-PROD-${Date.now().toString(36).toUpperCase()}-${index + 1}-${item.productName.length}`,
      });
    }
  });

  if (missingProducts.size) {
    const missingProductsJson = JSON.stringify(Array.from(missingProducts.values()));
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
  const missingExecutions = new Map<string, { productId: number; material: string; length: string }>();
  rawItems.forEach((item, index) => {
    const productId = toInt(productForItem[index]?.id, 0);
    const key = executionKey(productId, item.material, item.length);
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

  const variantKey = (executionId: number, category: unknown, gender: unknown, color: unknown, size: unknown) => [
    executionId,
    normalizeAudienceCategory(category, size),
    normalizeCatalogCombinationGender(gender),
    normalizeCatalogCombinationColor(color),
    normalizeCatalogCombinationSize(size),
  ].join('¦');

  let variants = await loadVariants();
  let variantByKey = new Map(variants.map(row => [variantKey(toInt(row.stock_position_id, 0), row.category, row.gender, row.color, row.size_label), row]));
  const missingVariants = new Map<string, Record<string, unknown>>();
  rawItems.forEach((item, index) => {
    const product = productForItem[index]!;
    const execution = executionForItem[index]!;
    const key = variantKey(toInt(execution.id, 0), item.category, item.gender, item.color, item.size);
    if (variantByKey.has(key) || missingVariants.has(key)) return;
    const category = normalizeAudienceCategory(item.category, item.size);
    const gender = normalizeCatalogCombinationGender(item.gender);
    const color = normalizeCatalogCombinationColor(item.color);
    const size = normalizeCatalogCombinationSize(item.size);
    const material = canonicalStockPositionValue(execution.material);
    const length = canonicalStockPositionValue(execution.length);
    missingVariants.set(key, {
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
    variantByKey = new Map(variants.map(row => [variantKey(toInt(row.stock_position_id, 0), row.category, row.gender, row.color, row.size_label), row]));
  }

  return rawItems.map((item, index) => {
    const product = productForItem[index]!;
    const execution = executionForItem[index]!;
    const variant = variantByKey.get(variantKey(toInt(execution.id, 0), item.category, item.gender, item.color, item.size));
    if (!variant?.id) throw new Error('Не удалось создать складскую комбинацию товара. Повторите действие.');
    return {
      productId: toInt(product.id, 0) || null,
      variantId: toInt(variant.id, 0) || null,
      productName: upperText(product.name),
      category: normalizeAudienceCategory(item.category, item.size),
      gender: normalizeCatalogCombinationGender(item.gender) || null,
      color: normalizeCatalogCombinationColor(item.color) || null,
      material: canonicalStockPositionValue(execution.material),
      length: canonicalStockPositionValue(execution.length),
      size: normalizeCatalogCombinationSize(item.size) || null,
      quantity: item.quantity,
      expectedQuantity: item.expectedQuantity,
    } satisfies InventoryResolvedItem;
  });
}


export async function applyInventoryMovement(
  db: D1Database,
  input: { requestId?: unknown; inventorySource?: unknown; movementType?: unknown; comment?: unknown; items?: InventoryItemInput[] },
  returnInventory = true,
  actor = '',
) {
  const inventorySource = normalizeSourceType(input.inventorySource);
  const movementType = cleanText(input.movementType).toLowerCase() as InventoryMovementKind;
  const comment = cleanText(input.comment);
  const requestId = cleanText(input.requestId) || `manual-${crypto.randomUUID()}`;
  const normalizedItems = Array.isArray(input.items) ? input.items.map(normalizeInventoryItem) : [];
  const rawItems = movementType === 'manual_set'
    ? normalizedItems
    : normalizedItems.filter(item => item.quantity > 0);
  if (movementType === 'manual_set') {
    const keys = new Set<string>();
    for (const item of rawItems) {
      const key = inventoryMergeKey(item);
      if (keys.has(key)) throw new Error(`Одна и та же позиция «${item.productName || 'товар'}» повторяется в корректировке. Оставьте одну строку с итоговым фактическим количеством.`);
      keys.add(key);
    }
  }
  const items = movementType === 'manual_set' ? rawItems : mergeInventoryItems(rawItems);

  if (!items.length) throw new Error('At least one inventory item is required.');
  const allowed = new Set<InventoryMovementKind>(['arrival', 'manual_set', 'writeoff', 'sale', 'return', 'revision', 'delete']);
  if (!allowed.has(movementType)) throw new Error('Unsupported movement type.');
  if (items.length > 100) throw new Error('За одну ручную операцию можно сохранить не больше 100 позиций. Разделите слишком большую партию.');

  const requestFingerprint = inventoryManualRequestFingerprint(inventorySource, movementType, comment, items);
  const existingOperation = await db.prepare(
    `SELECT o.operation_id, o.operation_type, o.source_type, o.status, o.item_count, o.total_quantity,
            f.request_fingerprint
     FROM inventory_operations o
     LEFT JOIN inventory_operation_request_fingerprints f ON f.operation_id = o.operation_id
     WHERE o.operation_id = ? LIMIT 1`
  ).bind(requestId).first<Record<string, unknown>>();
  if (existingOperation?.operation_id) {
    if (cleanText(existingOperation.operation_type) !== movementType || normalizeSourceType(existingOperation.source_type) !== inventorySource) {
      throw new Error('Этот идентификатор складской операции уже использован для другого действия. Обновите страницу и повторите.');
    }
    if (cleanText(existingOperation.request_fingerprint) && cleanText(existingOperation.request_fingerprint) !== requestFingerprint) {
      throw new Error('Эта складская операция уже была сохранена, но текущая форма отличается от исходной попытки. Обновите остатки перед новой операцией.');
    }
    const duplicate = { ok: true, duplicate: true, source: inventorySource, applied: toInt(existingOperation.item_count, 0), operationId: requestId };
    if (!returnInventory) return duplicate;
    return { ...duplicate, inventory: await listInventory(db, new URL(`https://dummy.local/api/inventory?source=${inventorySource}`)) };
  }

  const now = new Date().toISOString();
  type ResolvedEntry = {
    raw: ReturnType<typeof normalizeInventoryItem>;
    item: InventoryResolvedItem;
    legacyStock?: { id: number; quantity: number; reserved_quantity?: number } | null;
  };
  const resolvedEntries: Array<ResolvedEntry | null> = items.map(() => null);
  const variantIds = Array.from(new Set(items.map(item => Math.max(0, toInt(item.variantId, 0))).filter(Boolean)));
  const variantIdsJson = JSON.stringify(variantIds);
  const canonicalById = new Map<number, InventoryResolvedItem>();

  if (variantIds.length) {
    const canonicalResult = await db.prepare(
      `SELECT v.id AS variant_id, v.product_id, p.name AS product_name,
              COALESCE(v.category, p.category, 'adult') AS category,
              v.gender, v.color, v.material, v.length, v.size_label
       FROM catalog_variants v
       JOIN catalog_products p ON p.id = v.product_id
       WHERE v.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
    ).bind(variantIdsJson).all<Record<string, unknown>>();
    for (const row of canonicalResult.results || []) {
      const variantId = toInt(row.variant_id, 0);
      if (!variantId) continue;
      canonicalById.set(variantId, {
        productId: toInt(row.product_id, 0) || null,
        variantId,
        productName: upperText(row.product_name),
        category: normalizeCatalogCategory(row.category) as 'adult' | 'child',
        gender: upperText(row.gender) || null,
        color: upperText(row.color) || null,
        material: canonicalStockPositionValue(row.material),
        length: canonicalStockPositionValue(row.length),
        size: cleanText(row.size_label) || null,
        quantity: 0,
        expectedQuantity: null,
      });
    }
  }

  const strictOperationName = movementType === 'manual_set' ? 'Корректировка' : (movementType === 'writeoff' || movementType === 'delete') ? 'Списание' : '';
  const creatableIndexes: number[] = [];
  const legacyManualIndexes: number[] = [];
  items.forEach((raw, index) => {
    if (raw.variantId > 0) {
      const canonical = canonicalById.get(raw.variantId);
      if (canonical) {
        const item: InventoryResolvedItem = { ...canonical, quantity: raw.quantity, expectedQuantity: raw.expectedQuantity };
        if (strictOperationName) {
          const mismatch = (
            (raw.productId > 0 && raw.productId !== item.productId)
            || raw.productName !== item.productName
            || raw.category !== item.category
            || raw.gender !== (item.gender || '')
            || raw.color !== (item.color || '')
            || raw.material !== (item.material || '')
            || raw.length !== (item.length || '')
            || raw.size !== (item.size || '')
          );
          if (mismatch) throw new Error(`${strictOperationName}: характеристики не соответствуют выбранному варианту. Выберите существующую комбинацию заново.`);
        }
        resolvedEntries[index] = { raw, item };
        return;
      }
      if (strictOperationName) throw new Error(`${strictOperationName}: выбранный вариант больше не существует. Обновите остатки.`);
      creatableIndexes.push(index);
      return;
    }

    if (movementType === 'manual_set') {
      legacyManualIndexes.push(index);
      return;
    }
    if (movementType === 'writeoff' || movementType === 'delete') {
      throw new Error('Списание: выберите существующий вариант из выбранной точки.');
    }
    creatableIndexes.push(index);
  });

  if (creatableIndexes.length) {
    const creatableRaw = creatableIndexes.map(index => ({ ...items[index], variantId: 0 }));
    const createdResolved = await resolveInventoryCreatableItemsBulk(db, creatableRaw);
    creatableIndexes.forEach((index, localIndex) => {
      resolvedEntries[index] = { raw: items[index], item: createdResolved[localIndex] };
    });
  }

  if (legacyManualIndexes.length) {
    const wantedJson = JSON.stringify(legacyManualIndexes.map(index => {
      const raw = items[index];
      const key = inventoryWhereKey(raw);
      if (!key.productName) throw new Error('Корректировка: выберите существующую позицию склада.');
      return {
        index,
        productName: key.productName,
        gender: key.gender || '',
        color: key.color || '',
        material: canonicalStockPositionValue(key.material),
        length: canonicalStockPositionValue(key.length),
        size: key.size || '',
      };
    }));
    const legacyResult = await db.prepare(
      `WITH wanted AS (
         SELECT CAST(json_extract(j.value, '$.index') AS INTEGER) AS item_index,
                CAST(json_extract(j.value, '$.productName') AS TEXT) AS product_name,
                CAST(json_extract(j.value, '$.gender') AS TEXT) AS gender,
                CAST(json_extract(j.value, '$.color') AS TEXT) AS color,
                CAST(json_extract(j.value, '$.material') AS TEXT) AS material,
                CAST(json_extract(j.value, '$.length') AS TEXT) AS length,
                CAST(json_extract(j.value, '$.size') AS TEXT) AS size
         FROM json_each(?) j
       )
       SELECT w.item_index, s.id, s.quantity, s.reserved_quantity
       FROM wanted w
       JOIN inventory_stock s
         ON s.inventory_source = ?
        AND s.product_name_snapshot = w.product_name
        AND COALESCE(s.gender_snapshot, '') = w.gender
        AND COALESCE(s.color_snapshot, '') = w.color
        AND COALESCE(NULLIF(UPPER(TRIM(s.material_snapshot)), ''), 'СТАНДАРТ') = w.material
        AND COALESCE(NULLIF(UPPER(TRIM(s.length_snapshot)), ''), 'СТАНДАРТ') = w.length
        AND COALESCE(s.size_snapshot, '') = w.size
       ORDER BY w.item_index ASC, s.id ASC`
    ).bind(wantedJson, inventorySource).all<Record<string, unknown>>();
    const stockByIndex = new Map<number, Record<string, unknown>>();
    for (const row of legacyResult.results || []) {
      const index = toInt(row.item_index, -1);
      if (index >= 0 && !stockByIndex.has(index)) stockByIndex.set(index, row);
    }
    for (const index of legacyManualIndexes) {
      const raw = items[index];
      const stock = stockByIndex.get(index);
      if (!stock?.id) throw new Error('Корректировка: такой позиции нет на выбранной точке. Новые варианты создаются только через приход.');
      const key = inventoryWhereKey(raw);
      resolvedEntries[index] = {
        raw,
        item: {
          productId: raw.productId > 0 ? raw.productId : null,
          variantId: null,
          productName: key.productName,
          category: normalizeAudienceCategory(raw.category, key.size) as 'adult' | 'child',
          gender: key.gender,
          color: key.color,
          material: key.material,
          length: key.length,
          size: key.size,
          quantity: raw.quantity,
          expectedQuantity: raw.expectedQuantity,
        },
        legacyStock: {
          id: toInt(stock.id, 0),
          quantity: toInt(stock.quantity, 0),
          reserved_quantity: Math.max(0, toInt(stock.reserved_quantity, 0)),
        },
      };
    }
  }

  if (resolvedEntries.some(entry => !entry)) throw new Error('Не удалось подготовить все позиции складской операции. Обновите данные и повторите.');

  // Different aliases/raw identities can converge to the same canonical variant. Collapse them
  // before touching stock so one physical row is never updated twice inside a bulk request.
  const canonicalEntries: ResolvedEntry[] = [];
  const canonicalEntryIndex = new Map<string, number>();
  for (const entry of resolvedEntries as ResolvedEntry[]) {
    const variantId = toInt(entry.item.variantId, 0);
    const legacyStockId = toInt(entry.legacyStock?.id, 0);
    const key = variantId > 0 ? `variant:${variantId}` : `stock:${legacyStockId}`;
    const previousIndex = canonicalEntryIndex.get(key);
    if (previousIndex === undefined) {
      canonicalEntryIndex.set(key, canonicalEntries.length);
      canonicalEntries.push(entry);
      continue;
    }

    const previous = canonicalEntries[previousIndex];
    const previousExpected = previous.raw.expectedQuantity;
    const nextExpected = entry.raw.expectedQuantity;
    const previousObserved = previous.raw.observedPhysicalQuantity;
    const nextObserved = entry.raw.observedPhysicalQuantity;
    if (previousExpected !== null && nextExpected !== null && previousExpected !== nextExpected) {
      throw new Error(`Остатки «${entry.item.productName}» изменились между строками операции. Обновите данные и повторите.`);
    }
    if (previousObserved !== null && nextObserved !== null && previousObserved !== nextObserved) {
      throw new Error(`Для «${entry.item.productName}» указано разное фактическое количество. Оставьте одно значение и повторите.`);
    }
    if (movementType === 'manual_set') {
      if (previous.item.quantity !== entry.item.quantity) {
        throw new Error(`Для «${entry.item.productName}» указаны разные итоговые остатки. Оставьте одну строку корректировки.`);
      }
      continue;
    }

    previous.raw.quantity += entry.raw.quantity;
    previous.item.quantity += entry.item.quantity;
    previous.raw.expectedQuantity = previousExpected ?? nextExpected;
    previous.item.expectedQuantity = previous.raw.expectedQuantity;
    previous.raw.observedPhysicalQuantity = previousObserved ?? nextObserved;
  }

  // Canonical identity is authoritative. Resolve all source stock rows in one query instead of
  // one findInventoryStockRow() call per line.
  const resolvedVariantIds = Array.from(new Set(canonicalEntries.map(entry => toInt(entry.item.variantId, 0)).filter(Boolean)));
  const resolvedVariantIdsJson = JSON.stringify(resolvedVariantIds);
  const stockByVariant = new Map<number, Record<string, unknown>>();
  if (resolvedVariantIds.length) {
    const stockResult = await db.prepare(
      `SELECT id, variant_id, quantity, reserved_quantity
       FROM inventory_stock
       WHERE inventory_source = ?
         AND variant_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
    ).bind(inventorySource, resolvedVariantIdsJson).all<Record<string, unknown>>();
    for (const row of stockResult.results || []) stockByVariant.set(toInt(row.variant_id, 0), row);
  }

  type PreparedManual = {
    item: InventoryResolvedItem;
    stockId: number;
    stockExisted: boolean;
    currentQuantity: number;
    effectiveBefore: number;
    targetQuantity: number;
    delta: number;
    expectedQuantity: number | null;
    observedPhysicalQuantity: number | null;
    reservedQuantity: number;
  };
  const prepared: PreparedManual[] = [];

  for (const entry of canonicalEntries) {
    const rawItem = entry.raw;
    const item = entry.item;
    const existingStock = entry.legacyStock || (item.variantId ? stockByVariant.get(toInt(item.variantId, 0)) || null : null);
    if ((movementType === 'manual_set' || movementType === 'writeoff' || movementType === 'delete') && !existingStock?.id) {
      throw new Error(`${movementType === 'manual_set' ? 'Корректировка' : 'Списание'}: выбранной позиции больше нет на выбранной точке. Обновите остатки.`);
    }

    const currentQuantity = existingStock?.id ? toInt(existingStock.quantity, 0) : 0;
    const reservedQuantity = existingStock?.id ? Math.max(0, toInt(existingStock.reserved_quantity, 0)) : 0;
    const expectedQuantity = rawItem.expectedQuantity;
    const observedPhysicalQuantity = rawItem.observedPhysicalQuantity;
    if (observedPhysicalQuantity !== null && (!Number.isInteger(observedPhysicalQuantity) || observedPhysicalQuantity < 0)) {
      throw new Error(`Фактическое количество для «${item.productName}» должно быть целым числом не меньше нуля.`);
    }

    let effectiveBefore = currentQuantity;
    let targetQuantity = currentQuantity;
    let delta = item.quantity;
    if (movementType === 'manual_set') {
      if (expectedQuantity !== null && currentQuantity !== expectedQuantity) {
        throw new Error(`Остатки изменились после открытия таблицы: ${item.productName} ${item.size || ''}. Было ${expectedQuantity}, сейчас ${currentQuantity}. Обновите данные и повторите установку.`);
      }
      targetQuantity = Math.max(0, item.quantity);
      delta = targetQuantity - currentQuantity;
    } else if (movementType === 'writeoff' || movementType === 'delete') {
      const requested = Math.max(0, item.quantity);
      if (observedPhysicalQuantity !== null) {
        if (expectedQuantity === null) throw new Error(`Перед фактической сверкой «${item.productName}» обновите остатки и повторите списание.`);
        if (currentQuantity !== expectedQuantity) throw new Error(`Остаток «${item.productName}» изменился после открытия формы: было ${expectedQuantity}, сейчас ${currentQuantity}. Обновите данные и повторите.`);
        effectiveBefore = observedPhysicalQuantity;
      }
      if (requested > Math.max(0, effectiveBefore)) {
        throw new Error(`По учёту «${item.productName}» на месте ${effectiveBefore} шт., а списать нужно ${requested}. Если товар физически есть, укажите фактическое количество прямо в строке списания.`);
      }
      targetQuantity = effectiveBefore - requested;
      delta = -requested;
    } else if (movementType === 'sale') {
      targetQuantity = currentQuantity - Math.max(0, item.quantity);
      delta = -Math.max(0, item.quantity);
    } else if (movementType === 'arrival' || movementType === 'return' || movementType === 'revision') {
      targetQuantity = currentQuantity + Math.max(0, item.quantity);
      delta = Math.max(0, item.quantity);
    }

    prepared.push({
      item,
      stockId: toInt(existingStock?.id, 0),
      stockExisted: Boolean(existingStock?.id),
      currentQuantity,
      effectiveBefore,
      targetQuantity,
      delta,
      expectedQuantity,
      observedPhysicalQuantity,
      reservedQuantity,
    });
  }

  const referenceId = requestId;
  // Step 191E: keep manual operations atomic while avoiding the repeated json_each(?) row-source
  // pattern that failed at runtime for transfer. One compact JSON payload per logical row is bound
  // through a normal VALUES CTE. Chunks of 70 keep every statement comfortably under D1's
  // 100-bound-parameter ceiling even when fixed metadata bindings are added.
  const preparedChunks = chunksOf(prepared, 70).map(chunk => {
    const rowBindings = chunk.map(row => JSON.stringify({
      stockId: row.stockId,
      stockExisted: row.stockExisted ? 1 : 0,
      productId: toInt(row.item.productId, 0) || null,
      variantId: toInt(row.item.variantId, 0) || null,
      productName: row.item.productName,
      gender: row.item.gender,
      color: row.item.color,
      material: row.item.material,
      length: row.item.length,
      size: row.item.size,
      currentQuantity: row.currentQuantity,
      effectiveBefore: row.effectiveBefore,
      targetQuantity: row.targetQuantity,
      delta: row.delta,
      reservedQuantity: row.reservedQuantity,
      observedPhysical: row.observedPhysicalQuantity,
      inventorySource,
    }));
    const valuesSql = rowBindings.map(() => '(?)').join(', ');
    const rowsSql = `input(payload) AS (VALUES ${valuesSql}),
      x AS (
        SELECT
          CAST(json_extract(payload, '$.stockId') AS INTEGER) AS stock_id,
          CAST(json_extract(payload, '$.stockExisted') AS INTEGER) AS stock_existed,
          CAST(json_extract(payload, '$.productId') AS INTEGER) AS product_id,
          CAST(json_extract(payload, '$.variantId') AS INTEGER) AS variant_id,
          CAST(json_extract(payload, '$.productName') AS TEXT) AS product_name,
          json_extract(payload, '$.gender') AS gender,
          json_extract(payload, '$.color') AS color,
          json_extract(payload, '$.material') AS material,
          json_extract(payload, '$.length') AS length,
          json_extract(payload, '$.size') AS size,
          CAST(json_extract(payload, '$.currentQuantity') AS INTEGER) AS current_quantity,
          CAST(json_extract(payload, '$.effectiveBefore') AS INTEGER) AS effective_before,
          CAST(json_extract(payload, '$.targetQuantity') AS INTEGER) AS target_quantity,
          CAST(json_extract(payload, '$.delta') AS INTEGER) AS delta,
          CAST(json_extract(payload, '$.reservedQuantity') AS INTEGER) AS reserved_quantity,
          CASE WHEN json_type(payload, '$.observedPhysical') = 'null' THEN NULL
               ELSE CAST(json_extract(payload, '$.observedPhysical') AS INTEGER) END AS observed_physical,
          CAST(json_extract(payload, '$.inventorySource') AS TEXT) AS inventory_source
        FROM input
      )`;
    return { rowBindings, rowsSql };
  });
  const rowMatchSql = `((x.stock_existed = 1 AND x.stock_id = inventory_stock.id)
                    OR (x.stock_existed = 0 AND inventory_stock.inventory_source = x.inventory_source AND x.variant_id = inventory_stock.variant_id))`;

  const statements: D1PreparedStatement[] = [];
  for (const chunk of preparedChunks) {
    statements.push(db.prepare(
      `WITH ${chunk.rowsSql}
       INSERT INTO inventory_model_meta (key, value, updated_at)
       SELECT 'human_inventory_v2', '__manual_operation_conflict__', ?
       WHERE EXISTS (
         SELECT 1
         FROM x
         LEFT JOIN inventory_stock s
           ON (x.stock_existed = 1 AND s.id = x.stock_id)
           OR (x.stock_existed = 0 AND s.inventory_source = ? AND s.variant_id = x.variant_id)
         WHERE (x.stock_existed = 1 AND (s.id IS NULL OR COALESCE(s.quantity, 0) <> x.current_quantity))
            OR (x.stock_existed = 0 AND s.id IS NOT NULL)
       )`
    ).bind(...chunk.rowBindings, now, inventorySource));
  }
  for (const chunk of preparedChunks) {
    statements.push(db.prepare(
      `WITH ${chunk.rowsSql}
       INSERT OR IGNORE INTO inventory_stock (
         inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
         material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
         last_action, last_source_ref, created_at, updated_at
       )
       SELECT ?, x.product_id, x.variant_id, x.product_name, x.gender, x.color,
              x.material, x.length, x.size, 0, 0, ?, ?, ?, ?
       FROM x
       WHERE x.stock_existed = 0 AND x.variant_id IS NOT NULL`
    ).bind(...chunk.rowBindings, inventorySource, movementType, referenceId, now, now));
  }

  statements.push(
    db.prepare(
      `INSERT INTO inventory_operations (
         operation_id, operation_type, source_type, status, comment, item_count, total_quantity, created_at, completed_at
       ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?)`
    ).bind(requestId, movementType, inventorySource, comment || null, prepared.length, prepared.reduce((sum, row) => sum + Math.max(0, row.item.quantity), 0), now, now),
    db.prepare(
      `INSERT INTO inventory_operation_request_fingerprints (operation_id, request_fingerprint, created_at) VALUES (?, ?, ?)`
    ).bind(requestId, requestFingerprint, now),
  );

  if ((movementType === 'writeoff' || movementType === 'delete') && prepared.some(row => row.observedPhysicalQuantity !== null)) {
    for (const chunk of preparedChunks) {
      statements.push(
        db.prepare(
          `WITH ${chunk.rowsSql}
           INSERT INTO inventory_movements (
             inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
             material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after, reference_type, reference_id, comment, created_at
           )
           SELECT ?, 'revision', x.product_id, x.variant_id, x.product_name, x.gender, x.color,
                  x.material, x.length, x.size, x.effective_before - x.current_quantity, x.effective_before,
                  'manual_observation', ?,
                  'Фактическая сверка перед списанием. По учёту: ' || x.current_quantity || '; подтверждено: ' || x.effective_before || '.', ?
           FROM x WHERE x.observed_physical IS NOT NULL`
        ).bind(...chunk.rowBindings, inventorySource, requestId, now),
        db.prepare(
          `WITH ${chunk.rowsSql}
           INSERT OR IGNORE INTO inventory_stock_checks (
             check_key, inventory_source, product_id, variant_id,
             expected_quantity, counted_quantity, difference_quantity, reserved_quantity,
             check_type, reference_type, reference_id, checked_by, checked_at, created_at
           )
           SELECT 'manual-writeoff:' || ? || ':' || COALESCE(CAST(x.variant_id AS TEXT), CAST(x.stock_id AS TEXT)),
                  ?, x.product_id, x.variant_id, x.current_quantity, x.effective_before,
                  x.effective_before - x.current_quantity, x.reserved_quantity,
                  'writeoff_observation', 'manual', ?, ?, ?, ?
           FROM x WHERE x.observed_physical IS NOT NULL`
        ).bind(...chunk.rowBindings, requestId, inventorySource, requestId, cleanText(actor) || null, now, now),
      );
    }
  }

  for (const chunk of preparedChunks) {
    statements.push(db.prepare(
      `WITH ${chunk.rowsSql}
       UPDATE inventory_stock
       SET quantity = (SELECT x.target_quantity FROM x WHERE ${rowMatchSql} LIMIT 1),
           product_id = COALESCE((SELECT x.product_id FROM x WHERE ${rowMatchSql} LIMIT 1), product_id),
           variant_id = COALESCE((SELECT x.variant_id FROM x WHERE ${rowMatchSql} LIMIT 1), variant_id),
           product_name_snapshot = (SELECT x.product_name FROM x WHERE ${rowMatchSql} LIMIT 1),
           gender_snapshot = (SELECT x.gender FROM x WHERE ${rowMatchSql} LIMIT 1),
           color_snapshot = (SELECT x.color FROM x WHERE ${rowMatchSql} LIMIT 1),
           material_snapshot = (SELECT x.material FROM x WHERE ${rowMatchSql} LIMIT 1),
           length_snapshot = (SELECT x.length FROM x WHERE ${rowMatchSql} LIMIT 1),
           size_snapshot = (SELECT x.size FROM x WHERE ${rowMatchSql} LIMIT 1),
           last_action = ?, last_source_ref = ?, updated_at = ?
       WHERE EXISTS (SELECT 1 FROM x WHERE ${rowMatchSql})`
    ).bind(...chunk.rowBindings, movementType, referenceId, now));
  }

  for (const chunk of preparedChunks) {
    statements.push(db.prepare(
      `WITH ${chunk.rowsSql}
       INSERT INTO inventory_movements (
         inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
         material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after, reference_type, reference_id, comment, created_at
       )
       SELECT ?, ?, x.product_id, x.variant_id, x.product_name, x.gender, x.color,
              x.material, x.length, x.size, x.delta, x.target_quantity, 'manual', ?, ?, ?
       FROM x`
    ).bind(...chunk.rowBindings, inventorySource, movementType, referenceId, comment || null, now));
  }

  if (movementType === 'manual_set') {
    for (const chunk of preparedChunks) {
      statements.push(db.prepare(
        `WITH ${chunk.rowsSql}
         INSERT OR IGNORE INTO inventory_stock_checks (
           check_key, inventory_source, product_id, variant_id,
           expected_quantity, counted_quantity, difference_quantity, reserved_quantity,
           check_type, reference_type, reference_id, checked_by, checked_at, created_at
         )
         SELECT 'manual-set:' || ? || ':' || COALESCE(CAST(x.variant_id AS TEXT), CAST(x.stock_id AS TEXT)),
                ?, x.product_id, x.variant_id, x.current_quantity, x.target_quantity,
                x.target_quantity - x.current_quantity, x.reserved_quantity,
                'manual_set', 'manual', ?, ?, ?, ?
         FROM x`
      ).bind(...chunk.rowBindings, requestId, inventorySource, requestId, cleanText(actor) || null, now, now));
    }
  }

  try {
    await db.batch(statements);
  } catch (error) {
    const raced = await db.prepare(
      `SELECT o.operation_id, o.operation_type, o.source_type, o.status, o.item_count, f.request_fingerprint
       FROM inventory_operations o LEFT JOIN inventory_operation_request_fingerprints f ON f.operation_id = o.operation_id
       WHERE o.operation_id = ? LIMIT 1`
    ).bind(requestId).first<Record<string, unknown>>();
    if (raced?.operation_id && cleanText(raced.request_fingerprint) === requestFingerprint) {
      const duplicate = { ok: true, duplicate: true, source: inventorySource, applied: toInt(raced.item_count, 0), operationId: requestId };
      if (!returnInventory) return duplicate;
      return { ...duplicate, inventory: await listInventory(db, new URL(`https://dummy.local/api/inventory?source=${inventorySource}`)) };
    }
    throw new Error('Остатки изменились во время сохранения операции. Ничего не применено. Обновите данные и повторите.');
  }

  const response = { ok: true, duplicate: false, source: inventorySource, applied: prepared.length, operationId: requestId };
  if (!returnInventory) return response;
  return { ...response, inventory: await listInventory(db, new URL(`https://dummy.local/api/inventory?source=${inventorySource}`)) };
}


export type PreparedInventoryTransferItem = {
  item: InventoryResolvedItem;
  variantId: number;
  quantity: number;
  sourceCurrent: number;
  sourceRowExisted: boolean;
  targetCurrent: number;
  effectiveSourceBefore: number;
  reservedAtSource: number;
  shortageAfter: number;
  observedPhysicalQuantity: number | null;
};


export function inventoryTransferExternalId() {
  const compact = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `TR-${compact}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}


export function inventoryTransferRequestFingerprint(
  fromSource: SourceType,
  toSource: SourceType,
  comment: string,
  rawItems: InventoryItemInput[],
) {
  const normalizeOptional = (value: unknown): number | string | null => {
    if (value === null || value === undefined || cleanText(value) === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && Number.isInteger(numeric) ? numeric : cleanText(value);
  };
  const items = rawItems
    .map((raw) => ({
      variantId: Math.max(0, toInt(raw?.variantId, 0)),
      quantity: Math.max(0, toInt(raw?.quantity, 0)),
      expectedQuantity: normalizeOptional(raw?.expectedQuantity),
      observedPhysicalQuantity: normalizeOptional(raw?.observedPhysicalQuantity),
    }))
    .filter((row) => row.quantity > 0)
    .sort((left, right) => (
      left.variantId - right.variantId
      || left.quantity - right.quantity
      || JSON.stringify(left.expectedQuantity).localeCompare(JSON.stringify(right.expectedQuantity))
      || JSON.stringify(left.observedPhysicalQuantity).localeCompare(JSON.stringify(right.observedPhysicalQuantity))
    ));
  return JSON.stringify({ fromSource, toSource, comment, items });
}


export async function assertNoActiveStocktakeForTransfer(db: D1Database, fromSource: SourceType, toSource: SourceType) {
  const result = await db.prepare(
    `SELECT id, inventory_source
     FROM inventory_stocktake_sessions
     WHERE status = 'active' AND inventory_source IN (?, ?)
     ORDER BY updated_at DESC`
  ).bind(fromSource, toSource).all<Record<string, unknown>>();
  const rows = result.results || [];
  if (!rows.length) return;
  const labels = Array.from(new Set(rows.map(row => normalizeSourceType(row.inventory_source) === 'warehouse' ? 'Склад' : 'Бутик'))).join(' и ');
  throw new Error(`Сейчас в точке «${labels}» идёт ревизия. Чтобы не смешивать пересчёт с физическим перемещением, сначала завершите или отмените ревизию.`);
}


export async function applyInventoryTransfer(
  db: D1Database,
  input: { requestId?: unknown; fromSource?: unknown; toSource?: unknown; comment?: unknown; items?: InventoryItemInput[] },
  actor = '',
  returnInventory = true,
) {
  const fromSource = normalizeSourceType(input.fromSource);
  const toSource = normalizeSourceType(input.toSource || (fromSource === 'warehouse' ? 'boutique' : 'warehouse'));
  const comment = cleanText(input.comment);
  const requestId = cleanText(input.requestId) || `transfer-client-${crypto.randomUUID()}`;
  const rawItems = Array.isArray(input.items) ? input.items : [];

  if (fromSource === toSource) throw new Error('Точка отправления и назначения должны отличаться.');
  if (!rawItems.length) throw new Error('Добавьте хотя бы одну позицию в перемещение.');
  if (rawItems.length > 60) throw new Error('За одно перемещение можно перенести не больше 60 строк. Разделите слишком большую партию на две операции.');

  const requestFingerprint = inventoryTransferRequestFingerprint(fromSource, toSource, comment, rawItems);
  const duplicateResponse = async (document: Record<string, unknown>) => {
    if (normalizeSourceType(document.from_source) !== fromSource || normalizeSourceType(document.to_source) !== toSource) {
      throw new Error('Этот идентификатор перемещения уже использован для другого направления. Обновите страницу и повторите действие.');
    }
    if (cleanText(document.request_fingerprint) !== requestFingerprint) {
      throw new Error('Это перемещение уже было сохранено, но текущая форма отличается от исходной попытки. Обновите склад: старую операцию нельзя безопасно повторить с другим составом.');
    }
    const transferId = toInt(document.id, 0);
    const savedItems = transferId
      ? await db.prepare(
          `SELECT variant_id, quantity, source_shortage_after
           FROM inventory_transfer_items WHERE transfer_id = ? ORDER BY id ASC`
        ).bind(transferId).all<Record<string, unknown>>()
      : { results: [] as Record<string, unknown>[] };
    const savedRows = savedItems.results || [];
    const response = {
      ok: true,
      duplicate: true,
      transferId,
      externalId: cleanText(document.external_id),
      status: cleanText(document.status),
      fromSource,
      toSource,
      applied: savedRows.length,
      totalQuantity: savedRows.reduce((sum, row) => sum + Math.max(0, toInt(row.quantity, 0)), 0),
      warnings: savedRows
        .filter((row) => toInt(row.source_shortage_after, 0) > 0)
        .map((row) => ({ variantId: toInt(row.variant_id, 0), shortageAfter: Math.max(0, toInt(row.source_shortage_after, 0)) })),
    };
    if (!returnInventory) return response;
    return {
      ...response,
      from: await listInventory(db, new URL(`https://dummy.local/api/inventory?source=${fromSource}`)),
      to: await listInventory(db, new URL(`https://dummy.local/api/inventory?source=${toSource}`)),
    };
  };

  // Idempotency has priority over current operational gates. If the exact request already
  // committed, a network retry must return that success even if a stocktake started afterwards.
  const existingDocument = await db.prepare(
    `SELECT id, external_id, request_fingerprint, from_source, to_source, status, created_at
     FROM inventory_transfer_documents WHERE request_id = ? LIMIT 1`
  ).bind(requestId).first<Record<string, unknown>>();
  if (existingDocument) return await duplicateResponse(existingDocument);

  await assertNoActiveStocktakeForTransfer(db, fromSource, toSource);

  // Step 190.2: variant identity, stock and reservations are loaded set-wise. The UI may
  // legitimately send 60 lines; processing those lines must not become 60-180 D1 queries.
  const aggregatedInput = new Map<number, {
    quantity: number;
    expectedQuantity: number | null;
    observedPhysicalQuantity: number | null;
  }>();
  for (const raw of rawItems) {
    const normalized = normalizeInventoryItem(raw);
    if (normalized.quantity <= 0) continue;
    const variantId = Math.max(0, toInt(normalized.variantId, 0));
    if (!variantId) throw new Error('Для перемещения нужна точная каноническая комбинация товара.');
    const rawObserved = raw?.observedPhysicalQuantity;
    let observedPhysicalQuantity: number | null = null;
    if (rawObserved !== null && rawObserved !== undefined && cleanText(rawObserved) !== '') {
      const observed = Number(rawObserved);
      if (!Number.isFinite(observed) || observed < 0 || !Number.isInteger(observed)) {
        throw new Error('Фактическое количество должно быть целым числом 0 или больше.');
      }
      observedPhysicalQuantity = observed;
    }
    const expectedQuantity = normalized.expectedQuantity;
    const previous = aggregatedInput.get(variantId);
    if (previous) {
      if (previous.observedPhysicalQuantity !== observedPhysicalQuantity || previous.expectedQuantity !== expectedQuantity) {
        throw new Error('Для одной комбинации переданы противоречивые данные фактической сверки. Оставьте одну строку этой комбинации.');
      }
      previous.quantity += Math.max(0, normalized.quantity);
    } else {
      aggregatedInput.set(variantId, {
        quantity: Math.max(0, normalized.quantity),
        expectedQuantity,
        observedPhysicalQuantity,
      });
    }
  }
  if (!aggregatedInput.size) throw new Error('Укажите количество хотя бы для одной позиции.');

  const variantIds = Array.from(aggregatedInput.keys());
  const variantIdsJson = JSON.stringify(variantIds);
  const canonicalResult = await db.prepare(
    `SELECT v.id AS variant_id, v.product_id, p.name AS product_name,
            COALESCE(v.category, p.category, 'adult') AS category,
            v.gender, v.color, v.material, v.length, v.size_label
     FROM catalog_variants v
     JOIN catalog_products p ON p.id = v.product_id
     WHERE v.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
  ).bind(variantIdsJson).all<Record<string, unknown>>();
  const canonicalById = new Map<number, CanonicalVariantSnapshot>();
  for (const row of canonicalResult.results || []) {
    const variantId = toInt(row.variant_id, 0);
    if (!variantId) continue;
    canonicalById.set(variantId, {
      productId: toInt(row.product_id, 0),
      variantId,
      productName: cleanText(row.product_name),
      category: normalizeAudienceCategory(row.category, row.size_label),
      gender: cleanText(row.gender) || null,
      color: cleanText(row.color) || null,
      material: canonicalStockPositionValue(row.material) || null,
      length: canonicalStockPositionValue(row.length) || null,
      size: cleanText(row.size_label) || null,
    });
  }
  const missingCanonical = variantIds.filter(id => !canonicalById.has(id));
  if (missingCanonical.length) throw new Error('Одна из выбранных комбинаций больше не существует. Обновите склад и повторите перемещение.');

  const stocksResult = await db.prepare(
    `SELECT id, inventory_source, variant_id, quantity, reserved_quantity
     FROM inventory_stock
     WHERE inventory_source IN (?, ?)
       AND variant_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
  ).bind(fromSource, toSource, variantIdsJson).all<Record<string, unknown>>();
  const stockBySourceVariant = new Map<string, Record<string, unknown>>();
  for (const row of stocksResult.results || []) {
    stockBySourceVariant.set(`${cleanText(row.inventory_source)}:${toInt(row.variant_id, 0)}`, row);
  }

  const reservationsResult = await db.prepare(
    `SELECT inventory_source, variant_id, COALESCE(SUM(quantity), 0) AS qty
     FROM inventory_reservations
     WHERE inventory_source IN (?, ?)
       AND status = 'active'
       AND variant_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
     GROUP BY inventory_source, variant_id`
  ).bind(fromSource, toSource, variantIdsJson).all<Record<string, unknown>>();
  const reservationsBySourceVariant = new Map<string, number>();
  for (const row of reservationsResult.results || []) {
    reservationsBySourceVariant.set(
      `${cleanText(row.inventory_source)}:${toInt(row.variant_id, 0)}`,
      Math.max(0, toInt(row.qty, 0)),
    );
  }

  const prepared: Array<PreparedInventoryTransferItem & { targetReservedQuantity: number }> = [];
  for (const variantId of variantIds) {
    const entry = aggregatedInput.get(variantId)!;
    const canonical = canonicalById.get(variantId)!;
    const item: InventoryResolvedItem = {
      productId: canonical.productId,
      variantId: canonical.variantId,
      productName: upperText(canonical.productName),
      category: canonical.category,
      gender: upperText(canonical.gender) || null,
      color: upperText(canonical.color) || null,
      material: canonicalStockPositionValue(canonical.material),
      length: canonicalStockPositionValue(canonical.length),
      size: cleanText(canonical.size) || null,
      quantity: entry.quantity,
      expectedQuantity: entry.expectedQuantity,
    };
    const sourceStock = stockBySourceVariant.get(`${fromSource}:${variantId}`);
    const targetStock = stockBySourceVariant.get(`${toSource}:${variantId}`);
    const sourceRowExisted = Boolean(sourceStock?.id);
    const sourceCurrent = toInt(sourceStock?.quantity, 0);
    const targetCurrent = toInt(targetStock?.quantity, 0);
    const reservedAtSource = reservationsBySourceVariant.get(`${fromSource}:${variantId}`) || 0;
    const targetReservedQuantity = reservationsBySourceVariant.get(`${toSource}:${variantId}`) || 0;

    let effectiveSourceBefore = sourceCurrent;
    if (!sourceRowExisted && entry.observedPhysicalQuantity === null) {
      throw new Error(`«${item.productName}» не числится в точке «${fromSource === 'warehouse' ? 'Склад' : 'Бутик'}». Если товар физически находится здесь, укажите фактическое количество прямо в строке перемещения.`);
    }
    if (entry.observedPhysicalQuantity !== null) {
      if (entry.expectedQuantity === null || entry.expectedQuantity === undefined) {
        throw new Error(`Перед фактической сверкой «${item.productName}» обновите остатки и повторите перемещение.`);
      }
      if (sourceCurrent !== entry.expectedQuantity) {
        throw new Error(`Остаток «${item.productName}» изменился после открытия формы: было ${entry.expectedQuantity}, сейчас ${sourceCurrent}. Обновите данные и повторите.`);
      }
      effectiveSourceBefore = entry.observedPhysicalQuantity;
    }
    if (entry.quantity > effectiveSourceBefore) {
      throw new Error(`По учёту в точке «${fromSource === 'warehouse' ? 'Склад' : 'Бутик'}» у «${item.productName}» на месте ${effectiveSourceBefore} шт., а переместить нужно ${entry.quantity}. Если товар физически есть, укажите фактическое количество прямо в строке перемещения.`);
    }
    const shortageAfter = Math.max(0, reservedAtSource - (effectiveSourceBefore - entry.quantity));
    prepared.push({
      item,
      variantId,
      quantity: entry.quantity,
      sourceCurrent,
      sourceRowExisted,
      targetCurrent,
      effectiveSourceBefore,
      reservedAtSource,
      shortageAfter,
      observedPhysicalQuantity: entry.observedPhysicalQuantity,
      targetReservedQuantity,
    });
  }

  const now = new Date().toISOString();
  const externalId = inventoryTransferExternalId();
  // Step 191D: keep the 60-line Cloudflare bind budget without using json_each(?) as a
  // table-valued row source inside every batched mutation. The video failure compiled with
  // EXPLAIN on live D1 but rolled the whole batch back at runtime. One compact JSON payload per
  // row keeps every statement <= 66 binds (D1 max is 100) and uses an ordinary VALUES CTE.
  const transferRowBindings = prepared.map(row => JSON.stringify({
    variantId: row.variantId,
    productId: toInt(row.item.productId, 0),
    sourceCurrent: row.sourceCurrent,
    targetCurrent: row.targetCurrent,
    effectiveBefore: row.effectiveSourceBefore,
    moveQty: row.quantity,
    reservedQty: row.reservedAtSource,
    targetReservedQty: row.targetReservedQuantity,
    shortageAfter: row.shortageAfter,
    observedPhysical: row.observedPhysicalQuantity,
  }));
  const transferInputValuesSql = transferRowBindings.map(() => '(?)').join(', ');
  const transferRowsSql = `input(payload) AS (VALUES ${transferInputValuesSql}),
    x AS (
      SELECT
        CAST(json_extract(payload, '$.variantId') AS INTEGER) AS variant_id,
        CAST(json_extract(payload, '$.productId') AS INTEGER) AS product_id,
        CAST(json_extract(payload, '$.sourceCurrent') AS INTEGER) AS source_current,
        CAST(json_extract(payload, '$.targetCurrent') AS INTEGER) AS target_current,
        CAST(json_extract(payload, '$.effectiveBefore') AS INTEGER) AS effective_before,
        CAST(json_extract(payload, '$.moveQty') AS INTEGER) AS move_qty,
        CAST(json_extract(payload, '$.reservedQty') AS INTEGER) AS reserved_qty,
        CAST(json_extract(payload, '$.targetReservedQty') AS INTEGER) AS target_reserved_qty,
        CAST(json_extract(payload, '$.shortageAfter') AS INTEGER) AS shortage_after,
        CASE WHEN json_type(payload, '$.observedPhysical') = 'null' THEN NULL
             ELSE CAST(json_extract(payload, '$.observedPhysical') AS INTEGER) END AS observed_physical
      FROM input
    )`;

  const ensureSourceStock = db.prepare(
    `WITH ${transferRowsSql}
     INSERT OR IGNORE INTO inventory_stock (
       inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
       material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
       last_action, last_source_ref, created_at, updated_at
     )
     SELECT ?, v.product_id, v.id, p.name, NULLIF(v.gender,''), NULLIF(v.color,''),
            COALESCE(NULLIF(v.material,''),'СТАНДАРТ'), COALESCE(NULLIF(v.length,''),'СТАНДАРТ'), NULLIF(v.size_label,''),
            0, x.reserved_qty, 'Фактическая сверка', ?, ?, ?
     FROM x JOIN catalog_variants v ON v.id = x.variant_id JOIN catalog_products p ON p.id = v.product_id`
  ).bind(...transferRowBindings, fromSource, externalId, now, now);

  const guard = db.prepare(
    `WITH ${transferRowsSql}
     INSERT INTO inventory_model_meta (key, value, updated_at)
     SELECT 'human_inventory_v2', '__transfer_conflict__', ?
     WHERE EXISTS (
       SELECT 1 FROM x
       LEFT JOIN inventory_stock s ON s.inventory_source = ? AND s.variant_id = x.variant_id
       LEFT JOIN inventory_stock t ON t.inventory_source = ? AND t.variant_id = x.variant_id
       WHERE s.id IS NULL OR COALESCE(s.quantity, 0) <> x.source_current OR COALESCE(t.quantity, 0) <> x.target_current
     )
     OR EXISTS (
       SELECT 1 FROM inventory_stocktake_sessions
       WHERE status = 'active' AND inventory_source IN (?, ?)
     )`
  ).bind(...transferRowBindings, now, fromSource, toSource, fromSource, toSource);

  const insertDocument = db.prepare(
    `INSERT INTO inventory_transfer_documents (
       external_id, request_id, request_fingerprint, from_source, to_source, status, comment, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, 'applied', ?, ?, ?)`
  ).bind(externalId, requestId, requestFingerprint, fromSource, toSource, comment || null, cleanText(actor) || null, now);

  const ensureTargetStock = db.prepare(
    `WITH ${transferRowsSql}
     INSERT OR IGNORE INTO inventory_stock (
       inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
       material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
       last_action, last_source_ref, created_at, updated_at
     )
     SELECT ?, v.product_id, v.id, p.name, NULLIF(v.gender,''), NULLIF(v.color,''),
            COALESCE(NULLIF(v.material,''),'СТАНДАРТ'), COALESCE(NULLIF(v.length,''),'СТАНДАРТ'), NULLIF(v.size_label,''),
            0, x.target_reserved_qty, 'Перемещение', ?, ?, ?
     FROM x JOIN catalog_variants v ON v.id = x.variant_id JOIN catalog_products p ON p.id = v.product_id`
  ).bind(...transferRowBindings, toSource, externalId, now, now);

  const canonicalizeStockSnapshots = db.prepare(
    `WITH ${transferRowsSql}
     UPDATE inventory_stock
     SET product_id = (SELECT v.product_id FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
         product_name_snapshot = (SELECT p.name FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id WHERE v.id = inventory_stock.variant_id),
         gender_snapshot = (SELECT NULLIF(v.gender,'') FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
         color_snapshot = (SELECT NULLIF(v.color,'') FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
         material_snapshot = (SELECT COALESCE(NULLIF(v.material,''),'СТАНДАРТ') FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
         length_snapshot = (SELECT COALESCE(NULLIF(v.length,''),'СТАНДАРТ') FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
         size_snapshot = (SELECT NULLIF(v.size_label,'') FROM catalog_variants v WHERE v.id = inventory_stock.variant_id)
     WHERE inventory_source IN (?, ?) AND EXISTS (SELECT 1 FROM x WHERE x.variant_id = inventory_stock.variant_id)`
  ).bind(...transferRowBindings, fromSource, toSource);

  const applyObservation = db.prepare(
    `WITH ${transferRowsSql}
     UPDATE inventory_stock
     SET quantity = (SELECT effective_before FROM x WHERE x.variant_id = inventory_stock.variant_id),
         last_action = 'Быстрая сверка', last_source_ref = ?, updated_at = ?
     WHERE inventory_source = ?
       AND EXISTS (SELECT 1 FROM x WHERE x.variant_id = inventory_stock.variant_id)
       AND quantity <> (SELECT effective_before FROM x WHERE x.variant_id = inventory_stock.variant_id)`
  ).bind(...transferRowBindings, externalId, now, fromSource);

  const observationMovements = db.prepare(
    `WITH ${transferRowsSql}
     INSERT INTO inventory_movements (
       inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
       material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after, reference_type, reference_id, comment, created_at
     )
     SELECT ?, 'revision', v.product_id, v.id, p.name, NULLIF(v.gender,''), NULLIF(v.color,''),
            COALESCE(NULLIF(v.material,''),'СТАНДАРТ'), COALESCE(NULLIF(v.length,''),'СТАНДАРТ'), NULLIF(v.size_label,''),
            x.effective_before - x.source_current, x.effective_before,
            'transfer_stocktake', ? || ':' || v.id, 'Фактическая сверка перед перемещением', ?
     FROM x JOIN catalog_variants v ON v.id = x.variant_id JOIN catalog_products p ON p.id = v.product_id
     WHERE x.effective_before <> x.source_current`
  ).bind(...transferRowBindings, fromSource, externalId, now);

  const observationChecks = db.prepare(
    `WITH ${transferRowsSql}
     INSERT OR IGNORE INTO inventory_stock_checks (
       check_key, inventory_source, product_id, variant_id,
       expected_quantity, counted_quantity, difference_quantity, reserved_quantity,
       check_type, reference_type, reference_id, checked_by, checked_at, created_at
     )
     SELECT 'transfer:' || ? || ':' || x.variant_id, ?, x.product_id, x.variant_id,
            x.source_current, x.effective_before, x.effective_before - x.source_current, x.reserved_qty,
            'transfer_observation', 'transfer', ?, ?, ?, ?
     FROM x
     WHERE x.observed_physical IS NOT NULL`
  ).bind(...transferRowBindings, externalId, fromSource, externalId, cleanText(actor) || null, now, now);

  const updateSource = db.prepare(
    `WITH ${transferRowsSql}
     UPDATE inventory_stock
     SET quantity = (SELECT effective_before - move_qty FROM x WHERE x.variant_id = inventory_stock.variant_id),
         last_action = 'Перемещение', last_source_ref = ?, updated_at = ?
     WHERE inventory_source = ? AND EXISTS (SELECT 1 FROM x WHERE x.variant_id = inventory_stock.variant_id)`
  ).bind(...transferRowBindings, externalId, now, fromSource);

  const updateTarget = db.prepare(
    `WITH ${transferRowsSql}
     UPDATE inventory_stock
     SET quantity = quantity + (SELECT move_qty FROM x WHERE x.variant_id = inventory_stock.variant_id),
         last_action = 'Перемещение', last_source_ref = ?, updated_at = ?
     WHERE inventory_source = ? AND EXISTS (SELECT 1 FROM x WHERE x.variant_id = inventory_stock.variant_id)`
  ).bind(...transferRowBindings, externalId, now, toSource);

  const transferOutMovements = db.prepare(
    `WITH ${transferRowsSql}
     INSERT INTO inventory_movements (
       inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
       material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after, reference_type, reference_id, comment, created_at
     )
     SELECT ?, 'writeoff', v.product_id, v.id, p.name, NULLIF(v.gender,''), NULLIF(v.color,''),
            COALESCE(NULLIF(v.material,''),'СТАНДАРТ'), COALESCE(NULLIF(v.length,''),'СТАНДАРТ'), NULLIF(v.size_label,''),
            -x.move_qty, x.effective_before - x.move_qty, 'transfer_out', ?, ?, ?
     FROM x JOIN catalog_variants v ON v.id = x.variant_id JOIN catalog_products p ON p.id = v.product_id`
  ).bind(...transferRowBindings, fromSource, externalId, comment || `Перемещение в ${toSource === 'warehouse' ? 'Склад' : 'Бутик'}`, now);

  const transferInMovements = db.prepare(
    `WITH ${transferRowsSql}
     INSERT INTO inventory_movements (
       inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
       material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after, reference_type, reference_id, comment, created_at
     )
     SELECT ?, 'arrival', v.product_id, v.id, p.name, NULLIF(v.gender,''), NULLIF(v.color,''),
            COALESCE(NULLIF(v.material,''),'СТАНДАРТ'), COALESCE(NULLIF(v.length,''),'СТАНДАРТ'), NULLIF(v.size_label,''),
            x.move_qty, x.target_current + x.move_qty, 'transfer_in', ?, ?, ?
     FROM x JOIN catalog_variants v ON v.id = x.variant_id JOIN catalog_products p ON p.id = v.product_id`
  ).bind(...transferRowBindings, toSource, externalId, comment || `Перемещение из ${fromSource === 'warehouse' ? 'Склад' : 'Бутик'}`, now);

  const insertItems = db.prepare(
    `WITH ${transferRowsSql}
     INSERT INTO inventory_transfer_items (
       transfer_id, product_id, variant_id, quantity,
       from_quantity_before, from_quantity_after, to_quantity_before, to_quantity_after,
       source_reserved_quantity, source_shortage_after, created_at
     )
     SELECT (SELECT id FROM inventory_transfer_documents WHERE request_id = ?), v.product_id, v.id, x.move_qty,
            x.effective_before, x.effective_before - x.move_qty, x.target_current, x.target_current + x.move_qty,
            x.reserved_qty, x.shortage_after, ?
     FROM x JOIN catalog_variants v ON v.id = x.variant_id`
  ).bind(...transferRowBindings, requestId, now);

  try {
    await db.batch([
      ensureSourceStock,
      guard,
      insertDocument,
      ensureTargetStock,
      canonicalizeStockSnapshots,
      applyObservation,
      observationMovements,
      observationChecks,
      updateSource,
      updateTarget,
      transferOutMovements,
      transferInMovements,
      insertItems,
    ]);
  } catch (error) {
    // Two identical retries may race before either request sees the document. The UNIQUE request_id
    // makes only one batch win; the loser must be reported as a successful duplicate, not as a stock conflict.
    const racedDocument = await db.prepare(
      `SELECT id, external_id, request_fingerprint, from_source, to_source, status, created_at
       FROM inventory_transfer_documents WHERE request_id = ? LIMIT 1`
    ).bind(requestId).first<Record<string, unknown>>();
    if (racedDocument) return await duplicateResponse(racedDocument);
    await assertNoActiveStocktakeForTransfer(db, fromSource, toSource);

    const currentRows = await db.prepare(
      `SELECT inventory_source, variant_id, quantity FROM inventory_stock
       WHERE inventory_source IN (?, ?)
         AND variant_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
    ).bind(fromSource, toSource, variantIdsJson).all<Record<string, unknown>>();
    const currentMap = new Map((currentRows.results || []).map(row => [`${cleanText(row.inventory_source)}:${toInt(row.variant_id, 0)}`, toInt(row.quantity, 0)]));
    const changed = prepared.filter(row => {
      const sourceKey = `${fromSource}:${row.variantId}`;
      const targetKey = `${toSource}:${row.variantId}`;
      const sourceChanged = row.sourceRowExisted
        ? !currentMap.has(sourceKey) || currentMap.get(sourceKey) !== row.sourceCurrent
        : currentMap.has(sourceKey) && currentMap.get(sourceKey) !== row.sourceCurrent;
      return sourceChanged
        || (currentMap.has(targetKey) ? currentMap.get(targetKey) !== row.targetCurrent : row.targetCurrent !== 0);
    });
    if (changed.length) throw new Error(`Остатки изменились во время сохранения перемещения (${changed.length} поз.). Ничего не перемещено. Обновите данные и повторите.`);
    console.error(JSON.stringify({
      event: 'inventory_transfer_batch_error',
      requestId,
      externalId,
      fromSource,
      toSource,
      variants: prepared.map(row => ({ variantId: row.variantId, quantity: row.quantity })),
      message: cleanText(error instanceof Error ? error.message : error).slice(0, 800),
    }));
    throw error;
  }

  const document = await db.prepare(
    `SELECT id, external_id FROM inventory_transfer_documents WHERE request_id = ? LIMIT 1`
  ).bind(requestId).first<Record<string, unknown>>();
  const warnings = prepared.filter(row => row.shortageAfter > 0).map(row => ({ variantId: row.variantId, productName: row.item.productName, shortageAfter: row.shortageAfter }));
  const response = {
    ok: true,
    duplicate: false,
    transferId: toInt(document?.id, 0),
    externalId: cleanText(document?.external_id) || externalId,
    fromSource,
    toSource,
    applied: prepared.length,
    totalQuantity: prepared.reduce((sum, row) => sum + row.quantity, 0),
    warnings,
  };
  if (!returnInventory) return response;
  return {
    ...response,
    from: await listInventory(db, new URL(`https://dummy.local/api/inventory?source=${fromSource}`)),
    to: await listInventory(db, new URL(`https://dummy.local/api/inventory?source=${toSource}`)),
  };
}


export async function reverseInventoryTransferDocument(db: D1Database, externalId: string, actor = '', comment = '') {
  const document = await db.prepare(
    `SELECT * FROM inventory_transfer_documents WHERE external_id = ? LIMIT 1`
  ).bind(externalId).first<Record<string, unknown>>();
  if (!document) throw new Error('Документ перемещения не найден.');
  if (cleanText(document.status) === 'reversed') throw new Error('Это перемещение уже отменено.');
  const fromSource = normalizeSourceType(document.from_source);
  const toSource = normalizeSourceType(document.to_source);
  await assertNoActiveStocktakeForTransfer(db, fromSource, toSource);

  const itemRows = await db.prepare(
    `SELECT i.*, p.name AS product_name, v.gender, v.color, v.material, v.length, v.size_label
     FROM inventory_transfer_items i
     JOIN catalog_variants v ON v.id = i.variant_id
     JOIN catalog_products p ON p.id = i.product_id
     WHERE i.transfer_id = ? ORDER BY i.id ASC`
  ).bind(toInt(document.id, 0)).all<Record<string, unknown>>();
  const items = itemRows.results || [];
  if (!items.length) throw new Error('В документе перемещения нет позиций.');

  const variantIds = Array.from(new Set(items.map(row => toInt(row.variant_id, 0)).filter(Boolean)));
  const variantIdsJson = JSON.stringify(variantIds);
  const stocks = await db.prepare(
    `SELECT inventory_source, variant_id, quantity FROM inventory_stock
     WHERE inventory_source IN (?, ?)
       AND variant_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
  ).bind(fromSource, toSource, variantIdsJson).all<Record<string, unknown>>();
  const stockMap = new Map((stocks.results || []).map(row => [`${cleanText(row.inventory_source)}:${toInt(row.variant_id, 0)}`, Math.max(0, toInt(row.quantity, 0))]));

  const prepared = items.map(row => {
    const variantId = toInt(row.variant_id, 0);
    const quantity = Math.max(0, toInt(row.quantity, 0));
    const sourceCurrent = stockMap.get(`${fromSource}:${variantId}`) ?? 0;
    const targetCurrent = stockMap.get(`${toSource}:${variantId}`) ?? 0;
    if (targetCurrent < quantity) throw new Error(`Нельзя безопасно отменить перемещение «${cleanText(row.product_name)}»: в точке «${toSource === 'warehouse' ? 'Склад' : 'Бутик'}» сейчас ${targetCurrent} шт., для возврата нужно ${quantity}. Сначала разберите фактический остаток.`);
    return { variantId, quantity, sourceCurrent, targetCurrent };
  });

  const now = new Date().toISOString();
  const reversalRef = `${externalId}:reversal`;
  const reversalComment = cleanText(comment) || `Отмена перемещения ${externalId}`;
  // Step 191E: reversal now uses the same one-bind-per-row VALUES source as forward transfer.
  // The old repeated json_each(?) rowset was the closest remaining analogue to the live 191D
  // runtime failure. 60 rows + fixed metadata stays below D1's 100-bind limit per statement.
  const reversalRowBindings = prepared.map(row => JSON.stringify({
    variantId: row.variantId,
    sourceCurrent: row.sourceCurrent,
    targetCurrent: row.targetCurrent,
    moveQty: row.quantity,
  }));
  const reversalValuesSql = reversalRowBindings.map(() => '(?)').join(', ');
  const reversalRowsSql = `input(payload) AS (VALUES ${reversalValuesSql}),
    x AS (
      SELECT
        CAST(json_extract(payload, '$.variantId') AS INTEGER) AS variant_id,
        CAST(json_extract(payload, '$.sourceCurrent') AS INTEGER) AS source_current,
        CAST(json_extract(payload, '$.targetCurrent') AS INTEGER) AS target_current,
        CAST(json_extract(payload, '$.moveQty') AS INTEGER) AS move_qty
      FROM input
    )`;

  const guard = db.prepare(
    `WITH ${reversalRowsSql}
     INSERT INTO inventory_model_meta (key, value, updated_at)
     SELECT 'human_inventory_v2', '__transfer_reverse_conflict__', ?
     WHERE EXISTS (
       SELECT 1 FROM x
       LEFT JOIN inventory_stock s ON s.inventory_source = ? AND s.variant_id = x.variant_id
       LEFT JOIN inventory_stock t ON t.inventory_source = ? AND t.variant_id = x.variant_id
       WHERE s.id IS NULL OR t.id IS NULL OR COALESCE(s.quantity, 0) <> x.source_current OR COALESCE(t.quantity, 0) <> x.target_current
     )
     OR EXISTS (
       SELECT 1 FROM inventory_stocktake_sessions
       WHERE status = 'active' AND inventory_source IN (?, ?)
     )
     OR NOT EXISTS (
       SELECT 1 FROM inventory_transfer_documents WHERE id = ? AND status = 'applied'
     )`
  ).bind(...reversalRowBindings, now, fromSource, toSource, fromSource, toSource, toInt(document.id, 0));
  const sourceUpdate = db.prepare(
    `WITH ${reversalRowsSql}
     UPDATE inventory_stock
     SET quantity = quantity + (SELECT move_qty FROM x WHERE x.variant_id = inventory_stock.variant_id),
         last_action = 'Отмена перемещения', last_source_ref = ?, updated_at = ?
     WHERE inventory_source = ? AND EXISTS (SELECT 1 FROM x WHERE x.variant_id = inventory_stock.variant_id)`
  ).bind(...reversalRowBindings, externalId, now, fromSource);
  const targetUpdate = db.prepare(
    `WITH ${reversalRowsSql}
     UPDATE inventory_stock
     SET quantity = quantity - (SELECT move_qty FROM x WHERE x.variant_id = inventory_stock.variant_id),
         last_action = 'Отмена перемещения', last_source_ref = ?, updated_at = ?
     WHERE inventory_source = ? AND EXISTS (SELECT 1 FROM x WHERE x.variant_id = inventory_stock.variant_id)`
  ).bind(...reversalRowBindings, externalId, now, toSource);
  const sourceMovements = db.prepare(
    `WITH ${reversalRowsSql}
     INSERT INTO inventory_movements (
       inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
       material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after, reference_type, reference_id, comment, created_at
     )
     SELECT ?, 'revision', v.product_id, v.id, p.name, NULLIF(v.gender,''), NULLIF(v.color,''),
            COALESCE(NULLIF(v.material,''),'СТАНДАРТ'), COALESCE(NULLIF(v.length,''),'СТАНДАРТ'), NULLIF(v.size_label,''),
            x.move_qty, x.source_current + x.move_qty, 'movement_reversal', ?, ?, ?
     FROM x JOIN catalog_variants v ON v.id = x.variant_id JOIN catalog_products p ON p.id = v.product_id`
  ).bind(...reversalRowBindings, fromSource, reversalRef, reversalComment, now);
  const targetMovements = db.prepare(
    `WITH ${reversalRowsSql}
     INSERT INTO inventory_movements (
       inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
       material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after, reference_type, reference_id, comment, created_at
     )
     SELECT ?, 'revision', v.product_id, v.id, p.name, NULLIF(v.gender,''), NULLIF(v.color,''),
            COALESCE(NULLIF(v.material,''),'СТАНДАРТ'), COALESCE(NULLIF(v.length,''),'СТАНДАРТ'), NULLIF(v.size_label,''),
            -x.move_qty, x.target_current - x.move_qty, 'movement_reversal', ?, ?, ?
     FROM x JOIN catalog_variants v ON v.id = x.variant_id JOIN catalog_products p ON p.id = v.product_id`
  ).bind(...reversalRowBindings, toSource, reversalRef, reversalComment, now);
  const markReversed = db.prepare(
    `UPDATE inventory_transfer_documents SET status = 'reversed', reversed_by = ?, reversed_at = ? WHERE id = ? AND status = 'applied'`
  ).bind(cleanText(actor) || null, now, toInt(document.id, 0));
  const linkReversals = db.prepare(
    `INSERT OR IGNORE INTO inventory_movement_reversals (
       original_movement_id, reversal_movement_id, operation_reference_id, operation_created_at,
       comment, reversed_by, reversed_at
     )
     SELECT orig.id, rev.id, ?, orig.created_at, ?, ?, ?
     FROM inventory_movements orig
     JOIN inventory_movements rev
       ON rev.reference_id = ?
      AND rev.reference_type = 'movement_reversal'
      AND rev.inventory_source = orig.inventory_source
      AND rev.variant_id = orig.variant_id
      AND rev.quantity_delta = -orig.quantity_delta
     WHERE orig.reference_id = ? AND orig.reference_type IN ('transfer_in','transfer_out')`
  ).bind(externalId, reversalComment, cleanText(actor) || null, now, reversalRef, externalId);

  try {
    await db.batch([guard, sourceUpdate, targetUpdate, sourceMovements, targetMovements, markReversed, linkReversals]);
  } catch (error) {
    await assertNoActiveStocktakeForTransfer(db, fromSource, toSource);
    const current = await db.prepare(
      `SELECT inventory_source, variant_id, quantity FROM inventory_stock
       WHERE inventory_source IN (?, ?)
         AND variant_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
    ).bind(fromSource, toSource, variantIdsJson).all<Record<string, unknown>>();
    const currentMap = new Map((current.results || []).map(row => [`${cleanText(row.inventory_source)}:${toInt(row.variant_id, 0)}`, toInt(row.quantity, 0)]));
    const changed = prepared.some(row => {
      const sourceKey = `${fromSource}:${row.variantId}`;
      const targetKey = `${toSource}:${row.variantId}`;
      return !currentMap.has(sourceKey) || !currentMap.has(targetKey)
        || currentMap.get(sourceKey) !== row.sourceCurrent
        || currentMap.get(targetKey) !== row.targetCurrent;
    });
    if (changed) throw new Error('Остатки изменились во время отмены перемещения. Ничего не отменено. Обновите склад и повторите.');
    throw error;
  }

  return { ok: true, transferId: toInt(document.id, 0), externalId, reversedRows: prepared.length * 2, operationReferenceId: externalId };
}


export async function getInventoryControlSettings(db: D1Database) {
  return {
    ok: true,
    autoWriteoffEnabled: await isInventoryAutoWriteoffEnabled(db),
    pendingWriteoffCount: await getPendingInventoryWriteoffCount(db),
  };
}


export async function updateInventoryControlSettings(db: D1Database, input: { autoWriteoffEnabled?: unknown }) {
  const enabled = input.autoWriteoffEnabled === true || cleanText(input.autoWriteoffEnabled).toLowerCase() === 'true' || cleanText(input.autoWriteoffEnabled) === '1';
  await setAppSetting(db, 'inventory_auto_writeoff_enabled', enabled ? '1' : '0');
  return await getInventoryControlSettings(db);
}


export async function applyPendingInventoryWriteoffs(db: D1Database) {
  const rows = await db.prepare(
    `SELECT
       oi.id AS order_item_id, oi.order_id, o.external_id,
       oi.product_id, oi.variant_id, oi.product_name_snapshot, oi.audience_type,
       oi.gender_snapshot, oi.color_snapshot, oi.material_snapshot, oi.length_snapshot, oi.size_snapshot,
       oi.quantity, oi.source_type
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.is_workshop = 0
       AND oi.quantity > 0
       AND COALESCE(oi.stock_writeoff_status, '') IN ('writeoff_disabled', 'pending_manual_writeoff')
       AND COALESCE(o.order_status, '') <> 'deleted'
     ORDER BY oi.id ASC
     LIMIT 2000`
  ).all<Record<string, unknown>>();

  const now = new Date().toISOString();
  let applied = 0;
  let reconciled = 0;
  for (const row of rows.results || []) {
    const orderItemId = toInt(row.order_item_id, 0);
    const externalId = cleanText(row.external_id);
    if (!orderItemId || !externalId) continue;
    const normalizedItem = {
      productName: cleanText(row.product_name_snapshot),
      audienceType: normalizeAudienceCategory(row.audience_type, row.size_snapshot) === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ',
      gender: cleanText(row.gender_snapshot),
      color: cleanText(row.color_snapshot),
      material: cleanText(row.material_snapshot),
      length: cleanText(row.length_snapshot),
      size: cleanText(row.size_snapshot),
      quantity: Math.max(0, toInt(row.quantity, 0)),
      unitPrice: 0,
      lineTotal: 0,
      isWorkshop: false,
      inventorySource: normalizeSourceType(row.source_type),
      workshopComment: '',
      workshopUrgent: false,
      workshopDueDate: '',
    } as ReturnType<typeof normalizeOrderItems>[number];
    if (!normalizedItem.productName || !normalizedItem.quantity) continue;

    // Step 188 idempotence guard: if a previous attempt already wrote the movement but
    // failed before updating order_items, synchronize the status instead of subtracting stock twice.
    const existingMovement = await findInventoryMovementMatch(db, {
      source: normalizedItem.inventorySource,
      movementType: 'sale',
      referenceType: 'order_manual_writeoff',
      referenceTypes: ['order_manual_writeoff', 'order', 'order_edit_new'],
      referenceId: externalId,
      referenceIds: [externalId],
      productName: normalizedItem.productName,
      gender: normalizedItem.gender || null,
      color: normalizedItem.color || null,
      material: normalizedItem.material || null,
      length: normalizedItem.length || null,
      size: normalizedItem.size || null,
      variantId: toInt(row.variant_id, 0) || null,
      quantityDelta: -normalizedItem.quantity,
    });
    if (existingMovement?.id) {
      const quantityAfter = toInt(existingMovement.quantityAfter, 0);
      await db.prepare(
        `UPDATE order_items
         SET stock_writeoff_status = ?,
             stock_quantity_before = COALESCE(stock_quantity_before, ?),
             stock_quantity_after = ?
         WHERE id = ?`
      ).bind(
        quantityAfter < 0 ? 'negative' : 'written_off',
        quantityAfter + normalizedItem.quantity,
        quantityAfter,
        orderItemId,
      ).run();
      reconciled += 1;
      continue;
    }

    await applyOrderStockWriteOff(
      db,
      toInt(row.order_id, 0),
      externalId,
      normalizedItem,
      toInt(row.product_id, 0),
      toInt(row.variant_id, 0) || null,
      now,
      orderItemId,
      'order_manual_writeoff',
      externalId,
      `Ручной запуск отложенного списания по заказу ${externalId}`,
    );
    applied += 1;
  }

  return {
    ok: true,
    applied,
    reconciled,
    pendingWriteoffCount: await getPendingInventoryWriteoffCount(db),
  };
}


export async function reverseInventoryMovementOperation(
  db: D1Database,
  movementId: number,
  actor = '',
  comment = '',
  returnInventory = true,
) {
  const original = await db.prepare(
    `SELECT m.*,
       r.reversed_at,
       CASE WHEN rr.original_movement_id IS NOT NULL THEN 1 ELSE 0 END AS is_reversal
     FROM inventory_movements m
     LEFT JOIN inventory_movement_reversals r ON r.original_movement_id = m.id
     LEFT JOIN inventory_movement_reversals rr ON rr.reversal_movement_id = m.id
     WHERE m.id = ? LIMIT 1`
  ).bind(movementId).first<Record<string, unknown>>();

  if (!original) throw new Error('Складское движение не найдено.');
  if (cleanText(original.reversed_at)) throw new Error('Эта операция уже отменена.');
  if (toInt(original.is_reversal, 0) === 1 || cleanText(original.reference_type) === 'movement_reversal') {
    throw new Error('Движение отмены нельзя отменять повторно.');
  }
  if (!isReversibleInventoryMovementReference(original.reference_type)) {
    throw new Error('Эта операция отменяется в своём разделе или защищена от ручного отката.');
  }

  const referenceId = cleanText(original.reference_id);
  const createdAt = cleanText(original.created_at);
  const originalReferenceType = cleanText(original.reference_type).toLowerCase();
  if (referenceId && ['transfer_in', 'transfer_out'].includes(originalReferenceType)) {
    const transferDocument = await db.prepare(`SELECT id FROM inventory_transfer_documents WHERE external_id = ? LIMIT 1`).bind(referenceId).first<{ id: number }>();
    if (transferDocument?.id) return await reverseInventoryTransferDocument(db, referenceId, actor, comment);
  }

  const operationRows = referenceId && createdAt
    ? await db.prepare(
      `SELECT m.*,
         r.reversed_at,
         CASE WHEN rr.original_movement_id IS NOT NULL THEN 1 ELSE 0 END AS is_reversal
       FROM inventory_movements m
       LEFT JOIN inventory_movement_reversals r ON r.original_movement_id = m.id
       LEFT JOIN inventory_movement_reversals rr ON rr.reversal_movement_id = m.id
       WHERE m.reference_id = ? AND m.created_at = ?
       ORDER BY m.id DESC`
    ).bind(referenceId, createdAt).all<Record<string, unknown>>()
    : { results: [original] } as D1Result<Record<string, unknown>>;

  const rows = (operationRows.results || []).filter((row) => cleanText(row.reference_type) !== 'movement_reversal');
  if (!rows.length) throw new Error('Не удалось определить складскую операцию.');
  if (rows.some((row) => cleanText(row.reversed_at) || toInt(row.is_reversal, 0) === 1)) {
    throw new Error('Операция уже отменена полностью или частично. Обновите журнал.');
  }
  if (rows.some((row) => !toInt(row.variant_id, 0))) {
    throw new Error('Эту старую операцию нельзя безопасно отменить автоматически: у одной из строк нет канонического варианта. Используйте физическую сверку.');
  }

  const now = new Date().toISOString();
  const operationKey = referenceId || `movement-${movementId}`;
  const reversalComment = cleanText(comment) || `Отмена складской операции ${operationKey}`;

  type ReversalStockState = {
    source: SourceType;
    variantId: number;
    stockId: number;
    currentQuantity: number;
    simulatedQuantity: number;
  };
  const stockStateByKey = new Map<string, ReversalStockState>();
  for (const row of rows) {
    const source = normalizeSourceType(row.inventory_source);
    const variantId = toInt(row.variant_id, 0);
    const key = `${source}:${variantId}`;
    if (!stockStateByKey.has(key)) {
      const stock = await db.prepare(
        `SELECT id, quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? ORDER BY id ASC LIMIT 1`
      ).bind(source, variantId).first<{ id: number; quantity: number }>();
      if (!stock?.id) throw new Error(`Нельзя отменить операцию: текущая складская строка variant #${variantId} не найдена в точке ${source === 'warehouse' ? 'Склад' : 'Бутик'}.`);
      stockStateByKey.set(key, {
        source,
        variantId,
        stockId: stock.id,
        currentQuantity: toInt(stock.quantity, 0),
        simulatedQuantity: toInt(stock.quantity, 0),
      });
    }
  }

  // Reverse the operation in reverse movement order. This matters for a write-off that first
  // contained an inline physical observation and then the write-off itself: undo the write-off
  // first, then undo the observation. Never let an automatic reversal invent negative stock.
  const simulatedAfterByMovement = new Map<number, number>();
  for (const row of rows) {
    const source = normalizeSourceType(row.inventory_source);
    const variantId = toInt(row.variant_id, 0);
    const state = stockStateByKey.get(`${source}:${variantId}`)!;
    const reverseDelta = -toInt(row.quantity_delta, 0);
    const next = state.simulatedQuantity + reverseDelta;
    if (next < 0) {
      const name = cleanText(row.product_name_snapshot) || `variant #${variantId}`;
      throw new Error(`Операцию нельзя отменить напрямую: для «${name}» в точке ${source === 'warehouse' ? 'Склад' : 'Бутик'} физически недостаточно товара. По учёту сейчас ${state.simulatedQuantity} шт., для отката нужно убрать ${Math.abs(reverseDelta)} шт. Сначала выполните физическую сверку.`);
    }
    state.simulatedQuantity = next;
    simulatedAfterByMovement.set(toInt(row.id, 0), next);
  }

  // Step 191E: reversal statement count is bounded by chunks rather than movement rows.
  // Keep the complete operation in one D1 batch so any CAS conflict or linkage error rolls back
  // stock, reversal movements and reversal links together.
  const statements: D1PreparedStatement[] = [];
  const statePayloads = Array.from(stockStateByKey.values()).map(state => JSON.stringify({
    stockId: state.stockId,
    currentQuantity: state.currentQuantity,
    targetQuantity: state.simulatedQuantity,
  }));
  for (const payloadChunk of chunksOf(statePayloads, 70)) {
    const valuesSql = payloadChunk.map(() => '(?)').join(', ');
    const cte = `input(payload) AS (VALUES ${valuesSql}),
      x AS (
        SELECT CAST(json_extract(payload, '$.stockId') AS INTEGER) AS stock_id,
               CAST(json_extract(payload, '$.currentQuantity') AS INTEGER) AS current_quantity,
               CAST(json_extract(payload, '$.targetQuantity') AS INTEGER) AS target_quantity
        FROM input
      )`;
    statements.push(
      db.prepare(
        `WITH ${cte}
         INSERT INTO inventory_model_meta (key, value, updated_at)
         SELECT 'human_inventory_v2', '__movement_reversal_conflict__', ?
         WHERE EXISTS (
           SELECT 1 FROM x
           LEFT JOIN inventory_stock s ON s.id = x.stock_id
           WHERE s.id IS NULL OR COALESCE(s.quantity, 0) <> x.current_quantity
         )`
      ).bind(...payloadChunk, now),
      db.prepare(
        `WITH ${cte}
         UPDATE inventory_stock
         SET quantity = (SELECT x.target_quantity FROM x WHERE x.stock_id = inventory_stock.id),
             last_action = 'Отмена складской операции', last_source_ref = ?, updated_at = ?
         WHERE EXISTS (
           SELECT 1 FROM x
           WHERE x.stock_id = inventory_stock.id AND inventory_stock.quantity = x.current_quantity
         )`
      ).bind(...payloadChunk, `movement_reversal:${operationKey}`, now),
    );
  }

  const movementPayloads = rows.map(row => {
    const originalId = toInt(row.id, 0);
    const variantId = toInt(row.variant_id, 0);
    return JSON.stringify({
      originalId,
      source: normalizeSourceType(row.inventory_source),
      productId: toInt(row.product_id, 0) || null,
      variantId: variantId || null,
      productName: cleanText(row.product_name_snapshot),
      gender: cleanText(row.gender_snapshot) || null,
      color: cleanText(row.color_snapshot) || null,
      material: canonicalStockPositionValue(row.material_snapshot),
      length: canonicalStockPositionValue(row.length_snapshot),
      size: cleanText(row.size_snapshot) || null,
      reverseDelta: -toInt(row.quantity_delta, 0),
      quantityAfter: simulatedAfterByMovement.get(originalId) ?? 0,
      referenceId: `${operationKey}:movement:${originalId}`,
    });
  });
  for (const payloadChunk of chunksOf(movementPayloads, 70)) {
    const valuesSql = payloadChunk.map(() => '(?)').join(', ');
    const cte = `input(payload) AS (VALUES ${valuesSql}),
      x AS (
        SELECT CAST(json_extract(payload, '$.originalId') AS INTEGER) AS original_id,
               CAST(json_extract(payload, '$.source') AS TEXT) AS source,
               CAST(json_extract(payload, '$.productId') AS INTEGER) AS product_id,
               CAST(json_extract(payload, '$.variantId') AS INTEGER) AS variant_id,
               CAST(json_extract(payload, '$.productName') AS TEXT) AS product_name,
               json_extract(payload, '$.gender') AS gender,
               json_extract(payload, '$.color') AS color,
               json_extract(payload, '$.material') AS material,
               json_extract(payload, '$.length') AS length,
               json_extract(payload, '$.size') AS size,
               CAST(json_extract(payload, '$.reverseDelta') AS INTEGER) AS reverse_delta,
               CAST(json_extract(payload, '$.quantityAfter') AS INTEGER) AS quantity_after,
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
         SELECT x.source, 'revision', x.product_id, x.variant_id, x.product_name, x.gender,
                x.color, x.material, x.length, x.size, x.reverse_delta, x.quantity_after,
                'movement_reversal', x.reference_id, ?, ?
         FROM x`
      ).bind(...payloadChunk, reversalComment, now),
      db.prepare(
        `WITH ${cte}
         INSERT OR IGNORE INTO inventory_movement_reversals (
           original_movement_id, reversal_movement_id, operation_reference_id, operation_created_at,
           comment, reversed_by, reversed_at
         )
         SELECT x.original_id, rev.id, ?, ?, ?, ?, ?
         FROM x
         JOIN inventory_movements rev
           ON rev.reference_type = 'movement_reversal'
          AND rev.reference_id = x.reference_id`
      ).bind(
        ...payloadChunk,
        referenceId || null,
        createdAt || null,
        reversalComment,
        cleanText(actor) || null,
        now,
      ),
    );
  }

  await db.batch(statements);
  if (!returnInventory) return { ok: true, reversedRows: rows.length, operationReferenceId: operationKey };
  return {
    ok: true,
    reversedRows: rows.length,
    operationReferenceId: operationKey,
    warehouse: await listInventory(db, new URL('https://dummy.local/api/inventory?source=warehouse&limit=1000')),
    boutique: await listInventory(db, new URL('https://dummy.local/api/inventory?source=boutique&limit=1000')),
  };
}
