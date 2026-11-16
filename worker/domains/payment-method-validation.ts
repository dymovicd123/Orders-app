// Validate reference-owned payment channels only for newly posted money.
// Existing historical rows remain readable even if a method is later disabled.
import { upperText } from '../core/text.ts'

export async function assertActivePaymentMethod(
  db: D1Database,
  value: unknown,
  label = 'Способ оплаты',
): Promise<string> {
  const method = upperText(value).replace(/\s+/g, ' ').trim()
  if (!method) throw new Error(`${label}: выберите способ из справочника.`)
  const matched = await db.prepare(
    `SELECT value FROM reference_values
     WHERE kind = 'payment_method' AND is_active = 1
       AND UPPER(TRIM(value)) = ? LIMIT 1`,
  ).bind(method).first<{ value: string }>()
  if (!matched) throw new Error(`${label} «${method}» отсутствует среди активных способов оплаты.`)
  return upperText(matched.value)
}

export async function assertActivePaymentMethods(db: D1Database, values: unknown[]): Promise<void> {
  const distinct = new Set(values.map(value => upperText(value)).filter(Boolean))
  for (const method of distinct) await assertActivePaymentMethod(db, method)
}
