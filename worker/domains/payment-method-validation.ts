// Validate reference-owned payment channels only for newly posted money.
// Existing historical rows remain readable even if a method is later disabled.
import { upperText } from '../core/text.ts'

export class PaymentMethodValidationError extends Error {
  readonly status = 400
  readonly code = 'payment_method_invalid'
}

export async function assertActivePaymentMethod(
  db: D1Database,
  value: unknown,
  label = 'Способ оплаты',
): Promise<string> {
  const method = upperText(value).replace(/\s+/g, ' ').trim()
  if (!method) throw new PaymentMethodValidationError(`${label}: выберите способ из справочника.`)
  // SQLite UPPER() does not case-fold Cyrillic, so compare in JS to recognize
  // e.g. "Перевод" and "ПЕРЕВОД" as the same reference value.
  const result = await db.prepare(
    `SELECT value FROM reference_values
     WHERE kind = 'payment_method' AND is_active = 1`,
  ).all<{ value: string }>()
  const matched = (result.results || []).find(row =>
    upperText(row.value).replace(/\s+/g, ' ').trim() === method
  )
  if (!matched) throw new PaymentMethodValidationError(`${label} «${method}» отсутствует среди активных способов оплаты.`)
  return upperText(matched.value)
}

export async function assertActivePaymentMethods(db: D1Database, values: unknown[]): Promise<void> {
  const distinct = new Set(values.map(value => upperText(value)).filter(Boolean))
  for (const method of distinct) await assertActivePaymentMethod(db, method)
}
