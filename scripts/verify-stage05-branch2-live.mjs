// Read-only public smoke test for the Stage05 lazy-loaded Warehouse UI.
const base='https://orders-app-branch2.orders-clothes.workers.dev'
async function read(url) {
  const r=await fetch(url,{cache:'no-store',headers:{'Cache-Control':'no-cache'}})
  if(!r.ok)throw Error('HTTP '+r.status+' '+url)
  return r.text()
}
async function onePass() {
  const html=await read(base+'/?stage05='+Date.now())
  const index=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
  if(!index)throw Error('Missing public index bundle')
  const js=await read(base+index[1])
  const warehouse=js.match(/InventorySection-[A-Za-z0-9_-]+\.js/)
  if(!warehouse)throw Error('Warehouse chunk not found')
  const chunk=await read(base+'/assets/'+warehouse[0])
  for(const word of ['Статистика спроса','Средняя известная цена','Чистые продажи','Цвета','Размеры']) {
    if(!chunk.includes(word))throw Error('Stage05 public UI is stale: '+word)
  }
  console.log('Stage05 Warehouse public chunk verified:',warehouse[0])
}
for(let i=0;i<3;i++){
  await onePass()
  if(i<2)await new Promise(resolve=>setTimeout(resolve,3500))
}
console.log('STAGE05_BRANCH2_PUBLIC_FRONTEND_VERIFIED')
