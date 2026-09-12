import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')
const utils = read('src/app/utils.ts')
const dashboard = read('src/features/sections/DashboardSection.tsx')
const app = read('src/App.tsx')
const text = read('worker/core/text.ts')
const ordersRead = read('worker/domains/orders-read.ts')
const workshop = read('worker/domains/workshop.ts')
const activity = read('worker/domains/activity.ts')
const team = read('worker/domains/team.ts')

assert.ok(utils.includes("const BUSINESS_TIME_ZONE = 'Asia/Almaty'"), 'Frontend business timezone must be explicit')
assert.ok(utils.includes('businessDateFormatter.formatToParts(value)'), 'Frontend business date must use timezone-aware parts')
assert.ok(utils.includes("timeZone: 'UTC'"), 'Month-only helpers must avoid browser timezone drift')
assert.ok(dashboard.includes("import { formatLocalDateInput } from '../../app/utils'"), 'Dashboard must reuse the business date helper')
assert.ok(!dashboard.includes('new Date().toISOString().slice(0, 10)'), 'Dashboard must not derive today from UTC')
assert.ok(app.includes("const today = formatLocalDateInput()"), 'Shipping date must use the business date')
assert.ok(!app.includes('new Date().toISOString().slice(0, 10)'), 'App business day must not use UTC slicing')
assert.ok(!app.includes('new Date().toISOString().slice(0, 7)'), 'App business month must not use UTC slicing')

assert.ok(text.includes("timeZone: 'Asia/Almaty'"), 'Worker business timezone must be explicit')
assert.ok(text.includes('const businessDate = (date = new Date()) =>'), 'Worker business date helper missing')
assert.ok(text.includes('if (!text) return businessDate();'), 'normalizeDate empty fallback must use business date')
assert.ok(text.includes('return businessDate(parsed);'), 'normalizeDate timestamps must resolve in business timezone')
assert.ok(!ordersRead.includes('const today = new Date().toISOString().slice(0, 10);'), 'Archive cutoff must not default through UTC')
assert.ok(workshop.includes("const today = normalizeDate('');"), 'Workshop periods must use business today')
assert.ok(activity.includes("const todayIso = normalizeDate('');"), 'Report default range must use business today')
assert.ok(team.includes("return normalizeDate('').slice(0, 7);"), 'Timesheet month must use business month')

const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' })
const businessDate = (iso) => {
  const parts = formatter.formatToParts(new Date(iso))
  const part = (type) => parts.find((entry) => entry.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
assert.equal(businessDate('2026-09-12T20:30:00.000Z'), '2026-09-13', 'Almaty day boundary must advance after 20:00 UTC')
assert.equal(businessDate('2026-09-30T20:30:00.000Z'), '2026-10-01', 'Almaty month boundary must advance after 20:00 UTC')

console.log('Business date boundary R1 regression: OK')
