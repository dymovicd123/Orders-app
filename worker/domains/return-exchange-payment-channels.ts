// Money channel validation and refund reversal for Returns and Exchanges.
// The function bodies and SQL are extracted unchanged from returns-exchanges.ts.
import { cleanText, toInt, upperText } from '../core/text.ts'
import { CriticalOperationConflictError } from './critical.ts'
import { financialEventStatement } from './money.ts'

export type MoneyPartInput = { method?: string; amount?: number };
export type MoneyPart = { method: string; amount: number };

// A settlement is one business operation but may have two actual payment channels.
// Never create a combined-method cash event: cash reports must see each channel separately.
export function normalizeMoneyParts(input: unknown, expected: number, legacyMethod: unknown): MoneyPart[] {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('Некорректная сумма денежной операции.');
  const raw = Array.isArray(input) ? input : null;
  if (!expected) {
    if (raw?.length) throw new Error('Для нулевой суммы способы оплаты не нужны.');
    return [];
  }
  if (!raw) {
    const method = upperText(legacyMethod);
    if (!method) throw new Error('Выберите способ оплаты или возврата денег.');
    return [{ method, amount: expected }];
  }
  if (raw.length < 1 || raw.length > 2) throw new Error('Можно указать один или два способа оплаты.');
  const parts: MoneyPart[] = [];
  const methods = new Set<string>();
  for (const part of raw as MoneyPartInput[]) {
    const method = upperText(part?.method);
    const amount = Number(part?.amount);
    if (!method || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('Укажите способ и положительную целую сумму для каждого платежа.');
    if (methods.has(method)) throw new Error('Один и тот же способ оплаты указан дважды.');
    methods.add(method);
    parts.push({ method, amount });
  }
  if (parts.reduce((sum, part) => sum + part.amount, 0) !== expected) {
    throw new Error('Суммы по способам оплаты не совпадают с итогом операции.');
  }
  return parts;
}
export function moneyMethodsSummary(parts: MoneyPart[]): string {
  return parts.map(part => part.method).join(' + ');
}

// Reversing a split refund must mirror its original channels, not post a single
// fictitious combined-method cash movement. Legacy single-method refunds use
// the existing reversal path unchanged.
export async function splitRefundReversalStatements(
  db: D1Database,
  input: {
    orderId: number; externalOrderId: string; amount: number; methodSummary: string;
    timestamp: string; comment: string; reason: 'return_cancel' | 'exchange_cancel';
    returnId?: number; exchangeId?: number;
  },
): Promise<D1PreparedStatement[] | null> {
  const isExchange = Boolean(input.exchangeId);
  const result = isExchange
    ? await db.prepare(
      "SELECT amount_delta, payment_method FROM financial_events WHERE source_type='exchange' AND source_id=? AND event_type='exchange_refund' AND event_key LIKE '1901:%:exchange-set-refund%' ORDER BY event_key"
    ).bind(input.exchangeId).all<{amount_delta:number;payment_method:string}>()
    : await db.prepare(
      "SELECT amount_delta, payment_method FROM financial_events WHERE event_type='order_refund' AND source_ref = (SELECT 'critical-operation:' || request_id FROM critical_operations WHERE operation_type='return_create' AND target_id=? ORDER BY created_at DESC LIMIT 1) ORDER BY event_key"
    ).bind(input.returnId).all<{amount_delta:number;payment_method:string}>();
  const rows = result.results || [];
  if (rows.length < 2) {
    if (input.methodSummary.includes(' + ')) throw new CriticalOperationConflictError('Не найдены все исходные части возврата денег. Отмена остановлена без финансовых изменений.');
    return null;
  }
  const total = rows.reduce((sum, row) => sum - Number(row.amount_delta), 0);
  if (total !== input.amount || rows.some(row => Number(row.amount_delta) >= 0 || !cleanText(row.payment_method))) {
    throw new CriticalOperationConflictError('Части возврата не совпадают с сохранённой суммой. Отмена остановлена.');
  }
  return rows.map((row, index) => financialEventStatement(db, {
    eventKey: '189c:' + (isExchange ? 'exchange-set:' + input.exchangeId : 'return:' + input.returnId) + ':split-refund-cancel:' + (index + 1),
    orderId: input.orderId,
    externalOrderId: input.externalOrderId,
    eventDate: input.timestamp.slice(0, 10),
    eventAt: input.timestamp,
    eventType: 'refund_reversal',
    relatedType: isExchange ? 'exchange_refund' : 'order_refund',
    amountDelta: -Number(row.amount_delta),
    paymentMethod: cleanText(row.payment_method),
    sourceType: isExchange ? 'exchange' : 'return',
    sourceId: isExchange ? input.exchangeId : input.returnId,
    sourceRef: isExchange ? 'exchanges:' + input.exchangeId : 'returns:' + input.returnId,
    reason: input.reason,
    comment: input.comment,
  }));
}

export async function exchangeSetPaymentIds(db: D1Database, exchangeId: number): Promise<number[]> {
  const result = await db.prepare(
    "SELECT ce.entity_id AS id FROM critical_operation_entities ce JOIN critical_operations co ON co.request_id=ce.request_id WHERE co.operation_type='exchange_set_create' AND co.target_id=? AND ce.entity_type='payment' AND ce.entity_key LIKE 'exchange:set:payment%' ORDER BY ce.entity_key"
  ).bind(exchangeId).all<{id:number}>();
  return (result.results || []).map(row => toInt(row.id, 0)).filter(id => id > 0);
}

