import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const ui = read('src/features/sections/OrderReturnsSection.tsx')
const css = read('src/styles/194-return-smart-ux.css')

check(ui.includes("import '../../styles/194-return-smart-ux.css'"), 'Return smart stylesheet is not loaded')
check(ui.includes('return-smart-grid') && ui.includes('return-smart-card') && ui.includes('return-smart-pick'), 'Return items are not selectable cards')
check(!ui.includes('className="data-table return-items-table"'), 'Legacy technical Return table is still rendered')
check(ui.includes("item.issuedToClient === false ? 'Не выдавали'"), 'Never-issued state is not obvious')
check(ui.includes('disabled={item.issuedToClient === false || returnBusy}'), 'Never-issued Return card can be selected')
check(ui.includes('const toggleReturnItem') && ui.includes('quantity: selected ? 0 : 1'), 'Card selection is not mapped to quantity')
check(ui.includes('maxQuantity > 1') && ui.includes('Все {maxQuantity}'), 'Multi-quantity controls are missing')
check(ui.includes('Где товар сейчас?') && ui.includes('Ещё едет обратно') && ui.includes('Уже вернули'), 'Physical state is not a simple choice')
check(ui.includes("physicalState: 'pending', restock: false"), 'Pending choice lost delayed-intake semantics')
check(
  ui.includes('const defaultReturnDestination =')
    && ui.includes("item.sourceType === 'workshop' || item.isWorkshop")
    && ui.includes("? 'no_stock'")
    && ui.includes("item.sourceType === 'boutique'")
    && ui.includes("? 'boutique'")
    && ui.includes("const physicalState = defaultReturnDestination(item)"),
  'Arrived Return no longer defaults by original source with Workshop staying no-stock',
)
check(ui.includes('<option value="warehouse">Склад</option>') && ui.includes('<option value="boutique">Бутик</option>') && ui.includes('<option value="no_stock">Не добавлять в остаток</option>'), 'Per-item stock disposition is missing')
check(ui.includes('selectedReturnLines.length') && ui.includes('selectedReturnQuantity'), 'Selected Return summary is missing')
check(ui.includes('Товары и деньги учитываются отдельно'), 'Goods and refund money were blurred again')

check(css.includes('.return-smart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))'), 'Desktop Return card grid missing')
check(css.includes('@media(max-width:900px){.return-smart-grid{grid-template-columns:1fr}}'), 'Return cards do not collapse on narrow screens')
check(css.includes('.return-smart-choice-row') && css.includes('.return-smart-card.is-selected'), 'Selected/physical visual states missing')

console.log('RETURN SMART UX R3 PASSED')
