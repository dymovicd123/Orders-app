from pathlib import Path


def replace_once(text: str, before: str, after: str, label: str) -> str:
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, got {count}")
    return text.replace(before, after, 1)


# Worker domain: exact order-scoped auto-heal + narrow existing-variant resolution.
path = Path('worker/domains/catalog-review.ts')
text = path.read_text()
anchor = "\n\nexport async function listCatalogReviewQueue(db: D1Database, url: URL) {\n"
insert = r'''

export async function reconcileCatalogReviewOrder(db: D1Database, orderId: number) {
  if (!orderId) return { ok: true, resolvedGroups: 0, linkedItems: 0, reserved: 0 };
  const rowsResult = await fetchCatalogReviewRows(db, 160, orderId);
  const rows = rowsResult.results || [];
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = normalizedCatalogReviewKey(row);
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }

  let resolvedGroups = 0;
  let linkedItems = 0;
  let reserved = 0;
  for (const [inputKey, matching] of groups) {
    const sample = matching.find((row) => toInt(row.is_workshop, 0) !== 1) || null;
    if (!sample) continue;
    try {
      const item = catalogReviewRowToOrderItem(sample);
      const resolved = await resolveCatalogProductAndVariantV2(db, item);
      if (resolved.productId) {
        const timestamp = new Date().toISOString();
        for (const row of matching) {
          const rowId = toInt(row.id ?? row.order_item_id, 0);
          if (rowId && !toInt(row.product_id, 0)) {
            await db.prepare(`UPDATE order_items SET product_id = ? WHERE id = ?`).bind(resolved.productId, rowId).run();
            await db.prepare(`UPDATE workshop_tasks SET product_id = ?, updated_at = ? WHERE order_item_id = ?`).bind(resolved.productId, timestamp, rowId).run();
          }
        }
      }
      if (!resolved.productId || !resolved.variantId) continue;
      const selected = await db.prepare(
        `SELECT v.id AS variant_id, v.product_id, p.name AS product_name, COALESCE(v.category, p.category, 'adult') AS category,
                v.gender, v.color, v.material, v.length, v.size_label
         FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
         WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1 LIMIT 1`
      ).bind(resolved.variantId).first<CatalogReviewSelectedVariant>();
      if (!selected?.variant_id) continue;
      const result = await resolveCatalogReviewRows(db, matching, selected, inputKey, new Date().toISOString(), { writeAlias: false });
      resolvedGroups += 1;
      linkedItems += result.linked;
      reserved += result.reserved;
    } catch (error) {
      console.warn('Order-scoped catalog auto-reconciliation skipped one ambiguous group', error);
    }
  }
  return { ok: true, resolvedGroups, linkedItems, reserved };
}


export async function resolveOrderCatalogReviewExistingVariant(db: D1Database, orderId: number, orderItemId: number, variantId: number) {
  if (!orderId || !orderItemId || !variantId) throw new Error('Выберите проблемную позицию и существующий вариант каталога.');
  const anchor = await db.prepare(
    `SELECT oi.*, o.external_id, o.shipping_status, o.shipping_date, o.order_status, o.archived_at
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.id = ? AND oi.order_id = ? LIMIT 1`
  ).bind(orderItemId, orderId).first<Record<string, unknown>>();
  if (!anchor?.id) throw new Error('Позиция не найдена в этом заказе.');
  if (normalizeShippingStatus(anchor.shipping_status) === 'sent') throw new Error('Заказ уже отправлен. Складскую привязку здесь менять нельзя.');
  if (normalizeOrderStatus(anchor.order_status) !== 'active' || cleanText(anchor.archived_at)) throw new Error('Этот заказ уже не активен.');

  const selected = await db.prepare(
    `SELECT v.id AS variant_id, v.product_id, p.name AS product_name, COALESCE(v.category, p.category, 'adult') AS category,
            v.gender, v.color, v.material, v.length, v.size_label
     FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
     WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1 LIMIT 1`
  ).bind(variantId).first<CatalogReviewSelectedVariant>();
  if (!selected?.variant_id || !selected.product_id) throw new Error('Выбранный вариант каталога не найден или отключён.');
  const knownProductId = toInt(anchor.product_id, 0);
  if (knownProductId && knownProductId !== toInt(selected.product_id, 0)) {
    throw new Error('Для этой позиции базовый товар уже известен. Выберите вариант именно этого товара.');
  }

  const inputKey = normalizedCatalogReviewKey(anchor);
  const rowsResult = await fetchCatalogReviewRows(db, 160, orderId);
  const matching = (rowsResult.results || []).filter((row) => normalizedCatalogReviewKey(row) === inputKey);
  if (!matching.length) throw new Error('Эта позиция уже разобрана. Обновите заказ.');
  return await resolveCatalogReviewRows(db, matching, selected, inputKey);
}
'''
text = replace_once(text, anchor, insert + anchor, 'catalog-review order helpers')
path.write_text(text)


# Worker router and shipping preflight.
path = Path('worker/index.ts')
text = path.read_text()
text = replace_once(
    text,
    "import { excludeCatalogReviewQueueItem, getCatalogReviewContext, listCatalogReviewQueue, reconcileCatalogReviewQueue, resolveCatalogReviewFacts, resolveCatalogReviewQueueItem } from './domains/catalog-review.ts'\n",
    "import { excludeCatalogReviewQueueItem, getCatalogReviewContext, listCatalogReviewQueue, reconcileCatalogReviewOrder, reconcileCatalogReviewQueue, resolveCatalogReviewFacts, resolveCatalogReviewQueueItem, resolveOrderCatalogReviewExistingVariant } from './domains/catalog-review.ts'\n",
    'catalog-review import',
)
route_anchor = "      if (url.pathname === '/api/catalog/review' && request.method === 'GET') {\n"
route_insert = r'''      const orderCatalogReviewMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/catalog-review$/);
      if (orderCatalogReviewMatch && request.method === 'GET') {
        const orderId = toInt(orderCatalogReviewMatch[1], 0);
        const scopedUrl = new URL(request.url);
        scopedUrl.searchParams.set('orderId', String(orderId));
        return json(await listCatalogReviewQueue(env.DB, scopedUrl));
      }

      const orderCatalogReviewContextMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/catalog-review\/(\d+)\/context$/);
      if (orderCatalogReviewContextMatch && request.method === 'GET') {
        const orderId = toInt(orderCatalogReviewContextMatch[1], 0);
        const orderItemId = toInt(orderCatalogReviewContextMatch[2], 0);
        const scoped = await env.DB.prepare(
          `SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE oi.id = ? AND oi.order_id = ? AND COALESCE(o.order_status, 'active') = 'active'
             AND COALESCE(o.archived_at, '') = '' AND COALESCE(o.shipping_status, 'not_sent') <> 'sent' LIMIT 1`
        ).bind(orderItemId, orderId).first<{ id: number }>();
        if (!scoped?.id) return json({ ok: false, message: 'Позиция не найдена среди активных товаров этого заказа.' }, { status: 404 });
        return json(await getCatalogReviewContext(env.DB, orderItemId));
      }

      const orderCatalogReviewResolveMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/catalog-review\/(\d+)\/resolve-existing$/);
      if (orderCatalogReviewResolveMatch && request.method === 'POST') {
        const orderId = toInt(orderCatalogReviewResolveMatch[1], 0);
        const orderItemId = toInt(orderCatalogReviewResolveMatch[2], 0);
        const input = await readJson<{ variantId?: unknown }>(request);
        const result = await resolveOrderCatalogReviewExistingVariant(env.DB, orderId, orderItemId, toInt(input.variantId, 0));
        await writeActivityLog(env.DB, {
          eventType: 'order_catalog_resolved',
          entityType: 'order',
          entityId: orderId,
          orderId,
          externalOrderId: '',
          title: 'Уточнён товар перед отправкой',
          details: `Связано позиций: ${result.linked}; зарезервировано: ${result.reserved}`,
        });
        return json(result);
      }

'''
text = replace_once(text, route_anchor, route_insert + route_anchor, 'order-scoped catalog routes')
old_shipping = """        if (humanInventoryModelEnabled) {
          const blockers = await getOrderShipmentInventoryBlockers(env.DB, id);
          const unresolvedBlockers = blockers.filter((row) => cleanText(row.blocker_reason) !== 'insufficient_physical');
          if (unresolvedBlockers.length) {
            return json({ ok: false, code: 'catalog_review_required', reviewOrderId: id, message: orderShipmentInventoryBlockerMessage(unresolvedBlockers) }, { status: 409 });
          }
          const shortageBlockers = blockers.filter((row) => cleanText(row.blocker_reason) === 'insufficient_physical');
"""
new_shipping = """        if (humanInventoryModelEnabled) {
          let blockers = await getOrderShipmentInventoryBlockers(env.DB, id);
          let unresolvedBlockers = blockers.filter((row) => cleanText(row.blocker_reason) !== 'insufficient_physical');
          if (unresolvedBlockers.length) {
            try {
              await reconcileCatalogReviewOrder(env.DB, id);
            } catch (error) {
              console.warn('Order-scoped catalog auto-reconciliation failed; keeping shipping safely blocked', error);
            }
            blockers = await getOrderShipmentInventoryBlockers(env.DB, id);
            unresolvedBlockers = blockers.filter((row) => cleanText(row.blocker_reason) !== 'insufficient_physical');
          }
          if (unresolvedBlockers.length) {
            return json({ ok: false, code: 'catalog_review_required', reviewOrderId: id, message: orderShipmentInventoryBlockerMessage(unresolvedBlockers) }, { status: 409 });
          }
          const shortageBlockers = blockers.filter((row) => cleanText(row.blocker_reason) === 'insufficient_physical');
"""
text = replace_once(text, old_shipping, new_shipping, 'shipping catalog auto-heal')
path.write_text(text)


# Orders UI: open contextual modal instead of redirecting to Warehouse/Attention.
path = Path('src/App.tsx')
text = path.read_text()
text = replace_once(
    text,
    "import { InventoryStockGroupsRenderer } from './features/renderers/InventoryStockGroupsRenderer'\n",
    "import { InventoryStockGroupsRenderer } from './features/renderers/InventoryStockGroupsRenderer'\nimport { OrderCatalogResolutionModal } from './features/orders/OrderCatalogResolutionModal'\n",
    'App contextual resolver import',
)
text = replace_once(
    text,
    "  const [stockHandoverActionItemId, setStockHandoverActionItemId] = useState<number | null>(null)\n",
    "  const [stockHandoverActionItemId, setStockHandoverActionItemId] = useState<number | null>(null)\n  const [orderCatalogResolutionOrder, setOrderCatalogResolutionOrder] = useState<OrderRecord | null>(null)\n",
    'App contextual resolver state',
)
old_review = """      if (!response.ok && result.code === 'catalog_review_required') {
        if (isAdmin) {
          await loadCatalogReview(true, Number(result.reviewOrderId || order.id))
          setActiveSector('inventory')
          openInventoryPanel('catalog')
          setMessage('В этом заказе есть товар, который нужно один раз связать с каталогом. Открыт только этот заказ — старые записи не загружаются.')
        } else {
          setMessage(result.message || 'В заказе есть неразобранная складская позиция. Попросите администратора открыть «Склад → Товары → Требуют разбора».')
        }
        return
      }
"""
new_review = """      if (!response.ok && result.code === 'catalog_review_required') {
        setOrderCatalogResolutionOrder(order)
        setMessage(result.message || 'Перед отправкой нужно уточнить складской товар. Окно уточнения открыто прямо в заказах.')
        return
      }
"""
text = replace_once(text, old_review, new_review, 'App catalog review redirect')
modal_anchor = "      <DatabaseStorageModal maintenance={storageMaintenance} onOpenReports={openStorageMonthReports} />\n"
modal = """      <OrderCatalogResolutionModal
        order={orderCatalogResolutionOrder}
        apiFetch={apiFetch}
        isAdmin={isAdmin}
        onClose={() => setOrderCatalogResolutionOrder(null)}
        onCompleted={async (resolvedOrder) => {
          setOrderCatalogResolutionOrder(null)
          setMessage(`Все товары заказа ${resolvedOrder.external_id || `#${resolvedOrder.id}`} уточнены. Нажмите «Отправить клиенту» ещё раз — система повторно проверит склад.`)
          await loadDashboard(false)
        }}
        onOpenFullReview={async (blockedOrder) => {
          setOrderCatalogResolutionOrder(null)
          await loadCatalogReview(true, blockedOrder.id)
          setActiveSector('inventory')
          openInventoryPanel('catalog')
          setMessage('Открыт полный разбор только этого заказа. Используйте его, если нужной комбинации ещё нет в каталоге.')
        }}
      />

"""
text = replace_once(text, modal_anchor, modal + modal_anchor, 'App resolver modal render')
path.write_text(text)

print('Contextual catalog resolution source patch applied')
