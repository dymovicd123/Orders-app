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
           SUM(MAX(0,quantity)) AS physical,
           SUM(MAX(0,COALESCE(reserved_quantity,0))) AS cached_reserved
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
    value.physical+=Math.max(0,toInt(row.physical,0))
    value.cachedReserved+=Math.max(0,toInt(row.cached_reserved,0))
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
