import {cleanText,toInt} from '../core/text.ts'

export type SourcePickerVariant = {
  variantId:number
  productId:number
  productName:string
  category:string
  gender:string
  color:string
  material:string
  length:string
  size:string
  salePrice:number|null
  warehouse:{physical:number;reserved:number;free:number;cachedReserved:number}
  boutique:{physical:number;reserved:number;free:number;cachedReserved:number}
}

type StockTotals={physical:number;reserved:number;cachedReserved:number}

/**
 * Read-only source-first catalog for Main's order creator.
 * Physical quantity is the most recently accounted on-hand stock; active
 * reservations are authoritative for already promised units. The cached
 * reserved_quantity is reported separately to expose drift, NEVER used to
 * invent availability or to perform an inventory adjustment.
 */
export async function listOrderSourcePicker(db:D1Database){
  const [catalogRows,stockRows,reserveRows]=await Promise.all([
    db.prepare(`SELECT v.id AS variant_id,v.product_id,p.name AS product_name,
         COALESCE(NULLIF(v.category,''),p.category,'adult') AS category,
         v.gender,v.color,v.material,v.length,v.size_label AS size,
         ep.sale_price
       FROM catalog_variants v
       JOIN catalog_products p ON p.id=v.product_id
       LEFT JOIN catalog_execution_prices ep ON ep.stock_position_id=v.stock_position_id
         AND ep.category=COALESCE(NULLIF(v.category,''),p.category,'adult')
       WHERE v.is_active=1 AND p.is_active=1
       ORDER BY p.name,v.color,v.size_label,v.id
       LIMIT 10001`).all<Record<string,unknown>>(),
    db.prepare(`SELECT inventory_source,variant_id,
           SUM(quantity) AS physical,
           SUM(COALESCE(reserved_quantity,0)) AS cached_reserved
         FROM inventory_stock
         WHERE inventory_source IN ('warehouse','boutique') AND variant_id>0
         GROUP BY inventory_source,variant_id`).all<Record<string,unknown>>(),
    db.prepare(`SELECT inventory_source,variant_id,SUM(quantity) AS reserved
         FROM inventory_reservations
         WHERE status='active' AND inventory_source IN ('warehouse','boutique')
           AND variant_id>0 AND quantity>0
         GROUP BY inventory_source,variant_id`).all<Record<string,unknown>>(),
  ])
  if((catalogRows.results||[]).length>10000)throw new Error('Каталог слишком большой для полного выбора. Уточните загрузку списка товаров.')
  const totals=new Map<string,StockTotals>()
  const key=(source:string,id:number)=>source+':'+id
  for(const row of stockRows.results||[]){
    const source=cleanText(row.inventory_source),id=toInt(row.variant_id,0)
    if(!id)continue
    const value=totals.get(key(source,id))||{physical:0,reserved:0,cachedReserved:0}
    value.physical+=toInt(row.physical,0)
    value.cachedReserved+=toInt(row.cached_reserved,0)
    totals.set(key(source,id),value)
  }
  for(const row of reserveRows.results||[]){
    const source=cleanText(row.inventory_source),id=toInt(row.variant_id,0)
    if(!id)continue
    const value=totals.get(key(source,id))||{physical:0,reserved:0,cachedReserved:0}
    value.reserved+=Math.max(0,toInt(row.reserved,0))
    totals.set(key(source,id),value)
  }
  const source=(name:'warehouse'|'boutique',id:number)=>{
    const value=totals.get(key(name,id))||{physical:0,reserved:0,cachedReserved:0}
    return {...value,free:Math.max(0,value.physical-value.reserved)}
  }
  const variants:SourcePickerVariant[]=(catalogRows.results||[]).map(row=>{
    const variantId=toInt(row.variant_id,0)
    const price=row.sale_price===null||row.sale_price===undefined?null:toInt(row.sale_price,0)
    return {
      variantId,productId:toInt(row.product_id,0),
      productName:cleanText(row.product_name),category:cleanText(row.category)||'adult',
      gender:cleanText(row.gender),color:cleanText(row.color),
      material:cleanText(row.material),length:cleanText(row.length),
      size:cleanText(row.size),salePrice:price,
      warehouse:source('warehouse',variantId),boutique:source('boutique',variantId),
    }
  })
  return {ok:true,variants}
}


/**
 * A selected SKU is an immutable identity, not editable free text.
 * Re-read the exact active catalog record before any price, stock, customer,
 * payment or order mutation. New orders never create variants here.
 */
export async function hydratePickedOrderItems(
  db:D1Database,items:ReturnType<typeof import('./order-core.ts').normalizeOrderItems>,
){
  const identities=new Map<number,Record<string,unknown>>()
  for(const item of items){
    const variantId=Math.max(0,toInt(item.catalogVariantId,0))
    if(!variantId)continue
    let record=identities.get(variantId)
    if(!record){
      record=await db.prepare(`SELECT v.id AS variant_id,v.product_id,
            p.name AS product_name,COALESCE(NULLIF(v.category,''),p.category,'adult') AS category,
            v.gender,v.color,v.material,v.length,v.size_label AS size
          FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id
          WHERE v.id=? AND v.is_active=1 AND p.is_active=1
          LIMIT 1`).bind(variantId).first<Record<string,unknown>>()||undefined
      if(!record)throw new Error('Выбранный вариант товара больше не активен. Обновите список товаров.')
      identities.set(variantId,record)
    }
    const canonicalProduct=cleanText(record.product_name).toLocaleUpperCase('ru-RU')
    const canonicalColor=cleanText(record.color).toLocaleUpperCase('ru-RU')
    const canonicalSize=cleanText(record.size).toLocaleUpperCase('ru-RU')
    // A picked item is not allowed to preserve silently changed draft identity.
    if(item.productName!==canonicalProduct
      || cleanText(item.color).toLocaleUpperCase('ru-RU')!==canonicalColor
      || cleanText(item.size).toLocaleUpperCase('ru-RU')!==canonicalSize){
      throw new Error('Характеристики выбранного товара изменились в каталоге. Обновите выбор товара.')
    }
    item.productName=canonicalProduct
    item.catalogProductId=toInt(record.product_id,0)
    item.category=cleanText(record.category)==='child'?'child':'adult'
    item.audienceType=item.category==='child'?'ДЕТСКИЙ':'ВЗРОСЛЫЙ'
    item.gender=cleanText(record.gender).toLocaleUpperCase('ru-RU')
    item.color=canonicalColor
    item.material=cleanText(record.material).toLocaleUpperCase('ru-RU')
    item.length=cleanText(record.length).toLocaleUpperCase('ru-RU')
    item.size=cleanText(record.size)
    // Workshop lines keep their identity but are never stock reservations.
    // Main's existing manual workshop path remains unchanged.
  }
  return items
}
