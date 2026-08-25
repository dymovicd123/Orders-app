// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { mapSqlRows } from '../core/sql.ts'
import { canonicalPaymentMethodName, cleanText, toInt } from '../core/text.ts'
import { normalizeManagerColor, parseReportDateRange } from './activity.ts'
import { listCallCentreRecords, listLeadRecords, listPlans, listTeamEmployees } from './team.ts'

export async function listFinanceReports(db: D1Database, url: URL) {
  const runD1Bounded = async (tasks: Array<() => Promise<any>>) => {
    const results: any[] = [];
    for (let index = 0; index < tasks.length; index += 6) {
      results.push(...await Promise.all(tasks.slice(index, index + 6).map(task => task())));
    }
    return results;
  };

  const { startDate, endDate } = parseReportDateRange(url);
  const startAt = `${startDate}T00:00:00.000Z`;
  const endAt = `${endDate}T23:59:59.999Z`;

  const [overviewRow, paymentMethods, managerRows, managerCashRows, productRows, cityRows, cityCashRows, dayRows, returnsRows,
    exchangeRows, closedDebtRows, currentDebtRow, currentDebtTopRows, inventoryRows, repeatClientRows,
    activityRows] = await runD1Bounded([
    () => db.prepare(
      `SELECT
         COUNT(*) AS order_count,
         COALESCE(SUM(total_amount), 0) AS total_sales,
         COALESCE(SUM(received_amount), 0) AS total_received,
         COALESCE(SUM(return_amount), 0) AS total_returns,
         COALESCE(SUM(debt_amount), 0) AS period_debt,
         COALESCE(AVG(NULLIF(total_amount, 0)), 0) AS avg_check
       FROM orders
       WHERE order_date BETWEEN ? AND ?
         AND order_status <> 'deleted'`
    ).bind(startDate, endDate).first<any>(),

    () => db.prepare(
      `SELECT p.method AS method, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS total
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.payment_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       GROUP BY p.method
       ORDER BY total DESC, count DESC, method ASC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT o.manager_id,
              COALESCE(m.name, o.manager_snapshot_name, 'Не указан') AS manager,
              COALESCE(m.color_key, '#475569') AS color_key,
              COUNT(DISTINCT o.id) AS order_count,
              COALESCE(SUM(o.total_amount), 0) AS total_sales,
              COALESCE(SUM(o.received_amount), 0) AS total_received,
              COALESCE(SUM(o.return_amount), 0) AS total_returns,
              COALESCE(SUM(o.debt_amount), 0) AS total_debt,
              COALESCE(AVG(NULLIF(o.total_amount, 0)), 0) AS avg_check
       FROM orders o
       LEFT JOIN managers m ON m.id = o.manager_id
       WHERE o.order_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       GROUP BY o.manager_id, m.name, m.color_key, o.manager_snapshot_name
       ORDER BY total_sales DESC, order_count DESC, manager ASC, o.manager_id ASC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT x.manager_id,
              COALESCE(m.name, 'Не указан') AS manager,
              COALESCE(m.color_key, '#475569') AS color_key,
              COALESCE(SUM(x.total_received), 0) AS total_received,
              COALESCE(SUM(x.total_returns), 0) AS total_returns
       FROM (
         SELECT o.manager_id AS manager_id, p.amount AS total_received, 0 AS total_returns
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE p.payment_date BETWEEN ? AND ? AND o.order_status <> 'deleted'
         UNION ALL
         SELECT COALESCE(r.manager_id, o.manager_id) AS manager_id, 0 AS total_received, r.amount AS total_returns
         FROM returns r
         JOIN orders o ON o.id = r.order_id
         WHERE r.return_date BETWEEN ? AND ? AND COALESCE(r.status, 'completed') <> 'cancelled' AND o.order_status <> 'deleted'
       ) x
       LEFT JOIN managers m ON m.id = x.manager_id
       GROUP BY x.manager_id, m.name, m.color_key
       ORDER BY total_received DESC, manager ASC, x.manager_id ASC`
    ).bind(startDate, endDate, startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT oi.product_name_snapshot AS product,
              COALESCE(SUM(oi.quantity), 0) AS quantity,
              COUNT(DISTINCT oi.order_id) AS order_count,
              COALESCE(SUM(o.total_amount), 0) AS order_sales
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.order_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       GROUP BY oi.product_name_snapshot
       ORDER BY quantity DESC, order_count DESC, product ASC
       LIMIT 250`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT COALESCE(NULLIF(o.city, ''), 'Не указан') AS city,
              COUNT(*) AS order_count,
              COALESCE(SUM(o.total_amount), 0) AS total_sales,
              COALESCE(SUM(o.received_amount), 0) AS total_received,
              COALESCE(SUM(o.debt_amount), 0) AS total_debt,
              COALESCE(SUM(o.return_amount), 0) AS total_returns
       FROM orders o
       WHERE o.order_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       GROUP BY city
       ORDER BY order_count DESC, total_sales DESC, city ASC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT x.city AS city,
              COALESCE(SUM(x.total_received), 0) AS total_received,
              COALESCE(SUM(x.total_returns), 0) AS total_returns
       FROM (
         SELECT COALESCE(NULLIF(o.city, ''), 'Не указан') AS city, p.amount AS total_received, 0 AS total_returns
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE p.payment_date BETWEEN ? AND ? AND o.order_status <> 'deleted'
         UNION ALL
         SELECT COALESCE(NULLIF(o.city, ''), 'Не указан') AS city, 0 AS total_received, r.amount AS total_returns
         FROM returns r
         JOIN orders o ON o.id = r.order_id
         WHERE r.return_date BETWEEN ? AND ? AND COALESCE(r.status, 'completed') <> 'cancelled' AND o.order_status <> 'deleted'
       ) x
       GROUP BY x.city
       ORDER BY total_received DESC, x.city ASC`
    ).bind(startDate, endDate, startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT o.order_date AS date,
              COUNT(*) AS order_count,
              COALESCE(SUM(o.total_amount), 0) AS total_sales,
              COALESCE(SUM(o.received_amount), 0) AS total_received,
              COALESCE(SUM(o.return_amount), 0) AS total_returns,
              COALESCE(SUM(o.debt_amount), 0) AS total_debt
       FROM orders o
       WHERE o.order_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       GROUP BY o.order_date
       ORDER BY o.order_date ASC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT r.id, r.order_id, o.external_id, o.order_date, r.return_date, r.amount, r.payment_method, r.status,
              COALESCE(r.comment, '') AS comment,
              COALESCE(m.name, '') AS manager,
              COALESCE(m.color_key, '#475569') AS manager_color,
              COALESCE(c.display_name, c.phone_normalized, '—') AS customer,
              COALESCE(o.city, '') AS city,
              CASE WHEN EXISTS (
                SELECT 1 FROM exchanges e
                WHERE e.refund_return_id = r.id
                  AND COALESCE(e.status, 'completed') <> 'cancelled'
                  AND e.financial_action = 'refund'
              ) THEN 'exchange_refund' ELSE 'order_return' END AS return_type
       FROM returns r
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE r.return_date BETWEEN ? AND ?
         AND COALESCE(r.status, 'completed') <> 'cancelled'
         AND o.order_status <> 'deleted'
       ORDER BY r.return_date DESC, r.id DESC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT e.id, e.order_id, o.external_id, o.order_date, e.exchange_date, e.old_quantity,
              e.old_return_source, e.new_source_type, e.financial_action,
              e.financial_amount, e.status, COALESCE(e.comment, '') AS comment
       FROM exchanges e
       JOIN orders o ON o.id = e.order_id
       WHERE e.exchange_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       ORDER BY e.exchange_date DESC, e.id DESC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT p.id, p.order_id, o.external_id, o.order_date, p.payment_date, p.method, p.amount,
              COALESCE(p.comment, '') AS comment
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.payment_kind IN ('debt_close', 'extra')
         AND NOT EXISTS (
           SELECT 1 FROM exchanges e
           WHERE e.payment_id = p.id
             AND COALESCE(e.status, 'completed') <> 'cancelled'
             AND e.financial_action = 'extra_payment'
         )
         AND p.payment_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       ORDER BY p.payment_date DESC, p.id DESC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT COUNT(*) AS order_count, COALESCE(SUM(debt_amount), 0) AS total_debt
       FROM orders
       WHERE debt_amount > 0
         AND order_status <> 'deleted'`
    ).first<any>(),

    () => db.prepare(
      `SELECT o.id, o.external_id, o.order_date, COALESCE(m.name, '') AS manager,
              COALESCE(c.display_name, c.phone_normalized, '') AS customer,
              o.debt_amount
       FROM orders o
       LEFT JOIN managers m ON m.id = o.manager_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.debt_amount > 0
         AND o.order_status <> 'deleted'
       ORDER BY o.debt_amount DESC, o.order_date ASC
       LIMIT 30`
    ).all<any>(),

    () => db.prepare(
      `SELECT movement_type, inventory_source,
              COUNT(*) AS count,
              COALESCE(SUM(quantity_delta), 0) AS quantity_delta
       FROM inventory_movements
       WHERE created_at BETWEEN ? AND ?
       GROUP BY movement_type, inventory_source
       ORDER BY movement_type ASC, inventory_source ASC`
    ).bind(startAt, endAt).all<any>(),

    () => db.prepare(
      `SELECT COALESCE(c.phone_normalized, '') AS client_key,
              COALESCE(c.display_name, c.phone_normalized, 'Не указан') AS client,
              COUNT(o.id) AS period_orders,
              COALESCE(SUM(o.total_amount), 0) AS period_sales,
              COALESCE(c.orders_count, 0) AS total_orders,
              COALESCE(c.first_order_at, '') AS first_order_at,
              COALESCE(c.last_order_at, '') AS last_order_at
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE o.order_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       GROUP BY c.id
       HAVING COALESCE(c.orders_count, 0) > 1 OR COUNT(o.id) > 1
       ORDER BY period_orders DESC, period_sales DESC, client ASC
       LIMIT 100`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT event_type, COUNT(*) AS count
       FROM activity_log
       WHERE created_at BETWEEN ? AND ?
       GROUP BY event_type
       ORDER BY count DESC, event_type ASC`
    ).bind(startAt, endAt).all<any>(),
  ]);


  const [paymentByDayRows, paymentOperationRows, managerOrderDayRows, managerPaymentDayRows, managerReturnDayRows, productDayRows, cityDayRows, cityCashDayRows, returnsDetailRows, closedDebtDetailRows, paymentEventRows] = await runD1Bounded([
    () => db.prepare(
      `SELECT p.payment_date AS date, p.method AS method, COALESCE(SUM(p.amount), 0) AS total
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.payment_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       GROUP BY p.payment_date, p.method
       ORDER BY p.payment_date ASC, total DESC, p.method ASC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT p.id,
              p.order_id,
              o.external_id,
              o.order_date,
              COALESCE(o.created_at, '') AS order_created_at,
              p.payment_date,
              p.method,
              p.amount,
              p.payment_kind,
              COALESCE(p.comment, '') AS comment,
              COALESCE(p.created_at, '') AS created_at,
              o.manager_id,
              COALESCE(m.name, o.manager_snapshot_name, 'Не указан') AS manager,
              COALESCE(m.color_key, '#475569') AS manager_color,
              COALESCE(c.display_name, c.phone_normalized, '—') AS customer,
              COALESCE(o.city, '') AS city,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM exchanges e
                  WHERE e.payment_id = p.id
                    AND COALESCE(e.status, 'completed') <> 'cancelled'
                    AND e.financial_action = 'extra_payment'
                ) THEN 'exchange_extra'
                WHEN p.payment_kind = 'debt_close' THEN 'debt_close'
                WHEN p.payment_kind = 'extra' THEN 'order_extra'
                ELSE 'order_payment'
              END AS operation_type,
              CASE
                WHEN p.payment_date < o.order_date THEN 'before_order'
                WHEN p.payment_date > o.order_date THEN 'after_order'
                ELSE 'same_day'
              END AS date_relation,
              CAST(julianday(p.payment_date) - julianday(o.order_date) AS INTEGER) AS date_offset_days
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN managers m ON m.id = o.manager_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE p.payment_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       ORDER BY p.payment_date DESC, p.id DESC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT o.order_date AS date,
              o.manager_id,
              COALESCE(m.name, o.manager_snapshot_name, 'Не указан') AS manager,
              COALESCE(m.color_key, '#475569') AS color_key,
              COUNT(o.id) AS order_count,
              COALESCE(SUM(o.total_amount), 0) AS total_sales,
              COALESCE(SUM(o.received_amount), 0) AS total_received,
              COALESCE(SUM(o.return_amount), 0) AS total_returns,
              COALESCE(SUM(o.debt_amount), 0) AS total_debt,
              COALESCE(AVG(NULLIF(o.total_amount, 0)), 0) AS avg_check
       FROM orders o
       LEFT JOIN managers m ON m.id = o.manager_id
       WHERE o.order_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       GROUP BY o.order_date, o.manager_id, m.name, m.color_key, o.manager_snapshot_name
       ORDER BY o.order_date ASC, total_sales DESC, manager ASC, o.manager_id ASC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT p.payment_date AS date,
              o.manager_id,
              COALESCE(m.name, o.manager_snapshot_name, 'Не указан') AS manager,
              COALESCE(m.color_key, '#475569') AS color_key,
              COALESCE(SUM(CASE
                WHEN p.payment_kind NOT IN ('debt_close', 'extra')
                  AND NOT EXISTS (
                    SELECT 1 FROM exchanges e
                    WHERE e.payment_id = p.id
                      AND COALESCE(e.status, 'completed') <> 'cancelled'
                      AND e.financial_action = 'extra_payment'
                  )
                THEN p.amount ELSE 0 END), 0) AS primary_received,
              COALESCE(SUM(CASE WHEN p.payment_kind = 'debt_close' THEN p.amount ELSE 0 END), 0) AS debt_closed,
              COALESCE(SUM(CASE
                WHEN p.payment_kind = 'extra'
                  AND NOT EXISTS (
                    SELECT 1 FROM exchanges e
                    WHERE e.payment_id = p.id
                      AND COALESCE(e.status, 'completed') <> 'cancelled'
                      AND e.financial_action = 'extra_payment'
                  )
                THEN p.amount ELSE 0 END), 0) AS order_extra_received,
              COALESCE(SUM(CASE WHEN EXISTS (
                SELECT 1 FROM exchanges e
                WHERE e.payment_id = p.id
                  AND COALESCE(e.status, 'completed') <> 'cancelled'
                  AND e.financial_action = 'extra_payment'
              ) THEN p.amount ELSE 0 END), 0) AS extra_received
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN managers m ON m.id = o.manager_id
       WHERE p.payment_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       GROUP BY p.payment_date, o.manager_id, m.name, m.color_key, o.manager_snapshot_name
       ORDER BY p.payment_date ASC, manager ASC, o.manager_id ASC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT r.return_date AS date,
              COALESCE(r.manager_id, o.manager_id) AS manager_id,
              COALESCE(m.name, o.manager_snapshot_name, 'Не указан') AS manager,
              COALESCE(m.color_key, '#475569') AS color_key,
              COALESCE(SUM(r.amount), 0) AS total_returns
       FROM returns r
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
       WHERE r.return_date BETWEEN ? AND ?
         AND COALESCE(r.status, 'completed') <> 'cancelled'
         AND o.order_status <> 'deleted'
       GROUP BY r.return_date, COALESCE(r.manager_id, o.manager_id), m.name, m.color_key, o.manager_snapshot_name
       ORDER BY r.return_date ASC, manager ASC, manager_id ASC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT o.order_date AS date,
              TRIM(oi.product_name_snapshot || ' ' || COALESCE(oi.material_snapshot, '') || ' ' || COALESCE(oi.gender_snapshot, '')) AS product,
              COALESCE(SUM(oi.quantity), 0) AS quantity,
              COUNT(DISTINCT oi.order_id) AS order_count
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.order_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       GROUP BY o.order_date, product
       ORDER BY o.order_date ASC, quantity DESC, order_count DESC, product ASC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT o.order_date AS date,
              COALESCE(NULLIF(o.city, ''), 'Не указан') AS city,
              COUNT(o.id) AS order_count,
              COALESCE(SUM(o.total_amount), 0) AS total_sales,
              COALESCE(SUM(o.received_amount), 0) AS total_received,
              COALESCE(SUM(o.debt_amount), 0) AS total_debt,
              COUNT(DISTINCT o.customer_id) AS clients,
              COUNT(DISTINCT o.manager_id) AS managers,
              COALESCE(AVG(NULLIF(o.total_amount, 0)), 0) AS avg_check
       FROM orders o
       WHERE o.order_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       GROUP BY o.order_date, city
       ORDER BY o.order_date ASC, order_count DESC, total_sales DESC, city ASC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT x.date AS date, x.city AS city,
              COALESCE(SUM(x.total_received), 0) AS total_received,
              COALESCE(SUM(x.total_returns), 0) AS total_returns
       FROM (
         SELECT p.payment_date AS date, COALESCE(NULLIF(o.city, ''), 'Не указан') AS city, p.amount AS total_received, 0 AS total_returns
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE p.payment_date BETWEEN ? AND ? AND o.order_status <> 'deleted'
         UNION ALL
         SELECT r.return_date AS date, COALESCE(NULLIF(o.city, ''), 'Не указан') AS city, 0 AS total_received, r.amount AS total_returns
         FROM returns r
         JOIN orders o ON o.id = r.order_id
         WHERE r.return_date BETWEEN ? AND ? AND COALESCE(r.status, 'completed') <> 'cancelled' AND o.order_status <> 'deleted'
       ) x
       GROUP BY x.date, x.city
       ORDER BY x.date ASC, x.city ASC`
    ).bind(startDate, endDate, startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT r.id,
              r.order_id,
              o.external_id,
              o.order_date,
              r.return_date AS date,
              r.return_date AS operation_date,
              r.amount,
              r.status,
              COALESCE(r.comment, '') AS comment,
              COALESCE(m.name, o.manager_snapshot_name, 'Не указан') AS manager,
              COALESCE(c.display_name, c.phone_normalized, '—') AS customer,
              COALESCE(GROUP_CONCAT(ri.product_name_snapshot || ' × ' || ri.quantity, ' · '), '') AS items,
              CASE WHEN EXISTS (
                SELECT 1 FROM exchanges e
                WHERE e.refund_return_id = r.id
                  AND COALESCE(e.status, 'completed') <> 'cancelled'
                  AND e.financial_action = 'refund'
              ) THEN 'exchange_refund' ELSE 'order_return' END AS return_type
       FROM returns r
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN return_items ri ON ri.return_id = r.id
       WHERE r.return_date BETWEEN ? AND ?
         AND COALESCE(r.status, 'completed') <> 'cancelled'
         AND o.order_status <> 'deleted'
       GROUP BY r.id
       ORDER BY r.return_date DESC, r.id DESC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT p.id,
              p.order_id,
              o.external_id,
              o.order_date,
              p.payment_date AS date,
              p.payment_date AS operation_date,
              p.method,
              p.amount,
              COALESCE(p.comment, '') AS comment,
              COALESCE(m.name, o.manager_snapshot_name, 'Не указан') AS manager,
              COALESCE(c.display_name, c.phone_normalized, '—') AS customer,
              COALESCE(o.city, '') AS city
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN managers m ON m.id = o.manager_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE p.payment_kind IN ('debt_close', 'extra')
         AND NOT EXISTS (
           SELECT 1 FROM exchanges e
           WHERE e.payment_id = p.id
             AND COALESCE(e.status, 'completed') <> 'cancelled'
             AND e.financial_action = 'extra_payment'
         )
         AND p.payment_date BETWEEN ? AND ?
         AND o.order_status <> 'deleted'
       ORDER BY p.payment_date DESC, p.id DESC`
    ).bind(startDate, endDate).all<any>(),

    () => db.prepare(
      `SELECT id, order_id, external_order_id, event_date, event_at, event_type, related_type,
              amount_delta, payment_method, source_type, source_id, source_ref, reason, is_backfill, created_at
       FROM financial_events
       WHERE event_date BETWEEN ? AND ?
         AND amount_delta > 0
         AND event_type IN ('order_payment', 'debt_close', 'order_extra', 'exchange_extra')
       ORDER BY event_at DESC, id DESC`
    ).bind(startDate, endDate).all<any>(),
  ]);

  const returns = mapSqlRows(returnsRows);
  const exchanges = mapSqlRows(exchangeRows);
  const closedDebts = mapSqlRows(closedDebtRows);
  const paymentMethodMap = new Map<string, { method: string; count: number; total: number }>();
  for (const row of mapSqlRows(paymentMethods) as any[]) {
    const method = canonicalPaymentMethodName(row.method);
    const current = paymentMethodMap.get(method) || { method, count: 0, total: 0 };
    current.count += Number(row.count || 0);
    current.total += Number(row.total || 0);
    paymentMethodMap.set(method, current);
  }
  const paymentRows = Array.from(paymentMethodMap.values()).sort((a, b) => b.total - a.total || a.method.localeCompare(b.method, 'ru'));

  const managerMap = new Map<number, any>();
  for (const row of mapSqlRows(managerRows) as any[]) {
    const managerId = toInt(row.manager_id, 0);
    managerMap.set(managerId, { ...row, manager_id: managerId, total_received: 0, total_returns: 0 });
  }
  for (const row of mapSqlRows(managerCashRows) as any[]) {
    const managerId = toInt(row.manager_id, 0);
    const manager = cleanText(row.manager) || 'Не указан';
    const current = managerMap.get(managerId) || { manager_id: managerId, manager, color_key: row.color_key, order_count: 0, total_sales: 0, total_debt: 0, avg_check: 0 };
    current.total_received = Number(row.total_received || 0);
    current.total_returns = Number(row.total_returns || 0);
    current.color_key = cleanText(row.color_key) || current.color_key;
    managerMap.set(managerId, current);
  }
  const normalizedManagerRows = Array.from(managerMap.values()).sort((a, b) => Number(b.total_received || 0) - Number(a.total_received || 0) || String(a.manager).localeCompare(String(b.manager), 'ru'));

  const cityMap = new Map<string, any>();
  for (const row of mapSqlRows(cityRows) as any[]) cityMap.set(cleanText(row.city) || 'Не указан', { ...row, total_received: 0, total_returns: 0 });
  for (const row of mapSqlRows(cityCashRows) as any[]) {
    const city = cleanText(row.city) || 'Не указан';
    const current = cityMap.get(city) || { city, order_count: 0, total_sales: 0, total_debt: 0 };
    current.total_received = Number(row.total_received || 0);
    current.total_returns = Number(row.total_returns || 0);
    cityMap.set(city, current);
  }
  const normalizedCityRows = Array.from(cityMap.values()).sort((a, b) => Number(b.total_received || 0) - Number(a.total_received || 0) || String(a.city).localeCompare(String(b.city), 'ru'));

  const paymentEvents = mapSqlRows(paymentEventRows) as any[];
  const paymentEventsBySourceId = new Map<number, any[]>();
  const paymentEventsByFingerprint = new Map<string, any[]>();
  const financeDateOffset = (left: string, right: string) => {
    const leftDate = /^\d{4}-\d{2}-\d{2}$/.test(left) ? Date.parse(`${left}T00:00:00.000Z`) : Number.NaN;
    const rightDate = /^\d{4}-\d{2}-\d{2}$/.test(right) ? Date.parse(`${right}T00:00:00.000Z`) : Number.NaN;
    return Number.isFinite(leftDate) && Number.isFinite(rightDate) ? Math.round((leftDate - rightDate) / 86_400_000) : 0;
  };
  const financeEventFingerprint = (orderId: number, eventDate: string, eventType: string, amount: number, method: string, eventAt: string) => [
    orderId,
    eventDate,
    eventType,
    Math.trunc(amount),
    canonicalPaymentMethodName(method),
    eventAt,
  ].join('|');
  for (const event of paymentEvents) {
    const sourceId = toInt(event.source_id, 0);
    if (cleanText(event.source_type) === 'payment' && sourceId) {
      const current = paymentEventsBySourceId.get(sourceId) || [];
      current.push(event);
      paymentEventsBySourceId.set(sourceId, current);
    }
    const fingerprint = financeEventFingerprint(
      toInt(event.order_id, 0),
      cleanText(event.event_date),
      cleanText(event.event_type),
      Number(event.amount_delta || 0),
      cleanText(event.payment_method),
      cleanText(event.event_at),
    );
    const current = paymentEventsByFingerprint.get(fingerprint) || [];
    current.push(event);
    paymentEventsByFingerprint.set(fingerprint, current);
  }

  const paymentOperations = mapSqlRows(paymentOperationRows).map((row: any) => {
    const operationType = cleanText(row.operation_type) || 'order_payment';
    const operationLabel = operationType === 'debt_close'
      ? 'Закрытие долга'
      : operationType === 'exchange_extra'
        ? 'Доплата по обмену'
        : operationType === 'order_extra'
          ? 'Закрытие долга (старый тип)'
          : 'Оплата заказа';
    const id = Number(row.id || 0);
    const orderId = Number(row.order_id || 0);
    const orderDate = cleanText(row.order_date);
    const orderCreatedAt = cleanText(row.order_created_at);
    const orderCreatedDate = orderCreatedAt.slice(0, 10);
    const paymentDate = cleanText(row.payment_date);
    const createdAt = cleanText(row.created_at);
    const recordedDate = createdAt.slice(0, 10);
    const amount = Number(row.amount || 0);
    const method = canonicalPaymentMethodName(row.method);
    const dateRelation = cleanText(row.date_relation) || 'same_day';

    const sourceCandidates = (paymentEventsBySourceId.get(id) || []).filter((event: any) => (
      cleanText(event.event_type) === operationType
      && Number(event.amount_delta || 0) === amount
      && canonicalPaymentMethodName(event.payment_method) === method
      && cleanText(event.event_date) === paymentDate
    ));
    const fingerprintCandidates = paymentEventsByFingerprint.get(financeEventFingerprint(
      orderId,
      paymentDate,
      operationType,
      amount,
      method,
      createdAt,
    )) || [];

    let lineageEvent: any = null;
    let eventLineageStatus = 'missing';
    if (sourceCandidates.length === 1) {
      lineageEvent = sourceCandidates[0];
      eventLineageStatus = 'source_id';
    } else if (sourceCandidates.length > 1) {
      eventLineageStatus = 'ambiguous';
    } else if (fingerprintCandidates.length === 1) {
      lineageEvent = fingerprintCandidates[0];
      eventLineageStatus = 'exact_fingerprint';
    } else if (fingerprintCandidates.length > 1) {
      eventLineageStatus = 'ambiguous';
    }

    const eventReason = cleanText(lineageEvent?.reason);
    const eventIsBackfill = toInt(lineageEvent?.is_backfill, 0) === 1;
    let traceCode = operationType;
    let traceSeverity: 'normal' | 'info' | 'review' = 'normal';
    let traceTitle = operationLabel;
    let traceExplanation = 'Операция относится к выбранному периоду.';

    if (operationType === 'debt_close') {
      traceCode = 'debt_close';
      traceTitle = 'Закрытие долга';
      traceExplanation = 'Отдельная оплата долга после создания заказа — нормальная денежная операция.';
    } else if (operationType === 'order_extra') {
      traceCode = 'legacy_order_extra';
      traceSeverity = 'info';
      traceTitle = 'Закрытие долга (старый тип)';
      traceExplanation = 'Старая запись использует прежний технический тип «extra». В текущей модели отдельной доплаты по обычному заказу нет: такая последующая оплата относится к закрытию долга.';
    } else if (operationType === 'exchange_extra') {
      traceCode = 'exchange_extra';
      traceTitle = 'Доплата по обмену';
      traceExplanation = 'Доплата связана с обменом и учитывается по дате операции обмена.';
    } else if (eventLineageStatus === 'ambiguous') {
      traceCode = 'lineage_ambiguous';
      traceSeverity = 'review';
      traceTitle = 'Неоднозначное происхождение оплаты';
      traceExplanation = 'Найдено несколько одинаково подходящих исторических событий. Система не выдаёт догадку за доказанный факт.';
    } else if (eventLineageStatus === 'missing') {
      traceCode = 'lineage_missing';
      traceSeverity = dateRelation === 'same_day' ? 'info' : 'review';
      traceTitle = 'Нет точной записи происхождения оплаты';
      traceExplanation = 'Текущая оплата существует, но точное неизменяемое событие её создания не найдено.';
    } else if (eventIsBackfill || eventReason === 'baseline') {
      traceCode = 'legacy_baseline';
      traceSeverity = 'info';
      traceTitle = 'Историческая базовая запись';
      traceExplanation = 'Эта запись восстановлена как достоверный снимок существовавшего состояния. Первоначальное действие пользователя по старой истории доказать нельзя.';
    } else if (dateRelation === 'before_order') {
      traceCode = 'primary_before_order';
      traceSeverity = 'review';
      traceTitle = 'Оплата раньше даты заказа';
      traceExplanation = 'Первичная оплата датирована раньше бизнес-даты заказа. Это требует проверки.';
    } else if (dateRelation === 'after_order') {
      if (eventReason === 'order_create' && orderCreatedDate && recordedDate === paymentDate && orderCreatedDate === paymentDate) {
        traceCode = 'backdated_order_entry';
        traceSeverity = 'info';
        traceTitle = 'Заказ введён позже своей бизнес-даты';
        traceExplanation = 'Оплата записана в том же создании заказа, но сам заказ был введён в систему позже указанной бизнес-даты.';
      } else if (eventReason === 'order_create') {
        traceCode = 'primary_future_dated';
        traceSeverity = 'review';
        traceTitle = 'Первичная оплата имеет другую дату';
        traceExplanation = 'Оплата создана вместе с заказом, но её бизнес-дата позже даты заказа.';
      } else {
        traceCode = 'primary_recorded_later';
        traceSeverity = 'review';
        traceTitle = 'Первичная оплата записана позже заказа';
        traceExplanation = 'Строка остаётся первичной оплатой, хотя дата отличается от даты заказа. Нужно проверить смысл операции.';
      }
    } else {
      traceCode = 'primary_same_day';
      traceTitle = 'Дата оплаты совпадает с датой заказа';
      traceExplanation = 'Первичная оплата и заказ относятся к одному бизнес-дню.';
    }

    return {
      id,
      orderId,
      externalId: cleanText(row.external_id),
      orderDate,
      orderCreatedAt,
      paymentDate,
      method,
      amount,
      paymentKind: cleanText(row.payment_kind),
      operationType,
      operationLabel,
      comment: cleanText(row.comment),
      createdAt,
      recordedLagDays: financeDateOffset(recordedDate, paymentDate),
      orderRecordedLagDays: financeDateOffset(orderCreatedDate, orderDate),
      managerId: row.manager_id == null ? null : Number(row.manager_id),
      manager: cleanText(row.manager) || 'Не указан',
      managerColor: normalizeManagerColor(row.manager_color, toInt(row.manager_id, 1) - 1),
      customer: cleanText(row.customer) || '—',
      city: cleanText(row.city),
      dateRelation,
      dateOffsetDays: Number(row.date_offset_days || 0),
      eventLineageStatus,
      eventId: lineageEvent?.id == null ? null : Number(lineageEvent.id),
      eventAt: cleanText(lineageEvent?.event_at) || null,
      eventRecordedAt: cleanText(lineageEvent?.created_at) || null,
      eventType: cleanText(lineageEvent?.event_type) || null,
      eventReason: eventReason || null,
      eventIsBackfill,
      traceCode,
      traceSeverity,
      traceTitle,
      traceExplanation,
    };
  });
  const paymentTraceReview = paymentOperations.filter((row: any) => row.traceSeverity === 'review');
  const paymentTraceInfo = paymentOperations.filter((row: any) => row.traceSeverity === 'info');
  const crossDatePaymentOperations = paymentOperations.filter((row: any) => row.orderDate < startDate || row.orderDate > endDate);
  const orderPaymentsTotal = paymentOperations.filter((row: any) => row.operationType === 'order_payment').reduce((sum: number, row: any) => sum + row.amount, 0);
  const orderExtraPaymentsTotal = paymentOperations.filter((row: any) => row.operationType === 'order_extra').reduce((sum: number, row: any) => sum + row.amount, 0);
  const debtPaymentsTotal = paymentOperations.filter((row: any) => row.operationType === 'debt_close' || row.operationType === 'order_extra').reduce((sum: number, row: any) => sum + row.amount, 0);
  const exchangeExtraPaymentsTotal = paymentOperations.filter((row: any) => row.operationType === 'exchange_extra').reduce((sum: number, row: any) => sum + row.amount, 0);
  const totalPayments = paymentOperations.reduce((sum: number, row: any) => sum + row.amount, 0);
  const paymentKinds = [
    { operationType: 'order_payment', label: 'Оплаты заказов', count: paymentOperations.filter((row: any) => row.operationType === 'order_payment').length, total: orderPaymentsTotal },
    { operationType: 'debt_close', label: 'Закрытие долгов', count: paymentOperations.filter((row: any) => row.operationType === 'debt_close' || row.operationType === 'order_extra').length, total: debtPaymentsTotal },
    { operationType: 'exchange_extra', label: 'Доплаты по обменам', count: paymentOperations.filter((row: any) => row.operationType === 'exchange_extra').length, total: exchangeExtraPaymentsTotal },
  ];
  const paymentDateAnomalies = paymentOperations.filter((row: any) => row.dateRelation === 'before_order');
  const completedReturns = returns.filter((row: any) => cleanText(row.status) !== 'cancelled');
  const regularReturnsTotal = completedReturns.filter((row: any) => cleanText(row.return_type) !== 'exchange_refund').reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
  const exchangeRefundsTotal = completedReturns.filter((row: any) => cleanText(row.return_type) === 'exchange_refund').reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
  const returnsTotal = regularReturnsTotal + exchangeRefundsTotal;
  const completedExchanges = exchanges.filter((row: any) => cleanText(row.status) !== 'cancelled');
  const refundExchanges = completedExchanges.filter((row: any) => cleanText(row.financial_action) === 'refund');
  const extraExchanges = completedExchanges.filter((row: any) => cleanText(row.financial_action) === 'extra_payment');
  const refundExchangeTotal = refundExchanges.reduce((sum: number, row: any) => sum + Number(row.financial_amount || 0), 0);
  const extraExchangeTotal = extraExchanges.reduce((sum: number, row: any) => sum + Number(row.financial_amount || 0), 0);

  const sales = Number((overviewRow as any)?.total_sales || 0);
  const received = totalPayments;
  const periodReturns = returnsTotal;


  const paymentMethodsByDayMap = new Map<string, { date: string; total: number; methods: Record<string, number> }>();
  for (const row of mapSqlRows(paymentByDayRows) as any[]) {
    const date = cleanText(row.date);
    const method = canonicalPaymentMethodName(row.method);
    const total = Number(row.total || 0);
    if (!paymentMethodsByDayMap.has(date)) paymentMethodsByDayMap.set(date, { date, total: 0, methods: {} });
    const bucket = paymentMethodsByDayMap.get(date)!;
    bucket.methods[method] = (bucket.methods[method] || 0) + total;
    bucket.total += total;
  }

  const managerPaymentMap = new Map<string, { managerId: number; manager: string; colorKey: string; primary_received: number; order_extra_received: number; debt_closed: number; extra_received: number }>();
  for (const row of mapSqlRows(managerPaymentDayRows) as any[]) {
    const managerId = toInt(row.manager_id, 0);
    managerPaymentMap.set(`${cleanText(row.date)}||${managerId}`, {
      managerId,
      manager: cleanText(row.manager) || 'Не указан',
      colorKey: normalizeManagerColor(row.color_key, managerId - 1),
      primary_received: Number(row.primary_received || 0),
      order_extra_received: Number(row.order_extra_received || 0),
      debt_closed: Number(row.debt_closed || 0),
      extra_received: Number(row.extra_received || 0),
    });
  }
  const managerReturnMap = new Map<string, { managerId: number; manager: string; colorKey: string; totalReturns: number }>();
  for (const row of mapSqlRows(managerReturnDayRows) as any[]) {
    const managerId = toInt(row.manager_id, 0);
    managerReturnMap.set(`${cleanText(row.date)}||${managerId}`, {
      managerId,
      manager: cleanText(row.manager) || 'Не указан',
      colorKey: normalizeManagerColor(row.color_key, managerId - 1),
      totalReturns: Number(row.total_returns || 0),
    });
  }
  const managerOrderMap = new Map<string, any>();
  for (const row of mapSqlRows(managerOrderDayRows) as any[]) {
    const managerId = toInt(row.manager_id, 0);
    managerOrderMap.set(`${cleanText(row.date)}||${managerId}`, row);
  }
  const managerKeys = new Set<string>([...managerOrderMap.keys(), ...managerPaymentMap.keys(), ...managerReturnMap.keys()]);
  const managerDaysMap = new Map<string, any>();
  for (const key of managerKeys) {
    const [date, managerIdText] = key.split('||');
    const managerId = toInt(managerIdText, 0);
    const row = managerOrderMap.get(key) || {};
    const paymentInfo = managerPaymentMap.get(key) || { managerId, manager: '', colorKey: '', primary_received: 0, order_extra_received: 0, debt_closed: 0, extra_received: 0 };
    const returnInfo = managerReturnMap.get(key) || { managerId, manager: '', colorKey: '', totalReturns: 0 };
    const manager = cleanText(row.manager) || paymentInfo.manager || returnInfo.manager || 'Не указан';
    const colorKey = normalizeManagerColor(cleanText(row.color_key) || paymentInfo.colorKey || returnInfo.colorKey, managerId - 1);
    const actualReceived = Number(paymentInfo.primary_received || 0) + Number(paymentInfo.order_extra_received || 0) + Number(paymentInfo.debt_closed || 0) + Number(paymentInfo.extra_received || 0);
    const actualReturns = Number(returnInfo.totalReturns || 0);
    if (!managerDaysMap.has(date)) managerDaysMap.set(date, { date, orderCount: 0, totalSales: 0, totalReceived: 0, totalReturns: 0, totalDebt: 0, managers: [] });
    const bucket = managerDaysMap.get(date);
    const managerRow = {
      managerId,
      manager,
      colorKey,
      order_count: Number(row.order_count || 0),
      total_sales: Number(row.total_sales || 0),
      total_received: actualReceived,
      primary_received: Number(paymentInfo.primary_received || 0),
      order_extra_received: Number(paymentInfo.order_extra_received || 0),
      debt_closed: Number(paymentInfo.debt_closed || 0),
      extra_received: Number(paymentInfo.extra_received || 0),
      total_returns: actualReturns,
      total_debt: Number(row.total_debt || 0),
      avg_check: Math.round(Number(row.avg_check || 0)),
    };
    bucket.orderCount += managerRow.order_count;
    bucket.totalSales += managerRow.total_sales;
    bucket.totalReceived += managerRow.total_received;
    bucket.totalReturns += managerRow.total_returns;
    bucket.totalDebt += managerRow.total_debt;
    bucket.managers.push(managerRow);
  }
  for (const bucket of managerDaysMap.values()) bucket.managers.sort((a: any, b: any) => b.total_received - a.total_received || a.manager.localeCompare(b.manager, 'ru') || a.managerId - b.managerId);

  const productDaysMap = new Map<string, any>();
  for (const row of mapSqlRows(productDayRows) as any[]) {
    const date = cleanText(row.date);
    if (!productDaysMap.has(date)) productDaysMap.set(date, { date, quantity: 0, orderCount: 0, products: [] });
    const bucket = productDaysMap.get(date);
    const productRow = { product: cleanText(row.product) || '—', quantity: Number(row.quantity || 0), order_count: Number(row.order_count || 0) };
    bucket.quantity += productRow.quantity;
    bucket.orderCount += productRow.order_count;
    bucket.products.push(productRow);
  }

  const cityOrderDayMap = new Map<string, any>();
  for (const row of mapSqlRows(cityDayRows) as any[]) cityOrderDayMap.set(`${cleanText(row.date)}||${cleanText(row.city) || 'Не указан'}`, row);
  const cityCashDayMap = new Map<string, any>();
  for (const row of mapSqlRows(cityCashDayRows) as any[]) cityCashDayMap.set(`${cleanText(row.date)}||${cleanText(row.city) || 'Не указан'}`, row);
  const cityDaysMap = new Map<string, any>();
  for (const key of new Set<string>([...cityOrderDayMap.keys(), ...cityCashDayMap.keys()])) {
    const [date, city] = key.split('||');
    const row = cityOrderDayMap.get(key) || {};
    const cash = cityCashDayMap.get(key) || {};
    if (!cityDaysMap.has(date)) cityDaysMap.set(date, { date, orderCount: 0, totalSales: 0, cities: [] });
    const bucket = cityDaysMap.get(date);
    const cityRow = {
      city,
      order_count: Number(row.order_count || 0),
      total_sales: Number(row.total_sales || 0),
      total_received: Number(cash.total_received || 0),
      total_returns: Number(cash.total_returns || 0),
      total_debt: Number(row.total_debt || 0),
      clients: Number(row.clients || 0),
      managers: Number(row.managers || 0),
      avg_check: Math.round(Number(row.avg_check || 0)),
    };
    bucket.orderCount += cityRow.order_count;
    bucket.totalSales += cityRow.total_sales;
    bucket.cities.push(cityRow);
  }
  for (const bucket of cityDaysMap.values()) bucket.cities.sort((a: any, b: any) => b.total_received - a.total_received || a.city.localeCompare(b.city, 'ru'));

  const returnDaysMap = new Map<string, any>();
  for (const row of mapSqlRows(returnsDetailRows) as any[]) {
    const date = cleanText(row.date);
    if (!returnDaysMap.has(date)) returnDaysMap.set(date, { date, count: 0, total: 0, returns: [] });
    const bucket = returnDaysMap.get(date);
    const returnRow = {
      id: Number(row.id || 0),
      external_id: cleanText(row.external_id),
      order_date: cleanText(row.order_date),
      operation_date: cleanText(row.operation_date),
      manager: cleanText(row.manager) || 'Не указан',
      customer: cleanText(row.customer) || '—',
      amount: Number(row.amount || 0),
      items: cleanText(row.items),
      comment: cleanText(row.comment),
      status: cleanText(row.status),
      returnType: cleanText(row.return_type) || 'order_return',
    };
    if (returnRow.status !== 'cancelled') {
      bucket.count += 1;
      bucket.total += returnRow.amount;
    }
    bucket.returns.push(returnRow);
  }

  const closedDebtDaysMap = new Map<string, any>();
  for (const row of mapSqlRows(closedDebtDetailRows) as any[]) {
    const date = cleanText(row.date);
    if (!closedDebtDaysMap.has(date)) closedDebtDaysMap.set(date, { date, count: 0, total: 0, rows: [] });
    const bucket = closedDebtDaysMap.get(date);
    const debtRow = {
      id: Number(row.id || 0),
      external_id: cleanText(row.external_id),
      order_date: cleanText(row.order_date),
      operation_date: cleanText(row.operation_date),
      manager: cleanText(row.manager) || 'Не указан',
      customer: cleanText(row.customer) || '—',
      city: cleanText(row.city),
      method: cleanText(row.method),
      amount: Number(row.amount || 0),
      comment: cleanText(row.comment),
    };
    bucket.count += 1;
    bucket.total += debtRow.amount;
    bucket.rows.push(debtRow);
  }

  const [leadReport, callCentreReport, planReport, teamReport] = await Promise.all([
    listLeadRecords(db, url),
    listCallCentreRecords(db, url),
    listPlans(db, url),
    listTeamEmployees(db),
  ]);

  return {
    ok: true,
    type: 'finance',
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    overview: {
      orderCount: Number((overviewRow as any)?.order_count || 0),
      totalSales: sales,
      totalReceived: received,
      totalReturns: periodReturns,
      netCash: received - periodReturns,
      periodDebt: Number((overviewRow as any)?.period_debt || 0),
      avgCheck: Math.round(Number((overviewRow as any)?.avg_check || 0)),
      paymentCount: paymentOperations.length,
      orderPaymentsTotal,
      orderExtraPaymentsTotal,
      debtPaymentsTotal,
      exchangeExtraPaymentsTotal,
      grossReceived: totalPayments,
      regularReturnsTotal,
      exchangeRefundsTotal,
      totalReturned: returnsTotal,
      extraExchangeTotal,
      refundExchangeTotal,
      paymentDateAnomalyCount: paymentDateAnomalies.length,
      paymentDateAnomalyTotal: paymentDateAnomalies.reduce((sum: number, row: any) => sum + row.amount, 0),
      paymentTraceReviewCount: paymentTraceReview.length,
      paymentTraceInfoCount: paymentTraceInfo.length,
      crossDatePaymentCount: crossDatePaymentOperations.length,
      crossDatePaymentTotal: crossDatePaymentOperations.reduce((sum: number, row: any) => sum + row.amount, 0),
      currentDebt: Number((currentDebtRow as any)?.total_debt || 0),
      currentDebtOrders: Number((currentDebtRow as any)?.order_count || 0),
      collectionRate: sales > 0 ? received / sales : 0,
      returnRate: sales > 0 ? periodReturns / sales : 0,
    },
    reports: {
      paymentMethods: paymentRows,
      paymentKinds,
      paymentOperations,
      paymentDateAnomalies,
      paymentTraceReview,
      paymentTraceInfo,
      crossDatePaymentOperations,
      traceScope: { startDate, endDate, selectedPeriodOnly: true },
      consistency: {
        ledgerTotal: totalPayments,
        methodsTotal: paymentRows.reduce((sum, row: any) => sum + Number(row.total || 0), 0),
        kindsTotal: paymentKinds.reduce((sum, row) => sum + Number(row.total || 0), 0),
        difference: Math.max(
          Math.abs(totalPayments - paymentRows.reduce((sum, row: any) => sum + Number(row.total || 0), 0)),
          Math.abs(totalPayments - paymentKinds.reduce((sum, row) => sum + Number(row.total || 0), 0)),
        ),
        ok: totalPayments === paymentRows.reduce((sum, row: any) => sum + Number(row.total || 0), 0)
          && totalPayments === paymentKinds.reduce((sum, row) => sum + Number(row.total || 0), 0),
      },
      managers: normalizedManagerRows,
      products: mapSqlRows(productRows),
      cities: normalizedCityRows,
      days: mapSqlRows(dayRows),
      returns,
      exchanges,
      closedDebts,
      currentDebtTop: mapSqlRows(currentDebtTopRows),
      inventoryMovements: mapSqlRows(inventoryRows),
      repeatClients: mapSqlRows(repeatClientRows),
      activityByType: mapSqlRows(activityRows),
      paymentMethodsByDay: Array.from(paymentMethodsByDayMap.values()),
      managerDays: Array.from(managerDaysMap.values()),
      productDays: Array.from(productDaysMap.values()),
      cityDays: Array.from(cityDaysMap.values()),
      returnDays: Array.from(returnDaysMap.values()).sort((a, b) => cleanText(b.date).localeCompare(cleanText(a.date))),
      closedDebtDays: Array.from(closedDebtDaysMap.values()).sort((a, b) => cleanText(b.date).localeCompare(cleanText(a.date))),
      leads: leadReport.rows,
      leadsTotals: leadReport.totals,
      callCentre: callCentreReport.rows,
      callCentreTotals: callCentreReport.totals,
      managerPlans: planReport.managerPlans,
      departmentPlans: planReport.departmentPlans,
      teamEmployees: teamReport.employees,
    },
  };
}
