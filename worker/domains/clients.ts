// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { json } from '../core/http.ts'
import { mapSqlRows } from '../core/sql.ts'
import { cleanText, normalizePhone, toInt } from '../core/text.ts'
import type { OrderListRow } from '../core/types.ts'
import { normalizeManagerColor } from './activity.ts'
import { fetchOrderRelations, workshopTaskStatusForOrderItem } from './orders-relations.ts'

export type ClientMode = 'all' | 'repeat' | 'debt';


export function normalizeClientMode(value: unknown): ClientMode {
  const text = cleanText(value).toLowerCase();
  if (text === 'repeat' || text === 'regular' || text === 'permanent') return 'repeat';
  if (text === 'debt' || text === 'debts') return 'debt';
  return 'all';
}


export function clientStatsCte() {
  return `
    WITH order_history AS (
      SELECT
        o.customer_id,
        o.order_date,
        o.total_amount,
        o.received_amount,
        o.debt_amount,
        o.return_amount,
        o.order_status,
        o.city,
        COALESCE(NULLIF(m.name, ''), NULLIF(o.manager_snapshot_name, ''), '') AS manager_name
      FROM orders o
      LEFT JOIN managers m ON m.id = o.manager_id
      WHERE o.order_status <> 'deleted'
      UNION ALL
      SELECT
        s.customer_id,
        s.order_date,
        s.total_amount,
        s.received_amount,
        s.debt_amount,
        s.return_amount,
        'archived' AS order_status,
        s.city,
        COALESCE(s.manager_name, '') AS manager_name
      FROM retained_order_summaries s
      WHERE s.customer_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM orders current_order WHERE current_order.id = s.original_order_id)
    ),
    stats AS (
      SELECT
        c.id,
        c.phone_normalized,
        COALESCE(c.display_name, '') AS display_name,
        COALESCE(NULLIF(c.city, ''), '') AS customer_city,
        COUNT(h.order_date) AS order_count,
        COALESCE(SUM(h.total_amount), 0) AS total_amount,
        COALESCE(SUM(h.received_amount), 0) AS received_amount,
        COALESCE(SUM(h.debt_amount), 0) AS debt_amount,
        COALESCE(SUM(h.return_amount), 0) AS return_amount,
        MIN(h.order_date) AS first_order_at,
        MAX(h.order_date) AS last_order_at,
        SUM(CASE WHEN h.order_status = 'archived' THEN 1 ELSE 0 END) AS archived_order_count,
        SUM(CASE WHEN h.order_status <> 'archived' THEN 1 ELSE 0 END) AS active_order_count,
        GROUP_CONCAT(DISTINCT COALESCE(NULLIF(h.city, ''), NULL)) AS cities,
        GROUP_CONCAT(DISTINCT COALESCE(NULLIF(h.manager_name, ''), NULL)) AS managers
      FROM customers c
      LEFT JOIN order_history h ON h.customer_id = c.id
      WHERE COALESCE(c.is_active, 1) = 1
      GROUP BY c.id
    )`;
}


export function buildClientWhere(mode: ClientMode, q: string) {
  const whereParts = ['order_count > 0'];
  const bindings: Array<string | number> = [];

  if (mode === 'repeat') {
    whereParts.push('order_count >= 2');
  } else if (mode === 'debt') {
    whereParts.push('debt_amount > 0');
  }

  if (q) {
    const qRaw = q;
    const qUpper = q.toUpperCase();
    const qLower = q.toLowerCase();
    const phone = normalizePhone(q);
    whereParts.push(`(
      INSTR(phone_normalized, ?) > 0
      OR INSTR(display_name, ?) > 0 OR INSTR(display_name, ?) > 0 OR INSTR(display_name, ?) > 0
      OR INSTR(customer_city, ?) > 0 OR INSTR(customer_city, ?) > 0 OR INSTR(customer_city, ?) > 0
      OR INSTR(COALESCE(cities, ''), ?) > 0 OR INSTR(COALESCE(cities, ''), ?) > 0 OR INSTR(COALESCE(cities, ''), ?) > 0
      OR INSTR(COALESCE(managers, ''), ?) > 0 OR INSTR(COALESCE(managers, ''), ?) > 0 OR INSTR(COALESCE(managers, ''), ?) > 0
    )`);
    bindings.push(phone || qRaw, qRaw, qUpper, qLower, qRaw, qUpper, qLower, qRaw, qUpper, qLower, qRaw, qUpper, qLower);
  }

  return { whereSql: whereParts.join(' AND '), bindings };
}


export function clientOrderBy(mode: ClientMode) {
  if (mode === 'debt') return 'debt_amount DESC, last_order_at DESC, order_count DESC';
  if (mode === 'repeat') return 'order_count DESC, total_amount DESC, last_order_at DESC';
  return 'last_order_at DESC, order_count DESC, total_amount DESC';
}


export function splitConcatList(value: unknown) {
  return cleanText(value)
    .split(',')
    .map(item => cleanText(item))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}


export async function getClientsSummary(db: D1Database) {
  const row = await db.prepare(`
    ${clientStatsCte()}
    SELECT
      COUNT(*) AS total_clients,
      SUM(CASE WHEN order_count >= 2 THEN 1 ELSE 0 END) AS repeat_clients,
      SUM(CASE WHEN debt_amount > 0 THEN 1 ELSE 0 END) AS debt_clients,
      COALESCE(SUM(debt_amount), 0) AS total_debt,
      COALESCE(SUM(total_amount), 0) AS total_sales,
      COALESCE(SUM(received_amount), 0) AS total_received,
      COALESCE(SUM(return_amount), 0) AS total_returns,
      COALESCE(SUM(order_count), 0) AS order_count,
      COALESCE(SUM(archived_order_count), 0) AS archived_order_count,
      COALESCE(SUM(active_order_count), 0) AS active_order_count
    FROM stats
    WHERE order_count > 0`
  ).first<Record<string, unknown>>();

  const orderCount = toInt(row?.order_count, 0);
  const totalSales = toInt(row?.total_sales, 0);
  return {
    totalClients: toInt(row?.total_clients, 0),
    repeatClients: toInt(row?.repeat_clients, 0),
    debtClients: toInt(row?.debt_clients, 0),
    totalDebt: toInt(row?.total_debt, 0),
    totalSales,
    totalReceived: toInt(row?.total_received, 0),
    totalReturns: toInt(row?.total_returns, 0),
    orderCount,
    activeOrderCount: toInt(row?.active_order_count, 0),
    archivedOrderCount: toInt(row?.archived_order_count, 0),
    avgCheck: orderCount > 0 ? Math.round(totalSales / orderCount) : 0,
  };
}


export async function listClients(db: D1Database, url: URL) {
  const mode = normalizeClientMode(url.searchParams.get('mode'));
  const q = cleanText(url.searchParams.get('q'));
  const limit = Math.min(60, Math.max(10, toInt(url.searchParams.get('limit'), 60)));
  const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0));
  const { whereSql, bindings } = buildClientWhere(mode, q);
  const cte = clientStatsCte();

  const [summary, countRow, rows] = await Promise.all([
    getClientsSummary(db),
    db.prepare(`${cte} SELECT COUNT(*) AS count FROM stats WHERE ${whereSql}`).bind(...bindings).first<{ count: number }>(),
    db.prepare(`
      ${cte}
      SELECT
        id,
        phone_normalized,
        display_name,
        COALESCE(NULLIF(customer_city, ''), COALESCE(cities, '')) AS city,
        order_count,
        total_amount,
        received_amount,
        debt_amount,
        return_amount,
        first_order_at,
        last_order_at,
        active_order_count,
        archived_order_count,
        COALESCE(cities, '') AS cities,
        COALESCE(managers, '') AS managers
      FROM stats
      WHERE ${whereSql}
      ORDER BY ${clientOrderBy(mode)}
      LIMIT ? OFFSET ?`
    ).bind(...bindings, limit, offset).all<Record<string, unknown>>(),
  ]);

  const clientRows = rows.results || [];
  const clientIds = clientRows.map((row) => toInt(row.id, 0)).filter(Boolean);
  const managerProfilesByClient = new Map<number, Array<{ id: number; name: string; colorKey: string }>>();
  if (clientIds.length) {
    // D1 has a bound-variable limit. Read manager badges in small chunks instead
    // of building one oversized IN(...) request for the whole client page.
    const chunkSize = 20;
    for (let start = 0; start < clientIds.length; start += chunkSize) {
      const chunk = clientIds.slice(start, start + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const profileRows = await db.prepare(
        `WITH manager_history AS (
           SELECT o.customer_id, m.id AS manager_id, m.name AS manager_name, COALESCE(m.color_key, '#475569') AS color_key
           FROM orders o
           JOIN managers m ON m.id = o.manager_id
           WHERE o.customer_id IN (${placeholders}) AND o.order_status <> 'deleted'
           UNION
           SELECT s.customer_id, m.id AS manager_id,
                  COALESCE(NULLIF(m.name, ''), NULLIF(s.manager_name, '')) AS manager_name,
                  COALESCE(m.color_key, '#475569') AS color_key
           FROM retained_order_summaries s
           LEFT JOIN managers m ON m.id = s.manager_id
           WHERE s.customer_id IN (${placeholders}) AND m.id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM orders current_order WHERE current_order.id = s.original_order_id)
         )
         SELECT DISTINCT customer_id, manager_id, manager_name, color_key
         FROM manager_history
         ORDER BY customer_id, manager_name, manager_id`
      ).bind(...chunk, ...chunk).all<any>();
      for (const row of mapSqlRows(profileRows)) {
        const clientId = toInt((row as any).customer_id, 0);
        if (!managerProfilesByClient.has(clientId)) managerProfilesByClient.set(clientId, []);
        managerProfilesByClient.get(clientId)!.push({
          id: toInt((row as any).manager_id, 0),
          name: cleanText((row as any).manager_name),
          colorKey: normalizeManagerColor((row as any).color_key, toInt((row as any).manager_id, 0) - 1),
        });
      }
    }
  }

  return {
    ok: true,
    mode,
    q,
    limit,
    offset,
    count: toInt(countRow?.count, 0),
    summary,
    clients: clientRows.map(row => ({
      id: toInt(row.id, 0),
      phone: cleanText(row.phone_normalized),
      name: cleanText(row.display_name),
      city: cleanText(row.city),
      cities: splitConcatList(row.cities),
      managers: splitConcatList(row.managers),
      managerProfiles: managerProfilesByClient.get(toInt(row.id, 0)) || [],
      orderCount: toInt(row.order_count, 0),
      totalAmount: toInt(row.total_amount, 0),
      receivedAmount: toInt(row.received_amount, 0),
      debtAmount: toInt(row.debt_amount, 0),
      returnAmount: toInt(row.return_amount, 0),
      firstOrderAt: cleanText(row.first_order_at),
      lastOrderAt: cleanText(row.last_order_at),
      activeOrderCount: toInt(row.active_order_count, 0),
      archivedOrderCount: toInt(row.archived_order_count, 0),
      avgCheck: toInt(row.order_count, 0) > 0 ? Math.round(toInt(row.total_amount, 0) / toInt(row.order_count, 1)) : 0,
    })),
  };
}


export async function getClientDetails(db: D1Database, clientId: number, url: URL) {
  const limit = Math.min(80, Math.max(20, toInt(url.searchParams.get('limit'), 40)));
  const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0));
  const cte = clientStatsCte();

  const stats = await db.prepare(`
    ${cte}
    SELECT * FROM stats WHERE id = ? AND order_count > 0 LIMIT 1`
  ).bind(clientId).first<Record<string, unknown>>();

  if (!stats?.id) {
    return json({ ok: false, message: 'Клиент не найден.' }, { status: 404 });
  }

  const [ordersResult, managerRows] = await Promise.all([
    db.prepare(
      `WITH client_history AS (
         SELECT
           o.id AS id, o.id AS original_order_id, 0 AS retained_only, NULL AS retained_summary_text,
           0 AS retained_payment_count, 0 AS retained_return_count,
           o.external_id, o.order_date, o.manager_id,
           CASE WHEN m.id IS NOT NULL THEN m.name WHEN NULLIF(TRIM(COALESCE(o.manager_snapshot_name, '')), '') IS NOT NULL THEN o.manager_snapshot_name || ' · исторический менеджер' ELSE 'Менеджер требует уточнения' END AS manager_name,
           o.manager_snapshot_name, COALESCE(m.color_key, '#64748B') AS manager_color,
           c.phone_normalized AS customer_phone, c.display_name AS customer_name,
           o.city, o.delivery_type, o.source_type, o.workshop_status, o.order_status,
           o.shipping_status, o.shipping_date,
           o.total_amount, o.received_amount, o.debt_amount, o.return_amount, o.comment,
           o.archived_at, o.archived_by, o.archive_reason, o.archive_batch_id
         FROM orders o
         LEFT JOIN managers m ON m.id = o.manager_id
         LEFT JOIN customers c ON c.id = o.customer_id
         WHERE o.customer_id = ? AND o.order_status <> 'deleted'
         UNION ALL
         SELECT
           -ABS(s.original_order_id) AS id, s.original_order_id, 1 AS retained_only, s.item_summary AS retained_summary_text,
           s.payment_count AS retained_payment_count, s.return_count AS retained_return_count,
           s.external_id, s.order_date, s.manager_id,
           COALESCE(NULLIF(s.manager_name, ''), 'Исторический менеджер') AS manager_name,
           s.manager_name AS manager_snapshot_name, COALESCE(m.color_key, '#64748B') AS manager_color,
           COALESCE(s.customer_phone, c.phone_normalized) AS customer_phone,
           COALESCE(s.customer_name, c.display_name) AS customer_name,
           s.city, s.delivery_type, s.source_type, '' AS workshop_status, 'archived' AS order_status,
           s.shipping_status, s.shipping_date,
           s.total_amount, s.received_amount, s.debt_amount, s.return_amount,
           'Сохранена краткая история после очистки старого месяца.' AS comment,
           s.retained_at AS archived_at, NULL AS archived_by,
           'Краткая история после очистки' AS archive_reason, NULL AS archive_batch_id
         FROM retained_order_summaries s
         LEFT JOIN managers m ON m.id = s.manager_id
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.customer_id = ?
           AND NOT EXISTS (SELECT 1 FROM orders current_order WHERE current_order.id = s.original_order_id)
       )
       SELECT * FROM client_history
       ORDER BY order_date DESC, original_order_id DESC
       LIMIT ? OFFSET ?`
    ).bind(clientId, clientId, limit, offset).all<OrderListRow & Record<string, unknown>>(),
    db.prepare(
      `WITH manager_history AS (
         SELECT o.customer_id, m.id, m.name, COALESCE(m.color_key, '#475569') AS color_key
         FROM orders o JOIN managers m ON m.id = o.manager_id
         WHERE o.customer_id = ? AND o.order_status <> 'deleted'
         UNION
         SELECT s.customer_id, m.id, COALESCE(NULLIF(m.name, ''), NULLIF(s.manager_name, '')) AS name,
                COALESCE(m.color_key, '#475569') AS color_key
         FROM retained_order_summaries s
         LEFT JOIN managers m ON m.id = s.manager_id
         WHERE s.customer_id = ? AND m.id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM orders current_order WHERE current_order.id = s.original_order_id)
       )
       SELECT DISTINCT id, name, color_key FROM manager_history
       WHERE id IS NOT NULL AND NULLIF(name, '') IS NOT NULL
       ORDER BY name, id`
    ).bind(clientId, clientId).all<Record<string, unknown>>(),
  ]);

  const orders = ordersResult.results || [];
  const currentOrderIds = orders.filter((order) => !toInt((order as any).retained_only, 0) && order.id > 0).map((order) => order.id);
  const relations = await fetchOrderRelations(db, currentOrderIds);
  const mappedOrders = orders.map(order => {
    const retainedOnly = toInt((order as any).retained_only, 0) === 1;
    if (retainedOnly) {
      return {
        ...order,
        retained_only: true,
        retained_summary_text: cleanText((order as any).retained_summary_text),
        retained_payment_count: toInt((order as any).retained_payment_count, 0),
        retained_return_count: toInt((order as any).retained_return_count, 0),
        stock_handover_review_needed: false,
        stock_handover_has_active_items: false,
        items: [],
        itemsText: cleanText((order as any).retained_summary_text) || 'Краткая история заказа сохранена без детальных строк.',
        payments: [],
        returns: [],
      };
    }
    const rawItems = relations.itemsByOrderId.get(order.id) || [];
    const items = rawItems.map(item => ({
      id: (item as any).id,
      productName: toInt((item as any).product_id, 0) ? cleanText((item as any).canonical_product_name) : cleanText((item as any).product_name_snapshot),
      audienceType: toInt((item as any).variant_id, 0) ? (cleanText((item as any).canonical_category).toLowerCase() === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ') : cleanText((item as any).audience_type),
      gender: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_gender) : cleanText((item as any).gender_snapshot),
      color: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_color) : cleanText((item as any).color_snapshot),
      material: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_material) : cleanText((item as any).material_snapshot),
      length: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_length) : cleanText((item as any).length_snapshot),
      size: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_size) : cleanText((item as any).size_snapshot),
      quantity: toInt((item as any).quantity, 1),
      unitPrice: toInt((item as any).unit_price, 0),
      lineTotal: toInt((item as any).line_total, 0),
      sourceType: (item as any).is_workshop ? 'workshop' : cleanText((item as any).source_type),
      isWorkshop: Boolean(toInt((item as any).is_workshop, 0)),
      workshopTaskStatus: workshopTaskStatusForOrderItem(item as Record<string, unknown>, relations.workshopTasksByOrderId.get(order.id) || []),
    }));
    return {
      ...order,
      retained_only: false,
      stock_handover_review_needed: (relations.handoverReviewByOrderId.get(order.id) || []).length > 0,
      stock_handover_has_active_items: (relations.activeStockHandoverByOrderId.get(order.id) || []).length > 0,
      items,
      itemsText: items.map(item => `${item.productName}${item.size ? ` · ${item.size}` : ''} × ${item.quantity}`).join('; '),
      payments: (relations.paymentsByOrderId.get(order.id) || []).map(payment => ({
        id: (payment as any).id, paymentDate: (payment as any).payment_date, method: (payment as any).method,
        amount: (payment as any).amount, paymentKind: (payment as any).payment_kind, comment: (payment as any).comment,
      })),
      returns: (relations.returnsByOrderId.get(order.id) || []).map(ret => ({
        id: (ret as any).id, returnDate: (ret as any).return_date, amount: (ret as any).amount,
        comment: (ret as any).comment, status: (ret as any).status || 'completed', cancelledAt: (ret as any).cancelled_at || null,
        cancellationComment: (ret as any).cancellation_comment || null,
      })),
    };
  });

  const managerProfiles = (managerRows.results || []).map(row => ({
    id: toInt(row.id, 0),
    name: cleanText(row.name),
    colorKey: normalizeManagerColor(row.color_key, toInt(row.id, 0) - 1),
  })).filter(row => row.id && row.name);
  const cities = splitConcatList(stats.cities);
  const totalOrderCount = toInt(stats.order_count, 0);
  const totalAmount = toInt(stats.total_amount, 0);

  return json({
    ok: true,
    orderOffset: offset,
    orderLimit: limit,
    totalOrderCount,
    hasMore: offset + mappedOrders.length < totalOrderCount,
    client: {
      id: toInt(stats.id, 0),
      phone: cleanText(stats.phone_normalized),
      name: cleanText(stats.display_name),
      city: cleanText(stats.customer_city) || cities[0] || '',
      firstOrderAt: cleanText(stats.first_order_at),
      lastOrderAt: cleanText(stats.last_order_at),
      orderCount: totalOrderCount,
      totalAmount,
      receivedAmount: toInt(stats.received_amount, 0),
      debtAmount: toInt(stats.debt_amount, 0),
      returnAmount: toInt(stats.return_amount, 0),
      avgCheck: totalOrderCount ? Math.round(totalAmount / totalOrderCount) : 0,
      managers: splitConcatList(stats.managers),
      managerProfiles,
      cities,
      activeOrderCount: toInt(stats.active_order_count, 0),
      archivedOrderCount: toInt(stats.archived_order_count, 0),
    },
    orders: mappedOrders,
  });
}
