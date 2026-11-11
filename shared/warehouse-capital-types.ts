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
