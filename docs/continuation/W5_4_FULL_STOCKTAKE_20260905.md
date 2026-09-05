# W5.4 — Full stocktake comprehension and completion UX

Date: 2026-09-05
Base Production: `a4a9ee8968523bac9d72bdce39cdfcd4d3d45477` (`W5: restore manager Warehouse checks and history`)

## Goal
Keep the proven resumable stocktake engine and layout, but remove the remaining points where an employee can hesitate during a full physical count: what an empty field means, why system numbers are hidden, what is saved, what cancel does, where to go next, and what the final button will do.

## Changes
- Active header no longer exposes the technical session id; the id remains on the printable audit sheet.
- Autosave state now says whether values are saved and explicitly tells the employee to wait before leaving/reviewing when writes are still pending.
- Persistent progress includes percentage and a concrete next-action message.
- Full-count rule explicitly states blind-first behavior and distinguishes an empty field from physical zero.
- Product browser and mobile selector use `готово`, `осталось`, and `пересчитать` states instead of terse counters/checkmarks.
- Current product shows its own counted/recount state.
- High-risk `Остальные = 0` becomes `Остальных нет`, with a visible consequence: it fills remaining blank positions with zero and should only be used after the product was physically counted.
- Footer gives a real next action instead of describing where UI controls are located.
- Review is named `Проверка результата`; system quantities are explained as intentionally appearing only after the physical count.
- Final action says `Сохранить изменения и завершить` when differences exist and explains the existing all-or-nothing conflict behavior.
- Cancel explanation states that cancellation closes the check without changing stock; leaving the section remains the safe way to continue later.
- Small-screen rules keep current-product actions, next action, review and finish controls large and stack them when needed.

## Deliberate non-changes
- No migration, D1 probe or Production data write.
- No stocktake server algorithm change: autosave, retry/idempotency, CAS/conflict marking and all-or-nothing completion remain unchanged.
- No change to `Найденная позиция`; that belongs to W5.5.
- No change to W5.6 completion consequences/recovery summary yet.
- Arrival UI frozen; Branch2 untouched.

## Next
W5.5: make found/unclear physical items during a check resolve naturally without turning the employee into a catalog administrator.
