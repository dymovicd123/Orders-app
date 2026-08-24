# Warehouse current context — canonical continuation

Updated: 2026-08-25
Repository: `dymovicd123/Orders-app`

This file is the canonical current continuation context for Warehouse work. It supersedes older roadmap wording where they conflict with this file. Git history preserves previous checkpoints.

## Mandatory continuation protocol

After every meaningful intermediate Warehouse step, update this file in the branch being worked on. A meaningful intermediate step includes:

1. completing a read-only forensic/audit;
2. making a source change that changes the current implementation state;
3. completing or failing a Branch 2 release gate/deploy;
4. completing a real Branch 2 acceptance scenario;
5. promoting a verified diff to `main`;
6. completing or failing Production deploy/acceptance;
7. discovering a new invariant, product rule, hidden defect or changed next action.

Each update must record:
- exact branch/commit;
- what was completed;
- what was found;
- what is still open in the current phase;
- exact next action;
- CI/deploy status;
- any new safety/product invariant.

On a new chat/continuation, read this file before relying on old conversation memory or older roadmap files.

## Current verified baseline

### Completed and closed unless a concrete new bug appears

- 192B2A4 Order Create / Save Integrity.
- 192B2B Movement picker + transfer UX.
- Transfer runtime/atomicity 191D/191E.
- Stocktake lost-response/retry hardening.
- Full stocktake functional acceptance gate: start/resume, count persistence, counted_at preservation, conflict/recount, atomic completion, completion replay after lost response, quick-check replay/race, active-session guard, cancellation and check history.
- GitHub -> Cloudflare monitored deploy flow for `branch2` and `main`.

Latest Production stocktake acceptance commit at this checkpoint:
- `a6d688bc737a28711573d2a1d1c3d849afdc6ca0` — `Add stocktake functional acceptance gate`
- `cloudflare-deploy/main = success`

### Frozen / deferred

- Arrival UI remains frozen and must not be changed by Warehouse/catalog work.
- Step 190.0 access/login redesign remains deferred pending client agreement and is not part of the active Warehouse completion plan.

## Authoritative product rules

### Inventory model

- Physical.
- Reserved.
- Available = Physical - Reserved.
- Order creation reserves Warehouse/Boutique stock; ordinary Workshop lines are not Warehouse/Boutique stock lines.
- Ordinary client shipment is all-or-nothing except the already accepted narrow early handover behavior for mixed orders.

### Workshop lifecycle — corrected 2026-08-25

This rule overrides older roadmap wording about Workshop -> Warehouse auto-intake.

1. A product made in Workshop does **not** enter Warehouse inventory when production is completed.
2. A completed Workshop item goes directly through the order/customer shipment flow.
3. Workshop completion/status changes must not write `inventory_stock`, create Warehouse/Boutique reservations, or pretend to be an inventory intake.
4. Warehouse only becomes relevant to that Workshop-made item if the client later returns the item **and an explicit business decision is made to send that returned item to Warehouse**.
5. A client return by itself does not imply Warehouse intake.
6. If the returned Workshop-made item is not explicitly sent to Warehouse, it does not enter Warehouse/Boutique inventory at all.
7. Therefore an exact-known Workshop return must not be auto-intaken merely because its identity is known.
8. Inventory identity resolution is required for a returned Workshop item only when a stock-affecting disposition actually needs a canonical Warehouse SKU. A non-stock disposition must not create pointless catalog/Attention work solely to force an inventory identity.

### Warehouse Attention

- Derived operational queue, not a persistent case-management system.
- No owners/SLA/deadline framework.
- Safe known states should auto-resolve.
- One physical fact should lead to one narrow action/question.
- Admin involvement only for genuinely ambiguous decisions.

### Physical truth / freshness

- No older event may overwrite newer physical truth.
- Active stocktake, overlapping stocktake, later exact physical checks and trusted full-stocktake baselines must remain respected by stock-affecting return/intake paths.
- Branch 2 is a technical acceptance environment, not evidence of Primary physical Warehouse truth.

## Remaining Warehouse plan — exact order

### Phase 0 — short read-only visual acceptance of already completed Warehouse UX

Purpose: close presentation acceptance of work that is already technically complete; do not open a new large feature unless a concrete defect is observed.

Primary read-only checks:
- Warehouse Attention problem types remain visually distinct.
- Order context is understandable where needed.
- Ancient chronology is not presented as a current action without a real unresolved reason.
- Auto-resolved known cases do not remain as "needs review".
- `Разобрать` opens the concrete object/problem immediately.
- Shortage/handover do not duplicate the same required quantity.
- Known inbound/return states are not mislabeled as unknown catalog problems.
- Movement picker is usable with real Primary stock in both Warehouse -> Boutique and Boutique -> Warehouse directions.
- Search by product/attributes works and selected rows remain understandable.
- Mobile layout is usable.
- Arrival remains unchanged.

Acceptance rule: visual/read-only by default. Do not press a final stock mutation button merely for visual acceptance.

Exit: either no defects, or only concrete small follow-up defects are fixed through Branch 2 first.

### Phase 1 — correct returned Workshop item disposition and stock intake semantics

This is the next major correctness phase.

#### 1A. Read-only cross-workflow audit first

Audit current code for:
- return creation;
- exchange old-item return;
- inventory lifecycle events;
- catalog resolution for Workshop-origin returned items;
- Warehouse Attention entries created by these paths;
- cancellation/reversal;
- retry/lost-response behavior;
- order reservation/shipping interactions.

Primary question: identify every place where a known Workshop-origin returned item can currently change Warehouse stock automatically or create unnecessary identity-review work.

No D1 mutation during this audit.

#### 1B. Implement explicit disposition

Required semantic result:

`Workshop production complete -> customer/order flow -> possible client return -> explicit disposition decision -> Warehouse only if explicitly chosen`

For Workshop-origin returns:
- return record/history is created independently of Warehouse stock intake;
- default/no-stock disposition does not mutate inventory;
- explicit `to Warehouse` disposition is the only path that may create Warehouse intake;
- exact canonical identity + explicit `to Warehouse` may use the safe stock intake path;
- unknown/conflicting identity + explicit `to Warehouse` goes to one narrow resolution action before stock mutation;
- unknown identity with no-stock disposition must not create pointless catalog-review/Attention work merely because no canonical stock SKU exists;
- no implicit Boutique intake;
- Workshop task completion remains production-only and never becomes inventory intake.

#### 1C. Safety requirements

- explicit disposition must be retry/idempotency safe;
- lost response must not double-intake;
- cancellation/reversal must not double-reverse;
- freshness barrier must be rechecked immediately before a stock-affecting intake;
- old return events must not overwrite a later stocktake or later exact physical check;
- no duplicate lifecycle event for the same returned line;
- reservations/shipping must not accidentally treat ordinary Workshop production as Warehouse stock;
- history must show the return and, separately, whether a Warehouse intake actually occurred.

#### 1D. Acceptance

Regression scenarios must cover at least:
1. Workshop item completed -> no Warehouse stock change.
2. Workshop item shipped to client -> no Warehouse stock intake side effect.
3. Client returns known Workshop item, no-stock disposition -> no inventory change.
4. Same return retried -> still no inventory change.
5. Client returns known Workshop item, explicit Warehouse disposition -> exactly one intake.
6. Lost response/retry of that intake -> still exactly one intake.
7. Unknown Workshop return, no-stock disposition -> no forced inventory identity task.
8. Unknown Workshop return, Warehouse disposition -> one clear identity-resolution path before intake.
9. Later stocktake/check supersedes older return event correctly.
10. Return/exchange cancellation preserves physical truth and history.

Branch 2 technical gate first; Primary mutation acceptance only if an intentionally chosen real scenario is necessary.

### Phase 2 — calm stock-check / cycle-count UX

Technical stocktake reliability is already closed. This phase is UX/workflow simplification, not a rewrite of stock mathematics.

Target routine flow:
1. find item;
2. see current Physical / Reserved / Available;
3. enter actual physical quantity or confirm `На месте` where appropriate;
4. save;
5. server handles chronology/freshness/conflicts automatically.

Requirements:
- no routine manual reconstruction of "where was this item at revision time";
- quick check, cycle count and full stocktake remain separate capabilities where they serve different jobs, but their language and entry points must be coherent;
- clear conflict/recount messages;
- recent exact checks visible when useful without dumping technical history;
- mobile-friendly fast count entry;
- existing functional/retry acceptance gate remains mandatory.

Exit: normal staff can perform routine physical verification without admin reasoning.

### Phase 3 — Step 192B3 Catalog redesign

Large UX/product phase. Do not mix it with stocktake or return-disposition work.

Target structure:
- Product -> Execution -> Variations.
- Execution = material/length.
- Variation characteristics include gender/type/color/size according to the established catalog rules.

Requirements:
- practical product search;
- clear grouped execution/variant navigation;
- easy visibility of active real SKUs;
- normal editing of reference-backed characteristics;
- garbage/retired values do not dominate everyday selection;
- blank/standard values are not automatically treated as unknown;
- legitimate explicit `БЕЗ ЦВЕТА` remains valid;
- blank manager color must not synthesize/select a conflicting colorless SKU;
- cards/rows with no variants remain operable where the product model allows it;
- mobile usability;
- Arrival untouched.

Cleanup rule:
- only 100%-proven garbage may be soft-retired/removed from operational UI;
- no destructive mass normalization by name;
- before any data cleanup, perform Primary forensic/evidence audit;
- preserve order/history/reference relationships;
- Branch 2 never proves Primary physical/catalog history.

Exit: catalog is understandable as a product model rather than a flat technical SKU dump.

### Phase 4 — Warehouse Attention final simplification / admin independence

After the return-disposition, calm-count and catalog phases, re-audit Attention instead of building a separate task system.

Target:
- deterministic safe cases disappear automatically;
- known return with no-stock disposition does not become an inventory problem;
- known return explicitly sent to Warehouse resolves normally when identity/freshness are safe;
- unknown stock-affecting return gets one precise question;
- shortages, handover, freshness and catalog ambiguity remain separated and de-duplicated;
- employees can recover from ordinary stale/lost-response states without an administrator;
- administrator sees only genuinely ambiguous cases.

Do not add persistent owners, SLA, deadlines or case-management infrastructure.

Exit: temporary admin absence does not stop routine Warehouse operations.

### Phase 5 — final Warehouse cross-workflow acceptance / audit

Run only after Phases 1-4 are complete.

Audit the whole system together:
- create/edit order;
- zero-payment order;
- Warehouse/Boutique reservation;
- Workshop order line creation;
- Workshop task progression/completion;
- direct Workshop-to-client shipment semantics;
- shortages;
- early handover;
- final shipping;
- Warehouse <-> Boutique movement;
- client returns;
- Workshop-origin return disposition;
- Warehouse intake only after explicit return disposition;
- exchanges;
- quick stock checks;
- cycle counts;
- full stocktakes;
- stocktake conflicts/recount;
- catalog selection/editing/retirement;
- Warehouse Attention;
- cancellation/reversal;
- retry/lost-response;
- mobile layouts;
- history correctness;
- Cloudflare/D1 row/bind/runtime limits;
- no unintended Arrival changes.

Final acceptance invariants:
- no successful mutation may look like a failure merely because a readback failed;
- no retry may duplicate a business/stock mutation;
- no older event may overwrite newer physical truth;
- ordinary Workshop production never becomes Warehouse stock;
- returned Workshop product enters Warehouse only by explicit stock disposition;
- ordinary staff can complete routine Warehouse work without reconstructing system history or waiting for admin intervention.

## Current next action

Phase 0 visual acceptance can be performed briefly, but the next code/audit task is **Phase 1A: read-only cross-workflow audit of Workshop-origin client return/exchange disposition**. The purpose is to locate and remove any automatic Warehouse intake that occurs merely because a returned Workshop item has a known canonical identity.
