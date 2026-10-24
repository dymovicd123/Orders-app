/**
 * An issue can open correction only on the exact source and variant identity.
 * Matching by name/color/size would risk editing another product.
 */
export function findCorrectionFocusGroup<
  Row extends { variantId: string | number; productId: string | number },
  Group extends { key: string; rows: Row[] },
>(groups: readonly Group[], target: {variantId: number; productId: number}): Group | undefined {
  if (!Number.isSafeInteger(target.variantId) || target.variantId <= 0) return undefined
  return groups.find(group => group.rows.some(row =>
    Number(row.variantId) === target.variantId
    && (!target.productId || Number(row.productId) === target.productId)))
}
