// Stage05: read-only demand statistics for shipped orders. This module never reads inventory_stock.
// Its date axis is the actual order shipping date, not creation date.
export const warehouseDemandSql = String.raw`
WITH returns_by_item AS (
  SELECT ri.order_item_id, SUM(ri.quantity) AS returned_qty
  FROM return_items ri
  JOIN returns r ON r.id = ri.return_id
  WHERE r.return_date <= ?
    AND COALESCE(r.status, 'completed') <> 'cancelled'
    AND NOT EXISTS (
      SELECT 1 FROM exchanges e
      WHERE e.refund_return_id = r.id AND COALESCE(e.status, 'completed') <> 'cancelled'
    )
  GROUP BY ri.order_item_id
),
sale_lines AS (
  SELECT
    TRIM(COALESCE(oi.product_name_snapshot, '')) AS product,
    TRIM(COALESCE(oi.color_snapshot, '')) AS color,
    TRIM(COALESCE(oi.size_snapshot, '')) AS size,
    TRIM(COALESCE(oi.material_snapshot, '')) AS material,
    TRIM(COALESCE(oi.length_snapshot, '')) AS length,
    TRIM(COALESCE(oi.gender_snapshot, '')) AS gender,
    COALESCE(NULLIF(TRIM(oi.audience_type), ''), 'unknown') AS category,
    CASE WHEN oi.is_workshop = 1 THEN 'workshop'
      ELSE COALESCE(NULLIF(oi.source_type, ''), 'warehouse') END AS source,
    CAST(oi.quantity AS INTEGER) AS sold,
    MIN(CAST(oi.quantity AS INTEGER), MAX(0, COALESCE(rb.returned_qty, 0))) AS returned,
    CASE WHEN oi.unit_price > 0
      AND oi.line_total = oi.quantity * oi.unit_price
      THEN CAST(oi.unit_price AS INTEGER) ELSE NULL END AS proven_price,
    oi.order_id
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  LEFT JOIN returns_by_item rb ON rb.order_item_id = oi.id
  WHERE o.shipping_status = 'sent'
    AND o.order_status <> 'deleted'
    AND SUBSTR(o.shipping_date, 1, 10) BETWEEN ? AND ?
    AND oi.quantity > 0
    AND COALESCE(oi.stock_writeoff_status, '') NOT IN ('cancelled', 'replaced_edit', 'reversed_delete')
)
SELECT product, color, size, material, length, gender, category, source,
       SUM(sold) AS sold,
       SUM(returned) AS returned,
       SUM(sold - returned) AS net,
       SUM(CASE WHEN proven_price IS NULL THEN 0 ELSE sold - returned END) AS priced_quantity,
       SUM(CASE WHEN proven_price IS NULL THEN 0 ELSE (sold - returned) * proven_price END) AS known_revenue,
       COUNT(DISTINCT order_id) AS orders_count
FROM sale_lines
GROUP BY product, color, size, material, length, gender, category, source
ORDER BY sold DESC, product ASC, color ASC, size ASC
LIMIT 6001`;

type DemandRow = Record<string, string | number | null>;
const asNumber = (value: unknown) => Math.max(0, Number(value) || 0);
const asText = (value: unknown) => String(value ?? '').trim();

export async function listWarehouseDemand(db: D1Database, url: URL) {
  const start = asText(url.searchParams.get('start'));
  const end = asText(url.searchParams.get('end'));
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(date + 'T00:00:00Z'))
    && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
  if (!validDate(start) || !validDate(end) || start > end)
    return { ok: false, message: 'Проверьте даты отчёта.' };
  if (Date.parse(end) - Date.parse(start) > 366 * 86400000)
    return { ok: false, message: 'Выберите период не более одного года.' };

  const result = await db.prepare(warehouseDemandSql).bind(end, start, end).all<DemandRow>();
  const raw = result.results || [];
  // Never silently publish an incomplete ranking as if it represented the whole period.
  const truncated = raw.length > 6000;
  const rows = truncated ? [] : raw.map(row => ({
    product: asText(row.product) || 'Без названия',
    color: asText(row.color) || 'Не указан',
    size: asText(row.size) || 'Не указан',
    material: asText(row.material) || 'Не указан',
    length: asText(row.length) || 'Не указана',
    gender: asText(row.gender) || 'Не указан',
    category: asText(row.category) || 'unknown',
    source: asText(row.source),
    sold: asNumber(row.sold),
    returned: asNumber(row.returned),
    net: asNumber(row.net),
    pricedQuantity: asNumber(row.priced_quantity),
    knownRevenue: asNumber(row.known_revenue),
    ordersCount: asNumber(row.orders_count),
  }));
  return { ok: true, start, end, truncated, rows,
    method: 'shipped_order_cohort',
    note: 'Продажи по дате отправки заказа. Состав заказа учитывает проведённые обмены; возвраты учтены до конца выбранного периода. Денежные показатели доступны только по строкам с подтверждённой ценой.' };
}
