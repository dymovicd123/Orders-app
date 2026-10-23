// Stage05 v2: read-only demand by shipped order cohort; never reads inventory_stock.
// The current order-item snapshot may include later exchanges, so this is not an immutable
// sale-event ledger. We explicitly disclose that limitation in the response and UI.
const demandBaseSql = String.raw`
WITH returns_by_item AS (
  SELECT ri.order_item_id, SUM(ri.quantity) AS returned_qty
  FROM return_items ri
  JOIN returns r ON r.id = ri.return_id
  WHERE r.return_date <= ?
    AND COALESCE(r.status, 'completed') <> 'cancelled'
    AND NOT EXISTS (
      SELECT 1 FROM exchanges e
      WHERE e.refund_return_id = r.id
        AND COALESCE(e.status, 'completed') <> 'cancelled'
    )
  GROUP BY ri.order_item_id
), sale_lines AS (
  SELECT
    oi.id AS item_id, o.id AS order_id, o.external_id AS external_id,
    SUBSTR(o.shipping_date, 1, 10) AS shipped_at,
    o.total_amount AS order_total,
    COALESCE(NULLIF(TRIM(oi.product_name_snapshot), ''), 'Без названия') AS product,
    COALESCE(NULLIF(TRIM(oi.color_snapshot), ''), 'Не указан') AS color,
    COALESCE(NULLIF(TRIM(oi.size_snapshot), ''), 'Не указан') AS size,
    COALESCE(NULLIF(TRIM(oi.material_snapshot), ''), 'Не указан') AS material,
    COALESCE(NULLIF(TRIM(oi.length_snapshot), ''), 'Не указана') AS length,
    COALESCE(NULLIF(TRIM(oi.gender_snapshot), ''), 'Не указан') AS gender,
    COALESCE(NULLIF(TRIM(oi.audience_type), ''), 'unknown') AS category,
    CASE WHEN oi.is_workshop = 1 THEN 'workshop'
      ELSE COALESCE(NULLIF(oi.source_type, ''), 'warehouse') END AS source,
    CAST(oi.quantity AS INTEGER) AS sold,
    MIN(CAST(oi.quantity AS INTEGER), MAX(0, COALESCE(rb.returned_qty, 0))) AS returned,
    CASE
      WHEN oi.unit_price > 0 OR
        (COALESCE(o.pricing_mode, '') = 'itemized_v1' AND oi.unit_price = 0)
      THEN CAST(oi.unit_price AS INTEGER)
      ELSE NULL
    END AS recorded_price,
    CASE WHEN oi.unit_price > 0 AND oi.line_total <> oi.quantity * oi.unit_price
      THEN 1 ELSE 0 END AS price_discrepancy
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  LEFT JOIN returns_by_item rb ON rb.order_item_id = oi.id
  WHERE o.order_status <> 'deleted'
    AND (
      (? = 'orders' AND o.order_date BETWEEN ? AND ?)
      OR (? = 'shipped' AND o.shipping_status = 'sent'
        AND SUBSTR(o.shipping_date, 1, 10) BETWEEN ? AND ?)
    )
    AND oi.quantity > 0
    AND COALESCE(oi.stock_writeoff_status, '') NOT IN
      ('cancelled', 'replaced_edit', 'reversed_delete')
)
`;
export const warehouseDemandSql = demandBaseSql + String.raw`
SELECT product, color, size, material, length, gender, category, source,
       SUM(sold) AS sold,
       SUM(returned) AS returned,
       SUM(sold - returned) AS net,
       SUM(CASE WHEN recorded_price IS NOT NULL THEN sold - returned ELSE 0 END) AS priced_quantity,
       SUM(CASE WHEN recorded_price IS NOT NULL THEN (sold - returned) * recorded_price ELSE 0 END) AS known_revenue,
       SUM(CASE WHEN price_discrepancy = 1 THEN sold - returned ELSE 0 END) AS price_discrepancy_quantity,
       MIN(CASE WHEN recorded_price IS NOT NULL THEN recorded_price END) AS min_price,
       MAX(CASE WHEN recorded_price IS NOT NULL THEN recorded_price END) AS max_price
FROM sale_lines
GROUP BY product, color, size, material, length, gender, category, source
ORDER BY sold DESC, product ASC, color ASC, size ASC
LIMIT 6001
`;
export const warehouseDemandOrdersSql = demandBaseSql + String.raw`
SELECT item_id, order_id, external_id, shipped_at, product, color, size, material,
       length, gender, category, source, sold, returned, sold - returned AS net,
       recorded_price, price_discrepancy, order_total
FROM sale_lines
WHERE product = ? AND color = ? AND size = ? AND material = ?
  AND length = ? AND gender = ? AND category = ? AND source = ?
ORDER BY shipped_at DESC, item_id DESC
LIMIT 51 OFFSET ?
`;

type DemandRow = Record<string, string | number | null>;
const num = (n: unknown) => Math.max(0, Number(n) || 0);
const txt = (n: unknown) => String(n ?? '').trim();
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day)
  && !Number.isNaN(Date.parse(day + 'T00:00:00Z'))
  && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;

export async function listWarehouseDemand(db: D1Database, url: URL) {
  const start = txt(url.searchParams.get('start'));
  const end = txt(url.searchParams.get('end'));
  if (!validDay(start) || !validDay(end) || start > end)
    return { ok: false, message: 'Проверьте даты отчёта.' };
  if (Date.parse(end) - Date.parse(start) > 366 * 86400000)
    return { ok: false, message: 'Выберите период не более одного года.' };

  const scope = url.searchParams.get('scope') === 'shipped' ? 'shipped' : 'orders';
  const binds: [string, string, string, string, string, string, string] = [end, scope, start, end, scope, start, end];

  if (url.searchParams.get('mode') === 'orders') {
    const fields = ['product', 'color', 'size', 'material', 'length', 'gender', 'category', 'source'] as const;
    const values = fields.map(key => txt(url.searchParams.get(key)));
    if (values.some(value => !value || value.length > 250))
      return { ok: false, message: 'Выберите конкретный вариант товара.' };
    const rawOffset = Number(url.searchParams.get('offset') ?? '0');
    if (!Number.isSafeInteger(rawOffset) || rawOffset < 0 || rawOffset > 10000)
      return { ok: false, message: 'Некорректная страница списка заказов.' };
    const result = await db.prepare(warehouseDemandOrdersSql)
      .bind(...binds, ...values, rawOffset).all<DemandRow>();
    const rows = result.results || [];
    return { ok: true, mode: 'orders', hasMore: rows.length > 50, nextOffset: rawOffset + 50,
      orders: rows.slice(0, 50).map(row => ({
        itemId: num(row.item_id), orderId: num(row.order_id),
        externalId: txt(row.external_id), shippedAt: txt(row.shipped_at),
        product: txt(row.product), color: txt(row.color), size: txt(row.size),
        material: txt(row.material), length: txt(row.length), gender: txt(row.gender),
        category: txt(row.category), source: txt(row.source),
        sold: num(row.sold), returned: num(row.returned), net: num(row.net),
        unitPrice: row.recorded_price === null ? null : num(row.recorded_price),
        priceDiscrepancy: Boolean(num(row.price_discrepancy)),
        orderTotal: num(row.order_total),
      })) };
  }

  const [result, counters] = await Promise.all([
    db.prepare(warehouseDemandSql).bind(...binds).all<DemandRow>(),
    db.prepare(`SELECT COUNT(*) AS all_orders,
      COALESCE(SUM(CASE WHEN shipping_status = 'sent' THEN 1 ELSE 0 END), 0) AS sent_orders
      FROM orders WHERE order_date BETWEEN ? AND ? AND order_status <> 'deleted'`)
      .bind(start, end).first<{ all_orders: number; sent_orders: number }>(),
  ]);
  const raw = result.results || [];
  const truncated = raw.length > 6000;
  const rows = truncated ? [] : raw.map(row => ({
    product: txt(row.product), color: txt(row.color), size: txt(row.size),
    material: txt(row.material), length: txt(row.length), gender: txt(row.gender),
    category: txt(row.category), source: txt(row.source),
    sold: num(row.sold), returned: num(row.returned), net: num(row.net),
    pricedQuantity: num(row.priced_quantity), knownRevenue: num(row.known_revenue),
    priceDiscrepancyQuantity: num(row.price_discrepancy_quantity),
    minPrice: row.min_price === null ? null : num(row.min_price),
    maxPrice: row.max_price === null ? null : num(row.max_price),
  }));
  return { ok: true, mode: 'summary', scope, start, end, truncated, rows,
    periodOrderCount: num(counters?.all_orders),
    periodShippedOrderCount: num(counters?.sent_orders),
    method: scope === 'orders' ? 'created_order_cohort_current_items' : 'shipped_order_cohort_current_items',
    note: scope === 'orders'
      ? 'Спрос по дате оформления: включены все не удалённые заказы, в том числе ещё не отправленные. Эти количества нельзя называть фактическими продажами. Обмены меняют текущий состав заказов. Сумма по сохранённым ценам позиций — не оплата и не прибыль.'
      : 'Выданные товары по дате отправки. Обмены, внесённые позднее, могут изменить прошлый период. Возвраты учитываются до конца выбранного периода. Цена берётся из сохранённой unit_price, сумма — не поступление денег.' };
}
