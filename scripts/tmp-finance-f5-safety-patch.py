from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new, label):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    write(path, text.replace(old, new, 1))


def regex_once(path, pattern, replacement, label, flags=0):
    text = read(path)
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one regex match, got {count}')
    write(path, new_text)


# Frontend payment identity: persisted rows have a server id; unsaved rows have a stable browser draft key.
replace_once(
    'src/app/types.ts',
    "export type Payment = {\n  paymentDate: string\n",
    "export type Payment = {\n  id?: number\n  draftKey?: string\n  paymentDate: string\n",
    'Payment identity fields',
)

# Do not synthesize a blank primary-looking row when opening an unpaid order.
replace_once(
    'src/app/utils.ts',
    "    payments: order.payments.length\n      ? order.payments.map((payment) => ({\n          paymentDate: payment.paymentDate,\n",
    "    payments: order.payments.length\n      ? order.payments.map((payment) => ({\n          id: Number(payment.id || 0) || undefined,\n          paymentDate: payment.paymentDate,\n",
    'Preserve persisted payment id',
)
replace_once(
    'src/app/utils.ts',
    "      : [createEmptyEditorPayment(order.order_date)],\n    orderTotal: String(order.total_amount || ''),\n",
    "      : [],\n    orderTotal: String(order.total_amount || ''),\n",
    'No synthetic editor payment',
)

# Track one payment-row mutation separately from the whole-order save.
replace_once(
    'src/App.tsx',
    "  const [savingOrder, setSavingOrder] = useState(false)\n",
    "  const [savingOrder, setSavingOrder] = useState(false)\n  const [editorPaymentSavingIndex, setEditorPaymentSavingIndex] = useState<number | null>(null)\n",
    'Editor payment busy state',
)

# Existing payment rows are immutable in the generic order editor. New rows are explicit and stable across retry.
pattern = r"  function updateEditorPayment\(index: number, field: keyof EditorPayment, value: string \| number\) \{.*?\n  function handleSelectDebtOrder"
replacement = r'''  function updateEditorPayment(index: number, field: keyof EditorPayment, value: string | number) {
    setEditorDraft((current) => {
      if (!current) return current
      const nextPayments = current.payments.map((payment, paymentIndex) => {
        if (paymentIndex !== index || payment.id) return payment
        return { ...payment, [field]: value }
      })
      return { ...current, payments: nextPayments }
    })
  }

  function addEditorPayment(paymentKind: EditorPayment['paymentKind']) {
    const draftKey = `editor-payment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    setEditorDraft((current) => current ? {
      ...current,
      payments: [...current.payments, { ...createEmptyEditorPayment(formatLocalDateInput()), paymentKind, draftKey }],
    } : current)
  }

  function removeEditorPayment(index: number) {
    setEditorDraft((current) => {
      if (!current || current.payments[index]?.id) return current
      return { ...current, payments: current.payments.filter((_, paymentIndex) => paymentIndex !== index) }
    })
  }

  async function saveEditorPayment(index: number) {
    if (!editorDraft || !selectedOrder) return
    const payment = editorDraft.payments[index]
    if (!payment || payment.id) return

    const amount = Number(payment.amount || 0)
    if (!payment.paymentDate) {
      setError('Укажите фактическую дату оплаты.')
      return
    }
    if (!String(payment.method || '').trim()) {
      setError('Выберите способ оплаты.')
      return
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      setError('Сумма оплаты должна быть целым числом больше нуля.')
      return
    }

    setEditorPaymentSavingIndex(index)
    setError(null)
    setMessage(null)
    try {
      const payload = {
        orderId: selectedOrder.id,
        paymentDate: payment.paymentDate,
        method: payment.method,
        amount,
        paymentKind: payment.paymentKind,
        comment: payment.comment || '',
      }
      const criticalKey = `order-editor-payment:${selectedOrder.id}:${payment.draftKey || index}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })
      const result = await readJsonResponse<{
        ok?: boolean
        message?: string
        paymentId?: number | null
        order?: OrderRecord
        refreshRequired?: boolean
      }>(response, 'Добавление оплаты')
      if (!response.ok || !result.ok) throw new Error(result.message || `Payment save failed: ${response.status}`)
      const paymentId = Number(result.paymentId || 0)
      if (!paymentId) {
        throw new Error('Оплата могла сохраниться, но сервер не вернул её идентификатор. Повторите сохранение этой строки — повтор безопасен.')
      }
      completeCriticalRequest(criticalKey, critical.requestId)
      setEditorDraft((current) => current ? ({
        ...current,
        payments: current.payments.map((entry, paymentIndex) => (
          paymentIndex === index ? { ...entry, id: paymentId, draftKey: undefined } : entry
        )),
      }) : current)
      if (result.order) {
        upsertOrderInState(result.order)
        setSelectedOrderId(result.order.id)
        setEditorOrderOverride(result.order)
      } else if (result.refreshRequired) {
        void loadDashboard(false)
      }
      invalidateFinanceReadCaches()
      setMessage(`Оплата по заказу ${selectedOrder.external_id} проведена отдельно и не переписывает предыдущие оплаты.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить оплату.')
    } finally {
      setEditorPaymentSavingIndex(null)
    }
  }

  function handleSelectDebtOrder'''
regex_once('src/App.tsx', pattern, replacement, 'Safe editor payment functions', flags=re.S)

# Generic order PATCH must never carry the editor payment list. That prevents delete/reinsert of history/cash.
regex_once(
    'src/App.tsx',
    r"\n\s*payments: nextDraft\.payments\.map\(\(payment, index\) => \(\{\n\s*paymentDate: payment\.paymentDate,\n\s*method: payment\.method,\n\s*amount: payment\.amount,\n\s*paymentKind: resolvePaymentKind\(payment, index\),\n\s*comment: payment\.comment,\n\s*\}\)\),",
    '',
    'Remove payments from order PATCH payload',
    flags=re.S,
)

# Preserve unsaved explicit payment rows when the non-money order PATCH succeeds; do not close the editor over them.
replace_once(
    'src/App.tsx',
    "      const postSaveShortages = (result.stockWriteOff || []).filter((entry) => Number(entry.shortageAfter || 0) > 0)\n",
    "      const pendingEditorPayments = nextDraft.payments.filter((payment) => !payment.id)\n      const postSaveShortages = (result.stockWriteOff || []).filter((entry) => Number(entry.shortageAfter || 0) > 0)\n",
    'Capture pending editor payments',
)
replace_once(
    'src/App.tsx',
    "        setEditorDraft(createEditorDraft(savedOrder))\n        closeOrderEditor()\n        if (activeSector === 'orders' && orderPanel === 'list') void loadOrdersFinanceSummary(filters, true)\n        return savedOrder\n",
    "        const savedDraft = createEditorDraft(savedOrder)\n        setEditorDraft(pendingEditorPayments.length ? { ...savedDraft, payments: [...savedDraft.payments, ...pendingEditorPayments] } : savedDraft)\n        if (pendingEditorPayments.length) {\n          setEditorOpen(true)\n          setMessage(`Заказ ${order.external_id} обновлён. Новые оплаты ещё не проведены — сохраните каждую новой кнопкой «Провести оплату».`)\n        } else {\n          closeOrderEditor()\n        }\n        if (activeSector === 'orders' && orderPanel === 'list') void loadOrdersFinanceSummary(filters, true)\n        return savedOrder\n",
    'Keep pending editor payments after order readback',
)
replace_once(
    'src/App.tsx',
    "      closeOrderEditor()\n      if (result.refreshRequired || !result.order) {\n        void loadDashboard(false)\n        void loadWorkshopData()\n      }\n      return null\n",
    "      if (pendingEditorPayments.length) {\n        setEditorOpen(true)\n        setMessage(`Заказ ${order.external_id} сохранён. Новые оплаты ещё не проведены — сохраните каждую отдельно.`)\n      } else {\n        closeOrderEditor()\n      }\n      if (result.refreshRequired || !result.order) {\n        void loadDashboard(false)\n        void loadWorkshopData()\n      }\n      return null\n",
    'Keep pending editor payments without readback',
)

# Pass the new controller state/action to the extracted editor section.
replace_once(
    'src/App.tsx',
    "<OrderEditorSection ctx={{ addEditorItem, addEditorPayment, applyEditorProductPick, ChoicePills, closeOrderEditor, createEditorDraft, editorDraft, editorFormRef, editorOpen, editorReturnSector,",
    "<OrderEditorSection ctx={{ addEditorItem, addEditorPayment, applyEditorProductPick, ChoicePills, closeOrderEditor, createEditorDraft, editorDraft, editorFormRef, editorOpen, editorPaymentSavingIndex, editorReturnSector,",
    'Editor payment busy context',
)
replace_once(
    'src/App.tsx',
    "removeEditorItem, removeEditorPayment, renderOrderSizeSelect, renderOrderSourceAvailability, saveSelectedOrder, savingOrder,",
    "removeEditorItem, removeEditorPayment, renderOrderSizeSelect, renderOrderSourceAvailability, saveEditorPayment, saveSelectedOrder, savingOrder,",
    'Editor payment save context',
)

# Replace the payment panel with explicit add actions, immutable persisted rows, and per-row append-only save.
editor_path = 'src/features/sections/OrderEditorSection.tsx'
editor = read(editor_path)
editor = editor.replace('    editorOpen,\n    editorReturnSector,', '    editorOpen,\n    editorPaymentSavingIndex,\n    editorReturnSector,', 1)
editor = editor.replace('    saveSelectedOrder,\n    savingOrder,', '    saveEditorPayment,\n    saveSelectedOrder,\n    savingOrder,', 1)
start_marker = '''                    <section className="mini-panel">
                      <div className="mini-panel-head">
                        <h3>Оплаты</h3>'''
end_marker = '''                    </section>
                  </div>
    
                  <div className="actions form-bottom-actions">'''
start = editor.find(start_marker)
end = editor.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Payment panel markers not found')
new_panel = '''                    <section className="mini-panel">
                      <div className="mini-panel-head">
                        <h3>Оплаты</h3>
                        <div className="actions">
                          <button className="secondary compact" type="button" onClick={() => addEditorPayment('primary')} disabled={editorPaymentSavingIndex !== null}>
                            + Первичная оплата
                          </button>
                          <button className="secondary compact" type="button" onClick={() => addEditorPayment('debt_close')} disabled={editorPaymentSavingIndex !== null}>
                            + Закрытие долга
                          </button>
                          <button className="secondary compact" type="button" onClick={() => addEditorPayment('extra')} disabled={editorPaymentSavingIndex !== null}>
                            + Доплата
                          </button>
                        </div>
                      </div>
                      <p className="mini-panel-note">
                        Если первичную оплату забыли внести, добавьте её явно. Новая операция получает сегодняшнюю дату — при необходимости укажите фактическую дату получения денег. Уже проведённые оплаты здесь не переписываются: это защищает денежную историю и кассу.
                      </p>
                      <div className="stack">
                        {editorDraft.payments.map((payment, index) => (
                          <div className="mini-item" key={`edit-payment-${payment.id || payment.draftKey || index}`}>
                            <div className="mini-item-head">
                              <strong>Оплата {index + 1}</strong>
                              {payment.id ? (
                                <span className="soft-badge">Проведена</span>
                              ) : (
                                <button className="ghost danger compact" type="button" onClick={() => removeEditorPayment(index)} disabled={editorPaymentSavingIndex !== null}>
                                  Удалить черновик
                                </button>
                              )}
                            </div>
                            <div className="subgrid">
                              <label>
                                <span>Дата</span>
                                <input
                                  type="date"
                                  value={payment.paymentDate}
                                  disabled={Boolean(payment.id) || editorPaymentSavingIndex === index}
                                  onChange={(event) => updateEditorPayment(index, 'paymentDate', event.target.value)}
                                />
                              </label>
                              <label>
                                <span>Смысл оплаты</span>
                                <select
                                  value={payment.paymentKind || 'primary'}
                                  disabled={Boolean(payment.id) || editorPaymentSavingIndex === index}
                                  onChange={(event) => updateEditorPayment(index, 'paymentKind', event.target.value)}
                                >
                                  <option value="primary">Первичная оплата</option>
                                  <option value="debt_close">Закрытие долга</option>
                                  <option value="extra">Доплата по заказу</option>
                                </select>
                              </label>
                              <label>
                                <span>Способ</span>
                                {payment.id ? (
                                  <input value={payment.method || ''} disabled readOnly />
                                ) : (
                                  <SmartPickerInput
                                    value={payment.method}
                                    onChange={(value) => updateEditorPayment(index, 'method', value)}
                                    placeholder="Выберите способ"
                                    options={suggestionValues.paymentMethods}
                                    disabled={editorPaymentSavingIndex === index}
                                  />
                                )}
                              </label>
                              <label>
                                <span>Сумма</span>
                                <FriendlyNumberInput
                                  type="number"
                                  min="0"
                                  value={payment.amount ?? 0}
                                  disabled={Boolean(payment.id) || editorPaymentSavingIndex === index}
                                  onChange={(event) => updateEditorPayment(index, 'amount', Number(event.target.value))}
                                />
                              </label>
                              <label className="wide-field">
                                <span>Комментарий</span>
                                <input
                                  value={payment.comment || ''}
                                  disabled={Boolean(payment.id) || editorPaymentSavingIndex === index}
                                  onChange={(event) => updateEditorPayment(index, 'comment', event.target.value)}
                                />
                              </label>
                            </div>
                            {payment.id ? (
                              <p className="mini-panel-note">Эта операция уже проведена. Для исправления исторической оплаты нельзя молча удалять и создавать её заново.</p>
                            ) : (
                              <div className="actions">
                                <button className="primary compact" type="button" onClick={() => void saveEditorPayment(index)} disabled={savingOrder || editorPaymentSavingIndex !== null}>
                                  {editorPaymentSavingIndex === index ? 'Провожу оплату…' : 'Провести оплату'}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                        {!editorDraft.payments.length ? <div className="empty-state">Оплат пока нет. Добавьте нужный вид операции одной из кнопок выше.</div> : null}
                      </div>
                    </section>'''
editor = editor[:start] + new_panel + editor[end + len('                    </section>'):]
write(editor_path, editor)

# Replace F5 test with stronger semantics and isolation guards.
f5_test = '''import fs from 'node:fs'\nimport path from 'node:path'\n\nconst root = process.cwd()\nconst read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')\nconst fail = (message) => { throw new Error(message) }\nconst check = (condition, message) => { if (!condition) fail(message) }\n\ntry {\n  const app = read('src/App.tsx')\n  const editor = read('src/features/sections/OrderEditorSection.tsx')\n  const utils = read('src/app/utils.ts')\n  const types = read('src/app/types.ts')\n  const money = read('worker/domains/money.ts')\n  const returnsExchanges = read('worker/domains/returns-exchanges.ts')\n\n  check(app.includes("function addEditorPayment(paymentKind: EditorPayment['paymentKind'])"), 'Editor payment action does not require an explicit semantic kind')\n  for (const marker of [\n    "addEditorPayment('primary')", '+ Первичная оплата',\n    "addEditorPayment('debt_close')", '+ Закрытие долга',\n    "addEditorPayment('extra')", '+ Доплата',\n  ]) check(editor.includes(marker), `Explicit editor payment action missing: ${marker}`)\n  check(!editor.includes('onClick={addEditorPayment}'), 'Generic +Payment action is still present')\n  check(app.includes('createEmptyEditorPayment(formatLocalDateInput())'), 'New editor payment does not default to the current entry day')\n  check(editor.includes('при необходимости укажите фактическую дату получения денег'), 'Editor does not explain the actual payment-date rule')\n  check(editor.includes('Смысл оплаты'), 'Payment meaning is not visible in the editor')\n  for (const marker of ['Первичная оплата', 'Закрытие долга', 'Доплата по заказу']) check(editor.includes(marker), `Payment semantic option missing: ${marker}`)\n\n  check(types.includes('id?: number') && types.includes('draftKey?: string'), 'Frontend cannot distinguish persisted payments from new editor drafts')\n  check(utils.includes('id: Number(payment.id || 0) || undefined'), 'Persisted payment identity is dropped when the editor draft is created')\n  check(utils.includes('      : [],\\n    orderTotal:'), 'Unpaid orders still synthesize a blank primary-looking editor row')\n  check(editor.includes('payment.id ? (') && editor.includes('Проведена'), 'Persisted payments are not visibly separated from new drafts')\n  check(editor.includes('Уже проведённые оплаты здесь не переписываются'), 'Editor does not explain immutable persisted payments')\n  check(app.includes('if (paymentIndex !== index || payment.id) return payment'), 'Controller can still mutate a persisted payment row')\n  check(app.includes('if (!current || current.payments[index]?.id) return current'), 'Controller can still delete a persisted payment row')\n\n  const persistStart = app.indexOf('async function persistOrder(')\n  const persistEnd = app.indexOf('async function saveSelectedOrder()', persistStart)\n  const persistBlock = persistStart >= 0 && persistEnd > persistStart ? app.slice(persistStart, persistEnd) : ''\n  check(persistBlock, 'persistOrder block not found')\n  check(!persistBlock.includes('payments: nextDraft.payments.map'), 'Generic order PATCH still rewrites the complete payment list')\n  check(persistBlock.includes('pendingEditorPayments') && persistBlock.includes('Новые оплаты ещё не проведены'), 'Unsaved explicit payments can be lost when non-money order fields are saved')\n\n  const savePaymentStart = app.indexOf('async function saveEditorPayment(index: number)')\n  const savePaymentEnd = app.indexOf('function handleSelectDebtOrder', savePaymentStart)\n  const savePaymentBlock = savePaymentStart >= 0 && savePaymentEnd > savePaymentStart ? app.slice(savePaymentStart, savePaymentEnd) : ''\n  check(savePaymentBlock.includes("apiFetch('/api/payments'"), 'New editor payments are not appended through the dedicated payment endpoint')\n  check(savePaymentBlock.includes('prepareCriticalRequest') && savePaymentBlock.includes('completeCriticalRequest'), 'Editor payment append is not protected by browser retry idempotency')\n  check(savePaymentBlock.includes("'X-Idempotency-Key': critical.requestId"), 'Editor payment append does not send the durable request id')\n  check(money.includes("beginCriticalOperation(db, 'order_payment_create'"), 'Server payment endpoint lost durable idempotency')\n  check(money.includes("'manual_order_payment'"), 'Server payment endpoint lost mapped-entity replay protection')\n\n  check(returnsExchanges.includes("throw new Error('Укажите дату возврата.')") && returnsExchanges.includes("throw new Error('Укажите дату обмена.')"), 'F2 return/exchange missing-date guards regressed')\n\n  console.log('FINANCE F5 ENTRY SEMANTICS TESTS PASSED — primary/debt/extra are explicit, persisted payments are immutable in the generic editor, and new payments use the idempotent append path.')\n} catch (error) {\n  console.error(`FINANCE F5 ENTRY SEMANTICS TESTS FAILED: ${error?.message || error}`)\n  process.exit(1)\n}\n'''
write('scripts/test-finance-f5-entry-semantics.mjs', f5_test)

# Adjacent regression: prove why payment rewrite is forbidden and protect neighboring finance paths.
adjacent = r'''import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function cashBalance(db) {
  const row = db.prepare("SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS balance FROM cash_register_entries").get()
  return Number(row?.balance || 0)
}

try {
  const app = read('src/App.tsx')
  const worker = read('worker/index.ts')
  const money = read('worker/domains/money.ts')
  const finance = read('worker/domains/finance-reports.ts')
  const cash = read('worker/domains/cash.ts')
  const migration = read('migrations/0046_v72_cash_register_and_inventory_revision.sql')
  const orderWrite = read('worker/domains/orders-write.ts')

  // Neighboring frontend paths must retain their established explicit semantics.
  check(app.includes("paymentKind: 'debt_close' as const") && app.includes("apiFetch('/api/payments'"), 'Dedicated debt-close flow no longer uses the safe payment endpoint')
  check(app.includes('payments: createDraft.payments.map'), 'Order creation accidentally stopped sending its initial payments')
  check(worker.includes("url.pathname === '/api/payments' && request.method === 'POST'"), 'Dedicated payment API route disappeared')
  check(money.includes('financialOperationTypeFromPaymentKind(plan.paymentKind)'), 'Manual payment no longer writes semantic immutable financial events')
  check(finance.includes("operationType === 'debt_close'") && finance.includes("operationType === 'order_extra'"), 'Finance reports lost payment-kind separation')
  check(cash.includes('includeLegacy') && cash.includes('traceSeverity'), 'F4 money-history audit controls regressed')

  // The old backend rewrite primitive still exists for explicit legacy/full-rewrite callers, but the generic UI must not invoke it.
  check(orderWrite.includes('removeOrderPaymentsWithMoneyEvents'), 'Expected guarded legacy payment-rewrite primitive disappeared unexpectedly')
  const persistStart = app.indexOf('async function persistOrder(')
  const persistEnd = app.indexOf('async function saveSelectedOrder()', persistStart)
  const persistBlock = app.slice(persistStart, persistEnd)
  check(!persistBlock.includes('payments:'), 'Order editor PATCH still sends a payment collection and can trigger rewrite-all')

  // Reproduce the neighboring cash hazard from the real migration. This negative control is why rewrite-all is forbidden.
  const db = new DatabaseSync(':memory:')
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      external_id TEXT,
      created_at TEXT,
      order_status TEXT DEFAULT 'active'
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      payment_date TEXT,
      method TEXT,
      amount INTEGER,
      payment_kind TEXT,
      comment TEXT,
      created_at TEXT
    );
    CREATE TABLE returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      return_date TEXT,
      amount INTEGER,
      comment TEXT,
      status TEXT DEFAULT 'completed',
      created_at TEXT
    );
    CREATE TABLE exchanges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER,
      refund_return_id INTEGER,
      comment TEXT
    );
  `)
  db.exec(migration)
  db.prepare("INSERT INTO cash_register_settings (id, opening_amount, initialized_at, auto_tracking_enabled, activated_at, updated_at) VALUES (1, 0, ?, 1, ?, ?)")
    .run('2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')
  db.prepare("INSERT INTO orders (id, external_id, created_at, order_status) VALUES (1, 'ORD-F5-CASH', '2026-08-02T09:00:00.000Z', 'active')").run()
  db.prepare("INSERT INTO payments (order_id, payment_date, method, amount, payment_kind, comment, created_at) VALUES (1, '2026-08-02', 'НАЛИЧКА', 100, 'primary', '', '2026-08-02T09:05:00.000Z')").run()
  check(cashBalance(db) === 100, 'Cash setup negative-control did not capture the original payment')
  db.prepare('UPDATE cash_register_settings SET auto_tracking_enabled = 0 WHERE id = 1').run()
  db.prepare('DELETE FROM payments WHERE order_id = 1').run()
  db.prepare("INSERT INTO payments (order_id, payment_date, method, amount, payment_kind, comment, created_at) VALUES (1, '2026-08-02', 'НАЛИЧКА', 100, 'primary', '', '2026-08-25T12:00:00.000Z')").run()
  check(cashBalance(db) === 0, 'Cash negative-control changed: review the F5 safety assumption before altering editor payment isolation')
  check(Number(db.prepare("SELECT COUNT(*) AS count FROM cash_register_entries WHERE entry_type = 'payment_reversal'").get()?.count || 0) === 1, 'Cash negative-control did not record the destructive rewrite reversal')

  console.log('FINANCE F5 ADJACENT REGRESSION PASSED — create/debt/report/journal paths remain intact, and the cash rewrite hazard is reproduced while the generic editor is statically isolated from it.')
} catch (error) {
  console.error(`FINANCE F5 ADJACENT REGRESSION FAILED: ${error?.message || error}`)
  process.exit(1)
}
'''
write('scripts/test-finance-f5-adjacent-regression.mjs', adjacent)

# Wire the new regression into the mandatory release gate.
release = read('scripts/release-check.mjs')
release = release.replace(
    "    'scripts/test-finance-f5-entry-semantics.mjs',\n",
    "    'scripts/test-finance-f5-entry-semantics.mjs',\n    'scripts/test-finance-f5-adjacent-regression.mjs',\n",
    1,
)
release = release.replace(
    "  run('Finance F5 entry semantics tests', process.execPath, [path.join(root, 'scripts/test-finance-f5-entry-semantics.mjs')])\n",
    "  run('Finance F5 entry semantics tests', process.execPath, [path.join(root, 'scripts/test-finance-f5-entry-semantics.mjs')])\n  run('Finance F5 adjacent finance/cash regression', process.execPath, [path.join(root, 'scripts/test-finance-f5-adjacent-regression.mjs')])\n",
    1,
)
write('scripts/release-check.mjs', release)

print('Finance F5 safety patch applied')
