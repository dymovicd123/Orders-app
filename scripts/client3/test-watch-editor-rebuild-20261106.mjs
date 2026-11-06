import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

const read=path=>fs.readFileSync(path,'utf8')
const editor=read('src/features/client3/WatchOrderCorrections.tsx')
const composition=read('src/features/client3/WatchAdminCompositionEditor.tsx')
const projection=read('worker/domains/client3-watch-orders-read.ts')
const core=read('worker/domains/orders-write.ts')
assert(editor.includes('Сохранить изменения'))
assert(editor.includes("await send('metadata'")&&editor.includes("await send('watch'"))
assert(editor.includes("await send('prices'")&&editor.includes('linkedReturns='))
assert(composition.includes('WatchOrderSourcePicker')&&composition.includes('WatchOrderLineEditor'))
assert(composition.includes('onAdd={choose}')&&composition.includes('onManual={addManual}'))
assert(composition.includes('hasFulfilledReservation'))
assert(projection.includes("'hasFulfilledReservation'"))
assert(core.includes('releaseOrderReservationsV2')&&core.includes('preservedRewriteItemIds'))

const vite=await createServer({configFile:false,plugins:[react()],appType:'custom',
 server:{middlewareMode:true},logLevel:'error'})
try{
 const {WatchAdminCompositionEditor}=await vite.ssrLoadModule('/src/features/client3/WatchAdminCompositionEditor.tsx')
 const item={id:11,watchVariantId:21,productName:'ARYSTAN',gender:'male',
   movement:'quartz',braceletMaterial:'steel',dialColor:'black',braceletColor:'',
   quantity:1,unitPrice:10000,source:'warehouse',engravingText:'',
   catalogPriceSnapshot:10000,stockWriteoffStatus:'reserved'}
 const props={brand:'TAUWACH',orderId:1,receivedAmount:1000,onDone:()=>{},onCancel:()=>{}}
 const normal=renderToStaticMarkup(React.createElement(WatchAdminCompositionEditor,
   {...props,itemLines:JSON.stringify([item])}))
 assert(normal.includes('Заменить')&&normal.includes('Добавить товар'))
 assert(normal.includes('Подтвердить изменение состава'))
 const issued=renderToStaticMarkup(React.createElement(WatchAdminCompositionEditor,
   {...props,itemLines:JSON.stringify([{...item,hasFulfilledReservation:1}])}))
 assert(issued.includes('Автоматическая перезапись состава могла бы'))
 assert(!issued.includes('Подтвердить изменение состава'))
 const returned=renderToStaticMarkup(React.createElement(WatchAdminCompositionEditor,
   {...props,itemLines:JSON.stringify([item]),linkedReturns:1}))
 assert(returned.includes('Автоматическая перезапись состава могла бы'))
 console.log('CLIENT3_ORDER_EDITOR_REBUILD_PASS')
}finally{await vite.close()}
