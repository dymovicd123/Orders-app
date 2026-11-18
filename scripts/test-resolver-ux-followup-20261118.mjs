import assert from 'node:assert/strict'
import fs from 'node:fs'
import {rankedProducts} from '../src/features/orders/catalogResolutionFlow.ts'

const products=[
  {id:1,name:'ЭТНО КӨЙЛЕК'},
  {id:2,name:'ЭТНО БОМБЕР'},
  {id:3,name:'ЭТНО ШАПАН'},
  {id:4,name:'ЭТНО КАМЗОЛ'},
  {id:5,name:'ЭТНО ЖИЛЕТ'},
  {id:6,name:'ЭТНО ПЛАТЬЕ'},
]
assert.equal(rankedProducts(products,'ЭТНО БОМБР')[0].product.id,2,'One-letter typo must rank closest entire model first')
assert.equal(rankedProducts(products,'ЭТНО БОМБЕР')[0].product.id,2,'Exact identity always wins')
assert.equal(rankedProducts(products,'ЭТНО ЖИЛЕТ')[0].product.id,5,'Other exact product wins')
assert.equal(rankedProducts(products,'ЭТНО')[0].score>0,true,'Partial query remains navigable')
assert.equal(rankedProducts(products,'ЭТНО БОМБР').length,products.length,'No candidate silently deleted')
const modal=fs.readFileSync('src/features/orders/OrderCatalogResolutionModal.tsx','utf8')
assert.match(modal,/\/api\/orders\/\$\{order\.id\}/,'Failed POST must verify authoritative order with a fresh GET')
assert.match(modal,/setConfirmed\(\{\}\)/,'Stale answer checkmarks must be cleared')
assert.match(modal,/setDraft\(null\)/,'Stale answer draft must not remain actionable')
assert.match(modal,/Повторно сохранять старый ответ не нужно/,'Manager must be told how to recover safely')
const editor=fs.readFileSync('src/features/sections/OrderEditorSection.tsx','utf8')
assert.match(editor,/compositionLockedAfterShipping/,'Shipment protection must precede editable line entry')
assert.match(editor,/itemizedMode&&!compositionLockedAfterShipping&&<ItemizedOrderEditorWorkspace/,'Already shipped composition editor must not be actionable')
console.log('RESOLVER_UX_FOLLOWUP_PASS: typo ranking, stale save readback and guarded composition editor')
