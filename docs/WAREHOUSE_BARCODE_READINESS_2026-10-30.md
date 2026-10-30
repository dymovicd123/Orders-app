# Warehouse barcode readiness: current safety boundary (Branch2, 2026-10-30)

## Confirmed physical workflow

Goods arrive from Kyrgyzstan. The warehouse lead identifies **each physical garment** (correct catalog product, gender/category, color, material, length and size), applies a barcode label and registers the received stock. Warehouse and Boutique are distinct physical sources. An identifying label is **not** evidence of arrival until the corresponding warehouse intake has been committed.

**Do not prematurely implement scans or print labels from a free-text product name.** A label must resolve to exactly one currently active canonical `catalog_variants.id`; the physical unit should later have its own unique label/receipt identifier so scanning the same garment twice cannot count it twice. Whether to reuse the same variant barcode visibly on all equal pieces versus individual serial labels requires a deliberate decision at scanner design time. It does not change the immutable SKU identity rule.

### Read-only live Branch2 audit evidence

- [GET-only Worker release readback #41104740262](https://github.com/dymovicd123/Orders-app/actions/runs/41104740262): active Branch2 version `9ae4a96a-9abe-46c3-a3df-b5451461c64d`; latest code at `0d772f4` uploaded successfully **without publication**; automatic deploy disabled.
- [D1 SELECT-only integrity audit #41105783225](https://github.com/dymovicd123/Orders-app/actions/runs/41105783225): 1,817 physical stock rows, 1,612 active catalog variants, 31 active reservation rows. No duplicate source+variant stock records, no duplicate **exact active** catalog variant identities, no stock/product variant-reference mismatches, no reserved quantities disagreeing with active reservation sums, no active reservation with a missing stock row, no active reservation referencing an absent variant, and no unidentified positive stock rows.
- **11 source+variant rows where physical stock is lower than active reservations (14 units short)**: 9 warehouse variants (12 units) and 2 boutique variants (2 units). [Read-only drilldown #41106059677](https://github.com/dymovicd123/Orders-app/actions/runs/41106059677). Source/variant/physical/reserved breakdown (no customer data): warehouse 1241 (0/2), 1541 (1/3), 1716 (0/2), 178 (0/1), 207 (0/1), 209 (0/1), 1300 (0/1), 1444 (0/1), 1821 (0/1); boutique 212 (0/1), 1800 (0/1). These are not proof of a current mutation bug; some may be explained by a later stocktake and pending handover. **Never blindly add stock or remove reservations.** Review the existing Warehouse Attention handover categorization and the individual order histories before intervention.
- 2 pending inbound `inventory_lifecycle_events` remain and require a specific identity/physical-receipt review. Future barcode printing must not silently resolve or double-apply these events.

### Technical invariants before enabling any scanner

1. **SKU is an identity, not just a product name.** Each source stock record points to the exact active canonical variant; retired and merged variants must be redirected only through approved, audited consolidation records. Never auto-select `ORDER BY id LIMIT 1` for ambiguous active SKU identities.
2. **Receiving is separated from counting.** Import shipment into an *uncommitted draft*; warehouse lead identifies each item; labels and quantities are reconciled to a unique receipt/unit key; one atomic confirmed arrival adds physical stock and an audit movement. Printed/reprinted labels alone do not change stock.
3. **Scan idempotency.** The same physical label/receipt key cannot be counted twice on retry, lost response or repeated scan. A duplicate should show the prior event, not create a second arrival. Keep line/product/source identity canonical.
4. **Transfer/dispatch/write-off.** A scanned unit can belong to only one physical location at a time. Transfer uses a single guarded source-to-target transaction; shipment accounts for any active reservations without a second physical decrement.
5. **Returns and exchanges.** Preserve original shipped `variant_id`, source and receipt/label relation. A physically returned piece must be explicitly accepted before stock increases; money-only refunds do not alter physical stock. Unlabeled pieces require a visible manual identity-resolution state. This deeper investigation is planned for the next stage, not silently fixed here.
6. **Stocktakes and adjustments.** Maintain `physical` and `reserved` separately, and use explicit count checkpoints. A scanned label may prove a counted item but must not rewrite existing reservations or overwrite a newer count.
7. **Operator UI.** Identify a SKU visually by human-friendly product characteristics and source, show in-stock, reserved and free quantities. For ambiguity/missing variant: block commit and direct to product catalog/resolver. For existing physical/reservation conflicts: show action and related orders in warehouse problems/history.
8. **Release gates.** Real SQLite tests, production build, authenticated manager/warehouse UI acceptance, SELECT-only D1 before/after audits, known Worker version/rollback, then explicit Branch2 promotion. **Main is frozen** until everything—including full order intake—is accepted.

### Two small targeted code changes in this PR

`reconcileFoundInventoryStock()`, used for physical pieces found during stocktakes, now fails closed for multiple matching SKU identities, duplicate stock records, and unresolved rows with active reserved quantity. It checks the number of affected rows and blocks a stale operation instead of reporting false success. [SQLite regression in this PR](../scripts/test-found-stock-unique-identity-barcode-readiness-20261030.mjs) checks seven cases.

**Existing-variant Arrival guard:** when a warehouse lead selects a known `variantId`, the server now verifies that the actual entered type, gender, color, material, length and size still match that canonical active SKU, while accepting harmless color-hyphen/spacing normalization. The original product ID / trusted alias checks remain. A stale picker cannot credit goods to a different size or color. [Exact-variant regression](../scripts/test-arrival-canonical-barcode-sku-20261030.mjs) covers the accepted match and six attribute mismatches.

**Not implemented in this PR:** physical-label or barcode tables, scanner API, barcode format, label printing, shipment intake drafts, automated data repairs, or changes to old orders/exchanges. This is a narrow prerequisite, not a claim that barcode rollout is ready.
