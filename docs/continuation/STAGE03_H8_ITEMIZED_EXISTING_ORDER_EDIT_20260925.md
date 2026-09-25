# Stage03-H8 — Existing itemized order editing

Date: 2026-09-25

Status: **H8A backend foundation implemented on Branch2. Restricted editor UI is not activated yet.**

## Why H8 exists

H7 intentionally activated itemized pricing only for new order creation. The old full-order editor remained blocked for `itemized_v1` because it was built around a manually editable order total and could rewrite item rows/inventory.

That guard remains correct for commercial or physical rewrites, but it is unnecessarily broad for safe non-commercial corrections such as:
- order date;
- manager;
- customer identity;
- city;
- delivery text;
- comment;
- correction of already-posted payment facts through the existing audited payment-correction path.

## H8A — backend metadata-only lane

`updateOrderCritical` now recognizes an itemized metadata-only edit only when the request contains **none** of the following:
- items;
- payments replacement;
- order total;
- pricing mode;
- source type;
- Workshop lifecycle status;
- order lifecycle status;
- shipping status/date.

If any of those are present, the existing itemized fail-closed guard still rejects the legacy PATCH.

The allowed lane therefore cannot:
- reprice a sold item;
- change `catalog_price_snapshot`;
- change quantity/product/SKU/source;
- move stock or reservations;
- replace the payment ledger;
- alter order/workshop/shipping lifecycle.

The persisted itemized `orders.total_amount` remains unchanged. Existing posted-payment corrections may update received/debt through the already-audited correction path.

## Rollout boundary

H8A is backend-only. The current frontend still blocks opening/saving itemized orders in the legacy full editor.

H8B will provide a restricted UI that sends only the allowed metadata/payment-correction payload. Product lines, quantities, sources, final sold prices and Catalog snapshots will be displayed as historical read-only facts until a separate commercial/physical edit design is implemented.

Environment rule remains unchanged: Branch2 Worker + Branch2 D1 only. Production is not a target.
