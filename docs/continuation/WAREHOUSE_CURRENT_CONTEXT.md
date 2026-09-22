# Warehouse current context — canonical continuation

Updated: 2026-09-22
Repository: `dymovicd123/Orders-app`

## CRITICAL environment invariant — Branch2 / Production D1 must never mix

On 2026-09-22 Branch2 was found with the Production D1 binding. Repository forensics identified the lineage error:

- reviewed Branch2 Stage02 state existed at `1984ff897a56cedb026278ff4cd7f503e06ee8c4` with the correct isolated binding:
  - Worker `orders-app-branch2`;
  - D1 `orders_db_branch2`;
  - id `40065052-854e-44b8-bcd5-251bdd488301`;
- Production candidate `1778c42701426a916a3b21a451156cece4e71b9a` merged that state into Production;
- Production hotfix `186f9b58ecd8e188783dd6b1886c30e190393c4b` correctly restored Production identity:
  - Worker `orders-app`;
  - D1 `orders_db_prod`;
  - id `17e68a41-1d58-4a36-8a63-47c3e32443c4`;
- later Branch2 sync commits were started from that Production hotfix tree and copied business files back one-by-one, but did **not** restore Branch2 environment identity. That left `branch2` using the Production binding.

Emergency repair: `0f38bf4f1c85ef124237abd952384b05513b946c` restores Branch2 `wrangler.jsonc`, visual title marker, Branch2 environment regression gate, and replaces the Production environment test in Branch2 `release:check`.

Permanent rule:
- Branch2 and Production D1 are separate physical databases and must never share bindings or data implicitly.
- Never use a Production tree as a Branch2 baseline without explicitly restoring/verifying Branch2 environment identity before any deploy.
- Never use a Branch2 tree as a Production release without explicitly restoring/verifying Production environment identity before any deploy.
- Never copy D1 data between environments unless the user explicitly requests that exact data-copy operation.
- Before any Branch2/Production D1 mutation, verify Worker name + D1 logical name + D1 id.
- If the environments appear identical, stop mutations and verify binding first.

---

This file is the canonical current continuation context for Warehouse work. It supersedes older roadmap wording where it conflicts with this file. Git history preserves earlier checkpoints.


## Checkpoint 2026-09-22 — Stage03-C catalog price UI

Baseline: `branch2` `29c1b7009242da884c74b8704ded159d508bcc79`. Branch2 Worker/D1 identity was verified before UI work; Production binding absent. Migration 0072 is already present only in Branch2 D1 and had zero backfilled price rows.

Implemented in Branch2 UI:
- price editing lives inside each execution card (product + material + length), above color/size details;
- rows are shown only for adult/child categories actually present in that execution;
- cost and sale price remain admin-only in Catalog;
- blank input maps to `NULL`; zero remains an explicit zero;
- save uses the existing full-pair admin `PUT /api/catalog/execution-prices`;
- ambiguous lost-response handling tells the admin to refresh/check before retrying;
- phone layout is included.

No gender/color/size/age price rule is invented.

Client requirement clarified by user: the catalog sale price must later prefill the order form, while managers need a way to apply a discount/price adjustment when necessary. That is **recorded but deliberately deferred** until after the base price-setting UI is accepted. Stage03-C does not touch order creation/editing, `unit_price`, or discount semantics.

No D1 mutation is performed by this UI commit.

---

## Checkpoint 2026-09-22 — Stage03-B3 admin price write contract

Baseline: `branch2` `94695197141b496b96a1153ed6936f3502001fd4`. Branch2 Worker/D1 identity was re-verified before editing; no Production binding is present.

Backend contract now includes:
- existing Catalog variant response exposes canonical `stockPositionId` with no extra query;
- admin-only `PUT /api/catalog/execution-prices`;
- request is an explicit full pair: `stockPositionId + adult|child + costPrice + salePrice`;
- nullable values mean intentionally unset; non-null values must be whole non-negative KZT;
- target execution must exist and be active;
- one UPSERT keyed by `(stock_position_id, category)`;
- write fails narrowly if migration 0072 is not actually applied;
- current price mutation never rewrites `order_items.unit_price` or any historical order/inventory row.

No D1 migration is executed by this source step and no UI is added.

Next gate: cumulative Branch2 build/deploy. After green, the remaining backend step is controlled application/acceptance of migration 0072 in **Branch2 D1 only**. Production/main promotion remains after backend acceptance and before Stage03 UI, per user instruction.

---

## Checkpoint 2026-09-22 — Stage03-B2 read-only Catalog price contract

Baseline: `branch2` `c41ee03e92a0649f6b3bf5b5e0ae34aff89d5c84`.

Before editing, Branch2 environment identity was re-verified as `orders-app-branch2` + `orders_db_branch2` (`40065052-854e-44b8-bcd5-251bdd488301`) with no Production binding.

B1 Cloudflare build failed for a non-runtime reason: Step 190.6C correctly detected the newly added historical migration file as unregistered (`64/63`). B2 registers migration 0072 as an accepted additive migration rather than weakening migration-history protection.

B2 adds a read-only `GET /api/catalog` contract:
- top-level `executionPrices`;
- one batched SELECT, no per-SKU/N+1 reads;
- key/context: execution + adult/child;
- nullable current cost/sale prices;
- graceful pre-migration fallback to `executionPrices: []` if table 0072 does not yet exist.

No D1 migration is executed by this source step. No price write endpoint, UI, order defaulting, historical order rewrite or cost snapshot is added.

Focused regression: `scripts/test-stage03-b-execution-price-read-contract.mjs`.

Branch2 cumulative Cloudflare build/deploy for code commit `e0de9e3c6e4612339e5afa20e07f06a779bb8cd6` completed successfully (GitHub Actions run `35720604755`). The environment-isolation gate passed before Cloudflare build monitoring, and the cumulative release/build checks passed with migration 0072 still unapplied.

Next: review B1+B2 together, then add the admin write path as a separate bounded step. Do not apply migration 0072 to any D1 until that write contract is reviewed.

---

## Checkpoint 2026-09-22 — Stage03-B1 price schema contract

Baseline: `branch2` `693e0cba25ed3349f9b0e9ac6524055e97693846`.

Branch2 environment identity was verified before work:
- Worker `orders-app-branch2`;
- D1 `orders_db_branch2`;
- D1 id `40065052-854e-44b8-bcd5-251bdd488301`;
- Production D1 binding absent.

Added additive migration file `migrations/0072_v72_catalog_execution_prices.sql`, but **did not execute it on Branch2 or Production D1**.

Schema decision:
- base current-price key = `stock_position_id + category`;
- table = `catalog_execution_prices`;
- fields = nullable non-negative integer `cost_price` + `sale_price`;
- one row per execution + `adult|child`;
- no historical/current-price backfill;
- gender/color/size/age remain unresolved and are not encoded as pricing dimensions.

Canonical design note: `docs/continuation/STAGE03_B_EXECUTION_PRICE_SCHEMA_20260922.md`.

Next micro-step: Stage03-B2 read-only Catalog API contract only. Do not apply migration 0072 until schema/API review is complete.

---

## Checkpoint 2026-09-22 — Stage03-A commercial price model corrected

Baseline before correction: `branch2` `be8371b440dd249cbb0c9118913e96cf24efa7db`.

User clarified a previously missing business invariant:
- material changes price;
- length changes price;
- adult vs child changes price;
- effect of gender, color and exact size/child age is still unanswered by the client.

Therefore the previous product-level pricing decision is superseded.

Current minimum known price scope is:

`product + material + length + adult/child`

In the current canonical identity this maps naturally to execution (`catalog_stock_positions.id`) + audience category.

Do not store the current two prices only on `catalog_products`, and do not duplicate them across every exact SKU. The preferred schema direction is a separate commercial-price record keyed by execution + audience category.

Gender/color/size/age pricing stays explicitly unresolved. If later confirmed, add a more-specific override layer only after the precedence rule is known.

Historical invariants remain unchanged:
- `order_items.unit_price` is the actual historical sale transaction price and is never rewritten by later catalog changes;
- historical cost still waits for Stage04 Workshop invoice/intake allocation instead of using today's mutable cost as false history.

Canonical design note: `docs/continuation/STAGE03_A_COMMERCIAL_PRICE_MODEL_20260922.md`.

Next micro-step: Stage03-B schema-contract design for execution + adult/child pricing only. No migration/UI/order defaulting yet.

---

## Checkpoint 2026-09-19 — Stage02 transactional stock truth resumed

The active Warehouse work is now Stage02 Phase2 under the redesigned transactional truth model in `STAGE02_PHASE2_STOCK_TRUTH_MODEL_20260919.md`. The older Smart Daily Stock / self-healing framing is superseded where it conflicts with that design.

Current verified baseline before the Phase2C candidate:
- `branch2`: `d7ef267a3581dcb8a2781b16b82ae2889b5698fd` (Phase2B shipping possession resolver);
- `main`: `f7a6f7240bcaf3c73e7568d7b9b33d98d87b8ac5` (Production Phase2B);
- migration 0071 `inventory_operation_evidence` has already been applied to both Branch2 and Production D1.

Completed: Phase2A primitives/evidence model and Phase2B final shipping. Current code step: **Phase2C early handover / `issue_now`** on branch `w-stage02-phase2c-early-handover-20260919`. Historical checkpoint answers `still_here` / `issued_before_checkpoint` remain separate lineage truth and must not be repurposed as stock-quantity confirmation.

After 2C: Phase2D transfer + writeoff, then Phase2E remove normal-operation dependency on Attention and run Stage02 acceptance.

**Release gate requested by user:** complete the remaining Stage02 work in `branch2`, then stop for the user's full inspection/complaints before promoting Phase2C+ to Production. Do not skip this review gate.


## Checkpoint 2026-09-10 — W paused, not completed; O1 prioritized

User explicitly postponed further Warehouse implementation to think through the audit and real usage. W remains open. Historical W8 completion means only that UI delivery package, not acceptance of the Warehouse product goal or completion of W9 discussion.

Production read-only audit found 32 order-observation records in manager mode across 21 orders (28 zero-to-positive corrections, 4 unchanged confirmations), but no standalone quick-count records in the retained check history. This proves contextual order-entry recovery is used, not general spontaneous stock maintenance. Actor attribution is shared access mode plus order manager, not personal authentication. Of 32 observations, 30 equal the corresponding current order quantity; this does not establish whether a full physical count occurred.

Open product questions: full count versus seeing only the item for an order; reporting missing stock without asserting an unverified zero; contextual follow-through; aggregate variant shortages hidden by surplus; same-day handover checkpoint precision. Do not implement these under O1.

O1 is a separate optimization step, now deployed to primary via PR #29 / main `90750f25e491b1ba5c47b9b13d8dbdb75084caeb` with successful Cloudflare deployment confirmation. Migration 0067 indexes are applied; 30/30 measured SQL result hashes match. See `O1_READ_BUDGET_20260909.md` for costs and remaining limitations (no measured compact-handover read reduction). Stock/reservation/handover semantics and Arrival UI remain unchanged; Branch2 untouched. O1 completion does NOT complete or resume W.

## Checkpoint 2026-09-06 — W8.4 final mobile acceptance / W8 closure

W8.4 closes the W8 interface work unless a concrete Production defect appears. The final mobile gap was in `Операции`: transfer already used phone cards, while `Списание` and `Исправить количество` still inherited a 660px desktop table. W8.4 makes those two rare modes readable/touch-safe on <=760px without changing their mutation logic, and keeps Arrival outside the new selectors.

The final audit also found one integration defect from W8.3: `w8-3-daily-surfaces.css` existed but was not imported by the Warehouse bundle. W8.4 fixes that import chain and adds a regression check so W8.3 History/Attention styling cannot silently become dead CSS again.

No Worker/API/D1/migration/stock-math/Arrival/Branch2 change is part of W8.4. Dedicated validation passed cumulative release checks, database safety, production build, lint and Wrangler dry-run. After merge/deploy, the next Warehouse phase is **W9 — full read-only Warehouse audit and discussion before another broad implementation wave**.

---

## Checkpoint 2026-09-06 — W8.3 remaining daily Warehouse surfaces polish

W8.3 is a narrow interface pass after W8.2, not the W9 full Warehouse audit. `История` keeps the selected exact SKU visible and exact physical-check rows now name the product/variant. `Нужно уточнить -> Товар` keeps the same derived data/actions but separates found-on-shelf, lifecycle intake identity and order-position identity into distinct visual groups. `Операции` and `Проверка` were reviewed and left unchanged because their accepted W4/W5 workflows already have clear primary actions and safety wording; Arrival remains frozen.

No Worker/API/D1/migration/business-truth change is part of W8.3. Next W8 pass is final cross-screen visual/mobile acceptance and only concrete defects found there. W9 remains reserved for the full Warehouse audit/discussion.

---

## Checkpoint 2026-09-06 — W8.2 `Остатки` workspace finish

W8.2 continues W8.1 instead of declaring `Остатки` complete prematurely. Explicit search now reveals all matching SKU rows regardless of the normal availability filter; product-level totals stay truthful when the filter hides some variants; exact SKU opening is neutral and the physical check is a separate explicit action; routine short checks no longer precede the main stock list; large products collapse color groups and keep better context; reservation-detail loading is latest-request-wins. Business truth and D1 mutation paths remain unchanged.

After the remaining W8 interface passes are finished, W9 is reserved for a full Warehouse audit and discussion before another broad implementation wave.

---

## Checkpoint 2026-09-06 — W8.1 `Остатки` interface completion

Baseline entering W8.1: `main` `ed889662e9d6dc0fc5fdfdd95943bb5641a8db5b` (W7). Work branch: `w8-1-stock-overview-completion`.

W8.1 is a presentation-only completion of the daily `Остатки` workflow. Multi-variant products keep exact SKU identity but browse as Execution -> Color -> category/gender subgroup -> large Size/Age tiles. Each tile shows source-specific Available/Physical/Reserved truth and reuses the existing exact quick-check drawer. A current-result count now explicitly separates search/filter scope from the global source summary. No Worker/API/D1/migration, stock mathematics, Catalog, Arrival, Branch2 or pricing change is in scope.

Next after green W8.1 acceptance: audit the remaining daily Warehouse surfaces (`Операции`, `Проверка`, `История`, recovery inbox) for concrete usability gaps only; do not reopen closed business semantics without evidence.

---

## Checkpoint 2026-09-06 — W7 exact-SKU history / price readiness

Baseline entering W7: `main` `246dfea9fb999fd10b68ad2b4a6d716f2d3792a8` (W6.4A). Work branch: `w7-sku-history-price-readiness-audit`.

Current conclusion: exact SKU history already exists and must be reused rather than rebuilt. Catalog SKU cards route lazily to the existing Warehouse history with explicit `source + variant_id`; no history reads are added to ordinary Catalog browsing. The shared history controller now uses latest-request-wins protection so a stale in-flight source/SKU/mode response cannot overwrite a newer history context. Pricing remains deferred: no price fields/API/migration/UI are introduced. Stable product/execution/variant identity and existing commercial anchors are preserved; historical `order_items.unit_price` remains a transaction snapshot that future catalog-price changes must never rewrite.

Next after green W7 acceptance: W8 Warehouse interface completion, starting from `Остатки`. Arrival remains frozen.

---

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
6. A returned Workshop item enters neither Warehouse nor Boutique inventory unless one of those destinations is explicitly chosen.
7. Exact-known identity does not justify automatic intake.
8. Identity resolution is required only when an actual stock-affecting disposition needs a canonical SKU.
9. A no-stock Workshop return must not create pointless catalog/Attention work.
10. No implicit Warehouse or Boutique intake. Both are valid only through an explicit disposition. The same rule applies to the old item in an exchange.

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
3. Return UI may offer no-stock / Warehouse / Boutique. For Workshop-origin returns, no-stock is the default; Warehouse or Boutique are valid only as explicit stock destinations.
4. Exchange old-item draft correctly defaults to no-stock. A Workshop old item follows the same explicit-disposition rule: no-stock by default, with Warehouse or Boutique only when deliberately selected.
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

`Workshop complete -> customer/order flow -> possible return -> explicit disposition -> Warehouse/Boutique only if explicitly chosen`

For Workshop-origin return/exchange old item:
- default = no stock;
- return/history record independent from inventory intake;
- no-stock => no inventory mutation and no forced SKU identity resolution;
- Workshop-origin UI offers no-stock by default plus explicit Warehouse or Boutique destinations;
- explicit Warehouse/Boutique + exact identity may use the existing freshness-safe lifecycle intake;
- explicit Warehouse/Boutique + unknown/conflicting identity => one narrow resolution action before stock mutation;
- exact-known by itself never triggers intake;
- Workshop production/completion itself remains non-inventory.

#### Phase 1C — safety/regression

Must cover:
- completion/shipment no stock mutation;
- known no-stock return, retry and cancel;
- exact Warehouse/Boutique disposition exactly once;
- lost-response replay no duplicate intake;
- unknown no-stock no identity task;
- unknown Warehouse/Boutique disposition one identity-resolution path;
- exchange old-item same semantics;
- cancellation/reversal exactly once;
- later exact check/stocktake supersedes older lifecycle event;
- history distinguishes client return from actual Warehouse intake.

#### Phase 1D — Branch2 then Production acceptance

Technical gate first. Primary mutation acceptance only with an intentionally selected real safe scenario if necessary.

### Phase 2 — Transactional Stock Truth + bounded Stock Resolver

**Redesigned on 2026-09-19 after user review. The previous proactive/self-healing stock-check concept is superseded.**

Canonical design: `docs/continuation/STAGE02_PHASE2_STOCK_TRUTH_MODEL_20260919.md`.

Core rule:
- normal operations may prove **a movement/delta** or that the concrete units involved are physically present;
- only an explicit stock-count/correction workflow may claim the **absolute total** Physical for a SKU;
- contextual resolver answers must never be disguised as full physical counts;
- outbound conflicts use bounded stock semantics and durable operation evidence instead of driving Physical negative or inventing a pre-operation count;
- Warehouse Attention is not a required work inbox.

Approved resolver surfaces:
- final shipping shortage;
- early handover `issue_now` shortage;
- Warehouse/Boutique transfer shortage at source;
- manual writeoff shortage at source.

Not resolver surfaces:
- return/exchange intake;
- full/selective/quick stocktake;
- manual absolute correction;
- Arrival;
- proactive prompts solely because stock is old.

Implementation order:
1. Phase2A truth primitives + operation-evidence model;
2. Phase2B shipping;
3. Phase2C early handover;
4. Phase2D transfer/writeoff;
5. Phase2E remove normal-work dependency on Attention and run final acceptance.

The old Smart Daily Stock Truth proposal is intentionally removed from the active plan. It relied on a user performing a real full-SKU count during unrelated work, which is not a safe assumption.

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
- returned Workshop product enters Warehouse or Boutique only by explicit destination;
- routine stock accuracy does not depend on an employee voluntarily opening an admin maintenance screen;
- ordinary staff can maintain day-to-day stock truth without reconstructing system history or waiting for admin.

## Current next action

**Phase 1A is complete. Next code task: Phase 1B — correct Workshop-origin return/exchange disposition semantics.**

After Phase 1 is safely closed, implement Phase 2 as Smart Daily Stock Truth, beginning with non-admin access + a small `Остатки`-based recommendation batch and one-tap matching confirmation. Do not start Catalog redesign or add new warning infrastructure before those two phases are complete.


## Checkpoint 2026-09-19 — Phase2D micro-step mode

- User requested that Stage02 continue in small, bounded steps rather than large bursts, to avoid losing progress to response/tool time limits.
- Current working branch: `w-stage02-phase2d-transfer-writeoff-20260919`.
- Current branch head when this checkpoint was written: `4e8e9103199ef6a01b5934eb4bc41b5e670fcbda`.
- Phase2C changes are already included in this branch; current work is Phase2D transfer/writeoff transactional possession handling.
- The latest GitHub Actions attempt is blocked before project checks by an external npm registry audit HTTP 503, so that failure is not yet evidence of a project regression.
- Continue with one narrow verification/fix at a time, report it, then proceed to the next micro-step.

- Phase2D micro-step: fixed legacy negative Physical handling in transfer. Source/target quantities are normalized to >= 0 at the transaction boundary; stale guards and retry diagnostics use the same semantics; transfer-in applies exact +Q from a non-negative baseline. This prevents an infinite resolver loop where the UI confirms expectedQuantity=0 but the server compares it to a legacy negative value. Regression assertions were added in `scripts/test-stage02-phase2d-transfer-writeoff-possession-resolver.mjs`. Commits: `c9e05d981be22ece8fda70aedf3d8d6edec2e06e`, `6a0cdd6d234cb234b6dd5f62cb41fbdf9bed9c52`.

- Phase2D micro-step: verified transfer resolver idempotency. A committed `request_id` is checked before stock-confirmation/resolver validation; resolver confirmations are not part of the transfer fingerprint; `inventory_transfer_documents.request_id` is UNIQUE; concurrent identical retries recover through the winning document; transfer items and operation evidence also have uniqueness guards. Added regression assertions and registered the Phase2D test in `scripts/release-check.mjs`. Commits: `d191ad47e7978682a22809997f52b7ee2c8bea59`, `e9da8aef051b2b9acc4129c1cef03e9ff0d9d42f`.

- Phase2D balanced checkpoint: writeoff resolver now uses the same bounded legacy-negative semantics as transfer, so old negative Physical is treated as 0 only for writeoff operation confirmation/replay while exact manual correction semantics stay unchanged. Writeoff retry/idempotency invariants are covered: committed `operation_id` short-circuits before resolver validation, confirmations are excluded from the request fingerprint, concurrent identical retries converge on duplicate success, and evidence keys remain unique. The Phase2D regression itself is green. CI then exposed the expected structural-preservation layer mismatch from Phase2D edits; added exact Phase2D Worker/frontend manifests and outer normalization layers for Step 190.6A/190.6B. Relevant commits: `25d6eb160c2f348dc652201bc30409686beaea33`, `01c3d517234a63d19a7321e8cb5cf0681ff0c1c0`, `1d9ed76857ae8d7892b4a693c917599091c2f3b9`, `f05ecdb5ee8aa358495e4af48caaec18044860f1`, `2dd0562500653ba87eb337bf317d85012ad3b126`, `aa10952a4c09f53616cc3f05af2b16299a23f117`. Latest full Quality run for the final structural-layer commit is still in progress at this checkpoint.

- Phase2D completion checkpoint: combined transfer + manual writeoff resolver audit is green. Additional correctness fixes found during final review: transfer reversal now restores only the source Physical delta that the forward transfer actually deducted (the explained portion), while destination reversal still removes exact Q; zero/negative tracked writeoff rows remain selectable so the possession resolver is reachable instead of being hidden by the UI; duplicate manual-movement retries no longer emit duplicate activity-log events; Worker route result narrowing is explicit and TypeScript-safe. W4/W8.4 legacy acceptance assertions were updated to protect the new bounded-possession flow instead of the retired full-count prompt. Full Quality run `35459453380` succeeded on code head `106a0dc9e849b1643d12a5f499e797f6beb694b4`. Phase2C is still stacked underneath Phase2D and neither is in production. Next repository action is to merge the combined Phase2C+Phase2D branch into `branch2`; production remains blocked until the user's full Stage02 review.
