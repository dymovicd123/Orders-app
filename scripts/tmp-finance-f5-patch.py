from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new, label):
    text = read(path)
    if old not in text:
        raise SystemExit(f'{label}: marker not found')
    write(path, text.replace(old, new, 1))
    print(f'{label}: patched')


# App: new editor payments must have an explicit semantic and default to the actual entry day.
replace_once(
    'src/App.tsx',
    """  function addEditorPayment() {
    setEditorDraft((current) => current ? { ...current, payments: [...current.payments, createEmptyEditorPayment(current.orderDate)] } : current)
  }
""",
    """  function addEditorPayment(paymentKind: 'debt_close' | 'extra') {
    setEditorDraft((current) => current ? {
      ...current,
      payments: [...current.payments, { ...createEmptyEditorPayment(formatLocalDateInput()), paymentKind }],
    } : current)
  }
""",
    'App explicit editor payment semantic',
)

# Editor UI: remove generic +Payment, expose meaning on every row, explain date semantics.
editor_path = 'src/features/sections/OrderEditorSection.tsx'
editor = read(editor_path)
old_head = """                      <div className=\"mini-panel-head\">
                        <h3>Оплаты</h3>
                        <button className=\"secondary compact\" type=\"button\" onClick={addEditorPayment}>
                          + Оплата
                        </button>
                      </div>
                      <p className=\"mini-panel-note\">
                        Способы оплаты подхватываются из справочника и из уже открытого заказа, чтобы подсказки не пропадали.
                      </p>
"""
new_head = """                      <div className=\"mini-panel-head\">
                        <h3>Оплаты</h3>
                        <div className=\"actions\">
                          <button className=\"secondary compact\" type=\"button\" onClick={() => addEditorPayment('debt_close')}>
                            + Закрытие долга
                          </button>
                          <button className=\"secondary compact\" type=\"button\" onClick={() => addEditorPayment('extra')}>
                            + Доплата
                          </button>
                        </div>
                      </div>
                      <p className=\"mini-panel-note\">
                        У каждой строки виден смысл операции. «Первичная оплата» — деньги, относящиеся к созданию заказа; более позднюю оплату долга добавляйте как «Закрытие долга», отдельную доплату — как «Доплата». Новая операция получает сегодняшнюю дату, при необходимости её можно изменить вручную.
                      </p>
"""
if old_head not in editor:
    raise SystemExit('OrderEditor payment header marker not found')
editor = editor.replace(old_head, new_head, 1)
old_date = """                              <label>
                                <span>Дата</span>
                                <input
                                  type=\"date\"
                                  value={payment.paymentDate}
                                  onChange={(event) => updateEditorPayment(index, 'paymentDate', event.target.value)}
                                />
                              </label>
                              <label>
                                <span>Способ</span>
"""
new_date = """                              <label>
                                <span>Дата</span>
                                <input
                                  type=\"date\"
                                  value={payment.paymentDate}
                                  onChange={(event) => updateEditorPayment(index, 'paymentDate', event.target.value)}
                                />
                              </label>
                              <label>
                                <span>Смысл оплаты</span>
                                <select
                                  value={payment.paymentKind || 'primary'}
                                  onChange={(event) => updateEditorPayment(index, 'paymentKind', event.target.value)}
                                >
                                  <option value=\"primary\">Первичная оплата</option>
                                  <option value=\"debt_close\">Закрытие долга</option>
                                  <option value=\"extra\">Доплата по заказу</option>
                                </select>
                              </label>
                              <label>
                                <span>Способ</span>
"""
if old_date not in editor:
    raise SystemExit('OrderEditor payment date marker not found')
editor = editor.replace(old_date, new_date, 1)
write(editor_path, editor)

# Regression test.
Path('scripts/test-finance-f5-entry-semantics.mjs').write_text(r'''import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  const app = read('src/App.tsx')
  const editor = read('src/features/sections/OrderEditorSection.tsx')
  const returnsExchanges = read('worker/domains/returns-exchanges.ts')

  check(app.includes("function addEditorPayment(paymentKind: 'debt_close' | 'extra')"), 'Generic editor payment action still has hidden semantics')
  check(app.includes("createEmptyEditorPayment(formatLocalDateInput())") && app.includes('paymentKind }'), 'New editor payment does not default to the actual entry day with an explicit kind')
  check(!app.includes('createEmptyEditorPayment(current.orderDate)'), 'New later editor payment still silently inherits the original order date')
  check(editor.includes("addEditorPayment('debt_close')") && editor.includes('+ Закрытие долга'), 'Explicit debt-close action missing')
  check(editor.includes("addEditorPayment('extra')") && editor.includes('+ Доплата'), 'Explicit extra-payment action missing')
  check(!editor.includes('onClick={addEditorPayment}'), 'Generic +Payment action is still present')
  check(editor.includes('<span>Смысл оплаты</span>'), 'Payment meaning is not visible in the editor')
  for (const marker of ['Первичная оплата', 'Закрытие долга', 'Доплата по заказу']) check(editor.includes(marker), `Payment semantic option missing: ${marker}`)
  check(editor.includes('Новая операция получает сегодняшнюю дату'), 'Editor does not explain the date rule for newly added money')
  check(returnsExchanges.includes("throw new Error('Укажите дату возврата.')") && returnsExchanges.includes("throw new Error('Укажите дату обмена.')"), 'F2 return/exchange missing-date guards regressed')

  console.log('FINANCE F5 ENTRY SEMANTICS TESTS PASSED — editor payment meaning is explicit, later operations default to entry day, and return/exchange dates stay required.')
} catch (error) {
  console.error(`FINANCE F5 ENTRY SEMANTICS TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
''', encoding='utf-8')

# Wire into the full release gate.
release_path = 'scripts/release-check.mjs'
release = read(release_path)
if "    'scripts/test-finance-f5-entry-semantics.mjs',\n" not in release:
    release = release.replace("    'scripts/test-finance-f4-money-journal.mjs',\n", "    'scripts/test-finance-f4-money-journal.mjs',\n    'scripts/test-finance-f5-entry-semantics.mjs',\n", 1)
if "Finance F5 entry semantics tests" not in release:
    release = release.replace("  run('Finance F4 money journal UX tests', process.execPath, [path.join(root, 'scripts/test-finance-f4-money-journal.mjs')])\n", "  run('Finance F4 money journal UX tests', process.execPath, [path.join(root, 'scripts/test-finance-f4-money-journal.mjs')])\n  run('Finance F5 entry semantics tests', process.execPath, [path.join(root, 'scripts/test-finance-f5-entry-semantics.mjs')])\n", 1)
write(release_path, release)

print('Finance F5 patch applied')
