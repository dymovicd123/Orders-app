import fs from 'node:fs'

const path = 'scripts/tmp-finance-f9-patch.mjs'
let source = fs.readFileSync(path, 'utf8')
const oldBoundary = "const paymentQueryBoundary = `    ).bind(startDate, endDate).all<any>(),\\n\\n    () => db.prepare(\\n      \\`SELECT o.order_date AS date,`"
const newBoundary = "const paymentQueryBoundary = `       ORDER BY p.payment_date DESC, p.id DESC\\`\\n    ).bind(startDate, endDate).all<any>(),\\n\\n    () => db.prepare(\\n      \\`SELECT o.order_date AS date,`"
const oldReplacement = "const beforeOrderQuery = `    ).bind(startDate, endDate).all<any>(),\\n\\n    () => db.prepare(\\n      \\`SELECT p.id,"
const newReplacement = "const beforeOrderQuery = `       ORDER BY p.payment_date DESC, p.id DESC\\`\\n    ).bind(startDate, endDate).all<any>(),\\n\\n    () => db.prepare(\\n      \\`SELECT p.id,"
if (!source.includes(oldBoundary) || !source.includes(oldReplacement)) throw new Error('F9 helper marker missing')
source = source.replace(oldBoundary, newBoundary).replace(oldReplacement, newReplacement)
fs.writeFileSync(path, source)
console.log('F9 payment query marker narrowed.')
