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
const tasksSource=fs.readFileSync('src/features/client3/WatchLogisticsTaskTable.tsx','utf8')
assert(tasksSource.includes('onOpenReturns(order.brand)'), 'Each watch row links physical intake for its exact brand')
assert(tasksSource.includes('Приёмка возврата'),
  'Physical intake remains actionable on its specific watch item')
const app=fs.readFileSync('src/WatchClient3App.tsx','utf8')
assert(app.includes('onOpenReturns={canSales?selected=>{') &&
  app.includes("setBrand(selected);setLastOrderBrand(selected);setReportOrderFocus(null);goTo('returns')"),
  'Sales roles can navigate from Logistics to the correct physical-intake queue')
assert(app.includes('initialBrand={reportOrderFocus?.brand||brand||undefined}'),
  'Returns intake must not silently reset selected brand to the first brand')

const server = await createServer({
  configFile: false, plugins: [reactPlugin()], appType: 'custom',
  server: { middlewareMode: true }, logLevel: 'error',
})
try {
  const { WatchLogisticsPanel, groupWatchLogistics, formatWatchDeadline, logisticsItemEligible,
      logisticsOrderComplete } =
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
  assert.equal(logisticsOrderComplete({order:row,items:[{...ready,quantity:2,shippedQuantity:1}]}),false,
    'One of two watch units dispatched is not a completed line')
  assert.equal(logisticsOrderComplete({order:row,items:[{...ready,quantity:0,returnedQuantity:1,
    pendingReturnQuantity:1}]}),true,
    'A fully returned historic order is no longer a dispatch task; physical intake has its own queue')
  const view = renderToStaticMarkup(React.createElement(WatchLogisticsPanel, {
    brand: 'TAUWACH', canCompleteEngraving: true,
  }))
  assert(view.includes('Логистика') && view.includes('Гравировка'))
  assert(view.includes('Ожидает') && view.includes('Готово'))
  assert(!view.includes('Зарплата цеха'))
assert(tasksSource.includes('Готово в логистике')&&tasksSource.includes('onReady(order.orderId,id)'),
  'Each engraved watch must have one direct prep action, without a bulk confirmation')
assert(tasksSource.includes('onSend(order,item,requested)') &&
  source.includes('reviewSendHandover(order,[{...item,quantity}])'),
  'Every individual Send click must pass Main revision preflight with exact quantity')
assert(source.includes('StockResolutionConfirmModal') &&
  source.includes('physicalQuantity')&&source.includes('tracked:'),
  'Main stock resolution must display actual tracked quantity when reservation is incomplete')
assert(source.includes('WatchOrderHandoverPanel')&&
  !source.includes('confirmPhysicalStock:true,'),
  'No generic physical confirmation that bypasses Main revision check')
  assert(!view.includes('Готово · гравировка'), 'No action without loaded order')
  console.log('CLIENT3_WATCH_LOGISTICS_SSR_PASS: grouping, Almaty exact deadline, brand/API isolation, no shipping or money mutation')
} finally {
  await server.close()
}
