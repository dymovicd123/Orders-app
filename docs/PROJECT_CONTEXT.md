# Постоянный контекст проекта «Система заказов»

Updated: 2026-09-26

Этот файл хранит **долгоживущие архитектурные и инженерные инварианты**. Текущий статус этапов/релизов хранится в корневом `PROJECT_CONTINUATION.md`.

Старые `CLOUDFLARE_CONTINUATION_CONTEXT_STEP*.md`, старые ZIP/context-файлы и исторические Stage-документы — evidence/history. Они не заменяют актуальный GitHub.

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
- D1: `orders_db_branch2`
- D1 id: `40065052-854e-44b8-bcd5-251bdd488301`

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
