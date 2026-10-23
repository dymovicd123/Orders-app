// Stage05 v3: public smoke test of the actual lazy-loaded Warehouse UI.
// A successful build is not sufficient if Cloudflare serves an older chunk.
const base = 'https://orders-app-branch2.orders-clothes.workers.dev'
async function read(url) {
  const response = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
  if (!response.ok) throw Error('HTTP ' + response.status + ' ' + url)
  return response.text()
}
async function onePass() {
  const html = await read(base + '/?stage05-v3=' + Date.now())
  const index = html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
  if (!index) throw Error('Missing public index bundle')
  const source = await read(base + index[1])
  const warehouse = source.match(/InventorySection-[A-Za-z0-9_-]+\.js/)
  if (!warehouse) throw Error('Warehouse chunk not found')
  const chunk = await read(base + '/assets/' + warehouse[0])
  for (const label of [
    'Что покупают чаще всего', 'Свой период', 'Популярность по характеристикам',
    'Проданные варианты', 'Цены сохранены для', 'ПОЗИЦИИ ЗАКАЗОВ', '← К рейтингу', 'Цена не записана',
  ]) {
    if (!chunk.includes(label)) throw Error('Stage05 v3 public UI is stale: ' + label)
  }
  console.log('Stage05 v3 public Warehouse chunk verified:', warehouse[0])
}
for (let i = 0; i < 3; i++) {
  await onePass()
  if (i < 2) await new Promise(resolve => setTimeout(resolve, 3500))
}
console.log('STAGE05_V3_BRANCH2_PUBLIC_FRONTEND_VERIFIED')
