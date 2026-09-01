from pathlib import Path
import re


def once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 anchor, found {count}')
    return text.replace(old, new, 1)


index = Path('worker/index.ts')
text = index.read_text()
text = once(
    text,
    "import { OrderInputValidationError } from './domains/order-core.ts'\n",
    "import { OrderInputValidationError } from './domains/order-core.ts'\nimport { deleteOrderSafely } from './domains/order-delete.ts'\n",
    'Worker delete import',
)
route_anchor = "      const orderMatch = url.pathname.match(/^\\/api\\/orders\\/(\\d+)$/);\n"
delete_route = """      const orderDeleteMatch = url.pathname.match(/^\\/api\\/orders\\/(\\d+)\\/delete$/);\n      if (orderDeleteMatch && request.method === 'POST') {\n        const id = toInt(orderDeleteMatch[1], 0);\n        const input = await readJson<{ requestId?: string; comment?: string }>(request);\n        input.requestId = cleanText(input.requestId) || cleanText(request.headers.get('X-Idempotency-Key')) || undefined;\n        try {\n          return json(await deleteOrderSafely(\n            env.DB,\n            id,\n            input,\n            authUser,\n            cleanText(request.headers.get('X-Access-User')) || normalizeAccessRole(request.headers.get('X-Access-Role')),\n          ));\n        } catch (error) {\n          const criticalResponse = criticalOperationErrorResponse(error);\n          if (criticalResponse) return criticalResponse;\n          const publicError = publicApiError(error);\n          return json({ ok: false, ...(publicError.code ? { code: publicError.code } : {}), message: publicError.message }, { status: publicError.status });\n        }\n      }\n\n"""
text = once(text, route_anchor, delete_route + route_anchor, 'Worker delete route')
index.write_text(text)


app = Path('src/App.tsx')
text = app.read_text()
start = text.find('  async function deleteOrderAsAdmin(order: OrderRecord) {')
if start < 0:
    raise SystemExit('deleteOrderAsAdmin not found')
next_match = re.search(r'\n  (?:async )?function [A-Za-z_]', text[start + 10:])
if not next_match:
    raise SystemExit('deleteOrderAsAdmin end not found')
end = start + 10 + next_match.start()
block = text[start:end]
block = once(
    block,
    "    if (!isAdmin) {\n      setError('Удаление заказа доступно только администратору.')\n      return\n    }\n",
    '',
    'frontend admin delete blocker',
)
block = block.replace('Удалено администратором', 'Удалено сотрудником как ошибочный заказ')
if "apiFetch(`/api/orders/${order.id}`" not in block:
    raise SystemExit('old order delete endpoint not found')
block = block.replace("apiFetch(`/api/orders/${order.id}`", "apiFetch(`/api/orders/${order.id}/delete`", 1)
if "method: 'PATCH'" not in block:
    raise SystemExit('old order delete PATCH not found')
block = block.replace("method: 'PATCH'", "method: 'POST'", 1)
block = block.replace("orderStatus: 'deleted' as const, ", '', 1)
block = block.replace(
    "Удалить заказ ${order.external_id}? Будут отменены связанные списания склада и задания цеха. История операции останется в журнале.",
    "Удалить ошибочный заказ ${order.external_id}? Если по нему сделали возврат или обмен только потому, что заказ не удалялся, система сначала безопасно отменит эти операции, затем удалит заказ. История действий сохранится.",
)
text = text[:start] + block + text[end:]
app.write_text(text)


table = Path('src/features/sections/OrdersTableSection.tsx')
text = table.read_text()
text = once(
    text,
    '{isAdmin && !retainedOnly && !archived ? (\n                              <button\n                                className="ghost danger compact"',
    '{!retainedOnly && !archived ? (\n                              <button\n                                className="ghost danger compact"',
    'manager delete button',
)
table.write_text(text)


package = Path('package.json')
text = package.read_text()
text = once(
    text,
    'node scripts/test-order-edit-payment-method-correction.mjs"',
    'node scripts/test-order-edit-payment-method-correction.mjs && node scripts/test-order-delete-mobility.mjs"',
    'release check append',
)
package.write_text(text)


modular = Path('scripts/test-step1906a-worker-modularization.mjs')
text = modular.read_text()
text = once(
    text,
    "const orderEditPaymentMethodPath = path.join(root, 'scripts/order-edit-payment-method-worker-manifest.json')\n",
    "const orderEditPaymentMethodPath = path.join(root, 'scripts/order-edit-payment-method-worker-manifest.json')\nconst orderDeleteMobilityPath = path.join(root, 'scripts/order-delete-mobility-worker-manifest.json')\n",
    'modular manifest path',
)
load_anchor = "  const orderEditPaymentMethodChanges = orderEditPaymentMethod.changes || {}\n"
text = once(
    text,
    load_anchor,
    load_anchor + "  check(fs.existsSync(orderDeleteMobilityPath), 'Order delete mobility Worker manifest missing')\n  const orderDeleteMobility = JSON.parse(fs.readFileSync(orderDeleteMobilityPath, 'utf8'))\n  check(orderDeleteMobility?.version === 1 && orderDeleteMobility?.revision === 'order-delete-mobility-r1', 'Order delete mobility Worker manifest invalid')\n  const orderDeleteMobilityAdded = orderDeleteMobility.added || {}\n",
    'modular manifest load',
)
text = once(
    text,
    "    'domains/auth.ts', 'domains/critical.ts', 'domains/catalog.ts', 'domains/money.ts',\n",
    "    'domains/auth.ts', 'domains/critical.ts', 'domains/catalog.ts', 'domains/money.ts', 'domains/order-delete.ts',\n",
    'modular required module',
)
old_count = "  const expectedDeclarationCount = manifest.declarationCount - removedNames.length + Object.keys(warehouseTruthFreshnessAdded).length + Object.keys(warehouseAttentionTruthAdded).length + Object.keys(dailyWarehouseAdded).length + Object.keys(attentionContextAdded).length + Object.keys(orderCreateSaveIntegrityAdded).length\n"
new_count = old_count.rstrip('\n') + " + Object.keys(orderDeleteMobilityAdded).length\n"
text = once(text, old_count, new_count, 'modular declaration count')
normalize_anchor = "  const normalizedRouter = currentRouter\n"
normalize_insert = "  const normalizedRouter = currentRouter\n    .replace(/\\n\\s*const orderDeleteMatch = url\\.pathname\\.match\\(\/\\^\\\\\/api\\\\\/orders\\\\\/\\(\\\\d\\+\\)\\\\\/delete\\$\/\\);[\\s\\S]*?(?=\\n\\s*const orderMatch = url\\.pathname\\.match)/, '')\n"
text = once(text, normalize_anchor, normalize_insert, 'router normalization')
graph_anchor = "  const graph = new Map(files.map((file) => [file, new Set()]))\n"
added_check = "  for (const [name, expectedHash] of Object.entries(orderDeleteMobilityAdded)) {\n    check(declarations.has(name), `Order delete mobility added Worker declaration missing: ${name}`)\n    check(sha(declarations.get(name)) === expectedHash, `Order delete mobility declaration changed beyond exact allow-list: ${name}`)\n  }\n\n"
text = once(text, graph_anchor, added_check + graph_anchor, 'added declaration verifier')
modular.write_text(text)

print('order-delete mobility source patch prepared')
