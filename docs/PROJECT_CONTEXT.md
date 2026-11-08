# Постоянный контекст проекта «Система заказов»

Updated: 2026-11-08 (Branch2 environment identity and sync checkpoint; older sections below remain historical)

Этот файл хранит **долгоживущие архитектурные и инженерные инварианты**. Текущий статус этапов/релизов хранится в корневом `PROJECT_CONTINUATION.md`.

Старые `CLOUDFLARE_CONTINUATION_CONTEXT_STEP*.md`, старые ZIP/context-файлы и исторические Stage-документы — evidence/history. Они не заменяют актуальный GitHub.

## Synchronization with Main — 2026-11-08 (Branch2-only stage 1)

- Checked actual GitHub heads: Main `e72ca3296e5ff71981c2f8f5558fe1a25ba938a7`, Branch2 `7127790374d68f056ff2c172ad754fd64a023bf4` before this sync PR. Branches have diverged and **must not** be merged or overwritten wholesale.
- First selected semantic fix: Branch2 Return creation already validated refundable money before its D1 batch, but lacked Main's atomic SQL revalidation. Copied just Main's guarded INSERT into Branch2 plus the identical race-conflict mapping. The money-event and physical item claim statements remain in the same batch. Existing Return active-reserve SQL test now executes the real guarded INSERT against disposable SQLite, including simultaneous stale preflights, zero-money, cancelled Return, and archived-order cases. This patch does not alter Main or any D1 database.
- Still intentionally **not synchronized**: Main's selective-shipment route architecture and domain refactors, and Branch2-specific Exchange cancellation/dispatch behavior, must be reconciled case by case with real Worker HTTP/SQLite tests. Do not copy Main `returns-exchanges.ts`, `worker/index.ts`, `wrangler.jsonc`, production migrations, or DB IDs on top of Branch2.
- Main architecture continuation: `AGENTS.md` and `docs/architecture/orders-app-audit-2026-11-08.md` in Main; use target-branch code and PR checks as the final truth. Exact PR status and Branch2 deployment must be checked separately.

## Source of truth

- Перед любой содержательной работой сначала проверять `dymovicd123/Orders-app` на GitHub.
- Использовать код текущей target-ветки, а не память о прошлой сессии.
- При конфликте старого документа с current branch/history приоритет у current GitHub.
- Никогда не переносить целые старые файлы поверх новой ветки без намеренного reconciliation.

## Архитектура

- Frontend: React + TypeScript + Vite.
- Backend: Cloudflare Worker + D1.
- `worker/index.ts` — composition root; доменная логика разнесена по `worker/domains`.
- Runtime-модули должны быть достижимы из `src/main.tsx` / `worker/index.ts`, кроме deliberately inactive contracts/fixtures, явно защищённых regression gate.
- CSS order/cascade является частью поведения; широкую CSS cleanup не смешивать с изменением business semantics.

## Environment isolation

Production:
- branch: `main`
- Worker: `orders-app`
- D1: `orders_db_prod`
- D1 id: `17e68a41-1d58-4a36-8a63-47c3e32443c4`

Branch2:
- branch: `branch2`
- Worker: `orders-app-branch2`
- D1: `orders_db_branch2_mirror_20261027` (actual `branch2` `wrangler.jsonc`)
- D1 id: `0904a573-21ff-44d8-93b0-c9200f771702` (actual Branch2 binding; reverify before any action)

Permanent rules:
- never cross-bind Worker/D1;
- never copy data between environments without explicit user request;
- verify actual physical binding before every D1 mutation;
- branch name is not proof of binding;
- preserve branch-specific `wrangler.jsonc`, visual marker and environment gate;
- do not blanket-apply legacy migration journals; audit schema/journal first and apply only the specific migration proven necessary.

Incident 2026-09-22: Branch2 temporarily inherited Production D1 identity. Fix `0f38bf4f1c85ef124237abd952384b05513b946c` is the permanent reminder to verify environment identity before deploy/mutation.

## Catalog identity and Resolver

Canonical identity hierarchy:
1. product — `catalog_products`;
2. execution — product + material + length, represented by `catalog_stock_positions`;
3. exact SKU — execution + audience category + gender + color + size/age, represented by `catalog_variants`.

Resolver invariants:
- anomaly guard, not compatibility questionnaire;
- a fact is known if present in maintained references or any active Catalog SKU;
- harmless punctuation/spacing identity canonicalizes automatically;
- recognized facts are independent: exact combination absence is not itself an anomaly;
- safe missing exact combination may be created/linked at physical stock 0;
- explicit manager gender wins, otherwise concrete selected SKU gender, then fixed product scope fallback;
- duplicate-reference guard is prospective/non-destructive.

## Inventory truth

- `Physical` = tracked physical count.
- `Reserved` = promises/reservations.
- `Available = Physical - Reserved`.
- Only explicit count/correction workflows can replace absolute Physical.
- Shipping/handover/transfer/writeoff possession confirmation proves only the concrete handled quantity.
- For unexplained outbound, source Physical is bounded at zero; unexplained quantity is append-only operation evidence.
- Transfer target still receives exact +Q.
- Return/exchange intake is transaction truth, not a fake stock count.
- Catalog/identity ambiguity and physical-quantity ambiguity are separate problems.
- Arrival / «Приход» is frozen unless user explicitly reopens it.

## Orders / finance truth

- Historical order state is not reinterpreted from mutable current Catalog.
- Payments are independent money facts with their own history.
- Debt derives from persisted commercial total and actual received money.
- Safe corrections preserve history through correction/reversal instead of silent rewrite.
- Return physical facts and refund amount are independent.
- Exchange physical change and exchange payment/refund are independent.
- Modern `itemized_v1` Exchange is a **set operation**, not a list of forced old→new pairs: old items and new items are independent collections.
- Itemized Exchange commercial total is derived from persisted sold line values; actual payment/refund is derived separately from real net paid.
- A never-issued exchanged item releases reservation/Workshop obligation without increasing Physical; a customer-held old item may remain pending and be received later per line.
- Delayed Set Exchange intake keeps a unique lifecycle identity per old exchange item; one group's lines may have different Warehouse/Boutique/no-stock dispositions.

Stage03 pricing model (active on Branch2, not yet fully promoted to Production):
- `legacy_manual_total` preserves old order-total truth.
- `itemized_v1` uses factual sold `unit_price`, `line_total = quantity × unit_price`.
- `catalog_price_snapshot` stores the historical Catalog recommendation, not actual payment and not mutable current price.
- Existing legacy orders must never be auto-converted/repriced.

## Operational autonomy

Routine legitimate correction should be possible in the application:
- multiple independent returns / return+exchange coexistence by remaining item capacity;
- debt close after legitimate return;
- explicit mistaken sent/handover correction;
- audited exchange-finance correction;
- ordinary posted-payment correction.

Safety comes from fresh-state validation, CAS/stale checks, idempotency, append-only history and reconciliation — not from requiring developer intervention.

## Change discipline

For every material change:
1. start from current target branch;
2. define influence map;
3. implement one coherent slice;
4. add direct semantic regressions;
5. run cumulative `npm run release:check`/build as appropriate;
6. verify environment identity;
7. for D1 changes, prove schema target and exact migration;
8. merge only reviewed diff;
9. verify exact merged SHA deploy status;
10. update continuation.

For dangerous mutation paths explicitly test:
- retry after lost response;
- duplicate request;
- stale editor/state;
- partial failure after critical write;
- no duplicate money/stock/history effect.

Do not treat secondary readback/history failures as proof that a completed critical business write failed.

## Testing philosophy

- Prefer semantic/domain tests for business invariants.
- Exact-source manifests are acceptable for frozen or historically sensitive layers, but should not expand casually.
- Keep byte-level freeze for truly protected artifacts such as Arrival.
- Data-dependent acceptance on Branch2 is not automatically representative; Production should be read-only/non-destructive until an explicit mutation test is authorized.

## Protected product boundaries

- Arrival UI is frozen.
- Step 190.0 access/auth remains deferred pending client agreement.
- CLIENT-ZAMMLER uses the existing Orders/Workshop model and is not roadmap Stage04.
- Resolver R11/R12/R13 is considered stable; change only for a concrete defect.
- Full Stage03 Production promotion requires explicit user authorization and fresh reconciliation from current main.
