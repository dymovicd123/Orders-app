from pathlib import Path
import json
import subprocess

root = Path('.')
app_path = root / 'src/App.tsx'
renderer_path = root / 'src/features/renderers/FinanceDashboardRenderer.tsx'
test_path = root / 'scripts/test-finance-day-transparency.mjs'
manifest_path = root / 'scripts/finance-day-transparency-manifest.json'

app = app_path.read_text(encoding='utf-8')
old = "    if (financeReportFilters.dateFrom === financeReportFilters.dateTo && (financeMode === 'summary' || financeMode === 'payments')) return\n"
if old not in app:
    raise SystemExit('summary/payments single-day guard missing')
app = app.replace(old, '', 1)
old = "    if (financeReportFilters.dateFrom === financeReportFilters.dateTo) return\n"
if old not in app:
    raise SystemExit('money-history single-day guard missing')
app = app.replace(old, '', 1)
old = "    if (!authReady || activeSector !== 'finance' || financeMode === 'cash') return\n"
if old not in app:
    raise SystemExit('finance report mode guard missing')
app = app.replace(old, "    if (!authReady || activeSector !== 'finance' || financeMode === 'cash' || financeMode === 'methods') return\n", 1)
app_path.write_text(app, encoding='utf-8')

renderer = renderer_path.read_text(encoding='utf-8')
anchor = "    } as Record<string, string>)[entryType] || entryType || 'Движение'\n\n    return ("
if anchor not in renderer:
    raise SystemExit('cash renderer helper anchor missing')
helper = """    } as Record<string, string>)[entryType] || entryType || 'Движение'\n\n    const cashRecordedBusinessDate = (value: unknown) => {\n      const text = String(value || '').trim()\n      if (!text) return ''\n      const date = new Date(text)\n      if (Number.isNaN(date.getTime())) return text.slice(0, 10)\n      return new Date(date.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10)\n    }\n    const cashBusinessDayMap = new Map<string, any[]>()\n    ;(cashRegister?.entries || []).forEach((entry: any) => {\n      const date = String(entry.businessDate || '').trim() || 'Без даты'\n      const rows = cashBusinessDayMap.get(date) || []\n      rows.push(entry)\n      cashBusinessDayMap.set(date, rows)\n    })\n    const cashBusinessDays = Array.from(cashBusinessDayMap.entries())\n      .map(([date, entries]) => ({\n        date,\n        entries: [...entries].sort((a: any, b: any) => String(b.occurredAt || b.createdAt || '').localeCompare(String(a.occurredAt || a.createdAt || '')) || Number(b.id || 0) - Number(a.id || 0)),\n        totalIn: entries.reduce((sum: number, entry: any) => sum + (entry.direction === 'in' ? Number(entry.amount || 0) : 0), 0),\n        totalOut: entries.reduce((sum: number, entry: any) => sum + (entry.direction === 'out' ? Number(entry.amount || 0) : 0), 0),\n      }))\n      .sort((a, b) => String(b.date).localeCompare(String(a.date)))\n\n    return ("""
renderer = renderer.replace(anchor, helper, 1)

start = renderer.find('              <section className="mini-panel cash-register-ledger-panel">')
if start < 0:
    raise SystemExit('technical cash ledger start missing')
end_marker = '              </section>\n            </>\n'
end = renderer.find(end_marker, start)
if end < 0:
    raise SystemExit('technical cash ledger end missing')
ledger = renderer[start:end + len('              </section>\n')]
human = r'''              <section className="mini-panel cash-business-history-panel">
                <div className="mini-panel-head">
                  <div>
                    <h3>История наличных по дням</h3>
                    <p className="mini-panel-note">Основная история сгруппирована по дате, к которой относятся деньги. Время внесения показывается только как дополнительная пометка.</p>
                  </div>
                  <button className="secondary compact" type="button" disabled={cashRegisterBusy} onClick={() => void loadCashRegister()}>Обновить</button>
                </div>
                {cashBusinessDays.length ? cashBusinessDays.map((day) => (
                  <section className="mini-panel" key={`cash-business-day-${day.date}`}>
                    <div className="mini-panel-head">
                      <div>
                        <h3>{day.date === 'Без даты' ? day.date : formatDateShort(day.date)}</h3>
                        <p className="mini-panel-note">Пришло + {formatMoney(day.totalIn)} · Ушло − {formatMoney(day.totalOut)} · Изменение {day.totalIn - day.totalOut >= 0 ? '+' : '−'} {formatMoney(Math.abs(day.totalIn - day.totalOut))}</p>
                      </div>
                    </div>
                    <div className="table-shell">
                      <table className="data-table cash-business-day-table">
                        <thead><tr><th>Операция</th><th>Заказ / источник</th><th>Комментарий</th><th>Когда внесено</th><th className="num">Приход</th><th className="num">Расход</th></tr></thead>
                        <tbody>
                          {day.entries.map((entry: any) => {
                            const recordedDate = cashRecordedBusinessDate(entry.createdAt)
                            const recordedLater = Boolean(recordedDate && day.date !== 'Без даты' && recordedDate !== day.date)
                            return <tr key={`cash-business-entry-${entry.id}`} className={entry.direction === 'out' ? 'is-out' : 'is-in'}>
                              <td><strong>{entryTypeLabel(entry.entryType)}</strong><span className="cash-entry-meta">{entry.paymentMethod || entry.createdBy || '—'}</span></td>
                              <td>{entry.externalOrderId ? <strong>{entry.externalOrderId}</strong> : entry.sourceType === 'manual' ? 'Ручная операция' : entry.entryType === 'ledger_reset' ? 'Новый цикл' : entry.sourceType === 'opening' ? 'Начальная точка' : '—'}</td>
                              <td>{entry.comment || '—'}</td>
                              <td>{recordedLater ? <><strong>Внесено позже</strong><span className="cash-entry-meta">{financeRecordedAt(entry.createdAt)}</span></> : <span className="cash-entry-meta">{financeRecordedAt(entry.createdAt)}</span>}</td>
                              <td className="num cash-in">{entry.direction === 'in' ? `+ ${formatMoney(entry.amount)}` : '—'}</td>
                              <td className="num cash-out">{entry.direction === 'out' ? `− ${formatMoney(entry.amount)}` : '—'}</td>
                            </tr>
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )) : <div className="empty-state">История наличных пока пуста.</div>}
              </section>

              <details className="mini-panel cash-technical-ledger-details">
                <summary><strong>Технический журнал кассы</strong> · порядок внесения и остаток после каждой записи</summary>
'''
technical = ledger.replace('<section className="mini-panel cash-register-ledger-panel">', '<section className="cash-register-ledger-panel">', 1)
replacement = human + technical + '              </details>\n'
renderer = renderer[:start] + replacement + renderer[end + len('              </section>\n'):]
renderer_path.write_text(renderer, encoding='utf-8')

test = test_path.read_text(encoding='utf-8')
needle = "assert.ok(rendererSource.indexOf('finance-human-operations-block') < rendererSource.indexOf('finance-payment-classification'), 'human operations must appear before classifications')\n"
if needle not in test:
    raise SystemExit('finance test anchor missing')
extra = needle + "const appSource = fs.readFileSync('src/App.tsx', 'utf8')\nassert.ok(!appSource.includes(\"financeReportFilters.dateFrom === financeReportFilters.dateTo && (financeMode === 'summary' || financeMode === 'payments')\"), 'single-day report must use the normal range loader')\nassert.ok(!appSource.includes(\"if (financeReportFilters.dateFrom === financeReportFilters.dateTo) return\"), 'single-day operations must reload money history')\nassert.ok(rendererSource.includes('История наличных по дням'), 'cash needs a business-date-first human history')\nassert.ok(rendererSource.includes('Технический журнал кассы'), 'insertion-order ledger must remain available only as technical audit')\nassert.ok(rendererSource.indexOf('История наличных по дням') < rendererSource.indexOf('Технический журнал кассы'), 'human cash history must lead technical ledger')\nassert.ok(rendererSource.includes('Внесено позже'), 'late-recorded cash must be secondary annotation')\n"
test = test.replace(needle, extra, 1)
test_path.write_text(test, encoding='utf-8')

manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
def blob(path: Path) -> str:
    return subprocess.check_output(['git', 'hash-object', str(path)], text=True).strip()
def lines(path: Path) -> int:
    return len(path.read_text(encoding='utf-8').splitlines())
manifest['files']['src/App.tsx']['afterGitBlob'] = blob(app_path)
manifest['files']['src/App.tsx']['afterLines'] = lines(app_path)
manifest['files']['src/features/renderers/FinanceDashboardRenderer.tsx']['afterGitBlob'] = blob(renderer_path)
manifest['files']['src/features/renderers/FinanceDashboardRenderer.tsx']['afterLines'] = lines(renderer_path)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('Finance R3 period + cash patch applied')
