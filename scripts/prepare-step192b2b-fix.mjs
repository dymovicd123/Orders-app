import fs from 'node:fs'
import path from 'node:path'

await import('./prepare-step192b2b.mjs')

const helperPath = path.join(process.cwd(), 'src/features/inventory/movementPickerB2B.ts')
let helper = fs.readFileSync(helperPath, 'utf8')
const before = `  let operationVisibleRows = sortedRows
  if (!searchActive && sortedRows.length > TRANSFER_DEFAULT_ROW_LIMIT) {`
const after = `  let operationVisibleRows = sortedRows
  const defaultRowLimit = sortedRows.some((row) => numberValue(row?.quantity) > 0)
    ? TRANSFER_DEFAULT_ROW_LIMIT
    : TRANSFER_RECOVERY_ROW_LIMIT
  if (!searchActive && sortedRows.length > defaultRowLimit) {`
if (!helper.includes(before)) throw new Error('B2B recovery-limit anchor missing')
helper = helper.replace(before, after)
fs.writeFileSync(helperPath, helper, 'utf8')
console.log('STEP 192B2B recovery-only limit corrected.')
