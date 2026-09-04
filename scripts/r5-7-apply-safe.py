from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


orders_path = Path('worker/domains/orders-read.ts')
text = orders_path.read_text(encoding='utf-8')

anchor = "  const dateTo = cleanText(url.searchParams.get('dateTo'));\n  let aggregateNeedsManagerJoin = false;"
replacement = """  const dateTo = cleanText(url.searchParams.get('dateTo'));
  // R5.7: paymentCount is not rendered by the Orders UI. Legacy callers still get it by default.
  // The UI may explicitly opt out so an active/no-date summary can reuse the canonical per-order
  // received_amount instead of scanning every payment again.
  const includePaymentCount = cleanText(url.searchParams.get('includePaymentCount')) !== '0';
  let aggregateNeedsManagerJoin = false;"""
if text.count(anchor) != 1:
    raise SystemExit(f'includePaymentCount anchor mismatch: {text.count(anchor)}')
text = text.replace(anchor, replacement, 1)

order_region = text.index('  let orderStats: Record<string, unknown> | null = null;')
order_start = text.index('  } else {\n    orderStats = await db.prepare(`', order_region)
order_end_marker = '\n  }\n\n  let paymentStats: Record<string, unknown> | null = null;'
order_end = text.index(order_end_marker, order_start)
new_order_else = """  } else {
    // R5.7 Production forensic: the old materialized Workshop aggregate cost 5,212 rows_read.
    // The correlated lookup below uses idx_order_items_workshop_order_quantity and returned the
    // exact same totals at 3,739 rows_read. received_amount is folded into this same orders scan.
    orderStats = await db.prepare(`
      SELECT
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.total_amount), 0) AS total_amount,
        COALESCE(SUM(o.received_amount), 0) AS payment_amount,
        COALESCE(SUM(o.debt_amount), 0) AS debt_amount,
        COALESCE(SUM((
          SELECT COALESCE(SUM(oi.quantity), 0)
          FROM order_items oi
          WHERE oi.order_id = o.id AND oi.is_workshop = 1
        )), 0) AS workshop_units
      ${aggregateJoins}
      ${orderWhereParts.length ? `WHERE ${orderWhereParts.join(' AND ')}` : ''}`
    ).bind(...orderBindings).first<Record<string, unknown>>();"""
text = text[:order_start] + new_order_else + text[order_end:]

payment_region = text.index('  let paymentStats: Record<string, unknown> | null = null;')
payment_start = text.index('  } else {\n    [paymentStats, returnStats] = await Promise.all([', payment_region)
payment_end_marker = '\n  }\n\n  const totalCount = toInt(orderStats?.order_count, 0);'
payment_end = text.index(payment_end_marker, payment_start)
new_payment_else = """  } else {
    const returnStatsPromise = db.prepare(`
      SELECT COUNT(r.id) AS return_count, COALESCE(SUM(r.amount), 0) AS return_amount
      FROM returns r
      JOIN orders o ON o.id = r.order_id
      ${aggregateNeedsManagerJoin ? 'LEFT JOIN managers m ON m.id = o.manager_id' : ''}
      ${aggregateNeedsCustomerJoin ? 'LEFT JOIN customers c ON c.id = o.customer_id' : ''}
      ${returnWhereParts.length ? `WHERE ${returnWhereParts.join(' AND ')}` : ''}`
    ).bind(...returnBindings).first<Record<string, unknown>>();

    // Before R5.7, Production verified zero received_amount/payment-sum mismatches across all
    // 1,295 active orders. Therefore any subset of those active orders has the same payment total.
    // Payment-date windows and non-active/archive modes keep the legacy exact payments query.
    const canUseOrderReceivedPaymentAmount = !includePaymentCount
      && archiveMode === 'active'
      && (status === 'all' || status === 'active')
      && !dateFrom
      && !dateTo;

    if (canUseOrderReceivedPaymentAmount) {
      paymentStats = { payment_count: null, payment_amount: toInt(orderStats?.payment_amount, 0) };
      returnStats = await returnStatsPromise;
    } else {
      [paymentStats, returnStats] = await Promise.all([
        db.prepare(`
          SELECT COUNT(p.id) AS payment_count, COALESCE(SUM(p.amount), 0) AS payment_amount
          FROM payments p
          JOIN orders o ON o.id = p.order_id
          ${aggregateNeedsManagerJoin ? 'LEFT JOIN managers m ON m.id = o.manager_id' : ''}
          ${aggregateNeedsCustomerJoin ? 'LEFT JOIN customers c ON c.id = o.customer_id' : ''}
          ${paymentWhereParts.length ? `WHERE ${paymentWhereParts.join(' AND ')}` : ''}`
        ).bind(...paymentBindings).first<Record<string, unknown>>(),
        returnStatsPromise,
      ]);
    }"""
text = text[:payment_start] + new_payment_else + text[payment_end:]

old_count = '      paymentCount: toInt(paymentStats?.payment_count, 0),'
new_count = '      paymentCount: paymentStats?.payment_count == null ? null : toInt(paymentStats.payment_count, 0),'
if text.count(old_count) != 1:
    raise SystemExit(f'paymentCount response anchor mismatch: {text.count(old_count)}')
text = text.replace(old_count, new_count, 1)
orders_path.write_text(text, encoding='utf-8')

replace_once(
    'src/App.tsx',
    "        dateTo: activeFilters.dateTo,\n      })",
    """        dateTo: activeFilters.dateTo,
        // R5.7: paymentCount is not rendered by the Orders UI. Opt out only where the Worker has
        // a proven received_amount/payment-sum equivalence and no payment-date window.
        includePaymentCount: activeFilters.archiveMode === 'active' && !activeFilters.dateFrom && !activeFilters.dateTo ? '0' : '1',
      })""",
    'App includePaymentCount',
)

replace_once(
    'src/app/types.ts',
    '  paymentCount: number\n',
    '  paymentCount: number | null\n',
    'OrderPeriodStats paymentCount nullable',
)

print('R5.7 source transformation applied successfully.')
