from pathlib import Path

files = {
    'activity': Path('worker/domains/activity.ts'),
    'domain': Path('worker/domains/returns-exchanges.ts'),
    'types': Path('src/app/types.ts'),
    'app': Path('src/App.tsx'),
    'returns': Path('src/features/sections/OrderReturnsSection.tsx'),
    'exchange': Path('src/features/sections/OrderExchangeSection.tsx'),
    'test': Path('scripts/test-return-exchange-physical-receipt-r1.mjs'),
}
texts = {k: p.read_text() for k, p in files.items()}

def rep(key, old, new, label):
    count = texts[key].count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 anchor, found {count}')
    texts[key] = texts[key].replace(old, new, 1)

# Return summary: pre-aggregate pending physical quantities by return_id, then join one row per return.
rep('activity',
"""            SUM(CASE WHEN COALESCE(r.status, 'completed') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
            COALESCE(SUM(CASE WHEN COALESCE(r.status, 'completed') <> 'cancelled' THEN r.amount ELSE 0 END), 0) AS active_amount
     FROM returns r
     JOIN orders o ON o.id = r.order_id
     LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
     LEFT JOIN customers c ON c.id = o.customer_id
""",
"""            SUM(CASE WHEN COALESCE(r.status, 'completed') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
            COALESCE(SUM(CASE WHEN COALESCE(r.status, 'completed') <> 'cancelled' THEN r.amount ELSE 0 END), 0) AS active_amount,
            COALESCE(SUM(CASE WHEN COALESCE(r.status, 'completed') <> 'cancelled' THEN COALESCE(pending_physical.pending_physical_quantity, 0) ELSE 0 END), 0) AS pending_physical_quantity
     FROM returns r
     JOIN orders o ON o.id = r.order_id
     LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN (
       SELECT return_id, SUM(quantity) AS pending_physical_quantity
       FROM return_items
       WHERE physical_tracking = 1 AND physical_received_at IS NULL
       GROUP BY return_id
     ) pending_physical ON pending_physical.return_id = r.id
""", 'return summary pending quantity')
rep('activity',
"""    summary: { activeCount: Math.max(0, toInt(summary?.active_count, 0)), cancelledCount: Math.max(0, toInt(summary?.cancelled_count, 0)), activeAmount: Number(summary?.active_amount || 0) },
""",
"""    summary: { activeCount: Math.max(0, toInt(summary?.active_count, 0)), cancelledCount: Math.max(0, toInt(summary?.cancelled_count, 0)), activeAmount: Number(summary?.active_amount || 0), pendingPhysicalQuantity: Math.max(0, toInt(summary?.pending_physical_quantity, 0)) },
""", 'return summary response')

# Exchange summary: one old snapshot per exchange, so counts and sums remain one-row-per-operation.
rep('domain',
"""    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN COALESCE(e.status, 'completed') <> 'cancelled' THEN 1 ELSE 0 END) AS active_count,
            SUM(CASE WHEN COALESCE(e.status, 'completed') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
     FROM exchanges e JOIN orders o ON o.id = e.order_id
     LEFT JOIN managers m ON m.id = e.manager_id LEFT JOIN customers c ON c.id = o.customer_id ${whereSql}`
""",
"""    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN COALESCE(e.status, 'completed') <> 'cancelled' THEN 1 ELSE 0 END) AS active_count,
            SUM(CASE WHEN COALESCE(e.status, 'completed') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
            COALESCE(SUM(CASE
              WHEN COALESCE(e.status, 'completed') <> 'cancelled'
               AND old_summary.physical_tracking = 1
               AND old_summary.physical_received_at IS NULL
              THEN COALESCE(old_summary.quantity, e.old_quantity, 0)
              ELSE 0
            END), 0) AS pending_physical_quantity
     FROM exchanges e JOIN orders o ON o.id = e.order_id
     LEFT JOIN managers m ON m.id = e.manager_id LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN exchange_items old_summary ON old_summary.id = (
       SELECT ei.id FROM exchange_items ei WHERE ei.exchange_id = e.id AND ei.role = 'old' ORDER BY ei.id ASC LIMIT 1
     )
     ${whereSql}`
""", 'exchange summary pending quantity')
rep('domain',
"""    summary: { activeCount: Math.max(0, toInt(summary?.active_count, 0)), cancelledCount: Math.max(0, toInt(summary?.cancelled_count, 0)) }, exchanges: rows };
""",
"""    summary: { activeCount: Math.max(0, toInt(summary?.active_count, 0)), cancelledCount: Math.max(0, toInt(summary?.cancelled_count, 0)), pendingPhysicalQuantity: Math.max(0, toInt(summary?.pending_physical_quantity, 0)) }, exchanges: rows };
""", 'exchange summary response')

# Frontend response/state contracts.
rep('types',
"""    cancelledCount: number
    activeAmount: number
  }
""",
"""    cancelledCount: number
    activeAmount: number
    pendingPhysicalQuantity: number
  }
""", 'return summary type')
rep('types',
"""  summary?: { activeCount: number; cancelledCount: number }
""",
"""  summary?: { activeCount: number; cancelledCount: number; pendingPhysicalQuantity: number }
""", 'exchange summary type')
rep('app',
"""  const [returnHistorySummary, setReturnHistorySummary] = useState({ activeCount: 0, cancelledCount: 0, activeAmount: 0, count: 0 })
""",
"""  const [returnHistorySummary, setReturnHistorySummary] = useState({ activeCount: 0, cancelledCount: 0, activeAmount: 0, pendingPhysicalQuantity: 0, count: 0 })
""", 'return summary state')
rep('app',
"""  const [exchangeHistorySummary, setExchangeHistorySummary] = useState({ activeCount: 0, cancelledCount: 0, count: 0 })
""",
"""  const [exchangeHistorySummary, setExchangeHistorySummary] = useState({ activeCount: 0, cancelledCount: 0, pendingPhysicalQuantity: 0, count: 0 })
""", 'exchange summary state')
rep('app',
"""        activeAmount: Number(data.summary?.activeAmount || 0),
        count: Number(data.count || 0),
""",
"""        activeAmount: Number(data.summary?.activeAmount || 0),
        pendingPhysicalQuantity: Number(data.summary?.pendingPhysicalQuantity || 0),
        count: Number(data.count || 0),
""", 'return summary load')
rep('app',
"""      setExchangeHistorySummary({ activeCount: Number(data.summary?.activeCount || 0), cancelledCount: Number(data.summary?.cancelledCount || 0), count: Number(data.count || 0) })
""",
"""      setExchangeHistorySummary({ activeCount: Number(data.summary?.activeCount || 0), cancelledCount: Number(data.summary?.cancelledCount || 0), pendingPhysicalQuantity: Number(data.summary?.pendingPhysicalQuantity || 0), count: Number(data.count || 0) })
""", 'exchange summary load')

# Visible counters on the existing summary surfaces.
rep('returns',
"""                  <div>
                    <span>Отменённых</span>
                    <strong>{returnHistorySummary.cancelledCount}</strong>
                  </div>
""",
"""                  <div>
                    <span>Отменённых</span>
                    <strong>{returnHistorySummary.cancelledCount}</strong>
                  </div>
                  <div>
                    <span>Ещё физически не пришло</span>
                    <strong>{returnHistorySummary.pendingPhysicalQuantity} шт.</strong>
                  </div>
""", 'return top summary UI')
rep('returns',
"""                  <span>Сумма проведённых: <strong>{formatMoney(returnHistorySummary.activeAmount)}</strong></span>
                  {returnHistorySummary.cancelledCount ? <span>Отменено: <strong>{returnHistorySummary.cancelledCount}</strong></span> : null}
""",
"""                  <span>Сумма проведённых: <strong>{formatMoney(returnHistorySummary.activeAmount)}</strong></span>
                  <span>Ещё не пришло: <strong>{returnHistorySummary.pendingPhysicalQuantity} шт.</strong></span>
                  {returnHistorySummary.cancelledCount ? <span>Отменено: <strong>{returnHistorySummary.cancelledCount}</strong></span> : null}
""", 'return history summary UI')
rep('exchange',
"""                <div className=\"history-summary-line\"><span><strong>{exchangeHistorySummary.count}</strong> операций</span><span>Проведено: <strong>{exchangeHistorySummary.activeCount}</strong></span>{exchangeHistorySummary.cancelledCount ? <span>Отменено: <strong>{exchangeHistorySummary.cancelledCount}</strong></span> : null}</div>
""",
"""                <div className=\"history-summary-line\"><span><strong>{exchangeHistorySummary.count}</strong> операций</span><span>Проведено: <strong>{exchangeHistorySummary.activeCount}</strong></span><span>Старых вещей ещё не пришло: <strong>{exchangeHistorySummary.pendingPhysicalQuantity} шт.</strong></span>{exchangeHistorySummary.cancelledCount ? <span>Отменено: <strong>{exchangeHistorySummary.cancelledCount}</strong></span> : null}</div>
""", 'exchange history summary UI')

# Regression guards for the aggregate and visible counters.
anchor = "console.log('Return/exchange physical receipt R1 regression: OK')\n"
if texts['test'].count(anchor) != 1:
    raise SystemExit('test final anchor missing')
checks = """expect(activity.includes('AS pending_physical_quantity'), 'return history pending physical quantity summary missing')
expect(activity.includes('pendingPhysicalQuantity: Math.max(0, toInt(summary?.pending_physical_quantity, 0))'), 'return history pending physical quantity response missing')
expect(domain.includes('old_summary.physical_tracking = 1'), 'exchange pending physical quantity summary missing')
expect(domain.includes('pendingPhysicalQuantity: Math.max(0, toInt(summary?.pending_physical_quantity, 0))'), 'exchange pending physical quantity response missing')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const returnsSection = fs.readFileSync('src/features/sections/OrderReturnsSection.tsx', 'utf8')
const exchangeSection = fs.readFileSync('src/features/sections/OrderExchangeSection.tsx', 'utf8')
expect(app.includes('pendingPhysicalQuantity: Number(data.summary?.pendingPhysicalQuantity || 0)'), 'frontend does not consume pending physical quantity')
expect(returnsSection.includes('Ещё физически не пришло'), 'return summary does not show pending physical quantity')
expect(exchangeSection.includes('Старых вещей ещё не пришло'), 'exchange summary does not show pending physical quantity')

"""
texts['test'] = texts['test'].replace(anchor, checks + anchor, 1)

for key, path in files.items():
    path.write_text(texts[key])
print('physical receipt summary counters patched')
