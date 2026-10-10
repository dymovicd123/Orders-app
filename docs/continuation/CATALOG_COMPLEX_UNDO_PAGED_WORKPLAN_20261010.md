# Complex SKU undo: full paginated evidence and operational workplan (2026-10-10)

## Business principle
Post-merger sales, shipments, returns, exchanges, stocktakes, warehouse/boutique movements and altered reservations are **historical facts**. Do not “undo” them by resetting old SKU foreign keys, rolling back physical stock to merger-day quantities or fabricating compensating movements. Preserve shipped customer snapshots, money, workshop and Stage04 history. If a prior catalog consolidation no longer reflects the desired SKU identity, the administrator must first reconcile actual current commitments and physical quantities using existing live workflows.

## Admin-only READ-ONLY APIs
1. `GET /api/catalog/variants/consolidation-undo-case-review?consolidationId=N`: established high-level summary with blocker and first 50 links per category.
2. `GET /api/catalog/variants/consolidation-undo-case-details?consolidationId=N&section=reservations|orders|movements|checks&afterId=0&limit=25`: new **cursor-paged** exact historical evidence. Page size 1–50, stable increasing record IDs, full category total count, nextCursor, hasMore and per-record safe next step. Original merger-time stock-finalization movement excluded only when its reference and timestamp match exactly; later sales and unknown-date movements remain visible. Reuses identical original reservation risk classifier across summary and pages.
3. `GET /api/catalog/variants/consolidation-undo-case-workplan?consolidationId=N`: new **operational plan** listing current separate stock and reserve amounts by warehouse/boutique, historical merged figures as evidence, counts of later movements/physical checks, warnings where new reconciliation is necessary, and the next operational actions for customer obligations, missing links, shipments, returns/exchanges, physical counting, and other dependencies.

All three require admin authentication. New endpoints are GET-only and do not create audit/stock/order records or locks. They return `noChangesApplied=true`; **no endpoint returns permission to broadly undo complex merger history**. 50-row pagination is for investigation only: records can change between HTTP requests. Refresh the overall case before taking other actions. No claim of a frozen cross-page transaction.

## Case routing
- All original live untouched reservations, with no other changes: use the pre-existing narrowly guarded `consolidation-undo-reserved-preview` and its atomic writer, **never** infer eligibility from these detail pages.
- Shipped/completed/exchanged/returned orders: retain immutable original order and inventory history. Any new business action must use existing order, exchange or return operations.
- Stock changed since merger: verify authoritative current warehouse/boutique counts. Existing revision/writeoff/transfer flows record genuine new movements; do not perform a secret “reverse old merge” stock edit.
- Lost references/unknown dates/truncated case summary: investigate full evidence and reconcile. No blind reuse of the old merger snapshot.

## Tests and deployment
New Node SQLite regressions cover >50 movements across cursor pages, no duplicated/lost IDs, original merger-time correction exclusion, unknown-date movement inclusion, customer reservation risk after shipment, later orders and stock checks, per-location workplan, malformed cursors, zero data mutations and no safe-to-undo flags. Quality, Stage04-safe cumulative integration, Cloudflare PR check and exact `branch2` deploy must succeed before considering ready. `main` and production database remain untouched.

## Remaining
User-facing human-friendly admin interface and a carefully scoped **manual case resolution experience** where multiple post-merge obligations remain. Beyond complex undo: characteristic merges, duplicate prevention, references/writeoff UX and final main audit. Do not add a universal compensating SQL writer without an explicit physically and financially reconciled case contract.
