import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
const source=fs.readFileSync('src/features/client3/WatchOrderForm.tsx','utf8')
assert(!/Размер|Длина|Обмен размера|Цех/.test(source),'Watch form must not show clothing fields')
assert(source.includes("quantity<=free"),'Submission must not exceed selected source available quantity')
assert(source.includes("deliveryMethods.map"),'Delivery choices must come from current Main configuration')
assert(source.includes('receivedAmount'),'Received money must be explicitly captured')
assert(source.includes('requestRef'),'Create retries need a stable idempotency key')
assert(source.includes('managerId'),'Admin must select a brand-bound salesperson')
const server=await createServer({configFile:false,plugins:[reactPlugin()],appType:'custom',
  server:{middlewareMode:true},logLevel:'error'})
try {
  const {WatchOrderForm}=await server.ssrLoadModule('/src/features/client3/WatchOrderForm.tsx')
  const catalog=[
    {brand:'TAUWACH',watchProductId:1,watchVariantId:11,catalogVariantId:100,
      modelName:'CLASSIC',gender:'male',movement:'quartz',
      braceletMaterial:'leather',dialColor:'black',braceletColor:'ЧЁРНЫЙ',
      officePhysical:4,officeReserved:1,showcasePhysical:1,showcaseReserved:0,catalogPriceSnapshot:60000},
    {brand:'TAUWACH',watchProductId:1,watchVariantId:12,catalogVariantId:101,
      modelName:'CLASSIC',gender:'male',movement:'quartz',
      braceletMaterial:'leather',dialColor:'black',braceletColor:'КОРИЧНЕВЫЙ',
      officePhysical:2,officeReserved:0,showcasePhysical:1,showcaseReserved:1,catalogPriceSnapshot:60000},
    {brand:'WACHIZEN',watchProductId:2,watchVariantId:21,catalogVariantId:102,
      modelName:'CLASSIC',gender:'female',movement:'mechanical',
      braceletMaterial:'steel',dialColor:'silver',braceletColor:'',
      officePhysical:8,officeReserved:0,showcasePhysical:4,showcaseReserved:0,catalogPriceSnapshot:45000},
  ]
  const html=renderToStaticMarkup(React.createElement(WatchOrderForm,{
    allowedBrands:['TAUWACH','WACHIZEN'],
    catalog,deliveryMethods:['Казпочта','Курьер'],onSave:async()=>{},
  }))
  for(const label of ['Оформление заказа','Бренд','Откуда заберут часы',
    'Модель и комплектация','Цена по каталогу','Цена продажи','Получено от клиента','Комментарий логисту',
    'Текст гравировки','Полный адрес доставки','Индекс','Город',
    'Отправить до','Срочный заказ','Казпочта','KASPI RED','KASPI GOLD','Рассрочка',
    'ЧЁРНЫЙ','КОРИЧНЕВЫЙ']){
    assert(html.includes(label),'Missing customer watch form field/option: '+label)
  }
  assert(html.includes('type="datetime-local"'),'Shipping cutoff needs date AND time')
  assert(html.includes('type="checkbox"'),'Urgency is separate')
  assert(html.includes('type="submit"')&&html.includes('disabled'),'Empty watch selection must not save order')
  assert(html.indexOf('Бренд')<html.indexOf('Откуда заберут часы') &&
    html.indexOf('Откуда заберут часы')<html.indexOf('Модель и комплектация'),
    'Watch order must show brand and source before SKU')
  assert(!html.includes('Жилет')&&!html.includes('Шапан'),'Do not seed third-party clothing catalog')
  console.log('CLIENT3_WATCH_ORDER_FORM_SSR_PASS: brand-source-SKU, leather dual colors, safe qty, engraving, Kazpost, exact deadline')
} finally{await server.close()}
