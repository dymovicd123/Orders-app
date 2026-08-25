from pathlib import Path


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


# ---------------------------------------------------------------------------
# F5 business truth: ordinary orders have only primary payment and debt close.
# Generic "extra" survives only as legacy/history and as an internal exchange
# payment kind used by the dedicated exchange workflow.
# ---------------------------------------------------------------------------

# Editor controller: primary is anchored to order date; debt close defaults to today.
replace_once(
    'src/App.tsx',
    """  function updateEditorPayment(index: number, field: keyof EditorPayment, value: string | number) {
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
""",
    """  function updateEditorPayment(index: number, field: keyof EditorPayment, value: string | number) {
    setEditorDraft((current) => {
      if (!current) return current
      const nextPayments = current.payments.map((payment, paymentIndex) => {
        if (paymentIndex !== index || payment.id) return payment
        if (field === 'paymentDate' && payment.paymentKind === 'primary') return payment
        if (field === 'paymentKind') {
          const nextKind = value === 'debt_close' ? 'debt_close' : 'primary'
          return {
            ...payment,
            paymentKind: nextKind,
            paymentDate: nextKind === 'primary' ? (current.orderDate || payment.paymentDate) : (payment.paymentDate || formatLocalDateInput()),
          }
        }
        return { ...payment, [field]: value }
      })
      return { ...current, payments: nextPayments }
    })
  }

  function addEditorPayment(paymentKind: 'primary' | 'debt_close') {
    const draftKey = `editor-payment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    setEditorDraft((current) => {
      if (!current) return current
      const paymentDate = paymentKind === 'primary'
        ? (current.orderDate || formatLocalDateInput())
        : formatLocalDateInput()
      return {
        ...current,
        payments: [...current.payments, { ...createEmptyEditorPayment(paymentDate), paymentKind, draftKey }],
      }
    })
  }
""",
    'Editor payment kinds/date semantics',
)

replace_once(
    'src/App.tsx',
    """    const payment = editorDraft.payments[index]
    if (!payment || payment.id) return

    const amount = Number(payment.amount || 0)
""",
    """    const payment = editorDraft.payments[index]
    if (!payment || payment.id) return
    const paymentKind = payment.paymentKind === 'primary' || payment.paymentKind === 'debt_close'
      ? payment.paymentKind
      : null
    if (!paymentKind) {
      setError('Для обычного заказа доступны только первичная оплата и закрытие долга. Доплата оформляется только внутри обмена.')
      return
    }

    const amount = Number(payment.amount || 0)
""",
    'Editor payment kind guard',
)
replace_once(
    'src/App.tsx',
    "        paymentKind: payment.paymentKind,\n",
    "        paymentKind,\n",
    'Editor canonical payment kind payload',
)

# Editor UI: no generic extra; primary date is visibly locked to the order date.
replace_once(
    'src/features/sections/OrderEditorSection.tsx',
    """                          <button className=\"secondary compact\" type=\"button\" onClick={() => addEditorPayment('debt_close')} disabled={savingOrder}>
                            + Закрытие долга
                          </button>
                          <button className=\"secondary compact\" type=\"button\" onClick={() => addEditorPayment('extra')} disabled={savingOrder}>
                            + Доплата
                          </button>
""",
    """                          <button className=\"secondary compact\" type=\"button\" onClick={() => addEditorPayment('debt_close')} disabled={savingOrder}>
                            + Закрытие долга
                          </button>
""",
    'Remove generic extra editor action',
)
replace_once(
    'src/features/sections/OrderEditorSection.tsx',
    """                      <p className=\"mini-panel-note\">
                        Если первичную оплату забыли внести, добавьте её явно. Новая операция получает сегодняшнюю дату — при необходимости укажите фактическую дату получения денег. Уже проведённые оплаты здесь не переписываются: это защищает денежную историю и кассу.
                      </p>
""",
    """                      <p className=\"mini-panel-note\">
                        Если первичную оплату забыли внести, добавьте её явно — она всегда относится к дате заказа. Любая обычная оплата позже создания заказа оформляется как «Закрытие долга» и проходит через тот же серверный механизм, что и отдельная кнопка закрытия долга. Доплата существует только в форме обмена. Уже проведённые оплаты здесь не переписываются: это защищает денежную историю и кассу.
                      </p>
""",
    'Editor payment explanation',
)
replace_once(
    'src/features/sections/OrderEditorSection.tsx',
    """                                  disabled={Boolean(payment.id) || savingOrder}
                                  onChange={(event) => updateEditorPayment(index, 'paymentDate', event.target.value)}
""",
    """                                  disabled={Boolean(payment.id) || savingOrder || payment.paymentKind === 'primary'}
                                  onChange={(event) => updateEditorPayment(index, 'paymentDate', event.target.value)}
""",
    'Lock primary payment date in editor',
)
replace_once(
    'src/features/sections/OrderEditorSection.tsx',
    "                                  <option value=\"debt_close\">Закрытие долга</option>\n                                  <option value=\"extra\">Доплата по заказу</option>\n",
    "                                  <option value=\"debt_close\">Закрытие долга</option>\n",
    'Remove generic extra semantic option',
)

# Server payment endpoint: stale clients cannot create ordinary extras. A manually
# restored primary payment is canonicalized to the order date; debt_close keeps its
# actual supplied operation date. The exchange domain does not call this function.
replace_once(
    'worker/domains/money.ts',
    """  const method = upperText(input.method);
  const paymentKind = normalizePaymentKind(input.paymentKind) as PaymentKind;
  const paymentDate = normalizeDate(input.paymentDate);
  const comment = cleanText(input.comment);
  if (!orderId) throw new Error('orderId is required');
  if (!method || amount <= 0) throw new Error('method and amount are required');

  const payload = { orderId, paymentDate, method, amount, paymentKind, comment };
""",
    """  const method = upperText(input.method);
  const paymentKind = normalizePaymentKind(input.paymentKind) as PaymentKind;
  const requestedPaymentDate = normalizeDate(input.paymentDate);
  const comment = cleanText(input.comment);
  if (!orderId) throw new Error('orderId is required');
  if (!method || amount <= 0) throw new Error('method and amount are required');
  if (paymentKind === 'extra') {
    throw new CriticalOperationConflictError('Обычной доплаты по заказу нет. Используйте закрытие долга; доплата доступна только внутри обмена.');
  }

  const payload = { orderId, paymentDate: requestedPaymentDate, method, amount, paymentKind, comment };
""",
    'Reject ordinary extra payments',
)
replace_once(
    'worker/domains/money.ts',
    """        `SELECT id, external_id, order_status, archived_at
         FROM orders WHERE id = ? LIMIT 1`
""",
    """        `SELECT id, external_id, order_date, order_status, archived_at
         FROM orders WHERE id = ? LIMIT 1`
""",
    'Read order date for manual primary',
)
replace_once(
    'worker/domains/money.ts',
    """      plan = {
        orderId,
        externalId: cleanText(existing.external_id),
        paymentDate,
        method,
""",
    """      plan = {
        orderId,
        externalId: cleanText(existing.external_id),
        paymentDate: paymentKind === 'primary' ? normalizeDate(existing.order_date) : requestedPaymentDate,
        method,
""",
    'Canonical manual primary date',
)

# Finance page: ordinary extra is not a current category. Legacy order_extra stays
# traceable, but is presented as an old debt-payment classification. Exchange extra
# remains fully visible as its own business operation.
replace_once(
    'src/features/renderers/FinanceDashboardRenderer.tsx',
    "      payment_extra: 'Доплата',\n",
    "      payment_extra: 'Закрытие долга (старый тип)',\n",
    'Cash legacy extra label',
)
replace_once(
    'src/features/renderers/FinanceDashboardRenderer.tsx',
    """  const orderExtraPaymentsTotal = Number(financeReport.overview.orderExtraPaymentsTotal || 0)
  const debtPaymentsTotal = Number(financeReport.overview.debtPaymentsTotal || closedDebtTotal)
""",
    """  const legacyOrderExtraPaymentsTotal = Number(financeReport.overview.orderExtraPaymentsTotal || 0)
  const debtPaymentsTotal = Number(financeReport.overview.debtPaymentsTotal || closedDebtTotal) + legacyOrderExtraPaymentsTotal
""",
    'Merge legacy ordinary extra into debt total',
)
replace_once(
    'src/features/renderers/FinanceDashboardRenderer.tsx',
    "                  <div><span>Доплаты по заказам</span><strong>{formatMoney(orderExtraPaymentsTotal)}</strong></div>\n",
    '',
    'Remove generic extra summary line',
)
replace_once(
    'src/features/renderers/FinanceDashboardRenderer.tsx',
    "                <option value=\"order_extra\">Доплата по заказу</option>\n",
    '',
    'Remove generic extra journal filter',
)

# Strict reports: remove the generic extra column and fold old rows into debt closing.
replace_once(
    'src/features/renderers/FinanceReportContentRenderer.tsx',
    "<th className=\"num\">Оплаты заказов</th><th className=\"num\">Доплаты заказов</th><th className=\"num\">Закрытие долгов</th><th className=\"num\">Доплаты обмена</th>",
    "<th className=\"num\">Оплаты заказов</th><th className=\"num\">Закрытие долгов</th><th className=\"num\">Доплаты обмена</th>",
    'Remove generic extra manager report column',
)
replace_once(
    'src/features/renderers/FinanceReportContentRenderer.tsx',
    "<td className=\"num\">{formatMoney(row.primary_received)}</td><td className=\"num\">{formatMoney(row.order_extra_received || 0)}</td><td className=\"num\">{formatMoney(row.debt_closed)}</td><td className=\"num\">{formatMoney(row.extra_received || 0)}</td>",
    "<td className=\"num\">{formatMoney(row.primary_received)}</td><td className=\"num\">{formatMoney(Number(row.debt_closed || 0) + Number(row.order_extra_received || 0))}</td><td className=\"num\">{formatMoney(row.extra_received || 0)}</td>",
    'Fold legacy extra into manager debt close',
)

# Finance report backend keeps the raw legacy type for lineage, but never describes
# it as a current generic extra to users.
replace_once(
    'worker/domains/finance-reports.ts',
    """    const operationLabel = operationType === 'debt_close'
      ? 'Закрытие долга'
      : operationType === 'exchange_extra'
        ? 'Доплата по обмену'
        : operationType === 'order_extra'
          ? 'Доплата по заказу'
          : 'Оплата заказа';
""",
    """    const operationLabel = operationType === 'debt_close'
      ? 'Закрытие долга'
      : operationType === 'exchange_extra'
        ? 'Доплата по обмену'
        : operationType === 'order_extra'
          ? 'Закрытие долга (старый тип)'
          : 'Оплата заказа';
""",
    'Finance legacy extra operation label',
)
replace_once(
    'worker/domains/finance-reports.ts',
    """    } else if (operationType === 'order_extra') {
      traceCode = 'order_extra';
      traceTitle = 'Доплата по заказу';
      traceExplanation = 'Отдельная доплата хранится отдельно от первичной оплаты заказа.';
""",
    """    } else if (operationType === 'order_extra') {
      traceCode = 'legacy_order_extra';
      traceSeverity = 'info';
      traceTitle = 'Закрытие долга (старый тип)';
      traceExplanation = 'Старая запись использует прежний технический тип «extra». В текущей модели отдельной доплаты по обычному заказу нет: такая последующая оплата относится к закрытию долга.';
""",
    'Finance legacy extra trace explanation',
)
replace_once(
    'worker/domains/finance-reports.ts',
    "  const debtPaymentsTotal = paymentOperations.filter((row: any) => row.operationType === 'debt_close').reduce((sum: number, row: any) => sum + row.amount, 0);\n",
    "  const debtPaymentsTotal = paymentOperations.filter((row: any) => row.operationType === 'debt_close' || row.operationType === 'order_extra').reduce((sum: number, row: any) => sum + row.amount, 0);\n",
    'Finance debt total includes legacy ordinary extra',
)
replace_once(
    'worker/domains/finance-reports.ts',
    """  const paymentKinds = [
    { operationType: 'order_payment', label: 'Оплаты заказов', count: paymentOperations.filter((row: any) => row.operationType === 'order_payment').length, total: orderPaymentsTotal },
    { operationType: 'order_extra', label: 'Доплаты по заказам', count: paymentOperations.filter((row: any) => row.operationType === 'order_extra').length, total: orderExtraPaymentsTotal },
    { operationType: 'debt_close', label: 'Закрытие долгов', count: paymentOperations.filter((row: any) => row.operationType === 'debt_close').length, total: debtPaymentsTotal },
    { operationType: 'exchange_extra', label: 'Доплаты по обменам', count: paymentOperations.filter((row: any) => row.operationType === 'exchange_extra').length, total: exchangeExtraPaymentsTotal },
  ];
""",
    """  const paymentKinds = [
    { operationType: 'order_payment', label: 'Оплаты заказов', count: paymentOperations.filter((row: any) => row.operationType === 'order_payment').length, total: orderPaymentsTotal },
    { operationType: 'debt_close', label: 'Закрытие долгов', count: paymentOperations.filter((row: any) => row.operationType === 'debt_close' || row.operationType === 'order_extra').length, total: debtPaymentsTotal },
    { operationType: 'exchange_extra', label: 'Доплаты по обменам', count: paymentOperations.filter((row: any) => row.operationType === 'exchange_extra').length, total: exchangeExtraPaymentsTotal },
  ];
""",
    'Finance payment kind groups',
)

# Treat legacy generic-extra payments as old debt closes in closed-debt lists, but
# never absorb a payment that is actually linked to an exchange.
finance = read('worker/domains/finance-reports.ts')
old_where = """       WHERE p.payment_kind = 'debt_close'
         AND p.payment_date BETWEEN ? AND ?
"""
new_where = """       WHERE p.payment_kind IN ('debt_close', 'extra')
         AND NOT EXISTS (
           SELECT 1 FROM exchanges e
           WHERE e.payment_id = p.id
             AND COALESCE(e.status, 'completed') <> 'cancelled'
             AND e.financial_action = 'extra_payment'
         )
         AND p.payment_date BETWEEN ? AND ?
"""
count = finance.count(old_where)
if count != 2:
    raise SystemExit(f'Closed debt query markers: expected 2, got {count}')
finance = finance.replace(old_where, new_where)
write('worker/domains/finance-reports.ts', finance)

# Money-history backend: old order_extra remains retrievable but appears under debt
# close, not as a current business category.
replace_once(
    'worker/domains/cash.ts',
    "  if (eventType === 'order_extra') return reason === 'order_edit_new' ? 'Исправленная доплата' : 'Доплата по заказу';\n",
    "  if (eventType === 'order_extra') return reason === 'order_edit_new' ? 'Исправленное закрытие долга (старый тип)' : 'Закрытие долга (старый тип)';\n",
    'Money history legacy extra label',
)
replace_once(
    'worker/domains/cash.ts',
    "  if (operation === 'order_payment') where.push(\"fe.event_type = 'order_payment'\");\n  else if (operation === 'debt_close') where.push(\"fe.event_type = 'debt_close'\");\n  else if (operation === 'order_extra') where.push(\"fe.event_type = 'order_extra'\");\n",
    "  if (operation === 'order_payment') where.push(\"fe.event_type = 'order_payment'\");\n  else if (operation === 'debt_close' || operation === 'order_extra') where.push(\"fe.event_type IN ('debt_close', 'order_extra')\");\n",
    'Money history debt filter compatibility',
)
replace_once(
    'worker/domains/cash.ts',
    """    } else if (eventType === 'order_extra') {
      traceCode = 'order_extra';
      traceTitle = 'Доплата по заказу';
      traceExplanation = 'Отдельная доплата хранится отдельно от первичной оплаты.';
""",
    """    } else if (eventType === 'order_extra') {
      traceCode = 'legacy_order_extra';
      traceSeverity = 'info';
      traceTitle = 'Закрытие долга (старый тип)';
      traceExplanation = 'Это старая техническая классификация. В текущей модели отдельной доплаты по обычному заказу нет; такая последующая оплата относится к закрытию долга.';
""",
    'Money history legacy extra trace',
)

# ---------------------------------------------------------------------------
# Regression expectations: exact business vocabulary, two identical debt-close
# entry points, exchange-only extra, and existing cash rewrite safety.
# ---------------------------------------------------------------------------
entry_test = read('scripts/test-finance-f5-entry-semantics.mjs')
entry_test = entry_test.replace(
    "  check(app.includes(\"function addEditorPayment(paymentKind: EditorPayment['paymentKind'])\"), 'Editor payment action does not require an explicit semantic kind')\n",
    "  check(app.includes(\"function addEditorPayment(paymentKind: 'primary' | 'debt_close')\"), 'Editor ordinary-payment action is not restricted to primary/debt_close')\n",
)
entry_test = entry_test.replace(
    """  for (const marker of [
    \"addEditorPayment('primary')\", '+ Первичная оплата',
    \"addEditorPayment('debt_close')\", '+ Закрытие долга',
    \"addEditorPayment('extra')\", '+ Доплата',
  ]) check(editor.includes(marker), `Explicit editor payment action missing: ${marker}`)
""",
    """  for (const marker of [
    \"addEditorPayment('primary')\", '+ Первичная оплата',
    \"addEditorPayment('debt_close')\", '+ Закрытие долга',
  ]) check(editor.includes(marker), `Explicit editor payment action missing: ${marker}`)
  check(!editor.includes(\"addEditorPayment('extra')\") && !editor.includes('<option value=\"extra\">'), 'Ordinary order editor still exposes generic extra payment')
""",
)
entry_test = entry_test.replace(
    "  check(app.includes('createEmptyEditorPayment(formatLocalDateInput())'), 'New editor payment does not default to the current entry day')\n",
    "  check(app.includes(\"paymentKind === 'primary'\") && app.includes('current.orderDate || formatLocalDateInput()'), 'Forgotten primary payment is not anchored to the order date')\n  check(app.includes(\": formatLocalDateInput()\"), 'Debt-close editor payment does not default to the current operation day')\n",
)
entry_test = entry_test.replace(
    "  check(editor.includes('при необходимости укажите фактическую дату получения денег'), 'Editor does not explain the actual payment-date rule')\n",
    "  check(editor.includes('она всегда относится к дате заказа') && editor.includes('тот же серверный механизм'), 'Editor does not explain primary/debt-close date and shared-path rules')\n",
)
entry_test = entry_test.replace(
    "  for (const marker of ['Первичная оплата', 'Закрытие долга', 'Доплата по заказу']) check(editor.includes(marker), `Payment semantic option missing: ${marker}`)\n",
    "  for (const marker of ['Первичная оплата', 'Закрытие долга']) check(editor.includes(marker), `Payment semantic option missing: ${marker}`)\n  check(!editor.includes('Доплата по заказу'), 'Generic ordinary extra wording remains in the order editor')\n",
)
entry_test = entry_test.replace(
    "  check(money.includes(\"'manual_order_payment'\"), 'Server payment endpoint lost mapped-entity replay protection')\n",
    "  check(money.includes(\"'manual_order_payment'\"), 'Server payment endpoint lost mapped-entity replay protection')\n  check(money.includes(\"paymentKind === 'extra'\") && money.includes('Обычной доплаты по заказу нет'), 'Stale clients can still create generic ordinary extras')\n  check(money.includes(\"paymentKind === 'primary' ? normalizeDate(existing.order_date) : requestedPaymentDate\"), 'Server does not canonicalize manual primary payment to order date')\n",
)
entry_test = entry_test.replace(
    "  console.log('FINANCE F5 ENTRY SEMANTICS TESTS PASSED — primary/debt/extra are explicit, persisted payments are immutable in the generic editor, and new payments use the idempotent append path.')\n",
    "  console.log('FINANCE F5 ENTRY SEMANTICS TESTS PASSED — ordinary orders expose only primary/debt-close, primary is anchored to order date, exchange-only extra is isolated, and appended payments are idempotent.')\n",
)
write('scripts/test-finance-f5-entry-semantics.mjs', entry_test)

adj = read('scripts/test-finance-f5-adjacent-regression.mjs')
adj = adj.replace(
    "  check(finance.includes(\"operationType === 'debt_close'\") && finance.includes(\"operationType === 'order_extra'\"), 'Finance reports lost payment-kind separation')\n",
    "  check(finance.includes(\"operationType === 'debt_close' || row.operationType === 'order_extra'\") && finance.includes('Закрытие долга (старый тип)'), 'Finance reports do not fold legacy ordinary extra into debt-close semantics')\n",
)
insert_marker = "  check(cash.includes('includeLegacy') && cash.includes('traceSeverity'), 'F4 money-history audit controls regressed')\n"
insert = insert_marker + """  const financeUi = read('src/features/renderers/FinanceDashboardRenderer.tsx')
  const reportUi = read('src/features/renderers/FinanceReportContentRenderer.tsx')
  const returnsExchanges = read('worker/domains/returns-exchanges.ts')
  check(!financeUi.includes('Доплаты по заказам') && !financeUi.includes('<option value=\"order_extra\">'), 'Finance page still exposes generic ordinary extra')
  check(!reportUi.includes('Доплаты заказов'), 'Strict manager report still exposes generic ordinary extra column')
  check(financeUi.includes('Доплаты по обменам') && returnsExchanges.includes(\"eventType: 'exchange_extra'\"), 'Exchange extra disappeared while ordinary extra was removed')
  check(cash.includes(\"operation === 'debt_close' || operation === 'order_extra'\") && cash.includes('Закрытие долга (старый тип)'), 'Money history does not keep legacy extra traceable under debt close')

  const editorPaymentStart = app.indexOf('async function saveEditorPayment(index: number)')
  const editorPaymentEnd = app.indexOf('function addEditorItem()', editorPaymentStart)
  const editorPaymentBlock = app.slice(editorPaymentStart, editorPaymentEnd)
  const debtCloseStart = app.indexOf('async function saveDebtClose()')
  const debtCloseEnd = app.indexOf('async function saveReturn()', debtCloseStart)
  const debtCloseBlock = app.slice(debtCloseStart, debtCloseEnd)
  check(editorPaymentBlock.includes(\"apiFetch('/api/payments'\") && debtCloseBlock.includes(\"apiFetch('/api/payments'\"), 'Editor and dedicated debt close do not share /api/payments')
  check(editorPaymentBlock.includes(\"payment.paymentKind === 'primary' || payment.paymentKind === 'debt_close'\") && debtCloseBlock.includes(\"paymentKind: 'debt_close' as const\"), 'Debt-close semantic kind can diverge between editor and dedicated flow')
  check(editorPaymentBlock.includes('prepareCriticalRequest') && debtCloseBlock.includes('prepareCriticalRequest'), 'One debt-close entry path lost browser idempotency')
"""
if insert_marker not in adj:
    raise SystemExit('Adjacent insertion marker missing')
adj = adj.replace(insert_marker, insert, 1)
adj = adj.replace(
    "  console.log('FINANCE F5 ADJACENT REGRESSION PASSED — create/debt/report/journal paths remain intact, and the cash rewrite hazard is reproduced while the generic editor is statically isolated from it.')\n",
    "  console.log('FINANCE F5 ADJACENT REGRESSION PASSED — both debt-close entry points share the same idempotent backend, ordinary extra is removed, exchange extra remains isolated, and the cash rewrite hazard stays blocked.')\n",
)
write('scripts/test-finance-f5-adjacent-regression.mjs', adj)

print('Finance F5 business-finalization patch applied')
