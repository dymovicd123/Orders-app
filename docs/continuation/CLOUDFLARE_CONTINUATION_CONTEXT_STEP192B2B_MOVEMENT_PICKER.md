# Continuation context — Step 192B2B Movement Picker UX

Date: 2026-08-24
Repository: `dymovicd123/Orders-app`
Current implementation branch: `branch2`
Production branch: `main`

## Status at handoff

Step **192B2B — Movement picker + movement UX** is implemented, fully regression-tested and deployed to **Branch 2**.

Primary B2B source commit:

- `7cc623879e3983c23e87a35ff092e2508b3dca93` — `Step 192B2B movement picker UX`
- Cloudflare status for that exact SHA: `cloudflare-deploy/branch2 = success`

Post-step CI cleanup:

- `b5612e01b8486d47a6bbc43fd75d683932ffa796` — restored the normal read-only Cloudflare deploy monitor after the temporary B2B verification runner.

Step 192B2B is **not yet promoted to `main`**. The next action is visual acceptance on Branch 2, then promotion of the same five-file source diff to `main` and verification of `cloudflare-deploy/main = success`.

No D1 migration was added or executed. No D1 data mutation was performed by the installer/verification process. Arrival UI remains unchanged.

## Why this step existed

The transfer runtime itself was already hardened by Steps 191D/191E. The user-facing problem was the read/UX layer: movement selection mixed normal physically present source variants with zero-quantity variants surfaced from the target point solely for source-mismatch recovery. This made the picker look like a large technical SKU dump and made ordinary Warehouse ↔ Boutique work unnecessarily difficult.

The audit confirmed that target-side variants must not simply be removed. The existing recovery path intentionally unions source rows with target rows so that a manager can recover a real-world case where a SKU is physically at the source but accounting currently knows that exact SKU only at the other point. Such a row is represented for the source as an exact known variant with source quantity `0` / no source stock row, then the accepted physical-observation path can confirm the fact safely.

Therefore B2B keeps the recovery capability and changes only how the choices are ranked, searched and presented.

## Final source diff

Compared with the pre-B2B Branch 2 baseline `0c7a3abe5f9d9113ae85e42cd8139934f9e62592`, the cleaned post-B2B tree contains exactly five source/test files changed:

1. `src/features/inventory/movementPickerB2B.ts` — new hook-free read/UX refinement helper.
2. `src/features/inventory/views/renderInventoryMovementPanel.tsx` — applies the B2B refinement to the existing movement renderer; accepted mutation JSX/runtime remains intact.
3. `src/styles/192b2b-movement-picker.css` — scoped transfer-picker layout/scroll/mobile styling only.
4. `scripts/test-step192b2b-movement-picker.mjs` — dedicated B2B regression coverage.
5. `scripts/release-check.mjs` — includes B2B files and executes the B2B regression test.

Temporary bootstrap/generator files were removed from the final tree. The temporary diagnostic `apply_b2b` job was removed by restoring `.github/workflows/cloudflare-deploy-monitor.yml` to the standard monitor content matching `main`.

## B2B behavior now

### Product-level selection

- Only `transfer` uses the new refinement; write-off, correction and Arrival paths keep their existing behavior.
- The selected product/group is kept at the top.
- Products with physical quantity at the source are ranked before target-only / recovery-only groups.
- Within the remainder, larger source physical totals are preferred, then product name.
- Product search is no longer effectively name-only: the search tokens can match product name plus variant characteristics including material, length, color, size and gender.

### Variant-level selection

- Already-selected variants stay visible first, so clearing a search cannot make a selected recovery row disappear.
- Physically present source variants come before zero-quantity variants.
- Source-mismatch recovery rows are pushed behind ordinary source rows instead of crowding the normal choice list.
- Without an explicit variant search, a normal product is capped at **12** visible rows.
- A recovery-only product is capped at **8** rows.
- When the manager types an explicit variant search, the cap is removed for the matching result set so all matching rows remain reachable.

### Human-readable labels

- Material/length are surfaced first as execution context.
- Blank/`СТАНДАРТ` execution becomes `Исполнение: стандартное` rather than looking like an unknown value.
- Non-standard material/length appears as `Исполнение: ...`.
- A target-only source-mismatch row is explicitly explained as:
  `Нет в учёте этой точки — можно подтвердить фактическое наличие`.
- Existing variant details (category/gender/color/size/current accounting context) remain available; B2B does not destroy identity information.

### Scrolling/mobile

The transfer picker has scoped styling only under `.inventory-operation-card-transfer`:

- variant list has a bounded scroll area (`max-height: min(58vh, 560px)`; smaller-screen adjustment included),
- table header remains sticky while scrolling,
- variant search area is easier to use and not artificially narrow,
- selected-product block is visually separated,
- no Arrival selectors/styles were modified.

## Runtime/inventory invariants deliberately preserved

B2B did **not** rewrite the server transfer mutation path.

The Step 191D/191E invariants remain authoritative:

- exact transfer runtime and source-mismatch recovery path preserved;
- bounded D1 mutation rowsets and bind counts preserved;
- atomic transfer writes preserved;
- no new reservation model;
- physical movement does not silently reinterpret or delete existing order reservations;
- manager physical observation path remains available when accounting source quantity is stale;
- no catalog identity is created/deleted by the picker;
- no migration or schema change;
- Arrival remains frozen.

The B2B regression explicitly guards the source/target union markers in `useOperationalViewModel.ts`, including the target-row recovery projection with source quantity `0`.

## Verification result

The successful clean GitHub Actions run reached and passed the entire historical `npm run release:check` chain before committing B2B.

Confirmed passes included:

- Source invariants;
- 189A.2;
- 189B history + SQL;
- 189C money + SQL;
- 189D / 189D.1;
- 190.1 / 190.2 / 190.3 / 190.4 / 190.5;
- 190.6A/B/C/D/E;
- 191D transfer runtime;
- 191E runtime limits / atomicity;
- 191F admin session;
- 192A1 Warehouse truth / freshness;
- 192A2 catalog truth;
- 192B1;
- 192B2A;
- 192B2A1;
- 192B2A2;
- 192B2A3;
- 192B2A4 order create/save integrity;
- **192B2B movement picker UX test**.

Then Cloudflare deployed commit `7cc623879e3983c23e87a35ff092e2508b3dca93` to `orders-app-branch2`, and the GitHub monitor reported `cloudflare-deploy/branch2 = success` for that exact commit.

## Intermediate failures and what they mean

Several temporary B2B bootstrap commits exist in Branch 2 history. They are diagnostic history, not final source state.

Two failures were found before the final code commit:

1. The first one-time generator embedded TypeScript template literals inside a JavaScript template literal without escaping nested backticks. Node failed while parsing the temporary generator, before B2B source was applied.
2. After that was corrected, the generated B2B test lost regex backslashes inside the generator template (`\b`, `\s`, `\(`). The full release gate reached the new B2B test and stopped there. Old regression tests had already passed. The generator wrapper was corrected so the final generated helper/test preserve the regex escapes.

These failures did not mutate D1 or partially commit B2B runtime code. The final source was committed only after the full release gate passed.

Do not reintroduce the temporary bootstrap workflow. Future source edits should use the normal GitHub workflow: Branch 2 source commit → Cloudflare `release:check` + deploy → monitor status → visual/functional acceptance → same reviewed diff to `main`.

## Visual acceptance still required before `main`

Check Branch 2 UI, especially on mobile as well as desktop:

1. Open `Склад → Движение товара → Перемещение`.
2. Test Warehouse → Boutique and Boutique → Warehouse direction swap.
3. Pick a product with many variants; ordinary physically present variants should be easy to see without a huge technical dump.
4. Search by product name and by characteristic tokens such as material, length, color or size.
5. Confirm a selected row remains selected/visible after clearing the search.
6. If a known source-mismatch case is available, verify the row is still reachable and clearly says it is absent in accounting for this point but may be confirmed physically.
7. Confirm quantities/current source/destination values remain understandable and transfer execution itself behaves as before.
8. Confirm Arrival visually and behaviorally remains unchanged.

If the visual acceptance reveals only presentation defects, fix them inside B2B on `branch2` before promotion. Do not expand that fix into catalog cleanup.

## Promotion to Production after acceptance

Do **not** merge the whole temporary Branch 2 commit history into `main`.

Promote the cleaned B2B source diff only (the five files listed above), preserving `main`-specific configuration/auth. Then:

1. wait for `cloudflare-deploy/main = success`;
2. verify Production health / relevant read paths;
3. update this continuation context to record the Production commit SHA and final acceptance status.

No automatic D1 migration should run from the push.

## Cross-workflow audit findings to carry forward

- `renderInventoryMovementPanel` and the source/target recovery read path are the correct B2B scope; 191D/191E server runtime did not require another rewrite.
- Exact admin stock correction remains a separate advanced workflow and already uses a structured product/execution matrix; do not force B2B's transfer list onto it blindly.
- Exchange currently has its own order-context replacement form and SmartPicker-based characteristic entry. It should be reconsidered during later catalog/picker unification, but changing it inside B2B would broaden risk unnecessarily.
- The B2B helper is deliberately hook-free and presentation-only so it can later inform a shared catalog/SKU selection primitive without entangling inventory lifecycle state.
- Real catalog garbage is not deleted or rewritten in B2B. Picker presentation and catalog truth remain separate concerns.

## Remaining Warehouse roadmap after B2B

After B2B visual acceptance + Production promotion, continue in this order:

### 1. Workshop → Warehouse known return/intake

- Exact known canonical Workshop return should normally auto-intake.
- Unknown/suspicious identity goes to manager review.
- Keep B2A2 `Завершить приёмку` as the safe recovery action for known pending inbound.
- Preserve the freshness barrier: trusted full baseline; active/overlap/stale/rechecked fail closed; pre-revision event is superseded without changing current physical truth; later exact physical check supersedes older event; only genuinely fresh unsuperseded event may mutate physical stock.
- Ordinary staff must not have to reconstruct manually where the item was at the revision date.

### 2. Calm stock-check / stocktake cycle UX

- Routine count should be narrow and understandable: find item → record fact / `На месте` → save.
- Server handles chronology, reservations and freshness.
- Historical reconstruction stays exceptional/internal.
- Keep quick stocktake and `inventory_stock_checks` truth semantics.

### 3. Step 192B3 — Catalog redesign

- Replace the current technical catalog dump with usable product → execution → variation management.
- Search/navigation/editing must be practical for staff.
- Remove only 100%-proven garbage; never bulk-delete by suspicious label alone.
- Legitimate explicit `БЕЗ ЦВЕТА` remains valid.
- Blank manager color must not synthesize or select a conflicting colorless SKU.
- Preserve order/history/reference links and retirement semantics.

### 4. Final cross-workflow Warehouse acceptance

Audit together:

- create/edit order and unpaid Workshop;
- reservations and shortages;
- early handover and final shipping;
- Warehouse ↔ Boutique transfers;
- returns/exchanges;
- Workshop returns/intake;
- stock checks and stocktakes;
- catalog flows;
- mobile UX;
- retry/lost-response/idempotency;
- history/audit visibility;
- Cloudflare/D1 query and mutation limits.

## Global invariants / deferred work

- Arrival UI is frozen: do not change it.
- `Physical / Reserved / Available` remains the inventory model.
- User-facing shipping is all-or-nothing; partial shipment is not a normal order state.
- Branch 2 has separate D1 and branch-specific auth/config; never use it as proof of Primary physical warehouse truth and never overwrite its auth from `main`.
- GitHub is source of truth. Normal source-only workflow: `branch2` → successful monitored Cloudflare deploy → acceptance → reviewed diff to `main` → successful monitored Production deploy.
- D1 migrations are never automatic from ordinary Git pushes.
- Step 190.0 access/login redesign remains deferred pending client agreement.
- Do not introduce a persistent task/case/SLA/owner system for Warehouse Attention. Admin independence should come from deterministic safe defaults, auto-handling of known states, narrow actionable exceptions and recovery paths.
