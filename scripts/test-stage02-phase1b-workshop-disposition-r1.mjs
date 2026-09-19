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
    utils.includes("physicalState: (item.sourceType === 'workshop' ? 'no_stock' : 'pending')"),
    'Workshop Return drafts no longer default to no-stock',
  )
  check(
    utils.includes("oldPhysicalState: firstItem?.sourceType === 'workshop' ? 'no_stock' : 'pending'"),
    'Workshop Exchange old-item drafts no longer default to no-stock',
  )
  check(
    exchange.includes("oldPhysicalState: selectedItem?.sourceType === 'workshop' ? 'no_stock' : 'pending'"),
    'Changing the Exchange old item can preserve an unsafe stock disposition',
  )
  check(
    returns.includes("item.sourceType !== 'workshop' ? <option value=\"boutique\">") &&
      exchange.includes("!effectiveOldItemIsWorkshop ? <option value=\"boutique\">"),
    'Workshop-origin old items can again be routed to Boutique in the UI',
  )
  check(
    returns.includes('Для вещи из Цеха по умолчанию остаток не создаётся') &&
      exchange.includes('Для вещи из Цеха по умолчанию остаток не создаётся'),
    'Workshop no-stock default is not explained in Return/Exchange UI',
  )

  console.log('STAGE02 PHASE1B WORKSHOP DISPOSITION R1 TESTS PASSED — Workshop-origin old items default to no-stock and Boutique remains unavailable.')
} catch (error) {
  console.error(`STAGE02 PHASE1B WORKSHOP DISPOSITION R1 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
