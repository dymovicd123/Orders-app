// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { cleanText, isArchivedOrder, normalizeArchiveMode, normalizeDate, normalizeShippingFilter, normalizeStatusFilter, toInt } from '../core/text.ts'
import type { OrderListRow } from '../core/types.ts'
import { writeActivityLog } from './activity.ts'
import { fetchOrderRelations, workshopTaskStatusForOrderItem } from './orders-relations.ts'
import { getOrder } from './orders-write.ts'

export type ArchiveRuleInput = {
  cutoffDate?: unknown;
  reason?: unknown;
  includeNotSent?: unknown;
  limit?: unknown;
};


export function normalizeBoolean(value: unknown, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = cleanText(value).toLowerCase();
  if (['1', 'true', 'yes', 'да', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'нет', 'off'].includes(text)) return false;
  return Boolean(value);
}


export function parseArchiveRules(input: ArchiveRuleInput | URLSearchParams) {
  const getValue = (key: keyof ArchiveRuleInput) => input instanceof URLSearchParams ? input.get(String(key)) : input[key];
  const today = new Date().toISOString().slice(0, 10);
  const cutoffDate = normalizeDate(getValue('cutoffDate') || today);
  return {
    cutoffDate,
    reason: cleanText(getValue('reason')) || `Автоархив закрытых заказов до ${cutoffDate}`,
    includeNotSent: normalizeBoolean(getValue('includeNotSent'), false),
    limit: Math.min(5000, Math.max(1, toInt(getValue('limit'), 1000))),
  };
}


export async function getArchivePreview(db: D1Database, input: ArchiveRuleInput | URLSearchParams) {
  const runD1Bounded = async (tasks: Array<() => Promise<any>>) => {
    const results: any[] = [];
    for (let index = 0; index < tasks.length; index += 6) {
      results.push(...await Promise.all(tasks.slice(index, index + 6).map(task => task())));
    }
    return results;
  };

  const rules = parseArchiveRules(input);
  const sentGuard = rules.includeNotSent ? '1 = 1' : "COALESCE(o.shipping_status, '') IN ('sent', '')";
  const eligibleSql = `
    SELECT o.id, o.external_id, o.order_date, o.total_amount, o.received_amount, o.debt_amount,
           o.shipping_status, o.workshop_status, COALESCE(m.name, '') AS manager
    FROM orders o
    LEFT JOIN managers m ON m.id = o.manager_id
    WHERE o.order_status = 'closed'
      AND o.order_date <= ?
      AND COALESCE(o.debt_amount, 0) <= 0
      AND NOT EXISTS (
        SELECT 1 FROM workshop_tasks wt
        WHERE wt.order_id = o.id AND wt.status IN ('active', 'ready')
      )
      AND ${sentGuard}
    ORDER BY o.order_date ASC, o.id ASC
    LIMIT ?`;

  const [eligibleRows, totalOpen, notClosed, tooNew, withDebt, activeWorkshop, notSent] = await runD1Bounded([
    () => db.prepare(eligibleSql).bind(rules.cutoffDate, rules.limit).all<Record<string, unknown>>(),
    () => db.prepare("SELECT COUNT(*) AS count FROM orders WHERE order_status NOT IN ('deleted', 'archived')").first<{ count: number }>(),
    () => db.prepare("SELECT COUNT(*) AS count FROM orders WHERE order_status NOT IN ('deleted', 'archived', 'closed')").first<{ count: number }>(),
    () => db.prepare("SELECT COUNT(*) AS count FROM orders WHERE order_status = 'closed' AND order_date > ?").bind(rules.cutoffDate).first<{ count: number }>(),
    () => db.prepare("SELECT COUNT(*) AS count FROM orders WHERE order_status = 'closed' AND order_date <= ? AND COALESCE(debt_amount, 0) > 0").bind(rules.cutoffDate).first<{ count: number }>(),
    () => db.prepare(`SELECT COUNT(DISTINCT o.id) AS count
                FROM orders o
                JOIN workshop_tasks wt ON wt.order_id = o.id AND wt.status IN ('active', 'ready')
                WHERE o.order_status = 'closed' AND o.order_date <= ? AND COALESCE(o.debt_amount, 0) <= 0`).bind(rules.cutoffDate).first<{ count: number }>(),
    () => db.prepare(`SELECT COUNT(*) AS count
                FROM orders o
                WHERE o.order_status = 'closed'
                  AND o.order_date <= ?
                  AND COALESCE(o.debt_amount, 0) <= 0
                  AND NOT EXISTS (SELECT 1 FROM workshop_tasks wt WHERE wt.order_id = o.id AND wt.status IN ('active', 'ready'))
                  AND COALESCE(o.shipping_status, '') NOT IN ('sent', '')`).bind(rules.cutoffDate).first<{ count: number }>(),
  ]);

  const orders = (eligibleRows.results || []).map((row: Record<string, unknown>) => ({
    id: toInt(row.id, 0),
    externalId: cleanText(row.external_id),
    orderDate: cleanText(row.order_date),
    manager: cleanText(row.manager),
    totalAmount: toInt(row.total_amount, 0),
    receivedAmount: toInt(row.received_amount, 0),
    debtAmount: toInt(row.debt_amount, 0),
    shippingStatus: cleanText(row.shipping_status) || 'not_sent',
    workshopStatus: cleanText(row.workshop_status),
  }));

  return {
    ok: true,
    rules,
    eligibleCount: orders.length,
    totalActiveOrders: Number(totalOpen?.count || 0),
    blocked: {
      notClosed: Number(notClosed?.count || 0),
      tooNew: Number(tooNew?.count || 0),
      withDebt: Number(withDebt?.count || 0),
      activeWorkshop: Number(activeWorkshop?.count || 0),
      notSent: rules.includeNotSent ? 0 : Number(notSent?.count || 0),
    },
    orders,
  };
}


export async function archiveOrders(db: D1Database, input: ArchiveRuleInput, actor: string) {
  const preview = await getArchivePreview(db, input);
  const ids = (preview.orders || []).map((order: any) => Number(order.id || 0)).filter(Boolean);
  if (!ids.length) {
    return { ...preview, archivedCount: 0, batchId: '', message: 'Нет подходящих заказов для архивации.' };
  }

  const timestamp = new Date().toISOString();
  const batchId = `ARCH-${timestamp.replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 9000 + 1000)}`;
  const rules = (preview as any).rules;
  const reason = cleanText(rules.reason) || 'Архивация закрытых заказов';
  const sentGuard = rules.includeNotSent ? '1 = 1' : "COALESCE(orders.shipping_status, '') IN ('sent', '')";
  const idsJson = JSON.stringify(ids);

  // Step 191E: archive is one atomic D1 transaction. The old per-order await loop could leave a
  // partially archived selection if a request failed mid-run and could exceed the D1 query budget
  // for a large preview. Re-check the eligibility rules inside the UPDATE so stale previews never
  // archive an order that became unsafe between preview and confirmation.
  const update = db.prepare(
    `UPDATE orders
     SET order_status = 'archived', archived_at = ?, archived_by = ?, archive_reason = ?, archive_batch_id = ?, updated_at = ?
     WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
       AND order_status = 'closed'
       AND order_date <= ?
       AND COALESCE(debt_amount, 0) <= 0
       AND NOT EXISTS (
         SELECT 1 FROM workshop_tasks wt
         WHERE wt.order_id = orders.id AND wt.status IN ('active', 'ready')
       )
       AND ${sentGuard}`
  ).bind(timestamp, actor || 'admin', reason, batchId, timestamp, idsJson, rules.cutoffDate);
  const insertRun = db.prepare(
    `INSERT INTO archive_runs (batch_id, cutoff_date, include_not_sent, reason, archived_count, created_by, created_at)
     VALUES (?, ?, ?, ?, (SELECT COUNT(*) FROM orders WHERE archive_batch_id = ? AND order_status = 'archived'), ?, ?)`
  ).bind(batchId, rules.cutoffDate, rules.includeNotSent ? 1 : 0, reason, batchId, actor || 'admin', timestamp);
  const [updateResult] = await db.batch([update, insertRun]);
  const archivedCount = Math.max(0, Number(updateResult?.meta?.changes || 0));

  try {
    await writeActivityLog(db, {
      eventType: 'orders_archived',
      entityType: 'archive',
      entityId: null,
      title: `Архивировано заказов: ${archivedCount}`,
      details: `Пакет ${batchId}; до ${rules.cutoffDate}; ${reason}`,
      amount: archivedCount,
      createdAt: timestamp,
    });
  } catch (error) {
    console.warn('Orders archive activity log after committed archive failed', error);
  }

  return { ...preview, archivedCount, batchId, message: `Архивировано заказов: ${archivedCount}.` };
}


export async function restoreArchivedOrder(db: D1Database, id: number, actor: string) {
  const order = await db.prepare('SELECT id, external_id, order_status FROM orders WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!order?.id) return { ok: false, status: 404, message: 'Order not found' };

  const safeReadback = async () => {
    try {
      return await getOrder(db, id);
    } catch (error) {
      console.warn('Order readback after archive restore failed', error);
      return null;
    }
  };

  if (!isArchivedOrder(order)) {
    // A transport failure can happen after the archive flags were already cleared. Treat the exact
    // post-restore state as a successful replay so the client may safely retry the PATCH.
    if (cleanText(order.order_status).toLowerCase() === 'closed') {
      const restored = await safeReadback();
      return restored
        ? { ok: true, alreadyRestored: true, order: restored, refreshRequired: false }
        : { ok: true, alreadyRestored: true, refreshRequired: true };
    }
    return { ok: false, status: 409, message: 'Заказ не находится в архиве.' };
  }

  const timestamp = new Date().toISOString();
  await db.prepare(
    `UPDATE orders
     SET order_status = 'closed', archived_at = NULL, archived_by = NULL, archive_reason = NULL, archive_batch_id = NULL, updated_at = ?
     WHERE id = ?`
  ).bind(timestamp, id).run();
  try {
    await writeActivityLog(db, {
      eventType: 'order_restored_from_archive',
      entityType: 'order',
      entityId: id,
      orderId: id,
      externalOrderId: cleanText(order.external_id),
      title: `Заказ ${cleanText(order.external_id)} возвращён из архива`,
      details: `Вернул: ${actor || 'admin'}`,
      createdAt: timestamp,
    });
  } catch (error) {
    console.warn('Order archive restore activity log after committed restore failed', error);
  }
  // The archive state above is already committed. A secondary order read must not report a false
  // restore failure after the mutation succeeded; the caller refreshes the list when needed.
  const restored = await safeReadback();
  return restored
    ? { ok: true, order: restored, refreshRequired: false }
    : { ok: true, refreshRequired: true };
}


export function retainedOrderSummaryPayload(row: Record<string, unknown>) {
  return {
    id: -Math.abs(toInt(row.original_order_id, 0)),
    external_id: cleanText(row.external_id),
    order_date: cleanText(row.order_date),
    manager_id: toInt(row.manager_id, 0) || null,
    manager_name: cleanText(row.manager_name) || 'Исторический менеджер',
    manager_snapshot_name: cleanText(row.manager_name) || null,
    manager_color: cleanText(row.manager_color) || '#64748B',
    customer_phone: cleanText(row.customer_phone) || null,
    customer_name: cleanText(row.customer_name) || null,
    city: cleanText(row.city) || null,
    delivery_type: cleanText(row.delivery_type) || null,
    source_type: cleanText(row.source_type) || 'warehouse',
    workshop_status: '',
    order_status: 'archived',
    shipping_status: cleanText(row.shipping_status) || 'not_sent',
    shipping_date: cleanText(row.shipping_date) || null,
    total_amount: toInt(row.total_amount, 0),
    received_amount: toInt(row.received_amount, 0),
    debt_amount: toInt(row.debt_amount, 0),
    return_amount: toInt(row.return_amount, 0),
    comment: 'Сохранена краткая история после очистки старого месяца.',
    archived_at: cleanText(row.retained_at) || null,
    archived_by: null,
    archive_reason: 'Краткая история после очистки',
    archive_batch_id: null,
    retained_only: true,
    retained_summary_text: cleanText(row.item_summary),
    retained_payment_count: toInt(row.payment_count, 0),
    retained_return_count: toInt(row.return_count, 0),
    stock_handover_review_needed: false,
    stock_handover_has_active_items: false,
    items: [],
    payments: [],
    returns: [],
  };
}


export async function findRetainedOrderSummary(db: D1Database, externalId: string) {
  if (!/^ORD-/i.test(externalId)) return null;
  return await db.prepare(
    `SELECT s.*, COALESCE(m.color_key, '#64748B') AS manager_color
     FROM retained_order_summaries s
     LEFT JOIN managers m ON m.id = s.manager_id
     WHERE UPPER(s.external_id) = UPPER(?)
     LIMIT 1`
  ).bind(externalId).first<Record<string, unknown>>();
}


export async function listOrders(db: D1Database, url: URL) {
  const limit = Math.min(200, Math.max(20, toInt(url.searchParams.get('limit'), 100)));
  const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0));
  const q = cleanText(url.searchParams.get('q'));
  const source = cleanText(url.searchParams.get('source')).toLowerCase();
  const manager = cleanText(url.searchParams.get('manager')).toUpperCase();
  const managerId = toInt(url.searchParams.get('managerId'), 0);
  const status = normalizeStatusFilter(url.searchParams.get('status'));
  const shippingStatus = normalizeShippingFilter(url.searchParams.get('shippingStatus'));
  const archiveMode = status === 'archived' ? 'archived' : normalizeArchiveMode(url.searchParams.get('archiveMode'));
  const dateFrom = cleanText(url.searchParams.get('dateFrom'));
  const dateTo = cleanText(url.searchParams.get('dateTo'));

  // The visible list uses order_date. Cash cards use actual payment/return dates.
  const baseWhereParts: string[] = [];
  const baseBindings: Array<string | number> = [];

  if (archiveMode === 'active') {
    baseWhereParts.push("o.order_status NOT IN ('deleted', 'archived')");
  } else if (archiveMode === 'archived') {
    baseWhereParts.push("o.order_status = 'archived'");
  } else {
    baseWhereParts.push("o.order_status <> 'deleted'");
  }

  if (source === 'warehouse' || source === 'boutique') {
    baseWhereParts.push('o.source_type = ?');
    baseBindings.push(source);
  }

  if (managerId > 0) {
    baseWhereParts.push('o.manager_id = ?');
    baseBindings.push(managerId);
  } else if (manager) {
    baseWhereParts.push("UPPER(COALESCE(m.name, o.manager_snapshot_name, '')) = ?");
    baseBindings.push(manager);

  }

  if (shippingStatus === 'sent') {
    baseWhereParts.push("COALESCE(o.shipping_status, '') = 'sent'");
  } else if (shippingStatus === 'not_sent') {
    baseWhereParts.push("COALESCE(o.shipping_status, '') <> 'sent'");
    if (status !== 'returned') baseWhereParts.push('COALESCE(o.return_amount, 0) <= 0');
  }

  if (status === 'active') {
    baseWhereParts.push("o.order_status = 'active'");
  } else if (status === 'closed') {
    baseWhereParts.push("o.order_status = 'closed'");
  } else if (status === 'returned') {
    baseWhereParts.push('COALESCE(o.return_amount, 0) > 0');
  } else if (status === 'archived') {
    baseWhereParts.push("o.order_status = 'archived'");
  }

  if (q) {
    const exactExternalId = /^ORD-\d{8,14}-[A-Z0-9]{4,16}$/i.test(q) ? q.toUpperCase() : '';
    if (exactExternalId) {
      baseWhereParts.push('o.external_id = ?');
      baseBindings.push(exactExternalId);
    } else {
      const searchOrderText = `COALESCE(o.external_id, '') || ' ' || COALESCE(o.order_date, '') || ' ' ||
        COALESCE(m.name, o.manager_snapshot_name, '') || ' ' || COALESCE(c.phone_normalized, '') || ' ' ||
        COALESCE(c.display_name, '') || ' ' || COALESCE(o.city, '') || ' ' || COALESCE(o.delivery_type, '') || ' ' || COALESCE(o.comment, '')`;
      const searchItemText = `COALESCE(oi.product_name_snapshot, '') || ' ' || COALESCE(oi.gender_snapshot, '') || ' ' ||
        COALESCE(oi.color_snapshot, '') || ' ' || COALESCE(oi.material_snapshot, '') || ' ' ||
        COALESCE(oi.length_snapshot, '') || ' ' || COALESCE(oi.size_snapshot, '')`;
      const searchPaymentText = `COALESCE(search_payment.method, '') || ' ' || COALESCE(search_payment.comment, '')`;
      const qVariants = [q, q.toUpperCase(), q.toLowerCase()];
      baseWhereParts.push(`(
        INSTR(${searchOrderText}, ?) > 0 OR INSTR(${searchOrderText}, ?) > 0 OR INSTR(${searchOrderText}, ?) > 0
        OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND (
          INSTR(${searchItemText}, ?) > 0 OR INSTR(${searchItemText}, ?) > 0 OR INSTR(${searchItemText}, ?) > 0
        ))
        OR EXISTS (SELECT 1 FROM payments search_payment WHERE search_payment.order_id = o.id AND (
          INSTR(${searchPaymentText}, ?) > 0 OR INSTR(${searchPaymentText}, ?) > 0 OR INSTR(${searchPaymentText}, ?) > 0
        ))
      )`);
      baseBindings.push(...qVariants, ...qVariants, ...qVariants);
    }
  }

  const orderWhereParts = [...baseWhereParts];
  const orderBindings = [...baseBindings];
  if (dateFrom) {
    orderWhereParts.push('o.order_date >= ?');
    orderBindings.push(normalizeDate(dateFrom));
  }
  if (dateTo) {
    orderWhereParts.push('o.order_date <= ?');
    orderBindings.push(normalizeDate(dateTo));
  }

  const paymentWhereParts = [...baseWhereParts];
  const paymentBindings = [...baseBindings];
  if (dateFrom) {
    paymentWhereParts.push('p.payment_date >= ?');
    paymentBindings.push(normalizeDate(dateFrom));
  }
  if (dateTo) {
    paymentWhereParts.push('p.payment_date <= ?');
    paymentBindings.push(normalizeDate(dateTo));
  }

  const returnWhereParts = [...baseWhereParts, "COALESCE(r.status, 'completed') <> 'cancelled'"];
  const returnBindings = [...baseBindings];
  if (dateFrom) {
    returnWhereParts.push('r.return_date >= ?');
    returnBindings.push(normalizeDate(dateFrom));
  }
  if (dateTo) {
    returnWhereParts.push('r.return_date <= ?');
    returnBindings.push(normalizeDate(dateTo));
  }

  const joins = `

    FROM orders o
    LEFT JOIN managers m ON m.id = o.manager_id
    LEFT JOIN customers c ON c.id = o.customer_id`;

  const rows = await db.prepare(`
    SELECT
      o.id, o.external_id, o.order_date, o.manager_id,
      CASE WHEN m.id IS NOT NULL THEN m.name WHEN NULLIF(TRIM(COALESCE(o.manager_snapshot_name, '')), '') IS NOT NULL THEN o.manager_snapshot_name || ' · исторический менеджер' ELSE 'Менеджер требует уточнения' END AS manager_name,
      o.manager_snapshot_name, COALESCE(m.color_key, '#64748B') AS manager_color, c.phone_normalized AS customer_phone, c.display_name AS customer_name,
      o.city, o.delivery_type, o.source_type, o.workshop_status, o.order_status,
      o.shipping_status, o.shipping_date,
      o.total_amount, o.received_amount, o.debt_amount, o.return_amount, o.comment,
      o.archived_at, o.archived_by, o.archive_reason, o.archive_batch_id
    ${joins}
    ${orderWhereParts.length ? `WHERE ${orderWhereParts.join(' AND ')}` : ''}
    ORDER BY o.order_date DESC, o.id DESC
    LIMIT ? OFFSET ?`
  ).bind(...orderBindings, limit, offset).all<OrderListRow>();

  const orders = rows.results || [];
  if (!orders.length && offset === 0 && q) {
    const retained = await findRetainedOrderSummary(db, q);
    if (retained) {
      const retainedOrder = retainedOrderSummaryPayload(retained);
      return {
        ok: true,
        limit,
        offset,
        count: 1,
        pageCount: 1,
        totalCount: 1,
        hasMore: false,
        hasPrevious: false,
        periodStats: {
          orderCount: 1,
          totalAmount: toInt(retained.total_amount, 0),
          paymentCount: toInt(retained.payment_count, 0),
          paymentAmount: toInt(retained.received_amount, 0),
          debtAmount: toInt(retained.debt_amount, 0),
          returnCount: toInt(retained.return_count, 0),
          returnAmount: toInt(retained.return_amount, 0),
          workshopUnits: 0,
        },
        orders: [retainedOrder],
      };
    }
  }
  const ids = orders.map(order => order.id);
  const relations = await fetchOrderRelations(db, ids);

  // A small page may still contain the complete filtered result. When it is provably complete, its rows
  // plus the relations we already loaded are the exact source for the summary.
  // Reusing them avoids re-scanning the same orders/order_items/payments/returns.
  // If pagination ever truncates the result, the legacy SQL aggregate remains as
  // a correctness fallback and preserves the API contract for larger databases.
  const completeOrderResult = offset === 0 && orders.length < limit;

  let orderStats: Record<string, unknown> | null = null;
  if (completeOrderResult) {
    let totalAmount = 0;
    let debtAmount = 0;
    let workshopUnits = 0;
    for (const order of orders) {
      totalAmount += toInt(order.total_amount, 0);
      debtAmount += toInt(order.debt_amount, 0);
      for (const item of relations.itemsByOrderId.get(order.id) || []) {
        const record = item as Record<string, unknown>;
        if (toInt(record.is_workshop, 0) === 1) workshopUnits += toInt(record.quantity, 0);
      }
    }
    orderStats = { order_count: orders.length, total_amount: totalAmount, debt_amount: debtAmount, workshop_units: workshopUnits };
  } else {
    orderStats = await db.prepare(`
      SELECT
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.total_amount), 0) AS total_amount,
        COALESCE(SUM(o.debt_amount), 0) AS debt_amount,
        COALESCE(SUM(COALESCE(workshop_items.workshop_units, 0)), 0) AS workshop_units
      ${joins}
      LEFT JOIN (
        SELECT order_id, COALESCE(SUM(quantity), 0) AS workshop_units
        FROM order_items
        WHERE COALESCE(is_workshop, 0) = 1
        GROUP BY order_id
      ) workshop_items ON workshop_items.order_id = o.id
      ${orderWhereParts.length ? `WHERE ${orderWhereParts.join(' AND ')}` : ''}`
    ).bind(...orderBindings).first<Record<string, unknown>>();
  }

  let paymentStats: Record<string, unknown> | null = null;
  let returnStats: Record<string, unknown> | null = null;
  if (completeOrderResult && !dateFrom && !dateTo) {
    let paymentCount = 0;
    let paymentAmount = 0;
    let returnCount = 0;
    let returnAmount = 0;
    for (const order of orders) {
      for (const payment of relations.paymentsByOrderId.get(order.id) || []) {
        const record = payment as Record<string, unknown>;
        paymentCount += 1;
        paymentAmount += toInt(record.amount, 0);
      }
      for (const returned of relations.returnsByOrderId.get(order.id) || []) {
        const record = returned as Record<string, unknown>;
        if (cleanText(record.status || 'completed').toLowerCase() === 'cancelled') continue;
        returnCount += 1;
        returnAmount += toInt(record.amount, 0);
      }
    }
    paymentStats = { payment_count: paymentCount, payment_amount: paymentAmount };
    returnStats = { return_count: returnCount, return_amount: returnAmount };
  } else {
    [paymentStats, returnStats] = await Promise.all([
      db.prepare(`
        SELECT COUNT(p.id) AS payment_count, COALESCE(SUM(p.amount), 0) AS payment_amount
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        LEFT JOIN managers m ON m.id = o.manager_id
        LEFT JOIN customers c ON c.id = o.customer_id
        ${paymentWhereParts.length ? `WHERE ${paymentWhereParts.join(' AND ')}` : ''}`
      ).bind(...paymentBindings).first<Record<string, unknown>>(),
      db.prepare(`
        SELECT COUNT(r.id) AS return_count, COALESCE(SUM(r.amount), 0) AS return_amount
        FROM returns r
        JOIN orders o ON o.id = r.order_id
        LEFT JOIN managers m ON m.id = o.manager_id
        LEFT JOIN customers c ON c.id = o.customer_id
        ${returnWhereParts.length ? `WHERE ${returnWhereParts.join(' AND ')}` : ''}`
      ).bind(...returnBindings).first<Record<string, unknown>>(),
    ]);
  }

  const totalCount = toInt(orderStats?.order_count, 0);
  return {
    ok: true,
    limit,
    offset,
    count: totalCount,
    pageCount: orders.length,
    totalCount,
    hasMore: offset + orders.length < totalCount,
    hasPrevious: offset > 0,
    periodStats: {
      orderCount: toInt(orderStats?.order_count, 0),
      totalAmount: toInt(orderStats?.total_amount, 0),
      paymentCount: toInt(paymentStats?.payment_count, 0),
      paymentAmount: toInt(paymentStats?.payment_amount, 0),
      debtAmount: toInt(orderStats?.debt_amount, 0),
      returnCount: toInt(returnStats?.return_count, 0),
      returnAmount: toInt(returnStats?.return_amount, 0),
      workshopUnits: toInt(orderStats?.workshop_units, 0),
    },
    orders: orders.map(order => ({
      ...order,
      stock_handover_review_needed: (relations.handoverReviewByOrderId.get(order.id) || []).length > 0,
      stock_handover_has_active_items: (relations.activeStockHandoverByOrderId.get(order.id) || []).length > 0,
      items: (relations.itemsByOrderId.get(order.id) || []).map(item => ({
        id: (item as any).id,
        productName: toInt((item as any).product_id, 0) ? cleanText((item as any).canonical_product_name) : cleanText((item as any).product_name_snapshot),
        audienceType: toInt((item as any).variant_id, 0) ? (cleanText((item as any).canonical_category).toLowerCase() === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ') : cleanText((item as any).audience_type),
        gender: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_gender) : cleanText((item as any).gender_snapshot),
        color: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_color) : cleanText((item as any).color_snapshot),
        material: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_material) : cleanText((item as any).material_snapshot),
        length: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_length) : cleanText((item as any).length_snapshot),
        size: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_size) : cleanText((item as any).size_snapshot),
        quantity: (item as any).quantity,
        unitPrice: (item as any).unit_price,
        lineTotal: (item as any).line_total,
        sourceType: (item as any).is_workshop ? 'workshop' : (item as any).source_type,
        isWorkshop: Boolean((item as any).is_workshop),
        workshopComment: (item as any).workshop_comment,
        workshopUrgent: Boolean((item as any).workshop_urgent),
        workshopDueDate: (item as any).workshop_due_date || '',
        workshopTaskStatus: workshopTaskStatusForOrderItem(
          item as Record<string, unknown>,
          relations.workshopTasksByOrderId.get(order.id) || [],
        ),
      })),
      payments: (relations.paymentsByOrderId.get(order.id) || []).map(payment => ({
        id: (payment as any).id,
        paymentDate: (payment as any).payment_date,
        method: (payment as any).method,
        amount: (payment as any).amount,
        paymentKind: (payment as any).payment_kind,
        comment: (payment as any).comment,
      })),
      returns: (relations.returnsByOrderId.get(order.id) || []).map(ret => ({
        id: (ret as any).id,
        returnDate: (ret as any).return_date,
        amount: (ret as any).amount,
        comment: (ret as any).comment,
        status: (ret as any).status || 'completed',
        cancelledAt: (ret as any).cancelled_at || null,
        cancellationComment: (ret as any).cancellation_comment || null,
      })),
    })),
  };
}


export async function listOpenDebtOrders(db: D1Database, url: URL) {
  const limit = Math.min(1000, Math.max(50, toInt(url.searchParams.get('limit'), 500)));
  const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0));
  const [summary, rows, historyRows] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(o.debt_amount), 0) AS total_debt,
              (SELECT COUNT(*) FROM payments hp JOIN orders ho ON ho.id = hp.order_id WHERE hp.payment_kind = 'debt_close' AND ho.order_status <> 'deleted') AS debt_close_count,
              (SELECT COALESCE(SUM(hp.amount), 0) FROM payments hp JOIN orders ho ON ho.id = hp.order_id WHERE hp.payment_kind = 'debt_close' AND ho.order_status <> 'deleted') AS debt_close_amount
       FROM orders o
       WHERE o.debt_amount > 0 AND o.order_status NOT IN ('deleted', 'archived')`
    ).first<Record<string, unknown>>(),
    db.prepare(
      `SELECT o.id, o.external_id, o.order_date, o.manager_id,
              CASE WHEN m.id IS NOT NULL THEN m.name WHEN NULLIF(TRIM(COALESCE(o.manager_snapshot_name, '')), '') IS NOT NULL THEN o.manager_snapshot_name || ' · исторический менеджер' ELSE 'Менеджер требует уточнения' END AS manager_name,
              COALESCE(m.color_key, '#64748B') AS manager_color,
              c.phone_normalized AS customer_phone, c.display_name AS customer_name,
              o.city, o.comment, o.total_amount, o.received_amount, o.debt_amount,
              o.order_status, o.shipping_status, o.shipping_date
       FROM orders o
       LEFT JOIN managers m ON m.id = o.manager_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.debt_amount > 0 AND o.order_status NOT IN ('deleted', 'archived')
       ORDER BY o.order_date DESC, o.id DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT p.id, p.payment_date, p.method, p.amount, COALESCE(p.comment, '') AS comment,
              o.id AS order_id, o.external_id, o.order_date,
              COALESCE(m.name, o.manager_snapshot_name, '') AS manager_name,
              COALESCE(m.color_key, '#475569') AS manager_color,
              COALESCE(c.display_name, c.phone_normalized, '') AS customer
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN managers m ON m.id = o.manager_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE p.payment_kind = 'debt_close' AND o.order_status <> 'deleted'
       ORDER BY p.payment_date DESC, p.id DESC
       LIMIT 300`
    ).all<Record<string, unknown>>(),
  ]);

  const orderRows = rows.results || [];
  const ids = orderRows.map(row => toInt(row.id, 0)).filter(Boolean);
  const itemsByOrder = new Map<number, Array<Record<string, unknown>>>();
  if (ids.length) {
    const itemRows = await db.prepare(
      `SELECT oi.order_id, oi.id,
              COALESCE(p.name, oi.product_name_snapshot, '') AS product_name,
              COALESCE(v.size_label, oi.size_snapshot, '') AS size_label,
              oi.quantity
       FROM order_items oi
       LEFT JOIN catalog_products p ON p.id = oi.product_id
       LEFT JOIN catalog_variants v ON v.id = oi.variant_id
       WHERE oi.quantity > 0
         AND oi.order_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
       ORDER BY oi.order_id, oi.id`
    ).bind(JSON.stringify(ids)).all<Record<string, unknown>>();
    for (const item of itemRows.results || []) {
      const orderId = toInt(item.order_id, 0);
      if (!itemsByOrder.has(orderId)) itemsByOrder.set(orderId, []);
      itemsByOrder.get(orderId)!.push({
        id: toInt(item.id, 0),
        productName: cleanText(item.product_name),
        size: cleanText(item.size_label),
        quantity: Math.max(0, toInt(item.quantity, 0)),
      });
    }
  }

  const count = toInt(summary?.count, 0);
  return {
    ok: true,
    count,
    totalDebt: toInt(summary?.total_debt, 0),
    debtCloseCount: toInt(summary?.debt_close_count, 0),
    debtCloseAmount: toInt(summary?.debt_close_amount, 0),
    limit,
    offset,
    hasMore: offset + orderRows.length < count,
    orders: orderRows.map(row => ({ ...row, items: itemsByOrder.get(toInt(row.id, 0)) || [], payments: [], returns: [] })),
    debtCloseHistory: (historyRows.results || []).map(row => ({
      id: `debt-${toInt(row.id, 0)}`,
      paymentDate: cleanText(row.payment_date),
      orderDate: cleanText(row.order_date),
      orderId: cleanText(row.external_id),
      manager: cleanText(row.manager_name) || '—',
      managerColor: cleanText(row.manager_color) || '#475569',
      customer: cleanText(row.customer) || '—',
      method: cleanText(row.method) || '—',
      amount: toInt(row.amount, 0),
      comment: cleanText(row.comment) || '—',
    })),
  };
}
