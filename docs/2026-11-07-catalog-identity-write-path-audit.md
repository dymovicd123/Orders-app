# Catalog identity write-path audit — Orders-app / Branch2, 2026-11-07

## Operational rule

A manager must be able to record a sale using existing SKU or manual description without learning the resolver internals. Routine order operations may **find existing SKU identities across all stock sources** but cannot create any new product, execution (material+length), or variant. This includes valid new combinations of known reference values.

**No new manager dialogs, confirmation pages, merging or alias maintenance.** Existing model/material/color/size selection, source control, and custom form remain.

## Entry points

| Path | What happens | Allowed to create SKU? |
|---|---|---|
| Main order create (normal, source-scoped exact SKU) | Server validates exact SKU and characteristics; active stock reserve where applicable | No |
| Main order create (manually entered, Workshop or warehouse/boutique) | Matches exact active SKU across entire catalog regardless of source; unknown identity remains unresolved | No |
| Main order create (legacy free-form without variant ID) | Looks up active known variant, otherwise unresolved and order can continue subject to inventory safeguards | No |
| Order idempotent retry, rewrite/edit | Existing exact identifiers and read-only resolver; stock changes through normal lifecycle | No |
| Exchange replacement (single, batch) | Match active SKU only; unknown replacement remains unresolved, never fabricated during exchange | No |
| Background catalog-review queue | Link previously unresolved order to an existing active SKU; no automatic catalog creation | No |
| Return existing item | Relates and processes original historical variant; does not use new-combination creation | No |
| Catalog product/variant admin APIs | Explicit creation guarded by admin authorization and duplicate/known-value checks | **Yes — explicit** |
| Stocktake “found combination” | Explicit addition of observed stock, with known references or deliberate create-field action | **Yes — explicit** |
| Historical catalog-review resolution | Explicit admin flow to create/reconcile a chosen missing combination | **Yes — explicit** |

## Code boundaries

- `resolveCatalogProductAndVariantV2(..., { createMissing: false })`: existing exact active combination first. If not found, return `unresolved_variant`/`unresolved_execution` (without executing `ensureCatalogExecutionV3` or `createCatalogCombinationV3`).
- `resolveCatalogProductAndVariant(..., { createMissing: false })`: applies read-only behavior even for old non-V3 database shape by using flat lookup instead of legacy auto-insertion.
- Callers in `orders-write.ts`, `returns-exchanges.ts`, and background reconciliation explicitly use read-only mode.
- Dedicated stocktake and admin catalog creation are intentionally not changed; these must continue to support actual new physical goods.
- No database migration, no real production write, no Main deploy.

## Residual risks and non-goals

1. Unknown manual descriptions may remain unresolved and require normal clarification, but they are never converted into arbitrary new catalog identities. Further UX streamlining can be considered only if it does not increase manager work.
2. Administrator can deliberately create a catalog variant with the same human meaning but different literal values; authorization and duplicate checks are already in place, though canonical reference governance may warrant a separate focused review.
3. Historical identity and existing duplicates are not merged in this change; no new workflow is introduced for staff.
4. Verify that existing exchange/return/stocktake regression suites accept the stricter runtime no-creation rule before Main promotion.

## Acceptance

- Exact active variant reused across both stock sources.
- Missing known-size or known-material combination does not create product, execution or SKU.
- Unmatched orders and exchanges remain safe and auditable.
- Ordinary manager flow receives no extra steps.
- Full-worker HTTP checks, browser interactions, and existing Main business release gates pass in isolated Branch2.
