from pathlib import Path
import hashlib, json

root = Path(__file__).resolve().parents[1]
renderer_path = root / 'src/features/renderers/FinanceDashboardRenderer.tsx'
css_path = root / 'src/features/finance/finance-day.css'
test_path = root / 'scripts/test-finance-day-transparency.mjs'
manifest_path = root / 'scripts/finance-day-transparency-manifest.json'

renderer = renderer_path.read_text(encoding='utf-8')

replacements = [
    (
        "      payment_reversal: 'Отмена оплаты',\n",
        "      payment_reversal: 'Отмена оплаты',\n      payment_correction: 'Исправление способа оплаты',\n",
    ),
    (
        '        {ctx.financeDay}\n        <div className="finance-tab-content cash-register-content cash-register-v2">',
        '''        {ctx.financeDay}\n        <details className={`finance-current-cash-disclosure${ctx.financeDay ? ' is-historical' : ' is-live'}`} open={ctx.financeDay ? undefined : true}>\n          <summary>\n            <span><strong>Текущая касса — сейчас</strong>{cashRegister?.initialized ? <small>{formatMoney(cashRegister.currentBalance)} в кассе · текущий цикл</small> : <small>Открыть текущую кассу</small>}</span>\n            {ctx.financeDay ? <span>Показать</span> : null}\n          </summary>\n          <div className="finance-tab-content cash-register-content cash-register-v2">''',
    ),
    (
        '<thead><tr><th>Дата</th><th>Операция</th>',
        '<thead><tr><th>Внесено / относится к</th><th>Операция</th>',
    ),
    (
        '<td><strong>Относится к {formatDateShort(entry.businessDate)}</strong><span className="cash-entry-meta">Внесено в систему {financeRecordedAt(entry.createdAt)}</span></td>',
        '<td><strong>{financeRecordedAt(entry.createdAt)}</strong><span className="cash-entry-meta">Относится к {formatDateShort(entry.businessDate)}</span></td>',
    ),
    (
        '            </>\n          )}\n        </div>\n      </div>\n    )',
        '            </>\n          )}\n          </div>\n        </details>\n      </div>\n    )',
    ),
]
for old, new in replacements:
    count = renderer.count(old)
    if count != 1:
        raise SystemExit(f'renderer anchor count {count}, expected 1: {old[:80]!r}')
    renderer = renderer.replace(old, new, 1)
renderer_path.write_text(renderer, encoding='utf-8')

css = css_path.read_text(encoding='utf-8')
css_replacements = [
    ('.finance-day { display: grid; gap: 14px; padding: 18px;', '.finance-day { display: grid; gap: 12px; padding: 16px;'),
    ('.finance-day-totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }', '.finance-day-totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }'),
    ('.finance-day-totals article { display: grid; align-content: start; gap: 7px; padding: 13px;', '.finance-day-totals article { display: grid; align-content: start; gap: 4px; padding: 10px;'),
    ('.finance-day-totals strong { font-size: 22px;', '.finance-day-totals strong { font-size: 20px;'),
    ('.finance-day-totals small { color: #536375; line-height: 1.4; }', '.finance-day-totals small { color: #536375; line-height: 1.35; font-size: 12px; }'),
    ('.finance-day-methods > div { display: flex; align-items: center; gap: 10px; padding: 8px 10px;', '.finance-day-methods > div { display: flex; align-items: center; gap: 8px; padding: 6px 9px;'),
]
for old, new in css_replacements:
    if old not in css:
        raise SystemExit(f'css anchor missing: {old}')
    css = css.replace(old, new, 1)

insert_before = '@media (max-width: 1050px)'
if insert_before not in css:
    raise SystemExit('css media anchor missing')
disclosure_css = '''.finance-current-cash-disclosure { margin-top: 12px; border: 1px solid #dbe3eb; border-radius: 12px; background: #fff; overflow: clip; }\n.finance-current-cash-disclosure > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; cursor: pointer; list-style: none; background: #f8fafc; }\n.finance-current-cash-disclosure > summary::-webkit-details-marker { display: none; }\n.finance-current-cash-disclosure > summary > span:first-child { display: grid; gap: 2px; }\n.finance-current-cash-disclosure > summary strong { font-size: 15px; }\n.finance-current-cash-disclosure > summary small { color: #536375; font-size: 12px; font-weight: 400; }\n.finance-current-cash-disclosure > summary > span:last-child { color: #365c91; font-size: 12px; font-weight: 700; }\n.finance-current-cash-disclosure[open].is-historical > summary { border-bottom: 1px solid #dbe3eb; }\n.finance-current-cash-disclosure.is-historical .cash-register-content { margin: 0; border: 0; border-radius: 0; box-shadow: none; }\n.finance-current-cash-disclosure.is-live { margin-top: 0; border: 0; border-radius: 0; overflow: visible; }\n.finance-current-cash-disclosure.is-live > summary { display: none; }\n.finance-current-cash-disclosure.is-live .cash-register-content { margin-top: 0; }\n'''
css = css.replace(insert_before, disclosure_css + insert_before, 1)
css_path.write_text(css, encoding='utf-8')

test = test_path.read_text(encoding='utf-8')
anchor = "console.log('FINANCE DAY FOCUSED GREEN — corrected payments, separate cash, late dates, unknowns, read-only SQL and human rendering')"
if anchor not in test:
    raise SystemExit('focused-test anchor missing')
checks = '''const rendererSource = fs.readFileSync('src/features/renderers/FinanceDashboardRenderer.tsx', 'utf8')\nconst financeDayCss = fs.readFileSync('src/features/finance/finance-day.css', 'utf8')\nassert.ok(rendererSource.includes("payment_correction: 'Исправление способа оплаты'"), 'cash journal must not expose payment_correction')\nassert.ok(rendererSource.includes('Внесено / относится к'), 'cash journal date heading must explain insertion order')\nassert.ok(rendererSource.includes('<strong>{financeRecordedAt(entry.createdAt)}</strong><span className="cash-entry-meta">Относится к {formatDateShort(entry.businessDate)}</span>'), 'cash journal must emphasize recorded-at before business date')\nassert.ok(rendererSource.includes('finance-current-cash-disclosure'), 'historical day must collapse the live cash workspace')\nassert.ok(financeDayCss.includes('.finance-current-cash-disclosure.is-historical'), 'historical cash disclosure styles missing')\n'''
test = test.replace(anchor, checks + anchor, 1)
test_path.write_text(test, encoding='utf-8')

# Update the exact finance-day preservation manifest after the bounded UI polish.
def git_blob_sha(text: str) -> str:
    raw = text.encode('utf-8')
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

def sha256(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
renderer_text = renderer_path.read_text(encoding='utf-8')
css_text = css_path.read_text(encoding='utf-8')
manifest['files']['src/features/renderers/FinanceDashboardRenderer.tsx']['afterGitBlob'] = git_blob_sha(renderer_text)
manifest['files']['src/features/renderers/FinanceDashboardRenderer.tsx']['afterLines'] = len(renderer_text.splitlines()) + (1 if renderer_text.endswith('\n') else 0)
manifest['addedFiles']['src/features/finance/finance-day.css'] = sha256(css_text)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('FINANCE DAY HUMAN POLISH PATCH APPLIED')
