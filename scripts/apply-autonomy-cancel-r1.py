from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, value: str) -> None:
    Path(path).write_text(value, encoding='utf-8')


def replace_once(path: str, old: str, new: str, label: str) -> None:
    value = read(path)
    count = value.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    write(path, value.replace(old, new, 1))


lifecycle_path = 'worker/domains/lifecycle.ts'
marker = '\n\nexport async function cancelInventoryLifecycleEvent(\n'
helper = r'''


type InventoryLifecycleCancellationDisposition = {
  reversePhysical: boolean;
  reason: 'safe' | 'active_stocktake' | 'later_physical_check' | 'unknown_event_time' | 'insufficient_current_physical';
  eventAt?: string;
  activeStocktakeId?: string;
  laterCheckId?: number;
  laterCheckAt?: string;
  currentPhysical?: number;
};


async function inventoryLifecycleCancellationDisposition(
  db: D1Database,
  event: InventoryLifecycleEventRow,
): Promise<InventoryLifecycleCancellationDisposition> {
  const source = normalizeSourceType(event.inventory_source);
  const variantId = toInt(event.variant_id, 0);
  const quantity = Math.max(1, toInt(event.quantity, 1));
  const eventAt = cleanText(event.applied_at) || cleanText(event.created_at);

  const activeStocktake = await db.prepare(
    `SELECT id, started_at
     FROM inventory_stocktake_sessions
     WHERE inventory_source = ? AND status = 'active'
     ORDER BY started_at DESC, id DESC
     LIMIT 1`
  ).bind(source).first<{ id: string; started_at: string | null }>();
  if (activeStocktake?.id) {
    return {
      reversePhysical: false,
      reason: 'active_stocktake',
      eventAt,
      activeStocktakeId: cleanText(activeStocktake.id),
    };
  }

  // Applied lifecycle rows should always have a timestamp. If a historical/corrupt row does not,
  // cancellation may still finish financially and logically, but must not guess across physical truth.
  if (!eventAt) {
    return { reversePhysical: false, reason: 'unknown_event_time' };
  }

  if (variantId) {
    const laterCheck = await db.prepare(
      `SELECT id, checked_at
       FROM inventory_stock_checks
       WHERE inventory_source = ? AND variant_id = ?
         AND datetime(checked_at) > datetime(?)
       ORDER BY datetime(checked_at) DESC, id DESC
       LIMIT 1`
    ).bind(source, variantId, eventAt).first<{ id: number; checked_at: string }>();
    if (laterCheck?.id) {
      return {
        reversePhysical: false,
        reason: 'later_physical_check',
        eventAt,
        laterCheckId: toInt(laterCheck.id, 0),
        laterCheckAt: cleanText(laterCheck.checked_at),
      };
    }

    // Cancelling an inbound lifecycle event means subtracting the quantity that was added earlier.
    // Never manufacture a negative physical balance just because later operational movements used it.
    if (cleanText(event.direction) === 'in') {
      const stock = await db.prepare(
        `SELECT quantity
         FROM inventory_stock
         WHERE inventory_source = ? AND variant_id = ?
         ORDER BY id ASC LIMIT 1`
      ).bind(source, variantId).first<{ quantity: number }>();
      const currentPhysical = Math.max(0, toInt(stock?.quantity, 0));
      if (currentPhysical < quantity) {
        return {
          reversePhysical: false,
          reason: 'insufficient_current_physical',
          eventAt,
          currentPhysical,
        };
      }
    }
  }

  return { reversePhysical: true, reason: 'safe', eventAt };
}
'''
replace_once(lifecycle_path, marker, helper + marker, 'insert cancellation disposition helper')

anchor = """  const originalDelta = cleanText(event.direction) === 'in' ? qty : -qty;\n  const reversalDelta = -originalDelta;\n  const stock = await ensureHumanInventoryStockRow(db, source, canonical, timestamp);\n"""
guarded = """  const originalDelta = cleanText(event.direction) === 'in' ? qty : -qty;\n  const reversalDelta = -originalDelta;\n  const physicalDisposition = await inventoryLifecycleCancellationDisposition(db, event);\n  if (!physicalDisposition.reversePhysical) {\n    const reasonText = physicalDisposition.reason === 'active_stocktake'\n      ? 'Физический остаток не откатывался: на точке идёт ревизия, которая является текущей физической истиной.'\n      : physicalDisposition.reason === 'later_physical_check'\n        ? 'Физический остаток не откатывался: после операции уже была более свежая физическая сверка.'\n        : physicalDisposition.reason === 'insufficient_current_physical'\n          ? 'Физический остаток не откатывался: обратное списание сделало бы остаток отрицательным.'\n          : 'Физический остаток не откатывался: у исторического события нет надёжной временной границы.';\n    const bookkeeping: D1PreparedStatement[] = [];\n    if (isOutgoingExchange && toInt(event.order_item_id, 0)) {\n      bookkeeping.push(db.prepare(\n        `UPDATE inventory_reservations SET status = 'released', released_at = ?, updated_at = ?\n         WHERE order_item_id = ? AND status = 'fulfilled'\n           AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'applied')`\n      ).bind(timestamp, timestamp, toInt(event.order_item_id, 0), event.id));\n    }\n    if (cleanText(event.event_type) === 'return_in' && toInt(event.operation_item_id, 0)) {\n      bookkeeping.push(db.prepare(\n        `UPDATE return_items SET restocked = 0\n         WHERE id = ? AND EXISTS (SELECT 1 FROM inventory_lifecycle_events WHERE id = ? AND status = 'applied')`\n      ).bind(toInt(event.operation_item_id, 0), event.id));\n    }\n    bookkeeping.push(db.prepare(\n      `UPDATE inventory_lifecycle_events\n       SET status = 'cancelled', cancelled_at = ?, updated_at = ?,\n           resolution_comment = CASE\n             WHEN COALESCE(resolution_comment, '') = '' THEN ?\n             ELSE resolution_comment || ' | ' || ?\n           END\n       WHERE id = ? AND status = 'applied'`\n    ).bind(timestamp, timestamp, reasonText, reasonText, event.id));\n    await db.batch(bookkeeping);\n    event = await db.prepare(`SELECT * FROM inventory_lifecycle_events WHERE id = ? LIMIT 1`).bind(event.id).first<InventoryLifecycleEventRow>();\n    return {\n      cancelled: true,\n      pendingOnly: false,\n      event,\n      source,\n      productName: canonical.productName,\n      quantityDelta: 0,\n      physicalReversalSkipped: true,\n      physicalReversalReason: physicalDisposition.reason,\n      protectedPhysicalTruth: true,\n      activeStocktakeId: physicalDisposition.activeStocktakeId || null,\n      laterCheckId: physicalDisposition.laterCheckId || null,\n      laterCheckAt: physicalDisposition.laterCheckAt || null,\n      currentPhysical: physicalDisposition.currentPhysical ?? null,\n    };\n  }\n  const stock = await ensureHumanInventoryStockRow(db, source, canonical, timestamp);\n"""
replace_once(lifecycle_path, anchor, guarded, 'guard physical cancellation reversal')

worker_path = 'worker/index.ts'
worker = read(worker_path)
for route_name in ('returnCancelMatch', 'exchangeCancelMatch'):
    pattern = rf"(if \({route_name} && request\.method === 'PATCH'\) \{{\n)        const denied = requireAdminAccess\(request\);\n        if \(denied\) return denied;\n"
    worker, count = re.subn(pattern, r'\1', worker, count=1)
    if count != 1:
        raise SystemExit(f'remove admin guard for {route_name}: expected 1 match, found {count}')
health_anchor = "          orderCreateSaveIntegrity: '192b2a4',\n"
if worker.count(health_anchor) != 1:
    raise SystemExit('health marker anchor mismatch')
worker = worker.replace(health_anchor, health_anchor + "          returnExchangeCancelAutonomy: '192b2a5',\n", 1)
write(worker_path, worker)

app_path = 'src/App.tsx'
app = read(app_path)
for block in (
    """    if (!isAdmin) {\n      setError('Отмена возврата доступна только администратору.')\n      return\n    }\n""",
    """    if (!isAdmin) {\n      setError('Отмена обмена доступна только администратору.')\n      return\n    }\n""",
):
    if app.count(block) != 1:
        raise SystemExit('frontend admin-only cancellation block mismatch')
    app = app.replace(block, '', 1)
old = "if (!window.confirm(`Отменить возврат ${entry.externalId || ''} на ${formatMoney(entry.amount)}? Остатки и сумма возврата будут откатаны.`)) return"
new = "if (!window.confirm(`Отменить возврат ${entry.externalId || ''} на ${formatMoney(entry.amount)}? Система отменит деньги и статус возврата. Более свежие фактические данные склада, если они уже появились, будут сохранены.`)) return"
if app.count(old) != 1:
    raise SystemExit('return confirmation anchor mismatch')
app = app.replace(old, new, 1)
old = "if (!window.confirm(`Отменить обмен по заказу ${entry.externalId}? Склад, деньги и новая позиция будут откатаны.`)) return"
new = "if (!window.confirm(`Отменить обмен по заказу ${entry.externalId}? Система отменит деньги, статус и новую позицию. Более свежие фактические данные склада, если они уже появились, будут сохранены.`)) return"
if app.count(old) != 1:
    raise SystemExit('exchange confirmation anchor mismatch')
app = app.replace(old, new, 1)
write(app_path, app)

returns_path = 'src/features/sections/OrderReturnsSection.tsx'
returns = read(returns_path)
if returns.count('    isAdmin,\n') != 1:
    raise SystemExit('returns section isAdmin destructure mismatch')
returns = returns.replace('    isAdmin,\n', '', 1)
old = "{entry.status === 'cancelled' ? null : entry.operationType === 'exchange_refund' ? <button className=\"secondary compact\" type=\"button\" onClick={() => setOrderPanel('exchange')}>Открыть обмены</button> : isAdmin ? <button className=\"ghost danger compact\" type=\"button\" onClick={() => void cancelReturnEntry(entry)} disabled={returnBusy}>Отменить возврат</button> : null}"
new = "{entry.status === 'cancelled' ? null : entry.operationType === 'exchange_refund' ? <button className=\"secondary compact\" type=\"button\" onClick={() => setOrderPanel('exchange')}>Открыть обмены</button> : <button className=\"ghost danger compact\" type=\"button\" onClick={() => void cancelReturnEntry(entry)} disabled={returnBusy}>Отменить возврат</button>}"
if returns.count(old) != 1:
    raise SystemExit('returns action anchor mismatch')
write(returns_path, returns.replace(old, new, 1))

exchange_path = 'src/features/sections/OrderExchangeSection.tsx'
exchange = read(exchange_path)
if exchange.count('    isAdmin,\n') != 1:
    raise SystemExit('exchange section isAdmin destructure mismatch')
exchange = exchange.replace('    isAdmin,\n', '', 1)
old = "{entry.status !== 'cancelled' && isAdmin ? <button className=\"ghost danger compact\" type=\"button\" onClick={() => void cancelExchangeEntry(entry)} disabled={exchangeBusy}>Отменить обмен</button> : null}"
new = "{entry.status !== 'cancelled' ? <button className=\"ghost danger compact\" type=\"button\" onClick={() => void cancelExchangeEntry(entry)} disabled={exchangeBusy}>Отменить обмен</button> : null}"
if exchange.count(old) != 1:
    raise SystemExit('exchange action anchor mismatch')
write(exchange_path, exchange.replace(old, new, 1))

Path('scripts/test-return-exchange-cancel-autonomy.mjs').write_text(r'''import fs from 'node:fs'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

const lifecycle = fs.readFileSync('worker/domains/lifecycle.ts', 'utf8')
const worker = fs.readFileSync('worker/index.ts', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const returnsSection = fs.readFileSync('src/features/sections/OrderReturnsSection.tsx', 'utf8')
const exchangeSection = fs.readFileSync('src/features/sections/OrderExchangeSection.tsx', 'utf8')

check(lifecycle.includes('inventoryLifecycleCancellationDisposition'), 'cancellation disposition helper missing')
check(lifecycle.includes("status = 'active'"), 'active stocktake safety gate missing')
check(lifecycle.includes('inventory_stock_checks'), 'later physical check safety gate missing')
check(lifecycle.includes("reason: 'insufficient_current_physical'"), 'negative physical protection missing')
check(lifecycle.includes('physicalReversalSkipped: true'), 'non-mutating cancellation outcome missing')
check(lifecycle.includes('protectedPhysicalTruth: true'), 'freshness protection result missing')
const returnRoute = worker.match(/const returnCancelMatch[\s\S]*?const exchangeCancelMatch/)?.[0] || ''
const exchangeStart = worker.indexOf('const exchangeCancelMatch')
const exchangeRoute = exchangeStart >= 0 ? worker.slice(exchangeStart, exchangeStart + 1600) : ''
check(returnRoute && !returnRoute.includes('requireAdminAccess(request)'), 'return cancellation is still admin-only')
check(exchangeRoute && !exchangeRoute.includes('requireAdminAccess(request)'), 'exchange cancellation is still admin-only')
check(worker.includes("returnExchangeCancelAutonomy: '192b2a5'"), 'health marker missing')
check(!app.includes('Отмена возврата доступна только администратору.'), 'frontend still blocks manager return cancellation')
check(!app.includes('Отмена обмена доступна только администратору.'), 'frontend still blocks manager exchange cancellation')
check(returnsSection.includes('>Отменить возврат</button>}'), 'return cancel action is not available in ordinary mode')
check(exchangeSection.includes("entry.status !== 'cancelled' ? <button"), 'exchange cancel action is not available in ordinary mode')
console.log('RETURN/EXCHANGE CANCEL AUTONOMY PASSED')
''', encoding='utf-8')

package_path = 'package.json'
package = read(package_path)
old = 'node scripts/test-order-delete-mobility.mjs"'
new = 'node scripts/test-order-delete-mobility.mjs && node scripts/test-return-exchange-cancel-autonomy.mjs"'
if package.count(old) != 1:
    raise SystemExit('release:check anchor mismatch')
write(package_path, package.replace(old, new, 1))
