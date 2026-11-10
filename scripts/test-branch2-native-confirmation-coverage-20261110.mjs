import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:tsx?|jsx?)$/.test(entry.name) ? [path] : []
  })
}

const files = sourceFiles('src')
const nativeDialog = /\b(?:window|globalThis)\s*\.\s*(?:confirm|prompt)\s*\(|(?<![\w.$])(?:confirm|prompt)\s*\(/g
const matches = []
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  for (const found of source.matchAll(nativeDialog)) {
    const before = source.slice(0, found.index)
    const line = before.split('\n').length
    matches.push(relative('.', file) + ':' + line + ' ' + source.split('\n')[line - 1].trim().slice(0, 160))
  }
}

assert.deepEqual(matches, [], 'Native browser confirmation blocks employee workflows; use the shared in-app dialog.')
const app = readFileSync('src/App.tsx', 'utf8')
const modal = readFileSync('src/components/dialogs/ActionConfirmationModal.tsx', 'utf8')
assert(app.includes('<ActionConfirmationModal message={actionConfirmationText} onDecision={answerActionConfirmation} />'))
assert(app.includes('askActionConfirmation'))
assert(modal.includes('role="alertdialog"'))
assert(modal.includes('aria-modal="true"'))
assert(modal.includes("event.key === 'Escape'"))
assert(modal.includes('cancelRef.current?.focus()'))
assert(modal.includes('previousFocus.focus()'))
assert(app.includes('<InventorySection ctx={{ askActionConfirmation'))
assert(app.includes('<OrdersTableSection ctx={{'))
console.log('BRANCH2_UNIFIED_CONFIRMATION_COVERAGE_PASS', JSON.stringify({ scannedFiles: files.length, remainingNativeDialogs: 0 }))
