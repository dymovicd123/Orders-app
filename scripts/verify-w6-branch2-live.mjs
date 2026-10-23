// Smoke checks only public Branch2 build assets. Never submits inventory operations.
const site='https://orders-app-branch2.orders-clothes.workers.dev'
async function read(path) {
 const r=await fetch(site+path,{cache:'no-store',headers:{'Cache-Control':'no-cache'}})
 if(!r.ok)throw Error('HTTP '+r.status+' '+path)
 return r.text()
}
async function check() {
 const html=await read('/?w6='+Date.now())
 const idx=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
 if(!idx)throw Error('Missing index asset')
 const entry=await read(idx[1])
 const mod=entry.match(/InventorySection-[A-Za-z0-9_-]+\.js/)
 if(!mod)throw Error('Missing inventory module chunk')
 const js=await read('/assets/'+mod[0])
 const labels=['Введите количество поступивших вещей','Выберите один или несколько товаров',
  'stocktake-counting-shell','Проверить результат','Будет:','Нужного товара или варианта нет',
  'Приход','Списание','Корректировка']
 for(const label of labels)if(!js.includes(label))throw Error('Stale unified warehouse UI: '+label)
 console.log('W6_PUBLIC_WAREHOUSE_CHUNK_OK',mod[0])
}
let passed=0
for(let i=0;i<7;i++){
 try {await check();passed++;if(passed>=2)break}
 catch(e){console.warn('UI smoke retry',i+1,String(e));passed=0}
 if(i<6)await new Promise(resolve=>setTimeout(resolve,5000))
}
if(passed<2)throw Error('New Warehouse W6 UI is not reliably served')
console.log('W6_BRANCH2_PUBLIC_UI_VERIFIED')
