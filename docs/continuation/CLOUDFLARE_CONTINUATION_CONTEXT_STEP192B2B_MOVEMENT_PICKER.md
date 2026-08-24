# Continuation context — Step 192B2B Movement Picker UX

Date: 2026-08-24
Repository: `dymovicd123/Orders-app`
Primary branch: `main`
Branch 2: `branch2`

## Current status

Step **192B2B — Movement picker + movement UX** is implemented, regression-tested, deployed to Branch 2 and promoted to Production.

Verified Branch 2 source commit:

- `7cc623879e3983c23e87a35ff092e2508b3dca93` — `Step 192B2B movement picker UX`
- exact status: `cloudflare-deploy/branch2 = success`

Production promotion commit:

- `c233c58e4b3d9a31b940c849fd2d39744c50f8df` — `Step 192B2B movement picker UX`
- exact status: `cloudflare-deploy/main = success`

The Production commit was built atomically from the same five verified B2B blobs rather than merging Branch 2 history. Main-specific configuration/auth and Branch 2-specific configuration/auth were therefore not crossed.

No D1 migration was added or executed. No D1 repair/data mutation was used for deployment. Arrival remains frozen and was not changed.

## Important acceptance rule discovered here

Branch 2 has effectively no representative warehouse stock, so it is a useful **technical acceptance environment** but a poor visual acceptance environment for data-dependent Warehouse screens.

For Warehouse UX that depends on real stock data, use this rule:

1. Branch 2 first for clean source build, full `npm run release:check`, Cloudflare deployment and non-production technical checks.
2. Promote only the reviewed source diff to `main` after the technical gate succeeds.
3. Perform **read-only visual acceptance on Primary** when Branch 2 lacks representative data. Opening/searching/selecting is allowed; do not press the final mutation button during visual-only acceptance.
4. Only perform a real mutation on Primary if a concrete runtime scenario needs acceptance and the operation is intentionally chosen.

Do not copy the Primary D1 database into Branch 2 merely to make visual testing easier unless a separate explicit migration/test-data plan is approved. Branch 2 must not be treated as evidence of Primary physical warehouse truth.

## Why 192B2B existed

The transfer runtime had already been hardened by Steps 191D/191E. The remaining problem was the read/UX layer: the movement picker mixed normal source variants with zero-quantity variants projected from the destination solely to preserve source-mismatch recovery. That made ordinary Warehouse ↔ Boutique movement look like a technical SKU dump.

Target-side variants could not simply be removed. The accepted recovery path intentionally lets an exact known SKU remain reachable when the item is physically in the source point but accounting knows the SKU only at the other point. In that case the manager can confirm actual physical presence through the already accepted observation path.

Therefore 192B2B changes ranking/search/presentation and deliberately leaves the transfer mutation runtime intact.

## Final B2B source diff

Exactly five source/test files belong to the cleaned step:

1. `src/features/inventory/movementPickerB2B.ts`
2. `src/features/inventory/views/renderInventoryMovementPanel.tsx`
3. `src/styles/192b2b-movement-picker.css`
4. `scripts/test-step192b2b-movement-picker.mjs`
5. `scripts/release-check.mjs`

The two existing modified files in `main` were verified byte-for-byte equal to the pre-B2B Branch 2 baseline before Production promotion. The new files and modified blobs were then inserted into one new main tree/commit. No full Branch 2 merge was performed.

## Behavior now

### Product picker

- Only `transfer` receives the B2B refinement; Arrival, write-off and correction keep their prior behavior.
- Selected product stays prioritized.
- Products physically present at the source rank ahead of target-only/recovery-only groups.
- Product search can match product name plus variant characteristics: material, length, color, size and gender.

### Variant picker

- Selected variants remain visible first.
- Physical source variants rank before zero-quantity rows.
- Source-mismatch recovery rows remain reachable but no longer dominate ordinary work.
- Normal default list cap: **12** rows.
- Recovery-only default list cap: **8** rows.
- Explicit variant search removes the default cap for matching results.

### Human-facing labels

- Material/length are surfaced as execution context.
- Blank or `СТАНДАРТ` execution is shown as `Исполнение: стандартное`.
- Non-standard material/length is shown as `Исполнение: ...`.
- Source-mismatch recovery row is explained as `Нет в учёте этой точки — можно подтвердить фактическое наличие`.

### Layout/mobile

Transfer-only CSS adds a bounded scroll area, sticky table header, wider/easier variant search, separated selected-product block and small-screen adjustments. Styles are scoped under `.inventory-operation-card-transfer`; Arrival selectors/styles were not modified.

## Runtime/inventory invariants preserved

192B2B did **not** rewrite the server transfer mutation path.

Keep these authoritative invariants:

- 191D/191E transfer runtime and atomicity remain the mutation baseline;
- bounded D1 mutation rowsets/binds remain required;
- reservations are not silently reinterpreted by physical transfer;
- physical-observation recovery remains available for stale source accounting;
- picker does not create/delete catalog identities;
- no schema migration;
- Arrival frozen;
- `Physical / Reserved / Available` remains the inventory model.

## Verification history

The clean B2B GitHub Actions run passed the full `npm run release:check` chain, including all preserved regressions from 189A.2 through 192B2A4 and the new `Step 192B2B movement picker UX tests`.

The intermediate failures before the final Branch 2 commit were limited to temporary generation/test tooling:

1. nested template literals in the one-time generator were not escaped;
2. generated regex backslashes in the new B2B test were initially lost inside the generator template.

Both failed before final B2B source was committed. D1 was not touched. The final Branch 2 source was committed only after the complete release gate passed.

## Current required visual acceptance — Production, read-only

Because Branch 2 has no useful stock data, now inspect **Primary** without committing a movement:

1. `Склад → Движение товара → Перемещение`.
2. Check `Склад → Бутик` and `Бутик → Склад` direction switch.
3. Pick products with many real variants.
4. Verify physically present variants are easy to find and the screen is not a giant SKU dump.
5. Search by product name, material, length, color and size.
6. Clear search after selecting a row and ensure the selected row remains understandable/visible.
7. Check source/destination/current/reserved/free quantities for clarity.
8. Check mobile layout as well as desktop.
9. Do **not** press the final `Переместить` action during visual-only acceptance unless intentionally testing a real mutation.
10. Arrival must look and behave exactly as before.

If visual acceptance finds only presentation issues, fix them as a small 192B2B follow-up through Branch 2 first; do not expand that correction into catalog cleanup.

## Cross-workflow audit findings to retain

- `renderInventoryMovementPanel` plus the existing source/target recovery read path are the correct scope for B2B; no extra 191D/191E mutation rewrite was justified.
- Exact admin stock correction already has a structured product/execution matrix and should not blindly adopt the transfer list.
- Exchange has its own order-context replacement/SmartPicker path. Reconsider picker unification later during catalog redesign rather than broadening B2B.
- B2B helper is hook-free/presentation-only so it can inform a future shared selection primitive without owning lifecycle state.
- Catalog garbage was not removed by B2B. Picker presentation and catalog truth remain separate concerns.

## Remaining Warehouse roadmap

### Next — Workshop → Warehouse known return/intake

Goal: exact known canonical Workshop return should normally auto-intake into Warehouse.

- Known valid exact variant: automatic normal path.
- Unknown/suspicious identity or conflicting attributes: manager review.
- Preserve B2A2 `Завершить приёмку` as recovery for known pending inbound.
- Preserve freshness barrier: trusted full baseline; active/overlap/stale/rechecked fail closed; pre-revision event superseded without changing current physical truth; later exact physical check supersedes an older event; only genuinely fresh unsuperseded event may mutate stock.
- Normal staff must not reconstruct manually where an item was at revision time.

### Then — calm stock-check / stocktake cycle UX

Routine flow should be: find item → record actual fact / `На месте` → save. Server handles chronology, reservations and freshness. Keep quick stocktake and `inventory_stock_checks`; historical reconstruction remains exceptional/internal.

### Then — Step 192B3 Catalog redesign

- Product → execution → variation structure.
- Practical search/navigation/editing.
- Remove/retire only 100%-proven garbage.
- Legitimate explicit `БЕЗ ЦВЕТА` stays valid.
- Blank manager color must not synthesize/select a conflicting colorless SKU.
- Preserve order/history/reference relationships and retirement semantics.

### Then — final Warehouse cross-workflow acceptance

Audit together: create/edit orders; unpaid Workshop; reservations; shortages; early handover; final shipping; Warehouse ↔ Boutique; Workshop returns; returns/exchanges; stock checks; stocktakes; catalog flows; mobile; retry/lost-response; history; Cloudflare/D1 limits.

## Global/deferred rules

- GitHub is source of truth.
- Normal source release: Branch 2 technical gate → monitored Cloudflare success → reviewed diff to main → monitored Production success.
- For data-dependent Warehouse UX with empty Branch 2, Primary visual acceptance may be read-only after successful technical promotion.
- D1 migrations never run automatically from ordinary Git pushes.
- No manual D1 repair for routine operations.
- Step 190.0 access/login remains deferred pending client agreement.
- Do not introduce Warehouse case/SLA/owner infrastructure. Admin independence should come from deterministic safe defaults, automatic known-state handling, narrow exception actions and retry/recovery paths.
