import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const utils = read('src/app/utils.ts')
  const returns = read('src/features/sections/OrderReturnsSection.tsx')
  const exchange = read('src/features/sections/OrderExchangeSection.tsx')

  check(
    utils.includes("physicalState: (sourceType === 'workshop' ? 'no_stock' : 'pending')"),
    'Workshop Return drafts no longer default to no-stock',
  )
  const exchangeDraftStart = utils.indexOf('export function createExchangeDraft(')
  const exchangeDraftBody = exchangeDraftStart >= 0 ? utils.slice(exchangeDraftStart, utils.indexOf('\n}', exchangeDraftStart) + 2) : ''
  check(
    exchangeDraftBody.includes("oldPhysicalState: firstItem?.sourceType === 'workshop'") &&
      exchangeDraftBody.includes("? 'no_stock'") &&
      exchangeDraftBody.includes("order?.shipping_status === 'sent'") &&
      exchangeDraftBody.includes(": 'not_issued'"),
    'Workshop Exchange old-item drafts no longer default to no-stock',
  )

  const exchangeDefaultStart = exchange.indexOf('const defaultOldPhysicalStateForItem =')
  const exchangeDefaultEnd = exchange.indexOf('const resetObservedStock', exchangeDefaultStart)
  const exchangeDefaultHelper = exchangeDefaultStart >= 0 && exchangeDefaultEnd > exchangeDefaultStart
    ? exchange.slice(exchangeDefaultStart, exchangeDefaultEnd)
    : ''
  check(
    exchangeDefaultHelper.includes("item?.sourceType === 'workshop'") &&
      exchangeDefaultHelper.includes("? 'no_stock'"),
    'Changing the Exchange old item can preserve an unsafe Workshop stock disposition',
  )
  check(
    exchange.includes('oldPhysicalState: defaultOldPhysicalStateForItem(selectedItem)'),
    'Changing the Exchange old item no longer uses the guarded physical-state default',
  )
  check(
    returns.includes('Для вещи из Цеха по умолчанию остаток не создаётся') &&
      exchange.includes('Для вещи из Цеха по умолчанию остаток не создаётся'),
    'Workshop no-stock default is not explained in Return/Exchange UI',
  )

  console.log('STAGE02 PHASE1B WORKSHOP DISPOSITION R1 TESTS PASSED — Workshop-origin old items still default to no-stock; later revisions may expand explicit destinations without changing that default.')
} catch (error) {
  console.error(`STAGE02 PHASE1B WORKSHOP DISPOSITION R1 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
