// Stage05 v4: public smoke test of the actual lazy-loaded Warehouse UI.
// A successful build is not sufficient if Cloudflare serves an older chunk.
const base = 'https://orders-app-branch2.orders-clothes.workers.dev'
async function read(url) {
  const response = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
  if (!response.ok) throw Error('HTTP ' + response.status + ' ' + url)
  return response.text()
}
async function onePass() {
  const html = await read(base + '/?stage05-v4=' + Date.now())
  const index = html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
  if (!index) throw Error('Missing public index bundle')
  const source = await read(base + index[1])
  const warehouse = source.match(/InventorySection-[A-Za-z0-9_-]+\.js/)
  if (!warehouse) throw Error('Warehouse chunk not found')
  const chunk = await read(base + '/assets/' + warehouse[0])
  for (const label of [
    'Какие товары пользуются спросом', 'Все оформленные заказы', 'Только отправленные товары',
    'Что чаще всего заказывают', 'Уточнить выборку', 'ПОЗИЦИИ ЗАКАЗОВ', 'Какие варианты выбирали',
  ]) {
    if (!chunk.includes(label)) throw Error('Stage05 v4 public UI is stale: ' + label)
  }
  console.log('Stage05 v4 public Warehouse chunk verified:', warehouse[0])
}
for (let i = 0; i < 3; i++) {
  await onePass()
  if (i < 2) await new Promise(resolve => setTimeout(resolve, 3500))
}
console.log('STAGE05_V4_BRANCH2_PUBLIC_FRONTEND_VERIFIED')
