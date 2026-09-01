from pathlib import Path
import json


def require_once(text: str, old: str, label: str) -> str:
    if text.count(old) != 1:
        raise SystemExit(f'{label} anchor changed: {text.count(old)} matches')
    return text


# Frontend controller: an existing payment may edit only its method.
app = Path('src/App.tsx')
text = app.read_text()
old_guard = "        if (paymentIndex !== index || payment.id) return payment"
require_once(text, old_guard, 'App persisted-payment edit guard')
text = text.replace(
    old_guard,
    "        if (paymentIndex !== index) return payment\n        if (payment.id && field !== 'method') return payment",
    1,
)

payload_start = text.find("        items: nextDraft.items.map((item) => ({\n", text.find('async function persistOrder('))
if payload_start < 0:
    raise SystemExit('persistOrder items payload anchor changed')
payload_end_marker = "        })),\n      }\n\n      const criticalKey = `order-edit:${order.id}`"
payload_end = text.find(payload_end_marker, payload_start)
if payload_end < 0:
    raise SystemExit('persistOrder payload end anchor changed')
payload_replacement = "        })),\n        paymentMethodCorrections: nextDraft.payments\n          .filter((payment) => Boolean(payment.id))\n          .map((payment) => ({ paymentId: Number(payment.id), method: payment.method })),\n      }\n\n      const criticalKey = `order-edit:${order.id}`"
text = text[:payload_end] + text[payload_end:].replace(payload_end_marker, payload_replacement, 1)
app.write_text(text)


# Frontend view: unlock only payment method for already-recorded rows.
view = Path('src/features/sections/OrderEditorSection.tsx')
text = view.read_text()
old_note = "                        Если первичную оплату забыли внести, добавьте её явно — она всегда относится к дате заказа. Любая обычная оплата позже создания заказа оформляется как «Закрытие долга» и проходит через тот же серверный механизм, что и отдельная кнопка закрытия долга. Доплата существует только в форме обмена. Уже проведённые оплаты здесь не переписываются: это защищает денежную историю и кассу."
new_note = "                        Если первичную оплату забыли внести, добавьте её явно — она всегда относится к дате заказа. Любая обычная оплата позже создания заказа оформляется как «Закрытие долга». У уже проведённой оплаты можно исправить способ оплаты; сумма, дата и смысл операции останутся прежними, а исправление сохранится в денежной истории."
require_once(text, old_note, 'OrderEditor payment note')
text = text.replace(old_note, new_note, 1)
old_method = '''                                {payment.id ? (
                                  <input value={payment.method || ''} disabled readOnly />
                                ) : (
                                  <SmartPickerInput
                                    value={payment.method}
                                    onChange={(value) => updateEditorPayment(index, 'method', value)}
                                    placeholder="Выберите способ"
                                    options={suggestionValues.paymentMethods}
                                    disabled={savingOrder}
                                  />
                                )}'''
new_method = '''                                <SmartPickerInput
                                  value={payment.method || ''}
                                  onChange={(value) => updateEditorPayment(index, 'method', value)}
                                  placeholder="Выберите способ"
                                  options={suggestionValues.paymentMethods}
                                  disabled={savingOrder}
                                />'''
require_once(text, old_method, 'OrderEditor persisted method field')
text = text.replace(old_method, new_method, 1)
old_row_note = '                              <p className="mini-panel-note">Эта операция уже проведена. Для исправления исторической оплаты нельзя молча удалять и создавать её заново.</p>'
new_row_note = '                              <p className="mini-panel-note">Оплата уже проведена. Здесь можно исправить только способ оплаты; сумма, дата и тип операции не меняются.</p>'
require_once(text, old_row_note, 'OrderEditor persisted row note')
text = text.replace(old_row_note, new_row_note, 1)
view.write_text(text)


# Backend: keep payment row/id stable. Correct only its classification and append audit events.
worker = Path('worker/domains/orders-write.ts')
text = worker.read_text()
old_import = "import { buildPaymentAndMoneyEventStatements, removeOrderPaymentsWithMoneyEvents } from './money.ts'"
new_import = "import { buildPaymentAndMoneyEventStatements, financialEventStatement, financialOperationTypeFromPaymentKind, removeOrderPaymentsWithMoneyEvents } from './money.ts'"
require_once(text, old_import, 'orders-write money import')
text = text.replace(old_import, new_import, 1)

request_anchor = "      const existingPaymentsForEdit = normalizeOrderPayments((existingAny.payments || []) as OrderInput['payments'], nextOrderDate);\n"
require_once(text, request_anchor, 'existingPaymentsForEdit')
correction_plan = '''      const rawPaymentMethodCorrections = Array.isArray((input as any).paymentMethodCorrections)
        ? (input as any).paymentMethodCorrections as Array<{ paymentId?: unknown; method?: unknown }>
        : [];
      const requestedPaymentMethodCorrections = new Map<number, string>();
      for (const correction of rawPaymentMethodCorrections) {
        const paymentId = toInt(correction?.paymentId, 0);
        const method = upperText(correction?.method);
        if (!paymentId) throw new OrderInputValidationError('Не удалось определить оплату для исправления способа. Обновите заказ и повторите.');
        if (!method) throw new OrderInputValidationError('Способ оплаты не может быть пустым.');
        requestedPaymentMethodCorrections.set(paymentId, method);
      }
      const paymentMethodCorrections: Array<Record<string, any>> = [];
      const isCashPaymentMethod = (value: unknown) => {
        const method = upperText(value);
        return method === 'CASH' || method.includes('НАЛИЧ');
      };
      for (const [paymentId, newMethod] of requestedPaymentMethodCorrections) {
        const payment = await db.prepare(
          `SELECT p.id, p.payment_date, p.method, p.amount, COALESCE(p.payment_kind, 'primary') AS payment_kind,
                  p.comment, o.created_at AS order_created_at,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM exchanges e
                    WHERE e.payment_id = p.id AND e.financial_action = 'extra_payment'
                      AND COALESCE(e.status, 'completed') <> 'cancelled'
                  ) THEN 1 ELSE 0 END AS is_exchange_extra,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM cash_register_entries c WHERE c.source_key = 'payment:' || p.id
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
        if (!payment?.id) throw new OrderInputValidationError('Одна из оплат заказа уже изменилась. Обновите заказ и повторите исправление способа оплаты.');
        const oldMethod = upperText(payment.method);
        if (oldMethod === newMethod) continue;
        const paymentKind = cleanText(payment.payment_kind);
        const relatedType = toInt(payment.is_exchange_extra, 0) > 0
          ? 'exchange_extra'
          : financialOperationTypeFromPaymentKind(paymentKind);
        paymentMethodCorrections.push({
          paymentId,
          paymentDate: normalizeDate(payment.payment_date || nextOrderDate),
          amount: Math.max(0, toInt(payment.amount, 0)),
          paymentKind,
          relatedType,
          oldMethod,
          newMethod,
          comment: cleanText(payment.comment),
          oldIsCash: isCashPaymentMethod(oldMethod),
          newIsCash: isCashPaymentMethod(newMethod),
          cashEntryTracked: toInt(payment.cash_entry_tracked, 0) > 0,
          cashTrackingEligible: toInt(payment.cash_tracking_eligible, 0) > 0,
        });
      }
'''
text = text.replace(request_anchor, request_anchor + correction_plan, 1)

plan_anchor = "        rewriteItems, rewritePayments, deletingOrder, deferShippingCommit,\n        nextItems, nextPayments, totals, rewritePreResolvedCatalog: rewritePreResolvedCatalog || null,\n"
require_once(text, plan_anchor, 'updateOrderCritical plan')
text = text.replace(
    plan_anchor,
    "        rewriteItems, rewritePayments, deletingOrder, deferShippingCommit,\n        paymentMethodCorrections,\n        nextItems, nextPayments, totals, rewritePreResolvedCatalog: rewritePreResolvedCatalog || null,\n",
    1,
)

apply_anchor = "      await advanceCriticalOperation(db, criticalOperation, 'shipping_committed', { context: operationContext });\n    }\n\n    const completedResponse = {\n"
require_once(text, apply_anchor, 'shipping_committed completion')
apply_block = '''      await advanceCriticalOperation(db, criticalOperation, 'shipping_committed', { context: operationContext });
    }

    const paymentMethodCorrectionCount = Array.isArray(p.paymentMethodCorrections) ? p.paymentMethodCorrections.length : 0;
    if (criticalOperation.row.step === 'shipping_committed' && paymentMethodCorrectionCount) {
      for (const correction of p.paymentMethodCorrections as Array<Record<string, any>>) {
        const eventSourceRef = `payments:${correction.paymentId}:method-correction:${criticalOperation.requestId}`;
        const amount = Math.abs(toInt(correction.amount, 0));
        const statements: D1PreparedStatement[] = [
          db.prepare(`UPDATE payments SET method = ? WHERE id = ? AND order_id = ?`)
            .bind(correction.newMethod, correction.paymentId, id),
        ];
        if (amount > 0) {
          statements.unshift(
            financialEventStatement(db, {
              eventKey: `1901:${criticalOperation.requestId}:payment-method:${correction.paymentId}:old`,
              orderId: id,
              externalOrderId: p.externalId,
              eventDate: correction.paymentDate,
              eventAt: p.timestamp,
              eventType: 'payment_reversal',
              relatedType: correction.relatedType,
              amountDelta: -amount,
              paymentMethod: correction.oldMethod,
              sourceType: 'payment',
              sourceId: correction.paymentId,
              sourceRef: eventSourceRef,
              reason: 'payment_method_correction',
              comment: `Исправлен способ оплаты: ${correction.oldMethod} → ${correction.newMethod}`,
            }),
            financialEventStatement(db, {
              eventKey: `1901:${criticalOperation.requestId}:payment-method:${correction.paymentId}:new`,
              orderId: id,
              externalOrderId: p.externalId,
              eventDate: correction.paymentDate,
              eventAt: p.timestamp,
              eventType: correction.relatedType,
              amountDelta: amount,
              paymentMethod: correction.newMethod,
              sourceType: 'payment',
              sourceId: correction.paymentId,
              sourceRef: eventSourceRef,
              reason: 'payment_method_correction',
              comment: `Исправлен способ оплаты: ${correction.oldMethod} → ${correction.newMethod}`,
            }),
          );
        }
        const cashDirection = amount > 0 && correction.oldIsCash && !correction.newIsCash && correction.cashEntryTracked
          ? 'out'
          : (amount > 0 && !correction.oldIsCash && correction.newIsCash && correction.cashTrackingEligible ? 'in' : '');
        if (cashDirection) {
          statements.push(db.prepare(
            `INSERT OR IGNORE INTO cash_register_entries (
              occurred_at, business_date, direction, amount, entry_type,
              source_type, source_id, source_key, order_id, external_order_id,
              payment_method, comment, created_by, created_at
            ) VALUES (?, date('now', '+5 hours'), ?, ?, 'payment_method_correction',
                      'payment_method_correction', ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            p.timestamp,
            cashDirection,
            amount,
            String(correction.paymentId),
            `payment-method-correction:${criticalOperation.requestId}:${correction.paymentId}:${cashDirection}`,
            id,
            p.externalId,
            correction.newMethod,
            `Исправлен способ оплаты: ${correction.oldMethod} → ${correction.newMethod}`,
            cleanText(checkedBy) || 'admin',
            p.timestamp,
          ));
        }
        await db.batch(statements);
      }
    }

    const completedResponse = {
'''
text = text.replace(apply_anchor, apply_block, 1)

response_anchor = "      inventoryDelivery: operationContext.inventoryDelivery ?? inventoryDelivery,\n"
require_once(text, response_anchor, 'completedResponse inventoryDelivery')
text = text.replace(response_anchor, response_anchor + "      paymentMethodCorrectionCount,\n", 1)

activity_anchor = "        details: `${p.deletingOrder ? (p.humanInventoryModelEnabled ? 'Заказ удалён; резерв освобождён; цех снят; ' : 'Заказ удалён; остатки возвращены; цех снят; ') : ''}${p.rewriteItems ? 'Товары обновлены; ' : ''}${p.rewritePayments ? 'оплаты обновлены; ' : ''}статус отправки: ${p.nextShippingStatus}`,\n"
require_once(text, activity_anchor, 'order activity details')
activity_new = "        details: `${p.deletingOrder ? (p.humanInventoryModelEnabled ? 'Заказ удалён; резерв освобождён; цех снят; ' : 'Заказ удалён; остатки возвращены; цех снят; ') : ''}${p.rewriteItems ? 'Товары обновлены; ' : ''}${p.rewritePayments ? 'оплаты обновлены; ' : ''}${paymentMethodCorrectionCount ? `способ оплаты исправлен: ${paymentMethodCorrectionCount}; ` : ''}статус отправки: ${p.nextShippingStatus}`,\n"
text = text.replace(activity_anchor, activity_new, 1)
worker.write_text(text)


# Regression coverage for this exact UX/backend contract.
regression = Path('scripts/test-order-edit-payment-method-correction.mjs')
regression.write_text(r'''import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const section = (text, start, end = '') => {
  const i = text.indexOf(start)
  check(i >= 0, `missing section ${start}`)
  if (!end) return text.slice(i)
  const j = text.indexOf(end, i + start.length)
  check(j > i, `missing section end ${end}`)
  return text.slice(i, j)
}

try {
  const app = read('src/App.tsx')
  const view = read('src/features/sections/OrderEditorSection.tsx')
  const worker = read('worker/domains/orders-write.ts')
  const persist = section(app, 'async function persistOrder(', 'async function saveSelectedOrder()')
  const updatePayment = section(app, 'function updateEditorPayment(', 'function addEditorPayment(')
  const edit = section(worker, 'export async function updateOrderCritical(', 'export async function getOrder(')

  check(updatePayment.includes("if (payment.id && field !== 'method') return payment"), 'persisted payment is not limited to method-only edit')
  check(!view.includes("<input value={payment.method || ''} disabled readOnly />"), 'persisted payment method is still read-only')
  check(view.includes("onChange={(value) => updateEditorPayment(index, 'method', value)}"), 'payment method editor missing')
  check(view.includes("disabled={Boolean(payment.id) || savingOrder || payment.paymentKind === 'primary'}"), 'persisted payment date unexpectedly unlocked')
  check(view.includes('disabled={Boolean(payment.id) || savingOrder}'), 'persisted amount/kind/comment locks disappeared')
  check(persist.includes('paymentMethodCorrections: nextDraft.payments'), 'order PATCH does not send payment-method corrections')
  check(persist.includes('.filter((payment) => Boolean(payment.id))'), 'unsaved payment drafts can leak into correction PATCH')
  check(!persist.includes('payments: nextDraft.payments'), 'order edit unexpectedly rewrites full payment history')

  check(edit.includes('rawPaymentMethodCorrections'), 'backend correction input missing')
  check(edit.includes('WHERE p.id = ? AND p.order_id = ?'), 'payment correction is not scoped to the exact order')
  check(edit.includes('UPDATE payments SET method = ? WHERE id = ? AND order_id = ?'), 'payment row/id is not corrected in place')
  check(edit.includes("eventType: 'payment_reversal'"), 'old method financial reversal missing')
  check(edit.includes('eventType: correction.relatedType'), 'new method financial event missing')
  check(edit.includes('eventDate: correction.paymentDate'), 'correction does not preserve original payment date')
  check(edit.includes("reason: 'payment_method_correction'"), 'financial correction audit reason missing')
  check(edit.includes('payment-method-correction:${criticalOperation.requestId}:${correction.paymentId}:${cashDirection}'), 'cash correction is not request-idempotent')
  check(edit.includes('correction.oldIsCash && !correction.newIsCash && correction.cashEntryTracked'), 'cash-to-noncash balance correction missing')
  check(edit.includes('!correction.oldIsCash && correction.newIsCash && correction.cashTrackingEligible'), 'noncash-to-cash balance correction missing')
  check(edit.indexOf("criticalOperation.row.step === 'shipping_committed' && paymentMethodCorrectionCount") > edit.indexOf("advanceCriticalOperation(db, criticalOperation, 'shipping_committed'"), 'method correction runs before normal order edit is safely committed')
  check(edit.includes('const rewritePayments = !deletingOrder'), 'legacy full-payment rewrite detection unexpectedly removed')
  check(edit.includes('} else if (p.rewritePayments) {'), 'legacy full-payment rewrite path unexpectedly removed')

  console.log('ORDER EDIT PAYMENT METHOD CORRECTION PASSED — persisted payment id/amount/date/kind remain stable, method is corrected in place, finance gets an auditable net-zero pair, and cash classification is adjusted idempotently')
} catch (error) {
  console.error(`ORDER EDIT PAYMENT METHOD CORRECTION FAILED: ${error?.message || error}`)
  process.exit(1)
}
''')

pkg_path = Path('package.json')
pkg = json.loads(pkg_path.read_text())
needle = 'node scripts/test-order-edit-payment-method-correction.mjs'
if needle not in pkg['scripts']['release:check']:
    pkg['scripts']['release:check'] += f' && {needle}'
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')


# Extend the Worker declaration preservation chain after the already-accepted exchange hotfix.
gate = Path('scripts/test-step1906a-worker-modularization.mjs')
text = gate.read_text()
path_anchor = "const exchangeStaleHandoverPath = path.join(root, 'scripts/exchange-stale-handover-worker-manifest.json')\n"
require_once(text, path_anchor, 'exchange manifest path')
text = text.replace(path_anchor, path_anchor + "const orderEditPaymentMethodPath = path.join(root, 'scripts/order-edit-payment-method-worker-manifest.json')\n", 1)
load_anchor = "  const exchangeStaleHandoverChanges = exchangeStaleHandover.changes || {}\n"
require_once(text, load_anchor, 'exchange manifest load')
text = text.replace(
    load_anchor,
    load_anchor
    + "  check(fs.existsSync(orderEditPaymentMethodPath), 'Order edit payment-method Worker manifest missing')\n"
    + "  const orderEditPaymentMethod = JSON.parse(fs.readFileSync(orderEditPaymentMethodPath, 'utf8'))\n"
    + "  check(orderEditPaymentMethod?.version === 1 && orderEditPaymentMethod?.revision === 'order-edit-payment-method-r1', 'Order edit payment-method Worker manifest invalid')\n"
    + "  const orderEditPaymentMethodChanges = orderEditPaymentMethod.changes || {}\n",
    1,
)
old_terminal = '''    const exchangeStaleHandoverChanged = exchangeStaleHandoverChanges[name]
    if (exchangeStaleHandoverChanged) {
      check(exchangeStaleHandoverChanged.before === acceptedPostShippingShortageHash, `Exchange stale-handover baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === exchangeStaleHandoverChanged.after, `Worker declaration changed beyond exact Exchange stale-handover allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostShippingShortageHash, `Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability / Shipping shortage / Exchange stale-handover deltas: ${name}`)
    }'''
new_terminal = '''    const exchangeStaleHandoverChanged = exchangeStaleHandoverChanges[name]
    let acceptedPostExchangeStaleHandoverHash = acceptedPostShippingShortageHash
    if (exchangeStaleHandoverChanged) {
      check(exchangeStaleHandoverChanged.before === acceptedPostShippingShortageHash, `Exchange stale-handover baseline hash mismatch: ${name}`)
      acceptedPostExchangeStaleHandoverHash = exchangeStaleHandoverChanged.after
    }
    const orderEditPaymentMethodChanged = orderEditPaymentMethodChanges[name]
    if (orderEditPaymentMethodChanged) {
      check(orderEditPaymentMethodChanged.before === acceptedPostExchangeStaleHandoverHash, `Order edit payment-method baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === orderEditPaymentMethodChanged.after, `Worker declaration changed beyond exact Order edit payment-method allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostExchangeStaleHandoverHash, `Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability / Shipping shortage / Exchange stale-handover / payment-method deltas: ${name}`)
    }'''
require_once(text, old_terminal, 'terminal Worker declaration gate')
text = text.replace(old_terminal, new_terminal, 1)
gate.write_text(text)

print('payment method correction patch prepared')
