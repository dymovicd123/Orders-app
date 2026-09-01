from pathlib import Path

p = Path('scripts/test-step189c-money-history.mjs')
text = p.read_text()
old = """  const cleanup1906c = worker.includes(\"deadLegacyCleanup: '1906c'\")
  const orderSaveIntegrity192b2a4 = worker.includes(\"orderCreateSaveIntegrity: '192b2a4'\")
  const rawMutations = [...worker.matchAll(/(?:INSERT INTO payments|DELETE FROM payments|UPDATE payments)/g)].map((m) => m.index)
  const expectedRawMutations = cleanup1906c ? (orderSaveIntegrity192b2a4 ? 4 : 3) : 5
  if (rawMutations.length !== expectedRawMutations) {
    fail(`Неожиданное число прямых payment mutations: ${rawMutations.length} (ожидалось ${expectedRawMutations}: ${cleanup1906c ? (orderSaveIntegrity192b2a4 ? 'действующие money helpers + retry-safe manual payment Step 192B2A4' : 'только действующие money helpers после удаления legacy import runtime') : 'import cleanup + money helpers'}).`)
  }
"""
new = """  const cleanup1906c = worker.includes(\"deadLegacyCleanup: '1906c'\")
  const orderSaveIntegrity192b2a4 = worker.includes(\"orderCreateSaveIntegrity: '192b2a4'\")
  const orderEditPaymentMethodCorrection = worker.includes(\"reason: 'payment_method_correction'\")
  const rawMutations = [...worker.matchAll(/(?:INSERT INTO payments|DELETE FROM payments|UPDATE payments)/g)].map((m) => m.index)
  const paymentMethodCorrectionMutations = orderEditPaymentMethodCorrection ? 1 : 0
  const expectedRawMutations = (cleanup1906c ? (orderSaveIntegrity192b2a4 ? 4 : 3) : 5) + paymentMethodCorrectionMutations
  if (rawMutations.length !== expectedRawMutations) {
    fail(`Неожиданное число прямых payment mutations: ${rawMutations.length} (ожидалось ${expectedRawMutations}: действующие money helpers${orderSaveIntegrity192b2a4 ? ' + retry-safe manual payment' : ''}${orderEditPaymentMethodCorrection ? ' + точечное исправление способа оплаты без пересоздания payment' : ''}).`)
  }
  if (orderEditPaymentMethodCorrection) {
    for (const marker of [
      'UPDATE payments SET method = ? WHERE id = ? AND order_id = ?',
      \"eventType: 'payment_reversal'\",
      'eventType: correction.relatedType',
      'eventDate: correction.paymentDate',
      \"reason: 'payment_method_correction'\",
    ]) if (!worker.includes(marker)) fail(`Payment-method correction money-history guard отсутствует: ${marker}`)
  }
"""
if text.count(old) != 1:
    raise SystemExit('Step 189C raw payment mutation guard anchor changed')
p.write_text(text.replace(old, new, 1))
print('Step 189C payment-method correction allow-list extended')
