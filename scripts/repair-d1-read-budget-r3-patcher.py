from pathlib import Path

path = Path(__file__).resolve().parent / 'apply-d1-read-budget-r3.py'
text = path.read_text(encoding='utf-8')
old = '''app = replace_once(
    app,
    "    if (activeSector === 'finance') {\\n      if (financeMode === 'cash') void loadCashRegister()\\n      else {\\n        if (financeMode === 'payments') void loadMoneyHistory()\\n        if (financeMode === 'methods') void loadFinancePaymentMethods()\\n        void loadFinanceReports(financeReportFilters, { force: true })\\n      }\\n    }",
    "    if (activeSector === 'finance') {\\n      if (financeMode === 'cash') void loadCashRegister()\\n      else {\\n        if (financeMode === 'payments') void loadMoneyHistory()\\n        if (financeMode === 'methods') void loadFinancePaymentMethods()\\n      }\\n    }",
    'remove forced finance read on navigation',
)'''
new = '''app = replace_once(
    app,
    "    if (activeSector === 'finance') {\\n      void loadFinancePaymentMethods()\\n      // Финансовая сводка должна появляться сразу при входе в раздел.\\n      // Отдельный effect ниже по-прежнему обновляет её при смене периода.\\n      if (financeMode !== 'cash') void loadFinanceReports(financeReportFilters, { force: true })\\n    }",
    "    if (activeSector === 'finance') {\\n      void loadFinancePaymentMethods()\\n      // Сводка ниже загружается отдельным effect и использует scoped cache.\\n    }",
    'remove forced finance read on navigation',
)'''
if text.count(old) != 1:
    raise SystemExit(f'expected one old patch block, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Repaired R3 patcher finance navigation anchor')
