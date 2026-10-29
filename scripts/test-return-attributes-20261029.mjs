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
assert.equal(a.restock,false)
assert.equal(b.restock,false)
const ui=readFileSync('src/features/sections/OrderReturnsSection.tsx','utf8')
assert.match(ui,/<small className="return-smart-characteristics">\{formatReturnItemCharacteristics\(item\)\}<\/small>/)
assert.match(ui,/\['Цвет', item\.color\]/)
assert.match(ui,/\['Материал', item\.material\]/)
assert.match(ui,/\['Размер\/возраст', item\.size\]/)
assert(ui.indexOf('<small className="return-smart-characteristics">')>ui.indexOf('<strong>{item.productName}</strong>'))
const css=readFileSync('src/styles/194-return-smart-ux.css','utf8')
assert(css.includes('.return-smart-main .return-smart-characteristics'))
console.log('RETURN_VARIANT_CHARACTERISTICS_PASS')
