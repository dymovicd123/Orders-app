from pathlib import Path
import re


def once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one anchor, found {count}')
    return text.replace(old, new, 1)

# Worker orchestration: keep ordinary delete simple, but turn a recorded physical handover
# into one explicit factual question instead of a permanent admin dead-end.
p = Path('worker/domains/order-delete.ts')
text = p.read_text()
text = once(
    text,
    "  input: { requestId?: string; comment?: string },\n",
    "  input: { requestId?: string; comment?: string; physicalOutcome?: 'not_issued' },\n",
    'delete input type',
)
old_guard = """  const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db)\n  if (humanInventoryModelEnabled) {\n    const fulfilled = await db.prepare(\n      `SELECT COUNT(*) AS count FROM inventory_reservations WHERE order_id = ? AND status = 'fulfilled'`\n    ).bind(orderId).first<{ count: number }>()\n    if (normalizeShippingStatus((order as any).shipping_status) === 'sent' || toInt(fulfilled?.count, 0) > 0) {\n      throw new CriticalOperationConflictError(\n        'Этот заказ уже физически выдавался клиенту. Система ничего не изменила: такой заказ нельзя просто стереть вместе с движением товара. Если заказ ошибочный, сначала зафиксируйте фактический возврат товара; отдельный сценарий аннулирования после полного возврата будет разбираться без ожидания администратора.'\n      )\n    }\n  }\n\n"""
new_guard = """  const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db)\n  const fulfilledRows = humanInventoryModelEnabled\n    ? await db.prepare(\n      `SELECT r.id, r.order_item_id, r.inventory_source, r.product_id, r.variant_id, r.quantity, r.fulfilled_at\n       FROM inventory_reservations r\n       WHERE r.order_id = ? AND r.status = 'fulfilled'\n       ORDER BY r.id ASC`\n    ).bind(orderId).all<Record<string, unknown>>()\n    : { results: [] as Record<string, unknown>[] }\n  const fulfilledReservations = fulfilledRows.results || []\n  const shippingWasSent = normalizeShippingStatus((order as any).shipping_status) === 'sent'\n  const physicalOutcome = cleanText(input.physicalOutcome).toLowerCase()\n  const hasPhysicalHandoverMarker = humanInventoryModelEnabled && (shippingWasSent || fulfilledReservations.length > 0)\n  if (hasPhysicalHandoverMarker && physicalOutcome !== 'not_issued') {\n    const confirmationRequired = new CriticalOperationConflictError(\n      'Заказ отмечен как выданный / отправленный. Если это ошибочная отметка и товар фактически НЕ передавался клиенту, подтвердите это — система сама отменит ложную выдачу и продолжит удаление. Если товар реально передавался, удаление остановлено: сначала нужно отразить фактический возврат товара.'\n    )\n    confirmationRequired.code = 'order_delete_physical_confirmation_required'\n    throw confirmationRequired\n  }\n\n"""
text = once(text, old_guard, new_guard, 'physical handover guard')
insert_anchor = """  if (isArchivedOrder(order)) {\n"""
reversal = r'''  let falseShipmentRestoredQuantity = 0
  let falseShipmentFreshnessProtectedQuantity = 0
  if (hasPhysicalHandoverMarker && physicalOutcome === 'not_issued') {
    const restoreGroups = new Map<string, { source: string; variantId: number; quantity: number }>()
    for (const reservation of fulfilledReservations) {
      const variantId = toInt(reservation.variant_id, 0)
      const quantity = Math.max(0, toInt(reservation.quantity, 0))
      const source = cleanText(reservation.inventory_source)
      const fulfilledAt = cleanText(reservation.fulfilled_at)
      if (!variantId || !source || !quantity) {
        throw new CriticalOperationConflictError('Ложную выдачу нельзя отменить автоматически: у проведённого складского списания потеряна точная товарная связь. Система ничего не изменила; нужна фактическая сверка этой позиции.')
      }
      if (!fulfilledAt) {
        throw new CriticalOperationConflictError('Ложную выдачу нельзя отменить автоматически: у складского списания нет времени выдачи, поэтому система не может проверить более новую физическую сверку. Система ничего не изменила.')
      }
      await loadCanonicalVariantSnapshot(db, variantId)
      const newerPhysicalTruth = await db.prepare(
        `SELECT id
         FROM inventory_stock_checks
         WHERE inventory_source = ? AND variant_id = ?
           AND datetime(checked_at) > datetime(?)
         ORDER BY datetime(checked_at) DESC, id DESC
         LIMIT 1`
      ).bind(source, variantId, fulfilledAt).first<{ id: number }>()
      if (newerPhysicalTruth?.id) {
        falseShipmentFreshnessProtectedQuantity += quantity
        continue
      }
      const key = `${source}:${variantId}`
      const current = restoreGroups.get(key)
      if (current) current.quantity += quantity
      else restoreGroups.set(key, { source, variantId, quantity })
    }

    for (const group of restoreGroups.values()) {
      const stock = await db.prepare(
        `SELECT id FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? ORDER BY id ASC LIMIT 1`
      ).bind(group.source, group.variantId).first<{ id: number }>()
      if (!stock?.id) {
        throw new CriticalOperationConflictError('Ложную выдачу нельзя отменить автоматически: для одной из проведённых позиций больше нет строки физического остатка. Система ничего не изменила; укажите фактическое количество через сверку.')
      }
      falseShipmentRestoredQuantity += group.quantity
    }

    const timestamp = new Date().toISOString()
    const externalId = cleanText((order as any).external_id)
    const restorePayload = JSON.stringify(Array.from(restoreGroups.values()))
    const statements: D1PreparedStatement[] = []
    if (restoreGroups.size) {
      statements.push(
        db.prepare(
          `WITH x AS (
             SELECT CAST(json_extract(j.value, '$.source') AS TEXT) AS source,
                    CAST(json_extract(j.value, '$.variantId') AS INTEGER) AS variant_id,
                    CAST(json_extract(j.value, '$.quantity') AS INTEGER) AS quantity
             FROM json_each(?) j
           )
           INSERT INTO inventory_movements (
             inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
             color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
             reference_type, reference_id, comment, created_at
           )
           SELECT s.inventory_source, 'revision', s.product_id, s.variant_id, s.product_name_snapshot, s.gender_snapshot,
                  s.color_snapshot, s.material_snapshot, s.length_snapshot, s.size_snapshot,
                  x.quantity, s.quantity + x.quantity, 'order_delete_void', ?, ?, ?
           FROM x
           JOIN inventory_stock s ON s.inventory_source = x.source AND s.variant_id = x.variant_id`
        ).bind(
          restorePayload,
          externalId,
          `Отмена ложной физической выдачи перед удалением ошибочного заказа ${externalId}`,
          timestamp,
        ),
        db.prepare(
          `WITH x AS (
             SELECT CAST(json_extract(j.value, '$.source') AS TEXT) AS source,
                    CAST(json_extract(j.value, '$.variantId') AS INTEGER) AS variant_id,
                    CAST(json_extract(j.value, '$.quantity') AS INTEGER) AS quantity
             FROM json_each(?) j
           )
           UPDATE inventory_stock
           SET quantity = quantity + (
                 SELECT x.quantity FROM x
                 WHERE x.source = inventory_stock.inventory_source AND x.variant_id = inventory_stock.variant_id
               ),
               last_action = 'Отмена ошибочной выдачи',
               last_source_ref = ?,
               updated_at = ?
           WHERE EXISTS (
             SELECT 1 FROM x
             WHERE x.source = inventory_stock.inventory_source AND x.variant_id = inventory_stock.variant_id
           )`
        ).bind(restorePayload, `order-delete-void:${externalId}`, timestamp),
      )
    }
    statements.push(
      db.prepare(
        `UPDATE order_items
         SET stock_writeoff_status = 'reversed_delete'
         WHERE order_id = ?
           AND EXISTS (
             SELECT 1 FROM inventory_reservations r
             WHERE r.order_id = ? AND r.order_item_id = order_items.id AND r.status = 'fulfilled'
           )`
      ).bind(orderId, orderId),
      db.prepare(
        `UPDATE inventory_reservations
         SET status = 'released', released_at = ?, updated_at = ?
         WHERE order_id = ? AND status = 'fulfilled'`
      ).bind(timestamp, timestamp, orderId),
      db.prepare(
        `UPDATE orders
         SET shipping_status = 'not_sent', shipping_date = NULL, updated_at = ?
         WHERE id = ? AND shipping_status = 'sent'`
      ).bind(timestamp, orderId),
    )
    await db.batch(statements)
  }

'''
text = once(text, insert_anchor, reversal + insert_anchor, 'false shipment reversal insertion')
return_anchor = """    autoCancelledExchanges,\n    message: [\n"""
return_replacement = """    autoCancelledExchanges,\n    falseShipmentRestoredQuantity,\n    falseShipmentFreshnessProtectedQuantity,\n    message: [\n"""
text = once(text, return_anchor, return_replacement, 'delete response counters')
p.write_text(text)

# Scoped route accepts only the one narrow physical fact; no generic admin bypass is exposed.
p = Path('worker/index.ts')
text = p.read_text()
text = once(
    text,
    "        const input = await readJson<{ requestId?: string; comment?: string }>(request);\n",
    "        const input = await readJson<{ requestId?: string; comment?: string; physicalOutcome?: 'not_issued' }>(request);\n",
    'delete route input',
)
p.write_text(text)

# Frontend: first attempt remains one-click. Only a factual handover conflict asks one narrow question,
# then safely retries with the exact explicit fact.
p = Path('src/App.tsx')
text = p.read_text()
start = text.index('  async function deleteOrderAsAdmin(order: OrderRecord) {')
m = re.search(r'\n  (?:async )?function [A-Za-z_]', text[start + 10:])
if not m:
    raise SystemExit('delete function end not found')
end = start + 10 + m.start()
old = text[start:end]
new = r'''  async function deleteOrderAsAdmin(order: OrderRecord) {
    if (isArchivedOrderRecord(order)) {
      setMessage('Архивный заказ нельзя удалить. Сначала верните его из архива.')
      return
    }
    const confirmed = window.confirm(`Удалить заказ ${order.external_id}? Он исчезнет из рабочих таблиц, но запись останется в журнале.`)
    if (!confirmed) return
    setSavingOrder(true)
    setError(null)
    setMessage(null)
    try {
      const criticalKey = `order-delete:${order.id}`
      const sendDelete = async (physicalOutcome?: 'not_issued') => {
        const payload = {
          comment: order.comment || 'Удалено сотрудником как ошибочный заказ',
          ...(physicalOutcome ? { physicalOutcome } : {}),
        }
        const critical = prepareCriticalRequest(criticalKey, payload)
        const response = await apiFetch(`/api/orders/${order.id}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
          body: JSON.stringify(critical.payload),
        })
        const result = await readJsonResponse<{ ok?: boolean; code?: string; message?: string; order?: OrderRecord }>(response, 'Удаление заказа')
        return { response, result, critical }
      }

      let attempt = await sendDelete()
      if (!attempt.response.ok && attempt.result.code === 'order_delete_physical_confirmation_required') {
        const notIssued = window.confirm(
          `Заказ ${order.external_id} отмечен как выданный или отправленный.\n\nПодтвердите только если товар ФАКТИЧЕСКИ НЕ передавался клиенту и отметка выдачи ошибочная. Тогда система сама отменит ложное складское списание и продолжит удаление.\n\nЕсли товар реально передавался — нажмите «Отмена»: удаление остановится без изменений.`
        )
        if (!notIssued) {
          throw new Error('Удаление остановлено. Заказ с реальной выдачей нужно сначала привести к фактическому состоянию через возврат товара.')
        }
        attempt = await sendDelete('not_issued')
      }
      if (!attempt.response.ok) throw new Error(attempt.result.message || `Delete failed: ${attempt.response.status}`)
      completeCriticalRequest(criticalKey, attempt.critical.requestId)
      setOrders((current) => current.filter((entry) => entry.id !== order.id))
      if (selectedOrderId === order.id) {
        setSelectedOrderId(null)
        setEditorOpen(false)
      }
      invalidateFinanceReadCaches()
      invalidateInventoryStockCaches(true)
      setMessage(attempt.result.message || `Заказ ${order.external_id} удалён из активной работы.`)
      void loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSavingOrder(false)
    }
  }
'''
text = text[:start] + new + text[end:]
p.write_text(text)

# Regression keeps the original deletion guarantees and adds freshness-aware false-shipment recovery.
p = Path('scripts/test-order-delete-mobility.mjs')
text = p.read_text()
old_checks = """  check(deletion.includes(\"status = 'fulfilled'\"), 'physical handover preflight missing')\n  check(deletion.includes(\"normalizeShippingStatus((order as any).shipping_status) === 'sent'\"), 'sent-order physical guard missing')\n"""
new_checks = """  check(deletion.includes(\"status = 'fulfilled'\"), 'physical handover preflight missing')\n  check(deletion.includes(\"normalizeShippingStatus((order as any).shipping_status) === 'sent'\"), 'sent-order physical guard missing')\n  check(deletion.includes(\"confirmationRequired.code = 'order_delete_physical_confirmation_required'\"), 'physical fact confirmation code missing')\n  check(deletion.includes(\"physicalOutcome !== 'not_issued'\"), 'false-shipment confirmation is not explicit')\n  check(deletion.includes('datetime(checked_at) > datetime(?)'), 'newer physical check freshness barrier missing')\n  check(deletion.includes(\"reference_type, reference_id, comment, created_at\"), 'false-shipment reversal movement history missing')\n  check(deletion.includes(\"SET status = 'released', released_at = ?, updated_at = ?\"), 'fulfilled reservation is not retired after false-shipment reversal')\n  check(deletion.includes(\"SET shipping_status = 'not_sent', shipping_date = NULL\"), 'false shipping marker is not normalized before deletion')\n  check(app.includes(\"attempt.result.code === 'order_delete_physical_confirmation_required'\"), 'frontend does not handle narrow physical confirmation')\n  check(app.includes(\"sendDelete('not_issued')\"), 'frontend does not send explicit not-issued fact')\n"""
text = once(text, old_checks, new_checks, 'delete regression checks')
text = text.replace(
    "ORDER DELETE MOBILITY PASSED — ordinary staff get one safe delete action, deterministic return/exchange blockers auto-cancel, physical handover remains a factual safety boundary, retries are idempotent",
    "ORDER DELETE MOBILITY PASSED — ordinary staff get one safe delete action, deterministic return/exchange blockers auto-cancel, recorded handover asks one physical fact, false shipment reverses only when no newer physical truth supersedes it, retries are idempotent",
)
p.write_text(text)

print('order delete not-issued recovery patch prepared')
