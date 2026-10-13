# Production physical stock replay — 2026-10-13 (read only)

## Scope and safety

Analyzed production Cloudflare D1 bound in `main` (`orders_db_prod`), never branch2. Used immutable historical `inventory_movements`, `inventory_stock_checks`, `inventory_stocktake_sessions`, inventory stock and active inventory reservations. **No D1 UPDATE/INSERT/DELETE in any forensic run.**

Every source + canonical SKU was reconstructed starting with the most recent completed physical stocktake movement `reference_type='stocktake', movement_type='manual_set'`; full and selective completed revisions both qualify. Manual exact quantity `manual_set/manual`, genuine quick checks, and subsequent confirmed physical actions act as barriers or explicit movements and are **never automatically rolled back**.

Read-only executions: GitHub Actions runs #38419157604, #38419509213, #38420190801, #38420525376.

## Findings

- 19 live SKU/source stock rows have suspect automatic order observations after their last recorded stocktake.
- 17 have a present-day quantity consistent with bounded physical movement replay (or otherwise no actionable discrepancy); **never restore an additional unit purely by summing movement deltas**.
- Two have a nonzero counterfactual after suppressing `order_observation`, but neither can be proved wrong: the observation of 1 might have represented an actual object physically present. **Do not modify either without an independent physical count**.
- Active-reservation cache mismatches: **0**. Duplicate stock rows per source + variant: **0**.
- 11 current-stock/journal-last-after mismatches came from legacy underflow normalization or old catalog identity migration; they are not proof of a new physical loss since the last completed revision. No automatic repairs.
- 32 positions with no recorded physical movement have physical zero and active reservations; this is a legitimate 'promised but not physically recorded' deficit, not proof of physical stock.
- Eight `order_handover_correction` service events checked: only one postdates its latest stocktake (movement #3057, Bayan Camel/42 warehouse), and it has a subsequent physical issue; current physical is 0. No automatic restoration.

## Independent count required (only live ambiguous candidates)

### 1. Bayan Sulu Shapan — light beige / 48 / suede-velour / standard / women's — warehouse

- `stock_id=227`, `variant_id=178`.
- Last authoritative stocktake movement **#3888**, 2026-10-02T18:54:44Z, counted 0.
- Order observation movement **#3968** added 1 on 2026-10-03; shipment **#3970** physically removed 1; order observation **#4948** added 1 on 2026-10-13T13:19:15Z.
- At audit: physical 1, active reserve 2, available -1.
- Active orders: `ORD-20261009095142-D1F1E7A8` and `ORD-20261013131915-4181A125`, both not sent at audit.
- Counterfactual ignoring unverified order observations (bounded shipments): 0, **but that is not proof the current physical 1 is wrong**.
- Independent blind physical count must include any item already set aside for orders. If one order has physically left but shipping state is still not_sent, reconcile its shipment rather than arbitrarily adjust stock.

### 2. Kozy Korpesh Shapan — wet asphalt / 52 / suede-velour / standard / women's — warehouse

- `stock_id=110`, `variant_id=111`.
- Last authoritative stocktake movement **#4079**, 2026-10-06T10:25:12Z, counted 0.
- Order observation movement **#4874** later raised total to 1; there is no later physical movement or independent stocktake for this SKU in the audited range.
- At audit: physical 1, reserved 1, available 0.
- Active unsent order: `ORD-20261012103509-CDB7EA05`.
- Counterfactual ignoring observation: 0, **not enough evidence to overwrite 1**. Independently count the physical object, including reserved items.

## Specific non-candidates

- Bayan Sulu Shapan orange/52 suede-velour standard at boutique (`stock_id=434, variant_id=351`): last count 1, transfer +1, suspect order observation -1, then **three genuine order issues** (one -1 and two bounded issues with movement delta 0, with fulfilled reservation evidence). Current physical=0; **do not restore 1**.
- Bayan Sulu Shapan orange/56 warehouse (`variant_id=33`) has legitimate manual corrections after the revision, currently physical=3; preserve this explicit manager/admin truth.
- All explicit `manual_set/manual` and completed stocktakes remain authoritative. The script never proposes edits to these.

## Safe closure

1. Warehouse staff independently count the two ambiguous physical SKUs, *without seeing the system's expected number*.
2. Establish whether each reserved item is physically on site or has already been issued; correct order shipment state if necessary.
3. Only if observed physical differs from system physical, use an audited warehouse stocktake/correction with explicit evidence, reason and actor. Do not silently replay or delete original historical movements.
4. Refresh and compare expected `inventory_stock.quantity`, `reserved_quantity`, `updated_at`, active order references, and most recent movement immediately before applying any correction (optimistic CAS). Abort if changed. Inventory stocks and production data have NOT been modified by this investigation.

Release safety fixes preventing *future* hidden order count corrections already shipped in main PR #387. This is strictly a historical audit.
