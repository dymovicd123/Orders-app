# W7 adjacent review checklist — 2026-09-06

This checklist records the adjacent paths reviewed before W7 promotion.

- Catalog browsing itself performs no history request; history is still opened only after an explicit click.
- Exact SKU identity is preserved by passing the existing `variant_id`; no fallback to product/name matching is introduced.
- Warehouse and Boutique history are explicit separate choices so a zero current balance does not hide older history at the other source.
- Existing Warehouse history retains both modes: movements and physical checks/revisions.
- `Остатки → История` keeps using the same `openSimpleStockHistory` path; W7 reuses it rather than replacing it.
- Existing history pagination/search behavior is untouched.
- Manager history stays read-only; the existing destructive reverse action remains admin-only.
- SKU `Создать похожий`, exceptional correction and guarded soft-retirement are unchanged.
- No stock/reservation/transfer/stocktake/lifecycle mathematics changed.
- No new API endpoint, polling, migration or Production D1 read/write was introduced.
- Arrival remains frozen.
- Price readiness is structural only. No price field, price inheritance rule or price UI is introduced.
