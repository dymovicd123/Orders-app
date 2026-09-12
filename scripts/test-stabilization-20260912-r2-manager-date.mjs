import fs from 'node:fs'
import assert from 'node:assert/strict'

const dashboard = fs.readFileSync('worker/domains/inventory-read.ts', 'utf8')
const finance = fs.readFileSync('worker/domains/finance-reports.ts', 'utf8')

const dashboardStart = dashboard.indexOf('export async function getDashboardInsights')
assert.ok(dashboardStart >= 0, 'Dashboard declaration missing')
const dashboardBody = dashboard.slice(dashboardStart)
assert.ok(dashboardBody.includes('Asia/Almaty'), 'Dashboard must use Kazakhstan business timezone')
assert.ok(dashboardBody.includes('.formatToParts(new Date())'), 'Dashboard date must be assembled from timezone-aware parts')
assert.ok(!dashboardBody.includes('new Date().toISOString().slice(0, 10)'), 'Dashboard must not derive business day from UTC')

assert.ok(finance.includes('const managerIdentityKey = (managerId: number, managerName: unknown)'), 'Collision-safe manager identity missing')
assert.ok(finance.includes('const managerSummaryMap = new Map<string, any>()'), 'Manager summary must use stable string identities')
assert.ok(finance.includes('current.order_count += Number(row.order_count || 0)'), 'Split manager order groups must accumulate instead of overwrite')
assert.ok(finance.includes('current.primary_received += Number(row.primary_received || 0)'), 'Split manager payment groups must accumulate instead of overwrite')
assert.ok(finance.includes('current.totalReturns += Number(row.total_returns || 0)'), 'Split manager return groups must accumulate instead of overwrite')
assert.ok(!finance.includes('const managerSummaryMap = new Map<number, any>()'), 'Old numeric-only manager summary key must stay removed')

console.log('September 12 stabilization R2 manager/date regression: OK')
