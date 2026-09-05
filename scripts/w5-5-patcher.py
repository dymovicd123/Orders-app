from pathlib import Path
import re


def one(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)

# API contracts
p = Path('shared/api-contracts.ts')
s = p.read_text(encoding='utf-8')
s = one(s,
"export type WarehouseAttentionStocktakeItem = {\n",
"export type WarehouseAttentionFoundItem = {\n  stockId: number\n  source: InventorySource\n  productId: number\n  productName: string\n  category: AudienceCategory\n  gender: string\n  color: string\n  material: string\n  length: string\n  size: string\n  physical: number\n  createdAt: string\n  updatedAt: string\n  exactVariantId?: number | null\n  exactKnown?: boolean\n}\n\nexport type WarehouseAttentionStocktakeItem = {\n",
'found attention type')
s = one(s,
"    handover: number\n    stocktake: number\n",
"    handover: number\n    stocktake: number\n    found?: number\n",
'found count contract')
s = one(s,
"    handover: WarehouseAttentionHandoverItem[]\n    stocktakes: WarehouseAttentionStocktakeItem[]\n",
"    handover: WarehouseAttentionHandoverItem[]\n    stocktakes: WarehouseAttentionStocktakeItem[]\n    found?: WarehouseAttentionFoundItem[]\n",
'found items contract')
s = one(s,
"  alreadyPresentCount?: number\n  item?: InventoryStocktakeCountItem\n",
"  alreadyPresentCount?: number\n  deferredUnknownCount?: number\n  unresolvedFoundCount?: number\n  item?: InventoryStocktakeCountItem\n",
'stocktake response found counts')
p.write_text(s, encoding='utf-8')

# Worker stocktake domain
p = Path('worker/domains/inventory-stocktake.ts')
s = p.read_text(encoding='utf-8')
s = one(s,
"    createReferenceFields?: unknown;\n  },\n) {\n",
"    createReferenceFields?: unknown;\n    deferUnknown?: unknown;\n  },\n) {\n",
'combination defer input')
s = one(s,
"  const createFields = new Set(Array.isArray(input.createReferenceFields) ? (input.createReferenceFields as unknown[]).map(cleanText) : []);\n",
"  const createFields = new Set(Array.isArray(input.createReferenceFields) ? (input.createReferenceFields as unknown[]).map(cleanText) : []);\n  const deferUnknown = input.deferUnknown === true || cleanText(input.deferUnknown).toLowerCase() === 'true';\n",
'defer unknown flag')
old = """    const missing = (referenceState.results || []).filter(row => toInt(row.exists_flag, 0) === 0);
    for (const row of missing) {
      const field = cleanText(row.field);
      const value = cleanText(row.value);
      if (!createFields.has(field)) {
        throw new Error(`Значение «${value}» ещё не существует. Выберите существующее или явно добавьте его как новое.`);
      }
    }
    if (missing.length) {
"""
new = """    const missing = (referenceState.results || []).filter(row => toInt(row.exists_flag, 0) === 0);
    if (missing.length && deferUnknown) {
      const source = normalizeSourceType(session.inventory_source);
      const unresolvedRef = `stocktake-unresolved:${category}:${sessionId}`;
      let addedCount = 0;
      let alreadyPresentCount = 0;
      for (const size of normalizedSizes) {
        const findUnresolved = async () => await db.prepare(
          `SELECT id, quantity, reserved_quantity FROM inventory_stock
           WHERE inventory_source = ? AND variant_id IS NULL AND product_id = ?
             AND COALESCE(gender_snapshot, '') = COALESCE(?, '')
             AND COALESCE(color_snapshot, '') = COALESCE(?, '')
             AND UPPER(TRIM(COALESCE(NULLIF(material_snapshot, ''), 'СТАНДАРТ'))) = UPPER(TRIM(?))
             AND UPPER(TRIM(COALESCE(NULLIF(length_snapshot, ''), 'СТАНДАРТ'))) = UPPER(TRIM(?))
             AND COALESCE(size_snapshot, '') = COALESCE(?, '')
             AND last_source_ref LIKE ?
           ORDER BY id ASC LIMIT 1`
        ).bind(source, productId, gender || null, color || null, material, length, size || null, `stocktake-unresolved:${category}:%`).first<Record<string, unknown>>();
        let stock = await findUnresolved();
        if (!stock?.id) {
          await db.prepare(
            `INSERT INTO inventory_stock (
               inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
               material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
               last_action, last_source_ref, created_at, updated_at
             ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, 0, 'Найдено при проверке', ?, ?, ?)`
          ).bind(source, productId, product.name, gender || null, color || null, material, length, size || null, unresolvedRef, timestamp, timestamp).run();
          stock = await findUnresolved();
        }
        const stockId = toInt(stock?.id, 0);
        if (!stockId) throw new Error('Не удалось сохранить найденную позицию для уточнения.');
        const existingItem = await db.prepare(
          `SELECT id FROM inventory_stocktake_items WHERE session_id = ? AND stock_id = ? LIMIT 1`
        ).bind(sessionId, stockId).first<{ id: number }>();
        if (existingItem?.id) {
          alreadyPresentCount += 1;
          continue;
        }
        const opening = toInt(stock?.quantity, 0);
        const openingReserved = Math.max(0, toInt(stock?.reserved_quantity, 0));
        await db.prepare(
          `INSERT INTO inventory_stocktake_items (
             session_id, inventory_source, stock_id, product_id, variant_id,
             product_name_snapshot, category_snapshot, gender_snapshot, color_snapshot,
             material_snapshot, length_snapshot, size_snapshot,
             opening_quantity, opening_reserved_quantity, baseline_quantity,
             status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        ).bind(
          sessionId, source, stockId, productId, product.name, category, gender || null, color || null,
          material, length, size || null, opening, openingReserved, opening, timestamp, timestamp,
        ).run();
        addedCount += 1;
      }
      return {
        ok: true,
        deferredUnknownCount: addedCount,
        addedCount,
        alreadyPresentCount,
        session: await serializeInventoryStocktakeSession(db, sessionId),
      };
    }
    for (const row of missing) {
      const field = cleanText(row.field);
      const value = cleanText(row.value);
      if (!createFields.has(field)) {
        throw new Error(`Значение «${value}» ещё не существует. Выберите существующее или явно добавьте его как новое.`);
      }
    }
    if (missing.length) {
"""
s = one(s, old, new, 'deferred unknown branch')

# Add exact reconciliation function before completion-conflict helper
anchor = "\n\nexport async function markInventoryStocktakeConflicts(db: D1Database, sessionId: string) {\n"
if s.count(anchor) != 1:
    raise SystemExit('reconcile insertion anchor mismatch')
reconcile = r'''

export async function reconcileFoundInventoryStock(db: D1Database, stockId: number) {
  const row = await db.prepare(
    `SELECT s.id, s.inventory_source, s.product_id, s.variant_id, s.product_name_snapshot,
            s.gender_snapshot, s.color_snapshot, s.material_snapshot, s.length_snapshot, s.size_snapshot,
            s.quantity, s.reserved_quantity, s.last_source_ref, s.updated_at,
            COALESCE((SELECT i.category_snapshot FROM inventory_stocktake_items i WHERE i.stock_id = s.id ORDER BY i.id DESC LIMIT 1), 'adult') AS category_snapshot
     FROM inventory_stock s WHERE s.id = ? LIMIT 1`
  ).bind(stockId).first<Record<string, unknown>>();
  if (!row?.id) throw new Error('Найденная позиция больше не существует.');
  if (toInt(row.variant_id, 0) > 0) {
    return { ok: true, already: true, stockId, variantId: toInt(row.variant_id, 0), quantity: Math.max(0, toInt(row.quantity, 0)), message: 'Эта найденная позиция уже связана с вариантом.' };
  }
  const quantity = Math.max(0, toInt(row.quantity, 0));
  if (quantity <= 0 || !cleanText(row.last_source_ref).startsWith('stocktake-unresolved:')) {
    return { ok: true, already: true, stockId, variantId: null, quantity, message: 'Эта найденная позиция уже не требует уточнения.' };
  }
  const source = normalizeSourceType(row.inventory_source);
  const category = normalizeAudienceCategory(row.category_snapshot, row.size_snapshot);
  const productId = Math.max(0, toInt(row.product_id, 0));
  const variant = await db.prepare(
    `SELECT v.id, v.product_id, v.category, v.gender, v.color, v.material, v.length, v.size_label, p.name AS product_name
     FROM catalog_variants v
     JOIN catalog_products p ON p.id = v.product_id
     WHERE v.is_active = 1 AND p.is_active = 1 AND v.product_id = ?
       AND COALESCE(v.category, 'adult') = ?
       AND UPPER(TRIM(COALESCE(v.gender, ''))) = UPPER(TRIM(COALESCE(?, '')))
       AND UPPER(TRIM(COALESCE(v.color, ''))) = UPPER(TRIM(COALESCE(?, '')))
       AND UPPER(TRIM(COALESCE(NULLIF(v.material, ''), 'СТАНДАРТ'))) = UPPER(TRIM(?))
       AND UPPER(TRIM(COALESCE(NULLIF(v.length, ''), 'СТАНДАРТ'))) = UPPER(TRIM(?))
       AND UPPER(TRIM(COALESCE(v.size_label, ''))) = UPPER(TRIM(COALESCE(?, '')))
     ORDER BY v.id ASC LIMIT 1`
  ).bind(
    productId, category, cleanText(row.gender_snapshot), cleanText(row.color_snapshot),
    canonicalStockPositionValue(row.material_snapshot), canonicalStockPositionValue(row.length_snapshot), cleanText(row.size_snapshot),
  ).first<Record<string, unknown>>();
  const variantId = toInt(variant?.id, 0);
  if (!variantId) {
    return { ok: false, code: 'identity_unresolved', stockId, quantity, message: 'Точного варианта пока нет. Создайте или исправьте его в «Товары», затем вернитесь к этому уточнению.' };
  }
  const target = await db.prepare(
    `SELECT id, quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? ORDER BY id ASC LIMIT 1`
  ).bind(source, variantId).first<Record<string, unknown>>();
  const now = new Date().toISOString();
  const resolutionRef = `found-stock:${stockId}:${variantId}`;
  if (!target?.id) {
    await db.prepare(
      `UPDATE inventory_stock
       SET product_id = ?, variant_id = ?, product_name_snapshot = ?, gender_snapshot = ?, color_snapshot = ?,
           material_snapshot = ?, length_snapshot = ?, size_snapshot = ?,
           last_action = 'Определён найденный товар', last_source_ref = ?, updated_at = ?
       WHERE id = ? AND variant_id IS NULL AND quantity = ? AND last_source_ref LIKE 'stocktake-unresolved:%'`
    ).bind(
      toInt(variant?.product_id, productId), variantId, cleanText(variant?.product_name) || cleanText(row.product_name_snapshot),
      cleanText(variant?.gender) || null, cleanText(variant?.color) || null,
      canonicalStockPositionValue(variant?.material), canonicalStockPositionValue(variant?.length), cleanText(variant?.size_label) || null,
      `stocktake-resolved:${resolutionRef}`, now, stockId, quantity,
    ).run();
    return { ok: true, already: false, merged: false, stockId, variantId, quantity, message: 'Найденная вещь связана с вариантом и теперь отображается в обычных остатках.' };
  }

  const targetId = toInt(target.id, 0);
  const productName = cleanText(variant?.product_name) || cleanText(row.product_name_snapshot);
  await db.batch([
    db.prepare(
      `UPDATE inventory_stock
       SET quantity = quantity + ?, last_action = 'Определён найденный товар', last_source_ref = ?, updated_at = ?
       WHERE id = ?
         AND EXISTS (SELECT 1 FROM inventory_stock u WHERE u.id = ? AND u.variant_id IS NULL AND u.quantity = ? AND u.last_source_ref LIKE 'stocktake-unresolved:%')`
    ).bind(quantity, resolutionRef, now, targetId, stockId, quantity),
    db.prepare(
      `INSERT INTO inventory_movements (
         inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
         color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
         reference_type, reference_id, comment, created_at
       )
       SELECT ?, 'manual_set', ?, ?, ?, ?, ?, ?, ?, ?, ?,
              (SELECT quantity FROM inventory_stock WHERE id = ?),
              'identity_resolution', ?, 'Найденная при проверке вещь связана с существующим вариантом', ?
       WHERE EXISTS (SELECT 1 FROM inventory_stock u WHERE u.id = ? AND u.variant_id IS NULL AND u.quantity = ? AND u.last_source_ref LIKE 'stocktake-unresolved:%')`
    ).bind(
      source, toInt(variant?.product_id, productId), variantId, productName, cleanText(variant?.gender) || null,
      cleanText(variant?.color) || null, canonicalStockPositionValue(variant?.material), canonicalStockPositionValue(variant?.length), cleanText(variant?.size_label) || null,
      quantity, targetId, resolutionRef, now, stockId, quantity,
    ),
    db.prepare(
      `INSERT INTO inventory_movements (
         inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
         color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
         reference_type, reference_id, comment, created_at
       )
       SELECT inventory_source, 'manual_set', product_id, NULL, product_name_snapshot, gender_snapshot,
              color_snapshot, material_snapshot, length_snapshot, size_snapshot, ?, 0,
              'identity_resolution', ?, 'Найденная вещь перенесена в определённый вариант без изменения общего физического количества', ?
       FROM inventory_stock
       WHERE id = ? AND variant_id IS NULL AND quantity = ? AND last_source_ref LIKE 'stocktake-unresolved:%'`
    ).bind(-quantity, resolutionRef, now, stockId, quantity),
    db.prepare(
      `UPDATE inventory_stock
       SET quantity = 0, last_action = 'Найденный товар определён', last_source_ref = ?, updated_at = ?
       WHERE id = ? AND variant_id IS NULL AND quantity = ? AND last_source_ref LIKE 'stocktake-unresolved:%'`
    ).bind(`stocktake-resolved:${resolutionRef}`, now, stockId, quantity),
  ]);
  return { ok: true, already: false, merged: true, stockId, variantId, quantity, message: 'Найденная вещь связана с вариантом и добавлена к его обычному остатку без повторного прихода.' };
}
'''
s = s.replace(anchor, reconcile + anchor, 1)

# Count unresolved found items on completion and keep marker on unresolved stock rows
s = one(s,
"  const sessionStatus = cleanText(session.status);\n",
"  const sessionStatus = cleanText(session.status);\n  const countUnresolvedFound = async () => Math.max(0, toInt((await db.prepare(\n    `SELECT COUNT(DISTINCT s.id) AS qty\n     FROM inventory_stock s\n     JOIN inventory_stocktake_items i ON i.stock_id = s.id\n     WHERE i.session_id = ? AND s.variant_id IS NULL AND s.quantity > 0\n       AND s.last_source_ref LIKE 'stocktake-unresolved:%'`\n  ).bind(sessionId).first<Record<string, unknown>>())?.qty, 0));\n",
'completion unresolved counter')
needle = "return {\n      ok: true,\n      changed,\n"
count = s.count(needle)
if count != 2:
    raise SystemExit(f'completion success return count: expected 2, got {count}')
s = s.replace(needle, "return {\n      ok: true,\n      changed,\n      unresolvedFoundCount: await countUnresolvedFound(),\n", 2)
s = one(s,
"           last_action = 'Ревизия',\n           last_source_ref = ?,\n           updated_at = ?\n",
"           last_action = CASE WHEN variant_id IS NULL AND last_source_ref LIKE 'stocktake-unresolved:%' THEN 'Найдено при проверке' ELSE 'Ревизия' END,\n           last_source_ref = CASE WHEN variant_id IS NULL AND last_source_ref LIKE 'stocktake-unresolved:%' THEN last_source_ref ELSE ? END,\n           updated_at = ?\n",
'preserve unresolved marker')
old_cancel = """  await db.prepare(
    `UPDATE inventory_stocktake_sessions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`
  ).bind(now, now, sessionId).run();
  return { ok: true, session: await serializeInventoryStocktakeSession(db, sessionId) };
"""
new_cancel = """  await db.batch([
    db.prepare(
      `UPDATE inventory_stocktake_sessions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`
    ).bind(now, now, sessionId),
    db.prepare(
      `UPDATE inventory_stock
       SET last_action = 'Найденная позиция отменена вместе с проверкой', last_source_ref = ?, updated_at = ?
       WHERE variant_id IS NULL AND quantity = 0 AND reserved_quantity = 0
         AND last_source_ref LIKE 'stocktake-unresolved:%'
         AND id IN (SELECT stock_id FROM inventory_stocktake_items WHERE session_id = ? AND stock_id IS NOT NULL)`
    ).bind(`stocktake-cancelled:${sessionId}`, now, sessionId),
  ]);
  return { ok: true, session: await serializeInventoryStocktakeSession(db, sessionId) };
"""
s = one(s, old_cancel, new_cancel, 'cancel unresolved marker')
p.write_text(s, encoding='utf-8')

# Warehouse attention: persistent found physical facts
p = Path('worker/domains/warehouse-attention.ts')
s = p.read_text(encoding='utf-8')
insert_after = """  const exactLifecycleVariantSql = `COALESCE(
    (SELECT v0.id FROM catalog_variants v0 WHERE v0.id = e.variant_id AND v0.is_active = 1 LIMIT 1),
    (SELECT v.id
     FROM catalog_variants v
     WHERE v.is_active = 1
       AND v.product_id = e.product_id
       AND LOWER(TRIM(COALESCE(v.category, 'adult'))) = CASE WHEN UPPER(TRIM(COALESCE(e.audience_type, ''))) LIKE '%ДЕТ%' OR LOWER(TRIM(COALESCE(e.audience_type, ''))) = 'child' THEN 'child' ELSE 'adult' END
       AND UPPER(TRIM(COALESCE(v.gender, ''))) = UPPER(TRIM(COALESCE(e.gender_snapshot, '')))
       AND UPPER(TRIM(COALESCE(v.color, ''))) = UPPER(TRIM(COALESCE(e.color_snapshot, '')))
       AND UPPER(TRIM(COALESCE(NULLIF(v.material, ''), 'СТАНДАРТ'))) = UPPER(TRIM(COALESCE(NULLIF(e.material_snapshot, ''), 'СТАНДАРТ')))
       AND UPPER(TRIM(COALESCE(NULLIF(v.length, ''), 'СТАНДАРТ'))) = UPPER(TRIM(COALESCE(NULLIF(e.length_snapshot, ''), 'СТАНДАРТ')))
       AND UPPER(TRIM(COALESCE(v.size_label, ''))) = UPPER(TRIM(COALESCE(e.size_snapshot, '')))
     ORDER BY v.id
     LIMIT 1)
  )`
"""
addition = insert_after + """

  const exactFoundVariantSql = `(SELECT v.id
     FROM catalog_variants v
     JOIN catalog_products p ON p.id = v.product_id
     WHERE v.is_active = 1 AND p.is_active = 1
       AND v.product_id = s.product_id
       AND LOWER(TRIM(COALESCE(v.category, 'adult'))) = COALESCE((
         SELECT CASE WHEN LOWER(TRIM(COALESCE(i.category_snapshot, 'adult'))) = 'child' THEN 'child' ELSE 'adult' END
         FROM inventory_stocktake_items i WHERE i.stock_id = s.id ORDER BY i.id DESC LIMIT 1
       ), 'adult')
       AND UPPER(TRIM(COALESCE(v.gender, ''))) = UPPER(TRIM(COALESCE(s.gender_snapshot, '')))
       AND UPPER(TRIM(COALESCE(v.color, ''))) = UPPER(TRIM(COALESCE(s.color_snapshot, '')))
       AND UPPER(TRIM(COALESCE(NULLIF(v.material, ''), 'СТАНДАРТ'))) = UPPER(TRIM(COALESCE(NULLIF(s.material_snapshot, ''), 'СТАНДАРТ')))
       AND UPPER(TRIM(COALESCE(NULLIF(v.length, ''), 'СТАНДАРТ'))) = UPPER(TRIM(COALESCE(NULLIF(s.length_snapshot, ''), 'СТАНДАРТ')))
       AND UPPER(TRIM(COALESCE(v.size_label, ''))) = UPPER(TRIM(COALESCE(s.size_snapshot, '')))
     ORDER BY v.id ASC LIMIT 1)`
"""
s = one(s, insert_after, addition, 'found exact matcher')
s = one(s,
"         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count`\n",
"         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count,\n         (SELECT COUNT(*) FROM inventory_stock s WHERE s.variant_id IS NULL AND s.quantity > 0 AND s.last_source_ref LIKE 'stocktake-unresolved:%') AS found_count`\n",
'found summary count')
s = one(s,
"      stocktake: Math.max(0, toInt(summary?.stocktake_count, 0)),\n",
"      stocktake: Math.max(0, toInt(summary?.stocktake_count, 0)),\n      found: Math.max(0, toInt(summary?.found_count, 0)),\n",
'found summary counts object')
s = one(s,
"      total: counts.shortage + counts.intake + counts.lifecycle + counts.catalog + counts.handover + counts.stocktake,\n",
"      total: counts.shortage + counts.intake + counts.lifecycle + counts.catalog + counts.handover + counts.stocktake + counts.found,\n",
'found summary total')
# details query, count and mapping
anchor = """  const rawShortageCount = Math.max(0, toInt(coreSummary?.shortage_count, 0))
"""
found_query = """  const foundResult = await db.prepare(
    `SELECT s.id AS stock_id, s.inventory_source, s.product_id, s.product_name_snapshot,
            s.gender_snapshot, s.color_snapshot, s.material_snapshot, s.length_snapshot, s.size_snapshot,
            s.quantity, s.created_at, s.updated_at,
            COALESCE((SELECT i.category_snapshot FROM inventory_stocktake_items i WHERE i.stock_id = s.id ORDER BY i.id DESC LIMIT 1), 'adult') AS category_snapshot,
            ${exactFoundVariantSql} AS exact_variant_id,
            COUNT(*) OVER() AS found_count
     FROM inventory_stock s
     WHERE s.variant_id IS NULL AND s.quantity > 0 AND s.last_source_ref LIKE 'stocktake-unresolved:%'
     ORDER BY s.updated_at DESC, s.id DESC
     LIMIT ?`
  ).bind(limit).all<Record<string, unknown>>()

""" + anchor
s = one(s, anchor, found_query, 'found details query')
s = one(s,
"  const catalogCount = Math.max(0, toInt((catalogResult.results || [])[0]?.catalog_count, 0))\n",
"  const catalogCount = Math.max(0, toInt((catalogResult.results || [])[0]?.catalog_count, 0))\n  const foundCount = Math.max(0, toInt((foundResult.results || [])[0]?.found_count, 0))\n",
'found detail count value')
s = one(s,
"    stocktake: Math.max(0, toInt(coreSummary?.stocktake_count, 0)),\n  }\n",
"    stocktake: Math.max(0, toInt(coreSummary?.stocktake_count, 0)),\n    found: foundCount,\n  }\n",
'found detail counts object')
s = one(s,
"    total: counts.shortage + counts.intake + counts.lifecycle + counts.catalog + counts.handover + counts.stocktake,\n",
"    total: counts.shortage + counts.intake + counts.lifecycle + counts.catalog + counts.handover + counts.stocktake + counts.found,\n",
'found detail total')
s = one(s,
"    stocktakes: (stocktakeResult.results || []).map((row) => ({\n",
"    found: (foundResult.results || []).map((row) => ({\n      stockId: toInt(row.stock_id, 0),\n      source: normalizeSourceType(row.inventory_source),\n      productId: toInt(row.product_id, 0),\n      productName: cleanText(row.product_name_snapshot),\n      category: normalizeAudienceCategory(row.category_snapshot, row.size_snapshot),\n      gender: cleanText(row.gender_snapshot),\n      color: cleanText(row.color_snapshot),\n      material: canonicalStockPositionValue(row.material_snapshot) || 'СТАНДАРТ',\n      length: canonicalStockPositionValue(row.length_snapshot) || 'СТАНДАРТ',\n      size: cleanText(row.size_snapshot),\n      physical: Math.max(0, toInt(row.quantity, 0)),\n      createdAt: cleanText(row.created_at),\n      updatedAt: cleanText(row.updated_at),\n      exactVariantId: toInt(row.exact_variant_id, 0) || null,\n      exactKnown: Boolean(toInt(row.exact_variant_id, 0)),\n    })),\n    stocktakes: (stocktakeResult.results || []).map((row) => ({\n",
'found response items')
p.write_text(s, encoding='utf-8')

# Worker router
p = Path('worker/index.ts')
s = p.read_text(encoding='utf-8')
s = one(s,
"import { addInventoryStocktakeCombination, addInventoryStocktakeVariant, cancelInventoryStocktakeSession, completeInventoryStocktakeSession, createInventoryStocktakeSession, listInventoryCheckHistory, listInventoryCycleCountSuggestions, listInventoryHistory, listInventoryStocktakeSessions, quickInventoryStocktake, quickInventoryStocktakeBatch, saveInventoryStocktakeCount, serializeInventoryStocktakeSession } from './domains/inventory-stocktake.ts'",
"import { addInventoryStocktakeCombination, addInventoryStocktakeVariant, cancelInventoryStocktakeSession, completeInventoryStocktakeSession, createInventoryStocktakeSession, listInventoryCheckHistory, listInventoryCycleCountSuggestions, listInventoryHistory, listInventoryStocktakeSessions, quickInventoryStocktake, quickInventoryStocktakeBatch, reconcileFoundInventoryStock, saveInventoryStocktakeCount, serializeInventoryStocktakeSession } from './domains/inventory-stocktake.ts'",
'worker reconcile import')
s = one(s,
"const input = await readJson<{ productId?: unknown; material?: unknown; length?: unknown; category?: unknown; gender?: unknown; color?: unknown; size?: unknown; createReferenceFields?: unknown }>(request);",
"const input = await readJson<{ productId?: unknown; material?: unknown; length?: unknown; category?: unknown; gender?: unknown; color?: unknown; size?: unknown; sizes?: unknown; createReferenceFields?: unknown; deferUnknown?: unknown }>(request);",
'router combination input')
s = one(s,
"        const createReferenceFields = input.createReferenceFields && typeof input.createReferenceFields === 'object'\n          ? input.createReferenceFields as Record<string, unknown>\n          : {};\n        const wantsNewReferenceValue = Object.values(createReferenceFields).some((value) => value === true);\n",
"        const createReferenceFields = input.createReferenceFields;\n        const wantsNewReferenceValue = Array.isArray(createReferenceFields)\n          ? createReferenceFields.length > 0\n          : Boolean(createReferenceFields && typeof createReferenceFields === 'object' && Object.values(createReferenceFields as Record<string, unknown>).some((value) => value === true));\n",
'router create refs admin gate')
route_anchor = """        return json(await addInventoryStocktakeCombination(env.DB, decodeURIComponent(inventoryStocktakeAddCombinationMatch[1]), input), { status: 201 });
      }
"""
route_new = route_anchor + """

      const inventoryFoundStockReconcileMatch = url.pathname.match(/^\/api\/inventory\/found-stock\/(\d+)\/reconcile$/);
      if (inventoryFoundStockReconcileMatch && request.method === 'POST') {
        return json(await reconcileFoundInventoryStock(env.DB, toInt(inventoryFoundStockReconcileMatch[1], 0)));
      }
"""
s = one(s, route_anchor, route_new, 'found reconcile route')
p.write_text(s, encoding='utf-8')

# App API client and context pass-through
p = Path('src/App.tsx')
s = p.read_text(encoding='utf-8')
s = one(s,
"    createReferenceFields?: string[]\n  }) {\n",
"    createReferenceFields?: string[]\n    deferUnknown?: boolean\n  }) {\n",
'app combination input')
anchor = """  async function addInventoryStocktakeCombination(sessionId: string, input: {
"""
# Insert reconcile function after addInventoryStocktakeCombination function by locating next known loader
pattern = re.compile(r"(  async function addInventoryStocktakeCombination\([\s\S]*?\n  }\n)(\n\n  async function loadInventoryCycleCounts)")
m = pattern.search(s)
if not m:
    raise SystemExit('app combination function block not found')
reconcile_client = m.group(1) + """

  async function reconcileFoundInventoryStock(stockId: number) {
    if (!stockId) return null
    const response = await apiFetch(`/api/inventory/found-stock/${stockId}/reconcile`, { method: 'POST' })
    const data = await readJsonResponse<any>(response, 'Уточнение найденной позиции')
    if (!response.ok || data?.ok === false) throw new Error(data?.message || 'Не удалось определить найденную позицию.')
    return data
  }
""" + m.group(2)
s = s[:m.start()] + reconcile_client + s[m.end():]
s = one(s,
"resolveInventoryLifecycleFacts, reconcileKnownInventoryLifecycle, loadWarehouseAttention,",
"resolveInventoryLifecycleFacts, reconcileKnownInventoryLifecycle, reconcileFoundInventoryStock, loadWarehouseAttention,",
'app inventory ctx reconcile')
p.write_text(s, encoding='utf-8')

# Inventory controller
p = Path('src/features/sections/InventorySection.tsx')
s = p.read_text(encoding='utf-8')
s = one(s,
"import '../../styles/w5-3-selective-queue.css'\n",
"import '../../styles/w5-3-selective-queue.css'\nimport '../../styles/w5-5-found-items.css'\n",
'w5.5 css import')
s = one(s,
"    reconcileKnownInventoryLifecycle,\n    loadWarehouseAttention,\n",
"    reconcileKnownInventoryLifecycle,\n    reconcileFoundInventoryStock,\n    loadWarehouseAttention,\n",
'controller reconcile destructure')
s = one(s,
"  const warehouseClarificationCount = Number(warehouseAttention?.counts?.handover || 0)\n    + Number(warehouseAttention?.counts?.lifecycle || 0)\n    + Number(warehouseAttention?.counts?.catalog || 0)\n",
"  const warehouseClarificationCount = Number(warehouseAttention?.counts?.handover || 0)\n    + Number(warehouseAttention?.counts?.lifecycle || 0)\n    + Number(warehouseAttention?.counts?.catalog || 0)\n    + Number(warehouseAttention?.counts?.found || 0)\n",
'found clarification count')
# replace create-ref confirmation with defer behavior
old = """    if (createReferenceFields.length) {
      const newValues = [
        materialFact.create ? `материал «${material}»` : '',
        lengthFact.create ? `длину «${length}»` : '',
        colorFact.create ? `цвет «${color}»` : '',
        createSize ? `${stocktakeFoundDraft.category === 'child' ? 'возраст' : 'размер'} «${String(stocktakeFoundCustom.size || '').trim()}»` : '',
      ].filter(Boolean).join(', ')
      if (!window.confirm(`Добавить в канонические справочники: ${newValues}? Эти значения станут доступны во всей системе.`)) return
    }

    setStocktakeAddingVariantId(-1)
"""
new = """    const deferUnknown = createReferenceFields.length > 0

    setStocktakeAddingVariantId(-1)
"""
s = one(s, old, new, 'defer unknown instead of catalog mutation')
s = one(s,
"        createReferenceFields,\n      })\n",
"        createReferenceFields: deferUnknown ? [] : createReferenceFields,\n        deferUnknown,\n      })\n",
'combination defer payload')
s = one(s,
"      await Promise.all([loadCatalogData(true), createReferenceFields.length ? loadReferencesData(true) : Promise.resolve(null)])\n",
"      await Promise.all([loadCatalogData(true), !deferUnknown && createReferenceFields.length ? loadReferencesData(true) : Promise.resolve(null)])\n",
'avoid ref reload on deferred unknown')
s = one(s,
"      const added = Number(result?.addedCount || 0)\n      const existing = Number(result?.alreadyPresentCount || 0)\n      setStocktakeNotice(`${added ? `Добавлено в ревизию: ${added}. ` : ''}${existing ? `Уже были в ревизии: ${existing}. ` : ''}Теперь укажите фактическое количество по найденным размерам.`)\n",
"      const added = Number(result?.addedCount || 0)\n      const existing = Number(result?.alreadyPresentCount || 0)\n      const deferred = Number(result?.deferredUnknownCount || 0)\n      setStocktakeNotice(deferred\n        ? `Найдено позиций для уточнения: ${deferred}. Они сохранены в этой проверке — укажите фактическое количество. После завершения система отдельно покажет, что нужно определить.`\n        : `${added ? `Добавлено в ревизию: ${added}. ` : ''}${existing ? `Уже были в ревизии: ${existing}. ` : ''}Теперь укажите фактическое количество по найденным размерам.`)\n",
'deferred found notice')
# successful completion: never let refresh failure masquerade as mutation failure; route to clarification when needed
old_apply = """      setStocktakeNotice(result.message || 'Ревизия завершена.')
      setStocktakeSession(null)
      setStocktakeFacts({})
      setStocktakeReviewMode(false)
      await Promise.all([refreshInventoryModule(true), refreshActiveStocktakes()])
"""
new_apply = """      const unresolvedFoundCount = Math.max(0, Number(result?.unresolvedFoundCount || 0))
      setStocktakeNotice(result.message || 'Ревизия завершена.')
      setStocktakeSession(null)
      setStocktakeFacts({})
      setStocktakeReviewMode(false)
      await Promise.allSettled([refreshInventoryModule(true), refreshActiveStocktakes()])
      if (unresolvedFoundCount > 0) {
        setAttentionCategory('identify')
        openInventoryPanel('attention')
        void loadWarehouseAttention(true)
      }
"""
s = one(s, old_apply, new_apply, 'completion attention redirect')
# helper functions before simple-stock helpers
anchor = """  async function openStocktakeOrders(row: any) {
"""
helpers = """  async function resolveFoundInventoryStock(item: any) {
    if (!item?.stockId) return
    try {
      await reconcileFoundInventoryStock(Number(item.stockId))
      await Promise.allSettled([
        loadInventoryData(item.source === 'boutique' ? 'boutique' : 'warehouse', true, '', false),
        loadWarehouseAttention(true),
      ])
    } catch (error) {
      setStocktakeNotice(error instanceof Error ? error.message : 'Не удалось определить найденную позицию.')
    }
  }

  function openFoundInventoryCatalog(item: any) {
    setCatalogAdminMode('catalog')
    if (item?.category === 'child' || item?.category === 'adult') setCatalogCategoryFilter(item.category)
    openInventoryPanel('catalog')
  }

""" + anchor
s = one(s, anchor, helpers, 'found resolution controller helpers')
# pass render attention callbacks
s = one(s,
"        openAttentionIntake,\n        openAttentionLifecycle,\n        refreshWarehouseAttention,\n",
"        openAttentionIntake,\n        openAttentionLifecycle,\n        openAttentionFoundCatalog: openFoundInventoryCatalog,\n        reconcileFoundInventoryStock: resolveFoundInventoryStock,\n        refreshWarehouseAttention,\n",
'attention renderer callbacks')
p.write_text(s, encoding='utf-8')

# Stocktake renderer copy: unknown values become deferred clarification, never master-data creation
p = Path('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
s = p.read_text(encoding='utf-8')
s = s.replace('Новое значение будет добавлено только после отдельного подтверждения.', 'Если такого значения ещё нет, вещь сохранится отдельно и после проверки появится в «Нужно уточнить».')
s = one(s,
"<div className=\"stocktake-found-modal-note\">Выберите факты о найденной вещи. Это не приход: количество изменится только после пересчёта.</div>",
"<div className=\"stocktake-found-modal-note w5-found-clarification-note\"><strong>Выберите то, что видите на вещи.</strong><span>Если нужного значения нет в списке, мы не будем создавать вариант автоматически. Физический факт сохранится отдельно, а после проверки система попросит определить товар.</span></div>",
'found modal clarification note')
s = one(s,
"<span>Это не «Приход» и не ручное изменение остатка. Позиция лишь появляется в текущем листе, после чего вы вводите фактическое количество.</span>",
"<span>Сначала позиция появится в текущем листе. Обычный вариант товара будет создан или связан только если его характеристики уже однозначно известны.</span>",
'found action functional copy')
p.write_text(s, encoding='utf-8')

# Attention renderer: prominent persistent found-item clarification
p = Path('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
s = p.read_text(encoding='utf-8')
s = one(s,
"  | 'openAttentionLifecycle'\n  | 'refreshWarehouseAttention'\n",
"  | 'openAttentionLifecycle'\n  | 'openAttentionFoundCatalog'\n  | 'reconcileFoundInventoryStock'\n  | 'refreshWarehouseAttention'\n",
'attention context found callbacks')
s = one(s,
"    openAttentionLifecycle,\n    refreshWarehouseAttention,\n",
"    openAttentionLifecycle,\n    openAttentionFoundCatalog,\n    reconcileFoundInventoryStock,\n    refreshWarehouseAttention,\n",
'attention destructure found callbacks')
s = one(s,
"    identify: Number(counts?.lifecycle || 0) + Number(counts?.catalog || 0),\n",
"    identify: Number(counts?.lifecycle || 0) + Number(counts?.catalog || 0) + Number(counts?.found || 0),\n",
'attention identify found count')
s = one(s,
"          {(items.lifecycle.length || items.catalog.length) ? <div className=\"inventory-attention-list\">\n",
"          {((items.found?.length || 0) || items.lifecycle.length || items.catalog.length) ? <div className=\"inventory-attention-list\">\n            {(items.found || []).map((item: any) => (\n              <article className=\"w5-found-attention-card\" key={`attention-found-${item.stockId}`}>\n                <div className=\"inventory-attention-main\">\n                  <strong>{item.productName || 'Найденная вещь'}</strong>\n                  <span>{detailLine(item) || 'Характеристики требуют уточнения'} · {sourceLabel(item.source)}</span>\n                  <small>Физически учтено: {item.physical}</small>\n                  <div className=\"w5-found-attention-warning\"><strong>Вариант товара ещё не определён</strong><span>Физически вещь учтена, но пока не появилась среди обычных вариантов этого товара. Определите её, чтобы она стала доступна в остатках, перемещениях и заказах.</span></div>\n                </div>\n                {item.exactKnown\n                  ? <button className=\"primary compact\" type=\"button\" onClick={() => void reconcileFoundInventoryStock(item)}>Связать с вариантом</button>\n                  : isAdmin\n                    ? <button className=\"secondary compact\" type=\"button\" onClick={() => openAttentionFoundCatalog(item)}>Разобрать</button>\n                    : <span className=\"inventory-attention-admin-note\">Требуется администратор</span>}\n              </article>\n            ))}\n",
'attention found cards')
p.write_text(s, encoding='utf-8')

# Dedicated responsive styling
Path('src/styles/w5-5-found-items.css').write_text(r'''/* W5.5 — found physical item clarification */
.w5-found-clarification-note {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid rgba(180, 120, 0, .28);
  border-radius: 12px;
  background: rgba(255, 191, 0, .08);
}
.w5-found-clarification-note strong { font-size: 14px; }
.w5-found-clarification-note span { line-height: 1.45; }
.w5-found-attention-card {
  border-width: 2px !important;
  border-color: rgba(207, 126, 0, .38) !important;
}
.w5-found-attention-warning {
  display: grid;
  gap: 4px;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 191, 0, .10);
}
.w5-found-attention-warning strong { font-size: 13px; }
.w5-found-attention-warning span { font-size: 12px; line-height: 1.45; }
@media (max-width: 600px) {
  .w5-found-attention-card { align-items: stretch !important; }
  .w5-found-attention-card > button { width: 100%; min-height: 44px; }
  .w5-found-clarification-note { padding: 11px 12px; }
}
''', encoding='utf-8')

print('W5.5 source patch applied')
