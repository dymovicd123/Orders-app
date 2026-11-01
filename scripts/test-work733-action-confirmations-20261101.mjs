// Work #733: browser confirm must never block the test/user browser or hide
// what physical/financial operation is about to be committed.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const sources=[
 'src/App.tsx',
 'src/features/sections/OrdersTableSection.tsx',
 'src/features/sections/InventorySection.tsx',
]
let total=0
for(const path of sources){
 const text=readFileSync(path,'utf8')
 assert(!/window\.confirm\s*\(/.test(text),path+' still blocks browser with native confirm')
 const count=(text.match(/await askActionConfirmation\s*\(/g)||[]).length
 assert(count>0,path+' must explicitly await in-app approval')
 total+=count
}
assert(total>=28,'Retain every existing confirmation, not silently remove them: '+total)
const app=readFileSync('src/App.tsx','utf8')
assert(app.includes('<ActionConfirmationModal message={actionConfirmationMessage}'))
assert(app.includes('<InventorySection ctx={{ askActionConfirmation,'))
assert(app.includes('<OrdersTableSection ctx={{ askActionConfirmation,'))
assert(app.includes('if (actionConfirmationResolver.current) { resolve(false); return }'),
 'Rapid second click must not open a second confirm or authorize operation')
const modal=readFileSync('src/features/orders/ActionConfirmationModal.tsx','utf8')
for(const text of ['role="alertdialog"','aria-modal="true"',"event.key === 'Escape'",'onDecision(false)','onDecision(true)','Отмена — ничего не менять','Да, выполнить действие','previous.focus()']){
 assert(modal.includes(text),'Native dialog must support '+text)
}
assert(modal.includes('message.trim().split'), 'Never lose the existing order / SKU / money / stock consequences')
console.log('WORK733_ALL_NONBLOCKING_CONFIRMATIONS_PASS: '+total+' mandatory approvals preserved')
