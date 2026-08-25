from pathlib import Path


def replace_once(path, old, new, label):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


renderer = 'src/features/renderers/FinanceDashboardRenderer.tsx'

replace_once(
    renderer,
    "  const legacyOrderExtraPaymentsTotal = Number(financeReport.overview.orderExtraPaymentsTotal || 0)\n  const debtPaymentsTotal = Number(financeReport.overview.debtPaymentsTotal || closedDebtTotal) + legacyOrderExtraPaymentsTotal\n",
    "  const debtPaymentsTotal = Number(financeReport.overview.debtPaymentsTotal || closedDebtTotal)\n",
    'Do not double-count legacy extra in debt total',
)

replace_once(
    renderer,
    "      orderPayments: 0,\n      orderExtras: 0,\n      debtPayments: 0,\n",
    "      orderPayments: 0,\n      debtPayments: 0,\n",
    'Remove obsolete daily ordinary-extra bucket',
)

replace_once(
    renderer,
    "    if (row.operationType === 'debt_close') bucket.debtPayments += Number(row.amount || 0)\n    else if (row.operationType === 'exchange_extra') bucket.exchangeExtras += Number(row.amount || 0)\n    else if (row.operationType === 'order_extra') bucket.orderExtras += Number(row.amount || 0)\n    else bucket.orderPayments += Number(row.amount || 0)\n",
    "    if (row.operationType === 'debt_close' || row.operationType === 'order_extra') bucket.debtPayments += Number(row.amount || 0)\n    else if (row.operationType === 'exchange_extra') bucket.exchangeExtras += Number(row.amount || 0)\n    else bucket.orderPayments += Number(row.amount || 0)\n",
    'Fold legacy extra into daily debt-close bucket',
)

replace_once(
    renderer,
    "<thead><tr><th>Дата</th><th className=\"num\">Заказов<br /><small>по дате заказа</small></th><th className=\"num\">Продажи<br /><small>по дате заказа</small></th><th className=\"num\">Оплаты заказов<br /><small>по дате оплаты</small></th><th className=\"num\">Доплаты заказов</th><th className=\"num\">Закрытие долгов</th><th className=\"num\">Доплаты обмена</th><th className=\"num\">Всего поступило</th><th className=\"num\">Возвращено</th><th className=\"num\">Чистыми</th><th>Проверка дат</th></tr></thead>",
    "<thead><tr><th>Дата</th><th className=\"num\">Заказов<br /><small>по дате заказа</small></th><th className=\"num\">Продажи<br /><small>по дате заказа</small></th><th className=\"num\">Оплаты заказов<br /><small>по дате оплаты</small></th><th className=\"num\">Закрытие долгов</th><th className=\"num\">Доплаты обмена</th><th className=\"num\">Всего поступило</th><th className=\"num\">Возвращено</th><th className=\"num\">Чистыми</th><th>Проверка дат</th></tr></thead>",
    'Remove ordinary-extra daily column',
)

replace_once(
    renderer,
    "                    <td className=\"num\">{formatMoney(row.orderPayments)}</td>\n                    <td className=\"num\">{formatMoney(row.orderExtras)}</td>\n                    <td className=\"num\">{formatMoney(row.debtPayments)}</td>\n",
    "                    <td className=\"num\">{formatMoney(row.orderPayments)}</td>\n                    <td className=\"num\">{formatMoney(row.debtPayments)}</td>\n",
    'Remove ordinary-extra daily cell',
)

replace_once(
    renderer,
    "                  {!cashDays.length ? <tr><td colSpan={11} className=\"empty-state\">За выбранный период нет заказов и денежных операций.</td></tr> : null}\n",
    "                  {!cashDays.length ? <tr><td colSpan={10} className=\"empty-state\">За выбранный период нет заказов и денежных операций.</td></tr> : null}\n",
    'Fix daily table colspan',
)

# Extend the permanent regression so this cannot silently return.
test = 'scripts/test-finance-f5-adjacent-regression.mjs'
replace_once(
    test,
    "  check(!financeUi.includes('Доплаты по заказам') && !financeUi.includes('<option value=\"order_extra\">'), 'Finance page still exposes generic ordinary extra')\n",
    "  check(!financeUi.includes('Доплаты по заказам') && !financeUi.includes('Доплаты заказов') && !financeUi.includes('<option value=\"order_extra\">'), 'Finance page still exposes generic ordinary extra')\n  check(!financeUi.includes('legacyOrderExtraPaymentsTotal') && !financeUi.includes('orderExtras'), 'Legacy ordinary extra is still separately accumulated in Finance UI and can be double-counted')\n  check(financeUi.includes(\"row.operationType === 'debt_close' || row.operationType === 'order_extra'\"), 'Legacy ordinary extra is not folded into the daily debt-close bucket')\n",
    'Extend F5 Finance UI regression',
)

print('Finance F5 adjacent fix applied')
