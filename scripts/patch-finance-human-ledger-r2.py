from pathlib import Path
import hashlib
import json

root = Path('.')
renderer_path = root / 'src/features/renderers/FinanceDashboardRenderer.tsx'
test_path = root / 'scripts/test-finance-day-transparency.mjs'
manifest_path = root / 'scripts/finance-day-transparency-manifest.json'

text = renderer_path.read_text(encoding='utf-8')

def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return source.replace(old, new, 1)

text = replace_once(
    text,
    'Записи идут в порядке внесения. Для истории конкретного дня используйте «Один день». Ошибочную ручную операцию лучше отменять кнопкой «Отменить», а не создавать встречное внесение вручную.',
    'Это техническая последовательность текущей кассы. Обычную историю денег смотрите во вкладке «Операции». Ошибочную ручную операцию лучше отменять кнопкой «Отменить», а не создавать встречное внесение вручную.',
    'cash ledger copy',
)

cash_anchor = '''  const cashDays = Array.from(cashDayMap.values())
    .map((row) => ({ ...row, net: row.received - row.returned }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))

  return (
'''
human_block = '''  const cashDays = Array.from(cashDayMap.values())
    .map((row) => ({ ...row, net: row.received - row.returned }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))

  const humanOperations = [
    ...paymentOperations.map((row) => ({
      key: `payment-${row.id}`,
      date: row.paymentDate,
      orderId: row.orderId,
      externalId: row.externalId,
      orderDate: row.orderDate,
      label: row.operationLabel || ({ order_payment: 'Оплата заказа', debt_close: 'Закрытие долга', order_extra: 'Доплата по заказу', exchange_extra: 'Доплата по обмену' } as Record<string, string>)[row.operationType] || 'Оплата',
      method: row.method || 'Способ не указан',
      amount: Number(row.amount || 0),
      direction: 'in',
      customer: row.customer || '',
      manager: row.manager || '',
      managerColor: row.managerColor || '',
      comment: row.comment || '',
      recordedAt: row.createdAt || '',
    })),
    ...activeReturns.map((row) => ({
      key: `return-${row.id}`,
      date: row.return_date,
      orderId: row.order_id,
      externalId: row.external_id,
      orderDate: row.order_date,
      label: row.return_type === 'exchange_refund' ? 'Возврат по обмену' : 'Возврат клиенту',
      method: row.payment_method || 'Способ не указан',
      amount: Number(row.amount || 0),
      direction: 'out',
      customer: row.customer || '',
      manager: row.manager || '',
      managerColor: row.manager_color || '',
      comment: row.comment || '',
      recordedAt: '',
    })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.key).localeCompare(String(a.key)))

  return (
'''
text = replace_once(text, cash_anchor, human_block, 'human operations model')

# Put the human day chronology immediately after the four overview cards.
days_start = text.index('          <section className="mini-panel finance-days-truth-panel">')
summary_end_marker = '        </div>\n      ) : null}\n\n      {financeMode === \'payments\' ? ('
days_end = text.index(summary_end_marker, days_start)
days_region = text[days_start:days_end]
last_section_end = days_region.rfind('          </section>')
if last_section_end < 0:
    raise SystemExit('summary day section end missing')
days_block = days_region[:last_section_end + len('          </section>')]
text = text[:days_start] + text[days_start + len(days_block):]
reconciliation_marker = '          <section className={`finance-reconciliation finance-reconciliation-v2 ${consistency.ok ? \'is-ok\' : \'is-error\'}`}> '
if reconciliation_marker not in text:
    reconciliation_marker = '          <section className={`finance-reconciliation finance-reconciliation-v2 ${consistency.ok ? \'is-ok\' : \'is-error\'}`}>\n'
if reconciliation_marker not in text:
    raise SystemExit('reconciliation marker missing')
reconciliation_index = text.index(reconciliation_marker)
text = text[:reconciliation_index] + days_block + '\n\n' + text[reconciliation_index:]

payments_open = '      {financeMode === \'payments\' ? (\n        <div className="finance-payment-ledger finance-tab-content finance-truth-content">\n'
if payments_open not in text:
    raise SystemExit('payments open missing')

human_ui = '''          <section className="report-block finance-human-operations-block">
            <div className="strict-section-head finance-money-history-head">
              <div>
                <h3>Операции по датам</h3>
                <p className="mini-panel-note">Операции идут по дате, к которой относятся деньги. Время внесения показывается только как примечание и не меняет порядок журнала.</p>
              </div>
              <span className="soft-badge">{humanOperations.length} операций</span>
            </div>
            {humanOperations.length ? <div className="finance-money-history-list">{humanOperations.map((row, index) => {
              const previous = humanOperations[index - 1]
              const showDay = !previous || previous.date !== row.date
              const recordedLater = row.recordedAt && String(row.recordedAt).slice(0, 10) !== String(row.date)
              return <div className="finance-money-history-entry" key={row.key}>
                {showDay ? <div className="strict-section-head finance-money-history-day"><h3>{formatDateShort(row.date)}</h3><span className="soft-badge">дата операции</span></div> : null}
                <article className={`finance-money-history-row finance-money-history-row-f4 ${row.direction === 'out' ? 'trace-review' : 'trace-normal'}`}>
                  <div className="finance-money-history-date">
                    <strong>{row.label}</strong>
                    <small>{recordedLater ? `Внесено позже — ${financeRecordedAt(row.recordedAt)}` : `Относится к ${formatDateShort(row.date)}`}</small>
                  </div>
                  <div className="finance-money-history-order">
                    <strong>{row.externalId || 'Без номера заказа'}</strong>
                    {row.customer ? <small>{row.customer}</small> : null}
                    {row.orderDate ? <small>Дата заказа: {formatDateShort(row.orderDate)}</small> : null}
                    {row.manager ? <ManagerBadge name={row.manager} colorKey={row.managerColor || managerColorFor(row.manager)} compact /> : null}
                  </div>
                  <div className="finance-money-history-operation">
                    <strong>{row.method}</strong>
                    {row.comment ? <span className="finance-money-history-note">{row.comment}</span> : null}
                  </div>
                  <div className="finance-money-history-method">{row.direction === 'out' ? 'Возврат' : 'Поступление'}</div>
                  <div className={`finance-money-history-amount ${row.direction === 'out' ? 'is-out' : 'is-in'}`}>{row.direction === 'out' ? '− ' : '+ '}{formatMoney(row.amount)}</div>
                  <div className="finance-money-history-actions">
                    {row.orderId || row.externalId ? <button className="secondary compact finance-order-link" type="button" onClick={() => void openOrderFromFinance({ orderId: row.orderId || undefined, externalId: row.externalId, orderDate: row.orderDate || undefined })}>К заказу</button> : null}
                  </div>
                </article>
              </div>
            })}</div> : <div className="finance-money-history-state"><strong>За выбранный период денежных операций нет.</strong></div>}
          </section>

'''
text = replace_once(text, payments_open, payments_open + human_ui, 'human operations UI')

class_start = text.index('          <div className="report-grid two-columns finance-payment-classification">', text.index(payments_open))
money_start = text.index('          <section className="report-block finance-money-history-block">', class_start)
class_block = text[class_start:money_start]
class_wrapped = '''          <details className="finance-secondary-details">
            <summary>Разбивка поступлений по видам и способам оплаты</summary>
''' + class_block + '''          </details>

'''
text = text[:class_start] + class_wrapped + text[money_start:]

money_start = text.index('          <section className="report-block finance-money-history-block">', text.index(payments_open))
payments_end_marker = '        </div>\n      ) : null}\n\n      {financeMode === \'debts\' ? ('
payments_end = text.index(payments_end_marker, money_start)
money_block = text[money_start:payments_end]
money_block = money_block.replace('<h3>Операции по датам</h3>', '<h3>История изменений</h3>', 1)
money_block = money_block.replace('Операции идут по дате, к которой относятся деньги. Если запись внесли позже, это показано внутри операции и не меняет её место в журнале.', 'Здесь хранится аудит исправлений, отмен и перенесённых записей. Для обычной работы используйте список операций выше.', 1)
money_wrapped = '''          <details className="finance-secondary-details">
            <summary>История исправлений и технический аудит</summary>
''' + money_block + '''          </details>
'''
text = text[:money_start] + money_wrapped + text[payments_end:]

renderer_path.write_text(text, encoding='utf-8')

# Advance focused regression to the human ledger contract.
test = test_path.read_text(encoding='utf-8')
needle = '''assert.ok(rendererSource.includes("payment_correction: 'Исправление способа оплаты'"), 'cash journal must not expose payment_correction')
console.log('FINANCE DAY FOCUSED GREEN — backend day audit preserved; human finance UI uses business-date periods without a special-day client')
'''
replacement = '''assert.ok(rendererSource.includes("payment_correction: 'Исправление способа оплаты'"), 'cash journal must not expose payment_correction')
assert.ok(rendererSource.includes('const humanOperations = ['), 'effective payments and returns must drive the human journal')
assert.ok(rendererSource.includes('История исправлений и технический аудит'), 'raw financial events must be secondary audit detail')
assert.ok(rendererSource.includes('Разбивка поступлений по видам и способам оплаты'), 'classification tables must be secondary detail')
assert.ok(!rendererSource.includes('Для истории конкретного дня используйте «Один день»'), 'removed single-day UX must not remain in cash copy')
assert.ok(rendererSource.indexOf('finance-days-truth-panel') < rendererSource.indexOf('finance-reconciliation-v2'), 'day chronology must appear before reconciliation diagnostics')
assert.ok(rendererSource.indexOf('finance-human-operations-block') < rendererSource.indexOf('finance-payment-classification'), 'human operations must appear before classifications')
console.log('FINANCE DAY FOCUSED GREEN — business-date human journal leads; corrections and audit stay secondary; cash remains a separate current-state workspace')
'''
if needle not in test:
    raise SystemExit('focused test anchor missing')
test_path.write_text(test.replace(needle, replacement, 1), encoding='utf-8')

# Keep exact frontend preservation honest.
def git_blob_sha(content: str) -> str:
    data = content.encode('utf-8')
    return hashlib.sha1(f'blob {len(data)}\0'.encode('utf-8') + data).hexdigest()

manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['files']['src/features/renderers/FinanceDashboardRenderer.tsx']['afterGitBlob'] = git_blob_sha(text)
manifest['files']['src/features/renderers/FinanceDashboardRenderer.tsx']['afterLines'] = len(text.splitlines())
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('FINANCE HUMAN LEDGER R2 PATCH APPLIED')
