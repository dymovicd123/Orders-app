import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source=readFileSync('src/app/utils.ts','utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const {createReturnDraft}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
const order={
  shipping_status:'sent',
  items:[
    {id:101,productName:'ЭТНО КАРДИГАН',gender:'ЖЕН',color:'СИНИЙ',material:'ШЕРСТЬ',length:'ДЛИННЫЙ',size:'46',quantity:1,availableOperationQuantity:1,stockWriteoffStatus:'fulfilled',sourceType:'warehouse'},
    {id:102,productName:'ЭТНО КАРДИГАН',gender:'МУЖ',color:'БЕЖЕВЫЙ',material:'ХЛОПОК',length:'КОРОТКИЙ',size:'52',quantity:1,availableOperationQuantity:1,stockWriteoffStatus:'fulfilled',sourceType:'warehouse'},
  ],
}
const draft=createReturnDraft(order)
assert.equal(draft.items.length,2)
const a=draft.items.find(x=>x.orderItemId===101),b=draft.items.find(x=>x.orderItemId===102)
assert(a&&b)
for(const field of ['gender','color','material','length','size']){
  assert.equal(a[field],order.items[0][field],field+' first')
  assert.equal(b[field],order.items[1][field],field+' second')
}
assert.equal(a.productName,b.productName,'same model must remain distinct order items')
assert.notEqual(a.color,b.color)
assert.equal(a.quantity,1,'Sent issued first SKU should be selected when Return form opens')
assert.equal(b.quantity,1,'Sent issued second SKU should be selected separately')
assert.equal(a.physicalState,'pending','Preselected goods must not be recorded as physically received')
assert.equal(b.physicalState,'pending')
assert.equal(a.restock,false)
assert.equal(b.restock,false)

const partiallySent=createReturnDraft({...order,shipping_status:'partially_sent'})
assert(partiallySent.items.every(x=>x.quantity===0),
  'Partially sent order must not auto-select unverified or not-yet-sent quantities')
const notSent=createReturnDraft({...order,shipping_status:'not_sent'})
assert(notSent.items.every(x=>x.quantity===0),
  'Unsent order must still require explicit choice, even with legacy fulfilled stock state')
const mixed=createReturnDraft({...order,items:[
  {...order.items[0],id:103,availableOperationQuantity:1},
  {...order.items[1],id:104,stockWriteoffStatus:'pending_reservation',availableOperationQuantity:2},
  {id:105,productName:'Цеховая вещь',sourceType:'workshop',quantity:2,availableOperationQuantity:1,stockWriteoffStatus:''},
  {...order.items[0],id:106,availableOperationQuantity:0},
]})
assert.equal(mixed.items.length,3,'Already returned/zero available item must not be included')
assert.equal(mixed.items.find(x=>x.orderItemId===103)?.quantity,1)
assert.equal(mixed.items.find(x=>x.orderItemId===104)?.quantity,0,
  'A line with unresolved/non-issued stock must not be silently selected')
assert.equal(mixed.items.find(x=>x.orderItemId===104)?.issuedToClient,false)
const workshop=mixed.items.find(x=>x.orderItemId===105)
assert.equal(workshop?.quantity,1,'Workshop item in sent order should be selected within available limit')
assert.equal(workshop?.maxQuantity,1)
assert.equal(workshop?.physicalState,'pending',
  'Workshop item must remain awaiting actual intake, never be pre-marked no_stock received')
assert.equal(workshop?.restock,false,'Preselection must never create stock')
const ui=readFileSync('src/features/sections/OrderReturnsSection.tsx','utf8')
assert.match(ui,/<small className="return-smart-characteristics">\{formatReturnItemCharacteristics\(item\)\}<\/small>/)
assert.match(ui,/\['Цвет', item\.color\]/)
assert.match(ui,/\['Материал', item\.material\]/)
assert.match(ui,/\['Размер\/возраст', item\.size\]/)
assert(ui.indexOf('<small className="return-smart-characteristics">')>ui.indexOf('<strong>{item.productName}</strong>'))
const css=readFileSync('src/styles/194-return-smart-ux.css','utf8')
assert(css.includes('.return-smart-main .return-smart-characteristics'))
console.log('RETURN_VARIANT_CHARACTERISTICS_PASS')
