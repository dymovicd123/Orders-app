// W7 public asset smoke test. No login and no inventory write requests.
const site='https://orders-app-branch2.orders-clothes.workers.dev'
async function get(path){
 const r=await fetch(site+path,{cache:'no-store',headers:{'Cache-Control':'no-cache'}})
 if(!r.ok)throw Error('HTTP '+r.status+' '+path)
 return r.text()
}
async function check(){
 const index=await get('/?w7='+Date.now())
 const js=index.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
 if(!js)throw Error('Missing entry asset')
 const entry=await get(js[1])
 const inv=entry.match(/InventorySection-[A-Za-z0-9_-]+\.js/)
 if(!inv)throw Error('Inventory chunk unavailable')
 const chunk=await get('/assets/'+inv[0])
 for(const term of ['Откуда → куда','Добавить к приходу','Выберите один или несколько товаров',
   'Пустые поля оставят остаток неизменным','Проверить результат','Поменять направление'])
   if(!chunk.includes(term))throw Error('Stale W7 inventory chunk: '+term)
 console.log('W7_PUBLIC_ASSET_OK',inv[0])
}
let consecutive=0
for(let i=0;i<7;i++){
 try{await check();consecutive++;if(consecutive>=2)break}
 catch(err){consecutive=0;console.warn('retry',i+1,String(err))}
 if(i<6)await new Promise(done=>setTimeout(done,5000))
}
if(consecutive<2)throw Error('W7 public UI verification failed')
console.log('W7_BRANCH2_PUBLIC_UI_VERIFIED')
