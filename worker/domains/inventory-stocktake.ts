// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import type { InventoryCycleCountApplyResponse, InventoryCycleCountSuggestionsResponse, InventoryStocktakeMutationResponse, InventoryStocktakeSession, InventoryStocktakeSessionsResponse } from '../../shared/api-contracts.ts'
import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, normalizeSourceType, toInt, upperText } from '../core/text.ts'
import { ensureCatalogExecutionV3, isCatalogIdentityV3Enabled, makeVariantExternalId, normalizeCatalogCombinationColor, normalizeCatalogCombinationGender, normalizeCatalogCombinationSize } from './catalog.ts'
import { isReversibleInventoryMovementReference } from './inventory-reservations.ts'

export type InventoryStocktakeSessionRow = Record<string, unknown>;


export function inventoryStocktakeSessionId(source: string, scope: 'full' | 'selective' = 'full') {
  const compact = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const scopeCode = scope === 'selective' ? 'P' : 'F';
  return `REV-${source === 'boutique' ? 'B' : 'S'}-${scopeCode}-${compact}-${suffix}`;
}


export function inventoryStocktakeScopeFromId(sessionId: unknown): 'full' | 'selective' {
  return /^REV-[SB]-P-/i.test(cleanText(sessionId)) ? 'selective' : 'full';
}


export async function getInventoryStocktakeItemRows(db: D1Database, sessionId: string) {
  const result = await db.prepare(
    `SELECT
       i.id, i.session_id, i.inventory_source, i.stock_id, i.product_id, i.variant_id,
       i.product_name_snapshot, i.category_snapshot, i.gender_snapshot, i.color_snapshot,
       i.material_snapshot, i.length_snapshot, i.size_snapshot,
       i.opening_quantity, i.opening_reserved_quantity, i.baseline_quantity,
       i.counted_quantity, i.counted_at, i.status, i.conflict_quantity, i.applied_quantity,
       i.created_at, i.updated_at,
       COALESCE(s.quantity, 0) AS current_quantity,
       COALESCE(s.reserved_quantity, 0) AS current_reserved_quantity,
       s.id AS current_stock_id
     FROM inventory_stocktake_items i
     LEFT JOIN inventory_stock s
       ON s.inventory_source = i.inventory_source
      AND (
        (i.stock_id IS NOT NULL AND s.id = i.stock_id)
        OR (i.stock_id IS NULL AND i.variant_id IS NOT NULL AND s.variant_id = i.variant_id)
      )
     WHERE i.session_id = ?
     ORDER BY i.product_name_snapshot,
       COALESCE(i.material_snapshot, ''), COALESCE(i.length_snapshot, ''),
       COALESCE(i.category_snapshot, ''), COALESCE(i.gender_snapshot, ''),
       COALESCE(i.color_snapshot, ''), COALESCE(i.size_snapshot, ''), i.id`
  ).bind(sessionId).all<InventoryStocktakeSessionRow>();
  return result.results || [];
}


export async function serializeInventoryStocktakeSession(db: D1Database, sessionId: string): Promise<InventoryStocktakeSession> {
  const session = await db.prepare(
    `SELECT id, inventory_source, status, created_by, started_at, updated_at, completed_at, cancelled_at
     FROM inventory_stocktake_sessions WHERE id = ? LIMIT 1`
  ).bind(sessionId).first<InventoryStocktakeSessionRow>();
  if (!session?.id) throw new Error('Ревизия не найдена.');

  const rows = await getInventoryStocktakeItemRows(db, sessionId);
  const items = rows.map(row => ({
    id: toInt(row.id, 0),
    sessionId: cleanText(row.session_id),
    source: normalizeSourceType(row.inventory_source),
    stockId: toInt(row.current_stock_id, 0) || toInt(row.stock_id, 0) || null,
    productId: toInt(row.product_id, 0),
    variantId: toInt(row.variant_id, 0),
    productName: cleanText(row.product_name_snapshot),
    category: normalizeAudienceCategory(row.category_snapshot, row.size_snapshot),
    gender: cleanText(row.gender_snapshot),
    color: cleanText(row.color_snapshot),
    material: canonicalStockPositionValue(row.material_snapshot),
    length: canonicalStockPositionValue(row.length_snapshot),
    size: cleanText(row.size_snapshot),
    openingQuantity: toInt(row.opening_quantity, 0),
    openingReservedQuantity: Math.max(0, toInt(row.opening_reserved_quantity, 0)),
    baselineQuantity: toInt(row.baseline_quantity, 0),
    countedQuantity: row.counted_quantity === null || row.counted_quantity === undefined ? null : Math.max(0, toInt(row.counted_quantity, 0)),
    countedAt: cleanText(row.counted_at) || null,
    status: cleanText(row.status) || 'pending',
    conflictQuantity: row.conflict_quantity === null || row.conflict_quantity === undefined ? null : toInt(row.conflict_quantity, 0),
    appliedQuantity: row.applied_quantity === null || row.applied_quantity === undefined ? null : toInt(row.applied_quantity, 0),
    currentQuantity: toInt(row.current_quantity, 0),
    reservedQuantity: Math.max(0, toInt(row.current_reserved_quantity, 0)),
  }));
  const countedCount = items.filter(item => item.countedQuantity !== null && item.status !== 'pending').length;
  const recountCount = items.filter(item => item.status === 'recount_required').length;
  const shortageCount = items.filter(item => item.countedQuantity !== null && item.countedQuantity - item.reservedQuantity < 0).length;
  return {
    id: cleanText(session.id),
    source: normalizeSourceType(session.inventory_source),
    scope: inventoryStocktakeScopeFromId(session.id),
    status: cleanText(session.status),
    createdBy: cleanText(session.created_by),
    startedAt: cleanText(session.started_at),
    updatedAt: cleanText(session.updated_at),
    completedAt: cleanText(session.completed_at) || null,
    cancelledAt: cleanText(session.cancelled_at) || null,
    totalItems: items.length,
    countedCount,
    recountCount,
    shortageCount,
    items,
  };
}


export async function listInventoryStocktakeSessions(db: D1Database, url: URL): Promise<InventoryStocktakeSessionsResponse> {
  const sourceRaw = cleanText(url.searchParams.get('source'));
  const params: unknown[] = [];
  let sourceClause = '';
  if (sourceRaw) {
    sourceClause = ' AND inventory_source = ?';
    params.push(normalizeSourceType(sourceRaw));
  }
  const result = await db.prepare(
    `SELECT id, inventory_source, status, created_by, started_at, updated_at, completed_at, cancelled_at
     FROM inventory_stocktake_sessions
     WHERE status = 'active'${sourceClause}
     ORDER BY updated_at DESC`
  ).bind(...params).all<InventoryStocktakeSessionRow>();
  const sessions = [];
  for (const row of result.results || []) {
    const summary = await db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN counted_quantity IS NOT NULL THEN 1 ELSE 0 END) AS counted,
              SUM(CASE WHEN status = 'recount_required' THEN 1 ELSE 0 END) AS recount
       FROM inventory_stocktake_items WHERE session_id = ?`
    ).bind(cleanText(row.id)).first<Record<string, unknown>>();
    sessions.push({
      id: cleanText(row.id),
      source: normalizeSourceType(row.inventory_source),
      scope: inventoryStocktakeScopeFromId(row.id),
      status: cleanText(row.status),
      createdBy: cleanText(row.created_by),
      startedAt: cleanText(row.started_at),
      updatedAt: cleanText(row.updated_at),
      totalItems: toInt(summary?.total, 0),
      countedCount: toInt(summary?.counted, 0),
      recountCount: toInt(summary?.recount, 0),
    });
  }
  return { ok: true, sessions };
}


export async function createInventoryStocktakeSession(
  db: D1Database,
  input: { source?: unknown; productIds?: unknown },
  actor: string,
): Promise<InventoryStocktakeMutationResponse> {
  const source = normalizeSourceType(input.source);
  const selectedProductIds = Array.from(new Set(
    Array.isArray(input.productIds)
      ? input.productIds.map(value => Math.max(0, toInt(value, 0))).filter(Boolean)
      : [],
  )).slice(0, 80);
  const scope: 'full' | 'selective' = selectedProductIds.length ? 'selective' : 'full';
  const existing = await db.prepare(
    `SELECT id FROM inventory_stocktake_sessions WHERE inventory_source = ? AND status = 'active' LIMIT 1`
  ).bind(source).first<{ id: string }>();
  if (existing?.id) {
    return {
      ok: true,
      resumed: true,
      sessionId: existing.id,
      session: await serializeInventoryStocktakeSession(db, existing.id),
    };
  }

  const now = new Date().toISOString();
  const sessionId = inventoryStocktakeSessionId(source, scope);
  const scopeClause = selectedProductIds.length
    ? ` AND COALESCE(s.product_id, v.product_id) IN (${selectedProductIds.map(() => '?').join(',')})`
    : '';

  if (scope === 'selective') {
    const selectedCount = await db.prepare(
      `SELECT COUNT(*) AS qty
       FROM inventory_stock s
       LEFT JOIN catalog_variants v ON v.id = s.variant_id
       WHERE s.inventory_source = ?
         AND (COALESCE(s.quantity, 0) <> 0 OR COALESCE(s.reserved_quantity, 0) <> 0)
         AND (
           s.variant_id IS NULL
           OR (
             COALESCE(v.is_active, 0) = 1
             AND EXISTS (
               SELECT 1 FROM catalog_products active_product
               WHERE active_product.id = v.product_id AND active_product.is_active = 1
             )
           )
         )
         ${scopeClause}`
    ).bind(source, ...selectedProductIds).first<{ qty: number }>();
    if (toInt(selectedCount?.qty, 0) <= 0) {
      throw new Error('У выбранных товаров сейчас нет позиций с остатком или резервом. Для найденного товара используйте «Нашли ещё позицию» внутри обычной ревизии.');
    }
  }

  // Step 188E usability: create the session and its initial item list with two
  // constant-size SQL statements. Do not create one D1 statement per SKU; a full
  // clothing revision can contain hundreds of positions.
  await db.batch([
    db.prepare(
      `INSERT INTO inventory_stocktake_sessions (
         id, inventory_source, status, created_by, started_at, updated_at
       ) VALUES (?, ?, 'active', ?, ?, ?)`
    ).bind(sessionId, source, actor || null, now, now),
    db.prepare(
      `INSERT INTO inventory_stocktake_items (
         session_id, inventory_source, stock_id, product_id, variant_id,
         product_name_snapshot, category_snapshot, gender_snapshot, color_snapshot,
         material_snapshot, length_snapshot, size_snapshot,
         opening_quantity, opening_reserved_quantity, baseline_quantity,
         status, created_at, updated_at
       )
       SELECT
         ?, s.inventory_source, s.id, COALESCE(s.product_id, v.product_id), s.variant_id,
         s.product_name_snapshot,
         CASE WHEN COALESCE(v.category, '') = 'child' THEN 'child' ELSE 'adult' END,
         COALESCE(v.gender, s.gender_snapshot, ''), COALESCE(v.color, s.color_snapshot, ''),
         COALESCE(NULLIF(v.material, ''), NULLIF(s.material_snapshot, ''), 'СТАНДАРТ'),
         COALESCE(NULLIF(v.length, ''), NULLIF(s.length_snapshot, ''), 'СТАНДАРТ'),
         COALESCE(v.size_label, s.size_snapshot, ''),
         COALESCE(s.quantity, 0), MAX(0, COALESCE(s.reserved_quantity, 0)), COALESCE(s.quantity, 0),
         'pending', ?, ?
       FROM inventory_stock s
       LEFT JOIN catalog_variants v ON v.id = s.variant_id
       WHERE s.inventory_source = ?
         AND (COALESCE(s.quantity, 0) <> 0 OR COALESCE(s.reserved_quantity, 0) <> 0)
         AND (
           s.variant_id IS NULL
           OR (
             COALESCE(v.is_active, 0) = 1
             AND EXISTS (
               SELECT 1 FROM catalog_products active_product
               WHERE active_product.id = v.product_id AND active_product.is_active = 1
             )
           )
         )
         ${scopeClause}`
    ).bind(sessionId, now, now, source, ...selectedProductIds),
  ]);
  return { ok: true, resumed: false, session: await serializeInventoryStocktakeSession(db, sessionId) };
}


export async function saveInventoryStocktakeCount(
  db: D1Database,
  sessionId: string,
  itemId: number,
  input: { countedQuantity?: unknown },
) {
  const session = await db.prepare(
    `SELECT id, inventory_source, status FROM inventory_stocktake_sessions WHERE id = ? LIMIT 1`
  ).bind(sessionId).first<InventoryStocktakeSessionRow>();
  if (!session?.id) throw new Error('Ревизия не найдена.');
  if (cleanText(session.status) !== 'active') throw new Error('Эта ревизия уже завершена или отменена.');
  const item = await db.prepare(
    `SELECT id, stock_id, variant_id, baseline_quantity, counted_quantity, counted_at, status, conflict_quantity FROM inventory_stocktake_items WHERE id = ? AND session_id = ? LIMIT 1`
  ).bind(itemId, sessionId).first<InventoryStocktakeSessionRow>();
  if (!item?.id) throw new Error('Позиция ревизии не найдена.');
  if (!Object.prototype.hasOwnProperty.call(input, 'countedQuantity')) {
    throw new Error('Укажите количество или явно очистите результат пересчёта.');
  }
  const clearCount = input.countedQuantity === null;
  const numericCount = clearCount ? null : Number(input.countedQuantity);
  if (!clearCount && (!Number.isFinite(numericCount) || numericCount! < 0 || !Number.isInteger(numericCount))) {
    throw new Error('Количество должно быть целым числом 0 или больше.');
  }
  const counted = clearCount ? null : Math.max(0, Number(numericCount));
  const source = normalizeSourceType(session.inventory_source);
  const stock = toInt(item.stock_id, 0)
    ? await db.prepare(`SELECT id, quantity, reserved_quantity FROM inventory_stock WHERE id = ? AND inventory_source = ? LIMIT 1`).bind(toInt(item.stock_id, 0), source).first<Record<string, unknown>>()
    : await db.prepare(`SELECT id, quantity, reserved_quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? LIMIT 1`).bind(source, toInt(item.variant_id, 0)).first<Record<string, unknown>>();
  const currentQuantity = toInt(stock?.quantity, 0);
  const now = new Date().toISOString();
  const previousBaseline = toInt(item.baseline_quantity, 0);
  const persistedCount = item.counted_quantity === null || item.counted_quantity === undefined
    ? null
    : Math.max(0, toInt(item.counted_quantity, 0));
  const persistedStatus = cleanText(item.status);
  const alreadyPersisted = currentQuantity === previousBaseline && (
    (clearCount && persistedCount === null && persistedStatus === 'pending')
    || (!clearCount && persistedCount === counted && persistedStatus === 'counted')
  );
  if (alreadyPersisted) {
    return {
      ok: true,
      item: {
        id: itemId,
        stockId: toInt(stock?.id, 0) || toInt(item.stock_id, 0) || null,
        baselineQuantity: previousBaseline,
        countedQuantity: persistedCount,
        countedAt: cleanText(item.counted_at) || null,
        status: persistedStatus,
        conflictQuantity: item.conflict_quantity === null || item.conflict_quantity === undefined ? null : toInt(item.conflict_quantity, 0),
        currentQuantity,
        reservedQuantity: Math.max(0, toInt(stock?.reserved_quantity, 0)),
      },
    };
  }

  if (clearCount) {
    await db.batch([
      db.prepare(
        `UPDATE inventory_stocktake_items
         SET stock_id = COALESCE(stock_id, ?), baseline_quantity = ?, counted_quantity = NULL, counted_at = NULL,
             status = 'pending', conflict_quantity = NULL, updated_at = ?
         WHERE id = ? AND session_id = ?`
      ).bind(toInt(stock?.id, 0) || null, currentQuantity, now, itemId, sessionId),
      db.prepare(`UPDATE inventory_stocktake_sessions SET updated_at = ? WHERE id = ?`).bind(now, sessionId),
    ]);
    const cleared = (await getInventoryStocktakeItemRows(db, sessionId)).find(row => toInt(row.id, 0) === itemId);
    if (!cleared) throw new Error('Не удалось очистить результат пересчёта.');
    return {
      ok: true,
      item: {
        id: itemId,
        stockId: toInt(cleared.current_stock_id, 0) || toInt(cleared.stock_id, 0) || null,
        baselineQuantity: toInt(cleared.baseline_quantity, 0),
        countedQuantity: null,
        countedAt: null,
        status: 'pending',
        conflictQuantity: null,
        currentQuantity: toInt(cleared.current_quantity, 0),
        reservedQuantity: Math.max(0, toInt(cleared.current_reserved_quantity, 0)),
      },
    };
  }

  if (currentQuantity !== previousBaseline) {
    await db.batch([
      db.prepare(
        `UPDATE inventory_stocktake_items
         SET stock_id = COALESCE(stock_id, ?), baseline_quantity = ?, counted_quantity = NULL, counted_at = NULL,
             status = 'recount_required', conflict_quantity = ?, updated_at = ?
         WHERE id = ? AND session_id = ?`
      ).bind(toInt(stock?.id, 0) || null, currentQuantity, currentQuantity, now, itemId, sessionId),
      db.prepare(`UPDATE inventory_stocktake_sessions SET updated_at = ? WHERE id = ?`).bind(now, sessionId),
    ]);
    return {
      ok: false,
      code: 'recount_required',
      message: 'Эта позиция изменилась во время ревизии. Система обновила контрольную точку — пересчитайте её ещё раз.',
      item: {
        id: itemId, stockId: toInt(stock?.id, 0) || toInt(item.stock_id, 0) || null,
        baselineQuantity: currentQuantity, countedQuantity: null, countedAt: null, status: 'recount_required',
        conflictQuantity: currentQuantity, currentQuantity,
      },
    };
  }
  await db.batch([
    db.prepare(
      `UPDATE inventory_stocktake_items
       SET stock_id = COALESCE(stock_id, ?), baseline_quantity = ?, counted_quantity = ?, counted_at = ?,
           status = 'counted', conflict_quantity = NULL, updated_at = ?
       WHERE id = ? AND session_id = ?`
    ).bind(toInt(stock?.id, 0) || null, currentQuantity, counted!, now, now, itemId, sessionId),
    db.prepare(`UPDATE inventory_stocktake_sessions SET updated_at = ? WHERE id = ?`).bind(now, sessionId),
  ]);
  const updated = (await getInventoryStocktakeItemRows(db, sessionId)).find(row => toInt(row.id, 0) === itemId);
  if (!updated) throw new Error('Не удалось перечитать сохранённую позицию ревизии.');
  return {
    ok: true,
    item: {
      id: itemId,
      stockId: toInt(updated.current_stock_id, 0) || toInt(updated.stock_id, 0) || null,
      baselineQuantity: toInt(updated.baseline_quantity, 0),
      countedQuantity: Math.max(0, toInt(updated.counted_quantity, 0)),
      countedAt: cleanText(updated.counted_at) || null,
      status: cleanText(updated.status),
      conflictQuantity: null,
      currentQuantity: toInt(updated.current_quantity, 0),
      reservedQuantity: Math.max(0, toInt(updated.current_reserved_quantity, 0)),
    },
  };
}


export async function addInventoryStocktakeVariant(
  db: D1Database,
  sessionId: string,
  input: { variantId?: unknown },
) {
  const variantId = Math.max(0, toInt(input.variantId, 0));
  if (!variantId) throw new Error('Выберите товар из каталога.');
  const session = await db.prepare(
    `SELECT id, inventory_source, status FROM inventory_stocktake_sessions WHERE id = ? LIMIT 1`
  ).bind(sessionId).first<InventoryStocktakeSessionRow>();
  if (!session?.id) throw new Error('Ревизия не найдена.');
  if (cleanText(session.status) !== 'active') throw new Error('Эта ревизия уже завершена или отменена.');
  const existing = await db.prepare(
    `SELECT id FROM inventory_stocktake_items WHERE session_id = ? AND variant_id = ? LIMIT 1`
  ).bind(sessionId, variantId).first<{ id: number }>();
  if (existing?.id) return { ok: true, alreadyPresent: true, session: await serializeInventoryStocktakeSession(db, sessionId) };

  const variant = await db.prepare(
    `SELECT v.id, v.product_id, v.category, v.gender, v.color, v.material, v.length, v.size_label,
            p.name AS product_name
     FROM catalog_variants v
     JOIN catalog_products p ON p.id = v.product_id
     WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1 LIMIT 1`
  ).bind(variantId).first<InventoryStocktakeSessionRow>();
  if (!variant?.id) throw new Error('Активная комбинация товара не найдена.');
  const source = normalizeSourceType(session.inventory_source);
  const stock = await db.prepare(
    `SELECT id, quantity, reserved_quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? LIMIT 1`
  ).bind(source, variantId).first<InventoryStocktakeSessionRow>();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO inventory_stocktake_items (
         session_id, inventory_source, stock_id, product_id, variant_id,
         product_name_snapshot, category_snapshot, gender_snapshot, color_snapshot,
         material_snapshot, length_snapshot, size_snapshot,
         opening_quantity, opening_reserved_quantity, baseline_quantity,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(
      sessionId,
      source,
      toInt(stock?.id, 0) || null,
      toInt(variant.product_id, 0) || null,
      variantId,
      cleanText(variant.product_name),
      normalizeAudienceCategory(variant.category, variant.size_label),
      cleanText(variant.gender) || null,
      cleanText(variant.color) || null,
      canonicalStockPositionValue(variant.material),
      canonicalStockPositionValue(variant.length),
      cleanText(variant.size_label) || null,
      toInt(stock?.quantity, 0),
      Math.max(0, toInt(stock?.reserved_quantity, 0)),
      toInt(stock?.quantity, 0),
      now,
      now,
    ),
    db.prepare(`UPDATE inventory_stocktake_sessions SET updated_at = ? WHERE id = ?`).bind(now, sessionId),
  ]);
  return { ok: true, alreadyPresent: false, session: await serializeInventoryStocktakeSession(db, sessionId) };
}


export async function addInventoryStocktakeCombination(
  db: D1Database,
  sessionId: string,
  input: {
    productId?: unknown;
    material?: unknown;
    length?: unknown;
    category?: unknown;
    gender?: unknown;
    color?: unknown;
    size?: unknown;
    sizes?: unknown;
    createReferenceFields?: unknown;
  },
) {
  if (!await isCatalogIdentityV3Enabled(db)) throw new Error('Сначала завершите обновление идентичности каталога Step 188D.');
  const productId = Math.max(0, toInt(input.productId, 0));
  if (!productId) throw new Error('Выберите базовый товар.');
  const product = await db.prepare(
    `SELECT id, name FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1`
  ).bind(productId).first<{ id: number; name: string }>();
  if (!product?.id) throw new Error('Выбранный товар не найден или отключён.');

  const session = await db.prepare(
    `SELECT id, inventory_source, status FROM inventory_stocktake_sessions WHERE id = ? LIMIT 1`
  ).bind(sessionId).first<InventoryStocktakeSessionRow>();
  if (!session?.id) throw new Error('Ревизия не найдена.');
  if (cleanText(session.status) !== 'active') throw new Error('Эта ревизия уже завершена или отменена.');

  const createFields = new Set(Array.isArray(input.createReferenceFields) ? (input.createReferenceFields as unknown[]).map(cleanText) : []);
  const material = canonicalStockPositionValue(input.material);
  const length = canonicalStockPositionValue(input.length);
  const rawSizes = Array.isArray(input.sizes) ? input.sizes : [input.size];
  const normalizedSizes = Array.from(new Set(rawSizes.map(value => normalizeCatalogCombinationSize(value)).filter(Boolean))).slice(0, 40);
  const category = normalizeAudienceCategory(input.category, normalizedSizes[0] || input.size);
  const gender = normalizeCatalogCombinationGender(input.gender);
  const color = normalizeCatalogCombinationColor(input.color);
  if (!normalizedSizes.length) throw new Error(category === 'child' ? 'Выберите хотя бы один возраст.' : 'Выберите хотя бы один размер.');
  if (gender && gender !== 'ЖЕН' && gender !== 'МУЖ') throw new Error('Выберите пол из списка.');

  // Step 190.2: reference validation is set-based. Forty selected sizes must not become
  // forty separate existence queries before the actual stocktake write even starts.
  const referenceRows: Array<{ field: string; kind: string; value: string }> = [];
  const pushReference = (field: string, kind: string, value: string) => {
    const normalized = upperText(value);
    if (!normalized || ((kind === 'material' || kind === 'length') && normalized === 'СТАНДАРТ')) return;
    if (!referenceRows.some(row => row.kind === kind && row.value === normalized)) referenceRows.push({ field, kind, value: normalized });
  };
  pushReference('material', 'material', material);
  pushReference('length', 'length', length);
  pushReference('color', 'color', color);
  for (const size of normalizedSizes) pushReference('size', category === 'child' ? 'child_age' : 'size', size);

  const timestamp = new Date().toISOString();
  if (referenceRows.length) {
    const referenceJson = JSON.stringify(referenceRows);
    const referenceState = await db.prepare(
      `WITH wanted AS (
         SELECT CAST(json_extract(j.value, '$.field') AS TEXT) AS field,
                CAST(json_extract(j.value, '$.kind') AS TEXT) AS kind,
                CAST(json_extract(j.value, '$.value') AS TEXT) AS value
         FROM json_each(?) j
       )
       SELECT w.field, w.kind, w.value, CASE WHEN rv.id IS NULL THEN 0 ELSE 1 END AS exists_flag
       FROM wanted w
       LEFT JOIN reference_values rv
         ON rv.kind = w.kind AND rv.is_active = 1 AND UPPER(TRIM(rv.value)) = w.value`
    ).bind(referenceJson).all<Record<string, unknown>>();
    const missing = (referenceState.results || []).filter(row => toInt(row.exists_flag, 0) === 0);
    for (const row of missing) {
      const field = cleanText(row.field);
      const value = cleanText(row.value);
      if (!createFields.has(field)) {
        throw new Error(`Значение «${value}» ещё не существует. Выберите существующее или явно добавьте его как новое.`);
      }
    }
    if (missing.length) {
      const missingJson = JSON.stringify(missing.map(row => ({ kind: cleanText(row.kind), value: cleanText(row.value) })));
      await db.prepare(
        `INSERT INTO reference_values (kind, value, is_active, sort_order, created_at, updated_at)
         SELECT CAST(json_extract(j.value, '$.kind') AS TEXT), CAST(json_extract(j.value, '$.value') AS TEXT), 1, 0, ?, ?
         FROM json_each(?) j
         WHERE 1
         ON CONFLICT(kind, value) DO UPDATE SET
           is_active = excluded.is_active,
           sort_order = excluded.sort_order,
           updated_at = excluded.updated_at`
      ).bind(timestamp, timestamp, missingJson).run();
    }
  }

  const execution = await ensureCatalogExecutionV3(db, productId, material, length, timestamp);
  const sizesJson = JSON.stringify(normalizedSizes);
  const existingVariants = await db.prepare(
    `SELECT id, size_label
     FROM catalog_variants
     WHERE stock_position_id = ? AND is_active = 1
       AND COALESCE(category, 'adult') = ?
       AND COALESCE(gender, '') = ?
       AND COALESCE(color, '') = ?
       AND COALESCE(size_label, '') IN (SELECT CAST(value AS TEXT) FROM json_each(?))`
  ).bind(execution.id, category, gender, color, sizesJson).all<{ id: number; size_label: string }>();
  const existingBySize = new Map((existingVariants.results || []).map(row => [normalizeCatalogCombinationSize(row.size_label), toInt(row.id, 0)]));
  const missingSizes = normalizedSizes.filter(size => !existingBySize.has(size));

  let createdCount = 0;
  if (missingSizes.length) {
    const missingVariantJson = JSON.stringify(missingSizes.map(size => ({
      size,
      externalId: makeVariantExternalId(product.name, category, gender, color, execution.material, execution.length, size),
    })));
    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO catalog_variants (
         external_id, product_id, stock_position_id, category, gender, color, material, length, size_label,
         is_active, sort_order, created_at, updated_at
       )
       SELECT CAST(json_extract(j.value, '$.externalId') AS TEXT), ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?,
              NULLIF(CAST(json_extract(j.value, '$.size') AS TEXT), ''), 1, 0, ?, ?
       FROM json_each(?) j`
    ).bind(productId, execution.id, category, gender, color, execution.material, execution.length, timestamp, timestamp, missingVariantJson).run();
    createdCount = Math.max(0, toInt(inserted.meta?.changes, 0));
  }

  const variantRows = await db.prepare(
    `SELECT id, size_label
     FROM catalog_variants
     WHERE stock_position_id = ? AND is_active = 1
       AND COALESCE(category, 'adult') = ?
       AND COALESCE(gender, '') = ?
       AND COALESCE(color, '') = ?
       AND COALESCE(size_label, '') IN (SELECT CAST(value AS TEXT) FROM json_each(?))`
  ).bind(execution.id, category, gender, color, sizesJson).all<{ id: number; size_label: string }>();
  const variantBySize = new Map((variantRows.results || []).map(row => [normalizeCatalogCombinationSize(row.size_label), toInt(row.id, 0)]));
  const variantIds = normalizedSizes.map(size => variantBySize.get(size) || 0).filter(Boolean);
  if (variantIds.length !== normalizedSizes.length) throw new Error('Не удалось создать все выбранные складские комбинации. Обновите каталог и повторите действие.');

  const source = normalizeSourceType(session.inventory_source);
  const variantIdsJson = JSON.stringify(variantIds);
  const insertItems = db.prepare(
    `WITH wanted AS (
       SELECT CAST(value AS INTEGER) AS variant_id FROM json_each(?)
     )
     INSERT OR IGNORE INTO inventory_stocktake_items (
       session_id, inventory_source, stock_id, product_id, variant_id,
       product_name_snapshot, category_snapshot, gender_snapshot, color_snapshot,
       material_snapshot, length_snapshot, size_snapshot,
       opening_quantity, opening_reserved_quantity, baseline_quantity,
       status, created_at, updated_at
     )
     SELECT ?, ?, s.id, v.product_id, v.id,
            p.name, COALESCE(NULLIF(v.category, ''), 'adult'), NULLIF(v.gender, ''), NULLIF(v.color, ''),
            COALESCE(NULLIF(v.material, ''), 'СТАНДАРТ'), COALESCE(NULLIF(v.length, ''), 'СТАНДАРТ'), NULLIF(v.size_label, ''),
            COALESCE(s.quantity, 0), MAX(0, COALESCE(s.reserved_quantity, 0)), COALESCE(s.quantity, 0),
            'pending', ?, ?
     FROM wanted w
     JOIN catalog_variants v ON v.id = w.variant_id AND v.is_active = 1
     JOIN catalog_products p ON p.id = v.product_id AND p.is_active = 1
     LEFT JOIN inventory_stock s ON s.inventory_source = ? AND s.variant_id = v.id
     WHERE NOT EXISTS (
       SELECT 1 FROM inventory_stocktake_items sti WHERE sti.session_id = ? AND sti.variant_id = v.id
     )`
  ).bind(variantIdsJson, sessionId, source, timestamp, timestamp, source, sessionId);
  const touchSession = db.prepare(`UPDATE inventory_stocktake_sessions SET updated_at = ? WHERE id = ?`).bind(timestamp, sessionId);
  const batchResult = await db.batch([insertItems, touchSession]);
  const addedCount = Math.max(0, toInt((batchResult?.[0] as any)?.meta?.changes, 0));

  return {
    ok: true,
    variantIds,
    createdCount,
    addedCount,
    alreadyPresentCount: variantIds.length - addedCount,
    session: await serializeInventoryStocktakeSession(db, sessionId),
  };
}


export async function listInventoryCycleCountSuggestions(db: D1Database, url: URL): Promise<InventoryCycleCountSuggestionsResponse> {
  const source = normalizeSourceType(url.searchParams.get('source'));
  const limit = Math.min(24, Math.max(6, toInt(url.searchParams.get('limit'), 12)));
  const activeSession = await db.prepare(
    `SELECT id FROM inventory_stocktake_sessions WHERE inventory_source = ? AND status = 'active' LIMIT 1`
  ).bind(source).first<{ id: string }>();

  const result = await db.prepare(
    `SELECT
       s.product_id, s.variant_id, s.quantity, s.reserved_quantity,
       p.name AS product_name, v.category, v.gender, v.color, v.material, v.length, v.size_label,
       lc.checked_at AS last_checked_at, lc.counted_quantity AS last_counted_quantity,
       lc.difference_quantity AS last_difference_quantity, lc.check_type AS last_check_type,
       COALESCE((
         SELECT COUNT(*) FROM inventory_movements m
         WHERE m.inventory_source = s.inventory_source
           AND m.variant_id = s.variant_id
           AND m.created_at > COALESCE(lc.checked_at, datetime('now', '-30 days'))
       ), 0) AS movements_since_check
     FROM inventory_stock s
     JOIN catalog_variants v ON v.id = s.variant_id AND v.is_active = 1
     JOIN catalog_products p ON p.id = v.product_id AND p.is_active = 1
     LEFT JOIN inventory_stock_checks lc ON lc.id = (
       SELECT c2.id FROM inventory_stock_checks c2
       WHERE c2.inventory_source = s.inventory_source AND c2.variant_id = s.variant_id
       ORDER BY c2.checked_at DESC, c2.id DESC LIMIT 1
     )
     WHERE s.inventory_source = ? AND s.variant_id IS NOT NULL
       AND (COALESCE(s.quantity, 0) <> 0 OR COALESCE(s.reserved_quantity, 0) <> 0)
     ORDER BY p.name, v.material, v.length, v.color, v.size_label`
  ).bind(source).all<Record<string, unknown>>();

  const now = Date.now();
  const all = (result.results || []).map(row => {
    const physical = toInt(row.quantity, 0);
    const reserved = Math.max(0, toInt(row.reserved_quantity, 0));
    const free = physical - reserved;
    const lastCheckedAt = cleanText(row.last_checked_at) || null;
    const lastMs = lastCheckedAt ? Date.parse(lastCheckedAt) : NaN;
    const daysSinceCheck = Number.isFinite(lastMs) ? Math.max(0, Math.floor((now - lastMs) / 86400000)) : null;
    const movementsSinceCheck = Math.max(0, toInt(row.movements_since_check, 0));
    const lastDifference = toInt(row.last_difference_quantity, 0);
    const reasons: string[] = [];
    let priority = 0;

    if (physical < 0) {
      priority += 170;
      reasons.push(`Учёт показывает отрицательный остаток ${physical} — нужна физическая сверка`);
    }
    if (free < 0) {
      priority += 140;
      reasons.push(`Не хватает ${Math.abs(free)} шт. для текущих заказов`);
    }
    if (!lastCheckedAt) {
      priority += 70;
      reasons.push('Ещё не сверяли физически');
    } else if ((daysSinceCheck || 0) >= 60) {
      priority += 60;
      reasons.push(`Не проверяли ${daysSinceCheck} дн.`);
    } else if ((daysSinceCheck || 0) >= 30) {
      priority += 35;
      reasons.push(`Не проверяли ${daysSinceCheck} дн.`);
    }
    if (movementsSinceCheck >= 12) {
      priority += 45;
      reasons.push(`После сверки было движений: ${movementsSinceCheck}`);
    } else if (movementsSinceCheck >= 6) {
      priority += 25;
      reasons.push(`После сверки было движений: ${movementsSinceCheck}`);
    }
    if (lastCheckedAt && lastDifference !== 0) {
      priority += 15;
      reasons.push(`В прошлую сверку нашли расхождение ${lastDifference > 0 ? '+' : ''}${lastDifference}`);
    }

    return {
      productId: toInt(row.product_id, 0),
      variantId: toInt(row.variant_id, 0),
      productName: cleanText(row.product_name),
      category: normalizeAudienceCategory(row.category, row.size_label),
      gender: cleanText(row.gender),
      color: cleanText(row.color),
      material: canonicalStockPositionValue(row.material),
      length: canonicalStockPositionValue(row.length),
      size: cleanText(row.size_label),
      physical,
      reserved,
      free,
      lastCheckedAt,
      daysSinceCheck,
      movementsSinceCheck,
      lastDifference,
      lastCheckType: cleanText(row.last_check_type),
      reasons,
      priority,
    };
  });

  const recommended = all
    .filter(row => row.priority >= 25)
    .sort((a, b) => b.priority - a.priority
      || (b.daysSinceCheck ?? 999999) - (a.daysSinceCheck ?? 999999)
      || b.movementsSinceCheck - a.movementsSinceCheck
      || a.productName.localeCompare(b.productName, 'ru'));

  return {
    ok: true,
    source,
    blockedByStocktake: Boolean(activeSession?.id),
    activeStocktakeId: activeSession?.id || null,
    totalPositions: all.length,
    recommendedCount: recommended.length,
    items: recommended.slice(0, limit),
    policy: { dueAfterDays: 30, highDueAfterDays: 60, movementAttention: 6, movementHigh: 12 },
  };
}


export async function quickInventoryStocktakeBatch(
  db: D1Database,
  input: { source?: unknown; items?: unknown; requestId?: unknown },
  options: { actor?: string; checkType?: string; referenceType?: string } = {},
): Promise<InventoryCycleCountApplyResponse> {
  const source = normalizeSourceType(input.source);
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length) throw new Error('Выберите хотя бы одну позицию для сверки.');
  if (rawItems.length > 30) throw new Error('За одну быструю сверку можно проверить не больше 30 позиций.');

  const items = rawItems.map((raw: any) => ({
    variantId: Math.max(0, toInt(raw?.variantId, 0)),
    expectedQuantity: toInt(raw?.expectedQuantity, 0),
    countedQuantity: raw?.countedQuantity,
  }));
  if (items.some(item => !item.variantId)) throw new Error('В сверке есть позиция без варианта товара.');
  if (new Set(items.map(item => item.variantId)).size !== items.length) throw new Error('Одна и та же позиция выбрана для сверки несколько раз.');
  for (const item of items) {
    const counted = Number(item.countedQuantity);
    if (item.countedQuantity === null || item.countedQuantity === undefined || cleanText(item.countedQuantity) === '' || !Number.isFinite(counted) || counted < 0 || !Number.isInteger(counted)) {
      throw new Error('Для каждой выбранной позиции укажите целое фактическое количество 0 или больше.');
    }
  }

  const checkType = cleanText(options.checkType) || 'quick_stocktake';
  const checkReferenceType = cleanText(options.referenceType) || (checkType === 'cycle_count' ? 'cycle_count' : 'quick_stocktake');
  const requestId = cleanText(input.requestId).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 96);
  const requestReferenceId = requestId ? `stock-check:${checkType}:${source}:${requestId}` : '';

  const loadReplay = async (): Promise<InventoryCycleCountApplyResponse | null> => {
    if (!requestReferenceId) return null;
    const previous = await db.prepare(
      `SELECT variant_id, expected_quantity, counted_quantity, difference_quantity, reserved_quantity
       FROM inventory_stock_checks
       WHERE inventory_source = ? AND check_type = ? AND reference_type = ? AND reference_id = ?
       ORDER BY variant_id`
    ).bind(source, checkType, checkReferenceType, requestReferenceId).all<Record<string, unknown>>();
    const previousRows = previous.results || [];
    if (!previousRows.length) return null;
    const expectedByVariant = new Map(items.map(item => [item.variantId, item]));
    const replayMismatch = previousRows.length !== items.length || previousRows.some(row => {
      const expected = expectedByVariant.get(toInt(row.variant_id, 0));
      return !expected
        || toInt(row.expected_quantity, 0) !== expected.expectedQuantity
        || toInt(row.counted_quantity, 0) !== Math.trunc(Number(expected.countedQuantity));
    });
    if (replayMismatch) throw new Error('Ключ повтора уже использован для другой сверки. Обновите страницу и повторите действие.');
    const results = previousRows.map(row => {
      const previousQuantity = toInt(row.expected_quantity, 0);
      const physical = Math.max(0, toInt(row.counted_quantity, 0));
      const reserved = Math.max(0, toInt(row.reserved_quantity, 0));
      return { variantId: toInt(row.variant_id, 0), previousQuantity, physical, reserved, free: physical - reserved, changed: physical !== previousQuantity };
    });
    return { ok: true, changedCount: results.filter(row => row.changed).length, results };
  };

  const replay = await loadReplay();
  if (replay) return replay;

  const activeSession = await db.prepare(
    `SELECT id FROM inventory_stocktake_sessions WHERE inventory_source = ? AND status = 'active' LIMIT 1`
  ).bind(source).first<{ id: string }>();
  if (activeSession?.id) {
    return { ok: false, code: 'stocktake_active', message: 'Сейчас по этой точке идёт ревизия. Завершите или отмените её перед быстрой сверкой.', sessionId: activeSession.id };
  }

  const variantIds = items.map(item => item.variantId);
  const placeholders = variantIds.map(() => '?').join(',');
  const variantsResult = await db.prepare(
    `SELECT v.id, v.product_id, v.category, v.gender, v.color, v.material, v.length, v.size_label, p.name AS product_name
     FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
     WHERE v.id IN (${placeholders}) AND v.is_active = 1 AND p.is_active = 1`
  ).bind(...variantIds).all<Record<string, unknown>>();
  const variantMap = new Map((variantsResult.results || []).map(row => [toInt(row.id, 0), row]));
  if (variantMap.size !== variantIds.length) throw new Error('Одна из выбранных позиций больше не существует в активном каталоге.');

  const stockResult = await db.prepare(
    `SELECT id, variant_id, quantity, reserved_quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id IN (${placeholders})`
  ).bind(source, ...variantIds).all<Record<string, unknown>>();
  const stockMap = new Map((stockResult.results || []).map(row => [toInt(row.variant_id, 0), row]));
  const reservationResult = await db.prepare(
    `SELECT variant_id, COALESCE(SUM(quantity), 0) AS qty
     FROM inventory_reservations
     WHERE inventory_source = ? AND status = 'active' AND variant_id IN (${placeholders})
     GROUP BY variant_id`
  ).bind(source, ...variantIds).all<Record<string, unknown>>();
  const reservationMap = new Map((reservationResult.results || []).map(row => [toInt(row.variant_id, 0), Math.max(0, toInt(row.qty, 0))]));

  const conflicts = items.flatMap(item => {
    const current = toInt(stockMap.get(item.variantId)?.quantity, 0);
    return current === item.expectedQuantity ? [] : [{ variantId: item.variantId, expectedQuantity: item.expectedQuantity, currentQuantity: current, productName: cleanText(variantMap.get(item.variantId)?.product_name), color: cleanText(variantMap.get(item.variantId)?.color), size: cleanText(variantMap.get(item.variantId)?.size_label) }];
  });
  if (conflicts.length) {
    return { ok: false, code: 'changed', message: `Во время сверки изменилось ${conflicts.length} позиций. Обновите остатки и пересчитайте только их.`, conflicts };
  }

  const now = new Date().toISOString();
  const batchId = requestReferenceId || `quick-stocktake-batch:${source}:${Date.now()}`;
  const expectedValuesSql = items.map(() => '(?, ?, ?)').join(',');
  const expectedBindings = items.flatMap(item => [item.variantId, item.expectedQuantity, Math.trunc(Number(item.countedQuantity))]);

  // Guard is intentionally inside the D1 batch transaction. If any quantity changes
  // between the read above and the write transaction, this INSERT attempts to reuse
  // the existing human_inventory_v2 primary key and aborts/rolls back the entire batch.
  const guard = db.prepare(
    `WITH expected(variant_id, expected_quantity, counted_quantity) AS (VALUES ${expectedValuesSql})
     INSERT INTO inventory_model_meta (key, value)
     SELECT 'human_inventory_v2', '__quick_stocktake_conflict__'
     WHERE EXISTS (
       SELECT 1 FROM expected e
       LEFT JOIN inventory_stock s ON s.inventory_source = ? AND s.variant_id = e.variant_id
       WHERE COALESCE(s.quantity, 0) <> e.expected_quantity
     )`
  ).bind(...expectedBindings, source);

  const updateCases = items.map(() => 'WHEN ? THEN ?').join(' ');
  const updateBindings = items.flatMap(item => [item.variantId, Math.trunc(Number(item.countedQuantity))]);
  const updateExisting = db.prepare(
    `UPDATE inventory_stock
     SET quantity = CASE variant_id ${updateCases} ELSE quantity END,
         last_action = 'Быстрая сверка', last_source_ref = ?, updated_at = ?
     WHERE inventory_source = ? AND variant_id IN (${placeholders})`
  ).bind(...updateBindings, batchId, now, source, ...variantIds);

  const insertMissing = db.prepare(
    `WITH expected(variant_id, expected_quantity, counted_quantity) AS (VALUES ${expectedValuesSql})
     INSERT INTO inventory_stock (
       inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
       material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
       last_action, last_source_ref, updated_at
     )
     SELECT ?, v.product_id, v.id, p.name, v.gender, v.color,
            COALESCE(NULLIF(v.material,''),'СТАНДАРТ'), COALESCE(NULLIF(v.length,''),'СТАНДАРТ'), v.size_label,
            e.counted_quantity,
            COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.inventory_source = ? AND r.variant_id = v.id AND r.status = 'active'), 0),
            'Быстрая сверка', ?, ?
     FROM expected e
     JOIN catalog_variants v ON v.id = e.variant_id
     JOIN catalog_products p ON p.id = v.product_id
     WHERE NOT EXISTS (SELECT 1 FROM inventory_stock s WHERE s.inventory_source = ? AND s.variant_id = v.id)`
  ).bind(...expectedBindings, source, source, batchId, now, source);

  const insertMovements = db.prepare(
    `WITH expected(variant_id, expected_quantity, counted_quantity) AS (VALUES ${expectedValuesSql})
     INSERT INTO inventory_movements (
       inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
       color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
       reference_type, reference_id, comment, created_at
     )
     SELECT ?, 'revision', v.product_id, v.id, p.name, v.gender, v.color,
            COALESCE(NULLIF(v.material,''),'СТАНДАРТ'), COALESCE(NULLIF(v.length,''),'СТАНДАРТ'), v.size_label,
            e.counted_quantity - e.expected_quantity, e.counted_quantity,
            'quick_stocktake', ? || ':' || v.id, 'Быстрая сверка фактического количества', ?
     FROM expected e
     JOIN catalog_variants v ON v.id = e.variant_id
     JOIN catalog_products p ON p.id = v.product_id
     WHERE e.counted_quantity <> e.expected_quantity`
  ).bind(...expectedBindings, source, batchId, now);

  const insertChecks = db.prepare(
    `WITH expected(variant_id, expected_quantity, counted_quantity) AS (VALUES ${expectedValuesSql})
     ${requestReferenceId ? 'INSERT' : 'INSERT OR IGNORE'} INTO inventory_stock_checks (
       check_key, inventory_source, product_id, variant_id, expected_quantity, counted_quantity,
       difference_quantity, reserved_quantity, check_type, reference_type, reference_id, checked_by, checked_at, created_at
     )
     SELECT ? || ':' || v.id, ?, v.product_id, v.id, e.expected_quantity, e.counted_quantity,
            e.counted_quantity - e.expected_quantity,
            COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.inventory_source = ? AND r.variant_id = v.id AND r.status = 'active'), 0),
            ?, ?, ?, ?, ?, ?
     FROM expected e
     JOIN catalog_variants v ON v.id = e.variant_id`
  ).bind(...expectedBindings, batchId, source, source, checkType, checkReferenceType, batchId, cleanText(options.actor) || null, now, now);

  try {
    await db.batch([guard, updateExisting, insertMissing, insertMovements, insertChecks]);
  } catch (error) {
    const replayAfterRace = await loadReplay();
    if (replayAfterRace) return replayAfterRace;
    const currentStock = await db.prepare(
      `SELECT variant_id, quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id IN (${placeholders})`
    ).bind(source, ...variantIds).all<Record<string, unknown>>();
    const currentMap = new Map((currentStock.results || []).map(row => [toInt(row.variant_id, 0), toInt(row.quantity, 0)]));
    const raced = items.flatMap(item => {
      const current = currentMap.get(item.variantId) ?? 0;
      return current === item.expectedQuantity ? [] : [{ variantId: item.variantId, expectedQuantity: item.expectedQuantity, currentQuantity: current }];
    });
    if (raced.length) return { ok: false, code: 'changed', message: `Во время сохранения изменилось ${raced.length} позиций. Ничего из быстрой сверки не применено.`, conflicts: raced };
    throw error;
  }

  const results = items.map(item => {
    const stock = stockMap.get(item.variantId);
    const previousQuantity = toInt(stock?.quantity, 0);
    const physical = Math.trunc(Number(item.countedQuantity));
    const reserved = stock ? Math.max(0, toInt(stock.reserved_quantity, 0)) : (reservationMap.get(item.variantId) || 0);
    return { variantId: item.variantId, previousQuantity, physical, reserved, free: physical - reserved, changed: physical !== previousQuantity };
  });
  return { ok: true, changedCount: results.filter(row => row.changed).length, results };
}


export async function quickInventoryStocktake(
  db: D1Database,
  input: { source?: unknown; variantId?: unknown; expectedQuantity?: unknown; countedQuantity?: unknown; requestId?: unknown },
  options: { actor?: string; checkType?: string; referenceType?: string } = {},
): Promise<InventoryCycleCountApplyResponse> {
  const result = await quickInventoryStocktakeBatch(db, {
    source: input.source,
    items: [{ variantId: input.variantId, expectedQuantity: input.expectedQuantity, countedQuantity: input.countedQuantity }],
    requestId: input.requestId,
  }, options);
  if (!result.ok) return result;
  const row = result.results?.[0];
  return { ok: true, changed: Boolean(row?.changed), previousQuantity: row?.previousQuantity ?? 0, physical: row?.physical ?? 0, reserved: row?.reserved ?? 0, free: row?.free ?? 0 };
}


export async function markInventoryStocktakeConflicts(db: D1Database, sessionId: string) {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE inventory_stocktake_items
       SET status = 'recount_required',
           counted_quantity = NULL,
           counted_at = NULL,
           conflict_quantity = COALESCE((
             SELECT s.quantity
             FROM inventory_stock s
             WHERE s.inventory_source = inventory_stocktake_items.inventory_source
               AND (
                 (inventory_stocktake_items.stock_id IS NOT NULL AND s.id = inventory_stocktake_items.stock_id)
                 OR (inventory_stocktake_items.stock_id IS NULL AND inventory_stocktake_items.variant_id IS NOT NULL AND s.variant_id = inventory_stocktake_items.variant_id)
               )
             LIMIT 1
           ), 0),
           baseline_quantity = COALESCE((
             SELECT s.quantity
             FROM inventory_stock s
             WHERE s.inventory_source = inventory_stocktake_items.inventory_source
               AND (
                 (inventory_stocktake_items.stock_id IS NOT NULL AND s.id = inventory_stocktake_items.stock_id)
                 OR (inventory_stocktake_items.stock_id IS NULL AND inventory_stocktake_items.variant_id IS NOT NULL AND s.variant_id = inventory_stocktake_items.variant_id)
               )
             LIMIT 1
           ), 0),
           updated_at = ?
       WHERE session_id = ?
         AND COALESCE((
           SELECT s.quantity
           FROM inventory_stock s
           WHERE s.inventory_source = inventory_stocktake_items.inventory_source
             AND (
               (inventory_stocktake_items.stock_id IS NOT NULL AND s.id = inventory_stocktake_items.stock_id)
               OR (inventory_stocktake_items.stock_id IS NULL AND inventory_stocktake_items.variant_id IS NOT NULL AND s.variant_id = inventory_stocktake_items.variant_id)
             )
           LIMIT 1
         ), 0) <> baseline_quantity`
    ).bind(now, sessionId),
    db.prepare(`UPDATE inventory_stocktake_sessions SET updated_at = ? WHERE id = ? AND status = 'active'`).bind(now, sessionId),
  ]);
  const refreshed = await serializeInventoryStocktakeSession(db, sessionId);
  const conflictItemIds = refreshed.items.filter((item: any) => item.status === 'recount_required').map((item: any) => item.id);
  return { refreshed, conflictItemIds };
}


export async function completeInventoryStocktakeSession(db: D1Database, sessionId: string) {
  const session = await db.prepare(
    `SELECT id, inventory_source, status FROM inventory_stocktake_sessions WHERE id = ? LIMIT 1`
  ).bind(sessionId).first<InventoryStocktakeSessionRow>();
  if (!session?.id) throw new Error('Ревизия не найдена.');
  const sessionStatus = cleanText(session.status);
  if (sessionStatus === 'completed') {
    const completed = await serializeInventoryStocktakeSession(db, sessionId);
    const changed = completed.items.filter((item: any) => item.appliedQuantity !== null && Number(item.appliedQuantity) !== Number(item.baselineQuantity)).length;
    const shortages = completed.items
      .filter((item: any) => item.appliedQuantity !== null && Number(item.appliedQuantity) - Number(item.reservedQuantity || 0) < 0)
      .map((item: any) => ({
        itemId: item.id,
        productId: item.productId,
        variantId: item.variantId,
        productName: item.productName,
        color: item.color,
        size: item.size,
        reservedQuantity: item.reservedQuantity,
        physicalQuantity: item.appliedQuantity,
        shortageQuantity: Math.abs(Number(item.appliedQuantity) - Number(item.reservedQuantity || 0)),
      }));
    return {
      ok: true,
      changed,
      message: shortages.length
        ? `Ревизия уже завершена. Исправлено ${changed} позиций. По ${shortages.length} позициям товара не хватает для текущих заказов.`
        : `Ревизия уже завершена. Исправлено ${changed} позиций.`,
      shortages,
      session: completed,
    };
  }
  if (sessionStatus !== 'active') throw new Error('Эта ревизия уже завершена или отменена.');
  const source = normalizeSourceType(session.inventory_source);
  const rows = await getInventoryStocktakeItemRows(db, sessionId);
  const unfilled = rows.filter(row => row.counted_quantity === null || row.counted_quantity === undefined);
  if (unfilled.length) {
    return { ok: false, code: 'unfilled', message: `Не заполнено ${unfilled.length} позиций.`, session: await serializeInventoryStocktakeSession(db, sessionId) };
  }

  const conflicts = rows.filter(row => toInt(row.current_quantity, 0) !== toInt(row.baseline_quantity, 0));
  if (conflicts.length) {
    const { refreshed, conflictItemIds } = await markInventoryStocktakeConflicts(db, sessionId);
    return {
      ok: false,
      code: 'recount_required',
      message: `Во время пересчёта изменилось ${conflictItemIds.length} позиций. Пересчитайте только их — остальные данные сохранены.`,
      conflictItemIds,
      session: refreshed,
    };
  }

  const now = new Date().toISOString();
  const changed = rows.filter(row => Math.max(0, toInt(row.counted_quantity, 0)) !== toInt(row.current_quantity, 0)).length;
  const sourceLabel = source === 'warehouse' ? 'склада' : 'бутика';
  const reference = `stocktake:${sessionId}`;

  // The first statement acquires an in-transaction completion lock only when every
  // counted row still matches its accepted baseline. D1 batches execute as one SQL
  // transaction, so concurrent stock writes cannot interleave after this check.
  // Later statements depend on this lock instead of re-checking quantities after our
  // own stock updates. The batch stays constant-size regardless of revision length.
  const consistencyGuard = `NOT EXISTS (
    SELECT 1
    FROM inventory_stocktake_items guard_i
    LEFT JOIN inventory_stock guard_s
      ON guard_s.inventory_source = guard_i.inventory_source
     AND (
       (guard_i.stock_id IS NOT NULL AND guard_s.id = guard_i.stock_id)
       OR (guard_i.stock_id IS NULL AND guard_i.variant_id IS NOT NULL AND guard_s.variant_id = guard_i.variant_id)
     )
    WHERE guard_i.session_id = ?
      AND (
        guard_i.counted_quantity IS NULL
        OR COALESCE(guard_s.quantity, 0) <> guard_i.baseline_quantity
      )
  )`;
  const completionLock = `lock:${sessionId}:${now}`;
  const hasCompletionLock = `EXISTS (
    SELECT 1 FROM inventory_stocktake_sessions lock_s
    WHERE lock_s.id = ? AND lock_s.status = 'active' AND lock_s.completed_at = ?
  )`;

  await db.batch([
    db.prepare(
      `UPDATE inventory_stocktake_sessions
       SET completed_at = ?
       WHERE id = ? AND status = 'active' AND completed_at IS NULL
         AND ${consistencyGuard}`
    ).bind(completionLock, sessionId, sessionId),
    db.prepare(
      `INSERT INTO inventory_stock (
         inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
         material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
         last_action, last_source_ref, created_at, updated_at
       )
       SELECT
         i.inventory_source, i.product_id, i.variant_id, i.product_name_snapshot, i.gender_snapshot, i.color_snapshot,
         i.material_snapshot, i.length_snapshot, i.size_snapshot, i.counted_quantity, 0,
         'Ревизия', ?, ?, ?
       FROM inventory_stocktake_items i
       WHERE i.session_id = ?
         AND i.counted_quantity IS NOT NULL
         AND i.counted_quantity <> i.baseline_quantity
         AND i.variant_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM inventory_stock s
           WHERE s.inventory_source = i.inventory_source AND s.variant_id = i.variant_id
         )
         AND ${hasCompletionLock}`
    ).bind(reference, now, now, sessionId, sessionId, completionLock),
    db.prepare(
      `UPDATE inventory_stock
       SET quantity = (
             SELECT i.counted_quantity
             FROM inventory_stocktake_items i
             WHERE i.session_id = ?
               AND i.counted_quantity IS NOT NULL
               AND (
                 (i.stock_id IS NOT NULL AND i.stock_id = inventory_stock.id)
                 OR (i.stock_id IS NULL AND i.variant_id IS NOT NULL AND i.variant_id = inventory_stock.variant_id AND i.inventory_source = inventory_stock.inventory_source)
               )
             LIMIT 1
           ),
           last_action = 'Ревизия',
           last_source_ref = ?,
           updated_at = ?
       WHERE inventory_source = ?
         AND EXISTS (
           SELECT 1
           FROM inventory_stocktake_items i
           WHERE i.session_id = ?
             AND i.counted_quantity IS NOT NULL
             AND i.counted_quantity <> i.baseline_quantity
             AND (
               (i.stock_id IS NOT NULL AND i.stock_id = inventory_stock.id)
               OR (i.stock_id IS NULL AND i.variant_id IS NOT NULL AND i.variant_id = inventory_stock.variant_id AND i.inventory_source = inventory_stock.inventory_source)
             )
         )
         AND ${hasCompletionLock}`
    ).bind(sessionId, reference, now, source, sessionId, sessionId, completionLock),
    db.prepare(
      `INSERT INTO inventory_movements (
         inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
         color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
         reference_type, reference_id, comment, created_at
       )
       SELECT
         i.inventory_source, 'manual_set', i.product_id, i.variant_id, i.product_name_snapshot, i.gender_snapshot,
         i.color_snapshot, i.material_snapshot, i.length_snapshot, i.size_snapshot,
         i.counted_quantity - i.baseline_quantity, i.counted_quantity,
         'stocktake', ?, ?, ?
       FROM inventory_stocktake_items i
       WHERE i.session_id = ?
         AND i.counted_quantity IS NOT NULL
         AND i.counted_quantity <> i.baseline_quantity
         AND ${hasCompletionLock}`
    ).bind(sessionId, `Ревизия ${sourceLabel} ${sessionId}`, now, sessionId, sessionId, completionLock),
    db.prepare(
      `UPDATE inventory_stocktake_items
       SET stock_id = COALESCE(stock_id, (
             SELECT s.id
             FROM inventory_stock s
             WHERE s.inventory_source = inventory_stocktake_items.inventory_source
               AND inventory_stocktake_items.variant_id IS NOT NULL
               AND s.variant_id = inventory_stocktake_items.variant_id
             LIMIT 1
           )),
           updated_at = ?
       WHERE session_id = ?
         AND ${hasCompletionLock}`
    ).bind(now, sessionId, sessionId, completionLock),
    db.prepare(
      `INSERT OR IGNORE INTO inventory_stock_checks (
         check_key, inventory_source, product_id, variant_id, expected_quantity, counted_quantity,
         difference_quantity, reserved_quantity, check_type, reference_type, reference_id, checked_by, checked_at, created_at
       )
       SELECT
         'stocktake:' || i.session_id || ':' || i.variant_id, i.inventory_source, i.product_id, i.variant_id,
         i.baseline_quantity, i.counted_quantity, i.counted_quantity - i.baseline_quantity, COALESCE(i.opening_reserved_quantity, 0),
         CASE WHEN i.session_id LIKE 'REV-%-P-%' THEN 'selective_stocktake' ELSE 'full_stocktake' END,
         'stocktake', i.session_id,
         (SELECT created_by FROM inventory_stocktake_sessions WHERE id = i.session_id),
         COALESCE(i.counted_at, ?), COALESCE(i.counted_at, ?)
       FROM inventory_stocktake_items i
       WHERE i.session_id = ? AND i.variant_id IS NOT NULL AND i.counted_quantity IS NOT NULL
         AND ${hasCompletionLock}`
    ).bind(now, now, sessionId, sessionId, completionLock),
    db.prepare(
      `UPDATE inventory_stocktake_items
       SET status = 'applied', applied_quantity = counted_quantity, conflict_quantity = NULL, updated_at = ?
       WHERE session_id = ?
         AND ${hasCompletionLock}`
    ).bind(now, sessionId, sessionId, completionLock),
    db.prepare(
      `UPDATE inventory_stocktake_sessions
       SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'active' AND completed_at = ?`
    ).bind(now, now, sessionId, completionLock),
  ]);

  const completionState = await db.prepare(
    `SELECT status FROM inventory_stocktake_sessions WHERE id = ? LIMIT 1`
  ).bind(sessionId).first<InventoryStocktakeSessionRow>();
  if (cleanText(completionState?.status) !== 'completed') {
    const { refreshed, conflictItemIds } = await markInventoryStocktakeConflicts(db, sessionId);
    if (conflictItemIds.length) {
      return {
        ok: false,
        code: 'recount_required',
        message: `Во время завершения изменилось ${conflictItemIds.length} позиций. Пересчитайте только их — ничего из ревизии не было применено частично.`,
        conflictItemIds,
        session: refreshed,
      };
    }
    return {
      ok: false,
      code: 'retry_completion',
      message: 'Ревизия не была применена. Данные сохранены — попробуйте завершить её ещё раз.',
      session: refreshed,
    };
  }

  const completed = await serializeInventoryStocktakeSession(db, sessionId);
  const shortages = completed.items
    .filter((item: any) => item.appliedQuantity !== null && Number(item.appliedQuantity) - Number(item.reservedQuantity || 0) < 0)
    .map((item: any) => ({
      itemId: item.id,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      color: item.color,
      size: item.size,
      reservedQuantity: item.reservedQuantity,
      physicalQuantity: item.appliedQuantity,
      shortageQuantity: Math.abs(Number(item.appliedQuantity) - Number(item.reservedQuantity || 0)),
    }));
  return {
    ok: true,
    changed,
    message: shortages.length
      ? `Ревизия завершена. Исправлено ${changed} позиций. По ${shortages.length} позициям товара не хватает для текущих заказов.`
      : `Ревизия завершена. Исправлено ${changed} позиций.`,
    shortages,
    session: completed,
  };
}


export async function cancelInventoryStocktakeSession(db: D1Database, sessionId: string) {
  const session = await db.prepare(
    `SELECT id, status FROM inventory_stocktake_sessions WHERE id = ? LIMIT 1`
  ).bind(sessionId).first<InventoryStocktakeSessionRow>();
  if (!session?.id) throw new Error('Ревизия не найдена.');
  if (cleanText(session.status) !== 'active') return { ok: true, session: await serializeInventoryStocktakeSession(db, sessionId) };
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE inventory_stocktake_sessions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`
  ).bind(now, now, sessionId).run();
  return { ok: true, session: await serializeInventoryStocktakeSession(db, sessionId) };
}




export async function listInventoryHistory(db: D1Database, url: URL) {
  const sourceRaw = cleanText(url.searchParams.get('source'));
  const source = sourceRaw ? normalizeSourceType(sourceRaw) : '';
  const variantId = Math.max(0, toInt(url.searchParams.get('variantId'), 0));
  const beforeId = Math.max(0, toInt(url.searchParams.get('beforeId'), 0));
  const limit = Math.min(100, Math.max(20, toInt(url.searchParams.get('limit'), 50)));
  const query = upperText(url.searchParams.get('q'));
  const where: string[] = [];
  const bindings: Array<string | number> = [];
  if (source) { where.push('m.inventory_source = ?'); bindings.push(source); }
  if (variantId) { where.push('m.variant_id = ?'); bindings.push(variantId); }
  if (beforeId) { where.push('m.id < ?'); bindings.push(beforeId); }
  if (query) {
    where.push(`INSTR(UPPER(
      COALESCE(m.product_name_snapshot, '') || ' ' || COALESCE(m.gender_snapshot, '') || ' ' ||
      COALESCE(m.color_snapshot, '') || ' ' || COALESCE(m.material_snapshot, '') || ' ' ||
      COALESCE(m.length_snapshot, '') || ' ' || COALESCE(m.size_snapshot, '') || ' ' ||
      COALESCE(m.comment, '') || ' ' || COALESCE(m.reference_id, '')
    ), ?) > 0`);
    bindings.push(query);
  }
  const result = await db.prepare(
    `SELECT
       m.id, m.inventory_source, m.movement_type, m.product_id, m.variant_id,
       m.product_name_snapshot, m.gender_snapshot, m.color_snapshot, m.material_snapshot,
       m.length_snapshot, m.size_snapshot, m.quantity_delta, m.quantity_after,
       m.reference_type, m.reference_id, m.comment, m.created_at,
       r.reversed_at, r.reversal_movement_id,
       CASE WHEN rr.original_movement_id IS NOT NULL THEN 1 ELSE 0 END AS is_reversal,
       td.from_source AS transfer_from_source, td.to_source AS transfer_to_source,
       td.status AS transfer_status, td.comment AS transfer_comment,
       (SELECT COUNT(*) FROM inventory_transfer_items ti WHERE ti.transfer_id = td.id) AS transfer_item_count,
       (SELECT COALESCE(SUM(ti.quantity), 0) FROM inventory_transfer_items ti WHERE ti.transfer_id = td.id) AS transfer_total_quantity
     FROM inventory_movements m
     LEFT JOIN inventory_movement_reversals r ON r.original_movement_id = m.id
     LEFT JOIN inventory_movement_reversals rr ON rr.reversal_movement_id = m.id
     LEFT JOIN inventory_transfer_documents td
       ON td.external_id = m.reference_id AND m.reference_type IN ('transfer_in', 'transfer_out')
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY m.id DESC
     LIMIT ?`
  ).bind(...bindings, limit + 1).all<Record<string, unknown>>();
  const raw = result.results || [];
  const page = raw.slice(0, limit);
  return {
    ok: true,
    hasMore: raw.length > limit,
    nextBeforeId: page.length ? toInt(page[page.length - 1].id, 0) : null,
    movements: page.map(row => ({
      id: toInt(row.id, 0),
      inventorySource: cleanText(row.inventory_source),
      movementType: cleanText(row.movement_type),
      productId: toInt(row.product_id, 0),
      variantId: toInt(row.variant_id, 0),
      productName: cleanText(row.product_name_snapshot),
      gender: cleanText(row.gender_snapshot),
      color: cleanText(row.color_snapshot),
      material: canonicalStockPositionValue(row.material_snapshot),
      length: canonicalStockPositionValue(row.length_snapshot),
      size: cleanText(row.size_snapshot),
      quantityDelta: toInt(row.quantity_delta, 0),
      quantityAfter: toInt(row.quantity_after, 0),
      referenceType: cleanText(row.reference_type),
      referenceId: cleanText(row.reference_id),
      comment: cleanText(row.comment),
      createdAt: cleanText(row.created_at),
      reversedAt: cleanText(row.reversed_at),
      reversalMovementId: toInt(row.reversal_movement_id, 0),
      isReversal: toInt(row.is_reversal, 0) === 1,
      canReverse: !cleanText(row.reversed_at)
        && toInt(row.is_reversal, 0) !== 1
        && toInt(row.quantity_delta, 0) !== 0
        && isReversibleInventoryMovementReference(row.reference_type),
      transferFromSource: cleanText(row.transfer_from_source) || null,
      transferToSource: cleanText(row.transfer_to_source) || null,
      transferStatus: cleanText(row.transfer_status) || null,
      transferComment: cleanText(row.transfer_comment) || null,
      transferItemCount: Math.max(0, toInt(row.transfer_item_count, 0)),
      transferTotalQuantity: Math.max(0, toInt(row.transfer_total_quantity, 0)),
    })),
  };
}


export async function listInventoryCheckHistory(db: D1Database, url: URL) {
  const sourceRaw = cleanText(url.searchParams.get('source'));
  const source = sourceRaw ? normalizeSourceType(sourceRaw) : '';
  const variantId = Math.max(0, toInt(url.searchParams.get('variantId'), 0));
  const limit = Math.min(50, Math.max(10, toInt(url.searchParams.get('limit'), 30)));

  // When the user opened history from one exact SKU, show that SKU's real physical checks.
  // Do not replace an exact check with a whole-stocktake summary — the narrow context must stay narrow.
  if (variantId > 0) {
    const exactSourceClause = source ? 'AND c.inventory_source = ?' : '';
    const exactBindings: Array<string | number> = source ? [variantId, source] : [variantId];
    const exact = await db.prepare(
      `SELECT c.id, c.inventory_source, c.check_type, c.reference_type, c.reference_id,
              c.expected_quantity, c.counted_quantity, c.difference_quantity, c.checked_by, c.checked_at
       FROM inventory_stock_checks c
       WHERE c.variant_id = ? ${exactSourceClause}
       ORDER BY c.checked_at DESC, c.id DESC
       LIMIT ?`
    ).bind(...exactBindings, limit).all<Record<string, unknown>>();
    return {
      ok: true,
      rows: (exact.results || []).map(row => ({
        kind: 'check', id: String(toInt(row.id, 0)), source: normalizeSourceType(row.inventory_source),
        scope: null, checkedAt: cleanText(row.checked_at), checkedBy: cleanText(row.checked_by) || null,
        itemCount: 1, differenceCount: toInt(row.difference_quantity, 0) !== 0 ? 1 : 0,
        netDelta: toInt(row.difference_quantity, 0), referenceType: cleanText(row.reference_type),
        referenceId: cleanText(row.reference_id), checkType: cleanText(row.check_type),
        expectedQuantity: toInt(row.expected_quantity, 0), countedQuantity: toInt(row.counted_quantity, 0),
      })),
    };
  }

  const sourceClause = source ? 'AND s.inventory_source = ?' : '';
  const sourceBindings: Array<string> = source ? [source] : [];
  const sessions = await db.prepare(
    `SELECT s.id, s.inventory_source, s.created_by, s.started_at, s.completed_at,
            COUNT(i.id) AS item_count,
            SUM(CASE WHEN i.counted_quantity IS NOT NULL AND i.counted_quantity <> i.baseline_quantity THEN 1 ELSE 0 END) AS difference_count,
            COALESCE(SUM(CASE WHEN i.counted_quantity IS NOT NULL THEN i.counted_quantity - i.baseline_quantity ELSE 0 END), 0) AS net_delta
     FROM inventory_stocktake_sessions s
     LEFT JOIN inventory_stocktake_items i ON i.session_id = s.id
     WHERE s.status = 'completed' ${sourceClause}
     GROUP BY s.id, s.inventory_source, s.created_by, s.started_at, s.completed_at
     ORDER BY s.completed_at DESC, s.id DESC
     LIMIT ?`
  ).bind(...sourceBindings, limit).all<Record<string, unknown>>();

  const checkSourceClause = source ? 'AND c.inventory_source = ?' : '';
  const checks = await db.prepare(
    `SELECT MIN(c.id) AS id, c.inventory_source, c.check_type, c.reference_type, c.reference_id,
            MAX(c.checked_at) AS checked_at, MAX(COALESCE(c.checked_by, '')) AS checked_by,
            COUNT(*) AS item_count,
            SUM(CASE WHEN c.difference_quantity <> 0 THEN 1 ELSE 0 END) AS difference_count,
            COALESCE(SUM(c.difference_quantity), 0) AS net_delta
     FROM inventory_stock_checks c
     WHERE COALESCE(c.reference_type, '') <> 'stocktake' ${checkSourceClause}
     GROUP BY c.inventory_source, c.check_type, c.reference_type, c.reference_id
     ORDER BY checked_at DESC, id DESC
     LIMIT ?`
  ).bind(...sourceBindings, limit).all<Record<string, unknown>>();

  const rows = [
    ...(sessions.results || []).map(row => ({
      kind: 'stocktake', id: cleanText(row.id), source: normalizeSourceType(row.inventory_source),
      scope: inventoryStocktakeScopeFromId(row.id), checkedAt: cleanText(row.completed_at) || cleanText(row.started_at),
      checkedBy: cleanText(row.created_by) || null, itemCount: Math.max(0, toInt(row.item_count, 0)),
      differenceCount: Math.max(0, toInt(row.difference_count, 0)), netDelta: toInt(row.net_delta, 0),
      referenceType: 'stocktake', referenceId: cleanText(row.id), checkType: inventoryStocktakeScopeFromId(row.id) === 'selective' ? 'selective_stocktake' : 'full_stocktake',
    })),
    ...(checks.results || []).map(row => ({
      kind: 'check', id: String(toInt(row.id, 0)), source: normalizeSourceType(row.inventory_source), scope: null,
      checkedAt: cleanText(row.checked_at), checkedBy: cleanText(row.checked_by) || null,
      itemCount: Math.max(0, toInt(row.item_count, 0)), differenceCount: Math.max(0, toInt(row.difference_count, 0)),
      netDelta: toInt(row.net_delta, 0), referenceType: cleanText(row.reference_type), referenceId: cleanText(row.reference_id), checkType: cleanText(row.check_type),
    })),
  ].sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt))).slice(0, limit);
  return { ok: true, rows };
}
