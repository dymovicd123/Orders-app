import assert from 'node:assert/strict'
import { assertActivePaymentMethod, assertActivePaymentMethods } from '../worker/domains/payment-method-validation.ts'

const methods = ['Перевод', 'ТЕРМИНАЛ', 'НАЛИЧКА']
const database = {
  prepare(sql) {
    assert.match(sql, /reference_values/)
    return {
      async all() {
        return { results: methods.map(value => ({ value })) }
      },
    }
  },
}

assert.equal(await assertActivePaymentMethod(database, 'пЕРЕВОД'), 'ПЕРЕВОД')
assert.equal(await assertActivePaymentMethod(database, ' ТЕРМИНАЛ '), 'ТЕРМИНАЛ')
await assertActivePaymentMethods(database, ['перевод', 'ТЕРМИНАЛ'])
await assert.rejects(assertActivePaymentMethod(database, ''), /выберите способ/)
await assert.rejects(assertActivePaymentMethod(database, '22500'), /отсутствует/)
await assert.rejects(assertActivePaymentMethod(database, 'KASPI'), /отсутствует/)
await assert.rejects(assertActivePaymentMethods(database, ['НАЛИЧКА', 'INVALID']), /отсутствует/)
console.log('PAYMENT_METHOD_REFERENCE_VALIDATION_PASS')
