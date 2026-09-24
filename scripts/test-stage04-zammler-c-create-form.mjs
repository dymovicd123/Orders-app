import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const types = read('src/app/types.ts')
const constants = read('src/app/constants.ts')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const migration = read('migrations/0075_v72_zammler_workshop_due_time.sql')

check(types.includes("'create' | 'zammler' | 'list'"), 'Dedicated ZAMMLER order panel missing')
check(constants.includes("{ kind: 'zammler', label: 'Создать заказ ЗАММЛЕР'"), 'ZAMMLER create tab missing or unclear')
check(createUi.includes("zammlerMode ? 'Новый заказ ЗАММЛЕР' : 'Новый заказ'"), 'Dedicated ZAMMLER form title missing')
check(createUi.includes('value="ЗАММЛЕР" readOnly'), 'ZAMMLER delivery must be visibly fixed in the dedicated form')
check(createUi.includes('value="КАСПИ МАГАЗИН" readOnly'), 'Primary payment method must be visibly fixed to KASPI MAGAZIN in the dedicated form')
check(app.includes("deliveryType: 'ЗАММЛЕР'"), 'ZAMMLER draft delivery default missing')
check(app.includes("method: 'КАСПИ МАГАЗИН'"), 'ZAMMLER draft payment method default missing')
check(app.includes("orderPanel === 'zammler' && field === 'sourceType' && value === 'workshop'"), 'Workshop source must trigger ZAMMLER urgency defaults')
check(app.includes("nextItem.workshopUrgent = true"), 'ZAMMLER workshop line must default to urgent')
check(app.includes("nextItem.workshopDueDate = nextItem.workshopDueDate || current.orderDate"), 'ZAMMLER workshop line must default due date to the order date')
check(app.includes("nextItem.workshopDueTime = nextItem.workshopDueTime || '20:00'"), 'ZAMMLER workshop line must default due time to 20:00')
check(createUi.includes("'workshopDueDate'") && createUi.includes("'workshopDueTime'"), 'ZAMMLER due date/time must remain editable through the shared form')
check(app.includes("payments[0] = { ...payments[0], method: 'КАСПИ МАГАЗИН' }"), 'Removing payments must not silently clear the fixed primary ZAMMLER payment method')
check(!migration.includes("('delivery_type', 'ZAMMLER'") && !migration.includes("'ЗАММЛЕР'"), '0075 must not duplicate the pre-existing delivery reference')
check(!app.includes('marketplace_order') && !app.includes('kaspi_order'), 'No invented marketplace/Kaspi identifier is allowed')
check(!app.includes('zammler_orders'), 'ZAMMLER must use the normal orders model')

console.log('STAGE04-ZAMMLER-C CREATE FORM PASSED — dedicated form reuses normal Create, fixes delivery/payment defaults, and only defaults existing Workshop urgency/date/time without a parallel order model')
