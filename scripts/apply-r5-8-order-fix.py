from pathlib import Path

finance_path = Path('worker/domains/finance-reports.ts')
text = finance_path.read_text()
old = """  const paymentMethodsByDayMap = new Map<string, { date: string; total: number; methods: Record<string, number> }>();
  const paymentMethodsByDaySource = financeWorkspaceOnly
    ? rawPaymentOperationRows.map((row: any) => ({ date: row.payment_date, method: row.method, total: row.amount }))
    : mapSqlRows(paymentByDayRows) as any[];
"""
new = """  const paymentMethodsByDayMap = new Map<string, { date: string; total: number; methods: Record<string, number> }>();
  const paymentMethodsByDaySource = financeWorkspaceOnly
    ? Array.from(rawPaymentOperationRows.reduce((groups: Map<string, any>, row: any) => {
        const date = cleanText(row.payment_date);
        const rawMethod = row.method == null ? null : String(row.method);
        const key = JSON.stringify([date, rawMethod]);
        const current = groups.get(key) || { date, method: rawMethod, total: 0 };
        current.total += Number(row.amount || 0);
        groups.set(key, current);
        return groups;
      }, new Map<string, any>()).values()).sort((a: any, b: any) => {
        const dateOrder = String(a.date).localeCompare(String(b.date));
        if (dateOrder) return dateOrder;
        const totalOrder = Number(b.total || 0) - Number(a.total || 0);
        if (totalOrder) return totalOrder;
        if (a.method == null && b.method != null) return -1;
        if (a.method != null && b.method == null) return 1;
        const left = String(a.method ?? '');
        const right = String(b.method ?? '');
        return left < right ? -1 : left > right ? 1 : 0;
      })
    : mapSqlRows(paymentByDayRows) as any[];
"""
if text.count(old) != 1:
    raise SystemExit(f'payment-by-day candidate anchor count={text.count(old)}')
finance_path.write_text(text.replace(old, new, 1))

test_path = Path('scripts/test-d1-read-budget-r5-8.mjs')
test = test_path.read_text()
old_test = "  check(finance.includes('? rawPaymentOperationRows.map((row: any) => ({ date: row.payment_date, method: row.method, total: row.amount }))'), 'R5.8 payment-by-day must derive from payment operations inside Finance scope')\n"
new_test = "  check(finance.includes('Array.from(rawPaymentOperationRows.reduce((groups: Map<string, any>, row: any) => {'), 'R5.8 payment-by-day must derive grouped raw methods from payment operations inside Finance scope')\n  check(finance.includes('const totalOrder = Number(b.total || 0) - Number(a.total || 0);'), 'R5.8 Finance-derived day methods must preserve SQL total-desc ordering before canonical merge')\n  check(finance.includes('if (a.method == null && b.method != null) return -1;'), 'R5.8 Finance-derived day methods must preserve SQLite NULL-first method tie ordering')\n"
if test.count(old_test) != 1:
    raise SystemExit('R5.8 test anchor missing')
test_path.write_text(test.replace(old_test, new_test, 1))
