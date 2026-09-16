from pathlib import Path
import hashlib, json

root = Path(__file__).resolve().parents[1]
renderer_path = root / 'src/features/renderers/FinanceDashboardRenderer.tsx'
section_path = root / 'src/features/sections/FinanceSection.tsx'
test_path = root / 'scripts/test-finance-day-transparency.mjs'
manifest_path = root / 'scripts/finance-day-transparency-manifest.json'

renderer = renderer_path.read_text(encoding='utf-8')
replacements = [
    ("    { id: 'payments', label: 'Денежный журнал', hint: 'История денег' },", "    { id: 'payments', label: 'Операции', hint: 'По дате операции' },"),
    ("    { id: 'cash', label: 'Инкассация', hint: 'Наличные в офисе' },", "    { id: 'cash', label: 'Касса', hint: 'Наличные сейчас' },"),
    ("\n  if (ctx.financeDay && (financeMode === 'summary' || financeMode === 'payments')) {\n    return <div className=\"finance-tabs-shell finance-truth-shell\">{financeTabsNode}{ctx.financeDay}</div>\n  }\n", "\n"),
    (
        '''        {financeTabsNode}\n        {ctx.financeDay}\n        <details className={`finance-current-cash-disclosure${ctx.financeDay ? ' is-historical' : ' is-live'}`} open={ctx.financeDay ? undefined : true}>\n          <summary>\n            <span><strong>Текущая касса — сейчас</strong>{cashRegister?.initialized ? <small>{formatMoney(cashRegister.currentBalance)} в кассе · текущий цикл</small> : <small>Открыть текущую кассу</small>}</span>\n            {ctx.financeDay ? <span>Показать</span> : null}\n          </summary>\n          <div className="finance-tab-content cash-register-content cash-register-v2">''',
        '''        {financeTabsNode}\n        <div className="finance-tab-content cash-register-content cash-register-v2">''',
    ),
    (
        '''            </>\n          )}\n          </div>\n        </details>\n      </div>\n    )\n  }''',
        '''            </>\n          )}\n        </div>\n      </div>\n    )\n  }''',
    ),
    ('<h3>История денег</h3>', '<h3>Операции по датам</h3>'),
    ('Здесь видно, как менялись деньги в системе. Оплата, возврат и последующее исправление остаются отдельными строками.', 'Операции идут по дате, к которой относятся деньги. Если запись внесли позже, это показано внутри операции и не меняет её место в журнале.'),
    ('<span>Итог изменений</span>', '<span>Изменение по журналу</span>'),
    (
        ': moneyHistory.length ? <div className="finance-money-history-list">{moneyHistory.map((row) => (\n              <article className={`finance-money-history-row finance-money-history-row-f4 trace-${row.traceSeverity || \'normal\'}`} key={`money-history-${row.id}`}>',
        ': moneyHistory.length ? <div className="finance-money-history-list">{moneyHistory.map((row, index) => {\n              const previous = moneyHistory[index - 1]\n              const showDay = !previous || previous.eventDate !== row.eventDate\n              return <div className="finance-money-history-entry" key={`money-history-entry-${row.id}`}>\n                {showDay ? <div className="strict-section-head finance-money-history-day"><h3>{formatDateShort(row.eventDate)}</h3><span className="soft-badge">дата операции</span></div> : null}\n              <article className={`finance-money-history-row finance-money-history-row-f4 trace-${row.traceSeverity || \'normal\'}`}>',
    ),
    (
        '''              </article>\n            ))}</div>''',
        '''              </article>\n              </div>\n            })}</div>''',
    ),
]
for old, new in replacements:
    count = renderer.count(old)
    if count != 1:
        raise SystemExit(f'renderer anchor count {count}, expected 1: {old[:100]!r}')
    renderer = renderer.replace(old, new, 1)
renderer_path.write_text(renderer, encoding='utf-8')

# Replace the old special-day UI assertions with the new period semantics.
test = test_path.read_text(encoding='utf-8')
old_assertions = '''const section = fs.readFileSync('src/features/sections/FinanceSection.tsx','utf8')\nassert.ok(section.includes('active && singleDay'))\nassert.ok(section.includes('initialLedger={financeMode'))\nassert.ok(section.includes('accessRole}`'))\nassert.ok(section.includes('Дата дня'))\nconst router = fs.readFileSync('worker/domains/cash.ts','utf8')\nassert.ok(router.includes("if (url.searchParams.get('view') === 'day') return readFinanceDay(db, url)"))\nassert.ok(router.includes('ORDER BY fe.event_date DESC, datetime(fe.event_at) DESC, fe.id DESC'))\nconst rendererSource = fs.readFileSync('src/features/renderers/FinanceDashboardRenderer.tsx', 'utf8')\nconst financeDayCss = fs.readFileSync('src/features/finance/finance-day.css', 'utf8')\nassert.ok(rendererSource.includes("payment_correction: 'Исправление способа оплаты'"), 'cash journal must not expose payment_correction')\nassert.ok(rendererSource.includes('Внесено / относится к'), 'cash journal date heading must explain insertion order')\nassert.ok(rendererSource.includes('<strong>{financeRecordedAt(entry.createdAt)}</strong><span className="cash-entry-meta">Относится к {formatDateShort(entry.businessDate)}</span>'), 'cash journal must emphasize recorded-at before business date')\nassert.ok(rendererSource.includes('finance-current-cash-disclosure'), 'historical day must collapse the live cash workspace')\nassert.ok(financeDayCss.includes('.finance-current-cash-disclosure.is-historical'), 'historical cash disclosure styles missing')\n'''
new_assertions = '''const section = fs.readFileSync('src/features/sections/FinanceSection.tsx','utf8')\nassert.ok(!section.includes('FinanceDayPanel'), 'a single day must not replace the normal finance workspace')\nassert.ok(section.includes("const periodApplies = !['cash', 'methods'].includes(financeMode)"), 'cash and payment-method settings must not inherit the report period')\nassert.ok(section.includes('Все операции ниже относятся именно к выбранным датам'), 'period semantics must be explicit to the user')\nconst router = fs.readFileSync('worker/domains/cash.ts','utf8')\nassert.ok(router.includes("if (url.searchParams.get('view') === 'day') return readFinanceDay(db, url)"))\nassert.ok(router.includes('ORDER BY fe.event_date DESC, datetime(fe.event_at) DESC, fe.id DESC'))\nconst rendererSource = fs.readFileSync('src/features/renderers/FinanceDashboardRenderer.tsx', 'utf8')\nassert.ok(rendererSource.includes("{ id: 'payments', label: 'Операции', hint: 'По дате операции' }"), 'human money journal label missing')\nassert.ok(rendererSource.includes("{ id: 'cash', label: 'Касса', hint: 'Наличные сейчас' }"), 'cash must be presented as current operational state')\nassert.ok(!rendererSource.includes('ctx.financeDay'), 'historical day must not replace summary, operations or cash')\nassert.ok(rendererSource.includes('moneyHistory.map((row, index)'), 'operations must be grouped by business date')\nassert.ok(rendererSource.includes('дата операции'), 'business-date group heading missing')\nassert.ok(rendererSource.includes("payment_correction: 'Исправление способа оплаты'"), 'cash journal must not expose payment_correction')\n'''
if test.count(old_assertions) != 1:
    raise SystemExit('old finance assertions anchor missing')
test = test.replace(old_assertions, new_assertions, 1)
test_path.write_text(test, encoding='utf-8')

# Advance the exact frontend preservation hashes only for the intentionally changed files.
def git_blob_sha(text: str) -> str:
    raw = text.encode('utf-8')
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
for rel in ['src/features/sections/FinanceSection.tsx', 'src/features/renderers/FinanceDashboardRenderer.tsx']:
    text = (root / rel).read_text(encoding='utf-8')
    manifest['files'][rel]['afterGitBlob'] = git_blob_sha(text)
    manifest['files'][rel]['afterLines'] = len(text.splitlines())
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('FINANCE BUSINESS-DATE R1 PATCH APPLIED')
