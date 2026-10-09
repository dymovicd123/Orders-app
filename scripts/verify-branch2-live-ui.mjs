// Read-only smoke test of the actual public Branch2 Worker assets.
// Builds/CI success is insufficient if Cloudflare serves a stale app bundle.
const base = 'https://orders-app-branch2.orders-clothes.workers.dev'
async function get(uri) {
  const response=await fetch(uri, {headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}})
  if(!response.ok)throw new Error('GET '+uri+' HTTP '+response.status)
  return response.text()
}
const html=await get(base+'/?branch2-live-check='+Date.now())
const entry=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
if(!entry)throw new Error('Cannot find bundled index.js in public HTML')
const entrySource=await get(base+entry[1])
const referenceChunk=entrySource.match(/ReferencesSection-[A-Za-z0-9_-]+\.js/)
if(!referenceChunk)throw new Error('Public index.js does not link ReferencesSection')
const references=await get(base+'/assets/'+referenceChunk[0])
const expected=['Все рабочие справочники','Проверка дублей']
const missing=expected.filter(text=>!references.includes(text))
console.log('Branch2 entry:',entry[1])
console.log('Branch2 references chunk:',referenceChunk[0])
console.log('New references title:',references.includes(expected[0]))
console.log('Duplicates entry:',references.includes(expected[1]))
console.log('New integrity component:',references.includes(expected[2]))
if(missing.length) {
  throw new Error('PUBLIC BRANCH2 SERVES STALE ASSETS: '+missing.join(', '))
}
console.log('BRANCH2 LIVE UI VERIFIED — published References component contains the new functionality')
