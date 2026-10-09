// Pure presentation math for manual physical writeoff. Does not mutate inventory.
export type WriteoffReviewInput = {
  variantId: number;
  productName: string;
  detail: string;
  requested: number;
  physical: number;
  reserved: number;
}
export function summarizeWriteoff(lines: WriteoffReviewInput[]) {
  const rows = lines.filter(x=>Number(x.requested)>0).map(x=>{
    const physical = Math.max(0,Number(x.physical)||0)
    const reserved = Math.max(0,Number(x.reserved)||0)
    const requested = Number(x.requested)
    const validQuantity = Number.isSafeInteger(requested) && requested>0
    const tracked = validQuantity ? Math.min(physical,requested) : 0
    const after = physical - tracked
    const untracked = validQuantity ? Math.max(0,requested-physical) : 0
    const shortageBefore = Math.max(0,reserved-physical)
    const shortageAfter = Math.max(0,reserved-after)
    return { ...x, physical,reserved,requested,validQuantity,tracked,after,untracked,
      availableBefore:physical-reserved,shortageAfter,newShortage:Math.max(0,shortageAfter-shortageBefore) }
  })
  return {
    rows, valid:rows.length>0 && rows.every(x=>x.validQuantity),
    totalRequested:rows.reduce((n,x)=>n+(x.validQuantity?x.requested:0),0),
    totalTracked:rows.reduce((n,x)=>n+x.tracked,0),
    totalUntracked:rows.reduce((n,x)=>n+x.untracked,0),
    totalNewShortage:rows.reduce((n,x)=>n+x.newShortage,0),
    affectedReservations:rows.reduce((n,x)=>n+(x.reserved>0?1:0),0),
  }
}
