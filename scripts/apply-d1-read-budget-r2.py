from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(rel): return (ROOT / rel).read_text(encoding='utf-8')
def write(rel, text): (ROOT / rel).write_text(text, encoding='utf-8')
def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)

def replace_between(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0: raise SystemExit(f'{label}: start marker missing')
    end = text.find(end_marker, start)
    if end < 0: raise SystemExit(f'{label}: end marker missing')
    return text[:start] + replacement + text[end:]

# 1) Canonical compact handover resolver: allow all-active summary and hydrate only summary facts.
rel = 'worker/domains/order-reservations.ts'
text = read(rel)
start = '    if (listFlagsOnly) {\n'
end = '    const orderScope = chunk\n'
new_compact = '''    if (listFlagsOnly) {
      if (!allActive && !chunk?.length) throw new Error('Compact handover flags require an explicit order scope.');
      const placeholders = chunk?.map(() => '?').join(',') || '';
      const reservationScope = allActive
        ? `r.status = 'active' AND r.variant_id IS NOT NULL
           AND scoped_order.order_status NOT IN ('deleted', 'archived')
           AND COALESCE(scoped_order.shipping_status, 'not_sent') <> 'sent'`
        : `r.order_id IN (${placeholders}) AND r.status = 'active' AND r.variant_id IS NOT NULL`;
      // D1 read-budget R2: list/attention summaries need lineage flags and stock totals, not the
      // full customer/catalog payload. The detailed handover screen still uses the full branch below.
      const compact = await db.prepare(
        `WITH active_reservations AS (
           SELECT r.id AS reservation_id, r.order_id, r.order_item_id, r.inventory_source, r.variant_id,
                  r.quantity AS reservation_quantity
           FROM inventory_reservations r
           JOIN orders scoped_order ON scoped_order.id = r.order_id
           WHERE ${reservationScope}
         ),
         workshop_orders AS (
           SELECT oi.order_id
           FROM order_items oi
           JOIN (SELECT DISTINCT order_id FROM active_reservations) active_order ON active_order.order_id = oi.order_id
           WHERE COALESCE(oi.is_workshop, 0) = 1 AND oi.quantity > 0
           GROUP BY oi.order_id
         ),
         scoped_items AS (
           SELECT
             oi.order_id,
             oi.id AS order_item_id,
             COALESCE(NULLIF(oi.inventory_obligation_key, ''), 'legacy-order-item:' || oi.id) AS obligation_key,
             COALESCE(NULLIF(oi.inventory_obligation_origin_at, ''), oi.created_at) AS origin_at,
             o.order_date,
             ar.inventory_source,
             ar.variant_id,
             CASE WHEN wo.order_id IS NULL THEN 0 ELSE 1 END AS has_workshop
           FROM active_reservations ar
           JOIN order_items oi ON oi.id = ar.order_item_id
           JOIN orders o ON o.id = oi.order_id
           LEFT JOIN workshop_orders wo ON wo.order_id = oi.order_id
           WHERE COALESCE(oi.is_workshop, 0) = 0 AND oi.quantity > 0
         ),
         latest_check AS (
           SELECT si.order_item_id, c.id AS checkpoint_id, c.checked_at AS checkpoint_at,
                  ROW_NUMBER() OVER (PARTITION BY si.order_item_id ORDER BY datetime(c.checked_at) DESC, c.id DESC) AS rn
           FROM scoped_items si
           JOIN inventory_stock_checks c ON c.inventory_source = si.inventory_source AND c.variant_id = si.variant_id
           WHERE (
             (datetime(c.checked_at) < datetime(si.origin_at) AND date(c.checked_at, '+5 hours') >= date(si.order_date))
             OR (si.has_workshop = 1 AND datetime(c.checked_at) > datetime(si.origin_at))
           )
         ),
         latest_full_stocktake AS (
           SELECT si.order_item_id, -s.rowid AS checkpoint_id, s.completed_at AS checkpoint_at,
                  ROW_NUMBER() OVER (PARTITION BY si.order_item_id ORDER BY datetime(s.completed_at) DESC, s.rowid DESC) AS rn
           FROM scoped_items si
           JOIN inventory_stocktake_sessions s ON s.inventory_source = si.inventory_source
           WHERE s.status = 'completed' AND s.completed_at IS NOT NULL AND s.id NOT LIKE 'REV-%-P-%'
             AND datetime(s.started_at) <= datetime(si.origin_at)
             AND date(s.completed_at, '+5 hours') >= date(si.order_date)
             AND NOT EXISTS (
               SELECT 1 FROM inventory_stock_checks exact_sku
               WHERE exact_sku.inventory_source = si.inventory_source
                 AND exact_sku.variant_id = si.variant_id
                 AND exact_sku.reference_type = 'stocktake'
                 AND exact_sku.reference_id = s.id
             )
         ),
         checkpoint_candidates AS (
           SELECT order_item_id, checkpoint_id, checkpoint_at FROM latest_check WHERE rn = 1
           UNION ALL
           SELECT order_item_id, checkpoint_id, checkpoint_at FROM latest_full_stocktake WHERE rn = 1
         ),
         selected_checkpoint AS (
           SELECT order_item_id, checkpoint_id, checkpoint_at,
                  ROW_NUMBER() OVER (PARTITION BY order_item_id ORDER BY datetime(checkpoint_at) DESC, checkpoint_id DESC) AS rn
           FROM checkpoint_candidates
         ),
         latest_review AS (
           SELECT si.order_item_id, hr.checkpoint_id AS reviewed_checkpoint_id, hr.checkpoint_at AS reviewed_checkpoint_at,
                  ROW_NUMBER() OVER (
                    PARTITION BY si.order_item_id
                    ORDER BY datetime(hr.checkpoint_at) DESC, hr.checkpoint_id DESC, hr.id DESC
                  ) AS rn
           FROM scoped_items si
           JOIN inventory_handover_reviews hr ON hr.order_id = si.order_id
           JOIN order_items reviewed_item ON reviewed_item.id = hr.order_item_id
           WHERE COALESCE(NULLIF(reviewed_item.inventory_obligation_key, ''), 'legacy-order-item:' || reviewed_item.id) = si.obligation_key
         )
         SELECT
           ar.order_id, ar.order_item_id, ar.reservation_id, ar.inventory_source, ar.variant_id,
           ar.reservation_quantity,
           COALESCE(stock.quantity, 0) AS physical_quantity,
           COALESCE(stock.reserved_quantity, 0) AS total_reserved_quantity,
           si.order_date, si.origin_at AS item_created_at,
           CASE WHEN
             julianday(cp.checkpoint_at) > 0
             AND (
               COALESCE(julianday(lr.reviewed_checkpoint_at), 0) < julianday(cp.checkpoint_at)
               OR (julianday(lr.reviewed_checkpoint_at) = julianday(cp.checkpoint_at)
                   AND COALESCE(lr.reviewed_checkpoint_id, 0) <> cp.checkpoint_id)
             )
           THEN 1 ELSE 0 END AS review_needed
         FROM active_reservations ar
         JOIN scoped_items si ON si.order_item_id = ar.order_item_id
         LEFT JOIN inventory_stock stock ON stock.inventory_source = ar.inventory_source AND stock.variant_id = ar.variant_id
         LEFT JOIN selected_checkpoint cp ON cp.order_item_id = ar.order_item_id AND cp.rn = 1
         LEFT JOIN latest_review lr ON lr.order_item_id = ar.order_item_id AND lr.rn = 1
         ORDER BY ar.order_id, ar.order_item_id`
      ).bind(...(chunk || [])).all<Record<string, unknown>>();
      rows.push(...(compact.results || []));
      continue;
    }

'''
text = replace_between(text, start, end, new_compact, 'compact handover branch')
write(rel, text)

# 2) Warehouse attention: compact all-active resolver for summary; full payload only for details.
rel = 'worker/domains/warehouse-attention.ts'
text = read(rel)
text = replace_once(text,
    "    fetchOrderStockHandoverRows(db, [], { allActive: true }),",
    "    fetchOrderStockHandoverRows(db, [], { allActive: true, listFlagsOnly: !details }),",
    'attention resolver mode')
old = '''  const handovers = handoverRows
    .map((row) => ({ row, item: stockHandoverItemFromRow(row) }))
    .filter((entry) => entry.item.reviewNeeded)
    .sort((a, b) => {
      const orderDateDelta = cleanText(b.row.order_date).localeCompare(cleanText(a.row.order_date))
      if (orderDateDelta) return orderDateDelta
      return handoverSortMillis(b.item.itemCreatedAt) - handoverSortMillis(a.item.itemCreatedAt)
    })

  const handoverReservations = new Map<string, { reviewReserved: number; totalReserved: number; physical: number }>()
  for (const { row } of handovers) {
'''
new = '''  const handovers = details
    ? handoverRows
        .map((row) => ({ row, item: stockHandoverItemFromRow(row) }))
        .filter((entry) => entry.item.reviewNeeded)
        .sort((a, b) => {
          const orderDateDelta = cleanText(b.row.order_date).localeCompare(cleanText(a.row.order_date))
          if (orderDateDelta) return orderDateDelta
          return handoverSortMillis(b.item.itemCreatedAt) - handoverSortMillis(a.item.itemCreatedAt)
        })
    : []
  const handoverReviewRows = details
    ? handovers.map(({ row }) => row)
    : handoverRows.filter((row) => toInt(row.review_needed, 0) === 1)

  const handoverReservations = new Map<string, { reviewReserved: number; totalReserved: number; physical: number }>()
  for (const row of handoverReviewRows) {
'''
text = replace_once(text, old, new, 'attention handover summary')
text = replace_once(text, '    handover: handovers.length,', '    handover: handoverReviewRows.length,', 'attention handover count')
write(rel, text)

# 3) Orders: indexed ORD-prefix path + reuse already-loaded relations for date-bounded stats.
rel = 'worker/domains/orders-read.ts'
text = read(rel)
old_q_start = '  if (q) {\n    const exactExternalId = /^ORD-\\d{8,14}-[A-Z0-9]{4,16}$/i.test(q) ? q.toUpperCase() : \'\';\n'
q_start = text.find(old_q_start)
q_end_marker = '\n\n  const orderWhereParts = [...baseWhereParts];'
q_end = text.find(q_end_marker, q_start)
if q_start < 0 or q_end < 0: raise SystemExit('orders q block markers missing')
new_q = '''  if (q) {
    const normalizedExternalId = q.toUpperCase();
    const exactExternalId = /^ORD-\d{8,14}-[A-Z0-9]{4,16}$/i.test(q) ? normalizedExternalId : '';
    const externalIdPrefix = !exactExternalId && /^ORD-[A-Z0-9-]*$/i.test(q) ? normalizedExternalId : '';
    if (exactExternalId) {
      baseWhereParts.push('o.external_id = ?');
      baseBindings.push(exactExternalId);
    } else if (externalIdPrefix) {
      // D1 read-budget R2: while the operator is typing/copying an ORD id, stay on the
      // indexed external_id range instead of scanning customers/items/payments per keystroke.
      baseWhereParts.push('o.external_id >= ? AND o.external_id < ?');
      baseBindings.push(externalIdPrefix, `${externalIdPrefix}\uffff`);
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
  }'''
text = text[:q_start] + new_q + text[q_end:]
old = '''  if (completeOrderResult && !dateFrom && !dateTo) {
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
'''
new = '''  if (completeOrderResult) {
    let paymentCount = 0;
    let paymentAmount = 0;
    let returnCount = 0;
    let returnAmount = 0;
    const statsDateFrom = dateFrom ? normalizeDate(dateFrom) : '';
    const statsDateTo = dateTo ? normalizeDate(dateTo) : '';
    for (const order of orders) {
      for (const payment of relations.paymentsByOrderId.get(order.id) || []) {
        const record = payment as Record<string, unknown>;
        const paymentDate = cleanText(record.payment_date);
        if (statsDateFrom && paymentDate < statsDateFrom) continue;
        if (statsDateTo && paymentDate > statsDateTo) continue;
        paymentCount += 1;
        paymentAmount += toInt(record.amount, 0);
      }
      for (const returned of relations.returnsByOrderId.get(order.id) || []) {
        const record = returned as Record<string, unknown>;
        if (cleanText(record.status || 'completed').toLowerCase() === 'cancelled') continue;
        const returnDate = cleanText(record.return_date);
        if (statsDateFrom && returnDate < statsDateFrom) continue;
        if (statsDateTo && returnDate > statsDateTo) continue;
        returnCount += 1;
        returnAmount += toInt(record.amount, 0);
      }
    }
'''
text = replace_once(text, old, new, 'orders relation stats')
write(rel, text)

# 4) Inventory snapshot: join active catalog once rather than correlated EXISTS per stock row.
rel = 'worker/domains/inventory-read.ts'
text = read(rel)
old = '''  const searchableSql = `LOWER(
    COALESCE(product_name_snapshot, '') || ' ' ||
    COALESCE(gender_snapshot, '') || ' ' ||
    COALESCE(color_snapshot, '') || ' ' ||
    COALESCE(material_snapshot, '') || ' ' ||
    COALESCE(length_snapshot, '') || ' ' ||
    COALESCE(size_snapshot, '') || ' ' ||
    COALESCE(last_action, '') || ' ' ||
    COALESCE(last_source_ref, '')
  )`;
'''
new = '''  const searchableSql = `LOWER(
    COALESCE(s.product_name_snapshot, '') || ' ' ||
    COALESCE(s.gender_snapshot, '') || ' ' ||
    COALESCE(s.color_snapshot, '') || ' ' ||
    COALESCE(s.material_snapshot, '') || ' ' ||
    COALESCE(s.length_snapshot, '') || ' ' ||
    COALESCE(s.size_snapshot, '') || ' ' ||
    COALESCE(s.last_action, '') || ' ' ||
    COALESCE(s.last_source_ref, '')
  )`;
'''
text = replace_once(text, old, new, 'inventory searchable alias')
old = '''  const stockSql = `SELECT
      id, inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
      material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
      last_action, last_source_ref, updated_at, created_at
     FROM inventory_stock
     WHERE inventory_source = ?
       AND (
         variant_id IS NULL
         OR EXISTS (
           SELECT 1
           FROM catalog_variants active_variant
           JOIN catalog_products active_product ON active_product.id = active_variant.product_id
           WHERE active_variant.id = inventory_stock.variant_id
             AND active_variant.is_active = 1
             AND active_product.is_active = 1
         )
       )${searchClauses ? ` AND ${searchClauses}` : ''}
     ORDER BY product_name_snapshot, COALESCE(gender_snapshot, ''), COALESCE(color_snapshot, ''),
       COALESCE(material_snapshot, ''), COALESCE(length_snapshot, ''), COALESCE(size_snapshot, '')
     LIMIT ?`;
'''
new = '''  const stockSql = `SELECT
      s.id, s.inventory_source, s.product_id, s.variant_id, s.product_name_snapshot, s.gender_snapshot, s.color_snapshot,
      s.material_snapshot, s.length_snapshot, s.size_snapshot, s.quantity, s.reserved_quantity,
      s.last_action, s.last_source_ref, s.updated_at, s.created_at
     FROM inventory_stock s
     LEFT JOIN catalog_variants active_variant ON active_variant.id = s.variant_id
     LEFT JOIN catalog_products active_product ON active_product.id = active_variant.product_id
     WHERE s.inventory_source = ?
       AND (s.variant_id IS NULL OR (active_variant.is_active = 1 AND active_product.is_active = 1))${searchClauses ? ` AND ${searchClauses}` : ''}
     ORDER BY s.product_name_snapshot, COALESCE(s.gender_snapshot, ''), COALESCE(s.color_snapshot, ''),
       COALESCE(s.material_snapshot, ''), COALESCE(s.length_snapshot, ''), COALESCE(s.size_snapshot, '')
     LIMIT ?`;
'''
text = replace_once(text, old, new, 'inventory stock query')
write(rel, text)

# 5) Team employees: scan each reference table once, not once per manager.
rel = 'worker/domains/team.ts'
text = read(rel)
start = text.find('export async function listTeamEmployees(db: D1Database) {')
end = text.find('\n\nexport async function saveTeamEmployee', start)
if start < 0 or end < 0: raise SystemExit('listTeamEmployees markers missing')
old_func = text[start:end]
query_start = old_func.find('  const result = await db.prepare(\n')
query_end = old_func.find('\n\n  const rows = mapSqlRows', query_start)
if query_start < 0 or query_end < 0: raise SystemExit('listTeamEmployees query markers missing')
new_query = '''  // D1 read-budget R2: aggregate each history table once. The previous eight scalar
  // subqueries were cheap per employee but multiplied into hundreds of thousands of row reads.
  const result = await db.prepare(
    `WITH order_refs AS (
       SELECT manager_id, COUNT(*) AS ref_count, MIN(order_date) AS first_order_at
       FROM orders WHERE manager_id IS NOT NULL GROUP BY manager_id
     ), return_refs AS (
       SELECT manager_id, COUNT(*) AS ref_count FROM returns WHERE manager_id IS NOT NULL GROUP BY manager_id
     ), exchange_refs AS (
       SELECT manager_id, COUNT(*) AS ref_count FROM exchanges WHERE manager_id IS NOT NULL GROUP BY manager_id
     ), plan_refs AS (
       SELECT manager_id, COUNT(*) AS ref_count FROM plans WHERE manager_id IS NOT NULL GROUP BY manager_id
     ), lead_refs AS (
       SELECT manager_id, COUNT(*) AS ref_count FROM lead_records WHERE manager_id IS NOT NULL GROUP BY manager_id
     ), call_refs AS (
       SELECT manager_id, COUNT(*) AS ref_count FROM call_centre_records WHERE manager_id IS NOT NULL GROUP BY manager_id
     ), timesheet_refs AS (
       SELECT manager_id, COUNT(*) AS ref_count FROM team_timesheet WHERE manager_id IS NOT NULL GROUP BY manager_id
     ), attendance_refs AS (
       SELECT manager_id, COUNT(*) AS ref_count FROM attendance_days WHERE manager_id IS NOT NULL GROUP BY manager_id
     )
     SELECT m.id, m.name, m.is_active, COALESCE(m.role, '') AS role, COALESCE(m.phone, '') AS phone,
            COALESCE(m.comment, '') AS comment, COALESCE(m.color_key, '') AS color_key,
            COALESCE(orx.first_order_at, m.hired_at, substr(m.created_at, 1, 10)) AS hired_at,
            COALESCE(m.dismissed_at, '') AS dismissed_at,
            m.created_at, m.updated_at,
            COALESCE(orx.ref_count, 0) + COALESCE(rr.ref_count, 0) + COALESCE(er.ref_count, 0)
              + COALESCE(pr.ref_count, 0) + COALESCE(lr.ref_count, 0) + COALESCE(cr.ref_count, 0)
              + COALESCE(tr.ref_count, 0) + COALESCE(ar.ref_count, 0) AS reference_count
     FROM managers m
     LEFT JOIN order_refs orx ON orx.manager_id = m.id
     LEFT JOIN return_refs rr ON rr.manager_id = m.id
     LEFT JOIN exchange_refs er ON er.manager_id = m.id
     LEFT JOIN plan_refs pr ON pr.manager_id = m.id
     LEFT JOIN lead_refs lr ON lr.manager_id = m.id
     LEFT JOIN call_refs cr ON cr.manager_id = m.id
     LEFT JOIN timesheet_refs tr ON tr.manager_id = m.id
     LEFT JOIN attendance_refs ar ON ar.manager_id = m.id
     ORDER BY m.is_active DESC, hired_at DESC, m.name ASC, m.id DESC`
  ).all<any>();'''
new_func = old_func[:query_start] + new_query + old_func[query_end:]
text = text[:start] + new_func + text[end:]
write(rel, text)

# 6) Clients: carry filtered count as a window value instead of rebuilding the entire stats CTE twice.
rel = 'worker/domains/clients.ts'
text = read(rel)
old = '''  const [summary, countRow, rows] = await Promise.all([
    getClientsSummary(db),
    db.prepare(`${cte} SELECT COUNT(*) AS count FROM stats WHERE ${whereSql}`).bind(...bindings).first<{ count: number }>(),
    db.prepare(`
      ${cte}
      SELECT
        id,
'''
new = '''  const [summary, rows] = await Promise.all([
    getClientsSummary(db),
    db.prepare(`
      ${cte}
      SELECT
        COUNT(*) OVER() AS filtered_count,
        id,
'''
text = replace_once(text, old, new, 'clients count window start')
old = '''  const clientRows = rows.results || [];
  const clientIds = clientRows.map((row) => toInt(row.id, 0)).filter(Boolean);
'''
new = '''  const clientRows = rows.results || [];
  // Window count removes the normal second full client-history scan. Only an out-of-range
  // pagination request needs the old count fallback to preserve an exact total.
  let filteredCount = clientRows.length ? toInt(clientRows[0].filtered_count, 0) : 0;
  if (!clientRows.length && offset > 0) {
    const countRow = await db.prepare(`${cte} SELECT COUNT(*) AS count FROM stats WHERE ${whereSql}`).bind(...bindings).first<{ count: number }>();
    filteredCount = toInt(countRow?.count, 0);
  }
  const clientIds = clientRows.map((row) => toInt(row.id, 0)).filter(Boolean);
'''
text = replace_once(text, old, new, 'clients count fallback')
text = replace_once(text, '    count: toInt(countRow?.count, 0),', '    count: filteredCount,', 'clients count response')
write(rel, text)

# 7) Frontend: short summary cache + in-flight coalescing without adding hooks.
rel = 'src/App.tsx'
text = read(rel)
marker = '\nfunction handoverCheckpointDateLabel(value: string | null | undefined) {'
insert = '''
const WAREHOUSE_ATTENTION_SUMMARY_TTL_MS = 20_000
let warehouseAttentionSummaryCache: { data: WarehouseAttentionSummaryResponse; loadedAt: number } | null = null
let warehouseAttentionSummaryInFlight: Promise<WarehouseAttentionSummaryResponse | null> | null = null
let warehouseAttentionRequestToken = 0

function handoverCheckpointDateLabel(value: string | null | undefined) {'''
text = replace_once(text, marker, '\n' + insert, 'attention frontend cache marker')
old = '''  async function loadWarehouseAttention(details = false) {
    const response = await apiFetch(`/api/inventory/attention${details ? '?details=1&limit=30' : ''}`)
    if (!response.ok) return null
    const data = await readJsonResponse<WarehouseAttentionSummaryResponse>(response, 'Склад')
    setWarehouseAttention(data)
    return data
  }
'''
new = '''  async function loadWarehouseAttention(details = false, force = false) {
    if (!details && !force) {
      const cached = warehouseAttentionSummaryCache
      if (cached && Date.now() - cached.loadedAt < WAREHOUSE_ATTENTION_SUMMARY_TTL_MS) {
        setWarehouseAttention(cached.data)
        return cached.data
      }
      if (warehouseAttentionSummaryInFlight) {
        const data = await warehouseAttentionSummaryInFlight
        if (data) setWarehouseAttention(data)
        return data
      }
    }
    const requestToken = ++warehouseAttentionRequestToken
    const request = (async () => {
      const response = await apiFetch(`/api/inventory/attention${details ? '?details=1&limit=30' : ''}`)
      if (!response.ok) return null
      return await readJsonResponse<WarehouseAttentionSummaryResponse>(response, 'Склад')
    })()
    if (!details) warehouseAttentionSummaryInFlight = request
    try {
      const data = await request
      if (!data || requestToken !== warehouseAttentionRequestToken) return data
      setWarehouseAttention(data)
      if (!details) warehouseAttentionSummaryCache = { data, loadedAt: Date.now() }
      return data
    } finally {
      if (!details && warehouseAttentionSummaryInFlight === request) warehouseAttentionSummaryInFlight = null
    }
  }
'''
text = replace_once(text, old, new, 'loadWarehouseAttention')
old = '''  function invalidateInventoryStockCaches(includeCatalogReview = false) {
    setInventoryData({ warehouse: null, boutique: null })
    if (includeCatalogReview) setCatalogReview(null)
    void loadWarehouseAttention()
  }
'''
new = '''  function invalidateInventoryStockCaches(includeCatalogReview = false) {
    setInventoryData({ warehouse: null, boutique: null })
    if (includeCatalogReview) setCatalogReview(null)
    warehouseAttentionSummaryCache = null
    void loadWarehouseAttention(false, true)
  }
'''
text = replace_once(text, old, new, 'inventory invalidation attention')
# Resolution writes must not be hidden behind a pre-write summary cache.
text = text.replace('        loadWarehouseAttention(),\n      ])\n      setMessage(result?.message || \'Позиция разобрана.\')',
                    '        loadWarehouseAttention(false, true),\n      ])\n      setMessage(result?.message || \'Позиция разобрана.\')', 1)
write(rel, text)

# 8) Structural guard: chain R2 after R1 for base declarations and 192B1-added declarations.
rel = 'scripts/test-step1906a-worker-modularization.mjs'
text = read(rel)
text = replace_once(text,
    "const d1ReadBudgetPath = path.join(root, 'scripts/d1-read-budget-r1-worker-manifest.json')\n",
    "const d1ReadBudgetPath = path.join(root, 'scripts/d1-read-budget-r1-worker-manifest.json')\nconst d1ReadBudgetR2Path = path.join(root, 'scripts/d1-read-budget-r2-worker-manifest.json')\n",
    'structural r2 path')
old = '''  const d1ReadBudget = JSON.parse(fs.readFileSync(d1ReadBudgetPath, 'utf8'))
  check(d1ReadBudget?.version === 1 && d1ReadBudget?.revision === 'd1-read-budget-r1', 'D1 read-budget R1 Worker manifest invalid')
  const d1ReadBudgetChanges = d1ReadBudget.changes || {}
'''
new = '''  const d1ReadBudget = JSON.parse(fs.readFileSync(d1ReadBudgetPath, 'utf8'))
  check(d1ReadBudget?.version === 1 && d1ReadBudget?.revision === 'd1-read-budget-r1', 'D1 read-budget R1 Worker manifest invalid')
  const d1ReadBudgetChanges = d1ReadBudget.changes || {}
  check(fs.existsSync(d1ReadBudgetR2Path), 'D1 read-budget R2 Worker manifest missing')
  const d1ReadBudgetR2 = JSON.parse(fs.readFileSync(d1ReadBudgetR2Path, 'utf8'))
  check(d1ReadBudgetR2?.version === 1 && d1ReadBudgetR2?.revision === 'd1-read-budget-r2', 'D1 read-budget R2 Worker manifest invalid')
  const d1ReadBudgetR2Changes = d1ReadBudgetR2.changes || {}
'''
text = replace_once(text, old, new, 'structural r2 manifest load')
old = '''    const d1ReadBudgetChanged = d1ReadBudgetChanges[name]
    if (d1ReadBudgetChanged) {
      check(d1ReadBudgetChanged.before === acceptedPostD1CapacityHash, `D1 read-budget R1 baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1ReadBudgetChanged.after, `Worker declaration changed beyond exact D1 read-budget R1 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1CapacityHash, `Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability / Shipping shortage / Exchange stale-handover / payment-method / cancellation-autonomy / order-edit-autonomy / D1-capacity / D1-read-budget deltas: ${name}`)
    }
'''
new = '''    const d1ReadBudgetChanged = d1ReadBudgetChanges[name]
    let acceptedPostD1ReadBudgetHash = acceptedPostD1CapacityHash
    if (d1ReadBudgetChanged) {
      check(d1ReadBudgetChanged.before === acceptedPostD1CapacityHash, `D1 read-budget R1 baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetHash = d1ReadBudgetChanged.after
    }
    const d1ReadBudgetR2Changed = d1ReadBudgetR2Changes[name]
    if (d1ReadBudgetR2Changed) {
      check(d1ReadBudgetR2Changed.before === acceptedPostD1ReadBudgetHash, `D1 read-budget R2 baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1ReadBudgetR2Changed.after, `Worker declaration changed beyond exact D1 read-budget R2 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetHash, `Worker declaration body changed beyond accepted cumulative deltas: ${name}`)
    }
'''
text = replace_once(text, old, new, 'structural base r2 chain')
# 192B1-added loop already has R1 special handling; extend it once after R1.
old = '''    const d1ReadBudgetChanged = d1ReadBudgetChanges[name]
    if (d1ReadBudgetChanged) {
      check(d1ReadBudgetChanged.before === acceptedPostOrderCreateHash, `D1 read-budget R1 changed 192B1-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1ReadBudgetChanged.after, `192B1-added declaration changed beyond exact D1 read-budget R1 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostOrderCreateHash, `192B1 added Worker declaration changed beyond accepted deltas: ${name}`)
    }
'''
new = '''    const d1ReadBudgetChanged = d1ReadBudgetChanges[name]
    let acceptedPostD1ReadBudgetHash = acceptedPostOrderCreateHash
    if (d1ReadBudgetChanged) {
      check(d1ReadBudgetChanged.before === acceptedPostOrderCreateHash, `D1 read-budget R1 changed 192B1-added declaration baseline hash mismatch: ${name}`)
      acceptedPostD1ReadBudgetHash = d1ReadBudgetChanged.after
    }
    const d1ReadBudgetR2Changed = d1ReadBudgetR2Changes[name]
    if (d1ReadBudgetR2Changed) {
      check(d1ReadBudgetR2Changed.before === acceptedPostD1ReadBudgetHash, `D1 read-budget R2 changed 192B1-added declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === d1ReadBudgetR2Changed.after, `192B1-added declaration changed beyond exact D1 read-budget R2 allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetHash, `192B1 added Worker declaration changed beyond accepted deltas: ${name}`)
    }
'''
text = replace_once(text, old, new, 'structural 192b1 r2 chain')
write(rel, text)

# 9) Cumulative regression + release gate.
test = r'''import fs from 'node:fs'
const read = (p) => fs.readFileSync(p, 'utf8')
const check = (ok, msg) => { if (!ok) throw new Error(msg) }
const reservations = read('worker/domains/order-reservations.ts')
const attention = read('worker/domains/warehouse-attention.ts')
const orders = read('worker/domains/orders-read.ts')
const inventory = read('worker/domains/inventory-read.ts')
const team = read('worker/domains/team.ts')
const clients = read('worker/domains/clients.ts')
const app = read('src/App.tsx')
check(reservations.includes("allActive?: boolean; listFlagsOnly?: boolean"), 'compact resolver options lost')
check(reservations.includes("scoped_order.order_status NOT IN ('deleted', 'archived')"), 'all-active compact scope must exclude closed operational history')
check(reservations.includes('COALESCE(stock.reserved_quantity, 0) AS total_reserved_quantity'), 'compact attention stock totals missing')
check(attention.includes("{ allActive: true, listFlagsOnly: !details }"), 'attention summary must request compact handover rows')
check(attention.includes('handoverRows.filter((row) => toInt(row.review_needed, 0) === 1)'), 'compact attention review flags not consumed')
check(orders.includes("baseWhereParts.push('o.external_id >= ? AND o.external_id < ?')"), 'ORD prefix must use indexed range')
check(orders.includes('if (completeOrderResult) {') && orders.includes('const statsDateFrom = dateFrom ? normalizeDate(dateFrom)'), 'complete result must reuse relation stats across date ranges')
check(inventory.includes('LEFT JOIN catalog_variants active_variant ON active_variant.id = s.variant_id'), 'inventory snapshot must join active variant once')
check(!inventory.includes('WHERE active_variant.id = inventory_stock.variant_id'), 'correlated active-variant EXISTS returned')
check(team.includes('WITH order_refs AS') && team.includes('LEFT JOIN attendance_refs ar ON ar.manager_id = m.id'), 'team reference counts must be preaggregated')
check(!team.includes('(SELECT COUNT(*) FROM orders o WHERE o.manager_id = m.id)'), 'per-manager correlated order count returned')
check(clients.includes('COUNT(*) OVER() AS filtered_count'), 'client list must carry filtered count in the page query')
check(app.includes('WAREHOUSE_ATTENTION_SUMMARY_TTL_MS') && app.includes('warehouseAttentionSummaryInFlight'), 'attention summary cache/coalescing missing')
check(app.includes('void loadWarehouseAttention(false, true)'), 'inventory writes must force attention refresh')
console.log('D1 read-budget R2 regression: OK')
'''
write('scripts/test-d1-read-budget-r2.mjs', test)
rel = 'package.json'
text = read(rel)
text = replace_once(text,
    '&& node scripts/test-d1-read-budget-r1.mjs"',
    '&& node scripts/test-d1-read-budget-r1.mjs && node scripts/test-d1-read-budget-r2.mjs"',
    'release gate append r2')
write(rel, text)

print('D1 read-budget R2 source patch applied')
