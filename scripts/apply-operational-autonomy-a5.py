from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


def insert_before(path: str, anchor: str, block: str):
    replace_once(path, anchor, block + '\n\n' + anchor)


# Worker domain imports.
replace_once(
    'worker/domains/returns-exchanges.ts',
    "import { advanceCriticalOperation, beginCriticalOperation, completeCriticalOperation, criticalOperationEntityId, failCriticalOperation, insertCriticalMappedEntity, parseCriticalContext, refreshCriticalOperation, updateCriticalOperationTargetFromLastInsert } from './critical.ts'",
    "import { advanceCriticalOperation, beginCriticalOperation, completeCriticalOperation, CriticalOperationConflictError, criticalOperationEntityId, failCriticalOperation, insertCriticalMappedEntity, parseCriticalContext, refreshCriticalOperation, updateCriticalOperationTargetFromLastInsert } from './critical.ts'",
)
replace_once(
    'worker/domains/returns-exchanges.ts',
    "import { buildPaymentAndMoneyEventStatements, readOrderFinancialLedger, refundMoneyEventStatement, refundReversalMoneyEventStatement, removeSinglePaymentWithMoneyEvent, syncOrderFinancialLedger } from './money.ts'",
    "import { buildPaymentAndMoneyEventStatements, financialEventStatement, readOrderFinancialLedger, refundMoneyEventStatement, refundReversalMoneyEventStatement, removeSinglePaymentWithMoneyEvent, syncOrderFinancialLedger } from './money.ts'",
)

backend = r'''export async function correctExchangeFinancials(
  db: D1Database,
  exchangeId: number,
  input: {
    requestId?: string;
    exchangeDate?: string;
    financialAmount?: number;
    paymentMethod?: string;
    comment?: string;
    expectedExchangeDate?: string;
    expectedFinancialAmount?: number;
    expectedPaymentMethod?: string;
    expectedComment?: string;
  },
) {
  let criticalOperation: CriticalOperationHandle | null = null;
  try {
    if (!exchangeId) throw new Error('exchangeId is required.');
    const timestamp = new Date().toISOString();
    criticalOperation = await beginCriticalOperation(db, 'exchange_financial_correction', input.requestId, input, { exchangeId, createdAt: timestamp });
    if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse;

    const row = await db.prepare(
      `SELECT e.id, e.order_id, e.exchange_date, e.financial_action, e.financial_amount, e.payment_method,
              e.payment_id, e.refund_return_id, e.comment, e.status,
              o.external_id, o.order_status,
              p.id AS linked_payment_id, p.payment_date AS linked_payment_date, p.method AS linked_payment_method,
              p.amount AS linked_payment_amount, p.comment AS linked_payment_comment,
              r.id AS linked_return_id, r.return_date AS linked_return_date, r.payment_method AS linked_return_method,
              r.amount AS linked_return_amount, r.comment AS linked_return_comment, r.status AS linked_return_status
       FROM exchanges e
       JOIN orders o ON o.id = e.order_id
       LEFT JOIN payments p ON p.id = e.payment_id AND p.order_id = e.order_id
       LEFT JOIN returns r ON r.id = e.refund_return_id AND r.order_id = e.order_id
       WHERE e.id = ?`
    ).bind(exchangeId).first<any>();
    if (!row) throw new Error('Обмен не найден.');
    if (cleanText(row.status) === 'cancelled') throw new Error('Отменённый обмен нельзя исправлять.');
    if (normalizeOrderStatus(row.order_status) === 'deleted') throw new Error('Нельзя исправлять обмен удалённого заказа.');

    const financialAction = normalizeExchangeFinancialAction(row.financial_action);
    if (financialAction !== 'extra_payment' && financialAction !== 'refund') {
      throw new Error('У этого обмена нет денежной операции для исправления.');
    }

    const rawExchangeDate = cleanText(input.exchangeDate);
    if (!rawExchangeDate) throw new Error('Укажите дату денежной операции обмена.');
    const nextExchangeDate = normalizeDate(rawExchangeDate);
    const nextAmountRaw = Number(input.financialAmount);
    if (!Number.isInteger(nextAmountRaw) || nextAmountRaw <= 0) throw new Error('Укажите целую сумму больше нуля.');
    const nextAmount = Math.trunc(nextAmountRaw);
    const nextMethod = upperText(input.paymentMethod);
    if (!nextMethod) throw new Error(financialAction === 'refund' ? 'Выберите способ возврата денег.' : 'Выберите способ оплаты доплаты.');
    const nextComment = cleanText(input.comment);

    const oldExchangeDate = normalizeDate(row.exchange_date);
    const oldAmount = Math.max(0, toInt(row.financial_amount, 0));
    const oldMethod = upperText(row.payment_method);
    const oldComment = cleanText(row.comment);
    if (!oldAmount || !oldMethod) throw new Error('У обмена повреждены данные денежной операции. Отмена обмена остаётся безопасным вариантом.');

    const expectedProvided = ['expectedExchangeDate', 'expectedFinancialAmount', 'expectedPaymentMethod', 'expectedComment']
      .every((key) => Object.prototype.hasOwnProperty.call(input, key));
    if (!expectedProvided) {
      throw new CriticalOperationConflictError('Обновите историю обменов перед исправлением: не хватает исходного снимка операции.');
    }
    const expectedMatches = normalizeDate(input.expectedExchangeDate) === oldExchangeDate
      && Math.max(0, toInt(input.expectedFinancialAmount, 0)) === oldAmount
      && upperText(input.expectedPaymentMethod) === oldMethod
      && cleanText(input.expectedComment) === oldComment;

    const linkedId = financialAction === 'extra_payment' ? toInt(row.linked_payment_id, 0) : toInt(row.linked_return_id, 0);
    const linkedDate = normalizeDate(financialAction === 'extra_payment' ? row.linked_payment_date : row.linked_return_date);
    const linkedAmount = Math.max(0, toInt(financialAction === 'extra_payment' ? row.linked_payment_amount : row.linked_return_amount, 0));
    const linkedMethod = upperText(financialAction === 'extra_payment' ? row.linked_payment_method : row.linked_return_method);
    if (!linkedId) throw new Error(financialAction === 'extra_payment' ? 'Связанная доплата обмена не найдена.' : 'Связанный возврат обмена не найден.');
    if (financialAction === 'refund' && cleanText(row.linked_return_status) === 'cancelled') throw new Error('Связанный возврат этого обмена уже отменён.');
    if (linkedDate !== oldExchangeDate || linkedAmount !== oldAmount || linkedMethod !== oldMethod) {
      throw new CriticalOperationConflictError('Денежные данные обмена изменились отдельно. Обновите историю и повторите исправление.');
    }

    const alreadyDesired = oldExchangeDate === nextExchangeDate
      && oldAmount === nextAmount
      && oldMethod === nextMethod
      && oldComment === nextComment;
    if (!alreadyDesired && !expectedMatches) {
      throw new CriticalOperationConflictError('Обмен уже изменился после открытия формы. Обновите историю и повторите исправление.');
    }

    const orderId = toInt(row.order_id, 0);
    const externalOrderId = cleanText(row.external_id);
    if (alreadyDesired) {
      await syncOrderFinancialLedger(db, orderId);
      const order = await getOrder(db, orderId);
      const response = { ok: true, exchangeId, unchanged: true, order };
      await completeCriticalOperation(db, criticalOperation, response);
      return response;
    }

    await syncOrderFinancialLedger(db, orderId);
    const ledger = await readOrderFinancialLedger(db, orderId);
    let nextTotalAmount = ledger.totalAmount;
    if (financialAction === 'extra_payment') {
      nextTotalAmount = ledger.totalAmount - oldAmount + nextAmount;
    } else {
      const otherReturns = Math.max(0, ledger.returnAmount - oldAmount);
      const availableRefund = Math.max(0, ledger.receivedAmount - otherReturns);
      if (nextAmount > availableRefund) {
        throw new Error(`Сумма возврата ${nextAmount} больше доступной суммы ${availableRefund}.`);
      }
      nextTotalAmount = ledger.totalAmount + oldAmount - nextAmount;
    }
    if (!Number.isFinite(nextTotalAmount) || nextTotalAmount < 0) throw new Error('Исправление привело бы к отрицательной сумме заказа.');

    const cashSettings = await db.prepare(
      `SELECT auto_tracking_enabled FROM cash_register_settings WHERE id = 1`
    ).first<any>();
    const baseCashKey = financialAction === 'extra_payment' ? `payment:${linkedId}` : `return:${linkedId}`;
    const cashTrackedRow = await db.prepare(
      `SELECT id FROM cash_register_entries
       WHERE source_key = ?
          OR (source_type = 'exchange_financial_correction' AND source_id = ?)
       ORDER BY id DESC LIMIT 1`
    ).bind(baseCashKey, String(exchangeId)).first<any>();
    const cashTrackingEnabled = toInt(cashSettings?.auto_tracking_enabled, 0) === 1;
    const cashWasTracked = Boolean(cashTrackedRow?.id);
    const isCashMethod = (value: unknown) => {
      const method = upperText(value);
      return method === 'НАЛИЧКА' || method === 'НАЛИЧНЫЕ' || method === 'CASH' || method.includes('НАЛИЧ');
    };
    const oldCashTrackedAmount = isCashMethod(oldMethod) && cashWasTracked ? oldAmount : 0;
    const newCashTrackedAmount = isCashMethod(nextMethod) && (cashWasTracked || cashTrackingEnabled) ? nextAmount : 0;
    const sign = financialAction === 'extra_payment' ? 1 : -1;
    const cashDelta = (newCashTrackedAmount * sign) - (oldCashTrackedAmount * sign);

    const requestId = cleanText(criticalOperation.requestId);
    const eventSourceRef = `exchanges:${exchangeId}:financial-correction:${requestId}`;
    const auditComment = [
      `Исправление денег обмена #${exchangeId}`,
      `${oldExchangeDate} → ${nextExchangeDate}`,
      `${oldAmount} → ${nextAmount}`,
      `${oldMethod} → ${nextMethod}`,
      oldComment !== nextComment ? `Комментарий: «${oldComment || '—'}» → «${nextComment || '—'}»` : '',
    ].filter(Boolean).join(' · ');

    const statements: D1PreparedStatement[] = [];
    statements.push(financialEventStatement(db, {
      eventKey: `189c:exchange:${exchangeId}:financial-correction:${requestId}:old`,
      orderId,
      externalOrderId,
      eventDate: oldExchangeDate,
      eventAt: timestamp,
      eventType: financialAction === 'extra_payment' ? 'payment_reversal' : 'refund_reversal',
      relatedType: financialAction === 'extra_payment' ? 'exchange_extra' : 'exchange_refund',
      amountDelta: financialAction === 'extra_payment' ? -oldAmount : oldAmount,
      paymentMethod: oldMethod,
      sourceType: 'exchange',
      sourceId: exchangeId,
      sourceRef: eventSourceRef,
      reason: 'exchange_financial_correction',
      comment: auditComment,
    }));
    statements.push(financialEventStatement(db, {
      eventKey: `189c:exchange:${exchangeId}:financial-correction:${requestId}:new`,
      orderId,
      externalOrderId,
      eventDate: nextExchangeDate,
      eventAt: timestamp,
      eventType: financialAction === 'extra_payment' ? 'exchange_extra' : 'exchange_refund',
      amountDelta: financialAction === 'extra_payment' ? nextAmount : -nextAmount,
      paymentMethod: nextMethod,
      sourceType: 'exchange',
      sourceId: exchangeId,
      sourceRef: eventSourceRef,
      reason: 'exchange_financial_correction',
      comment: auditComment,
    }));

    if (financialAction === 'extra_payment') {
      statements.push(db.prepare(
        `UPDATE payments
         SET payment_date = ?, method = ?, amount = ?, comment = ?
         WHERE id = ? AND order_id = ?`
      ).bind(nextExchangeDate, nextMethod, nextAmount, nextComment || `Доплата по обмену #${exchangeId}`, linkedId, orderId));
    } else {
      statements.push(db.prepare(
        `UPDATE returns
         SET return_date = ?, amount = ?, payment_method = ?, comment = ?
         WHERE id = ? AND order_id = ? AND COALESCE(status, 'completed') <> 'cancelled'`
      ).bind(nextExchangeDate, nextAmount, nextMethod, nextComment || `Возврат денег по обмену #${exchangeId}`, linkedId, orderId));
      statements.push(db.prepare(`UPDATE return_items SET amount = ? WHERE return_id = ?`).bind(nextAmount, linkedId));
    }

    statements.push(db.prepare(
      `UPDATE exchanges
       SET exchange_date = ?, financial_amount = ?, payment_method = ?, comment = ?
       WHERE id = ? AND COALESCE(status, 'completed') <> 'cancelled'`
    ).bind(nextExchangeDate, nextAmount, nextMethod, nextComment || null, exchangeId));
    statements.push(db.prepare(`UPDATE orders SET total_amount = ?, updated_at = ? WHERE id = ?`).bind(nextTotalAmount, timestamp, orderId));

    if (cashDelta) {
      const cashDirection = cashDelta > 0 ? 'in' : 'out';
      statements.push(db.prepare(
        `INSERT OR IGNORE INTO cash_register_entries (
           occurred_at, business_date, direction, amount, entry_type,
           source_type, source_id, source_key, order_id, external_order_id,
           payment_method, comment, created_by, created_at
         ) VALUES (?, date('now', '+5 hours'), ?, ?, 'exchange_financial_correction',
                   'exchange_financial_correction', ?, ?, ?, ?, ?, ?, 'Автоучёт', ?)`
      ).bind(
        timestamp, cashDirection, Math.abs(cashDelta), String(exchangeId),
        `exchange-financial-correction:${requestId}:cash-delta`, orderId, externalOrderId,
        nextMethod, auditComment, timestamp,
      ));
    }

    await db.batch(statements);
    await syncOrderFinancialLedger(db, orderId);
    const order = await getOrder(db, orderId);
    try {
      await writeActivityLog(db, {
        eventType: 'exchange_financial_corrected',
        entityType: 'exchange',
        entityId: exchangeId,
        orderId,
        externalOrderId,
        title: `Исправлена денежная часть обмена #${exchangeId}`,
        details: auditComment,
        amount: nextAmount,
        createdAt: timestamp,
      });
    } catch (error) {
      console.warn('Exchange financial correction activity log failed after committed correction', error);
    }
    const response = { ok: true, exchangeId, financialAction, financialAmount: nextAmount, exchangeDate: nextExchangeDate, paymentMethod: nextMethod, order };
    await completeCriticalOperation(db, criticalOperation, response);
    return response;
  } catch (error) {
    if (criticalOperation) await failCriticalOperation(db, criticalOperation, error);
    throw error;
  }
}'''
insert_before('worker/domains/returns-exchanges.ts', 'export async function listExchanges(', backend)

# Router.
replace_once(
    'worker/index.ts',
    "import { cancelExchange, cancelReturn, createExchange, createReturn, listExchanges } from './domains/returns-exchanges.ts'",
    "import { cancelExchange, cancelReturn, correctExchangeFinancials, createExchange, createReturn, listExchanges } from './domains/returns-exchanges.ts'",
)
route = r'''      const exchangeFinancialCorrectionMatch = url.pathname.match(/^\/api\/exchanges\/(\d+)\/financials$/);
      if (exchangeFinancialCorrectionMatch && request.method === 'PATCH') {
        const input = await readJson<{
          requestId?: string;
          exchangeDate?: string;
          financialAmount?: number;
          paymentMethod?: string;
          comment?: string;
          expectedExchangeDate?: string;
          expectedFinancialAmount?: number;
          expectedPaymentMethod?: string;
          expectedComment?: string;
        }>(request);
        input.requestId = cleanText(input.requestId) || cleanText(request.headers.get('X-Idempotency-Key')) || undefined;
        try {
          return json(await correctExchangeFinancials(env.DB, Number(exchangeFinancialCorrectionMatch[1]), input));
        } catch (error) {
          const criticalResponse = criticalOperationErrorResponse(error);
          if (criticalResponse) return criticalResponse;
          throw error;
        }
      }
'''
insert_before('worker/index.ts', "      const exchangeCancelMatch = url.pathname.match(/^\\/api\\/exchanges\\/(\\d+)\\/cancel$/);", route.rstrip())

# App handler.
app_handler = r'''  async function correctExchangeFinancialEntry(
    entry: ExchangeHistoryEntry,
    draft: { exchangeDate: string; financialAmount: number; paymentMethod: string; comment: string },
  ) {
    const amount = Math.trunc(Number(draft.financialAmount || 0))
    if (entry.status === 'cancelled' || (entry.financialAction !== 'extra_payment' && entry.financialAction !== 'refund')) return false
    if (!draft.exchangeDate) {
      setError('Укажите дату денежной операции обмена.')
      return false
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      setError('Укажите целую сумму больше нуля.')
      return false
    }
    if (!draft.paymentMethod.trim()) {
      setError(entry.financialAction === 'refund' ? 'Выберите способ возврата денег.' : 'Выберите способ оплаты доплаты.')
      return false
    }

    setExchangeBusy(true)
    setError(null)
    setMessage(null)
    try {
      const payload = {
        exchangeDate: draft.exchangeDate,
        financialAmount: amount,
        paymentMethod: draft.paymentMethod,
        comment: draft.comment,
        expectedExchangeDate: entry.exchangeDate,
        expectedFinancialAmount: entry.financialAmount,
        expectedPaymentMethod: entry.paymentMethod || '',
        expectedComment: entry.comment || '',
      }
      const criticalKey = `exchange-financial-correct:${entry.id}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch(`/api/exchanges/${entry.id}/financials`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })
      const result = await readJsonResponse<{ ok?: boolean; message?: string; order?: OrderRecord; unchanged?: boolean }>(response, 'Исправление денег обмена')
      if (!response.ok) throw new Error(result.message || `Exchange correction failed: ${response.status}`)
      completeCriticalRequest(criticalKey, critical.requestId)
      if (result.order) upsertOrderInState(result.order)
      invalidateFinanceReadCaches()
      await Promise.allSettled([
        loadExchangeHistory(),
        refreshActivityLogIfVisible(),
        refreshFinanceReportsIfVisible(),
        loadDashboard(false),
        cashRegister?.initialized ? loadCashRegister() : Promise.resolve(null),
      ])
      setMessage(result.unchanged
        ? `Денежная часть обмена #${entry.id} уже соответствует этим данным.`
        : `Денежная часть обмена #${entry.id} исправлена. Товары, остатки и цех не менялись.`)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка исправления денег обмена')
      return false
    } finally {
      setExchangeBusy(false)
    }
  }
'''
insert_before('src/App.tsx', '  async function cancelExchangeEntry(entry: ExchangeHistoryEntry) {', app_handler.rstrip())
replace_once(
    'src/App.tsx',
    'applyExchangeProductPick, cancelExchangeEntry, closeExchangeForm,',
    'applyExchangeProductPick, cancelExchangeEntry, closeExchangeForm, correctExchangeFinancialEntry,',
)

# Exchange section local correction UI.
replace_once(
    'src/features/sections/OrderExchangeSection.tsx',
    "import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'",
    "import { useState } from 'react'\nimport { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'",
)
replace_once(
    'src/features/sections/OrderExchangeSection.tsx',
    '    closeExchangeForm,\n    createExchangeDraft,',
    '    closeExchangeForm,\n    correctExchangeFinancialEntry,\n    createExchangeDraft,',
)
replace_once(
    'src/features/sections/OrderExchangeSection.tsx',
    '  } = ctx\n\n  const formatHistoryCharacteristics',
    "  } = ctx\n\n  const [financialCorrection, setFinancialCorrection] = useState<any>(null)\n\n  const openFinancialCorrection = (entry: any) => {\n    setFinancialCorrection({\n      exchangeId: entry.id,\n      exchangeDate: entry.exchangeDate || '',\n      financialAmount: Number(entry.financialAmount || 0),\n      paymentMethod: entry.paymentMethod || '',\n      comment: entry.comment || '',\n    })\n  }\n\n  const formatHistoryCharacteristics",
)

# Put method in visible finance details.
replace_once(
    'src/features/sections/OrderExchangeSection.tsx',
    "<div><span>Финансы</span><strong>{entry.financialAction === 'extra_payment' ? `Доплата ${formatMoney(entry.financialAmount)}` : entry.financialAction === 'refund' ? `Возврат ${formatMoney(entry.financialAmount)}` : 'Без доплаты'}</strong></div>",
    "<div><span>Финансы</span><strong>{entry.financialAction === 'extra_payment' ? `Доплата ${formatMoney(entry.financialAmount)}` : entry.financialAction === 'refund' ? `Возврат ${formatMoney(entry.financialAmount)}` : 'Без доплаты'}</strong></div>\n                              {entry.financialAction !== 'none' ? <div><span>Способ</span><strong>{entry.paymentMethod || '—'}</strong></div> : null}",
)

correction_panel = r'''                          {detailsOpen && financialCorrection?.exchangeId === entry.id ? (
                            <div className="mini-panel" style={{ marginTop: 12 }}>
                              <div className="mini-panel-head">
                                <div>
                                  <h4>Исправить денежную часть</h4>
                                  <p className="mini-panel-note">Меняются только дата, сумма, способ и комментарий. Товары, остатки и Цех не затрагиваются. Тип операции ({entry.financialAction === 'refund' ? 'возврат' : 'доплата'}) здесь не меняется.</p>
                                </div>
                              </div>
                              <div className="form-grid compact-form-grid">
                                <label><span>Дата</span><input type="date" value={financialCorrection.exchangeDate} onChange={(event) => setFinancialCorrection((current: any) => ({ ...current, exchangeDate: event.target.value }))} /></label>
                                <label><span>Сумма</span><FriendlyNumberInput min={1} value={financialCorrection.financialAmount} onChange={(value: number) => setFinancialCorrection((current: any) => ({ ...current, financialAmount: value }))} /></label>
                                <label><span>{entry.financialAction === 'refund' ? 'Способ возврата' : 'Способ оплаты'}</span><SmartPickerInput value={financialCorrection.paymentMethod} options={suggestionValues.paymentMethods} onChange={(value: string) => setFinancialCorrection((current: any) => ({ ...current, paymentMethod: value }))} /></label>
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
    "                          {detailsOpen && entry.status !== 'cancelled' ? (\n                            <button className=\"danger compact\" type=\"button\" disabled={exchangeBusy} onClick={() => void cancelExchangeEntry(entry)}>Отменить обмен</button>\n                          ) : null}",
    "                          {detailsOpen && entry.status !== 'cancelled' && entry.financialAction !== 'none' ? (\n                            <button className=\"secondary compact\" type=\"button\" disabled={exchangeBusy} onClick={() => openFinancialCorrection(entry)}>Исправить деньги</button>\n                          ) : null}\n" + correction_panel + "\n                          {detailsOpen && entry.status !== 'cancelled' ? (\n                            <button className=\"danger compact\" type=\"button\" disabled={exchangeBusy} onClick={() => void cancelExchangeEntry(entry)}>Отменить обмен</button>\n                          ) : null}",
)

# Focused semantic regression test.
test = r'''import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const worker = read('worker/domains/returns-exchanges.ts')
const router = read('worker/index.ts')
const app = read('src/App.tsx')
const ui = read('src/features/sections/OrderExchangeSection.tsx')

const check = (condition, message) => { if (!condition) throw new Error(message) }
const fnStart = worker.indexOf('export async function correctExchangeFinancials(')
const fnEnd = worker.indexOf('export async function listExchanges(', fnStart)
check(fnStart >= 0 && fnEnd > fnStart, 'A5 correction function missing')
const fn = worker.slice(fnStart, fnEnd)

check(fn.includes("beginCriticalOperation(db, 'exchange_financial_correction'"), 'A5 correction must be idempotent')
check(fn.includes('CriticalOperationConflictError'), 'A5 correction must stale-check the opened exchange snapshot')
check(fn.includes("financialAction !== 'extra_payment' && financialAction !== 'refund'"), 'A5 must keep exchange financial action immutable')
check(fn.includes('UPDATE payments') && fn.includes('UPDATE returns') && fn.includes('UPDATE return_items SET amount'), 'A5 must keep linked payment/refund rows consistent')
check(fn.includes('UPDATE exchanges') && fn.includes('UPDATE orders SET total_amount'), 'A5 must update exchange and order financial totals together')
check(fn.includes("eventType: financialAction === 'extra_payment' ? 'payment_reversal' : 'refund_reversal'"), 'A5 must append immutable reversal history')
check(fn.includes("eventType: financialAction === 'extra_payment' ? 'exchange_extra' : 'exchange_refund'"), 'A5 must append corrected financial history')
check(fn.includes("entry_type") && fn.includes("exchange_financial_correction") && fn.includes('cashDelta'), 'A5 must reconcile the cash-register delta')
check(!fn.includes('inventory_stock') && !fn.includes('inventory_lifecycle_events') && !fn.includes('workshop_tasks'), 'A5 finance correction must not mutate physical exchange state')
check(router.includes('/financials') && router.includes('correctExchangeFinancials'), 'A5 PATCH route missing')
check(app.includes('correctExchangeFinancialEntry') && app.includes('expectedFinancialAmount') && app.includes('expectedPaymentMethod'), 'A5 browser stale snapshot payload missing')
check(ui.includes('Исправить деньги') && ui.includes('Товары, остатки и Цех не затрагиваются'), 'A5 dedicated correction UI missing')
check(ui.includes("entry.financialAction !== 'none'"), 'A5 correction control must not appear for no-money exchanges')

console.log('OPERATIONAL AUTONOMY A5 TESTS PASSED — exchange-linked money can be corrected in place with stale protection, immutable finance history and cash delta, without touching physical exchange state')
'''
Path('scripts/test-operational-autonomy-a5-exchange-financial-correction.mjs').write_text(test)

# Cumulative gate.
replace_once(
    'package.json',
    ' && node scripts/test-operational-autonomy-a4-handover-correction.mjs"',
    ' && node scripts/test-operational-autonomy-a4-handover-correction.mjs && node scripts/test-operational-autonomy-a5-exchange-financial-correction.mjs"',
)

# Continuation audit update.
replace_once(
    'docs/continuation/OPERATIONAL_AUTONOMY_AUDIT_20260910.md',
    '### A5 — Exchange-linked payment correction is cumbersome\n\nThe order editor intentionally permits only payment-method correction for an exchange-linked extra.',
    '### A5 — Exchange-linked payment correction is cumbersome\n\n> A5 update: implemented on the current A5 branch as a dedicated audited correction of the existing exchange financial fact. Date, amount, payment method and comment can be corrected without changing exchanged items, stock/lifecycle or Workshop. The financial action itself (extra payment vs refund) remains immutable; changing that business meaning still requires exchange cancellation. Financial history is append-only and cash-register delta is reconciled.\n\nThe order editor intentionally permits only payment-method correction for an exchange-linked extra.',
)

print('A5 product patch applied')
