// W9 read-only public deploy smoke test: never commits inventory.
const base='https://orders-app-branch2.orders-clothes.workers.dev'
async function read(path) {
 const response=await fetch(base+path,{cache:'no-store',headers:{'Cache-Control':'no-cache'}})
 if(!response.ok)throw Error('HTTP '+response.status+' '+path)
 return response.text()
}
async function check(){
 const html=await read('/?w9='+Date.now())
 const match=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
 if(!match)throw Error('Entry JS missing')
 const entry=await read(match[1])
 const mod=entry.match(/InventorySection-[A-Za-z0-9_-]+\.js/)
 if(!mod)throw Error('Inventory UI chunk missing')
 const ui=await read('/assets/'+mod[0])
 for(const label of [
  'Добавить в корректировку','Фактический остаток','Добавить новый размер',
  'Добавить новый цвет','+ размер','+ цвет','Проверить результат',
 ]) if(!ui.includes(label))throw Error('Old W9 interface: '+label)
 console.log('W9_PUBLIC_UI_OK',mod[0])
}
let success=0
for(let i=0;i<7;i++){
 try {await check();success++;if(success>=2)break}
 catch(e){success=0;console.warn('W9 public retry',i+1,String(e))}
 if(i<6)await new Promise(resolve=>setTimeout(resolve,5000))
}
if(success<2)throw Error('Public W9 warehouse UI cannot be confirmed')
console.log('W9_BRANCH2_PUBLIC_UI_VERIFIED')
