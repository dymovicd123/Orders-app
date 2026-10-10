# Stock reconciliation before SKU/reference merge — Stage 5 (2026-10-10)

**Operations are rare, privileged and potentially destructive. Keep existing UI unchanged until backend acceptance is complete.**

## Domain separation

1. **Reference alias**: admin decides which color/material/size label is canonical; this does not establish physical stock truth.
2. **Variant identity**: exact SKU business equivalence is verified per product, material, length, gender, audience and size.
3. **Physical stock**: each SKU pair at **warehouse** and **boutique** gets an INDEPENDENT disposition.

## Stage 5 backend

- Every variant consolidation preview exposes the two quantities, sum, reservation totals, last available stock-check evidence (date, counted quantity, actor and type) and five alternative scenarios per location:
  - **sum**: only if independently physically verified that both quantities represent different units;
  - **keep source**, **keep keeper**: requires a later separately audited reconciliation writer;
  - **physical count**: physical count unknown until staff reports it; must follow verified stocktake workflow;
  - **defer**: keep pair unchanged, don't block review of other product pairs.
- For each option, project resulting physical, difference from arithmetic sum and shortage against **combined active reservations**.
- No automatic selection, no false confidence score; a past check is merely evidence, not proof of today's stock.
- Previously an exact-SKU merge *silently summed physical stock*. For any source with positive physical quantity, the existing admin API now requires **a deliberate per-location** `sum / physicallyVerified` decision for every source-positive location, plus the current exact preview token. It rejects partial, duplicate, unknown, or unsupported decisions. This is NOT a bulk confirmation for all products.
- The current UI doesn't supply this confirmation, so **positive-source mergers cannot be confirmed from that UI until a later deliberate redesign**. The backend still supports verified individual summed-stock merges, retaining all legacy D1 transfer, reservation, audit and rollback checks.
- Zero-source-quantity merges still use the guarded stock/reservation writer after the normal preview-token and history/rollback checks, without inventing physical additions.

## Stage 6/7 design backlog — NOT IMPLEMENTED

- Account corrections such as **keep source**, **keep keeper**, **physical count** must be first-class compensated inventory events, never pretend inventory disappeared through a sale/writeoff. They must have actor, reason, timestamp, per-location before/after balances and stale-state guard.
- Old order identity and original customer-visible snapshots remain immutable. Current orders/reservations may be remapped only under the guarded writer.
- An operator-confirmed physical figure below reservations is a real shortage: report and resolve the customer commitment explicitly; never erase a reservation to make the numbers match.
- Reversal needs a new preview, checked downstream movements, per-order commitments and journal, with a compensating transaction rather than pretending the original consolidation never happened.
- Physical-count evidence freshness should be validated before any future automatic suggestion; even a recent stocktake can be wrong. No bulk default to "sum".
- Follow final TypeScript, regression, schema rehearsal, isolated branch2 deployment, and real public asset validation before discussing UI or main.
