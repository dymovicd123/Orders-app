// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { bindInChunks, chunksOf, readTableColumnSet } from '../core/sql.ts'
import { cleanText, isArchivedOrder, normalizeDate, toInt, workshopOnlyComment } from '../core/text.ts'
import type { WorkshopTaskStatus, WorkshopViewMode } from '../core/types.ts'
import { isHighConfidenceWorkshopTaskItemMatch, matchWorkshopTasksToOrderItems } from './workshop-matching.ts'

export function normalizeWorkshopViewMode(value: unknown): WorkshopViewMode {
  const text = cleanText(value).toLowerCase();
  if (text === 'invoice' || text === 'накладная') return 'invoice';
  if (text === 'urgent' || text === 'срочные' || text === 'срочно') return 'urgent';
  if (text === 'done' || text === 'готово' || text === 'готовые') return 'done';
  return 'active';
}


export function normalizeWorkshopTaskStatus(value: unknown): WorkshopTaskStatus {
  const text = cleanText(value).toLowerCase();
  if (text === 'ready' || text === 'готов') return 'ready';
  if (text === 'done' || text === 'готово') return 'done';
  if (text === 'cancelled' || text === 'отменён' || text === 'отменен') return 'cancelled';
  return 'active';
}


export function resolveWorkshopPeriod(url: URL) {
  const period = cleanText(url.searchParams.get('period')).toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const shifted = (days: number) => {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  if (period === 'today' || period === 'сегодня') {
    return { dateFrom: today, dateTo: today };
  }

  if (period === 'yesterday' || period === 'вчера') {
    const yesterday = shifted(-1);
    return { dateFrom: yesterday, dateTo: yesterday };
  }

  if (period === 'month' || period === 'месяц') {
    return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today };
  }

  if (period === 'custom' || period === 'period' || period === 'период') {
    return {
      dateFrom: cleanText(url.searchParams.get('dateFrom')),
      dateTo: cleanText(url.searchParams.get('dateTo')),
    };
  }

  return {
    dateFrom: cleanText(url.searchParams.get('dateFrom')),
    dateTo: cleanText(url.searchParams.get('dateTo')),
  };
}


export async function refreshOrderWorkshopStatusFromTasks(db: D1Database, orderId: number, timestamp: string) {
  const state = await db.prepare(
    `SELECT
       o.workshop_status,
       COUNT(wt.id) AS task_count,
       COALESCE(SUM(CASE WHEN wt.status = 'active' THEN 1 ELSE 0 END), 0) AS active_count
     FROM orders o
     LEFT JOIN workshop_tasks wt ON wt.order_id = o.id
     WHERE o.id = ?
     GROUP BY o.id, o.workshop_status`
  ).bind(orderId).first<{ workshop_status: string; task_count: number; active_count: number }>();

  if (Number(state?.task_count || 0) <= 0) return false;
  const nextStatus = Number(state?.active_count || 0) > 0 ? 'in_workshop' : 'ready';
  if (cleanText(state?.workshop_status) === nextStatus) return false;

  await db.prepare(
    `UPDATE orders SET workshop_status = ?, updated_at = ? WHERE id = ? AND COALESCE(workshop_status, '') <> ?`
  ).bind(nextStatus, timestamp, orderId, nextStatus).run();
  return true;
}


export async function enrichWorkshopTaskRowsFromOrderItems(
  db: D1Database,
  taskRows: Record<string, unknown>[],
  workshopColumns?: Set<string>,
): Promise<Record<string, unknown>[]> {
  if (!taskRows.length) return taskRows;

  const columns = workshopColumns || await readTableColumnSet(db, 'workshop_tasks');
  const wtColumn = (name: string) => columns.has(name.toLowerCase()) ? `wt.${name}` : 'NULL';
  const directItemIds = Array.from(new Set(taskRows.map(row => toInt(row.order_item_id, 0)).filter(Boolean)));

  const directLinkRows = directItemIds.length
    ? await bindInChunks<Record<string, unknown>>(
        db,
        `SELECT order_id, order_item_id, COUNT(*) AS link_count
         FROM workshop_tasks
         WHERE order_item_id IN (`,
        directItemIds,
        ') GROUP BY order_id, order_item_id',
      )
    : [];

  // R5.10: only large read-side enrichments use the set resolver. Small status/relink
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

  const directLinkCountByKey = new Map(
    directLinkRows.map(row => [`${toInt(row.order_id, 0)}:${toInt(row.order_item_id, 0)}`, toInt(row.link_count, 0)]),
  );
  const directItemById = new Map(directItemRows.map(row => [toInt(row.id, 0), row]));
  const fallbackOrderIds = new Set<number>();

  for (const row of taskRows) {
    const orderId = toInt(row.order_id, 0);
    const orderItemId = toInt(row.order_item_id, 0);
    const linkedItem = directItemById.get(orderItemId);
    const linkCount = directLinkCountByKey.get(`${orderId}:${orderItemId}`) || 0;
    if (!orderId || !orderItemId || linkCount !== 1 || !linkedItem || toInt(linkedItem.order_id, 0) !== orderId) {
      if (orderId) fallbackOrderIds.add(orderId);
    }
  }

  let fallbackMatches = new Map<number, Record<string, unknown>>();
  if (fallbackOrderIds.size) {
    const orderIds = Array.from(fallbackOrderIds);
    const taskIdentityRows = await bindInChunks<Record<string, unknown>>(
      db,
      `SELECT
         wt.id,
         wt.order_id,
         ${wtColumn('order_item_id')} AS order_item_id,
         ${wtColumn('product_id')} AS product_id,
         wt.product_name_snapshot,
         ${wtColumn('gender_snapshot')} AS gender_snapshot,
         ${wtColumn('color_snapshot')} AS color_snapshot,
         ${wtColumn('material_snapshot')} AS material_snapshot,
         ${wtColumn('length_snapshot')} AS length_snapshot,
         ${wtColumn('size_snapshot')} AS size_snapshot,
         wt.quantity
       FROM workshop_tasks wt
       WHERE wt.order_id IN (`,
      orderIds,
      ') ORDER BY wt.order_id ASC, wt.id ASC',
    );

    const orderItemRows = await bindInChunks<Record<string, unknown>>(
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
       WHERE oi.order_id IN (`,
      orderIds,
      ') AND COALESCE(oi.quantity, 0) > 0 ORDER BY oi.order_id ASC, oi.id ASC',
    );

    fallbackMatches = matchWorkshopTasksToOrderItems(taskIdentityRows, orderItemRows);
  }

  return taskRows.map(row => {
    const orderId = toInt(row.order_id, 0);
    const taskId = toInt(row.id, 0);
    const directItem = directItemById.get(toInt(row.order_item_id, 0));
    const matchedItem = fallbackOrderIds.has(orderId) ? fallbackMatches.get(taskId) : directItem;
    const matchedAudience = cleanText(matchedItem?.resolved_audience_type);
    const taskSize = cleanText(row.size_snapshot);
    const resolvedAudience = matchedAudience
      || (/(?:ДЕТ|CHILD)/i.test(cleanText(row.gender_snapshot)) || (/^\d{1,2}$/.test(taskSize) && toInt(taskSize, 99) <= 16) ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ');
    return {
      ...row,
      resolved_order_item_id: toInt(matchedItem?.id, 0) || toInt(row.order_item_id, 0) || null,
      product_id: toInt(matchedItem?.product_id, 0) || toInt(row.product_id, 0) || null,
      variant_id: toInt(matchedItem?.resolved_variant_id, 0) || null,
      product_name_snapshot: cleanText(matchedItem?.product_name_snapshot) || cleanText(row.product_name_snapshot),
      resolved_gender: cleanText(matchedItem?.resolved_gender) || cleanText(row.gender_snapshot),
      resolved_color: cleanText(matchedItem?.resolved_color) || cleanText(row.color_snapshot),
      resolved_material: cleanText(matchedItem?.resolved_material) || cleanText(row.material_snapshot),
      resolved_length: cleanText(matchedItem?.resolved_length) || cleanText(row.length_snapshot),
      resolved_size: cleanText(matchedItem?.resolved_size) || taskSize,
      resolved_audience_type: resolvedAudience,
    } as Record<string, unknown>;
  });
}


export const workshopStandaloneReturnOrdersCte = `standalone_return_orders AS (
  SELECT wr.order_id
  FROM returns wr
  WHERE COALESCE(wr.status, 'completed') <> 'cancelled'
    AND NOT EXISTS (
      SELECT 1
      FROM exchanges we
      WHERE we.refund_return_id = wr.id
        AND COALESCE(we.status, 'completed') <> 'cancelled'
    )
  GROUP BY wr.order_id
)`;


export async function readWorkshopCounts(db: D1Database) {
  // Step 173: count the common visible population directly from the existing
  // status indexes, then subtract only tasks belonging to hidden orders. The
  // previous query joined every workshop task to orders and return visibility,
  // which multiplied rows read even though almost all orders are visible.
  const row = await db.prepare(
    `WITH ${workshopStandaloneReturnOrdersCte},
     hidden_orders AS (
       SELECT id AS order_id
       FROM orders
       WHERE order_status IN ('deleted', 'archived')
       UNION
       SELECT order_id FROM standalone_return_orders
     ),
     hidden_counts AS (
       SELECT
         COALESCE(SUM(CASE WHEN wt.status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
         COALESCE(SUM(CASE WHEN wt.status = 'active' AND wt.urgent = 1 THEN 1 ELSE 0 END), 0) AS urgent_count,
         COALESCE(SUM(CASE WHEN wt.status IN ('done', 'ready') THEN 1 ELSE 0 END), 0) AS done_count
       FROM hidden_orders hidden
       JOIN workshop_tasks wt ON wt.order_id = hidden.order_id
     )
     SELECT
       MAX(0, (SELECT COUNT(*) FROM workshop_tasks WHERE status = 'active') - COALESCE(hidden_counts.active_count, 0)) AS active_count,
       MAX(0, (SELECT COUNT(*) FROM workshop_tasks WHERE status = 'active' AND urgent = 1) - COALESCE(hidden_counts.urgent_count, 0)) AS urgent_count,
       MAX(0, (SELECT COUNT(*) FROM workshop_tasks WHERE status = 'done')
         + (SELECT COUNT(*) FROM workshop_tasks WHERE status = 'ready')
         - COALESCE(hidden_counts.done_count, 0)) AS done_count
     FROM hidden_counts`
  ).first<{ active_count: number; urgent_count: number; done_count: number }>();
  return {
    activeCount: Number(row?.active_count || 0),
    urgentCount: Number(row?.urgent_count || 0),
    doneCount: Number(row?.done_count || 0),
  };
}


export async function listWorkshopTasks(db: D1Database, url: URL) {
  const view = normalizeWorkshopViewMode(url.searchParams.get('view'));
  const urgentOnly = ['1', 'true', 'yes', 'да'].includes(cleanText(url.searchParams.get('urgentOnly')).toLowerCase());
  const q = cleanText(url.searchParams.get('q')).toLowerCase();
  const includeCounts = !['0', 'false', 'no'].includes(cleanText(url.searchParams.get('includeCounts')).toLowerCase());
  const limit = Math.min(500, Math.max(20, toInt(url.searchParams.get('limit'), 200)));
  const sortDirection = cleanText(url.searchParams.get('sort')).toLowerCase() === 'newest' ? 'DESC' : 'ASC';
  const { dateFrom, dateTo } = resolveWorkshopPeriod(url);
  const workshopEffectiveDateSql = `COALESCE(ex.exchange_date, o.order_date)`;

  const whereParts: string[] = [];
  const bindings: Array<string | number> = [];

  if (view === 'done') {
    whereParts.push("wt.status IN ('done', 'ready')");
  } else {
    whereParts.push("wt.status = 'active'");
  }

  if (view === 'urgent' || urgentOnly) {
    whereParts.push('wt.urgent = 1');
  }

  if (dateFrom) {
    whereParts.push(`${workshopEffectiveDateSql} >= ?`);
    bindings.push(dateFrom);
  }

  if (dateTo) {
    whereParts.push(`${workshopEffectiveDateSql} <= ?`);
    bindings.push(dateTo);
  }

  const invoiceSiblingSpecialSql = `EXISTS (
    SELECT 1
    FROM workshop_tasks sibling
    WHERE sibling.order_id = wt.order_id
      AND sibling.status = 'active'
      AND (sibling.urgent = 1 OR LENGTH(TRIM(COALESCE(sibling.comment, ''))) > 0)
  )`;
  const orderBySql = view === 'invoice'
    ? `CASE
        WHEN wt.urgent = 1 THEN 0
        WHEN LENGTH(TRIM(COALESCE(wt.comment, ''))) > 0 OR ${invoiceSiblingSpecialSql} THEN 1
        ELSE 2
      END ASC, ${workshopEffectiveDateSql} ${sortDirection}, wt.external_order_id ASC, wt.id ASC`
    : `${workshopEffectiveDateSql} ${sortDirection}, wt.external_order_id ASC, wt.id ASC`;

  // workshop_tasks is intentionally only the workflow/status source here.
  // Product characteristics come from order_items, which is the source used by the order table.
  // Some production databases have a legacy workshop_tasks table without variant_id, so this
  // read path never depends on that column and never mutates the schema while loading a page.
  const workshopColumns = await readTableColumnSet(db, 'workshop_tasks');
  const wtColumn = (name: string) => workshopColumns.has(name.toLowerCase()) ? `wt.${name}` : 'NULL';
  const wtProductIdSql = wtColumn('product_id');
  const wtGenderSql = wtColumn('gender_snapshot');
  const wtColorSql = wtColumn('color_snapshot');
  const wtMaterialSql = wtColumn('material_snapshot');
  const wtLengthSql = wtColumn('length_snapshot');
  const wtSizeSql = wtColumn('size_snapshot');

  const sql = `
    WITH ${workshopStandaloneReturnOrdersCte}
    SELECT
      wt.id,
      wt.order_id,
      ${wtColumn('order_item_id')} AS order_item_id,
      wt.external_order_id,
      ${wtProductIdSql} AS product_id,
      wt.product_name_snapshot,
      ${wtGenderSql} AS gender_snapshot,
      ${wtColorSql} AS color_snapshot,
      ${wtMaterialSql} AS material_snapshot,
      ${wtLengthSql} AS length_snapshot,
      ${wtSizeSql} AS size_snapshot,
      wt.quantity,
      wt.comment,
      wt.urgent,
      wt.due_date,
      wt.status,
      wt.created_at,
      wt.updated_at,
      o.order_date AS original_order_date,
      ${workshopEffectiveDateSql} AS workshop_effective_date,
      o.total_amount,
      o.received_amount,
      o.debt_amount,
      o.shipping_status,
      o.shipping_date,
      CASE WHEN m.id IS NOT NULL THEN m.name
           WHEN NULLIF(TRIM(COALESCE(o.manager_snapshot_name, '')), '') IS NOT NULL THEN o.manager_snapshot_name || ' · исторический менеджер'
           ELSE 'Менеджер требует уточнения'
      END AS manager_name,
      c.phone_normalized AS customer_phone,
      c.display_name AS customer_name,
      o.city,
      o.delivery_type,
      ex.id AS exchange_id,
      ex.exchange_date
    FROM workshop_tasks wt
    JOIN orders o ON o.id = wt.order_id
    LEFT JOIN managers m ON m.id = o.manager_id
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN exchanges ex ON ex.new_order_item_id = ${wtColumn('order_item_id')} AND COALESCE(ex.status, 'completed') = 'completed'
    LEFT JOIN standalone_return_orders returned ON returned.order_id = o.id
    ${whereParts.length ? `WHERE ${whereParts.join(' AND ')} AND o.order_status NOT IN ('deleted', 'archived') AND returned.order_id IS NULL` : `WHERE o.order_status NOT IN ('deleted', 'archived') AND returned.order_id IS NULL`}
    ORDER BY ${orderBySql}
    LIMIT ?`;

  const result = await db.prepare(sql).bind(...bindings, limit).all<Record<string, unknown>>();
  let tasks = await enrichWorkshopTaskRowsFromOrderItems(db, result.results || [], workshopColumns);

  if (q) {
    tasks = tasks.filter(row => {
      const searchable = [
        row.external_order_id,
        row.product_name_snapshot,
        row.resolved_gender,
        row.resolved_color,
        row.resolved_material,
        row.resolved_length,
        row.resolved_size,
        row.comment,
        row.manager_name,
        row.customer_phone,
        row.customer_name,
        row.city,
        row.delivery_type,
        row.workshop_effective_date,
        row.original_order_date,
      ].map(part => cleanText(part).toLowerCase()).join(' ');
      return searchable.includes(q);
    });
  }

  const counts = includeCounts ? await readWorkshopCounts(db) : null;

  return {
    ok: true,
    view,
    period: { dateFrom, dateTo },
    urgentOnly,
    count: tasks.length,
    countsIncluded: Boolean(counts),
    activeCount: counts?.activeCount || 0,
    urgentCount: counts?.urgentCount || 0,
    doneCount: counts?.doneCount || 0,
    tasks: tasks.map(row => ({
      id: toInt(row.id, 0),
      orderId: toInt(row.order_id, 0),
      orderItemId: toInt(row.resolved_order_item_id, 0) || toInt(row.order_item_id, 0) || null,
      externalOrderId: cleanText(row.external_order_id),
      productId: toInt(row.product_id, 0) || null,
      variantId: toInt(row.variant_id, 0) || null,
      productName: cleanText(row.product_name_snapshot),
      gender: cleanText(row.resolved_gender),
      color: cleanText(row.resolved_color),
      material: cleanText(row.resolved_material),
      length: cleanText(row.resolved_length),
      size: cleanText(row.resolved_size),
      audienceType: cleanText(row.resolved_audience_type),
      quantity: toInt(row.quantity, 1),
      comment: workshopOnlyComment(row.comment),
      urgent: Boolean(toInt(row.urgent, 0)),
      dueDate: cleanText(row.due_date),
      status: cleanText(row.status),
      createdAt: cleanText(row.created_at),
      updatedAt: cleanText(row.updated_at),
      orderDate: cleanText(row.workshop_effective_date) || cleanText(row.original_order_date),
      managerName: cleanText(row.manager_name),
      customerPhone: cleanText(row.customer_phone),
      customerName: cleanText(row.customer_name),
      city: cleanText(row.city),
      deliveryType: cleanText(row.delivery_type),
      totalAmount: toInt(row.total_amount, 0),
      receivedAmount: toInt(row.received_amount, 0),
      debtAmount: toInt(row.debt_amount, 0),
      shippingStatus: cleanText(row.shipping_status),
      shippingDate: cleanText(row.shipping_date),
      exchangeId: toInt(row.exchange_id, 0) || null,
      exchangeDate: cleanText(row.exchange_date),
    })),
  };
}


export async function updateWorkshopTask(db: D1Database, id: number, input: { status?: unknown; urgent?: unknown; dueDate?: unknown; comment?: unknown; orderItemId?: unknown }) {
  const existing = await db.prepare(
    `SELECT
       wt.id, wt.order_id, wt.order_item_id, wt.external_order_id, wt.product_id, wt.product_name_snapshot,
       wt.gender_snapshot, wt.color_snapshot, wt.material_snapshot, wt.length_snapshot, wt.size_snapshot,
       wt.status, wt.urgent, wt.due_date, wt.comment, wt.updated_at, o.order_status,
       oi.id AS linked_item_id, oi.order_id AS linked_item_order_id, oi.is_workshop AS linked_item_is_workshop,
       oi.source_type AS linked_item_source_type
     FROM workshop_tasks wt
     JOIN orders o ON o.id = wt.order_id
     LEFT JOIN order_items oi ON oi.id = wt.order_item_id
     WHERE wt.id = ?`
  ).bind(id).first<Record<string, unknown>>();

  if (!existing?.id) {
    throw new Error('Workshop task not found.');
  }
  if (isArchivedOrder(existing)) {
    throw new Error('Нельзя менять цеховую позицию архивного заказа.');
  }

  const timestamp = new Date().toISOString();
  const previousStatus = normalizeWorkshopTaskStatus(existing.status);
  const nextStatus = input.status !== undefined ? normalizeWorkshopTaskStatus(input.status) : previousStatus;
  const nextUrgent = input.urgent !== undefined ? (Boolean(input.urgent) ? 1 : 0) : toInt(existing.urgent, 0);
  const nextDueDate = nextUrgent ? (input.dueDate !== undefined ? normalizeDate(input.dueDate || '') : cleanText(existing.due_date) || null) : null;
  const nextComment = input.comment !== undefined ? cleanText(input.comment) : cleanText(existing.comment);
  const orderId = toInt(existing.order_id, 0);
  const persistedOrderItemId = toInt(existing.order_item_id, 0);
  const submittedOrderItemId = toInt(input.orderItemId, 0);
  const directLinkCount = persistedOrderItemId > 0
    ? toInt((await db.prepare('SELECT COUNT(*) AS count FROM workshop_tasks WHERE order_id = ? AND order_item_id = ?').bind(orderId, persistedOrderItemId).first<{ count: number }>())?.count, 0)
    : 0;
  const uniqueValidDirectLink = persistedOrderItemId > 0
    && directLinkCount === 1
    && toInt(existing.linked_item_id, 0) === persistedOrderItemId
    && toInt(existing.linked_item_order_id, 0) === orderId;

  let orderItemId = uniqueValidDirectLink ? persistedOrderItemId : 0;
  if (!orderItemId || (submittedOrderItemId > 0 && submittedOrderItemId !== orderItemId)) {
    const orderTasks = await db.prepare('SELECT * FROM workshop_tasks WHERE order_id = ? ORDER BY id ASC').bind(orderId).all<Record<string, unknown>>();
    const resolvedTasks = await enrichWorkshopTaskRowsFromOrderItems(db, orderTasks.results || []);
    const resolvedTask = resolvedTasks.find(row => toInt(row.id, 0) === id);
    const resolvedOrderItemId = toInt(resolvedTask?.resolved_order_item_id, 0) || toInt(resolvedTask?.order_item_id, 0);
    if (submittedOrderItemId > 0 && submittedOrderItemId !== resolvedOrderItemId) {
      throw new Error('Позиция цеха изменилась. Обновите страницу и повторите действие.');
    }
    orderItemId = submittedOrderItemId || resolvedOrderItemId;
  }

  const linkedItem = orderItemId > 0
    ? await db.prepare(
      `SELECT
         oi.id, oi.order_id, oi.product_id, oi.product_name_snapshot, oi.is_workshop, oi.stock_writeoff_status, oi.source_type,
         COALESCE(NULLIF(oi.gender_snapshot, ''), NULLIF(cv.gender, '')) AS resolved_gender,
         COALESCE(NULLIF(oi.color_snapshot, ''), NULLIF(cv.color, '')) AS resolved_color,
         COALESCE(NULLIF(oi.material_snapshot, ''), NULLIF(cv.material, '')) AS resolved_material,
         COALESCE(NULLIF(oi.length_snapshot, ''), NULLIF(cv.length, '')) AS resolved_length,
         COALESCE(NULLIF(oi.size_snapshot, ''), NULLIF(cv.size_label, '')) AS resolved_size
       FROM order_items oi
       LEFT JOIN catalog_variants cv ON cv.id = oi.variant_id
       WHERE oi.id = ? AND oi.order_id = ? AND oi.quantity > 0`
    ).bind(orderItemId, orderId).first<Record<string, unknown>>()
    : null;
  const validLinkedItem = Boolean(linkedItem?.id);
  if (submittedOrderItemId > 0 && !validLinkedItem) {
    throw new Error('Связанная позиция заказа не найдена. Обновите страницу.');
  }
  if (validLinkedItem && !uniqueValidDirectLink && !isHighConfidenceWorkshopTaskItemMatch(existing, linkedItem as Record<string, unknown>)) {
    throw new Error('Не удалось однозначно связать задачу цеха с товаром. Обновите данные и передайте заказ администратору для проверки.');
  }

  const currentDueDate = cleanText(existing.due_date);
  const currentComment = cleanText(existing.comment);
  const taskNeedsUpdate = (orderItemId > 0 && orderItemId !== persistedOrderItemId)
    || previousStatus !== nextStatus
    || toInt(existing.urgent, 0) !== nextUrgent
    || currentDueDate !== cleanText(nextDueDate)
    || currentComment !== nextComment;
  const liveLinkedTask = validLinkedItem && ['active', 'ready', 'done'].includes(nextStatus);
  const stockStatus = cleanText(linkedItem?.stock_writeoff_status);
  const itemNeedsRepair = liveLinkedTask && (
    toInt(linkedItem?.is_workshop, 0) !== 1
    || ['', 'none', 'written_off', 'negative', 'pending_writeoff'].includes(stockStatus)
  );
  const statements: D1PreparedStatement[] = [];

  if (taskNeedsUpdate) {
    statements.push(db.prepare(
      `UPDATE workshop_tasks
       SET order_item_id = CASE WHEN ? > 0 THEN ? ELSE order_item_id END,
           status = ?, urgent = ?, due_date = ?, comment = ?, updated_at = ?
       WHERE id = ?`
    ).bind(orderItemId, orderItemId, nextStatus, nextUrgent, nextDueDate, nextComment || null, timestamp, id));
  }

  // Step 161 invariant: a live task linked to an order item is itself the proof
  // that this exact line is a workshop line. Repair only that linked line; never
  // touch a neighbouring item with similar characteristics.
  if (itemNeedsRepair) {
    statements.push(db.prepare(
      `UPDATE order_items
       SET is_workshop = 1,
           stock_writeoff_status = CASE
             WHEN COALESCE(stock_writeoff_status, '') IN ('', 'none', 'written_off', 'negative', 'pending_writeoff') THEN 'workshop'
             ELSE stock_writeoff_status
           END
       WHERE id = ? AND order_id = ?`
    ).bind(orderItemId, orderId));
  }

  if (statements.length) await db.batch(statements);
  const orderStatusChanged = previousStatus !== nextStatus
    ? await refreshOrderWorkshopStatusFromTasks(db, orderId, timestamp)
    : false;
  const changed = taskNeedsUpdate || itemNeedsRepair || orderStatusChanged;
  const task = {
    id,
    order_id: orderId,
    order_item_id: orderItemId || persistedOrderItemId || null,
    external_order_id: cleanText(existing.external_order_id),
    product_name_snapshot: cleanText(existing.product_name_snapshot),
    status: nextStatus,
    urgent: nextUrgent,
    due_date: nextDueDate,
    updated_at: taskNeedsUpdate ? timestamp : cleanText(existing.updated_at),
  };

  return {
    ok: true,
    changed,
    task,
    previousStatus,
    preservedOrderItemId: validLinkedItem ? orderItemId : null,
  };

}

export async function bulkUpdateWorkshopTasks(
  db: D1Database,
  input: { ids?: unknown; status?: unknown; urgent?: unknown; dueDate?: unknown; comment?: unknown },
) {
  const ids = Array.isArray(input.ids)
    ? Array.from(new Set(input.ids.map(id => toInt(id, 0)).filter(id => id > 0))).slice(0, 300)
    : [];

  if (!ids.length) {
    throw new Error('Выберите позиции цеха.');
  }

  const timestamp = new Date().toISOString();
  const idsJson = JSON.stringify(ids);
  const existing = await db.prepare(
    `SELECT
       wt.id, wt.order_id, wt.order_item_id, wt.status, wt.urgent, wt.due_date, wt.comment,
       oi.id AS linked_item_id, oi.order_id AS linked_item_order_id
     FROM workshop_tasks wt
     LEFT JOIN order_items oi ON oi.id = wt.order_item_id
     WHERE wt.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
  ).bind(idsJson).all<Record<string, unknown>>();
  const rows = existing.results || [];

  if (!rows.length) {
    throw new Error('Позиции цеха не найдены.');
  }

  const nextStatusProvided = input.status !== undefined;
  const nextUrgentProvided = input.urgent !== undefined;
  const nextDueDateProvided = input.dueDate !== undefined;
  const nextCommentProvided = input.comment !== undefined;
  const updates = rows.map(row => {
    const nextStatus = nextStatusProvided ? normalizeWorkshopTaskStatus(input.status) : normalizeWorkshopTaskStatus(row.status);
    const nextUrgent = nextUrgentProvided ? (Boolean(input.urgent) ? 1 : 0) : toInt(row.urgent, 0);
    const nextDueDate = nextUrgent
      ? (nextDueDateProvided ? (cleanText(input.dueDate) ? normalizeDate(input.dueDate) : null) : cleanText(row.due_date) || null)
      : null;
    const nextComment = nextCommentProvided ? cleanText(input.comment) : cleanText(row.comment);
    const orderId = toInt(row.order_id, 0);
    const orderItemId = toInt(row.order_item_id, 0);
    const validLinkedItem = orderItemId > 0
      && toInt(row.linked_item_id, 0) === orderItemId
      && toInt(row.linked_item_order_id, 0) === orderId;
    return {
      id: toInt(row.id, 0),
      orderId,
      orderItemId,
      status: nextStatus,
      urgent: nextUrgent,
      dueDate: nextDueDate,
      comment: nextComment || null,
      promoteWorkshopItem: validLinkedItem && ['active', 'ready', 'done'].includes(nextStatus) ? 1 : 0,
    };
  });
  // Step 191E: keep the 300-row UI capacity but stop reusing one json_each(?) rowset across
  // multiple mutation statements. Each row is one compact JSON bind in an ordinary VALUES CTE;
  // 70-row chunks stay below D1's 100-bind ceiling and all chunks remain in one atomic batch.
  const statements: D1PreparedStatement[] = [];
  for (const updateChunk of chunksOf(updates, 70)) {
    const rowBindings = updateChunk.map(row => JSON.stringify(row));
    const valuesSql = rowBindings.map(() => '(?)').join(', ');
    const rowsSql = `input(payload) AS (VALUES ${valuesSql}),
      x AS (
        SELECT CAST(json_extract(payload, '$.id') AS INTEGER) AS id,
               CAST(json_extract(payload, '$.orderId') AS INTEGER) AS order_id,
               CAST(json_extract(payload, '$.orderItemId') AS INTEGER) AS order_item_id,
               CAST(json_extract(payload, '$.status') AS TEXT) AS status,
               CAST(json_extract(payload, '$.urgent') AS INTEGER) AS urgent,
               json_extract(payload, '$.dueDate') AS due_date,
               json_extract(payload, '$.comment') AS comment,
               CAST(json_extract(payload, '$.promoteWorkshopItem') AS INTEGER) AS promote_workshop_item
        FROM input
      )`;

    statements.push(
      db.prepare(
        `WITH ${rowsSql}
         UPDATE workshop_tasks
         SET status = (SELECT status FROM x WHERE x.id = workshop_tasks.id),
             urgent = (SELECT urgent FROM x WHERE x.id = workshop_tasks.id),
             due_date = (SELECT due_date FROM x WHERE x.id = workshop_tasks.id),
             comment = (SELECT comment FROM x WHERE x.id = workshop_tasks.id),
             updated_at = ?
         WHERE EXISTS (SELECT 1 FROM x WHERE x.id = workshop_tasks.id)`
      ).bind(...rowBindings, timestamp),
      db.prepare(
        `WITH ${rowsSql}
         UPDATE order_items
         SET is_workshop = 1,
             stock_writeoff_status = CASE
               WHEN COALESCE(stock_writeoff_status, '') IN ('', 'none', 'written_off', 'negative', 'pending_writeoff') THEN 'workshop'
               ELSE stock_writeoff_status
             END
         WHERE EXISTS (
           SELECT 1 FROM x
           WHERE x.promote_workshop_item = 1
             AND x.order_item_id = order_items.id
             AND x.order_id = order_items.order_id
         )`
      ).bind(...rowBindings),
      db.prepare(
        `WITH ${rowsSql},
         affected_orders AS (
           SELECT DISTINCT order_id FROM x WHERE order_id > 0
         ),
         state AS (
           SELECT o.id,
                  CASE WHEN COALESCE(SUM(CASE WHEN wt.status = 'active' THEN 1 ELSE 0 END), 0) > 0 THEN 'in_workshop' ELSE 'ready' END AS next_status,
                  COUNT(wt.id) AS task_count
           FROM orders o
           JOIN affected_orders a ON a.order_id = o.id
           LEFT JOIN workshop_tasks wt ON wt.order_id = o.id
           GROUP BY o.id
         )
         UPDATE orders
         SET workshop_status = (SELECT next_status FROM state WHERE state.id = orders.id),
             updated_at = ?
         WHERE EXISTS (
           SELECT 1 FROM state
           WHERE state.id = orders.id
             AND state.task_count > 0
             AND COALESCE(orders.workshop_status, '') <> state.next_status
         )`
      ).bind(...rowBindings, timestamp),
    );
  }

  await db.batch(statements);

  const orderIds = Array.from(new Set(updates.map(row => row.orderId).filter(id => id > 0)));
  return {
    ok: true,
    updated: rows.length,
    orderIds,
  };
}
