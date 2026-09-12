import fs from 'node:fs'

const path = 'worker/core/text.ts'
let source = fs.readFileSync(path, 'utf8')
const oldBlock = `export const BUSINESS_TIME_ZONE = 'Asia/Almaty';\n\nconst businessDateFormatter = new Intl.DateTimeFormat('en-US', {\n  timeZone: BUSINESS_TIME_ZONE,\n  year: 'numeric',\n  month: '2-digit',\n  day: '2-digit',\n});\n\nexport function businessDate(value = new Date()) {\n  const parts = businessDateFormatter.formatToParts(value);\n  const year = parts.find(part => part.type === 'year')?.value || '';\n  const month = parts.find(part => part.type === 'month')?.value || '';\n  const day = parts.find(part => part.type === 'day')?.value || '';\n  return \`${'${year}'}-${'${month}'}-${'${day}'}\`;\n}\n\nexport function normalizeDate(value: unknown) {\n  const text = cleanText(value);\n  if (!text) return businessDate();\n  const iso = text.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/);\n  if (iso) return \`${'${iso[1]}'}-${'${iso[2].padStart(2, \'0\')}'}-${'${iso[3].padStart(2, \'0\')}'}\`;\n  const ru = text.match(/^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2}|\\d{4})$/);\n  if (ru) {\n    const year = ru[3].length === 2 ? \`20${'${ru[3]}'}\` : ru[3];\n    return \`${'${year}'}-${'${ru[2].padStart(2, \'0\')}'}-${'${ru[1].padStart(2, \'0\')}'}\`;\n  }\n  const parsed = new Date(text);\n  if (!Number.isNaN(parsed.getTime())) return businessDate(parsed);\n  return businessDate();\n}\n`
const newBlock = `export function normalizeDate(value: unknown) {\n  const businessDate = (date = new Date()) => {\n    const parts = new Intl.DateTimeFormat('en-US', {\n      timeZone: 'Asia/Almaty',\n      year: 'numeric',\n      month: '2-digit',\n      day: '2-digit',\n    }).formatToParts(date);\n    const year = parts.find(part => part.type === 'year')?.value || '';\n    const month = parts.find(part => part.type === 'month')?.value || '';\n    const day = parts.find(part => part.type === 'day')?.value || '';\n    return \`${'${year}'}-${'${month}'}-${'${day}'}\`;\n  };\n  const text = cleanText(value);\n  if (!text) return businessDate();\n  const iso = text.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/);\n  if (iso) return \`${'${iso[1]}'}-${'${iso[2].padStart(2, \'0\')}'}-${'${iso[3].padStart(2, \'0\')}'}\`;\n  const ru = text.match(/^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2}|\\d{4})$/);\n  if (ru) {\n    const year = ru[3].length === 2 ? \`20${'${ru[3]}'}\` : ru[3];\n    return \`${'${year}'}-${'${ru[2].padStart(2, \'0\')}'}-${'${ru[1].padStart(2, \'0\')}'}\`;\n  }\n  const parsed = new Date(text);\n  if (!Number.isNaN(parsed.getTime())) return businessDate(parsed);\n  return businessDate();\n}\n`
if (!source.includes(oldBlock)) throw new Error('Expected generated Worker business-date block not found.')
source = source.replace(oldBlock, newBlock)
fs.writeFileSync(path, source)

const testPath = 'scripts/test-business-date-boundaries-r1.mjs'
let test = fs.readFileSync(testPath, 'utf8')
test = test.replace(
  `assert.ok(text.includes("export const BUSINESS_TIME_ZONE = 'Asia/Almaty'"), 'Worker business timezone must be explicit')\nassert.ok(text.includes('export function businessDate(value = new Date())'), 'Worker business date helper missing')`,
  `assert.ok(text.includes("timeZone: 'Asia/Almaty'"), 'Worker business timezone must be explicit')\nassert.ok(text.includes('const businessDate = (date = new Date()) =>'), 'Worker business date helper missing')`,
)
fs.writeFileSync(testPath, test)
console.log('Repaired Worker date helper without adding top-level declarations.')
