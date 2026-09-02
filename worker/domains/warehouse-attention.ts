import { canonicalStockPositionValue, cleanText, normalizeAudienceCategory, normalizeSourceType, toInt } from '../core/text.ts'
import { catalogReviewBasePredicate, catalogReviewOperationalPredicate } from './catalog-review.ts'
import { fetchOrderStockHandoverRows, stockHandoverItemFromRow } from './order-reservations.ts'

const ATTENTION_DETAIL_LIMIT = 50

function clampLimit(value: unknown) {
  return Math.min(50, Math.max(5, toInt(value, ATTENTION_DETAIL_LIMIT)))
}

function handoverKey(row: Record<string, unknown>) {
  const source = normalizeSourceType(row.inventory_source)
  const variantId = toInt(row.variant_id, 0)
  return variantId > 0 ? `${source}:${variantId}` : ''
}

function handoverSortMillis(value: unknown) {
  const text = cleanText(value)
  if (!text) return 0
  const parsed = Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function getWarehouseAttentionSummary(db: D1Database, url?: URL) {
  const base = catalogReviewBasePredicate('oi', 'o')
  const operational = catalogReviewOperationalPredicate('oi', 'o')
  const details = url?.searchParams.get('details') === '1'
  const limit = clampLimit(url?.searchParams.get('limit'))

  const exactLifecycleVariantSql = `COALESCE(
    (SELECT v0.id FROM catalog_variants v0 WHERE v0.id = e.variant_id AND v0.is_active = 1 LIMIT 1),
    (SELECT v.id
     FROM catalog_variants v
     WHERE v.is_active = 1
       AND v.product_id = e.product_id
       AND LOWER(TRIM(COALESCE(v.category, 'adult'))) = CASE WHEN UPPER(TRIM(COALESCE(e.audience_type, ''))) LIKE '%ДЕТ%' OR LOWER(TRIM(COALESCE(e.audience_type, ''))) = 'child' THEN 'child' ELSE 'adult' END
       AND UPPER(TRIM(COALESCE(v.gender, ''))) = UPPER(TRIM(COALESCE(e.gender_snapshot, '')))
       AND UPPER(TRIM(COALESCE(v.color, ''))) = UPPER(TRIM(COALESCE(e.color_snapshot, '')))
       AND UPPER(TRIM(COALESCE(NULLIF(v.material, ''), 'СТАНДАРТ'))) = UPPER(TRIM(COALESCE(NULLIF(e.material_snapshot, ''), 'СТАНДАРТ')))
       AND UPPER(TRIM(COALESCE(NULLIF(v.length, ''), 'СТАНДАРТ'))) = UPPER(TRIM(COALESCE(NULLIF(e.length_snapshot, ''), 'СТАНДАРТ')))
       AND UPPER(TRIM(COALESCE(v.size_label, ''))) = UPPER(TRIM(COALESCE(e.size_snapshot, '')))
     ORDER BY v.id
     LIMIT 1)
  )`

  const [summary, handoverRows] = await Promise.all([
    details ? Promise.resolve(null) : db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM (
            SELECT s.inventory_source, s.variant_id
            FROM inventory_stock s
            WHERE s.quantity < 0
            UNION
            SELECT r.inventory_source, r.variant_id
            FROM inventory_reservations r
            LEFT JOIN inventory_stock s ON s.inventory_source = r.inventory_source AND s.variant_id = r.variant_id
            WHERE r.status = 'active' AND r.variant_id IS NOT NULL
            GROUP BY r.inventory_source, r.variant_id
            HAVING SUM(r.quantity) > COALESCE(MAX(s.quantity), 0)
          )) AS shortage_count,
         (SELECT COUNT(*) FROM inventory_lifecycle_events WHERE status = 'pending') AS lifecycle_total_count,
         (SELECT COUNT(*) FROM inventory_lifecycle_events e
          WHERE e.status = 'pending' AND e.direction = 'in' AND ${exactLifecycleVariantSql} IS NOT NULL) AS intake_count,
         (SELECT COUNT(*) FROM (
            SELECT 1
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE ${base}
              AND ${operational}
              AND NOT EXISTS (
                SELECT 1 FROM inventory_lifecycle_events e
                WHERE e.status = 'pending' AND e.order_item_id = oi.id
              )
            GROUP BY
              UPPER(TRIM(COALESCE(oi.product_name_snapshot, ''))),
              CASE WHEN UPPER(TRIM(COALESCE(oi.audience_type, ''))) LIKE '%ДЕТ%' OR LOWER(TRIM(COALESCE(oi.audience_type, ''))) = 'child' THEN 'child' ELSE 'adult' END,
              UPPER(TRIM(COALESCE(oi.gender_snapshot, ''))),
              UPPER(TRIM(COALESCE(oi.color_snapshot, ''))),
              CASE WHEN TRIM(COALESCE(oi.material_snapshot, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(oi.material_snapshot)) END,
              CASE WHEN TRIM(COALESCE(oi.length_snapshot, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(oi.length_snapshot)) END,
              UPPER(TRIM(COALESCE(oi.size_snapshot, '')))
          )) AS catalog_count,
         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count`
    ).first<Record<string, unknown>>(),
    fetchOrderStockHandoverRows(db, [], { allActive: true, listFlagsOnly: !details }),
  ])

  const handovers = details
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
    const key = handoverKey(row)
    if (!key) continue
    const current = handoverReservations.get(key) || { reviewReserved: 0, totalReserved: Math.max(0, toInt(row.total_reserved_quantity, 0)), physical: toInt(row.physical_quantity, 0) }
    current.reviewReserved += Math.max(0, toInt(row.reservation_quantity, 0))
    current.totalReserved = Math.max(current.totalReserved, Math.max(0, toInt(row.total_reserved_quantity, 0)))
    current.physical = toInt(row.physical_quantity, current.physical)
    handoverReservations.set(key, current)
  }

  const fullyExplainedShortageKeys = new Set<string>()
  for (const [key, value] of handoverReservations) {
    const ordinaryReserved = Math.max(0, value.totalReserved - value.reviewReserved)
    if (value.physical >= 0 && value.totalReserved > value.physical && ordinaryReserved <= value.physical) fullyExplainedShortageKeys.add(key)
  }

  if (!details) {
    const rawShortageCount = Math.max(0, toInt(summary?.shortage_count, 0))
    const intakeCount = Math.max(0, toInt(summary?.intake_count, 0))
    const lifecycleTotalCount = Math.max(0, toInt(summary?.lifecycle_total_count, 0))
    const counts = {
      shortage: Math.max(0, rawShortageCount - fullyExplainedShortageKeys.size),
      intake: intakeCount,
      lifecycle: Math.max(0, lifecycleTotalCount - intakeCount),
      catalog: Math.max(0, toInt(summary?.catalog_count, 0)),
      handover: handoverReviewRows.length,
      stocktake: Math.max(0, toInt(summary?.stocktake_count, 0)),
    }
    return {
      ok: true,
      total: counts.shortage + counts.intake + counts.lifecycle + counts.catalog + counts.handover + counts.stocktake,
      counts,
    }
  }

  const shortageFetchLimit = Math.min(100, limit + fullyExplainedShortageKeys.size + handoverReservations.size)
  const [shortageResult, lifecycleResult, catalogResult, stocktakeResult, coreSummary] = await Promise.all([
    db.prepare(
      `WITH reservation_totals AS (
         SELECT inventory_source, variant_id, SUM(quantity) AS reserved
         FROM inventory_reservations
         WHERE status = 'active' AND variant_id IS NOT NULL
         GROUP BY inventory_source, variant_id
       ), problem_keys AS (
         SELECT inventory_source, variant_id FROM inventory_stock WHERE quantity < 0 AND variant_id IS NOT NULL
         UNION
         SELECT rt.inventory_source, rt.variant_id
         FROM reservation_totals rt
         LEFT JOIN inventory_stock s ON s.inventory_source = rt.inventory_source AND s.variant_id = rt.variant_id
         WHERE rt.reserved > COALESCE(s.quantity, 0)
       )
       SELECT pk.inventory_source, pk.variant_id,
              COALESCE(v.product_id, s.product_id) AS product_id,
              COALESCE(p.name, s.product_name_snapshot, 'Неизвестный товар') AS product_name,
              COALESCE(v.category, 'adult') AS category,
              COALESCE(v.gender, s.gender_snapshot, '') AS gender,
              COALESCE(v.color, s.color_snapshot, '') AS color,
              COALESCE(NULLIF(v.material, ''), NULLIF(s.material_snapshot, ''), 'СТАНДАРТ') AS material,
              COALESCE(NULLIF(v.length, ''), NULLIF(s.length_snapshot, ''), 'СТАНДАРТ') AS length,
              COALESCE(v.size_label, s.size_snapshot, '') AS size_label,
              COALESCE(s.quantity, 0) AS physical,
              COALESCE(rt.reserved, 0) AS reserved
       FROM problem_keys pk
       LEFT JOIN inventory_stock s ON s.inventory_source = pk.inventory_source AND s.variant_id = pk.variant_id
       LEFT JOIN reservation_totals rt ON rt.inventory_source = pk.inventory_source AND rt.variant_id = pk.variant_id
       LEFT JOIN catalog_variants v ON v.id = pk.variant_id
       LEFT JOIN catalog_products p ON p.id = v.product_id
       ORDER BY (COALESCE(rt.reserved, 0) - COALESCE(s.quantity, 0)) DESC,
                COALESCE(p.name, s.product_name_snapshot, '') COLLATE NOCASE,
                pk.variant_id
       LIMIT ?`
    ).bind(shortageFetchLimit).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT e.id, e.event_type, e.direction, e.order_id, e.order_item_id, e.inventory_source, e.quantity,
              e.product_id, e.variant_id, e.product_name_snapshot, e.audience_type, e.gender_snapshot,
              e.color_snapshot, e.material_snapshot, e.length_snapshot, e.size_snapshot, e.is_workshop,
              e.pending_reason, e.created_at, o.external_id, o.order_date, ${exactLifecycleVariantSql} AS exact_variant_id
       FROM inventory_lifecycle_events e
       JOIN orders o ON o.id = e.order_id
       WHERE e.status = 'pending'
       ORDER BY e.created_at ASC, e.id ASC
       LIMIT ?`
    ).bind(limit).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT MIN(oi.id) AS order_item_id, MIN(oi.order_id) AS order_id, MIN(o.external_id) AS external_id,
              MIN(o.order_date) AS order_date, COUNT(*) AS affected_count, COUNT(*) OVER() AS catalog_count,
              oi.product_name_snapshot, oi.audience_type, oi.gender_snapshot, oi.color_snapshot,
              oi.material_snapshot, oi.length_snapshot, oi.size_snapshot, oi.source_type, oi.is_workshop
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE ${base}
         AND ${operational}
         AND NOT EXISTS (
           SELECT 1 FROM inventory_lifecycle_events e
           WHERE e.status = 'pending' AND e.order_item_id = oi.id
         )
       GROUP BY
         UPPER(TRIM(COALESCE(oi.product_name_snapshot, ''))),
         CASE WHEN UPPER(TRIM(COALESCE(oi.audience_type, ''))) LIKE '%ДЕТ%' OR LOWER(TRIM(COALESCE(oi.audience_type, ''))) = 'child' THEN 'child' ELSE 'adult' END,
         UPPER(TRIM(COALESCE(oi.gender_snapshot, ''))),
         UPPER(TRIM(COALESCE(oi.color_snapshot, ''))),
         CASE WHEN TRIM(COALESCE(oi.material_snapshot, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(oi.material_snapshot)) END,
         CASE WHEN TRIM(COALESCE(oi.length_snapshot, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(oi.length_snapshot)) END,
         UPPER(TRIM(COALESCE(oi.size_snapshot, '')))
       ORDER BY MAX(oi.id) DESC
       LIMIT ?`
    ).bind(limit).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT id, inventory_source, started_at, updated_at,
              (SELECT COUNT(*) FROM inventory_stocktake_items i WHERE i.session_id = s.id) AS total_items,
              (SELECT COUNT(*) FROM inventory_stocktake_items i WHERE i.session_id = s.id AND i.status = 'recount_required') AS recount_items,
              (SELECT COUNT(*) FROM inventory_stocktake_items i WHERE i.session_id = s.id AND i.counted_quantity IS NOT NULL) AS counted_items
       FROM inventory_stocktake_sessions s
       WHERE status = 'active'
       ORDER BY started_at ASC
       LIMIT 4`
    ).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM (
            SELECT s.inventory_source, s.variant_id
            FROM inventory_stock s
            WHERE s.quantity < 0
            UNION
            SELECT r.inventory_source, r.variant_id
            FROM inventory_reservations r
            LEFT JOIN inventory_stock s ON s.inventory_source = r.inventory_source AND s.variant_id = r.variant_id
            WHERE r.status = 'active' AND r.variant_id IS NOT NULL
            GROUP BY r.inventory_source, r.variant_id
            HAVING SUM(r.quantity) > COALESCE(MAX(s.quantity), 0)
          )) AS shortage_count,
         (SELECT COUNT(*) FROM inventory_lifecycle_events WHERE status = 'pending') AS lifecycle_total_count,
         (SELECT COUNT(*) FROM inventory_lifecycle_events e
          WHERE e.status = 'pending' AND e.direction = 'in' AND ${exactLifecycleVariantSql} IS NOT NULL) AS intake_count,
         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count`
    ).first<Record<string, unknown>>(),
  ])

  const rawShortageCount = Math.max(0, toInt(coreSummary?.shortage_count, 0))
  const intakeCount = Math.max(0, toInt(coreSummary?.intake_count, 0))
  const lifecycleTotalCount = Math.max(0, toInt(coreSummary?.lifecycle_total_count, 0))
  const catalogCount = Math.max(0, toInt((catalogResult.results || [])[0]?.catalog_count, 0))
  const counts = {
    shortage: Math.max(0, rawShortageCount - fullyExplainedShortageKeys.size),
    intake: intakeCount,
    lifecycle: Math.max(0, lifecycleTotalCount - intakeCount),
    catalog: catalogCount,
    handover: handoverReviewRows.length,
    stocktake: Math.max(0, toInt(coreSummary?.stocktake_count, 0)),
  }
  const response: Record<string, unknown> = {
    ok: true,
    total: counts.shortage + counts.intake + counts.lifecycle + counts.catalog + counts.handover + counts.stocktake,
    counts,
  }

  const shortageItems = (shortageResult.results || []).map((row) => {
    const source = normalizeSourceType(row.inventory_source)
    const variantId = toInt(row.variant_id, 0)
    const physical = toInt(row.physical, 0)
    const reserved = Math.max(0, toInt(row.reserved, 0))
    const reviewReserved = Math.min(reserved, handoverReservations.get(`${source}:${variantId}`)?.reviewReserved || 0)
    const countRelevantReserved = Math.max(0, reserved - reviewReserved)
    return {
      source,
      variantId,
      productId: toInt(row.product_id, 0),
      productName: cleanText(row.product_name),
      category: normalizeAudienceCategory(row.category, row.size_label),
      gender: cleanText(row.gender),
      color: cleanText(row.color),
      material: canonicalStockPositionValue(row.material) || 'СТАНДАРТ',
      length: canonicalStockPositionValue(row.length) || 'СТАНДАРТ',
      size: cleanText(row.size_label),
      physical,
      reserved,
      handoverReserved: reviewReserved,
      countRelevantReserved,
      free: physical - reserved,
    }
  }).filter((row) => row.physical < 0 || row.countRelevantReserved > row.physical).slice(0, limit)

  const lifecycleItems = (lifecycleResult.results || []).map((row) => ({
    id: toInt(row.id, 0),
    eventType: cleanText(row.event_type),
    direction: cleanText(row.direction),
    orderId: toInt(row.order_id, 0),
    orderItemId: toInt(row.order_item_id, 0) || null,
    externalId: cleanText(row.external_id),
    orderDate: cleanText(row.order_date),
    source: normalizeSourceType(row.inventory_source),
    quantity: Math.max(1, toInt(row.quantity, 1)),
    productId: toInt(row.product_id, 0) || null,
    variantId: toInt(row.exact_variant_id, 0) || toInt(row.variant_id, 0) || null,
    exactKnown: Boolean(toInt(row.exact_variant_id, 0) && cleanText(row.direction) === 'in'),
    productName: cleanText(row.product_name_snapshot),
    category: normalizeAudienceCategory(row.audience_type, row.size_snapshot),
    gender: cleanText(row.gender_snapshot),
    color: cleanText(row.color_snapshot),
    material: canonicalStockPositionValue(row.material_snapshot) || 'СТАНДАРТ',
    length: canonicalStockPositionValue(row.length_snapshot) || 'СТАНДАРТ',
    size: cleanText(row.size_snapshot),
    isWorkshop: Boolean(toInt(row.is_workshop, 0)),
    pendingReason: cleanText(row.pending_reason),
    createdAt: cleanText(row.created_at),
  }))

  response.items = {
    shortages: shortageItems,
    intake: lifecycleItems.filter((row) => row.exactKnown),
    lifecycle: lifecycleItems.filter((row) => !row.exactKnown),
    catalog: (catalogResult.results || []).map((row) => ({
      orderItemId: toInt(row.order_item_id, 0),
      orderId: toInt(row.order_id, 0),
      externalId: cleanText(row.external_id),
      orderDate: cleanText(row.order_date),
      affectedCount: Math.max(1, toInt(row.affected_count, 1)),
      productName: cleanText(row.product_name_snapshot),
      category: normalizeAudienceCategory(row.audience_type, row.size_snapshot),
      gender: cleanText(row.gender_snapshot),
      color: cleanText(row.color_snapshot),
      material: canonicalStockPositionValue(row.material_snapshot) || 'СТАНДАРТ',
      length: canonicalStockPositionValue(row.length_snapshot) || 'СТАНДАРТ',
      size: cleanText(row.size_snapshot),
      source: cleanText(row.source_type),
      isWorkshop: Boolean(toInt(row.is_workshop, 0)),
    })),
    handover: handovers.slice(0, limit).map(({ row, item }) => ({
      orderId: toInt(row.order_id, 0),
      externalId: cleanText(row.external_id),
      orderDate: cleanText(row.order_date),
      orderCreatedAt: cleanText(row.order_created_at),
      customerName: cleanText(row.customer_name),
      ...item,
    })),
    stocktakes: (stocktakeResult.results || []).map((row) => ({
      id: cleanText(row.id),
      source: normalizeSourceType(row.inventory_source),
      startedAt: cleanText(row.started_at),
      updatedAt: cleanText(row.updated_at),
      totalItems: Math.max(0, toInt(row.total_items, 0)),
      countedItems: Math.max(0, toInt(row.counted_items, 0)),
      recountItems: Math.max(0, toInt(row.recount_items, 0)),
    })),
  }
  return response
}
