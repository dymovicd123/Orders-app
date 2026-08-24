import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const sourcePath = path.join(root, 'scripts/prepare-step192b2b.mjs')
let source = fs.readFileSync(sourcePath, 'utf8')

const nestedTemplateReplacements = [
  ["`Исполнение: ${executionParts.join(' · ')}`", "\\`Исполнение: \\${executionParts.join(' · ')}\\`"],
  ["`B2B helper marker missing: ${marker}`", "\\`B2B helper marker missing: \\${marker}\\`"],
  ["`Source-mismatch recovery path changed or missing: ${marker}`", "\\`Source-mismatch recovery path changed or missing: \\${marker}\\`"],
  ["`B2B CSS marker missing: ${marker}`", "\\`B2B CSS marker missing: \\${marker}\\`"],
  ["`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`", "\\`data:text/javascript;base64,\\${Buffer.from(transpiled).toString('base64')}\\`"],
  ["`ЦВЕТ ${index + 1}`", "\\`ЦВЕТ \\${index + 1}\\`"],
  ["`${row.color} · ${row.size}`", "\\`\\${row.color} · \\${row.size}\\`"],
  ["`STEP 192B2B MOVEMENT PICKER UX TESTS FAILED: ${error?.message || error}`", "\\`STEP 192B2B MOVEMENT PICKER UX TESTS FAILED: \\${error?.message || error}\\`"],
  ["split(/\\s+/).filter(Boolean)", "split(/\\\\s+/).filter(Boolean)"],
  ["check(!/\\buse(?:State|Effect|Memo|Ref|Callback)\\s*\\(/.test(helperSource)", "check(!/\\\\buse(?:State|Effect|Memo|Ref|Callback)\\\\s*\\\\(/.test(helperSource)"],
]

for (const [before, after] of nestedTemplateReplacements) {
  if (!source.includes(before)) throw new Error(`B2B generator nested-template anchor missing: ${before}`)
  source = source.replace(before, after)
}

const runtimePath = path.join(os.tmpdir(), `orders-app-step192b2b-${process.pid}-${Date.now()}.mjs`)
fs.writeFileSync(runtimePath, source, 'utf8')
try {
  await import(pathToFileURL(runtimePath).href)
} finally {
  try { fs.unlinkSync(runtimePath) } catch {}
}

const helperPath = path.join(root, 'src/features/inventory/movementPickerB2B.ts')
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
console.log('STEP 192B2B generator parsing, regex escaping and recovery-only limit corrected.')
