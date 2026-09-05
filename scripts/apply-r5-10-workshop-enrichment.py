from pathlib import Path

p = Path('worker/domains/workshop.ts')
text = p.read_text(encoding='utf-8')
marker = 'export async function enrichWorkshopTaskRowsFromOrderItems(\n'
if text.count(marker) != 1:
    raise SystemExit(f'enrich marker count={text.count(marker)}')

helper = r'''const WORKSHOP_SET_FALLBACK_MIN_ITEMS = 20;

function sqliteTrimSpaces(value: unknown) {
  return String(value ?? '').replace(/^ +| +$/g, '');
}

function sqliteAsciiUpper(value: unknown) {
  return sqliteTrimSpaces(value).replace(/[a-z]/g, char => char.toUpperCase());
}

function sqliteAsciiLower(value: unknown) {
  return String(value ?? '').replace(/[A-Z]/g, char => char.toLowerCase());
}

function firstSqlNonEmpty(...values: unknown[]) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value) !== '') return value;
  }
  return null;
}

async function loadWorkshopDirectItemsSetBased(db: D1Database, directItemIds: number[]) {
  const rawRows = await bindInChunks<Record<string, unknown>>(
    db,
    `SELECT
       oi.id, oi.order_id, oi.product_id, oi.variant_id,
       oi.product_name_snapshot, oi.audience_type, oi.gender_snapshot, oi.color_snapshot,
       oi.material_snapshot, oi.length_snapshot, oi.size_snapshot,
       oi.quantity, oi.is_workshop, oi.source_type, oi.stock_writeoff_status,
       cv_direct.category AS direct_category, cv_direct.gender AS direct_gender,
       cv_direct.color AS direct_color, cv_direct.material AS direct_material,
       cv_direct.length AS direct_length, cv_direct.size_label AS direct_size
     FROM order_items oi
     LEFT JOIN catalog_variants cv_direct ON cv_direct.id = oi.variant_id
     WHERE oi.id IN (`,
    directItemIds,
    ') AND COALESCE(oi.quantity, 0) > 0',
  );

  const missingProductIds = Array.from(new Set(
    rawRows
      .filter(row => row.variant_id === null || row.variant_id === undefined)
      .map(row => toInt(row.product_id, 0))
      .filter(Boolean),
  ));
  const fallbackVariants = missingProductIds.length
    ? await bindInChunks<Record<string, unknown>>(
        db,
        `SELECT id, product_id, category, gender, color, material, length, size_label, is_active, sort_order
         FROM catalog_variants
         WHERE product_id IN (`,
        missingProductIds,
        ') ORDER BY product_id ASC, is_active DESC, sort_order ASC, id ASC',
      )
    : [];
  const variantsByProduct = new Map<number, Record<string, unknown>[]>();
  for (const variant of fallbackVariants) {
    const productId = toInt(variant.product_id, 0);
    if (!variantsByProduct.has(productId)) variantsByProduct.set(productId, []);
    variantsByProduct.get(productId)!.push(variant);
  }

  return rawRows.map(row => {
    const variantIsNull = row.variant_id === null || row.variant_id === undefined;
    const rawColor = sqliteTrimSpaces(row.color_snapshot);
    const rawSize = sqliteTrimSpaces(row.size_snapshot);
    const fallbackVariant = variantIsNull
      ? (variantsByProduct.get(toInt(row.product_id, 0)) || []).find(variant =>
          (!rawColor || sqliteAsciiUpper(variant.color) === sqliteAsciiUpper(row.color_snapshot))
          && (!rawSize || sqliteAsciiUpper(variant.size_label) === sqliteAsciiUpper(row.size_snapshot)))
      : undefined;
    const category = firstSqlNonEmpty(row.audience_type, row.direct_category, fallbackVariant?.category);
    const rawAudience = String(row.audience_type ?? '');
    const child = sqliteAsciiLower(category) === 'child' || sqliteAsciiUpper(rawAudience).includes('ДЕТ');

    return {
      id: row.id,
      order_id: row.order_id,
      product_id: row.product_id,
      resolved_variant_id: variantIsNull ? (fallbackVariant?.id ?? null) : row.variant_id,
      product_name_snapshot: row.product_name_snapshot,
      resolved_gender: firstSqlNonEmpty(row.gender_snapshot, row.direct_gender, fallbackVariant?.gender),
      resolved_color: firstSqlNonEmpty(row.color_snapshot, row.direct_color, fallbackVariant?.color),
      resolved_material: firstSqlNonEmpty(row.material_snapshot, row.direct_material, fallbackVariant?.material),
      resolved_length: firstSqlNonEmpty(row.length_snapshot, row.direct_length, fallbackVariant?.length),
      resolved_size: firstSqlNonEmpty(row.size_snapshot, row.direct_size, fallbackVariant?.size_label),
      resolved_audience_type: child ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ',
      quantity: row.quantity,
      is_workshop: row.is_workshop,
      source_type: row.source_type,
      stock_writeoff_status: row.stock_writeoff_status,
    } as Record<string, unknown>;
  });
}


'''
text = text.replace(marker, helper + marker, 1)

old = r'''  const directItemRows = directItemIds.length
    ? await bindInChunks<Record<string, unknown>>(
        db,
        `SELECT
           oi.id,
           oi.order_id,
           oi.product_id,
           COALESCE(oi.variant_id, cv_fallback.id) AS resolved_variant_id,
           oi.product_name_snapshot,
           COALESCE(NULLIF(oi.gender_snapshot, ''), NULLIF(cv_direct.gender, ''), NULLIF(cv_fallback.gender, '')) AS resolved_gender,
           COALESCE(NULLIF(oi.color_snapshot, ''), NULLIF(cv_direct.color, ''), NULLIF(cv_fallback.color, '')) AS resolved_color,
           COALESCE(NULLIF(oi.material_snapshot, ''), NULLIF(cv_direct.material, ''), NULLIF(cv_fallback.material, '')) AS resolved_material,
           COALESCE(NULLIF(oi.length_snapshot, ''), NULLIF(cv_direct.length, ''), NULLIF(cv_fallback.length, '')) AS resolved_length,
           COALESCE(NULLIF(oi.size_snapshot, ''), NULLIF(cv_direct.size_label, ''), NULLIF(cv_fallback.size_label, '')) AS resolved_size,
           CASE
             WHEN LOWER(COALESCE(NULLIF(oi.audience_type, ''), NULLIF(cv_direct.category, ''), NULLIF(cv_fallback.category, ''))) = 'child'
               OR UPPER(COALESCE(NULLIF(oi.audience_type, ''), '')) LIKE '%ДЕТ%'
             THEN 'ДЕТСКИЙ'
             ELSE 'ВЗРОСЛЫЙ'
           END AS resolved_audience_type,
           oi.quantity,
           oi.is_workshop,
           oi.source_type,
           oi.stock_writeoff_status
         FROM order_items oi
         LEFT JOIN catalog_variants cv_direct ON cv_direct.id = oi.variant_id
         LEFT JOIN catalog_variants cv_fallback ON cv_fallback.id = (
           SELECT cv2.id
           FROM catalog_variants cv2
           WHERE oi.variant_id IS NULL
             AND cv2.product_id = oi.product_id
             AND (
               NULLIF(TRIM(COALESCE(oi.color_snapshot, '')), '') IS NULL
               OR UPPER(TRIM(COALESCE(cv2.color, ''))) = UPPER(TRIM(COALESCE(oi.color_snapshot, '')))
             )
             AND (
               NULLIF(TRIM(COALESCE(oi.size_snapshot, '')), '') IS NULL
               OR UPPER(TRIM(COALESCE(cv2.size_label, ''))) = UPPER(TRIM(COALESCE(oi.size_snapshot, '')))
             )
           ORDER BY cv2.is_active DESC, cv2.sort_order ASC, cv2.id ASC
           LIMIT 1
         )
         WHERE oi.id IN (`,
        directItemIds,
        ') AND COALESCE(oi.quantity, 0) > 0',
      )
    : [];
'''
new = r'''  // R5.10: large Workshop reads used to run the correlated legacy variant fallback once per
  // linked item. Production proof on 80 live Workshop items measured 2,967 rows_read. Resolve
  // those historical variant-less rows set-wise instead; small mutation/relink flows deliberately
  // retain the exact legacy query below so a one-item status action does not fan out over catalog data.
  const directItemRows = directItemIds.length >= WORKSHOP_SET_FALLBACK_MIN_ITEMS
    ? await loadWorkshopDirectItemsSetBased(db, directItemIds)
    : directItemIds.length
      ? await bindInChunks<Record<string, unknown>>(
          db,
          `SELECT
             oi.id,
             oi.order_id,
             oi.product_id,
             COALESCE(oi.variant_id, cv_fallback.id) AS resolved_variant_id,
             oi.product_name_snapshot,
             COALESCE(NULLIF(oi.gender_snapshot, ''), NULLIF(cv_direct.gender, ''), NULLIF(cv_fallback.gender, '')) AS resolved_gender,
             COALESCE(NULLIF(oi.color_snapshot, ''), NULLIF(cv_direct.color, ''), NULLIF(cv_fallback.color, '')) AS resolved_color,
             COALESCE(NULLIF(oi.material_snapshot, ''), NULLIF(cv_direct.material, ''), NULLIF(cv_fallback.material, '')) AS resolved_material,
             COALESCE(NULLIF(oi.length_snapshot, ''), NULLIF(cv_direct.length, ''), NULLIF(cv_fallback.length, '')) AS resolved_length,
             COALESCE(NULLIF(oi.size_snapshot, ''), NULLIF(cv_direct.size_label, ''), NULLIF(cv_fallback.size_label, '')) AS resolved_size,
             CASE
               WHEN LOWER(COALESCE(NULLIF(oi.audience_type, ''), NULLIF(cv_direct.category, ''), NULLIF(cv_fallback.category, ''))) = 'child'
                 OR UPPER(COALESCE(NULLIF(oi.audience_type, ''), '')) LIKE '%ДЕТ%'
               THEN 'ДЕТСКИЙ'
               ELSE 'ВЗРОСЛЫЙ'
             END AS resolved_audience_type,
             oi.quantity,
             oi.is_workshop,
             oi.source_type,
             oi.stock_writeoff_status
           FROM order_items oi
           LEFT JOIN catalog_variants cv_direct ON cv_direct.id = oi.variant_id
           LEFT JOIN catalog_variants cv_fallback ON cv_fallback.id = (
             SELECT cv2.id
             FROM catalog_variants cv2
             WHERE oi.variant_id IS NULL
               AND cv2.product_id = oi.product_id
               AND (
                 NULLIF(TRIM(COALESCE(oi.color_snapshot, '')), '') IS NULL
                 OR UPPER(TRIM(COALESCE(cv2.color, ''))) = UPPER(TRIM(COALESCE(oi.color_snapshot, '')))
               )
               AND (
                 NULLIF(TRIM(COALESCE(oi.size_snapshot, '')), '') IS NULL
                 OR UPPER(TRIM(COALESCE(cv2.size_label, ''))) = UPPER(TRIM(COALESCE(oi.size_snapshot, '')))
               )
             ORDER BY cv2.is_active DESC, cv2.sort_order ASC, cv2.id ASC
             LIMIT 1
           )
           WHERE oi.id IN (`,
          directItemIds,
          ') AND COALESCE(oi.quantity, 0) > 0',
        )
      : [];
'''
if text.count(old) != 1:
    raise SystemExit(f'directItemRows block count={text.count(old)}')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')

test = Path('scripts/test-d1-read-budget-r5-10.mjs')
test.write_text(r'''import fs from 'node:fs'
const workshop = fs.readFileSync('worker/domains/workshop.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
try {
  check(workshop.includes('const WORKSHOP_SET_FALLBACK_MIN_ITEMS = 20'), 'large-read threshold missing')
  check(workshop.includes('directItemIds.length >= WORKSHOP_SET_FALLBACK_MIN_ITEMS'), 'large Workshop reads must use set fallback')
  check(workshop.includes('loadWorkshopDirectItemsSetBased(db, directItemIds)'), 'set-based loader missing')
  check(workshop.includes("FROM catalog_variants\n         WHERE product_id IN ("), 'set-based catalog fetch missing')
  check(workshop.includes('ORDER BY product_id ASC, is_active DESC, sort_order ASC, id ASC'), 'legacy fallback priority must be preserved')
  const split = workshop.indexOf('// R5.10: large Workshop reads')
  const fallback = workshop.indexOf('const directLinkCountByKey', split)
  const block = workshop.slice(split, fallback)
  check(block.includes('LEFT JOIN catalog_variants cv_fallback ON cv_fallback.id = ('), 'small-flow legacy fallback must remain')
  check(block.includes('directItemIds.length\n      ? await bindInChunks'), 'small status/relink flow must remain bounded and legacy-compatible')
  const laterFallback = workshop.indexOf('let fallbackMatches = new Map', fallback)
  const laterEnd = workshop.indexOf('return taskRows.map', laterFallback)
  check(workshop.slice(laterFallback, laterEnd).includes('LEFT JOIN catalog_variants cv_fallback ON cv_fallback.id = ('), 'ambiguous legacy task matcher must remain unchanged')
  console.log('R5.10 WORKSHOP READ BUDGET PASSED — large direct-link enrichment is set-based while small mutation/relink and ambiguous matching retain legacy semantics')
} catch (error) {
  console.error(`R5.10 WORKSHOP READ BUDGET FAILED: ${error?.message || error}`)
  process.exit(1)
}
''', encoding='utf-8')

package = Path('package.json')
package_text = package.read_text(encoding='utf-8')
needle = 'node scripts/test-workshop-backlog-visibility-r1.mjs"'
replacement = 'node scripts/test-workshop-backlog-visibility-r1.mjs && node scripts/test-d1-read-budget-r5-10.mjs"'
if package_text.count(needle) != 1:
    raise SystemExit(f'release gate terminal count={package_text.count(needle)}')
package.write_text(package_text.replace(needle, replacement, 1), encoding='utf-8')
