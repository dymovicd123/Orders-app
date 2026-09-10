from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match, got {count}')
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    i = text.find(start)
    if i < 0:
        raise SystemExit(f'{label}: start not found')
    j = text.find(end, i)
    if j < 0:
        raise SystemExit(f'{label}: end not found')
    return text[:i] + replacement + text[j:]


# Frontend controller.
p = Path('src/App.tsx')
text = p.read_text(encoding='utf-8')
text = replace_between(
    text,
    '  function updateEditorPayment(index: number, field: keyof EditorPayment, value: string | number) {',
    "  function addEditorPayment(paymentKind: 'primary' | 'debt_close') {",
    '''  function updateEditorPayment(index: number, field: keyof EditorPayment, value: string | number) {
    setEditorDraft((current) => {
      if (!current) return current
      const nextPayments = current.payments.map((payment, paymentIndex) => {
        if (paymentIndex !== index) return payment
        if (payment.id && payment.paymentKind === 'extra' && field !== 'method') return payment
        if (!payment.id && field === 'paymentDate' && payment.paymentKind === 'primary') return payment
        if (field === 'paymentKind') {
          const nextKind: EditorPayment['paymentKind'] = value === 'debt_close' ? 'debt_close' : 'primary'
          return {
            ...payment,
            paymentKind: nextKind,
            paymentDate: !payment.id && nextKind === 'primary'
              ? (current.orderDate || payment.paymentDate)
              : (payment.paymentDate || formatLocalDateInput()),
          }
        }
        return { ...payment, [field]: value }
      })
      return { ...current, payments: nextPayments }
    })
  }

''',
    'App updateEditorPayment',
)
text = replace_once(
    text,
    '''      const payload = {
        orderDate: nextDraft.orderDate,''',
    '''      const paymentCorrections: Array<{
        paymentId: number
        paymentDate: string
        method: string
        amount: number
        paymentKind: string
        comment: string
        expectedPaymentDate: string
        expectedMethod: string
        expectedAmount: number
        expectedPaymentKind: string
        expectedComment: string
      }> = []
      for (const payment of nextDraft.payments) {
        const paymentId = Number(payment.id || 0)
        if (!paymentId) continue
        const original = order.payments.find((entry) => Number(entry.id || 0) === paymentId)
        if (!original) throw new Error('Одна из оплат уже изменилась. Обновите заказ и повторите исправление.')
        const nextPaymentDate = String(payment.paymentDate || '').trim()
        const nextMethod = String(payment.method || '').trim()
        const nextAmount = Number(payment.amount || 0)
        const nextPaymentKind = String(payment.paymentKind || 'primary').trim()
        const nextComment = String(payment.comment || '').trim()
        const oldPaymentDate = String(original.paymentDate || '').trim()
        const oldMethod = String(original.method || '').trim()
        const oldAmount = Number(original.amount || 0)
        const oldPaymentKind = String(original.paymentKind || 'primary').trim()
        const oldComment = String(original.comment || '').trim()
        const changed = nextPaymentDate !== oldPaymentDate
          || nextMethod.toUpperCase() !== oldMethod.toUpperCase()
          || nextAmount !== oldAmount
          || nextPaymentKind !== oldPaymentKind
          || nextComment !== oldComment
        if (!changed) continue
        paymentCorrections.push({
          paymentId,
          paymentDate: nextPaymentDate,
          method: nextMethod,
          amount: nextAmount,
          paymentKind: nextPaymentKind,
          comment: nextComment,
          expectedPaymentDate: oldPaymentDate,
          expectedMethod: oldMethod,
          expectedAmount: oldAmount,
          expectedPaymentKind: oldPaymentKind,
          expectedComment: oldComment,
        })
      }

      const payload = {
        orderDate: nextDraft.orderDate,''',
    'App correction payload builder',
)
text = replace_once(
    text,
    '''        paymentMethodCorrections: nextDraft.payments
          .filter((payment) => Boolean(payment.id))
          .map((payment) => ({ paymentId: Number(payment.id), method: payment.method })),''',
    '        paymentCorrections,',
    'App correction payload',
)
p.write_text(text, encoding='utf-8')


# Editor UI.
p = Path('src/features/sections/OrderEditorSection.tsx')
text = p.read_text(encoding='utf-8')
text = replace_once(
    text,
    'Если первичную оплату забыли внести, добавьте её явно — она всегда относится к дате заказа. Любая обычная оплата позже создания заказа оформляется как «Закрытие долга» и проходит через тот же серверный механизм, что и отдельная кнопка закрытия долга. У уже проведённой оплаты можно исправить способ оплаты; сумма, дата и смысл операции останутся прежними, а исправление сохранится в денежной истории.',
    'Если первичную оплату забыли внести, добавьте её явно — при создании она относится к дате заказа. У уже проведённой обычной оплаты можно безопасно исправить дату, сумму, способ, смысл и комментарий: ID оплаты не меняется, а корректировка остаётся в денежной истории. Доплата, связанная с обменом, исправляется через операцию обмена; здесь для неё доступен только способ оплаты.',
    'editor intro note',
)
text = replace_once(text, "disabled={Boolean(payment.id) || savingOrder || payment.paymentKind === 'primary'}", "disabled={savingOrder || (!payment.id && payment.paymentKind === 'primary') || Boolean(payment.id && payment.paymentKind === 'extra')}", 'payment date lock')
text = replace_once(text, "disabled={Boolean(payment.id) || savingOrder}\n                                  onChange={(event) => updateEditorPayment(index, 'paymentKind', event.target.value)}", "disabled={savingOrder || Boolean(payment.id && payment.paymentKind === 'extra')}\n                                  onChange={(event) => updateEditorPayment(index, 'paymentKind', event.target.value)}", 'payment kind lock')
text = replace_once(text, "disabled={Boolean(payment.id) || savingOrder}\n                                  onChange={(event) => updateEditorPayment(index, 'amount', Number(event.target.value))}", "disabled={savingOrder || Boolean(payment.id && payment.paymentKind === 'extra')}\n                                  onChange={(event) => updateEditorPayment(index, 'amount', Number(event.target.value))}", 'payment amount lock')
text = replace_once(text, "disabled={Boolean(payment.id) || savingOrder}\n                                  onChange={(event) => updateEditorPayment(index, 'comment', event.target.value)}", "disabled={savingOrder || Boolean(payment.id && payment.paymentKind === 'extra')}\n                                  onChange={(event) => updateEditorPayment(index, 'comment', event.target.value)}", 'payment comment lock')
text = replace_once(
    text,
    '''                            {payment.id ? (
                              <p className="mini-panel-note">Оплата уже проведена. Здесь можно исправить только способ оплаты; сумма, дата и тип операции не меняются.</p>
                            ) : (''',
    '''                            {payment.id ? (
                              <p className="mini-panel-note">
                                {payment.paymentKind === 'extra'
                                  ? 'Эта доплата связана с обменом. Здесь можно исправить только способ оплаты; сумму, дату и смысл меняйте через операцию обмена.'
                                  : 'Оплата уже проведена. Дату, сумму, способ, смысл и комментарий можно исправить; ID оплаты сохранится, а изменение будет отражено в денежной истории.'}
                              </p>
                            ) : (''',
    'posted payment note',
)
p.write_text(text, encoding='utf-8')


# Typed request contract.
p = Path('worker/core/types.ts')
text = p.read_text(encoding='utf-8')
text = replace_once(
    text,
    '''  payments?: Array<{
    paymentDate?: string;
    method?: string;
    amount?: number;
    paymentKind?: 'primary' | 'debt_close' | 'extra';
    comment?: string;
  }>;
};''',
    '''  payments?: Array<{
    paymentDate?: string;
    method?: string;
    amount?: number;
    paymentKind?: 'primary' | 'debt_close' | 'extra';
    comment?: string;
  }>;
  paymentCorrections?: Array<{
    paymentId?: number;
    paymentDate?: string;
    method?: string;
    amount?: number;
    paymentKind?: 'primary' | 'debt_close' | 'extra' | string;
    comment?: string;
    expectedPaymentDate?: string;
    expectedMethod?: string;
    expectedAmount?: number;
    expectedPaymentKind?: 'primary' | 'debt_close' | 'extra' | string;
    expectedComment?: string;
  }>;
  paymentMethodCorrections?: Array<{ paymentId?: number; method?: string }>;
};''',
    'OrderInput payment correction type',
)
p.write_text(text, encoding='utf-8')


# Backend correction plan.
p = Path('worker/domains/orders-write.ts')
text = p.read_text(encoding='utf-8')
text = replace_between(
    text,
    '      const rawPaymentMethodCorrections = Array.isArray((input as any).paymentMethodCorrections)',
    '      const rewriteItems = Boolean(requestedItems && !sameNormalizedOrderItemsForEdit(existingItemsForEdit, requestedItems));',
    '''      const rawPaymentCorrections = Array.isArray(input.paymentCorrections)
        ? input.paymentCorrections
        : (Array.isArray(input.paymentMethodCorrections)
          ? input.paymentMethodCorrections.map((correction) => ({ paymentId: correction.paymentId, method: correction.method }))
          : []);
      const requestedPaymentCorrections = new Map<number, (typeof rawPaymentCorrections)[number]>();
      for (const correction of rawPaymentCorrections) {
        const paymentId = toInt(correction?.paymentId, 0);
        if (!paymentId) throw new OrderInputValidationError('Не удалось определить оплату для исправления. Обновите заказ и повторите.');
        requestedPaymentCorrections.set(paymentId, correction);
      }
      const paymentCorrections: Array<Record<string, any>> = [];
      const isCashPaymentMethod = (value: unknown) => {
        const method = upperText(value);
        return method === 'CASH' || method.includes('НАЛИЧ');
      };
      const validPaymentDate = (value: string) => {
        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      };
      for (const [paymentId, requested] of requestedPaymentCorrections) {
        const payment = await db.prepare(
          `SELECT p.id, p.payment_date, p.method, p.amount, COALESCE(p.payment_kind, 'primary') AS payment_kind,
                  p.comment, o.created_at AS order_created_at,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM exchanges e
                    WHERE e.payment_id = p.id AND e.financial_action = 'extra_payment'
                      AND COALESCE(e.status, 'completed') <> 'cancelled'
                  ) THEN 1 ELSE 0 END AS is_exchange_extra,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM cash_register_entries c
                    WHERE c.source_key = 'payment:' || p.id
                       OR (CAST(c.source_id AS TEXT) = CAST(p.id AS TEXT)
                           AND c.source_type IN ('payment_method_correction', 'payment_correction'))
                  ) THEN 1 ELSE 0 END AS cash_entry_tracked,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM cash_register_settings s
                    WHERE s.id = 1 AND s.auto_tracking_enabled = 1
                      AND (
                        COALESCE(p.payment_kind, 'primary') IN ('debt_close', 'extra')
                        OR COALESCE(o.created_at, '') >= COALESCE(s.activated_at, '')
                      )
                  ) THEN 1 ELSE 0 END AS cash_tracking_eligible
           FROM payments p
           JOIN orders o ON o.id = p.order_id
           WHERE p.id = ? AND p.order_id = ?
           LIMIT 1`
        ).bind(paymentId, id).first<Record<string, unknown>>();
        if (!payment?.id) throw new CriticalOperationConflictError('Одна из оплат заказа уже изменилась или исчезла. Обновите заказ и повторите исправление.');

        const oldPaymentDate = normalizeDate(payment.payment_date || nextOrderDate);
        const oldMethod = upperText(payment.method);
        const oldAmount = Math.max(0, toInt(payment.amount, 0));
        const oldPaymentKind = cleanText(payment.payment_kind) || 'primary';
        const oldComment = cleanText(payment.comment);
        const requestedDateText = requested.paymentDate === undefined ? oldPaymentDate : cleanText(requested.paymentDate);
        if (!validPaymentDate(requestedDateText)) throw new OrderInputValidationError('Укажите корректную фактическую дату оплаты.');
        const newPaymentDate = requestedDateText;
        const newMethod = requested.method === undefined ? oldMethod : upperText(requested.method);
        if (!newMethod) throw new OrderInputValidationError('Способ оплаты не может быть пустым.');
        const newAmountRaw = requested.amount === undefined ? oldAmount : Number(requested.amount);
        if (!Number.isInteger(newAmountRaw) || newAmountRaw <= 0) throw new OrderInputValidationError('Сумма проведённой оплаты должна быть целым числом больше нуля.');
        const newAmount = Number(newAmountRaw);
        const newPaymentKind = requested.paymentKind === undefined ? oldPaymentKind : cleanText(requested.paymentKind);
        if (!['primary', 'debt_close', 'extra'].includes(newPaymentKind)) throw new OrderInputValidationError('Не удалось определить смысл оплаты. Обновите заказ и повторите.');
        const newComment = requested.comment === undefined ? oldComment : cleanText(requested.comment);

        const staleSnapshot = (
          (requested.expectedPaymentDate !== undefined && normalizeDate(requested.expectedPaymentDate) !== oldPaymentDate)
          || (requested.expectedMethod !== undefined && upperText(requested.expectedMethod) !== oldMethod)
          || (requested.expectedAmount !== undefined && Number(requested.expectedAmount) !== oldAmount)
          || (requested.expectedPaymentKind !== undefined && (cleanText(requested.expectedPaymentKind) || 'primary') !== oldPaymentKind)
          || (requested.expectedComment !== undefined && cleanText(requested.expectedComment) !== oldComment)
        );
        if (staleSnapshot) throw new CriticalOperationConflictError('Эта оплата уже была изменена после открытия редактора. Обновите заказ и повторите исправление, чтобы не перезаписать чужое изменение.');

        const isExchangeExtra = toInt(payment.is_exchange_extra, 0) > 0;
        const nonMethodChanged = newPaymentDate !== oldPaymentDate
          || newAmount !== oldAmount
          || newPaymentKind !== oldPaymentKind
          || newComment !== oldComment;
        if (isExchangeExtra && nonMethodChanged) {
          throw new CriticalOperationConflictError('Эта доплата принадлежит операции обмена. В редакторе заказа можно исправить только способ оплаты; сумму, дату и смысл меняйте через обмен.');
        }
        if (!isExchangeExtra && newPaymentKind === 'extra') {
          throw new OrderInputValidationError('Доплату нельзя превращать в обычную оплату заказа. Доплата создаётся только внутри обмена.');
        }
        const changed = nonMethodChanged || newMethod !== oldMethod;
        if (!changed) continue;
        const oldRelatedType = isExchangeExtra ? 'exchange_extra' : financialOperationTypeFromPaymentKind(oldPaymentKind);
        const newRelatedType = isExchangeExtra ? 'exchange_extra' : financialOperationTypeFromPaymentKind(newPaymentKind);
        paymentCorrections.push({
          paymentId,
          oldPaymentDate, newPaymentDate,
          oldAmount, newAmount,
          oldPaymentKind, newPaymentKind,
          oldRelatedType, newRelatedType,
          oldMethod, newMethod,
          oldComment, newComment,
          oldIsCash: isCashPaymentMethod(oldMethod),
          newIsCash: isCashPaymentMethod(newMethod),
          cashEntryTracked: toInt(payment.cash_entry_tracked, 0) > 0,
          cashTrackingEligible: toInt(payment.cash_tracking_eligible, 0) > 0,
          isExchangeExtra,
        });
      }
''',
    'worker correction planning',
)
rewrite_line = "      const rewritePayments = !deletingOrder && Boolean(requestedPayments && !sameNormalizedOrderPaymentsForEdit(existingPaymentsForEdit, requestedPayments));"
text = replace_once(text, rewrite_line, rewrite_line + "\n      if (paymentCorrections.length && (rewritePayments || deletingOrder)) {\n        throw new CriticalOperationConflictError('Исправление проведённой оплаты нельзя совмещать с удалением заказа или полной перезаписью оплат. Сохраните эти действия отдельно.');\n      }", 'mixed payment mutation guard')
text = replace_once(
    text,
    '''      const totals = calculateTotals(nextItems, nextPayments, input.orderTotal !== undefined ? input.orderTotal : existingAny.total_amount);
      if (totals.receivedAmount > totals.totalAmount) throw new OrderInputValidationError(`Оплаты (${totals.receivedAmount}) больше цены заказа (${totals.totalAmount}). Исправьте цену или оплаты.`);''',
    '''      const calculatedTotals = calculateTotals(nextItems, nextPayments, input.orderTotal !== undefined ? input.orderTotal : existingAny.total_amount);
      const paymentCorrectionAmountDelta = paymentCorrections.reduce(
        (sum, correction) => sum + toInt(correction.newAmount, 0) - toInt(correction.oldAmount, 0),
        0,
      );
      const correctedReceivedAmount = calculatedTotals.receivedAmount + paymentCorrectionAmountDelta;
      const totals = {
        ...calculatedTotals,
        receivedAmount: correctedReceivedAmount,
        debtAmount: Math.max(0, calculatedTotals.totalAmount - correctedReceivedAmount),
      };
      if (totals.receivedAmount > totals.totalAmount) throw new OrderInputValidationError(`Оплаты (${totals.receivedAmount}) больше цены заказа (${totals.totalAmount}). Исправьте цену или оплаты.`);''',
    'corrected order totals',
)
text = replace_once(text, '        paymentMethodCorrections,\n        nextItems, nextPayments, totals,', '        paymentCorrections,\n        nextItems, nextPayments, totals,', 'plan correction field')
text = replace_between(
    text,
    '    const paymentMethodCorrectionCount = Array.isArray(p.paymentMethodCorrections) ? p.paymentMethodCorrections.length : 0;',
    '    const completedResponse = {',
    '''    const paymentCorrectionCount = Array.isArray(p.paymentCorrections) ? p.paymentCorrections.length : 0;
    if (criticalOperation.row.step === 'shipping_committed' && paymentCorrectionCount) {
      for (const correction of p.paymentCorrections as Array<Record<string, any>>) {
        const oldAmount = Math.abs(toInt(correction.oldAmount, 0));
        const newAmount = Math.abs(toInt(correction.newAmount, 0));
        const eventSourceRef = `payments:${correction.paymentId}:correction:${criticalOperation.requestId}`;
        const changedFields = [
          correction.oldPaymentDate !== correction.newPaymentDate ? `дата ${correction.oldPaymentDate} → ${correction.newPaymentDate}` : '',
          correction.oldAmount !== correction.newAmount ? `сумма ${correction.oldAmount} → ${correction.newAmount}` : '',
          correction.oldMethod !== correction.newMethod ? `способ ${correction.oldMethod} → ${correction.newMethod}` : '',
          correction.oldPaymentKind !== correction.newPaymentKind ? `смысл ${correction.oldPaymentKind} → ${correction.newPaymentKind}` : '',
          correction.oldComment !== correction.newComment ? 'комментарий' : '',
        ].filter(Boolean).join('; ');
        const auditComment = `Исправлена проведённая оплата #${correction.paymentId}: ${changedFields || 'уточнены данные'}`;
        const statements: D1PreparedStatement[] = [];
        if (oldAmount > 0) {
          statements.push(financialEventStatement(db, {
            eventKey: `1901:${criticalOperation.requestId}:payment-correction:${correction.paymentId}:old`,
            orderId: id,
            externalOrderId: p.externalId,
            eventDate: correction.oldPaymentDate,
            eventAt: p.timestamp,
            eventType: 'payment_reversal',
            relatedType: correction.oldRelatedType,
            amountDelta: -oldAmount,
            paymentMethod: correction.oldMethod,
            sourceType: 'payment',
            sourceId: correction.paymentId,
            sourceRef: eventSourceRef,
            reason: 'payment_correction',
            comment: auditComment,
          }));
        }
        if (newAmount > 0) {
          statements.push(financialEventStatement(db, {
            eventKey: `1901:${criticalOperation.requestId}:payment-correction:${correction.paymentId}:new`,
            orderId: id,
            externalOrderId: p.externalId,
            eventDate: correction.newPaymentDate,
            eventAt: p.timestamp,
            eventType: correction.newRelatedType,
            amountDelta: newAmount,
            paymentMethod: correction.newMethod,
            sourceType: 'payment',
            sourceId: correction.paymentId,
            sourceRef: eventSourceRef,
            reason: 'payment_correction',
            comment: auditComment,
          }));
        }
        statements.push(
          db.prepare(`UPDATE payments SET payment_date = ?, method = ?, amount = ?, payment_kind = ?, comment = ? WHERE id = ? AND order_id = ?`)
            .bind(correction.newPaymentDate, correction.newMethod, newAmount, correction.newPaymentKind, correction.newComment || null, correction.paymentId, id),
        );
        const oldTrackedCashAmount = correction.oldIsCash && correction.cashEntryTracked ? oldAmount : 0;
        const newCashShouldTrack = correction.newIsCash && (correction.cashEntryTracked || correction.cashTrackingEligible);
        const newTrackedCashAmount = newCashShouldTrack ? newAmount : 0;
        const cashDelta = newTrackedCashAmount - oldTrackedCashAmount;
        if (cashDelta !== 0) {
          const cashDirection = cashDelta > 0 ? 'in' : 'out';
          statements.push(db.prepare(
            `INSERT OR IGNORE INTO cash_register_entries (
              occurred_at, business_date, direction, amount, entry_type,
              source_type, source_id, source_key, order_id, external_order_id,
              payment_method, comment, created_by, created_at
            ) VALUES (?, date('now', '+5 hours'), ?, ?, 'payment_correction',
                      'payment_correction', ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            p.timestamp, cashDirection, Math.abs(cashDelta), String(correction.paymentId),
            `payment-correction:${criticalOperation.requestId}:${correction.paymentId}:cash-delta`,
            id, p.externalId, correction.newMethod, auditComment, cleanText(checkedBy) || 'admin', p.timestamp,
          ));
        }
        await db.batch(statements);
      }
    }

''',
    'worker correction application',
)
text = replace_once(text, '      paymentMethodCorrectionCount,', '      paymentCorrectionCount,', 'response correction count')
text = replace_once(text, "${paymentMethodCorrectionCount ? `способ оплаты исправлен: ${paymentMethodCorrectionCount}; ` : ''}", "${paymentCorrectionCount ? `оплаты исправлены: ${paymentCorrectionCount}; ` : ''}", 'activity correction detail')
p.write_text(text, encoding='utf-8')


# Regression contract.
Path('scripts/test-order-edit-payment-method-correction.mjs').write_text("""import fs from 'node:fs'\nimport path from 'node:path'\n\nconst root = process.cwd()\nconst read = file => fs.readFileSync(path.join(root, file), 'utf8')\nconst check = (condition, message) => { if (!condition) throw new Error(message) }\nconst section = (text, start, end = '') => {\n  const i = text.indexOf(start)\n  check(i >= 0, `missing section ${start}`)\n  if (!end) return text.slice(i)\n  const j = text.indexOf(end, i + start.length)\n  check(j > i, `missing section end ${end}`)\n  return text.slice(i, j)\n}\n\ntry {\n  const app = read('src/App.tsx')\n  const view = read('src/features/sections/OrderEditorSection.tsx')\n  const worker = read('worker/domains/orders-write.ts')\n  const types = read('worker/core/types.ts')\n  const persist = section(app, 'async function persistOrder(', 'async function saveSelectedOrder()')\n  const updatePayment = section(app, 'function updateEditorPayment(', 'function addEditorPayment(')\n  const edit = section(worker, 'export async function updateOrderCritical(', 'export async function getOrder(')\n\n  check(!updatePayment.includes(\"if (payment.id && field !== 'method') return payment\"), 'persisted ordinary payment is still method-only')\n  check(updatePayment.includes(\"payment.id && payment.paymentKind === 'extra' && field !== 'method'\"), 'exchange-extra editor guard missing')\n  check(updatePayment.includes(\"!payment.id && field === 'paymentDate' && payment.paymentKind === 'primary'\"), 'creation-time primary date guard missing')\n  check(updatePayment.includes(\"!payment.id && nextKind === 'primary'\"), 'posted primary correction still risks forcing date to order date')\n  check(view.includes(\"Boolean(payment.id && payment.paymentKind === 'extra')\"), 'exchange-linked fields are not protected in UI')\n  check(view.includes('Дату, сумму, способ, смысл и комментарий можно исправить'), 'posted ordinary correction explanation missing')\n  check(view.includes('сумму, дату и смысл меняйте через операцию обмена'), 'exchange-extra ownership explanation missing')\n  check(persist.includes('const paymentCorrections:'), 'frontend correction snapshot builder missing')\n  check(persist.includes('expectedPaymentDate: oldPaymentDate'), 'frontend CAS date snapshot missing')\n  check(persist.includes('expectedAmount: oldAmount'), 'frontend CAS amount snapshot missing')\n  check(persist.includes('expectedPaymentKind: oldPaymentKind'), 'frontend CAS kind snapshot missing')\n  check(persist.includes('expectedComment: oldComment'), 'frontend CAS comment snapshot missing')\n  check(persist.includes('paymentCorrections,'), 'order PATCH does not send payment corrections')\n  check(!persist.includes('payments: nextDraft.payments'), 'normal order edit unexpectedly rewrites full payment history')\n  check(types.includes('paymentCorrections?: Array<{'), 'typed payment correction request contract missing')\n  check(types.includes('paymentMethodCorrections?: Array<{ paymentId?: number; method?: string }>'), 'cached-client method-only compatibility missing')\n  check(edit.includes('rawPaymentCorrections'), 'backend generalized correction input missing')\n  check(edit.includes('requested.expectedPaymentDate'), 'server CAS check missing')\n  check(edit.includes('после открытия редактора'), 'stale payment conflict is not user-visible')\n  check(edit.includes('isExchangeExtra && nonMethodChanged'), 'exchange-extra non-method correction guard missing')\n  check(edit.includes(\"newPaymentKind === 'extra'\"), 'ordinary payment can become exchange-extra')\n  check(edit.includes('paymentCorrectionAmountDelta'), 'order received/debt totals do not incorporate corrected amount')\n  check(edit.includes('UPDATE payments SET payment_date = ?, method = ?, amount = ?, payment_kind = ?, comment = ? WHERE id = ? AND order_id = ?'), 'same payment row/id is not corrected in place')\n  check(edit.includes(\"eventType: 'payment_reversal'\"), 'old monetary fact reversal missing')\n  check(edit.includes('eventDate: correction.oldPaymentDate'), 'reversal does not stay on old business date')\n  check(edit.includes('eventDate: correction.newPaymentDate'), 'corrected money fact does not move to corrected date')\n  check(edit.includes('eventType: correction.newRelatedType'), 'corrected operation kind not reflected in finance history')\n  check(edit.includes(\"reason: 'payment_correction'\"), 'generic audited correction reason missing')\n  check(edit.includes('payment-correction:${correction.paymentId}:old'), 'old event is not request-idempotent')\n  check(edit.includes('payment-correction:${correction.paymentId}:new'), 'new event is not request-idempotent')\n  check(edit.includes('newTrackedCashAmount - oldTrackedCashAmount'), 'cash correction is not delta-based')\n  check(edit.includes('payment-correction:${criticalOperation.requestId}:${correction.paymentId}:cash-delta'), 'cash delta is not request-idempotent')\n  check(edit.includes(\"c.source_type IN ('payment_method_correction', 'payment_correction')\"), 'cash lineage does not survive successive corrections')\n  check(edit.indexOf(\"criticalOperation.row.step === 'shipping_committed' && paymentCorrectionCount\") > edit.indexOf(\"advanceCriticalOperation(db, criticalOperation, 'shipping_committed'\"), 'payment correction runs before core order edit is committed')\n  check(edit.includes('const rewritePayments = !deletingOrder'), 'legacy full-payment rewrite detection unexpectedly removed')\n  check(edit.includes('} else if (p.rewritePayments) {'), 'legacy full-payment rewrite path unexpectedly removed')\n  console.log('ORDER EDIT SAFE PAYMENT CORRECTION PASSED — posted ordinary payments correct date/amount/method/kind/comment in place with CAS, finance reversal+replacement, delta cash and exchange ownership')\n} catch (error) {\n  console.error(`ORDER EDIT SAFE PAYMENT CORRECTION FAILED: ${error?.message || error}`)\n  process.exit(1)\n}\n""", encoding='utf-8')

Path('docs/continuation/ORDER_EDIT_SAFE_PAYMENT_CORRECTIONS_20260910.md').write_text("""# Safe correction of posted order payments — 2026-09-10\n\nPersisted ordinary order payments can be corrected in place from the order editor: payment date, amount, method, semantic kind (`primary` / `debt_close`) and comment. The stable `payments.id` is preserved.\n\nThe browser sends only changed persisted payments together with the snapshot it originally opened. The server compares that expected snapshot with the current payment before freezing the critical-operation plan; a stale editor receives a conflict instead of overwriting another change. Cached clients using the former method-only payload remain supported.\n\nEach correction appends an auditable finance reversal of the old monetary fact and a corrected positive event using the corrected business date, amount, method and operation type, then updates the same payment row. Request-scoped event keys and cash source keys make retry replay idempotent. Cash uses only the tracked old/new cash delta, including successive corrections. Order `received_amount` and `debt_amount` include the corrected amount before the order row is written.\n\nExchange-linked extra payments retain exchange ownership: the ordinary order editor may correct their payment method only. Date, amount, kind and comment must be changed through the exchange operation. New unsaved primary payments still inherit the order date at creation time; that creation rule does not prevent correcting a posted primary payment date later.\n\nNo schema migration is required. Arrival and Branch2 are outside this change.\n""", encoding='utf-8')

print('targeted payment correction patch applied')
