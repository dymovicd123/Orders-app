// UI regression: reference-backed selectors and role-independent metadata
// action live inside the existing extra-actions expander, including on legacy
// orders that are not eligible for the price-correction action.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const app=readFileSync('src/App.tsx','utf8')
const server=readFileSync('worker/domains/orders-write.ts','utf8')
const start=ui.indexOf('className="order-extra-actions"')
const end=ui.indexOf('{isAdmin && !retainedOnly && !archived ? (',start)
assert(start>0 && end>start,'Extra actions section missing')
const actions=ui.slice(start,end)
assert(actions.includes('Доп. действия'),'Menu trigger must remain')
assert(actions.includes('aria-expanded={extraActionsOrderId === order.id}'),'Menu expanded state must be tracked')
assert(actions.includes('{extraActionsOrderId === order.id ? ('),'Metadata correction must be inside the expanded menu')
assert(actions.includes('Исправить реквизиты'),'Metadata correction action missing')
assert(actions.indexOf('Доп. действия') < actions.indexOf('Исправить реквизиты'),'Metadata correction must follow the expand trigger')
assert(!ui.slice(0,start).includes('Исправить реквизиты'),'No separate metadata correction shortcut should remain outside the menu')
assert(ui.includes("{!retainedOnly && !archived && !projection.deleted ? ("),'Extra actions must remain available on normal active orders')
assert(actions.includes("extraActionsOrderId === order.id && order.pricing_mode === 'itemized_v1'"),'Price correction must remain restricted to eligible itemized orders')
assert((app.match(/shippingStatusLabel, suggestionValues, busy, changeOrderPage/g)||[]).length===2,
  'Cities and delivery reference lists must reach both Kaspi and ordinary order contexts')

const modal=ui.slice(ui.indexOf('{metadataDraft ? ('),ui.lastIndexOf('</article>'))
assert(modal.includes("key==='city'||key==='deliveryType' ? ("),'City and delivery must use select, not text input')
assert(modal.includes('<select')&&modal.includes('<option value="">Не указано</option>'),
  'Reference-backed dropdown and empty-value choice are required')
assert(modal.includes("key==='city'?suggestionValues?.cities:suggestionValues?.deliveryTypes"),
  'Dropdown choices must come from the same reference lists as order creation')
assert(modal.includes("String(metadataDraft.next[key]||'').trim()"),
  'Legacy values missing from current references must remain available')
assert(modal.includes('[...new Set(['),'Repeated reference values should not duplicate options')
assert(modal.includes("['deliveryType','Способ доставки']"),'Delivery label missing')
assert(modal.includes("type={key==='orderDate'?'date':'text'}"),
  'Existing name/phone/date controls must remain')
assert(!/key==='city'\s*\?\s*'date'\s*:\s*'text'/.test(modal),
  'City must not be a manually typed input')
assert(modal.includes('onChange={(event)=>setMetadataDraft((d)=>d?{'),
  'Selectors must update only draft metadata')
assert(server.includes("field==='requestId'||field==='metadataCorrection'"),
  'Backend must still reject mixed money/stock payloads')
assert(server.includes("SET order_date=?,customer_id=?,city=?,delivery_type=?,comment=?,updated_at=?"),
  'Backend must still update only allowlisted fields')
console.log('METADATA_REFERENCE_DROPDOWNS_AND_COLLAPSED_EXTRA_ACTIONS_PASSED')
