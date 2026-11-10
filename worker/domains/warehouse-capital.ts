// Financial snapshot of the CURRENT physical warehouse/boutique stock only.
// Read-only: values use current catalog execution prices, never historic purchase costs.
export type WarehouseCapitalRow = {
  stockId:number; source:'warehouse'|'boutique'; variantId:number|null; productId:number|null;
  product:string; gender:string; color:string; size:string; material:string; length:string;
  category:string; quantity:number; reserved:number; free:number;
  costPrice:number|null; salePrice:number|null;
  costValue:number|null; retailValue:number|null; grossPotential:number|null;
  archived:boolean; overReserved:boolean;
}
export type WarehouseCapitalTotals = {
  quantity:number; reserved:number; free:number; pricedCostQuantity:number; pricedSaleQuantity:number;
  bothPricedQuantity:number; knownCost:number; knownSale:number; knownGrossPotential:number;
  knownFreeCost:number; knownReservedCost:number; missingCostQuantity:number; missingSaleQuantity:number;
  stockRows:number; zeroRows:number; negativeRows:number; overReservedRows:number; unlinkedPositiveRows:number;
}
export type WarehouseCapitalSnapshot = {
  ok:true; capturedAt:string; pricesAvailable:boolean; rows:WarehouseCapitalRow[];
  totals:WarehouseCapitalTotals; bySource:Record<'warehouse'|'boutique',WarehouseCapitalTotals>;
}
type RawRow = Record<string,unknown>
const integer=(v:unknown)=>Number.isFinite(Number(v))?Math.trunc(Number(v)):0
const nullablePrice=(v:unknown)=>v===null||v===undefined||!Number.isSafeInteger(Number(v))||Number(v)<0?null:Number(v)
const str=(v:unknown)=>String(v??'').trim()
export function emptyWarehouseCapitalTotals():WarehouseCapitalTotals{
  return {quantity:0,reserved:0,free:0,pricedCostQuantity:0,pricedSaleQuantity:0,
    bothPricedQuantity:0,knownCost:0,knownSale:0,knownGrossPotential:0,
    knownFreeCost:0,knownReservedCost:0,missingCostQuantity:0,missingSaleQuantity:0,
    stockRows:0,zeroRows:0,negativeRows:0,overReservedRows:0,unlinkedPositiveRows:0}
}
export function sumWarehouseCapital(rows:WarehouseCapitalRow[],quality?:{
  zeroRows:number;negativeRows:number;overReservedRows:number;unlinkedPositiveRows:number
}):WarehouseCapitalTotals{
  const totals=emptyWarehouseCapitalTotals()
  for(const row of rows){
    totals.stockRows++
    totals.quantity+=row.quantity
    totals.reserved+=row.reserved
    totals.free+=row.free
    if(row.costPrice!==null){
      totals.pricedCostQuantity+=row.quantity
      totals.knownCost+=row.costValue||0
      totals.knownFreeCost+=row.free*row.costPrice
      totals.knownReservedCost+=row.reserved*row.costPrice
    }else totals.missingCostQuantity+=row.quantity
    if(row.salePrice!==null){
      totals.pricedSaleQuantity+=row.quantity
      totals.knownSale+=row.retailValue||0
    }else totals.missingSaleQuantity+=row.quantity
    if(row.costPrice!==null&&row.salePrice!==null){
      totals.bothPricedQuantity+=row.quantity
      totals.knownGrossPotential+=row.grossPotential||0
    }
  }
  if(quality)Object.assign(totals,quality)
  return totals
}
export async function readWarehouseCapital(db:D1Database):Promise<WarehouseCapitalSnapshot>{
  const available=await db.prepare(
    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_execution_prices') AS available"
  ).first<{available:number}>()
  const pricesAvailable=Number(available?.available)===1
  // Compare exact stock variant.category to execution price category: no guessed price.
  const sql=`SELECT
    s.id AS stock_id,s.inventory_source,s.variant_id,s.product_id,
    s.product_name_snapshot,s.gender_snapshot,s.color_snapshot,s.size_snapshot,
    s.material_snapshot,s.length_snapshot,s.quantity,s.reserved_quantity,
    v.id AS matched_variant,v.category AS variant_category,v.gender AS variant_gender,
    v.color AS variant_color,v.size_label AS variant_size,
    v.material AS variant_material,v.length AS variant_length,v.is_active AS variant_active,
    p.name AS catalog_product,p.is_active AS product_active
    ${pricesAvailable?',e.cost_price,e.sale_price':',NULL AS cost_price,NULL AS sale_price'}
   FROM inventory_stock s
   LEFT JOIN catalog_variants v ON v.id=s.variant_id
   LEFT JOIN catalog_products p ON p.id=COALESCE(v.product_id,s.product_id)
   ${pricesAvailable?'LEFT JOIN catalog_execution_prices e ON e.stock_position_id=v.stock_position_id AND e.category=v.category':''}
   WHERE s.inventory_source IN ('warehouse','boutique')
   ORDER BY s.id
   LIMIT 20001`
  const result=await db.prepare(sql).all<RawRow>()
  const raw=result.results||[]
  if(raw.length>20000)throw new Error('Отчёт превышает 20 000 складских позиций. Неполную оценку показывать нельзя.')
  const rows:WarehouseCapitalRow[]=[]
  const quality={zeroRows:0,negativeRows:0,overReservedRows:0,unlinkedPositiveRows:0}
  const sourceQuality={
    warehouse:{...quality},boutique:{...quality},
  }
  for(const r of raw){
    const source=r.inventory_source==='boutique'?'boutique':'warehouse'
    const qty=integer(r.quantity)
    if(qty===0){quality.zeroRows++;sourceQuality[source].zeroRows++;continue}
    if(qty<0){quality.negativeRows++;sourceQuality[source].negativeRows++;continue}
    const rawReserved=Math.max(0,integer(r.reserved_quantity))
    const overReserved=rawReserved>qty
    if(overReserved){quality.overReservedRows++;sourceQuality[source].overReservedRows++}
    if(r.matched_variant===null || r.matched_variant===undefined){
      quality.unlinkedPositiveRows++;sourceQuality[source].unlinkedPositiveRows++
    }
    const reserved=Math.min(qty,rawReserved)
    const free=qty-reserved
    const costPrice=nullablePrice(r.cost_price),salePrice=nullablePrice(r.sale_price)
    rows.push({
      stockId:integer(r.stock_id),source,
      variantId:r.variant_id===null?null:integer(r.variant_id),
      productId:r.product_id===null?null:integer(r.product_id),
      product:str(r.catalog_product)||str(r.product_name_snapshot)||'Без названия',
      gender:str(r.variant_gender)||str(r.gender_snapshot),
      color:str(r.variant_color)||str(r.color_snapshot),
      size:str(r.variant_size)||str(r.size_snapshot),
      material:str(r.variant_material)||str(r.material_snapshot),
      length:str(r.variant_length)||str(r.length_snapshot),
      category:str(r.variant_category)||'unknown',
      quantity:qty,reserved,free,costPrice,salePrice,
      costValue:costPrice===null?null:qty*costPrice,
      retailValue:salePrice===null?null:qty*salePrice,
      grossPotential:costPrice===null||salePrice===null?null:qty*(salePrice-costPrice),
      archived:r.variant_active===0||r.product_active===0,overReserved,
    })
  }
  return {
    ok:true,capturedAt:new Date().toISOString(),pricesAvailable,rows,
    totals:sumWarehouseCapital(rows,quality),
    bySource:{
      warehouse:sumWarehouseCapital(rows.filter(r=>r.source==='warehouse'),sourceQuality.warehouse),
      boutique:sumWarehouseCapital(rows.filter(r=>r.source==='boutique'),sourceQuality.boutique),
    },
  }
}
