// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, normalizeCatalogCategory, toInt, upperText } from '../core/text.ts'

export function normalizeCatalogProductNameKey(value: unknown) {
  return upperText(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}


export function normalizeCatalogProductIdentityKey(value: unknown) {
  const replacements: Record<string, string> = {
    'Ә': 'А', 'Ғ': 'Г', 'Қ': 'К', 'Ң': 'Н', 'Ө': 'О', 'Ұ': 'У', 'Ү': 'У', 'Һ': 'Х', 'І': 'И', 'Ы': 'И', 'Ё': 'Е',
  };
  return normalizeCatalogProductNameKey(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ӘҒҚҢӨҰҮҺІЫЁ]/g, letter => replacements[letter] || letter)
    .replace(/[^A-ZА-Я0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


export async function findCanonicalCatalogProductByIdentity(
  db: D1Database,
  name: unknown,
  excludeId = 0,
  activeOnly = false,
) {
  const cleanName = upperText(name);
  if (!cleanName) return null;
  const activeClause = activeOnly ? ' AND is_active = 1' : '';
  const exact = await db.prepare(
    `SELECT id, name, category, external_id
     FROM catalog_products
     WHERE UPPER(TRIM(name)) = ? AND id <> ?${activeClause}
     ORDER BY id ASC
     LIMIT 1`
  ).bind(cleanName, excludeId).first<{ id: number; name: string; category: string; external_id?: string | null }>();
  if (exact?.id) return exact;

  const identityKey = normalizeCatalogProductIdentityKey(cleanName);
  if (!identityKey) return null;
  const rows = await db.prepare(
    `SELECT id, name, category, external_id
     FROM catalog_products
     WHERE id <> ?${activeClause}
     ORDER BY id ASC`
  ).bind(excludeId).all<{ id: number; name: string; category: string; external_id?: string | null }>();
  return (rows.results || []).find(row => normalizeCatalogProductIdentityKey(row.name) === identityKey) || null;
}


export async function findCatalogProductByIdentity(
  db: D1Database,
  name: unknown,
  excludeId = 0,
  options: { activeOnly?: boolean; allowAlias?: boolean } = {},
) {
  const cleanName = upperText(name);
  if (!cleanName) return null;
  const activeOnly = Boolean(options.activeOnly);
  const canonicalIdentity = await findCanonicalCatalogProductByIdentity(db, cleanName, excludeId, activeOnly);
  if (canonicalIdentity?.id) return canonicalIdentity;
  if (options.allowAlias === false) return null;

  const identityKey = normalizeCatalogProductIdentityKey(cleanName);
  if (!identityKey) return null;

  // Step 188F2: learned spellings are operational aliases for ACTIVE products only.
  // An inactive legacy/noise product must not disagree with the frontend and hijack an order.
  try {
    const alias = await db.prepare(
      `SELECT p.id, p.name, p.category, p.external_id
       FROM catalog_product_aliases a
       JOIN catalog_products p ON p.id = a.product_id
       WHERE a.alias_key = ? AND p.id <> ? AND p.is_active = 1
       LIMIT 1`
    ).bind(identityKey, excludeId).first<{ id: number; name: string; category: string; external_id?: string | null }>();
    if (alias?.id) return alias;
  } catch {
    // Migration 0050 is additive. A pre-migration Worker deploy must keep reading safely.
  }
  return null;
}



export async function assertCatalogProductAliasTargetAvailable(
  db: D1Database,
  rawName: unknown,
  targetProductId = 0,
) {
  const aliasKey = normalizeCatalogProductIdentityKey(rawName);
  if (!aliasKey) return;
  const canonicalConflict = await findCanonicalCatalogProductByIdentity(db, rawName, targetProductId, true);
  if (canonicalConflict?.id && toInt(canonicalConflict.id, 0) !== targetProductId) {
    throw new Error(`Написание «${cleanText(rawName)}» уже совпадает с активным товаром «${cleanText(canonicalConflict.name)}». Выберите его вместо создания или другой привязки.`);
  }
  try {
    const alias = await db.prepare(
      `SELECT a.product_id, p.name
       FROM catalog_product_aliases a
       JOIN catalog_products p ON p.id = a.product_id
       WHERE a.alias_key = ? AND p.is_active = 1
       LIMIT 1`
    ).bind(aliasKey).first<{ product_id: number; name: string }>();
    if (alias?.product_id && toInt(alias.product_id, 0) !== targetProductId) {
      throw new Error(`Написание «${cleanText(rawName)}» уже связано с товаром «${cleanText(alias.name)}». Сначала разберите конфликт, чтобы система не обучилась двум значениям одного ввода.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('уже связано с товаром')) throw error;
    // Before migration 0050 there is no alias table. Step 188G itself requires 0050 as a
    // prerequisite, but keeping this read tolerant preserves the older deploy safety pattern.
  }
}


export async function rememberCatalogProductAlias(
  db: D1Database,
  rawName: unknown,
  productId: number,
  timestamp: string,
) {
  const aliasKey = normalizeCatalogProductIdentityKey(rawName);
  if (!aliasKey || !productId) return false;
  const product = await db.prepare(
    `SELECT id, name FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1`
  ).bind(productId).first<{ id: number; name: string }>();
  if (!product?.id) throw new Error('Нельзя запомнить написание: выбранный товар не найден или отключён.');
  if (normalizeCatalogProductIdentityKey(product.name) === aliasKey) return false;

  // Only another ACTIVE canonical product blocks learning. Inactive legacy noise must not
  // make the order resolver disagree with the active-only frontend.
  const canonicalConflict = await findCanonicalCatalogProductByIdentity(db, rawName, productId, true);
  if (canonicalConflict?.id && toInt(canonicalConflict.id, 0) !== productId) {
    throw new Error(`Написание «${cleanText(rawName)}» уже совпадает с другим активным товаром «${cleanText(canonicalConflict.name)}». Связь не сохранена.`);
  }

  try {
    // INSERT OR IGNORE makes two simultaneous resolutions of the same typo to the same
    // product safe. We re-read the winner before updating any metadata.
    await db.prepare(
      `INSERT OR IGNORE INTO catalog_product_aliases (alias_key, raw_value, product_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(aliasKey, cleanText(rawName), productId, timestamp, timestamp).run();

    const existing = await db.prepare(
      `SELECT id, product_id FROM catalog_product_aliases WHERE alias_key = ? LIMIT 1`
    ).bind(aliasKey).first<{ id: number; product_id: number }>();
    if (!existing?.id) throw new Error('alias_row_missing');
    if (toInt(existing.product_id, 0) !== productId) {
      throw new Error(`Написание «${cleanText(rawName)}» уже связано с другим товаром. Сначала разберите конфликт вручную.`);
    }
    await db.prepare(
      `UPDATE catalog_product_aliases SET raw_value = ?, updated_at = ? WHERE id = ?`
    ).bind(cleanText(rawName), timestamp, existing.id).run();
    return true;
  } catch (error) {
    if (error instanceof Error && (error.message.includes('уже связано с другим товаром') || error.message.includes('совпадает с другим активным товаром'))) throw error;
    throw new Error('Не удалось сохранить безопасное написание товара. Проверьте схему Step 188F1 и повторите разбор.');
  }
}



export async function isCatalogIdentityV3Enabled(db: D1Database) {
  try {
    const row = await db.prepare(
      `SELECT value FROM catalog_identity_meta WHERE key = 'catalog_identity_v3' LIMIT 1`
    ).first<{ value: string }>();
    return cleanText(row?.value).toLowerCase() === 'active';
  } catch {
    // Step 188D deploys compatibility code before the identity migration is activated.
    return false;
  }
}


export function normalizeCatalogCombinationGender(value: unknown) {
  const text = upperText(value);
  if (!text) return '';
  if (text.includes('ЖЕН')) return 'ЖЕН';
  if (text.includes('МУЖ')) return 'МУЖ';
  return text;
}


export function normalizeCatalogCombinationColor(value: unknown) {
  return upperText(value) || 'БЕЗ ЦВЕТА';
}


export function normalizeCatalogCombinationSize(value: unknown) {
  const text = upperText(value);
  if (!text || ['БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р'].includes(text)) return '';
  return text;
}


export async function catalogReferenceValueExists(db: D1Database, kind: 'color' | 'size' | 'child_age', value: string) {
  const normalized = upperText(value);
  if (!normalized) return true;
  const row = await db.prepare(
    `SELECT id FROM reference_values WHERE kind = ? AND is_active = 1 AND UPPER(TRIM(value)) = ? LIMIT 1`
  ).bind(kind, normalized).first<{ id: number }>();
  return Boolean(row?.id);
}


export async function findCatalogExecutionV3(db: D1Database, productId: number, material: unknown, length: unknown) {
  const normalizedMaterial = canonicalStockPositionValue(material);
  const normalizedLength = canonicalStockPositionValue(length);
  return await db.prepare(
    `SELECT id, product_id, material, length, is_active
     FROM catalog_stock_positions
     WHERE product_id = ? AND is_active = 1
       AND UPPER(TRIM(material)) = ?
       AND UPPER(TRIM(length)) = ?
     ORDER BY id ASC LIMIT 1`
  ).bind(productId, normalizedMaterial, normalizedLength).first<{ id: number; product_id: number; material: string; length: string; is_active: number }>();
}


export async function ensureCatalogExecutionV3(db: D1Database, productId: number, material: unknown, length: unknown, timestamp: string) {
  const normalizedMaterial = canonicalStockPositionValue(material);
  const normalizedLength = canonicalStockPositionValue(length);
  let execution = await findCatalogExecutionV3(db, productId, normalizedMaterial, normalizedLength);
  if (execution?.id) return execution;
  try {
    const result = await db.prepare(
      `INSERT INTO catalog_stock_positions (
        product_id, category, gender_scope, material, length, is_default, is_active, sort_order, created_at, updated_at
      ) VALUES (?, 'adult', 'unisex', ?, ?, 0, 1, 0, ?, ?)`
    ).bind(productId, normalizedMaterial, normalizedLength, timestamp, timestamp).run();
    const id = Number(result.meta?.last_row_id || 0);
    if (id) return { id, product_id: productId, material: normalizedMaterial, length: normalizedLength, is_active: 1 };
  } catch {
    // Concurrent creation is safe because Step 188D adds a unique execution identity.
  }
  execution = await findCatalogExecutionV3(db, productId, normalizedMaterial, normalizedLength);
  if (!execution?.id) throw new Error('Не удалось создать исполнение товара. Обновите каталог и повторите действие.');
  return execution;
}


export async function findCatalogCombinationV3(
  db: D1Database,
  executionId: number,
  category: unknown,
  gender: unknown,
  color: unknown,
  sizeLabel: unknown,
  excludeId = 0,
) {
  const normalizedCategory = normalizeAudienceCategory(category, sizeLabel);
  const normalizedGender = normalizeCatalogCombinationGender(gender);
  const normalizedColor = normalizeCatalogCombinationColor(color);
  const normalizedSize = normalizeCatalogCombinationSize(sizeLabel);
  return await db.prepare(
    `SELECT id, product_id, stock_position_id, category, gender, color, size_label, is_active
     FROM catalog_variants
     WHERE stock_position_id = ? AND id <> ? AND is_active = 1
       AND COALESCE(category, 'adult') = ?
       AND COALESCE(gender, '') = ?
       AND COALESCE(color, '') = ?
       AND COALESCE(size_label, '') = ?
     ORDER BY id ASC LIMIT 1`
  ).bind(executionId, excludeId, normalizedCategory, normalizedGender, normalizedColor, normalizedSize)
    .first<{ id: number; product_id: number; stock_position_id: number; category: string; gender: string; color: string; size_label: string; is_active: number }>();
}


export async function createCatalogCombinationV3(
  db: D1Database,
  input: {
    productId: number;
    executionId: number;
    category: unknown;
    gender: unknown;
    color: unknown;
    material: unknown;
    length: unknown;
    sizeLabel: unknown;
    sortOrder?: unknown;
    externalId?: string;
  },
  timestamp: string,
) {
  const category = normalizeAudienceCategory(input.category, input.sizeLabel);
  const gender = normalizeCatalogCombinationGender(input.gender);
  const color = normalizeCatalogCombinationColor(input.color);
  const sizeLabel = normalizeCatalogCombinationSize(input.sizeLabel);
  const material = canonicalStockPositionValue(input.material);
  const length = canonicalStockPositionValue(input.length);
  const duplicate = await findCatalogCombinationV3(db, input.executionId, category, gender, color, sizeLabel);
  if (duplicate?.id) return { id: toInt(duplicate.id, 0), created: false };
  try {
    const result = await db.prepare(
      `INSERT INTO catalog_variants (
        external_id, product_id, stock_position_id, category, gender, color, material, length, size_label,
        is_active, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).bind(
      cleanText(input.externalId) || null,
      input.productId,
      input.executionId,
      category,
      gender || null,
      color || null,
      material,
      length,
      sizeLabel || null,
      toInt(input.sortOrder, 0),
      timestamp,
      timestamp,
    ).run();
    const id = Number(result.meta?.last_row_id || 0);
    if (id) return { id, created: true };
  } catch {
    // A concurrent request may have created exactly the same stock combination.
  }
  const existing = await findCatalogCombinationV3(db, input.executionId, category, gender, color, sizeLabel);
  if (!existing?.id) throw new Error('Не удалось создать складскую комбинацию товара. Повторите действие.');
  return { id: toInt(existing.id, 0), created: false };
}


export async function catalogVariantHasOperationalUsage(db: D1Database, variantId: number) {
  const row = await db.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM order_items WHERE variant_id = ? LIMIT 1) AS used_orders,
       EXISTS(SELECT 1 FROM inventory_stock WHERE variant_id = ? LIMIT 1) AS used_stock,
       EXISTS(SELECT 1 FROM inventory_movements WHERE variant_id = ? LIMIT 1) AS used_movements,
       EXISTS(SELECT 1 FROM workshop_tasks WHERE variant_id = ? LIMIT 1) AS used_workshop,
       EXISTS(SELECT 1 FROM inventory_reservations WHERE variant_id = ? LIMIT 1) AS used_reservations,
       EXISTS(SELECT 1 FROM inventory_lifecycle_events WHERE variant_id = ? LIMIT 1) AS used_lifecycle,
       EXISTS(SELECT 1 FROM inventory_transfer_items WHERE variant_id = ? LIMIT 1) AS used_transfers,
       EXISTS(SELECT 1 FROM inventory_stock_checks WHERE variant_id = ? LIMIT 1) AS used_checks,
       EXISTS(SELECT 1 FROM inventory_stocktake_items WHERE variant_id = ? LIMIT 1) AS used_stocktakes`
  ).bind(variantId, variantId, variantId, variantId, variantId, variantId, variantId, variantId, variantId).first<Record<string, unknown>>();
  return Boolean(
    toInt(row?.used_orders, 0) || toInt(row?.used_stock, 0) || toInt(row?.used_movements, 0)
    || toInt(row?.used_workshop, 0) || toInt(row?.used_reservations, 0) || toInt(row?.used_lifecycle, 0)
    || toInt(row?.used_transfers, 0) || toInt(row?.used_checks, 0) || toInt(row?.used_stocktakes, 0)
  );
}


export function makeVariantExternalId(productName: string, category: string, gender: string, color: string, material: string, length: string, size: string) {
  const raw = [productName, category, gender, color, material, length, size]
    .map(part => cleanText(part).toUpperCase())
    .join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `AUTO-${Math.abs(hash).toString(36).toUpperCase()}-${raw.length}`;
}


export type CatalogValueAliasKind = 'color' | 'material' | 'length' | 'size' | 'child_age';


export function catalogValueAliasKey(value: unknown) {
  return upperText(value).replace(/\s+/g, ' ').trim();
}


export async function resolveCatalogValueAlias(db: D1Database, kind: CatalogValueAliasKind, value: unknown) {
  const raw = catalogValueAliasKey(value);
  if (!raw) return raw;
  if ((kind === 'material' || kind === 'length') && raw === 'СТАНДАРТ') return raw;
  try {
    const alias = await db.prepare(
      `SELECT canonical_value FROM catalog_value_aliases WHERE kind = ? AND alias_key = ? LIMIT 1`
    ).bind(kind, raw).first<{ canonical_value: string }>();
    return catalogValueAliasKey(alias?.canonical_value || raw);
  } catch {
    // 0054 is additive; the compatibility deploy can still resolve raw reference values.
    return raw;
  }
}


export async function rememberCatalogValueAlias(
  db: D1Database,
  kind: CatalogValueAliasKind,
  rawValue: unknown,
  canonicalValue: unknown,
  timestamp: string,
) {
  const raw = catalogValueAliasKey(rawValue);
  const canonical = catalogValueAliasKey(canonicalValue);
  if (!raw || !canonical || raw === canonical) return false;
  if ((kind === 'material' || kind === 'length') && canonical === 'СТАНДАРТ') return false;
  if (!await catalogReferenceDbValueExists(db, kind, canonical)) {
    throw new Error(`Нельзя запомнить исправление «${raw} → ${canonical}»: каноническое значение отсутствует в справочнике.`);
  }
  // Concurrency-safe learning: two reviewers may resolve the same raw value at once.
  // The first INSERT wins; a competing canonical target must never silently overwrite it.
  await db.prepare(
    `INSERT OR IGNORE INTO catalog_value_aliases (kind, alias_key, raw_value, canonical_value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(kind, raw, cleanText(rawValue) || raw, canonical, timestamp, timestamp).run();
  const winner = await db.prepare(
    `SELECT id, canonical_value FROM catalog_value_aliases WHERE kind = ? AND alias_key = ? LIMIT 1`
  ).bind(kind, raw).first<{ id: number; canonical_value: string }>();
  if (!winner?.id) throw new Error(`Не удалось сохранить исправление значения «${raw}».`);
  if (catalogValueAliasKey(winner.canonical_value) !== canonical) {
    throw new Error(`Значение «${raw}» уже связано с «${cleanText(winner.canonical_value)}». Сначала разберите конфликт вручную.`);
  }
  await db.prepare(
    `UPDATE catalog_value_aliases SET raw_value = ?, updated_at = ? WHERE id = ?`
  ).bind(cleanText(rawValue) || raw, timestamp, winner.id).run();
  return true;
}


export async function listCatalog(db: D1Database) {
  const productsResult = await db.prepare(
    `SELECT
      id, name, category, is_active, created_at, updated_at
     FROM catalog_products
     WHERE NOT (is_active = 0 AND name IN ('КОРСЕТ','БАСҚА'))
     ORDER BY name`
  ).all<Record<string, unknown>>();

  const variantsResult = await db.prepare(
    `SELECT
      id, product_id, category, gender, color, material, length, size_label, is_active, sort_order,
      created_at, updated_at
     FROM catalog_variants`
  ).all<Record<string, unknown>>();

  let productAliasRows: Record<string, unknown>[] = [];
  try {
    const aliasesResult = await db.prepare(
      `SELECT a.raw_value, a.product_id, p.name AS product_name
       FROM catalog_product_aliases a
       JOIN catalog_products p ON p.id = a.product_id
       WHERE p.is_active = 1
       ORDER BY a.id ASC`
    ).all<Record<string, unknown>>();
    productAliasRows = aliasesResult.results || [];
  } catch {
    // Migration 0050 is additive; catalog reads remain compatible during deployment.
  }

  let valueAliasRows: Record<string, unknown>[] = [];
  try {
    const aliasesResult = await db.prepare(
      `SELECT kind, raw_value, canonical_value FROM catalog_value_aliases ORDER BY kind, id ASC`
    ).all<Record<string, unknown>>();
    valueAliasRows = aliasesResult.results || [];
  } catch {
    // Migration 0054 is additive; catalog reads remain compatible during deployment.
  }

  const rawProducts = productsResult.results || [];
  const rawVariants = variantsResult.results || [];
  const productById = new Map<number, { name: string; category: string | null }>();
  const productOrderById = new Map<number, number>();
  const variantCountByProductId = new Map<number, number>();

  rawProducts.forEach((row, index) => {
    const productId = toInt(row.id, 0);
    productById.set(productId, {
      name: cleanText(row.name),
      category: row.category == null ? null : cleanText(row.category),
    });
    productOrderById.set(productId, index);
  });
  for (const row of rawVariants) {
    if (!Boolean(toInt(row.is_active, 1))) continue;
    const productId = toInt(row.product_id, 0);
    variantCountByProductId.set(productId, (variantCountByProductId.get(productId) || 0) + 1);
  }

  const sortedRawVariants = rawVariants
    .filter(row => productById.has(toInt(row.product_id, 0)))
    .sort((left, right) => {
      const leftProductOrder = productOrderById.get(toInt(left.product_id, 0)) ?? Number.MAX_SAFE_INTEGER;
      const rightProductOrder = productOrderById.get(toInt(right.product_id, 0)) ?? Number.MAX_SAFE_INTEGER;
      if (leftProductOrder !== rightProductOrder) return leftProductOrder - rightProductOrder;
      const leftSort = toInt(left.sort_order, 0);
      const rightSort = toInt(right.sort_order, 0);
      if (leftSort !== rightSort) return leftSort - rightSort;
      return toInt(left.id, 0) - toInt(right.id, 0);
    });

  return {
    ok: true,
    products: rawProducts.map(row => {
      const id = toInt(row.id, 0);
      return {
        id,
        name: cleanText(row.name),
        category: cleanText(row.category),
        isActive: Boolean(toInt(row.is_active, 1)),
        variantsCount: variantCountByProductId.get(id) || 0,
        createdAt: cleanText(row.created_at),
        updatedAt: cleanText(row.updated_at),
      };
    }),
    productAliases: productAliasRows.map(row => ({
      rawValue: cleanText(row.raw_value),
      productId: toInt(row.product_id, 0),
      productName: cleanText(row.product_name),
    })),
    valueAliases: valueAliasRows.map(row => ({
      kind: cleanText(row.kind),
      rawValue: cleanText(row.raw_value),
      canonicalValue: cleanText(row.canonical_value),
    })),
    variants: sortedRawVariants.map(row => {
      const productId = toInt(row.product_id, 0);
      const product = productById.get(productId);
      return {
        id: toInt(row.id, 0),
        productId,
        productName: product?.name || '',
        productCategory: row.category == null
          ? (product?.category == null ? 'adult' : cleanText(product.category))
          : cleanText(row.category),
        gender: cleanText(row.gender),
        color: cleanText(row.color),
        material: canonicalStockPositionValue(row.material),
        length: canonicalStockPositionValue(row.length),
        sizeLabel: cleanText(row.size_label),
        isActive: Boolean(toInt(row.is_active, 1)),
        sortOrder: toInt(row.sort_order, 0),
        createdAt: cleanText(row.created_at),
        updatedAt: cleanText(row.updated_at),
      };
    }),
  };
}


export async function createCatalogProduct(db: D1Database, input: { name?: unknown; category?: unknown }) {
  const name = upperText(input.name);
  if (!name) throw new Error('Product name is required.');
  const duplicate = await findCatalogProductByIdentity(db, name);
  if (duplicate?.id) throw new Error(`Такой базовый товар уже существует: ${cleanText(duplicate.name)}.`);
  const category = normalizeCatalogCategory(input.category);
  const createdAt = new Date().toISOString();
  const result = await db.prepare(
    `INSERT INTO catalog_products (name, category, is_active, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`
  ).bind(name, category, createdAt, createdAt).run();
  return { ok: true, id: Number(result.meta?.last_row_id || 0), name, category };
}


export async function updateCatalogProduct(db: D1Database, id: number, input: { name?: unknown; category?: unknown; isActive?: unknown }) {
  const existing = await db.prepare('SELECT id FROM catalog_products WHERE id = ?').bind(id).first<{ id: number }>();
  if (!existing) throw new Error('Product not found.');
  const name = input.name !== undefined ? upperText(input.name) : undefined;
  const category = input.category !== undefined ? normalizeCatalogCategory(input.category) : undefined;
  if (name) {
    const duplicate = await findCatalogProductByIdentity(db, name, id);
    if (duplicate?.id) throw new Error(`Такой базовый товар уже существует: ${cleanText(duplicate.name)}.`);
  }
  const isActive = input.isActive === undefined ? undefined : (cleanText(input.isActive).toLowerCase() === 'false' ? 0 : 1);
  const createdAt = new Date().toISOString();
  await db.prepare(
    `UPDATE catalog_products
     SET name = COALESCE(?, name),
         category = COALESCE(?, category),
         is_active = COALESCE(?, is_active),
         updated_at = ?
     WHERE id = ?`
  ).bind(name || null, category || null, isActive ?? null, createdAt, id).run();
  return { ok: true };
}


export async function requireCatalogAdminReferenceValue(db: D1Database, dbKind: string, value: unknown, label: string) {
  const normalized = upperText(value);
  if (!normalized || ((dbKind === 'material' || dbKind === 'length') && normalized === 'СТАНДАРТ')) return;
  if (await catalogReferenceDbValueExists(db, dbKind, normalized)) return;
  throw new Error(`${label} «${normalized}» отсутствует в справочнике. Сначала добавьте значение в «Склад → Товары → Характеристики одежды».`);
}


export async function createCatalogVariant(db: D1Database, input: { productId?: unknown; category?: unknown; gender?: unknown; color?: unknown; material?: unknown; length?: unknown; sizeLabel?: unknown; sortOrder?: unknown }) {
  const productId = toInt(input.productId, 0);
  if (!productId) throw new Error('productId is required.');
  const product = await db.prepare('SELECT id FROM catalog_products WHERE id = ?').bind(productId).first<{ id: number }>();
  if (!product) throw new Error('Product not found.');
  const category = normalizeAudienceCategory(input.category, input.sizeLabel) as 'adult' | 'child';
  const gender = normalizeCatalogCombinationGender(input.gender);
  const color = await resolveCatalogValueAlias(db, 'color', normalizeCatalogCombinationColor(input.color));
  const material = await resolveCatalogValueAlias(db, 'material', canonicalStockPositionValue(input.material));
  const length = await resolveCatalogValueAlias(db, 'length', canonicalStockPositionValue(input.length));
  const sizeLabel = await resolveCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', normalizeCatalogCombinationSize(input.sizeLabel));
  const sortOrder = toInt(input.sortOrder, 0);
  const createdAt = new Date().toISOString();

  if (await isCatalogIdentityV3Enabled(db)) {
    await requireCatalogAdminReferenceValue(db, 'material', material, 'Материал');
    await requireCatalogAdminReferenceValue(db, 'length', length, 'Длина');
    await requireCatalogAdminReferenceValue(db, 'color', color, 'Цвет');
    await requireCatalogAdminReferenceValue(db, category === 'child' ? 'child_age' : 'size', sizeLabel, category === 'child' ? 'Возраст' : 'Размер');
    const execution = await ensureCatalogExecutionV3(db, productId, material, length, createdAt);
    const duplicate = await findCatalogCombinationV3(db, execution.id, category, gender, color, sizeLabel);
    if (duplicate?.id) throw new Error('Такая комбинация товара уже существует. Откройте существующую строку вместо создания дубля.');
    const created = await createCatalogCombinationV3(db, {
      productId, executionId: execution.id, category, gender, color, material, length, sizeLabel, sortOrder,
    }, createdAt);
    return { ok: true, id: created.id };
  }

  const result = await db.prepare(
    `INSERT INTO catalog_variants (
      product_id, category, gender, color, material, length, size_label, is_active, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).bind(productId, category, gender || null, color || null, material || null, length || null, sizeLabel || null, sortOrder, createdAt, createdAt).run();
  return { ok: true, id: Number(result.meta?.last_row_id || 0) };
}


export async function updateCatalogVariant(db: D1Database, id: number, input: { productId?: unknown; category?: unknown; gender?: unknown; color?: unknown; material?: unknown; length?: unknown; sizeLabel?: unknown; isActive?: unknown; sortOrder?: unknown }) {
  const existing = await db.prepare(
    `SELECT id, product_id, stock_position_id, category, gender, color, material, length, size_label, is_active, sort_order
     FROM catalog_variants WHERE id = ? LIMIT 1`
  ).bind(id).first<Record<string, unknown>>();
  if (!existing?.id) throw new Error('Variant not found.');

  const productId = input.productId === undefined ? toInt(existing.product_id, 0) : toInt(input.productId, 0);
  const targetSize = input.sizeLabel === undefined ? cleanText(existing.size_label) : normalizeCatalogCombinationSize(input.sizeLabel);
  const category = input.category === undefined ? normalizeAudienceCategory(existing.category, targetSize) : normalizeAudienceCategory(input.category, targetSize);
  const gender = input.gender === undefined ? normalizeCatalogCombinationGender(existing.gender) : normalizeCatalogCombinationGender(input.gender);
  const color = await resolveCatalogValueAlias(db, 'color', input.color === undefined ? normalizeCatalogCombinationColor(existing.color) : normalizeCatalogCombinationColor(input.color));
  const material = await resolveCatalogValueAlias(db, 'material', input.material === undefined ? canonicalStockPositionValue(existing.material) : canonicalStockPositionValue(input.material));
  const length = await resolveCatalogValueAlias(db, 'length', input.length === undefined ? canonicalStockPositionValue(existing.length) : canonicalStockPositionValue(input.length));
  const sizeLabel = await resolveCatalogValueAlias(db, category === 'child' ? 'child_age' : 'size', targetSize);
  const isActive = input.isActive === undefined ? toInt(existing.is_active, 1) : (cleanText(input.isActive).toLowerCase() === 'false' ? 0 : 1);
  const sortOrder = input.sortOrder === undefined ? toInt(existing.sort_order, 0) : toInt(input.sortOrder, 0);
  const timestamp = new Date().toISOString();

  if (await isCatalogIdentityV3Enabled(db)) {
    if (canonicalStockPositionValue(existing.material) !== material) await requireCatalogAdminReferenceValue(db, 'material', material, 'Материал');
    if (canonicalStockPositionValue(existing.length) !== length) await requireCatalogAdminReferenceValue(db, 'length', length, 'Длина');
    if (normalizeCatalogCombinationColor(existing.color) !== color) await requireCatalogAdminReferenceValue(db, 'color', color, 'Цвет');
    if (normalizeCatalogCombinationSize(existing.size_label) !== sizeLabel || normalizeAudienceCategory(existing.category, existing.size_label) !== category) {
      await requireCatalogAdminReferenceValue(db, category === 'child' ? 'child_age' : 'size', sizeLabel, category === 'child' ? 'Возраст' : 'Размер');
    }
    const execution = await ensureCatalogExecutionV3(db, productId, material, length, timestamp);
    const identityChanged = productId !== toInt(existing.product_id, 0)
      || execution.id !== toInt(existing.stock_position_id, 0)
      || category !== normalizeAudienceCategory(existing.category, existing.size_label)
      || gender !== normalizeCatalogCombinationGender(existing.gender)
      || color !== normalizeCatalogCombinationColor(existing.color)
      || sizeLabel !== normalizeCatalogCombinationSize(existing.size_label);
    if (identityChanged && await catalogVariantHasOperationalUsage(db, id)) {
      throw new Error('Эта комбинация уже использовалась в заказах или движениях склада. Нельзя переписать её историю. Создайте правильную комбинацию отдельно; старую затем можно отключить.');
    }
    const duplicate = await findCatalogCombinationV3(db, execution.id, category, gender, color, sizeLabel, id);
    if (duplicate?.id && isActive) throw new Error('Такая комбинация уже существует. Не создавайте второй дубль.');
    await db.prepare(
      `UPDATE catalog_variants
       SET product_id = ?, stock_position_id = ?, category = ?, gender = ?, color = ?, material = ?, length = ?,
           size_label = ?, is_active = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).bind(productId, execution.id, category, gender || null, color || null, material, length, sizeLabel || null, isActive, sortOrder, timestamp, id).run();
    return { ok: true };
  }

  await db.prepare(
    `UPDATE catalog_variants
     SET product_id = ?, category = ?, gender = ?, color = ?, material = ?, length = ?, size_label = ?, is_active = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`
  ).bind(productId, category, gender || null, color || null, material || null, length || null, sizeLabel || null, isActive, sortOrder, timestamp, id).run();
  return { ok: true };
}


export async function isHumanInventoryModelEnabled(db: D1Database) {
  try {
    const row = await db.prepare(
      `SELECT value FROM inventory_model_meta WHERE key = 'human_inventory_v2' LIMIT 1`
    ).first<{ value: string }>();
    return cleanText(row?.value).toLowerCase() === 'active';
  } catch {
    // Step 188A deploys compatibility code before the additive schema/backfill is activated.
    return false;
  }
}


export type CanonicalVariantSnapshot = {
  productId: number;
  variantId: number;
  productName: string;
  category: 'adult' | 'child';
  gender: string | null;
  color: string | null;
  material: string | null;
  length: string | null;
  size: string | null;
};


export async function loadCanonicalVariantSnapshot(db: D1Database, variantId: number): Promise<CanonicalVariantSnapshot> {
  const row = await db.prepare(
    `SELECT v.id AS variant_id, v.product_id, p.name AS product_name,
            COALESCE(v.category, p.category, 'adult') AS category,
            v.gender, v.color, v.material, v.length, v.size_label
     FROM catalog_variants v
     JOIN catalog_products p ON p.id = v.product_id
     WHERE v.id = ? LIMIT 1`
  ).bind(variantId).first<Record<string, unknown>>();
  if (!row?.variant_id || !row?.product_id) throw new Error('Каноническая комбинация товара не найдена. Обновите каталог и повторите операцию.');
  return {
    productId: toInt(row.product_id, 0),
    variantId: toInt(row.variant_id, 0),
    productName: cleanText(row.product_name),
    category: normalizeAudienceCategory(row.category, row.size_label),
    gender: cleanText(row.gender) || null,
    color: cleanText(row.color) || null,
    material: canonicalStockPositionValue(row.material) || null,
    length: canonicalStockPositionValue(row.length) || null,
    size: cleanText(row.size_label) || null,
  };
}


export async function catalogReferenceDbValueExists(db: D1Database, kind: string, value: unknown) {
  const normalized = upperText(value);
  if (!normalized) return true;
  if ((kind === 'material' || kind === 'length') && normalized === 'СТАНДАРТ') return true;
  const row = await db.prepare(
    `SELECT id FROM reference_values WHERE kind = ? AND is_active = 1 AND UPPER(TRIM(value)) = ? LIMIT 1`
  ).bind(kind, normalized).first<{ id: number }>();
  return Boolean(row?.id);
}
