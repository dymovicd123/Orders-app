import type {WatchSource} from '../../shared/client3/watch-domain.ts'

type StockLine={source:WatchSource;variantId:number;quantity:number}
export type WatchStockAvailabilityIssue={
 source:WatchSource;variantId:number;requested:number;available:number
}

/** Read-only preflight; Main's critical operation owns the final reservation. */
export async function findUnavailableWatchStockSelections(
 db:D1Database,lines:readonly StockLine[],
):Promise<WatchStockAvailabilityIssue[]>{
 const groups=new Map<string,StockLine>()
 for(const line of lines){
   const key=line.source+':'+line.variantId
   const existing=groups.get(key)
   if(existing)existing.quantity+=line.quantity
   else groups.set(key,{...line})
 }
 const issues:WatchStockAvailabilityIssue[]=[]
 for(const line of groups.values()){
   const location=line.source==='office'?'warehouse':'boutique'
   const [stock,claims]=await Promise.all([
     db.prepare('SELECT COALESCE(SUM(quantity),0) AS physical,'+
        ' COALESCE(SUM(reserved_quantity),0) AS reserved'+
       ' FROM inventory_stock WHERE inventory_source=? AND variant_id=?')
       .bind(location,line.variantId).first<{physical:number;reserved:number}>(),
     db.prepare('SELECT COALESCE(SUM(quantity),0) AS reserved'+
       " FROM inventory_reservations WHERE inventory_source=? AND variant_id=? AND status='active'")
       .bind(location,line.variantId).first<{reserved:number}>(),
   ])
   const physical=Math.max(0,Number(stock?.physical||0))
   const reserved=Math.max(0,Number(stock?.reserved||0),Number(claims?.reserved||0))
   const available=Math.max(0,physical-reserved)
   if(available<line.quantity)issues.push({
     source:line.source,variantId:line.variantId,requested:line.quantity,available,
   })
 }
 return issues
}
