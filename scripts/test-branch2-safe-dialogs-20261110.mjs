import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Inspect active application sources, not historical fixtures, migrations or source snapshots.
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? sources(full) : /\.(?:tsx?|jsx?)$/.test(entry.name) ? [full] : []
  })
}

const native = []
for (const file of sources('src')) {
  const text = readFileSync(file, 'utf8')
  const regex = /\bwindow\.(?:confirm|prompt)\s*\(/g
  for (const match of text.matchAll(regex)) {
    const line = text.slice(0, match.index).split('\n').length
    native.push(file + ':' + line + ': ' + match[0])
  }
}
assert.deepEqual(native, [], 'Active browser confirm/prompt must use the accessible shared dialogs')

const app = readFileSync('src/App.tsx', 'utf8')
assert(app.includes('<ActionConfirmationModal message={actionConfirmationText}'), 'Confirmation modal must be mounted')
assert(app.includes('<ActionTextPromptModal title={actionTextPrompt.title}'), 'Reason-input modal must be mounted')
assert(app.includes('actionConfirmationDecisionRef.current || actionTextDecisionRef.current'),
  'Concurrent unrelated confirmations must be refused')
assert(app.includes('askActionConfirmation={askActionConfirmation}'),
  'Catalog resolution must receive in-app approval')
for (const file of [
  'src/features/finance/cashRegisterActions.ts',
  'src/features/inventory/warehouseGovernanceActions.ts',
  'src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx',
  'src/features/workshop/WorkshopSettlementsPanel.tsx',
  'src/features/orders/orderCreationActions.ts',
  'src/features/orders/orderShippingHandoverActions.ts',
]) assert(readFileSync(file, 'utf8').includes('askActionConfirmation'),
  file + ' lost its guarded operation confirmation')
for (const file of [
  'src/features/finance/cashRegisterActions.ts',
  'src/features/workshop/WorkshopSettlementsPanel.tsx',
]) assert(readFileSync(file, 'utf8').includes('askActionTextPrompt'),
  file + ' must require an explicit written reason')

const promptModal = readFileSync('src/components/dialogs/ActionTextPromptModal.tsx', 'utf8')
const workshop = readFileSync('src/features/workshop/WorkshopSettlementsPanel.tsx', 'utf8')
assert(promptModal.includes('value.trim().length >= minLength'), 'Reason validation must happen before the modal closes')
assert(workshop.includes("askActionTextPrompt('Причина отмены выплаты (сохранится в истории)', '', 5)"),
  'Workshop payout cancellation reason must require at least 5 characters in the dialog')

console.log('BRANCH2_SAFE_DIALOGS_PASS: all active TS/TSX files have no native window.confirm/prompt, cash/workshop reasons and operation confirmations are wired')
