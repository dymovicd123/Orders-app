import fs from 'node:fs'
import assert from 'node:assert/strict'

// UI regression for stage 4. No network, remote DB or browser writes.
const ui=fs.readFileSync('src/features/inventory/views/renderInventoryAttentionPanel.tsx','utf8')
const css=fs.readFileSync('src/styles/stock-attention-human-friendly.css','utf8')
const backend=fs.readFileSync('worker/domains/warehouse-attention.ts','utf8')
const screen=ui.slice(ui.indexOf("{items && attentionCategory === 'shortage'"),ui.indexOf("{items && attentionCategory === 'handover'"))
assert(screen.length>1000)
assert(screen.includes('Числится в системе') && screen.includes('Нужно для заказов') && screen.includes('Разница'))
assert(screen.includes('item.countRelevantReserved ?? item.reserved'),
  'Exclude reservations requiring separate handover from actionable shortage explanation')
assert(screen.includes('Number(item.physical)'),'Display database stock as a number, not a physical count')
assert(!screen.includes('На месте {item.physical}'),
  'A D1 inventory balance must never be presented as a fresh human physical count')
assert(screen.includes('Это данные учёта, <strong>не свежий пересчёт</strong>'),
  'Card must explain the physical stocktake evidence boundary')
assert(screen.includes('Посмотреть историю') && screen.includes('Открыть заказ'),
  'Direct access to exact variant/source history and linked order must survive')
assert(screen.indexOf('Посмотреть историю</button>') < screen.indexOf('После проверки — оформить действие'),
  'Investigation precedes inventory mutation actions')
assert(screen.includes('<details className="inventory-attention-safe-operations">'),
  'Post-verification mutation tools must not be prominent before reviewing evidence')
assert(screen.includes('isAdmin ? <button') && screen.includes('Оформить фактический приход'),
  'Arrival still admin scoped; never hidden behind automatic mutation')
assert(screen.includes('Корректировка после пересчёта')&&screen.includes('openAttentionCorrection(item)'),
  'Selective exact SKU correction must remain available after review')
assert(!screen.includes('saveInventoryMovement(') && !screen.includes('quickInventoryStocktake('),
  'Problem list must not itself write stock')
assert(backend.includes('countRelevantReserved')&&backend.includes('fullyExplainedShortageKeys'),
  'Uncertain handover shortage categories must remain segregated')
assert(ui.includes('Не все вопросы здесь требуют действий склада.'),
  'Engineering catalog issues cannot be represented as confirmed staff errors')
assert(ui.includes('Уточнить выдачу в заказе')&&ui.includes('openAttentionHandover(item)'),
  'Handover action must be direct and truthful')
assert(css.includes('.inventory-attention-balance')&&css.includes('@media(max-width:520px)'),
  'Issue balance must be readable and responsive on small screens')
console.log('STAGE4_HUMAN_STOCK_PROBLEMS_UI_PASS: accounted-vs-physical truth, evidence-first, safe mutation, clear role boundaries, mobile')
