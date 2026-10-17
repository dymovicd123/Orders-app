import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const table=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const worker=readFileSync('worker/domains/orders-write.ts','utf8')
const start=table.indexOf('{metadataDraft ? (')
const stop=table.indexOf('</form>',start)
assert(start>=0 && stop>start, 'Order metadata modal not found')
const form=table.slice(start,stop)
assert(!/\brequired(?:\s|=|>)/.test(form),'No metadata input can be marked required')
assert(!form.includes('!next.customerPhone.trim()||!next.customerName.trim()'),
  'Missing name or phone must not block a metadata edit')
assert(form.includes("if(next.orderDate.trim() && !/"),
  'Optional empty order date must not trigger invalid date error')
assert(form.includes('<option value="">Не указано</option>'),
  'City and delivery must still allow empty values')
assert(form.includes("['city','Город']") && form.includes("['deliveryType','Способ доставки']"),
  'Reference selectors were lost')
assert(worker.includes('orderDate:cleanText(rawMetadata.next.orderDate)||cleanText(existingAny.order_date)'),
  'Empty date must preserve previous business date instead of normalizing to today')
assert(worker.includes("if(actor?.role!=='admin' && cleanText(rawMetadata.next.orderDate)"),
  'Managers should not be blocked by an untouched date left empty')
assert(worker.includes('customer_name_override=?,city=?,delivery_type=?,comment=?,updated_at=?') &&
  worker.includes('customer_id=CASE WHEN ?') && worker.includes('ON CONFLICT(phone_normalized) DO NOTHING'),
  'Only metadata columns may be changed')
assert(worker.includes('rawMetadata.expectedState')&&worker.includes('ORDER_METADATA_STALE'),
  'CAS protection against concurrent money/order status changes is mandatory')
assert(!form.includes('Укажите имя и телефон клиента.'),
  'Obsolete mandatory-fields error must be removed')
console.log('OPTIONAL_METADATA_EMPTY_FIELDS_AND_PRESERVED_BUSINESS_DATE_PASSED')
