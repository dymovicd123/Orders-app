// Read-only smoke test of the actual public Branch2 Worker assets.
// Builds/CI success is insufficient if Cloudflare serves a stale app bundle.
// Check QA-specific markers and verify consecutive requests: a freshly deployed
// version can be briefly visible before an older Worker takes traffic back.
const base = 'https://orders-app-branch2.orders-clothes.workers.dev'
const expected=[
  'Все рабочие справочники',
  'Проверка дублей',
  'Объединить значения',
  'Убираем лишнее название',
  'Оставляем правильное название',
  'Разобрать прежнее объединение товаров',
  // PR #355: older PR #354 assets contain every marker above.
  'Всего в выбранном списке:',
  'Списков всего:',
  'Проверьте номер в истории объединений.',
  // PR #357: ensure the real public build includes the paged SKU matching UI.
  'Проверить соответствия товаров по каждой вариации',
  'Посмотреть все соответствия',
]
async function get(uri) {
  const response=await fetch(uri, {
    cache:'no-store',
    headers:{'Cache-Control':'no-cache','Pragma':'no-cache'},
  })
  if(!response.ok)throw new Error('GET '+uri+' HTTP '+response.status)
  return response.text()
}
async function verifyPass(pass) {
  const html=await get(base+'/?branch2-live-check='+Date.now()+'-'+pass)
  const entry=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
  if(!entry)throw new Error('Cannot find bundled index.js in public HTML')
  const entrySource=await get(base+entry[1])
  const referenceChunk=entrySource.match(/ReferencesSection-[A-Za-z0-9_-]+\.js/)
  if(!referenceChunk)throw new Error('Public index.js does not link ReferencesSection')
  const references=await get(base+'/assets/'+referenceChunk[0])
  const missing=expected.filter(marker=>!references.includes(marker))
  console.log('Branch2 pass '+pass+' entry:',entry[1])
  console.log('Branch2 pass '+pass+' references chunk:',referenceChunk[0])
  if(missing.length)throw new Error('PUBLIC BRANCH2 SERVES STALE ASSETS: '+missing.join(', '))
}
// Check multiple rounds several seconds apart. A single lucky response is not
// enough to certify the Cloudflare version assigned to real users.
for(let pass=1;pass<=3;pass++) {
  await verifyPass(pass)
  if(pass<3)await new Promise(resolve=>setTimeout(resolve,4000))
}
console.log('BRANCH2 LIVE UI VERIFIED — three consecutive public checks include PR #355 fixes')
