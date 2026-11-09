import { cleanText, normalizeDate, normalizeExchangeFinancialAction, normalizeOrderStatus, toInt, upperText } from '../core/text.ts'
import { writeActivityLog } from './activity.ts'
import type { CriticalOperationHandle } from './critical.ts'
import { beginCriticalOperation, completeCriticalOperation, CriticalOperationConflictError, failCriticalOperation } from './critical.ts'
import { financialEventStatement, readOrderFinancialLedger, syncOrderFinancialLedger } from './money.ts'
import { getOrder } from './orders-write.ts'
import { exchangeSetPaymentIds } from './return-exchange-payment-channels.ts'

export async function correctExchangeFinancials(
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
              o.external_id, o.order_status, o.pricing_mode,
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

    // This editor rewrites one linked payment/return. A multi-channel operation
    // must not be flattened into one method or partially corrected.
    const splitPaymentIds = await exchangeSetPaymentIds(db, exchangeId);
    const refundEvents = financialAction === 'refund'
      ? await db.prepare("SELECT COUNT(*) AS count FROM financial_events WHERE source_type='exchange' AND source_id=? AND event_type='exchange_refund' AND event_key LIKE '1901:%:exchange-set-refund%'").bind(exchangeId).first<{count:number}>()
      : null;
    if (splitPaymentIds.length > 1 || toInt(refundEvents?.count, 0) > 1) {
      throw new CriticalOperationConflictError('У обмена несколько способов расчёта. Изменение одной общей суммой не допускается: используйте отмену обмена и создайте его заново.');
    }

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
      const completedResponse = { ok: true, exchangeId, unchanged: true, refreshRequired: true };
      await completeCriticalOperation(db, criticalOperation, completedResponse);
      let order = null;
      try {
        order = await getOrder(db, orderId);
      } catch (error) {
        console.warn('Order readback after unchanged exchange financial correction failed', error);
      }
      return order ? { ...completedResponse, order, refreshRequired: false } : completedResponse;
    }

    await syncOrderFinancialLedger(db, orderId);
    const ledger = await readOrderFinancialLedger(db, orderId);
    const isItemizedExchange = cleanText(row.pricing_mode) === 'itemized_v1';
    let nextTotalAmount = ledger.totalAmount;
    let projectedReceivedAmount = ledger.receivedAmount;
    let projectedReturnAmount = ledger.returnAmount;
    if (financialAction === 'extra_payment') {
      projectedReceivedAmount = Math.max(0, ledger.receivedAmount - oldAmount + nextAmount);
      if (!isItemizedExchange) {
        nextTotalAmount = ledger.totalAmount - oldAmount + nextAmount;
      }
    } else {
      const otherReturns = Math.max(0, ledger.returnAmount - oldAmount);
      const availableRefund = Math.max(0, ledger.receivedAmount - otherReturns);
      if (nextAmount > availableRefund) {
        throw new Error(`Сумма возврата ${nextAmount} больше доступной суммы ${availableRefund}.`);
      }
      projectedReturnAmount = otherReturns + nextAmount;
      if (!isItemizedExchange) {
        nextTotalAmount = ledger.totalAmount + oldAmount - nextAmount;
      }
    }
    if (!Number.isSafeInteger(nextTotalAmount) || nextTotalAmount < 0) throw new Error('Исправление привело бы к некорректной сумме заказа.');
    if (isItemizedExchange) {
      const projectedNetPaid = Math.max(0, projectedReceivedAmount - projectedReturnAmount);
      if (!Number.isSafeInteger(projectedNetPaid) || projectedNetPaid > nextTotalAmount) {
        throw new CriticalOperationConflictError(
          `После исправления денежной части обмена у itemized-заказа останется необъяснённая переплата ${Math.max(0, projectedNetPaid - nextTotalAmount)}. Увеличьте возврат или уменьшите доплату.`
        );
      }
    }

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
    if (!isItemizedExchange) {
      statements.push(db.prepare(`UPDATE orders SET total_amount = ?, updated_at = ? WHERE id = ?`).bind(nextTotalAmount, timestamp, orderId));
    }

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
    const completedResponse = {
      ok: true,
      exchangeId,
      financialAction,
      financialAmount: nextAmount,
      exchangeDate: nextExchangeDate,
      paymentMethod: nextMethod,
      refreshRequired: true,
    };
    // All business writes are committed at this point. Complete the idempotent operation
    // before secondary readback/logging so a transient read failure cannot report a
    // successful money correction as failed and invite a misleading retry.
    await completeCriticalOperation(db, criticalOperation, completedResponse);
    let order = null;
    try {
      order = await getOrder(db, orderId);
    } catch (error) {
      console.warn('Order readback after committed exchange financial correction failed', error);
    }
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
    return order ? { ...completedResponse, order, refreshRequired: false } : completedResponse;
  } catch (error) {
    if (criticalOperation) await failCriticalOperation(db, criticalOperation, error);
    throw error;
  }
}
