// UI-side fail-closed stock choices for an EXACT business-identity SKU pair.
// Backend remains authoritative: D1 CAS and immutable stock journal must recheck.
export type VerifiedSkuLocation={
 location:string;sourcePhysical:number;keeperPhysical:number;
 sourceReserved:number;keeperReserved:number;reservedTotal:number;
 combinedPhysical:number;requiresDecision:boolean;needsInvestigation:boolean
}
export type VerifiedSkuPreview={
 canConsolidate:boolean;canConsolidateAfterVerifiedSum:boolean;
 blockers:string[];stockReconciliation:{locations:VerifiedSkuLocation[]}
}
export type SkuDecisionMethod='sum'|'keep_source'|'keep_keeper'|'physical_count'|'defer'
export type SkuPlaceChoice={method?:SkuDecisionMethod;verified?:boolean;reason?:string;counted?:string}
export type SkuChoiceMap=Record<string,SkuPlaceChoice>
export type VerifiedChoice={
 location:string;method:Exclude<SkuDecisionMethod,'defer'>;
 physicallyVerified:true;countedQuantity?:number;reason?:string
}
const allowed=new Set(['warehouse','boutique'])
const valid=(n:number)=>Number.isSafeInteger(n)&&n>=0
const METHODS=new Set(['sum','keep_source','keep_keeper','physical_count'])

export function confirmedSkuStockDecisions(
 preview:VerifiedSkuPreview,
 choices:SkuChoiceMap,
):VerifiedChoice[]|null{
 if(!preview?.canConsolidateAfterVerifiedSum
   || !Array.isArray(preview.blockers) || preview.blockers.length>0
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
 const results:VerifiedChoice[]=[]
 for(const place of needed){
  const choice=choices[place.location]
  if(!choice || choice.verified!==true || !choice.method || !METHODS.has(choice.method))return null
  const method=choice.method as VerifiedChoice['method']
  const reason=(choice.reason||'').trim()
  let resulting=place.combinedPhysical
  let countedQuantity:number|undefined
  if(method==='keep_source')resulting=place.sourcePhysical
  if(method==='keep_keeper')resulting=place.keeperPhysical
  if(method==='physical_count'){
   const raw=(choice.counted||'').trim()
   if(!/^\d+$/.test(raw))return null
   countedQuantity=Number(raw)
   if(!valid(countedQuantity))return null
   resulting=countedQuantity
  }
  if(method!=='sum' && (reason.length<12||reason.length>500))return null
  // Customer commitments are never implicitly reduced to make accounting fit.
  if(resulting<place.reservedTotal)return null
  results.push({
   location:place.location,method,physicallyVerified:true,
   ...(method==='physical_count'?{countedQuantity}:{}),
   ...(method!=='sum'?{reason}:{})
  })
 }
 return results
}
