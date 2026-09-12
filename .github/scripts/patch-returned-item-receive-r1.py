from pathlib import Path

DOMAIN = Path('worker/domains/returns-exchanges.ts')
ROUTER = Path('worker/index.ts')

domain = DOMAIN.read_text()
router = ROUTER.read_text()

anchor = "\n\nexport const noStandaloneReturnSql = `NOT EXISTS (\n"
if domain.count(anchor) != 1:
    raise SystemExit(f'domain insert anchor count={domain.count(anchor)}')

function = r'''

export async function receiveReturnedItem(
  db: D1Database,
  input: {
    requestId?: string;
    operationType?: 'return' | 'exchange';
    operationId?: number;
    operationItemId?: number;
    destination?: 'warehouse' | 'boutique' | 'no_stock';
  },
) {
  let criticalOperation: CriticalOperationHandle | null = null;
  try {
    const operationType = cleanText(input.operationType).toLowerCase();
    if (operationType !== 'return' && operationType !== 'exchange') throw new Error('Не выбран тип возвратной операции.');
    const operationId = toInt(input.operationId, 0);
    const operationItemId = toInt(input.operationItemId, 0);
    if (!operationId || !operationItemId) throw new Error('Не выбрана возвращаемая позиция.');
    const destination = cleanText(input.destination).toLowerCase();
    if (!['warehouse', 'boutique', 'no_stock'].includes(destination)) throw new Error('Выберите, куда принять вернувшийся товар.');

    const startedAt = new Date().toISOString();
    const criticalPayload = { operationType, operationId, operationItemId, destination };
    criticalOperation = await beginCriticalOperation(db, 'returned_item_receive', input.requestId, criticalPayload, { startedAt });
    if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse;
    const operationContext = parseCriticalContext<{ startedAt?: string }>(criticalOperation.row);
    const timestamp = cleanText(operationContext.startedAt) || startedAt;

    const loadItem = async () => operationType === 'return'
      ? await db.prepare(
        `SELECT ri.id AS operation_item_id, ri.return_id AS operation_id, ri.order_item_id,
                ri.product_name_snapshot, ri.gender_snapshot, ri.color_snapshot, ri.material_snapshot,
                ri.length_snapshot, ri.size_snapshot, ri.quantity, ri.inventory_source, ri.restocked,
                ri.physical_tracking, ri.physical_received_at,
                r.order_id, COALESCE(r.status, 'completed') AS operation_status,
                o.external_id, oi.product_id, oi.variant_id, oi.audience_type, oi.is_workshop, oi.source_type
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         JOIN orders o ON o.id = r.order_id
         LEFT JOIN order_items oi ON oi.id = ri.order_item_id
         WHERE ri.id = ? AND ri.return_id = ?
         LIMIT 1`
      ).bind(operationItemId, operationId).first<Record<string, unknown>>()
      : await db.prepare(
        `SELECT ei.id AS operation_item_id, ei.exchange_id AS operation_id, ei.order_item_id,
                ei.product_name_snapshot, ei.gender_snapshot, ei.color_snapshot, ei.material_snapshot,
                ei.length_snapshot, ei.size_snapshot, ei.quantity, ei.inventory_source, 0 AS restocked,
                ei.physical_tracking, ei.physical_received_at,
                e.order_id, COALESCE(e.status, 'completed') AS operation_status,
                o.external_id, oi.product_id, oi.variant_id, oi.audience_type, oi.is_workshop, oi.source_type
         FROM exchange_items ei
         JOIN exchanges e ON e.id = ei.exchange_id
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN order_items oi ON oi.id = ei.order_item_id
         WHERE ei.id = ? AND ei.exchange_id = ? AND ei.role = 'old'
         LIMIT 1`
      ).bind(operationItemId, operationId).first<Record<string, unknown>>();

    let item = await loadItem();
    if (!item) throw new Error('Возвращаемая позиция не найдена. Обновите историю и повторите действие.');
    if (cleanText(item.operation_status) === 'cancelled') throw new CriticalOperationConflictError('Эта операция уже отменена. Принимать товар по ней нельзя.');
    if (!toInt(item.physical_tracking, 0)) {
      throw new CriticalOperationConflictError('Это старая запись: физическое получение по ней раньше не отслеживалось. Автоматически менять остаток нельзя.');
    }
    const isWorkshop = Boolean(toInt(item.is_workshop, 0));
    if (isWorkshop && destination === 'boutique') {
      throw new Error('Возвращённую вещь из Цеха нельзя принять в остаток Бутика. Выберите Склад или «Без возврата в остаток».');
    }

    const persistedDestination = () => {
      const source = cleanText(item?.inventory_source);
      return source === 'warehouse' || source === 'boutique' ? source : 'no_stock';
    };

    if (cleanText(item.physical_received_at)) {
      if (persistedDestination() !== destination) {
        throw new CriticalOperationConflictError('Товар уже отмечен полученным с другим решением по остатку. Обновите историю.');
      }
    } else {
      const source = destination === 'warehouse' || destination === 'boutique' ? destination : null;
      const update = operationType === 'return'
        ? await db.prepare(
          `UPDATE return_items
           SET physical_received_at = ?, inventory_source = ?
           WHERE id = ? AND return_id = ? AND physical_tracking = 1 AND physical_received_at IS NULL`
        ).bind(timestamp, source, operationItemId, operationId).run()
        : await db.prepare(
          `UPDATE exchange_items
           SET physical_received_at = ?, inventory_source = ?
           WHERE id = ? AND exchange_id = ? AND role = 'old' AND physical_tracking = 1 AND physical_received_at IS NULL`
        ).bind(timestamp, source, operationItemId, operationId).run();
      item = await loadItem();
      if (!item || !cleanText(item.physical_received_at)) {
        throw new CriticalOperationConflictError('Не удалось зафиксировать получение товара. Обновите историю и повторите действие.');
      }
      if (persistedDestination() !== destination) {
        throw new CriticalOperationConflictError('Товар одновременно приняли с другим решением по остатку. Обновите историю.');
      }
      if (toInt(update.meta?.changes, 0) <= 0 && !cleanText(item.physical_received_at)) {
        throw new CriticalOperationConflictError('Получение товара уже обрабатывается другим запросом. Обновите историю.');
      }
    }

    if (operationType === 'exchange') {
      await db.prepare(`UPDATE exchanges SET old_return_source = ? WHERE id = ? AND COALESCE(status, 'completed') <> 'cancelled'`)
        .bind(destination === 'no_stock' ? 'none' : destination, operationId).run();
    }

    let stockApplied = false;
    let stockAlreadyApplied = false;
    let pendingInventory: Record<string, unknown> | null = null;

    if (destination !== 'no_stock') {
      const resolved = await resolveInventoryLifecycleCandidate(db, item, isWorkshop);
      const event = await insertInventoryLifecycleEvent(db, {
        eventKey: operationType === 'return' ? `return:${operationId}:item:${operationItemId}` : `exchange:${operationId}:old`,
        operationType,
        operationId,
        operationItemId,
        orderId: toInt(item.order_id, 0),
        orderItemId: toInt(item.order_item_id, 0) || null,
        eventType: operationType === 'return' ? 'return_in' : 'exchange_old_in',
        direction: 'in',
        inventorySource: destination as 'warehouse' | 'boutique',
        quantity: Math.max(1, toInt(item.quantity, 1)),
        item,
        isWorkshop,
        productId: resolved.productId,
        variantId: resolved.variantId,
        pendingReason: inventoryLifecyclePendingReason(resolved, isWorkshop),
        timestamp,
      });
      const eventStatus = cleanText(event.status);
      if (eventStatus === 'cancelled') throw new CriticalOperationConflictError('Складское событие этой позиции уже отменено. Автоматическое проведение остановлено.');
      if (eventStatus === 'applied') {
        stockAlreadyApplied = true;
      } else {
        const autoApplyWorkshop = Boolean(isWorkshop && resolved.variantId && await canAutoApplyFreshWorkshopInbound(db, event, resolved.variantId));
        if (resolved.variantId && (!isWorkshop || autoApplyWorkshop)) {
          const applied = await applyCanonicalInventoryLifecycleEvent(
            db,
            event.id,
            resolved.variantId,
            timestamp,
            `Физически получен товар по ${operationType === 'return' ? 'возврату' : 'обмену'} ${cleanText(item.external_id)}`,
          );
          stockApplied = Boolean(applied.applied);
          stockAlreadyApplied = Boolean(applied.already);
        } else {
          pendingInventory = {
            eventId: event.id,
            eventType: event.event_type,
            productName: cleanText(item.product_name_snapshot),
            source: destination,
            reason: cleanText(event.pending_reason),
          };
        }
      }
    }

    const completedResponse = {
      ok: true,
      operationType,
      operationId,
      operationItemId,
      destination,
      receivedAt: cleanText(item.physical_received_at) || timestamp,
      stockApplied,
      stockAlreadyApplied,
      pendingInventory,
      pendingInventoryCount: pendingInventory ? 1 : 0,
    };
    await completeCriticalOperation(db, criticalOperation, completedResponse);

    try {
      const destinationLabel = destination === 'warehouse' ? 'Склад' : destination === 'boutique' ? 'Бутик' : 'без возврата в остаток';
      await writeActivityLog(db, {
        eventType: 'returned_item_received',
        entityType: operationType === 'return' ? 'return_item' : 'exchange_item',
        entityId: operationItemId,
        orderId: toInt(item.order_id, 0),
        externalOrderId: cleanText(item.external_id),
        title: `Физически получен товар по ${operationType === 'return' ? 'возврату' : 'обмену'} ${cleanText(item.external_id)}`,
        details: `${cleanText(item.product_name_snapshot)} × ${Math.max(1, toInt(item.quantity, 1))}; ${destinationLabel}`,
        createdAt: timestamp,
      });
    } catch (error) {
      console.warn('Returned item receipt activity log failed after committed receive', error);
    }

    return completedResponse;
  } catch (error) {
    await failCriticalOperation(db, criticalOperation, error);
    throw error;
  }
}
'''

domain = domain.replace(anchor, function + anchor, 1)
DOMAIN.write_text(domain)

old_import = "import { cancelExchange, cancelReturn, correctExchangeFinancials, createExchange, createReturn, listExchanges } from './domains/returns-exchanges.ts'"
new_import = "import { cancelExchange, cancelReturn, correctExchangeFinancials, createExchange, createReturn, listExchanges, receiveReturnedItem } from './domains/returns-exchanges.ts'"
if router.count(old_import) != 1:
    raise SystemExit(f'router import anchor count={router.count(old_import)}')
router = router.replace(old_import, new_import, 1)

route_anchor = """      if (url.pathname === '/api/returns' && request.method === 'GET') {
        return json(await listReturnHistory(env.DB, url));
      }
"""
if router.count(route_anchor) != 1:
    raise SystemExit(f'router route anchor count={router.count(route_anchor)}')
route = """      if (url.pathname === '/api/returned-items/receive' && request.method === 'POST') {
        const input = await readJson<{ requestId?: string; operationType?: 'return' | 'exchange'; operationId?: number; operationItemId?: number; destination?: 'warehouse' | 'boutique' | 'no_stock' }>(request);
        input.requestId = cleanText(input.requestId) || cleanText(request.headers.get('X-Idempotency-Key')) || undefined;
        try {
          return json(await receiveReturnedItem(env.DB, input));
        } catch (error) {
          const criticalResponse = criticalOperationErrorResponse(error);
          if (criticalResponse) return criticalResponse;
          const publicError = publicApiError(error);
          return json({ ok: false, ...(publicError.code ? { code: publicError.code } : {}), message: publicError.message }, { status: publicError.status });
        }
      }

"""
router = router.replace(route_anchor, route + route_anchor, 1)
ROUTER.write_text(router)
print('returned item receive operation and route patched')
