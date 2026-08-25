// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { cleanText, normalizeDate, normalizeOrderStatus, toInt, upperText } from '../core/text.ts'
import type { PaymentKind } from '../core/types.ts'
import { advanceCriticalOperation, beginCriticalOperation, completeCriticalOperation, CriticalOperationConflictError, failCriticalOperation, insertCriticalMappedEntity, parseCriticalContext } from './critical.ts'

export function normalizePaymentKind(value: unknown) {
  const kind = cleanText(value).toLowerCase();
  if (kind === 'debt_close' || kind === 'долг' || kind === 'закрытие долга') return 'debt_close';
  if (kind === 'extra' || kind === 'доплата') return 'extra';
  return 'primary';
}


export type FinancialEventType =
  | 'order_payment'
  | 'debt_close'
  | 'order_extra'
  | 'exchange_extra'
  | 'order_refund'
  | 'exchange_refund'
  | 'payment_reversal'
  | 'refund_reversal';


export type FinancialEventInput = {
  eventKey: string;
  orderId: number;
  externalOrderId: string;
  eventDate: string;
  eventAt: string;
  eventType: FinancialEventType;
  relatedType?: FinancialEventType | null;
  amountDelta: number;
  paymentMethod?: string | null;
  sourceType: 'payment' | 'return' | 'exchange' | 'order';
  sourceId?: number | null;
  sourceRef?: string | null;
  reason?: string | null;
  comment?: string | null;
  isBackfill?: boolean;
};


export function financialOperationTypeFromPaymentKind(paymentKind: unknown): FinancialEventType {
  const kind = normalizePaymentKind(paymentKind);
  if (kind === 'debt_close') return 'debt_close';
  if (kind === 'extra') return 'order_extra';
  return 'order_payment';
}


export function financialEventStatement(db: D1Database, input: FinancialEventInput) {
  const amountDelta = Math.trunc(Number(input.amountDelta || 0));
  if (!amountDelta) throw new Error('Денежное событие с нулевой суммой не сохраняется.');
  return db.prepare(
    `INSERT OR IGNORE INTO financial_events (
       event_key, order_id, external_order_id, event_date, event_at, event_type, related_type,
       amount_delta, payment_method, source_type, source_id, source_ref, reason, comment, is_backfill, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    cleanText(input.eventKey),
    input.orderId || null,
    cleanText(input.externalOrderId),
    normalizeDate(input.eventDate),
    cleanText(input.eventAt) || new Date().toISOString(),
    input.eventType,
    input.relatedType || null,
    amountDelta,
    cleanText(input.paymentMethod) || null,
    input.sourceType,
    input.sourceId || null,
    cleanText(input.sourceRef) || null,
    cleanText(input.reason) || null,
    cleanText(input.comment) || null,
    input.isBackfill ? 1 : 0,
    cleanText(input.eventAt) || new Date().toISOString(),
  );
}


export function buildPaymentAndMoneyEventStatements(
  db: D1Database,
  input: {
    orderId: number;
    externalOrderId: string;
    paymentDate: string;
    method: string;
    amount: number;
    paymentKind: PaymentKind;
    comment?: string | null;
    timestamp: string;
    eventType?: FinancialEventType;
    sourceType?: 'payment' | 'exchange' | 'order';
    sourceId?: number | null;
    sourceRef?: string | null;
    reason?: string | null;
    eventKey?: string;
    isBackfill?: boolean;
  },
) {
  const eventType = input.eventType || financialOperationTypeFromPaymentKind(input.paymentKind);
  const eventKey = cleanText(input.eventKey) || `189c:${eventType}:${input.orderId}:${crypto.randomUUID()}`;
  const payment = db.prepare(
    `INSERT INTO payments (order_id, payment_date, method, amount, payment_kind, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    input.orderId,
    input.paymentDate,
    input.method,
    input.amount,
    input.paymentKind,
    cleanText(input.comment) || null,
    input.timestamp,
  );
  const event = financialEventStatement(db, {
    eventKey,
    orderId: input.orderId,
    externalOrderId: input.externalOrderId,
    eventDate: input.paymentDate,
    eventAt: input.timestamp,
    eventType,
    amountDelta: Math.abs(Math.trunc(Number(input.amount || 0))),
    paymentMethod: input.method,
    sourceType: input.sourceType || 'payment',
    sourceId: input.sourceId || null,
    sourceRef: input.sourceRef || null,
    reason: input.reason || 'recorded',
    comment: input.comment || null,
    isBackfill: Boolean(input.isBackfill),
  });
  return { payment, event, eventKey };
}


export async function removeOrderPaymentsWithMoneyEvents(
  db: D1Database,
  input: { orderId: number; externalOrderId: string; timestamp: string; reason: 'order_edit' | 'order_delete'; comment: string },
) {
  const eventDate = input.timestamp.slice(0, 10);
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO financial_events (
         event_key, order_id, external_order_id, event_date, event_at, event_type, related_type,
         amount_delta, payment_method, source_type, source_id, source_ref, reason, comment, is_backfill, created_at
       )
       SELECT
         '189c:payment:' || p.id || ':reversal:' || ?,
         p.order_id,
         ?,
         ?,
         ?,
         'payment_reversal',
         CASE
           WHEN EXISTS (SELECT 1 FROM exchanges e WHERE e.payment_id = p.id AND e.financial_action = 'extra_payment') THEN 'exchange_extra'
           WHEN p.payment_kind = 'debt_close' THEN 'debt_close'
           WHEN p.payment_kind = 'extra' THEN 'order_extra'
           ELSE 'order_payment'
         END,
         -ABS(p.amount),
         p.method,
         'payment',
         p.id,
         'payments:' || p.id,
         ?,
         ?,
         0,
         ?
       FROM payments p
       WHERE p.order_id = ? AND COALESCE(p.amount, 0) > 0`
    ).bind(
      input.reason,
      input.externalOrderId,
      eventDate,
      input.timestamp,
      input.reason,
      input.comment,
      input.timestamp,
      input.orderId,
    ),
    db.prepare('DELETE FROM payments WHERE order_id = ?').bind(input.orderId),
  ]);
}


export async function removeSinglePaymentWithMoneyEvent(
  db: D1Database,
  input: {
    paymentId: number;
    orderId: number;
    externalOrderId: string;
    timestamp: string;
    relatedType?: FinancialEventType | null;
    reason: 'exchange_cancel' | 'payment_correction';
    comment: string;
  },
) {
  const eventDate = input.timestamp.slice(0, 10);
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO financial_events (
         event_key, order_id, external_order_id, event_date, event_at, event_type, related_type,
         amount_delta, payment_method, source_type, source_id, source_ref, reason, comment, is_backfill, created_at
       )
       SELECT
         '189c:payment:' || p.id || ':reversal:' || ?,
         p.order_id,
         ?,
         ?,
         ?,
         'payment_reversal',
         COALESCE(?, CASE WHEN p.payment_kind = 'debt_close' THEN 'debt_close' WHEN p.payment_kind = 'extra' THEN 'order_extra' ELSE 'order_payment' END),
         -ABS(p.amount),
         p.method,
         'payment',
         p.id,
         'payments:' || p.id,
         ?,
         ?,
         0,
         ?
       FROM payments p
       WHERE p.id = ? AND p.order_id = ? AND COALESCE(p.amount, 0) > 0`
    ).bind(
      input.reason,
      input.externalOrderId,
      eventDate,
      input.timestamp,
      input.relatedType || null,
      input.reason,
      input.comment,
      input.timestamp,
      input.paymentId,
      input.orderId,
    ),
    db.prepare('DELETE FROM payments WHERE id = ? AND order_id = ?').bind(input.paymentId, input.orderId),
  ]);
}


export function refundMoneyEventStatement(
  db: D1Database,
  input: {
    eventKey: string;
    orderId: number;
    externalOrderId: string;
    returnDate: string;
    amount: number;
    paymentMethod?: string | null;
    timestamp: string;
    eventType: 'order_refund' | 'exchange_refund';
    sourceId?: number | null;
    sourceRef?: string | null;
    comment?: string | null;
    reason?: string | null;
    isBackfill?: boolean;
  },
) {
  return financialEventStatement(db, {
    eventKey: input.eventKey,
    orderId: input.orderId,
    externalOrderId: input.externalOrderId,
    eventDate: input.returnDate,
    eventAt: input.timestamp,
    eventType: input.eventType,
    amountDelta: -Math.abs(Math.trunc(Number(input.amount || 0))),
    paymentMethod: input.paymentMethod || null,
    sourceType: input.eventType === 'exchange_refund' ? 'exchange' : 'return',
    sourceId: input.sourceId || null,
    sourceRef: input.sourceRef || null,
    reason: input.reason || 'recorded',
    comment: input.comment || null,
    isBackfill: Boolean(input.isBackfill),
  });
}


export function refundReversalMoneyEventStatement(
  db: D1Database,
  input: {
    eventKey: string;
    orderId: number;
    externalOrderId: string;
    amount: number;
    paymentMethod?: string | null;
    timestamp: string;
    relatedType: 'order_refund' | 'exchange_refund';
    sourceId?: number | null;
    sourceRef?: string | null;
    reason: 'return_cancel' | 'exchange_cancel';
    comment?: string | null;
  },
) {
  return financialEventStatement(db, {
    eventKey: input.eventKey,
    orderId: input.orderId,
    externalOrderId: input.externalOrderId,
    eventDate: input.timestamp.slice(0, 10),
    eventAt: input.timestamp,
    eventType: 'refund_reversal',
    relatedType: input.relatedType,
    amountDelta: Math.abs(Math.trunc(Number(input.amount || 0))),
    paymentMethod: input.paymentMethod || null,
    sourceType: input.relatedType === 'exchange_refund' ? 'exchange' : 'return',
    sourceId: input.sourceId || null,
    sourceRef: input.sourceRef || null,
    reason: input.reason,
    comment: input.comment || null,
  });
}



export type OrderFinancialLedger = {
  totalAmount: number;
  receivedAmount: number;
  returnAmount: number;
  debtAmount: number;
};


export async function readOrderFinancialLedger(db: D1Database, orderId: number): Promise<OrderFinancialLedger> {
  const row = await db.prepare(
    `SELECT
       COALESCE(o.total_amount, 0) AS total_amount,
       COALESCE((
         SELECT SUM(CASE WHEN COALESCE(p.amount, 0) > 0 THEN p.amount ELSE 0 END)
         FROM payments p
         WHERE p.order_id = o.id
       ), 0) AS received_amount,
       COALESCE((
         SELECT SUM(CASE WHEN COALESCE(r.amount, 0) > 0 THEN r.amount ELSE 0 END)
         FROM returns r
         WHERE r.order_id = o.id
           AND COALESCE(r.status, 'completed') <> 'cancelled'
       ), 0) AS return_amount
     FROM orders o
     WHERE o.id = ?
     LIMIT 1`
  ).bind(orderId).first<Record<string, unknown>>();

  if (!row) throw new Error('Order not found.');
  const totalAmount = Math.max(0, toInt(row.total_amount, 0));
  const receivedAmount = Math.max(0, toInt(row.received_amount, 0));
  const returnAmount = Math.max(0, toInt(row.return_amount, 0));
  return {
    totalAmount,
    receivedAmount,
    returnAmount,
    debtAmount: Math.max(0, totalAmount - receivedAmount),
  };
}


export async function syncOrderFinancialLedger(
  db: D1Database,
  orderId: number,
  timestamp = new Date().toISOString(),
): Promise<OrderFinancialLedger> {
  const ledger = await readOrderFinancialLedger(db, orderId);
  await db.prepare(
    `UPDATE orders
     SET received_amount = ?, return_amount = ?, debt_amount = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    ledger.receivedAmount,
    ledger.returnAmount,
    ledger.debtAmount,
    timestamp,
    orderId,
  ).run();
  return ledger;
}

export async function createManualOrderPaymentCritical(
  db: D1Database,
  input: {
    requestId?: unknown;
    orderId?: unknown;
    paymentDate?: unknown;
    method?: unknown;
    amount?: unknown;
    paymentKind?: unknown;
    comment?: unknown;
  },
) {
  const orderId = toInt(input.orderId, 0);
  const amountNumber = Number(input.amount);
  const amount = Number.isFinite(amountNumber) && Number.isInteger(amountNumber) ? amountNumber : 0;
  const method = upperText(input.method);
  const paymentKind = normalizePaymentKind(input.paymentKind) as PaymentKind;
  const requestedPaymentDate = normalizeDate(input.paymentDate);
  const comment = cleanText(input.comment);
  if (!orderId) throw new Error('orderId is required');
  if (!method || amount <= 0) throw new Error('method and amount are required');
  if (paymentKind === 'extra') {
    throw new CriticalOperationConflictError('Обычной доплаты по заказу нет. Используйте закрытие долга; доплата доступна только внутри обмена.');
  }

  const payload = { orderId, paymentDate: requestedPaymentDate, method, amount, paymentKind, comment };
  const criticalOperation = await beginCriticalOperation(db, 'order_payment_create', input.requestId, payload);
  if (criticalOperation.row.status === 'completed') {
    const cached = criticalOperation.cachedResponse && typeof criticalOperation.cachedResponse === 'object'
      ? criticalOperation.cachedResponse as Record<string, unknown>
      : {};
    return {
      ok: true,
      orderId: toInt(cached.orderId, orderId),
      paymentId: toInt(cached.paymentId, 0) || null,
      externalOrderId: cleanText(cached.externalOrderId),
      amount: toInt(cached.amount, amount),
      method: cleanText(cached.method) || method,
      createdAt: cleanText(cached.createdAt),
      refreshRequired: true,
      replayed: true,
    };
  }

  try {
    type ManualPaymentPlan = {
      orderId: number;
      externalId: string;
      paymentDate: string;
      method: string;
      amount: number;
      paymentKind: PaymentKind;
      comment: string;
      timestamp: string;
    };
    let context = parseCriticalContext<{ plan?: ManualPaymentPlan; paymentId?: number }>(criticalOperation.row);
    let plan = context.plan || null;

    if (!plan) {
      const existing = await db.prepare(
        `SELECT id, external_id, order_date, order_status, archived_at
         FROM orders WHERE id = ? LIMIT 1`
      ).bind(orderId).first<Record<string, unknown>>();
      if (!existing?.id) throw new Error('Order not found');
      if (normalizeOrderStatus(existing.order_status) === 'archived' || cleanText(existing.archived_at)) {
        throw new CriticalOperationConflictError('Нельзя добавлять оплату в архивный заказ.');
      }
      if (normalizeOrderStatus(existing.order_status) === 'deleted') {
        throw new CriticalOperationConflictError('Нельзя добавлять оплату в удалённый заказ.');
      }

      const ledger = await readOrderFinancialLedger(db, orderId);
      if (paymentKind === 'debt_close' && ledger.returnAmount > 0) {
        throw new CriticalOperationConflictError('По заказу уже оформлен возврат. Обычное закрытие долга недоступно.');
      }
      if (ledger.debtAmount <= 0) {
        throw new CriticalOperationConflictError('Долг по заказу уже закрыт.');
      }
      if (amount > ledger.debtAmount) {
        throw new CriticalOperationConflictError(`Сумма оплаты ${amount} больше текущего долга ${ledger.debtAmount}.`);
      }

      plan = {
        orderId,
        externalId: cleanText(existing.external_id),
        paymentDate: paymentKind === 'primary' ? normalizeDate(existing.order_date) : requestedPaymentDate,
        method,
        amount,
        paymentKind,
        comment,
        timestamp: new Date().toISOString(),
      };
      context = { ...context, plan };
      await advanceCriticalOperation(db, criticalOperation, 'validated', { context });
    }

    let paymentId = toInt(context.paymentId, 0);
    if (criticalOperation.row.step === 'validated') {
      const mapped = await insertCriticalMappedEntity(
        db,
        criticalOperation,
        'payment',
        'manual_order_payment',
        db.prepare(
          `INSERT INTO payments (order_id, payment_date, method, amount, payment_kind, comment, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          plan.orderId,
          plan.paymentDate,
          plan.method,
          plan.amount,
          plan.paymentKind,
          plan.comment || null,
          plan.timestamp,
        ),
      );
      paymentId = mapped.id;
      context = { ...context, paymentId };
      await advanceCriticalOperation(db, criticalOperation, 'payment_written', {
        targetType: 'payment',
        targetId: paymentId,
        targetRef: plan.externalId,
        context,
      });
    }

    if (criticalOperation.row.step === 'payment_written') {
      const event = financialEventStatement(db, {
        eventKey: `192b2a4:${criticalOperation.requestId}:manual-payment`,
        orderId: plan.orderId,
        externalOrderId: plan.externalId,
        eventDate: plan.paymentDate,
        eventAt: plan.timestamp,
        eventType: financialOperationTypeFromPaymentKind(plan.paymentKind),
        amountDelta: plan.amount,
        paymentMethod: plan.method,
        sourceType: 'payment',
        sourceId: paymentId || null,
        sourceRef: `payments:${paymentId || 'pending'}`,
        reason: 'payment_added',
        comment: plan.comment || null,
      });
      const syncOrder = db.prepare(
        `UPDATE orders
         SET received_amount = COALESCE((
               SELECT SUM(CASE WHEN COALESCE(p.amount, 0) > 0 THEN p.amount ELSE 0 END)
               FROM payments p WHERE p.order_id = orders.id
             ), 0),
             return_amount = COALESCE((
               SELECT SUM(CASE WHEN COALESCE(r.amount, 0) > 0 THEN r.amount ELSE 0 END)
               FROM returns r
               WHERE r.order_id = orders.id AND COALESCE(r.status, 'completed') <> 'cancelled'
             ), 0),
             debt_amount = MAX(0, COALESCE(total_amount, 0) - COALESCE((
               SELECT SUM(CASE WHEN COALESCE(p.amount, 0) > 0 THEN p.amount ELSE 0 END)
               FROM payments p WHERE p.order_id = orders.id
             ), 0)),
             updated_at = ?
         WHERE id = ?`
      ).bind(plan.timestamp, plan.orderId);
      await db.batch([event, syncOrder]);
      await advanceCriticalOperation(db, criticalOperation, 'ledger_synced', { context });
    }

    if (criticalOperation.row.step !== 'ledger_synced') {
      throw new CriticalOperationConflictError('Оплата находится в неизвестной фазе восстановления. Повторите действие.');
    }

    const response = {
      ok: true,
      orderId: plan.orderId,
      paymentId: paymentId || toInt(criticalOperation.row.target_id, 0) || null,
      externalOrderId: plan.externalId,
      amount: plan.amount,
      method: plan.method,
      createdAt: plan.timestamp,
      refreshRequired: true,
    };
    await completeCriticalOperation(db, criticalOperation, response);
    return { ...response, replayed: false };
  } catch (error) {
    await failCriticalOperation(db, criticalOperation, error);
    throw error;
  }
}

