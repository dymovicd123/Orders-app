// Read-only public UI verification; does NOT submit a warehouse operation.
const base='https://orders-app-branch2.orders-clothes.workers.dev'
async function read(path) {
 const res=await fetch(base+path,{cache:'no-store',headers:{'Cache-Control':'no-cache'}})
 if(!res.ok)throw Error('HTTP '+res.status+' '+path)
 return res.text()
}
async function verify(){
 const html=await read('/?w8='+Date.now())
 const m=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
 if(!m)throw Error('No entry JS')
 const entry=await read(m[1])
 const chunk=entry.match(/InventorySection-[A-Za-z0-9_-]+\.js/)
 if(!chunk)throw Error('Inventory chunk missing')
 const js=await read('/assets/'+chunk[0])
 const required=[
  'Перемещение временно недоступно','Открыть проверку',
  'Не удалось подтвердить операцию','Обновить актуальные остатки',
  'Отсутствующий вариант','Проверить результат'
 ]
 for(const term of required)if(!js.includes(term))throw Error('W8 old UI asset: '+term)
 console.log('W8_PUBLIC_INVENTORY_ASSET_OK',chunk[0])
}
let done=0
for(let i=0;i<7;i++){
 try{await verify();done++;if(done>=2)break}
 catch(error){done=0;console.warn('attempt',i+1,String(error))}
 if(i<6)await new Promise(resolve=>setTimeout(resolve,5000))
}
if(done<2)throw Error('W8 public interface not reliably deployed')
console.log('W8_BRANCH2_PUBLIC_UI_VERIFIED')
