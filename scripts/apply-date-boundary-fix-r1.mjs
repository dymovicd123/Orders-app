import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function write(path, text) {
  fs.writeFileSync(path, text)
}

function replaceOnce(path, oldText, newText) {
  const source = read(path)
  const first = source.indexOf(oldText)
  if (first < 0) throw new Error(`Missing target in ${path}: ${oldText.slice(0, 120)}`)
  if (source.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`Target is not unique in ${path}: ${oldText.slice(0, 120)}`)
  write(path, source.slice(0, first) + newText + source.slice(first + oldText.length))
}

function replaceCount(path, oldText, newText, expectedCount) {
  const source = read(path)
  const count = source.split(oldText).length - 1
  if (count !== expectedCount) throw new Error(`Expected ${expectedCount} occurrences in ${path}, found ${count}: ${oldText}`)
  write(path, source.split(oldText).join(newText))
}

replaceOnce(
  'src/app/utils.ts',
  `export function formatLocalDateInput(value = new Date()) {\n  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000)\n  return local.toISOString().slice(0, 10)\n}\n\n\n\nexport function shiftLocalDate(days: number) {\n  const date = new Date()\n  date.setDate(date.getDate() + days)\n  return formatLocalDateInput(date)\n}\n\n\n\nexport function getPeriodRange(preset: OrderPeriodPreset) {\n  const today = formatLocalDateInput()\n  const now = new Date()\n  if (preset === 'today') return { dateFrom: today, dateTo: today }\n  if (preset === 'yesterday') {\n    const yesterday = shiftLocalDate(-1)\n    return { dateFrom: yesterday, dateTo: yesterday }\n  }\n  if (preset === 'year') {\n    return {\n      dateFrom: \`${'${now.getFullYear()}'}-01-01\`,\n      dateTo: \`${'${now.getFullYear()}'}-12-31\`,\n    }\n  }\n  if (preset === 'month') {\n    return {\n      dateFrom: \`${'${now.getFullYear()}'}-${'${String(now.getMonth() + 1).padStart(2, \'0\')}'}-01\`,\n      dateTo: today,\n    }\n  }\n  return {\n    dateFrom: '',\n    dateTo: '',\n  }\n}\n\n\n\nexport function getClosedArchiveMonth() {\n  const now = new Date()\n  const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)\n  const monthEnd = new Date(now.getFullYear(), now.getMonth(), 0)\n  const value = \`${'${monthStart.getFullYear()}'}-${'${String(monthStart.getMonth() + 1).padStart(2, \'0\')}'}\`\n  return {\n    value,\n    dateFrom: \`${'${value}'}-01\`,\n    dateTo: formatLocalDateInput(monthEnd),\n    label: monthStart.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),\n  }\n}\n\n\n\nexport function monthEndFromInput(value: string) {\n  const [yearText, monthText] = String(value || '').split('-')\n  const year = Number(yearText)\n  const month = Number(monthText)\n  if (!year || !month) return getClosedArchiveMonth().dateTo\n  return formatLocalDateInput(new Date(year, month, 0))\n}\n\n\n\nexport function monthStartFromInput(value: string) {\n  const [yearText, monthText] = String(value || '').split('-')\n  const year = Number(yearText)\n  const month = Number(monthText)\n  if (!year || !month) return getClosedArchiveMonth().dateFrom\n  return \`${'${year}'}-${'${String(month).padStart(2, \'0\')}'}-01\`\n}\n\n\n\nexport function monthLabelFromInput(value: string) {\n  const [yearText, monthText] = String(value || '').split('-')\n  const year = Number(yearText)\n  const month = Number(monthText)\n  if (!year || !month) return getClosedArchiveMonth().label\n  return new Date(year, month - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })\n}\n`,
  `const BUSINESS_TIME_ZONE = 'Asia/Almaty'\nconst businessDateFormatter = new Intl.DateTimeFormat('en-US', {\n  timeZone: BUSINESS_TIME_ZONE,\n  year: 'numeric',\n  month: '2-digit',\n  day: '2-digit',\n})\n\nfunction businessDateParts(value: Date) {\n  const parts = businessDateFormatter.formatToParts(value)\n  const year = parts.find((part) => part.type === 'year')?.value || ''\n  const month = parts.find((part) => part.type === 'month')?.value || ''\n  const day = parts.find((part) => part.type === 'day')?.value || ''\n  return { year, month, day }\n}\n\nexport function formatLocalDateInput(value = new Date()) {\n  const { year, month, day } = businessDateParts(value)\n  return \`${'${year}'}-${'${month}'}-${'${day}'}\`\n}\n\n\n\nexport function shiftLocalDate(days: number) {\n  const today = formatLocalDateInput()\n  const date = new Date(\`${'${today}'}T00:00:00.000Z\`)\n  date.setUTCDate(date.getUTCDate() + days)\n  return date.toISOString().slice(0, 10)\n}\n\n\n\nexport function getPeriodRange(preset: OrderPeriodPreset) {\n  const today = formatLocalDateInput()\n  const year = today.slice(0, 4)\n  const month = today.slice(5, 7)\n  if (preset === 'today') return { dateFrom: today, dateTo: today }\n  if (preset === 'yesterday') {\n    const yesterday = shiftLocalDate(-1)\n    return { dateFrom: yesterday, dateTo: yesterday }\n  }\n  if (preset === 'year') {\n    return {\n      dateFrom: \`${'${year}'}-01-01\`,\n      dateTo: \`${'${year}'}-12-31\`,\n    }\n  }\n  if (preset === 'month') {\n    return {\n      dateFrom: \`${'${year}'}-${'${month}'}-01\`,\n      dateTo: today,\n    }\n  }\n  return {\n    dateFrom: '',\n    dateTo: '',\n  }\n}\n\n\n\nexport function getClosedArchiveMonth() {\n  const today = formatLocalDateInput()\n  const year = Number(today.slice(0, 4))\n  const month = Number(today.slice(5, 7))\n  const previousMonth = new Date(Date.UTC(year, month - 2, 1))\n  const previousYear = previousMonth.getUTCFullYear()\n  const previousMonthNumber = previousMonth.getUTCMonth() + 1\n  const value = \`${'${previousYear}'}-${'${String(previousMonthNumber).padStart(2, \'0\')}'}\`\n  const lastDay = new Date(Date.UTC(previousYear, previousMonthNumber, 0)).getUTCDate()\n  return {\n    value,\n    dateFrom: \`${'${value}'}-01\`,\n    dateTo: \`${'${value}'}-${'${String(lastDay).padStart(2, \'0\')}'}\`,\n    label: previousMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }),\n  }\n}\n\n\n\nexport function monthEndFromInput(value: string) {\n  const [yearText, monthText] = String(value || '').split('-')\n  const year = Number(yearText)\n  const month = Number(monthText)\n  if (!year || !month) return getClosedArchiveMonth().dateTo\n  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()\n  return \`${'${year}'}-${'${String(month).padStart(2, \'0\')}'}-${'${String(lastDay).padStart(2, \'0\')}'}\`\n}\n\n\n\nexport function monthStartFromInput(value: string) {\n  const [yearText, monthText] = String(value || '').split('-')\n  const year = Number(yearText)\n  const month = Number(monthText)\n  if (!year || !month) return getClosedArchiveMonth().dateFrom\n  return \`${'${year}'}-${'${String(month).padStart(2, \'0\')}'}-01\`\n}\n\n\n\nexport function monthLabelFromInput(value: string) {\n  const [yearText, monthText] = String(value || '').split('-')\n  const year = Number(yearText)\n  const month = Number(monthText)\n  if (!year || !month) return getClosedArchiveMonth().label\n  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })\n}\n`,
)

replaceOnce(
  'src/features/sections/DashboardSection.tsx',
  `import { useMemo, useState } from 'react'\nimport '../../styles/dashboard-workshop-attention-r1.css'`,
  `import { useMemo, useState } from 'react'\nimport { formatLocalDateInput } from '../../app/utils'\nimport '../../styles/dashboard-workshop-attention-r1.css'`,
)
replaceCount('src/features/sections/DashboardSection.tsx', `new Date().toISOString().slice(0, 10)`, `formatLocalDateInput()`, 3)

replaceCount('src/App.tsx', `new Date().toISOString().slice(0, 7)`, `formatLocalDateInput().slice(0, 7)`, 2)
replaceCount('src/App.tsx', `new Date().toISOString().slice(0, 10)`, `formatLocalDateInput()`, 1)

replaceOnce(
  'worker/core/text.ts',
  `export function normalizeDate(value: unknown) {\n  const text = cleanText(value);\n  if (!text) return new Date().toISOString().slice(0, 10);\n  const iso = text.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/);\n  if (iso) return \`${'${iso[1]}'}-${'${iso[2].padStart(2, \'0\')}'}-${'${iso[3].padStart(2, \'0\')}'}\`;\n  const ru = text.match(/^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2}|\\d{4})$/);\n  if (ru) {\n    const year = ru[3].length === 2 ? \`20${'${ru[3]}'}\` : ru[3];\n    return \`${'${year}'}-${'${ru[2].padStart(2, \'0\')}'}-${'${ru[1].padStart(2, \'0\')}'}\`;\n  }\n  const parsed = new Date(text);\n  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);\n  return new Date().toISOString().slice(0, 10);\n}\n`,
  `export const BUSINESS_TIME_ZONE = 'Asia/Almaty';\n\nconst businessDateFormatter = new Intl.DateTimeFormat('en-US', {\n  timeZone: BUSINESS_TIME_ZONE,\n  year: 'numeric',\n  month: '2-digit',\n  day: '2-digit',\n});\n\nexport function businessDate(value = new Date()) {\n  const parts = businessDateFormatter.formatToParts(value);\n  const year = parts.find(part => part.type === 'year')?.value || '';\n  const month = parts.find(part => part.type === 'month')?.value || '';\n  const day = parts.find(part => part.type === 'day')?.value || '';\n  return \`${'${year}'}-${'${month}'}-${'${day}'}\`;\n}\n\nexport function normalizeDate(value: unknown) {\n  const text = cleanText(value);\n  if (!text) return businessDate();\n  const iso = text.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/);\n  if (iso) return \`${'${iso[1]}'}-${'${iso[2].padStart(2, \'0\')}'}-${'${iso[3].padStart(2, \'0\')}'}\`;\n  const ru = text.match(/^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2}|\\d{4})$/);\n  if (ru) {\n    const year = ru[3].length === 2 ? \`20${'${ru[3]}'}\` : ru[3];\n    return \`${'${year}'}-${'${ru[2].padStart(2, \'0\')}'}-${'${ru[1].padStart(2, \'0\')}'}\`;\n  }\n  const parsed = new Date(text);\n  if (!Number.isNaN(parsed.getTime())) return businessDate(parsed);\n  return businessDate();\n}\n`,
)

replaceOnce(
  'worker/domains/orders-read.ts',
  `  const today = new Date().toISOString().slice(0, 10);\n  const cutoffDate = normalizeDate(getValue('cutoffDate') || today);`,
  `  const cutoffDate = normalizeDate(getValue('cutoffDate'));`,
)

replaceOnce(
  'worker/domains/workshop.ts',
  `  const today = new Date().toISOString().slice(0, 10);`,
  `  const today = normalizeDate('');`,
)

replaceOnce(
  'worker/domains/activity.ts',
  `  const today = new Date();\n  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);\n  const todayIso = today.toISOString().slice(0, 10);`,
  `  const todayIso = normalizeDate('');\n  const monthStart = \`${'${todayIso.slice(0, 7)}'}-01\`;`,
)

replaceOnce(
  'worker/domains/team.ts',
  `  return new Date().toISOString().slice(0, 7);`,
  `  return normalizeDate('').slice(0, 7);`,
)

const test = `import fs from 'node:fs'\nimport assert from 'node:assert/strict'\n\nconst read = (path) => fs.readFileSync(path, 'utf8')\nconst utils = read('src/app/utils.ts')\nconst dashboard = read('src/features/sections/DashboardSection.tsx')\nconst app = read('src/App.tsx')\nconst text = read('worker/core/text.ts')\nconst ordersRead = read('worker/domains/orders-read.ts')\nconst workshop = read('worker/domains/workshop.ts')\nconst activity = read('worker/domains/activity.ts')\nconst team = read('worker/domains/team.ts')\n\nassert.ok(utils.includes("const BUSINESS_TIME_ZONE = 'Asia/Almaty'"), 'Frontend business timezone must be explicit')\nassert.ok(utils.includes('businessDateFormatter.formatToParts(value)'), 'Frontend business date must use timezone-aware parts')\nassert.ok(utils.includes("timeZone: 'UTC'"), 'Month-only helpers must avoid browser timezone drift')\nassert.ok(dashboard.includes("import { formatLocalDateInput } from '../../app/utils'"), 'Dashboard must reuse the business date helper')\nassert.ok(!dashboard.includes('new Date().toISOString().slice(0, 10)'), 'Dashboard must not derive today from UTC')\nassert.ok(app.includes("const today = formatLocalDateInput()"), 'Shipping date must use the business date')\nassert.ok(!app.includes('new Date().toISOString().slice(0, 10)'), 'App business day must not use UTC slicing')\nassert.ok(!app.includes('new Date().toISOString().slice(0, 7)'), 'App business month must not use UTC slicing')\n\nassert.ok(text.includes("export const BUSINESS_TIME_ZONE = 'Asia/Almaty'"), 'Worker business timezone must be explicit')\nassert.ok(text.includes('export function businessDate(value = new Date())'), 'Worker business date helper missing')\nassert.ok(text.includes('if (!text) return businessDate();'), 'normalizeDate empty fallback must use business date')\nassert.ok(text.includes('return businessDate(parsed);'), 'normalizeDate timestamps must resolve in business timezone')\nassert.ok(!ordersRead.includes('const today = new Date().toISOString().slice(0, 10);'), 'Archive cutoff must not default through UTC')\nassert.ok(workshop.includes("const today = normalizeDate('');"), 'Workshop periods must use business today')\nassert.ok(activity.includes("const todayIso = normalizeDate('');"), 'Report default range must use business today')\nassert.ok(team.includes("return normalizeDate('').slice(0, 7);"), 'Timesheet month must use business month')\n\nconst formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' })\nconst businessDate = (iso) => {\n  const parts = formatter.formatToParts(new Date(iso))\n  const part = (type) => parts.find((entry) => entry.type === type)?.value || ''\n  return \`${'${part(\'year\')}'}-${'${part(\'month\')}'}-${'${part(\'day\')}'}\`\n}\nassert.equal(businessDate('2026-09-12T20:30:00.000Z'), '2026-09-13', 'Almaty day boundary must advance after 20:00 UTC')\nassert.equal(businessDate('2026-09-30T20:30:00.000Z'), '2026-10-01', 'Almaty month boundary must advance after 20:00 UTC')\n\nconsole.log('Business date boundary R1 regression: OK')\n`
write('scripts/test-business-date-boundaries-r1.mjs', test)

replaceOnce(
  'package.json',
  `node scripts/test-stabilization-20260912-r2-manager-date.mjs && node scripts/test-phase1c-workshop-return-safety.mjs`,
  `node scripts/test-stabilization-20260912-r2-manager-date.mjs && node scripts/test-business-date-boundaries-r1.mjs && node scripts/test-phase1c-workshop-return-safety.mjs`,
)

console.log('Applied business date boundary R1 patch.')
