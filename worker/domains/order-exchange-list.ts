import { cleanText, normalizeDate, toInt, upperText } from '../core/text.ts'

export async function listExchanges(db: D1Database, url: URL) {
  const orderId = toInt(url.searchParams.get('orderId'), 0);
  const limit = Math.min(100, Math.max(20, toInt(url.searchParams.get('limit'), 50)));
  const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0));
  const query = upperText(url.searchParams.get('q'));
  const dateFrom = cleanText(url.searchParams.get('dateFrom'));
  const dateTo = cleanText(url.searchParams.get('dateTo'));
  const status = cleanText(url.searchParams.get('status')).toLowerCase();
  const pendingOnly = url.searchParams.get('pendingOnly') === '1';
  const where: string[] = [];
  const bindings: Array<string | number> = [];
  if (pendingOnly) where.push(`COALESCE(e.status,'completed') <> 'cancelled'
    AND EXISTS (SELECT 1 FROM exchange_items pe
      WHERE pe.exchange_id = e.id AND pe.role = 'old'
      AND pe.physical_tracking = 1 AND pe.physical_received_at IS NULL)`);

  if (orderId) { where.push('e.order_id = ?'); bindings.push(orderId); }
  if (dateFrom) { where.push('e.exchange_date >= ?'); bindings.push(normalizeDate(dateFrom)); }
  if (dateTo) { where.push('e.exchange_date <= ?'); bindings.push(normalizeDate(dateTo)); }
  if (status === 'completed') where.push("COALESCE(e.status, 'completed') <> 'cancelled'");
  if (status === 'cancelled') where.push("COALESCE(e.status, 'completed') = 'cancelled'");
  if (query) {
    where.push(`INSTR(UPPER(
      COALESCE(o.external_id, '') || ' ' || COALESCE(m.name, '') || ' ' || COALESCE(c.display_name, '') || ' ' || COALESCE(c.phone_normalized, '') || ' ' ||
      COALESCE(e.comment, '') || ' ' || COALESCE(e.cancellation_comment, '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(product_name_snapshot, ' ') FROM exchange_items WHERE exchange_id = e.id AND role = 'old'), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(product_name_snapshot, ' ') FROM exchange_items WHERE exchange_id = e.id AND role = 'new'), '')
    ), ?) > 0`);
    bindings.push(query);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const summary = await db.prepare(
    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN COALESCE(e.status, 'completed') <> 'cancelled' THEN 1 ELSE 0 END) AS active_count,
            SUM(CASE WHEN COALESCE(e.status, 'completed') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
            COALESCE(SUM(CASE
              WHEN COALESCE(e.status, 'completed') = 'cancelled' THEN 0
              WHEN EXISTS(
                SELECT 1 FROM critical_operations co
                WHERE co.operation_type = 'exchange_set_create'
                  AND co.target_type = 'exchange'
                  AND co.target_id = e.id
              ) THEN COALESCE((
                SELECT SUM(ei.quantity)
                FROM exchange_items ei
                WHERE ei.exchange_id = e.id
                  AND ei.role = 'old'
                  AND COALESCE(ei.physical_tracking, 0) = 1
                  AND ei.physical_received_at IS NULL
              ), 0)
              WHEN old_summary.physical_tracking = 1
               AND old_summary.physical_received_at IS NULL
              THEN COALESCE(old_summary.quantity, e.old_quantity, 0)
              ELSE 0
            END), 0) AS pending_physical_quantity
     FROM exchanges e JOIN orders o ON o.id = e.order_id
     LEFT JOIN managers m ON m.id = e.manager_id LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN exchange_items old_summary ON old_summary.id = (
       SELECT ei.id FROM exchange_items ei WHERE ei.exchange_id = e.id AND ei.role = 'old' ORDER BY ei.id ASC LIMIT 1
     )
     ${whereSql}`
  ).bind(...bindings).first<Record<string, unknown>>();

  const result = await db.prepare(
    `SELECT e.*, o.external_id, o.order_date, m.name AS manager_name, m.color_key AS manager_color, c.phone_normalized AS customer_phone, c.display_name AS customer_name,
       EXISTS(
         SELECT 1 FROM critical_operations co
         WHERE co.operation_type = 'exchange_set_create' AND co.target_type = 'exchange' AND co.target_id = e.id
       ) AS is_set_exchange,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.product_name_snapshot ELSE old_item.product_name_snapshot END AS old_product_name,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.quantity ELSE e.old_quantity END AS old_item_quantity,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.gender_snapshot ELSE old_item.gender_snapshot END AS old_gender_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.color_snapshot ELSE old_item.color_snapshot END AS old_color_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.material_snapshot ELSE old_item.material_snapshot END AS old_material_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.length_snapshot ELSE old_item.length_snapshot END AS old_length_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.size_snapshot ELSE old_item.size_snapshot END AS old_size_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.inventory_source ELSE e.old_return_source END AS old_inventory_source,
       old_snapshot.id AS old_operation_item_id,
       old_snapshot.physical_tracking AS old_physical_tracking,
       old_snapshot.physical_received_at AS old_physical_received_at,
       COALESCE(old_item.is_workshop, 0) AS old_is_workshop,
       old_item.source_type AS old_source_type,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.product_name_snapshot ELSE new_item.product_name_snapshot END AS new_product_name,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.quantity ELSE new_item.quantity END AS new_item_quantity,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.gender_snapshot ELSE new_item.gender_snapshot END AS new_gender_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.color_snapshot ELSE new_item.color_snapshot END AS new_color_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.material_snapshot ELSE new_item.material_snapshot END AS new_material_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.length_snapshot ELSE new_item.length_snapshot END AS new_length_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.size_snapshot ELSE new_item.size_snapshot END AS new_size_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.inventory_source ELSE e.new_source_type END AS new_inventory_source,
       old_lifecycle.id AS old_lifecycle_id, old_lifecycle.variant_id AS old_lifecycle_variant_id, old_lifecycle.status AS old_lifecycle_status,
       old_item.variant_id AS old_current_variant_id,
       new_lifecycle.id AS new_lifecycle_id, new_lifecycle.status AS new_lifecycle_status
     FROM exchanges e JOIN orders o ON o.id = e.order_id
     LEFT JOIN managers m ON m.id = e.manager_id LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN exchange_items old_snapshot ON old_snapshot.id = (SELECT ei.id FROM exchange_items ei WHERE ei.exchange_id = e.id AND ei.role = 'old' ORDER BY ei.id ASC LIMIT 1)
     LEFT JOIN exchange_items new_snapshot ON new_snapshot.id = (SELECT ei.id FROM exchange_items ei WHERE ei.exchange_id = e.id AND ei.role = 'new' ORDER BY ei.id ASC LIMIT 1)
     LEFT JOIN order_items old_item ON old_item.id = e.old_order_item_id LEFT JOIN order_items new_item ON new_item.id = e.new_order_item_id
     LEFT JOIN inventory_lifecycle_events old_lifecycle ON old_lifecycle.id = (SELECT le.id FROM inventory_lifecycle_events le WHERE le.operation_type = 'exchange' AND le.operation_id = e.id AND le.event_type = 'exchange_old_in' ORDER BY le.id DESC LIMIT 1)
     LEFT JOIN inventory_lifecycle_events new_lifecycle ON new_lifecycle.id = (SELECT le.id FROM inventory_lifecycle_events le WHERE le.operation_type = 'exchange' AND le.operation_id = e.id AND le.event_type = 'exchange_new_out' ORDER BY le.id DESC LIMIT 1)
     ${whereSql}
     ORDER BY e.exchange_date ${pendingOnly ? 'ASC' : 'DESC'}, e.id ${pendingOnly ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`
  ).bind(...bindings, limit, offset).all<Record<string, unknown>>();
  const baseRows = result.results || [];
  const pageExchangeIds = baseRows.map((row) => toInt(row.id, 0)).filter(Boolean);
  const exchangeItems = pageExchangeIds.length
    ? await db.prepare(
        `SELECT ei.*, oi.unit_price, oi.catalog_price_snapshot, oi.is_workshop, oi.source_type, oi.variant_id AS current_variant_id,
                le.id AS lifecycle_id, le.variant_id AS lifecycle_variant_id, le.status AS lifecycle_status
         FROM exchange_items ei
         LEFT JOIN order_items oi ON oi.id = ei.order_item_id
         LEFT JOIN inventory_lifecycle_events le ON le.id = (
           SELECT child.id
           FROM inventory_lifecycle_events child
           WHERE child.operation_type = 'exchange'
             AND child.operation_id = ei.exchange_id
             AND child.operation_item_id = ei.id
           ORDER BY child.id DESC
           LIMIT 1
         )
         WHERE ei.exchange_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
         ORDER BY ei.exchange_id DESC, ei.role ASC, ei.id ASC`
      ).bind(JSON.stringify(pageExchangeIds)).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };

  const itemGroups = new Map<number, { oldItems: Record<string, unknown>[]; newItems: Record<string, unknown>[] }>();
  for (const item of exchangeItems.results || []) {
    const exchangeId = toInt(item.exchange_id, 0);
    if (!exchangeId) continue;
    const group = itemGroups.get(exchangeId) || { oldItems: [], newItems: [] };
    const serialized = {
      id: toInt(item.id, 0),
      orderItemId: toInt(item.order_item_id, 0) || null,
      productName: cleanText(item.product_name_snapshot) || '—',
      quantity: Math.max(0, toInt(item.quantity, 0)),
      gender: cleanText(item.gender_snapshot),
      color: cleanText(item.color_snapshot),
      material: cleanText(item.material_snapshot),
      length: cleanText(item.length_snapshot),
      size: cleanText(item.size_snapshot),
      inventorySource: cleanText(item.inventory_source) || null,
      physicalTracking: Boolean(toInt(item.physical_tracking, 0)),
      physicalReceivedAt: cleanText(item.physical_received_at) || null,
      isWorkshop: Boolean(toInt(item.is_workshop, 0)),
      sourceType: cleanText(item.source_type) || (toInt(item.is_workshop, 0) ? 'workshop' : 'warehouse'),
      unitPrice: Math.max(0, toInt(item.unit_price, 0)),
      catalogPriceSnapshot: item.catalog_price_snapshot == null ? null : Math.max(0, toInt(item.catalog_price_snapshot, 0)),
      currentVariantId: toInt(item.current_variant_id, 0) || null,
      lifecycleId: toInt(item.lifecycle_id, 0) || null,
      lifecycleVariantId: toInt(item.lifecycle_variant_id, 0) || null,
      lifecycleStatus: cleanText(item.lifecycle_status) || null,
      wasNotIssued: cleanText(item.inventory_source) === 'not_issued',
    };
    if (cleanText(item.role) === 'old') group.oldItems.push(serialized);
    else if (cleanText(item.role) === 'new') group.newItems.push(serialized);
    itemGroups.set(exchangeId, group);
  }

  const rows = baseRows.map(row => {
    const itemGroup = itemGroups.get(toInt(row.id, 0)) || { oldItems: [], newItems: [] };
    return {
      id: row.id, orderId: row.order_id, externalId: row.external_id, orderDate: row.order_date,
      manager: row.manager_name || '—', managerColor: cleanText(row.manager_color) || null, customer: row.customer_name || row.customer_phone || '—', exchangeDate: row.exchange_date,
      isSetExchange: Boolean(toInt(row.is_set_exchange, 0)),
      oldItems: itemGroup.oldItems,
      newItems: itemGroup.newItems,
      oldItemId: row.old_order_item_id, oldProductName: row.old_product_name || itemGroup.oldItems[0]?.productName || '—', oldQuantity: row.old_item_quantity || row.old_quantity || itemGroup.oldItems[0]?.quantity || 0,
      oldGender: row.old_gender_snapshot || itemGroup.oldItems[0]?.gender || '', oldColor: row.old_color_snapshot || itemGroup.oldItems[0]?.color || '', oldMaterial: row.old_material_snapshot || itemGroup.oldItems[0]?.material || '', oldLength: row.old_length_snapshot || itemGroup.oldItems[0]?.length || '', oldSize: row.old_size_snapshot || itemGroup.oldItems[0]?.size || '', oldReturnSource: row.old_inventory_source || row.old_return_source || itemGroup.oldItems[0]?.inventorySource || 'none',
      oldOperationItemId: row.old_operation_item_id == null ? (itemGroup.oldItems[0]?.id || null) : toInt(row.old_operation_item_id, 0) || null,
      // Legacy compatibility fields deliberately remain the exact first-old-item projection.
      // Set V2 consumers use oldItems[] below, so these fields must not be overloaded with set-wide fallbacks.
      oldPhysicalTracking: Boolean(toInt(row.old_physical_tracking, 0)),
      oldPhysicalReceivedAt: cleanText(row.old_physical_received_at) || null,
      oldWasNotIssued: cleanText(row.old_inventory_source) === 'not_issued',
      oldIsWorkshop: Boolean(toInt(row.old_is_workshop, 0)),
      oldSourceType: cleanText(row.old_source_type) || (toInt(row.old_is_workshop, 0) ? 'workshop' : 'warehouse'),
      newItemId: row.new_order_item_id, newProductName: row.new_product_name || itemGroup.newItems[0]?.productName || '—', newQuantity: row.new_item_quantity || itemGroup.newItems[0]?.quantity || 0,
      newGender: row.new_gender_snapshot || itemGroup.newItems[0]?.gender || '', newColor: row.new_color_snapshot || itemGroup.newItems[0]?.color || '', newMaterial: row.new_material_snapshot || itemGroup.newItems[0]?.material || '', newLength: row.new_length_snapshot || itemGroup.newItems[0]?.length || '', newSize: row.new_size_snapshot || itemGroup.newItems[0]?.size || '', newSourceType: row.new_inventory_source || row.new_source_type || itemGroup.newItems[0]?.inventorySource,
      oldCurrentVariantId: toInt(row.old_current_variant_id, 0) || Number(itemGroup.oldItems[0]?.currentVariantId || 0) || null,
      oldLifecycleId: toInt(row.old_lifecycle_id, 0) || null,
      oldLifecycleVariantId: toInt(row.old_lifecycle_variant_id, 0) || null,
      newLifecycleId: toInt(row.new_lifecycle_id, 0) || null,
      oldLifecycleStatus: cleanText(row.old_lifecycle_status) || String(itemGroup.oldItems[0]?.lifecycleStatus || '') || null,
      newLifecycleStatus: cleanText(row.new_lifecycle_status) || String(itemGroup.newItems[0]?.lifecycleStatus || '') || null,
      financialAction: row.financial_action || 'none', financialAmount: row.financial_amount || 0, paymentMethod: row.payment_method || '',
      status: row.status || 'completed', comment: row.comment || '', cancelledAt: row.cancelled_at || null, cancellationComment: row.cancellation_comment || null,
    };
  });
  const totalCount = Math.max(0, toInt(summary?.total_count, 0));
  return { ok: true, count: totalCount, offset, limit, hasMore: offset + rows.length < totalCount,
    summary: { activeCount: Math.max(0, toInt(summary?.active_count, 0)), cancelledCount: Math.max(0, toInt(summary?.cancelled_count, 0)), pendingPhysicalQuantity: Math.max(0, toInt(summary?.pending_physical_quantity, 0)) }, exchanges: rows };
}
