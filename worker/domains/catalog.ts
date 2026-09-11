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


export type CatalogProductGenderScope = 'female' | 'male' | 'unisex';

export function normalizeCatalogProductGenderScope(value: unknown): CatalogProductGenderScope {
  const text = cleanText(value).toLowerCase();
  if (['female', 'жен', 'женский', 'ж'].includes(text)) return 'female';
  if (['male', 'муж', 'мужской', 'м'].includes(text)) return 'male';
  return 'unisex';
}

export function catalogGenderForProductScope(scope: CatalogProductGenderScope) {
  return scope === 'female' ? 'ЖЕН' : scope === 'male' ? 'МУЖ' : '';
}

export async function isCatalogProductGenderScopeEnabled(db: D1Database) {
  try {
    await db.prepare('SELECT gender_scope FROM catalog_products LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

export async function getCatalogProductGenderScope(db: D1Database, productId: number): Promise<CatalogProductGenderScope> {
  if (!productId) return 'unisex';
  if (await isCatalogProductGenderScopeEnabled(db)) {
    const row = await db.prepare('SELECT gender_scope FROM catalog_products WHERE id = ? LIMIT 1').bind(productId).first<{ gender_scope: string }>();
    return normalizeCatalogProductGenderScope(row?.gender_scope);
  }
  const profile = await db.prepare(
    `SELECT
       MAX(CASE WHEN UPPER(TRIM(COALESCE(gender,'')))='ЖЕН' THEN 1 ELSE 0 END) AS has_female,
       MAX(CASE WHEN UPPER(TRIM(COALESCE(gender,'')))='МУЖ' THEN 1 ELSE 0 END) AS has_male,
       MAX(CASE WHEN TRIM(COALESCE(gender,''))='' THEN 1 ELSE 0 END) AS has_blank
     FROM catalog_variants WHERE product_id = ? AND is_active = 1`
  ).bind(productId).first<Record<string, unknown>>();
  const female = toInt(profile?.has_female, 0) > 0;
  const male = toInt(profile?.has_male, 0) > 0;
  const blank = toInt(profile?.has_blank, 0) > 0;
  if (female && !male && !blank) return 'female';
  if (male && !female && !blank) return 'male';
  return 'unisex';
}

export async function resolveCatalogGenderForProduct(db: D1Database, productId: number, value: unknown) {
  const explicitGender = normalizeCatalogCombinationGender(value);
  // A concrete human choice is authoritative and does not need another D1 read.
  if (explicitGender === 'ЖЕН' || explicitGender === 'МУЖ') return { scope: null, gender: explicitGender };
  const scope = await getCatalogProductGenderScope(db, productId);
  const fixed = catalogGenderForProductScope(scope);
  if (fixed) return { scope, gender: fixed };
  throw new Error('Для товара «Унисекс» выберите пол конкретной вещи: ЖЕН или МУЖ.');
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
       AND CASE
         WHEN UPPER(TRIM(COALESCE(gender, ''))) LIKE '%ЖЕН%' THEN 'ЖЕН'
         WHEN UPPER(TRIM(COALESCE(gender, ''))) LIKE '%МУЖ%' THEN 'МУЖ'
         ELSE UPPER(TRIM(COALESCE(gender, '')))
       END = ?
       AND CASE
         WHEN TRIM(COALESCE(color, '')) = '' THEN 'БЕЗ ЦВЕТА'
         ELSE UPPER(TRIM(color))
       END = ?
       AND CASE
         WHEN UPPER(TRIM(COALESCE(size_label, ''))) IN ('', 'БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р') THEN ''
         ELSE UPPER(TRIM(size_label))
       END = ?
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


export async function assertCatalogVariantMayDeactivate(db: D1Database, variantId: number) {
  const row = await db.prepare(
    `SELECT
       COALESCE((SELECT SUM(COALESCE(quantity, 0)) FROM inventory_stock WHERE variant_id = ?), 0) AS physical_quantity,
       COALESCE((SELECT SUM(COALESCE(reserved_quantity, 0)) FROM inventory_stock WHERE variant_id = ?), 0) AS stock_reserved_quantity,
       COALESCE((SELECT SUM(COALESCE(quantity, 0)) FROM inventory_reservations WHERE variant_id = ? AND status = 'active'), 0) AS active_reservation_quantity,
       EXISTS(
         SELECT 1 FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.variant_id = ?
           AND COALESCE(o.order_status, 'active') = 'active'
           AND COALESCE(o.shipping_status, 'not_sent') <> 'sent'
         LIMIT 1
       ) AS open_order,
       EXISTS(
         SELECT 1 FROM workshop_tasks
         WHERE variant_id = ? AND status IN ('active', 'ready')
         LIMIT 1
       ) AS open_workshop,
       EXISTS(
         SELECT 1 FROM inventory_lifecycle_events
         WHERE variant_id = ? AND status = 'pending'
         LIMIT 1
       ) AS pending_lifecycle,
       EXISTS(
         SELECT 1
         FROM inventory_stocktake_items i
         JOIN inventory_stocktake_sessions s ON s.id = i.session_id
         WHERE i.variant_id = ? AND s.status = 'active'
         LIMIT 1
       ) AS active_stocktake`
  ).bind(variantId, variantId, variantId, variantId, variantId, variantId, variantId).first<Record<string, unknown>>();

  const physicalQuantity = toInt(row?.physical_quantity, 0);
  const stockReservedQuantity = toInt(row?.stock_reserved_quantity, 0);
  const activeReservationQuantity = toInt(row?.active_reservation_quantity, 0);
  const blockers: string[] = [];
  if (physicalQuantity !== 0) blockers.push(`физический остаток ${physicalQuantity} шт.`);
  if (stockReservedQuantity !== 0 || activeReservationQuantity !== 0) {
    const reserved = Math.max(Math.abs(stockReservedQuantity), Math.abs(activeReservationQuantity));
    blockers.push(`действующий резерв ${reserved} шт.`);
  }
  if (toInt(row?.open_order, 0)) blockers.push('есть активный неотправленный заказ');
  if (toInt(row?.open_workshop, 0)) blockers.push('есть незавершённая задача Цеха');
  if (toInt(row?.pending_lifecycle, 0)) blockers.push('есть незавершённая приёмка или возврат');
  if (toInt(row?.active_stocktake, 0)) blockers.push('позиция участвует в текущей ревизии');

  if (blockers.length) {
    throw new Error(`Нельзя вывести позицию из активного каталога: ${blockers.join('; ')}. Сначала завершите связанные операции или разберите остаток.`);
  }
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
  const genderScopeEnabled = await isCatalogProductGenderScopeEnabled(db);
  const productsResult = await db.prepare(
    `SELECT
      id, name, category, ${genderScopeEnabled ? 'gender_scope' : "'unisex' AS gender_scope"}, is_active, created_at, updated_at
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
        genderScope: normalizeCatalogProductGenderScope(row.gender_scope),
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


export async function createCatalogProduct(db: D1Database, input: { name?: unknown; category?: unknown; genderScope?: unknown }) {
  const name = upperText(input.name);
  if (!name) throw new Error('Product name is required.');
  const duplicate = await findCatalogProductByIdentity(db, name);
  if (duplicate?.id) throw new Error(`Такой базовый товар уже существует: ${cleanText(duplicate.name)}.`);
  if (input.genderScope === undefined || !cleanText(input.genderScope)) {
    throw new Error('Выберите назначение товара по полу: Женский, Мужской или Унисекс.');
  }
  if (!await isCatalogProductGenderScopeEnabled(db)) {
    throw new Error('Схема каталога ещё не поддерживает назначение товара по полу. Примените миграцию 0068 и повторите действие.');
  }
  const category = normalizeCatalogCategory(input.category);
  const genderScope = normalizeCatalogProductGenderScope(input.genderScope);
  const createdAt = new Date().toISOString();
  const result = await db.prepare(
    `INSERT INTO catalog_products (name, category, gender_scope, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  ).bind(name, category, genderScope, createdAt, createdAt).run();
  return { ok: true, id: Number(result.meta?.last_row_id || 0), name, category, genderScope };
}


export async function updateCatalogProduct(db: D1Database, id: number, input: { name?: unknown; category?: unknown; genderScope?: unknown; isActive?: unknown }) {
  const existing = await db.prepare('SELECT id FROM catalog_products WHERE id = ?').bind(id).first<{ id: number }>();
  if (!existing) throw new Error('Product not found.');
  const name = input.name !== undefined ? upperText(input.name) : undefined;
  const category = input.category !== undefined ? normalizeCatalogCategory(input.category) : undefined;
  if (name) {
    const duplicate = await findCatalogProductByIdentity(db, name, id);
    if (duplicate?.id) throw new Error(`Такой базовый товар уже существует: ${cleanText(duplicate.name)}.`);
  }
  const genderScope = input.genderScope === undefined ? undefined : normalizeCatalogProductGenderScope(input.genderScope);
  if (genderScope !== undefined && !await isCatalogProductGenderScopeEnabled(db)) {
    throw new Error('Схема каталога ещё не поддерживает назначение товара по полу. Примените миграцию 0068 и повторите действие.');
  }
  const isActive = input.isActive === undefined ? undefined : (cleanText(input.isActive).toLowerCase() === 'false' ? 0 : 1);
  const createdAt = new Date().toISOString();
  await db.prepare(
    `UPDATE catalog_products
     SET name = COALESCE(?, name),
         category = COALESCE(?, category),
         gender_scope = COALESCE(?, gender_scope),
         is_active = COALESCE(?, is_active),
         updated_at = ?
     WHERE id = ?`
  ).bind(name || null, category || null, genderScope ?? null, isActive ?? null, createdAt, id).run();
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
  const genderResolution = await resolveCatalogGenderForProduct(db, productId, input.gender);
  const gender = genderResolution.gender;
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
  const genderResolution = await resolveCatalogGenderForProduct(db, productId, input.gender === undefined ? existing.gender : input.gender);
  const gender = genderResolution.gender;
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
    const deactivating = toInt(existing.is_active, 1) === 1 && isActive === 0;
    if (deactivating && identityChanged) {
      throw new Error('Нельзя одновременно исправлять идентичность и выводить позицию из каталога. Сохраните только одно действие.');
    }
    const duplicate = await findCatalogCombinationV3(db, execution.id, category, gender, color, sizeLabel, id);
    const existingGender = normalizeCatalogCombinationGender(existing.gender);
    const genderOnlyIdentityChange = identityChanged
      && productId === toInt(existing.product_id, 0)
      && execution.id === toInt(existing.stock_position_id, 0)
      && category === normalizeAudienceCategory(existing.category, existing.size_label)
      && color === normalizeCatalogCombinationColor(existing.color)
      && sizeLabel === normalizeCatalogCombinationSize(existing.size_label)
      && existingGender !== gender;
    const hasOperationalUsage = identityChanged ? await catalogVariantHasOperationalUsage(db, id) : false;
    const productScope = genderOnlyIdentityChange && existingGender === '' && (gender === 'ЖЕН' || gender === 'МУЖ')
      ? await getCatalogProductGenderScope(db, productId)
      : null;

    if (productScope === 'unisex' && duplicate?.id) {
      const previousMerge = await db.prepare(
        `SELECT keeper_variant_id, target_gender, repair_mode
         FROM catalog_gender_variant_repairs
         WHERE old_variant_id = ? LIMIT 1`
      ).bind(id).first<Record<string, unknown>>();
      if (cleanText(previousMerge?.repair_mode) === 'merge') {
        if (toInt(previousMerge?.keeper_variant_id, 0) === toInt(duplicate.id, 0)
          && normalizeCatalogCombinationGender(previousMerge?.target_gender) === gender) {
          return { ok: true, correctedGender: true, merged: true, keeperVariantId: toInt(duplicate.id, 0), replayed: true };
        }
        throw new Error('Эта старая позиция уже была объединена с другой канонической комбинацией. Обновите каталог перед новым исправлением.');
      }

      const sourceIsActive = toInt(existing.is_active, 1) === 1;
      if (!sourceIsActive || isActive !== 1 || deactivating) {
        throw new Error('Эта старая позиция уже не активна. Обновите каталог и повторите исправление на актуальной карточке.');
      }

      const blockers = await db.prepare(
        `SELECT
           EXISTS(
             SELECT 1
             FROM inventory_stocktake_items i
             JOIN inventory_stocktake_sessions s ON s.id = i.session_id
             WHERE i.variant_id IN (?, ?) AND s.status = 'active'
             LIMIT 1
           ) AS active_stocktake,
           EXISTS(
             SELECT 1
             FROM inventory_transfer_items source_item
             JOIN inventory_transfer_items target_item
               ON target_item.transfer_id = source_item.transfer_id
              AND target_item.variant_id = ?
             JOIN inventory_transfer_documents d ON d.id = source_item.transfer_id
             WHERE source_item.variant_id = ? AND d.status = 'applied'
             LIMIT 1
           ) AS applied_transfer_collision`
      ).bind(id, duplicate.id, duplicate.id, id).first<Record<string, unknown>>();
      if (toInt(blockers?.active_stocktake, 0)) {
        throw new Error('Нельзя объединить позиции во время активной ревизии. Завершите или отмените ревизию и повторите исправление.');
      }
      if (toInt(blockers?.applied_transfer_collision, 0)) {
        throw new Error('Эти две позиции встречаются в одном действующем документе перемещения. Сначала завершите разбор перемещения, затем повторите объединение.');
      }

      const stockResult = await db.prepare(
        `SELECT id, inventory_source, variant_id
         FROM inventory_stock
         WHERE variant_id IN (?, ?)
         ORDER BY inventory_source ASC, id ASC`
      ).bind(id, duplicate.id).all<Record<string, unknown>>();
      const stockRows = stockResult.results || [];
      const targetStockBySource = new Map<string, number>();
      for (const row of stockRows) {
        if (toInt(row.variant_id, 0) === toInt(duplicate.id, 0)) {
          targetStockBySource.set(cleanText(row.inventory_source), toInt(row.id, 0));
        }
      }

      const mergeStatements = [
        db.prepare('UPDATE order_items SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare('UPDATE inventory_movements SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare('UPDATE workshop_tasks SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare('UPDATE inventory_reservations SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare('UPDATE catalog_input_aliases SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare('UPDATE inventory_lifecycle_events SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare('UPDATE inventory_stock_checks SET variant_id = ? WHERE variant_id = ?').bind(duplicate.id, id),
        db.prepare(
          `UPDATE inventory_transfer_items
           SET variant_id = ?
           WHERE variant_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM inventory_transfer_items sibling
               WHERE sibling.transfer_id = inventory_transfer_items.transfer_id
                 AND sibling.variant_id = ?
                 AND sibling.id <> inventory_transfer_items.id
             )`
        ).bind(duplicate.id, id, duplicate.id),
        db.prepare(
          `UPDATE inventory_stocktake_items
           SET variant_id = ?
           WHERE variant_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM inventory_stocktake_items sibling
               WHERE sibling.session_id = inventory_stocktake_items.session_id
                 AND sibling.variant_id = ?
                 AND sibling.id <> inventory_stocktake_items.id
             )`
        ).bind(duplicate.id, id, duplicate.id),
      ];

      for (const sourceStock of stockRows) {
        if (toInt(sourceStock.variant_id, 0) !== id) continue;
        const sourceStockId = toInt(sourceStock.id, 0);
        const source = cleanText(sourceStock.inventory_source);
        const targetStockId = targetStockBySource.get(source) || 0;
        if (targetStockId) {
          mergeStatements.push(
            db.prepare(
              `UPDATE inventory_stock
               SET quantity = COALESCE(quantity, 0) + COALESCE((SELECT quantity FROM inventory_stock WHERE id = ? AND variant_id = ?), 0),
                   reserved_quantity = COALESCE(reserved_quantity, 0) + COALESCE((SELECT reserved_quantity FROM inventory_stock WHERE id = ? AND variant_id = ?), 0),
                   updated_at = ?
               WHERE id = ? AND variant_id = ?`
            ).bind(sourceStockId, id, sourceStockId, id, timestamp, targetStockId, duplicate.id),
            db.prepare(
              `UPDATE inventory_stock
               SET quantity = 0,
                   reserved_quantity = 0,
                   last_action = 'Объединение позиции каталога',
                   last_source_ref = ?,
                   updated_at = ?
               WHERE id = ? AND variant_id = ?`
            ).bind(`catalog-merge:${id}->${duplicate.id}`, timestamp, sourceStockId, id),
          );
        } else {
          mergeStatements.push(
            db.prepare(
              `UPDATE inventory_stock
               SET variant_id = ?, product_id = ?, updated_at = ?
               WHERE id = ? AND variant_id = ?`
            ).bind(duplicate.id, productId, timestamp, sourceStockId, id),
          );
        }
      }

      mergeStatements.push(
        db.prepare(
          `UPDATE inventory_stock
           SET product_id = ?,
               product_name_snapshot = (SELECT p.name FROM catalog_products p WHERE p.id = ?),
               gender_snapshot = (SELECT NULLIF(v.gender, '') FROM catalog_variants v WHERE v.id = ?),
               color_snapshot = (SELECT NULLIF(v.color, '') FROM catalog_variants v WHERE v.id = ?),
               material_snapshot = (SELECT NULLIF(v.material, '') FROM catalog_variants v WHERE v.id = ?),
               length_snapshot = (SELECT NULLIF(v.length, '') FROM catalog_variants v WHERE v.id = ?),
               size_snapshot = (SELECT NULLIF(v.size_label, '') FROM catalog_variants v WHERE v.id = ?),
               external_product_id = (SELECT p.external_id FROM catalog_products p WHERE p.id = ?),
               external_variant_id = (SELECT v.external_id FROM catalog_variants v WHERE v.id = ?),
               reserved_quantity = COALESCE((
                 SELECT SUM(r.quantity)
                 FROM inventory_reservations r
                 WHERE r.variant_id = ?
                   AND r.inventory_source = inventory_stock.inventory_source
                   AND r.status = 'active'
               ), 0),
               updated_at = ?
           WHERE variant_id = ?`
        ).bind(productId, productId, duplicate.id, duplicate.id, duplicate.id, duplicate.id, duplicate.id, productId, duplicate.id, duplicate.id, timestamp, duplicate.id),
        db.prepare('UPDATE catalog_variants SET is_active = 0, updated_at = ? WHERE id = ? AND is_active = 1').bind(timestamp, id),
        db.prepare(
          `INSERT OR REPLACE INTO catalog_gender_variant_repairs
           (old_variant_id, keeper_variant_id, product_id, target_gender, repair_mode, repaired_at)
           VALUES (?, ?, ?, ?, 'merge', ?)`
        ).bind(id, duplicate.id, productId, gender, timestamp),
      );
      await db.batch(mergeStatements);
      return { ok: true, correctedGender: true, merged: true, keeperVariantId: toInt(duplicate.id, 0) };
    }

    if (identityChanged && hasOperationalUsage) {
      const safeLegacyUnisexGenderCorrection = productScope === 'unisex'
        && isActive === 1
        && !deactivating
        && !duplicate?.id;
      if (safeLegacyUnisexGenderCorrection) {
        await db.batch([
          db.prepare('UPDATE catalog_variants SET gender = ?, updated_at = ? WHERE id = ?').bind(gender, timestamp, id),
          db.prepare('UPDATE inventory_stock SET gender_snapshot = ?, updated_at = ? WHERE variant_id = ?').bind(gender, timestamp, id),
          db.prepare(`INSERT OR REPLACE INTO catalog_gender_variant_repairs
             (old_variant_id, keeper_variant_id, product_id, target_gender, repair_mode, repaired_at)
             VALUES (?, ?, ?, ?, 'in_place', ?)`).bind(id, id, productId, gender, timestamp),
        ]);
        return { ok: true, correctedGender: true, merged: false };
      }
      throw new Error('Эта комбинация уже использовалась в заказах или движениях склада. Нельзя переписать её историю. Создайте правильную комбинацию отдельно; старую затем можно отключить.');
    }
    if (deactivating) await assertCatalogVariantMayDeactivate(db, id);
    if (duplicate?.id && isActive) throw new Error('Такая комбинация уже существует. Не создавайте второй дубль.');
    await db.prepare(
      `UPDATE catalog_variants
       SET product_id = ?, stock_position_id = ?, category = ?, gender = ?, color = ?, material = ?, length = ?,
           size_label = ?, is_active = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).bind(productId, execution.id, category, gender || null, color || null, material, length, sizeLabel || null, isActive, sortOrder, timestamp, id).run();
    return { ok: true };
  }

  const deactivating = toInt(existing.is_active, 1) === 1 && isActive === 0;
  if (deactivating) await assertCatalogVariantMayDeactivate(db, id);
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
