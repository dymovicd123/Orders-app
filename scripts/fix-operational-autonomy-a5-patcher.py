from pathlib import Path

p = Path('scripts/apply-operational-autonomy-a5.py')
text = p.read_text()
start = text.index('# Put method in visible finance details.')
end = text.index('# Focused semantic regression test.')
replacement = r'''# Put method in visible finance details.
replace_once(
    'src/features/sections/OrderExchangeSection.tsx',
    "<div><span>Деньги</span><strong>{entry.financialAction === 'extra_payment' ? `Доплата ${formatMoney(entry.financialAmount)}` : entry.financialAction === 'refund' ? `Возврат ${formatMoney(entry.financialAmount)}` : 'Без доплаты / возврата'}</strong></div>",
    "<div><span>Деньги</span><strong>{entry.financialAction === 'extra_payment' ? `Доплата ${formatMoney(entry.financialAmount)}` : entry.financialAction === 'refund' ? `Возврат ${formatMoney(entry.financialAmount)}` : 'Без доплаты / возврата'}</strong></div>\n                            {entry.financialAction !== 'none' ? <div><span>Способ</span><strong>{entry.paymentMethod || '—'}</strong></div> : null}",
)

correction_panel = r'''                          {financialCorrection?.exchangeId === entry.id ? (
                            <div className="mini-panel" style={{ marginTop: 12 }}>
                              <div className="mini-panel-head">
                                <div>
                                  <h4>Исправить денежную часть</h4>
                                  <p className="mini-panel-note">Меняются только дата, сумма, способ и комментарий. Товары, остатки и Цех не затрагиваются. Тип операции ({entry.financialAction === 'refund' ? 'возврат' : 'доплата'}) здесь не меняется.</p>
                                </div>
                              </div>
                              <div className="form-grid compact-form-grid">
                                <label><span>Дата</span><input type="date" value={financialCorrection.exchangeDate} onChange={(event) => setFinancialCorrection((current: any) => ({ ...current, exchangeDate: event.target.value }))} /></label>
                                <label><span>Сумма</span><FriendlyNumberInput type="number" min="1" value={financialCorrection.financialAmount} onChange={(event) => setFinancialCorrection((current: any) => ({ ...current, financialAmount: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                                <label><span>{entry.financialAction === 'refund' ? 'Способ возврата' : 'Способ оплаты'}</span><SmartPickerInput value={financialCorrection.paymentMethod} options={suggestionValues.paymentMethods} placeholder={entry.financialAction === 'refund' ? 'Например, НАЛИЧКА' : 'Например, KASPI'} onChange={(value: string) => setFinancialCorrection((current: any) => ({ ...current, paymentMethod: value }))} /></label>
                                <label className="wide"><span>Комментарий</span><input value={financialCorrection.comment} onChange={(event) => setFinancialCorrection((current: any) => ({ ...current, comment: event.target.value }))} /></label>
                              </div>
                              <div className="row-actions">
                                <button className="primary compact" type="button" disabled={exchangeBusy} onClick={async () => { if (await correctExchangeFinancialEntry(entry, financialCorrection)) setFinancialCorrection(null) }}>{exchangeBusy ? 'Сохраняю…' : 'Сохранить исправление'}</button>
                                <button className="secondary compact" type="button" disabled={exchangeBusy} onClick={() => setFinancialCorrection(null)}>Отмена</button>
                              </div>
                            </div>
                          ) : null}'''
replace_once(
    'src/features/sections/OrderExchangeSection.tsx',
    "                          <div className=\"history-card-actions\">{entry.status !== 'cancelled' ? <button className=\"ghost danger compact\" type=\"button\" onClick={() => void cancelExchangeEntry(entry)} disabled={exchangeBusy}>Отменить обмен</button> : null}</div>",
    correction_panel + "\n                          <div className=\"history-card-actions\">{entry.status !== 'cancelled' && entry.financialAction !== 'none' ? <button className=\"secondary compact\" type=\"button\" onClick={() => openFinancialCorrection(entry)} disabled={exchangeBusy}>Исправить деньги</button> : null}{entry.status !== 'cancelled' ? <button className=\"ghost danger compact\" type=\"button\" onClick={() => void cancelExchangeEntry(entry)} disabled={exchangeBusy}>Отменить обмен</button> : null}</div>",
)

'''
text = text[:start] + replacement + text[end:]
p.write_text(text)
print('A5 patcher anchors fixed')
