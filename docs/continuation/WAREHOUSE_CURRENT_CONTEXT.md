# Warehouse current context — canonical continuation

Updated: 2026-08-26
Repository: `dymovicd123/Orders-app`

This file is the canonical current continuation context for Warehouse work. It supersedes older roadmap wording where it conflicts with this file. Git history preserves earlier checkpoints.

## Mandatory continuation protocol

After every meaningful intermediate Warehouse step, update this file in the branch being worked on. A meaningful step includes:

1. completing a read-only forensic/audit;
2. making a source implementation change;
3. completing/failing a Branch 2 release gate or deploy;
4. completing a real Branch 2 acceptance scenario;
5. promoting a reviewed diff to `main`;
6. completing/failing Production deploy or acceptance;
7. discovering a new invariant, hidden defect, product rule, performance issue or changed next action.

Record exact branch/commit, what was completed, findings, open work, exact next action, CI/deploy status and new invariants. On a new chat, read this file before older plans/memory.

## Current verified baseline

### Completed / closed unless a concrete new bug appears

- 192B2A4 Order Create / Save Integrity.
- 192B2B movement picker + transfer UX.
- Transfer runtime/atomicity 191D/191E.
- Stocktake lost-response/retry hardening.
- Full stocktake functional acceptance: start/resume, count persistence, `counted_at`, conflict/recount, atomic completion, completion replay after lost response, quick-check replay/race, active-session guard, cancellation and physical-check history.
- GitHub -> Cloudflare monitored deploy flow for `branch2` and `main`.

Latest known Production stocktake acceptance product checkpoint remains:
- `a6d688bc737a28711573d2a1d1c3d849afdc6ca0` — stocktake functional acceptance gate.

### Frozen / deferred

- **Arrival / `Приход` UI is frozen.** Warehouse/catalog work must not change it.
- Step 190.0 access/login redesign remains deferred pending client agreement.

## Authoritative Warehouse rules

### Inventory model

- Physical.
- Reserved.
- Available = Physical - Reserved.
- Order creation reserves Warehouse/Boutique stock.
- Ordinary Workshop lines are not Warehouse/Boutique stock lines and must not create stock reservations.
- Ordinary client shipping is all-or-nothing except the already accepted narrow early-handover flow for a Warehouse/Boutique portion of a mixed Warehouse+Workshop order.

### Workshop lifecycle — corrected rule

1. Workshop production completion does **not** put the made item into Warehouse.
2. The made item goes directly through the order/customer shipment flow.
3. Workshop completion/status changes must not write `inventory_stock`, create Warehouse/Boutique reservations or masquerade as intake.
4. Warehouse becomes relevant only after a client return **and an explicit business decision to send that returned item to Warehouse**.
5. Return itself does not imply inventory intake.
6. If the returned Workshop item is not explicitly sent to Warehouse, it enters neither Warehouse nor Boutique inventory.
7. Exact-known identity does not justify automatic intake.
8. Identity resolution is required only when an actual stock-affecting disposition needs a canonical SKU.
9. A no-stock Workshop return must not create pointless catalog/Attention work.
10. No implicit Boutique intake. The same rule applies to the old item in an exchange.

### Warehouse Attention

- Derived operational queue, not a persistent case-management system.
- No owners/SLA/deadline framework.
- Safe deterministic states should auto-resolve.
- One physical fact -> one narrow action/question.
- Admin only for genuine ambiguity.
- Do not solve adoption by adding more red/yellow cards; routine maintenance should be calm and contextual.

### Physical truth / freshness

- No older event may overwrite newer physical truth.
- Active stocktake, later exact physical checks and trusted full-stocktake baselines remain authoritative barriers for stock-affecting lifecycle events.
- Branch 2 is a technical acceptance environment, not evidence of Primary physical Warehouse truth.

## Read-only full Warehouse revision — 2026-08-26

Audit basis:
- main source baseline before this docs-only checkpoint: `baa0a71682497cf3e2ed3e61af3ab0082a53ef7e`;
- branch2 source baseline before this docs-only checkpoint: `51a531815ab2fffab8552748bf62add84b687ed3`;
- no product mutation, D1 write, migration or Arrival change during the audit.

### Main conclusion

Warehouse mathematics/retry/freshness is stronger than its daily human workflow. The biggest remaining risk is behavioral: the system assumes someone will consciously enter maintenance/admin screens and process visually noisy queues. For busy staff, that is unlikely to form a habit.

Therefore Phase 2 is no longer just “make cycle count prettier”. It becomes **smart daily stock truth**: surface a very small useful batch in the natural `Остатки` flow, make confirmation nearly effortless, and keep full/selective revision strict and separate.

### Confirmed cycle-count / stocktake findings

1. Current “Короткая проверка” is buried inside the admin `Ревизия` screen. A worker must first decide to do a revision before seeing recommendations.
2. Cycle suggestions are admin-only end-to-end: normal users do not get the Revision tab, GET `/api/inventory/cycle-counts` and POST apply are admin-gated.
3. This conflicts with the product goal that ordinary staff maintain routine physical truth without admin reasoning.
4. A normal user **already can** perform a safe exact quick check from `Остатки -> Сверить количество`; the mutation endpoint is not admin-only and already has stale expected-quantity protection. So routine recommended checks can reuse existing safe rights without granting movement/catalog/admin powers.
5. Current recommendation score is technically sensible: negative physical, negative available/shortage, never checked, 30/60-day staleness, movements since last check and prior discrepancy all increase priority.
6. The current card exposes the overall backlog (`N позиций просят внимания`) and can therefore make a maintenance task feel large before the user starts. Routine UX should show a capped “now” batch instead of a scary backlog.
7. Correct counts still require number entry. Matching the system should become a one-tap `Совпадает / На месте X` confirmation; numeric entry is for mismatch.
8. One active stocktake blocks cycle suggestions for the entire Warehouse/Boutique source. DB also enforces one active stocktake per source. This is good chronology protection but creates an adoption trap if a selective/full revision is abandoned.
9. Routine cycle candidates currently exclude positions where physical=0 and reserved=0. Hidden physical extras in a system-zero SKU therefore cannot be discovered by routine suggestions; only a fuller revision/manual discovery catches them.
10. Do not respond by sampling every zero catalog variant: that would create huge noise. If zero sampling is added, it must be narrow/risk-based (recently zeroed, prior discrepancy, recent movement/high-risk evidence).
11. `inventory_stock_checks` already stores successful confirmations including zero-difference checks and has useful source+variant+time indexes. No new “check history” model is needed.
12. Cycle scoring currently includes a correlated count of `inventory_movements` by source+variant+created_at. The initial migration inspected exposes an index oriented to movement reference, not this exact access path. Before making cycle suggestions refresh frequently on `Остатки`, benchmark/query-plan this read and add a narrow index only if needed. Do not assume repeated D1 scans are free.
13. No physical shelf/rack/bin location field or barcode/QR workflow was found. Physical findability may become the real cost of cycle counting, but do not add location/barcode infrastructure speculatively. First observe actual friction.
14. Full stocktake reliability should remain separate from routine checks. Do not weaken freshness chronology to make the UX easier.

### Confirmed Workshop return/exchange findings — Phase 1A complete

1. Current return backend still contains the old exact-known Workshop auto-intake path: a returned Workshop line chosen for restock can pass `canAutoApplyFreshWorkshopInbound(...)` and then `applyCanonicalInventoryLifecycleEvent(...)`.
2. This conflicts with the corrected rule if Warehouse disposition was not an explicit Warehouse-only decision.
3. Return UI currently offers no-stock / Warehouse / Boutique broadly; Workshop-origin return must not offer Boutique as a stock destination under the corrected rule.
4. Exchange old-item draft correctly defaults to no-stock, but its UI also offers Warehouse/Boutique/none regardless of Workshop origin; Workshop old item must follow the same none-or-explicit-Warehouse rule.
5. Cancellation/reversal already goes through lifecycle cancellation. Preserve that mechanism rather than inventing parallel reversal logic.
6. Ordinary order reservation code explicitly skips `item.isWorkshop`, so the standard reservation path does not currently treat Workshop production as Warehouse/Boutique stock.
7. No-stock Workshop return should bypass canonical inventory identity resolution entirely; otherwise it creates false catalog/Attention work.

### Warehouse Attention / interface findings

- Attention architecture is already derived rather than persistent cases; keep this.
- Current Attention covers shortages, lifecycle/intake, catalog ambiguity, handover and active revision; routine cycle suggestions are absent.
- Do **not** make cycle counting another large Attention category or global dashboard warning. A calm cue belongs primarily in Warehouse `Остатки`, where the employee is already working with stock.
- Global/dashboard surfaces already contain many warnings. More banners would increase the “visual noise” problem the redesign is meant to solve.
- Admin Health/diagnostic wording contains some legacy/technical semantics. Later signal-compression work should keep daily UI focused on current actionable truth and leave diagnostics in admin space.

### Movement/catalog findings

- Movement picker/transfer area is functionally mature after 192B2B. Keep closed unless a concrete defect appears. Arrival remains untouched.
- Catalog remains a large mixed admin surface (catalog, unresolved items, pending movement/lifecycle, references) and still justifies Phase 3 Product -> Execution -> Variations redesign.
- Do not put cycle-count UX into Catalog.

## Revised Warehouse plan — exact order

### Phase 0 — presentation acceptance is no longer a standalone workstream

Do short read-only Primary visual checks opportunistically while implementing the next phases. Do not spend a separate large phase on already-closed screens unless a concrete presentation defect appears.

### Phase 1 — Workshop return/exchange disposition correctness

#### Phase 1A — COMPLETE: read-only cross-workflow audit

Confirmed defects and invariants are recorded above.

#### Phase 1B — explicit disposition implementation

Required semantics:

`Workshop complete -> customer/order flow -> possible return -> explicit disposition -> Warehouse only if explicitly chosen`

For Workshop-origin return/exchange old item:
- default = no stock;
- return/history record independent from inventory intake;
- no-stock => no inventory mutation and no forced SKU identity resolution;
- Workshop-origin UI offers only no-stock or explicit Warehouse destination, not Boutique;
- explicit Warehouse + exact identity may use the existing freshness-safe lifecycle intake;
- explicit Warehouse + unknown/conflicting identity => one narrow resolution action before stock mutation;
- exact-known by itself never triggers intake;
- Workshop production/completion itself remains non-inventory.

#### Phase 1C — safety/regression

Must cover:
- completion/shipment no stock mutation;
- known no-stock return, retry and cancel;
- exact Warehouse disposition exactly once;
- lost-response replay no duplicate intake;
- unknown no-stock no identity task;
- unknown Warehouse disposition one identity-resolution path;
- exchange old-item same semantics;
- cancellation/reversal exactly once;
- later exact check/stocktake supersedes older lifecycle event;
- history distinguishes client return from actual Warehouse intake.

#### Phase 1D — Branch2 then Production acceptance

Technical gate first. Primary mutation acceptance only with an intentionally selected real safe scenario if necessary.

### Phase 2 — Smart Daily Stock Truth / cycle-count adoption

Goal: maintain accuracy through tiny contextual checks that normal staff actually perform. This is **not** a new task system and not a rewrite of stocktake mathematics.

#### 2A. Put routine checks in the natural workflow

- Keep full/selective `Ревизия` admin-only.
- Make safe cycle suggestions available to ordinary Warehouse users.
- Surface a compact cue/batch in `Остатки`, not only inside `Ревизия`.
- Reuse the same exact-count mutation semantics already used by normal-user `Сверить количество`.
- Do not grant ordinary users transfer/manual correction/catalog administration merely to enable counting.

#### 2B. Use an attention budget, not a backlog

- Routine user sees only a small batch, initially target 3–5 useful SKUs.
- Do not lead with the total number overdue.
- One dominant reason per SKU by default; detail only on demand.
- Negative stock/real shortage may remain urgent; “not checked for 30 days” is neutral maintenance, not a warning.
- After finishing a batch, another batch is optional rather than an endless queue.

#### 2C. One-tap matching count

Target interaction after physically locating a SKU:
- `Совпадает: X` / `На месте X` => one tap;
- mismatch => enter actual physical number;
- save and automatically advance;
- stale `expectedQuantity` conflict remains authoritative and asks to recount instead of overwriting newer truth.

#### 2D. Smarter prioritization without employee surveillance

Start with existing score and improve only where useful:
- negative Physical / negative Available / current shortage;
- never/long-unchecked;
- movement volume since check;
- prior discrepancy;
- add a small daily cap and rotation so the same skipped low-urgency item does not nag forever;
- prefer grouping nearby logical product/execution variants where it reduces mental/physical switching;
- optionally favor an SKU already being handled in the current workflow if this can be derived cheaply and safely.

Do not create worker scores, compliance dashboards, SLAs or nagging notifications.

#### 2E. Active-revision blocker must be understandable

Because one active stocktake blocks cycle checks for the entire source:
- show a clear calm reason: `Незавершённая ревизия блокирует короткие сверки`;
- for admin, make resume/cancel easy;
- distinguish an old/abandoned session by age/updated_at from a revision actively being worked on;
- do not silently remove chronology protection;
- investigate scope-aware overlap only as a separate safety change if real usage proves it necessary.

#### 2F. Cover the system-zero blind spot carefully

- Do not cycle-count all zero catalog variants.
- Consider a small risk-based sample only for recently-zeroed/high-movement/prior-discrepancy positions if evidence shows hidden extras are common.
- Full stocktake `found on shelf` remains the broad safety net.

#### 2G. Fresh recommendations without wasteful D1 reads

- Recommendation disappears immediately after successful exact confirmation.
- Refresh risk after relevant stock-affecting actions and when entering Warehouse/`Остатки`.
- Avoid polling/noisy reloads.
- Before frequent automatic refresh, inspect D1 query plan for the movements-since-check correlated count; add a composite source+variant+time index only if justified.

#### 2H. Acceptance is behavioral, not merely technical

Must prove:
1. a non-admin worker can complete a recommended batch;
2. matching SKU takes ~1–2 UI actions after finding it;
3. mismatch records actual physical once and updates truth safely;
4. stale race returns conflict rather than overwriting;
5. confirmed SKU disappears from the current batch immediately;
6. no routine prompt when nothing is meaningfully due;
7. abandoned active revision is visibly explained and recoverable by admin;
8. mobile completion of 3–5 checks is fast and readable;
9. recommendations do not create an intimidating backlog UI.

If effectiveness telemetry is ever added, measure feature outcomes such as recommendation -> check and match vs correction, not employee performance.

### Phase 3 — Catalog redesign + optional physical findability decision

Core target remains:
- Product -> Execution -> Variations;
- Execution = material/length;
- variation = established gender/type/color/size dimensions.

Keep existing cleanup safeguards: only proven garbage; no destructive name normalization; Primary evidence before cleanup; preserve history/refs; explicit `БЕЗ ЦВЕТА` stays valid; blank color must not synthesize a conflicting no-color SKU; Arrival untouched.

Before adding more inventory metadata, explicitly ask whether employees lose significant time locating physical items. Only if real usage says yes, consider a minimal optional zone/shelf field. Do not add barcode/QR infrastructure without demonstrated need.

### Phase 4 — Signal compression / Warehouse Attention / admin independence

Re-audit after Phases 1–3:
- deterministic safe cases disappear;
- no-stock Workshop return is not an inventory problem;
- exact explicit Warehouse return auto-resolves if identity/freshness are safe;
- unknown stock-affecting return asks exactly one question;
- shortages/handover/freshness/catalog ambiguity remain separated and de-duplicated;
- routine cycle cue stays calm/contextual rather than a persistent case;
- obsolete legacy/diagnostic wording is kept out of normal daily UI;
- temporary admin absence does not block normal Warehouse work.

Still no owners/SLA/deadline/case-management system.

### Phase 5 — final cross-workflow + human acceptance

Audit together:
- create/edit/zero-payment order;
- Warehouse/Boutique reservation and release/fulfilment;
- Workshop creation/progression/completion/direct-to-client semantics;
- shortage / early handover / final shipping;
- Warehouse <-> Boutique movement;
- client returns and exchanges;
- Workshop return explicit disposition;
- no-stock vs Warehouse intake;
- quick checks / smart cycle batches / full stocktake;
- active revision blocker/recovery;
- stale conflict/recount;
- system-zero discovery safety net;
- catalog selection/edit/retirement;
- Attention signal compression;
- cancellation/reversal;
- retry/lost-response;
- mobile layouts;
- history correctness;
- D1 row/bind/query/runtime limits;
- no Arrival changes.

Final invariants:
- successful mutation must not look failed merely because readback failed;
- retry never duplicates stock/business mutation;
- older event never overwrites newer physical truth;
- ordinary Workshop production never becomes Warehouse stock;
- returned Workshop product enters Warehouse only by explicit Warehouse disposition;
- routine stock accuracy does not depend on an employee voluntarily opening an admin maintenance screen;
- ordinary staff can maintain day-to-day stock truth without reconstructing system history or waiting for admin.

## Current next action

**Phase 1A is complete. Next code task: Phase 1B — correct Workshop-origin return/exchange disposition semantics.**

After Phase 1 is safely closed, implement Phase 2 as Smart Daily Stock Truth, beginning with non-admin access + a small `Остатки`-based recommendation batch and one-tap matching confirmation. Do not start Catalog redesign or add new warning infrastructure before those two phases are complete.
