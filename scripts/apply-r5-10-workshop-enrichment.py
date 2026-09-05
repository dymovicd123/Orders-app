from pathlib import Path

p = Path('worker/domains/workshop.ts')
text = p.read_text(encoding='utf-8')

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
new = r'''  // R5.10: only large read-side enrichments use the set resolver. Small status/relink
  // operations deliberately retain the exact legacy correlated query below.
  let directItemRows: Record<string, unknown>[] = [];
  if (directItemIds.length >= 20) {
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
    const trimSpaces = (value: unknown) => String(value ?? '').replace(/^ +| +$/g, '');
    const asciiUpper = (value: unknown) => trimSpaces(value).replace(/[a-z]/g, char => char.toUpperCase());
    const asciiLower = (value: unknown) => String(value ?? '').replace(/[A-Z]/g, char => char.toLowerCase());
    const firstNonEmpty = (...values: unknown[]) => {
      for (const value of values) {
        if (value !== null && value !== undefined && String(value) !== '') return value;
      }
      return null;
    };
    directItemRows = rawRows.map(row => {
      const variantIsNull = row.variant_id === null || row.variant_id === undefined;
      const rawColor = trimSpaces(row.color_snapshot);
      const rawSize = trimSpaces(row.size_snapshot);
      const fallbackVariant = variantIsNull
        ? (variantsByProduct.get(toInt(row.product_id, 0)) || []).find(variant =>
            (!rawColor || asciiUpper(variant.color) === asciiUpper(row.color_snapshot))
            && (!rawSize || asciiUpper(variant.size_label) === asciiUpper(row.size_snapshot)))
        : undefined;
      const category = firstNonEmpty(row.audience_type, row.direct_category, fallbackVariant?.category);
      const child = asciiLower(category) === 'child' || asciiUpper(row.audience_type).includes('ДЕТ');
      return {
        id: row.id,
        order_id: row.order_id,
        product_id: row.product_id,
        resolved_variant_id: variantIsNull ? (fallbackVariant?.id ?? null) : row.variant_id,
        product_name_snapshot: row.product_name_snapshot,
        resolved_gender: firstNonEmpty(row.gender_snapshot, row.direct_gender, fallbackVariant?.gender),
        resolved_color: firstNonEmpty(row.color_snapshot, row.direct_color, fallbackVariant?.color),
        resolved_material: firstNonEmpty(row.material_snapshot, row.direct_material, fallbackVariant?.material),
        resolved_length: firstNonEmpty(row.length_snapshot, row.direct_length, fallbackVariant?.length),
        resolved_size: firstNonEmpty(row.size_snapshot, row.direct_size, fallbackVariant?.size_label),
        resolved_audience_type: child ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ',
        quantity: row.quantity,
        is_workshop: row.is_workshop,
        source_type: row.source_type,
        stock_writeoff_status: row.stock_writeoff_status,
      };
    });
  } else if (directItemIds.length) {
    directItemRows = await bindInChunks<Record<string, unknown>>(
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
    );
  }
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
  check(!workshop.includes('WORKSHOP_SET_FALLBACK_MIN_ITEMS'), 'R5.10 must not add top-level Worker declarations')
  check(workshop.includes('if (directItemIds.length >= 20) {'), 'large Workshop read threshold missing')
  check(workshop.includes("FROM catalog_variants\n           WHERE product_id IN ("), 'set-based catalog fetch missing')
  check(workshop.includes('ORDER BY product_id ASC, is_active DESC, sort_order ASC, id ASC'), 'legacy fallback priority must be preserved')
  const split = workshop.indexOf('// R5.10: only large read-side enrichments')
  const fallback = workshop.indexOf('const directLinkCountByKey', split)
  const block = workshop.slice(split, fallback)
  check(block.includes('} else if (directItemIds.length) {'), 'small-flow boundary missing')
  check(block.includes('LEFT JOIN catalog_variants cv_fallback ON cv_fallback.id = ('), 'small-flow legacy fallback must remain')
  const laterFallback = workshop.indexOf('let fallbackMatches = new Map', fallback)
  const laterEnd = workshop.indexOf('return taskRows.map', laterFallback)
  check(workshop.slice(laterFallback, laterEnd).includes('LEFT JOIN catalog_variants cv_fallback ON cv_fallback.id = ('), 'ambiguous task matching must remain unchanged')
  console.log('R5.10 WORKSHOP READ BUDGET PASSED — large enrichment is set-based; small mutation/relink and ambiguous matching retain legacy SQL')
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
