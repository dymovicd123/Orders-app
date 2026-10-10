// Additional client-side guard for explicit per-location stock decisions.
// Server-side SQL/CAS validation is always the source of truth.
export type VerifiedSkuLocation={
 location:string;sourcePhysical:number;keeperPhysical:number;
 sourceReserved:number;keeperReserved:number;reservedTotal:number;
 combinedPhysical:number;requiresDecision:boolean;needsInvestigation:boolean
}
export type VerifiedSkuPreview={
 canConsolidate:boolean;canConsolidateAfterVerifiedSum:boolean;
 blockers:string[];stockReconciliation:{locations:VerifiedSkuLocation[]}
}
export type VerifiedSumChoice={location:string;method:'sum';physicallyVerified:true}
const allowed=new Set(['warehouse','boutique'])
const valid=(n:number)=>Number.isSafeInteger(n)&&n>=0

export function confirmedSkuStockDecisions(
 preview:VerifiedSkuPreview,
 confirmed:Record<string,boolean>,
):VerifiedSumChoice[]|null{
 if(!preview || !preview.canConsolidateAfterVerifiedSum || preview.blockers.length>0
   || !Array.isArray(preview.stockReconciliation?.locations)
   || preview.stockReconciliation.locations.length!==2) return null
 const places=preview.stockReconciliation.locations
 if(new Set(places.map(x=>x.location)).size!==2
   ||places.some(x=>!allowed.has(x.location)
     ||![x.sourcePhysical,x.keeperPhysical,x.sourceReserved,x.keeperReserved,
       x.reservedTotal,x.combinedPhysical].every(valid)
     ||x.combinedPhysical!==x.sourcePhysical+x.keeperPhysical
     ||x.reservedTotal!==x.sourceReserved+x.keeperReserved
     ||x.requiresDecision!==(x.sourcePhysical>0))) return null
 const needed=places.filter(x=>x.requiresDecision)
 if(needed.length===0)return preview.canConsolidate?[]:null
 // Each source-positive location must be verified independently. There is
 // deliberately no default and no global checkbox for all places.
 if(needed.some(place=>confirmed[place.location]!==true))return null
 if(needed.some(place=>place.combinedPhysical<place.reservedTotal))return null
 return needed.map(place=>({location:place.location,method:'sum',physicallyVerified:true}))
}
