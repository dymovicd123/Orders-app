// Shared standalone Return capacity predicate used by Return and Exchange.
// The filter excludes returns whose money is part of an active Exchange.
import { toInt } from '../core/text.ts'

export const noStandaloneReturnSql = `NOT EXISTS (
  SELECT 1
  FROM exchanges e
  WHERE e.refund_return_id = r.id
    AND COALESCE(e.status, 'completed') <> 'cancelled'
)`;


export async function hasActiveStandaloneReturn(db: D1Database, orderId: number) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM returns r
     WHERE r.order_id = ?
       AND COALESCE(r.status, 'completed') <> 'cancelled'
       AND ${noStandaloneReturnSql}`
  ).bind(orderId).first<{ count: number }>();
  return toInt(row?.count, 0) > 0;
}
