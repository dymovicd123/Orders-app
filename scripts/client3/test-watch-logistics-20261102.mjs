import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'

const source = fs.readFileSync('src/features/client3/WatchLogisticsPanel.tsx', 'utf8')
assert(source.includes('/api/client3/watches/logistics/'))
assert(source.includes('/ready'))
assert(!/\/api\/orders\/|\/api\/workshop\/|\/api\/finance\/|\/api\/cash/.test(source),
  'Logistics may not post to shipping, cash or legacy workshop endpoints')
assert(source.includes("crypto.randomUUID()"), 'Ready must have an idempotency key')
assert(source.includes("credentials: 'include'"), 'Only authenticated API calls allowed')

const server = await createServer({
  configFile: false, plugins: [reactPlugin()], appType: 'custom',
  server: { middlewareMode: true }, logLevel: 'error',
})
try {
  const { WatchLogisticsPanel, groupWatchLogistics, formatWatchDeadline, logisticsItemEligible } =
    await server.ssrLoadModule('/src/features/client3/WatchLogisticsPanel.tsx')
  const row = {
    orderId: 42, externalId: 'WATCH-42', brand: 'TAUWACH',
    recipientName: 'Получатель', recipientPhone: '+7 777 111 22 33',
    address: 'Улица 1, дом 2', postalCode: '050000', city: 'Алматы',
    deliveryMethod: 'Казпочта', urgent: 1,
    shippingDeadlineAt: '2026-11-02T12:00:00.000Z',
    deadlineTimezone: 'Asia/Almaty',
    engravingStatus: 'pending', readyAt: null,
    orderItemId: 12, quantity: 1, modelName: 'CLASSIC', engravingText: 'A + M',
    movement: 'quartz', braceletMaterial: 'leather', dialColor: 'black',
    braceletColor: 'ЧЁРНЫЙ',
  }
  assert.match(formatWatchDeadline('2026-11-02T12:00:00.000Z'), /17:00/)
  assert.equal(groupWatchLogistics([row, { ...row, orderItemId: 13, engravingText: 'B + S' }]).length, 1)
  const ready={...row,reservationStatus:'active',stockWriteoffStatus:'reserved',
    shippedQuantity:0,engravingReady:1}
  const pending={...ready,orderItemId:13,engravingText:'Другая гравировка',engravingReady:0}
  assert.equal(logisticsItemEligible(ready),true,'Only exact confirmed engraving is selectable')
  assert.equal(logisticsItemEligible(pending),false,'Other SKU remains unready in same order')
  assert.equal(logisticsItemEligible({...pending,engravingText:''}),true,'No engraving needs no confirmation')
  assert.equal(logisticsItemEligible({...ready,shippedQuantity:1}),false,'Cannot resend shipped item')
  assert.equal(logisticsItemEligible({...ready,reservationStatus:'unresolved'}),false,
    'Unreserved stock cannot be sent')
  const view = renderToStaticMarkup(React.createElement(WatchLogisticsPanel, {
    brand: 'TAUWACH', canCompleteEngraving: true,
  }))
  assert(view.includes('Логистика') && view.includes('Гравировка'))
  assert(view.includes('Ожидает') && view.includes('Готово'))
  assert(!view.includes('Зарплата цеха'))
  assert(!view.includes('Готово · гравировка'), 'No action without loaded order')
  console.log('CLIENT3_WATCH_LOGISTICS_SSR_PASS: grouping, Almaty exact deadline, brand/API isolation, no shipping or money mutation')
} finally {
  await server.close()
}
