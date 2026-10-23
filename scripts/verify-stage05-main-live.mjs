// Main Stage05 read-only public asset check; no authentication, no API data reads.
const base = 'https://orders-app.orders-clothes.workers.dev'
async function read(url) {
  const r = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
  if (!r.ok) throw Error('HTTP ' + r.status + ' ' + url)
  return r.text()
}
async function check() {
  const html = await read(base + '/?stage05-main=' + Date.now())
  const index = html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
  if (!index) throw Error('Main index bundle missing')
  const source = await read(base + index[1])
  const match = source.match(/InventorySection-[A-Za-z0-9_-]+\.js/)
  if (!match) throw Error('Main InventorySection asset missing')
  const inventory = await read(base + '/assets/' + match[0])
  const phrases = ['Какие товары пользуются спросом', 'Все оформленные заказы',
    'Только отправленные товары', 'Уточнить выборку', 'Какие варианты выбирали']
  for (const phrase of phrases) if (!inventory.includes(phrase)) throw Error('Main Stage05 public page is stale: ' + phrase)
  if (inventory.includes('Скачать список моделей (CSV)')) throw Error('Obsolete CSV export is still public')
  console.log('MAIN_STAGE05_PUBLIC_ASSET_OK ' + match[0])
}
let last
for (let i = 0; i < 8; i++) {
  try { await check(); last = null; if (i >= 2) break }
  catch (error) { last = error; console.warn('Main asset check retry ' + (i + 1) + ': ' + String(error)) }
  if (i < 7) await new Promise(done => setTimeout(done, 5000))
}
if (last) throw last
console.log('MAIN_STAGE05_PUBLIC_FRONTEND_VERIFIED')
