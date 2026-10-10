# Catalog duplicate prevention — exhaustive semantic SKU lookup (2026-10-10)

## Problem
The ordinary V3 catalog create/edit paths reuse `findCatalogCombinationV3` and `findRetiredCatalogCombinationV3`. They correctly normalize stock position, category, gender, size, and dash/space punctuation of color, but the fallback scan was truncated with `LIMIT 200`. A legacy equivalent stored as the 201st or later candidate could escape detection and create a duplicate physical SKU (or bypass retired identity checks). The fast exact path is already indexed and remains intact.

## Change
- Keep exact lookup as first operation.
- When exact spelling fails, scan the eligible active/retired combinations in **200-row ID-keyset pages**. Return the first semantic match; only return “not found” when the final page contains fewer than 200 entries.
- Cursor ascends for active and descends for retired; all SQL bindings and filters preserve execution, category, gender, normalized size and excluded ID. Only one page is held in memory.
- No migrations, no new locks, no historical or financial edits, no user form blocking beyond existing duplicate prevention.
- New in-memory SQLite test creates >310 active legacy combinations and >310 retired combinations; finds target after the old cap, does not cross size/gender/stock position, confirms `createCatalogCombinationV3` reuses an existing semantic SKU and a genuinely new color still creates.

## Remaining business stage
This closes a **specific prevention gap**, not all possible duplicate races or the cross-characteristic merge contract. Different colors, material, length, size and child age are not intrinsically equivalent; an admin decision must be backed by a full source→target SKU mapping, proof of per-location physical/reservation totals, active obligations, prices and immutable shipped history, with an explicit choice of which representation should remain. No change to the normal exact-SKU consolidation writer until that separate contract is fully validated.

Quality, cumulative Stage04-safe tests, Cloudflare PR check, and exact branch2 deployment required. Never merge to `main` or touch production D1 on this task.
