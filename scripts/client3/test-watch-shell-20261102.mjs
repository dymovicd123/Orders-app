import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'

const entry = fs.readFileSync('src/main.tsx', 'utf8')
const shell = fs.readFileSync('src/WatchClient3App.tsx', 'utf8')
assert(entry.includes("import { WatchClient3App }"))
assert(entry.includes('<WatchClient3App />'))
assert(!entry.includes('<App />'), 'Isolated Client3 must not render the old clothing dashboard')
assert(shell.includes('/api/client3/watches/brands'), 'Brands must come from session-bound API')
assert(shell.includes('/api/client3/watches/models?brand='))
assert(shell.includes('/api/client3/watches/orders'),'Watch create must use tenant-owned API')
assert(shell.includes('WatchOrderForm'),'Watch create form must be reachable')
assert(shell.includes("canCompleteEngraving={canAdmin||isLogisticsRole}"),
 'Only admin or logistics role may complete engraving; legacy packagers map to logists')
assert(shell.includes("canSales=brands.length>0")&&shell.includes("!isWarehouseRole"),
 'Warehouse chief must not receive sales access through a brand membership')
assert(!/\/api\/(?:finance|orders|cash)(?:\/|\?|['\"])/.test(shell),
  'Do not invoke brand-unsafe legacy sales/finance APIs from the watch shell')
const server = await createServer({
  configFile: false, plugins: [reactPlugin()], appType: 'custom',
  server: { middlewareMode: true }, logLevel: 'error',
})
try {
  const { WatchClient3App } = await server.ssrLoadModule('/src/WatchClient3App.tsx')
  const html = renderToStaticMarkup(React.createElement(WatchClient3App))
  assert(html.includes('Загрузка сессии.') && html.includes('erp-brand-mark'))
  assert(!html.includes('Цех') && !html.includes('Обмен размера'))
  console.log('CLIENT3_WATCH_SHELL_SSR_PASS: separate entrypoint, auth gating, scoped reads, zero legacy finance')
} finally { await server.close() }
