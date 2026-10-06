import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const app = read('src/App.tsx')
const types = read('src/app/types.ts')
const constants = read('src/app/constants.ts')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const migration = read('migrations/0075_v72_zammler_workshop_due_time.sql')

check(types.includes("'create' | 'zammler' | 'list'"), 'Internal specialized create subview disappeared')
check(constants.includes("{ id: 'kaspi', label: 'Kaspi'"), 'Specialized Kaspi workspace is missing from the sidebar')
check(!constants.includes("{ kind: 'zammler', label: 'Создать заказ ЗАММЛЕР'"), 'Old ZAMMLER create tab still clutters the ordinary Orders workspace')
check(createUi.includes("zammlerMode ? 'Новый заказ Kaspi' : 'Новый заказ'"), 'Specialized create form was not moved to the Kaspi workspace')
check(createUi.includes("placeholder={zammlerMode ? 'Рекомендуется ЗАММЛЕР'"), 'Kaspi create no longer recommends ZAMMLER delivery')
check(!createUi.includes('value="ЗАММЛЕР" readOnly'), 'ZAMMLER delivery became an incorrect immutable Kaspi identity')
check(createUi.includes('value="КАСПИ МАГАЗИН" readOnly'), 'Kaspi create must keep the authoritative order payment method visible')
check(app.includes("deliveryType: 'ЗАММЛЕР'"), 'Kaspi draft delivery default missing')
check(app.includes("orderPaymentMethod: 'КАСПИ МАГАЗИН'"), 'Kaspi draft order-level payment identity missing')
check(app.includes("method: 'КАСПИ МАГАЗИН'"), 'Kaspi draft factual-payment convenience default missing')
check(app.includes("orderPanel === 'zammler' && field === 'sourceType' && value === 'workshop'"), 'Workshop source must preserve the established ZAMMLER urgency defaults inside Kaspi create')
check(app.includes("nextItem.workshopUrgent = true"), 'ZAMMLER Workshop line must default to urgent')
check(app.includes("nextItem.workshopDueDate = nextItem.workshopDueDate || current.orderDate"), 'ZAMMLER Workshop line must default due date to the order date')
check(app.includes("nextItem.workshopDueTime = nextItem.workshopDueTime || '20:00'"), 'ZAMMLER Workshop line must default due time to 20:00')
check(createUi.includes("'workshopDueDate'") && createUi.includes("'workshopDueTime'"), 'ZAMMLER due date/time must remain editable through the shared form')
check(!migration.includes("('delivery_type', 'ZAMMLER'") && !migration.includes("'ЗАММЛЕР'"), '0075 must not duplicate the pre-existing delivery reference')
check(!app.includes('marketplace_order') && !app.includes('kaspi_order'), 'No invented marketplace/Kaspi identifier is allowed')
check(!app.includes('zammler_orders'), 'Kaspi/ZAMMLER must keep using the normal orders model')

console.log('CLIENT-ZAMMLER-C / KASPI CREATE PASSED — the shared Create flow moved from an Orders tab into the Kaspi workspace, keeps ZAMMLER as an editable default, KASPI MAGAZIN as payment identity, and preserves Workshop deadline defaults without a parallel order model')
