import fs from 'node:fs'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'

const git = (args) => execFileSync('git', args, { encoding: 'utf8' })
function router(ref) {
  const text = ref === 'HEAD' ? fs.readFileSync('worker/index.ts', 'utf8') : git(['show', `${ref}:worker/index.ts`])
  const source = ts.createSourceFile('worker/index.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) return statement.getText(source)
  }
  throw new Error(`router export assignment missing at ${ref}`)
}
function contiguousDiff(before, after) {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  return {
    prefix,
    suffix,
    beforeBlock: before.slice(prefix, before.length - suffix),
    afterBlock: after.slice(prefix, after.length - suffix),
  }
}

const before = router('origin/main')
const current = router('HEAD')
const returnBefore = "const input = await readJson<{ requestId?: string; orderId?: number; returnDate?: string; amount?: number; paymentMethod?: string; comment?: string; restockSource?: unknown; items?: Array<{ orderItemId?: number; quantity?: number; amount?: number; restock?: boolean }> }>(request);"
const returnAfter = "const input = await readJson<{ requestId?: string; orderId?: number; returnDate?: string; amount?: number; paymentMethod?: string; comment?: string; restockSource?: unknown; items?: Array<{ orderItemId?: number; quantity?: number; amount?: number; restock?: boolean; physicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock' }> }>(request);"
const exchangeBefore = "const input = await readJson<{ requestId?: string; orderId?: number; exchangeDate?: string; oldItemId?: number; oldQuantity?: number; oldReturnSource?: unknown; newItem?: NonNullable<OrderInput['items']>[number]; newSourceWasManuallyChanged?: boolean; financialAction?: unknown; financialAmount?: number; paymentMethod?: string; comment?: string }>(request);"
const exchangeAfter = "const input = await readJson<{ requestId?: string; orderId?: number; exchangeDate?: string; oldItemId?: number; oldQuantity?: number; oldReturnSource?: unknown; oldPhysicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock'; newItem?: NonNullable<OrderInput['items']>[number]; newSourceWasManuallyChanged?: boolean; financialAction?: unknown; financialAmount?: number; paymentMethod?: string; comment?: string }>(request);"

for (const [label, haystack, needle] of [
  ['main return type', before, returnBefore],
  ['branch return type', current, returnAfter],
  ['main exchange type', before, exchangeBefore],
  ['branch exchange type', current, exchangeAfter],
]) {
  console.log(label, haystack.includes(needle))
}

let reverted = current.replace(returnAfter, returnBefore).replace(exchangeAfter, exchangeBefore)
const diff = contiguousDiff(before, reverted)
console.log('before length', before.length)
console.log('current length', current.length)
console.log('reverted length', reverted.length)
console.log('exact equal after type reversions', reverted === before)
console.log('prefix', diff.prefix, 'suffix', diff.suffix)
console.log('beforeBlock length', diff.beforeBlock.length)
console.log('afterBlock length', diff.afterBlock.length)
console.log('afterBlock has receive route marker', diff.afterBlock.includes("/api/returned-items/receive"))
console.log('BEFORE BLOCK >>>')
console.log(JSON.stringify(diff.beforeBlock))
console.log('<<< BEFORE BLOCK')
console.log('AFTER BLOCK >>>')
console.log(JSON.stringify(diff.afterBlock))
console.log('<<< AFTER BLOCK')
