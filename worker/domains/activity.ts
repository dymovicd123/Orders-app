// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { mapSqlRows } from '../core/sql.ts'
import { cleanText, normalizeDate, toInt, upperText } from '../core/text.ts'
import type { ActivityEventInput } from '../core/types.ts'

export async function writeActivityLog(db: D1Database, input: ActivityEventInput) {
  const timestamp = input.createdAt || new Date().toISOString();
  try {
    await db.prepare(
      `INSERT INTO activity_log (
        event_type, entity_type, entity_id, order_id, external_order_id,
        title, details, amount, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      cleanText(input.eventType) || 'unknown',
      cleanText(input.entityType) || 'system',
      input.entityId ?? null,
      input.orderId ?? null,
      input.externalOrderId ? cleanText(input.externalOrderId) : null,
      cleanText(input.title) || 'Действие',
      input.details ? cleanText(input.details) : null,
      Math.max(0, toInt(input.amount, 0)),
      timestamp,
    ).run();
  } catch (error) {
    console.warn('Activity log write skipped:', error);
  }
}


export async function listActivityLog(db: D1Database, url: URL) {
  // Step 189D: this is a lightweight order-linked diagnostic journal, not the
  // source of truth for money, stock, returns or exchanges. Domain histories
  // remain authoritative and no actor-audit workflow is introduced here.
  const limit = Math.min(200, Math.max(20, toInt(url.searchParams.get('limit'), 80)));
  const orderId = toInt(url.searchParams.get('orderId'), 0);
  const eventType = cleanText(url.searchParams.get('eventType'));
  const query = upperText(url.searchParams.get('q'));
  const where: string[] = ['al.order_id IS NOT NULL'];
  const bindings: unknown[] = [];

  if (orderId) {
    where.push('al.order_id = ?');
    bindings.push(orderId);
  }

  if (eventType && eventType !== 'all') {
    where.push('al.event_type = ?');
    bindings.push(eventType);
  }

  if (query) {
    where.push(`(
      INSTR(UPPER(COALESCE(al.external_order_id, o.external_id, '')), ?) > 0
      OR INSTR(UPPER(COALESCE(m.name, o.manager_snapshot_name, '')), ?) > 0
      OR INSTR(UPPER(COALESCE(al.title, '')), ?) > 0
      OR INSTR(UPPER(COALESCE(al.details, '')), ?) > 0
    )`);
    bindings.push(query, query, query, query);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const result = await db.prepare(
    `SELECT al.id, al.event_type, al.entity_type, al.entity_id, al.order_id,
            COALESCE(al.external_order_id, o.external_id, '') AS external_order_id,
            al.title, al.details, al.amount, al.created_at,
            COALESCE(m.name, o.manager_snapshot_name, '') AS manager_name,
            COALESCE(m.color_key, '#475569') AS manager_color
     FROM activity_log al
     LEFT JOIN orders o ON o.id = al.order_id
     LEFT JOIN managers m ON m.id = o.manager_id
     ${whereSql}
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT ?`
  ).bind(...bindings, limit).all<any>();

  return {
    ok: true,
    count: result.results?.length || 0,
    activities: (result.results || []).map((row: any) => ({
      id: Number(row.id),
      eventType: cleanText(row.event_type),
      entityType: cleanText(row.entity_type),
      entityId: row.entity_id == null ? null : Number(row.entity_id),
      orderId: row.order_id == null ? null : Number(row.order_id),
      externalOrderId: cleanText(row.external_order_id),
      managerName: cleanText(row.manager_name) || null,
      managerColor: cleanText(row.manager_color) || null,
      title: cleanText(row.title),
      details: cleanText(row.details),
      amount: toInt(row.amount, 0),
      createdAt: cleanText(row.created_at),
    })),
  };
}



export function parseReportDateRange(url: URL) {
  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const todayIso = today.toISOString().slice(0, 10);
  const startDate = normalizeDate(url.searchParams.get('startDate') || monthStart);
  const endDate = normalizeDate(url.searchParams.get('endDate') || todayIso);
  if (startDate > endDate) {
    throw new Error('Начало периода не может быть позже конца периода.');
  }
  return { startDate, endDate };
}



export async function listReturnHistory(db: D1Database, url: URL) {
  const limit = Math.min(100, Math.max(20, toInt(url.searchParams.get('limit'), 50)));
  const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0));
  const query = upperText(url.searchParams.get('q'));
  const dateFrom = cleanText(url.searchParams.get('dateFrom'));
  const dateTo = cleanText(url.searchParams.get('dateTo'));
  const status = cleanText(url.searchParams.get('status')).toLowerCase();
  const where: string[] = [];
  const bindings: unknown[] = [];
  if (dateFrom) { where.push('r.return_date >= ?'); bindings.push(normalizeDate(dateFrom)); }
  if (dateTo) { where.push('r.return_date <= ?'); bindings.push(normalizeDate(dateTo)); }
  if (status === 'completed') where.push("COALESCE(r.status, 'completed') <> 'cancelled'");
  if (status === 'cancelled') where.push("COALESCE(r.status, 'completed') = 'cancelled'");
  if (query) {
    where.push(`(
      INSTR(UPPER(COALESCE(o.external_id, '')), ?) > 0 OR INSTR(UPPER(COALESCE(c.display_name, '')), ?) > 0
      OR INSTR(UPPER(COALESCE(c.phone_normalized, '')), ?) > 0 OR INSTR(UPPER(COALESCE(o.city, '')), ?) > 0
      OR INSTR(UPPER(COALESCE(m.name, '')), ?) > 0 OR INSTR(UPPER(COALESCE(r.comment, '')), ?) > 0
      OR INSTR(UPPER(COALESCE(r.cancellation_comment, '')), ?) > 0
      OR EXISTS (SELECT 1 FROM return_items ri_search WHERE ri_search.return_id = r.id AND INSTR(UPPER(
        COALESCE(ri_search.product_name_snapshot, '') || ' ' || COALESCE(ri_search.gender_snapshot, '') || ' ' ||
        COALESCE(ri_search.color_snapshot, '') || ' ' || COALESCE(ri_search.material_snapshot, '') || ' ' ||
        COALESCE(ri_search.length_snapshot, '') || ' ' || COALESCE(ri_search.size_snapshot, '')
      ), ?) > 0)
    )`);
    bindings.push(query, query, query, query, query, query, query, query);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const summary = await db.prepare(
    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN COALESCE(r.status, 'completed') <> 'cancelled' THEN 1 ELSE 0 END) AS active_count,
            SUM(CASE WHEN COALESCE(r.status, 'completed') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
            COALESCE(SUM(CASE WHEN COALESCE(r.status, 'completed') <> 'cancelled' THEN r.amount ELSE 0 END), 0) AS active_amount
     FROM returns r
     JOIN orders o ON o.id = r.order_id
     LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
     LEFT JOIN customers c ON c.id = o.customer_id
     ${whereSql}`
  ).bind(...bindings).first<Record<string, unknown>>();

  const result = await db.prepare(
    `WITH selected_returns AS (
       SELECT r.id FROM returns r
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
       LEFT JOIN customers c ON c.id = o.customer_id
       ${whereSql}
       ORDER BY r.return_date DESC, r.id DESC LIMIT ? OFFSET ?
     )
     SELECT r.id, r.order_id, o.external_id, o.order_date, r.return_date, r.amount, r.payment_method, r.status,
            COALESCE(r.comment, '') AS comment, r.cancelled_at, COALESCE(r.cancellation_comment, '') AS cancellation_comment,
            COALESCE(r.manager_id, o.manager_id) AS manager_id, COALESCE(m.name, o.manager_snapshot_name, 'Не указан') AS manager,
            COALESCE(m.color_key, '#475569') AS manager_color, COALESCE(c.display_name, c.phone_normalized, '—') AS customer,
            COALESCE(o.city, '') AS city, linked_exchange.id AS exchange_id,
            ri.id AS return_item_id, ri.order_item_id AS return_item_order_item_id,
            ri.product_name_snapshot AS return_item_product_name, ri.quantity AS return_item_quantity,
            ri.gender_snapshot AS return_item_gender, ri.color_snapshot AS return_item_color,
            ri.material_snapshot AS return_item_material, ri.length_snapshot AS return_item_length,
            ri.size_snapshot AS return_item_size, ri.inventory_source AS return_item_inventory_source,
            ri.restocked AS return_item_restocked, lifecycle.status AS return_item_lifecycle_status,
            lifecycle.pending_reason AS return_item_pending_reason
     FROM selected_returns selected
     JOIN returns r ON r.id = selected.id JOIN orders o ON o.id = r.order_id
     LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN exchanges linked_exchange ON linked_exchange.id = (SELECT e.id FROM exchanges e WHERE e.refund_return_id = r.id ORDER BY e.id DESC LIMIT 1)
     LEFT JOIN return_items ri ON ri.return_id = r.id
     LEFT JOIN inventory_lifecycle_events lifecycle ON lifecycle.id = (
       SELECT e.id FROM inventory_lifecycle_events e WHERE e.operation_type = 'return' AND e.operation_id = r.id AND e.operation_item_id = ri.id ORDER BY e.id DESC LIMIT 1
     )
     ORDER BY r.return_date DESC, r.id DESC, ri.id ASC`
  ).bind(...bindings, limit, offset).all<any>();

  const rowsById = new Map<number, any>();
  for (const row of mapSqlRows(result)) {
    const returnId = Number(row.id || 0);
    if (!rowsById.has(returnId)) {
      const exchangeId = row.exchange_id == null ? null : Number(row.exchange_id || 0) || null;
      rowsById.set(returnId, {
        id: returnId, orderId: Number(row.order_id || 0), externalId: cleanText(row.external_id), orderDate: cleanText(row.order_date),
        returnDate: cleanText(row.return_date), amount: Number(row.amount || 0), paymentMethod: cleanText(row.payment_method) || null,
        status: cleanText(row.status) || 'completed', comment: cleanText(row.comment), cancelledAt: cleanText(row.cancelled_at) || null,
        cancellationComment: cleanText(row.cancellation_comment), managerId: row.manager_id == null ? null : Number(row.manager_id),
        manager: cleanText(row.manager) || 'Не указан', managerColor: normalizeManagerColor(row.manager_color, toInt(row.manager_id, 1) - 1),
        customer: cleanText(row.customer) || '—', city: cleanText(row.city), operationType: exchangeId ? 'exchange_refund' : 'order_return', exchangeId, items: [],
      });
    }
    if (row.return_item_id != null) rowsById.get(returnId).items.push({
      id: Number(row.return_item_id || 0), orderItemId: row.return_item_order_item_id == null ? null : Number(row.return_item_order_item_id || 0) || null,
      productName: cleanText(row.return_item_product_name) || '—', quantity: Math.max(0, Number(row.return_item_quantity || 0)),
      gender: cleanText(row.return_item_gender) || null, color: cleanText(row.return_item_color) || null, material: cleanText(row.return_item_material) || null,
      length: cleanText(row.return_item_length) || null, size: cleanText(row.return_item_size) || null,
      inventorySource: cleanText(row.return_item_inventory_source) || null, restocked: Boolean(toInt(row.return_item_restocked, 0)),
      lifecycleStatus: cleanText(row.return_item_lifecycle_status) || null, pendingReason: cleanText(row.return_item_pending_reason) || null,
    });
  }
  const rows = Array.from(rowsById.values());
  const totalCount = Math.max(0, toInt(summary?.total_count, 0));
  return {
    ok: true, count: totalCount, offset, limit, hasMore: offset + rows.length < totalCount,
    summary: { activeCount: Math.max(0, toInt(summary?.active_count, 0)), cancelledCount: Math.max(0, toInt(summary?.cancelled_count, 0)), activeAmount: Number(summary?.active_amount || 0) },
    returns: rows,
  };
}



export const MANAGER_COLOR_PALETTE = [
  '#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#CA8A04', '#16A34A',
  '#0D9488', '#0891B2', '#0284C7', '#4F46E5', '#9333EA', '#C026D3',
  '#E11D48', '#B45309', '#15803D', '#0F766E', '#0369A1', '#4338CA',
  '#A21CAF', '#BE123C', '#6D28D9', '#1D4ED8', '#047857', '#9A3412',
] as const;


export function normalizeManagerColor(value: unknown, fallbackIndex = 0) {
  const color = cleanText(value).toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(color)) return color;
  return MANAGER_COLOR_PALETTE[Math.abs(fallbackIndex) % MANAGER_COLOR_PALETTE.length];
}


export async function resolveActiveManagerId(db: D1Database, managerId: unknown, managerName: unknown) {
  const id = toInt(managerId, 0);
  if (id > 0) {
    const row = await db.prepare('SELECT id FROM managers WHERE id = ? AND is_active = 1').bind(id).first<{ id: number }>();
    if (!row?.id) throw new Error('Выбранный сотрудник не найден или уже уволен.');
    return Number(row.id);
  }

  const name = upperText(managerName);
  if (!name) throw new Error('Выберите менеджера.');

  const matches = await db.prepare(
    'SELECT id FROM managers WHERE name = ? AND is_active = 1 ORDER BY id'
  ).bind(name).all<{ id: number }>();
  const ids = (matches.results || []).map((row) => Number(row.id || 0)).filter(Boolean);
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) {
    throw new Error(`Есть несколько активных сотрудников с именем ${name}. Выберите сотрудника из цветного списка.`);
  }
  throw new Error('Выберите действующего менеджера из списка.');
}


export async function listOrdersFinanceSummary(db: D1Database, url: URL) {
  const { startDate, endDate } = parseReportDateRange(url);
  const [ordersRow, paymentsRow, returnsRow, currentDebtRow] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS order_count,
              COALESCE(SUM(total_amount), 0) AS total_sales,
              COALESCE(AVG(NULLIF(total_amount, 0)), 0) AS avg_check
       FROM orders
       WHERE order_date BETWEEN ? AND ?
         AND order_status <> 'deleted'`
    ).bind(startDate, endDate).first<any>(),
    db.prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS gross_received
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.payment_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'`
    ).bind(startDate, endDate).first<any>(),
    db.prepare(
      `SELECT COALESCE(SUM(r.amount), 0) AS total_returned
       FROM returns r
       JOIN orders o ON o.id = r.order_id
       WHERE r.return_date BETWEEN ? AND ?
         AND COALESCE(r.status, 'completed') <> 'cancelled'
         AND o.order_status <> 'deleted'`
    ).bind(startDate, endDate).first<any>(),
    db.prepare(
      `SELECT COUNT(*) AS current_debt_orders,
              COALESCE(SUM(debt_amount), 0) AS current_debt
       FROM orders
       WHERE debt_amount > 0
         AND order_status <> 'deleted'`
    ).first<any>(),
  ]);

  return {
    ok: true,
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    overview: {
      orderCount: Number(ordersRow?.order_count || 0),
      totalSales: Number(ordersRow?.total_sales || 0),
      avgCheck: Math.round(Number(ordersRow?.avg_check || 0)),
      grossReceived: Number(paymentsRow?.gross_received || 0),
      totalReturned: Number(returnsRow?.total_returned || 0),
      currentDebt: Number(currentDebtRow?.current_debt || 0),
      currentDebtOrders: Number(currentDebtRow?.current_debt_orders || 0),
    },
  };
}
