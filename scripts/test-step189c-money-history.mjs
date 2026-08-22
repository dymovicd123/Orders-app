import fs from 'node:fs'

import { readWorkerSource } from './lib/worker-source.mjs'
const read = (file) => fs.readFileSync(file, 'utf8')
const fail = (message) => { throw new Error(message) }

try {
  const migration = read('migrations/0058_v72_reliable_money_history.sql')
  const worker = readWorkerSource()
  const app = read('src/App.tsx')
  const renderer = read('src/features/renderers/FinanceDashboardRenderer.tsx')
  const types = read('src/app/types.ts')

  for (const marker of [
    'CREATE TABLE IF NOT EXISTS financial_events',
    'event_key TEXT NOT NULL UNIQUE',
    "financial_history_model', '189c-v1'",
    '189c:baseline:payment:',
    '189c:baseline:return:',
  ]) if (!migration.includes(marker)) fail(`0058 marker отсутствует: ${marker}`)
  if (/CREATE\s+TRIGGER/i.test(migration)) fail('0058 не должен использовать payment triggers: retention cleanup не является денежной операцией.')
  if (/financial_events[\s\S]{0,700}REFERENCES\s+orders/i.test(migration)) fail('financial_events не должен иметь FK на orders: retention должен уметь удалить старую детализацию.')
  if (/\bUNION\b/i.test(migration)) fail('0058 не должен использовать compound SELECT.')

  for (const marker of [
    "reliableMoneyHistory: '189c'",
    "url.pathname === '/api/finance/money-history'",
    'async function listFinancialHistory',
    'buildPaymentAndMoneyEventStatements',
    'removeOrderPaymentsWithMoneyEvents',
    'removeSinglePaymentWithMoneyEvent',
    'refundMoneyEventStatement',
    'refundReversalMoneyEventStatement',
  ]) if (!worker.includes(marker)) fail(`Worker marker отсутствует: ${marker}`)

  const cleanup1906c = worker.includes("deadLegacyCleanup: '1906c'")
  const orderSaveIntegrity192b2a4 = worker.includes("orderCreateSaveIntegrity: '192b2a4'")
  const rawMutations = [...worker.matchAll(/(?:INSERT INTO payments|DELETE FROM payments|UPDATE payments)/g)].map((m) => m.index)
  const expectedRawMutations = cleanup1906c ? (orderSaveIntegrity192b2a4 ? 4 : 3) : 5
  if (rawMutations.length !== expectedRawMutations) {
    fail(`Неожиданное число прямых payment mutations: ${rawMutations.length} (ожидалось ${expectedRawMutations}: ${cleanup1906c ? (orderSaveIntegrity192b2a4 ? 'действующие money helpers + retry-safe manual payment Step 192B2A4' : 'только действующие money helpers после удаления legacy import runtime') : 'import cleanup + money helpers'}).`)
  }
  if (orderSaveIntegrity192b2a4) {
    for (const marker of [
      'createManualOrderPaymentCritical',
      "beginCriticalOperation(db, 'order_payment_create'",
      "'manual_order_payment'",
      'insertCriticalMappedEntity(',
      'financialEventStatement(db, {',
      'await db.batch([',
      'completeCriticalOperation(db, criticalOperation',
    ]) if (!worker.includes(marker)) fail(`Step 192B2A4 manual payment guard отсутствует: ${marker}`)
  }
  if (cleanup1906c && worker.includes('/api/import/')) fail('Step 190.6C: legacy import routes не должны оставаться источником payment mutations.')

  for (const marker of [
    "import './styles/189c-reliable-money-history.css'",
    'loadMoneyHistory',
    'moneyHistorySummary',
    'moneyHistoryType',
  ]) if (!app.includes(marker)) fail(`App marker отсутствует: ${marker}`)
  for (const marker of [
    '<h3>История денег</h3>',
    'Здесь видно, как менялись деньги в системе',
    'Поступления',
    'Списания и возвраты',
    'Исправления и отмены',
    'Показать ещё',
  ]) if (!renderer.includes(marker)) fail(`Finance UI marker отсутствует: ${marker}`)
  if (renderer.includes('<h3>Построчный денежный журнал</h3>')) fail('Старый изменяемый payment-ledger всё ещё показан как исторический журнал.')
  for (const marker of ['export type FinancialHistoryEntry', 'export type FinancialHistoryResponse']) if (!types.includes(marker)) fail(`Types marker отсутствует: ${marker}`)

  console.log('Step 189C reliable money history static tests: OK')
} catch (error) {
  console.error(`Step 189C reliable money history static tests FAILED: ${error?.message || error}`)
  process.exit(1)
}
